import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getDb, schema } from '../../../lib/db';
import { isAlertRule } from '../../../lib/risk/alerts';

export const runtime = 'nodejs';

function unavailable() {
  return NextResponse.json({ error: 'Database unavailable', message: 'DATABASE_URL is not configured.' }, { status: 503 });
}

const invalid = () =>
  NextResponse.json(
    { error: 'metric, operator (gt|lt), numeric threshold and boolean enabled are required' },
    { status: 400 },
  );

export async function GET() {
  const db = getDb();
  if (!db) return unavailable();
  try {
    return NextResponse.json(await db.select().from(schema.alertRules).orderBy(asc(schema.alertRules.createdAt)));
  } catch (error) {
    console.error('GET /api/alerts failed', error);
    return NextResponse.json({ error: 'Database request failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const db = getDb();
  if (!db) return unavailable();
  try {
    const body = await request.json();
    const rule = { id: typeof body?.id === 'string' && body.id ? body.id : randomUUID(), enabled: true, ...body };
    if (!isAlertRule(rule)) return invalid();
    const [row] = await db
      .insert(schema.alertRules)
      .values({ id: rule.id, metric: rule.metric, operator: rule.operator, threshold: rule.threshold, enabled: rule.enabled })
      .returning();
    return NextResponse.json(row, { status: 201 });
  } catch (error) {
    console.error('POST /api/alerts failed', error);
    return NextResponse.json({ error: 'Database request failed' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const db = getDb();
  if (!db) return unavailable();
  try {
    const body = await request.json();
    if (!isAlertRule(body)) return invalid();
    const [row] = await db
      .update(schema.alertRules)
      .set({ metric: body.metric, operator: body.operator, threshold: body.threshold, enabled: body.enabled })
      .where(eq(schema.alertRules.id, body.id))
      .returning();
    return row ? NextResponse.json(row) : NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  } catch (error) {
    console.error('PUT /api/alerts failed', error);
    return NextResponse.json({ error: 'Database request failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const db = getDb();
  if (!db) return unavailable();
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  try {
    const [row] = await db.delete(schema.alertRules).where(eq(schema.alertRules.id, id)).returning();
    return row ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Alert not found' }, { status: 404 });
  } catch (error) {
    console.error('DELETE /api/alerts failed', error);
    return NextResponse.json({ error: 'Database request failed' }, { status: 500 });
  }
}
