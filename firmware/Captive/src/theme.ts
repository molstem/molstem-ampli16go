import { createTheme } from '@mui/material/styles';

export const getTheme = (mode: 'light' | 'dark') => createTheme({
  palette: {
    mode,
    primary: {
      main: mode === 'dark' ? '#90caf9' : '#1976d2',
      dark: mode === 'dark' ? '#42a5f5' : '#1565c0',
      light: mode === 'dark' ? '#e3f2fd' : '#42a5f5',
    },
    secondary: {
      main: mode === 'dark' ? '#ce93d8' : '#9c27b0',
      dark: mode === 'dark' ? '#ab47bc' : '#7b1fa2',
      light: mode === 'dark' ? '#f3e5f5' : '#ba68c8',
    },
    success: {
      main: mode === 'dark' ? '#66bb6a' : '#2e7d32',
      dark: mode === 'dark' ? '#4caf50' : '#1b5e20',
      light: mode === 'dark' ? '#e8f5e9' : '#4caf50',
    },
    error: {
      main: mode === 'dark' ? '#f44336' : '#d32f2f',
      dark: mode === 'dark' ? '#e53935' : '#c62828',
      light: mode === 'dark' ? '#ffebee' : '#e57373',
    },
    warning: {
      main: mode === 'dark' ? '#ffa726' : '#ed6c02',
      dark: mode === 'dark' ? '#ff9800' : '#e65100',
      light: mode === 'dark' ? '#fff3e0' : '#ffb74d',
    },
    info: {
      main: mode === 'dark' ? '#29b6f6' : '#0288d1',
      dark: mode === 'dark' ? '#03a9f4' : '#01579b',
      light: mode === 'dark' ? '#e1f5fe' : '#4fc3f7',
    },
    background: {
      default: mode === 'dark' ? '#121212' : '#fafafa',
      paper: mode === 'dark' ? '#1e1e1e' : '#ffffff',
    },
    text: {
      primary: mode === 'dark' ? 'rgba(255, 255, 255, 0.87)' : 'rgba(0, 0, 0, 0.87)',
      secondary: mode === 'dark' ? 'rgba(255, 255, 255, 0.6)' : 'rgba(0, 0, 0, 0.6)',
      disabled: mode === 'dark' ? 'rgba(255, 255, 255, 0.38)' : 'rgba(0, 0, 0, 0.38)',
    },
    divider: mode === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)',
  },
  typography: {
    fontFamily: [
      '-apple-system',
      'BlinkMacSystemFont',
      '"Segoe UI"',
      'Roboto',
      '"Helvetica Neue"',
      'Arial',
      'sans-serif',
    ].join(','),
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
        },
      },
    },
    MuiTextField: {
      defaultProps: {
        variant: 'outlined',
        size: 'small',
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
});
