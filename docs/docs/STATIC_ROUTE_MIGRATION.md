# Static Route Audit and React-Only Migration

This document identifies remaining legacy/static behavior and how to migrate to fully React-driven routing.

## Current static-only or static-first surfaces

From `server.js` routing and static handling:

- `GET /checkout` and `/checkout.html` (legacy checkout HTML)
- `GET /admin` and `/admin/*` (admin.html + admin APIs)
- `GET /5e213853413a598023a5583149f32445.html` (verification file)
- `GET /sw.js` and `GET /manifest.json` (PWA static assets)
- `GET /whitney-fonts.css` and `GET /fonts/*` (font assets)
- `GET /styles.css` (global stylesheet consumed by SPA and static pages)

## Hybrid compatibility routes still supported

These route forms are intentionally mapped to SPA for bookmark compatibility:

- `/index.html`
- `/folder.html`
- `/video.html`
- `/shorts.html`
- `/custom-requests.html`
- `/categories.html`
- `/live-cams.html`
- `/blog.html`
- `/login.html`
- `/signup.html`
- `/create-account.html`
- `/upload.html`
- `/search.html`

## Why font looked inconsistent

Whitney is self-hosted in `client/public` and expected at:

- `/whitney-fonts.css`
- `/fonts/whitney/*.otf`

If these are not explicitly served from `client/dist`, browser falls back to non-Whitney fonts.

## React-only migration checklist

1. Replace `checkout.html` with `CheckoutPage.jsx` + API calls currently used by legacy checkout.
2. Move admin shell UI from `admin.html` to `client/src/pages/AdminPage.jsx` while keeping `/admin/api/*` server APIs.
3. Remove `*.html` legacy route aliases from `App.jsx` once redirects are no longer needed.
4. Narrow `STATIC_ALLOWLIST` to only immutable assets (`sw.js`, `manifest.json`, verification file, fonts, images).
5. Move global root `styles.css` into `client/src/styles` and import via `main.jsx` only (optional but cleaner).
6. Keep `server.js` SPA shell serving for clean URLs; avoid direct HTML files except verification.

## Suggested rollout order

1. Checkout migration
2. Admin page migration
3. Legacy alias cleanup
4. Static allowlist hardening

This order minimizes payment/admin regressions while progressively removing legacy behavior.
