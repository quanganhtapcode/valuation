import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Download Vietnam Stock Financial Data (Excel/CSV)',
  description:
    'Download financial statements, valuation data, and market data for Vietnam stocks in Excel or CSV format. Covers income statement, balance sheet, cash flow, and ratios.',
  keywords: [
    'vietnam stock data download',
    'vietnam financial data excel',
    'stock financial statements download',
    'vietnam stock csv',
  ],
  alternates: { canonical: '/downloads' },
  openGraph: {
    title: 'Download Vietnam Stock Data | Quang Anh',
    description:
      'Export financial statements and valuation data for Vietnam stocks to Excel or CSV.',
    url: '/downloads',
  },
};

export default function DownloadsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
