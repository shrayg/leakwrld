# Tailwind Phase 1 (Non-breaking Setup)

Tailwind has been added in setup-only mode so visuals remain unchanged.

## What is done

- Added `tailwindcss` as a dev dependency.
- Added `tailwind.config.cjs` with tokens mapped to existing CSS variables.
- Kept current stylesheet pipeline unchanged to avoid any visual regressions.

## Next safe migration steps

1. Add a dedicated Tailwind entry stylesheet (without enabling preflight globally at first).
2. Migrate shared primitives only:
   - buttons
   - nav chips
   - cards
3. Verify each migrated surface visually before expanding scope.
4. Remove duplicated legacy CSS only after parity is confirmed.
