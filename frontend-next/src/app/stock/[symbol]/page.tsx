import tickerData from '../../../../public/ticker_data.json';
import { getRequestLang } from '@/lib/i18nRouting';
import { getCompanyProfile, profileToText } from '@/lib/companyProfile.server';
import StockDetailClient from './StockDetailClient';

export default async function StockDetailPage({ params }: { params: Promise<{ symbol: string }> }) {
    const { symbol: rawSymbol } = await params;
    const symbol = rawSymbol.toUpperCase();
    const lang = await getRequestLang();
    const ticker = tickerData.tickers.find(item => item.symbol.toUpperCase() === symbol);
    const profile = await getCompanyProfile(symbol, lang);

    return (
        <StockDetailClient
            key={`${symbol}:${lang}`}
            initialStockInfo={{
                symbol,
                companyName: (lang === 'en' ? ticker?.en_name : ticker?.name) || ticker?.name || symbol,
                sector: (lang === 'en' ? ticker?.en_sector : ticker?.sector) || ticker?.sector || 'N/A',
                exchange: ticker?.exchange || 'N/A',
                overview: { description: profileToText(profile) },
            }}
        />
    );
}
