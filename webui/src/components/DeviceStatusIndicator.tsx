import React, { useState } from 'react';
import { Box, Chip, IconButton, Tooltip, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useSerialStore } from '../stores/serialStore';
import { useTelemetryStore, type DeviceMode, type DeviceState } from '../stores/telemetryStore';
import { devicePoller } from '../services/devicePoller';

const MODE_LABEL: Record<DeviceMode, string> = {
  unknown: 'Identifying…',
  app: 'Application',
  bootloader: 'Bootloader',
  provisioning: 'Provisioning',
};

const stateColor = (state: DeviceState): 'default' | 'success' | 'warning' | 'info' => {
  switch (state) {
    case 'RUNNING':
      return 'success';
    case 'BUSY':
      return 'warning';
    case 'IDLE':
      return 'info';
    default:
      return 'default';
  }
};

interface DeviceStatusIndicatorProps {
  /** `block` (default) is the centred text used on disconnected panels; `inline` fits the header. */
  variant?: 'block' | 'inline';
}

export const DeviceStatusIndicator: React.FC<DeviceStatusIndicatorProps> = ({ variant = 'block' }) => {
  const isConnected = useSerialStore((state) => state.isConnected);
  const deviceMode = useTelemetryStore((state) => state.deviceMode);
  const deviceState = useTelemetryStore((state) => state.state);
  const transport = useTelemetryStore((state) => state.transport);
  const identity = useTelemetryStore((state) => state.identity);
  const cycle = useTelemetryStore((state) => state.cycle);
  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await devicePoller.refreshNow();
    } finally {
      setRefreshing(false);
    }
  };

  const modeText = isConnected ? MODE_LABEL[deviceMode] : null;
  const stateText = isConnected && deviceMode === 'app' ? (deviceState ?? '…') : null;
  const phaseText =
    cycle && deviceState === 'RUNNING'
      ? `${cycle.phase.replace(/_/g, ' ').toLowerCase()} ${cycle.cycle}/${cycle.totalCycles}`
      : null;
  const tooltip = identity
    ? `${identity.serial || 'no serial'} · ${identity.version || 'unknown version'}${transport ? ` · ${transport}` : ''}`
    : transport ?? '';

  const refreshButton =
    isConnected && transport === 'cloud' ? (
      <Tooltip title="Refresh device status now (cloud polls every 60 s while idle)">
        <span>
          <IconButton size="small" onClick={handleRefresh} disabled={refreshing} aria-label="Refresh device status">
            <RefreshIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    ) : null;

  if (variant === 'inline') {
    if (!isConnected) return null;
    return (
      <Tooltip title={tooltip}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Chip size="small" variant="outlined" label={modeText} />
          {stateText && (
            <Chip
              size="small"
              color={stateColor(deviceState)}
              label={phaseText ? `${stateText} · ${phaseText}` : stateText}
            />
          )}
          {refreshButton}
        </Box>
      </Tooltip>
    );
  }

  return (
    <Box sx={{ textAlign: 'center', mt: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <Typography variant="body2" color="text.secondary">
        Device: {isConnected ? 'Connected' : 'Disconnected'}
        {modeText ? ` · ${modeText}` : ''}
        {stateText ? ` · ${stateText}` : ''}
      </Typography>
      {isConnected && (
        <Typography variant="caption" color="text.secondary">
          {tooltip}
        </Typography>
      )}
      {refreshButton}
    </Box>
  );
};
