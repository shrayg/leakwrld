# Fly.io deploy checklist

## 1) Create app (first time)

```bash
fly launch --no-deploy --copy-config
```

If needed, edit `fly.toml` `app = "your-app-name"`.

## 2) Set required secrets

```bash
fly secrets set \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  ADMIN_PASSWORD_WEBHOOK_URL=... \
  CRON_SECRET=... \
  TBW_PEPPER=...
```

Set any additional providers you use (`CLOUDFLARE_*`, `STRIPE_*`, etc.) the same way.

## 3) Deploy

```bash
fly deploy
```

## 4) Verify runtime

```bash
fly status
fly logs
curl https://<your-app>.fly.dev/api/health
```

## No Tigris / no volume

- This app does not require Tigris object storage.
- `fly.toml` is configured without volumes.
- Runtime scratch data is set to `TBW_DATA_DIR=/tmp/pornwrld-data` (ephemeral).
- Durable app data should live in Supabase/R2.

## Custom domain (`pornwrld.xyz`)

```bash
fly certs add pornwrld.xyz
fly certs add www.pornwrld.xyz
fly certs show pornwrld.xyz
```

Then in Porkbun DNS:
- Add `A` for root `@` -> `66.241.125.157`
- Add `AAAA` for root `@` -> `2a09:8280:1::10d:4568:0`
- Add `CNAME` for `www` -> `pornwrld.fly.dev`

Wait for DNS propagation, then re-run:

```bash
fly certs show pornwrld.xyz
fly certs show www.pornwrld.xyz
```

## Machine size recommendation

- Default in `fly.toml`: `shared-cpu-1x`, `512MB`
- Good starting point for this Node + Vite-served app.
- If memory pressure appears in logs, scale to `1024MB`.
