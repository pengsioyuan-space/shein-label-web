import { NextResponse } from 'next/server';
import { getPublicStores } from '@/lib/shein';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const stores = getPublicStores();
    return NextResponse.json({ ok: true, stores });
  } catch (e) {
    return NextResponse.json(
      { ok: false, stores: [], error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
