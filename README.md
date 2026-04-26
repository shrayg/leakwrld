# Pornyard

Monorepo: **Node HTTP API + static/media** (`server.js`) and **React SPA** (`client/`, Vite). Production serves the built app from **`client/dist`** (see **`Dockerfile`**).

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
