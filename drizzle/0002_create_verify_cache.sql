-- Lasting copy of the on-chain verification (src/lib/llama/verify-store.ts).
-- The app also creates it on first use; this file records it with the other tables.
CREATE TABLE IF NOT EXISTS "verify_cache" (
  "kind" text NOT NULL,
  "key" text NOT NULL,
  "value" jsonb,
  "version" integer DEFAULT 1 NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL,
  PRIMARY KEY ("kind", "key")
);
