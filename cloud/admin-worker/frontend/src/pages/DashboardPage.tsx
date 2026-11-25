import { useEffect, useState } from 'react';
import { Grid, Typography, Box, Button } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import DevicesIcon from '@mui/icons-material/Devices';
import PeopleIcon from '@mui/icons-material/People';
import LinkIcon from '@mui/icons-material/Link';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import { StatsCard, ErrorAlert } from '../components';
import { api, ApiError } from '../api/client';

export function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState({ devices: 0, users: 0, enrollments: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadStats() {
      try {
        const [devicesRes, usersRes, enrollmentsRes] = await Promise.all([
          api.getDevices(),
          api.getUsers(),
          api.getEnrollments(),
        ]);
        setStats({
          devices: devicesRes.devices.length,
          users: usersRes.users.length,
          enrollments: enrollmentsRes.enrollments.length,
        });
      } catch (e) {
        if (e instanceof ApiError) {
          setError(e.message);
        } else {
          setError('Failed to load dashboard stats');
        }
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, []);

  return (
    <Box>
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h5">Overview</Typography>
        <Button
          variant="contained"
          startIcon={<AddCircleIcon />}
          onClick={() => navigate('/provision')}
        >
          Provision Device
        </Button>
      </Box>

      <ErrorAlert error={error} onDismiss={() => setError(null)} />

      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={4}>
          <StatsCard
            title="Total Devices"
            value={loading ? '...' : stats.devices}
            icon={<DevicesIcon />}
            color="#1976d2"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <StatsCard
            title="Total Users"
            value={loading ? '...' : stats.users}
            icon={<PeopleIcon />}
            color="#388e3c"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={4}>
          <StatsCard
            title="Active Enrollments"
            value={loading ? '...' : stats.enrollments}
            icon={<LinkIcon />}
            color="#f57c00"
          />
        </Grid>
      </Grid>
    </Box>
  );
}
