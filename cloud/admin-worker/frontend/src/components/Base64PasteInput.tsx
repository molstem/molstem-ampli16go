import { useState } from 'react';
import { TextField, Box, Typography, Chip } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';

interface Base64PasteInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  helperText?: string;
  requiredFields?: string[];
  rows?: number;
}

export function Base64PasteInput({
  label,
  value,
  onChange,
  placeholder,
  helperText,
  requiredFields = [],
  rows = 4,
}: Base64PasteInputProps) {
  const [parseStatus, setParseStatus] = useState<{
    valid: boolean;
    fields: string[];
    error?: string;
  } | null>(null);

  const handleChange = (newValue: string) => {
    onChange(newValue);

    if (!newValue.trim()) {
      setParseStatus(null);
      return;
    }

    try {
      const decoded = atob(newValue.trim());
      const json = JSON.parse(decoded);
      // Support both root-level fields and nested { data: {...}, signature: ... } format
      const dataObj = json.data && typeof json.data === 'object' ? json.data : json;
      const fields = Object.keys(dataObj);
      const missingFields = requiredFields.filter((f) => !(f in dataObj));

      setParseStatus({
        valid: missingFields.length === 0,
        fields,
        error: missingFields.length > 0 ? `Missing: ${missingFields.join(', ')}` : undefined,
      });
    } catch {
      setParseStatus({
        valid: false,
        fields: [],
        error: 'Invalid Base64 or JSON format',
      });
    }
  };

  return (
    <Box>
      <TextField
        label={label}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={placeholder}
        helperText={helperText}
        multiline
        rows={rows}
        fullWidth
        sx={{ fontFamily: 'monospace' }}
      />

      {parseStatus && (
        <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          {parseStatus.valid ? (
            <Chip
              icon={<CheckCircleIcon />}
              label="Valid"
              color="success"
              size="small"
              variant="outlined"
            />
          ) : (
            <Chip
              icon={<ErrorIcon />}
              label={parseStatus.error}
              color="error"
              size="small"
              variant="outlined"
            />
          )}

          {parseStatus.fields.length > 0 && (
            <Typography variant="caption" color="text.secondary">
              Fields: {parseStatus.fields.join(', ')}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
