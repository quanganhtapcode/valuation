import type { Metadata } from 'next';
import { siteConfig } from '@/app/siteConfig';

type Props = { params: Promise<{ symbol: string }> };

type StockSeoData = {
  symbol: string;
  companyName: string;
  sector: string;
  exchange: string;
  price: number | null;
};

const BACKEND_API =
  process.env.NODE_ENV === 'development'
    ? (process.env.BACKEND_API_URL_LOCAL || 'http://127.0.0.1:8000/api')
    : (process.env.BACKEND_API_URL || 'https://api.quanganh.org/v1/valuation');

function normalizeSymbol(symbol: string): string {
  return (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

function toNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildDescription(data: StockSeoData): string {
  const parts = [
    `${data.symbol} stock analysis, valuation and financial insights`,
  ];

  if (data.companyName && data.companyName !== data.symbol) {
    parts.push(`for ${data.companyName}`);
  }

  if (data.exchange && data.exchange !== 'N/A') {
    parts.push(`listed on ${data.exchange}`);
  }

  if (data.sector && data.sector !== 'N/A' && data.sector.toLowerCase() !== 'unknown') {
    parts.push(`in ${data.sector}`);
  }

  if (data.price && data.price > 0) {
    parts.push(`with latest reference around ${Math.round(data.price).toLocaleString('en-US')} VND`);
  }

  return `${parts.join(', ')}. Track price history, valuation scenarios, holders, and peer comparison.`;
}

async function fetchStockSeoData(symbol: string): Promise<StockSeoData | null> {
  try {
    const url = `${BACKEND_API}/stock/${encodeURIComponent(symbol)}?fetch_price=true`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Next.js Stock SEO Metadata',
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) return null;

    const payload = await response.json();
    const data = payload?.data || payload || {};
    if (!data || typeof data !== 'object') return null;

    const name = String(data.name || data.company_name || symbol).trim() || symbol;
    const sector = String(data.sector || data.industry || 'N/A').trim() || 'N/A';
    const exchange = String(data.exchange || 'N/A').trim() || 'N/A';

    const price = toNumber(data.current_price ?? data.price ?? data.close);

    return {
      symbol,
      companyName: name,
      sector,
      exchange,
      price,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params;
  const sym = normalizeSymbol(symbol);

  if (!sym) {
    return {
      title: 'Stock',
      description: 'Vietnam stock analysis and valuation.',
      robots: { index: false, follow: false },
    };
  }

  const stock = (await fetchStockSeoData(sym)) || {
    symbol: sym,
    companyName: sym,
    sector: 'N/A',
    exchange: 'N/A',
    price: null,
  };

  const hasCompanyName = stock.companyName && stock.companyName !== sym;
  const pageTitle = hasCompanyName
    ? `${sym} - ${stock.companyName} Stock Analysis & Valuation`
    : `${sym} Stock Analysis & Valuation`;
  const description = buildDescription(stock);
  const canonicalPath = `/stock/${sym}`;
  const ogTitle = hasCompanyName
    ? `${sym} (${stock.companyName}) | Stock Analysis - Quang Anh`
    : `${sym} | Stock Analysis - Quang Anh`;

  const keywords = [
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

  const logo = siteConfig.stockLogoUrl(sym);
  const ogImagePath = `/stock/${sym}/opengraph-image`;

  return {
    title: pageTitle,
    description,
    keywords,
    alternates: {
      canonical: canonicalPath,
      languages: {
        'x-default': canonicalPath,
        en: canonicalPath,
      },
    },
    openGraph: {
      title: ogTitle,
      description,
      url: canonicalPath,
      type: 'article',
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
      images: [ogImagePath, logo],
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

  const stock = await fetchStockSeoData(sym);
  const companyName = stock?.companyName || sym;
  const pageUrl = `${siteConfig.url}/stock/${sym}`;
  const displayName = companyName !== sym ? `${companyName} (${sym})` : sym;

  const webPageJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${displayName} Stock Analysis`,
    description: stock
      ? buildDescription(stock)
      : `${sym} stock analysis, valuation and financial insights for Vietnam market.`,
    url: pageUrl,
    inLanguage: 'en',
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
        name: 'Home',
        item: siteConfig.url,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Stock',
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
          name: `${sym} Latest Quote`,
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
