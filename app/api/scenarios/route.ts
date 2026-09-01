import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getDb, schema } from '../../../lib/db';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function unavailable() {
  return NextResponse.json({ error: 'Database unavailable', message: 'DATABASE_URL is not configured.' }, { status: 503 });
}

export async function GET() {
  const db = getDb();
  if (!db) return unavailable();
  try {
    return NextResponse.json(await db.select().from(schema.scenarios).orderBy(desc(schema.scenarios.updatedAt)));
  } catch (error) {
    console.error('GET /api/scenarios failed', error);
    return NextResponse.json({ error: 'Database request failed' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const db = getDb();
  if (!db) return unavailable();
  try {
    const body = await request.json();
    if (!body || typeof body.data !== 'object' || Array.isArray(body.data)) {
      return NextResponse.json({ error: 'data must be an object' }, { status: 400 });
    }
    const [scenario] = await db.insert(schema.scenarios).values({
      id: typeof body.id === 'string' && body.id ? body.id : randomUUID(),
      name: typeof body.name === 'string' && body.name ? body.name : 'Untitled scenario',
      data: body.data,
    }).returning();
    return NextResponse.json(scenario, { status: 201 });
  } catch (error) {
    console.error('POST /api/scenarios failed', error);
    return NextResponse.json({ error: 'Database request failed' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const db = getDb();
  if (!db) return unavailable();
  try {
    const body = await request.json();
    if (typeof body?.id !== 'string' || !body.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
      return NextResponse.json({ error: 'id and object data are required' }, { status: 400 });
    }
    const [scenario] = await db.update(schema.scenarios).set({
      ...(typeof body.name === 'string' ? { name: body.name } : {}), data: body.data, updatedAt: new Date(),
    }).where(eq(schema.scenarios.id, body.id)).returning();
    return scenario ? NextResponse.json(scenario) : NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  } catch (error) {
    console.error('PUT /api/scenarios failed', error);
    return NextResponse.json({ error: 'Database request failed' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const db = getDb();
  if (!db) return unavailable();
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  try {
    const [scenario] = await db.delete(schema.scenarios).where(eq(schema.scenarios.id, id)).returning();
    return scenario ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Scenario not found' }, { status: 404 });
  } catch (error) {
    console.error('DELETE /api/scenarios failed', error);
    return NextResponse.json({ error: 'Database request failed' }, { status: 500 });
  }
}
