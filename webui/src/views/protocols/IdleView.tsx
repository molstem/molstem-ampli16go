import React from 'react';
import { Button, Container, Stack, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ScienceIcon from '@mui/icons-material/Science';
import { useTelemetryStore } from '../../stores/telemetryStore';

interface IdleViewProps {
  onStart: () => void;
}

export const IdleView: React.FC<IdleViewProps> = ({ onStart }) => {
  const identity = useTelemetryStore((s) => s.identity);
  const transport = useTelemetryStore((s) => s.transport);

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 4, sm: 8 } }}>
      <Stack spacing={3} alignItems="center" sx={{ textAlign: 'center' }}>
        <ScienceIcon sx={{ fontSize: 56, color: 'primary.main' }} />
        <Stack spacing={1}>
          <Typography variant="h3" component="h1">
            Ready
          </Typography>
          <Typography variant="body1" color="text.secondary">
            The thermocycler is idle and waiting for a bio protocol.
          </Typography>
          {identity && (
            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {identity.serial || 'no serial'} · {identity.version || 'unknown version'}
              {transport ? ` · ${transport}` : ''}
            </Typography>
          )}
        </Stack>
        <Button
          variant="contained"
          color="success"
          size="large"
          startIcon={<PlayArrowIcon />}
          onClick={onStart}
          sx={{ minHeight: 52, px: 4, width: { xs: '100%', sm: 'auto' } }}
        >
          Start bio protocol
        </Button>
      </Stack>
    </Container>
  );
};
