import { NextResponse } from 'next/server';
import { processExcel } from '@/lib/excel';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get('file');
    const workersRaw = form.get('workers');
    const workers = Math.max(1, Math.min(Number(workersRaw || process.env.SHEIN_DEFAULT_WORKERS || 8), 20));

    if (!(file instanceof File)) throw new Error('请上传 Excel 文件');
    if (!/\.xlsx?$/i.test(file.name)) throw new Error('只支持 .xlsx 或 .xls 文件');

    const arrayBuffer = await file.arrayBuffer();
    const result = await processExcel(Buffer.from(arrayBuffer), file.name, workers);
    const encodedName = encodeURIComponent(result.fileName);

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodedName}`,
        'X-Success-Count': String(result.successCount),
        'X-Fail-Count': String(result.failCount),
        'X-Total-Count': String(result.totalCount),
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
