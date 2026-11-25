import React, { useState } from 'react';
import { Alert, Box, Button, Container, Stack, TextField, Typography } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { STAGE_KEYS, useProtocolStore, type StageKey, type StoredProtocol } from '../../stores/protocolStore';
import {
  CYCLED_STAGES,
  LIMITS,
  STAGE_LABELS,
  draftFromProtocol,
  validateDraft,
  type DraftField,
  type ProtocolDraft,
} from '../../services/protocolCommands';

interface ProtocolFormViewProps {
  /** When set, the form edits this protocol and saving overwrites it. */
  initial?: StoredProtocol;
  onSaveAndStart: (saved: StoredProtocol) => void;
  onBack: () => void;
}

export const ProtocolFormView: React.FC<ProtocolFormViewProps> = ({ initial, onSaveAndStart, onBack }) => {
  const add = useProtocolStore((s) => s.add);
  const update = useProtocolStore((s) => s.update);
  const [draft, setDraft] = useState<ProtocolDraft>(() => draftFromProtocol(initial));
  const [error, setError] = useState<{ text: string; field: DraftField } | null>(null);

  const setStage = (key: StageKey, part: 'temp' | 'seconds', value: string) => {
    setDraft((d) => ({ ...d, stages: { ...d.stages, [key]: { ...d.stages[key], [part]: value } } }));
    setError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateDraft(draft);
    if (!result.ok) {
      setError({ text: result.error, field: result.field });
      return;
    }
    const saved = initial ? update(initial.id, result.value) : add(result.value);
    if (!saved) {
      // The protocol was deleted from another tab while editing: save it as new.
      onSaveAndStart(add(result.value));
      return;
    }
    onSaveAndStart(saved);
  };

  const fieldError = (field: DraftField) => error?.field === field;

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 2, sm: 4 } }}>
      <Box component="form" onSubmit={handleSubmit} noValidate>
        <Stack spacing={3}>
          <Box>
            <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ ml: -1 }}>
              Back
            </Button>
            <Typography variant="h4" component="h1" sx={{ mt: 1 }}>
              {initial ? 'Edit protocol' : 'New protocol'}
            </Typography>
          </Box>

          <TextField
            label="Name"
            value={draft.name}
            onChange={(e) => {
              setDraft((d) => ({ ...d, name: e.target.value }));
              setError(null);
            }}
            inputProps={{ maxLength: LIMITS.nameLen }}
            error={fieldError('name')}
            fullWidth
            size="medium"
            autoFocus={!initial}
            required
          />

          <TextField
            label="Cycles"
            type="number"
            value={draft.cycles}
            onChange={(e) => {
              setDraft((d) => ({ ...d, cycles: e.target.value }));
              setError(null);
            }}
            inputProps={{ min: LIMITS.cycles[0], max: LIMITS.cycles[1], inputMode: 'numeric' }}
            error={fieldError('cycles')}
            helperText={`${LIMITS.cycles[0]}–${LIMITS.cycles[1]}. Repeats ${CYCLED_STAGES.map((k) => STAGE_LABELS[k].toLowerCase()).join(', ')}; intro and final extension run once.`}
            fullWidth
            size="medium"
            required
          />

          <Box>
            <Typography variant="overline" color="text.secondary">
              Parameters
            </Typography>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {STAGE_KEYS.map((key) => {
                const [minS, maxS] = LIMITS.seconds[key];
                return (
                  <Box key={key} sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
                    <TextField
                      label={`${STAGE_LABELS[key]} °C`}
                      type="number"
                      value={draft.stages[key].temp}
                      onChange={(e) => setStage(key, 'temp', e.target.value)}
                      inputProps={{ min: LIMITS.temp[0], max: LIMITS.temp[1], step: 0.1, inputMode: 'decimal' }}
                      error={fieldError(`${key}.temp`)}
                      helperText={`${LIMITS.temp[0]}–${LIMITS.temp[1]} °C`}
                      size="medium"
                      required
                    />
                    <TextField
                      label={`${STAGE_LABELS[key]} s`}
                      type="number"
                      value={draft.stages[key].seconds}
                      onChange={(e) => setStage(key, 'seconds', e.target.value)}
                      inputProps={{ min: minS, max: maxS, step: 1, inputMode: 'numeric' }}
                      error={fieldError(`${key}.seconds`)}
                      helperText={`${minS}–${maxS} s`}
                      size="medium"
                      required
                    />
                  </Box>
                );
              })}
            </Stack>
          </Box>

          {error && <Alert severity="error">{error.text}</Alert>}

          <Stack direction={{ xs: 'column-reverse', sm: 'row' }} spacing={1.5} justifyContent="flex-end">
            <Button variant="text" size="large" onClick={onBack} sx={{ minHeight: 48 }}>
              Back
            </Button>
            <Button type="submit" variant="contained" color="success" size="large" startIcon={<PlayArrowIcon />} sx={{ minHeight: 48 }}>
              Save and start
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Container>
  );
};
