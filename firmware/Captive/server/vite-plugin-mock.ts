import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'http';

// Simulated device state
let setupMode: 'local' | 'cloud' = 'local';
let deviceName = '';
let wifiConnected = false;
let deviceSerial = 'MOLSTEM-2024-' + Math.random().toString(36).substring(2, 8).toUpperCase();

function resetState() {
  setupMode = 'local';
  deviceName = '';
  wifiConnected = false;
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: ServerResponse, data: unknown) {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

export function mockApiPlugin(): Plugin {
  return {
    name: 'mock-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';

        // Only handle /api routes
        if (!url.startsWith('/api')) {
          return next();
        }

        // GET /api/wifi-scan
        if (req.method === 'GET' && url === '/api/wifi-scan') {
          setTimeout(() => {
            sendJson(res, {
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
          return;
        }

        // POST /api/host-setup
        if (req.method === 'POST' && url === '/api/host-setup') {
          const body = await parseBody(req);
          const { mode, deviceName: name, password } = body as {
            mode?: string;
            deviceName?: string;
            password?: string;
          };

          console.log('Host setup request:', { mode, deviceName: name, hasPassword: !!password });

          if (!mode || (mode !== 'local' && mode !== 'cloud')) {
            return sendJson(res, { status: 'error', message: 'Invalid mode. Must be "local" or "cloud".' });
          }

          if (!name || name.length < 1 || name.length > 63) {
            return sendJson(res, { status: 'error', message: 'Device name must be 1-63 characters.' });
          }

          if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(name)) {
            return sendJson(res, { status: 'error', message: 'Device name must be DNS-compatible.' });
          }

          if (mode === 'local' && (!password || password.length < 6)) {
            return sendJson(res, { status: 'error', message: 'Password must be at least 6 characters for local mode.' });
          }

          if (name.toLowerCase().includes('fail')) {
            return sendJson(res, { status: 'error', message: 'Simulated setup failure for testing.' });
          }

          setupMode = mode as 'local' | 'cloud';
          deviceName = name;

          setTimeout(() => {
            sendJson(res, { status: 'success' });
          }, 800);
          return;
        }

        // POST /api/wifi-setup
        if (req.method === 'POST' && url === '/api/wifi-setup') {
          const body = await parseBody(req);
          const { ssid, password, region, timezone } = body as {
            ssid?: string;
            password?: string;
            region?: string;
            timezone?: string;
          };

          console.log('WiFi setup request:', { ssid, hasPassword: !!password, region, timezone });

          if (!ssid || ssid.length === 0) {
            return sendJson(res, { status: 'error', message: 'SSID is required.' });
          }

          if (!region) {
            return sendJson(res, { status: 'error', message: 'Region is required.' });
          }

          if (!timezone) {
            return sendJson(res, { status: 'error', message: 'Timezone is required.' });
          }

          const connectionTime = 2000 + Math.random() * 3000;

          setTimeout(() => {
            if (ssid.toLowerCase().includes('fail') || password === 'wrongpassword') {
              wifiConnected = false;
              return sendJson(res, {
                status: 'error',
                message: 'Authentication failed. Please verify your WiFi password and try again.',
              });
            }

            wifiConnected = true;
            console.log(`WiFi connected to ${ssid} in region ${region} (${timezone})`);
            sendJson(res, { status: 'success' });
          }, connectionTime);
          return;
        }

        // GET /api/status
        if (req.method === 'GET' && url === '/api/status') {
          console.log('Status request. wifiConnected:', wifiConnected, 'setupMode:', setupMode);

          if (!wifiConnected) {
            return sendJson(res, {
              status: 'success',
              state: 'disconnected',
              id: deviceSerial,
            });
          }

          if (setupMode === 'local') {
            return sendJson(res, {
              status: 'success',
              state: 'local',
              id: deviceSerial,
              link: `http://${deviceName.toLowerCase()}.local`,
              ip: '192.168.1.' + Math.floor(100 + Math.random() * 100),
            });
          } else {
            return sendJson(res, {
              status: 'success',
              state: 'cloud',
              id: deviceSerial,
              link: Math.random().toString(16).substring(2, 6).toUpperCase() + '-' +
                    Math.random().toString(16).substring(2, 6).toUpperCase(),
            });
          }
        }

        // POST /api/commit
        if (req.method === 'POST' && url === '/api/commit') {
          console.log('Setup committed. Turning off AP mode.');
          setTimeout(() => {
            sendJson(res, { status: 'success' });
          }, 300);
          return;
        }

        // POST /api/reset
        if (req.method === 'POST' && url === '/api/reset') {
          console.log('Resetting device state');
          resetState();
          deviceSerial = 'MOLSTEM-2024-' + Math.random().toString(36).substring(2, 8).toUpperCase();
          return sendJson(res, { status: 'success' });
        }

        // Unknown API route
        res.statusCode = 404;
        sendJson(res, { status: 'error', message: 'Not found' });
      });

      console.log(`
╔══════════════════════════════════════════════════════════╗
║       molstem captive portal - Mock API (Integrated)     ║
╠══════════════════════════════════════════════════════════╣
║  Mock API is running as part of Vite dev server          ║
║                                                          ║
║  Test Scenarios:                                         ║
║  • Include 'fail' in device name to trigger setup error  ║
║  • Include 'fail' in SSID to trigger WiFi error          ║
║  • Use 'wrongpassword' as WiFi password to trigger error ║
║                                                          ║
║  POST /api/reset to reset device state                   ║
╚══════════════════════════════════════════════════════════╝
      `);
    },
  };
}
