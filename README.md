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

**VPS / `sudo`:** plain `sudo -u leakwrld npm run db:schema` often **drops `DATABASE_URL`**, so `psql` falls back to your Linux username and Postgres looks for a role named `leakwrld` (which does not exist). Source `.env` inside the target user’s shell:

```bash
sudo -u leakwrld bash -lc 'cd /opt/leakwrld && set -a && . ./.env && set +a && npm run db:schema'
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

Copy **`.env`** in the repo root (gitignored — create from scratch or sync from your password manager). Keys:

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string |
| `SESSION_SECRET` | Cookie / session signing |
| `PORT`, `HOST` | Node HTTP bind (`HOST=127.0.0.1` typical behind nginx) |
| `SECURE_COOKIES` | Set `1` when serving HTTPS |
| `ONLINE_CAPACITY`, `SKIP_QUEUE_PRICE_CENTS` | Queue endpoint |

**Recommended on VPS:** **`R2_WORKER_ORIGIN`** — same public **`https://…workers.dev`** URL as your Worker. Set in **`.env`**, **`systemctl restart leakwrld`** only — Node proxies **`/r2/*`** to Cloudflare (no `npm run build`, no R2 keys).  

Alternative: **`VITE_R2_PUBLIC_BASE`** at **build** time (browser hits Worker directly). Or **nginx** `location /r2/` → Worker — see Deploy.

### Empty “Top creators” on the deployed site

The API only lists creators marked **ready** (real counts in `client/src/data/media-summary.json`). If the server could not read that file (older builds only loaded `data/media-summary.json`), the grid was empty — fixed by loading both paths in `server/catalog.js`. After deploy, **`git pull`**, **`npm run build`**, **`sudo systemctl restart leakwrld`**.

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

### Media files (`/r2/*`) work locally but not on the VPS

Locally, **Vite** forwards `/r2/*` to Node, and Node streams with **rclone** when `RCLONE_CONFIG_R2_*` is set. On the VPS, **without rclone**, Node used to return **503** for every `/r2/` request — thumbnails and lightbox break.

Pick **one**:

**A — `R2_WORKER_ORIGIN` (recommended)** — no client rebuild. Add to **`/opt/leakwrld/.env`**:

```bash
R2_WORKER_ORIGIN=https://leakwrld-r2.YOUR_SUBDOMAIN.workers.dev
```

Then **`sudo systemctl restart leakwrld`**. The browser still requests **`https://your-site/r2/videos/...`** (same origin); Node **proxies** to the Worker (forwards `Range` for video).

If you previously set **`VITE_R2_PUBLIC_BASE`**, the built JS may still load media **directly** from Cloudflare and **ignore** this proxy. Either remove that line and **`npm run build`** again, or fix the Worker URL in `VITE_*`.

**B — `VITE_R2_PUBLIC_BASE` at build time** — browser loads media straight from the Worker; requires correct URL whenever you **`npm run build`**.

**C — Nginx `location /r2/`** → Worker (nginx snippet stays valid).

Only the Worker’s **HTTPS hostname** is needed — not Cloudflare account API keys.

**HTTPS:** install Certbot on the server and point DNS at the VPS when you have a domain.

**Security:** change the VPS root password after sharing it anywhere, and prefer SSH keys (`ssh-copy-id`) instead of password login.
