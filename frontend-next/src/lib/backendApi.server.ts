import 'server-only';

// Browser HTTP requests use /api; only server code resolves the upstream URL.
export const BACKEND_API = (
    process.env.NODE_ENV === 'development'
        ? (process.env.BACKEND_API_URL_LOCAL || 'http://127.0.0.1:8000/api')
        : (process.env.BACKEND_API_URL || 'https://api.quanganh.org/v1/valuation')
).replace(/\/+$/, '');
