import { NextResponse } from 'next/server';
import { getCompanyProfile } from '@/lib/companyProfile.server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ ticker: string }> },
) {
    const { ticker } = await params;
    const symbol = ticker.toUpperCase();
    const language = new URL(request.url).searchParams.get('lang') === 'en' ? 'en' : 'vi';

    if (!/^[A-Z0-9]{1,10}$/.test(symbol)) {
        return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
    }

    const profile = await getCompanyProfile(symbol, language, 10000);
    return NextResponse.json(
        { available: Boolean(profile), profile, source: 'Vietcap IQ' },
        { headers: { 'Cache-Control': profile
            ? 'public, s-maxage=2592000, stale-while-revalidate=604800'
            : 'no-store' } },
    );
}
