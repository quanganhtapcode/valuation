'use client';

import React, { useEffect, useState, useRef } from 'react';
import { formatNumber } from '@/lib/api';
import { cx } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type DisplayMode = 'annual' | 'quarterly' | 'ttm';
type ReportType = 'key_stats' | 'income' | 'balance' | 'cashflow' | 'ratios';
type DisplayUnit = 'billions' | 'trillions';

interface FinancialsTabProps {
    symbol: string;
    period?: 'quarter' | 'year';
    setPeriod?: (p: 'quarter' | 'year') => void;
    initialChartData?: any;
    initialOverviewData?: any;
    isLoading?: boolean;
    onDownloadExcel?: () => void;
}

// ── Tab Configuration ─────────────────────────────────────────────────────────

const TABS: { id: ReportType; label: string }[] = [
    { id: 'key_stats', label: 'Key Stats' },
    { id: 'income', label: 'Income Statement' },
    { id: 'balance', label: 'Balance Sheet' },
    { id: 'cashflow', label: 'Cash Flow' },
    { id: 'ratios', label: 'Ratios' },
];

const BANK_SYMBOLS = new Set([
    'VCB','BID','CTG','TCB','MBB','ACB','VPB','HDB','SHB','STB',
    'TPB','LPB','MSB','OCB','EIB','ABB','NAB','PGB','VAB','VIB',
    'SSB','BAB','KLB','BVB','KBS','SGB','NVB'
]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, decimals = 0): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '-';
    const absV = Math.abs(v);
    if (absV < 0.01) return '-';
    const sign = v < 0 ? '-' : '';
    return `${sign}${formatNumber(absV, { maximumFractionDigits: decimals, minimumFractionDigits: 0 })}`;
}

function fmtPct(v: number | null | undefined, decimals = 1): string {
    if (v === null || v === undefined || Number.isNaN(v)) return '-';
    const displayValue = Math.abs(v) < 2 ? v * 100 : v;
    return `${displayValue.toFixed(decimals)}%`;
}

function renderPeriod(row: Record<string, any>, isForecast?: boolean): { label: string; isForecast: boolean } {
    const year = row?.year ?? row?.year_report ?? row?.yearReport;
    const quarter = row?.quarter ?? row?.quarter_report ?? row?.quarterReport;
    let label = '-';
    if (quarter && Number(quarter) > 0) {
        label = `Q${quarter}/${year}`;
    } else if (year) {
        label = `12/31/${year}`;
    }
    return { label, isForecast: isForecast ?? row?.is_forecast ?? row?.isForecast ?? false };
}

function periodSortKey(row: Record<string, any>): number {
    const year = Number(row?.year ?? row?.year_report ?? row?.yearReport ?? 0);
    const quarter = Number(row?.quarter ?? row?.quarter_report ?? row?.quarterReport ?? 0);
    return year * 10 + (quarter || 0);
}

function isBankStock(symbol: string, overviewData: any): boolean {
    // Primary: vci_company.sqlite isbank flag, already included in overviewData
    if (overviewData?.isbank) return true;
    // Secondary: hardcoded set as fallback before overviewData loads
    if (BANK_SYMBOLS.has(symbol)) return true;
    // Tertiary: NIM > 0 from vci_stats_financial
    const nim = overviewData?.nim ?? overviewData?.net_interest_margin;
    if (nim !== null && nim !== undefined && Number(nim) > 0) return true;
    return false;
}

// ── Display Unit Config ───────────────────────────────────────────────────────

const DISPLAY_UNITS: { id: DisplayUnit; label: string; divisor: number }[] = [
    { id: 'billions', label: 'Tỷ', divisor: 1_000_000 },
    { id: 'trillions', label: 'Nghìn tỷ', divisor: 1_000_000_000 },
];

// ── Key Metrics Config ────────────────────────────────────────────────────────

const NORMAL_KEY_METRICS: { key: string; label: string; section: string; isPct?: boolean; indent?: boolean }[] = [
    { key: 'market_cap', label: 'Market Cap', section: 'overview' },
    { key: 'cash', label: 'Cash', section: 'overview' },
    { key: 'total_debt', label: 'Debt', section: 'overview' },
    { key: 'enterprise_value', label: 'Enterprise Value', section: 'overview' },
    { key: 'revenue', label: 'Revenue', section: 'income' },
    { key: 'revenue_growth', label: '  Revenue Growth', isPct: true, indent: true, section: 'income' },
    { key: 'gross_profit', label: 'Gross Profit', section: 'income' },
    { key: 'gross_margin', label: '  Gross Margin', isPct: true, indent: true, section: 'income' },
    { key: 'ebitda', label: 'EBITDA', section: 'income' },
    { key: 'ebitda_margin', label: '  EBITDA Margin', isPct: true, indent: true, section: 'income' },
    { key: 'net_income', label: 'Net Income', section: 'income' },
    { key: 'net_profit_margin', label: '  Net Margin', isPct: true, indent: true, section: 'income' },
    { key: 'eps', label: 'Diluted EPS', section: 'eps' },
    { key: 'eps_ttm', label: 'EPS (TTM)', section: 'eps' },
    { key: 'profit_growth', label: '  Profit Growth', isPct: true, indent: true, section: 'eps' },
    { key: 'operating_cash_flow', label: 'Operating Cash Flow', section: 'cashflow' },
    { key: 'capex', label: 'CapEx', section: 'cashflow' },
    { key: 'free_cash_flow', label: 'Free Cash Flow', section: 'cashflow' },
];

const BANK_KEY_METRICS: { key: string; label: string; section: string; isPct?: boolean; indent?: boolean }[] = [
    { key: 'market_cap', label: 'Market Cap', section: 'overview' },
    { key: 'enterprise_value', label: 'Enterprise Value', section: 'overview' },
    { key: 'net_income', label: 'Net Income', section: 'income' },
    { key: 'nim', label: 'NIM', isPct: true, section: 'income' },
    { key: 'cir', label: 'CIR (Cost-to-Income)', isPct: true, section: 'income' },
    { key: 'eps', label: 'EPS (TTM)', section: 'income' },
    { key: 'profit_growth', label: '  Profit Growth', isPct: true, indent: true, section: 'income' },
    { key: 'casa', label: 'CASA Ratio', isPct: true, section: 'balance' },
    { key: 'npl', label: 'NPL Ratio', isPct: true, section: 'balance' },
    { key: 'ldr', label: 'LDR (Loans/Deposits)', isPct: true, section: 'balance' },
    { key: 'roe', label: 'ROE', isPct: true, section: 'ratios' },
    { key: 'roa', label: 'ROA', isPct: true, section: 'ratios' },
    { key: 'car', label: 'CAR (Capital Adequacy)', isPct: true, section: 'ratios' },
    { key: 'pe', label: 'P/E Ratio', section: 'ratios' },
    { key: 'pb', label: 'P/B Ratio', section: 'ratios' },
];

// ── Section Definitions for Reports ───────────────────────────────────────────

const INCOME_SECTIONS = [
    {
        title: 'Báo cáo kết quả kinh doanh',
        rows: [
            { key: 'isa1', label: 'Total Revenues' },
            { key: 'isa3', label: 'Net Revenue' },
            { key: 'isa4', label: 'Cost of Goods Sold' },
            { key: 'isa5', label: 'Gross Profit', isTotal: true },
            { key: 'isa6', label: 'Financial Income' },
            { key: 'isa7', label: 'Financial Expense' },
            { key: 'isa11', label: 'Operating Profit', isTotal: true },
            { key: 'isa16', label: 'Income Before Taxes', isTotal: true },
            { key: 'isa19', label: 'Provision for Taxes' },
            { key: 'isa20', label: 'Consolidated Net Income', isTotal: true },
            { key: 'isa21', label: 'Minority Interests' },
            { key: 'isa22', label: 'Net Profit (Parent)' },
            { key: 'isa23', label: 'EPS (Basic)' },
            { key: 'isa24', label: 'EPS (Diluted)' },
        ]
    },
    {
        title: 'Margins',
        isPctSection: true,
        rows: [
            { key: 'gross_margin', label: 'Gross Margin' },
            { key: 'operating_margin', label: 'Operating Margin' },
            { key: 'ebitda_margin', label: 'EBITDA Margin' },
            { key: 'net_margin', label: 'Net Profit Margin' },
            { key: 'pre_tax_margin', label: 'Pre-Tax Profit Margin' },
        ]
    }
];

const BALANCE_SECTIONS = [
    {
        title: 'Assets',
        rows: [
            { key: 'bsa2', label: 'Cash & Equivalents' },
            { key: 'bsa5', label: 'Short-term Investments' },
            { key: 'bsa8', label: 'Accounts Receivable' },
            { key: 'bsa15', label: 'Inventories, Net' },
            { key: 'bsa1', label: 'Total Current Assets', isTotal: true },
            { key: 'bsa29', label: 'Fixed Assets' },
            { key: 'bsa40', label: 'Investment Properties' },
            { key: 'bsa43', label: 'Long-term Investments' },
            { key: 'bsa49', label: 'Other Long-term Assets' },
            { key: 'bsa23', label: 'Total Long-term Assets', isTotal: true },
            { key: 'bsa53', label: 'Total Assets', isGrandTotal: true },
        ]
    },
    {
        title: 'Liabilities',
        rows: [
            { key: 'bsa55', label: 'Current Liabilities' },
            { key: 'bsa56', label: 'Short-term Borrowings' },
            { key: 'bsa57', label: 'Trade Accounts Payable' },
            { key: 'bsa67', label: 'Long-term Liabilities' },
            { key: 'bsa71', label: 'Long-term Borrowings' },
            { key: 'bsa54', label: 'Total Liabilities', isGrandTotal: true },
        ]
    },
    {
        title: 'Equity',
        rows: [
            { key: 'bsa78', label: "Owner's Equity" },
            { key: 'bsa79', label: 'Capital and Reserves' },
            { key: 'bsa80', label: 'Paid-in Capital' },
            { key: 'bsa81', label: 'Share Premium' },
            { key: 'bsa83', label: 'Treasury Shares' },
            { key: 'bsa90', label: 'Undistributed Earnings' },
            { key: 'bsa210', label: 'Minority Interests' },
            { key: 'bsa96', label: 'Total Resources', isGrandTotal: true },
        ]
    }
];

const CASHFLOW_SECTIONS = [
    {
        title: 'Operating Activities',
        rows: [
            { key: 'cfa1', label: 'Profit Before Tax' },
            { key: 'cfa2', label: 'Depreciation & Amortization' },
            { key: 'cfa3', label: 'Provisions' },
            { key: 'cfa4', label: 'P/L from Disposal of FA' },
            { key: 'cfa5', label: 'P/L from Investment Activities' },
            { key: 'cfa6', label: 'Interest Income' },
            { key: 'cfa7', label: 'Interest & Dividend Income' },
            { key: 'cfa8', label: 'Operating CF before WC' },
            { key: 'cfa9', label: 'Change in Receivables' },
            { key: 'cfa10', label: 'Change in Inventory' },
            { key: 'cfa11', label: 'Change in Payables' },
            { key: 'cfa12', label: 'Change in Prepaid Expenses' },
            { key: 'cfa13', label: 'Interest Paid' },
            { key: 'cfa14', label: 'Corporate Income Tax Paid' },
            { key: 'cfa15', label: 'Other Cash Receipts' },
            { key: 'cfa16', label: 'Other Cash Payments' },
            { key: 'cfa17', label: 'Cash from Operations', isTotal: true },
        ]
    },
    {
        title: 'Investing Activities',
        rows: [
            { key: 'cfa18', label: 'Purchase of Fixed Assets' },
            { key: 'cfa19', label: 'Proceeds from Disposal of FA' },
            { key: 'cfa20', label: 'Loans / Other Collections' },
            { key: 'cfa21', label: 'Investments in Other Companies' },
            { key: 'cfa22', label: 'Proceeds from Sale of Investments' },
            { key: 'cfa23', label: 'Dividends & Interest Received' },
            { key: 'cfa24', label: 'Cash from Investing', isTotal: true },
        ]
    },
    {
        title: 'Financing Activities',
        rows: [
            { key: 'cfa25', label: 'Proceeds from Issue of Shares' },
            { key: 'cfa26', label: 'Payments for Share Buyback' },
            { key: 'cfa27', label: 'Proceeds from Borrowings' },
            { key: 'cfa28', label: 'Repayments of Borrowings' },
            { key: 'cfa29', label: 'Finance Lease Payments' },
            { key: 'cfa30', label: 'Dividends Paid' },
            { key: 'cfa31', label: 'Other Financing Cash Flows' },
            { key: 'cfa32', label: 'Cash from Financing', isTotal: true },
        ]
    },
    {
        title: 'Summary',
        rows: [
            { key: 'cfa33', label: 'Net Change in Cash', isTotal: true },
            { key: 'cfa34', label: 'Cash at Beginning of Period' },
            { key: 'cfa35', label: 'Cash at End of Period', isGrandTotal: true },
        ]
    }
];

// ── Bank-specific Section Definitions ────────────────────────────────────────
// Banks use isb*/bsb*/cfb* columns instead of the standard isa*/bsa*/cfa*.

const BANK_INCOME_SECTIONS = [
    {
        title: 'Kết quả kinh doanh ngân hàng',
        rows: [
            { key: 'isb25', label: 'Interest and Similar Income' },
            { key: 'isb26', label: 'Interest and Similar Expenses' },
            { key: 'isb27', label: 'Net Interest Income', isTotal: true },
            { key: 'isb28', label: 'Fee and Commission Income' },
            { key: 'isb29', label: 'Fee and Commission Expenses' },
            { key: 'isb30', label: 'Net Fee and Commission Income', isTotal: true },
            { key: 'isb31', label: 'Net FX & Gold Gain/(Loss)' },
            { key: 'isb32', label: 'Net Gain from Trading Securities' },
            { key: 'isb33', label: 'Net Gain from Investment Securities' },
            { key: 'isb36', label: 'Net Other Operating Income' },
            { key: 'isb37', label: 'Dividend Income' },
            { key: 'isb38', label: 'Total Operating Income', isTotal: true },
            { key: 'isb39', label: 'General and Admin Expenses' },
            { key: 'isb40', label: 'Operating Profit Before Provisions', isTotal: true },
            { key: 'isb41', label: 'Provision for Credit Losses' },
        ]
    },
    {
        title: 'Lợi nhuận',
        rows: [
            { key: 'isa19', label: 'Corporate Income Tax' },
            { key: 'isa20', label: 'Net Profit After Tax', isTotal: true },
            { key: 'isa21', label: 'Minority Interests' },
            { key: 'isa22', label: 'Net Profit (Parent)', isGrandTotal: true },
            { key: 'isa23', label: 'EPS (Basic)' },
            { key: 'isa24', label: 'EPS (Diluted)' },
        ]
    }
];

const BANK_BALANCE_SECTIONS = [
    {
        title: 'Assets',
        rows: [
            { key: 'bsb97',  label: 'Balances with the SBV' },
            { key: 'bsb258', label: 'Balances with Other Credit Institutions' },
            { key: 'bsb259', label: 'Loans to Other Credit Institutions' },
            { key: 'bsb98',  label: 'Placements with Other Credit Institutions (net)' },
            { key: 'bsb99',  label: 'Trading Securities, Net' },
            { key: 'bsb102', label: 'Derivatives and Other Financial Assets' },
            { key: 'bsb104', label: 'Loans and Advances to Customers (gross)' },
            { key: 'bsb105', label: 'Provision for Loan Losses' },
            { key: 'bsb103', label: 'Loans and Advances to Customers (net)', isTotal: true },
            { key: 'bsb106', label: 'Investment Securities' },
            { key: 'bsb110', label: 'Other Assets' },
            { key: 'bsa53',  label: 'Total Assets', isGrandTotal: true },
        ]
    },
    {
        title: 'Liabilities',
        rows: [
            { key: 'bsb111', label: 'Loans from Gov and SBV' },
            { key: 'bsb112', label: 'Deposits & Loans from Other Credit Institutions' },
            { key: 'bsb113', label: 'Deposits from Customers' },
            { key: 'bsb114', label: 'Derivatives and Other Financial Liabilities' },
            { key: 'bsb116', label: 'Bonds and Valuable Papers Issued' },
            { key: 'bsb117', label: 'Other Liabilities' },
            { key: 'bsa54',  label: 'Total Liabilities', isGrandTotal: true },
        ]
    },
    {
        title: 'Equity',
        rows: [
            { key: 'bsb118', label: 'Charter Capital' },
            { key: 'bsb121', label: 'Reserves' },
            { key: 'bsa78',  label: "Owner's Equity (Total)", isTotal: true },
            { key: 'bsa96',  label: 'Total Resources', isGrandTotal: true },
        ]
    }
];

const BANK_CASHFLOW_SECTIONS = [
    {
        title: 'Operating Activities',
        rows: [
            { key: 'cfb75', label: 'Interest and Similar Receipts' },
            { key: 'cfb76', label: 'Interest and Similar Payments' },
            { key: 'cfb77', label: 'Fee and Commission Receipts' },
            { key: 'cfb78', label: 'FX, Gold and Securities Dealing' },
            { key: 'cfb81', label: 'Payments to Employees & Operating Expenses' },
            { key: 'cfb48', label: 'Change in Compulsory Reserves (SBV)' },
            { key: 'cfb49', label: 'Change in Placements with Other Banks' },
            { key: 'cfb52', label: 'Change in Loans and Advances to Customers' },
            { key: 'cfb55', label: 'Change in Other Operating Assets' },
            { key: 'cfb56', label: 'Change in Loans from SBV' },
            { key: 'cfb57', label: 'Change in Placements from Other Banks' },
            { key: 'cfb58', label: 'Change in Deposits from Customers' },
            { key: 'cfb63', label: 'Change in Other Operating Liabilities' },
            { key: 'cfb64', label: 'Net Cash from Operating Activities', isTotal: true },
        ]
    },
    {
        title: 'Investing Activities',
        rows: [
            { key: 'cfb67', label: 'Proceeds from Disposal of Fixed Assets' },
            { key: 'cfb68', label: 'Purchases of Investment Properties' },
            { key: 'cfb69', label: 'Proceeds from Investment Properties' },
            { key: 'cfa24', label: 'Net Cash from Investing', isTotal: true },
        ]
    },
    {
        title: 'Financing Activities',
        rows: [
            { key: 'cfb71', label: 'Proceeds from Convertible Bonds' },
            { key: 'cfb72', label: 'Payments for Convertible Bonds' },
            { key: 'cfb73', label: 'Purchase of Treasury Shares' },
            { key: 'cfb74', label: 'Proceeds from Selling Treasury Shares' },
            { key: 'cfa32', label: 'Net Cash from Financing', isTotal: true },
        ]
    },
    {
        title: 'Summary',
        rows: [
            { key: 'cfa33', label: 'Net Change in Cash', isTotal: true },
            { key: 'cfa34', label: 'Cash at Beginning of Period' },
            { key: 'cfa35', label: 'Cash at End of Period', isGrandTotal: true },
        ]
    }
];

const RATIOS_SECTIONS = [
    {
        title: 'Valuation',
        rows: [
            { key: 'current_price', label: 'Stock Price' },
            { key: 'price', label: 'Market Price' },
            { key: 'outstanding_share', label: 'Shares Outstanding' },
            { key: 'shares_outstanding', label: 'Shares Outstanding' },
            { key: 'market_cap', label: 'Market Cap' },
            { key: 'tev', label: 'Total Enterprise Value (TEV)' },
        ]
    },
    {
        title: 'Trailing Valuation',
        rows: [
            { key: 'pe', label: 'P/E Ratio' },
            { key: 'price_to_earnings', label: 'P/E Ratio' },
            { key: 'pb', label: 'P/B Ratio' },
            { key: 'price_to_book', label: 'P/B Ratio' },
            { key: 'ps', label: 'P/S Ratio' },
            { key: 'price_to_sales', label: 'P/S Ratio' },
            { key: 'pcf', label: 'P/CF Ratio' },
            { key: 'p_cash_flow', label: 'Price to Cash Flow' },
            { key: 'ev_to_ebitda', label: 'EV/EBITDA' },
            { key: 'ev_ebitda', label: 'EV/EBITDA' },
            { key: 'dividend_yield', label: 'Dividend Yield', isPct: true },
            { key: 'buyback_yield', label: 'Buyback Yield', isPct: true },
            { key: 'fcf_yield', label: 'FCF Yield', isPct: true },
        ]
    },
    {
        title: 'Profitability',
        rows: [
            { key: 'roe', label: 'ROE', isPct: true },
            { key: 'roa', label: 'ROA', isPct: true },
            { key: 'roic', label: 'ROIC', isPct: true },
            { key: 'net_profit_margin', label: 'Net Profit Margin', isPct: true },
            { key: 'gross_profit_margin', label: 'Gross Profit Margin', isPct: true },
            { key: 'ebit_margin', label: 'EBIT Margin', isPct: true },
            { key: 'pre_tax_margin', label: 'Pre-Tax Margin', isPct: true },
        ]
    },
    {
        title: 'Financial Health',
        rows: [
            { key: 'current_ratio', label: 'Current Ratio' },
            { key: 'quick_ratio', label: 'Quick Ratio' },
            { key: 'cash_ratio', label: 'Cash Ratio' },
            { key: 'debt_to_equity', label: 'Debt-to-Equity' },
            { key: 'debt_equity', label: 'Debt/Equity' },
            { key: 'financial_leverage', label: 'Financial Leverage' },
            { key: 'interest_coverage', label: 'Interest Coverage' },
            { key: 'asset_turnover', label: 'Asset Turnover' },
            { key: 'inventory_turnover', label: 'Inventory Turnover' },
            { key: 'receivables_turnover', label: 'Receivables Turnover' },
        ]
    },
    {
        title: 'Other',
        rows: [
            { key: 'free_cash_flow', label: 'Free Cash Flow' },
            { key: 'ebitda', label: 'EBITDA' },
            { key: 'nopat', label: 'NOPAT' },
            { key: 'book_value', label: 'Book Value' },
            { key: 'bvps', label: 'Book Value Per Share' },
            { key: 'eps', label: 'EPS' },
        ]
    }
];

// ── Pill Dropdown Component ───────────────────────────────────────────────────

function PillDropdown({
    label,
    children,
    align = 'left',
}: {
    label: React.ReactNode;
    children: React.ReactNode;
    align?: 'left' | 'right';
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        if (open) document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(o => !o)}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-[13px] font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
                {label}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-gray-400 flex-shrink-0">
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>
            {open && (
                <div className={cx(
                    'absolute top-full mt-1.5 z-50 min-w-[160px] rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-1 overflow-hidden',
                    align === 'right' ? 'right-0' : 'left-0'
                )}>
                    {children}
                </div>
            )}
        </div>
    );
}

function PillDropdownItem({
    active,
    onClick,
    children,
}: {
    active?: boolean;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            onClick={onClick}
            className={cx(
                'w-full text-left px-3 py-2 text-[13px] transition-colors',
                active
                    ? 'bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white font-medium'
                    : 'text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700/60'
            )}
        >
            {children}
        </button>
    );
}

// ── Settings Popover ──────────────────────────────────────────────────────────

function SettingsPopover({
    displayUnit,
    setDisplayUnit,
}: {
    displayUnit: DisplayUnit;
    setDisplayUnit: (u: DisplayUnit) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onClickOutside(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        }
        if (open) document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                onClick={() => setOpen(o => !o)}
                className="flex items-center justify-center w-8 h-8 rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" />
                </svg>
            </button>
            {open && (
                <div className="absolute right-0 top-full mt-1.5 z-50 w-52 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg py-3 px-4">
                    <p className="text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">Đơn vị hiển thị</p>
                    <div className="space-y-1">
                        {DISPLAY_UNITS.map(unit => (
                            <label key={unit.id} className="flex items-center gap-2 cursor-pointer py-0.5">
                                <input
                                    type="radio"
                                    name="displayUnit"
                                    checked={displayUnit === unit.id}
                                    onChange={() => { setDisplayUnit(unit.id); setOpen(false); }}
                                    className="w-3.5 h-3.5 text-blue-600 border-gray-300 focus:ring-blue-500"
                                />
                                <span className="text-[13px] text-gray-700 dark:text-slate-200">{unit.label}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Sectioned Table Component ─────────────────────────────────────────────────

function SectionedTable({
    sections,
    rows,
    displayUnit,
    fieldLabels,
}: {
    sections: { title: string; rows: { key: string; label: string; isTotal?: boolean; isGrandTotal?: boolean; isPct?: boolean; indent?: boolean }[]; isPctSection?: boolean }[];
    rows: any[];
    displayUnit: DisplayUnit;
    fieldLabels?: Record<string, string>;
}) {
    if (!rows || rows.length === 0) {
        return <div className="text-center py-8 text-gray-400 text-sm">Không có dữ liệu</div>;
    }

    const sortedRows = [...rows].sort((a, b) => periodSortKey(b) - periodSortKey(a));
    const displayRows = sortedRows.slice(0, 8);

    const getDisplayValue = (row: any, key: string, forcePct?: boolean): string => {
        const v = Number(row[key]);
        if (Number.isNaN(v) || Math.abs(v) < 0.01) return '-';
        if (forcePct) return fmtPct(v);
        const divisor = DISPLAY_UNITS.find(u => u.id === displayUnit)?.divisor ?? 1_000_000;
        return fmt(v / divisor);
    };

    return (
        <div className="overflow-x-auto -mx-4 px-0">
            <table className="w-full text-[13px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-800">
                        <th className="sticky left-0 bg-white dark:bg-[#111827] z-10 text-left py-2.5 px-4 font-medium text-gray-500 dark:text-slate-400 whitespace-nowrap min-w-[180px] text-[12px]">
                            Chỉ tiêu
                        </th>
                        {displayRows.map((row, i) => {
                            const { label, isForecast } = renderPeriod(row);
                            return (
                                <th key={i} className="text-right py-2.5 px-4 font-medium text-gray-500 dark:text-slate-400 whitespace-nowrap min-w-[90px] text-[12px]">
                                    <span className="inline-flex items-center gap-1">
                                        {label}
                                        {isForecast && (
                                            <span className="text-gray-400 cursor-help" title="Dự báo">
                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
                                                </svg>
                                            </span>
                                        )}
                                    </span>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {sections.map((section, sectionIdx) => (
                        <React.Fragment key={sectionIdx}>
                            <tr>
                                <td colSpan={displayRows.length + 1} className="px-4 pt-4 pb-1.5">
                                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{section.title}</span>
                                </td>
                            </tr>
                            {section.rows.map((rowDef, rowIdx) => {
                                const hasData = displayRows.some(r => {
                                    const v = Number(r[rowDef.key]);
                                    return !Number.isNaN(v) && Math.abs(v) > 0.01;
                                });
                                if (!hasData) return null;

                                const isGrandTotal = rowDef.isGrandTotal ?? false;
                                const isTotal = rowDef.isTotal ?? false;
                                const isPct = rowDef.isPct ?? section.isPctSection ?? false;
                                const isIndented = rowDef.indent ?? false;

                                const bgClass = isIndented
                                    ? 'bg-gray-50 dark:bg-slate-800/40'
                                    : 'bg-white dark:bg-[#111827]';

                                return (
                                    <tr
                                        key={`${sectionIdx}-${rowIdx}`}
                                        className={cx(
                                            'border-b border-gray-100 dark:border-slate-800/60',
                                            isGrandTotal ? 'border-t border-gray-300 dark:border-slate-600' : '',
                                        )}
                                    >
                                        <td className={cx(
                                            'sticky left-0 z-10 py-2.5 px-4 whitespace-nowrap',
                                            bgClass,
                                            isGrandTotal ? 'font-semibold text-gray-900 dark:text-white' : '',
                                            isTotal ? 'font-medium text-gray-800 dark:text-slate-100' : '',
                                            !isTotal && !isGrandTotal ? 'text-gray-700 dark:text-slate-300' : '',
                                            isIndented ? 'pl-8 italic text-gray-500 dark:text-slate-400' : '',
                                        )}>
                                            {rowDef.label}
                                        </td>
                                        {displayRows.map((row, i) => (
                                            <td key={i} className={cx(
                                                'text-right py-2.5 px-4 tabular-nums whitespace-nowrap',
                                                bgClass,
                                                isGrandTotal ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-slate-300',
                                            )}>
                                                {getDisplayValue(row, rowDef.key, isPct)}
                                            </td>
                                        ))}
                                    </tr>
                                );
                            })}
                        </React.Fragment>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

// ── Key Stats Table ───────────────────────────────────────────────────────────

function KeyStatsTable({
    metrics,
    overviewData,
    displayUnit,
}: {
    metrics: typeof NORMAL_KEY_METRICS;
    overviewData: any;
    displayUnit: DisplayUnit;
}) {
    if (!overviewData) {
        return <div className="text-center py-8 text-gray-400 text-sm">Không có dữ liệu</div>;
    }

    const divisor = DISPLAY_UNITS.find(u => u.id === displayUnit)?.divisor ?? 1_000_000;

    const getValue = (key: string, isPct?: boolean): string => {
        const v = Number(overviewData[key]);
        if (Number.isNaN(v) || Math.abs(v) < 0.01) return '-';
        if (isPct) return fmtPct(v);
        return fmt(v / divisor);
    };

    const sectionIds = Array.from(new Set(metrics.map(m => m.section)));
    const sectionLabels: Record<string, string> = {
        overview: 'Overview',
        income: 'Income & Margins',
        eps: 'EPS',
        cashflow: 'Cash Flow',
        balance: 'Balance Sheet',
        ratios: 'Ratios',
    };

    return (
        <div className="-mx-4">
            <div className="flex items-center border-b border-gray-100 dark:border-slate-800 px-4 pb-2.5 mb-0">
                <span className="text-[12px] font-medium text-gray-400 dark:text-slate-500 flex-1">Chỉ tiêu</span>
                <span className="text-[12px] font-medium text-gray-400 dark:text-slate-500">Giá trị</span>
            </div>
            {sectionIds.map(sectionId => {
                const sectionMetrics = metrics.filter(m => m.section === sectionId);
                if (sectionMetrics.length === 0) return null;

                return (
                    <React.Fragment key={sectionId}>
                        <div className="px-4 pt-4 pb-1.5">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                {sectionLabels[sectionId]}
                            </span>
                        </div>
                        {sectionMetrics.map((metric) => {
                            const value = getValue(metric.key, metric.isPct);
                            const isIndented = metric.indent ?? false;
                            return (
                                <div
                                    key={metric.key}
                                    className={cx(
                                        'flex items-center justify-between border-b border-gray-100 dark:border-slate-800/60 py-2.5 px-4',
                                        isIndented ? 'bg-gray-50 dark:bg-slate-800/40' : 'bg-white dark:bg-[#111827]',
                                    )}
                                >
                                    <span className={cx(
                                        'text-[13px]',
                                        isIndented
                                            ? 'pl-4 italic text-gray-500 dark:text-slate-400'
                                            : 'text-gray-700 dark:text-slate-300',
                                    )}>
                                        {metric.label}
                                    </span>
                                    <span className={cx(
                                        'text-[13px] tabular-nums',
                                        value === '-' ? 'text-gray-300 dark:text-slate-600' : 'text-gray-800 dark:text-slate-100 font-medium',
                                    )}>
                                        {value}
                                    </span>
                                </div>
                            );
                        })}
                    </React.Fragment>
                );
            })}
        </div>
    );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function FinancialsTab({
    symbol,
    period,
    setPeriod,
    initialChartData,
    initialOverviewData,
    isLoading: parentLoading = false,
    onDownloadExcel,
}: FinancialsTabProps) {
    const [loading, setLoading] = useState(false);
    const [reportLoading, setReportLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<ReportType>('key_stats');
    const [displayMode, setDisplayMode] = useState<DisplayMode>('annual');
    const [displayUnit, setDisplayUnit] = useState<DisplayUnit>('billions');
    const [overviewData, setOverviewData] = useState<any>(null);
    const [reportData, setReportData] = useState({
        income: [],
        balance: [],
        cashflow: [],
        ratios: [],
    });
    const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({});

    const effectivePeriod = period || (displayMode === 'annual' || displayMode === 'ttm' ? 'year' : 'quarter');

    // ── Fetch data ────────────────────────────────────────────────────────────

    useEffect(() => {
        if (initialOverviewData) setOverviewData(initialOverviewData);
    }, [initialOverviewData]);

    // Fetch field labels
    useEffect(() => {
        Promise.allSettled([
            fetch(`/api/financial-report-metrics/${symbol}?type=income`).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=balance`).then(r => r.json()),
            fetch(`/api/financial-report-metrics/${symbol}?type=cashflow`).then(r => r.json()),
        ]).then(([incomeMeta, balanceMeta, cashflowMeta]) => {
            const unwrap = (res: PromiseSettledResult<any>) => {
                if (res.status !== 'fulfilled' || !res.value) return {};
                return res.value.field_map || res.value.field_map_en || {};
            };
            const labels: Record<string, string> = {};
            Object.assign(labels, unwrap(incomeMeta), unwrap(balanceMeta), unwrap(cashflowMeta));
            setFieldLabels(labels);
        }).catch(() => {});
    }, [symbol]);

    // Fetch financial reports
    useEffect(() => {
        const controller = new AbortController();
        setReportLoading(true);

        Promise.allSettled([
            fetch(`/api/financial-report/${symbol}?type=income&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=balance&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=cashflow&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/financial-report/${symbol}?type=ratio&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
        ]).then(([income, balance, cashflow, ratio]) => {
            if (controller.signal.aborted) return;
            const unwrap = (res: PromiseSettledResult<any>) => {
                if (res.status !== 'fulfilled') return [];
                const payload = res.value;
                return Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
            };
            setReportData({
                income: unwrap(income).sort((a: any, b: any) => periodSortKey(b) - periodSortKey(a)),
                balance: unwrap(balance).sort((a: any, b: any) => periodSortKey(b) - periodSortKey(a)),
                cashflow: unwrap(cashflow).sort((a: any, b: any) => periodSortKey(b) - periodSortKey(a)),
                ratios: unwrap(ratio).sort((a: any, b: any) => periodSortKey(b) - periodSortKey(a)),
            });
        }).catch(() => {}).finally(() => {
            if (!controller.signal.aborted) setReportLoading(false);
        });

        return () => controller.abort();
    }, [symbol, effectivePeriod]);

    // ── Render ────────────────────────────────────────────────────────────────

    if (loading || parentLoading) {
        return (
            <div className="flex items-center justify-center p-12">
                <div className="spinner" />
                <span className="ml-3 text-sm text-gray-500">Loading data...</span>
            </div>
        );
    }

    const isBank = isBankStock(symbol, overviewData);
    const activeTabLabel = TABS.find(t => t.id === activeTab)?.label ?? 'Key Stats';
    const periodLabel = displayMode === 'annual' ? 'Năm' : displayMode === 'quarterly' ? 'Quý' : 'TTM';

    return (
        <div className="space-y-3">
            {/* ── Perplexity-style toolbar ─────────────────────────────── */}
            <div className="flex items-center gap-2 flex-wrap">
                {/* Report type pill dropdown */}
                <PillDropdown label={activeTabLabel}>
                    {TABS.map(tab => (
                        <PillDropdownItem
                            key={tab.id}
                            active={activeTab === tab.id}
                            onClick={() => setActiveTab(tab.id)}
                        >
                            {tab.label}
                        </PillDropdownItem>
                    ))}
                </PillDropdown>

                {/* Period pill dropdown */}
                <PillDropdown label={periodLabel}>
                    {([['annual', 'Năm'], ['quarterly', 'Quý'], ['ttm', 'TTM']] as [DisplayMode, string][]).map(([m, lbl]) => (
                        <PillDropdownItem
                            key={m}
                            active={displayMode === m}
                            onClick={() => setDisplayMode(m)}
                        >
                            {lbl}
                        </PillDropdownItem>
                    ))}
                </PillDropdown>

                {/* Settings (units) */}
                <SettingsPopover displayUnit={displayUnit} setDisplayUnit={setDisplayUnit} />

                {/* Download */}
                {onDownloadExcel && (
                    <button
                        onClick={onDownloadExcel}
                        title="Tải Excel"
                        className="flex items-center justify-center w-8 h-8 rounded-full border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-gray-500 dark:text-slate-400 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                    </button>
                )}
            </div>

            {/* ── Content Area ────────────────────────────────────────────── */}
            <div className="bg-white dark:bg-[#111827] rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden py-1">
                {reportLoading ? (
                    <div className="flex items-center justify-center p-12">
                        <div className="spinner" />
                    </div>
                ) : (
                    <>
                        {/* Key Stats */}
                        {activeTab === 'key_stats' && (
                            <KeyStatsTable
                                metrics={isBank ? BANK_KEY_METRICS : NORMAL_KEY_METRICS}
                                overviewData={overviewData}
                                displayUnit={displayUnit}
                            />
                        )}

                        {/* Income Statement */}
                        {activeTab === 'income' && (
                            <SectionedTable
                                sections={isBank ? BANK_INCOME_SECTIONS : INCOME_SECTIONS}
                                rows={reportData.income}
                                displayUnit={displayUnit}
                                fieldLabels={fieldLabels}
                            />
                        )}

                        {/* Balance Sheet */}
                        {activeTab === 'balance' && (
                            <SectionedTable
                                sections={isBank ? BANK_BALANCE_SECTIONS : BALANCE_SECTIONS}
                                rows={reportData.balance}
                                displayUnit={displayUnit}
                                fieldLabels={fieldLabels}
                            />
                        )}

                        {/* Cash Flow */}
                        {activeTab === 'cashflow' && (
                            <SectionedTable
                                sections={isBank ? BANK_CASHFLOW_SECTIONS : CASHFLOW_SECTIONS}
                                rows={reportData.cashflow}
                                displayUnit={displayUnit}
                                fieldLabels={fieldLabels}
                            />
                        )}

                        {/* Ratios */}
                        {activeTab === 'ratios' && (
                            <SectionedTable
                                sections={RATIOS_SECTIONS}
                                rows={reportData.ratios}
                                displayUnit={displayUnit}
                                fieldLabels={fieldLabels}
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
