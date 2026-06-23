import crypto from 'crypto';

export const DOMAIN = 'https://openapi.sheincorp.com';
export const ORDER_DETAIL_PATH = '/open-api/order/order-detail';
export const PRINT_EXPRESS_INFO_PATH = '/open-api/order/print-express-info';

export type StoreKey = {
  storeName: string;
  openKeyId: string;
  secretKey: string;
};

export type LabelRow = {
  orderNo: string;
  packageNo: string;
  deliveryNo: string;
  labelNo: string;
  filePdfUrl: string;
  method: string;
};

export type OrderResult = {
  ok: boolean;
  storeName: string;
  orderNo: string;
  packageNos: string[];
  deliveryNos: string[];
  labels: string[];
  urls: string[];
  methods: string[];
  rows: LabelRow[];
  error?: string;
};

type AnyRecord = Record<string, unknown>;

function isRecord(v: unknown): v is AnyRecord {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function safeStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function cleanKeyText(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  for (const ch of ['\ufeff', '\u200b', '\u200c', '\u200d', '\u2060', '\u00a0']) {
    s = s.split(ch).join('');
  }
  s = s.trim().replace(/^['"]|['"]$/g, '').trim();
  return s.replace(/\s+/g, '');
}

function looksLikeKey(line: string): boolean {
  const s = safeStr(line);
  return s.length >= 16 && /^[A-Za-z0-9_-]+$/.test(s);
}

function parseStoreKeysText(text: string): StoreKey[] {
  const lines = text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x && !x.startsWith('#'));

  const stores: StoreKey[] = [];
  let cur: StoreKey = { storeName: '', openKeyId: '', secretKey: '' };
  let unnamed = 0;

  const flush = () => {
    if (cur.openKeyId && cur.secretKey) {
      if (!cur.storeName) {
        unnamed += 1;
        cur.storeName = `店铺${unnamed}`;
      }
      stores.push({ ...cur });
    }
    cur = { storeName: '', openKeyId: '', secretKey: '' };
  };

  for (const line of lines) {
    if (line.includes('=')) {
      const [rawK, ...rest] = line.split('=');
      const k = rawK.trim().toLowerCase();
      const v = rest.join('=').trim();

      if (['店铺', '店铺名', 'store', 'storename', 'store_name', 'name'].includes(k)) {
        if (cur.openKeyId || cur.secretKey) flush();
        cur.storeName = v;
      } else if (['openkeyid', 'open_key_id', 'openkey', 'keyid'].includes(k)) {
        cur.openKeyId = cleanKeyText(v);
      } else if (['secretkey', 'secret_key', 'secret'].includes(k)) {
        cur.secretKey = cleanKeyText(v);
      }

      if (cur.openKeyId && cur.secretKey) flush();
      continue;
    }

    if (!cur.storeName && !looksLikeKey(line)) {
      cur.storeName = line;
    } else if (!cur.openKeyId) {
      cur.openKeyId = cleanKeyText(line);
    } else if (!cur.secretKey) {
      cur.secretKey = cleanKeyText(line);
      flush();
    } else {
      flush();
      cur.storeName = line;
    }
  }

  flush();
  const unique = new Map<string, StoreKey>();
  for (const s of stores) unique.set(s.openKeyId, s);
  return [...unique.values()];
}

export function loadStoreKeys(): StoreKey[] {
  const json = process.env.SHEIN_STORE_KEYS_JSON;
  if (json && json.trim()) {
    const arr = JSON.parse(json) as Array<Record<string, unknown>>;
    const stores = arr
      .map((x) => ({
        storeName: safeStr(x.storeName ?? x.store_name ?? x.name ?? x['店铺'] ?? x['店铺名']),
        openKeyId: cleanKeyText(x.openKeyId ?? x.open_key_id ?? x.openKey ?? x.OpenKeyId),
        secretKey: cleanKeyText(x.secretKey ?? x.secret_key ?? x.secret ?? x.SecretKey),
      }))
      .filter((x) => x.openKeyId && x.secretKey);
    if (stores.length > 0) return stores;
  }

  const text = process.env.SHEIN_STORE_KEYS_TEXT;
  if (text && text.trim()) return parseStoreKeysText(text);

  return [];
}

export function getPublicStores(): string[] {
  return loadStoreKeys().map((s) => s.storeName);
}

export function resolveStore(stores: StoreKey[], storeName: string): StoreKey {
  const keyword = safeStr(storeName);
  if (!keyword) throw new Error('店铺名为空');

  if (/^\d+$/.test(keyword)) {
    const idx = Number(keyword);
    if (idx >= 1 && idx <= stores.length) return stores[idx - 1];
  }

  const exact = stores.filter((s) => s.storeName === keyword);
  if (exact.length === 1) return exact[0];

  const fuzzy = stores.filter((s) => s.storeName.toLowerCase().includes(keyword.toLowerCase()));
  if (fuzzy.length === 1) return fuzzy[0];
  if (fuzzy.length > 1) throw new Error(`店铺名匹配到多个：${fuzzy.map((s) => s.storeName).join('，')}`);

  throw new Error(`没有找到店铺：${keyword}`);
}

function makeRandomKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 5; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function makeSignature(openKeyId: string, secretKey: string, path: string, timestamp: string, randomKey: string): string {
  const value = `${openKeyId}&${timestamp}&${path}`;
  const key = `${secretKey}${randomKey}`;
  const digest = crypto.createHmac('sha256', Buffer.from(key, 'utf8')).update(value, 'utf8').digest('hex');
  const base64Signature = Buffer.from(digest, 'utf8').toString('base64');
  return `${randomKey}${base64Signature}`;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function callSheinApi(store: StoreKey, path: string, body: AnyRecord = {}, retries = 3): Promise<AnyRecord> {
  const url = DOMAIN + path;

  for (let i = 0; i < retries; i += 1) {
    const timestamp = String(Date.now());
    const randomKey = makeRandomKey();
    const headers = {
      'Content-Type': 'application/json;charset=UTF-8',
      'x-lt-openKeyId': store.openKeyId,
      'x-lt-timestamp': timestamp,
      'x-lt-signature': makeSignature(store.openKeyId, store.secretKey, path, timestamp, randomKey),
    };

    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        cache: 'no-store',
      });
      const text = await resp.text();
      try {
        const parsed = JSON.parse(text) as AnyRecord;
        return parsed;
      } catch {
        return { code: 'HTTP_ERROR', msg: text, http_status: resp.status };
      }
    } catch (e) {
      if (i === retries - 1) return { code: 'REQUEST_ERROR', msg: e instanceof Error ? e.message : String(e) };
      await sleep(500 * (i + 1));
    }
  }

  return { code: 'UNKNOWN', msg: '未知错误' };
}

function firstExisting(d: unknown, keys: string[]): unknown {
  if (!isRecord(d)) return '';
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(d, key) && d[key] !== null && d[key] !== undefined && d[key] !== '') {
      return d[key];
    }
  }
  const lower = new Map<string, string>();
  for (const k of Object.keys(d)) lower.set(k.toLowerCase(), k);
  for (const key of keys) {
    const real = lower.get(key.toLowerCase());
    if (real && d[real] !== null && d[real] !== undefined && d[real] !== '') return d[real];
  }
  return '';
}

function collectValuesByKeys(obj: unknown, keys: string[]): unknown[] {
  const out: unknown[] = [];
  const target = new Set(keys.map((k) => k.toLowerCase()));

  if (Array.isArray(obj)) {
    for (const item of obj) out.push(...collectValuesByKeys(item, keys));
  } else if (isRecord(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (target.has(k.toLowerCase()) && v !== null && v !== undefined && v !== '') out.push(v);
      if (isRecord(v) || Array.isArray(v)) out.push(...collectValuesByKeys(v, keys));
    }
  }

  return out;
}

function collectListItemsByKeys(obj: unknown, keys: string[]): AnyRecord[] {
  const out: AnyRecord[] = [];
  const target = new Set(keys.map((k) => k.toLowerCase()));

  if (Array.isArray(obj)) {
    for (const item of obj) out.push(...collectListItemsByKeys(item, keys));
  } else if (isRecord(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      if (target.has(k.toLowerCase()) && Array.isArray(v)) {
        out.push(...v.filter(isRecord));
      } else if (isRecord(v) || Array.isArray(v)) {
        out.push(...collectListItemsByKeys(v, keys));
      }
    }
  }

  return out;
}

export function joinUnique(values: unknown[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    const text = safeStr(v);
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

function extractDetailList(result: AnyRecord): AnyRecord[] {
  const info = result.info;
  if (Array.isArray(info)) return info.filter(isRecord);
  if (isRecord(info)) {
    if ('orderNo' in info) return [info];
    for (const key of ['orderList', 'detailList', 'orderDetailList', 'list', 'data', 'records']) {
      const v = info[key];
      if (Array.isArray(v)) return v.filter(isRecord);
    }
    const out: AnyRecord[] = [];
    for (const v of Object.values(info)) {
      if (isRecord(v) && 'orderNo' in v) out.push(v);
    }
    return out;
  }
  return [];
}

async function getOrderDetail(store: StoreKey, orderNo: string): Promise<{ detail: AnyRecord; raw: AnyRecord }> {
  const result = await callSheinApi(store, ORDER_DETAIL_PATH, { orderNoList: [orderNo] });
  if (safeStr(result.code) !== '0') {
    throw new Error(`order-detail 失败：code=${safeStr(result.code)} msg=${safeStr(result.msg)}`);
  }

  const details = extractDetailList(result);
  if (details.length === 0) {
    throw new Error(`order-detail 成功但未解析到订单详情，原始返回：${JSON.stringify(result).slice(0, 1000)}`);
  }

  const matched = details.find((d) => safeStr(d.orderNo) === orderNo);
  return { detail: matched ?? details[0], raw: result };
}

function extractPackageNos(...objs: unknown[]): string[] {
  const packageNos: unknown[] = [];
  for (const obj of objs) {
    for (const item of collectListItemsByKeys(obj, ['packageWaybillList'])) {
      packageNos.push(firstExisting(item, ['packageNo', 'packageNumber', 'packageCode']));
    }
  }
  if (joinUnique(packageNos).length === 0) {
    for (const obj of objs) packageNos.push(...collectValuesByKeys(obj, ['packageNo', 'packageNumber', 'packageCode']));
  }
  return joinUnique(packageNos);
}

function extractDeliveryNos(...objs: unknown[]): string[] {
  const deliveryNos: unknown[] = [];
  for (const obj of objs) {
    for (const item of collectListItemsByKeys(obj, ['packageWaybillList'])) {
      deliveryNos.push(firstExisting(item, ['deliveryNo', 'deliveryNumber', 'deliveryCode']));
    }
  }
  if (joinUnique(deliveryNos).length === 0) {
    for (const obj of objs) deliveryNos.push(...collectValuesByKeys(obj, ['deliveryNo', 'deliveryNumber', 'deliveryCode']));
  }
  return joinUnique(deliveryNos);
}

function collectDictsWithAnyKey(obj: unknown, keys: string[]): AnyRecord[] {
  const out: AnyRecord[] = [];
  const target = new Set(keys.map((k) => k.toLowerCase()));

  if (Array.isArray(obj)) {
    for (const item of obj) out.push(...collectDictsWithAnyKey(item, keys));
  } else if (isRecord(obj)) {
    const lowerKeys = new Set(Object.keys(obj).map((k) => k.toLowerCase()));
    for (const key of target) {
      if (lowerKeys.has(key)) {
        out.push(obj);
        break;
      }
    }
    for (const v of Object.values(obj)) {
      if (isRecord(v) || Array.isArray(v)) out.push(...collectDictsWithAnyKey(v, keys));
    }
  }

  return out;
}

function bodyValueToText(body: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const v = body[key];
    if (v !== null && v !== undefined && v !== '') {
      if (Array.isArray(v)) return joinUnique(v).join(' | ');
      return safeStr(v);
    }
  }
  return '';
}

function extractLabelRows(result: AnyRecord, requestBody: AnyRecord = {}, method = ''): LabelRow[] {
  const rows: LabelRow[] = [];
  const requestOrderNo = bodyValueToText(requestBody, ['orderNo']);
  const requestPackageNo = bodyValueToText(requestBody, ['packageNo', 'packageNoList']);
  const requestDeliveryNo = bodyValueToText(requestBody, ['deliveryNo', 'deliveryNoList']);

  for (const item of collectDictsWithAnyKey(result, ['filePdfUrl', 'pdfUrl', 'fileUrl'])) {
    const url = safeStr(firstExisting(item, ['filePdfUrl', 'pdfUrl', 'fileUrl']));
    if (!url) continue;

    const packageNo = safeStr(firstExisting(item, ['packageNo', 'packageNumber', 'packageCode'])) || requestPackageNo;
    const deliveryNo = safeStr(firstExisting(item, ['deliveryNo', 'deliveryNumber', 'deliveryCode'])) || requestDeliveryNo;
    const labelNo = deliveryNo || packageNo;

    rows.push({
      orderNo: safeStr(firstExisting(item, ['orderNo'])) || requestOrderNo,
      packageNo,
      deliveryNo,
      labelNo,
      filePdfUrl: url,
      method,
    });
  }

  const unique: LabelRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.orderNo}\u0000${row.labelNo}\u0000${row.filePdfUrl}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(row);
    }
  }
  return unique;
}

function shouldRetryWithDeliveryNo(result: AnyRecord): boolean {
  const code = safeStr(result.code);
  const msg = safeStr(result.msg);
  return code === '9999400' || msg.includes('deliveryNo') || msg.toLowerCase().includes('deliveryno') || msg.includes('在线下单');
}

function makePrintBodies(orderNo: string, fieldName: 'deliveryNo' | 'packageNo', values: string[]): AnyRecord[] {
  const uniqueValues = joinUnique(values);
  if (uniqueValues.length === 0) return [];

  const bodies: AnyRecord[] = [];

  if (fieldName === 'deliveryNo') {
    for (const v of uniqueValues) bodies.push({ orderNo, deliveryNo: v });
    if (uniqueValues.length > 1) {
      bodies.push({ orderNo, deliveryNo: uniqueValues });
      bodies.push({ orderNo, deliveryNoList: uniqueValues });
    }
    return bodies;
  }

  for (const v of uniqueValues) bodies.push({ orderNo, packageNo: [v] });
  if (uniqueValues.length > 1) bodies.push({ orderNo, packageNo: uniqueValues });
  return bodies;
}

async function callPrintExpressInfo(store: StoreKey, body: AnyRecord, method: string): Promise<{ rows: LabelRow[]; result: AnyRecord }> {
  const result = await callSheinApi(store, PRINT_EXPRESS_INFO_PATH, body);
  if (safeStr(result.code) !== '0') return { rows: [], result };
  return { rows: extractLabelRows(result, body, method), result };
}

export async function getLabelUrls(store: StoreKey, orderNo: string): Promise<OrderResult> {
  const order = safeStr(orderNo);
  const { detail, raw } = await getOrderDetail(store, order);
  const packageNos = extractPackageNos(detail, raw);
  const deliveryNos = extractDeliveryNos(detail, raw);
  const attempts: Array<{ method: string; body: AnyRecord; result: AnyRecord }> = [];

  if (deliveryNos.length > 0) {
    for (const body of makePrintBodies(order, 'deliveryNo', deliveryNos)) {
      const { rows, result } = await callPrintExpressInfo(store, body, 'deliveryNo');
      attempts.push({ method: 'deliveryNo', body, result });
      if (rows.length > 0) return buildSuccess(store.storeName, order, packageNos, deliveryNos, rows);
    }
  }

  if (packageNos.length > 0) {
    for (const body of makePrintBodies(order, 'packageNo', packageNos)) {
      const { rows, result } = await callPrintExpressInfo(store, body, 'packageNo');
      attempts.push({ method: 'packageNo', body, result });
      if (rows.length > 0) return buildSuccess(store.storeName, order, packageNos, deliveryNos, rows);

      if (shouldRetryWithDeliveryNo(result) && deliveryNos.length === 0) {
        throw new Error(
          `print-express-info 提示该订单需要 deliveryNo，但 order-detail 没解析到 deliveryNo。packageNo 请求失败：code=${safeStr(
            result.code,
          )} msg=${safeStr(result.msg)}`,
        );
      }
    }
  }

  if (packageNos.length === 0 && deliveryNos.length === 0) {
    throw new Error('order-detail 未返回 packageNo 或 deliveryNo，无法调用 print-express-info。');
  }

  const last = attempts[attempts.length - 1];
  throw new Error(
    `print-express-info 失败：最后尝试=${last?.method ?? '未请求'} code=${safeStr(last?.result?.code)} msg=${safeStr(
      last?.result?.msg,
    )}，请求body=${JSON.stringify(last?.body ?? {})}`,
  );
}

function buildSuccess(storeName: string, orderNo: string, packageNos: string[], deliveryNos: string[], rows: LabelRow[]): OrderResult {
  for (const row of rows) row.orderNo = row.orderNo || orderNo;
  const labels = joinUnique(rows.map((r) => r.labelNo || r.deliveryNo || r.packageNo));
  const urls = joinUnique(rows.map((r) => r.filePdfUrl));
  const methods = joinUnique(rows.map((r) => r.method));
  return {
    ok: true,
    storeName,
    orderNo,
    packageNos,
    deliveryNos,
    labels: labels.length > 0 ? labels : deliveryNos.length > 0 ? deliveryNos : packageNos,
    urls,
    methods,
    rows,
  };
}

export async function processOrderSafely(store: StoreKey, orderNo: string): Promise<OrderResult> {
  try {
    return await getLabelUrls(store, orderNo);
  } catch (e) {
    return {
      ok: false,
      storeName: store.storeName,
      orderNo: safeStr(orderNo),
      packageNos: [],
      deliveryNos: [],
      labels: [],
      urls: [],
      methods: [],
      rows: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
