import 'server-only';

// Server rendering and legacy /api routes call the same backend directly.
export const BACKEND_API = (
    process.env.NODE_ENV === 'development'
        ? (process.env.BACKEND_API_URL_LOCAL || 'http://127.0.0.1:8000/api')
        : (process.env.BACKEND_API_URL || 'https://trading-api.quanganh.org/v1/valuation')
).replace(/\/+$/, '');
