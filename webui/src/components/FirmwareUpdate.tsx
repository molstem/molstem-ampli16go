import { useRef, useEffect } from 'react';
import {
  Box,
  Button,
  LinearProgress,
  Paper,
  TextField,
  Typography,
  Alert,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useFirmwareStore } from '../stores/firmwareStore';
import { useSerialStore } from '../stores/serialStore';
import { useLogStore } from '../stores/logStore';
import { useTelemetryStore } from '../stores/telemetryStore';
import { scpiClient } from '../services/scpiClient';
import { uploadFirmware, waitForDone, FirmwareUploadError } from '../services/firmwareUpdater';

const formatBytes = (n: number): string => {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MiB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${n} B`;
};

export const FirmwareUpdate: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const {
    fileName,
    status,
    isUploading,
    phase,
    progress,
    bytesAcked,
    totalBytes,
    error,
    setFilePath,
    setFileName,
    setStatus,
    setIsUploading,
    setPhase,
    setTransfer,
    setError,
  } = useFirmwareStore();

  const isConnected = useSerialStore((state) => state.isConnected);
  const deviceMode = useTelemetryStore((state) => state.deviceMode);
  const identity = useTelemetryStore((state) => state.identity);
  const addLog = useLogStore((state) => state.addLog);

  // Cancel a running transfer when the link goes away
  useEffect(() => {
    if (!isConnected) {
      abortRef.current?.abort();
    }
  }, [isConnected]);

  const handleBrowse = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setFileName(file.name);
      setFilePath(file.name);
      setPhase('idle');
      setError(null);
      setTransfer(0, file.size);
      setStatus(`Ready to upload ${file.name} (${formatBytes(file.size)})`);
      addLog(`Selected: ${file.name}`, 'info');
    }
  };

  const handleStartUpdate = async () => {
    if (!isConnected) {
      setStatus('No device connected');
      addLog('No device connected', 'error');
      return;
    }
    if (deviceMode !== 'bootloader') {
      setStatus('Device is not in the bootloader');
      addLog('Device is not in the bootloader', 'error');
      return;
    }

    const file = fileInputRef.current?.files?.[0];
    if (!file) {
      setStatus('No file selected');
      addLog('Select a .fwu file', 'error');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setIsUploading(true);
    setPhase('uploading');
    setError(null);
    setTransfer(0, file.size);
    setStatus('Uploading…');
    addLog(`Starting firmware update: ${file.name} (${formatBytes(file.size)})`, 'info');

    try {
      const image = new Uint8Array(await file.arrayBuffer());

      await uploadFirmware(
        image,
        ({ bytesAcked: acked, totalBytes: total }) => {
          setTransfer(acked, total);
          setStatus(`Uploading… ${formatBytes(acked)} / ${formatBytes(total)}`);
        },
        controller.signal
      );

      setPhase('finalizing');
      setStatus('All data acknowledged, waiting for the bootloader to finish…');
      addLog('Firmware data acknowledged; waiting for DONE', 'info');

      try {
        await waitForDone((s) => {
          setStatus(`Bootloader: ${s.state} ${s.percent}%${s.message ? ` (${s.message})` : ''}`);
        }, controller.signal);
      } catch (e) {
        // If the link dropped after the last OK the device is already rebooting.
        if (!(e instanceof FirmwareUploadError) || e.code !== null || useSerialStore.getState().isConnected) {
          throw e;
        }
      }

      setPhase('done');
      setStatus('Update complete, device rebooting');
      addLog('Firmware update complete, device rebooting', 'success');
    } catch (err) {
      const uploadError =
        err instanceof FirmwareUploadError
          ? err
          : new FirmwareUploadError(null, err instanceof Error ? err.message : String(err));
      setPhase('error');
      setError({ code: uploadError.code, msg: uploadError.msg });
      setStatus(
        uploadError.code !== null
          ? `Upload failed: ERR ${uploadError.code}${uploadError.msg ? ` "${uploadError.msg}"` : ''}`
          : `Upload failed: ${uploadError.msg}`
      );
      addLog(`Firmware update error: ${uploadError.message}`, 'error');
    } finally {
      abortRef.current = null;
      setIsUploading(false);
    }
  };

  const handleReset = async () => {
    try {
      await scpiClient.command('*RST', 5000);
      addLog('Bootloader reset (*RST); reconnect and start over', 'info');
      setPhase('idle');
      setError(null);
      setTransfer(0, totalBytes);
      setStatus('Bootloader reset. Reconnect if the link dropped, then start the update again.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addLog(`Reset failed: ${message}`, 'error');
    }
  };

  const alertSeverity = phase === 'done' ? 'success' : phase === 'error' ? 'error' : 'info';

  return (
    <Paper elevation={0} sx={{ p: 2, height: '100%', boxShadow: 'none' }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {/* Mode banner */}
        {isConnected && deviceMode === 'unknown' && (
          <Alert severity="info">Identifying device (*IDN?)…</Alert>
        )}

        {isConnected && deviceMode === 'app' && (
          <Alert severity="warning">
            Device is running the application, not the bootloader.<br />
            Use the device menu (Firmware update) to enter the bootloader, then reconnect.
          </Alert>
        )}

        {isConnected && deviceMode === 'provisioning' && (
          <Alert severity="warning">
            Device is unprovisioned (ESP32 provisioning mode). Provision it first; firmware updates
            need the STM32 bootloader.
          </Alert>
        )}

        {/* Bootloader UI */}
        {isConnected && deviceMode === 'bootloader' && (
          <>
            <Alert severity="success">
              Bootloader detected{identity?.version ? `: ${identity.version}` : ''}
              {identity?.serial ? ` (UID ${identity.serial})` : ''}
            </Alert>

            {/* File Selection */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <TextField
                fullWidth
                size="small"
                label="File Selected"
                value={fileName}
                InputProps={{ readOnly: true }}
                placeholder="No file selected"
              />

              <Button
                variant="outlined"
                onClick={handleBrowse}
                disabled={isUploading}
                startIcon={<UploadFileIcon />}
              >
                Browse
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept=".fwu"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
            </Box>

            {/* Progress Bar - bytes acknowledged by the bootloader */}
            <Box>
              <LinearProgress
                variant={phase === 'finalizing' ? 'indeterminate' : 'determinate'}
                value={progress}
                sx={{ height: 10, borderRadius: 5 }}
              />
              <Typography variant="caption" sx={{ mt: 0.5, display: 'block' }}>
                {totalBytes > 0
                  ? `Programming: ${progress}% (${formatBytes(bytesAcked)} of ${formatBytes(totalBytes)} acknowledged)`
                  : 'Programming: 0%'}
              </Typography>
            </Box>

            {/* Upload / Reset Buttons */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                variant="contained"
                color="primary"
                onClick={handleStartUpdate}
                disabled={!fileName || isUploading || !isConnected || phase === 'done'}
                sx={{ flex: 1 }}
              >
                {isUploading ? 'Uploading...' : 'Start Update'}
              </Button>

              {phase === 'error' && (
                <Button
                  variant="outlined"
                  color="warning"
                  onClick={handleReset}
                  startIcon={<RestartAltIcon />}
                >
                  Reset bootloader
                </Button>
              )}
            </Box>

            {/* Status */}
            <Alert severity={alertSeverity}>
              {status}
              {error && error.code !== null && (
                <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                  Bootloader error code {error.code}. Press "Reset bootloader" (*RST) and start over.
                </Typography>
              )}
            </Alert>
          </>
        )}
      </Box>
    </Paper>
  );
};
