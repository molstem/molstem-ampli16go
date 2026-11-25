import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

// Simulated device state
let setupMode: 'local' | 'cloud' = 'local';
let deviceName = '';
let wifiConnected = false;
let deviceSerial = 'MOLSTEM-2024-' + Math.random().toString(36).substring(2, 8).toUpperCase();

// Reset state
function resetState() {
  setupMode = 'local';
  deviceName = '';
  wifiConnected = false;
}

// GET /api/wifi-scan - Return list of available WiFi networks
app.get('/api/wifi-scan', (_req, res) => {
  // Simulate scan delay
  setTimeout(() => {
    res.json({
      status: 'success',
      networks: [
        { ssid: 'LabNetwork-5G', rssi: -45, secure: true },
        { ssid: 'LabNetwork-2.4G', rssi: -52, secure: true },
        { ssid: 'Research-WiFi', rssi: -58, secure: true },
        { ssid: 'Guest-Network', rssi: -65, secure: false },
        { ssid: 'IoT-Devices', rssi: -70, secure: true },
        { ssid: 'Conference-Room', rssi: -75, secure: true },
        { ssid: 'Neighbor-5G', rssi: -82, secure: true },
      ],
    });
  }, 500);
});

// POST /api/host-setup - Configure device mode and credentials
app.post('/api/host-setup', (req, res) => {
  const { mode, deviceName: name, password } = req.body;

  console.log('Host setup request:', { mode, deviceName: name, hasPassword: !!password });

  // Validate
  if (!mode || (mode !== 'local' && mode !== 'cloud')) {
    return res.json({ status: 'error', message: 'Invalid mode. Must be "local" or "cloud".' });
  }

  if (!name || name.length < 1 || name.length > 63) {
    return res.json({ status: 'error', message: 'Device name must be 1-63 characters.' });
  }

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(name)) {
    return res.json({ status: 'error', message: 'Device name must be DNS-compatible.' });
  }

  if (mode === 'local' && (!password || password.length < 6)) {
    return res.json({ status: 'error', message: 'Password must be at least 6 characters for local mode.' });
  }

  // Simulate occasional failure for testing
  if (name.toLowerCase().includes('fail')) {
    return res.json({ status: 'error', message: 'Simulated setup failure for testing.' });
  }

  // Success
  setupMode = mode;
  deviceName = name;

  // Simulate processing delay
  setTimeout(() => {
    res.json({ status: 'success' });
  }, 800);
});

// POST /api/wifi-setup - Connect to WiFi network
app.post('/api/wifi-setup', (req, res) => {
  const { ssid, password, region, timezone } = req.body;

  console.log('WiFi setup request:', { ssid, hasPassword: !!password, region, timezone });

  // Validate
  if (!ssid || ssid.length === 0) {
    return res.json({ status: 'error', message: 'SSID is required.' });
  }

  if (!region) {
    return res.json({ status: 'error', message: 'Region is required.' });
  }

  if (!timezone) {
    return res.json({ status: 'error', message: 'Timezone is required.' });
  }

  // Simulate WiFi connection (takes a few seconds)
  const connectionTime = 2000 + Math.random() * 3000; // 2-5 seconds

  setTimeout(() => {
    // Simulate failure for specific test cases
    if (ssid.toLowerCase().includes('fail') || password === 'wrongpassword') {
      wifiConnected = false;
      return res.json({
        status: 'error',
        message: 'Authentication failed. Please verify your WiFi password and try again.',
      });
    }

    // Success
    wifiConnected = true;
    console.log(`WiFi connected to ${ssid} in region ${region} (${timezone})`);
    res.json({ status: 'success' });
  }, connectionTime);
});

// GET /api/status - Get current device status
app.get('/api/status', (_req, res) => {
  console.log('Status request. wifiConnected:', wifiConnected, 'setupMode:', setupMode);

  if (!wifiConnected) {
    return res.json({
      status: 'success',
      state: 'disconnected',
      id: deviceSerial,
    });
  }

  if (setupMode === 'local') {
    res.json({
      status: 'success',
      state: 'local',
      id: deviceSerial,
      link: `http://${deviceName.toLowerCase()}.local`,
      ip: '192.168.1.' + Math.floor(100 + Math.random() * 100),
    });
  } else {
    res.json({
      status: 'success',
      state: 'cloud',
      id: deviceSerial,
      link: Math.random().toString(16).substring(2, 6).toUpperCase() + '-' +
            Math.random().toString(16).substring(2, 6).toUpperCase(),
    });
  }
});

// POST /api/commit - Finalize setup and turn off AP
app.post('/api/commit', (_req, res) => {
  console.log('Setup committed. Turning off AP mode.');

  // In real device, this would turn off the AP
  // For mock, we just acknowledge

  setTimeout(() => {
    res.json({ status: 'success' });
  }, 300);
});

// POST /api/reset - Reset device state (for testing)
app.post('/api/reset', (_req, res) => {
  console.log('Resetting device state');
  resetState();
  deviceSerial = 'MOLSTEM-2024-' + Math.random().toString(36).substring(2, 8).toUpperCase();
  res.json({ status: 'success' });
});

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║       molstem captive portal - Mock Server               ║
╠══════════════════════════════════════════════════════════╣
║  Server running on http://localhost:${PORT}                  ║
║                                                          ║
║  Test Scenarios:                                         ║
║  • Include 'fail' in device name to trigger setup error  ║
║  • Include 'fail' in SSID to trigger WiFi error          ║
║  • Use 'wrongpassword' as WiFi password to trigger error ║
║                                                          ║
║  POST /api/reset to reset device state                   ║
╚══════════════════════════════════════════════════════════╝
  `);
});
