# QA runbook (Master checklist execution)

This runbook implements the **Master QA checklist** as an executable guide. Do not edit the Cursor plan file; update this document with dated results if you keep an internal log.

**Automated helpers:** `npm test`, `npm run build:client`, `npm run qa:smoke` (requires server running).

---

## 0. Preconditions

Complete [QA_ENV_MATRIX.md](./QA_ENV_MATRIX.md) (build mode, auth tier, viewport, SW cleared).

---

## 1. Global shell (AppLayout)

| # | Check | Pass |
|---|--------|------|
| 1.1 | Age disclaimer: first visit, accept, persistence | ☐ |
| 1.2 | Background canvas loads without console errors | ☐ |
| 1.3 | Top ad banner: layout not overlapping content (`--ad-h`) | ☐ |
| 1.4 | TopNav: Home, Shorts, Upload, Support, Premium, Search; active states | ☐ |
| 1.5 | Mobile: hamburger opens sidebar; overlay closes | ☐ |
| 1.6 | Leaderboard dock visible on non-home routes only | ☐ |
| 1.7 | Auth modal opens/closes; ESC | ☐ |
| 1.8 | Redeem key modal from profile | ☐ |
| 1.9 | Footer TOS/DMCA links | ☐ |
| 1.10 | No horizontal scroll on `.main-content` at 390px | ☐ |

---

## 2. Routing and legacy URLs

| # | URL | Expected | Pass |
|---|-----|----------|------|
| 2.1 | `/index.html` | Redirect to `/` | ☐ |
| 2.2 | `/shorts.html` | Redirect to `/shorts` | ☐ |
| 2.3 | `/checkout.html` | Redirect to `/checkout` | ☐ |
| 2.4 | `/premium` | Redirect to `/checkout` | ☐ |
| 2.5 | `/omegle-wins` | Folder page (Omegle) | ☐ |
| 2.6 | `/folder?folder=...` | Folder page | ☐ |
| 2.7 | Unknown path | NotFound page | ☐ |

---

## 3. Per-page smoke

| # | Page | Pass |
|---|------|------|
| 3.1 | Home — grid, hero, referral strip | ☐ |
| 3.2 | Category folder — sort, pagination, **4-col desktop no clip**, local name filter | ☐ |
| 3.3 | Video (query) — player, stats | ☐ |
| 3.4 | Video by slug `/:cat/:slug` | ☐ |
| 3.5 | Search — query + empty | ☐ |
| 3.6 | Categories hub | ☐ |
| 3.7 | Shorts | ☐ |
| 3.8 | Upload — gate + form | ☐ |
| 3.9 | Live cams | ☐ |
| 3.10 | Custom requests form | ☐ |
| 3.11 | Blog | ☐ |
| 3.12 | Login / Signup / Create account | ☐ |
| 3.13 | Checkout — tiers, redeem link, **no accidental payment** | ☐ |

---

## 4. Shared components

| # | Component | Pass |
|---|-----------|------|
| 4.1 | VideoCard — thumb, lock, link | ☐ |
| 4.2 | CustomVideoPlayer — controls, fullscreen | ☐ |
| 4.3 | ProfileMenu — login, authed dropdown, logout | ☐ |

---

## 5. API smoke (automated)

Run `npm run qa:smoke` with server up. See script output for `/api/health`, `/api/ping`, `/api/me`, `/api/folder-counts`, etc.

Manual: admin `/admin` (password from rotation), Stripe webhook (test mode only).

---

## 6. Responsive / scaling

| # | Check | Pass |
|---|--------|------|
| 6.1 | Category grid: 4 columns desktop, no right-edge clip | ☐ |
| 6.2 | Modals fit 390px height | ☐ |
| 6.3 | Landscape mobile: nav + ad | ☐ |

---

## 7. Accessibility (smoke)

| # | Check | Pass |
|---|--------|------|
| 7.1 | Tab through nav and first form | ☐ |
| 7.2 | ESC closes modals | ☐ |
| 7.3 | Icon buttons have `aria-label` where icon-only | ☐ |

---

## 8. Regression quick path (each deploy)

1. Home loads  
2. One SEO category loads + one video  
3. Search with query  
4. Login modal or `/login`  
5. Open checkout (no pay)  
6. `npm run qa:smoke` green  

---

## Reference

- [route-manifest.md](./route-manifest.md) — HTTP API list  
- [ARCHITECTURE.md](./ARCHITECTURE.md) — SPA vs server  
