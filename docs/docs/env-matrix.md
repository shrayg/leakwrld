# Environment variables (Fly / local)

| Variable | Required | Purpose |
|----------|----------|---------|
| `PORT` | Fly sets | Listen port (default 3002 local) |
| `HOST` | Optional | Bind address (default `0.0.0.0` when `PORT` set) |
| `TBW_DATA_DIR` | Optional | Path to `data/` |
| `TBW_MEDIA_ROOT` | Optional | Local media root |
| `TBW_PEPPER` | Recommended | Password pepper |
| `TBW_SECURE_COOKIES` | Prod | `1` for Secure cookies |
| `TBW_DEV_ALLOW_SAME_IP_REFERRALS` | Dev | `1` relaxes referral IP checks |
| `R2_*` | Prod media | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET` |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Redeem | Supabase REST for keys |
| `SUPABASE_ACCESS_KEYS_TABLE`, `SUPABASE_ACCESS_KEY_COLUMN` | Optional | Defaults `issued_access_keys` / `access_key` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Payments | Stripe Checkout + webhook |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` | Discord OAuth | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google OAuth | Optional |
| `XYZPAY_*`, `XYZPAY_ALLOWED_ORIGINS` | Checkout | Direct links + redeem CORS |
| `OMEGLEPAY_SECRET` | Webhook | Tier set webhook |
| `ACCESS_REDEEM_WEBHOOK_URL` | Optional | Discord for key redeem notifications |
| `ADMIN_PASSWORD_WEBHOOK_URL`, `ADMIN_PASSWORD_ROTATE_MS` | Admin | Rotating admin password to Discord |

Webhook URLs for visits / payments / tiers may be hardcoded in `server.js` — move to env when rotating.
