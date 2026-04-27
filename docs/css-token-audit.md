# CSS Token Audit

## Entry order

`client/src/main.jsx` imports:

1. `styles.css`
2. `client/src/app.css`
3. `client/src/styles/pornwrld-theme.css`

Because of this order, token declarations in the legacy theme layer can override `styles.css` unless centralized.

## What was changed

- Moved `.site-theme-pornwrld` token ownership to `styles.css`.
- Removed duplicate core `--color-*` token redefinitions from the legacy theme layer.
- Kept theme CSS focused on layout/chrome behavior and component-specific visuals.

## Remaining technical debt

- `client/src/styles/pornwrld-legacy-theme.css` still contains many hardcoded color literals.
- A follow-up pass can progressively replace those literals with:
  - `--color-*` tokens
  - `--color-lock*` tokens for lock states
  - `--color-premium*` tokens for premium states
