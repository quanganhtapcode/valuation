import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { BACKEND_API } from '@/lib/backendApi.server';
import { backendRequestHeaders } from '@/lib/backendRequestHeaders';
import { createLocalizedMetadata, getRequestLang, localizedPath } from '@/lib/i18nRouting';
import type { FundDetail } from '@/lib/fundsApi';
import FundDetailClient from './FundDetailClient';

type Props = { params: Promise<{ lang: string; symbol: string }> };

const loadFund = cache(async (symbol: string): Promise<FundDetail> => {
    const response = await fetch(`${BACKEND_API}/market/funds/${encodeURIComponent(symbol.toUpperCase())}`, { headers: backendRequestHeaders, next: { revalidate: 300 }, signal: AbortSignal.timeout(10000) });
    if (response.status === 404) notFound();
    if (!response.ok) throw new Error('Unable to load fund');
    return response.json();
});

export async function generateMetadata({ params }: Props) {
    const { symbol } = await params;
    const { fund } = await loadFund(symbol.toUpperCase());
    return createLocalizedMetadata(params, `/funds/${symbol.toUpperCase()}`, {
        vi: { title: `${fund.short_name} · NAV`, description: `Theo dõi NAV và hiệu suất ${fund.name}, quản lý bởi ${fund.fund_owner_name}.` },
        en: { title: `${fund.short_name} · NAV`, description: `Track NAV and performance of ${fund.name}, managed by ${fund.fund_owner_name}.` },
    });
}

export default async function FundPage({ params }: Props) {
    const { symbol } = await params;
    const lang = await getRequestLang(params);
    const detail = await loadFund(symbol.toUpperCase());
    if (symbol !== symbol.toUpperCase()) permanentRedirect(localizedPath(`/funds/${symbol.toUpperCase()}`, lang));
    return <FundDetailClient detail={detail} />;
}
