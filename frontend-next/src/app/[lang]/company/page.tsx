import Link from 'next/link';
import tickerData from '../../../../public/ticker_data.json';
import { getRequestLang, localizedPath } from '@/lib/i18nRouting';
import { createLocalizedMetadata, type LocalizedPageProps } from '@/lib/i18nRouting';

export const generateMetadata = ({ params }: LocalizedPageProps) => createLocalizedMetadata(params, '/company', {
    vi: { title: 'Danh Sách Doanh Nghiệp Niêm Yết Việt Nam', description: 'Danh sách doanh nghiệp HOSE, HNX và UPCOM theo mã cổ phiếu, tên công ty và ngành. Truy cập từng mã để xem giá, báo cáo tài chính và định giá.' },
    en: { title: 'Vietnam Listed Company Directory | HOSE, HNX, UPCOM', description: 'Browse HOSE, HNX, and UPCOM companies by ticker, name, and sector. Open each stock for prices, financial statements, and valuation.' },
});

export default async function CompanyPage({ params }: LocalizedPageProps) {
    const lang = await getRequestLang(params);
    const vi = lang === 'vi';
    const exchanges = Array.from(new Set(tickerData.tickers.map(ticker => ticker.exchange))).sort();
    return (
        <div className="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
            <header className="space-y-3">
                <h1 className="text-2xl font-bold">{vi ? 'Danh sách doanh nghiệp Việt Nam' : 'Vietnam company directory'}</h1>
                <p className="text-slate-600 dark:text-slate-400">
                    {vi
                        ? `${tickerData.tickers.length.toLocaleString('vi-VN')} doanh nghiệp trong danh mục. Chọn mã cổ phiếu để xem giá giao dịch, báo cáo tài chính, cổ đông và công cụ định giá.`
                        : `${tickerData.tickers.length.toLocaleString('en-US')} companies in the catalogue. Select a stock to explore trading prices, financial statements, shareholders, and valuation tools.`}
                </p>
                <Link href={localizedPath('/screener', lang)} className="inline-block text-indigo-600 underline dark:text-indigo-400">
                    {vi ? 'Lọc cổ phiếu theo chỉ số tài chính' : 'Screen stocks by financial metrics'}
                </Link>
                <nav aria-label={vi ? 'Sàn giao dịch' : 'Exchanges'} className="flex flex-wrap gap-4">
                    {exchanges.map(exchange => <a key={exchange} href={`#exchange-${exchange}`} className="font-semibold text-indigo-600 dark:text-indigo-400">{exchange}</a>)}
                </nav>
            </header>
            {exchanges.map(exchange => (
                <section key={exchange} id={`exchange-${exchange}`} className="scroll-mt-24 space-y-3">
                    <h2 className="text-xl font-semibold">{exchange}</h2>
                    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {tickerData.tickers.filter(ticker => ticker.exchange === exchange)
                            .sort((a, b) => a.symbol.localeCompare(b.symbol)).map(ticker => (
                                <li key={ticker.symbol} className="rounded-lg border border-slate-200 p-4 dark:border-slate-800">
                                    <Link href={localizedPath(`/stock/${ticker.symbol}`, lang)} prefetch={false} className="block space-y-1 hover:text-indigo-600 dark:hover:text-indigo-400">
                                        <span className="font-bold">{ticker.symbol}</span>
                                        <span className="block text-sm">{(vi ? ticker.name : ticker.en_name) || ticker.name}</span>
                                    </Link>
                                    <p className="mt-2 text-xs text-slate-500">{(vi ? ticker.sector : ticker.en_sector) || ticker.sector}</p>
                                </li>
                            ))}
                    </ul>
                </section>
            ))}
        </div>
    );
}
