import type { AccessIdentity } from '../lib/access.js';

export function renderDashboard(identity: AccessIdentity): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>molstem admin dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f5f5f5;
      min-height: 100vh;
    }
    .header {
      background: #1976d2;
      color: white;
      padding: 1rem 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .header h1 { font-size: 1.25rem; }
    .header-right {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .user-info { font-size: 0.9rem; opacity: 0.9; }
    .btn-logout {
      background: rgba(255,255,255,0.2);
      color: white;
      border: 1px solid rgba(255,255,255,0.3);
      padding: 0.4rem 0.8rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.85rem;
    }
    .btn-logout:hover {
      background: rgba(255,255,255,0.3);
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem;
    }
    .tabs {
      display: flex;
      gap: 0;
      margin-bottom: 1rem;
      border-bottom: 2px solid #e0e0e0;
    }
    .tab {
      padding: 0.75rem 1.5rem;
      cursor: pointer;
      border: none;
      background: none;
      font-size: 1rem;
      color: #666;
      border-bottom: 2px solid transparent;
      margin-bottom: -2px;
    }
    .tab:hover { color: #1976d2; }
    .tab.active {
      color: #1976d2;
      border-bottom-color: #1976d2;
      font-weight: 500;
    }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .card {
      background: white;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    .card h2 {
      font-size: 1.1rem;
      margin-bottom: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .btn {
      background: #1976d2;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      border: none;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .btn:hover { background: #1565c0; }
    .btn:disabled { background: #ccc; cursor: not-allowed; }
    .btn-small { padding: 0.4rem 0.8rem; font-size: 0.85rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    th, td {
      padding: 0.75rem;
      text-align: left;
      border-bottom: 1px solid #eee;
    }
    th {
      background: #f5f5f5;
      font-weight: 500;
      color: #666;
    }
    td { font-family: monospace; }
    .truncate {
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .form-group {
      margin-bottom: 1rem;
    }
    .form-group label {
      display: block;
      font-size: 0.85rem;
      color: #666;
      margin-bottom: 0.25rem;
    }
    .form-group input, .form-group textarea {
      width: 100%;
      padding: 0.5rem;
      border: 1px solid #ddd;
      border-radius: 4px;
      font-family: monospace;
    }
    .form-group textarea {
      min-height: 80px;
      resize: vertical;
    }
    .message {
      padding: 0.75rem;
      border-radius: 4px;
      margin-bottom: 1rem;
    }
    .message.error { background: #ffebee; color: #c62828; }
    .message.success { background: #e8f5e9; color: #2e7d32; }
    .hidden { display: none; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .stat-card {
      background: white;
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    .stat-value { font-size: 2rem; font-weight: bold; color: #1976d2; }
    .stat-label { font-size: 0.85rem; color: #666; }
    .loading { color: #999; font-style: italic; }
  </style>
</head>
<body>
  <div class="header">
    <h1>molstem admin dashboard</h1>
    <div class="header-right">
      <div class="user-info">Logged in as ${escapeHtml(identity.email)}</div>
      <button class="btn-logout" id="logout-btn">Log out</button>
    </div>
  </div>

  <div class="container">
    <div id="message" class="message hidden"></div>

    <!-- Stats Overview -->
    <div class="stats">
      <div class="stat-card">
        <div class="stat-value" id="device-count">-</div>
        <div class="stat-label">Total Devices</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="user-count">-</div>
        <div class="stat-label">Total Users</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="enrollment-count">-</div>
        <div class="stat-label">Active Enrollments</div>
      </div>
    </div>

    <!-- Tab Navigation -->
    <div class="tabs">
      <button class="tab active" data-tab="devices-tab">Devices</button>
      <button class="tab" data-tab="users-tab">Users</button>
      <button class="tab" data-tab="enrollments-tab">Enrollments</button>
    </div>

    <!-- Devices Tab -->
    <div id="devices-tab" class="tab-content active">
      <div class="card">
        <h2>Provision New Device</h2>
        <form id="provision-form">
          <div class="form-group">
            <label for="serial">Serial Number</label>
            <input type="text" id="serial" placeholder="MOLSTEM-..." required>
          </div>
          <div class="form-group">
            <label for="pubkey">Public Key (Base64 SPKI)</label>
            <textarea id="pubkey" placeholder="MFkw..." required></textarea>
          </div>
          <div class="form-group">
            <label for="name">Name (optional)</label>
            <input type="text" id="name" placeholder="Device name">
          </div>
          <button type="submit" class="btn" id="provision-btn">Provision Device</button>
        </form>
      </div>

      <div class="card">
        <h2>
          All Devices
          <button class="btn btn-small" id="refresh-devices">Refresh</button>
        </h2>
        <div id="devices-table" class="loading">Loading...</div>
      </div>
    </div>

    <!-- Users Tab -->
    <div id="users-tab" class="tab-content">
      <div class="card">
        <h2>
          All Users
          <button class="btn btn-small" id="refresh-users">Refresh</button>
        </h2>
        <div id="users-table" class="loading">Loading...</div>
      </div>
    </div>

    <!-- Enrollments Tab -->
    <div id="enrollments-tab" class="tab-content">
      <div class="card">
        <h2>
          All Enrollments
          <button class="btn btn-small" id="refresh-enrollments">Refresh</button>
        </h2>
        <div id="enrollments-table" class="loading">Loading...</div>
      </div>
    </div>
  </div>

  <script>
    function showMessage(text, type) {
      const el = document.getElementById('message');
      el.textContent = text;
      el.className = 'message ' + type;
      setTimeout(() => el.classList.add('hidden'), 5000);
    }

    function truncate(str, len = 20) {
      if (!str) return '-';
      return str.length > len ? str.substring(0, len) + '...' : str;
    }

    function formatDate(timestamp) {
      if (!timestamp) return '-';
      return new Date(timestamp * 1000).toLocaleString();
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[m]);
    }

    async function loadDevices() {
      const container = document.getElementById('devices-table');
      container.innerHTML = '<span class="loading">Loading...</span>';
      try {
        const res = await fetch('/devices');
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        document.getElementById('device-count').textContent = data.devices.length;

        if (data.devices.length === 0) {
          container.innerHTML = '<p>No devices</p>';
        } else {
          container.innerHTML = \`
            <table>
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>Public Key</th>
                  <th>User</th>
                  <th>Name</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                \${data.devices.map(d => \`
                  <tr>
                    <td class="truncate" title="\${escapeHtml(d.serial_number)}">\${escapeHtml(truncate(d.serial_number, 20))}</td>
                    <td class="truncate" title="\${escapeHtml(d.public_key || '')}">\${escapeHtml(truncate(d.public_key, 15))}</td>
                    <td class="truncate">\${escapeHtml(truncate(d.user_id, 10))}</td>
                    <td>\${escapeHtml(d.name) || '-'}</td>
                    <td>\${formatDate(d.created_at)}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          \`;
        }
      } catch (e) {
        container.innerHTML = '<p style="color: #c62828;">Failed to load devices</p>';
      }
    }

    async function loadUsers() {
      const container = document.getElementById('users-table');
      container.innerHTML = '<span class="loading">Loading...</span>';
      try {
        const res = await fetch('/users');
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        document.getElementById('user-count').textContent = data.users.length;

        if (data.users.length === 0) {
          container.innerHTML = '<p>No users</p>';
        } else {
          container.innerHTML = \`
            <table>
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Created</th>
                  <th>Last Login</th>
                </tr>
              </thead>
              <tbody>
                \${data.users.map(u => \`
                  <tr>
                    <td>\${escapeHtml(u.email)}</td>
                    <td>\${escapeHtml(u.name) || '-'}</td>
                    <td>\${formatDate(u.created_at)}</td>
                    <td>\${formatDate(u.last_login_at)}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          \`;
        }
      } catch (e) {
        container.innerHTML = '<p style="color: #c62828;">Failed to load users</p>';
      }
    }

    async function loadEnrollments() {
      const container = document.getElementById('enrollments-table');
      container.innerHTML = '<span class="loading">Loading...</span>';
      try {
        const res = await fetch('/enrollments');
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        document.getElementById('enrollment-count').textContent = data.enrollments.length;

        if (data.enrollments.length === 0) {
          container.innerHTML = '<p>No enrollments</p>';
        } else {
          container.innerHTML = \`
            <table>
              <thead>
                <tr>
                  <th>Enrollment ID</th>
                  <th>Serial</th>
                  <th>Expires</th>
                </tr>
              </thead>
              <tbody>
                \${data.enrollments.map(e => \`
                  <tr>
                    <td>\${escapeHtml(e.enrollment_id)}</td>
                    <td class="truncate" title="\${escapeHtml(e.serial_number)}">\${escapeHtml(truncate(e.serial_number, 20))}</td>
                    <td>\${formatDate(e.expires_at)}</td>
                  </tr>
                \`).join('')}
              </tbody>
            </table>
          \`;
        }
      } catch (e) {
        container.innerHTML = '<p style="color: #c62828;">Failed to load enrollments</p>';
      }
    }

    // Tab navigation
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tab.dataset.tab).classList.add('active');
      });
    });

    // Provision form
    document.getElementById('provision-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('provision-btn');
      btn.disabled = true;
      btn.textContent = 'Provisioning...';

      const serial = document.getElementById('serial').value.trim();
      const publicKey = document.getElementById('pubkey').value.trim();
      const name = document.getElementById('name').value.trim() || undefined;

      try {
        const res = await fetch('/devices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serial_number: serial, public_key: publicKey, name })
        });

        if (res.ok) {
          showMessage('Device provisioned successfully!', 'success');
          document.getElementById('provision-form').reset();
          loadDevices();
        } else {
          const err = await res.json();
          showMessage(err.message || 'Failed to provision device', 'error');
        }
      } catch (e) {
        showMessage('Failed to provision device', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Provision Device';
      }
    });

    // Refresh buttons
    document.getElementById('refresh-devices').addEventListener('click', loadDevices);
    document.getElementById('refresh-users').addEventListener('click', loadUsers);
    document.getElementById('refresh-enrollments').addEventListener('click', loadEnrollments);

    // Initial load
    loadDevices();
    loadUsers();
    loadEnrollments();

    // Logout button - redirects to Cloudflare Access logout (use relative URL on same domain)
    document.getElementById('logout-btn').addEventListener('click', () => {
      window.location.href = '/cdn-cgi/access/logout';
    });
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
