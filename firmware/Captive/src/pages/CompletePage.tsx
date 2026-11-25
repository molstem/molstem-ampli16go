import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Typography,
  CircularProgress,
  Alert,
  Link,
  Paper,
  Chip,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningIcon from '@mui/icons-material/Warning';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useNavigate } from 'react-router-dom';
import { Layout, SimpleMarkdown } from '../components';
import { useWizard } from '../context/WizardContext';
import { getDeviceStatus, commitSetup, ApiError } from '../api/client';
import type { StatusResponse } from '../api/schemas';

import localInstructions from '../content/local-instructions.md?raw';
import cloudInstructions from '../content/cloud-instructions.md?raw';
import setupFailed from '../content/setup-failed.md?raw';

type PageState = 'loading' | 'success' | 'disconnected' | 'error';

export function CompletePage() {
  const navigate = useNavigate();
  const { dispatch } = useWizard();
  const [pageState, setPageState] = useState<PageState>('loading');
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const response = await getDeviceStatus();
        setStatus(response);
        dispatch({ type: 'SET_STATUS', status: response });

        if (response.state === 'disconnected') {
          setPageState('disconnected');
        } else {
          // Commit setup (turn off AP)
          try {
            await commitSetup();
          } catch (err) {
            console.warn('Failed to commit setup:', err);
            // Non-fatal - continue showing success
          }
          setPageState('success');
        }
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError('Failed to retrieve device status');
        }
        setPageState('error');
      }
    }

    fetchStatus();
  }, [dispatch]);

  const handleRestart = () => {
    dispatch({ type: 'RESET' });
    navigate('/');
  };

  // Loading state
  if (pageState === 'loading') {
    return (
      <Layout>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            py: 6,
          }}
        >
          <CircularProgress size={48} />
          <Typography variant="body1" color="text.secondary" mt={2}>
            Finalizing setup...
          </Typography>
        </Box>
      </Layout>
    );
  }

  // Error state
  if (pageState === 'error') {
    return (
      <Layout>
        <Box sx={{ textAlign: 'center' }}>
          <WarningIcon sx={{ fontSize: 64, color: 'error.main', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            Setup Error
          </Typography>
          <Alert severity="error" sx={{ mb: 3, textAlign: 'left' }}>
            {error}
          </Alert>
          <Button
            variant="contained"
            startIcon={<RestartAltIcon />}
            onClick={handleRestart}
          >
            Restart Wizard
          </Button>
        </Box>
      </Layout>
    );
  }

  // Disconnected state
  if (pageState === 'disconnected') {
    return (
      <Layout>
        <Box sx={{ textAlign: 'center' }}>
          <WarningIcon sx={{ fontSize: 64, color: 'warning.main', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            Setup Incomplete
          </Typography>

          {status?.id && (
            <Chip
              label={`Device: ${status.id}`}
              variant="outlined"
              sx={{ mb: 3 }}
            />
          )}

          <Box sx={{ textAlign: 'left' }}>
            <SimpleMarkdown content={setupFailed} />
          </Box>

          <Button
            variant="contained"
            startIcon={<RestartAltIcon />}
            onClick={handleRestart}
            sx={{ mt: 3 }}
            size="large"
          >
            Restart Wizard
          </Button>
        </Box>
      </Layout>
    );
  }

  // Success state - Local mode
  if (status?.state === 'local') {
    const mdnsLink = status.link || `http://${status.id?.toLowerCase()}.local`;
    const ipLink = status.ip ? `http://${status.ip}` : null;

    return (
      <Layout>
        <Box sx={{ textAlign: 'center' }}>
          <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            Setup Complete!
          </Typography>

          <Chip
            label={`Device: ${status.id}`}
            variant="outlined"
            sx={{ mb: 3 }}
          />

          {/* Access Links */}
          <Paper variant="outlined" sx={{ p: 2, mb: 3, textAlign: 'left' }}>
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Access your device:
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Link
                href={mdnsLink}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ fontFamily: 'monospace', fontSize: '0.9rem' }}
              >
                {mdnsLink}
              </Link>

              {ipLink && (
                <Link
                  href={ipLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  sx={{ fontFamily: 'monospace', fontSize: '0.9rem' }}
                >
                  {ipLink}
                </Link>
              )}
            </Box>
          </Paper>

          <Box sx={{ textAlign: 'left' }}>
            <SimpleMarkdown content={localInstructions} />
          </Box>
        </Box>
      </Layout>
    );
  }

  // Success state - Cloud mode, device already enrolled to an account
  if (status?.state === 'cloud' && status.enrolled) {
    return (
      <Layout>
        <Box sx={{ textAlign: 'center' }}>
          <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            Setup Complete!
          </Typography>

          <Chip label={`Device: ${status.id}`} variant="outlined" sx={{ mb: 3 }} />

          <Paper variant="outlined" sx={{ p: 2, mb: 3, bgcolor: 'action.hover' }}>
            <Typography variant="subtitle1" gutterBottom>
              This device is already linked to an account.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              No enrollment ID is needed. Open app.molstem.com/devices with that account
              to control it. To move it to another account, remove it there first; the
              device will then show a new enrollment ID.
            </Typography>
          </Paper>
        </Box>
      </Layout>
    );
  }

  // Success state - Cloud mode
  if (status?.state === 'cloud') {
    const enrollmentId = status.link || '';

    return (
      <Layout>
        <Box sx={{ textAlign: 'center' }}>
          <CheckCircleIcon sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography variant="h5" gutterBottom>
            Setup Complete!
          </Typography>

          <Chip
            label={`Device: ${status.id}`}
            variant="outlined"
            sx={{ mb: 3 }}
          />

          {/* Enrollment ID */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              mb: 3,
              bgcolor: 'action.hover',
            }}
          >
            <Typography variant="subtitle2" color="text.secondary" gutterBottom>
              Cloud Enrollment ID:
            </Typography>
            <Typography
              variant="h6"
              sx={{
                fontFamily: 'monospace',
                letterSpacing: 2,
                fontWeight: 'bold',
              }}
            >
              {enrollmentId}
            </Typography>
          </Paper>

          <Box sx={{ textAlign: 'left' }}>
            <SimpleMarkdown content={cloudInstructions} />
          </Box>
        </Box>
      </Layout>
    );
  }

  // Fallback
  return (
    <Layout>
      <Box sx={{ textAlign: 'center' }}>
        <Typography>Unknown state</Typography>
        <Button onClick={handleRestart}>Restart</Button>
      </Box>
    </Layout>
  );
}
