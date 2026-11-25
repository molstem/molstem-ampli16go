# molstem cloud backend

Cloudflare Workers-based cloud backend for molstem thermocycler devices, providing:
- Google OAuth authentication for users
- mTLS device authentication
- WebSocket proxy between users and devices
- Device enrollment flow

## Architecture

```
User Browser ────────────────────────────────────── Device (Simulator/ESP32)
     │                                                       │
     │  Session Cookie                           mTLS Client Cert
     │                                                       │
     ▼                                                       ▼
┌─────────────────────────────────────────────────────────────────┐
│           app.molstem.com  (devices: devices.molstem.com)       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │ WAF Rules    │    │ Main Worker  │    │ Durable Obj  │      │
│  │ (mTLS check) │───►│ (routing)    │───►│ DeviceProxy  │      │
│  └──────────────┘    └──────────────┘    └──────────────┘      │
│                             │                    │              │
│                      ┌──────┴──────┐      ┌──────┴──────┐      │
│                      │     D1      │      │     KV      │      │
│                      │ (users,     │      │ (sessions)  │      │
│                      │  devices)   │      │             │      │
│                      └─────────────┘      └─────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

> **Note:** The web UI and the cloud UI are now served by a single worker, `app-molstem`,
> at `app.molstem.com` (device management lives at `https://app.molstem.com/devices`).
> Device-facing endpoints (mTLS registration and the device WebSocket) are served on
> `devices.molstem.com`. The simulator defaults to `devices.molstem.com`.

## Project Structure

```
cloud/
├── shared/              # Shared Zod schemas and types
│   ├── package.json
│   └── schemas.ts
├── simulator/           # TypeScript device simulator
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts     # CLI entry point
│       ├── device.ts    # Simulated device class
│       ├── uart-bridge.ts
│       └── certificate.ts
└── worker/              # Cloudflare Worker
    ├── package.json
    ├── wrangler.toml
    ├── schema.sql
    └── src/
        ├── index.ts     # Worker entry point
        ├── durable-objects/
        │   └── device-proxy.ts
        ├── routes/
        │   ├── auth.ts
        │   ├── devices.ts
        │   ├── enrollment.ts
        │   └── websocket.ts
        ├── middleware/
        │   ├── session.ts
        │   └── mtls.ts
        └── lib/
            ├── db.ts
            └── kv.ts
```

## Setup

### Prerequisites

- Node.js 18+
- Cloudflare account
- Google Cloud Console project (for OAuth)
- Wrangler CLI: `npm install -g wrangler`

### 1. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Navigate to APIs & Services > Credentials
4. Create OAuth 2.0 Client ID (Web application)
5. Add authorized redirect URI: `https://app.molstem.com/auth/google/callback`
6. Note your Client ID and Client Secret

### 2. Cloudflare Setup

```bash
# Login to Cloudflare
wrangler login

# Navigate to worker directory
cd cloud/worker

# Create KV namespaces
wrangler kv:namespace create SESSIONS
wrangler kv:namespace create OAUTH_STATE

# Create D1 database
wrangler d1 create molstem

# Update wrangler.toml with the IDs from above commands
```

Update `wrangler.toml` with the IDs returned by the commands above.

### 3. Set Secrets

```bash
cd cloud/worker

# Set Google OAuth credentials
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
```

### 4. Deploy Database Schema

```bash
cd cloud/worker

# For production
wrangler d1 execute molstem --file=./schema.sql

# For local development
wrangler d1 execute molstem --local --file=./schema.sql
```

### 5. Configure mTLS (Cloudflare Dashboard)

1. Go to Cloudflare Dashboard > SSL/TLS > Client Certificates
2. Create a Client Certificate CA for your zone
3. Generate test certificates for the simulator
4. Create a WAF rule to enforce mTLS on device endpoints:
   - Expression: `(http.request.uri.path matches "^/ws/device" or http.request.uri.path matches "^/api/device/") and not cf.tls_client_auth.cert_verified`
   - Action: Block

### 6. Deploy Worker

```bash
cd cloud/worker
npm install
wrangler deploy
```

### 7. Configure DNS

Add CNAME records pointing `app.molstem.com` and `devices.molstem.com` to the `app-molstem` worker.

## Local Development

### Run Worker Locally

```bash
cd cloud/worker
npm install
npm run dev
```

### Run Device Simulator

```bash
cd cloud/simulator
npm install

# Generate a test certificate (requires openssl)
npm run dev -- generate-cert --serial MOLSTEM-TESTDEVICE12345678901234

# Run simulator
npm run dev -- run \
  --serial MOLSTEM-TESTDEVICE12345678901234 \
  --url localhost:8787 \
  --cert ./certs/MOLSTEM-TESTDEVICE12345678901234.crt \
  --key ./certs/MOLSTEM-TESTDEVICE12345678901234.key
```

## API Endpoints

### Authentication

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/google` | None | Start OAuth flow |
| GET | `/auth/google/callback` | None | OAuth callback |
| POST | `/auth/logout` | Session | Clear session |
| GET | `/auth/me` | Session | Current user info |

### Devices

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/device/register` | mTLS | Device registration |
| GET | `/api/devices` | Session | List user's devices |
| DELETE | `/api/devices/{serial}` | Session | Remove device |

### Enrollment

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/enrollment/{id}` | Session | Check enrollment status |
| POST | `/api/enrollment/{id}` | Session | Claim device |

### WebSocket

| Path | Auth | Description |
|------|------|-------------|
| `/ws/device` | mTLS | Device connection |
| `/ws/user?device={serial}` | Session | User connection |

## Enrollment Flow

1. Device calls `POST /api/device/register` with its serial number
2. Server returns an enrollment ID (e.g., `ENROLL-A1B2-C3D4`)
3. User logs in via Google OAuth
4. User enters the enrollment ID
5. User calls `POST /api/enrollment/{id}` to claim the device
6. Device connects to `/ws/device`
7. User connects to `/ws/user?device={serial}`
8. Messages are proxied bidirectionally

Ownership rules: a device registers on every boot. While it belongs to a user the
register reply is `{"enrolled": true}` and no code is issued (the LCD shows
`app.molstem.com` instead of an enrollment code). A claim with a code for a device
owned by someone else is refused with 409 and does **not** consume the code. Removing a
device on the Devices page sends `{"type":"reregister"}` to the connected device, which
immediately fetches a fresh code so a new owner can claim it without a reboot.

## Free Tier Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| Worker Requests | 100K/day | |
| D1 Reads | 5M/day | |
| D1 Writes | 100K/day | |
| D1 Storage | 500MB | |
| KV Reads | 100K/day | |
| KV Writes | 1K/day | |
| Durable Objects | 1M requests/month | |
| DO Storage | 1GB | |

## Troubleshooting

### Device can't connect
- Verify mTLS certificate is valid and CN matches device serial
- Check WAF rules aren't blocking legitimate requests
- Ensure device has registered first

### User can't connect to device
- Verify device is enrolled to user's account
- Check device is actually connected (`/status` endpoint on DO)
- Verify session cookie is present

### OAuth errors
- Verify redirect URI matches exactly in Google Console
- Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set correctly
