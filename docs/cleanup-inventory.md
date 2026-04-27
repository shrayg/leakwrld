# Cleanup Inventory

## Safe removals (non-runtime)

- `reference-pornwrld/` (reference clone, not runtime)
- `.next/` (legacy Next build artifacts)
- `design-extract-output/` (design extraction outputs, not runtime)

## Keep (runtime-critical)

- `client/` (SPA source/build)
- `server.js` (backend/runtime entry)
- `styles.css` and `client/src/styles/*.css` (site styling)
- `lib/` (shared runtime helpers)
- `scripts/transcode-worker.mjs` (video pipeline worker)
- `supabase/` (migrations/schema history)
- `public/`, `images/`, `manifest.json`, `sw.js` (site assets)
- `package.json`, `package-lock.json` (dependency graph)

## Optional follow-up candidates

- `.claude/` (local assistant metadata; removable if unused by your workflow)
- `tsconfig.tsbuildinfo` (generated artifact; safe to delete and ignore)
- any obsolete scripts in `scripts/` after dependency/usage check
