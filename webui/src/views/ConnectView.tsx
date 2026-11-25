import React, { useEffect, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  Container,
  Divider,
  Link,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import UsbIcon from '@mui/icons-material/Usb';
import WifiIcon from '@mui/icons-material/Wifi';
import CloudIcon from '@mui/icons-material/Cloud';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import LoginIcon from '@mui/icons-material/Login';
import LogoutIcon from '@mui/icons-material/Logout';
import DevicesIcon from '@mui/icons-material/Devices';
import { useSerialStore, type ConnectingKind } from '../stores/serialStore';
import { cloudService, type CloudDevice, type CloudUser } from '../services/cloudService';
import { isEmbeddedBuild } from '../services/connection';
import {
  connectCloud,
  connectEmbeddedWebSocket,
  connectSerial,
  hasWebSerial,
  tryAutoConnectOnce,
} from '../services/connectionActions';
import type { Route } from '../routes';

interface ConnectViewProps {
  /** Shown above the buttons, e.g. why this page needs a device. */
  note?: string;
  onNavigate?: (route: Route) => void;
}

const CONNECTING_TEXT: Record<Exclude<ConnectingKind, null>, string> = {
  serial: 'Requesting port access…',
  ws: 'Connecting…',
  cloud: 'Connecting to cloud device…',
  auto: 'Connecting…',
};

/** The former connection modal, rendered inline whenever no device is connected. */
export const ConnectView: React.FC<ConnectViewProps> = ({ note, onNavigate }) => {
  const status = useSerialStore((s) => s.status);
  const statusColor = useSerialStore((s) => s.statusColor);
  const connecting = useSerialStore((s) => s.connecting);

  const embedded = isEmbeddedBuild();
  const webSerial = hasWebSerial();
  const showCloud = !embedded;

  const [cloudUser, setCloudUser] = useState<CloudUser | null>(cloudService.getUser());
  const [cloudDevices, setCloudDevices] = useState<CloudDevice[]>([]);
  const [cloudLoading, setCloudLoading] = useState(showCloud);
  const [cloudError, setCloudError] = useState<string | null>(null);

  // Silent reconnect when there is nothing to choose (once per page load).
  useEffect(() => {
    void tryAutoConnectOnce();
  }, []);

  // Cloud session + device list
  useEffect(() => {
    if (!showCloud) return;
    let cancelled = false;
    void (async () => {
      setCloudLoading(true);
      setCloudError(null);
      try {
        const user = await cloudService.checkAuth();
        if (cancelled) return;
        setCloudUser(user);
        if (user) setCloudDevices(await cloudService.getDevices());
      } catch (error) {
        console.error('Cloud auth check failed:', error);
        if (!cancelled) setCloudError('Failed to reach the cloud');
      } finally {
        if (!cancelled) setCloudLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showCloud]);

  useEffect(() => {
    if (!showCloud || !cloudUser) return;
    const id = setInterval(() => {
      cloudService.getDevices().then(setCloudDevices).catch((e) => console.error('Failed to refresh cloud devices:', e));
    }, 10_000);
    return () => clearInterval(id);
  }, [showCloud, cloudUser]);

  useEffect(() => cloudService.subscribe(() => setCloudUser(cloudService.getUser())), []);

  // Failures are already reflected in the serial store status + log.
  const run = (action: () => Promise<void>) => action().catch(() => undefined);

  const handleLogout = async () => {
    await cloudService.logout();
    setCloudDevices([]);
  };

  const showStatus = statusColor === 'error' && status && status !== 'Not connected';

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 6 } }}>
      <Stack spacing={3}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            molstem thermocycler
          </Typography>
          <Typography variant="h3" component="h1">
            Connect to a device
          </Typography>
          {note && (
            <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
              {note}
            </Typography>
          )}
        </Box>

        {connecting ? (
          <Stack direction="row" spacing={2} alignItems="center" justifyContent="center" sx={{ py: 4 }}>
            <CircularProgress size={24} />
            <Typography>{CONNECTING_TEXT[connecting]}</Typography>
          </Stack>
        ) : (
          <Stack spacing={2}>
            {webSerial && !embedded && (
              <Button
                variant="contained"
                size="large"
                fullWidth
                startIcon={<UsbIcon />}
                onClick={() => run(() => connectSerial())}
                sx={{ minHeight: 48 }}
              >
                Connect over USB
              </Button>
            )}

            {embedded && (
              <Button
                variant="contained"
                size="large"
                fullWidth
                startIcon={<WifiIcon />}
                onClick={() => run(() => connectEmbeddedWebSocket())}
                sx={{ minHeight: 48 }}
              >
                Connect to this device
              </Button>
            )}

            {showCloud && (
              <>
                {webSerial ? (
                  <Divider>
                    <Typography variant="body2" color="text.secondary">
                      or connect via cloud
                    </Typography>
                  </Divider>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    USB connection needs Chrome or Edge on a desktop computer. On this device, connect through the cloud.
                  </Typography>
                )}

                {cloudLoading ? (
                  <Stack direction="row" spacing={2} alignItems="center" justifyContent="center" sx={{ py: 2 }}>
                    <CircularProgress size={20} />
                    <Typography variant="body2" color="text.secondary">
                      Checking cloud sign-in…
                    </Typography>
                  </Stack>
                ) : cloudUser ? (
                  <Stack spacing={2}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Avatar src={cloudUser.picture_url || undefined} alt={cloudUser.name || cloudUser.email} sx={{ width: 32, height: 32 }}>
                        {(cloudUser.name || cloudUser.email).charAt(0).toUpperCase()}
                      </Avatar>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" fontWeight={500} noWrap>
                          {cloudUser.name || cloudUser.email}
                        </Typography>
                        {cloudUser.name && (
                          <Typography variant="caption" color="text.secondary" noWrap component="div">
                            {cloudUser.email}
                          </Typography>
                        )}
                      </Box>
                      <Button size="small" startIcon={<LogoutIcon />} onClick={handleLogout}>
                        Sign out
                      </Button>
                    </Stack>

                    {cloudDevices.length > 0 ? (
                      <List disablePadding sx={{ bgcolor: 'action.hover', borderRadius: 1 }}>
                        {cloudDevices.map((device) => (
                          <ListItemButton
                            key={device.serial_number}
                            disabled={!device.online}
                            onClick={() => run(() => connectCloud(device))}
                            sx={{ minHeight: 56 }}
                          >
                            <ListItemIcon sx={{ minWidth: 40 }}>
                              {device.online ? <CloudIcon color="success" /> : <CloudOffIcon color="disabled" />}
                            </ListItemIcon>
                            <ListItemText
                              primary={device.name}
                              secondary={device.online ? 'Online' : 'Offline'}
                              primaryTypographyProps={{ fontWeight: 500 }}
                            />
                          </ListItemButton>
                        ))}
                      </List>
                    ) : (
                      <Stack direction="row" spacing={1} alignItems="center" justifyContent="center" sx={{ py: 2 }}>
                        <DevicesIcon color="disabled" />
                        <Typography variant="body2" color="text.secondary">
                          No devices registered
                        </Typography>
                      </Stack>
                    )}

                    <Typography variant="body2" sx={{ textAlign: 'center' }}>
                      {onNavigate ? (
                        <Link
                          href="./devices"
                          onClick={(e: React.MouseEvent) => {
                            e.preventDefault();
                            onNavigate('/devices');
                          }}
                        >
                          Manage your devices
                        </Link>
                      ) : (
                        <Link href="https://app.molstem.com/devices" target="_blank" rel="noopener noreferrer">
                          Manage your devices at app.molstem.com/devices
                        </Link>
                      )}
                    </Typography>
                  </Stack>
                ) : (
                  <Button
                    variant={webSerial ? 'outlined' : 'contained'}
                    size="large"
                    fullWidth
                    startIcon={<LoginIcon />}
                    onClick={() => cloudService.login()}
                    sx={{ minHeight: 48 }}
                  >
                    Sign in with Google
                  </Button>
                )}

                {cloudError && <Alert severity="warning">{cloudError}</Alert>}
              </>
            )}

            {showStatus && <Alert severity="error">{status}</Alert>}
          </Stack>
        )}
      </Stack>
    </Container>
  );
};
