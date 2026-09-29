import tickerData from '../../../../../public/ticker_data.json';
import { getRequestLang } from '@/lib/i18nRouting';
import StockDetailClient from './StockDetailClient';
import { notFound } from 'next/navigation';

export default async function StockDetailPage({ params }: { params: Promise<{ lang: string; symbol: string }> }) {
    const { symbol: rawSymbol } = await params;
    const symbol = rawSymbol.toUpperCase();
    const lang = await getRequestLang(params);
    const ticker = tickerData.tickers.find(item => item.symbol.toUpperCase() === symbol);
    if (!ticker) notFound();
    // Fetch the optional profile independently in the browser so a cold upstream
    // cannot delay the quote shell or the first cached render.

    return (
        <StockDetailClient
            key={`${symbol}:${lang}`}
            initialStockInfo={{
                symbol,
                companyName: (lang === 'en' ? ticker?.en_name : ticker?.name) || ticker?.name || symbol,
                sector: (lang === 'en' ? ticker?.en_sector : ticker?.sector) || ticker?.sector || 'N/A',
                exchange: ticker?.exchange || 'N/A',
                overview: { description: '' },
            }}
        />
    );
}
