import { boolean, doublePrecision, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

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

export type Scenario = typeof scenarios.$inferSelect;
export type NewScenario = typeof scenarios.$inferInsert;
export type AlertRuleRow = typeof alertRules.$inferSelect;
