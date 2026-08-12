import type { Lang } from '@/lib/translations';

export function isLang(value: string | undefined | null): value is Lang {
    return value === 'vi' || value === 'en';
}

export function localizedPath(pathname: string, lang: Lang): string {
    const path = pathname.startsWith('/') ? pathname : `/${pathname}`;
    const withoutLocale = path.replace(/^\/(vi|en)(?=\/|$)/, '') || '/';
    return `/${lang}${withoutLocale === '/' ? '' : withoutLocale}`;
}
