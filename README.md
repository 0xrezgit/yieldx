# YieldX

## Neon PostgreSQL persistence

The application is ready for Vercel + Neon without requiring a database during build. Database access is server-only through the `/api/scenarios` Route Handler and `DATABASE_URL` is read exclusively from `process.env.DATABASE_URL`.

### Setup

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL` locally, or add `DATABASE_URL` in Vercel Environment Variables. No credentials belong in the repository.
2. Run the migration with `npm run db:migrate` (or use `npm run db:push` for a development database).
3. Deploy normally with `npm run build` / Vercel.

`npm run db:generate` regenerates migrations after schema changes. The checked-in migration creates the `scenarios` table.

If `DATABASE_URL` is absent, builds still succeed and database endpoints return a clear HTTP 503 response. The UI's existing LocalStorage scenario remains the local/offline fallback and is not removed; it can later be migrated to the API.

### API

- `GET /api/scenarios` — list scenarios
- `POST /api/scenarios` — create `{ "name": "...", "data": { ... } }`
- `PUT /api/scenarios` — update `{ "id": "...", "name": "...", "data": { ... } }`
- `DELETE /api/scenarios?id=...` — delete a scenario
