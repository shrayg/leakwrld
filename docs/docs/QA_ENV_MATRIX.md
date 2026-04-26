# QA environment matrix

Use this before any full or smoke regression pass. Aligns with the Master QA checklist (plan: Master QA checklist).

## Build / serve mode

| Mode | Command | Notes |
|------|---------|--------|
| **Production-like** | `npm run build && npm start` | Serves `client/dist` from `server.js`; matches Fly deploy behavior. |
| **Dev (split)** | `npm run dev` | Vite HMR + API proxy; asset URLs differ from prod — use for feature work, then re-verify on production build. |

## Auth / tier states

| State | How to obtain | What it affects |
|-------|----------------|-----------------|
| **Anonymous** | Private window or clear `tbw_session` | Preview lists, gated `/api/list`, login CTAs |
| **Logged in, free** | Account with tier 0 | Same as above for library unless preview works |
| **Logged in, tier 1+** | Redeem key or admin-set tier | Full folder lists, `/api/videos` search library |

## Viewports (manual)

| Label | Width | Focus |
|-------|-------|--------|
| Mobile | 390px | Nav hamburger, quick Home/Shorts, modals, category grid columns |
| Tablet | 768px | Nav overflow “More”, main column width |
| Desktop | 1024px+ | Full top nav, 4-column category grids (when implemented) |
| Large | 1440px+ | Max-width `.main-content`, leaderboard dock |

## Service worker / cache

| Step | Action |
|------|--------|
| Before testing shell or after `sw.js` bump | DevTools → Application → Service Workers → Unregister; **hard refresh** (Ctrl+Shift+R) |
| Verify precache | [sw.js](../sw.js) `CACHE_NAME` matches expected version after deploy |

## Cookies and age gate

| Check | Expected |
|-------|----------|
| After logout | Session cleared; see ProfileMenu — `age_verified` may remain or clear per product (verify once) |
| Fresh session | Age disclaimer shows until accepted |

## Browsers (full pass)

- Chromium (Chrome/Edge)
- Firefox
- Safari / WebKit (macOS or Playwright webkit)

## External dependencies (smoke)

| Dependency | If missing |
|------------|------------|
| R2 configured | Media/list may fail or fall back — note in run results |
| Supabase | `/api/redeem-key` may fail — use staging keys for QA |
| Stripe | Use test keys only; never run real charges in QA |
