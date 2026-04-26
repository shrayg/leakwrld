# CLAUDE.md — Pornyard Project Instructions

## Testing Requirements

- **Always test every change in the browser before reporting done.** Never assume a fix works without verifying visually.
- After pushing, wait for Fly.io deploy to complete (check `sw.js` version or GitHub Actions).
- Clear service worker caches in the browser before verifying (SW caches shell assets and `/assets/*` responses).
- Test on both desktop and mobile viewports (resize to 390px width for mobile).
- When changing the profile dropdown: open the dropdown and click each changed button to confirm it works.
- When changing navigation: verify on mobile (hamburger, quick-nav buttons) and desktop.
- When changing modals/overlays: actually open them and verify content/layout.

## Deployment

- Fly.io auto-deploys on push to `main` via GitHub Actions (`.github/workflows/deploy.yml`).
- Deploy takes ~60–90 seconds.
- Always bump `sw.js` cache version (e.g. `pornyard-v73` → `pornyard-v74`) when changing precache behavior or forcing clients to refresh.

## Architecture (SPA-first)

The public site is the **React SPA** in **`client/`** (Vite build → **`client/dist`**). **`server.js`** serves `client/dist/index.html` for app routes when the build exists.

- **UI code:** `client/src/` — routes in `App.jsx`, shared shell in `components/layout/AppLayout.jsx`, API in `api/client.js`.
- **Global CSS:** Root **`styles.css`** (imported from `client/src/main.jsx`).
- **Checkout:** **`CheckoutPage.jsx`** + **`client/src/pages/checkout/checkout-page.css`** at **`/checkout`** (Vite bundle).
- **Legacy removed:** Root **`index.html`**, **`script.js`**, **`nav.js`**, and old multi-page HTML files were deleted; behavior lives in the SPA. See **`docs/ARCHITECTURE.md`** for layout and server routing details.
- **Server-shared helpers:** **`lib/xyzpurchase.js`** (required by `server.js`; tests in `tests/xyzpurchase.test.js`).
- **Optional tooling:** **`scripts/reddit-monitor.js`** (local Reddit monitor; not used by production server).

## Recurring tasks

- **Redgif preset rotation (every 6h)** — see `../redgif_rotation_instructions.md`. Referral “GET REFERRALS FAST” flow uses presets in the SPA (`ReferralModals` / related); update preset URLs on the same cycle as before.
