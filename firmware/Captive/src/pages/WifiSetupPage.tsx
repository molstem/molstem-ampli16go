import { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  InputAdornment,
  IconButton,
  Backdrop,
  CircularProgress,
} from '@mui/material';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import WifiIcon from '@mui/icons-material/Wifi';
import { useNavigate } from 'react-router-dom';
import {
  Layout,
  WizardStepper,
  WifiNetworkSelect,
  RegionSelect,
  TimezoneSelect,
  ErrorModal,
  SuccessAnimation,
} from '../components';
import { useWizard } from '../context/WizardContext';
import { scanWifiNetworks, setupWifi, ApiError } from '../api/client';
import type { WifiNetwork } from '../api/schemas';

type PageState = 'form' | 'connecting' | 'success' | 'error';

export function WifiSetupPage() {
  const navigate = useNavigate();
  const { state, dispatch } = useWizard();
  const [networks, setNetworks] = useState<WifiNetwork[]>([]);
  const [scanning, setScanning] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [pageState, setPageState] = useState<PageState>('form');
  const [error, setError] = useState<string | null>(null);
  const [isOtherSelected, setIsOtherSelected] = useState(false);

  const { selectedNetwork, customSsid, wifiPassword, region, timezone } = state;

  // Determine effective SSID and if password is needed
  const effectiveSsid = selectedNetwork?.ssid || customSsid;
  const needsPassword = selectedNetwork?.secure || isOtherSelected;

  // Scan for networks on mount
  const scanNetworks = useCallback(async () => {
    setScanning(true);
    try {
      const response = await scanWifiNetworks();
      if (response.status === 'success') {
        // Sort by signal strength
        const sorted = [...response.networks].sort((a, b) => b.rssi - a.rssi);
        setNetworks(sorted);
      }
    } catch (err) {
      console.error('Failed to scan networks:', err);
      // Non-fatal - user can still enter custom SSID
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    scanNetworks();
  }, [scanNetworks]);

  // Validation
  const isValid =
    effectiveSsid &&
    effectiveSsid.length > 0 &&
    region.length > 0 &&
    timezone.length > 0;

  const handleConnect = async () => {
    if (!isValid || !effectiveSsid) return;

    setPageState('connecting');
    setError(null);

    try {
      const response = await setupWifi({
        ssid: effectiveSsid,
        password: needsPassword ? wifiPassword : '',
        region,
        timezone,
      });

      if (response.status === 'success') {
        setPageState('success');
        // Wait for success animation then navigate
        setTimeout(() => {
          navigate('/complete');
        }, 3500);
      } else {
        setError(response.message);
        setPageState('error');
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to connect. Please check your credentials and try again.');
      }
      setPageState('error');
    }
  };

  const handleBack = () => {
    navigate('/setup');
  };

  const handleDismissError = () => {
    setError(null);
    setPageState('form');
  };

  // Connecting overlay
  if (pageState === 'connecting') {
    return (
      <Layout>
        <Backdrop
          open={true}
          sx={{
            position: 'absolute',
            color: '#fff',
            zIndex: (theme) => theme.zIndex.drawer + 1,
            flexDirection: 'column',
            gap: 2,
            bgcolor: 'background.paper',
          }}
        >
          <CircularProgress color="primary" size={64} />
          <Typography variant="h6" color="text.primary">
            Connecting to WiFi...
          </Typography>
          <Typography variant="body2" color="text.secondary">
            This may take up to a few minutes
          </Typography>
        </Backdrop>
      </Layout>
    );
  }

  // Success animation
  if (pageState === 'success') {
    return (
      <Layout>
        <SuccessAnimation message="Connected!" />
      </Layout>
    );
  }

  return (
    <Layout>
      <WizardStepper />

      <Box sx={{ textAlign: 'center', mb: 1 }}>
        <WifiIcon sx={{ fontSize: 48, color: 'primary.main' }} />
      </Box>

      <Typography variant="h5" component="h1" gutterBottom textAlign="center">
        WiFi Setup
      </Typography>

      <Typography variant="body2" color="text.secondary" textAlign="center" mb={3}>
        Connect your device to a WiFi network
      </Typography>

      <Box
        component="form"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (isValid) handleConnect();
        }}
        sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}
      >
        {/* WiFi Network Selection */}
        <WifiNetworkSelect
          networks={networks}
          loading={scanning}
          selectedNetwork={selectedNetwork}
          customSsid={customSsid}
          isOtherSelected={isOtherSelected}
          onNetworkChange={(network) => dispatch({ type: 'SET_NETWORK', network })}
          onCustomSsidChange={(ssid) => dispatch({ type: 'SET_CUSTOM_SSID', ssid })}
          onOtherSelectedChange={setIsOtherSelected}
          onRefresh={scanNetworks}
        />

        {/* Password Field (shown if network is secure or custom SSID) */}
        {needsPassword && (
          <TextField
            label="WiFi Password"
            type={showPassword ? 'text' : 'password'}
            value={wifiPassword}
            onChange={(e) => dispatch({ type: 'SET_WIFI_PASSWORD', password: e.target.value })}
            fullWidth
            helperText={isOtherSelected ? 'Leave empty for open networks' : ''}
            InputProps={{
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
        )}

        {/* Region and Timezone */}
        <RegionSelect
          value={region}
          onChange={(code) => dispatch({ type: 'SET_REGION', region: code })}
        />

        <TimezoneSelect
          value={timezone}
          onChange={(tz) => dispatch({ type: 'SET_TIMEZONE', timezone: tz })}
        />

        {/* Navigation Buttons */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            mt: 1.5,
            gap: 2,
          }}
        >
          <Button
            variant="outlined"
            startIcon={<ArrowBackIcon />}
            onClick={handleBack}
            type="button"
          >
            Back
          </Button>
          <Button
            variant="contained"
            endIcon={<ArrowForwardIcon />}
            type="submit"
            disabled={!isValid}
          >
            Configure WiFi
          </Button>
        </Box>
      </Box>

      <ErrorModal
        open={pageState === 'error' && !!error}
        title="Connection Failed"
        message={error || ''}
        onDismiss={handleDismissError}
      />
    </Layout>
  );
}
