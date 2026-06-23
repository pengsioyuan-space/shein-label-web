import * as XLSX from 'xlsx';
import { joinUnique, loadStoreKeys, processOrderSafely, resolveStore, safeStr, type OrderResult } from './shein';
import { runLimited } from './runLimited';

export type ExcelTask = {
  rowNumber: number;
  storeName: string;
  orderNo: string;
  skipError?: string;
};

export type ExcelProcessResult = {
  buffer: Buffer;
  fileName: string;
  successCount: number;
  failCount: number;
  totalCount: number;
  results: Array<OrderResult & { rowNumber: number }>;
};

function cellAddress(col: string, row: number): string {
  return `${col}${row}`;
}

function getCellText(ws: XLSX.WorkSheet, col: string, row: number): string {
  const cell = ws[cellAddress(col, row)];
  return safeStr(cell?.v);
}

function setCell(ws: XLSX.WorkSheet, col: string, row: number, value: string): void {
  const addr = cellAddress(col, row);
  ws[addr] = { t: 's', v: value };
}

function setHyperlinkCell(ws: XLSX.WorkSheet, col: string, row: number, value: string, urls: string[]): void {
  const addr = cellAddress(col, row);
  ws[addr] = { t: 's', v: value } as XLSX.CellObject;
  if (urls.length === 1) {
    (ws[addr] as XLSX.CellObject).l = { Target: urls[0], Tooltip: '打开面单 PDF' };
  }
}

function parseRows(ws: XLSX.WorkSheet): ExcelTask[] {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:E1');
  const tasks: ExcelTask[] = [];

  for (let r = Math.max(1, range.s.r + 1); r <= range.e.r; r += 1) {
    const rowNumber = r + 1;
    const storeName = getCellText(ws, 'A', rowNumber);
    const orderNo = getCellText(ws, 'B', rowNumber);
    if (!storeName && !orderNo) continue;
    if (!storeName || !orderNo) {
      tasks.push({ rowNumber, storeName, orderNo, skipError: '店铺名或订单号为空' });
      continue;
    }
    tasks.push({ rowNumber, storeName, orderNo });
  }

  return tasks;
}

function ensureHeaders(ws: XLSX.WorkSheet): void {
  if (!getCellText(ws, 'A', 1)) setCell(ws, 'A', 1, '店铺名');
  if (!getCellText(ws, 'B', 1)) setCell(ws, 'B', 1, '订单号');
  setCell(ws, 'C', 1, '包裹号/面单号');
  setCell(ws, 'D', 1, '网址');
  setCell(ws, 'E', 1, '状态');
}

function extendRange(ws: XLSX.WorkSheet, minCols = 5): void {
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:E1');
  range.e.c = Math.max(range.e.c, minCols - 1);
  ws['!ref'] = XLSX.utils.encode_range(range);
}

export async function processExcel(buffer: Buffer, originalName: string, workers: number): Promise<ExcelProcessResult> {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Excel 没有工作表');
  const ws = workbook.Sheets[sheetName];
  ensureHeaders(ws);
  extendRange(ws);

  const stores = loadStoreKeys();
  if (stores.length === 0) throw new Error('未配置 SHEIN_STORE_KEYS_JSON 或 SHEIN_STORE_KEYS_TEXT');

  const tasks = parseRows(ws);

  const results = await runLimited(tasks, workers, async (task) => {
    if (task.skipError) {
      return {
        ok: false,
        storeName: task.storeName,
        orderNo: task.orderNo,
        packageNos: [],
        deliveryNos: [],
        labels: [],
        urls: [],
        methods: [],
        rows: [],
        error: task.skipError,
        rowNumber: task.rowNumber,
      };
    }

    try {
      const store = resolveStore(stores, task.storeName);
      const result = await processOrderSafely(store, task.orderNo);
      return { ...result, rowNumber: task.rowNumber };
    } catch (e) {
      return {
        ok: false,
        storeName: task.storeName,
        orderNo: task.orderNo,
        packageNos: [],
        deliveryNos: [],
        labels: [],
        urls: [],
        methods: [],
        rows: [],
        error: e instanceof Error ? e.message : String(e),
        rowNumber: task.rowNumber,
      };
    }
  });

  let successCount = 0;
  let failCount = 0;

  for (const result of results) {
    if (result.ok) {
      successCount += 1;
      const labels = joinUnique(result.labels);
      const urls = joinUnique(result.urls);
      setCell(ws, 'C', result.rowNumber, labels.join('\n'));
      setHyperlinkCell(ws, 'D', result.rowNumber, urls.join('\n'), urls);
      setCell(ws, 'E', result.rowNumber, `成功${result.methods.length ? ` | ${result.methods.join(' | ')}` : ''}`);
    } else {
      failCount += 1;
      setCell(ws, 'E', result.rowNumber, `失败：${result.error || '未知错误'}`);
    }
  }

  ws['!cols'] = [
    { wch: 18 },
    { wch: 26 },
    { wch: 24 },
    { wch: 120 },
    { wch: 50 },
  ];

  const out = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  const safeName = originalName.replace(/\.xlsx?$/i, '') || '面单URL';
  return {
    buffer: out,
    fileName: `${safeName}_已获取.xlsx`,
    successCount,
    failCount,
    totalCount: tasks.length,
    results,
  };
}
