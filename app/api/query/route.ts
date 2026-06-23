import { NextResponse } from 'next/server';
import { loadStoreKeys, processOrderSafely, resolveStore, safeStr } from '@/lib/shein';
import { runLimited } from '@/lib/runLimited';

export const runtime = 'nodejs';
export const maxDuration = 60;

type QueryBody = {
  storeName?: string;
  orderNos?: string[] | string;
  workers?: number;
};

function normalizeOrders(v: unknown): string[] {
  if (Array.isArray(v)) return [...new Set(v.map(safeStr).filter(Boolean))];
  return [...new Set(safeStr(v).split(/[\n,，\s]+/).map(safeStr).filter(Boolean))];
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as QueryBody;
    const stores = loadStoreKeys();
    if (stores.length === 0) throw new Error('未配置 SHEIN_STORE_KEYS_JSON 或 SHEIN_STORE_KEYS_TEXT');

    const storeName = safeStr(body.storeName);
    const orderNos = normalizeOrders(body.orderNos);
    const workers = Math.max(1, Math.min(Number(body.workers || process.env.SHEIN_DEFAULT_WORKERS || 8), 20));

    if (!storeName) throw new Error('请选择店铺');
    if (orderNos.length === 0) throw new Error('请输入订单号');

    const store = resolveStore(stores, storeName);
    const results = await runLimited(orderNos, workers, async (orderNo) => processOrderSafely(store, orderNo));
    const successCount = results.filter((x) => x.ok).length;
    const failCount = results.length - successCount;

    return NextResponse.json({ ok: true, successCount, failCount, totalCount: results.length, results });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
