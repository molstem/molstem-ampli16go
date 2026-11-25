import React, { useState } from 'react';
import { Alert, Box, Button, Container, Divider, Paper, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { STAGE_KEYS, type StoredProtocol } from '../../stores/protocolStore';
import { CYCLED_STAGES, LIMITS, STAGE_LABELS, startErrorMessage, startProtocol } from '../../services/protocolCommands';
import { devicePoller } from '../../services/devicePoller';
import { useLogStore } from '../../stores/logStore';

interface StartConfirmViewProps {
  protocol: StoredProtocol;
  onBack: () => void;
}

export const StartConfirmView: React.FC<StartConfirmViewProps> = ({ protocol, onBack }) => {
  const addLog = useLogStore((s) => s.addLog);
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async () => {
    setSending(true);
    setError(null);
    try {
      await startProtocol(protocol, comment);
      addLog(`Protocol "${protocol.name}" started on device`, 'success');
      // On success the device reports RUNNING and this view is replaced.
    } catch (e) {
      const text = startErrorMessage(e);
      setError(text);
      addLog(`Start failed: ${text}`, 'error');
      void devicePoller.refreshNow();
      setSending(false);
    }
  };

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 2, sm: 4 } }}>
      <Stack spacing={3}>
        <Box>
          <Button startIcon={<ArrowBackIcon />} onClick={onBack} disabled={sending} sx={{ ml: -1 }}>
            Back
          </Button>
          <Typography variant="overline" color="text.secondary" component="div" sx={{ mt: 1 }}>
            Start protocol
          </Typography>
          <Typography variant="h4" component="h1">
            {protocol.name}
          </Typography>
        </Box>

        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack spacing={1}>
            <Row label="Cycles" value={`${protocol.cycles}`} />
            <Divider />
            {STAGE_KEYS.map((key) => (
              <Row
                key={key}
                label={STAGE_LABELS[key]}
                value={`${protocol.stages[key].temp} °C for ${protocol.stages[key].seconds} s`}
                muted={!CYCLED_STAGES.includes(key)}
              />
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            {CYCLED_STAGES.map((k) => STAGE_LABELS[k]).join(', ')} repeat {protocol.cycles} times.
          </Typography>
        </Paper>

        <TextField
          label="Comment (optional)"
          placeholder="Sample, operator, notes…"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          inputProps={{ maxLength: LIMITS.commentLen }}
          helperText={`${comment.length}/${LIMITS.commentLen} · sent to the device with the run`}
          fullWidth
          size="medium"
          multiline
          minRows={2}
          disabled={sending}
        />

        {error && <Alert severity="error">{error}</Alert>}

        <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end">
          <Button variant="text" size="large" onClick={onBack} disabled={sending} sx={{ minHeight: 48 }}>
            Back
          </Button>
          <Button
            variant="contained"
            color="success"
            size="large"
            startIcon={<PlayArrowIcon />}
            onClick={handleStart}
            disabled={sending}
            sx={{ minHeight: 48 }}
          >
            {sending ? 'Starting…' : 'Start protocol'}
          </Button>
        </Stack>
      </Stack>
    </Container>
  );
};

const Row: React.FC<{ label: string; value: string; muted?: boolean }> = ({ label, value, muted }) => (
  <Stack direction="row" justifyContent="space-between" spacing={2}>
    <Typography variant="body2" color={muted ? 'text.secondary' : 'text.primary'}>
      {label}
    </Typography>
    <Typography variant="body2" sx={{ fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
      {value}
    </Typography>
  </Stack>
);
