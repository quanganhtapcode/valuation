import { MetadataRoute } from 'next';
import { siteConfig } from '@/config/siteConfig';

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
        // Public JSON is needed to render quotes, charts and company profiles.
        // X-Robots-Tag prevents API indexing without blocking rendering.
      },
    ],
    sitemap: `${siteConfig.url}/sitemap.xml`,
    host: siteConfig.url,
  };
}
