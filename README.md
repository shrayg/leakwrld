# Leak World

Clean rebuild: Vite + React frontend, small Node HTTP API, and PostgreSQL for users, sessions, creators, media metadata, and queue state.

## Commands

```bash
npm install
npm run dev
npm run build
npm start
```

## Database

Set `DATABASE_URL`, then apply the schema:

```bash
npm run db:schema
```

The app seeds the first 100 creator records and starter shorts on first API read if the `creators` table is empty.

## Environment

```bash
DATABASE_URL=postgres://user:password@localhost:5432/leakworld
SESSION_SECRET=replace-with-random-secret
PORT=3002
ONLINE_CAPACITY=100
SKIP_QUEUE_PRICE_CENTS=499
```

Payments are intentionally stubbed until the new VPS deployment and billing provider are chosen.
