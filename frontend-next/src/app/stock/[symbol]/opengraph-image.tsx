import { ImageResponse } from 'next/og';

type Props = {
  params: Promise<{ symbol: string }>;
};

type StockCardData = {
  symbol: string;
  companyName: string;
  exchange: string;
  sector: string;
  price: number | null;
  changePercent: number | null;
};

export const runtime = 'edge';
export const size = {
  width: 1200,
  height: 630,
};
export const contentType = 'image/png';

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

function formatPrice(value: number | null): string {
  if (!value || value <= 0) return 'Price unavailable';
  return `${Math.round(value).toLocaleString('en-US')} VND`;
}

function formatChange(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Change unavailable';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

async function fetchStockCardData(symbol: string): Promise<StockCardData> {
  try {
    const response = await fetch(`${BACKEND_API}/stock/${encodeURIComponent(symbol)}?fetch_price=true`, {
      headers: {
        'User-Agent': 'Next.js OG Image Renderer',
        Accept: 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return {
        symbol,
        companyName: symbol,
        exchange: 'N/A',
        sector: 'N/A',
        price: null,
        changePercent: null,
      };
    }

    const payload = await response.json();
    const data = payload?.data || payload || {};

    const price = toNumber(data.current_price ?? data.price ?? data.close);

    return {
      symbol,
      companyName: String(data.name || data.company_name || symbol).trim() || symbol,
      exchange: String(data.exchange || 'N/A').trim() || 'N/A',
      sector: String(data.sector || data.industry || 'N/A').trim() || 'N/A',
      price,
      changePercent: toNumber(data.price_change_percent ?? data.changePercent ?? data.pctChange),
    };
  } catch {
    return {
      symbol,
      companyName: symbol,
      exchange: 'N/A',
      sector: 'N/A',
      price: null,
      changePercent: null,
    };
  }
}

export default async function OpenGraphImage({ params }: Props) {
  const { symbol } = await params;
  const sym = normalizeSymbol(symbol) || 'STOCK';
  const data = await fetchStockCardData(sym);
  const isUp = (data.changePercent || 0) >= 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'linear-gradient(135deg, #0b132b 0%, #1c2541 55%, #0f172a 100%)',
          color: '#f8fafc',
          padding: '54px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 24, opacity: 0.9 }}>Vietnam Stock Analysis</div>
            <div style={{ fontSize: 92, fontWeight: 800, letterSpacing: 2, marginTop: 14 }}>{sym}</div>
            <div style={{ fontSize: 34, marginTop: 10, maxWidth: 850 }}>{data.companyName}</div>
          </div>
          <div
            style={{
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(255,255,255,0.1)',
              padding: '12px 18px',
              fontSize: 22,
            }}
          >
            {data.exchange}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 24, opacity: 0.85 }}>Latest quote</div>
            <div style={{ fontSize: 54, fontWeight: 700, marginTop: 8 }}>{formatPrice(data.price)}</div>
            <div
              style={{
                fontSize: 30,
                fontWeight: 700,
                marginTop: 8,
                color: isUp ? '#34d399' : '#fb7185',
              }}
            >
              {formatChange(data.changePercent)}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', textAlign: 'right', fontSize: 22, opacity: 0.9 }}>
            <div>{data.sector && data.sector !== 'Unknown' ? data.sector : 'Vietnam Equity'}</div>
            <div style={{ marginTop: 10 }}>stock.quanganh.org/stock/{sym}</div>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
    },
  );
}
