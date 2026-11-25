import { Box, Typography } from '@mui/material';

interface PasswordStrengthBarProps {
  password: string;
}

type StrengthLevel = 0 | 1 | 2 | 3 | 4;

interface StrengthInfo {
  level: StrengthLevel;
  label: string;
  color: 'error' | 'warning' | 'info' | 'success';
  hint: string;
}

function calculateStrength(password: string): StrengthInfo {
  if (!password) {
    return {
      level: 0,
      label: '',
      color: 'error',
      hint: 'Enter a password',
    };
  }

  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumbers = /[0-9]/.test(password);
  const hasSymbols = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password);
  const length = password.length;

  // Level 4: Strong - 12+ chars with all character types
  if (length >= 12 && hasUppercase && hasLowercase && hasNumbers && hasSymbols) {
    return {
      level: 4,
      label: 'Strong',
      color: 'success',
      hint: 'Excellent password!',
    };
  }

  // Level 3: Good - 12+ chars OR (8+ with mixed case and numbers)
  if (length >= 12 || (length >= 8 && hasUppercase && hasLowercase && hasNumbers)) {
    return {
      level: 3,
      label: 'Good',
      color: 'info',
      hint: 'Add symbols for maximum security',
    };
  }

  // Level 2: Fair - 8-11 chars
  if (length >= 8) {
    return {
      level: 2,
      label: 'Fair',
      color: 'warning',
      hint: 'Use 12+ characters with mixed case, numbers, and symbols',
    };
  }

  // Level 1: Weak - less than 8 chars but meets minimum
  if (length >= 6) {
    return {
      level: 1,
      label: 'Weak',
      color: 'error',
      hint: 'Password is too short. Use at least 8 characters.',
    };
  }

  // Below minimum
  return {
    level: 1,
    label: 'Too Short',
    color: 'error',
    hint: 'Minimum 6 characters required',
  };
}

export function PasswordStrengthBar({ password }: PasswordStrengthBarProps) {
  const strength = calculateStrength(password);

  if (!password) {
    return null;
  }

  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: 'flex', gap: 0.5, mb: 0.5 }}>
        {[1, 2, 3, 4].map((level) => (
          <Box
            key={level}
            sx={{
              flex: 1,
              height: 4,
              borderRadius: 1,
              bgcolor: level <= strength.level
                ? `${strength.color}.main`
                : 'action.disabledBackground',
              transition: 'background-color 0.3s ease',
            }}
          />
        ))}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography
          variant="caption"
          color={`${strength.color}.main`}
          fontWeight="medium"
        >
          {strength.label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {strength.hint}
        </Typography>
      </Box>
    </Box>
  );
}

export { calculateStrength };
