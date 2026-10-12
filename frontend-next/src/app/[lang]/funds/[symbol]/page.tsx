import { notFound } from 'next/navigation';
import { BACKEND_API } from '@/lib/backendApi.server';
import type { FundDetail } from '@/lib/fundsApi';
import FundDetailClient from './FundDetailClient';

export async function generateMetadata({ params }: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await params;
    return { title: `${symbol.toUpperCase()} · NAV` };
}

export default async function FundPage({ params }: { params: Promise<{ symbol: string }> }) {
    const { symbol } = await params;
    const response = await fetch(`${BACKEND_API}/market/funds/${encodeURIComponent(symbol.toUpperCase())}`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(10000) });
    if (response.status === 404) notFound();
    if (!response.ok) throw new Error('Unable to load fund');
    const detail: FundDetail = await response.json();
    return <FundDetailClient detail={detail} />;
}
