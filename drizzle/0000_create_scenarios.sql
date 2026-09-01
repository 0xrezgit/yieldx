CREATE TABLE IF NOT EXISTS "scenarios" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "data" jsonb NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
