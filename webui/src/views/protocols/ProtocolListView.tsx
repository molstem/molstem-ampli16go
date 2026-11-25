import React, { useState } from 'react';
import {
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { type StoredProtocol } from '../../stores/protocolStore';
import { summarizeProtocol } from '../../services/protocolCommands';

interface ProtocolListViewProps {
  protocols: StoredProtocol[];
  onSelect: (protocol: StoredProtocol) => void;
  onEdit: (protocol: StoredProtocol) => void;
  onDelete: (id: string) => void;
  onAddNew: () => void;
  onBack: () => void;
}

export const ProtocolListView: React.FC<ProtocolListViewProps> = ({ protocols, onSelect, onEdit, onDelete, onAddNew, onBack }) => {
  const [pendingDelete, setPendingDelete] = useState<StoredProtocol | null>(null);

  return (
    <Container maxWidth="sm" sx={{ py: { xs: 2, sm: 4 } }}>
      <Stack spacing={2}>
        <Box>
          <Button startIcon={<ArrowBackIcon />} onClick={onBack} sx={{ ml: -1 }}>
            Back
          </Button>
          <Typography variant="h4" component="h1" sx={{ mt: 1 }}>
            Choose a protocol
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Protocols are saved in this browser.
          </Typography>
        </Box>

        <Button variant="contained" size="large" fullWidth startIcon={<AddIcon />} onClick={onAddNew} sx={{ minHeight: 48 }}>
          Add new protocol
        </Button>

        {protocols.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
            No saved protocols yet.
          </Typography>
        ) : (
          <Paper variant="outlined">
            <List disablePadding>
              {protocols.map((p, i) => (
                <ListItem
                  key={p.id}
                  disablePadding
                  divider={i < protocols.length - 1}
                  secondaryAction={
                    <Stack direction="row" spacing={0}>
                      <Tooltip title="Edit">
                        <IconButton edge={false} aria-label={`Edit ${p.name}`} onClick={() => onEdit(p)} sx={{ width: 44, height: 44 }}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton edge="end" aria-label={`Delete ${p.name}`} onClick={() => setPendingDelete(p)} sx={{ width: 44, height: 44 }}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  }
                >
                  <ListItemButton onClick={() => onSelect(p)} sx={{ minHeight: 64, pr: 12 }}>
                    <ListItemText
                      primary={p.name}
                      secondary={summarizeProtocol(p)}
                      primaryTypographyProps={{ fontWeight: 500, noWrap: true }}
                      secondaryTypographyProps={{ noWrap: true, sx: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem' } }}
                    />
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Paper>
        )}
      </Stack>

      <Dialog open={pendingDelete !== null} onClose={() => setPendingDelete(null)}>
        <DialogTitle>Delete “{pendingDelete?.name}”?</DialogTitle>
        <DialogContent>
          <DialogContentText>This removes the protocol from this browser. It cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPendingDelete(null)}>Keep</Button>
          <Button
            color="error"
            variant="contained"
            startIcon={<DeleteIcon />}
            onClick={() => {
              if (pendingDelete) onDelete(pendingDelete.id);
              setPendingDelete(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
};
