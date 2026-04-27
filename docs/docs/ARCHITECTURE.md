# Pornwrld architecture

Index: [docs/README.md](./README.md) · [Project root README.md](../README.md)

## Production surface

| Layer | Role |
|--------|------|
| **`server.js`** | HTTP API (`/api/*`), OAuth callbacks, Stripe, media proxy, `/admin/*`, SEO (`/sitemap.xml`). Serves **`client/dist`** as the React SPA for almost all HTML routes when `npm run build` has been run. |
| **`client/`** | Vite + React SPA (`client/src`). Entry: `client/src/main.jsx` → `App.jsx` → routes + `AppLayout` (shell: nav, ads, leaderboard, modals). |
| **`checkout.html`** | Standalone XYZPurchase checkout UI at **`/checkout.html`**. Embedded full-viewport by `CheckoutStandalonePage` (`/checkout`). Not part of the SPA bundle. |
| **`styles.css`** (repo root) | Global styling; imported by the SPA via `client/src/main.jsx`. |
| **`images/`** | Site UI raster assets (**`/images/…`** URLs); see `images/README.md`. Legacy `/face.png` etc. redirect with **301**. |
| **`sw.js`** | Service worker (precache shell assets; network-first for `/assets/*`). Bump `CACHE_NAME` when changing precache list or forcing client refresh. |
| **`lib/xyzpurchase.js`** | Shared helpers for access keys / plan slugs; **`server.js`** requires it; **`tests/xyzpurchase.test.js`** covers it. |

## React SPA layout (`client/src`)

```
client/src/
  App.jsx                 # Routes; checkout uses CheckoutStandalonePage (iframe → /checkout.html)
  main.jsx                # BrowserRouter, ShellProvider, global CSS
  api/client.js           # Same-origin fetch wrappers
  context/ShellContext.jsx
  components/
    layout/AppLayout.jsx  # BgCanvas, ads, leaderboard, auth/referral/redeem, footer
    navigation/TopNav.jsx # Desktop overflow “More” menu
    shell/                # Modals, age gate, URL query hooks
    auth/ProfileMenu.jsx
    home/                 # Homepage-only sections (folder grid, trending, …)
    media/VideoCard.jsx
    video/CustomVideoPlayer.jsx
  pages/                  # One file per route
  hooks/                  # useAuth, useNavOverflowSplit, …
  lib/                    # seoTitle, cleanUrls, folderMedia, time
  constants/lockedVideos.js
```

## Server routing (high level)

1. **API / auth / media** — handled before static files.
2. **Vite SPA** — If `client/dist/index.html` exists, GET requests matching SPA routes receive the built `index.html` (with `{{BASE_URL}}` replaced). Legacy `*.html` filenames (e.g. `/video.html`) still map to the SPA shell for bookmark compatibility.
3. **`/checkout` and `/premium`** — Resolve to **`checkout.html`** (legacy checkout, not the SPA).
4. **Static allowlist** — Remaining root files: `checkout.html`, `styles.css`, `sw.js`, images, verification HTML, etc. Old multi-page files (`index.html`, `script.js`, …) were removed; do not re-add without updating `STATIC_ALLOWLIST` and deploy flow.

## Ops / optional scripts

- **`scripts/reddit-monitor.js`** — Local Reddit scanner (not started by the server). Run with `node scripts/reddit-monitor.js`.

## Deploy

Build the client before release: **`npm run build`** (outputs to **`client/dist`**) so `server.js` can serve the SPA.
