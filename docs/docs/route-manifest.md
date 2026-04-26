# HTTP route manifest (server.js)

See [`server.js`](../server.js) for authoritative routing. Summary:

- **Health:** `GET /api/health` (early, duplicated logic removed in second position)
- **Auth / account:** `/api/login`, `/api/signup`, `/api/logout`, `/api/me`, `/api/ping`, `/api/replace-ip-account`, `/auth/discord/*`, `/auth/google/*`
- **Referrals:** `/api/referral/status`, `/api/referral/leaderboard`, referral slug `GET /{code}`
- **Payments:** `/api/payment-screenshot`, `/api/stripe/checkout`, `/api/stripe/success`, `/api/stripe/webhook`, `/api/redeem-key`, `/api/omeglepay/set-tier`
- **Library:** `/api/videos`, `/api/list`, `/api/random-videos`, `/api/preview/list`, `/api/folder-counts`, `/api/recommendations`, `/api/trending`, `/api/newest`
- **Media:** `/media`, `/preview-media`, `/thumbnail`, `/preview-transcode`
- **Engagement:** `/api/video/stats`, `/api/comments`, `/api/comments/vote`, `/api/comments/reply`
- **Shorts:** `/api/shorts/stats`, `/api/shorts/view`, `/api/shorts/like`
- **Upload:** `/api/upload`, `/api/upload/leaderboard`
- **Analytics:** `/api/track`, `/api/email/preferences`
- **Live cams:** `/api/cams`, `/api/cam-img` (CORS for embeds)
- **Admin:** `/admin`, `/admin/api/*` (large subtree)
- **SEO:** `/sitemap.xml`
- **Misc:** `/api/cache-bust`

## React SPA (when `client/dist` exists)

Document paths are served `client/dist/index.html` for HTML shells and clean URLs listed in `server.js` (`_SPA_HTML_PAGES`, `_SPA_CLEAN_PATHS`, SEO slug `/cat/video`). `/checkout.html` and `/checkout` / `/premium` stay legacy `checkout.html`. `/assets/*` served from `client/dist/assets/`.
