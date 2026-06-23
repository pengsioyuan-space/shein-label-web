'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';

type ApiResult = {
  ok: boolean;
  storeName: string;
  orderNo: string;
  labels: string[];
  urls: string[];
  methods: string[];
  error?: string;
};

type QueryResponse = {
  ok: boolean;
  successCount?: number;
  failCount?: number;
  totalCount?: number;
  results?: ApiResult[];
  error?: string;
};

function splitOrders(input: string): string[] {
  return [...new Set(input.split(/[\n,，\s]+/).map((x) => x.trim()).filter(Boolean))];
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function HomePage() {
  const [stores, setStores] = useState<string[]>([]);
  const [storeName, setStoreName] = useState('');
  const [ordersText, setOrdersText] = useState('');
  const [workers, setWorkers] = useState(8);
  const [manualLoading, setManualLoading] = useState(false);
  const [excelLoading, setExcelLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [results, setResults] = useState<ApiResult[]>([]);
  const [file, setFile] = useState<File | null>(null);

  const orderCount = useMemo(() => splitOrders(ordersText).length, [ordersText]);
  const successCount = results.filter((x) => x.ok).length;
  const failCount = results.length - successCount;

  useEffect(() => {
    fetch('/api/stores')
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) {
          setStores(data.stores || []);
          if ((data.stores || []).length > 0) setStoreName(data.stores[0]);
        } else {
          setMessage(data.error || '读取店铺失败');
        }
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : String(e)));
  }, []);

  async function queryManual(e: FormEvent) {
    e.preventDefault();
    setManualLoading(true);
    setMessage('');
    setResults([]);

    try {
      const orderNos = splitOrders(ordersText);
      const resp = await fetch('/api/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeName, orderNos, workers }),
      });
      const data = (await resp.json()) as QueryResponse;
      if (!resp.ok || !data.ok) throw new Error(data.error || '查询失败');
      setResults(data.results || []);
      setMessage(`执行完成：成功 ${data.successCount || 0}，失败 ${data.failCount || 0}，总计 ${data.totalCount || 0}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setManualLoading(false);
    }
  }

  async function uploadExcel(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setMessage('请先选择 Excel 文件');
      return;
    }
    setExcelLoading(true);
    setMessage('');

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('workers', String(workers));
      const resp = await fetch('/api/excel', { method: 'POST', body: form });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || 'Excel 处理失败');
      }

      const blob = await resp.blob();
      const base = file.name.replace(/\.xlsx?$/i, '') || '面单URL';
      downloadBlob(blob, `${base}_已获取.xlsx`);
      const total = resp.headers.get('X-Total-Count') || '-';
      const success = resp.headers.get('X-Success-Count') || '-';
      const fail = resp.headers.get('X-Fail-Count') || '-';
      setMessage(`Excel 已处理并开始下载：成功 ${success}，失败 ${fail}，总计 ${total}`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setExcelLoading(false);
    }
  }

  async function exportManualExcel() {
    if (results.length === 0) return;
    const XLSX = await import('xlsx');
    const rows = results.map((r) => ({
      店铺名: r.storeName,
      订单号: r.orderNo,
      包裹号或面单号: (r.labels || []).join('\n'),
      网址: (r.urls || []).join('\n'),
      状态: r.ok ? `成功${r.methods?.length ? ` | ${r.methods.join(' | ')}` : ''}` : `失败：${r.error || '未知错误'}`,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 18 }, { wch: 26 }, { wch: 24 }, { wch: 120 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '结果');
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '手动订单_面单URL.xlsx');
  }

  return (
    <main className="container">
      <section className="hero">
        <div>
          <p className="eyebrow">SHEIN Label URL Tool</p>
          <h1>SHEIN 面单 URL 网页版</h1>
          <p className="subtitle">上传 Excel 批量处理，或选择店铺后手动粘贴一个/多个订单号查询。</p>
        </div>
        <div className="statusCard">
          <span>店铺数</span>
          <strong>{stores.length}</strong>
          <small>密钥只保存在服务端环境变量</small>
        </div>
      </section>

      {message && <div className="message">{message}</div>}

      <section className="grid">
        <form className="card" onSubmit={uploadExcel}>
          <h2>方式一：上传 Excel 批量处理</h2>
          <p className="muted">Excel 格式：A 列店铺名，B 列订单号；处理后 C 列写包裹号/面单号，D 列写 PDF URL，E 列写状态。</p>
          <label className="label">
            选择 Excel 文件
            <input type="file" accept=".xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
          <button disabled={excelLoading || stores.length === 0} type="submit">
            {excelLoading ? '处理中...' : '上传并下载结果 Excel'}
          </button>
        </form>

        <form className="card" onSubmit={queryManual}>
          <h2>方式二：手动输入订单号</h2>
          <label className="label">
            店铺
            <select value={storeName} onChange={(e) => setStoreName(e.target.value)}>
              {stores.length === 0 && <option value="">未读取到店铺，请检查环境变量</option>}
              {stores.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="label">
            订单号，一行一个，也支持用空格、逗号分隔
            <textarea rows={8} value={ordersText} onChange={(e) => setOrdersText(e.target.value)} placeholder="GSU17812W0013NS&#10;GSU17R18300N53U" />
          </label>
          <div className="inline">
            <label className="label small">
              并发数
              <input type="number" min={1} max={20} value={workers} onChange={(e) => setWorkers(Number(e.target.value || 1))} />
            </label>
            <span className="counter">已识别 {orderCount} 个订单</span>
          </div>
          <button disabled={manualLoading || stores.length === 0 || orderCount === 0} type="submit">
            {manualLoading ? '查询中...' : '开始查询'}
          </button>
        </form>
      </section>

      {results.length > 0 && (
        <section className="results card wide">
          <div className="resultHeader">
            <div>
              <h2>查询结果</h2>
              <p className="muted">成功 {successCount}，失败 {failCount}，总计 {results.length}</p>
            </div>
            <button type="button" className="secondary" onClick={exportManualExcel}>下载结果 Excel</button>
          </div>
          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>状态</th>
                  <th>店铺名</th>
                  <th>订单号</th>
                  <th>包裹号/面单号</th>
                  <th>网址</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={`${r.storeName}-${r.orderNo}`}>
                    <td><span className={r.ok ? 'tag ok' : 'tag fail'}>{r.ok ? '成功' : '失败'}</span></td>
                    <td>{r.storeName}</td>
                    <td>{r.orderNo}</td>
                    <td>{(r.labels || []).map((x) => <div key={x}>{x}</div>)}</td>
                    <td>
                      {(r.urls || []).map((u) => (
                        <a href={u} key={u} target="_blank" rel="noreferrer">{u}</a>
                      ))}
                    </td>
                    <td className="errorText">{r.error || ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="note">
        <strong>部署说明：</strong>Vercel 部署后不能读取别人电脑上的本地路径，所以批量模式使用“上传 Excel”。本地路径只适合在你自己电脑上运行脚本，不适合网页部署。
      </section>
    </main>
  );
}
