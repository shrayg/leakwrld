# Leak World

Clean rebuild: Vite + React frontend, small Node HTTP API, and PostgreSQL for users, sessions, creators, media metadata, and queue state.

## Commands

```bash
npm install
npm run dev
npm run build
npm start
```

## Database

**One PostgreSQL instance** on the VPS is enough: relational tables for users, referrals, catalog, payments, and append-only analytics (`analytics_visits`, `analytics_events`). At very large scale you might add a columnar warehouse later; start with Postgres only.

### New database

Set `DATABASE_URL`, then apply the full schema:

```bash
npm run db:schema
```

### Existing database (upgrade from the older baseline)

```bash
npm run db:migrate
npm run db:backfill-referrals
```

`db:migrate` adds columns and analytics tables. `db:backfill-referrals` assigns every user a unique **6-character referral code** (charset without ambiguous `0/O/1/I`).

### Analytics HTTP endpoints (for the admin SPA / beacons)

| Endpoint | Purpose |
|----------|---------|
| `POST /api/analytics/visit` | Page view / session attribution (`visitorKey`, `path`, `referrer`, optional UTM fields). |
| `POST /api/analytics/event` | Structured events (`eventType`, optional `category`, `payload`). |
| `POST /api/analytics/ping` | Authenticated-only; accumulates `site_time_seconds` and `watch_time_seconds` on the user row (capped per request). |

Media-level aggregates (views, likes, watch totals **without** per-user linkage) live on `media_items` (`watch_seconds_total`, `watch_sessions`; like ratio = `likes` / `views`).

The app seeds the first 100 creator records and starter shorts on first API read if the `creators` table is empty.

## Environment

```bash
DATABASE_URL=postgres://user:password@localhost:5432/leakworld
SESSION_SECRET=replace-with-random-secret
PORT=3002
ONLINE_CAPACITY=100
SKIP_QUEUE_PRICE_CENTS=499
```

Payments are intentionally stubbed until the new VPS deployment and billing provider are chosen.

## Deploy on Ubuntu VPS

1. **SSH** from your machine (you must type the password interactively — automated login from here is not available without an SSH key):

   ```bash
   ssh root@YOUR_SERVER_IP
   ```

2. **Bootstrap** (installs Node 20, Postgres, nginx, clones this repo, runs `npm ci`, `npm run build`, `npm run db:schema`, systemd + nginx):

   ```bash
   apt-get update && apt-get install -y git
   git clone https://github.com/shrayg/leakwrld.git /opt/leakwrld
   sudo bash /opt/leakwrld/scripts/deploy/vps-bootstrap.sh
   ```

   Or copy `scripts/deploy/vps-bootstrap.sh` to the server and run it. The script writes `/opt/leakwrld/.env` with a generated `DATABASE_URL` and `SESSION_SECRET` — **back up `.env`** off the server.

3. **Verify:** `systemctl status leakwrld` and open `http://YOUR_SERVER_IP/` (nginx proxies to the app on port 3002).

**HTTPS:** install Certbot on the server and point DNS at the VPS when you have a domain.

**Security:** change the VPS root password after sharing it anywhere, and prefer SSH keys (`ssh-copy-id`) instead of password login.
