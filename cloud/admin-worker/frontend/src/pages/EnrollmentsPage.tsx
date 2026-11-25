import { useEffect, useState } from 'react';
import { Box, Typography, Button, Chip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { DataTable, ErrorAlert } from '../components';
import { api, ApiError } from '../api/client';
import type { AdminEnrollment } from '@molstem/cloud-shared';

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

function isExpired(expiresAt: number): boolean {
  return expiresAt * 1000 < Date.now();
}

export function EnrollmentsPage() {
  const [enrollments, setEnrollments] = useState<AdminEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadEnrollments = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getEnrollments();
      setEnrollments(response.enrollments);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError('Failed to load enrollments');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEnrollments();
  }, []);

  const columns = [
    {
      id: 'enrollment_id' as const,
      label: 'Enrollment ID',
      minWidth: 120,
      format: (value: AdminEnrollment['enrollment_id']) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
          {value}
        </Typography>
      ),
    },
    {
      id: 'serial_number' as const,
      label: 'Serial Number',
      minWidth: 200,
      format: (value: AdminEnrollment['serial_number']) => (
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {value}
        </Typography>
      ),
    },
    {
      id: 'created_at' as const,
      label: 'Created',
      minWidth: 150,
      format: (value: AdminEnrollment['created_at']) => formatDate(value),
    },
    {
      id: 'expires_at' as const,
      label: 'Expires',
      minWidth: 200,
      format: (value: AdminEnrollment['expires_at']) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <span>{formatDate(value)}</span>
          {isExpired(value) && <Chip label="Expired" color="error" size="small" />}
        </Box>
      ),
    },
  ];

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5">Enrollments</Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadEnrollments}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      <ErrorAlert error={error} onDismiss={() => setError(null)} />

      <DataTable
        columns={columns}
        rows={enrollments}
        loading={loading}
        emptyMessage="No active enrollments"
        getRowKey={(row) => row.enrollment_id}
      />
    </Box>
  );
}
