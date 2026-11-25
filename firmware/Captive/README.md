# molstem captive portal

A production-quality device setup wizard for the molstem thermocycler. Built with Vite, React, TypeScript, and MUI.

## Features

- 4-step setup wizard (Welcome → Device Setup → WiFi → Complete)
- Local or Cloud mode selection
- Password strength indicator with 4 levels
- WiFi network scanning and selection
- Region/timezone auto-detection
- Zod schema validation for all API interactions
- Responsive design (mobile/desktop)
- Dark/light mode based on system preference

## Development

### Prerequisites

- Node.js 18+
- npm

### Install Dependencies

```bash
npm install
```

### Development with Mock Server

```bash
npm run dev:mock
```

This starts both the Vite dev server (http://localhost:5173) and the mock API server (http://localhost:3001).

### Development against Real Hardware

```bash
npm run dev:hw
```

This proxies API requests to `http://192.168.4.1` (the ESP32 AP default).

### Run Tests

```bash
npm test
```

### Production Build

```bash
npm run build
```

Output is in `dist/`.

### Embedded Build (for ESP32)

```bash
npm run build:embed
```

Output is in `dist-embed/` with:
- Flat file structure (no hashed filenames)
- Gzip pre-compressed assets (`.gz` files)
- Console statements stripped
- Optimized for minimal size

## Project Structure

```
src/
├── api/           # API client and Zod schemas
├── components/    # Reusable UI components
├── content/       # Markdown content files
├── context/       # React context (wizard state)
├── pages/         # Wizard pages
├── theme.ts       # MUI theme
├── App.tsx        # Main app with router
└── main.tsx       # Entry point

server/            # Mock API server
tests/             # Unit and integration tests
scripts/           # Build scripts (gzip compression)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/wifi-scan` | GET | Returns list of available WiFi networks |
| `/api/host-setup` | POST | Configure device mode and credentials |
| `/api/wifi-setup` | POST | Connect to WiFi network (240s timeout) |
| `/api/status` | GET | Get current device status |
| `/api/commit` | POST | Finalize setup and turn off AP |

## Mock Server Test Scenarios

- Include `fail` in device name → triggers setup error
- Include `fail` in SSID → triggers WiFi connection error
- Use `wrongpassword` as WiFi password → triggers authentication error
- POST `/api/reset` → resets device state for fresh testing

## Building for ESP32

The `build:embed` script produces files optimized for embedding in ESP32 firmware:

1. All files use fixed names (no content hashes)
2. JavaScript is minified with Terser
3. All assets are gzip compressed with level 9
4. Console statements are stripped

Expected output size: ~150-200KB compressed.

## License

Proprietary - molstem
