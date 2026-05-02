import { MetadataRoute } from 'next';
import { siteConfig } from '@/app/siteConfig';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/_next/static/',
          '/_next/image',
        ],
        disallow: [
          '/api/',
          '/stock/*/opengraph-image',
        ],
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
  };
}
