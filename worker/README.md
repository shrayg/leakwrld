# leakwrld R2 proxy Worker

Edge proxy in front of the `leakwrld` R2 bucket. Streams object bodies, supports
HTTP range requests (video seek), caches at the edge, and is the seam where
future tier gating (`tier1` / `tier2` / `tier3`) will be enforced.

## Layout

- `src/index.js` — handler
- `wrangler.jsonc` — config + R2 binding

## Local dev

```bash
npm run worker:dev
# -> http://127.0.0.1:8787/<key>
```

The dev server uses `--remote` automatically since the R2 binding has to hit
real Cloudflare to read objects.

## Deploy

First-time deploy (uses the default `*.workers.dev` subdomain):

```bash
npx wrangler login          # if not already authenticated
npm run worker:deploy
```

Wrangler will print a URL like
`https://leakwrld-r2.<your-account-subdomain>.workers.dev`. Test:

```bash
curl -I https://leakwrld-r2.<sub>.workers.dev/videos/amouranth/free/<file>.jpg
```

## Custom domain (recommended for production)

1. Make sure `leakwrld.com` is added as a zone on the same Cloudflare account
   that owns the `leakwrld` bucket.
2. Uncomment the `routes` block in `wrangler.jsonc`.
3. Re-deploy. Wrangler creates the DNS record and SSL cert automatically.

After that, update `R2_PUBLIC_BASE` in the client config to
`https://cdn.leakwrld.com/`.

## Routes

| Method  | Path           | Behavior                              |
| ------- | -------------- | ------------------------------------- |
| GET     | `/`            | health text                           |
| OPTIONS | `/<key>`       | CORS preflight                        |
| HEAD    | `/<key>`       | headers only                          |
| GET     | `/<key>`       | stream object (Range supported)       |

`<key>` is the full R2 object key — e.g.
`videos/amouranth/free/abc123__photo.jpg`.

## Tier gating (TODO)

`src/index.js -> authorizeTier()` currently allows every request. When payments
go live, replace it with a check against the leakwrld session cookie + plan
tier. The seam is intentionally narrow so gating can land without touching
caching, range, or streaming logic.
