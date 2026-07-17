'use client';

import React, { useEffect, useState, useRef } from 'react';
import { formatNumber } from '@/lib/api';
import { cx } from '@/lib/utils';
import { useLanguage } from "@/lib/languageContext"
import { translations } from "@/lib/translations"
import { getFieldCodes } from "@/lib/fieldCodesCache"
import ValuationHistoryChart from './ValuationHistoryChart'

// ── Types ─────────────────────────────────────────────────────────────────────

type DisplayMode = 'annual' | 'quarterly';
type ReportType = 'key_stats' | 'income' | 'balance' | 'cashflow' | 'ratios' | 'notes';
type DisplayUnit = 'billions' | 'trillions';

interface FinancialsTabProps {
    symbol: string;
    period?: 'quarter' | 'year';
    setPeriod?: (p: 'quarter' | 'year') => void;
    initialOverviewData?: any;
    onDownloadExcel?: () => void;
}

// ── Tab Configuration ─────────────────────────────────────────────────────────
// TABS and DISPLAY_UNITS are defined inside the component to support i18n

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

// ── Key Metrics Config ────────────────────────────────────────────────────────
// Keys are computed in buildKeyStatsData() — some come from overviewData,
// others are derived from the latest income/balance/cashflow rows.

const NORMAL_KEY_METRICS: { key: string; label: string; section: string; isPct?: boolean; indent?: boolean }[] = [
    { key: 'market_cap',          label: 'Market Cap',          section: 'overview' },
    { key: '_cash',               label: 'Cash',                section: 'overview' },
    { key: '_total_debt',         label: 'Debt',                section: 'overview' },
    { key: '_enterprise_value',   label: 'Enterprise Value',    section: 'overview' },
    { key: '_revenue',            label: 'Revenue',             section: 'income' },
    { key: 'revenue_growth',      label: '% Growth',            isPct: true, indent: true, section: 'income' },
    { key: '_gross_profit',       label: 'Gross Profit',        section: 'income' },
    { key: 'gross_margin',        label: '% Margin',            isPct: true, indent: true, section: 'income' },
    { key: '_net_income',         label: 'Net Income',          section: 'income' },
    { key: 'net_profit_margin',   label: '% Margin',            isPct: true, indent: true, section: 'income' },
    { key: 'eps',                 label: 'EPS',                 section: 'eps' },
    { key: 'profit_growth',       label: '% Growth',            isPct: true, indent: true, section: 'eps' },
    { key: '_operating_cf',       label: 'Operating Cash Flow', section: 'cashflow' },
    { key: '_capex',              label: 'CapEx',               section: 'cashflow' },
    { key: '_free_cash_flow',     label: 'Free Cash Flow',      section: 'cashflow' },
];

const BANK_KEY_METRICS: { key: string; label: string; section: string; isPct?: boolean; indent?: boolean; isMultiple?: boolean }[] = [
    { key: 'market_cap', label: 'Market Cap', section: 'overview' },
    { key: 'enterprise_value', label: 'Enterprise Value', section: 'overview' },
    { key: '_net_income', label: 'Net Income', section: 'income' },
    { key: 'nim', label: 'NIM', isPct: true, section: 'income' },
    { key: 'cir', label: 'CIR (Cost-to-Income)', isPct: true, section: 'income' },
    { key: 'eps', label: 'EPS (TTM)', isMultiple: true, section: 'income' },
    { key: 'profit_growth', label: '  Profit Growth', isPct: true, indent: true, section: 'income' },
    { key: 'casa', label: 'CASA Ratio', isPct: true, section: 'balance' },
    { key: 'npl', label: 'NPL Ratio', isPct: true, section: 'balance' },
    { key: 'ldr', label: 'LDR (Loans/Deposits)', isPct: true, section: 'balance' },
    { key: 'roe', label: 'ROE', isPct: true, section: 'ratios' },
    { key: 'roa', label: 'ROA', isPct: true, section: 'ratios' },
    { key: 'pe', label: 'P/E Ratio', isMultiple: true, section: 'ratios' },
    { key: 'pb', label: 'P/B Ratio', isMultiple: true, section: 'ratios' },
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
            { key: 'pe', label: 'P/E Ratio', isMultiple: true },
            { key: 'price_to_earnings', label: 'P/E Ratio', isMultiple: true },
            { key: 'pb', label: 'P/B Ratio', isMultiple: true },
            { key: 'price_to_book', label: 'P/B Ratio', isMultiple: true },
            { key: 'ps', label: 'P/S Ratio', isMultiple: true },
            { key: 'price_to_sales', label: 'P/S Ratio', isMultiple: true },
            { key: 'pcf', label: 'P/CF Ratio', isMultiple: true },
            { key: 'p_cash_flow', label: 'Price to Cash Flow', isMultiple: true },
            { key: 'price_to_cash_flow', label: 'Price to Cash Flow', isMultiple: true },
            { key: 'ev_to_ebitda', label: 'EV/EBITDA', isMultiple: true },
            { key: 'ev_ebitda', label: 'EV/EBITDA', isMultiple: true },
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
            { key: 'current_ratio', label: 'Current Ratio', isMultiple: true },
            { key: 'quick_ratio', label: 'Quick Ratio', isMultiple: true },
            { key: 'cash_ratio', label: 'Cash Ratio', isMultiple: true },
            { key: 'debt_to_equity', label: 'Debt-to-Equity', isMultiple: true },
            { key: 'debt_equity', label: 'Debt/Equity', isMultiple: true },
            { key: 'financial_leverage', label: 'Financial Leverage', isMultiple: true },
            { key: 'interest_coverage', label: 'Interest Coverage', isMultiple: true },
            { key: 'asset_turnover', label: 'Asset Turnover', isMultiple: true },
            { key: 'inventory_turnover', label: 'Inventory Turnover', isMultiple: true },
            { key: 'receivables_turnover', label: 'Receivables Turnover', isMultiple: true },
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

// ── Notes Section Definitions ─────────────────────────────────────────────────
// Curated subset of noc* (general) and nob* (banking) note fields with labels.

const NORMAL_NOTES_SECTIONS = [
    {
        title: 'Hàng tồn kho',
        rows: [
            { key: 'noc17', label: 'Nguyên liệu, vật liệu' },
            { key: 'noc18', label: 'Công cụ, dụng cụ' },
            { key: 'noc19', label: 'Chi phí SXKD dở dang' },
            { key: 'noc20', label: 'Thành phẩm' },
            { key: 'noc21', label: 'Hàng hóa' },
            { key: 'noc15', label: 'Tổng hàng tồn kho', isTotal: true },
        ],
    },
    {
        title: 'Cơ cấu doanh thu',
        rows: [
            { key: 'noc103', label: 'Doanh thu bán hàng hóa' },
            { key: 'noc104', label: 'Doanh thu cung cấp dịch vụ' },
            { key: 'noc105', label: 'Doanh thu hợp đồng xây dựng' },
            { key: 'noc102', label: 'Tổng doanh thu', isTotal: true },
        ],
    },
    {
        title: 'Chi phí sản xuất theo yếu tố',
        rows: [
            { key: 'noc141', label: 'Chi phí nguyên liệu, vật liệu' },
            { key: 'noc142', label: 'Chi phí nhân công' },
            { key: 'noc143', label: 'Khấu hao TSCĐ' },
            { key: 'noc144', label: 'Chi phí dịch vụ mua ngoài' },
            { key: 'noc145', label: 'Chi phí khác bằng tiền' },
            { key: 'noc140', label: 'Tổng chi phí', isTotal: true },
        ],
    },
    {
        title: 'Doanh thu tài chính',
        rows: [
            { key: 'noc123', label: 'Lãi tiền gửi, tiền cho vay' },
            { key: 'noc125', label: 'Cổ tức, lợi nhuận được chia' },
            { key: 'noc126', label: 'Lãi bán ngoại tệ' },
            { key: 'noc127', label: 'Lãi chênh lệch tỷ giá (đã thực hiện)' },
            { key: 'noc122', label: 'Tổng doanh thu tài chính', isTotal: true },
        ],
    },
    {
        title: 'Chi phí tài chính',
        rows: [
            { key: 'noc132', label: 'Lãi tiền vay' },
            { key: 'noc136', label: 'Lỗ chênh lệch tỷ giá (đã thực hiện)' },
            { key: 'noc131', label: 'Tổng chi phí tài chính', isTotal: true },
        ],
    },
    {
        title: 'Vay dài hạn',
        rows: [
            { key: 'noc94', label: 'Vay ngân hàng' },
            { key: 'noc95', label: 'Vay đối tượng khác' },
            { key: 'noc96', label: 'Trái phiếu phát hành' },
            { key: 'noc97', label: 'Thuê tài chính' },
            { key: 'noc93', label: 'Tổng vay dài hạn', isTotal: true },
        ],
    },
];

const BANK_NOTES_SECTIONS = [
    {
        title: 'Phân loại cho vay theo chất lượng nợ',
        rows: [
            { key: 'nob40', label: 'Nợ đủ tiêu chuẩn (Nhóm 1)' },
            { key: 'nob41', label: 'Nợ cần chú ý (Nhóm 2)' },
            { key: 'nob42', label: 'Nợ dưới tiêu chuẩn (Nhóm 3)' },
            { key: 'nob43', label: 'Nợ nghi ngờ (Nhóm 4)' },
            { key: 'nob44', label: 'Nợ có khả năng mất vốn (Nhóm 5)' },
            { key: 'nob39', label: 'Tổng dư nợ', isTotal: true },
        ],
    },
    {
        title: 'Phân loại cho vay theo kỳ hạn',
        rows: [
            { key: 'nob46', label: 'Cho vay ngắn hạn' },
            { key: 'nob47', label: 'Cho vay trung hạn' },
            { key: 'nob48', label: 'Cho vay dài hạn' },
            { key: 'nob45', label: 'Tổng dư nợ', isTotal: true },
        ],
    },
    {
        title: 'Phân loại tiền gửi khách hàng',
        rows: [
            { key: 'nob66', label: 'Tiền gửi không kỳ hạn (CASA)' },
            { key: 'nob67', label: 'Tiền gửi có kỳ hạn' },
            { key: 'nob68', label: 'Tiền gửi tiết kiệm' },
            { key: 'nob65', label: 'Tổng tiền gửi', isTotal: true },
        ],
    },
    {
        title: 'Thu nhập lãi',
        rows: [
            { key: 'nob88', label: 'Lãi cho vay khách hàng' },
            { key: 'nob89', label: 'Lãi tiền gửi' },
            { key: 'nob90', label: 'Lãi chứng khoán nợ' },
            { key: 'nob87', label: 'Tổng thu nhập lãi', isTotal: true },
        ],
    },
    {
        title: 'Chi phí lãi',
        rows: [
            { key: 'nob96', label: 'Trả lãi tiền gửi' },
            { key: 'nob97', label: 'Trả lãi tiền vay' },
            { key: 'nob98', label: 'Trả lãi trái phiếu' },
            { key: 'nob95', label: 'Tổng chi phí lãi', isTotal: true },
        ],
    },
];

// VCI's field-code dataset does not include English labels for the detailed
// disclosure fields used in the Notes tab (noc* / nob*).
const NOTE_LABELS_EN: Record<string, string> = {
    noc17: 'Raw materials and supplies', noc18: 'Tools and instruments', noc19: 'Work in progress', noc20: 'Finished goods', noc21: 'Merchandise', noc15: 'Total inventories',
    noc103: 'Sales of goods', noc104: 'Service revenue', noc105: 'Construction contract revenue', noc102: 'Total revenue',
    noc141: 'Raw materials and supplies expense', noc142: 'Labour costs', noc143: 'Depreciation expense', noc144: 'External services', noc145: 'Other cash expenses', noc140: 'Total costs',
    noc123: 'Interest income from deposits and loans', noc125: 'Dividends and profit distributions', noc126: 'Gain on sale of foreign currency', noc127: 'Realised foreign exchange gains', noc122: 'Total financial income',
    noc132: 'Interest expense on borrowings', noc136: 'Realised foreign exchange losses', noc131: 'Total financial expenses',
    noc94: 'Bank borrowings', noc95: 'Other borrowings', noc96: 'Bonds issued', noc97: 'Finance lease liabilities', noc93: 'Total long-term borrowings',
    nob40: 'Standard loans (Group 1)', nob41: 'Special-mention loans (Group 2)', nob42: 'Substandard loans (Group 3)', nob43: 'Doubtful loans (Group 4)', nob44: 'Loss loans (Group 5)', nob39: 'Total outstanding loans',
    nob46: 'Short-term loans', nob47: 'Medium-term loans', nob48: 'Long-term loans', nob45: 'Total outstanding loans',
    nob66: 'Demand deposits (CASA)', nob67: 'Term deposits', nob68: 'Savings deposits', nob65: 'Total customer deposits',
    nob88: 'Interest income from customer loans', nob89: 'Interest income from deposits', nob90: 'Interest income from debt securities', nob87: 'Total interest income',
    nob96: 'Interest expense on deposits', nob97: 'Interest expense on borrowings', nob98: 'Interest expense on bonds', nob95: 'Total interest expense',
};

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
    units,
    title,
}: {
    displayUnit: DisplayUnit;
    setDisplayUnit: (u: DisplayUnit) => void;
    units: { id: DisplayUnit; label: string; divisor: number }[];
    title: string;
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
                    <p className="text-[11px] font-semibold text-gray-400 dark:text-slate-500 uppercase tracking-wider mb-2">{title}</p>
                    <div className="space-y-1">
                        {units.map(unit => (
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
    getRowLabel,
    getSectionTitle,
    divisor,
    lang = 'vi',
}: {
    sections: { title: string; rows: { key: string; label: string; isTotal?: boolean; isGrandTotal?: boolean; isPct?: boolean; isMultiple?: boolean; indent?: boolean }[]; isPctSection?: boolean }[];
    rows: any[];
    getRowLabel?: (key: string, fallback: string) => string;
    getSectionTitle?: (rawTitle: string) => string;
    divisor?: number;
    lang?: 'vi' | 'en';
}) {
    if (!rows || rows.length === 0) {
        return <div className="text-center py-8 text-gray-400 text-sm">{lang === 'vi' ? 'Không có dữ liệu' : 'No data available'}</div>;
    }

    const sortedRows = [...rows].sort((a, b) => periodSortKey(b) - periodSortKey(a));
    const displayRows = sortedRows.slice(0, 8);

    const getDisplayValue = (row: any, key: string, forcePct?: boolean, forceMultiple?: boolean): string => {
        const v = Number(row[key]);
        if (Number.isNaN(v)) return '-';
        if (forcePct) {
            if (Math.abs(v) < 0.0001) return '-';
            return fmtPct(v);
        }
        if (forceMultiple) {
            if (Math.abs(v) < 0.001) return '-';
            return v % 1 === 0 ? v.toFixed(0) : v.toFixed(2);
        }
        if (Math.abs(v) < 0.01) return '-';
        const effectiveDivisor = divisor ?? 1_000_000;
        return fmt(v / effectiveDivisor);
    };

    return (
        <div className="overflow-x-auto -mx-4">
            <table className="w-full text-[13px]" style={{ borderCollapse: 'collapse' }}>
                <thead>
                    <tr className="border-b border-gray-100 dark:border-slate-800">
                        <th className="sticky left-0 bg-white dark:bg-[#111827] z-10 text-left py-2.5 px-4 font-medium text-gray-500 dark:text-slate-400 whitespace-nowrap min-w-[180px] text-[12px]">
                            {lang === 'vi' ? 'Chỉ tiêu' : 'Metric'}
                        </th>
                        {displayRows.map((row, i) => {
                            const { label, isForecast } = renderPeriod(row);
                            return (
                                <th key={i} className="text-right py-2.5 px-4 font-medium text-gray-500 dark:text-slate-400 whitespace-nowrap min-w-[90px] text-[12px]">
                                    <span className="inline-flex items-center gap-1">
                                        {label}
                                        {isForecast && (
                                            <span className="text-gray-400 cursor-help" title={lang === 'vi' ? 'Dự báo' : 'Forecast'}>
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
                                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">{getSectionTitle ? getSectionTitle(section.title) : section.title}</span>
                                </td>
                            </tr>
                            {section.rows.map((rowDef, rowIdx) => {
                                const isMultipleRow = (rowDef as any).isMultiple ?? false;
                                const hasData = displayRows.some(r => {
                                    const v = Number(r[rowDef.key]);
                                    return !Number.isNaN(v) && Math.abs(v) > (isMultipleRow ? 0.001 : 0.01);
                                });
                                if (!hasData) return null;

                                const isGrandTotal = rowDef.isGrandTotal ?? false;
                                const isTotal = rowDef.isTotal ?? false;
                                const isPct = rowDef.isPct ?? section.isPctSection ?? false;
                                const isMultiple = (rowDef as any).isMultiple ?? false;
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
                                            {getRowLabel ? getRowLabel(rowDef.key, rowDef.label) : rowDef.label}
                                        </td>
                                        {displayRows.map((row, i) => (
                                            <td key={i} className={cx(
                                                'text-right py-2.5 px-4 tabular-nums whitespace-nowrap',
                                                bgClass,
                                                isGrandTotal ? 'font-semibold text-gray-900 dark:text-white' : 'text-gray-700 dark:text-slate-300',
                                            )}>
                                                {getDisplayValue(row, rowDef.key, isPct, isMultiple)}
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

// ── Ratio visual dashboard ───────────────────────────────────────────────────

type RatioMetric = {
    label: string;
    keys: string[];
    kind: 'percent' | 'multiple';
    description: string;
};

const RATIO_HIGHLIGHTS: RatioMetric[] = [
    { label: 'ROE', keys: ['roe'], kind: 'percent', description: 'Hiệu quả sử dụng vốn chủ sở hữu' },
    { label: 'Biên lợi nhuận ròng', keys: ['net_profit_margin', 'net_margin'], kind: 'percent', description: 'Lợi nhuận giữ lại trên doanh thu' },
    { label: 'P/E', keys: ['pe', 'price_to_earnings'], kind: 'multiple', description: 'Giá thị trường so với lợi nhuận' },
    { label: 'P/B', keys: ['pb', 'price_to_book'], kind: 'multiple', description: 'Giá thị trường so với giá trị sổ sách' },
    { label: 'Nợ / vốn chủ', keys: ['debt_to_equity', 'debt_equity'], kind: 'multiple', description: 'Mức độ sử dụng đòn bẩy tài chính' },
    { label: 'Thanh toán hiện hành', keys: ['current_ratio'], kind: 'multiple', description: 'Khả năng đáp ứng nợ ngắn hạn' },
];

function getRatioValue(row: Record<string, any>, keys: string[]): number | null {
    for (const key of keys) {
        const value = Number(row[key]);
        if (!Number.isNaN(value) && Math.abs(value) > 0.0001) return value;
    }
    return null;
}

function formatRatioHighlight(value: number, kind: RatioMetric['kind']): string {
    return kind === 'percent' ? fmtPct(value) : value.toFixed(value >= 10 ? 1 : 2);
}

function RatioPeriodHistory({ history, kind, recentLabel }: { history: Array<{ value: number; label: string }>; kind: RatioMetric['kind']; recentLabel: string }) {
    const periods = history.slice(-4);
    if (periods.length < 2) return null;
    return (
        <div className="mt-4 border-t border-gray-100 pt-3 dark:border-slate-800">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">{recentLabel}</p>
            <div className="grid grid-cols-4 gap-1.5">
                {periods.map((period, index) => (
                    <div key={`${period.label}-${index}`} className="min-w-0 rounded-md bg-slate-50 px-1.5 py-1.5 text-center dark:bg-slate-800/70">
                        <div className="truncate text-[10px] text-slate-400">{period.label}</div>
                        <div className="mt-0.5 truncate text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">{formatRatioHighlight(period.value, kind)}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function RatioDashboard({
    rows, getRowLabel, getSectionTitle, divisor, lang,
}: {
    rows: any[];
    getRowLabel: (key: string, fallback: string) => string;
    getSectionTitle: (rawTitle: string) => string;
    divisor?: number;
    lang: 'vi' | 'en';
}) {
    const copy = lang === 'vi'
        ? { title: 'Bức tranh tài chính', subtitle: 'Xu hướng các tỷ lệ trọng yếu trong tối đa 8 kỳ gần nhất.', badge: 'Tỷ lệ tài chính', latest: 'Kỳ gần nhất', recent: 'Các kỳ gần đây', show: 'Xem bảng số liệu đầy đủ', hide: 'Ẩn bảng số liệu đầy đủ' }
        : { title: 'Financial snapshot', subtitle: 'Key ratio trends across up to the eight most recent periods.', badge: 'Financial ratios', latest: 'Latest period', recent: 'Recent periods', show: 'View full data table', hide: 'Hide full data table' };
    const ratioText: Record<string, { label: string; description: string }> = lang === 'vi' ? {} : {
        ROE: { label: 'ROE', description: 'Return generated from shareholders’ equity' },
        'Biên lợi nhuận ròng': { label: 'Net profit margin', description: 'Profit retained from revenue' },
        'P/E': { label: 'P/E', description: 'Market price relative to earnings' },
        'P/B': { label: 'P/B', description: 'Market price relative to book value' },
        'Nợ / vốn chủ': { label: 'Debt / equity', description: 'Degree of financial leverage' },
        'Thanh toán hiện hành': { label: 'Current ratio', description: 'Capacity to meet short-term obligations' },
    };
    const sortedRows = [...rows].sort((a, b) => periodSortKey(a) - periodSortKey(b));
    const cards = RATIO_HIGHLIGHTS.map(metric => {
        const history = sortedRows.flatMap(row => {
            const value = getRatioValue(row, metric.keys);
            return value === null ? [] : [{ value, label: renderPeriod(row).label }];
        });
        const current = history[history.length - 1]?.value;
        const previous = history[history.length - 2]?.value;
        return { ...metric, ...(ratioText[metric.label] ?? {}), history, current, change: current !== undefined && previous !== undefined ? current - previous : null };
    }).filter(card => card.current !== undefined);

    if (cards.length === 0) return <SectionedTable sections={RATIOS_SECTIONS} rows={rows} getRowLabel={getRowLabel} getSectionTitle={getSectionTitle} divisor={divisor} lang={lang} />;

    return (
        <div className="py-4">
            <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                    <h3 className="text-[16px] font-semibold text-gray-900 dark:text-white">{copy.title}</h3>
                    <p className="mt-1 text-[12px] text-gray-500 dark:text-slate-400">{copy.subtitle}</p>
                </div>
                <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">{copy.badge}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {cards.map(card => {
                    const isPositive = card.change === null || card.change >= 0;
                    return (
                        <article key={card.label} className="rounded-xl border border-gray-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-700 dark:bg-slate-900/30">
                            <div className="flex items-start justify-between gap-3">
                                <div><h4 className="text-[13px] font-semibold text-gray-800 dark:text-slate-100">{card.label}</h4><p className="mt-0.5 text-[11px] leading-4 text-gray-500 dark:text-slate-400">{card.description}</p></div>
                                {card.change !== null && <span className={cx('rounded-md px-1.5 py-0.5 text-[10px] font-semibold tabular-nums', isPositive ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300')}>{isPositive ? '+' : ''}{formatRatioHighlight(card.change, card.kind)}</span>}
                            </div>
                            <div className="mt-3 flex items-end justify-between gap-4"><strong className="text-[22px] font-semibold tracking-tight tabular-nums text-gray-900 dark:text-white">{formatRatioHighlight(card.current!, card.kind)}</strong><span className="pb-1 text-[10px] text-gray-400">{copy.latest}</span></div>
                            <RatioPeriodHistory history={card.history} kind={card.kind} recentLabel={copy.recent} />
                        </article>
                    );
                })}
            </div>
            <details className="group mt-5 border-t border-gray-100 pt-4 dark:border-slate-800">
                <summary className="cursor-pointer list-none text-[13px] font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400"><span className="group-open:hidden">{copy.show}</span><span className="hidden group-open:inline">{copy.hide}</span></summary>
                <div className="mt-3 -mx-4"><SectionedTable sections={RATIOS_SECTIONS} rows={rows} getRowLabel={getRowLabel} getSectionTitle={getSectionTitle} divisor={divisor} lang={lang} /></div>
            </details>
        </div>
    );
}

// ── Build Key Stats Data ──────────────────────────────────────────────────────
// Merges overviewData (ratios/price) with derived values from the latest
// income / balance / cashflow rows. Keys prefixed with _ are computed here.

function buildKeyStatsData(
    overviewData: any,
    income: any[],
    balance: any[],
    cashflow: any[],
): Record<string, number | null> {
    const inc = income[0] ?? {};
    const bal = balance[0] ?? {};
    const cf  = cashflow[0] ?? {};

    const n = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : null; };

    const cash       = n(bal.bsa2);
    const stDebt     = n(bal.bsa56) ?? 0;
    const ltDebt     = n(bal.bsa71) ?? 0;
    const totalDebt  = stDebt + ltDebt || null;
    const marketCap  = n(overviewData?.market_cap);
    const ev         = (marketCap != null && cash != null && totalDebt != null)
                       ? marketCap - cash + totalDebt : null;

    // Revenue: prefer net sales (isa3), fallback to total sales (isa1)
    const revenue    = n(inc.isa3) ?? n(inc.isa1);
    const grossProfit= n(inc.isa5);
    const netIncome  = n(inc.isa22) ?? n(inc.isa20);
    const opCF       = n(cf.cfa17);
    const capex      = n(cf.cfa18); // usually negative
    const fcf        = (opCF != null && capex != null) ? opCF + capex : null;

    return {
        ...overviewData,
        _cash:             cash,
        _total_debt:       totalDebt,
        _enterprise_value: ev,
        _revenue:          revenue,
        _gross_profit:     grossProfit,
        _net_income:       netIncome,
        _operating_cf:     opCF,
        _capex:            capex,
        _free_cash_flow:   fcf,
    };
}

// ── Key Stats Table ───────────────────────────────────────────────────────────

function KeyStatsTable({
    metrics,
    data,
    getMetricLabel,
    divisor,
}: {
    metrics: typeof NORMAL_KEY_METRICS;
    data: Record<string, any>;
    getMetricLabel?: (key: string, fallback: string) => string;
    divisor?: number;
}) {
    if (!data) {
        return <div className="text-center py-8 text-gray-400 text-sm">Không có dữ liệu</div>;
    }

    const effectiveDivisor = divisor ?? 1_000_000_000;

    const getValue = (key: string, isPct?: boolean, isMultiple?: boolean): string => {
        const v = Number(data[key]);
        if (Number.isNaN(v) || !Number.isFinite(v) || Math.abs(v) < 0.001) return '-';
        if (isPct) return fmtPct(v);
        if (isMultiple) {
            // Ratios, multiples, and per-share amounts: display raw without unit divisor
            return v % 1 === 0
                ? formatNumber(v, { maximumFractionDigits: 0 })
                : v.toFixed(2);
        }
        return fmt(v / effectiveDivisor);
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
        <div>
            <div className="flex items-center border-b border-gray-100 dark:border-slate-800 pb-2.5">
                <span className="text-[12px] font-medium text-gray-400 dark:text-slate-500 flex-1">Chỉ tiêu</span>
                <span className="text-[12px] font-medium text-gray-400 dark:text-slate-500">Giá trị</span>
            </div>
            {sectionIds.map(sectionId => {
                const sectionMetrics = metrics.filter(m => m.section === sectionId);
                if (sectionMetrics.length === 0) return null;

                return (
                    <React.Fragment key={sectionId}>
                        <div className="pt-4 pb-1.5">
                            <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                                {sectionLabels[sectionId]}
                            </span>
                        </div>
                        {sectionMetrics.map((metric) => {
                            const value = getValue(metric.key, metric.isPct, metric.isMultiple);
                            const isIndented = metric.indent ?? false;
                            return (
                                <div
                                    key={metric.key}
                                    className={cx(
                                        'flex items-center justify-between border-b border-gray-100 dark:border-slate-800/60 py-2.5 -mx-4 px-4',
                                        isIndented ? 'bg-gray-50 dark:bg-slate-800/40' : '',
                                    )}
                                >
                                    <span className={cx(
                                        'text-[13px]',
                                        isIndented
                                            ? 'pl-4 italic text-gray-500 dark:text-slate-400'
                                            : 'text-gray-700 dark:text-slate-300',
                                    )}>
                                        {getMetricLabel ? getMetricLabel(metric.key, metric.label) : metric.label}
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
    initialOverviewData,
    onDownloadExcel,
}: FinancialsTabProps) {
    const [reportLoading, setReportLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<ReportType>('ratios');
    // Initialise from parent prop; 'year' maps to 'annual', 'quarter' to 'quarterly'
    const [displayMode, setDisplayModeState] = useState<DisplayMode>(
        period === 'quarter' ? 'quarterly' : 'annual'
    );
    const [displayUnit, setDisplayUnit] = useState<DisplayUnit>('billions');
    const [overviewData, setOverviewData] = useState<any>(null);
    const [reportData, setReportData] = useState({
        income: [],
        balance: [],
        cashflow: [],
        ratios: [],
        notes: [],
    });
    // ── i18n ─────────────────────────────────────────────────────────────────

    const { lang } = useLanguage()
    const tFin = translations[lang].financials

    const TABS: { id: ReportType; label: string }[] = [
        { id: 'income',    label: tFin.tabs.income },
        { id: 'balance',   label: tFin.tabs.balance },
        { id: 'cashflow',  label: tFin.tabs.cashflow },
        { id: 'ratios',    label: tFin.tabs.ratios },
        { id: 'notes',     label: lang === 'vi' ? 'Thuyết minh' : 'Notes' },
    ]

    const DISPLAY_UNITS: { id: DisplayUnit; label: string; divisor: number }[] = [
        { id: 'billions',  label: tFin.units.billions,  divisor: 1_000_000 },
        { id: 'trillions', label: tFin.units.trillions, divisor: 1_000_000_000 },
    ]

    const [fieldMap, setFieldMap] = useState<Record<string, { vi: string; en: string }>>({})

    useEffect(() => {
        getFieldCodes().then(setFieldMap)
    }, [])

    const rowLabel = (key: string, fallback: string): string => {
        if (lang === 'en' && NOTE_LABELS_EN[key]) return NOTE_LABELS_EN[key]
        const entry = fieldMap[key]
        if (!entry) return fallback
        return lang === "vi" ? entry.vi : entry.en
    }

    const metricLabel = (key: string, fallback: string): string => {
        const labels = tFin.keyMetrics as Record<string, string>
        return labels[key] ?? fallback
    }

    const sectionTitle = (rawTitle: string): string => {
        const map: Record<string, keyof typeof tFin.sections> = {
            'Báo cáo kết quả kinh doanh': 'incomeStatement',
            'Income Statement': 'incomeStatement',
            'Kết quả kinh doanh ngân hàng': 'bankIncome',
            'Bank Income Statement': 'bankIncome',
            'Lợi nhuận': 'bankProfit',
            'Profit': 'bankProfit',
            'Margins': 'margins',
            'Biên lợi nhuận': 'margins',
            'Assets': 'assets',
            'Tài sản': 'assets',
            'Liabilities': 'liabilities',
            'Nợ phải trả': 'liabilities',
            'Equity': 'equity',
            'Vốn chủ sở hữu': 'equity',
            'Operating Activities': 'operatingActivities',
            'Hoạt động kinh doanh': 'operatingActivities',
            'Investing Activities': 'investingActivities',
            'Hoạt động đầu tư': 'investingActivities',
            'Financing Activities': 'financingActivities',
            'Hoạt động tài chính': 'financingActivities',
            'Summary': 'summary',
            'Tóm tắt': 'summary',
            'Valuation': 'valuation',
            'Trailing Valuation': 'trailingValuation',
            'Growth Rates': 'growthRates',
            'Profitability': 'profitability',
            'Liquidity': 'liquidity',
            'Leverage': 'leverage',
            'Efficiency': 'efficiency',
        }
        const key = map[rawTitle]
        return key ? tFin.sections[key] : rawTitle
    }

    const notesSectionTitle = (rawTitle: string): string => {
        if (lang === 'vi') return rawTitle
        const labels: Record<string, string> = {
            'Hàng tồn kho': 'Inventories',
            'Cơ cấu doanh thu': 'Revenue breakdown',
            'Chi phí sản xuất theo yếu tố': 'Cost of goods manufactured by factors',
            'Doanh thu tài chính': 'Financial income',
            'Chi phí tài chính': 'Financial expenses',
            'Vay dài hạn': 'Long-term borrowings',
            'Phân loại cho vay theo chất lượng nợ': 'Loan classification by credit quality',
            'Phân loại cho vay theo kỳ hạn': 'Loan classification by tenor',
            'Phân loại tiền gửi khách hàng': 'Customer deposit classification',
            'Thu nhập lãi': 'Interest income',
            'Chi phí lãi': 'Interest expense',
        }
        return labels[rawTitle] ?? rawTitle
    }

    // Keep parent period in sync when user changes mode
    const setDisplayMode = (m: DisplayMode) => {
        setDisplayModeState(m);
        setPeriod?.(m === 'annual' ? 'year' : 'quarter');
    };

    // Source of truth for API calls — no longer overridden by the parent prop
    const effectivePeriod = displayMode === 'annual' ? 'year' : 'quarter';

    // ── Fetch data ────────────────────────────────────────────────────────────

    useEffect(() => {
        if (initialOverviewData) {
            queueMicrotask(() => setOverviewData(initialOverviewData));
        }
    }, [initialOverviewData]);

    // Fetch financial reports
    useEffect(() => {
        const controller = new AbortController();
        queueMicrotask(() => {
            if (!controller.signal.aborted) setReportLoading(true);
        });

        Promise.allSettled([
            fetch(`/api/stock/${symbol}/financial-report?type=income&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/stock/${symbol}/financial-report?type=balance&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/stock/${symbol}/financial-report?type=cashflow&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/stock/${symbol}/financial-report?type=ratio&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
            fetch(`/api/stock/${symbol}/financial-report?type=note&period=${effectivePeriod}&limit=40`, { signal: controller.signal }).then(r => r.json()),
        ]).then(([income, balance, cashflow, ratio, notes]) => {
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
                notes: unwrap(notes).sort((a: any, b: any) => periodSortKey(b) - periodSortKey(a)),
            });
        }).catch(() => {}).finally(() => {
            if (!controller.signal.aborted) setReportLoading(false);
        });

        return () => controller.abort();
    }, [symbol, effectivePeriod]);

    // ── Render ────────────────────────────────────────────────────────────────

    const isBank = isBankStock(symbol, overviewData);
    const activeTabLabel = TABS.find(t => t.id === activeTab)?.label ?? 'Key Stats';
    const periodLabel = displayMode === 'annual' ? (lang === 'vi' ? 'Năm' : 'Year') : (lang === 'vi' ? 'Quý' : 'Quarter');

    return (
        <div className="space-y-3">
            {/* ── Perplexity-style toolbar ─────────────────────────────── */}
            <div className="flex w-full flex-wrap items-center justify-between gap-3">
                <h3 className="text-tremor-title font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                    {lang === 'vi' ? 'Tài chính' : 'Financials'}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
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
                    {([['annual', lang === 'vi' ? 'Năm' : 'Year'], ['quarterly', lang === 'vi' ? 'Quý' : 'Quarter']] as [DisplayMode, string][]).map(([m, lbl]) => (
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
                <SettingsPopover displayUnit={displayUnit} setDisplayUnit={setDisplayUnit} units={DISPLAY_UNITS} title={lang === 'vi' ? 'Đơn vị hiển thị' : 'Display unit'} />

                {/* Download */}
                {onDownloadExcel && (
                    <button
                        onClick={onDownloadExcel}
                        title={lang === 'vi' ? 'Tải Excel' : 'Download Excel'}
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
            </div>

            {/* ── Content Area ────────────────────────────────────────────── */}
            <div className="bg-white dark:bg-[#111827] rounded-xl border border-gray-200 dark:border-slate-800 overflow-hidden px-4 py-1">
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
                                data={buildKeyStatsData(overviewData, reportData.income, reportData.balance, reportData.cashflow)}
                                getMetricLabel={metricLabel}
                                divisor={DISPLAY_UNITS.find(u => u.id === displayUnit)?.divisor}
                            />
                        )}

                        {/* Income Statement */}
                        {activeTab === 'income' && (
                            <SectionedTable
                                sections={isBank ? BANK_INCOME_SECTIONS : INCOME_SECTIONS}
                                rows={reportData.income}
                                getRowLabel={rowLabel}
                                getSectionTitle={sectionTitle}
                                divisor={DISPLAY_UNITS.find(u => u.id === displayUnit)?.divisor}
                                lang={lang}
                            />
                        )}

                        {/* Balance Sheet */}
                        {activeTab === 'balance' && (
                            <SectionedTable
                                sections={isBank ? BANK_BALANCE_SECTIONS : BALANCE_SECTIONS}
                                rows={reportData.balance}
                                getRowLabel={rowLabel}
                                getSectionTitle={sectionTitle}
                                divisor={DISPLAY_UNITS.find(u => u.id === displayUnit)?.divisor}
                                lang={lang}
                            />
                        )}

                        {/* Cash Flow */}
                        {activeTab === 'cashflow' && (
                            <SectionedTable
                                sections={isBank ? BANK_CASHFLOW_SECTIONS : CASHFLOW_SECTIONS}
                                rows={reportData.cashflow}
                                getRowLabel={rowLabel}
                                getSectionTitle={sectionTitle}
                                divisor={DISPLAY_UNITS.find(u => u.id === displayUnit)?.divisor}
                                lang={lang}
                            />
                        )}

                        {/* Ratios */}
                        {activeTab === 'ratios' && (
                            <div className="space-y-5 py-4">
                                <ValuationHistoryChart symbol={symbol} lang={lang} />
                                <RatioDashboard
                                    rows={reportData.ratios}
                                    getRowLabel={rowLabel}
                                    getSectionTitle={sectionTitle}
                                    divisor={DISPLAY_UNITS.find(u => u.id === displayUnit)?.divisor}
                                    lang={lang}
                                />
                            </div>
                        )}

                        {/* Notes (Thuyết minh) */}
                        {activeTab === 'notes' && (
                            <SectionedTable
                                sections={isBank ? BANK_NOTES_SECTIONS : NORMAL_NOTES_SECTIONS}
                                rows={reportData.notes}
                                getRowLabel={rowLabel}
                                getSectionTitle={notesSectionTitle}
                                divisor={DISPLAY_UNITS.find(u => u.id === displayUnit)?.divisor}
                                lang={lang}
                            />
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
