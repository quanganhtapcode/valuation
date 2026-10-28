import { siteConfig } from '@/config/siteConfig';

// Identifies the website's server-side requests at the origin. These public
// headers are not credentials and must never be treated as authentication.
export const backendRequestHeaders = {
    Origin: siteConfig.url,
    Referer: `${siteConfig.url}/`,
};
