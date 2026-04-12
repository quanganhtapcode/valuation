'use client';

import React, { useEffect, useRef, useState } from 'react';
import { formatNumber } from '@/lib/api';
import type { HistoricalChartData, HistoricalChartRecord, StockApiData } from '@/lib/types';
import { LineChart, type CustomTooltipProps as TremorCustomTooltipProps } from '@tremor/react';
import { cx } from '@/lib/utils';


type DisplayMode = 'annual' | 'quarterly' | 'ttm';

interface FinancialsTabProps {
    symbol: string;
    period?: 'quarter' | 'year';
    setPeriod?: (p: 'quarter' | 'year') => void;
    initialChartData?: HistoricalChartData | null;
    initialOverviewData?: StockApiData | null;
    isLoading?: boolean;
    onDownloadExcel?: () => void;
}

type ReportType = 'income' | 'balance' | 'cashflow' | 'note' | 'ratio' | 'equity' | 'key_stats';
type GrowthType = 'qoq' | 'yoy';
type StatementWindow = '4' | '8' | '12' | 'all';
type MetricMeta = { label: string; parent?: string | null; level?: number | null };
const PLUS_ICON_URL = 'https://trading.vietcap.com.vn/vietcap-iq/assets/images/plus-grid2e52f954fdf3abbd8683.svg';
const MINUS_ICON_URL = 'https://trading.vietcap.com.vn/vietcap-iq/assets/images/minus-grid0cc75a8b4abe6c3b23c9.svg';

// Growth type is derived automatically from displayMode:
//   annual → YoY, quarterly → QoQ, TTM → no growth
function getGrowthType(mode: DisplayMode): GrowthType {
    return mode === 'quarterly' ? 'qoq' : 'yoy';
}
const NORMAL_INCOME_PRESET = [
    ['total_revenues', 'Total Revenues'],
    ['cost_of_sales', 'Cost of Sales'],
    ['gross_profit', 'Gross Profit'],
    ['sga_expenses', 'Selling, General & Administrative Expenses'],
    ['rnd_expenses', 'Research & Development Expenses'],
    ['operating_profit', 'Operating Profit'],
    ['interest_and_investment_income', 'Interest and Investment Income'],
    ['non_operating_income', 'Non-Operating Income'],
    ['total_non_operating_income', 'Total Non-Operating Income'],
    ['income_before_tax', 'Income Before Provision for Income Taxes'],
    ['provision_income_taxes', 'Provision for Income Taxes'],
    ['consolidated_net_income', 'Consolidated Net Income'],
    ['minority_interest_net_income', 'Net Income Attributable to Minority Interests and Other'],
    ['common_shareholders_net_income', 'Net Income Attributable to Common Shareholders'],
    ['basic_eps', 'Basic EPS'],
    ['diluted_eps', 'Diluted EPS'],
    ['basic_weighted_avg_shares', 'Basic Weighted Average Shares Outstanding'],
    ['diluted_weighted_avg_shares', 'Diluted Weighted Average Shares Outstanding'],
    ['section_margins', 'Margins'],
    ['gross_margin', 'Gross Margin'],
    ['operating_margin', 'Operating Margin'],
    ['ebitda_margin', 'EBITDA Margin'],
    ['net_profit_margin', 'Net Profit Margin'],
    ['pre_tax_profit_margin', 'Pre-Tax Profit Margin'],
    ['effective_tax_rate', 'Effective Tax Rate'],
] as const;
const NORMAL_INCOME_PRESET_ORDER = NORMAL_INCOME_PRESET.map(([key]) => key);
const NORMAL_INCOME_PRESET_LABELS: Record<string, string> = Object.fromEntries(NORMAL_INCOME_PRESET);
const NORMAL_INCOME_PERCENT_KEYS = new Set<string>([
    'gross_margin',
    'operating_margin',
    'ebitda_margin',
    'net_profit_margin',
    'pre_tax_profit_margin',
    'effective_tax_rate',
]);
const NORMAL_INCOME_SECTION_KEYS = new Set<string>(['section_margins']);
const EQUITY_PRESET = [
    ['section_assets', 'Assets'],
    ['cash_and_cash_equivalents', 'Cash and Cash Equivalents'],
    ['short_term_investments', 'Short-Term Investments'],
    ['total_cash_and_cash_equivalents', 'Total Cash and Cash Equivalents'],
    ['accounts_receivable', 'Accounts Receivable'],
    ['total_trade_receivables', 'Total Trade Receivables'],
    ['other_current_assets', 'Other Current Assets'],
    ['total_current_assets', 'Total Current Assets'],
    ['net_property_plant_equipment', 'Net Property, Plant & Equipment'],
    ['other_long_term_assets', 'Other Long-Term Assets'],
    ['total_assets', 'Total Assets'],
    ['section_liabilities', 'Liabilities'],
    ['accounts_payable', 'Accounts Payable'],
    ['accrued_expenses', 'Accrued Expenses'],
    ['current_portion_of_leases', 'Current Portion of Leases'],
    ['unearned_revenue', 'Unearned Revenue'],
    ['total_current_liabilities', 'Total Current Liabilities'],
    ['leases', 'Leases'],
    ['other_long_term_liabilities', 'Other Long-Term Liabilities'],
    ['total_long_term_liabilities', 'Total Long-Term Liabilities'],
    ['total_liabilities', 'Total Liabilities'],
    ['section_equity', 'Equity'],
    ['common_stock', 'Common Stock'],
    ['additional_paid_in_capital', 'Additional Paid-in Capital'],
    ['accumulated_other_comprehensive_income', 'Accumulated Other Comprehensive Income'],
    ['retained_earnings', 'Retained Earnings'],
    ['total_common_shareholders_equity', "Total Common Shareholders' Equity"],
    ['minority_interests_and_other', 'Minority Interests and Other'],
    ['total_shareholders_equity', "Total Shareholders' Equity"],
    ['total_liabilities_and_shareholders_equity', "Total Liabilities and Shareholders' Equity"],
] as const;
const EQUITY_PRESET_ORDER = EQUITY_PRESET.map(([key]) => key);
const EQUITY_PRESET_LABELS: Record<string, string> = Object.fromEntries(EQUITY_PRESET);
const EQUITY_SECTION_KEYS = new Set<string>(['section_assets', 'section_liabilities', 'section_equity']);
const CASHFLOW_PRESET = [
    ['section_operating', 'Operating Activities'],
    ['net_income', 'Net Income'],
    ['depreciation_amortization', 'Depreciation & Amortization'],
    ['share_based_compensation', 'Share-Based Compensation Expense'],
    ['other_adjustments', 'Other Adjustments'],
    ['changes_trade_receivables', 'Changes in Trade Receivables'],
    ['changes_accounts_payable', 'Changes in Accounts Payable'],
    ['changes_accrued_expenses', 'Changes in Accrued Expenses'],
    ['changes_unearned_revenue', 'Changes in Unearned Revenue'],
    ['changes_other_operating', 'Changes in Other Operating Activities'],
    ['cash_from_operating', 'Cash from Operating Activities'],
    ['section_investing', 'Investing Activities'],
    ['capital_expenditure', 'Capital Expenditure'],
    ['purchases_investments', 'Purchases of Investments'],
    ['proceeds_sale_investments', 'Proceeds from Sale of Investments'],
    ['other_investing', 'Other Investing Activities'],
    ['cash_from_investing', 'Cash from Investing Activities'],
    ['section_financing', 'Financing Activities'],
    ['issuance_common_shares', 'Issuance of Common Shares'],
    ['repurchases_common_shares', 'Repurchases of Common Shares'],
    ['net_issuance_common_shares', 'Net Issuance / (Repurchases) of Common Shares'],
    ['other_financing', 'Other Financing Activities'],
    ['cash_from_financing', 'Cash from Financing Activities'],
    ['fx_effect_cash', 'Effect of Exchange Rate Changes on Cash and Cash Equivalents'],
    ['increase_decrease_cash', 'Increase / (Decrease) in Cash, Cash Equivalents and Restricted Cash'],
] as const;
const CASHFLOW_PRESET_ORDER = CASHFLOW_PRESET.map(([key]) => key);
const CASHFLOW_PRESET_LABELS: Record<string, string> = Object.fromEntries(CASHFLOW_PRESET);
const CASHFLOW_SECTION_KEYS = new Set<string>(['section_operating', 'section_investing', 'section_financing']);
const NORMAL_INCOME_LABEL_ORDER = [
    'Doanh thu bán hàng và cung cấp dịch vụ',
    'Các khoản giảm trừ doanh thu',
    'Doanh thu thuần',
    'Giá vốn hàng bán',
    'Lợi nhuận gộp',
    'Doanh thu hoạt động tài chính',
    'Chi phí tài chính',
    'Chi phí lãi vay',
    'Lãi/(lỗ) từ công ty liên doanh (từ năm 2015)',
    'Chi phí bán hàng',
    'Chi phí quản lý doanh nghiệp',
    'Lãi/(lỗ) từ hoạt động kinh doanh',
    'Thu nhập khác, ròng',
    'Thu nhập khác',
    'Chi phí khác',
    'Lãi/(lỗ) từ công ty liên doanh',
    'Lãi/(lỗ) trước thuế',
    'Chi phí thuế thu nhập doanh nghiệp',
    'Thuế thu nhập doanh nghiệp - hiện thời',
    'Thuế thu nhập doanh nghiệp - hoãn lại',
    'Lãi/(lỗ) thuần sau thuế',
    'Lợi ích của cổ đông thiểu số',
    'Lợi nhuận của Cổ đông của Công ty mẹ',
    'Lãi cơ bản trên cổ phiếu (VND)',
    'Lãi trên cổ phiếu pha loãng (VND)',
] as const;
const NORMAL_CASHFLOW_LABEL_ORDER = [
    'Lợi nhuận/(lỗ) trước thuế',
    'Khấu hao TSCĐ và BĐSĐT',
    'Phân bổ lợi thế thương mại',
    'Chi phí dự phòng',
    'Lãi/lỗ chênh lệch tỷ giá hối đoái do đánh giá lại các khoản mục tiền tệ có gốc ngoại tệ',
    'Lãi/(lỗ) từ thanh lý tài sản cố định',
    '(Lãi)/lỗ từ hoạt động đầu tư',
    'Chi phí lãi vay',
    'Thu lãi và cổ tức',
    'Các khoản điều chỉnh khác',
    'Lưu chuyển tiền tệ ròng từ các hoạt động sản xuất kinh doanh',
    'Lợi nhuận/(lỗ) từ hoạt động kinh doanh trước những thay đổi vốn lưu động',
    '(Tăng)/giảm các khoản phải thu',
    '(Tăng)/giảm hàng tồn kho',
    'Tăng/(giảm) các khoản phải trả',
    '(Tăng)/giảm chi phí trả trước',
    '(Tăng)/giảm chứng khoán kinh doanh',
    'Tiền lãi vay đã trả',
    'Thuế thu nhập doanh nghiệp đã nộp',
    'Tiền thu khác từ hoạt động kinh doanh',
    'Tiền chi khác cho hoạt động kinh doanh',
    'Lưu chuyển tiền thuần từ hoạt động đầu tư',
    'Tiền chi để mua sắm, xây dựng TSCĐ và các tài sản dài hạn khác',
    'Tiền thu từ thanh lý, nhượng bán TSCĐ và các tài sản dài hạn khác',
    'Tiền chi cho vay, mua các công cụ nợ của đơn vị khác',
    'Tiền thu hồi cho vay, bán lại các công cụ nợ của đơn vị khác',
    'Tiền chi đầu tư góp vốn vào đơn vị khác',
    'Tiền thu hồi đầu tư góp vốn vào đơn vị khác',
    'Tiền thu lãi cho vay, cổ tức và lợi nhuận được chia',
    'Lưu chuyển tiền thuần từ hoạt động tài chính',
    'Tiền thu từ phát hành cổ phiếu, nhận vốn góp của chủ sở hữu',
    'Tiền chi trả vốn góp cho các chủ sở hữu, mua lại cổ phiếu của doanh nghiệp đã phát hành',
    'Tiền thu được các khoản đi vay',
    'Tiền trả nợ gốc vay',
    'Tiền trả nợ gốc thuê tài chính',
    'Cổ tức, lợi nhuận đã trả cho chủ sở hữu',
    'Tiền lãi đã nhận',
    'Lưu chuyển tiền thuần trong kỳ',
    'Tiền và tương đương tiền đầu kỳ',
    'Ảnh hưởng của thay đổi tỷ giá hối đoái quy đổi ngoại tệ',
    'Tiền và tương đương tiền cuối kỳ',
] as const;
const NORMAL_BALANCE_LABEL_ORDER = [
    'TÀI SẢN NGẮN HẠN',
    'Tiền và tương đương tiền',
    'Tiền',
    'Các khoản tương đương tiền',
    'Đầu tư ngắn hạn',
    'Dự phòng giảm giá',
    'Đầu tư nắm giữ đến ngày đáo hạn',
    'Các khoản phải thu',
    'Phải thu khách hàng',
    'Trả trước người bán',
    'Phải thu nội bộ',
    'Phải thu hợp đồng xây dựng đang thực hiện',
    'Phải thu cho vay ngắn hạn',
    'Phải thu khác',
    'Dự phòng nợ khó đòi',
    'Tài sản thiếu cần xử lý',
    'Hàng tồn kho, ròng',
    'Hàng tồn kho',
    'Dự phòng giảm giá hàng tồn kho',
    'Tài sản lưu động khác',
    'Chi phí trả trước ngắn hạn',
    'Thuế GTGT được khấu trừ',
    'Phải thu thuế khác',
    'Giao dịch mua bán lại trái phiếu Chính phủ',
    'TÀI SẢN DÀI HẠN',
    'Phải thu dài hạn',
    'Phải thu khách hàng dài hạn',
    'Trả trước người bán dài hạn',
    'Vốn kinh doanh ở các đơn vị trực thuộc',
    'Phải thu nội bộ dài hạn',
    'Phải thu cho vay dài hạn',
    'Phải thu dài hạn khác',
    'Dự phòng phải thu dài hạn',
    'Tài sản cố định',
    'GTCL TSCĐ hữu hình',
    'Nguyên giá TSCĐ hữu hình',
    'Khấu hao lũy kế TSCĐ hữu hình',
    'GTCL tài sản thuê tài chính',
    'Nguyên giá tài sản thuê tài chính',
    'Khấu hao lũy kế tài sản thuê tài chính',
    'GTCL tài sản cố định vô hình',
    'Nguyên giá TSCĐ vô hình',
    'Khấu hao lũy kế TSCĐ vô hình',
    'Xây dựng cơ bản đang dang dở (trước 2015)',
    'Giá trị ròng tài sản đầu tư',
    'Nguyên giá tài sản đầu tư',
    'Khấu hao lũy kế tài sản đầu tư',
    'Tài sản dở dang dài hạn',
    'Chi phí sản xuất, kinh doanh dở dang dài hạn',
    'Xây dựng cơ bản đang dở dang',
    'Đầu tư dài hạn',
    'Đầu tư vào các công ty con',
    'Đầu tư vào các công ty liên kết',
    'Đầu tư dài hạn khác',
    'Dự phòng giảm giá đầu tư dài hạn',
    'Lợi thế thương mại (trước 2015)',
    'Tài sản dài hạn khác',
    'Trả trước dài hạn',
    'Thuế thu nhập hoãn lại',
    'Thiết bị, vật tư, phụ tùng thay thế dài hạn',
    'Các tài sản dài hạn khác',
    'Lợi thế thương mại',
    'TỔNG CỘNG TÀI SẢN',
    'NỢ PHẢI TRẢ',
    'Nợ ngắn hạn',
    'Phải trả người bán',
    'Người mua trả tiền trước',
    'Thuế và các khoản phải trả Nhà nước',
    'Phải trả người lao động',
    'Chi phí phải trả',
    'Phải trả nội bộ',
    'Phải trả về xây dựng cơ bản',
    'Doanh thu chưa thực hiện ngắn hạn',
    'Phải trả khác',
    'Vay ngắn hạn',
    'Dự phòng các khoản phải trả ngắn hạn',
    'Quỹ khen thưởng, phúc lợi',
    'Quỹ bình ổn giá',
    'Giao dịch mua bán lại trái phiếu chính phủ',
    'Nợ dài hạn',
    'Phải trả nhà cung cấp dài hạn',
    'Người mua trả tiền trước dài hạn',
    'Chi phí phải trả dài hạn',
    'Phải trả nội bộ về vốn kinh doanh',
    'Phải trả nội bộ dài hạn',
    'Doanh thu chưa thực hiện',
    'Phải trả dài hạn khác',
    'Vay dài hạn',
    'Trái phiếu chuyển đổi',
    'Cổ phiếu ưu đãi',
    'Dự phòng trợ cấp thôi việc',
    'Dự phòng các khoản nợ dài hạn',
    'Quỹ phát triển khoa học công nghệ',
    'Vốn chủ sở hữu',
    'Vốn và các quỹ',
    'Vốn góp',
    'Cổ phiếu phổ thông',
    'Thặng dư vốn cổ phần',
    'Quyền chọn chuyển đổi trái phiếu',
    'Vốn khác',
    'Cổ phiếu quỹ',
    'Chênh lệch đánh giá lại tài sản',
    'Chênh lệch tỷ giá',
    'Quỹ đầu tư và phát triển',
    'Quỹ hỗ trợ sắp xếp doanh nghiệp',
    'Quỹ dự phòng tài chính',
    'Quỹ khác',
    'Lãi chưa phân phối',
    'LNST chưa phân phối lũy kế đến cuối kỳ trước',
    'LNST chưa phân phối kỳ này',
    'Lợi ích cổ đông không kiểm soát',
    'Vốn Ngân sách nhà nước và quỹ khác',
    'Quỹ khen thưởng, phúc lợi (trước 2010)',
    'Vốn ngân sách nhà nước và quỹ khác',
    'Nguồn kinh phí đã hình thành TSCĐ',
    'Lợi ích của cổ đông thiểu số',
    'Tổng cộng nguồn vốn',
] as const;
const NORMAL_TEMPLATE_LABELS: Partial<Record<ReportType, readonly string[]>> = {
    income: NORMAL_INCOME_LABEL_ORDER,
    balance: NORMAL_BALANCE_LABEL_ORDER,
    cashflow: NORMAL_CASHFLOW_LABEL_ORDER,
};

// ── helpers ───────────────────────────────────────────────────────────────────

function parseChartResponse(res: any): HistoricalChartData | null {
    if (!res) return null;
    // Handle full API response envelope {success, data}
    if (res.success !== undefined && !res.success) return null;
    if (Array.isArray(res.data)) {
        return { symbol: res.symbol ?? '', period: res.period ?? 'quarter', count: res.count ?? res.data.length, records: res.data };
    }
    // Legacy parallel-arrays: may be res.data dict or res itself
    const d = res.data ?? res;
    if (!d?.years) return null;
    const records: HistoricalChartRecord[] = (d.years as string[]).map((period: string, i: number) => ({
        period,
        roe: d.roe_data?.[i] ?? null, roa: d.roa_data?.[i] ?? null,
        pe: d.pe_ratio_data?.[i] ?? null, pb: d.pb_ratio_data?.[i] ?? null,
        currentRatio: d.current_ratio_data?.[i] ?? null, quickRatio: d.quick_ratio_data?.[i] ?? null,
        cashRatio: d.cash_ratio_data?.[i] ?? null, nim: d.nim_data?.[i] ?? null,
        netMargin: d.net_profit_margin_data?.[i] ?? null,
    }));
    return { symbol: '', period: 'quarter', count: records.length, records };
}

function latest(records: HistoricalChartRecord[], key: keyof HistoricalChartRecord): number | null {
    for (let i = records.length - 1; i >= 0; i--) {
        const v = records[i][key];
        if (v !== null && v !== undefined && !Number.isNaN(Number(v))) return Number(v);
    }
    return null;
}

// ── original UI components ────────────────────────────────────────────────────

const MetricRow = ({ label, value, unit = '' }: { label: string; value: string | number | null | undefined; unit?: string }) => (
    <div className="flex items-center justify-between border-b border-tremor-border px-4 py-2.5 text-tremor-default dark:border-dark-tremor-border">
        <span className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">{label}</span>
        <span className="font-semibold text-tremor-brand dark:text-dark-tremor-brand">
            {value !== null && value !== undefined ? `${formatNumber(Number(value))}${unit}` : '-'}
        </span>
    </div>
);

const MetricCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="rounded-tremor-small border border-tremor-border bg-white shadow-sm dark:border-dark-tremor-border dark:bg-dark-tremor-background">
        <div className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
            {title}
        </div>
        <div className="pb-2">{children}</div>
    </div>
);

const ChartCard = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="flex flex-col overflow-hidden rounded-tremor-small border border-tremor-border bg-white shadow-sm dark:border-dark-tremor-border dark:bg-dark-tremor-background" style={{ height: '380px' }}>
        <div className="flex items-center justify-center border-b border-tremor-border px-4 py-3 text-tremor-default font-semibold text-tremor-content-strong dark:border-dark-tremor-border dark:text-dark-tremor-content-strong">
            {title}
        </div>
        <div className="flex-1 px-4 pb-2 pt-3" style={{ position: 'relative', minHeight: '240px' }}>
            {children}
        </div>
    </div>
);

function renderPeriod(row: Record<string, any>) {
    const year = row?.year ?? row?.year_report ?? row?.yearReport;
    const quarter = row?.quarter ?? row?.quarter_report ?? row?.quarterReport;
    if (quarter && Number(quarter) > 0) return `Q${quarter} ${year ?? ''}`.trim();
    if (year) return String(year);
    return '-';
}

function periodSortKey(row: Record<string, any>): number {
    const year = Number(row?.year ?? row?.year_report ?? row?.yearReport ?? 0);
    const quarter = Number(row?.quarter ?? row?.quarter_report ?? row?.quarterReport ?? 0);
    return year * 10 + quarter;
}

function pickColumns(rows: Record<string, any>[]): string[] {
    if (!rows.length) return [];
    const excluded = new Set([
        'symbol',
        'ticker',
        'organ_code',
        'organCode',
        'source',
        'period',
        'data_json',
        'created_at',
        'updated_at',
        'create_date',
        'update_date',
        'public_date',
        'id',
        'year',
        'quarter',
        'year_report',
        'quarter_report',
        'yearReport',
        'quarterReport',
    ]);
    const keys = new Set<string>();
    for (const row of rows) {
        Object.keys(row || {}).forEach((k) => {
            if (!excluded.has(k)) keys.add(k);
        });
    }
    return Array.from(keys).sort();
}

function formatCell(value: unknown): string {
    if (value === null || value === undefined || value === '') return '-';
    if (typeof value === 'number') {
        if (Math.abs(value) < 1) return value.toFixed(4);
        return formatNumber(value);
    }
    return String(value);
}

function formatStatementCell(metric: string, value: unknown, options?: { percentKeys?: Set<string> }): string {
    if (options?.percentKeys?.has(metric)) {
        if (value === null || value === undefined || value === '') return '-';
        const n = Number(value);
        if (!Number.isFinite(n)) return '-';
        return `${n.toFixed(2)}%`;
    }
    return formatCell(value);
}

function isZeroLike(value: unknown): boolean {
    if (value === null || value === undefined || value === '') return true;
    const n = Number(value);
    if (!Number.isFinite(n)) return false;
    return Math.abs(n) < 1e-12;
}

function formatMetricLabel(key: string): string {
    if (!key) return '';
    if (/^[a-z]{3}\d+$/i.test(key)) return key.toUpperCase(); // isa1/bsa1/cfa1/noc1
    const text = key.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    return text.charAt(0).toUpperCase() + text.slice(1);
}

function foldText(value: string): string {
    return value
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isFinancialStock(overviewData: any, isBank: boolean): boolean {
    if (isBank) return true;
    const candidates = [
        overviewData?.industry,
        overviewData?.sector,
        overviewData?.icb_name1,
        overviewData?.icb_name2,
        overviewData?.icb_name3,
        overviewData?.icb_name4,
        overviewData?.company_type,
        overviewData?.type,
    ].filter(Boolean).map((v) => foldText(String(v)));
    if (!candidates.length) return false;
    const financialHints = ['ngan hang', 'chung khoan', 'bao hiem', 'tai chinh', 'bank', 'securities', 'insurance', 'financial'];
    return candidates.some((text) => financialHints.some((hint) => text.includes(hint)));
}

function isImportantMetric(metric: string, label: string, tab: ReportType): boolean {
    const m = metric.toLowerCase();
    const l = label.toLowerCase();
    if (tab === 'income') {
        if (['isa1', 'isa3', 'isa5', 'isa16', 'isa20', 'isa22'].includes(m)) return true;
    }
    if (tab === 'cashflow') {
        if (['cfa1', 'cfa20', 'cfa30'].includes(m)) return true;
    }
    if (tab === 'balance') {
        if ([
            'tài sản ngắn hạn', 'tiền và tương đương tiền', 'đầu tư ngắn hạn', 'các khoản phải thu',
            'hàng tồn kho', 'tài sản lưu động khác', 'tài sản dài hạn', 'phải thu dài hạn',
            'tài sản cố định', 'gtcl tscđ hữu hình', 'gtcl tài sản thuê tài chính', 'gtcl tài sản cố định vô hình',
            'giá trị ròng tài sản đầu tư', 'tài sản dở dang dài hạn', 'đầu tư dài hạn', 'tài sản dài hạn khác',
            'tổng cộng tài sản', 'nợ phải trả', 'nợ ngắn hạn', 'nợ dài hạn', 'vốn chủ sở hữu',
            'vốn và các quỹ', 'vốn ngân sách nhà nước và quỹ khác', 'lợi ích của cổ đông thiểu số', 'tổng cộng nguồn vốn',
        ].includes(l)) return true;
    }
    return /doanh thu|lợi nhuận|revenue|profit|cash flow|dòng tiền/.test(l);
}

function metricCodeSortKey(metric: string): [number, number, string] {
    const m = metric.toLowerCase().match(/^([a-z]+)(\d+)$/);
    if (!m) return [99, Number.MAX_SAFE_INTEGER, metric];
    const prefix = m[1];
    const num = Number(m[2]);
    const prefixOrder: Record<string, number> = {
        isa: 1, isb: 2,
        bsa: 3, bsb: 4,
        cfa: 5, cfb: 6,
        noa: 7, nob: 8, noc: 9,
    };
    return [prefixOrder[prefix] ?? 98, num, metric];
}

function getSortedMetricKeys(tab: ReportType, metricKeys: string[]): string[] {
    if (tab === 'balance') {
        return [...metricKeys].sort((a, b) => {
            const ka = metricCodeSortKey(a);
            const kb = metricCodeSortKey(b);
            if (ka[0] !== kb[0]) return ka[0] - kb[0];
            if (ka[1] !== kb[1]) return ka[1] - kb[1];
            return ka[2].localeCompare(kb[2]);
        });
    }
    return [...metricKeys].sort((a, b) => {
        const ka = metricCodeSortKey(a);
        const kb = metricCodeSortKey(b);
        if (ka[0] !== kb[0]) return ka[0] - kb[0];
        if (ka[1] !== kb[1]) return ka[1] - kb[1];
        return ka[2].localeCompare(kb[2]);
    });
}

function getNormalTemplateMetricKeys(
    tab: ReportType,
    metricKeys: string[],
    metricMap: Record<string, string>,
    applyTemplate: boolean,
): string[] | null {
    if (!applyTemplate) return null;
    const labelOrder = NORMAL_TEMPLATE_LABELS[tab];
    if (!labelOrder || !labelOrder.length) return null;

    const buckets = new Map<string, string[]>();
    for (const key of metricKeys) {
        const label = metricMap[key.toLowerCase()] || formatMetricLabel(key);
        const normalized = foldText(label);
        const list = buckets.get(normalized) || [];
        list.push(key);
        buckets.set(normalized, list);
    }

    const out: string[] = [];
    const used = new Set<string>();
    for (const label of labelOrder) {
        const normalized = foldText(label);
        const bucket = buckets.get(normalized);
        if (!bucket || !bucket.length) continue;
        const key = bucket.shift();
        if (!key || used.has(key)) continue;
        out.push(key);
        used.add(key);
    }
    return out.length ? out : null;
}

function toFiniteNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function firstFiniteNumber(...values: unknown[]): number | null {
    for (const value of values) {
        const n = toFiniteNumber(value);
        if (n !== null) return n;
    }
    return null;
}

function ratioAsPercent(numerator: unknown, denominator: unknown): number | null {
    const num = toFiniteNumber(numerator);
    const den = toFiniteNumber(denominator);
    if (num === null || den === null || Math.abs(den) < 1e-12) return null;
    return (num / den) * 100;
}

function firstByLabel(
    row: Record<string, any>,
    metricMap: Record<string, string>,
    patterns: string[],
): number | null {
    const normalizedPatterns = patterns.map(foldText);
    for (const [metric, rawLabel] of Object.entries(metricMap || {})) {
        const label = foldText(rawLabel || '');
        if (!label) continue;
        if (!normalizedPatterns.some((p) => label === p || label.includes(p))) continue;
        const n = toFiniteNumber(row?.[metric]);
        if (n !== null) return n;
    }
    return null;
}

function buildNormalIncomePresetRows(
    incomeRows: Record<string, any>[],
    ratioRows: Record<string, any>[],
): Record<string, any>[] {
    const ratioByPeriod = new Map<string, Record<string, any>>();
    for (const row of ratioRows || []) {
        const year = row?.year ?? row?.year_report ?? row?.yearReport ?? '';
        const quarter = row?.quarter ?? row?.quarter_report ?? row?.quarterReport ?? 0;
        ratioByPeriod.set(`${year}-${quarter}`, row || {});
    }

    return (incomeRows || []).map((row) => {
        const year = row?.year ?? row?.year_report ?? row?.yearReport ?? '';
        const quarter = row?.quarter ?? row?.quarter_report ?? row?.quarterReport ?? 0;
        const ratio = ratioByPeriod.get(`${year}-${quarter}`) || {};
        const totalRevenues = firstFiniteNumber(row?.isa3, row?.isa1);
        const operatingProfit = firstFiniteNumber(row?.isa11);
        const ebitdaBillions = firstFiniteNumber(ratio?.ebitda_billions);
        const ebitdaValue = ebitdaBillions !== null ? ebitdaBillions * 1_000_000_000 : null;
        return {
            ...row,
            total_revenues: totalRevenues,
            cost_of_sales: firstFiniteNumber(row?.isa4),
            gross_profit: firstFiniteNumber(row?.isa5),
            sga_expenses: firstFiniteNumber(row?.isa9) !== null && firstFiniteNumber(row?.isa10) !== null
                ? Number(row?.isa9) + Number(row?.isa10)
                : firstFiniteNumber(row?.isa9, row?.isa10),
            rnd_expenses: null,
            operating_profit: operatingProfit,
            interest_and_investment_income: firstFiniteNumber(row?.isa6),
            non_operating_income: firstFiniteNumber(row?.isa12),
            total_non_operating_income: firstFiniteNumber(row?.isa14),
            income_before_tax: firstFiniteNumber(row?.isa16),
            provision_income_taxes: firstFiniteNumber(row?.isa19, row?.isa17),
            consolidated_net_income: firstFiniteNumber(row?.isa20),
            minority_interest_net_income: firstFiniteNumber(row?.isa21),
            common_shareholders_net_income: firstFiniteNumber(row?.isa22),
            basic_eps: firstFiniteNumber(row?.isa23),
            diluted_eps: firstFiniteNumber(row?.isa24),
            basic_weighted_avg_shares: firstFiniteNumber(ratio?.shares_outstanding_millions),
            diluted_weighted_avg_shares: firstFiniteNumber(ratio?.shares_outstanding_millions),
            section_margins: null,
            gross_margin: firstFiniteNumber(ratio?.gross_margin) !== null
                ? Number(ratio.gross_margin) * 100
                : ratioAsPercent(row?.isa5, totalRevenues),
            operating_margin: ratioAsPercent(operatingProfit, totalRevenues),
            ebitda_margin: ratioAsPercent(ebitdaValue, totalRevenues),
            net_profit_margin: firstFiniteNumber(ratio?.net_profit_margin) !== null
                ? Number(ratio.net_profit_margin) * 100
                : ratioAsPercent(row?.isa20, totalRevenues),
            pre_tax_profit_margin: ratioAsPercent(row?.isa16, totalRevenues),
            effective_tax_rate: ratioAsPercent(
                Math.abs(Number(firstFiniteNumber(row?.isa19, row?.isa17) ?? 0)),
                row?.isa16,
            ),
        };
    });
}

function buildEquityPresetRows(
    balanceRows: Record<string, any>[],
    balanceMap: Record<string, string>,
): Record<string, any>[] {
    return (balanceRows || []).map((row) => {
        const cashAndEquivalents = firstByLabel(row, balanceMap, ['tiền và tương đương tiền']);
        const shortTermInvestments = firstByLabel(row, balanceMap, ['đầu tư ngắn hạn']);
        const equityAoci = (
            firstByLabel(row, balanceMap, ['chênh lệch đánh giá lại tài sản']) ?? 0
        ) + (
            firstByLabel(row, balanceMap, ['chênh lệch tỷ giá']) ?? 0
        );
        return {
            ...row,
            section_assets: null,
            cash_and_cash_equivalents: cashAndEquivalents,
            short_term_investments: shortTermInvestments,
            total_cash_and_cash_equivalents:
                cashAndEquivalents !== null && shortTermInvestments !== null
                    ? cashAndEquivalents + shortTermInvestments
                    : firstFiniteNumber(cashAndEquivalents, shortTermInvestments),
            accounts_receivable: firstByLabel(row, balanceMap, ['phải thu khách hàng']),
            total_trade_receivables: firstByLabel(row, balanceMap, ['các khoản phải thu']),
            other_current_assets: firstByLabel(row, balanceMap, ['tài sản lưu động khác']),
            total_current_assets: firstByLabel(row, balanceMap, ['tài sản ngắn hạn']),
            net_property_plant_equipment: firstByLabel(row, balanceMap, ['gtcl tscđ hữu hình']),
            other_long_term_assets: firstByLabel(row, balanceMap, ['tài sản dài hạn khác']),
            total_assets: firstByLabel(row, balanceMap, ['tổng cộng tài sản']),
            section_liabilities: null,
            accounts_payable: firstByLabel(row, balanceMap, ['phải trả người bán']),
            accrued_expenses: firstByLabel(row, balanceMap, ['chi phí phải trả']),
            current_portion_of_leases: null,
            unearned_revenue: firstByLabel(row, balanceMap, ['doanh thu chưa thực hiện ngắn hạn', 'doanh thu chưa thực hiện']),
            total_current_liabilities: firstByLabel(row, balanceMap, ['nợ ngắn hạn']),
            leases: null,
            other_long_term_liabilities: firstByLabel(row, balanceMap, ['phải trả dài hạn khác']),
            total_long_term_liabilities: firstByLabel(row, balanceMap, ['nợ dài hạn']),
            total_liabilities: firstByLabel(row, balanceMap, ['nợ phải trả']),
            section_equity: null,
            common_stock: firstByLabel(row, balanceMap, ['cổ phiếu phổ thông', 'vốn góp']),
            additional_paid_in_capital: firstByLabel(row, balanceMap, ['thặng dư vốn cổ phần']),
            accumulated_other_comprehensive_income: Math.abs(equityAoci) > 1e-12 ? equityAoci : null,
            retained_earnings: firstByLabel(row, balanceMap, ['lãi chưa phân phối']),
            total_common_shareholders_equity: firstByLabel(row, balanceMap, ['vốn và các quỹ', 'vốn chủ sở hữu']),
            minority_interests_and_other: firstByLabel(row, balanceMap, ['lợi ích cổ đông không kiểm soát', 'lợi ích của cổ đông thiểu số']),
            total_shareholders_equity: firstByLabel(row, balanceMap, ['vốn chủ sở hữu']),
            total_liabilities_and_shareholders_equity: firstByLabel(row, balanceMap, ['tổng cộng nguồn vốn']),
        };
    });
}

function buildCashflowPresetRows(
    cashflowRows: Record<string, any>[],
    incomeRows: Record<string, any>[],
): Record<string, any>[] {
    const incomeByPeriod = new Map<string, Record<string, any>>();
    for (const row of incomeRows || []) {
        const year = row?.year ?? row?.year_report ?? row?.yearReport ?? '';
        const quarter = row?.quarter ?? row?.quarter_report ?? row?.quarterReport ?? 0;
        incomeByPeriod.set(`${year}-${quarter}`, row || {});
    }

    return (cashflowRows || []).map((row) => {
        const year = row?.year ?? row?.year_report ?? row?.yearReport ?? '';
        const quarter = row?.quarter ?? row?.quarter_report ?? row?.quarterReport ?? 0;
        const income = incomeByPeriod.get(`${year}-${quarter}`) || {};
        const issuance = firstFiniteNumber(row?.cfa27);
        const repurchases = firstFiniteNumber(row?.cfa28);
        const purchasesInvestments = (firstFiniteNumber(row?.cfa21) ?? 0) + (firstFiniteNumber(row?.cfa23) ?? 0);
        const proceedsInvestments = (firstFiniteNumber(row?.cfa22) ?? 0) + (firstFiniteNumber(row?.cfa24) ?? 0);
        const otherFinancing =
            (firstFiniteNumber(row?.cfa29) ?? 0) +
            (firstFiniteNumber(row?.cfa30) ?? 0) +
            (firstFiniteNumber(row?.cfa31) ?? 0) +
            (firstFiniteNumber(row?.cfa32) ?? 0) +
            (firstFiniteNumber(row?.cfa33) ?? 0);
        return {
            ...row,
            section_operating: null,
            net_income: firstFiniteNumber(income?.isa20),
            depreciation_amortization: firstFiniteNumber(row?.cfa2),
            share_based_compensation: null,
            other_adjustments: firstFiniteNumber(row?.cfa104),
            changes_trade_receivables: firstFiniteNumber(row?.cfa10),
            changes_accounts_payable: firstFiniteNumber(row?.cfa12),
            changes_accrued_expenses: null,
            changes_unearned_revenue: null,
            changes_other_operating: firstFiniteNumber(row?.cfa13, row?.cfa105),
            cash_from_operating: firstFiniteNumber(row?.cfa18),
            section_investing: null,
            capital_expenditure: firstFiniteNumber(row?.cfa19),
            purchases_investments: Math.abs(purchasesInvestments) > 1e-12 ? purchasesInvestments : null,
            proceeds_sale_investments: Math.abs(proceedsInvestments) > 1e-12 ? proceedsInvestments : null,
            other_investing: firstFiniteNumber(row?.cfa25),
            cash_from_investing: firstFiniteNumber(row?.cfa26),
            section_financing: null,
            issuance_common_shares: issuance,
            repurchases_common_shares: repurchases,
            net_issuance_common_shares:
                issuance !== null || repurchases !== null
                    ? (issuance ?? 0) + (repurchases ?? 0)
                    : null,
            other_financing: Math.abs(otherFinancing) > 1e-12 ? otherFinancing : null,
            cash_from_financing: firstFiniteNumber(row?.cfa34),
            fx_effect_cash: firstFiniteNumber(row?.cfa37),
            increase_decrease_cash: firstFiniteNumber(row?.cfa35, row?.cfa34),
        };
    });
}

// ── compact number formatter ──────────────────────────────────────────────────

function formatCompact(value: number | null | undefined, isEps = false): string {
    if (value === null || value === undefined || !Number.isFinite(value as number)) return '-';
    const n = value as number;
    if (isEps) return formatNumber(Math.round(n));
    const abs = Math.abs(n);
    if (abs >= 1e12) return `${formatNumber(n / 1e12, { maximumFractionDigits: 2 })}T`;
    if (abs >= 1e9) return `${formatNumber(n / 1e9, { maximumFractionDigits: 1 })}B`;
    if (abs >= 1e6) return `${formatNumber(n / 1e6, { maximumFractionDigits: 1 })}M`;
    return formatNumber(n, { maximumFractionDigits: 0 });
}

function fmtGrowth(pct: number | null): { text: string; cls: string } {
    if (pct === null || !Number.isFinite(pct)) return { text: '-', cls: 'text-tremor-content dark:text-dark-tremor-content' };
    const sign = pct >= 0 ? '+' : '';
    return {
        text: `${sign}${pct.toFixed(1)}%`,
        cls: pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400',
    };
}

function fmtMargin(pct: number | null): { text: string; cls: string } {
    if (pct === null || !Number.isFinite(pct)) return { text: '-', cls: 'text-tremor-content dark:text-dark-tremor-content' };
    return {
        text: `${pct.toFixed(1)}%`,
        cls: 'text-tremor-content dark:text-dark-tremor-content',
    };
}

// ── TTM helper ────────────────────────────────────────────────────────────────

// Fields that should be SUMMED for TTM (income statement and cash flow)
const IS_SUM_FIELDS = new Set([
    'isa1','isa2','isa3','isa4','isa5','isa6','isa7','isa8','isa9','isa10',
    'isa11','isa12','isa13','isa14','isa15','isa16','isa17','isa18','isa19',
    'isa20','isa21','isa22','isa23','isa24',
    'isb25','isb26','isb27','isb28','isb29','isb30','isb31','isb32','isb33','isb34','isb35','isb36','isb37','isb38','isb39','isb40',
]);
const CF_SUM_FIELDS = new Set([
    'cfa1','cfa2','cfa3','cfa4','cfa5','cfa6','cfa7','cfa8','cfa9','cfa10',
    'cfa11','cfa12','cfa13','cfa14','cfa15','cfa16','cfa17','cfa18','cfa19',
    'cfa20','cfa21','cfa22','cfa23','cfa24','cfa25','cfa26','cfa27','cfa28',
    'cfa29','cfa30','cfa31','cfa32','cfa33','cfa34','cfa35','cfa36','cfa37',
]);

function computeTTMRow(
    quarterlyRows: Record<string, any>[],
    sumFields: Set<string>,
): Record<string, any> {
    // Take up to 4 most recent quarters
    const sorted = [...quarterlyRows].sort((a, b) => periodSortKey(b) - periodSortKey(a));
    const last4 = sorted.slice(0, 4);
    if (!last4.length) return { year: 'TTM', quarter: 0 };

    const result: Record<string, any> = { year: 'TTM', quarter: 0 };
    // Collect all field keys
    const allKeys = new Set<string>();
    for (const r of last4) Object.keys(r).forEach(k => allKeys.add(k));

    for (const key of allKeys) {
        if (key === 'year' || key === 'quarter' || key === 'year_report' || key === 'quarter_report') continue;
        if (sumFields.has(key)) {
            let sum = 0;
            let hasAny = false;
            for (const r of last4) {
                const v = toFiniteNumber(r[key]);
                if (v !== null) { sum += v; hasAny = true; }
            }
            result[key] = hasAny ? sum : null;
        } else {
            // Non-sum fields: use latest non-null value
            result[key] = last4.find(r => r[key] !== null && r[key] !== undefined)?.[key] ?? null;
        }
    }
    return result;
}

// ── Key Stats Table ───────────────────────────────────────────────────────────

interface KeyStatRow {
    key: string;
    label: string;
    kind: 'section' | 'value' | 'growth' | 'margin' | 'separator';
    bold?: boolean;
    values?: (number | null)[];
    growths?: (number | null)[];
    margins?: (number | null)[];
    isEps?: boolean;
}

function buildKeyStatsRows(
    incomePeriods: Record<string, any>[],
    balanceByPeriod: Map<string, Record<string, any>>,
    cfByPeriod: Map<string, Record<string, any>>,
    marketCap: number | null,
    growthType: GrowthType,
    allIncomeRows: Record<string, any>[],
): { periods: string[]; rows: KeyStatRow[] } {
    const pkFn = (r: Record<string, any>) => {
        const y = r?.year ?? r?.year_report ?? '';
        const q = r?.quarter ?? r?.quarter_report ?? 0;
        return `${y}-${q}`;
    };

    const getComparison = (idx: number): Record<string, any> | null => {
        if (growthType === 'qoq') return incomePeriods[idx + 1] ?? null;
        const cur = incomePeriods[idx];
        const curY = cur?.year ?? cur?.year_report;
        const curQ = cur?.quarter ?? cur?.quarter_report ?? 0;
        return allIncomeRows.find(r => {
            const y = r?.year ?? r?.year_report;
            const q = r?.quarter ?? r?.quarter_report ?? 0;
            return y === curY - 1 && q === curQ;
        }) ?? null;
    };

    const growthPct = (cur: number | null, prior: number | null): number | null => {
        if (cur === null || prior === null || !Number.isFinite(cur) || !Number.isFinite(prior)) return null;
        if (Math.abs(prior) < 1e-12) return null;
        return ((cur - prior) / Math.abs(prior)) * 100;
    };
    const marginPct = (num: number | null, denom: number | null): number | null => {
        if (num === null || denom === null || !Number.isFinite(num) || !Number.isFinite(denom)) return null;
        if (Math.abs(denom) < 1e-12) return null;
        return (num / denom) * 100;
    };

    const n = incomePeriods.length;
    const periods = incomePeriods.map(r => renderPeriod(r));

    // Per-period metric arrays
    const mcArr: (number | null)[] = Array(n).fill(null);
    const cashArr: (number | null)[] = Array(n).fill(null);
    const debtArr: (number | null)[] = Array(n).fill(null);
    const evArr: (number | null)[] = Array(n).fill(null);
    const revArr: (number | null)[] = Array(n).fill(null);
    const gpArr: (number | null)[] = Array(n).fill(null);
    const ebitdaArr: (number | null)[] = Array(n).fill(null);
    const niArr: (number | null)[] = Array(n).fill(null);
    const epsArr: (number | null)[] = Array(n).fill(null);
    const ocfArr: (number | null)[] = Array(n).fill(null);
    const capexArr: (number | null)[] = Array(n).fill(null);
    const fcfArr: (number | null)[] = Array(n).fill(null);

    for (let i = 0; i < n; i++) {
        const row = incomePeriods[i];
        const pKey = pkFn(row);
        const bal = balanceByPeriod.get(pKey) ?? {};
        const cf = cfByPeriod.get(pKey) ?? {};

        const rev = firstFiniteNumber(row?.isa3, row?.isa1);
        const gp = firstFiniteNumber(row?.isa5);
        const opProfit = firstFiniteNumber(row?.isa11);
        const da = firstFiniteNumber(cf?.cfa2);
        const ebitda = opProfit !== null ? (da !== null ? opProfit + da : opProfit) : null;
        const ni = firstFiniteNumber(row?.isa22, row?.isa20);
        const eps = firstFiniteNumber(row?.isa24, row?.isa23);
        const ocf = firstFiniteNumber(cf?.cfa18);
        const capex = firstFiniteNumber(cf?.cfa19);
        const fcf = ocf !== null && capex !== null ? ocf + capex : ocf ?? null;
        const cash = firstFiniteNumber(bal?.bsa2);
        const stDebt = firstFiniteNumber(bal?.bsa56) ?? 0;
        const ltDebt = firstFiniteNumber(bal?.bsa71) ?? 0;
        const debt = stDebt + ltDebt;
        const mc = i === 0 ? marketCap : null;
        const ev = mc !== null ? mc - (cash ?? 0) + debt : null;

        mcArr[i] = mc;
        cashArr[i] = cash;
        debtArr[i] = debt > 0 ? debt : null;
        evArr[i] = ev;
        revArr[i] = rev;
        gpArr[i] = gp;
        ebitdaArr[i] = ebitda;
        niArr[i] = ni;
        epsArr[i] = eps;
        ocfArr[i] = ocf;
        capexArr[i] = capex;
        fcfArr[i] = fcf;
    }

    const revGrowth = revArr.map((v, i) => growthPct(v, getComparison(i) ? firstFiniteNumber(getComparison(i)?.isa3, getComparison(i)?.isa1) : null));
    const epsGrowth = epsArr.map((v, i) => {
        const cmp = getComparison(i);
        return growthPct(v, cmp ? firstFiniteNumber(cmp?.isa24, cmp?.isa23) : null);
    });
    const gpMargin = gpArr.map((v, i) => marginPct(v, revArr[i]));
    const ebitdaMargin = ebitdaArr.map((v, i) => marginPct(v, revArr[i]));
    const niMargin = niArr.map((v, i) => marginPct(v, revArr[i]));

    const rows: KeyStatRow[] = [
        { key: 'sect_ev', label: 'Enterprise Value', kind: 'section' },
        { key: 'market_cap', label: 'Market Cap', kind: 'value', values: mcArr },
        { key: 'cash', label: '(-) Cash & Equivalents', kind: 'value', values: cashArr },
        { key: 'debt', label: '(+) Total Debt', kind: 'value', values: debtArr },
        { key: 'ev', label: 'Enterprise Value', kind: 'value', bold: true, values: evArr },
        { key: 'sep1', label: '', kind: 'separator' },
        { key: 'sect_income', label: 'Income Statement', kind: 'section' },
        { key: 'revenue', label: 'Revenue', kind: 'value', values: revArr },
        { key: 'revenue_growth', label: 'Revenue % Growth', kind: 'growth', growths: revGrowth },
        { key: 'gross_profit', label: 'Gross Profit', kind: 'value', values: gpArr },
        { key: 'gross_margin', label: 'Gross Profit % Margin', kind: 'margin', margins: gpMargin },
        { key: 'ebitda', label: 'EBITDA', kind: 'value', values: ebitdaArr },
        { key: 'ebitda_margin', label: 'EBITDA % Margin', kind: 'margin', margins: ebitdaMargin },
        { key: 'net_income', label: 'Net Income', kind: 'value', values: niArr },
        { key: 'net_margin', label: 'Net Income % Margin', kind: 'margin', margins: niMargin },
        { key: 'diluted_eps', label: 'Diluted EPS', kind: 'value', isEps: true, values: epsArr },
        { key: 'eps_growth', label: 'Diluted EPS % Growth', kind: 'growth', growths: epsGrowth },
        { key: 'sep2', label: '', kind: 'separator' },
        { key: 'sect_cf', label: 'Cash Flow', kind: 'section' },
        { key: 'ocf', label: 'Operating Cash Flow', kind: 'value', values: ocfArr },
        { key: 'capex', label: 'CapEx', kind: 'value', values: capexArr },
        { key: 'fcf', label: 'Free Cash Flow', kind: 'value', bold: true, values: fcfArr },
    ];

    return { periods, rows };
}

function KeyStatsTable({
    incomeRows,
    balanceRows,
    cashflowRows,
    overviewData,
    displayMode,
    statementWindow,
    reportLoading,
}: {
    incomeRows: Record<string, any>[];
    balanceRows: Record<string, any>[];
    cashflowRows: Record<string, any>[];
    overviewData: any;
    displayMode: DisplayMode;
    statementWindow: StatementWindow;
    reportLoading: boolean;
}) {
    if (reportLoading) {
        return <div className="p-4 text-sm text-tremor-content dark:text-dark-tremor-content">Loading data...</div>;
    }

    const growthType = getGrowthType(displayMode);
    const allIncome = [...incomeRows].sort((a, b) => periodSortKey(a) - periodSortKey(b)); // asc for YoY lookup
    const sortedIncome = [...incomeRows].sort((a, b) => periodSortKey(b) - periodSortKey(a));
    const sortedBalance = [...balanceRows].sort((a, b) => periodSortKey(b) - periodSortKey(a));
    const sortedCF = [...cashflowRows].sort((a, b) => periodSortKey(b) - periodSortKey(a));

    // For TTM: build a single synthetic row
    let incomePeriods: Record<string, any>[];
    if (displayMode === 'ttm') {
        const ttmRow = computeTTMRow(sortedIncome, IS_SUM_FIELDS);
        incomePeriods = [ttmRow];
    } else {
        const maxPeriods = statementWindow === 'all' ? 999 : Number(statementWindow);
        incomePeriods = sortedIncome.slice(0, maxPeriods);
    }

    if (!incomePeriods.length) {
        return <div className="p-4 text-sm text-tremor-content dark:text-dark-tremor-content">No data available.</div>;
    }

    const balByPeriod = new Map<string, Record<string, any>>();
    for (const r of sortedBalance) {
        const y = r?.year ?? r?.year_report ?? '';
        const q = r?.quarter ?? r?.quarter_report ?? 0;
        balByPeriod.set(`${y}-${q}`, r);
    }
    const cfByPeriod = new Map<string, Record<string, any>>();
    for (const r of sortedCF) {
        const y = r?.year ?? r?.year_report ?? '';
        const q = r?.quarter ?? r?.quarter_report ?? 0;
        cfByPeriod.set(`${y}-${q}`, r);
    }

    const marketCap = toFiniteNumber(overviewData?.market_cap);
    const { periods, rows } = buildKeyStatsRows(incomePeriods, balByPeriod, cfByPeriod, marketCap, growthType, allIncome);

    return (
        <div>
            {/* Desktop table */}
            <div className="hidden md:block w-full overflow-x-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                <table className="min-w-full w-max border-collapse text-sm">
                    <thead className="bg-gray-50/50 dark:bg-gray-900/50">
                        <tr>
                            <th className="sticky left-0 z-10 min-w-[260px] border-b border-tremor-border bg-gray-50/50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-tremor-content dark:border-dark-tremor-border dark:bg-gray-900/50 dark:text-dark-tremor-content">
                                Metric
                            </th>
                            {periods.map((p, i) => (
                                <th key={i} className="whitespace-nowrap border-b border-tremor-border px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-tremor-content dark:border-dark-tremor-border dark:text-dark-tremor-content">
                                    {p}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {rows.map((row) => {
                            if (row.kind === 'separator') {
                                return (
                                    <tr key={row.key}>
                                        <td colSpan={periods.length + 1} className="h-2 bg-gray-50/50 dark:bg-gray-900/50 border-none p-0" />
                                    </tr>
                                );
                            }
                            if (row.kind === 'section') {
                                return (
                                    <tr key={row.key} className="bg-gray-100/70 dark:bg-gray-800/50">
                                        <td colSpan={periods.length + 1} className="sticky left-0 z-[1] bg-gray-100/70 dark:bg-gray-800/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-tremor-content-strong dark:text-dark-tremor-content-strong">
                                            {row.label}
                                        </td>
                                    </tr>
                                );
                            }
                            if (row.kind === 'growth') {
                                return (
                                    <tr key={row.key} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/50">
                                        <td className="sticky left-0 z-[1] bg-white dark:bg-gray-950 min-w-[260px] px-4 py-2 text-xs italic text-tremor-content dark:text-dark-tremor-content pl-8">
                                            {row.label}
                                        </td>
                                        {(row.growths ?? []).map((g, i) => {
                                            const { text, cls } = fmtGrowth(g);
                                            return (
                                                <td key={i} className={cx('whitespace-nowrap px-4 py-2 text-right text-xs font-medium', cls)}>
                                                    {text}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            }
                            if (row.kind === 'margin') {
                                return (
                                    <tr key={row.key} className="hover:bg-gray-50/50 dark:hover:bg-gray-900/50">
                                        <td className="sticky left-0 z-[1] bg-white dark:bg-gray-950 min-w-[260px] px-4 py-2 text-xs italic text-tremor-content dark:text-dark-tremor-content pl-8">
                                            {row.label}
                                        </td>
                                        {(row.margins ?? []).map((m, i) => {
                                            const { text, cls } = fmtMargin(m);
                                            return (
                                                <td key={i} className={cx('whitespace-nowrap px-4 py-2 text-right text-xs', cls)}>
                                                    {text}
                                                </td>
                                            );
                                        })}
                                    </tr>
                                );
                            }
                            // value row
                            return (
                                <tr key={row.key} className={cx('hover:bg-gray-50/50 dark:hover:bg-gray-900/50', row.bold && 'bg-amber-50/30 dark:bg-amber-900/10')}>
                                    <td className={cx(
                                        'sticky left-0 z-[1] min-w-[260px] bg-white px-4 py-2.5 text-sm dark:bg-gray-950',
                                        row.bold ? 'font-semibold text-amber-700 dark:text-amber-300' : 'font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong',
                                    )}>
                                        {row.label}
                                    </td>
                                    {(row.values ?? []).map((v, i) => (
                                        <td key={i} className={cx(
                                            'whitespace-nowrap px-4 py-2.5 text-right text-sm text-tremor-content dark:text-dark-tremor-content',
                                            row.bold && 'font-semibold',
                                        )}>
                                            {formatCompact(v, row.isEps)}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Mobile: single-period view */}
            <div className="md:hidden divide-y divide-gray-100 dark:divide-gray-800">
                {rows.filter(r => r.kind !== 'separator').map((row) => {
                    const v0 = row.values?.[0];
                    const g0 = row.growths?.[0];
                    const m0 = row.margins?.[0];
                    if (row.kind === 'section') {
                        return (
                            <div key={row.key} className="bg-gray-100/70 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-tremor-content-strong dark:bg-gray-800/50 dark:text-dark-tremor-content-strong">
                                {row.label}
                            </div>
                        );
                    }
                    if (row.kind === 'growth') {
                        const { text, cls } = fmtGrowth(g0 ?? null);
                        return (
                            <div key={row.key} className="flex items-center justify-between px-4 py-2">
                                <span className="text-xs italic text-tremor-content dark:text-dark-tremor-content">{row.label}</span>
                                <span className={cx('text-xs font-medium', cls)}>{text}</span>
                            </div>
                        );
                    }
                    if (row.kind === 'margin') {
                        const { text, cls } = fmtMargin(m0 ?? null);
                        return (
                            <div key={row.key} className="flex items-center justify-between px-4 py-2">
                                <span className="text-xs italic text-tremor-content dark:text-dark-tremor-content">{row.label}</span>
                                <span className={cx('text-xs', cls)}>{text}</span>
                            </div>
                        );
                    }
                    return (
                        <div key={row.key} className={cx('flex items-center justify-between px-4 py-2.5', row.bold && 'bg-amber-50/30 dark:bg-amber-900/10')}>
                            <span className={cx('text-sm', row.bold ? 'font-semibold text-amber-700 dark:text-amber-300' : 'font-medium text-tremor-content-strong dark:text-dark-tremor-content-strong')}>
                                {row.label}
                            </span>
                            <span className={cx('text-sm text-tremor-content dark:text-dark-tremor-content', row.bold && 'font-semibold')}>
                                {periods[0] && <span className="mr-1 text-xs text-tremor-content/60">{periods[0]}</span>}
                                {formatCompact(v0 ?? null, row.isEps)}
                            </span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ── main ──────────────────────────────────────────────────────────────────────

export default function FinancialsTab({
    symbol,
    period,
    setPeriod,
    initialChartData,
    initialOverviewData,
    isLoading: isParentLoading = false,
    onDownloadExcel,
}: FinancialsTabProps) {
    const [displayMode, setDisplayMode] = useState<DisplayMode>('quarterly');
    const effectivePeriod: 'quarter' | 'year' = displayMode === 'annual' ? 'year' : 'quarter';

    // Sync effectivePeriod back to parent when displayMode changes
    React.useEffect(() => {
        setPeriod?.(effectivePeriod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectivePeriod]);
    const [chartData, setChartData] = useState<HistoricalChartData | null>(() => parseChartResponse(initialChartData) || null);
    const [overviewData, setOverviewData] = useState<any>(initialOverviewData || null);
    const [loading, setLoading] = useState<boolean>(!initialChartData && !isParentLoading);
    const [bankingHistory, setBankingHistory] = useState<any[]>([]);
    const [activeSubTab, setActiveSubTab] = useState<ReportType>('key_stats');
    const [reportLoading, setReportLoading] = useState(false);
    const [reportData, setReportData] = useState<Record<ReportType, Record<string, any>[]>>({
        income: [],
        balance: [],
        cashflow: [],
        note: [],
        ratio: [],
        equity: [],
        key_stats: [],
    });
    const [metricMaps, setMetricMaps] = useState<Record<'income' | 'balance' | 'cashflow' | 'note', Record<string, string>>>({
        income: {},
        balance: {},
        cashflow: {},
        note: {},
    });
    const [metricMetaMaps, setMetricMetaMaps] = useState<Record<'income' | 'balance' | 'cashflow' | 'note', Record<string, MetricMeta>>>({
        income: {},
        balance: {},
        cashflow: {},
        note: {},
    });
    const [statementWindow, setStatementWindow] = useState<StatementWindow>('4');
    const [mobilePeriodIndex, setMobilePeriodIndex] = useState(0);
    const [collapsedRows, setCollapsedRows] = useState<Set<string>>(new Set());
    const isInitialMount = useRef(true);

    const BANK_SYMBOLS = new Set(['VCB','BID','CTG','TCB','MBB','ACB','VPB','HDB','SHB','STB','TPB','LPB','MSB','OCB','EIB','ABB','NAB','PGB','VAB','VIB','SSB','BAB','KLB','BVB','KBS','SGB','NVB']);
    const nimValue = overviewData?.nim ?? overviewData?.net_interest_margin ?? null;
    const isBank = nimValue !== null && nimValue !== undefined ? Number(nimValue) > 0 : BANK_SYMBOLS.has(symbol);
    const isNormalStock = !isFinancialStock(overviewData, isBank);

    useEffect(() => {
        if (initialChartData && effectivePeriod === 'quarter') {
            const parsed = parseChartResponse(initialChartData);
            if (parsed) queueMicrotask(() => setChartData(parsed));
        }
    }, [initialChartData, effectivePeriod]);

    useEffect(() => {
        if (initialOverviewData) queueMicrotask(() => setOverviewData(initialOverviewData));
    }, [initialOverviewData]);

    useEffect(() => {
        const controller = new AbortController();
        const { signal } = controller;

        if (isInitialMount.current) {
            isInitialMount.current = false;
            if (effectivePeriod === 'quarter' && initialChartData) {
                const parsed = parseChartResponse(initialChartData);
                if (parsed) { queueMicrotask(() => { setLoading(false); setChartData(parsed); }); return; }
            }
        }
        if (effectivePeriod === 'quarter' && isParentLoading) {
            queueMicrotask(() => setLoading(true));
            return;
        }

        queueMicrotask(() => setLoading(true));
        const stockPromise = initialOverviewData
            ? Promise.resolve({ success: true, data: initialOverviewData })
            : fetch(`/api/stock/${symbol}?period=${effectivePeriod}`, { signal }).then(r => r.json());

        Promise.allSettled([
            fetch(`/api/historical-chart-data/${symbol}?period=${effectivePeriod}`, { signal }).then(r => r.json()),
            stockPromise,
        ])
            .then(([chartResult, stockResult]) => {
                if (signal.aborted) return;
                const raw = chartResult.status === 'fulfilled' ? chartResult.value : null;
                const parsed = parseChartResponse(raw);
                if (parsed) setChartData(parsed);
                const stockRes = stockResult.status === 'fulfilled' ? stockResult.value : null;
                if (stockRes?.success || stockRes?.data) setOverviewData(stockRes.data || stockRes);
            })
            .catch(err => { if (err.name !== 'AbortError') console.error(err); })
            .finally(() => { if (!signal.aborted) setLoading(false); });

        return () => controller.abort();
    }, [symbol, effectivePeriod, isParentLoading, initialChartData, initialOverviewData]);

    useEffect(() => {
        if (!isBank) return;
        const controller = new AbortController();
        fetch(`/api/banking-kpi-history/${symbol}?period=${effectivePeriod}`, { signal: controller.signal })
            .then(r => r.json())
            .then(res => { if (res?.success && Array.isArray(res.data)) setBankingHistory(res.data); })
            .catch(() => {});
        return () => controller.abort();
    }, [symbol, isBank, effectivePeriod]);

    useEffect(() => {
        const controller = new AbortController();
        queueMicrotask(() => setReportLoading(true));
        Promise.allSettled([
            fetch(`/api/financial-report/${symbol}?type=income&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=balance&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=cashflow&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=note&period=${effectivePeriod}&limit=20`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=ratio&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
        ])
            .then(([income, balance, cashflow, note, ratio]) => {
                if (controller.signal.aborted) return;
                const unwrap = (res: PromiseSettledResult<any>) => {
                    if (res.status !== 'fulfilled') return [];
                    const payload = res.value;
                    if (Array.isArray(payload)) return payload;
                    if (Array.isArray(payload?.data)) return payload.data;
                    return [];
                };
                setReportData({
                    income: unwrap(income),
                    balance: unwrap(balance),
                    cashflow: unwrap(cashflow),
                    note: unwrap(note),
                    ratio: unwrap(ratio),
                    equity: [],
                    key_stats: [],
                });
                setCollapsedRows(new Set());
            })
            .finally(() => {
                if (!controller.signal.aborted) setReportLoading(false);
            });
        return () => controller.abort();
    }, [symbol, effectivePeriod]);

    useEffect(() => {
        const controller = new AbortController();
        Promise.allSettled([
            fetch(`/api/financial-report-metrics/${symbol}?type=income`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=balance`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=cashflow`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=note`, { signal: controller.signal }).then(r => r.json()),
        ]).then(([income, balance, cashflow, note]) => {
            if (controller.signal.aborted) return;
            const unwrapLabels = (res: PromiseSettledResult<any>, preferEn = false) => {
                if (res.status !== 'fulfilled') return {};
                const key = preferEn ? 'field_map_en' : 'field_map';
                return ((res.value?.[key] ?? res.value?.field_map) ?? {}) as Record<string, string>;
            };
            const unwrapMeta = (res: PromiseSettledResult<any>) => {
                if (res.status !== 'fulfilled') return {};
                const data = Array.isArray(res.value?.data) ? res.value.data : [];
                const out: Record<string, MetricMeta> = {};
                for (const row of data) {
                    const field = String(row?.field || '').toLowerCase().trim();
                    if (!field) continue;
                    out[field] = {
                        label: String(row?.label || '').trim() || field.toUpperCase(),
                        parent: row?.parent ? String(row.parent).toLowerCase().trim() : null,
                        level: row?.level ?? null,
                    };
                }
                return out;
            };
            setMetricMaps({
                income: unwrapLabels(income),
                balance: unwrapLabels(balance, true),   // use English labels for balance sheet raw view
                cashflow: unwrapLabels(cashflow),
                note: unwrapLabels(note),
            });
            setMetricMetaMaps({
                income: unwrapMeta(income),
                balance: unwrapMeta(balance),
                cashflow: unwrapMeta(cashflow),
                note: unwrapMeta(note),
            });
        });
        return () => controller.abort();
    }, [symbol]);

    // ── data helpers ──────────────────────────────────────────────────────────

    // Fallback: use overviewData.history (from /api/stock SQLite) when VCI chart fetch failed
    const records: HistoricalChartRecord[] = chartData?.records ?? (() => {
        const hist = (overviewData as any)?.history;
        if (!Array.isArray(hist) || hist.length === 0) return [];
        return hist.map((r: any) => ({
            period:       r.period,
            roe:          r.roe   ?? null,
            roa:          r.roa   ?? null,
            pe:           r.pe    ?? null,
            pb:           r.pb    ?? null,
            nim:          r.nim   ?? null,
            netMargin:    r.netMargin ?? r.net_margin ?? null,
            currentRatio: r.currentRatio ?? null,
            quickRatio:   r.quickRatio  ?? null,
            cashRatio:    null,
        }));
    })();
    const shouldBlockWithSpinner = loading && !chartData && !overviewData;

    const buildSeries = (mapPoint: (r: HistoricalChartRecord) => Record<string, string | number | null>) =>
        records.map(mapPoint);

    const pickOverview = (...keys: string[]): number | null => {
        if (!overviewData) return null;
        for (const key of keys) {
            const value = overviewData?.[key];
            if (value === null || value === undefined || value === '') continue;
            const numeric = Number(value);
            if (!Number.isNaN(numeric)) return numeric;
        }
        return null;
    };

    const computedEvEbitda = () => pickOverview('ev_to_ebitda', 'ev_ebitda', 'evEbitda', 'enterprise_to_ebitda');
    const getEpsForPeriod = () =>
        effectivePeriod === 'quarter'
            ? (pickOverview('eps', 'earnings_per_share', 'basic_eps', 'eps_quarter') ?? pickOverview('eps_ttm'))
            : pickOverview('eps_ttm', 'eps', 'earnings_per_share', 'basic_eps');

    const hasNetMarginData = records.some(r => r.netMargin !== null && r.netMargin !== 0);

    // ── custom tooltip ────────────────────────────────────────────────────────

    const CustomTooltip = ({ payload, active, label }: TremorCustomTooltipProps) => {
        if (!active || !payload || payload.length === 0) return null;
        return (
            <>
                <div className="w-56 rounded-md border border-gray-500/10 bg-blue-500 px-4 py-1.5 text-sm shadow-md dark:border-gray-400/20 dark:bg-gray-900 z-[100]">
                    <p className="flex items-center justify-between">
                        <span className="text-gray-50 dark:text-gray-50">Kỳ</span>
                        <span className="font-medium text-gray-50 dark:text-gray-50">{label ?? ''}</span>
                    </p>
                </div>
                <div className="mt-1 w-56 space-y-1 rounded-md border border-gray-500/10 bg-white px-4 py-2 text-sm shadow-md dark:border-gray-400/20 dark:bg-gray-900 z-[100]">
                    {payload.map((item, index) => {
                        const color = item.color || item.payload?.fill || item.stroke;
                        const isHex = color?.startsWith('#') || color?.startsWith('rgb');
                        return (
                            <div key={index} className="flex items-center space-x-2.5">
                                <span
                                    className={cx(!isHex ? `bg-${color}-500` : '', 'size-2.5 shrink-0 rounded-sm')}
                                    style={isHex ? { backgroundColor: color } : {}}
                                    aria-hidden={true}
                                />
                                <div className="flex w-full justify-between items-center space-x-2">
                                    <span className="text-gray-700 dark:text-gray-300 truncate">{item.name}</span>
                                    <span className="font-medium text-gray-900 dark:text-gray-50 whitespace-nowrap">
                                        {typeof item.value === 'number'
                                            ? (['ROE', 'ROA', 'NIM', 'Net Margin (%)'].includes(String(item.name)) || String(item.name).includes('%') || item.unit === '%')
                                                ? `${item.value}%`
                                                : formatNumber(item.value)
                                            : item.value}
                                    </span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </>
        );
    };

    // ── render ────────────────────────────────────────────────────────────────

    return (
        <div className="w-full text-tremor-content-strong dark:text-dark-tremor-content-strong" style={{ boxSizing: 'border-box' }}>
            {shouldBlockWithSpinner ? (
                <div style={{ textAlign: 'center', padding: '60px 0', color: '#9ca3af' }}>
                    <div className="spinner" style={{ margin: '0 auto', marginBottom: '12px' }} />
                    <span style={{ fontSize: '12px' }}>Loading data...</span>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    {/* ── Perplexity-style unified tab bar ────────────────────── */}
                    <div className="rounded-xl border border-tremor-border bg-white shadow-sm dark:border-dark-tremor-border dark:bg-gray-950">
                        <div className="flex items-center justify-between gap-2 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                            {/* Sub-tabs */}
                            <div className="flex shrink-0 items-center gap-0.5">
                                {[
                                    { id: 'key_stats', label: 'Key Stats' },
                                    { id: 'ratio', label: 'Ratios' },
                                    { id: 'income', label: 'Income' },
                                    { id: 'balance', label: 'Balance Sheet' },
                                    { id: 'equity', label: 'Equity' },
                                    { id: 'cashflow', label: 'Cash Flow' },
                                    { id: 'note', label: 'Note' },
                                ].map((tab) => (
                                    <button
                                        key={tab.id}
                                        type="button"
                                        onClick={() => {
                                            setActiveSubTab(tab.id as ReportType);
                                            setStatementWindow('4');
                                            setMobilePeriodIndex(0);
                                        }}
                                        className={cx(
                                            'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                                            activeSubTab === tab.id
                                                ? 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-white'
                                                : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-200'
                                        )}
                                    >
                                        {tab.label}
                                    </button>
                                ))}
                            </div>

                            {/* Right controls: period + window + export */}
                            <div className="ml-auto flex shrink-0 items-center gap-2">
                                {/* Period segmented control */}
                                <div className="flex items-center rounded-md border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-900">
                                    {(['annual', 'quarterly', 'ttm'] as DisplayMode[]).map((m) => (
                                        <button
                                            key={m}
                                            type="button"
                                            onClick={() => setDisplayMode(m)}
                                            className={cx(
                                                'rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors',
                                                displayMode === m
                                                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                                                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
                                            )}
                                        >
                                            {m === 'ttm' ? 'TTM' : m === 'annual' ? 'Annual' : 'Quarterly'}
                                        </button>
                                    ))}
                                </div>

                                {/* Window selector (hidden for ratio/key_stats) */}
                                {activeSubTab !== 'ratio' && (
                                    <select
                                        value={statementWindow}
                                        onChange={(e) => {
                                            setStatementWindow(e.target.value as StatementWindow);
                                            setMobilePeriodIndex(0);
                                        }}
                                        className="hidden rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 md:block"
                                    >
                                        <option value="4">4 periods</option>
                                        <option value="8">8 periods</option>
                                        <option value="12">12 periods</option>
                                        <option value="all">All</option>
                                    </select>
                                )}

                                {/* Export button */}
                                {onDownloadExcel && (
                                    <button
                                        type="button"
                                        onClick={onDownloadExcel}
                                        title="Export Excel"
                                        className="hidden items-center justify-center rounded-md border border-gray-200 bg-gray-50 p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 md:flex"
                                    >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                            <polyline points="7 10 12 15 17 10" />
                                            <line x1="12" y1="15" x2="12" y2="3" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Mobile tab select (visible on small screens) */}
                        <div className="border-t border-gray-100 px-2 pb-1.5 dark:border-gray-800 md:hidden">
                            <select
                                value={activeSubTab}
                                onChange={(e) => {
                                    setActiveSubTab(e.target.value as ReportType);
                                    setStatementWindow('4');
                                    setMobilePeriodIndex(0);
                                }}
                                className="w-full rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                            >
                                <option value="key_stats">Key Stats</option>
                                <option value="ratio">Ratios</option>
                                <option value="income">Income Statement</option>
                                <option value="balance">Balance Sheet</option>
                                <option value="equity">Equity</option>
                                <option value="cashflow">Cash Flow</option>
                                <option value="note">Note</option>
                            </select>
                        </div>
                    </div>

                    {activeSubTab === 'key_stats' && (
                        <div className="rounded-xl border border-tremor-border bg-white p-0 shadow-sm dark:border-dark-tremor-border dark:bg-gray-950 overflow-hidden">
                            <KeyStatsTable
                                incomeRows={reportData.income}
                                balanceRows={reportData.balance}
                                cashflowRows={reportData.cashflow}
                                overviewData={overviewData}
                                displayMode={displayMode}
                                statementWindow={statementWindow}
                                reportLoading={reportLoading}
                            />
                        </div>
                    )}

                    {activeSubTab !== 'ratio' && activeSubTab !== 'key_stats' && (
                        <div className="rounded-xl border border-tremor-border bg-white p-0 shadow-sm dark:border-dark-tremor-border dark:bg-gray-950">
                            {reportLoading ? (
                                <div className="p-4 text-sm text-tremor-content dark:text-dark-tremor-content">Loading report...</div>
                            ) : (
                                (() => {
                                    // For TTM mode: synthesize a single TTM row
                                    const isTTM = displayMode === 'ttm';
                                    const getBaseRows = (type: ReportType) => {
                                        const rows = reportData[type] || [];
                                        if (!isTTM) return rows;
                                        const sumFields = type === 'cashflow' ? CF_SUM_FIELDS : IS_SUM_FIELDS;
                                        return [computeTTMRow(rows, sumFields)];
                                    };
                                    const rawRows = isTTM ? getBaseRows(activeSubTab) : (reportData[activeSubTab] || []);
                                    const isNormalIncomePreset = activeSubTab === 'income' && isNormalStock;
                                    const isEquityPreset = activeSubTab === 'equity';
                                    const isCashflowPreset = activeSubTab === 'cashflow' && isNormalStock;
                                    const baseIncome = isTTM ? getBaseRows('income') : (reportData.income || []);
                                    const baseCashflow = isTTM ? getBaseRows('cashflow') : (reportData.cashflow || []);
                                    const statementRows = isNormalIncomePreset
                                        ? buildNormalIncomePresetRows(baseIncome, reportData.ratio || [])
                                        : isEquityPreset
                                            ? buildEquityPresetRows(reportData.balance || [], metricMaps.balance || {})
                                        : isCashflowPreset
                                            ? buildCashflowPresetRows(baseCashflow, baseIncome)
                                        : rawRows;
                                    const sortedPeriodRows = [...statementRows].sort((a, b) => periodSortKey(b) - periodSortKey(a));
                                    const periodRows = statementWindow === 'all'
                                        ? sortedPeriodRows
                                        : sortedPeriodRows.slice(0, Number(statementWindow));
                                    const metricKeys = isNormalIncomePreset
                                        ? NORMAL_INCOME_PRESET_ORDER
                                        : isEquityPreset
                                            ? EQUITY_PRESET_ORDER
                                        : isCashflowPreset
                                            ? CASHFLOW_PRESET_ORDER
                                        : pickColumns(periodRows).filter((metric) =>
                                            !periodRows.every((row) => isZeroLike(row[metric]))
                                        );
                                    const currentMap = activeSubTab === 'income'
                                        ? metricMaps.income
                                        : activeSubTab === 'balance'
                                            ? metricMaps.balance
                                            : activeSubTab === 'equity'
                                                ? metricMaps.balance
                                            : activeSubTab === 'cashflow'
                                            ? metricMaps.cashflow
                                            : metricMaps.note;
                                    const currentMeta = activeSubTab === 'income'
                                        ? metricMetaMaps.income
                                        : activeSubTab === 'balance'
                                            ? metricMetaMaps.balance
                                            : activeSubTab === 'equity'
                                                ? metricMetaMaps.balance
                                            : activeSubTab === 'cashflow'
                                                ? metricMetaMaps.cashflow
                                                : metricMetaMaps.note;
                                    if (!periodRows.length || !metricKeys.length) {
                                        return <div className="p-4 text-sm text-tremor-content dark:text-dark-tremor-content">No data.</div>;
                                    }
                                    const orderedMetricKeys =
                                        (isNormalIncomePreset
                                            ? NORMAL_INCOME_PRESET_ORDER
                                            : isEquityPreset
                                                ? EQUITY_PRESET_ORDER
                                            : isCashflowPreset
                                                ? CASHFLOW_PRESET_ORDER
                                            : null)
                                        ?? getNormalTemplateMetricKeys(activeSubTab, metricKeys, currentMap, isNormalStock)
                                        ?? getSortedMetricKeys(activeSubTab, metricKeys);
                                    const childrenMap = new Map<string, string[]>();
                                    for (const key of orderedMetricKeys) {
                                        const parent = currentMeta[key.toLowerCase()]?.parent?.toLowerCase();
                                        if (!parent) continue;
                                        if (!childrenMap.has(parent)) childrenMap.set(parent, []);
                                        childrenMap.get(parent)!.push(key);
                                    }
                                    const hasCollapsedAncestor = (metric: string): boolean => {
                                        let cursor = currentMeta[metric.toLowerCase()]?.parent?.toLowerCase();
                                        while (cursor) {
                                            if (collapsedRows.has(cursor)) return true;
                                            cursor = currentMeta[cursor]?.parent?.toLowerCase();
                                        }
                                        return false;
                                    };
                                    const displayMetricKeys = orderedMetricKeys.filter((metric) => !hasCollapsedAncestor(metric));
                                    const parentSumStatus = (metric: string, row: Record<string, any>): boolean | null => {
                                        const children = childrenMap.get(metric.toLowerCase()) || [];
                                        if (!children.length) return null;
                                        const parentVal = Number(row[metric]);
                                        if (!Number.isFinite(parentVal)) return null;
                                        const childVals = children.map((k) => Number(row[k]));
                                        if (childVals.some((v) => !Number.isFinite(v))) return null;
                                        const sum = childVals.reduce((a, b) => a + b, 0);
                                        const tolerance = Math.max(1, Math.abs(parentVal), Math.abs(sum)) * 1e-6;
                                        return Math.abs(parentVal - sum) <= tolerance;
                                    };
                                    const growthType = getGrowthType(displayMode);
                                    const showGrowth = displayMode !== 'ttm' && periodRows.length > 1;

                                    // Build comparison index: for each period, find the prior period for growth calc
                                    const growthForMetric = (metric: string, curIdx: number): number | null => {
                                        if (!showGrowth) return null;
                                        const cur = periodRows[curIdx];
                                        const curY = Number(cur?.year ?? cur?.year_report ?? 0);
                                        const curQ = Number(cur?.quarter ?? cur?.quarter_report ?? 0);

                                        let priorY: number, priorQ: number;
                                        if (growthType === 'yoy') {
                                            priorY = curY - 1;
                                            priorQ = curQ;
                                        } else {
                                            // QoQ: previous quarter
                                            if (curQ <= 1) { priorY = curY - 1; priorQ = 4; }
                                            else { priorY = curY; priorQ = curQ - 1; }
                                        }

                                        const prior = periodRows.find(r => {
                                            const ry = Number(r?.year ?? r?.year_report ?? 0);
                                            const rq = Number(r?.quarter ?? r?.quarter_report ?? 0);
                                            return ry === priorY && rq === priorQ;
                                        });
                                        if (!prior) return null;
                                        const curVal = Number(cur?.[metric]);
                                        const priorVal = Number(prior?.[metric]);
                                        if (!Number.isFinite(curVal) || !Number.isFinite(priorVal) || Math.abs(priorVal) < 1e-12) return null;
                                        return ((curVal - priorVal) / Math.abs(priorVal)) * 100;
                                    };

                                    const fmtGrowthCell = (pct: number | null): { text: string; cls: string } => {
                                        if (pct === null || !Number.isFinite(pct)) return { text: '-', cls: 'text-tremor-content dark:text-dark-tremor-content' };
                                        const sign = pct >= 0 ? '+' : '';
                                        return {
                                            text: `${sign}${pct.toFixed(1)}%`,
                                            cls: pct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400',
                                        };
                                    };

                                    const safeMobileIndex = Math.min(mobilePeriodIndex, Math.max(0, periodRows.length - 1));
                                    const mobileRow = periodRows[safeMobileIndex];
                                    return (
                                        <>
                                        <div className="p-3 md:hidden">
                                            <select
                                                value={String(safeMobileIndex)}
                                                onChange={(e) => setMobilePeriodIndex(Number(e.target.value))}
                                                className="w-full rounded-tremor-small border border-tremor-border bg-white px-2.5 py-2 text-sm text-tremor-content-strong dark:border-dark-tremor-border dark:bg-gray-950 dark:text-dark-tremor-content-strong"
                                            >
                                                {periodRows.map((row, idx) => (
                                                    <option key={`mobile-period-${idx}`} value={String(idx)}>
                                                        {renderPeriod(row)}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="hidden md:block w-full overflow-x-auto overflow-y-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                                            <table className="min-w-full w-max border-collapse text-sm">
                                                <thead className="bg-gray-50/50 dark:bg-gray-900/50">
                                                    <tr>
                                                        <th className="sticky left-0 z-10 min-w-[260px] border-b border-tremor-border bg-gray-50/50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-tremor-content dark:border-dark-tremor-border dark:bg-gray-900/50 dark:text-dark-tremor-content">
                                                            {activeSubTab === 'income' ? 'Income Statement' : activeSubTab === 'balance' ? 'Balance Sheet' : activeSubTab === 'equity' ? 'Equity' : activeSubTab === 'cashflow' ? 'Cash Flow' : 'Note'}
                                                        </th>
                                                        {periodRows.map((row, idx) => {
                                                            const growth = showGrowth && idx < periodRows.length - 1 ? growthForMetric('__check__', idx) : null;
                                                            return (
                                                                <React.Fragment key={`${renderPeriod(row)}-${idx}`}>
                                                                    <th className="whitespace-nowrap border-b border-tremor-border px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-tremor-content dark:border-dark-tremor-border dark:text-dark-tremor-content">
                                                                        {renderPeriod(row)}
                                                                    </th>
                                                                    {showGrowth && idx < periodRows.length - 1 && (
                                                                        <th className="whitespace-nowrap border-b border-tremor-border bg-gray-100/50 px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-wider text-tremor-content-subtle dark:border-dark-tremor-border dark:bg-gray-800/50 dark:text-dark-tremor-content-subtle" style={{ minWidth: '72px' }}>
                                                                            {growthType === 'yoy' ? 'YoY' : 'QoQ'}
                                                                        </th>
                                                                    )}
                                                                </React.Fragment>
                                                            );
                                                        })}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                                    {displayMetricKeys.map((metric) => (
                                                        (() => {
                                                            const label = currentMap[metric.toLowerCase()] || formatMetricLabel(metric);
                                                            const isSectionRow = (isEquityPreset && EQUITY_SECTION_KEYS.has(metric)) || (isNormalIncomePreset && NORMAL_INCOME_SECTION_KEYS.has(metric));
                                                            const isCashflowSectionRow = isCashflowPreset && CASHFLOW_SECTION_KEYS.has(metric);
                                                            const equityLabel = isEquityPreset ? EQUITY_PRESET_LABELS[metric] : null;
                                                            const cashflowLabel = isCashflowPreset ? CASHFLOW_PRESET_LABELS[metric] : null;
                                                            const displayLabel = (isNormalIncomePreset ? NORMAL_INCOME_PRESET_LABELS[metric] : null) || label;
                                                            const finalLabel = cashflowLabel || equityLabel || displayLabel;
                                                            const important = isSectionRow || isCashflowSectionRow || isImportantMetric(metric, finalLabel, activeSubTab);
                                                            const level = Number(currentMeta[metric.toLowerCase()]?.level ?? 0);
                                                            const hasChildren = (childrenMap.get(metric.toLowerCase()) || []).length > 0;
                                                            const isCollapsed = collapsedRows.has(metric.toLowerCase());
                                                            const relation = parentSumStatus(metric, periodRows[0] || {});
                                                            const isAnySection = isSectionRow || isCashflowSectionRow;
                                                            return (
                                                        <tr key={metric} className={cx(
                                                            "transition-colors",
                                                            isAnySection
                                                                ? "bg-gray-100/70 dark:bg-gray-800/50"
                                                                : cx("hover:bg-gray-50/50 dark:hover:bg-gray-900/50", important && "bg-amber-50/30 dark:bg-amber-900/10")
                                                        )}>
                                                            <td className={cx(
                                                                "sticky left-0 z-[1] min-w-[260px] px-4 py-3 text-sm font-medium dark:text-dark-tremor-content-strong",
                                                                isAnySection
                                                                    ? "bg-gray-100/70 dark:bg-gray-800/50 text-tremor-content-strong dark:text-dark-tremor-content-strong font-semibold uppercase tracking-wide text-xs"
                                                                    : cx("bg-white dark:bg-gray-950 text-tremor-content-strong", important && "text-amber-700 dark:text-amber-300 font-semibold")
                                                            )}>
                                                                <div className="flex items-center gap-1.5" style={{ paddingLeft: `${Math.max(0, level - 1) * 12}px` }}>
                                                                    {!isAnySection && hasChildren ? (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const key = metric.toLowerCase();
                                                                                setCollapsedRows((prev) => {
                                                                                    const next = new Set(prev);
                                                                                    if (next.has(key)) next.delete(key);
                                                                                    else next.add(key);
                                                                                    return next;
                                                                                });
                                                                            }}
                                                                            className="inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900"
                                                                            aria-label={isCollapsed ? 'Expand row' : 'Collapse row'}
                                                                        >
                                                                            <img src={isCollapsed ? PLUS_ICON_URL : MINUS_ICON_URL} alt="" className="h-2.5 w-2.5" />
                                                                        </button>
                                                                    ) : (
                                                                        !isAnySection && <span className="inline-block w-4" />
                                                                    )}
                                                                    <span>{finalLabel}</span>
                                                                    {relation !== null && (
                                                                        <span className={cx("ml-1 inline-block h-1.5 w-1.5 rounded-full", relation ? "bg-emerald-500" : "bg-amber-500")} />
                                                                    )}
                                                                </div>
                                                            </td>
                                                            {periodRows.map((row, idx) => {
                                                                const growthPct = showGrowth ? growthForMetric(metric, idx) : null;
                                                                const growthInfo = fmtGrowthCell(growthPct);
                                                                return (
                                                                    <React.Fragment key={`${metric}-${idx}`}>
                                                                        <td className={cx("whitespace-nowrap px-4 py-3 text-right text-sm text-tremor-content dark:text-dark-tremor-content", isAnySection && "bg-gray-100/70 dark:bg-gray-800/50")}>
                                                                            {isAnySection ? '' : formatStatementCell(metric, row[metric], {
                                                                                percentKeys: isNormalIncomePreset ? NORMAL_INCOME_PERCENT_KEYS : undefined,
                                                                            })}
                                                                        </td>
                                                                        {showGrowth && !isAnySection && (
                                                                            <td className={cx("whitespace-nowrap px-3 py-3 text-center text-xs font-medium", growthInfo.cls, "bg-gray-50/50 dark:bg-gray-900/30")} style={{ minWidth: '72px' }}>
                                                                                {growthInfo.text}
                                                                            </td>
                                                                        )}
                                                                        {showGrowth && isAnySection && (
                                                                            <td className="bg-gray-100/70 dark:bg-gray-800/50" style={{ minWidth: '72px' }} />
                                                                        )}
                                                                    </React.Fragment>
                                                                );
                                                            })}
                                                        </tr>
                                                            );
                                                        })()
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        {/* Mobile: single-period view with growth */}
                                        <div className="md:hidden w-full overflow-hidden px-0">
                                            <table className="w-full border-collapse text-sm">
                                                <thead className="bg-gray-50/50 dark:bg-gray-900/50">
                                                    <tr>
                                                        <th className="w-[50%] border-b border-tremor-border px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-tremor-content dark:border-dark-tremor-border dark:text-dark-tremor-content">Metric</th>
                                                        <th className="border-b border-tremor-border px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-tremor-content dark:border-dark-tremor-border dark:text-dark-tremor-content">{renderPeriod(mobileRow)}</th>
                                                        {showGrowth && safeMobileIndex < periodRows.length - 1 && (
                                                            <th className="border-b border-tremor-border bg-gray-100/50 px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-tremor-content-subtle dark:border-dark-tremor-border dark:bg-gray-800/50 dark:text-dark-tremor-content-subtle">
                                                                {growthType === 'yoy' ? 'YoY' : 'QoQ'}
                                                            </th>
                                                        )}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                                                    {displayMetricKeys.map((metric) => {
                                                        const label = currentMap[metric.toLowerCase()] || formatMetricLabel(metric);
                                                        const isSectionRow = (isEquityPreset && EQUITY_SECTION_KEYS.has(metric)) || (isNormalIncomePreset && NORMAL_INCOME_SECTION_KEYS.has(metric));
                                                        const isCashflowSectionRow = isCashflowPreset && CASHFLOW_SECTION_KEYS.has(metric);
                                                        const equityLabel = isEquityPreset ? EQUITY_PRESET_LABELS[metric] : null;
                                                        const cashflowLabel = isCashflowPreset ? CASHFLOW_PRESET_LABELS[metric] : null;
                                                        const displayLabel = (isNormalIncomePreset ? NORMAL_INCOME_PRESET_LABELS[metric] : null) || label;
                                                        const finalLabel = cashflowLabel || equityLabel || displayLabel;
                                                        const important = isSectionRow || isCashflowSectionRow || isImportantMetric(metric, finalLabel, activeSubTab);
                                                        const level = Number(currentMeta[metric.toLowerCase()]?.level ?? 0);
                                                        const hasChildren = (childrenMap.get(metric.toLowerCase()) || []).length > 0;
                                                        const isCollapsed = collapsedRows.has(metric.toLowerCase());
                                                        const relation = parentSumStatus(metric, mobileRow || {});
                                                        const isAnySection = isSectionRow || isCashflowSectionRow;
                                                        const growthPct = showGrowth ? growthForMetric(metric, safeMobileIndex) : null;
                                                        const growthInfo = fmtGrowthCell(growthPct);
                                                        return (
                                                            <tr key={`mobile-${metric}`} className={cx(
                                                                isAnySection
                                                                    ? "bg-gray-100/70 dark:bg-gray-800/50"
                                                                    : cx(important && "bg-amber-50/30 dark:bg-amber-900/10")
                                                            )}>
                                                                <td className={cx(
                                                                    "px-3 py-2 text-xs align-top break-words",
                                                                    isAnySection
                                                                        ? "text-tremor-content-strong dark:text-dark-tremor-content-strong font-semibold uppercase tracking-wide"
                                                                        : cx("text-tremor-content-strong dark:text-dark-tremor-content-strong", important && "text-amber-700 dark:text-amber-300 font-semibold")
                                                                )}>
                                                                    <div className="flex items-center gap-1.5" style={{ paddingLeft: `${Math.max(0, level - 1) * 10}px` }}>
                                                                        {!isAnySection && hasChildren ? (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => {
                                                                                    const key = metric.toLowerCase();
                                                                                    setCollapsedRows((prev) => {
                                                                                        const next = new Set(prev);
                                                                                        if (next.has(key)) next.delete(key);
                                                                                        else next.add(key);
                                                                                        return next;
                                                                                    });
                                                                                }}
                                                                                className="inline-flex h-4 w-4 items-center justify-center rounded border border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-900"
                                                                                aria-label={isCollapsed ? 'Expand row' : 'Collapse row'}
                                                                            >
                                                                                <img src={isCollapsed ? PLUS_ICON_URL : MINUS_ICON_URL} alt="" className="h-2.5 w-2.5" />
                                                                            </button>
                                                                        ) : (
                                                                            !isAnySection && <span className="inline-block w-4" />
                                                                        )}
                                                                        <span>{finalLabel}</span>
                                                                        {relation !== null && (
                                                                            <span className={cx("ml-1 inline-block h-1.5 w-1.5 rounded-full", relation ? "bg-emerald-500" : "bg-amber-500")} />
                                                                        )}
                                                                    </div>
                                                                </td>
                                                                <td className="px-3 py-2 text-right text-xs text-tremor-content dark:text-dark-tremor-content align-top break-all">
                                                                    {isAnySection ? '' : formatStatementCell(metric, mobileRow?.[metric], {
                                                                        percentKeys: isNormalIncomePreset ? NORMAL_INCOME_PERCENT_KEYS : undefined,
                                                                    })}
                                                                </td>
                                                                {showGrowth && !isAnySection && (
                                                                    <td className={cx("px-3 py-2 text-center text-xs font-medium align-top", growthInfo.cls, "bg-gray-50/50 dark:bg-gray-900/30")}>
                                                                        {growthInfo.text}
                                                                    </td>
                                                                )}
                                                                {showGrowth && isAnySection && (
                                                                    <td className="bg-gray-100/70 dark:bg-gray-800/50 align-top" />
                                                                )}
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                        </>
                                    );
                                })()
                            )}
                        </div>
                    )}

                    {/* Metric cards */}
                    {activeSubTab === 'ratio' && (
                    <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <MetricCard title="Valuation">
                            <MetricRow label={effectivePeriod === 'quarter' ? 'EPS (Quarter)' : 'EPS (TTM)'} value={getEpsForPeriod()} />
                            <MetricRow label="P/E" value={records.length ? latest(records, 'pe') : pickOverview('pe', 'pe_ratio', 'PE')} />
                            <MetricRow label="P/B" value={records.length ? latest(records, 'pb') : pickOverview('pb', 'pb_ratio', 'PB')} />
                            <MetricRow label="P/S" value={pickOverview('ps', 'p_s', 'price_to_sales')} />
                            <MetricRow label="P/CF" value={pickOverview('p_cash_flow', 'pcf_ratio', 'price_to_cash_flow')} />
                            <MetricRow label="EV/EBITDA" value={computedEvEbitda()} />
                        </MetricCard>

                        <MetricCard title="Profitability">
                            <MetricRow label="ROE" value={pickOverview('roe', 'ROE')} unit=" %" />
                            <MetricRow label="ROA" value={pickOverview('roa', 'ROA')} unit=" %" />
                            <MetricRow label="ROIC" value={pickOverview('roic')} unit=" %" />
                            <MetricRow label="Gross Margin" value={pickOverview('gross_margin', 'grossProfitMargin')} unit=" %" />
                            <MetricRow label="Net Margin" value={pickOverview('net_profit_margin', 'net_margin', 'netProfitMargin')} unit=" %" />
                        </MetricCard>

                        {!isBank && (
                            <MetricCard title="Financial Health">
                                <MetricRow label="Current Ratio" value={pickOverview('current_ratio', 'currentRatio')} />
                                <MetricRow label="Quick Ratio" value={pickOverview('quick_ratio', 'quickRatio')} />
                                <MetricRow label="Cash Ratio" value={pickOverview('cash_ratio', 'cashRatio')} />
                                <MetricRow label="D/E Ratio" value={pickOverview('debt_to_equity', 'debtToEquity', 'de')} />
                                <MetricRow label="Asset Turnover" value={pickOverview('asset_turnover')} />
                                <MetricRow label="Dividend Yield" value={pickOverview('dividend_yield')} unit=" %" />
                            </MetricCard>
                        )}

                        {isBank && (
                            <MetricCard title="Banking KPIs">
                                <MetricRow label="NIM" value={overviewData?.nim ?? overviewData?.net_interest_margin ?? null} unit=" %" />
                                <MetricRow label="CASA" value={overviewData?.casa ?? overviewData?.casa_ratio ?? null} unit=" %" />
                                <MetricRow label="CAR" value={overviewData?.car ?? null} unit=" %" />
                                <MetricRow label="NPL" value={overviewData?.npl ?? overviewData?.npl_ratio ?? null} unit=" %" />
                                <MetricRow label="LDR" value={overviewData?.ldr ?? null} unit=" %" />
                                <MetricRow label="CIR" value={overviewData?.cir ?? null} unit=" %" />
                                <MetricRow label="Cost of Funds" value={overviewData?.cof ?? null} unit=" %" />
                                <MetricRow label="Fee Income" value={overviewData?.fee_income_ratio ?? null} unit=" %" />
                                <MetricRow label="LLR Coverage" value={overviewData?.llr_coverage ?? null} unit=" x" />
                                <MetricRow label="Yield on Assets" value={overviewData?.yield_on_assets ?? null} unit=" %" />
                            </MetricCard>
                        )}
                    </div>

                    {/* Charts */}
                    {records.length > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                            <ChartCard title="ROE & ROA (%)">
                                <LineChart
                                    className="h-full w-full"
                                    style={{ height: '100%', width: '100%' }}
                                    data={buildSeries(r => ({ year: r.period, ROE: r.roe ?? 0, ROA: r.roa ?? 0 }))}
                                    index="year"
                                    categories={['ROE', 'ROA']}
                                    colors={['blue', 'emerald']}
                                    valueFormatter={formatNumber}
                                    yAxisWidth={40}
                                    customTooltip={CustomTooltip}
                                    showLegend={true}
                                    showAnimation={false}
                                />
                            </ChartCard>

                            <ChartCard title="P/E & P/B">
                                <LineChart
                                    className="h-full w-full"
                                    style={{ height: '100%', width: '100%' }}
                                    data={buildSeries(r => ({ year: r.period, 'P/E': r.pe ?? 0, 'P/B': r.pb ?? 0 }))}
                                    index="year"
                                    categories={['P/E', 'P/B']}
                                    colors={['red', 'violet']}
                                    valueFormatter={formatNumber}
                                    yAxisWidth={40}
                                    customTooltip={CustomTooltip}
                                    showLegend={true}
                                    showAnimation={false}
                                />
                            </ChartCard>

                            {!isBank && (
                                <ChartCard title="Current Ratio & Quick Ratio">
                                    <LineChart
                                        className="h-full w-full"
                                        style={{ height: '100%', width: '100%' }}
                                        data={buildSeries(r => ({ year: r.period, 'Current Ratio': r.currentRatio, 'Quick Ratio': r.quickRatio }))}
                                        index="year"
                                        categories={['Current Ratio', 'Quick Ratio']}
                                        colors={['amber', 'cyan']}
                                        valueFormatter={formatNumber}
                                        yAxisWidth={40}
                                        customTooltip={CustomTooltip}
                                        showLegend={true}
                                        showAnimation={false}
                                    />
                                </ChartCard>
                            )}

                            {hasNetMarginData && (
                                <ChartCard title="Net Profit Margin (%)">
                                    <LineChart
                                        className="h-full w-full"
                                        style={{ height: '100%', width: '100%' }}
                                        data={buildSeries(r => ({ year: r.period, 'Net Margin (%)': r.netMargin }))}
                                        index="year"
                                        categories={['Net Margin (%)']}
                                        colors={['teal']}
                                        valueFormatter={v => `${formatNumber(v)}%`}
                                        yAxisWidth={48}
                                        customTooltip={CustomTooltip}
                                        showLegend={true}
                                        showAnimation={false}
                                    />
                                </ChartCard>
                            )}

                            {isBank && bankingHistory.length > 0 && (
                                <ChartCard title="NIM & CIR (%)">
                                    <LineChart
                                        className="h-full w-full"
                                        style={{ height: '100%', width: '100%' }}
                                        data={bankingHistory.map(r => ({ year: r.label, 'NIM (%)': r.nim, 'CIR (%)': r.cir }))}
                                        index="year"
                                        categories={['NIM (%)', 'CIR (%)']}
                                        colors={['blue', 'orange']}
                                        valueFormatter={v => `${formatNumber(v)}%`}
                                        yAxisWidth={48}
                                        customTooltip={CustomTooltip}
                                        showLegend={true}
                                        showAnimation={false}
                                    />
                                </ChartCard>
                            )}

                            {isBank && bankingHistory.length > 0 && (
                                <ChartCard title="NPL & CAR (%)">
                                    <LineChart
                                        className="h-full w-full"
                                        style={{ height: '100%', width: '100%' }}
                                        data={bankingHistory.map(r => ({ year: r.label, 'NPL (%)': r.npl, 'CAR (%)': r.car }))}
                                        index="year"
                                        categories={['NPL (%)', 'CAR (%)']}
                                        colors={['red', 'emerald']}
                                        valueFormatter={v => `${formatNumber(v)}%`}
                                        yAxisWidth={48}
                                        customTooltip={CustomTooltip}
                                        showLegend={true}
                                        showAnimation={false}
                                    />
                                </ChartCard>
                            )}

                            {isBank && bankingHistory.length > 0 && (
                                <ChartCard title="CASA & LDR (%)">
                                    <LineChart
                                        className="h-full w-full"
                                        style={{ height: '100%', width: '100%' }}
                                        data={bankingHistory.map(r => ({ year: r.label, 'CASA (%)': r.casa, 'LDR (%)': r.ldr }))}
                                        index="year"
                                        categories={['CASA (%)', 'LDR (%)']}
                                        colors={['violet', 'cyan']}
                                        valueFormatter={v => `${formatNumber(v)}%`}
                                        yAxisWidth={48}
                                        customTooltip={CustomTooltip}
                                        showLegend={true}
                                        showAnimation={false}
                                    />
                                </ChartCard>
                            )}

                        </div>
                    )}
                    </>
                    )}
                </div>
            )}
        </div>
    );
}
