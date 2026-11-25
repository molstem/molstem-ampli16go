import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

interface ErrorModalProps {
  open: boolean;
  title?: string;
  message: string;
  onDismiss: () => void;
}

export function ErrorModal({
  open,
  title = 'Error',
  message,
  onDismiss,
}: ErrorModalProps) {
  return (
    <Dialog
      open={open}
      onClose={onDismiss}
      maxWidth="xs"
      fullWidth
      aria-labelledby="error-dialog-title"
    >
      <DialogTitle id="error-dialog-title">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ErrorOutlineIcon color="error" />
          <Typography variant="h6" component="span">
            {title}
          </Typography>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Typography color="text.secondary">{message}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onDismiss} variant="contained" autoFocus>
          Dismiss
        </Button>
      </DialogActions>
    </Dialog>
  );
}
