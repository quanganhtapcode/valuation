import { NextResponse } from 'next/server';

const VIETCAP_DETAILS_URL = 'https://iq.vietcap.com.vn/api/iq-insight-service/v1/company/details';
const PROFILE_REVALIDATE_SECONDS = 60 * 60 * 24 * 30;

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

    try {
        const response = await fetch(`${VIETCAP_DETAILS_URL}?ticker=${encodeURIComponent(symbol)}`, {
            headers: {
                Accept: 'application/json',
                'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8',
                Origin: 'https://trading.vietcap.com.vn',
                Referer: 'https://trading.vietcap.com.vn/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
                'device-id': '7a3c8d9e1f20',
            },
            next: { revalidate: PROFILE_REVALIDATE_SECONDS },
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            return NextResponse.json({ available: false }, { status: response.status });
        }

        const payload = await response.json();
        const details = payload?.data;
        const profile = language === 'en' ? details?.enProfile : details?.profile;

        return NextResponse.json(
            {
                available: typeof profile === 'string' && Boolean(profile.trim()),
                profile: typeof profile === 'string' ? profile : null,
                source: 'Vietcap IQ',
            },
            {
                headers: {
                    'Cache-Control': `public, s-maxage=${PROFILE_REVALIDATE_SECONDS}, stale-while-revalidate=604800`,
                },
            },
        );
    } catch (error) {
        console.error(`Vietcap company profile request failed for ${symbol}:`, error);
        return NextResponse.json({ available: false }, { status: 502 });
    }
}
