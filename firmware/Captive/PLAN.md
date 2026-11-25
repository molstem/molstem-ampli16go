# molstem captive portal - Implementation Plan

## Overview

A production-quality device setup wizard for the molstem thermocycler. Built with Vite, React, TypeScript, and MUI, matching the existing webui styling. Features Zod schema validation for all API interactions.

---

## Architecture

### Tech Stack
- **Build**: Vite 5.x with React plugin
- **UI**: React 18, MUI 5.x (matching webui theme)
- **Styling**: Emotion (MUI's styling engine)
- **Validation**: Zod for schema validation + type inference
- **Markdown**: react-markdown with remark-gfm for GFM support
- **State**: React Context + useReducer (simple wizard state)
- **Testing**: Vitest + React Testing Library
- **Icons**: MUI Icons

### Project Structure

```
firmware/Captive/
├── src/
│   ├── api/
│   │   ├── client.ts              # Fetch wrapper with error handling
│   │   └── schemas.ts             # Zod schemas + inferred types
│   ├── components/
│   │   ├── Layout.tsx             # Main layout wrapper
│   │   ├── WizardStepper.tsx      # Step indicator
│   │   ├── PasswordStrengthBar.tsx
│   │   ├── WifiNetworkSelect.tsx
│   │   ├── LoadingOverlay.tsx     # Full-page spinner
│   │   ├── ErrorModal.tsx         # Error dialog with retry
│   │   └── SuccessAnimation.tsx   # Checkmark animation
│   ├── pages/
│   │   ├── WelcomePage.tsx        # Step 1
│   │   ├── SetupModePage.tsx      # Step 2 (Local/Cloud + credentials)
│   │   ├── WifiSetupPage.tsx      # Step 3
│   │   └── CompletePage.tsx       # Step 4
│   ├── content/
│   │   ├── welcome.md             # Welcome page content
│   │   ├── local-instructions.md  # Local mode completion instructions
│   │   ├── cloud-instructions.md  # Cloud mode completion instructions
│   │   └── setup-failed.md        # Disconnected state instructions
│   ├── context/
│   │   └── WizardContext.tsx      # Wizard state management
│   ├── hooks/
│   │   └── useWizard.ts           # Wizard navigation hook
│   ├── theme.ts                   # MUI theme (copied from webui)
│   ├── App.tsx
│   ├── main.tsx
│   └── vite-env.d.ts
├── public/
│   └── favicon.png                # Copied from webui
├── server/
│   └── mock-server.ts             # Express mock API server
├── tests/
│   ├── setup.ts
│   ├── pages/
│   │   ├── WelcomePage.test.tsx
│   │   ├── SetupModePage.test.tsx
│   │   ├── WifiSetupPage.test.tsx
│   │   └── CompletePage.test.tsx
│   └── api/
│       └── schemas.test.ts
├── index.html
├── vite.config.ts
├── vite.config.embed.ts           # Flat bundle config for ESP32
├── tsconfig.json
├── tsconfig.node.json
├── package.json
└── vitest.config.ts
```

---

## API Schemas (Zod)

### File: `src/api/schemas.ts`

```typescript
import { z } from 'zod';

// ============ Common ============
export const ApiSuccessSchema = z.object({
  status: z.literal('success'),
});

export const ApiErrorSchema = z.object({
  status: z.literal('error'),
  message: z.string(),
});

export const ApiResponseSchema = z.discriminatedUnion('status', [
  ApiSuccessSchema,
  ApiErrorSchema,
]);

// ============ Host Setup (Step 2) ============
export const SetupModeSchema = z.enum(['local', 'cloud']);

export const HostSetupRequestSchema = z.object({
  mode: SetupModeSchema,
  deviceName: z.string()
    .min(1, 'Device name is required')
    .max(63, 'Device name must be 63 characters or less')
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i,
      'Must be DNS-compatible: letters, numbers, hyphens; cannot start/end with hyphen'),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
});

export const HostSetupResponseSchema = ApiResponseSchema;

// ============ WiFi Scan (Step 3) ============
export const WifiNetworkSchema = z.object({
  ssid: z.string(),
  rssi: z.number(),
  secure: z.boolean(),
});

export const WifiScanResponseSchema = z.object({
  status: z.literal('success'),
  networks: z.array(WifiNetworkSchema),
});

// ============ WiFi Setup (Step 3) ============
export const WifiSetupRequestSchema = z.object({
  ssid: z.string().min(1, 'SSID is required'),
  password: z.string().optional().default(''),
  region: z.string(),
  timezone: z.string(),
});

export const WifiSetupResponseSchema = ApiResponseSchema;

// ============ Status (Step 4) ============
export const DeviceStateSchema = z.enum(['disconnected', 'local', 'cloud']);

export const StatusResponseSchema = z.object({
  status: z.literal('success'),
  state: DeviceStateSchema,
  id: z.string(), // Device serial number
  link: z.string().optional(),
  ip: z.string().optional(),
});

// ============ Commit (Step 4) ============
export const CommitResponseSchema = ApiResponseSchema;

// ============ Type Exports ============
export type ApiSuccess = z.infer<typeof ApiSuccessSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ApiResponse = z.infer<typeof ApiResponseSchema>;
export type SetupMode = z.infer<typeof SetupModeSchema>;
export type HostSetupRequest = z.infer<typeof HostSetupRequestSchema>;
export type WifiNetwork = z.infer<typeof WifiNetworkSchema>;
export type WifiScanResponse = z.infer<typeof WifiScanResponseSchema>;
export type WifiSetupRequest = z.infer<typeof WifiSetupRequestSchema>;
export type DeviceState = z.infer<typeof DeviceStateSchema>;
export type StatusResponse = z.infer<typeof StatusResponseSchema>;
```

---

## Page Specifications

### Page 1: Welcome

**Layout:**
- Centered content, responsive (mobile-first)
- molstem logo (favicon.png) at top, ~120px height
- Markdown content rendered below
- "Get Started" primary button at bottom

**Markdown Content (welcome.md):**
```markdown
# Welcome to your molstem thermocycler

The **molstem thermocycler** is a professional-grade portable PCR thermocycler designed
for point-of-care diagnostics and field research.

## Key Features

- **Rapid Thermal Cycling** — Achieve results in under 45 minutes
- **Compact Design** — Portable and battery-compatible
- **Smart Connectivity** — Local network or cloud integration
- **Real-time Monitoring** — Track amplification curves live

## Setup Wizard

This wizard will help you:

1. Configure your device identity and access credentials
2. Connect to your WiFi network
3. Complete registration for local or cloud operation

Your device will be ready to use in just a few minutes.
```

---

### Page 2: Setup Mode

**Layout:**
- Two large, clickable cards side-by-side (stack on mobile):
  - **Local Use**: Icon `HomeOutlined` or `RouterOutlined`
  - **Cloud Registration**: Icon `CloudOutlined`
- Selection highlights the card with primary color border
- Below cards:
  - Device Name field (always visible)
  - Password fields (visible only for Local mode)

**Device Name Field:**
- Label: "Device Name"
- Helper text: "Used as network hostname (e.g., molstem-lab1.local)"
- Validation: DNS-compatible regex, 1-63 chars

**Password Fields (Local mode only):**
- Two password fields with visibility toggle
- "Password" and "Confirm Password"
- Must match
- Minimum 6 characters

**Password Strength Bar:**
- 4 levels with colors:
  1. **Weak** (red): < 8 chars
  2. **Fair** (orange): 8-11 chars
  3. **Good** (yellow): 12+ chars OR has mixed case + numbers
  4. **Strong** (green): 12+ chars AND alphanumeric AND symbols
- Helper text prompts user toward strong passwords

**Card Descriptions:**
- **Local Use**: "Access your device directly on your local network. Requires setting a device password for security."
- **Cloud Registration**: "Register with molstem cloud for remote access, automatic updates, and data backup."

**Button:** "Continue" (disabled until valid)

**API Call:** POST `/api/host-setup`
- Shows spinner overlay
- On error: modal with message, dismiss to retry
- On success: proceed to Page 3

---

### Page 3: WiFi Setup

**Layout:**
- Dropdown/Autocomplete for WiFi networks
- Password field (shown if network is secure or "Other")
- Region dropdown (auto-detected, editable)
- Timezone dropdown (auto-detected, editable)
- "Configure WiFi" button

**WiFi Dropdown:**
- Populated from GET `/api/wifi-scan`
- Shows SSID + signal strength indicator (based on RSSI)
- Lock icon for secured networks
- "Other network..." option at bottom → shows SSID text field

**Region/Timezone:**
- Auto-populated from browser: `Intl.DateTimeFormat().resolvedOptions()`
- Region: Country code dropdown (ISO 3166-1 alpha-2)
- Timezone: Full IANA timezone string

**Button:** "Configure WiFi"

**API Call:** POST `/api/wifi-setup` (timeout: 240s)
- Full-page spinner with "Connecting to WiFi..."
- On success:
  - Replace spinner with success animation (green checkmark with ripple)
  - Hold for 3 seconds
  - Proceed to Page 4
- On error:
  - Modal with error message
  - Dismiss to return to form for retry

---

### Page 4: Complete

**Initial Action:** GET `/api/status`, then POST `/api/commit`

**Layout varies by state:**

#### State: `local`
- Success icon
- "Setup Complete!" heading
- Device serial number displayed
- Two access links:
  - mDNS: `http://<deviceName>.local`
  - IP: `http://<ip>`
- Markdown instructions (local-instructions.md)

```markdown
## Your Device is Ready

You can now access your molstem thermocycler from any browser on your local network.

### Quick Access

Click either link above to open the device interface. The `.local` address
uses mDNS and works on most networks. If it doesn't resolve, use the IP address.

### What's Next?

1. Open the device interface
2. Connect via USB or network
3. Load your PCR protocol
4. Begin your experiment

For documentation and support, visit [molstem.com/docs](https://molstem.com/docs)
```

#### State: `cloud`
- Success icon
- "Setup Complete!" heading
- Device serial number
- Cloud enrollment ID displayed prominently
- Markdown instructions (cloud-instructions.md)

```markdown
## Cloud Registration Required

Your device is configured for cloud operation. Complete registration to enable
remote access and cloud features.

### Complete Registration

1. Visit [app.molstem.com/devices](https://app.molstem.com/devices)
2. Sign in or create an account
3. Click "Add Device"
4. Enter your enrollment ID shown above

### Cloud Features

- **Remote Access** — Monitor experiments from anywhere
- **Data Sync** — Automatic backup of all results
- **Fleet Management** — Manage multiple devices
- **OTA Updates** — Automatic firmware updates

Your device will appear in your dashboard within minutes of registration.
```

#### State: `disconnected`
- Warning icon
- "Setup Incomplete" heading
- Device serial number
- Markdown (setup-failed.md)
- "Restart Wizard" button → goes to Page 1

```markdown
## Connection Failed

Your device could not establish a network connection. This may be due to:

- Incorrect WiFi password
- Network out of range
- Router configuration issues

### Troubleshooting

1. Verify your WiFi credentials are correct
2. Move closer to your WiFi router
3. Check that your router allows new devices
4. Try a different WiFi network

Click **Restart Wizard** below to try again.
```

---

## Component Specifications

### PasswordStrengthBar

```typescript
interface PasswordStrengthBarProps {
  password: string;
}

// Returns level 0-4 based on:
// 0: empty
// 1: < 8 chars (Weak)
// 2: 8-11 chars (Fair)
// 3: 12+ chars OR (8+ with mixed case + numbers) (Good)
// 4: 12+ chars AND has uppercase AND lowercase AND numbers AND symbols (Strong)
```

Visual: 4-segment horizontal bar, filled segments colored by level.

### WifiNetworkSelect

- Uses MUI Autocomplete
- Custom option rendering with signal bars + lock icon
- "Other network..." as last option
- Manages internal state for custom SSID input

### LoadingOverlay

- Full viewport backdrop (semi-transparent)
- Centered CircularProgress
- Optional text message below spinner
- Prevents all interaction

### SuccessAnimation

- CSS keyframe animation
- Green checkmark that scales in
- Ripple effect emanating outward
- 3-4 second display duration

### ErrorModal

- MUI Dialog
- Error icon + title
- Message body from API
- Single "Dismiss" button
- onDismiss callback for retry logic

---

## Wizard State Management

```typescript
interface WizardState {
  currentStep: number; // 0-3

  // Step 2 data
  setupMode: 'local' | 'cloud' | null;
  deviceName: string;
  password: string;

  // Step 3 data
  selectedNetwork: WifiNetwork | null;
  customSsid: string;
  wifiPassword: string;
  region: string;
  timezone: string;

  // Step 4 data
  deviceStatus: StatusResponse | null;
}

type WizardAction =
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'GOTO_STEP'; step: number }
  | { type: 'SET_SETUP_MODE'; mode: 'local' | 'cloud' }
  | { type: 'SET_DEVICE_NAME'; name: string }
  | { type: 'SET_PASSWORD'; password: string }
  | { type: 'SET_NETWORK'; network: WifiNetwork | null }
  | { type: 'SET_CUSTOM_SSID'; ssid: string }
  | { type: 'SET_WIFI_PASSWORD'; password: string }
  | { type: 'SET_REGION'; region: string }
  | { type: 'SET_TIMEZONE'; timezone: string }
  | { type: 'SET_STATUS'; status: StatusResponse }
  | { type: 'RESET' };
```

---

## Build Configurations

### Development (vite.config.ts)

```typescript
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
  },
});
```

### Embedded Build (vite.config.embed.ts)

For ESP32 embedding - flat files, no hashes, minimal size:

```typescript
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist-embed',
    assetsDir: '', // Flat structure
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name][extname]',
      },
    },
    // Inline assets under 10KB
    assetsInlineLimit: 10240,
    // Minify for size
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
      },
    },
  },
});
```

Output structure:
```
dist-embed/
├── index.html
├── app.js
├── app.css
└── favicon.png
```

---

## Mock Server

Express server for development testing:

```typescript
// server/mock-server.ts
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// Simulated state
let setupComplete = false;
let wifiConnected = false;
let setupMode: 'local' | 'cloud' = 'local';

// GET /api/wifi-scan
app.get('/api/wifi-scan', (req, res) => {
  res.json({
    status: 'success',
    networks: [
      { ssid: 'LabNetwork-5G', rssi: -45, secure: true },
      { ssid: 'LabNetwork-2.4G', rssi: -52, secure: true },
      { ssid: 'Guest-WiFi', rssi: -68, secure: false },
      { ssid: 'Neighbor-Network', rssi: -78, secure: true },
    ],
  });
});

// POST /api/host-setup
app.post('/api/host-setup', (req, res) => {
  const { mode, deviceName, password } = req.body;

  // Simulate validation
  if (mode === 'local' && (!password || password.length < 6)) {
    return res.json({ status: 'error', message: 'Password must be at least 6 characters' });
  }

  setupMode = mode;
  setupComplete = true;
  res.json({ status: 'success' });
});

// POST /api/wifi-setup
app.post('/api/wifi-setup', async (req, res) => {
  const { ssid, password } = req.body;

  // Simulate connection delay
  await new Promise(r => setTimeout(r, 3000));

  // Simulate occasional failure
  if (ssid === 'fail-test') {
    return res.json({ status: 'error', message: 'Authentication failed. Please check password.' });
  }

  wifiConnected = true;
  res.json({ status: 'success' });
});

// GET /api/status
app.get('/api/status', (req, res) => {
  if (!wifiConnected) {
    return res.json({
      status: 'success',
      state: 'disconnected',
      id: 'MOLSTEM-2024-001234',
    });
  }

  res.json({
    status: 'success',
    state: setupMode,
    id: 'MOLSTEM-2024-001234',
    link: setupMode === 'local' ? 'http://molstem-device.local' : 'ENROLL-ABCD-1234-EFGH',
    ip: '192.168.1.105',
  });
});

// POST /api/commit
app.post('/api/commit', (req, res) => {
  res.json({ status: 'success' });
});

app.listen(3001, () => {
  console.log('Mock server running on http://localhost:3001');
});
```

---

## Package Scripts

```json
{
  "scripts": {
    "dev": "vite",
    "dev:mock": "concurrently \"npm run mock\" \"npm run dev\"",
    "dev:hw": "VITE_API_TARGET=http://192.168.4.1 vite",
    "build": "tsc && vite build",
    "build:embed": "tsc && vite build --config vite.config.embed.ts",
    "preview": "vite preview",
    "mock": "tsx server/mock-server.ts",
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "lint": "eslint . --ext ts,tsx --report-unused-disable-directives --max-warnings 0"
  }
}
```

---

## Testing Strategy

### Unit Tests

1. **Schema validation tests** (`tests/api/schemas.test.ts`)
   - Valid data passes
   - Invalid data fails with correct errors
   - Type inference works correctly

2. **Component tests**
   - PasswordStrengthBar: all strength levels
   - WifiNetworkSelect: selection, custom SSID
   - ErrorModal: display, dismiss callback

### Integration Tests

1. **Page flow tests**
   - Welcome → Get Started → Page 2
   - Setup Mode validation
   - WiFi form validation
   - Complete page state rendering

2. **API interaction tests** (mocked)
   - Success flows
   - Error handling
   - Retry logic

### E2E Considerations

- Manual testing against mock server
- Manual testing against real hardware (192.168.4.1)

---

## Dependencies

```json
{
  "dependencies": {
    "@emotion/react": "^11.11.0",
    "@emotion/styled": "^11.11.0",
    "@mui/icons-material": "^5.15.0",
    "@mui/material": "^5.15.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-markdown": "^9.0.0",
    "remark-gfm": "^4.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^14.2.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.2.0",
    "concurrently": "^8.2.0",
    "cors": "^2.8.0",
    "express": "^4.18.0",
    "jsdom": "^24.0.0",
    "tsx": "^4.7.0",
    "typescript": "^5.4.0",
    "vite": "^5.2.0",
    "vitest": "^1.4.0"
  }
}
```

---

## Responsive Design

### Breakpoints

- **xs** (0-599px): Mobile portrait - single column, stacked cards
- **sm** (600-899px): Mobile landscape / small tablet - still single column
- **md** (900px+): Desktop - side-by-side cards, wider forms

### Key Responsive Behaviors

1. **Welcome Page**: Logo scales down on mobile, text remains readable
2. **Setup Mode Cards**: Stack vertically on mobile, side-by-side on desktop
3. **Form Fields**: Full width on mobile, max-width 400px on desktop
4. **Buttons**: Full width on mobile, auto width on desktop

---

## Accessibility

- All form fields have proper labels
- Error messages announced to screen readers
- Focus management on page transitions
- Keyboard navigation for all interactive elements
- Sufficient color contrast (follows MUI defaults)
- Loading states announced via aria-live regions

---

## Security Considerations

1. **Password handling**: Never logged, cleared on component unmount
2. **Input validation**: Zod schemas validate all inputs before API calls
3. **API responses**: Validated against schemas before processing
4. **No sensitive data in localStorage**: Wizard state is in-memory only
5. **HTTPS ready**: No hardcoded HTTP URLs (except for local mDNS)

---

## Implementation Order

1. Project scaffolding (Vite, TypeScript, dependencies)
2. Theme setup (copy from webui)
3. Zod schemas and API client
4. Wizard context and state management
5. Shared components (Layout, LoadingOverlay, ErrorModal, etc.)
6. Page 1: Welcome
7. Page 2: Setup Mode (most complex)
8. Page 3: WiFi Setup
9. Page 4: Complete
10. Mock server
11. Tests
12. Embed build configuration
13. Final polish and testing

---

## Open Questions / Decisions Needed

1. **Region format**: Should this be ISO country code, or full region name?
   - **Proposal**: ISO 3166-1 alpha-2 codes (US, GB, DE, etc.)

2. **Timezone source**: Use browser's timezone or provide a searchable list?
   - **Proposal**: Default to browser timezone, allow selection from IANA list

3. **Password policy for Cloud mode**: Should cloud mode also require a local password?
   - **Proposal**: No local password for cloud mode (authentication handled by cloud)

4. **mDNS suffix**: Is `.local` always the suffix, or configurable?
   - **Proposal**: Always `.local` per mDNS standard

5. **ESP32 embedding**: Do you need gzip pre-compression for the embed build?
   - **Proposal**: Yes, add gzip compression to minimize flash usage

6. **Offline fallback**: Should there be any offline functionality?
   - **Proposal**: No - this is a setup wizard that requires network

---

## File Size Targets (Embedded Build)

Target total size under 200KB compressed:
- HTML: ~2KB
- JS (minified + gzipped): ~150KB
- CSS (minified + gzipped): ~15KB
- Favicon: ~10KB (or inline as base64)

Optimization strategies:
- Tree-shaking unused MUI components
- Dynamic imports if needed
- Terser compression
- Gzip pre-compression

---

*Plan created for molstem captive portal v1.0*
