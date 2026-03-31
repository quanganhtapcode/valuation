import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Vietnam Macro Indicators: FX, CPI, GDP, Commodities',
  description:
    'Monitor Vietnam macro indicators including exchange rates, CPI inflation, GDP growth, and key commodity prices relevant to Vietnamese stocks.',
  keywords: [
    'vietnam macro',
    'vietnam cpi',
    'vietnam gdp',
    'vietnam exchange rate',
    'vietnam commodities',
  ],
  alternates: { canonical: '/macro' },
  openGraph: {
    title: 'Vietnam Macro Indicators | Quang Anh',
    description:
      'Track macroeconomic indicators impacting Vietnam equities: FX, CPI, GDP and commodities.',
    url: '/macro',
  },
};

export default function MacroLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

