import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import { useTelemetryStore } from '../stores/telemetryStore';
import { useLogStore } from '../stores/logStore';
import { CurrentProtocolPlot } from '../components/CurrentProtocolPlot';
import { describeError, stopProtocol } from '../services/protocolCommands';
import { formatDuration, formatRemaining, formatTemp, humanizePhase } from '../utils/format';

export const RunningView: React.FC = () => {
  const cycle = useTelemetryStore((s) => s.cycle);
  const addLog = useLogStore((s) => s.addLog);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const aborting = cycle?.phase === 'ABORTING';
  const progress = cycle && cycle.totalS > 0 ? Math.min(100, (cycle.elapsedS / cycle.totalS) * 100) : undefined;

  const handleStop = async () => {
    setConfirmStop(false);
    setStopping(true);
    setError(null);
    try {
      await stopProtocol();
      addLog('Protocol stopped (device is aborting)', 'warning');
    } catch (e) {
      const text = `Stop failed: ${describeError(e)}`;
      setError(text);
      addLog(text, 'error');
    } finally {
      setStopping(false);
    }
  };

  return (
    <Container maxWidth="md" sx={{ py: { xs: 2, sm: 3 } }}>
      <Stack spacing={2}>
        <Box>
          <Typography variant="overline" color="text.secondary" component="div">
            {aborting ? 'Stopping' : 'Running'}
          </Typography>
          <Typography variant="h4" component="h1">
            {cycle ? humanizePhase(cycle.phase) : 'Bio protocol'}
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 2 }}>
            <Stat label="Cycle" value={cycle && cycle.totalCycles > 0 ? `${cycle.cycle} / ${cycle.totalCycles}` : '—'} />
            <Stat label="Remaining in step" value={cycle ? formatRemaining(cycle.remaining) : '—'} />
            <Stat label="Elapsed" value={cycle ? formatDuration(cycle.elapsedS) : '—'} />
            <Stat label="Total" value={cycle && cycle.totalS > 0 ? formatDuration(cycle.totalS) : '—'} />
            <Stat label="Block" value={cycle ? formatTemp(cycle.peltierT) : '—'} sub={cycle?.peltierTarget != null ? `→ ${formatTemp(cycle.peltierTarget)}` : undefined} />
            <Stat label="Lid" value={cycle ? formatTemp(cycle.lidT) : '—'} sub={cycle?.lidTarget != null ? `→ ${formatTemp(cycle.lidTarget)}` : undefined} />
          </Box>
          <LinearProgress
            variant={progress === undefined ? 'indeterminate' : 'determinate'}
            value={progress}
            sx={{ mt: 2, height: 6, borderRadius: 3 }}
          />
        </Paper>

        <Paper variant="outlined" sx={{ height: 'clamp(240px, 45vh, 520px)', overflow: 'hidden' }}>
          <CurrentProtocolPlot />
        </Paper>

        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

        <Button
          variant="outlined"
          color="error"
          size="large"
          startIcon={<StopIcon />}
          onClick={() => setConfirmStop(true)}
          disabled={stopping || aborting}
          sx={{ minHeight: 48, alignSelf: { xs: 'stretch', sm: 'flex-end' } }}
        >
          {aborting ? 'Stopping…' : stopping ? 'Sending stop…' : 'Stop protocol'}
        </Button>
      </Stack>

      <Dialog open={confirmStop} onClose={() => setConfirmStop(false)}>
        <DialogTitle>Stop the running protocol?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            The device will abort the current run and return to the home screen. This cannot be resumed.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmStop(false)}>Keep running</Button>
          <Button color="error" variant="contained" startIcon={<StopIcon />} onClick={handleStop} autoFocus>
            Stop protocol
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};

const Stat: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
  <Box>
    <Typography variant="caption" color="text.secondary" component="div">
      {label}
    </Typography>
    <Typography variant="h6" component="div" sx={{ fontFamily: 'JetBrains Mono, monospace', lineHeight: 1.3 }}>
      {value}
    </Typography>
    {sub && (
      <Typography variant="caption" color="text.secondary" component="div" sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
        {sub}
      </Typography>
    )}
  </Box>
);
