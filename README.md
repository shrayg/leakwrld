# Pornwrld

Monorepo: **Node HTTP API + static/media** (`server.js`) and **React SPA** (`client/`, Vite). Production serves the built app from **`client/dist`**.

| Doc | Contents |
|-----|----------|
| **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** | Layers, folder layout, routing, checkout iframe |
| **[docs/route-manifest.md](docs/route-manifest.md)** | API and HTTP routes (canonical list lives in `server.js`) |
| **[CLAUDE.md](CLAUDE.md)** | Deploy and manual test expectations for agents |

## Commands

```bash
npm install
npm run dev          # API + Vite (see package.json)
npm run build        # client/dist via Vite
npm start            # node server.js
npm test             # node --test tests/*.test.js
```

Do not commit **`.env`**, cookie dumps, or **`data/`** (runtime DB).

## Deploy (Fly.io)

The [Dockerfile](Dockerfile) runs `npm run build` then serves **`client/dist`** via `server.js`. [fly.toml](fly.toml) sets `PORT=8080` and `/api/health` for checks.

```bash
fly deploy
```

**Secrets:** Mirror your local `.env` into Fly (values are never committed). See [.env.example](.env.example) for key names. Example:

```bash
fly secrets set TBW_PUBLIC_ORIGIN=https://your-domain.example \
  CLOUDFLARE_R2_ACCESS_KEY_ID=... \
  CLOUDFLARE_R2_SECRET_ACCESS_KEY=... \
  CLOUDFLARE_R2_ENDPOINT=... \
  CLOUDFLARE_R2_BUCKET_RAW=... \
  TBW_PEPPER=...
```

Then redeploy so the app resolves R2 and serves media. Optional: `fly secrets list` (names only).

**R2 + CSP:** Production CSP already allows `https://*.r2.cloudflarestorage.com` for media/images (see `server.js`).
