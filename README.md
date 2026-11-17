# Nexo InOuty — API

The server of Nexo InOuty: planning, clock-in (kiosk, face-recognition
machines, manual), attendance, payroll, payslips, month closing, packs and
subscriptions, for many companies at once. The
[web app](https://github.com/TenachiLina/FinalFrontEndOtherVersion) and the
employee mobile app use it.

Built with NestJS 11, MongoDB (Mongoose 9) and TypeScript.

## What it does

| Area | Routes | Notes |
|---|---|---|
| Sign-in and sessions | `/auth/*`, `/login-sessions` | Short access tokens renewed with one-use refresh tokens; brute-force lock-out |
| Companies (super admin) | `/companies`, `/packs`, `/companies/:id/subscription` | Features and pages per company, packs, trials, payments recorded by hand |
| People | `/employees`, `/users`, `/company` | Archiving instead of deleting; pack employee limit |
| Planning | `/planning`, `/shifts`, `/tasks` | Day grid, copy a month, import, Excel/PDF exports |
| Clock-in | `/kiosk`, `/worktime`, `/attendance`, `/iclock/*` | `/iclock` is the ZKTeco machines' push (ADMS) |
| Pay | `/payroll/*`, `/advances`, `/bonuses` | Pay is calculated here (`src/payroll/payroll.calc.ts`); closed months are frozen |
| Day to day | `/dashboard`, `/notifications`, `/corrections` | Home figures, alerts, employees' correction requests |
| Employee app | `/me/*` | An employee's own planning, hours, advances, bonuses |
| Logs | `/audit-logs`, `/error-logs` | Activity log of every change, and server errors |
| Health | `/health` | For uptime checks and the hosting platform |

The full list of routes, with what each one accepts, is served at
**`/docs`** (Swagger UI) when the server runs.

### Rules every request goes through

1. **Company isolation.** Every company's records carry its id, and every
   query is limited to the current company automatically
   (`src/tenancy/tenant.plugin.ts`). Without a company, nothing runs.
2. **Access.** The guard (`src/auth/auth.guard.ts`) checks the session, the
   role, the company's features and pages, and the subscription: after it
   ends, the company is read-only.
3. **Validation.** Request bodies are checked against the fields each route
   accepts (`src/common/validate.ts`); unknown fields are dropped and
   MongoDB operators refused.
4. **Messages** go back in the user's language (English, French, Arabic;
   `src/common/messages.i18n.ts`).
5. **Activity log.** Every change is recorded with who made it
   (`src/audit`).

## Run it

Requirements: Node.js 22 or later and MongoDB 7 or later (or a MongoDB Atlas
cluster).

```bash
npm ci
cp .env.example .env          # then fill it in, see below
npm run start:dev             # http://localhost:3001
npm run create-superadmin     # the first account, to create companies
```

Or with Docker, MongoDB included:

```bash
docker compose up --build
```

### Settings (`.env`)

| Variable | What it is |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | At least 64 random characters; changing it signs everyone out |
| `FRONTEND_URL` | Web app address(es) allowed to call the API, comma-separated, `https://` in production |
| `ACCESS_TOKEN_TTL`, `SESSION_IDLE_TIMEOUT`, `SESSION_MAX_AGE` | Session timings |
| `RATE_LIMIT_PER_MINUTE` | Requests per minute per address |
| `SSL_CERT_PATH`, `SSL_KEY_PATH` | Local HTTPS only (see below) |
| `FORCE_HTTPS`, `TRUST_PROXY` | Production behind a proxy (defaults are right for Render) |
| `DEVICE_IP`, `DEVICE_COMPANY_ID` | Fallback for a clocking machine with no address saved yet |

## Tests

```bash
npm test               # everything (unit + integration)
npm run test:cov       # same, with the coverage gate used by CI
npm run test:security # security checks only
```

Integration tests start their own in-memory MongoDB: no database to set up.
Conventions and the known-bug log are in `docs/TESTING.md` and
`docs/TEST_FINDINGS.md`. CI (`.github/workflows/ci.yml`) runs lint, the
build and the tests with coverage on every push to `dev` and `main`.

## Deploy and operate

See **`docs/OPERATIONS.md`**: deploying (Render or Docker), the health
check, backups and restoring them, adding a company, connecting a ZKTeco
machine, and what to do when something goes wrong.

## Security

Automated checks: `npm run test:security` (uses a throw-away in-memory MongoDB).

### HTTPS

Production (Render): Render serves HTTPS; the app trusts its proxy (`TRUST_PROXY`,
default 1 hop in production), redirects/refuses plain HTTP (`FORCE_HTTPS`, on by
default in production) and sends HSTS. `FRONTEND_URL` must use `https://`.
The ZKTeco machine (`/iclock/*`) is the only plain-HTTP exception.

Local development over HTTPS:

1. In the web app's folder run `npm run dev:https` once. Next.js creates a
   trusted certificate for `localhost` in `certificates/` (it installs a local
   certificate authority with mkcert; Windows asks you to confirm).
2. In this backend's `.env`:
   ```
   SSL_CERT_PATH=../FinalFrontEndOtherVersion/certificates/localhost.pem
   SSL_KEY_PATH=../FinalFrontEndOtherVersion/certificates/localhost-key.pem
   ```
   (paths are relative to the folder you run `npm run start:dev` from)
3. In the web app's `.env.local`: `NEXT_PUBLIC_API_BASE_URL=https://localhost:3001`
4. Open https://localhost:3000.

### Sessions and tokens

- Sign-in creates a record in `login_sessions` (device, IP, current token id,
  expiry, renewals, end reason) and returns an access token (15 min) and a
  refresh token.
- The app renews both tokens automatically; each refresh token works once.
  Reusing an old one ends the session (stolen token).
- `ACCESS_TOKEN_TTL`, `SESSION_IDLE_TIMEOUT`, `SESSION_MAX_AGE` tune the timings.

## Licence

Private and unlicensed (`UNLICENSED` in `package.json`): all rights reserved.
