// ── Types ──────────────────────────────────────────────────────────────────────

export type DownloadStatus = 'idle' | 'loading' | 'done' | 'error';
export type ExportFormat   = 'CSV' | 'XLSX';
export type MainTab        = 'market' | 'stock' | 'macro';
export type MarketGroupId  = 'ALL' | 'market' | 'indices' | 'valuation' | 'reference';

export type FlatRow = Record<string, string | number | boolean | null>;

export type Dataset = {
    id: string;
    title: string;
    description: string;
    endpoint: string | ((symbol: string) => string);
    group: Exclude<MarketGroupId, 'ALL'>;
    formats: ExportFormat[];
    filename: (format: ExportFormat, symbol?: string) => string;
    notes?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export const today = () => new Date().toISOString().slice(0, 10);
export const DATE_FIELD_HINT       = /(date|time|timestamp|trading|ngay)/i;
export const DATE_FIELD_CANDIDATES = ['date', 'tradingDate', 'trading_date', 'time', 'timestamp', 'datetime', 'published_at', 'created_at'];

export function slugifyForFilename(input: string): string {
    const slug = input
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .toLowerCase();
    return slug || 'unknown';
}

// ── Market datasets ───────────────────────────────────────────────────────────

export const MARKET_DATASETS: Dataset[] = [
    {
        id: 'vci-indices',
        title: 'Chỉ số thị trường',
        description: 'VNINDEX, VN30, HNX, UPCOM — giá, thay đổi, khối lượng khớp.',
        endpoint: '/api/market/vci-indices',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `market_indices_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'top-movers-up',
        title: 'Tăng mạnh nhất',
        description: 'Top cổ phiếu tăng giá mạnh nhất phiên.',
        endpoint: '/api/market/top-movers?type=UP',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `top_movers_up_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'top-movers-down',
        title: 'Giảm mạnh nhất',
        description: 'Top cổ phiếu giảm giá mạnh nhất phiên.',
        endpoint: '/api/market/top-movers?type=DOWN',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `top_movers_down_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'market-news',
        title: 'Tin tức thị trường',
        description: 'Tin tức mới nhất với điểm sentiment AI (Positive/Negative/Neutral).',
        endpoint: '/api/market/news',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `market_news_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'heatmap-hsx',
        title: 'Heatmap HSX (phẳng)',
        description: 'Toàn bộ cổ phiếu HSX với ngành, giá, % thay đổi, vốn hóa.',
        endpoint: '/api/market/heatmap?exchange=HSX&limit=300&flat=1',
        group: 'market',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `heatmap_hsx_${today()}.${f.toLowerCase()}`,
        notes: 'Dữ liệu đã flatten — mỗi dòng là 1 cổ phiếu.',
    },
    {
        id: 'vnindex-history',
        title: 'VNINDEX — Lịch sử OHLCV',
        description: 'Dữ liệu giá mở/đóng, cao/thấp, khối lượng và foreign flow theo ngày.',
        endpoint: '/api/market/index-history?index=VNINDEX&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `vnindex_history_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'vn30-history',
        title: 'VN30 — Lịch sử OHLCV',
        description: 'Dữ liệu lịch sử chỉ số VN30.',
        endpoint: '/api/market/index-history?index=VN30&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `vn30_history_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'hnx-history',
        title: 'HNX — Lịch sử OHLCV',
        description: 'Dữ liệu lịch sử chỉ số HNX.',
        endpoint: '/api/market/index-history?index=HNXIndex&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `hnx_history_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'upcom-history',
        title: 'UPCOM — Lịch sử OHLCV',
        description: 'Dữ liệu lịch sử chỉ số UPCOM.',
        endpoint: '/api/market/index-history?index=HNXUpcomIndex&days=5000',
        group: 'indices',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `upcom_history_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'index-valuation',
        title: 'Định giá VNINDEX (PE/PB)',
        description: 'Chuỗi thời gian PE và PB của VNINDEX so với các mức trung bình lịch sử.',
        endpoint: '/api/market/pe-chart?metric=both&time_frame=ALL',
        group: 'valuation',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `vnindex_valuation_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'gold',
        title: 'Giá vàng',
        description: 'Giá vàng SJC và các thương hiệu khác (mua/bán).',
        endpoint: '/api/market/gold',
        group: 'valuation',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `gold_prices_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'world-indices',
        title: 'Chỉ số thế giới',
        description: 'S&P 500, Nasdaq, Nikkei, Hang Seng và các chỉ số toàn cầu khác.',
        endpoint: '/api/market/world-indices',
        group: 'reference',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `world_indices_${today()}.${f.toLowerCase()}`,
    },
    {
        id: 'tickers',
        title: 'Danh sách mã cổ phiếu',
        description: 'Toàn bộ ~1556 mã niêm yết: mã, tên công ty, ngành, sàn.',
        endpoint: '/api/tickers',
        group: 'reference',
        formats: ['CSV', 'XLSX'],
        filename: (f) => `tickers_${today()}.${f.toLowerCase()}`,
    },
];

// ── Per-stock datasets ────────────────────────────────────────────────────────

export type StockDataset = {
    id: string;
    title: string;
    description: string;
    endpoint: (symbol: string) => string;
    filename: (format: ExportFormat, symbol: string) => string;
    badge: string;
    badgeColor: string;
    notes?: string;
};

export const STOCK_DATASETS: StockDataset[] = [
    {
        id: 'price-history',
        title: 'Lịch sử giá (OHLCV)',
        description: 'Giá mở/đóng/cao/thấp, khối lượng giao dịch theo ngày — toàn bộ lịch sử.',
        endpoint: (s) => `/api/stock/history/${s}?period=ALL`,
        filename: (f, s) => `${s}_price_history_${today()}.${f.toLowerCase()}`,
        badge: 'Giá',
        badgeColor: 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30',
    },
    {
        id: 'financial-report',
        title: 'Báo cáo tài chính',
        description: 'Kết quả kinh doanh, bảng cân đối kế toán, lưu chuyển tiền tệ — theo quý/năm.',
        endpoint: (s) => `/api/financial-report/${s}`,
        filename: (f, s) => `${s}_financial_report_${today()}.${f.toLowerCase()}`,
        badge: 'Tài chính',
        badgeColor: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30',
    },
    {
        id: 'financial-ratios',
        title: 'Chỉ số tài chính lịch sử',
        description: 'ROE, ROA, P/E, P/B, EPS, biên lợi nhuận, thanh khoản — theo quý.',
        endpoint: (s) => `/api/historical-chart-data/${s}?period=quarter`,
        filename: (f, s) => `${s}_financial_ratios_${today()}.${f.toLowerCase()}`,
        badge: 'Tài chính',
        badgeColor: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30',
    },
    {
        id: 'company-profile',
        title: 'Hồ sơ công ty',
        description: 'Thông tin cơ bản: tên, ngành, vốn điều lệ, số cổ phiếu lưu hành, giới thiệu.',
        endpoint: (s) => `/api/company/profile/${s}`,
        filename: (f, s) => `${s}_company_profile_${today()}.${f.toLowerCase()}`,
        badge: 'Công ty',
        badgeColor: 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30',
    },
    {
        id: 'stock-snapshot',
        title: 'Snapshot hiện tại',
        description: 'Giá hiện tại, vốn hóa, P/E, P/B, EPS, tăng trưởng doanh thu — tất cả trong 1 dòng.',
        endpoint: (s) => `/api/stock/${s}?fetch_price=true`,
        filename: (f, s) => `${s}_snapshot_${today()}.${f.toLowerCase()}`,
        badge: 'Tổng quan',
        badgeColor: 'text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-700',
    },
    {
        id: 'stats-financial',
        title: 'Thông số VCI (stats_financial)',
        description: 'Bản ghi mới nhất từ bảng vci_stats_financial.stats_financial: PE/PB/ROE/ROA, NIM, NPL, LDR, market cap, shares...',
        endpoint: (s) => `/api/stock/${s}/stats-financial`,
        filename: (f, s) => `${s}_stats_financial_${today()}.${f.toLowerCase()}`,
        badge: 'Tài chính',
        badgeColor: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30',
        notes: 'CSV xuất UTF-8 (kèm BOM) để mở đúng tiếng Việt trong Excel.',
    },
    {
        id: 'news-sentiment',
        title: 'Tin tức & Sentiment AI',
        description: 'Tin tức gần nhất với điểm phân tích sentiment (Positive/Negative/Neutral).',
        endpoint: (s) => `/api/news/${s}`,
        filename: (f, s) => `${s}_news_${today()}.${f.toLowerCase()}`,
        badge: 'Tin tức',
        badgeColor: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30',
    },
    {
        id: 'holders',
        title: 'Cơ cấu cổ đông',
        description: 'Danh sách cổ đông lớn với tỷ lệ sở hữu.',
        endpoint: (s) => `/api/stock/holders/${s}`,
        filename: (f, s) => `${s}_holders_${today()}.${f.toLowerCase()}`,
        badge: 'Cổ đông',
        badgeColor: 'text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/30',
    },
    {
        id: 'stock-events',
        title: 'Sự kiện cổ phiếu',
        description: 'Cổ tức, đại hội cổ đông, ngày giao dịch không hưởng quyền.',
        endpoint: (s) => `/api/events/${s}`,
        filename: (f, s) => `${s}_events_${today()}.${f.toLowerCase()}`,
        badge: 'Sự kiện',
        badgeColor: 'text-cyan-700 dark:text-cyan-300 bg-cyan-50 dark:bg-cyan-900/30',
    },
];

// ── Group config ──────────────────────────────────────────────────────────────

export const MARKET_GROUPS: { id: MarketGroupId; label: string }[] = [
    { id: 'ALL',       label: 'Tất cả' },
    { id: 'market',    label: 'Market' },
    { id: 'indices',   label: 'Lịch sử Index' },
    { id: 'valuation', label: 'Valuation' },
    { id: 'reference', label: 'Reference' },
];

export const GROUP_STYLES: Record<Exclude<MarketGroupId, 'ALL'>, string> = {
    market:    'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30',
    indices:   'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30',
    valuation: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30',
    reference: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30',
};

export const GROUP_LABELS: Record<Exclude<MarketGroupId, 'ALL'>, string> = {
    market: 'Market', indices: 'Lịch sử', valuation: 'Valuation', reference: 'Reference',
};


export const MACRO_BADGE_FX   = 'text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30';
export const MACRO_BADGE_COMM = 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30';
export const MACRO_BADGE_ECO  = 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30';
export const MACRO_BADGE_FA   = 'text-violet-700 dark:text-violet-300 bg-violet-50 dark:bg-violet-900/30';

export const MACRO_HISTORY_CARDS = [
    { title: 'USD/VND — Lịch sử', badge: 'Tỷ giá', badgeColor: MACRO_BADGE_FX, description: 'Tỷ giá USD/VND hàng ngày — toàn bộ lịch sử từ Yahoo Finance.', endpoint: '/api/market/macro/history?symbol=USDVND%3DX&full=1', filename: (f: ExportFormat) => `usdvnd_history_${today()}.${f.toLowerCase()}` },
    { title: 'EUR/VND — Lịch sử', badge: 'Tỷ giá', badgeColor: MACRO_BADGE_FX, description: 'Tỷ giá EUR/VND hàng ngày — toàn bộ lịch sử.', endpoint: '/api/market/macro/history?symbol=EURVND%3DX&full=1', filename: (f: ExportFormat) => `eurvnd_history_${today()}.${f.toLowerCase()}` },
    { title: 'CNY/VND — Lịch sử', badge: 'Tỷ giá', badgeColor: MACRO_BADGE_FX, description: 'Tỷ giá CNY/VND hàng ngày — toàn bộ lịch sử.', endpoint: '/api/market/macro/history?symbol=CNYVND%3DX&full=1', filename: (f: ExportFormat) => `cnyvnd_history_${today()}.${f.toLowerCase()}` },
    { title: 'JPY/VND — Lịch sử', badge: 'Tỷ giá', badgeColor: MACRO_BADGE_FX, description: 'Tỷ giá JPY/VND hàng ngày — toàn bộ lịch sử.', endpoint: '/api/market/macro/history?symbol=JPYVND%3DX&full=1', filename: (f: ExportFormat) => `jpyvnd_history_${today()}.${f.toLowerCase()}` },
    { title: 'Brent Crude — Lịch sử', badge: 'Hàng hóa', badgeColor: MACRO_BADGE_COMM, description: 'Giá dầu thô Brent (USD/bbl) hàng ngày — toàn bộ lịch sử từ Yahoo Finance.', endpoint: '/api/market/macro/history?symbol=BZ%3DF&full=1', filename: (f: ExportFormat) => `brent_history_${today()}.${f.toLowerCase()}` },
    { title: 'Bạc (Silver) — Lịch sử', badge: 'Hàng hóa', badgeColor: MACRO_BADGE_COMM, description: 'Giá bạc (USD/oz) hàng ngày — toàn bộ lịch sử.', endpoint: '/api/market/macro/history?symbol=SI%3DF&full=1', filename: (f: ExportFormat) => `silver_history_${today()}.${f.toLowerCase()}` },
    { title: 'Lúa gạo (Rice) — Lịch sử', badge: 'Hàng hóa', badgeColor: MACRO_BADGE_COMM, description: 'Giá lúa gạo (USD/cwt) hàng ngày — toàn bộ lịch sử.', endpoint: '/api/market/macro/history?symbol=ZR%3DF&full=1', filename: (f: ExportFormat) => `rice_history_${today()}.${f.toLowerCase()}` },
    { title: 'Vàng (Gold) — Lịch sử', badge: 'Hàng hóa', badgeColor: MACRO_BADGE_COMM, description: 'Giá vàng thế giới (USD/oz) hàng ngày — toàn bộ lịch sử.', endpoint: '/api/market/macro/history?symbol=GC%3DF&full=1', filename: (f: ExportFormat) => `gold_futures_history_${today()}.${f.toLowerCase()}` },
];

export const MACRO_ECO_CARDS: { title: string; badge: string; badgeColor: string; description: string; endpoint: string; extract: (d: unknown) => unknown; filename: (f: ExportFormat) => string; notes?: string }[] = [
    { title: 'CPI Việt Nam (YoY)', badge: 'Kinh tế', badgeColor: MACRO_BADGE_ECO, description: 'Chỉ số giá tiêu dùng Việt Nam theo tháng — % so với cùng kỳ năm trước — toàn bộ lịch sử.', endpoint: '/api/market/macro/economic?full=1', extract: (d) => (d as Record<string, unknown>).cpi, filename: (f: ExportFormat) => `vn_cpi_${today()}.${f.toLowerCase()}` },
    { title: 'GDP Việt Nam (YoY)', badge: 'Kinh tế', badgeColor: MACRO_BADGE_ECO, description: 'Tăng trưởng GDP Việt Nam theo quý — % so với cùng kỳ — toàn bộ lịch sử.', endpoint: '/api/market/macro/economic?full=1', extract: (d) => (d as Record<string, unknown>).gdp, filename: (f: ExportFormat) => `vn_gdp_${today()}.${f.toLowerCase()}` },
    { title: 'Lợi suất TPCP 10 năm', badge: 'Kinh tế', badgeColor: MACRO_BADGE_ECO, description: 'Lãi suất trái phiếu Chính phủ Việt Nam kỳ hạn 10 năm (%) theo tháng — toàn bộ lịch sử.', endpoint: '/api/market/macro/economic?full=1', extract: (d) => (d as Record<string, unknown>).vn10y, filename: (f: ExportFormat) => `vn10y_yield_${today()}.${f.toLowerCase()}` },
];

export const MACRO_FA_CARDS: { type: string; title: string; description: string }[] = [
    { type: 'GDP',          title: 'GDP & Tăng trưởng',   description: 'GDP tổng, tăng trưởng QoQ/YoY, GDP bình quân đầu người, tăng trưởng theo ngành.' },
    { type: 'Prices',       title: 'Lạm phát & Giá cả',   description: 'CPI tổng, lõi, PPI, chỉ số giá tiêu dùng theo nhóm hàng.' },
    { type: 'Trade',        title: 'Thương mại quốc tế',  description: 'Cán cân thương mại, xuất khẩu, nhập khẩu, FDI, tài khoản vãng lai.' },
    { type: 'Labour',       title: 'Lao động & Dân số',   description: 'Tỷ lệ thất nghiệp, dân số, lương trung bình.' },
    { type: 'Money',        title: 'Tiền tệ & Tín dụng',  description: 'Dự trữ ngoại hối, M0/M1/M2, lãi suất tiền gửi.' },
    { type: 'Consumer',     title: 'Tiêu dùng',            description: 'Doanh thu bán lẻ, giá xăng, chỉ số niềm tin người tiêu dùng.' },
    { type: 'Business',     title: 'Sản xuất & Kinh doanh', description: 'PMI, sản xuất công nghiệp, sản lượng điện, doanh số ô tô.' },
    { type: 'InterestRate', title: 'Lãi suất điều hành',  description: 'Lãi suất qua đêm, 1 tuần, 1 tháng, 3 tháng, lãi suất tái cấp vốn.' },
    { type: 'Taxes',        title: 'Thuế & Ngân sách',    description: 'Thu thuế TNDN, TNCN, VAT.' },
];

