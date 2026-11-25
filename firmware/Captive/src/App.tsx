import { useMemo } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider, CssBaseline, useMediaQuery } from '@mui/material';
import { getTheme } from './theme';
import { WizardProvider } from './context/WizardContext';
import { WelcomePage, SetupModePage, WifiSetupPage, CompletePage } from './pages';

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<WelcomePage />} />
      <Route path="/setup" element={<SetupModePage />} />
      <Route path="/wifi" element={<WifiSetupPage />} />
      <Route path="/complete" element={<CompletePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  // Use system preference for dark mode
  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = useMemo(() => getTheme(prefersDarkMode ? 'dark' : 'light'), [prefersDarkMode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <HashRouter>
        <WizardProvider>
          <AppRoutes />
        </WizardProvider>
      </HashRouter>
    </ThemeProvider>
  );
}

export default App;
