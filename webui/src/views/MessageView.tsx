import React from 'react';
import { Box, CircularProgress, Container, Stack, Typography } from '@mui/material';

interface MessageViewProps {
  title: string;
  body?: React.ReactNode;
  icon?: React.ReactNode;
  spinner?: boolean;
  /** Buttons rendered under the message, stacked on phones. */
  actions?: React.ReactNode;
}

/** Centred status message used for identifying / querying / busy / provisioning. */
export const MessageView: React.FC<MessageViewProps> = ({ title, body, icon, spinner = false, actions }) => (
  <Container maxWidth="sm" sx={{ py: { xs: 4, sm: 8 } }}>
    <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center' }}>
      {spinner ? <CircularProgress /> : icon ? <Box sx={{ color: 'text.secondary', '& svg': { fontSize: 48 } }}>{icon}</Box> : null}
      <Typography variant="h4" component="h1">
        {title}
      </Typography>
      {body && (
        <Typography variant="body1" color="text.secondary" component="div">
          {body}
        </Typography>
      )}
      {actions && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ pt: 1, width: { xs: '100%', sm: 'auto' } }}>
          {actions}
        </Stack>
      )}
    </Stack>
  </Container>
);
