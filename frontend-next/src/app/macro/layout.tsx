import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Kinh Tế Vĩ Mô Việt Nam: Tỷ Giá, CPI, GDP, Hàng Hóa',
  description:
    'Theo dõi chỉ số kinh tế vĩ mô Việt Nam: tỷ giá USD/VND, lạm phát CPI, tăng trưởng GDP, giá vàng và hàng hóa ảnh hưởng đến thị trường chứng khoán.',
  keywords: [
    'kinh tế vĩ mô Việt Nam',
    'tỷ giá USD VND',
    'lạm phát CPI Việt Nam',
    'GDP Việt Nam',
    'giá vàng hôm nay',
    'vietnam macro indicators',
    'vietnam cpi',
    'vietnam gdp',
    'vietnam exchange rate',
    'vietnam commodities',
  ],
  alternates: { canonical: '/macro' },
  openGraph: {
    title: 'Kinh Tế Vĩ Mô Việt Nam | Quang Anh',
    description:
      'Chỉ số kinh tế vĩ mô Việt Nam: tỷ giá, CPI, GDP và hàng hóa tác động đến chứng khoán.',
    url: '/macro',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Kinh Tế Vĩ Mô Việt Nam | Quang Anh',
    description:
      'Tỷ giá USD/VND, CPI, GDP, giá vàng và hàng hóa ảnh hưởng đến thị trường chứng khoán Việt Nam.',
  },
};

export default function MacroLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
