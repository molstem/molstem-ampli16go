const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path = require('path');

let portSelectionWindow = null;
let portSelectionCallback = null;
let availablePorts = [];
let mainWindowRef = null;

function createPortSelectionWindow(mainWindow) {
  portSelectionWindow = new BrowserWindow({
    width: 600,
    height: 400,
    parent: mainWindow,
    modal: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    title: 'Select Serial Port',
    resizable: false,
    minimizable: false,
    maximizable: false,
  });

  // Create HTML content for port selection
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Select Serial Port</title>
      <style>
        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #1e1e1e;
          color: #ffffff;
          padding: 20px;
          height: 100vh;
          display: flex;
          flex-direction: column;
        }
        h2 {
          margin-bottom: 20px;
          font-size: 18px;
          font-weight: 500;
        }
        .port-list {
          flex: 1;
          overflow-y: auto;
          border: 1px solid #3e3e42;
          border-radius: 4px;
          margin-bottom: 20px;
        }
        .port-item {
          padding: 12px 16px;
          border-bottom: 1px solid #3e3e42;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        .port-item:last-child {
          border-bottom: none;
        }
        .port-item:hover {
          background-color: #2a2d2e;
        }
        .port-item.selected {
          background-color: #094771;
        }
        .port-name {
          font-weight: 500;
          margin-bottom: 4px;
        }
        .port-info {
          font-size: 12px;
          color: #a0a0a0;
        }
        .no-ports {
          padding: 40px;
          text-align: center;
          color: #a0a0a0;
        }
        .buttons {
          display: flex;
          gap: 10px;
          justify-content: flex-end;
        }
        button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          cursor: pointer;
          transition: background-color 0.2s;
        }
        button.primary {
          background-color: #0078d4;
          color: white;
        }
        button.primary:hover:not(:disabled) {
          background-color: #106ebe;
        }
        button.primary:disabled {
          background-color: #3e3e42;
          color: #666;
          cursor: not-allowed;
        }
        button.secondary {
          background-color: #3e3e42;
          color: white;
        }
        button.secondary:hover {
          background-color: #4e4e52;
        }
        .refresh-button {
          background-color: #2a2d2e;
          color: white;
          margin-bottom: 10px;
        }
        .refresh-button:hover {
          background-color: #3e3e42;
        }
      </style>
    </head>
    <body>
      <h2>Select a Serial Port</h2>
      <button class="refresh-button" onclick="refreshPorts()">🔄 Refresh Ports</button>
      <div class="port-list" id="portList">
        <div class="no-ports">No serial ports available</div>
      </div>
      <div class="buttons">
        <button class="secondary" onclick="cancel()">Cancel</button>
        <button class="primary" id="selectButton" disabled onclick="selectPort()">Select</button>
      </div>
      <script>
        let selectedPortId = null;
        let ports = [];

        window.addEventListener('DOMContentLoaded', () => {
          window.electronAPI.getPorts().then(updatePortList);
        });

        function updatePortList(portList) {
          ports = portList || [];
          const container = document.getElementById('portList');
          const selectButton = document.getElementById('selectButton');

          if (ports.length === 0) {
            container.innerHTML = '<div class="no-ports">No serial ports available. Connect a device and click Refresh.</div>';
            selectButton.disabled = true;
            selectedPortId = null;
            return;
          }

          container.innerHTML = ports.map(port => \`
            <div class="port-item" onclick="selectPortItem('\${port.portId}')" data-port-id="\${port.portId}">
              <div class="port-name">\${port.displayName || port.portName || 'Serial Port'}</div>
              <div class="port-info">
                \${port.vendorId ? 'VID: ' + port.vendorId : ''}
                \${port.productId ? 'PID: ' + port.productId : ''}
                \${port.serialNumber ? 'S/N: ' + port.serialNumber : ''}
              </div>
            </div>
          \`).join('');
        }

        function selectPortItem(portId) {
          selectedPortId = portId;
          document.querySelectorAll('.port-item').forEach(item => {
            item.classList.toggle('selected', item.dataset.portId === portId);
          });
          document.getElementById('selectButton').disabled = false;
        }

        function refreshPorts() {
          window.electronAPI.refreshPorts().then(updatePortList);
        }

        function selectPort() {
          if (selectedPortId) {
            window.electronAPI.selectPort(selectedPortId);
          }
        }

        function cancel() {
          window.electronAPI.cancel();
        }
      </script>
    </body>
    </html>
  `;

  portSelectionWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

  portSelectionWindow.on('closed', () => {
    portSelectionWindow = null;
    if (portSelectionCallback) {
      portSelectionCallback('');
      portSelectionCallback = null;
    }
  });

  return portSelectionWindow;
}

// IPC handlers for port selection window
ipcMain.handle('get-ports', () => {
  return availablePorts;
});

ipcMain.handle('refresh-ports', async () => {
  // Trigger a new port request to get updated list
  if (mainWindowRef && mainWindowRef.webContents) {
    mainWindowRef.webContents.session.emit('serial-port-revoked');
  }
  return availablePorts;
});

ipcMain.on('select-port', (event, portId) => {
  if (portSelectionCallback) {
    portSelectionCallback(portId);
    portSelectionCallback = null;
  }
  if (portSelectionWindow) {
    portSelectionWindow.close();
  }
});

ipcMain.on('cancel-port-selection', () => {
  if (portSelectionCallback) {
    portSelectionCallback('');
    portSelectionCallback = null;
  }
  if (portSelectionWindow) {
    portSelectionWindow.close();
  }
});

// Handle opening external URLs
ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

function createWindow() {
  // Hide the menu
  Menu.setApplicationMenu(null);

  // Determine if running in development or production
  const isDev = !app.isPackaged;

  // Set paths for icon and index.html
  const iconPath = isDev
    ? path.join(__dirname, '../icon.png')
    : path.join(process.resourcesPath, 'app/icon.png');

  const indexPath = isDev
    ? path.join(__dirname, '../dist/index.html')
    : path.join(__dirname, '../dist/index.html');

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
    icon: iconPath,
  });

  // Store reference to main window
  mainWindowRef = mainWindow;

  // Handle serial port selection
  mainWindow.webContents.session.on('select-serial-port', (event, portList, webContents, callback) => {
    event.preventDefault();

    availablePorts = portList;
    portSelectionCallback = callback;

    if (!portSelectionWindow) {
      createPortSelectionWindow(mainWindow);
    }

    portSelectionWindow.webContents.once('did-finish-load', () => {
      portSelectionWindow.show();
    });
  });

  // Grant permission for serial port access
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    if (permission === 'serial') {
      return true;
    }
    return false;
  });

  mainWindow.webContents.session.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'serial') {
      return true;
    }
    return false;
  });

  // Load the dist/index.html
  mainWindow.loadFile(indexPath);

  // Open DevTools in development or with F12 key
  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  // Allow F12 to toggle DevTools in production too
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
