# molstem thermocycler web application

A modern web-based PCR (Polymerase Chain Reaction) control interface built with React, TypeScript, Material-UI, and Web Serial API.

## Features

- **Device Communication**: Web Serial (USB), local WebSocket (embedded build) or the app.molstem.com cloud proxy, all speaking the same SCPI-style line protocol
- **Firmware Update**: Upload `.fwu` images to the STM32 bootloader (`BOOT:DATA`, pipelined)
- **Bio protocols**: A browser-side library of 5-stage protocols; start, watch and stop runs on the device
- **Real-time Temperature Monitoring**: Whole-run plot of Peltier and lid temperature
- **Mobile friendly**: Single-column, state-driven UI; cloud connection works on phones

## Technology Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Material-UI (MUI)** - Component library
- **Zustand** - State management
- **uPlot** - Temperature plotting
- **Vite** - Build tool
- **Web Serial API** - Device communication

## Prerequisites

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **Compatible Browser**: Chrome, Edge, or Opera (Web Serial API support required)
  - Firefox and Safari do NOT support Web Serial API

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd PCR-GUI
```

2. Install dependencies:
```bash
npm install
```

## Development

Start the development server:
```bash
npm run dev
```

The application will open at `http://localhost:3000`

## Building for Production

Build the application:
```bash
npm run build
```

Preview the production build:
```bash
npm run preview
```

## Usage

The main page follows the device. There is no layout to arrange: what you see is
decided by the connection and device state.

| State | Main view |
|---|---|
| Not connected | Connect: USB (Chrome/Edge desktop), this device (embedded build), or a cloud device after Google sign-in |
| Connected, identifying | "Connecting…" spinner with Cancel |
| Bootloader | Firmware update |
| Provisioning | Message; disconnect and finish provisioning on the device |
| Application, BUSY | "Device busy" (finish the dialog on the device) |
| Application, RUNNING | Live run info, whole-run temperature plot, Stop |
| Application, IDLE | "Start bio protocol" → protocol library → form → confirm |

### 1. Connection

1. Open the app. With exactly one previously granted USB port (or in the embedded build) it connects on its own.
2. Otherwise click **Connect over USB**, or sign in and pick a cloud device.
3. The header shows the device mode (Application / Bootloader) and state (IDLE / RUNNING / BUSY); the USB-off icon disconnects.

### 2. Running a bio protocol

1. With the device idle, click **Start bio protocol**.
2. Pick a saved protocol, or **Add new protocol** (the form opens directly when the library is empty). Protocols are stored in the browser (`localStorage` key `molstem-protocols`) and can be edited or deleted from the list.
3. The form takes a name, the cycle count and, per stage (intro denaturing, denaturing, annealing, extension, final extension), temperature in °C and time in seconds. Limits match the firmware (20–100 °C; intro 10–600 s, denaturing 1–60 s, annealing 5–60 s, extension 1–300 s, final 10–300 s; 1–50 cycles).
4. **Save and start** (or selecting a protocol) opens the confirmation screen with an optional comment that is sent to the device with the run.
5. **Start protocol** sends `PROT:STAR`; the view switches to the running screen. **Stop protocol** (with confirmation) sends `PROT:STOP`.

### 3. Firmware update

1. On the device, choose **Firmware update** from the menu (enters the bootloader), then reconnect
2. Click **"Browse"** to select a `.fwu` firmware file
3. Click **"Start Update"** to begin the transfer
4. Monitor progress in the progress bar
5. Wait for "Update complete, device rebooting"

### 4. Documentation and diagnostics pages

- **Documentation** in the header opens `/docs` (full page).
- Service pages, not linked from the UI: `/hw-monitor` (hardware monitor, USB only), `/serial` (SCPI console), `/log` (app log). They show the connect view when no device is connected.

## Device Protocol

The device speaks one SCPI-style, line-based request/response protocol on every
transport (USB CDC via Web Serial, the local `/ws` WebSocket of the embedded build,
and the cloud device socket). The full command reference lives in
[`docs/serial-api.md`](../docs/serial-api.md).

Key points:

- Every request line (`*IDN?`, `STAT?`, `PROT:CYCL?`, …) gets exactly one reply
  line: data, `OK` / `OK <n>`, or `ERR <code>,"<message>"`.
- Nothing is streamed unsolicited; the UI polls.
- Requests may be pipelined; replies come back in order.

### SCPI client (`src/services/scpiClient.ts`)

All traffic goes through `scpiClient`. It splits incoming bytes into lines, keeps
a FIFO of pending requests and matches replies in order:

- `send(line, timeoutMs)` → raw reply line
- `query(line)` → data line, rejects with `ScpiError {code, msg}` on `ERR`
- `command(line)` → resolves on `OK…`, rejects otherwise
- `sendBatch(lines[], timeouts)` → one write, one promise per line (pipelining)
- `onUnsolicited(cb)` → lines that arrive with nothing pending (shown in the SCPI console at `/serial`)

The pending FIFO is reset (promises rejected) on disconnect. Never write to the
connection directly; that would desynchronise request/reply matching.

### Device poller (`src/services/devicePoller.ts`, `src/stores/telemetryStore.ts`)

The poller starts on connect, identifies the device with `*IDN?` (`thermocycler`
→ application, `thermocycler-bootloader` → bootloader, `thermocycler-provisioning`
→ provisioning) and, in application mode, polls at a cadence chosen by transport:

| Transport | `HW?` | `STAT?` | `PROT:CYCL?` |
|---|---|---|---|
| USB | every 200 ms | every 1 s | every 1 s while RUNNING |
| Local WebSocket | never (`HW?` is USB-only) | every 1 s | every 1 s while RUNNING |
| Cloud | never (also no `LCD?` / `INP:*`) | every 60 s while not RUNNING | every 1 s while RUNNING |

Parsed replies land in the telemetry store (`deviceMode`, `identity`, `state`,
`cycle`, `hw`) together with rolling histories that feed the plots: the whole-run
temperature plot on the running screen and the hardware monitor at `/hw-monitor`
(`HW?` samples, USB only). Temperatures come from `HW?` (`pelt_t`/`lid_t`) when
available and from `PROT:CYCL?` otherwise. A Refresh button in the header (and on
the "Device busy" screen) forces an immediate status round on the slow cloud cadence.

### Starting a protocol

`src/services/protocolCommands.ts` validates the saved protocol against the
firmware limits and builds

```
PROT:STAR "<name>","<comment>",<cycles>,<introT>,<introS>,<denT>,<denS>,<annT>,<annS>,<extT>,<extS>,<finT>,<finS>
```

which the confirmation screen sends with `scpiClient.command`; **Stop** sends
`PROT:STOP`. Device errors are shown on the screen and in the log at `/log` as
`ERR <code> "<message>"` (200 = not idle, 104 = out of range).

### Firmware update

With the device in the bootloader (device menu → Firmware update, then reconnect),
the firmware update view streams the `.fwu` file verbatim as `BOOT:DATA <hex>`
lines of 512 bytes, pipelined in groups of 32 with at most 256 in flight. Progress
is the byte count acknowledged by `OK <n>`. The first line and the lines around
byte `10 + 0xA000` use a 60 s timeout (ESP32 slice erase), the rest 5 s. After the
last `OK` the panel polls `BOOT:STAT?` until `DONE`; on `ERR` it shows the code and
message and offers `*RST` to start over.

## Browser Compatibility

| Browser | Support | Notes |
|---------|---------|-------|
| Chrome  | ✅ Yes  | Recommended |
| Edge    | ✅ Yes  | Recommended |
| Opera   | ✅ Yes  | Full support |
| Firefox | ❌ No   | Web Serial API not supported |
| Safari  | ❌ No   | Web Serial API not supported |

## Security Requirements

- **HTTPS required** in production environments
- **localhost** allowed for development
- User must manually grant serial port permissions


## License

MIT License

Copyright (c) 2025 molstem

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


## Acknowledgments

Based on the original molstem Python application.
