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

## Machine size recommendation

- Default in `fly.toml`: `shared-cpu-1x`, `512MB`
- Good starting point for this Node + Vite-served app.
- If memory pressure appears in logs, scale to `1024MB`.
