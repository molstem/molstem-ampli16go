import { useState, useEffect } from 'react';
import { Box, Typography, Chip } from '@mui/material';
import { DataTable, ErrorAlert } from '../components';
import { api, ApiError } from '../api/client';
import type { AdminProvision } from '@molstem/cloud-shared';

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '-';
  return new Date(timestamp * 1000).toLocaleString();
}

const columns = [
  { id: 'serial_number', label: 'Serial', minWidth: 140 },
  {
    id: 'provision_mode',
    label: 'Mode',
    minWidth: 100,
    format: (value: AdminProvision['provision_mode']) => (
      <Chip
        label={value.toUpperCase()}
        size="small"
        color={value === 'production' ? 'error' : 'warning'}
        variant="outlined"
      />
    ),
  },
  { id: 'hw_version', label: 'HW Version', minWidth: 100 },
  { id: 'provisioned_by', label: 'Provisioned By', minWidth: 150 },
  {
    id: 'created_at',
    label: 'Attested',
    minWidth: 150,
    format: (value: AdminProvision['created_at']) => formatDate(value),
  },
  {
    id: 'signed_off_at',
    label: 'Signed Off',
    minWidth: 150,
    format: (value: AdminProvision['signed_off_at']) => formatDate(value),
  },
  {
    id: 'attestation_hash',
    label: 'Attestation Hash',
    minWidth: 200,
    format: (value: string) => (
      <Typography
        component="span"
        sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
        title={value}
      >
        {value.substring(0, 16)}...
      </Typography>
    ),
  },
];

export function ProvisionsPage() {
  const [provisions, setProvisions] = useState<AdminProvision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadProvisions();
  }, []);

  const loadProvisions = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getProvisions();
      setProvisions(data.provisions);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError('Failed to load provisions');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 3 }}>
        Provisioning History
      </Typography>

      <ErrorAlert error={error} onDismiss={() => setError(null)} />

      <DataTable
        columns={columns}
        rows={provisions}
        loading={loading}
        emptyMessage="No provisions found"
        getRowKey={(row) => String(row.id)}
      />
    </Box>
  );
}
