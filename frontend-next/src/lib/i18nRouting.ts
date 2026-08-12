import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { siteConfig } from '@/app/siteConfig';
import type { Lang } from '@/lib/translations';
import { isLang, localizedPath } from '@/lib/localePath';

export const supportedLanguages = ['vi', 'en'] as const;
export { localizedPath } from '@/lib/localePath';

export async function getRequestLang(): Promise<Lang> {
    const value = (await headers()).get('x-site-locale');
    return isLang(value) ? value : 'vi';
}

type SeoCopy = { title: string; description: string; keywords?: string[] };

export async function createLocalizedMetadata(path: string, copies: Record<Lang, SeoCopy>, options?: { type?: 'website' | 'article'; index?: boolean }): Promise<Metadata> {
    const lang = await getRequestLang();
    const copy = copies[lang];
    const canonical = localizedPath(path, lang);
    const imageAlt = lang === 'vi' ? 'Quang Anh – Nền tảng phân tích cổ phiếu Việt Nam' : 'Quang Anh – Vietnam stock analysis platform';

    return {
        title: copy.title,
        description: copy.description,
        keywords: copy.keywords,
        alternates: {
            canonical,
            languages: { 'vi-VN': localizedPath(path, 'vi'), 'en-US': localizedPath(path, 'en'), 'x-default': localizedPath(path, 'vi') },
        },
        robots: { index: options?.index !== false, follow: true },
        openGraph: {
            title: copy.title,
            description: copy.description,
            url: canonical,
            siteName: siteConfig.shortName,
            type: options?.type ?? 'website',
            locale: lang === 'vi' ? 'vi_VN' : 'en_US',
            alternateLocale: [lang === 'vi' ? 'en_US' : 'vi_VN'],
            images: [{ url: siteConfig.defaultOgImage, width: 512, height: 512, alt: imageAlt }],
        },
        twitter: { card: 'summary_large_image', title: copy.title, description: copy.description, images: [siteConfig.defaultOgImage] },
    };
}
