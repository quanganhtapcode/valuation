import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Lịch Sự Kiện Chứng Khoán: Cổ Tức, ĐHCĐ, Giao Dịch Nội Bộ',
  description:
    'Lịch sự kiện doanh nghiệp niêm yết Việt Nam: ngày chốt quyền cổ tức, đại hội cổ đông (ĐHCĐ), giao dịch nội bộ và các sự kiện công ty theo ngày và danh mục.',
  keywords: [
    'lịch sự kiện chứng khoán',
    'lịch chốt quyền cổ tức',
    'đại hội cổ đông',
    'giao dịch nội bộ',
    'vietnam stock events',
    'dividend calendar vietnam',
    'agm calendar vietnam',
    'insider trading vietnam',
    'corporate events vietnam',
  ],
  alternates: { canonical: '/events' },
  openGraph: {
    title: 'Lịch Sự Kiện Chứng Khoán Việt Nam | Quang Anh',
    description:
      'Lịch cổ tức, ĐHCĐ và giao dịch nội bộ cho cổ phiếu niêm yết Việt Nam.',
    url: '/events',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Lịch Sự Kiện Chứng Khoán Việt Nam | Quang Anh',
    description:
      'Ngày chốt quyền cổ tức, đại hội cổ đông và giao dịch nội bộ cho cổ phiếu HOSE, HNX, UPCOM.',
  },
};

export default function EventsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
