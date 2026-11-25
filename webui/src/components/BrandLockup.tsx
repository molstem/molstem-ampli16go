import React from 'react';
import { Box, Typography } from '@mui/material';
import markUrl from '../assets/molstem-mark.svg';
import { fonts } from '../theme';

interface BrandLockupProps {
  /** Small mono label rendered after the wordmark (e.g. "thermocycler", "devices") */
  label?: string;
  size?: number;
}

/**
 * molstem brand lockup: helix mark + serif wordmark, matching molstem.com.
 */
export const BrandLockup: React.FC<BrandLockupProps> = ({ label = 'thermocycler', size = 32 }) => (
  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
    <Box
      component="img"
      src={markUrl}
      alt="molstem"
      sx={{ height: size, width: size, flexShrink: 0 }}
    />
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, whiteSpace: 'nowrap' }}>
      <Typography
        component="span"
        sx={{
          fontFamily: fonts.serif,
          fontSize: '1.5rem',
          lineHeight: 1,
          letterSpacing: '0.01em',
          color: 'text.primary',
        }}
      >
        molstem
      </Typography>
      {label && (
        <Typography
          component="span"
          sx={{
            fontFamily: fonts.mono,
            fontSize: '0.68rem',
            letterSpacing: '0.16em',
            textTransform: 'uppercase',
            color: 'text.secondary',
            display: { xs: 'none', sm: 'inline' },
          }}
        >
          {label}
        </Typography>
      )}
    </Box>
  </Box>
);
