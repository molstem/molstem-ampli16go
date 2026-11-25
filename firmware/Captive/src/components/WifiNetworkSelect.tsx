import { useState } from 'react';
import {
  TextField,
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  InputAdornment,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SignalWifi4BarIcon from '@mui/icons-material/SignalWifi4Bar';
import SignalWifi3BarIcon from '@mui/icons-material/SignalWifi3Bar';
import SignalWifi2BarIcon from '@mui/icons-material/SignalWifi2Bar';
import SignalWifi1BarIcon from '@mui/icons-material/SignalWifi1Bar';
import SignalWifi0BarIcon from '@mui/icons-material/SignalWifi0Bar';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import WifiIcon from '@mui/icons-material/Wifi';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import type { WifiNetwork } from '../api/schemas';

interface WifiNetworkSelectProps {
  networks: WifiNetwork[];
  loading: boolean;
  selectedNetwork: WifiNetwork | null;
  customSsid: string;
  isOtherSelected: boolean;
  onNetworkChange: (network: WifiNetwork | null) => void;
  onCustomSsidChange: (ssid: string) => void;
  onOtherSelectedChange: (isOther: boolean) => void;
  onRefresh: () => void;
  error?: string;
}

function getSignalIcon(rssi: number) {
  if (rssi >= -50) return <SignalWifi4BarIcon fontSize="small" color="success" />;
  if (rssi >= -60) return <SignalWifi3BarIcon fontSize="small" color="success" />;
  if (rssi >= -70) return <SignalWifi2BarIcon fontSize="small" color="warning" />;
  if (rssi >= -80) return <SignalWifi1BarIcon fontSize="small" color="warning" />;
  return <SignalWifi0BarIcon fontSize="small" color="error" />;
}

function getSignalLabel(rssi: number): string {
  if (rssi >= -50) return 'Excellent';
  if (rssi >= -60) return 'Good';
  if (rssi >= -70) return 'Fair';
  if (rssi >= -80) return 'Weak';
  return 'Very Weak';
}

export function WifiNetworkSelect({
  networks,
  loading,
  selectedNetwork,
  customSsid,
  isOtherSelected,
  onNetworkChange,
  onCustomSsidChange,
  onOtherSelectedChange,
  onRefresh,
  error,
}: WifiNetworkSelectProps) {
  const [open, setOpen] = useState(false);

  const handleOpen = () => setOpen(true);
  const handleClose = () => setOpen(false);

  const handleSelectNetwork = (network: WifiNetwork) => {
    onOtherSelectedChange(false);
    onNetworkChange(network);
    onCustomSsidChange('');
    handleClose();
  };

  const handleSelectOther = () => {
    onOtherSelectedChange(true);
    onNetworkChange(null);
    handleClose();
  };

  // Display value for the text field
  const displayValue = isOtherSelected
    ? 'Other network...'
    : selectedNetwork?.ssid || '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label="WiFi Network"
        value={displayValue}
        onClick={handleOpen}
        error={!!error}
        helperText={error}
        fullWidth
        InputProps={{
          readOnly: true,
          endAdornment: (
            <InputAdornment position="end">
              <KeyboardArrowDownIcon color="action" />
            </InputAdornment>
          ),
        }}
        sx={{ cursor: 'pointer' }}
      />

      <Dialog
        open={open}
        onClose={handleClose}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: { maxHeight: '70vh' },
        }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
          <Typography variant="h6">Select WiFi Network</Typography>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              onRefresh();
            }}
            disabled={loading}
            aria-label="Refresh network list"
          >
            {loading ? <CircularProgress size={20} /> : <RefreshIcon />}
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          <List disablePadding>
            {networks.length === 0 && !loading && (
              <Box sx={{ textAlign: 'center', py: 3 }}>
                <Typography variant="body2" color="text.secondary">
                  No networks found
                </Typography>
                <Typography
                  variant="body2"
                  color="primary"
                  sx={{ cursor: 'pointer', mt: 1 }}
                  onClick={onRefresh}
                >
                  Scan again
                </Typography>
              </Box>
            )}
            {networks.map((network) => (
              <ListItemButton
                key={network.ssid}
                onClick={() => handleSelectNetwork(network)}
                selected={selectedNetwork?.ssid === network.ssid && !isOtherSelected}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  {getSignalIcon(network.rssi)}
                </ListItemIcon>
                <ListItemText
                  primary={network.ssid}
                  secondary={getSignalLabel(network.rssi)}
                />
                {network.secure ? (
                  <LockIcon fontSize="small" color="action" />
                ) : (
                  <LockOpenIcon fontSize="small" color="action" />
                )}
              </ListItemButton>
            ))}
            <ListItemButton
              onClick={handleSelectOther}
              selected={isOtherSelected}
              sx={{ borderTop: networks.length > 0 ? 1 : 0, borderColor: 'divider' }}
            >
              <ListItemIcon sx={{ minWidth: 40 }}>
                <WifiIcon fontSize="small" color="action" />
              </ListItemIcon>
              <ListItemText primary="Other network..." />
            </ListItemButton>
          </List>
        </DialogContent>
      </Dialog>

      {isOtherSelected && (
        <TextField
          label="Network Name (SSID)"
          value={customSsid}
          onChange={(e) => onCustomSsidChange(e.target.value)}
          placeholder="Enter network name"
          fullWidth
          autoFocus
        />
      )}
    </Box>
  );
}

export { getSignalIcon, getSignalLabel };
