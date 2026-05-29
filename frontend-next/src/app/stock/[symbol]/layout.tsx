import type { Metadata } from 'next';
import { cache } from 'react';
import { siteConfig } from '@/app/siteConfig';
import tickerData from '../../../../public/ticker_data.json';

type Props = { params: Promise<{ symbol: string }> };

export const dynamic = 'force-static';
export const revalidate = 300;

type StockSeoData = {
  symbol: string;
  companyName: string;
  sector: string;
  exchange: string;
  price: number | null;
};

function normalizeSymbol(symbol: string): string {
  return (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

function buildDescription(data: StockSeoData): string {
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

const getStockSeoData = cache((symbol: string): StockSeoData | null => {
  const tickers = Array.isArray((tickerData as any).tickers) ? (tickerData as any).tickers : [];
  const ticker = tickers.find((item: any) => String(item?.symbol || '').toUpperCase() === symbol);
  if (!ticker) return null;

  const name = String(ticker.name || ticker.en_name || symbol).trim() || symbol;
  const sector = String(ticker.sector || ticker.en_sector || 'N/A').trim() || 'N/A';
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
  const sym = normalizeSymbol(symbol);

  if (!sym) {
    return {
      title: 'Cổ phiếu',
      description: 'Phân tích và định giá cổ phiếu Việt Nam.',
      robots: { index: false, follow: false },
    };
  }

  const stock = getStockSeoData(sym) || {
    symbol: sym,
    companyName: sym,
    sector: 'N/A',
    exchange: 'N/A',
    price: null,
  };

  const hasCompanyName = stock.companyName && stock.companyName !== sym;
  const pageTitle = hasCompanyName
    ? `${sym} - ${stock.companyName} | Phân tích & định giá cổ phiếu`
    : `${sym} | Phân tích & định giá cổ phiếu`;
  const description = buildDescription(stock);
  const canonicalPath = `/stock/${sym}`;
  const ogTitle = hasCompanyName
    ? `${sym} (${stock.companyName}) | Phân tích cổ phiếu - Quang Anh`
    : `${sym} | Phân tích cổ phiếu - Quang Anh`;

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

  const ogImagePath = `/stock/${sym}/opengraph-image`;

  return {
    title: pageTitle,
    description,
    keywords,
    alternates: {
      canonical: canonicalPath,
      languages: {
        'x-default': canonicalPath,
        vi: canonicalPath,
        en: canonicalPath,
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
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  const sym = normalizeSymbol(symbol);

  if (!sym) {
    return <>{children}</>;
  }

  const stock = getStockSeoData(sym);
  const companyName = stock?.companyName || sym;
  const pageUrl = `${siteConfig.url}/stock/${sym}`;
  const displayName = companyName !== sym ? `${companyName} (${sym})` : sym;

  const webPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${displayName} - Phân tích cổ phiếu`,
    description: stock
      ? buildDescription(stock)
      : `Phân tích và định giá cổ phiếu ${sym} trên thị trường Việt Nam.`,
    url: pageUrl,
    inLanguage: 'vi',
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
        name: 'Trang chủ',
        item: siteConfig.url,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Cổ phiếu',
        item: `${siteConfig.url}/stock/${sym}`,
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
