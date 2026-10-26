import { NextRequest, NextResponse } from 'next/server';
import tickerData from '../public/ticker_data.json';
const PUBLIC_FILE = /\.[^/]+$/;
const isLang = (value: string): value is 'vi' | 'en' => value === 'vi' || value === 'en';
const stockSymbols = new Set(tickerData.tickers.map(ticker => ticker.symbol.toUpperCase()));

export function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    if (pathname.startsWith('/_next') || pathname.startsWith('/api') || pathname === '/robots.txt' || pathname === '/sitemap.xml') {
        return NextResponse.next();
    }

    // loading.tsx can flush a 200 response before notFound() executes. Reject
    // unknown ticker pages before rendering so their actual HTTP status is 404.
    const stockDetail = /^\/(?:vi\/|en\/)?stock\/([^/]+)\/?$/.exec(pathname);
    if (stockDetail && !stockSymbols.has(stockDetail[1].toUpperCase())) {
        const url = request.nextUrl.clone();
        const locale = pathname.split('/')[1];
        url.pathname = `/${isLang(locale) ? locale : 'vi'}/404`;
        const response = NextResponse.rewrite(url, { status: 404 });
        response.headers.set('X-Robots-Tag', 'noindex');
        return response;
    }
    if (PUBLIC_FILE.test(pathname)) return NextResponse.next();

    // Locale preference is cookie-dependent; only explicit locale URLs share HTML caches.
    if (pathname === '/') {
        const preferred = request.cookies.get('lang')?.value;
        const url = request.nextUrl.clone();
        url.pathname = isLang(preferred || '') ? `/${preferred}` : '/vi';
        const response = NextResponse.redirect(url, 307);
        response.headers.set('Cache-Control', 'private, no-store');
        return response;
    }

    const parts = pathname.split('/');
    const locale = parts[1];
    // Symbols have one URL spelling, including old unprefixed links.
    const symbolPath = /^\/(?:vi\/|en\/)?(stock|funds)\/([a-zA-Z0-9-]+)(\/.*)?$/.exec(pathname);
    if (symbolPath) {
        const url = request.nextUrl.clone();
        url.pathname = `/${isLang(locale) ? locale : 'vi'}/${symbolPath[1]}/${symbolPath[2].toUpperCase()}${symbolPath[3] || ''}`;
        if (url.pathname !== pathname) return NextResponse.redirect(url, 308);
    }
    if (!isLang(locale)) {
        const url = request.nextUrl.clone();
        url.pathname = `/vi${pathname}`;
        return NextResponse.redirect(url, 308);
    }

    return NextResponse.next();
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
