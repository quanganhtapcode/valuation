import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));

const securityHeaders = [
  {
    key: 'X-Frame-Options',
    value: 'SAMEORIGIN',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

const immutableAssetHeaders = [
  {
    key: 'Cache-Control',
    value: 'public, max-age=31536000, immutable',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  poweredByHeader: false,
  turbopack: {
    root: projectRoot,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 86400,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'vietcap-documents.s3.ap-southeast-1.amazonaws.com',
        pathname: '/sentiment/logo/**',
      },
    ],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        source: '/ticker_data.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, stale-while-revalidate=86400',
          },
        ],
      },
      {
        source: '/vci_field_codes.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/favicon.ico',
        headers: immutableAssetHeaders,
      },
      {
        source: '/favicon-16x16.png',
        headers: immutableAssetHeaders,
      },
      {
        source: '/favicon-32x32.png',
        headers: immutableAssetHeaders,
      },
      {
        source: '/apple-touch-icon.png',
        headers: immutableAssetHeaders,
      },
      {
        source: '/android-chrome-192x192.png',
        headers: immutableAssetHeaders,
      },
      {
        source: '/android-chrome-512x512.png',
        headers: immutableAssetHeaders,
      },
    ]
  },
};

export default nextConfig;
