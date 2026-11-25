import { Backdrop, CircularProgress, Typography, Box } from '@mui/material';

interface LoadingOverlayProps {
  open: boolean;
  message?: string;
}

export function LoadingOverlay({ open, message }: LoadingOverlayProps) {
  return (
    <Backdrop
      open={open}
      sx={{
        color: '#fff',
        zIndex: (theme) => theme.zIndex.drawer + 1,
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <CircularProgress color="inherit" size={48} />
      {message && (
        <Box
          sx={{
            textAlign: 'center',
            px: 2,
          }}
        >
          <Typography variant="h6" component="div">
            {message}
          </Typography>
        </Box>
      )}
    </Backdrop>
  );
}
