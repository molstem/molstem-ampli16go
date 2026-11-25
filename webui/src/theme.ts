import { createTheme } from '@mui/material/styles';

/**
 * molstem brand palette (mirrors molstem.com/src/styles/global.css).
 * Dark, quiet, bioluminescent: one teal accent, Instrument Serif for the wordmark,
 * Inter for UI text, JetBrains Mono for data.
 */
export const brand = {
  ink: '#070a0c',
  ink2: '#0b1013',
  ink3: '#111a1e',
  bone: '#ece8df',
  bone2: '#b9b5ab',
  bone3: '#6f6d66',
  teal: '#5fe3c8',
  tealDim: '#2f8f80',
  tealDeep: '#1f6b60',
  tealGlow: 'rgba(95, 227, 200, 0.18)',
  lineDark: 'rgba(236, 232, 223, 0.09)',
  lineLight: 'rgba(7, 10, 12, 0.10)',
} as const;

export const fonts = {
  serif: "'Instrument Serif', Georgia, 'Times New Roman', serif",
  sans: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

export const getTheme = (mode: 'light' | 'dark') => {
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: {
        // Teal reads well on ink; on a light ground use the dimmer teal for contrast.
        main: dark ? brand.teal : brand.tealDim,
        dark: dark ? brand.tealDim : brand.tealDeep,
        light: dark ? '#a3f0df' : brand.teal,
        contrastText: dark ? brand.ink : '#ffffff',
      },
      secondary: {
        main: dark ? brand.bone2 : brand.bone3,
        dark: dark ? brand.bone3 : '#4f4d47',
        light: dark ? brand.bone : brand.bone2,
        contrastText: dark ? brand.ink : '#ffffff',
      },
      success: {
        main: dark ? brand.teal : brand.tealDim,
        dark: dark ? brand.tealDim : brand.tealDeep,
        light: dark ? '#a3f0df' : brand.teal,
        contrastText: dark ? brand.ink : '#ffffff',
      },
      error: {
        main: dark ? '#ff7a6e' : '#c0392b',
        dark: dark ? '#e0574b' : '#96281b',
        light: dark ? '#ffb3ab' : '#e57368',
      },
      warning: {
        main: dark ? '#f0c060' : '#b8860b',
        dark: dark ? '#d3a33f' : '#8a6508',
        light: dark ? '#f7dc9a' : '#d9a93a',
      },
      info: {
        main: dark ? '#8fd3f4' : '#2a7fa8',
        dark: dark ? '#5fb8e0' : '#1f5f7e',
        light: dark ? '#c4e8f9' : '#6fb3d3',
      },
      background: {
        default: dark ? brand.ink : '#f6f4ef',
        paper: dark ? brand.ink2 : '#ffffff',
      },
      text: {
        primary: dark ? brand.bone : brand.ink,
        secondary: dark ? brand.bone2 : '#4f4d47',
        disabled: dark ? brand.bone3 : '#9a978f',
      },
      divider: dark ? brand.lineDark : brand.lineLight,
    },
    shape: {
      borderRadius: 4,
    },
    typography: {
      fontFamily: fonts.sans,
      h1: { fontFamily: fonts.serif, fontWeight: 400 },
      h2: { fontFamily: fonts.serif, fontWeight: 400 },
      h3: { fontFamily: fonts.serif, fontWeight: 400 },
      h4: { fontFamily: fonts.serif, fontWeight: 400 },
      h5: { fontFamily: fonts.serif, fontWeight: 400 },
      h6: { fontFamily: fonts.serif, fontWeight: 400, letterSpacing: '0.01em' },
      overline: {
        fontFamily: fonts.mono,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
      },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          '::selection': { background: brand.teal, color: brand.ink },
          body: dark
            ? {
                backgroundImage:
                  'radial-gradient(1200px 700px at 70% -10%, rgba(95, 227, 200, 0.07), transparent 60%),' +
                  'radial-gradient(900px 600px at 10% 110%, rgba(95, 227, 200, 0.05), transparent 60%)',
                backgroundAttachment: 'fixed',
              }
            : {},
        },
      },
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 500,
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
      MuiChip: {
        styleOverrides: {
          root: { borderRadius: 4 },
        },
      },
    },
  });
};
