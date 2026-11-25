import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Container,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import LoginIcon from '@mui/icons-material/Login';
import LogoutIcon from '@mui/icons-material/Logout';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import SendIcon from '@mui/icons-material/Send';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { cloudService, type CloudDevice, type CloudUser } from '../services/cloudService';
import { BrandLockup } from '../components/BrandLockup';
import { fonts } from '../theme';

interface DevicesPageProps {
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onNavigate: (path: string) => void;
}

type LineKind = 'rx' | 'tx' | 'system' | 'error';
interface TerminalLine {
  id: number;
  at: string;
  kind: LineKind;
  text: string;
}

const MAX_LINES = 500;
const REFRESH_MS = 10000;

/**
 * app.molstem.com/devices — device management (formerly cloud.easypcr.io).
 * Sign in, claim devices by enrollment ID, see their status, and open a raw terminal.
 */
export const DevicesPage: React.FC<DevicesPageProps> = ({ darkMode, onToggleDarkMode, onNavigate }) => {
  const [user, setUser] = useState<CloudUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [devices, setDevices] = useState<CloudDevice[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; severity: 'success' | 'error' } | null>(null);
  const [enrollmentId, setEnrollmentId] = useState('');
  const [enrolling, setEnrolling] = useState(false);

  // Terminal state
  const [selected, setSelected] = useState<CloudDevice | null>(null);
  const [wsState, setWsState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [lines, setLines] = useState<TerminalLine[]>([]);
  const [command, setCommand] = useState('');
  const wsRef = useRef<WebSocket | null>(null);
  const lineIdRef = useRef(0);
  const terminalRef = useRef<HTMLDivElement>(null);

  const showMessage = useCallback((text: string, severity: 'success' | 'error') => {
    setMessage({ text, severity });
    window.setTimeout(() => setMessage(null), 5000);
  }, []);

  const addLine = useCallback((text: string, kind: LineKind = 'system') => {
    setLines((prev) => {
      const next = [...prev, { id: ++lineIdRef.current, at: new Date().toLocaleTimeString(), kind, text }];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const loadDevices = useCallback(async () => {
    try {
      setDevices(await cloudService.getDevices());
      setDevicesError(null);
    } catch (error) {
      setDevicesError(error instanceof Error ? error.message : 'Failed to load devices');
    }
  }, []);

  // Auth check on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const u = await cloudService.checkAuth();
      if (cancelled) return;
      setUser(u);
      setAuthChecked(true);
      if (u) await loadDevices();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDevices]);

  // Follow cloudService user changes (e.g. 401 during a call)
  useEffect(() => cloudService.subscribe(() => setUser(cloudService.getUser())), []);

  // Periodic refresh while signed in
  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(loadDevices, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [user, loadDevices]);

  // Auto-scroll the terminal
  useEffect(() => {
    const el = terminalRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setSelected(null);
    setWsState('disconnected');
  }, []);

  // Close the socket when leaving the page
  useEffect(() => () => wsRef.current?.close(), []);

  const connectTo = useCallback(
    (device: CloudDevice) => {
      wsRef.current?.close();
      setSelected(device);
      setLines([]);
      setWsState('connecting');
      addLine(`Connecting to ${device.name}...`);

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/v0/ws?device=${encodeURIComponent(device.serial_number)}`);
      wsRef.current = ws;

      ws.onopen = () => {
        setWsState('connected');
        addLine('Connected to device');
      };
      ws.onclose = (e) => {
        if (wsRef.current === ws) wsRef.current = null;
        setWsState('disconnected');
        addLine(`Disconnected: ${e.reason || 'Connection closed'}`);
      };
      ws.onerror = () => addLine('WebSocket error', 'error');
      ws.onmessage = async (e) => {
        let text: string;
        if (e.data instanceof Blob) {
          text = await e.data.text();
        } else if (typeof e.data === 'string') {
          try {
            const msg = JSON.parse(e.data) as { type?: string };
            if (msg.type === 'device_connected') return addLine('Device came online');
            if (msg.type === 'device_disconnected') return addLine('Device went offline');
          } catch {
            // plain text
          }
          text = e.data;
        } else {
          text = `[Binary data: ${(e.data as ArrayBuffer).byteLength} bytes]`;
        }
        addLine(text, 'rx');
      };
    },
    [addLine]
  );

  const sendCommand = useCallback(() => {
    const cmd = command.trim();
    const ws = wsRef.current;
    if (!cmd || !ws || ws.readyState !== WebSocket.OPEN) return;
    addLine(cmd, 'tx');
    ws.send(cmd + '\n');
    setCommand('');
  }, [command, addLine]);

  const handleEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollmentId.trim()) return;
    setEnrolling(true);
    try {
      await cloudService.claimEnrollment(enrollmentId);
      showMessage('Device added', 'success');
      setEnrollmentId('');
      await loadDevices();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Failed to add device', 'error');
    } finally {
      setEnrolling(false);
    }
  };

  const handleRemove = async (device: CloudDevice) => {
    if (!window.confirm(`Remove ${device.name} (${device.serial_number}) from your account?`)) return;
    try {
      await cloudService.removeDevice(device.serial_number);
      if (selected?.serial_number === device.serial_number) disconnect();
      showMessage('Device removed', 'success');
      await loadDevices();
    } catch (error) {
      showMessage(error instanceof Error ? error.message : 'Failed to remove device', 'error');
    }
  };

  const handleLogout = async () => {
    disconnect();
    await cloudService.logout();
    setDevices([]);
  };

  const navLink = (label: string, onClick: () => void) => (
    <Box
      component="a"
      onClick={onClick}
      sx={{
        color: 'primary.main',
        fontSize: '0.875rem',
        fontWeight: 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
        '&:hover': { textDecoration: 'underline' },
      }}
    >
      {label}
    </Box>
  );

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      {/* Header (same shape as the main app header) */}
      <Box
        sx={{
          py: 1,
          px: 3,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          minHeight: '56px',
        }}
      >
        <Box
          component="a"
          href="./"
          onClick={(e: React.MouseEvent) => {
            e.preventDefault();
            onNavigate('/');
          }}
          sx={{ textDecoration: 'none', color: 'inherit', cursor: 'pointer', '&:hover': { opacity: 0.8 } }}
        >
          <BrandLockup label="devices" />
        </Box>
        <Box sx={{ display: 'flex', gap: 2, ml: 1 }}>{navLink('Open app', () => onNavigate('/'))}</Box>
        <Box sx={{ flex: 1 }} />
        {user && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ display: { xs: 'none', sm: 'flex' } }}>
            <Avatar src={user.picture_url || undefined} sx={{ width: 28, height: 28 }}>
              {(user.name || user.email).charAt(0).toUpperCase()}
            </Avatar>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 220 }} noWrap>
              {user.email}
            </Typography>
            <Tooltip title="Sign out">
              <IconButton size="small" color="inherit" onClick={handleLogout}>
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        )}
        <Tooltip title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}>
          <IconButton onClick={onToggleDarkMode} color="inherit" size="small">
            {darkMode ? <Brightness7Icon /> : <Brightness4Icon />}
          </IconButton>
        </Tooltip>
      </Box>

      <Container maxWidth="md" sx={{ py: 4, flex: 1 }}>
        <Box sx={{ mb: 3 }}>
          <Typography variant="overline" color="text.secondary">
            molstem cloud
          </Typography>
          <Typography variant="h3" component="h1">
            Your devices
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Remote access to your molstem thermocyclers.
          </Typography>
        </Box>

        {message && (
          <Alert severity={message.severity} sx={{ mb: 2 }} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        )}

        {!authChecked ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        ) : !user ? (
          <Paper variant="outlined" sx={{ p: 3, maxWidth: 420 }}>
            <Typography variant="h6" gutterBottom>
              Sign in to continue
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Use your Google account to manage the devices enrolled to you.
            </Typography>
            <Button variant="contained" startIcon={<LoginIcon />} onClick={() => cloudService.login()}>
              Sign in with Google
            </Button>
          </Paper>
        ) : (
          <Stack spacing={2}>
            {/* Mobile-only account row */}
            <Paper variant="outlined" sx={{ p: 2, display: { xs: 'flex', sm: 'none' }, alignItems: 'center', gap: 1.5 }}>
              <Avatar src={user.picture_url || undefined}>{(user.name || user.email).charAt(0).toUpperCase()}</Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {user.name || 'User'}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {user.email}
                </Typography>
              </Box>
              <Button size="small" startIcon={<LogoutIcon />} onClick={handleLogout}>
                Sign out
              </Button>
            </Paper>

            {/* Add device */}
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                Add a device
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Enter the enrollment ID shown on the device screen.
              </Typography>
              <Box component="form" onSubmit={handleEnroll} sx={{ display: 'flex', gap: 1 }}>
                <TextField
                  value={enrollmentId}
                  onChange={(e) => setEnrollmentId(e.target.value.toUpperCase())}
                  placeholder="XXXX-XXXX"
                  inputProps={{
                    pattern: '[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}',
                    style: { fontFamily: fonts.mono, letterSpacing: '0.08em' },
                    'aria-label': 'Enrollment ID',
                  }}
                  required
                  sx={{ flex: 1, maxWidth: 260 }}
                />
                <Button type="submit" variant="contained" disabled={enrolling}>
                  {enrolling ? 'Adding…' : 'Add'}
                </Button>
              </Box>
            </Paper>

            {/* Device list */}
            <Paper variant="outlined" sx={{ p: 3 }}>
              <Typography variant="h6" gutterBottom>
                My devices
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Select a device to open a terminal. To use the full interface, open the app and choose the device
                under Connect.
              </Typography>
              {devicesError ? (
                <Alert severity="error">{devicesError}</Alert>
              ) : devices.length === 0 ? (
                <Typography variant="body2" color="text.disabled" sx={{ py: 2, textAlign: 'center' }}>
                  No devices yet. Add one above.
                </Typography>
              ) : (
                <List disablePadding>
                  {devices.map((d) => {
                    const isSelected = selected?.serial_number === d.serial_number;
                    return (
                      <ListItem
                        key={d.serial_number}
                        disablePadding
                        secondaryAction={
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Chip
                              size="small"
                              label={d.online ? 'Online' : 'Offline'}
                              color={d.online ? 'success' : 'default'}
                              variant={d.online ? 'filled' : 'outlined'}
                            />
                            <Tooltip title="Remove device">
                              <IconButton edge="end" size="small" onClick={() => handleRemove(d)}>
                                <DeleteOutlineIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>
                        }
                        sx={{ borderBottom: 1, borderColor: 'divider', '&:last-child': { borderBottom: 0 } }}
                      >
                        <ListItemButton selected={isSelected} onClick={() => connectTo(d)} sx={{ pr: 18 }}>
                          <ListItemText
                            primary={d.name}
                            secondary={d.serial_number}
                            secondaryTypographyProps={{ sx: { fontFamily: fonts.mono, fontSize: '0.75rem' } }}
                          />
                        </ListItemButton>
                      </ListItem>
                    );
                  })}
                </List>
              )}
            </Paper>

            {/* Terminal */}
            {selected && (
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                  <Typography variant="h6" sx={{ flex: 1 }} noWrap>
                    {selected.name}
                  </Typography>
                  <Chip
                    size="small"
                    label={wsState === 'connected' ? 'Connected' : wsState === 'connecting' ? 'Connecting' : 'Disconnected'}
                    color={wsState === 'connected' ? 'success' : 'default'}
                    variant={wsState === 'connected' ? 'filled' : 'outlined'}
                  />
                  <Button size="small" color="error" startIcon={<LinkOffIcon />} onClick={disconnect}>
                    Disconnect
                  </Button>
                </Box>
                <Box
                  ref={terminalRef}
                  sx={{
                    bgcolor: '#070a0c',
                    color: '#ece8df',
                    fontFamily: fonts.mono,
                    fontSize: '0.8rem',
                    height: 300,
                    overflowY: 'auto',
                    p: 1.5,
                    borderRadius: 1,
                    border: 1,
                    borderColor: 'divider',
                    mb: 1,
                  }}
                >
                  {lines.map((l) => (
                    <Box
                      key={l.id}
                      sx={{
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-all',
                        my: 0.25,
                        color:
                          l.kind === 'rx' ? '#5fe3c8' : l.kind === 'tx' ? '#f0c060' : l.kind === 'error' ? '#ff7a6e' : '#6f6d66',
                        fontStyle: l.kind === 'system' ? 'italic' : 'normal',
                      }}
                    >
                      [{l.at}] {l.text}
                    </Box>
                  ))}
                </Box>
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') sendCommand();
                    }}
                    placeholder="Type a command and press Enter…"
                    disabled={wsState !== 'connected'}
                    inputProps={{ style: { fontFamily: fonts.mono } }}
                    sx={{ flex: 1 }}
                  />
                  <Button variant="contained" endIcon={<SendIcon />} disabled={wsState !== 'connected'} onClick={sendCommand}>
                    Send
                  </Button>
                </Box>
              </Paper>
            )}
          </Stack>
        )}
      </Container>
    </Box>
  );
};
