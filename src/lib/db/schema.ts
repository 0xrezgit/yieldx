import { boolean, doublePrecision, integer, jsonb, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export const scenarios = pgTable('scenarios', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const alertRules = pgTable('alert_rules', {
  id: text('id').primaryKey(),
  metric: text('metric').notNull(),
  operator: text('operator').notNull(),
  threshold: doublePrecision('threshold').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

/** The on-chain verification's lasting copy (lib/llama/verify-store.ts writes it with plain SQL). */
export const verifyCache = pgTable(
  'verify_cache',
  {
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    value: jsonb('value'),
    version: integer('version').default(1).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.key] })],
);

export type Scenario = typeof scenarios.$inferSelect;
export type NewScenario = typeof scenarios.$inferInsert;
export type AlertRuleRow = typeof alertRules.$inferSelect;
