import { Alert, AlertTitle } from '@mui/material';

interface ErrorAlertProps {
  error: string | null;
  title?: string;
  onDismiss?: () => void;
}

export function ErrorAlert({ error, title = 'Error', onDismiss }: ErrorAlertProps) {
  if (!error) return null;

  return (
    <Alert severity="error" onClose={onDismiss} sx={{ mb: 2 }}>
      <AlertTitle>{title}</AlertTitle>
      {error}
    </Alert>
  );
}
