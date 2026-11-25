import React from 'react';
import { Box, Button } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useSerialStore } from '../stores/serialStore';
import { HardwareMonitorPlot } from '../components/HardwareMonitorPlot';
import { SerialIO } from '../components/SerialIO';
import { LogDisplay } from '../components/LogDisplay';
import { ConnectView } from '../views/ConnectView';
import type { Route } from '../routes';

export type DiagnosticsPanel = 'hw-monitor' | 'serial' | 'log';

const TITLES: Record<DiagnosticsPanel, string> = {
  'hw-monitor': 'the hardware monitor',
  serial: 'the SCPI console',
  log: 'the log',
};

interface DiagnosticsPageProps {
  panel: DiagnosticsPanel;
  onNavigate: (route: Route) => void;
}

/**
 * Hidden routes (/hw-monitor, /serial, /log): the old dock panels, one per page,
 * for service use. Not linked from the UI.
 */
export const DiagnosticsPage: React.FC<DiagnosticsPageProps> = ({ panel, onNavigate }) => {
  const isConnected = useSerialStore((s) => s.isConnected);

  if (!isConnected) {
    return (
      <Box>
        <Box sx={{ px: { xs: 2, sm: 3 }, pt: 2 }}>
          <Button startIcon={<ArrowBackIcon />} onClick={() => onNavigate('/')} sx={{ ml: -1 }}>
            Back to app
          </Button>
        </Box>
        <ConnectView note={`Connect a device to use ${TITLES[panel]}.`} onNavigate={onNavigate} />
      </Box>
    );
  }

  if (panel === 'hw-monitor') {
    // Five stacked charts need vertical room; on phones give them a fixed tall box and scroll.
    return (
      <Box sx={{ height: { xs: 1400, md: '100%' }, minHeight: { md: 600 } }}>
        <HardwareMonitorPlot />
      </Box>
    );
  }

  return <Box sx={{ height: '100%' }}>{panel === 'serial' ? <SerialIO /> : <LogDisplay />}</Box>;
};
