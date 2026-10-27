import type { Metadata } from 'next';
import { cache } from 'react';
import { notFound } from 'next/navigation';
import { siteConfig } from '@/config/siteConfig';
import { STOCK_PRERENDER_SYMBOLS } from '@/config/stockPrerender';
import tickerData from '../../../../../public/ticker_data.json';
import { getRequestLang, localizedPath } from '@/lib/i18nRouting';
import type { Lang } from '@/lib/translations';

type Props = { params: Promise<{ lang: string; symbol: string }> };

// Build only a small set in both languages. Other valid catalogue symbols are
// rendered on first request and cached with the same ISR policy.
export function generateStaticParams() {
  return tickerData.tickers
    .filter(ticker => STOCK_PRERENDER_SYMBOLS.has(ticker.symbol))
    .map(ticker => ({ symbol: ticker.symbol }));
}
export const dynamic = 'force-static';
export const dynamicParams = true;
export const revalidate = 300;

type StockSeoData = {
  symbol: string;
  companyName: string;
  sector: string;
  exchange: string;
  price: number | null;
};

function normalizeSymbol(symbol: string): string {
  return symbol.toUpperCase();
}

function buildDescription(data: StockSeoData, lang: Lang): string {
  if (lang === 'en') {
    const identity = data.companyName && data.companyName !== data.symbol ? `${data.symbol} (${data.companyName})` : data.symbol;
    return `Analysis and valuation of ${identity}, listed on ${data.exchange}. Explore price history, financial statements, P/E, P/B, ROE, holders, news, and valuation models.`;
  }
  const parts = [
    `Phân tích và định giá cổ phiếu ${data.symbol}`,
  ];

  if (data.companyName && data.companyName !== data.symbol) {
    parts.push(data.companyName);
  }

  if (data.exchange && data.exchange !== 'N/A') {
    parts.push(`niêm yết trên ${data.exchange}`);
  }

  if (data.sector && data.sector !== 'N/A' && data.sector.toLowerCase() !== 'unknown') {
    parts.push(`ngành ${data.sector}`);
  }

  if (data.price && data.price > 0) {
    parts.push(`giá tham chiếu khoảng ${Math.round(data.price).toLocaleString('en-US')} VND`);
  }

  return `${parts.join(', ')}. Theo dõi giá, lịch sử giao dịch, báo cáo tài chính, P/E, P/B, ROE, cổ đông, tin tức và mô hình định giá.`;
}

const getStockSeoData = cache((symbol: string, lang: Lang): StockSeoData | null => {
  const ticker = tickerData.tickers.find(item => item.symbol.toUpperCase() === symbol);
  if (!ticker) return null;

  const name = String((lang === 'en' ? ticker.en_name : ticker.name) || ticker.name || symbol).trim() || symbol;
  const sector = String((lang === 'en' ? ticker.en_sector : ticker.sector) || ticker.sector || 'N/A').trim() || 'N/A';
  const exchange = String(ticker.exchange || 'N/A').trim() || 'N/A';

  return {
    symbol,
    companyName: name,
    sector,
    exchange,
    price: null,
  };
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const lang = await getRequestLang(params);
  const sym = normalizeSymbol(symbol);

  const stock = getStockSeoData(sym, lang);
  if (!stock) notFound();

  const hasCompanyName = stock.companyName && stock.companyName !== sym;
  const pageTitle = hasCompanyName
    ? `${sym} - ${stock.companyName} | ${lang === 'vi' ? 'Phân tích & định giá cổ phiếu' : 'Stock analysis & valuation'}`
    : `${sym} | ${lang === 'vi' ? 'Phân tích & định giá cổ phiếu' : 'Stock analysis & valuation'}`;
  const description = buildDescription(stock, lang);
  const canonicalPath = localizedPath(`/stock/${sym}`, lang);
  const ogTitle = hasCompanyName
    ? `${sym} (${stock.companyName}) | ${lang === 'vi' ? 'Phân tích cổ phiếu' : 'Stock analysis'} - Quang Anh`
    : `${sym} | ${lang === 'vi' ? 'Phân tích cổ phiếu' : 'Stock analysis'} - Quang Anh`;

  const keywords = [
    `${sym} cổ phiếu`,
    `${sym} giá cổ phiếu`,
    `${sym} định giá`,
    `${sym} báo cáo tài chính`,
    `${sym} cổ đông`,
    `${sym} phân tích kỹ thuật`,
    `${sym} stock`,
    `${sym} valuation`,
    `${sym} price`,
    `${sym} financial statements`,
    `${sym} holders`,
    `${sym} Vietnam stock`,
    'vietnam stock analysis',
    'dcf valuation vietnam',
  ];

  if (hasCompanyName) {
    keywords.push(stock.companyName);
  }

  if (stock.sector && stock.sector !== 'N/A' && stock.sector.toLowerCase() !== 'unknown') {
    keywords.push(`${stock.sector} vietnam stocks`);
  }

  const ogImagePath = localizedPath(`/stock/${sym}/opengraph-image`, lang);

  return {
    title: pageTitle,
    description,
    keywords,
    alternates: {
      canonical: canonicalPath,
      languages: {
        'x-default': localizedPath(`/stock/${sym}`, 'vi'),
        'vi-VN': localizedPath(`/stock/${sym}`, 'vi'),
        'en-US': localizedPath(`/stock/${sym}`, 'en'),
      },
    },
    openGraph: {
      title: ogTitle,
      description,
      url: canonicalPath,
      type: 'website',
      images: [
        {
          url: ogImagePath,
          width: 1200,
          height: 630,
          alt: `${sym} stock snapshot`,
        },
      ],
    },
    twitter: {
      card: 'summary_large_image',
      title: ogTitle,
      description,
      images: [ogImagePath],
    },
  };
}

export default async function StockLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string; symbol: string }>;
}) {
  const { symbol } = await params;
  const sym = normalizeSymbol(symbol);
  const lang = await getRequestLang(params);

  const stock = getStockSeoData(sym, lang);
  if (!stock) notFound();
  const companyName = stock?.companyName || sym;
  const pageUrl = `${siteConfig.url}${localizedPath(`/stock/${sym}`, lang)}`;
  const displayName = companyName !== sym ? `${companyName} (${sym})` : sym;

  const webPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${displayName} - ${lang === 'vi' ? 'Phân tích cổ phiếu' : 'Stock analysis'}`,
    description: stock
      ? buildDescription(stock, lang)
      : lang === 'vi' ? `Phân tích và định giá cổ phiếu ${sym} trên thị trường Việt Nam.` : `Analysis and valuation of ${sym} on the Vietnamese stock market.`,
    url: pageUrl,
    inLanguage: lang,
    isPartOf: {
      '@type': 'WebSite',
      name: siteConfig.name,
      url: siteConfig.url,
    },
    mainEntity: {
      '@type': 'Corporation',
      name: companyName,
      tickerSymbol: sym,
      ...(stock?.exchange && stock.exchange !== 'N/A' ? { stockExchange: stock.exchange } : {}),
      ...(stock?.sector && stock.sector !== 'N/A' && stock.sector.toLowerCase() !== 'unknown'
        ? { knowsAbout: stock.sector }
        : {}),
    },
  };

  const breadcrumbJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: lang === 'vi' ? 'Trang chủ' : 'Home',
        item: `${siteConfig.url}/${lang}`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: lang === 'vi' ? 'Cổ phiếu' : 'Stocks',
        item: pageUrl,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: sym,
        item: pageUrl,
      },
    ],
  };

  const quoteJsonLd =
    stock?.price && stock.price > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'Offer',
          name: `${sym} giá tham chiếu gần nhất`,
          url: pageUrl,
          price: Number(stock.price.toFixed(2)),
          priceCurrency: 'VND',
          itemOffered: {
            '@type': 'Corporation',
            name: companyName,
            tickerSymbol: sym,
          },
        }
      : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(webPageJsonLd).replace(/</g, '\\u003c') }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd).replace(/</g, '\\u003c') }}
      />
      {quoteJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(quoteJsonLd).replace(/</g, '\\u003c') }}
        />
      ) : null}
      {children}
    </>
  );
}
