export const MAX_MONTHLY = 36;
export const MAX_QUARTERLY = 20;
export const MAX_ANNUAL = 20;
export const MAX_DAILY = 60;

export interface RateItem {
    symbol: string;
    name: string;
    price: number;
    change: number;
    changePercent: number;
    unit?: string;
}

export interface PricePoint {
    date: string;
    close: number;
}

export interface RatesData {
    exchange_rates: RateItem[];
    commodities: RateItem[];
}

export interface FAIndicator {
    id: number;
    nameVN: string;
    name: string;
    unit: string;
    frequency: string;
    source?: string;
    lastValue: number | null;
    lastDate: string;
    data: { date: string; value: number }[];
}

export type FAData = Record<string, FAIndicator[]>;
export type VietnamSubTabId = 'growth' | 'prices' | 'trade' | 'money' | 'labour' | 'taxes';
export type DetailSelection = { kind: 'tv'; key: string } | { kind: 'fa'; key: number; type: string };
export type TremorColor = 'blue' | 'cyan' | 'emerald' | 'gray' | 'green' | 'indigo' | 'lime' | 'orange' | 'pink' | 'purple' | 'red' | 'rose' | 'sky' | 'slate' | 'teal' | 'violet' | 'yellow';

export const RANGE_OPTIONS = [
    { label: '1T', days: 30 },
    { label: '3T', days: 90 },
    { label: '6T', days: 180 },
    { label: '1N', days: 365 },
    { label: '3N', days: 1095 },
] as const;

export const RATES_REFRESH_MS = 5 * 60 * 1000;

export function downsample<T>(arr: T[], max: number): T[] {
    return arr.length > max ? arr.slice(arr.length - max) : arr;
}

export function limitByFreq<T>(arr: T[], freq: string): T[] {
    if (freq.includes('ngày') || freq.includes('ngay')) return downsample(arr, MAX_DAILY);
    if (freq.includes('tháng') || freq.includes('thang')) return downsample(arr, MAX_MONTHLY);
    if (freq.includes('quý') || freq.includes('Quý')) return downsample(arr, MAX_QUARTERLY);
    return downsample(arr, MAX_ANNUAL);
}

export function fmtVndPrice(val: number) {
    if (val >= 1000) return val.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (val >= 10) return val.toFixed(2);
    return val.toFixed(4);
}

export function fmtUsdPrice(val: number) {
    if (val >= 1000) return val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return val.toFixed(2);
}

export function fmtVndChange(val: number) {
    const abs = Math.abs(val);
    return `${val >= 0 ? '+' : '-'}${abs >= 10 ? abs.toFixed(0) : abs.toFixed(2)}`;
}

export function fmtUsdChange(val: number) {
    return `${val >= 0 ? '+' : '-'}${Math.abs(val).toFixed(2)}`;
}

export const fmtPct = (v: number) => `${v.toFixed(2)}%`;
export const fmtBillUSD = (v: number) => `${(v / 1e9).toFixed(1)} tỷ $`;
export const fmtTrVND = (v: number) => `${(v / 1e12).toFixed(0)} nghìn tỷ ₫`;
export const fmtMilVND = (v: number) => `${(v / 1e6).toFixed(1)} triệu ₫`;
export const fmtMilPpl = (v: number) => `${(v / 1e6).toFixed(1)}M người`;
export const fmtUSD = (v: number) => `$${v.toFixed(0)}`;
export const fmtUSDL = (v: number) => `$${v.toFixed(2)}/L`;
export const fmtIdx = (v: number) => v.toFixed(2);

export interface FFCardDef {
    channel: string;
    label: string;
    fmt: (p: number) => string;
}

export const FF_FOREX_CHANNELS = [
    { channel: 'EUR/USD', label: 'EUR/USD', fmt: (p: number) => p.toFixed(4) },
    { channel: 'GBP/USD', label: 'GBP/USD', fmt: (p: number) => p.toFixed(4) },
    { channel: 'USD/JPY', label: 'USD/JPY', fmt: (p: number) => p.toFixed(2) },
    { channel: 'AUD/USD', label: 'AUD/USD', fmt: (p: number) => p.toFixed(4) },
    { channel: 'USD/CHF', label: 'USD/CHF', fmt: (p: number) => p.toFixed(4) },
    { channel: 'USD/CAD', label: 'USD/CAD', fmt: (p: number) => p.toFixed(4) },
    { channel: 'NZD/USD', label: 'NZD/USD', fmt: (p: number) => p.toFixed(4) },
] as const;

export const FF_ASIA_CHANNELS = [
    { channel: 'Nikkei225/USD', label: 'Nikkei 225', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'ASX/USD', label: 'ASX 200', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
] as const;

export const FF_EUROPE_CHANNELS = [
    { channel: 'DAX/USD', label: 'DAX', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'FTSE100/USD', label: 'FTSE 100', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'CAC/USD', label: 'CAC 40', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'STOXX50/USD', label: 'Euro Stoxx 50', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
] as const;

export const FF_AMERICAS_CHANNELS = [
    { channel: 'SPX/USD', label: 'S&P 500', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'NDX/USD', label: 'Nasdaq 100', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'Dow/USD', label: 'Dow Jones', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'US2000/USD', label: 'Russell 2000', fmt: (p: number) => p.toLocaleString('en', { maximumFractionDigits: 0 }) },
    { channel: 'VIX/USD', label: 'VIX', fmt: (p: number) => p.toFixed(2) },
    { channel: 'DXY/USD', label: 'USD Index', fmt: (p: number) => p.toFixed(2) },
] as const;

export const FF_ALL_INDEX_CHANNELS = [...FF_ASIA_CHANNELS, ...FF_EUROPE_CHANNELS, ...FF_AMERICAS_CHANNELS];

export const FF_TO_YAHOO: Record<string, string> = {
    'Gold/USD': 'GC=F',
    'WTI/USD': 'CL=F',
    'Silver/USD': 'SI=F',
    'Brent/USD': 'BZ=F',
};

export function getMarketSessions(): { asia: boolean; europe: boolean; americas: boolean } {
    const d = new Date();
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return { asia: false, europe: false, americas: false };
    const t = d.getUTCHours() * 60 + d.getUTCMinutes();
    return {
        asia: t < 390 || (t >= 1380 && dow !== 6),
        europe: t >= 420 && t < 930,
        americas: t >= 810 && t < 1200,
    };
}

export function calcYAxisWidth(values: number[], fmt: (v: number) => string): number {
    if (!values.length) return 56;
    const maxLen = Math.max(...values.map(v => fmt(v).length));
    return Math.max(44, Math.min(96, maxLen * 7 + 10));
}

export interface TVConfig {
    titleVN: string;
    source: string;
    fmt: (v: number) => string;
    unitLabel: string;
    defaultDays: number;
    color: string;
    barChart?: boolean;
    freq: 'daily' | 'monthly' | 'annual';
    compareLag?: number;
    compareLabel?: string;
}

export const TV_CONFIGS: Record<string, TVConfig> = {
    'ECONOMICS:VNINBR': { titleVN: 'Lãi Suất Liên Ngân Hàng Qua Đêm', source: 'TradingView / NHNN · %/năm', fmt: fmtPct, unitLabel: '%/năm', defaultDays: 365, color: 'indigo', freq: 'daily', compareLag: 1, compareLabel: 'kỳ trước' },
    'ECONOMICS:VNINTR': { titleVN: 'Lãi Suất Chính Sách', source: 'TradingView / NHNN · %/năm', fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1825, color: 'blue', barChart: true, freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNDIR': { titleVN: 'Lãi Suất Tiền Gửi', source: 'TradingView / WB · %/năm', fmt: fmtPct, unitLabel: '%/năm', defaultDays: 3650, color: 'violet', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    'ECONOMICS:VNGDPYY': { titleVN: 'Tăng Trưởng GDP (YoY)', source: 'TradingView / GSO · %/năm', fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1825, color: 'emerald', barChart: true, freq: 'monthly', compareLag: 4, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGDPCP': { titleVN: 'GDP Thực Tế (hàng quý)', source: 'TradingView / GSO · nghìn tỷ ₫', fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 1825, color: 'blue', freq: 'monthly', compareLag: 4, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGDPS': { titleVN: 'GDP - Dịch Vụ', source: 'TradingView / GSO · nghìn tỷ ₫', fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 1825, color: 'cyan', freq: 'monthly', compareLag: 4, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGDPMAN': { titleVN: 'GDP - Công Nghiệp', source: 'TradingView / GSO · nghìn tỷ ₫', fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 1825, color: 'orange', freq: 'monthly', compareLag: 4, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGDPA': { titleVN: 'GDP - Nông Nghiệp', source: 'TradingView / GSO · nghìn tỷ ₫', fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 1825, color: 'lime', freq: 'monthly', compareLag: 4, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGDPPC': { titleVN: 'GDP Bình Quân Đầu Người', source: 'TradingView / WB · USD', fmt: fmtUSD, unitLabel: 'USD', defaultDays: 3650, color: 'violet', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    'ECONOMICS:VNGNP': { titleVN: 'GNP', source: 'TradingView / WB · nghìn tỷ ₫', fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 3650, color: 'teal', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    'ECONOMICS:VNGFCF': { titleVN: 'Đầu Tư Tài Sản Cố Định', source: 'TradingView / WB · nghìn tỷ ₫', fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 3650, color: 'amber', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    'ECONOMICS:VNIRYY': { titleVN: 'Lạm Phát (YoY)', source: 'TradingView / GSO · %/năm', fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1825, color: 'rose', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNCPI': { titleVN: 'Chỉ Số Giá Tiêu Dùng (CPI)', source: 'TradingView / GSO · chỉ số', fmt: fmtIdx, unitLabel: 'chỉ số', defaultDays: 1825, color: 'orange', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNFI': { titleVN: 'Lạm Phát Thực Phẩm', source: 'TradingView / GSO · %/năm', fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1825, color: 'amber', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNCIR': { titleVN: 'Lạm Phát Lõi', source: 'TradingView / GSO · %/năm', fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1825, color: 'red', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNGASP': { titleVN: 'Giá Xăng Dầu', source: 'TradingView / VN · USD/lít', fmt: fmtUSDL, unitLabel: 'USD/lít', defaultDays: 1095, color: 'yellow', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNFER': { titleVN: 'Dự Trữ Ngoại Hối', source: 'TradingView / NHNN · tỷ $', fmt: fmtBillUSD, unitLabel: 'tỷ $', defaultDays: 1825, color: 'emerald', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNM2': { titleVN: 'Cung Tiền M2', source: 'TradingView / WB · nghìn tỷ ₫', fmt: fmtTrVND, unitLabel: 'nghìn tỷ ₫', defaultDays: 3650, color: 'violet', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    'ECONOMICS:VNEXP': { titleVN: 'Xuất Khẩu', source: 'TradingView / Hải quan VN · tỷ $', fmt: fmtBillUSD, unitLabel: 'tỷ $', defaultDays: 1095, color: 'emerald', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNIMP': { titleVN: 'Nhập Khẩu', source: 'TradingView / Hải quan VN · tỷ $', fmt: fmtBillUSD, unitLabel: 'tỷ $', defaultDays: 1095, color: 'rose', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNBOT': { titleVN: 'Cán Cân Thương Mại', source: 'TradingView / Hải quan VN · tỷ $', fmt: fmtBillUSD, unitLabel: 'tỷ $', defaultDays: 1095, color: 'blue', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNFDI': { titleVN: 'Đầu Tư Trực Tiếp Nước Ngoài (FDI)', source: 'TradingView / MPI · tỷ $', fmt: fmtBillUSD, unitLabel: 'tỷ $', defaultDays: 1095, color: 'indigo', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNUR': { titleVN: 'Tỷ Lệ Thất Nghiệp', source: 'TradingView / GSO · %', fmt: fmtPct, unitLabel: '%', defaultDays: 1825, color: 'orange', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNWAG': { titleVN: 'Lương Bình Quân', source: 'TradingView / GSO · triệu ₫/tháng', fmt: fmtMilVND, unitLabel: 'triệu ₫/tháng', defaultDays: 1825, color: 'cyan', freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNMW': { titleVN: 'Lương Tối Thiểu', source: 'TradingView / MoLISA · triệu ₫/tháng', fmt: fmtMilVND, unitLabel: 'triệu ₫/tháng', defaultDays: 3650, color: 'teal', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    'ECONOMICS:VNPOP': { titleVN: 'Dân Số', source: 'TradingView / WB · triệu người', fmt: fmtMilPpl, unitLabel: 'triệu người', defaultDays: 3650, color: 'slate', freq: 'annual', compareLag: 1, compareLabel: 'năm trước' },
    'ECONOMICS:VNIPYY': { titleVN: 'Sản Lượng Công Nghiệp (YoY)', source: 'TradingView / GSO · %/năm', fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1095, color: 'orange', barChart: true, freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
    'ECONOMICS:VNRSYY': { titleVN: 'Doanh Thu Bán Lẻ (YoY)', source: 'TradingView / GSO · %/năm', fmt: fmtPct, unitLabel: '%/năm', defaultDays: 1095, color: 'cyan', barChart: true, freq: 'monthly', compareLag: 12, compareLabel: 'cùng kỳ' },
};

export const FA_COLORS: Record<string, string> = {
    GDP: 'emerald',
    Prices: 'rose',
    Trade: 'blue',
    Labour: 'violet',
    Money: 'amber',
    Consumer: 'cyan',
    Business: 'orange',
    InterestRate: 'indigo',
    Taxes: 'gray',
};

export const VIETNAM_SUBTABS: { id: VietnamSubTabId; label: string; subtitle: string }[] = [
    { id: 'growth', label: 'Tăng trưởng', subtitle: 'GDP, cơ cấu ngành, đầu tư tài sản' },
    { id: 'prices', label: 'Giá cả', subtitle: 'CPI, lạm phát, giá năng lượng' },
    { id: 'trade', label: 'Thương mại', subtitle: 'Xuất nhập khẩu, cán cân, FDI' },
    { id: 'money', label: 'Tiền tệ', subtitle: 'Lãi suất, M2, dự trữ ngoại hối' },
    { id: 'labour', label: 'Lao động', subtitle: 'Việc làm, thu nhập, dân số' },
    { id: 'taxes', label: 'Thuế', subtitle: 'Ngân sách và thuế' },
];

export const VIETNAM_TAB_TV: Record<VietnamSubTabId, string[]> = {
    growth: ['ECONOMICS:VNGDPYY', 'ECONOMICS:VNGDPPC', 'ECONOMICS:VNGNP', 'ECONOMICS:VNGFCF'],
    prices: ['ECONOMICS:VNIRYY', 'ECONOMICS:VNCPI', 'ECONOMICS:VNCIR', 'ECONOMICS:VNFI', 'ECONOMICS:VNGASP'],
    trade: ['ECONOMICS:VNBOT', 'ECONOMICS:VNEXP', 'ECONOMICS:VNIMP', 'ECONOMICS:VNFDI'],
    money: ['ECONOMICS:VNINBR', 'ECONOMICS:VNINTR', 'ECONOMICS:VNFER', 'ECONOMICS:VNM2', 'ECONOMICS:VNDIR'],
    labour: ['ECONOMICS:VNUR', 'ECONOMICS:VNWAG', 'ECONOMICS:VNMW', 'ECONOMICS:VNPOP', 'ECONOMICS:VNIPYY', 'ECONOMICS:VNRSYY'],
    taxes: [],
};

export const VIETNAM_TAB_FA: Record<VietnamSubTabId, string[]> = {
    growth: ['GDP', 'Business'],
    prices: ['Prices', 'Consumer'],
    trade: [],
    money: ['Money', 'InterestRate'],
    labour: ['Labour'],
    taxes: ['Taxes'],
};

export const KEY_STATS: { sym: string; tab: VietnamSubTabId }[] = [
    { sym: 'ECONOMICS:VNGDPYY', tab: 'growth' },
    { sym: 'ECONOMICS:VNIRYY', tab: 'prices' },
    { sym: 'ECONOMICS:VNBOT', tab: 'trade' },
    { sym: 'ECONOMICS:VNINBR', tab: 'money' },
];

export function normalizeColor(color: string): TremorColor {
    return (color === 'amber' ? 'yellow' : color) as TremorColor;
}
