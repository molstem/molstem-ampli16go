import { useEffect, useState } from 'react';
import { Box, Typography, Button, Chip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { DataTable, ErrorAlert } from '../components';
import { api, ApiError } from '../api/client';
import type { AdminDevice } from '@molstem/cloud-shared';

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '-';
  return new Date(timestamp * 1000).toLocaleString();
}

function truncate(str: string | null, maxLen: number): string {
  if (!str) return '-';
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen) + '...';
}

export function DevicesPage() {
  const [devices, setDevices] = useState<AdminDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDevices = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getDevices();
      setDevices(response.devices);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError('Failed to load devices');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, []);

  const columns = [
    {
      id: 'serial_number' as const,
      label: 'Serial Number',
      minWidth: 200,
      format: (value: AdminDevice['serial_number']) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {value}
        </Typography>
      ),
    },
    {
      id: 'public_key' as const,
      label: 'Public Key',
      minWidth: 150,
      format: (value: AdminDevice['public_key']) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }} title={value || ''}>
          {truncate(value, 20)}
        </Typography>
      ),
    },
    {
      id: 'name' as const,
      label: 'Name',
      minWidth: 120,
    },
    {
      id: 'user_id' as const,
      label: 'Status',
      minWidth: 120,
      format: (value: AdminDevice['user_id']) =>
        value ? (
          <Chip label="Enrolled" color="success" size="small" />
        ) : (
          <Chip label="Pre-provisioned" color="warning" size="small" variant="outlined" />
        ),
    },
    {
      id: 'enrolled_at' as const,
      label: 'Enrolled',
      minWidth: 150,
      format: (value: AdminDevice['enrolled_at']) => formatDate(value),
    },
    {
      id: 'last_seen_at' as const,
      label: 'Last Seen',
      minWidth: 150,
      format: (value: AdminDevice['last_seen_at']) => formatDate(value),
    },
    {
      id: 'created_at' as const,
      label: 'Created',
      minWidth: 150,
      format: (value: AdminDevice['created_at']) => formatDate(value),
    },
  ];

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5">Devices</Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadDevices}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      <ErrorAlert error={error} onDismiss={() => setError(null)} />

      <DataTable
        columns={columns}
        rows={devices}
        loading={loading}
        emptyMessage="No devices found"
        getRowKey={(row) => row.serial_number}
      />
    </Box>
  );
}
