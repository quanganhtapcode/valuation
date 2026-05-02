import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Lọc Cổ Phiếu Việt Nam: P/E, P/B, ROE, Tăng Trưởng, Vốn Hóa',
  description:
    'Bộ lọc cổ phiếu Việt Nam với hơn 20 tiêu chí: P/E, P/B, ROE, EPS, tăng trưởng doanh thu và lợi nhuận, vốn hóa thị trường cho HOSE, HNX, UPCOM.',
  keywords: [
    'lọc cổ phiếu Việt Nam',
    'bộ lọc cổ phiếu',
    'cổ phiếu định giá thấp',
    'vietnam stock screener',
    'hose screener',
    'hnx screener',
    'upcom screener',
    'pe pb roe filter vietnam',
    'stock filter vietnam',
  ],
  alternates: { canonical: '/screener' },
  openGraph: {
    title: 'Lọc Cổ Phiếu Việt Nam | Quang Anh',
    description:
      'Tìm cổ phiếu định giá thấp với bộ lọc P/E, P/B, ROE, vốn hóa và tăng trưởng trên HOSE, HNX, UPCOM.',
    url: '/screener',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lọc Cổ Phiếu Việt Nam | Quang Anh',
    description:
      'Bộ lọc cổ phiếu Việt Nam với P/E, P/B, ROE, EPS và hơn 20 tiêu chí cho HOSE, HNX, UPCOM.',
  },
};

export default function ScreenerLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
