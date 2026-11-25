import { Box, Typography, keyframes } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

const scaleIn = keyframes`
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.2);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
`;

const ripple = keyframes`
  0% {
    transform: scale(0.8);
    opacity: 0.8;
  }
  100% {
    transform: scale(2.5);
    opacity: 0;
  }
`;

interface SuccessAnimationProps {
  message?: string;
}

export function SuccessAnimation({ message = 'Success!' }: SuccessAnimationProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        py: 6,
      }}
    >
      <Box
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          mb: 3,
        }}
      >
        {/* Ripple effect */}
        <Box
          sx={{
            position: 'absolute',
            width: 80,
            height: 80,
            borderRadius: '50%',
            bgcolor: 'success.main',
            animation: `${ripple} 1.5s ease-out infinite`,
          }}
        />
        <Box
          sx={{
            position: 'absolute',
            width: 80,
            height: 80,
            borderRadius: '50%',
            bgcolor: 'success.main',
            animation: `${ripple} 1.5s ease-out 0.5s infinite`,
          }}
        />
        {/* Check icon */}
        <CheckCircleIcon
          sx={{
            fontSize: 80,
            color: 'success.main',
            animation: `${scaleIn} 0.5s ease-out`,
            position: 'relative',
            zIndex: 1,
          }}
        />
      </Box>
      <Typography
        variant="h5"
        color="success.main"
        fontWeight="medium"
        sx={{
          animation: `${scaleIn} 0.5s ease-out 0.2s both`,
        }}
      >
        {message}
      </Typography>
    </Box>
  );
}
