import { useState } from 'react';
import { Box, IconButton, TextField, Tooltip, InputAdornment } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';

interface CopyableTextProps {
  label: string;
  value: string;
  multiline?: boolean;
  rows?: number;
}

export function CopyableText({ label, value, multiline = false, rows = 4 }: CopyableTextProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Box>
      <TextField
        label={label}
        value={value}
        multiline={multiline}
        rows={multiline ? rows : undefined}
        fullWidth
        InputProps={{
          readOnly: true,
          sx: { fontFamily: 'monospace', fontSize: '0.875rem' },
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={copied ? 'Copied!' : 'Copy to clipboard'}>
                <IconButton onClick={handleCopy} edge="end" size="small">
                  {copied ? <CheckIcon color="success" /> : <ContentCopyIcon />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        }}
      />
    </Box>
  );
}
