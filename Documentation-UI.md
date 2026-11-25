# molstem thermocycler documentation

## Overview

The molstem web UI is a modern, browser-based control interface for the molstem thermocycler. Built with React, TypeScript, and Material-UI, it provides real-time monitoring, PCR protocol configuration, firmware management, and comprehensive diagnostics through a flexible dockable panel layout.

## System Requirements

### Browser Compatibility
- **Supported Browsers**: Chrome, Edge, Opera (browsers with Web Serial API support)
- **Required APIs**:
  - Web Serial API (for device communication)
  - localStorage (for layout persistence)
  - File System Access API (optional, for enhanced file saving)

### Device Requirements
- molstem thermocycler with USB serial connection
- Firmware speaking the request/response serial protocol (see [docs/serial-api.md](docs/serial-api.md))

## Technology Stack

- **Framework**: React 18.3.1 with TypeScript 5.4.5
- **Build Tool**: Vite 5.2.12
- **UI Library**: Material-UI (MUI) 5.15.19
- **Layout**: Dockview 4.9.0 (dockable panel system)
- **Charting**: Recharts 2.12.7
- **State Management**: Zustand 4.5.2
- **Desktop**: Electron 28.0.0 (for standalone app)

## Getting Started

### First-Time Connection

1. **Launch the Application**
   - Open the web UI in a supported browser, or
   - Launch the Electron desktop application

2. **Connect to Device**
   - The Connection Modal will appear automatically
   - Click "Connect" to trigger the browser's serial port selection dialog
   - Select your molstem thermocycler from the list
   - The application will establish connection at 115200 baud (default)

3. **Connection Status**
   - Green indicator: Successfully connected
   - Red indicator: Connection error or disconnected
   - Status message appears in the header

## User Interface Layout

### Dockview Panel System

The UI uses a flexible dockable panel layout that allows you to:
- **Drag panels** to reposition them
- **Resize panels** by dragging borders
- **Create tabs** by dragging panels onto each other
- **Restore default layout** using the "Reset Layout" button in the header

### Default Layout

The default layout is organized as follows:

**Right Column (Top Tabs)**:
- Documentation
- Temperature Plot (full history)
- Realtime Temperature Plot (60-second window)

**Right Column (Bottom Tabs)**:
- PCR Settings
- Log Display
- Firmware Update

**Additional Panel**:
- Serial I/O (raw serial monitor)

### Header Controls

- **molstem logo**: Application branding
- **Reset Layout**: Restores the default panel arrangement
- **Downloads**: Link to download resources
- **Disconnect**: Closes the serial connection (enabled when connected)
- **Status Indicator**: Shows connection status with color coding
- **Theme Toggle**: Switch between dark and light modes

## Main Features

### 1. PCR Settings

Configure your PCR protocol with up to 5 stages:

#### Available Stages
1. **Intro Denaturing**: Initial denaturation step
2. **Denaturing**: Cycling denaturation step
3. **Annealing**: Primer annealing step
4. **Extension**: DNA extension step
5. **Final Extension**: Final extension step

#### Configuration Parameters
- **Temperature**: Target temperature in °C
- **Time**: Duration in seconds
- **Cycles**: Number of repetitions for this stage

#### Actions
- **Save Protocol**: Export protocol to CSV file
  - Format: `Stage, Temperature, TimeSec, Cycles`
  - Uses File System Access API when available, falls back to download
- **Drive Selection**: Choose storage location (currently "Download")
- **Clear**: Reset all fields to defaults

#### Usage Tips
- Fill in only the stages you need (empty stages are ignored)
- Temperature range typically: 50-95°C
- Cycle count is per-stage (not total)
- Save your protocols for reuse in future experiments

### 2. Temperature Monitoring

Two complementary views for temperature tracking:

#### Temperature Plot (Full History)
- **Purpose**: View complete temperature history since connection
- **Data Displayed**:
  - Peltier Temperature (blue line)
  - Lid Temperature (red line)
- **Features**:
  - Dynamic Y-axis scaling based on temperature range
  - Time-based X-axis
  - Hover for exact values
  - Full history retention

#### Realtime Temperature Plot (60-second Window)
- **Purpose**: Monitor current temperature trends
- **Data Displayed**: Last 60 data points
- **Use Cases**:
  - Verify system is reaching target temperature
  - Monitor temperature stability
  - Observe cycling patterns during PCR

#### Data Source
The device never streams data on its own. Temperature samples come from the
UI polling the device (see [Polling](#polling)): over USB the `HW?` reply
supplies `pelt_t` / `lid_t` (and their setpoints) at 5 Hz; over the cloud
socket the `PROT:CYCL?` reply supplies the Peltier and lid temperatures once
per second while a run is in progress.

### 3. Firmware Update

Update your molstem thermocycler firmware safely and efficiently.

#### Supported File Format
- **Firmware update package** (`.fwu`): produced by `firmware/tools/make_fwu.py`.
  The file starts with the `molstemfw1` cookie and is uploaded verbatim; the
  bootloader validates it and flashes the ESP32 and STM32 images it contains.

#### Upload Process
1. **Enter the bootloader**: choose *Firmware update* from the device menu.
2. **Detect the device**: the UI sends `*IDN?` and expects the model field to
   be `thermocycler-bootloader`. If it reports `thermocycler` the application
   is still running; go back to step 1.
3. **Select File**: Click "Choose File" and select the `.fwu` image.
4. **Transfer**: the file is sent as hex-encoded `BOOT:DATA <hex>` lines,
   512 bytes (1024 hex characters) per line. The device acknowledges every line
   with `OK <bytes_total>`; up to 256 lines may be in flight.
5. **Progress Tracking**: progress is derived from the acknowledged byte count
   (and can be cross-checked with `BOOT:STAT?`).
6. **Completion**: after the last `OK` the bootloader reports `DONE` and the
   device resets itself about one second later.

#### Technical Details
- **Protocol**: request/response lines, see
  [docs/serial-api.md](docs/serial-api.md), *Bootloader commands*.
- **Timeouts**: the first line (ESP32 erase) and the line crossing the second
  ESP32 slice boundary can take several seconds; the UI uses a 60 s timeout
  there and 5 s elsewhere.
- **Errors**: `ERR 303` bad hex, `ERR 300` bad cookie, `ERR 301` flash error,
  `ERR 302` data after completion. On any error the bootloader latches the
  `ERROR` state; the UI sends `*RST` and the upload must be restarted.
- **Logging**: Full operation logging in Log Display

#### Safety Notes
- Do not disconnect during firmware upload
- Wait for completion message before using the device
- Keep original firmware backup for recovery

### 4. Log Display

Comprehensive application event logging with color-coded messages.

#### Log Types
- **Info** (grey/black): General information messages
- **Success** (green): Successful operations
- **Error** (red): Errors and failures
- **Warning** (orange): Warning messages

#### Features
- **Timestamps**: Millisecond-precision timestamps for all events
- **Auto-scroll**: Automatically scrolls to newest messages
- **Clear Logs**: Button to clear all log entries
- **Theme-aware**: Colors adapt to dark/light mode

#### Use Cases
- Troubleshoot connection issues
- Monitor firmware upload progress
- Track PCR protocol operations
- Debug serial communication

### 5. Serial I/O

Raw serial communication monitor for advanced diagnostics.

#### Display Features
- **Character-level Display**: Shows every character sent/received
- **Line Buffering**: Groups characters into lines (splits on `\n`)
- **Non-printable Characters**: Escaped for visibility (e.g., `\r`, `\x00`)
- **Current Line Indicator**: Shows incomplete current line with cursor
- **Auto-scroll**: Follows latest data

#### Use Cases
- Debug serial protocol issues
- Verify device responses
- Monitor raw communication
- Develop new features

#### Technical Notes
- Filters out `\r` characters
- Treats `\n` as line breaks
- Shows escape sequences for control characters
- Useful for protocol development and debugging

### 6. Documentation

In-app help and user guide.

#### Features
- **Markdown Support**: Renders formatted documentation
- **Always Available**: Accessible via Documentation tab
- **No Internet Required**: Embedded in application

#### Supported Markdown
- Headers (H1-H6)
- Bold and italic text
- Links
- Code blocks and inline code
- Ordered and unordered lists

## Serial Communication

### Connection Parameters
- **Baud Rate**: 115200 (default)
- **Data Bits**: 8
- **Stop Bits**: 1
- **Parity**: None
- **Flow Control**: None

### Available Baud Rates
The application supports the following baud rates:
- 9600
- 19200
- 38400
- 57600
- 115200 (default)

### Protocol

The device speaks a single SCPI-style, line-based request/response protocol
over USB (Web Serial), the local WebSocket and the cloud device socket. The
full command reference lives in [docs/serial-api.md](docs/serial-api.md);
the essentials:

- A request is one line: `<HEADER>[ <arg>[,<arg>…]]\n`. Headers are
  case-insensitive (`*IDN?`, `STAT?`, `PROT:STAR`). Arguments are comma
  separated; a `"quoted"` argument may contain commas and spaces, and `""`
  inside quotes is a literal quote.
- Every non-empty request produces exactly one reply line: query data (no
  prefix), `OK` / `OK <n>` for commands, or `ERR <code>,"<message>"`.
- The device never sends anything unsolicited, so the UI drives everything by
  polling. Requests may be pipelined; replies arrive in order.

Common commands:

| Command | Purpose |
|---|---|
| `*IDN?` | `molstem,<model>,<serial>,<version>` — model is `thermocycler`, `thermocycler-bootloader` or `thermocycler-provisioning` |
| `STAT?` | `IDLE`, `RUNNING` or `BUSY` |
| `PROT:STAR "<name>","<comment>",<cycles>,<introT>,<introS>,…,<finT>,<finS>` | start a protocol |
| `PROT:STOP` | abort the running protocol |
| `PROT:CYCL?` | phase, cycle, remaining time, temperatures and targets of the current run |
| `PROT:DEF?` | the protocol currently stored on the device |
| `HW?` | hardware monitor (`key=value` pairs) — USB only |

### Polling

- **USB (Web Serial)**: `HW?` at 5 Hz feeds the temperature plots and the
  hardware monitor; `STAT?` and, while running, `PROT:CYCL?` at 1 Hz drive the
  run status display.
- **Cloud (app.molstem.com/devices)**: `STAT?` every 60 s while idle;
  `PROT:CYCL?` at 1 Hz while a run is in progress. There is no hardware
  monitor over the cloud socket (`HW?` answers `ERR 100`), so temperature data
  is only available during a run.

### Data Flow
1. **UI to Device**: UI (poll timer or user action) → serialService writes a request line
2. **Device to UI**: reply line → serialService matches it to the pending request → stores update → UI re-renders

### Protocol Notes
- Commands and responses are logged
- All data is visible in Serial I/O panel

## State Management

The application uses Zustand stores for state management:

### serialStore
- Port connection state
- Baud rate configuration
- Available ports list
- Status messages

### pcrStore
- PCR protocol configuration
- Form field values
- Drive selection
- Protocol serialization

### temperatureStore
- Temperature data points (time, peltier, lid)
- Parsing state
- Data management (add, clear)

### logStore
- Application log messages
- Timestamp tracking
- Log type categorization

### firmwareStore
- Firmware file information
- Upload progress tracking
- Upload status

## File Formats

### PCR Protocol CSV

When saving PCR protocols, the file format is:

```csv
Stage,Temperature,TimeSec,Cycles
Intro Denaturing,95,300,1
Denaturing,95,30,35
Annealing,55,30,35
Extension,72,60,35
Final Extension,72,600,1
```

#### Fields
- **Stage**: Stage name (one of the 5 predefined stages)
- **Temperature**: Target temperature in °C
- **TimeSec**: Duration in seconds
- **Cycles**: Number of cycles for this stage

### Firmware Update Package (`.fwu`)

Built by `firmware/tools/make_fwu.py`. The file begins with the `molstemfw1`
cookie followed by the ESP32 and STM32 images; the UI does not interpret it
and streams it to the bootloader byte-for-byte as `BOOT:DATA` lines (see
[docs/serial-api.md](docs/serial-api.md)).

## Troubleshooting

### Connection Issues

**Problem**: Cannot connect to device
- **Check**: USB cable is properly connected
- **Check**: Device is powered on
- **Check**: Browser supports Web Serial API
- **Try**: Disconnect and reconnect USB cable
- **Try**: Restart browser
- **Try**: Check device permissions in browser settings

**Problem**: "No ports available"
- **Check**: Device drivers are installed
- **Check**: Device appears in system device manager
- **Try**: Use a different USB port
- **Try**: Restart the device

### Temperature Data Not Showing

**Problem**: Charts are empty
- **Check**: `HW?` requests and their replies appear in Serial I/O (USB)
- **Check**: Over the cloud socket, temperatures are only reported while a
  protocol is running (`PROT:CYCL?`)
- **Check**: `*IDN?` reports model `thermocycler` (not the bootloader or
  provisioning mode)
- **Try**: Disconnect and reconnect

### Firmware Upload Fails

**Problem**: Upload stops or fails
- **Check**: `*IDN?` reports `thermocycler-bootloader` (device is in
  Firmware update mode)
- **Check**: Firmware file is a valid `.fwu` package (`ERR 300` = bad cookie,
  `ERR 303` = bad hex)
- **Check**: File is not corrupted
- **Check**: Serial connection is stable
- **Try**: Restart device and retry upload
- **Try**: Use original firmware file from manufacturer

### Layout Issues

**Problem**: Panels are in wrong positions
- **Solution**: Click "Reset Layout" in header

**Problem**: Panel is missing
- **Solution**: Reset layout to restore all panels

## Advanced Features

### Custom Layouts

The dockview system allows you to create custom workspace layouts:
1. Drag panels to desired positions
2. Create tab groups by dragging panels onto each other
3. Resize panels by dragging borders
4. Layout is automatically saved to localStorage
5. Restore anytime with "Reset Layout"

### Theme Customization

Toggle between dark and light modes using the theme button in the header. The theme preference is persisted across sessions.

### Data Export

#### Temperature Data
Currently displayed in charts only. For data export:
- Use Serial I/O to capture raw data
- Copy from log messages
- Future versions may include CSV export

#### Log Export
- Select and copy from Log Display panel
- Includes timestamps for all events

## Development & Extension

### Project Structure

```
webui/
├── src/
│   ├── components/        # React components
│   │   ├── ConnectionModal.tsx
│   │   ├── Documentation.tsx
│   │   ├── FirmwareUpgrade.tsx
│   │   ├── LogDisplay.tsx
│   │   ├── PCRSettings.tsx
│   │   ├── RealtimeTemperaturePlot.tsx
│   │   ├── SerialControl.tsx
│   │   ├── SerialIO.tsx
│   │   └── TemperaturePlot.tsx
│   ├── services/          # Core services
│   │   ├── connection/         # Transports: Web Serial, local /ws, cloud socket
│   │   ├── serialService.ts    # Web Serial API wrapper
│   │   ├── scpiClient.ts       # Request/response client (docs/serial-api.md)
│   │   ├── devicePoller.ts     # HW? / STAT? / PROT:CYCL? polling
│   │   ├── cloudService.ts     # app.molstem.com device socket
│   │   └── storageService.ts   # File saving
│   ├── stores/           # Zustand state stores
│   │   ├── firmwareStore.ts
│   │   ├── logStore.ts
│   │   ├── pcrStore.ts
│   │   ├── serialStore.ts
│   │   └── temperatureStore.ts
│   ├── types/            # TypeScript definitions
│   │   └── index.ts
│   ├── App.tsx           # Main application
│   └── main.tsx          # Entry point
├── electron/             # Electron desktop app
└── public/              # Static assets
```

### Adding New Features

To extend the application:
1. Create component in `src/components/`
2. Add state store if needed in `src/stores/`
3. Register panel in `App.tsx` dockview configuration
4. Add types to `src/types/index.ts`

### Building

```bash
# Development
npm run dev

# Build for web
npm run build

# Build for desktop
npm run electron:build
```

## API Reference

### serialService

```typescript
// Request port from user
requestPort(): Promise<SerialPort>

// Connect to port
connect(port: SerialPort, baudRate: number): Promise<void>

// Disconnect
disconnect(): Promise<void>

// Write data
write(data: string | Uint8Array): Promise<void>

// Read specific number of bytes
readBytes(size: number, timeout?: number): Promise<Uint8Array>

// Register data callback
onData(callback: (data: string) => void): void

// Get port information
getPortInfo(): { vendorId?: number; productId?: number }
```

### scpiClient

Line-oriented request/response client shared by all transports. Every call
sends one request line and resolves with the single reply line; `ERR` replies
reject with a `ScpiError` carrying the numeric code and message.

```typescript
// Send a request line, resolve with the reply line
send(line: string, timeoutMs?: number): Promise<string>

// Pipeline several requests; replies are matched in order
sendBatch(lines: string[], timeoutMs?: number | number[]): Promise<string>[]

// Query (expects data) / command (expects OK)
query(line: string, timeoutMs?: number): Promise<string>
command(line: string, timeoutMs?: number): Promise<string>

// Observe raw traffic (Serial I/O panel)
onTraffic(cb: (direction: 'tx' | 'rx', line: string) => void): () => void
```

### devicePoller

Drives the periodic `HW?`, `STAT?` and `PROT:CYCL?` requests described under
[Polling](#polling) and feeds the temperature and run-status stores. The
poll schedule depends on the active transport (USB vs. cloud).

### Firmware update

The firmware panel streams a `.fwu` package as `BOOT:DATA <hex>` lines
through `scpiClient`, keeping up to 16 lines in flight and tracking the
`OK <bytes_total>` acknowledgements for progress (see
[docs/serial-api.md](docs/serial-api.md), *Bootloader commands*).

### storageService

```typescript
// Save PCR protocol to file
saveProtocolToFile(
  protocol: PCRProtocol,
  options?: StorageOptions
): Promise<void>
```

## Support & Resources

### Getting Help
- Check Log Display for error messages
- Review Serial I/O for communication issues
- Check browser console for JavaScript errors

### Documentation
- This document (available in Documentation tab)
- Source code comments
- Type definitions in `src/types/index.ts`

### Contributing
For bug reports and feature requests, please check the project repository.

## Version History

### Version 1.0.0
- Initial release
- Web Serial API support
- PCR protocol configuration
- Real-time temperature monitoring
- Firmware upgrade via YMODEM
- Dockable panel layout
- Dark/Light theme support
- Comprehensive logging
- Serial I/O monitor

### Version 2.0.0 (hw2)
- SCPI-style request/response protocol shared by USB, local WebSocket and
  cloud transports (docs/serial-api.md)
- Polling-based telemetry (`HW?`, `STAT?`, `PROT:CYCL?`); no unsolicited output
- Firmware update via `.fwu` packages streamed as `BOOT:DATA` lines
- Device detection via `*IDN?`

## License

Check the project repository for license information.

---

**Note**: This documentation is for the molstem web UI. For hardware documentation, firmware development, or protocol specifications, please refer to the main project documentation.
