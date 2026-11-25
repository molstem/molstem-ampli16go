import { Autocomplete, TextField } from '@mui/material';

// Common IANA timezones grouped by region
const TIMEZONES = [
  // Americas
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Phoenix',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'America/Buenos_Aires',
  'America/Santiago',
  'America/Lima',
  'America/Bogota',
  // Europe
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Vienna',
  'Europe/Zurich',
  'Europe/Stockholm',
  'Europe/Oslo',
  'Europe/Copenhagen',
  'Europe/Helsinki',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/Budapest',
  'Europe/Bucharest',
  'Europe/Sofia',
  'Europe/Athens',
  'Europe/Dublin',
  'Europe/Lisbon',
  'Europe/Moscow',
  'Europe/Kiev',
  'Europe/Istanbul',
  // Asia
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Manila',
  'Asia/Jakarta',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dhaka',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Jerusalem',
  // Oceania
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Australia/Perth',
  'Australia/Adelaide',
  'Pacific/Auckland',
  'Pacific/Fiji',
  'Pacific/Honolulu',
  // Africa
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Casablanca',
  // UTC
  'UTC',
].sort();

function getTimezoneOffset(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find((p) => p.type === 'timeZoneName');
    return offsetPart?.value || '';
  } catch {
    return '';
  }
}

function formatTimezone(timezone: string): string {
  const offset = getTimezoneOffset(timezone);
  const displayName = timezone.replace(/_/g, ' ').replace('/', ' / ');
  return offset ? `${displayName} (${offset})` : displayName;
}

interface TimezoneSelectProps {
  value: string;
  onChange: (timezone: string) => void;
  error?: string;
}

export function TimezoneSelect({ value, onChange, error }: TimezoneSelectProps) {
  return (
    <Autocomplete
      options={TIMEZONES}
      value={TIMEZONES.includes(value) ? value : null}
      onChange={(_, newValue) => {
        if (newValue) {
          onChange(newValue);
        }
      }}
      getOptionLabel={formatTimezone}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Timezone"
          error={!!error}
          helperText={error || 'Device clock and scheduling'}
        />
      )}
      // Allow free text input if timezone not in list
      freeSolo
      onInputChange={(_, newInputValue, reason) => {
        if (reason === 'input' && newInputValue) {
          onChange(newInputValue);
        }
      }}
    />
  );
}

export { TIMEZONES, formatTimezone };
