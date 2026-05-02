import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Tin Tức Chứng Khoán Việt Nam Mới Nhất | HOSE, HNX, UPCOM',
  description:
    'Tin tức thị trường chứng khoán Việt Nam mới nhất: thông báo doanh nghiệp, sự kiện cổ tức, kết quả kinh doanh và diễn biến VNINDEX cập nhật liên tục.',
  keywords: [
    'tin tức chứng khoán Việt Nam',
    'tin tức cổ phiếu hôm nay',
    'thông báo doanh nghiệp',
    'vietnam stock news',
    'vnindex news',
    'hose news',
    'hnx news',
    'upcom news',
    'stock market news vietnam',
  ],
  alternates: { canonical: '/news' },
  openGraph: {
    title: 'Tin Tức Chứng Khoán Việt Nam | Quang Anh',
    description:
      'Tin tức chứng khoán mới nhất từ doanh nghiệp niêm yết và thị trường HOSE, HNX, UPCOM.',
    url: '/news',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Tin Tức Chứng Khoán Việt Nam | Quang Anh',
    description:
      'Tin tức thị trường chứng khoán Việt Nam cập nhật liên tục từ HOSE, HNX, UPCOM.',
  },
};

export default function NewsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
