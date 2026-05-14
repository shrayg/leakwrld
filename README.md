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

**What lives where (same DB):**

| Area | Tables |
|------|--------|
| Accounts | `users` (username, email, password hash, tier, IPs, watch/site seconds, 6-char `referral_code`, `referral_signups_count`, `referred_by_user_id`) |
| Referrals | `referral_signups` (referrer, referred user, code used) + trigger keeps counts on `users` |
| Media (aggregate, no per-viewer PII) | `media_items` (`views`, `likes`, `watch_seconds_total`, `watch_sessions` → avg watch & like ratio) |
| Traffic | `analytics_visits`, `analytics_events` |
| Admin UI | `/admin` reads these via `/api/admin/dashboard` and paginated `/api/admin/*` routes |

No second database type is required unless you later add dedicated search/analytics infrastructure.

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
| `POST /api/analytics/event` | Structured events (`eventType`, optional `category`, `payload`). Includes **`media_load_timing`** (client media performance sampling: `metadataMs`, optional `responseStart` / `duration` from Resource Timing, `stallCount`, `error`, `surface`). |
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
| `SECURE_COOKIES` | Set `1` only when the **browser** loads the site over **HTTPS** (required for `Secure` session cookies). Leave unset/`0` for `http://` or cookies are ignored and login appears broken. |
| `ADMIN_DISCORD_WEBHOOK_URL` | Optional. **Secret** — do not commit. If set, the server posts the **`/admin` password** (and site label) here. **Regenerate the webhook** if the URL leaks. |
| `PUBLIC_SITE_URL` | Shown with the admin Discord message (e.g. `http://45.156.87.83` or your domain) so you can tell localhost vs production. |
| `ADMIN_SESSION_SECRET` | Optional separate HMAC secret for the admin cookie; defaults to `SESSION_SECRET`. |
| `ONLINE_CAPACITY`, `SKIP_QUEUE_PRICE_CENTS` | Queue endpoint |
| `MEDIA_SIGNING_SECRET` | Optional dedicated HMAC secret for **signed playback URLs** (defaults to `SESSION_SECRET`). Must match **`wrangler secret put MEDIA_SIGNING_SECRET`** on the R2 Worker. |
| `MEDIA_PUBLIC_ORIGIN` | Public **https** origin for signed media (usually same as `R2_WORKER_ORIGIN`). Exposed to the browser via `/api/site-config`. |
| `MEDIA_SIGN_TTL_SEC` | Signed URL lifetime in seconds (default `3600`, max `86400`). |

**Catalog precalc (Postgres):** run migration `009_catalog_precalc.sql` (`npm run db:migrate`), then **`npm run catalog:rebuild`** after `media:sync` so `/api/shorts/feed` reads from `catalog_shorts` instead of rebuilding manifests per request.

**Thumbnails on disk:** Node serves **`/cache/thumbs/*`** from `data/thumb-cache/` (override with env `THUMB_CACHE_DIR` if you add it later). In production, point **nginx** `alias` at the same directory for zero-copy static delivery.

**HLS ladder:** `npm run media:transcode:hls` (see `scripts/media-transcode-hls.mjs`) writes `…/hls/master.m3u8` next to each MP4; upload to R2, then `catalog:rebuild -- --force`. The Worker rewrites `.m3u8` playlists so child segments load with the same `exp`/`sig` model.

**`/admin`:** Password login + optional Discord notification (webhook env). Uses cookie `lw_admin` (independent of member login). Anyone with the webhook URL can see passwords — treat Discord channel access as sensitive.

**Recommended on VPS:** **`R2_WORKER_ORIGIN`** — same public **`https://…workers.dev`** URL as your Worker. Set in **`.env`**, **`systemctl restart leakwrld`** only — Node proxies **`/r2/*`** to Cloudflare (no `npm run build`, no R2 keys).  

Alternative: **`VITE_R2_PUBLIC_BASE`** at **build** time (browser hits Worker directly). Or **nginx** `location /r2/` → Worker — see Deploy.

### Login/signup succeeds but header still shows “Login”

Usually **`SECURE_COOKIES=1`** in `.env` while visitors use **`http://`**. Session cookies are marked `Secure`, so the browser drops them. Use **`SECURE_COOKIES=0`** until HTTPS is configured, **or** enable HTTPS and set **`SECURE_COOKIES=1`**, then **`sudo systemctl restart leakwrld`**.

List recent accounts:

```bash
sudo -u leakwrld bash -lc 'cd /opt/leakwrld && set -a && . ./.env && set +a && psql "$DATABASE_URL" -c "select username, email, referral_code, created_at from users order by created_at desc limit 15;"'
```

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

### Thumbnail HTTP caching

The Node static handler sends **`Cache-Control: public, max-age=10800`** (3 hours) for files under **`/thumbnails/`** (creator grid **WebP** files in `client/public/thumbnails/*.webp`) so updates propagate within a few hours. Hashed **`/assets/`** and **`/fonts/`** still use **`max-age=31536000, immutable`**.

Convert existing JPEG creator thumbnails locally: **`npm run thumbs:convert`** (writes **`.webp`**, deletes **`.jpg`**). **`npm run thumbs:convert:force`** overwrites existing WebPs. Requires **`sharp`** (`npm ci`). No R2 or ffmpeg.

For **`/r2/*`** images: production responses come from the Worker (already long-lived **`immutable`** for tiered vault keys). Node **rewrites** cache policy only for **non–free-tier** media (`private, max-age=300`). Local **rclone** streaming uses **`immutable`** (~30d) for **public/free image** extensions so dev matches production disk-cache behavior.

If you replace a **`/thumbnails/`** file **at the same URL**, some browsers may still show the old bytes until the **3-hour** window expires — use a **new filename** or query string when you need an immediate update.

**Catalog short-card previews** still use **`mediaUrl(key)`** (same asset as playback) but **defer loading** until the card is near the viewport so off-screen rows do not spike bandwidth. Separate tiny poster URLs would further reduce bytes.

### Nginx tuning when Node proxies `/r2/*` to the Worker

If nginx sits in front of Node for HTML **and** you proxy `/r2/` through Node (default app setup), large video bodies benefit from **generous read timeouts** and buffering to the client:

- Raise **`proxy_read_timeout`** (e.g. `300s` or higher) on the `location` that forwards to Node so long R2 streams are not cut off mid-body.
- Keep **`proxy_http_version 1.1`** and **`proxy_set_header Connection ""`** for upstream keep-alive to the Worker.
- If you terminate TLS at nginx, ensure **`proxy_buffering`** matches your goals: `on` can smooth bursts to slow clients; `off` lowers latency to first byte but loads nginx RAM.

Tune based on **`journalctl -u leakwrld`** and nginx error logs when users report stalls.

### Architecture choice: Node hop vs direct Worker

- **Today:** the browser hits **same-origin `/r2/*`**, Node enforces **tier cookies**, then `fetch`es the Cloudflare Worker. Video playback uses **HTTP Range** requests; the Worker’s edge cache only applies to **full GETs without `Range`**, so most bytes are **origin/R2 speed**, not CDN cache.
- **Future (faster):** serve **public/free** objects from a **CDN-custom hostname** on the Worker with long **`immutable`** cache headers, and keep **paid tiers** behind Node or **signed short-lived URLs** so entitlements stay correct. The Worker’s `authorizeTier` hook in `worker/src/index.js` is the intended place to wire session checks if you move gating to the edge.

### Thumbnail derivatives (planned)

Catalog grids and short cards currently use **full-size** R2 objects for previews where `mediaUrl(key)` is used. The scalable approach is to **generate and store** small WebP (or AVIF) derivatives during ingest (e.g. `thumbnails/{hash}.webp` or `*_thumb.webp` next to originals), expose their paths in manifests or `media_items`, and use **`srcset` / `sizes`** in `CreatorCard` / `ShortCard`. Optional: a **Worker image** route (`cf.image`) or imgproxy for on-the-fly resize—avoid heavy resize on the Node process.
