# QA automated run log

Append a row per CI or local full pass. **Do not edit the Cursor plan file** — this file is the execution record.

| Date (UTC) | Command | Result | Notes |
|------------|---------|--------|--------|
| 2026-04-18 | `npm test` | 6/6 pass | xyzpurchase / redeem unit tests |
| 2026-04-18 | `npm run build:client` | pass | Vite production bundle |
| 2026-04-18 | `npm run qa:smoke` | all pass | `QA_BASE_URL` default `http://127.0.0.1:3002` |

## Manual-only (not automated here)

- Shell UI: AgeDisclaimer, BgCanvas, AdTopBanner, modals — verify in browser per [QA_RUNBOOK.md](./QA_RUNBOOK.md) §1.
- Stripe / XYZ checkout **navigation only** — do not submit real payments; verify open + back.
- Viewport 390 / 768 / 1440 — resize browser or device toolbar.
- Keyboard: Tab, Escape — browser manual.
- Admin `/admin` — requires rotated password from webhook.

## How to run

```bash
npm test
npm run build:client
# Terminal 1: npm start   (or existing server on PORT)
npm run qa:smoke
# Optional: QA_BASE_URL=https://pornwrld.xyz npm run qa:smoke
```
