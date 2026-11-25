import { useEffect, useState } from 'react';
import { Box, Typography, Button, Avatar } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { DataTable, ErrorAlert } from '../components';
import { api, ApiError } from '../api/client';
import type { AdminUser } from '@molstem/cloud-shared';

function formatDate(timestamp: number | null): string {
  if (!timestamp) return '-';
  return new Date(timestamp * 1000).toLocaleString();
}

export function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUsers = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getUsers();
      setUsers(response.users);
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
      } else {
        setError('Failed to load users');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const columns = [
    {
      id: 'picture_url' as const,
      label: '',
      minWidth: 50,
      format: (value: AdminUser['picture_url'], row: AdminUser) => (
        <Avatar src={value || undefined} alt={row.name || row.email} sx={{ width: 32, height: 32 }}>
          {(row.name || row.email)[0].toUpperCase()}
        </Avatar>
      ),
    },
    {
      id: 'email' as const,
      label: 'Email',
      minWidth: 200,
    },
    {
      id: 'name' as const,
      label: 'Name',
      minWidth: 150,
    },
    {
      id: 'created_at' as const,
      label: 'Created',
      minWidth: 150,
      format: (value: AdminUser['created_at']) => formatDate(value),
    },
    {
      id: 'last_login_at' as const,
      label: 'Last Login',
      minWidth: 150,
      format: (value: AdminUser['last_login_at']) => formatDate(value),
    },
  ];

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5">Users</Typography>
        <Button
          variant="outlined"
          startIcon={<RefreshIcon />}
          onClick={loadUsers}
          disabled={loading}
        >
          Refresh
        </Button>
      </Box>

      <ErrorAlert error={error} onDismiss={() => setError(null)} />

      <DataTable
        columns={columns}
        rows={users}
        loading={loading}
        emptyMessage="No users found"
        getRowKey={(row) => row.id}
      />
    </Box>
  );
}
