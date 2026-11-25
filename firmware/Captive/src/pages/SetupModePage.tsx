import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  TextField,
  Typography,
  InputAdornment,
  IconButton,
} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import CloudIcon from '@mui/icons-material/Cloud';
import SettingsIcon from '@mui/icons-material/Settings';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useNavigate } from 'react-router-dom';
import { Layout, WizardStepper, PasswordStrengthBar, LoadingOverlay, ErrorModal } from '../components';
import { useWizard } from '../context/WizardContext';
import { setupHost, getDeviceStatus, ApiError } from '../api/client';
import { isValidDnsName, type SetupMode } from '../api/schemas';

export function SetupModePage() {
  const navigate = useNavigate();
  const { state, dispatch } = useWizard();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { setupMode, deviceName, password, confirmPassword } = state;

  // Fetch device status to get device ID for default hostname
  useEffect(() => {
    async function fetchDeviceId() {
      try {
        const status = await getDeviceStatus();
        if (status.id && !deviceName) {
          // Convert device ID to DNS-compatible name (lowercase, replace invalid chars)
          const defaultName = status.id.toLowerCase().replace(/[^a-z0-9-]/g, '-');
          dispatch({ type: 'SET_DEVICE_NAME', name: defaultName });
        }
      } catch (err) {
        console.warn('Failed to fetch device status:', err);
      }
    }
    fetchDeviceId();
  }, [dispatch, deviceName]);

  // Validation
  const deviceNameError = deviceName && !isValidDnsName(deviceName)
    ? 'Must be DNS-compatible: letters, numbers, hyphens only; cannot start or end with hyphen'
    : '';

  const passwordError = setupMode === 'local' && password && password.length < 6
    ? 'Password must be at least 6 characters'
    : '';

  const confirmPasswordError = setupMode === 'local' && confirmPassword && password !== confirmPassword
    ? 'Passwords do not match'
    : '';

  const isValid =
    setupMode !== null &&
    deviceName.length > 0 &&
    isValidDnsName(deviceName) &&
    (setupMode === 'cloud' || (
      password.length >= 6 &&
      password === confirmPassword
    ));

  const handleModeSelect = (mode: SetupMode) => {
    dispatch({ type: 'SET_SETUP_MODE', mode });
    // Clear password fields when switching to cloud mode
    if (mode === 'cloud') {
      dispatch({ type: 'SET_PASSWORD', password: '' });
      dispatch({ type: 'SET_CONFIRM_PASSWORD', password: '' });
    }
  };

  const handleContinue = async () => {
    if (!isValid || !setupMode) return;

    setLoading(true);
    setError(null);

    try {
      const response = await setupHost({
        mode: setupMode,
        deviceName,
        password: setupMode === 'local' ? password : undefined,
      });

      if (response.status === 'success') {
        navigate('/wifi');
      } else {
        setError(response.message);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    navigate('/');
  };

  return (
    <Layout>
      <WizardStepper />

      <Box sx={{ textAlign: 'center', mb: 1 }}>
        <SettingsIcon sx={{ fontSize: 48, color: 'primary.main' }} />
      </Box>

      <Typography variant="h5" component="h1" gutterBottom textAlign="center">
        Device Setup
      </Typography>

      <Typography variant="body2" color="text.secondary" textAlign="center" mb={3}>
        Choose how you want to use your molstem thermocycler
      </Typography>

      <Box
        component="form"
        onSubmit={(e: React.FormEvent) => {
          e.preventDefault();
          if (isValid && !loading) handleContinue();
        }}
      >
        {/* Mode Selection Cards */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
            gap: 2,
            mb: 3,
          }}
        >
          {/* Local Mode Card */}
          <Card
            variant="outlined"
            sx={{
              borderColor: setupMode === 'local' ? 'primary.main' : 'divider',
              borderWidth: 2,
              transition: 'all 0.2s ease',
              height: '100%',
            }}
          >
            <CardActionArea
              onClick={() => handleModeSelect('local')}
              sx={{ height: '100%', alignItems: 'flex-start' }}
            >
              <CardContent sx={{ textAlign: 'center', py: 3 }}>
                <HomeIcon
                  sx={{
                    fontSize: 48,
                    color: setupMode === 'local' ? 'primary.main' : 'action.active',
                    mb: 1,
                  }}
                />
                <Typography variant="h6" gutterBottom>
                  Local Use
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Access your device directly on your local network. Requires setting a device password for security.
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>

          {/* Cloud Mode Card */}
          <Card
            variant="outlined"
            sx={{
              borderColor: setupMode === 'cloud' ? 'primary.main' : 'divider',
              borderWidth: 2,
              transition: 'all 0.2s ease',
              height: '100%',
            }}
          >
            <CardActionArea
              onClick={() => handleModeSelect('cloud')}
              sx={{ height: '100%', alignItems: 'flex-start' }}
            >
              <CardContent sx={{ textAlign: 'center', py: 3 }}>
                <CloudIcon
                  sx={{
                    fontSize: 48,
                    color: setupMode === 'cloud' ? 'primary.main' : 'action.active',
                    mb: 1,
                  }}
                />
                <Typography variant="h6" gutterBottom>
                  Cloud Registration
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Register with molstem cloud for remote access, protocol storage, and experiment history.
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        </Box>

        {/* Device Name Field */}
        <TextField
          label="Device Name"
          value={deviceName}
          onChange={(e) => dispatch({ type: 'SET_DEVICE_NAME', name: e.target.value.toLowerCase() })}
          error={!!deviceNameError}
          helperText={
            deviceNameError ||
            `Used as network hostname (e.g., ${deviceName && isValidDnsName(deviceName) ? deviceName : 'molstem-lab1'}.local)`
          }
          fullWidth
          sx={{ mb: 2 }}
          inputProps={{
            maxLength: 63,
            pattern: '[a-z0-9-]*',
          }}
        />

        {/* Password Fields (Local mode only) */}
        {setupMode === 'local' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box>
              <TextField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => dispatch({ type: 'SET_PASSWORD', password: e.target.value })}
                error={!!passwordError}
                helperText={passwordError}
                fullWidth
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
              <PasswordStrengthBar password={password} />
            </Box>

            <TextField
              label="Confirm Password"
              type={showConfirmPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => dispatch({ type: 'SET_CONFIRM_PASSWORD', password: e.target.value })}
              error={!!confirmPasswordError}
              helperText={confirmPasswordError}
              fullWidth
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      edge="end"
                      aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                    >
                      {showConfirmPassword ? <VisibilityOffIcon /> : <VisibilityIcon />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        )}

        {/* Navigation Buttons */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            mt: 4,
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
            disabled={!isValid || loading}
          >
            Continue
          </Button>
        </Box>
      </Box>

      <LoadingOverlay open={loading} message="Configuring device..." />
      <ErrorModal
        open={!!error}
        title="Setup Failed"
        message={error || ''}
        onDismiss={() => setError(null)}
      />
    </Layout>
  );
}
