# Running Nexo InOuty

How to deploy the API and the web app, keep them healthy, back up the data
and handle the usual requests. For the code itself, see the README of each
repository.

## 1. What runs where

| Piece | Where it runs today | What it needs |
|---|---|---|
| API (this repository) | Render, web service | `MONGODB_URI`, `JWT_SECRET`, `FRONTEND_URL` |
| Web app | Vercel | `NEXT_PUBLIC_API_BASE_URL` |
| Database | MongoDB Atlas | Backups (see 4) |
| Clocking machines (ZKTeco) | At each company | Push to `https://<api>/iclock/...` (see 6) |
| Employee mobile app | Phones | The API's address |

Either can also run on a server of your own with Docker (see 2.3).

## 2. Deploying

### 2.1 API on Render

1. New Web Service from the repository, branch `main`.
2. Build command `npm ci && npm run build`, start command `npm run start:prod`.
3. Environment: everything in `.env.example`. `NODE_ENV=production`.
   `FRONTEND_URL` is the web app's address (`https://...`, comma-separated
   if there are several).
4. **Health check path: `/health`.** Render then waits for a new version to
   answer before switching to it, and restarts a version that stops
   answering.

Every push to `main` deploys. Merge `dev` into `main` only when CI is green
on `dev`.

### 2.2 Web app on Vercel

1. Import the web app's repository, framework Next.js, branch `main`.
2. Environment: `NEXT_PUBLIC_API_BASE_URL=https://<the API's address>`, and
   the support contacts if you want them on the Help page.
3. Add the Vercel address to the API's `FRONTEND_URL`.

### 2.3 Your own server, with Docker

```bash
git clone <API repository> && cd <folder>
cp .env.example .env        # JWT_SECRET, FRONTEND_URL
docker compose up -d --build
docker compose exec api npm run create-superadmin
```

This starts the API and a MongoDB whose data stays in the `mongo-data`
volume. Put a reverse proxy in front for HTTPS (Caddy does it in two
lines). The web app has its own `Dockerfile`:

```bash
docker build --build-arg NEXT_PUBLIC_API_BASE_URL=https://api.example.com -t nexo-web .
docker run -d -p 3000:3000 nexo-web
```

## 3. Is everything all right?

- **`GET /health`** answers `200 {"status":"ok","database":"up"}`, or `503`
  when the database can't be reached. Point an uptime monitor at it (every
  minute), alerting by email or SMS.
- **System errors** (super admin, in the app): every server error with the
  request that caused it. Look at it every day at first, then weekly.
- **Activity log**: who changed what, per company. The answer to "who
  deleted that?".
- **Login sessions** (super admin): who is signed in, from where. Revoke a
  session there if a device is lost.
- **API documentation**: `/docs` lists every route. Switch it off with
  `API_DOCS=off` if you don't want it public (the routes stay protected
  either way).

## 4. Backups

The whole product is in one MongoDB database. **Back it up every day, keep
at least 30 days, and test a restore every month**: a backup never restored
is a hope, not a backup.

### MongoDB Atlas

Turn on *Cloud Backup* for the cluster (Backup → Edit policy): daily
snapshots kept 30 days, plus weekly kept 3 months. Restoring is done from
the Atlas page, into a new cluster first (see "Testing a restore").

### Your own server

A daily copy with `mongodump`, kept 30 days:

```bash
# /etc/cron.d/nexo-backup — every night at 02:30
30 2 * * * root cd /srv/nexo && docker compose exec -T mongo \
  mongodump --db nexo --archive=/backups/nexo-$(date +\%F).gz --gzip \
  && find /srv/nexo/backups -name 'nexo-*.gz' -mtime +30 -delete
```

Copy the `backups/` folder off the server as well (another machine, or a
storage bucket): a backup on the same disk dies with it.

### Restoring

```bash
docker compose exec -T mongo mongorestore --gzip --drop \
  --archive=/backups/nexo-2026-11-16.gz
```

`--drop` replaces the current data. Restore into a test database first
(`--nsFrom 'nexo.*' --nsTo 'nexo_test.*'`) when only checking a backup, or
when you need a few records back rather than everything.

### Testing a restore (monthly)

Restore last night's backup into a test database, start an API on it
(`MONGODB_URI=.../nexo_test`), sign in, and open a company's planning and
payroll. Write down the date and how long it took.

## 5. Everyday requests

| Request | Where |
|---|---|
| A new customer | Companies → Add company (creates its first admin) |
| A trial, a paid period, a payment received | Companies → the company → Subscription |
| Change what a company can open | Companies → the company → Features and Pages, or give it another pack |
| A company didn't pay | Do nothing: at the end date it becomes read-only by itself; record the payment and it works again at once |
| A forgotten password | The company's admin: Users → Reset password. An admin's own: another admin, or the super admin inside the company |
| A month to correct after closing | Monthly Payroll → Reopen month (admins), correct, close it again |
| An employee who left | Employees → Archive (keeps their history and pay) |
| "Who changed this?" | Activity log, filtered by date or person |

## 6. Clocking machines (ZKTeco)

1. In the company's settings (super admin → Companies), add the machine's
   serial number (as the machine reports it, see the API logs on its first
   connection).
2. On the machine: *Comm → Cloud Server Setting*: server address = the API's
   address, port 443, HTTPS on if the firmware supports it.
3. Set the company's *Clocking machine time zone* (e.g. `+01:00`).

A machine that stops talking for more than 15 minutes shows up in the
admins' notifications. Check its power and network first.

## 7. When something goes wrong

| What you see | First things to check |
|---|---|
| Nobody can sign in | `/health` (database down?), then Render's logs. A changed `JWT_SECRET` signs everyone out (expected) |
| "Origin not allowed" in the browser | The web app's address is missing from `FRONTEND_URL` |
| One company sees "read-only" | Its subscription ended (Companies → the company) |
| A page or menu item is missing for a company | Its pack or features and pages (Companies → the company) |
| Pay looks wrong for a month | Is the month closed? A closed month shows the pay frozen at closing; reopen it to recalculate |
| A machine's punches don't arrive | Notifications → silent machine; the serial number in the company; the machine's server address |
| A server error a user reports | System errors: the user gives the reference shown in the message |

## 8. Before a release

1. CI green on `dev` (both repositories).
2. Merge `dev` into `main` in the API first, then in the web app (the web
   app may need new API routes; the API never needs a newer web app).
3. After deploying: `/health`, sign in, open Home and Monthly Payroll.
4. If something is wrong: redeploy the previous version from Render's and
   Vercel's dashboards (one click each), then investigate.
