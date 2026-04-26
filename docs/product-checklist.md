# Product Checklist

## Complete
- [x] Phase A foundation: app shell, route group, shared layout, dark token theme
- [x] Reusable UI primitives (`button`, `card`, `chip`, form controls, modal, sheet)
- [x] Adapted reusable header/footer shell components
- [x] Mobile-first navigation (bottom tab bar + compact structure)
- [x] Supabase client/server/proxy wiring
- [x] Supabase schema migrations for all required domain tables
- [x] RLS baseline policies with owner/public/service-role boundaries
- [x] Age gate and cookie preference client persistence scaffolding
- [x] Cloudflare Stream upload/webhook endpoint scaffolding
- [x] Watch page + shorts feed scaffold and ranking v1 helper
- [x] Report endpoint + report UI hook
- [x] Legal/policy pages linked from footer
- [x] Basic tests for ranking/trust-safety helpers
- [x] Docs set (`architecture`, `schema`, `video-pipeline`)

## Pending / Next implementation
- [ ] Full Supabase DB type generation and query-layer integration
- [ ] Production worker implementation consuming `video_jobs` queue
- [ ] Cloudflare Stream direct-upload API call (currently metadata scaffold)
- [ ] Real auth flows (sign in/up/reset) and protected route guards
- [ ] Persistent comments/reactions/subscriptions API storage
- [ ] Sentry SDK + product analytics SDK instrumentation
- [ ] Dedicated moderation dashboard and admin auth gates
- [ ] Anti-abuse rate limiting integration (Redis/edge KV)
