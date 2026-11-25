import React from 'react';
import { Container, Divider, Typography } from '@mui/material';
import { Documentation } from '../components/Documentation';

export const DocsPage: React.FC = () => (
  <Container maxWidth="md" sx={{ py: { xs: 2, sm: 4 } }}>
    <Documentation />
    <Divider sx={{ my: 4 }} />
    <Typography variant="caption" color="text.secondary" component="p">
      molstem thermocycler app · version {__APP_VERSION__}
    </Typography>
  </Container>
);
