import type { Metadata } from 'next';
import { BACKEND_API } from '@/lib/backendApi.server';
import { createLocalizedMetadata } from '@/lib/i18nRouting';
import { fundsCopy } from '@/lib/fundsCopy';
import type { FundSnapshot } from '@/lib/fundsApi';
import FundsClient from './FundsClient';

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
    return createLocalizedMetadata(params, '/funds', {
        vi: { title: fundsCopy.vi.title, description: fundsCopy.vi.description },
        en: { title: fundsCopy.en.title, description: fundsCopy.en.description },
    });
}

export default async function FundsPage() {
    let initial: FundSnapshot | null = null;
    try {
        const response = await fetch(`${BACKEND_API}/market/funds`, { next: { revalidate: 60 }, signal: AbortSignal.timeout(8000) });
        if (response.ok) {
            const data: FundSnapshot = await response.json();
            if (data.success && Array.isArray(data.data)) initial = data;
        }
    } catch { /* The client offers retry if the initial snapshot is unavailable. */ }
    return <FundsClient initial={initial} />;
}
