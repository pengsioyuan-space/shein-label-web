import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SHEIN 面单 URL 网页版',
  description: '上传 Excel 或手动输入订单号，批量查询 SHEIN 面单 PDF URL。',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
