import { ReactNode } from 'react';
import { Box, Container, Paper, useMediaQuery, useTheme } from '@mui/material';

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Box
      sx={{
        minHeight: { xs: 'auto', sm: '100vh' },
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        py: { xs: 0, sm: 2 },
        px: { xs: 0, sm: 1 },
      }}
    >
      {isSmallScreen ? (
        <Box sx={{ p: 2, width: '100%' }}>
          {children}
        </Box>
      ) : (
        <Container maxWidth="sm">
          <Paper
            elevation={3}
            sx={{
              p: { sm: 3, md: 4 },
              borderRadius: 2,
            }}
          >
            {children}
          </Paper>
        </Container>
      )}
    </Box>
  );
}
