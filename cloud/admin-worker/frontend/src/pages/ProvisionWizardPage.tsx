import { useState, useCallback, useEffect } from 'react';
import {
  Box,
  Stepper,
  Step,
  StepLabel,
  Card,
  CardContent,
  Typography,
  Button,
  Alert,
  TextField,
  Table,
  TableBody,
  TableRow,
  TableCell,
  Grid,
  FormControlLabel,
  Checkbox,
  Chip,
  RadioGroup,
  Radio,
  FormControl,
  FormLabel,
} from '@mui/material';
import UsbIcon from '@mui/icons-material/Usb';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import RestoreIcon from '@mui/icons-material/Restore';
import { LoadingOverlay, ErrorAlert } from '../components';
import { api, ApiError } from '../api/client';
import {
  SerialConnection,
  serialConnection,
  type DeviceIdentity,
  type HardwareTest,
  type ChecklistItem,
  type Attestation,
} from '../services';
import type { VerifyAttestationResponse } from '../api/client';

const STEPS = [
  'Connect Serial',
  'Device Identity',
  'mTLS Exchange',
  'Calibration',
  'Hardware Details',
  'Provision Mode',
  'Hardware Tests',
  'Checklist',
  'Attestation',
  'Sign-off',
  'Complete',
];

// Default calibration values
const DEFAULT_CALIBRATION = {
  kp: 1.740,
  ti: 6.010,
  td: 1.010,
  tf: 0.1,
  kb: 0.810,
};

export function ProvisionWizardPage() {
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('Processing...');
  const [error, setError] = useState<string | null>(null);

  // Serial connection state
  const [connected, setConnected] = useState(false);

  // Step 1: Device identity
  const [deviceInfo, setDeviceInfo] = useState<DeviceIdentity | null>(null);

  // Step 2: mTLS - handled automatically

  // Step 3: Calibration
  const [calibration, setCalibration] = useState(DEFAULT_CALIBRATION);

  // Step 4: Hardware details
  const [hwVersion, setHwVersion] = useState('v1.0');
  const [hwComment, setHwComment] = useState('');

  // Step 5: Provision mode
  const [provisionMode, setProvisionMode] = useState<'development' | 'production'>('development');

  // Step 6: Hardware tests (only for production)
  const [tests, setTests] = useState<HardwareTest[]>([]);

  // Step 7: Checklist (only for production)
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);

  // Step 8: Attestation
  const [_attestation, setAttestation] = useState<Attestation | null>(null);
  const [attestationResult, setAttestationResult] = useState<VerifyAttestationResponse | null>(null);

  // Check serial support
  const serialSupported = SerialConnection.isSupported();

  // Update connection status
  useEffect(() => {
    const interval = setInterval(() => {
      setConnected(serialConnection.isConnected());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Step 0: Connect Serial
  const handleConnect = async () => {
    setLoading(true);
    setLoadingMessage('Connecting to serial port...');
    setError(null);
    try {
      await serialConnection.connect();
      // Test connection with ping
      await serialConnection.ping();
      setConnected(true);
      setActiveStep(1);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
      setConnected(false);
    } finally {
      setLoading(false);
    }
  };

  // Step 1: Get Device Identity
  const handleGetIdentity = async () => {
    setLoading(true);
    setLoadingMessage('Getting device identity (may generate keys)...');
    setError(null);
    try {
      const identity = await serialConnection.getIdentity();
      setDeviceInfo(identity);
      setActiveStep(2);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to get identity');
    } finally {
      setLoading(false);
    }
  };

  // Step 2: mTLS Exchange
  const handleMtlsExchange = async () => {
    if (!deviceInfo) return;

    setLoading(true);
    setLoadingMessage('Preparing mTLS credentials...');
    setError(null);
    try {
      // Get mTLS payload from backend
      const response = await api.prepareKeyExchange(deviceInfo);

      // Send to device
      setLoadingMessage('Sending mTLS credentials to device...');
      await serialConnection.setMtls(response.payload);

      setActiveStep(3);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to exchange mTLS credentials');
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Set Calibration
  const handleSetCalibration = async () => {
    setLoading(true);
    setLoadingMessage('Setting calibration parameters...');
    setError(null);
    try {
      await serialConnection.setCalibration(
        calibration.kp,
        calibration.ti,
        calibration.td,
        calibration.tf,
        calibration.kb
      );
      setActiveStep(4);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set calibration');
    } finally {
      setLoading(false);
    }
  };

  // Step 4: Set Hardware Details
  const handleSetHwVersion = async () => {
    setLoading(true);
    setLoadingMessage('Setting hardware details...');
    setError(null);
    try {
      await serialConnection.setHwVersion(hwVersion, hwComment);
      setActiveStep(5);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set hardware details');
    } finally {
      setLoading(false);
    }
  };

  // Step 5: Set Provision Mode
  const handleSetMode = async () => {
    setLoading(true);
    setLoadingMessage('Setting provision mode...');
    setError(null);
    try {
      await serialConnection.setMode(provisionMode);

      if (provisionMode === 'production') {
        // Load tests for production mode
        setLoadingMessage('Loading hardware tests...');
        const testsData = await serialConnection.getTests();
        setTests(testsData);
        setActiveStep(6);
      } else {
        // Skip tests and checklist for development mode
        setActiveStep(8);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to set provision mode');
    } finally {
      setLoading(false);
    }
  };

  // Step 6: Hardware Tests
  const handleRunTest = async (testId: string, action: 'pass' | 'fail') => {
    setLoading(true);
    setError(null);
    try {
      await serialConnection.runTest(testId, action);
      setTests((prev) =>
        prev.map((t) => (t.id === testId ? { ...t, status: action === 'pass' ? 'passed' : 'failed' } : t))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update test');
    } finally {
      setLoading(false);
    }
  };

  const handleTestsContinue = async () => {
    setLoading(true);
    setLoadingMessage('Loading checklist...');
    setError(null);
    try {
      const checklistData = await serialConnection.getChecklist();
      setChecklist(checklistData);
      setActiveStep(7);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load checklist');
    } finally {
      setLoading(false);
    }
  };

  // Step 7: Checklist
  const handleChecklistToggle = async (itemId: string, completed: boolean) => {
    setLoading(true);
    setError(null);
    try {
      await serialConnection.setChecklistItem(itemId, completed);
      setChecklist((prev) => prev.map((item) => (item.id === itemId ? { ...item, completed } : item)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update checklist');
    } finally {
      setLoading(false);
    }
  };

  // Step 8: Get Attestation
  const handleGetAttestation = async () => {
    setLoading(true);
    setLoadingMessage('Getting signed attestation from device...');
    setError(null);
    try {
      const att = await serialConnection.getAttestation();
      setAttestation(att);

      // Verify on backend
      setLoadingMessage('Verifying attestation...');
      const attJson = JSON.stringify(att);
      const attB64 = btoa(attJson);
      const result = await api.verifyAttestation({ attestation: attB64 });
      setAttestationResult(result);

      setActiveStep(9);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to get/verify attestation');
      }
    } finally {
      setLoading(false);
    }
  };

  // Step 9: Sign-off
  const handleSignoff = async () => {
    if (!attestationResult) return;

    setLoading(true);
    setLoadingMessage('Generating sign-off...');
    setError(null);
    try {
      // Generate signoff from backend
      const response = await api.generateSignoff({
        attestationHash: attestationResult.attestationHash,
        serial: attestationResult.serial,
      });

      // Send to device
      setLoadingMessage('Sending sign-off to device...');
      await serialConnection.setSignoff(response.payload);

      // Disconnect serial
      setLoadingMessage('Disconnecting...');
      await serialConnection.disconnect();
      setConnected(false);

      setActiveStep(10);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Failed to complete sign-off');
      }
    } finally {
      setLoading(false);
    }
  };

  // Reset everything
  const handleReset = useCallback(async () => {
    try {
      await serialConnection.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    setActiveStep(0);
    setConnected(false);
    setDeviceInfo(null);
    setCalibration(DEFAULT_CALIBRATION);
    setHwVersion('v1.0');
    setHwComment('');
    setProvisionMode('development');
    setTests([]);
    setChecklist([]);
    setAttestation(null);
    setAttestationResult(null);
    setError(null);
  }, []);

  // Auto-trigger mTLS exchange when entering step 2
  useEffect(() => {
    if (activeStep === 2 && deviceInfo && !loading) {
      handleMtlsExchange();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStep, deviceInfo]);

  // Render step 0: Connect Serial
  const renderConnectStep = () => (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <UsbIcon sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
      <Typography variant="h6" gutterBottom>
        Connect to Device
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Connect your molstem thermocycler via USB and click the button below to start provisioning.
      </Typography>

      {!serialSupported && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Web Serial API is not supported in this browser. Please use Chrome, Edge, or Opera.
        </Alert>
      )}

      <Button
        variant="contained"
        size="large"
        onClick={handleConnect}
        disabled={!serialSupported || loading}
        startIcon={<UsbIcon />}
      >
        Connect Serial
      </Button>
    </Box>
  );

  // Render step 1: Device Identity
  const renderIdentityStep = () => (
    <Box>
      <Typography variant="body1" sx={{ mb: 3 }}>
        Click below to retrieve the device identity. If this is a new device, cryptographic keys will be generated.
      </Typography>

      {deviceInfo && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>
              Device Information
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, width: 120 }}>Serial</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{deviceInfo.serial}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>WiFi MAC</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{deviceInfo.wifiMac}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Chip ID</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{deviceInfo.chipId}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="outlined" onClick={handleReset} startIcon={<ArrowBackIcon />}>
          Disconnect
        </Button>
        {!deviceInfo ? (
          <Button variant="contained" onClick={handleGetIdentity} disabled={loading} endIcon={<ArrowForwardIcon />}>
            Get Identity
          </Button>
        ) : (
          <Button variant="contained" onClick={handleMtlsExchange} disabled={loading} endIcon={<ArrowForwardIcon />}>
            Continue
          </Button>
        )}
      </Box>
    </Box>
  );

  // Render step 2: mTLS Exchange (auto-proceed)
  const renderMtlsStep = () => (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <Typography variant="body1">
        Exchanging mTLS credentials with device...
      </Typography>
    </Box>
  );

  // Render step 3: Calibration
  const renderCalibrationStep = () => (
    <Box>
      <Typography variant="body1" sx={{ mb: 3 }}>
        Configure the PID controller parameters for temperature control. Default values are pre-filled.
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        {[
          { key: 'kp', label: 'KP', description: 'Proportional gain' },
          { key: 'ti', label: 'TI', description: 'Integral time constant' },
          { key: 'td', label: 'TD', description: 'Derivative time constant' },
          { key: 'tf', label: 'TF', description: 'Derivative filter time' },
          { key: 'kb', label: 'KB', description: 'Anti-windup gain' },
        ].map((field) => (
          <Grid item xs={6} key={field.key}>
            <TextField
              fullWidth
              type="number"
              label={field.label}
              value={calibration[field.key as keyof typeof calibration]}
              onChange={(e) =>
                setCalibration((prev) => ({
                  ...prev,
                  [field.key]: parseFloat(e.target.value) || 0,
                }))
              }
              helperText={field.description}
              inputProps={{ step: 0.001, min: 0, max: 100 }}
            />
          </Grid>
        ))}
      </Grid>

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button
          variant="outlined"
          onClick={() => setCalibration(DEFAULT_CALIBRATION)}
          startIcon={<RestoreIcon />}
        >
          Reset to Defaults
        </Button>
        <Button variant="contained" onClick={handleSetCalibration} disabled={loading} endIcon={<ArrowForwardIcon />}>
          Save & Continue
        </Button>
      </Box>
    </Box>
  );

  // Render step 4: Hardware Details
  const renderHwDetailsStep = () => (
    <Box>
      <Typography variant="body1" sx={{ mb: 3 }}>
        Enter the hardware version and any comments about this device.
      </Typography>

      <TextField
        fullWidth
        label="Hardware Version"
        value={hwVersion}
        onChange={(e) => setHwVersion(e.target.value)}
        sx={{ mb: 2 }}
        required
      />

      <TextField
        fullWidth
        label="Comment (optional)"
        value={hwComment}
        onChange={(e) => setHwComment(e.target.value)}
        multiline
        rows={2}
        sx={{ mb: 3 }}
      />

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="outlined" onClick={() => setActiveStep(3)} startIcon={<ArrowBackIcon />}>
          Back
        </Button>
        <Button
          variant="contained"
          onClick={handleSetHwVersion}
          disabled={loading || !hwVersion.trim()}
          endIcon={<ArrowForwardIcon />}
        >
          Continue
        </Button>
      </Box>
    </Box>
  );

  // Render step 5: Provision Mode
  const renderModeStep = () => (
    <Box>
      <Typography variant="body1" sx={{ mb: 3 }}>
        Select the provisioning mode for this device.
      </Typography>

      <FormControl component="fieldset" sx={{ mb: 3 }}>
        <FormLabel component="legend">Provision Mode</FormLabel>
        <RadioGroup
          value={provisionMode}
          onChange={(e) => setProvisionMode(e.target.value as 'development' | 'production')}
        >
          <FormControlLabel
            value="development"
            control={<Radio />}
            label={
              <Box>
                <Typography variant="body1">Development</Typography>
                <Typography variant="body2" color="text.secondary">
                  For testing and development. Can be re-provisioned later.
                </Typography>
              </Box>
            }
          />
          <FormControlLabel
            value="production"
            control={<Radio />}
            label={
              <Box>
                <Typography variant="body1" color="error.main">
                  Production
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  For final deployment. Requires hardware tests and checklist. Cannot be re-provisioned.
                </Typography>
              </Box>
            }
          />
        </RadioGroup>
      </FormControl>

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="outlined" onClick={() => setActiveStep(4)} startIcon={<ArrowBackIcon />}>
          Back
        </Button>
        <Button variant="contained" onClick={handleSetMode} disabled={loading} endIcon={<ArrowForwardIcon />}>
          Continue
        </Button>
      </Box>
    </Box>
  );

  // Render step 6: Hardware Tests
  const renderTestsStep = () => {
    const allCompleted = tests.every((t) => t.status === 'passed' || t.status === 'failed');

    return (
      <Box>
        <Typography variant="body1" sx={{ mb: 3 }}>
          Verify hardware functionality by running these tests.
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3 }}>
          {tests.map((test) => (
            <Card key={test.id} variant="outlined">
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Box>
                    <Typography variant="subtitle1" fontWeight="medium">
                      {test.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {test.description}
                    </Typography>
                  </Box>
                  <Chip
                    label={test.status}
                    color={
                      test.status === 'passed'
                        ? 'success'
                        : test.status === 'failed'
                        ? 'error'
                        : 'default'
                    }
                    size="small"
                  />
                </Box>

                {test.status === 'pending' && (
                  <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
                    <Button
                      size="small"
                      variant="contained"
                      color="success"
                      startIcon={<CheckCircleIcon />}
                      onClick={() => handleRunTest(test.id, 'pass')}
                      disabled={loading}
                    >
                      Pass
                    </Button>
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<CloseIcon />}
                      onClick={() => handleRunTest(test.id, 'fail')}
                      disabled={loading}
                    >
                      Fail
                    </Button>
                  </Box>
                )}
              </CardContent>
            </Card>
          ))}
        </Box>

        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button variant="outlined" onClick={() => setActiveStep(5)} startIcon={<ArrowBackIcon />}>
            Back
          </Button>
          <Button
            variant="contained"
            onClick={handleTestsContinue}
            disabled={!allCompleted || loading}
            endIcon={<ArrowForwardIcon />}
          >
            Continue
          </Button>
        </Box>
      </Box>
    );
  };

  // Render step 7: Checklist
  const renderChecklistStep = () => {
    const allCompleted = checklist.every((item) => item.completed);

    return (
      <Box>
        <Typography variant="body1" sx={{ mb: 3 }}>
          Verify all physical requirements before completing provisioning.
        </Typography>

        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {checklist.map((item) => (
                <FormControlLabel
                  key={item.id}
                  control={
                    <Checkbox
                      checked={item.completed}
                      onChange={(e) => handleChecklistToggle(item.id, e.target.checked)}
                      disabled={loading}
                    />
                  }
                  label={
                    <Typography
                      variant="body2"
                      sx={{
                        textDecoration: item.completed ? 'line-through' : 'none',
                        color: item.completed ? 'text.secondary' : 'text.primary',
                      }}
                    >
                      {item.description}
                    </Typography>
                  }
                />
              ))}
            </Box>
          </CardContent>
        </Card>

        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Button variant="outlined" onClick={() => setActiveStep(6)} startIcon={<ArrowBackIcon />}>
            Back
          </Button>
          <Button
            variant="contained"
            onClick={() => setActiveStep(8)}
            disabled={!allCompleted || loading}
            endIcon={<ArrowForwardIcon />}
          >
            Continue
          </Button>
        </Box>
      </Box>
    );
  };

  // Render step 8: Attestation
  const renderAttestationStep = () => (
    <Box>
      <Typography variant="body1" sx={{ mb: 3 }}>
        Request the device to generate a signed attestation of its configuration.
      </Typography>

      {attestationResult && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>
              Verified Device Configuration
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, width: 140 }}>Serial</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{attestationResult.serial}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Provision Mode</TableCell>
                  <TableCell>
                    <Chip
                      label={attestationResult.provisionMode.toUpperCase()}
                      color={attestationResult.provisionMode === 'production' ? 'error' : 'warning'}
                      size="small"
                    />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>HW Version</TableCell>
                  <TableCell>{attestationResult.hwVersion}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Calibration</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    KP={attestationResult.calibration.kp}, TI={attestationResult.calibration.ti}, TD=
                    {attestationResult.calibration.td}, TF={attestationResult.calibration.tf}, KB=
                    {attestationResult.calibration.kb}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button
          variant="outlined"
          onClick={() => setActiveStep(provisionMode === 'production' ? 7 : 5)}
          startIcon={<ArrowBackIcon />}
        >
          Back
        </Button>
        {!attestationResult ? (
          <Button variant="contained" onClick={handleGetAttestation} disabled={loading} endIcon={<ArrowForwardIcon />}>
            Get Attestation
          </Button>
        ) : (
          <Button variant="contained" onClick={() => setActiveStep(9)} disabled={loading} endIcon={<ArrowForwardIcon />}>
            Continue to Sign-off
          </Button>
        )}
      </Box>
    </Box>
  );

  // Render step 9: Sign-off
  const renderSignoffStep = () => (
    <Box>
      <Alert severity="warning" sx={{ mb: 3 }}>
        Review the device configuration below and click "Approve & Complete" to finalize provisioning.
        {provisionMode === 'production' && ' This action cannot be undone.'}
      </Alert>

      {attestationResult && (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>
              Configuration to Approve
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, width: 140 }}>Serial</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{attestationResult.serial}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Provision Mode</TableCell>
                  <TableCell>
                    <Chip
                      label={attestationResult.provisionMode.toUpperCase()}
                      color={attestationResult.provisionMode === 'production' ? 'error' : 'warning'}
                      size="small"
                    />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>HW Version</TableCell>
                  <TableCell>{attestationResult.hwVersion}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Calibration</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                    KP={attestationResult.calibration.kp}, TI={attestationResult.calibration.ti}, TD=
                    {attestationResult.calibration.td}, TF={attestationResult.calibration.tf}, KB=
                    {attestationResult.calibration.kb}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button variant="outlined" onClick={() => setActiveStep(8)} startIcon={<ArrowBackIcon />}>
          Back
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={handleSignoff}
          disabled={loading}
          endIcon={<CheckCircleIcon />}
        >
          Approve & Complete
        </Button>
      </Box>
    </Box>
  );

  // Render step 10: Complete
  const renderCompleteStep = () => (
    <Box sx={{ textAlign: 'center', py: 4 }}>
      <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
      <Typography variant="h6" gutterBottom>
        Provisioning Complete!
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        The device has been successfully provisioned and is ready for use.
      </Typography>

      {attestationResult && (
        <Card variant="outlined" sx={{ mb: 3, textAlign: 'left' }}>
          <CardContent>
            <Typography variant="subtitle2" gutterBottom>
              Device Summary
            </Typography>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Serial</TableCell>
                  <TableCell sx={{ fontFamily: 'monospace' }}>{attestationResult.serial}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>Mode</TableCell>
                  <TableCell>{attestationResult.provisionMode}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600 }}>HW Version</TableCell>
                  <TableCell>{attestationResult.hwVersion}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Button variant="contained" onClick={handleReset}>
        Provision Another Device
      </Button>
    </Box>
  );

  // Get visible steps based on mode (hide tests/checklist for dev mode after mode selection)
  const getVisibleSteps = () => {
    if (activeStep <= 5 || provisionMode === 'production') {
      return STEPS;
    }
    // Dev mode: skip steps 6 and 7 (Hardware Tests, Checklist)
    return STEPS.filter((_, i) => i !== 6 && i !== 7);
  };

  const getAdjustedStep = () => {
    if (activeStep <= 5 || provisionMode === 'production') {
      return activeStep;
    }
    // Dev mode: adjust step number after skipping
    if (activeStep >= 8) {
      return activeStep - 2;
    }
    return activeStep;
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Provision Device (Serial)
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stepper activeStep={getAdjustedStep()} alternativeLabel>
            {getVisibleSteps().map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        </CardContent>
      </Card>

      {connected && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Connected to device via serial
        </Alert>
      )}

      <ErrorAlert error={error} onDismiss={() => setError(null)} />

      <Card>
        <CardContent>
          {activeStep === 0 && renderConnectStep()}
          {activeStep === 1 && renderIdentityStep()}
          {activeStep === 2 && renderMtlsStep()}
          {activeStep === 3 && renderCalibrationStep()}
          {activeStep === 4 && renderHwDetailsStep()}
          {activeStep === 5 && renderModeStep()}
          {activeStep === 6 && renderTestsStep()}
          {activeStep === 7 && renderChecklistStep()}
          {activeStep === 8 && renderAttestationStep()}
          {activeStep === 9 && renderSignoffStep()}
          {activeStep === 10 && renderCompleteStep()}
        </CardContent>
      </Card>

      <LoadingOverlay open={loading} message={loadingMessage} />
    </Box>
  );
}
