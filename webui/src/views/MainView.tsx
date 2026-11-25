import React, { useState } from 'react';
import { Button, Container } from '@mui/material';
import HourglassTopIcon from '@mui/icons-material/HourglassTop';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import RefreshIcon from '@mui/icons-material/Refresh';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import { useSerialStore } from '../stores/serialStore';
import { useTelemetryStore } from '../stores/telemetryStore';
import { disconnectDevice } from '../services/connectionActions';
import { devicePoller } from '../services/devicePoller';
import { FirmwareUpdate } from '../components/FirmwareUpdate';
import { ConnectView } from './ConnectView';
import { MessageView } from './MessageView';
import { RunningView } from './RunningView';
import { IdleFlow } from './protocols/IdleFlow';
import type { Route } from '../routes';

interface MainViewProps {
  onNavigate: (route: Route) => void;
}

/** Route "/": what is shown follows the device, nothing else. */
export const MainView: React.FC<MainViewProps> = ({ onNavigate }) => {
  const isConnected = useSerialStore((s) => s.isConnected);
  const deviceMode = useTelemetryStore((s) => s.deviceMode);
  const state = useTelemetryStore((s) => s.state);
  const transport = useTelemetryStore((s) => s.transport);
  const lastPollError = useTelemetryStore((s) => s.lastPollError);

  if (!isConnected) {
    return <ConnectView onNavigate={onNavigate} />;
  }

  if (deviceMode === 'unknown') {
    return (
      <MessageView
        spinner
        title="Connecting…"
        body={lastPollError ? `Waiting for the device to answer (${lastPollError})` : 'Identifying the device'}
        actions={
          <Button variant="outlined" size="large" onClick={() => void disconnectDevice()} sx={{ minHeight: 48 }}>
            Cancel
          </Button>
        }
      />
    );
  }

  if (deviceMode === 'bootloader') {
    return (
      <Container maxWidth="sm" sx={{ py: { xs: 2, sm: 4 } }}>
        <FirmwareUpdate />
      </Container>
    );
  }

  if (deviceMode === 'provisioning') {
    return (
      <MessageView
        icon={<SettingsSuggestIcon />}
        title="Device is in provisioning mode"
        body="Finish provisioning on the device, then reconnect."
        actions={
          <Button variant="outlined" size="large" startIcon={<LinkOffIcon />} onClick={() => void disconnectDevice()} sx={{ minHeight: 48 }}>
            Disconnect
          </Button>
        }
      />
    );
  }

  if (state === null) {
    return <MessageView spinner title="Querying device…" body="Reading the device state" />;
  }

  if (state === 'BUSY') {
    return (
      <MessageView
        icon={<HourglassTopIcon />}
        title="Device busy"
        body="Finish the dialog on the device screen to continue."
        actions={transport === 'cloud' ? <RefreshButton /> : undefined}
      />
    );
  }

  if (state === 'RUNNING') {
    return <RunningView />;
  }

  return <IdleFlow />;
};

const RefreshButton: React.FC = () => {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="outlined"
      size="large"
      startIcon={<RefreshIcon />}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await devicePoller.refreshNow();
        } finally {
          setBusy(false);
        }
      }}
      sx={{ minHeight: 48 }}
    >
      Refresh
    </Button>
  );
};
