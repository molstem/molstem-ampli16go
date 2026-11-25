import { useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from '@mui/material/styles';
import { Box, CssBaseline } from '@mui/material';
import { getTheme } from './theme';
import { AppHeader } from './components/AppHeader';
import { DevicesPage } from './pages/DevicesPage';
import { DocsPage } from './pages/DocsPage';
import { DiagnosticsPage } from './pages/DiagnosticsPage';
import { MainView } from './views/MainView';
import { installUnexpectedDisconnectWatcher } from './services/connectionActions';
import { parseRoute, useRoute } from './routes';

const DARK_MODE_KEY = 'dark-mode';

function loadDarkMode(): boolean {
  try {
    const saved = localStorage.getItem(DARK_MODE_KEY);
    if (saved !== null) return saved === 'true';
  } catch (error) {
    console.error('Failed to load dark mode:', error);
  }
  return true;
}

function App() {
  const { route, navigate } = useRoute();
  const [darkMode, setDarkMode] = useState<boolean>(loadDarkMode);
  const theme = useMemo(() => getTheme(darkMode ? 'dark' : 'light'), [darkMode]);

  const toggleDarkMode = () => {
    setDarkMode((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(DARK_MODE_KEY, String(next));
      } catch (error) {
        console.error('Failed to save dark mode:', error);
      }
      return next;
    });
  };

  // USB unplugged / cloud device went away
  useEffect(() => installUnexpectedDisconnectWatcher(), []);

  if (route === '/devices') {
    return (
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <DevicesPage darkMode={darkMode} onToggleDarkMode={toggleDarkMode} onNavigate={(path) => navigate(parseRoute(path))} />
      </ThemeProvider>
    );
  }

  let content: React.ReactNode;
  switch (route) {
    case '/docs':
      content = <DocsPage />;
      break;
    case '/hw-monitor':
      content = <DiagnosticsPage panel="hw-monitor" onNavigate={navigate} />;
      break;
    case '/serial':
      content = <DiagnosticsPage panel="serial" onNavigate={navigate} />;
      break;
    case '/log':
      content = <DiagnosticsPage panel="log" onNavigate={navigate} />;
      break;
    default:
      content = <MainView onNavigate={navigate} />;
  }

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        sx={{
          height: '100vh',
          // Mobile browsers: exclude the dynamic address bar where supported
          '@supports (height: 100dvh)': { height: '100dvh' },
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.default',
          overflow: 'hidden',
        }}
      >
        <AppHeader darkMode={darkMode} onToggleDarkMode={toggleDarkMode} route={route} onNavigate={navigate} />
        <Box component="main" sx={{ flex: 1, minHeight: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch' }}>
          {content}
        </Box>
      </Box>
    </ThemeProvider>
  );
}

export default App;
