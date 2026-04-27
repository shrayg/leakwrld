# CLAUDE.md — Pornwrld Instructions

## Current stack

- Runtime: Node server (`server.js`) + Vite React SPA (`client/src`).
- Styling: `styles.css` + `client/src/app.css` with Inter + tokenized theme.
- Storage/auth: Supabase + Cloudflare R2 integrations remain active.

## Required validation

- Run `npm run build` and `npm test` after substantive changes.
- Smoke-check desktop + mobile navigation and account menu flows.
- When touching auth/account paths, verify `/api/me` and `/api/account`.

## Deployment baseline

- Main deployment target is push-ready source on `main`.
- If service worker behavior changes, bump cache key in `sw.js`.

## Cleanup rule

- Remove unused/legacy artifacts aggressively when not needed by runtime, build, or deployment path.
