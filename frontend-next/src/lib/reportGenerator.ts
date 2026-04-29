import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { API_BASE } from './api';

// ─── Color constants ─────────────────────────────────────────────────────────
const DARK         = '1E293B';
const ACCENT       = '2563EB';
const LIGHT_BG     = 'EFF6FF';
const HEADER_BG    = 'DBEAFE';
const TOTAL_BG     = 'F1F5F9';
const GRAND_TOTAL_BG = 'E2E8F0';
const INPUT_YLW    = 'FEF9C3';
const GREEN_BG     = 'DCFCE7';
// RED_BG kept for potential future use
// const RED_BG    = 'FEE2E2';

const BORDER_THIN:   ExcelJS.Border = { style: 'thin',   color: { argb: 'CBD5E1' } };
const BORDER_MEDIUM: ExcelJS.Border = { style: 'medium', color: { argb: '64748B' } };

// ─── Style helpers ────────────────────────────────────────────────────────────
function applyBorders(cell: ExcelJS.Cell, type: 'thin' | 'medium' = 'thin') {
    const b = type === 'medium' ? BORDER_MEDIUM : BORDER_THIN;
    cell.border = { top: b, left: b, bottom: b, right: b };
}

function sectionHeader(sheet: ExcelJS.Worksheet, row: number, text: string, cols = 5) {
    sheet.mergeCells(row, 1, row, cols);
    const c = sheet.getCell(row, 1);
    c.value = text;
    c.font = { bold: true, color: { argb: 'FFFFFF' }, size: 11 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
    c.alignment = { horizontal: 'left', indent: 1, vertical: 'middle' };
    sheet.getRow(row).height = 20;
}

function labelValue(sheet: ExcelJS.Worksheet, row: number, label: string, col = 1) {
    const c = sheet.getCell(row, col);
    c.value = label;
    c.font = { color: { argb: '334155' } };
    c.alignment = { horizontal: 'left', indent: 1 };
}

function setNote(sheet: ExcelJS.Worksheet, row: number, note: string, col = 3) {
    const c = sheet.getCell(row, col);
    c.value = note;
    c.font = { italic: true, color: { argb: '94A3B8' }, size: 9 };
}

function toNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizePercentValue(value: unknown): number {
    const n = toNumber(value, 0);
    if (n === 0) return 0;
    return Math.abs(n) > 1 ? n / 100 : n;
}

// Excel column letter helper (1-based)
function colLetter(col: number): string {
    let letter = '';
    let n = col;
    while (n > 0) {
        const rem = (n - 1) % 26;
        letter = String.fromCharCode(65 + rem) + letter;
        n = Math.floor((n - 1) / 26);
    }
    return letter;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface StatementRow {
    key: string;
    label: string;
    indent: number;
    isTotal?: boolean;
    isGrandTotal?: boolean;
    isComputed?: boolean;  // margin / ratio row — italic, separated
    isEPS?: boolean;       // no divide by 1e9
    isFCF?: boolean;       // FCF computed row
}

interface HistoricalData {
    income:   Record<string, unknown>[];
    balance:  Record<string, unknown>[];
    cashflow: Record<string, unknown>[];
    years:    number[];
}

// coord registry: sheetName → field → {col, row}
type CoordRegistry = Record<string, Record<string, { col: number; row: number }>>;

// ─── Row definitions ──────────────────────────────────────────────────────────
const IS_ROWS: StatementRow[] = [
    { key: 'isa1',  label: 'Net Revenue',                      indent: 0, isTotal: true },
    { key: 'isa4',  label: 'Cost of Revenue',                  indent: 1 },
    { key: 'isa5',  label: 'Gross Profit',                     indent: 0, isTotal: true },
    { key: 'isa9',  label: 'Selling Expenses',                 indent: 1 },
    { key: 'isa10', label: 'G&A Expenses',                     indent: 1 },
    { key: 'isa11', label: 'Operating Income (EBIT)',          indent: 0, isTotal: true },
    { key: 'isa8',  label: 'Interest Expense',                 indent: 1 },
    { key: 'isa16', label: 'Pre-tax Income (EBT)',             indent: 0, isTotal: true },
    { key: 'isa19', label: 'Income Tax',                       indent: 1 },
    { key: 'isa20', label: 'Net Income',                       indent: 0, isGrandTotal: true },
    { key: 'isa22', label: 'Net Income (Parent Co.)',          indent: 0, isGrandTotal: true },
    { key: 'isa23', label: 'EPS Basic (VND)',                  indent: 0, isEPS: true },
    // computed margins separated by blank row
    { key: 'gross_margin', label: 'Gross Margin',             indent: 0, isComputed: true },
    { key: 'ebit_margin',  label: 'EBIT Margin',              indent: 0, isComputed: true },
    { key: 'net_margin',   label: 'Net Margin',               indent: 0, isComputed: true },
];

const BS_ROWS: StatementRow[] = [
    // Assets
    { key: 'bsa2',  label: 'Cash & Equivalents',              indent: 1 },
    { key: 'bsa5',  label: 'Short-term Investments',          indent: 1 },
    { key: 'bsa8',  label: 'Accounts Receivable',             indent: 1 },
    { key: 'bsa15', label: 'Inventories',                     indent: 1 },
    { key: 'bsa1',  label: 'Total Current Assets',            indent: 0, isTotal: true },
    { key: 'bsa29', label: 'PP&E (Net)',                      indent: 1 },
    { key: 'bsa43', label: 'Long-term Investments',           indent: 1 },
    { key: 'bsa23', label: 'Total Long-term Assets',          indent: 0, isTotal: true },
    { key: 'bsa53', label: 'Total Assets',                    indent: 0, isGrandTotal: true },
    // Liabilities
    { key: 'bsa56', label: 'Short-term Borrowings',           indent: 1 },
    { key: 'bsa57', label: 'Accounts Payable',                indent: 1 },
    { key: 'bsa55', label: 'Total Current Liabilities',       indent: 0, isTotal: true },
    { key: 'bsa71', label: 'Long-term Borrowings',            indent: 1 },
    { key: 'bsa67', label: 'Total Long-term Liabilities',     indent: 0, isTotal: true },
    { key: 'bsa54', label: 'Total Liabilities',               indent: 0, isGrandTotal: true },
    // Equity
    { key: 'bsa80', label: "Paid-in Capital",                 indent: 1 },
    { key: 'bsa90', label: 'Retained Earnings',               indent: 1 },
    { key: 'bsa78', label: "Owner's Equity",                  indent: 0, isTotal: true },
    { key: 'bsa96', label: 'Total Liabilities + Equity',      indent: 0, isGrandTotal: true },
];

const CF_ROWS: StatementRow[] = [
    { key: 'cfa1',  label: 'Profit Before Tax',               indent: 1 },
    { key: 'cfa2',  label: 'Depreciation & Amortization',     indent: 1 },
    { key: 'cfa18', label: 'Net Operating Cash Flow',         indent: 0, isTotal: true },
    { key: 'cfa19', label: 'Capital Expenditure (CapEx)',      indent: 1 },
    { key: 'cfa26', label: 'Net Investing Cash Flow',         indent: 0, isTotal: true },
    { key: 'cfa29', label: 'Proceeds from Borrowings',        indent: 1 },
    { key: 'cfa30', label: 'Repayment of Borrowings',         indent: 1 },
    { key: 'cfa32', label: 'Dividends Paid',                  indent: 1 },
    { key: 'cfa34', label: 'Net Financing Cash Flow',         indent: 0, isTotal: true },
    { key: 'fcf',   label: 'Free Cash Flow (FCF)',            indent: 0, isFCF: true },
];

// ─── Inputs sheet row map ─────────────────────────────────────────────────────
const I = {
    currentPrice: 7, eps: 8, bvps: 9, pe: 10, pb: 11,
    roe: 12, roa: 13, marketCap: 14, sharesOutstanding: 15,
    revPerShare: 26,
    growthHigh: 19, growthTerminal: 20, ke: 21, wacc: 22, dcfYears: 23,
    peMultiple: 27, pbMultiple: 28, psMultiple: 29,
    fcfe_netIncome: 33, fcfe_depreciation: 34, fcfe_workingCapital: 35,
    fcfe_capex: 36, fcfe_netBorrowing: 37,
    fcff_netIncome: 43, fcff_interestAfterTax: 44, fcff_depreciation: 45,
    fcff_workingCapital: 46, fcff_capex: 47,
    grahamValue: 52,
    wFCFE: 57, wFCFF: 58, wPE: 59, wPB: 60, wGraham: 61, wPS: 62,
};

const PROJ_YEARS = 10;

// ─── Main class ───────────────────────────────────────────────────────────────
export class ReportGenerator {
    private toast: { show?: (msg: string, type: string) => void; hide?: () => void };

    constructor(toastManager?: { show?: (msg: string, type: string) => void; hide?: () => void }) {
        this.toast = toastManager ?? { show: (m, t) => console.log(`[${t}] ${m}`), hide: () => {} };
    }

    private showStatus(message: string, type: 'info' | 'error' | 'success' = 'info') {
        if (this.toast?.show) this.toast.show(message, type);
        else console.log(`[${type.toUpperCase()}] ${message}`);
    }

    // ── Fetch historical statements ──────────────────────────────────────────
    private async fetchHistoricalStatements(symbol: string): Promise<HistoricalData> {
        const fetch3 = async (type: string) => {
            try {
                const resp = await fetch(
                    `/api/financial-report/${symbol}?type=${type}&period=year&limit=7`,
                    { cache: 'no-store' }
                );
                if (!resp.ok) return [];
                const payload = await resp.json();
                const rows: Record<string, unknown>[] = Array.isArray(payload)
                    ? payload
                    : (Array.isArray(payload?.data) ? payload.data : []);
                return rows;
            } catch {
                return [];
            }
        };

        const [income, balance, cashflow] = await Promise.all([
            fetch3('income'),
            fetch3('balance'),
            fetch3('cashflow'),
        ]);

        // Sort ascending by year; take most recent 5
        const sortAsc = (arr: Record<string, unknown>[]) =>
            [...arr].sort((a, b) => toNumber(a.year) - toNumber(b.year));

        const incomeAsc   = sortAsc(income).slice(-5);
        const balanceAsc  = sortAsc(balance).slice(-5);
        const cashflowAsc = sortAsc(cashflow).slice(-5);

        // Build unified year list (use income years as primary)
        const yearsSet = new Set<number>();
        [...incomeAsc, ...balanceAsc, ...cashflowAsc].forEach(r => {
            const y = toNumber(r.year);
            if (y > 0) yearsSet.add(y);
        });
        const years = Array.from(yearsSet).sort((a, b) => a - b).slice(-5);

        return { income: incomeAsc, balance: balanceAsc, cashflow: cashflowAsc, years };
    }

    // ── Fetch single latest row (legacy for Inputs sheet DCF seeding) ────────
    private async fetchLatestFinancialReportRow(
        symbol: string,
        type: 'income' | 'cashflow'
    ): Promise<Record<string, unknown> | null> {
        for (const period of ['quarter', 'year'] as const) {
            try {
                const resp = await fetch(
                    `/api/financial-report/${symbol}?type=${type}&period=${period}&limit=1`,
                    { cache: 'no-store' }
                );
                if (!resp.ok) continue;
                const payload = await resp.json();
                const rows: Record<string, unknown>[] = Array.isArray(payload)
                    ? payload : (Array.isArray(payload?.data) ? payload.data : []);
                if (rows.length > 0) return rows[0];
            } catch { /* try next */ }
        }
        return null;
    }

    // ── Public entry point ───────────────────────────────────────────────────
    async exportReport(
        stockData: Record<string, unknown>,
        valuationResults: Record<string, unknown>,
        assumptions: Record<string, unknown>,
        modelWeights: Record<string, unknown>,
        symbol: string
    ) {
        if (!stockData || !valuationResults) {
            this.showStatus('No data available to export report', 'error');
            return;
        }
        try {
            this.showStatus('Fetching historical financial statements…', 'info');
            const [historical, incomeRow, cashflowRow] = await Promise.all([
                this.fetchHistoricalStatements(symbol),
                this.fetchLatestFinancialReportRow(symbol, 'income'),
                this.fetchLatestFinancialReportRow(symbol, 'cashflow'),
            ]);

            this.showStatus('Building financial model…', 'info');

            const wb = new ExcelJS.Workbook();
            wb.creator = 'quanganh.org';
            wb.created = new Date();
            wb.calcProperties.fullCalcOnLoad = false;

            const noGrid = { views: [{ showGridLines: false }] };

            // Sheet order: Summary first (visible), then statements, then models
            const wsSummary = wb.addWorksheet('Summary',          noGrid);
            const wsIS      = wb.addWorksheet('Income Statement', noGrid);
            const wsBS      = wb.addWorksheet('Balance Sheet',    noGrid);
            const wsCF      = wb.addWorksheet('Cash Flow',        noGrid);
            const wsRatios  = wb.addWorksheet('Key Ratios',       noGrid);
            const wsFCFE    = wb.addWorksheet('FCFE Model',       noGrid);
            const wsFCFF    = wb.addWorksheet('FCFF Model',       noGrid);
            const wsComp    = wb.addWorksheet('Comparables',      noGrid);
            const wsAssump  = wb.addWorksheet('Assumptions',      noGrid);
            const wsPeers   = wb.addWorksheet('Sector Peers',     noGrid);

            // Build financial statement sheets and collect coord registry
            const coordReg: CoordRegistry = {};
            this.createStatementsSheet(wsIS,  IS_ROWS,  historical.income,   historical.years, 'Income Statement',  symbol, coordReg);
            this.createStatementsSheet(wsBS,  BS_ROWS,  historical.balance,  historical.years, 'Balance Sheet',     symbol, coordReg);
            this.createCFSheet(wsCF, historical.cashflow, historical.years, symbol, coordReg);
            this.createKeyRatiosSheet(wsRatios, historical.years, coordReg, symbol);

            // Inputs / Assumptions sheet (yellow cells)
            this.createAssumptionsSheet(
                wsAssump, stockData, valuationResults, assumptions, modelWeights,
                symbol, incomeRow, cashflowRow, historical
            );

            // DCF sheets
            this.buildDCFSheet(wsFCFE, 'FCFE', valuationResults);
            this.buildDCFSheet(wsFCFF, 'FCFF', valuationResults);

            // Comparables (combined P/E + P/B)
            this.createComparablesSheet(wsComp, valuationResults);

            // Summary first sheet
            this.createSummarySheet(wsSummary, stockData, valuationResults, modelWeights, symbol);

            // Sector peers
            this.createSectorPeersSheet(wsPeers, valuationResults);

            // Sheet order is already set by worksheet creation order above

            const buf = await wb.xlsx.writeBuffer();
            const dateStr = new Date().toISOString().split('T')[0];

            // Try R2 raw statements
            let statementsArrayBuffer: ArrayBuffer | null = null;
            try {
                const resp = await fetch(
                    `${API_BASE}/download/${encodeURIComponent(symbol)}?proxy=1`,
                    { cache: 'no-store' }
                );
                if (resp.ok) statementsArrayBuffer = await resp.arrayBuffer();
            } catch { /* optional */ }

            if (statementsArrayBuffer) {
                const zip = new JSZip();
                zip.file(`${symbol}_Valuation_Model_${dateStr}.xlsx`, buf);
                zip.file(`${symbol}_Financial_Statements.xlsx`, statementsArrayBuffer);
                const blob = await zip.generateAsync({ type: 'blob' });
                saveAs(blob, `${symbol}_Valuation_Package_${dateStr}.zip`);
            } else {
                const blob = new Blob([buf], {
                    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                });
                saveAs(blob, `${symbol}_Valuation_Model_${dateStr}.xlsx`);
            }
            this.showStatus('Financial model downloaded!', 'success');

        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error('ReportGenerator error:', err);
            this.showStatus('Error generating report: ' + msg, 'error');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FINANCIAL STATEMENT SHEET BUILDER (IS / BS)
    // ═══════════════════════════════════════════════════════════════════════
    private createStatementsSheet(
        sheet: ExcelJS.Worksheet,
        rows: StatementRow[],
        data: Record<string, unknown>[],
        years: number[],
        title: string,
        symbol: string,
        coordReg: CoordRegistry
    ) {
        const numYears  = years.length;
        const totalCols = 1 + numYears + 1; // label + years + YoY growth

        // Row 1: title
        sheet.mergeCells(1, 1, 1, totalCols);
        const titleCell = sheet.getCell(1, 1);
        titleCell.value = `${title.toUpperCase()} — ${symbol}`;
        titleCell.font  = { bold: true, size: 14, color: { argb: 'FFFFFF' } };
        titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 28;

        // Row 2: unit note
        sheet.mergeCells(2, 1, 2, totalCols);
        const unitCell = sheet.getCell(2, 1);
        unitCell.value = 'Unit: Billion VND (Tỷ đồng)  |  Monetary values ÷ 1,000,000,000';
        unitCell.font  = { italic: true, color: { argb: '64748B' }, size: 9 };
        unitCell.alignment = { horizontal: 'center' };

        // Row 3: blank
        // Row 4: headers
        const HDR_ROW = 4;
        sheet.getCell(HDR_ROW, 1).value = 'Line Item';
        sheet.getCell(HDR_ROW, 1).font = { bold: true };
        sheet.getCell(HDR_ROW, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
        applyBorders(sheet.getCell(HDR_ROW, 1));

        years.forEach((yr, i) => {
            const c = sheet.getCell(HDR_ROW, 2 + i);
            c.value = yr;
            c.font  = { bold: true };
            c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            c.alignment = { horizontal: 'center' };
            applyBorders(c);
        });

        if (numYears >= 2) {
            const yoyC = sheet.getCell(HDR_ROW, 2 + numYears);
            yoyC.value = 'YoY Growth';
            yoyC.font  = { bold: true };
            yoyC.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            yoyC.alignment = { horizontal: 'center' };
            applyBorders(yoyC);
        }
        sheet.getRow(HDR_ROW).height = 18;

        // Build year→data map
        const dataByYear: Record<number, Record<string, unknown>> = {};
        data.forEach(row => {
            const yr = toNumber(row.year);
            if (yr > 0) dataByYear[yr] = row;
        });

        let rowNum = 5;
        const sheetName = title;
        if (!coordReg[sheetName]) coordReg[sheetName] = {};

        let lastComputedBlankInserted = false;

        rows.forEach(rowDef => {
            // Insert blank before first computed row (margins)
            if (rowDef.isComputed && !lastComputedBlankInserted) {
                rowNum++;
                lastComputedBlankInserted = true;
            }

            const labelC = sheet.getCell(rowNum, 1);
            labelC.value = rowDef.label;
            const indentLevel = rowDef.indent ?? 0;
            labelC.alignment = { horizontal: 'left', indent: indentLevel === 0 ? 1 : 2 };

            // Style label based on row type
            if (rowDef.isGrandTotal) {
                labelC.font = { bold: true };
                labelC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAND_TOTAL_BG } };
                applyBorders(labelC, 'medium');
            } else if (rowDef.isTotal) {
                labelC.font = { bold: true };
                labelC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
                applyBorders(labelC);
            } else if (rowDef.isComputed) {
                labelC.font = { italic: true, color: { argb: '475569' } };
                applyBorders(labelC);
            } else {
                applyBorders(labelC);
            }

            years.forEach((yr, i) => {
                const col = 2 + i;
                const c   = sheet.getCell(rowNum, col);
                const yrData = dataByYear[yr] ?? {};
                let rawVal = 0;

                if (rowDef.isComputed) {
                    // Margin computations — use Excel formulas referencing same sheet
                    const reg = coordReg[sheetName];
                    if (rowDef.key === 'gross_margin' && reg['isa5'] && reg['isa1']) {
                        const gpCell  = `${colLetter(reg['isa5'].col)}${reg['isa5'].row}`;
                        const revCell = `${colLetter(reg['isa1'].col)}${reg['isa1'].row}`;
                        // Offset to the correct column
                        const gpC  = `${colLetter(col)}${reg['isa5'].row}`;
                        const revC = `${colLetter(col)}${reg['isa1'].row}`;
                        void gpCell; void revCell;
                        c.value = { formula: `=IF(${revC}<>0,${gpC}/${revC},0)` };
                        c.numFmt = '0.0%';
                    } else if (rowDef.key === 'ebit_margin' && reg['isa11'] && reg['isa1']) {
                        const ebitC = `${colLetter(col)}${reg['isa11'].row}`;
                        const revC  = `${colLetter(col)}${reg['isa1'].row}`;
                        c.value = { formula: `=IF(${revC}<>0,${ebitC}/${revC},0)` };
                        c.numFmt = '0.0%';
                    } else if (rowDef.key === 'net_margin' && reg['isa20'] && reg['isa1']) {
                        const niC  = `${colLetter(col)}${reg['isa20'].row}`;
                        const revC = `${colLetter(col)}${reg['isa1'].row}`;
                        c.value = { formula: `=IF(${revC}<>0,${niC}/${revC},0)` };
                        c.numFmt = '0.0%';
                    } else {
                        c.value = 0;
                        c.numFmt = '0.0%';
                    }
                    c.font = { italic: true, color: { argb: '475569' } };
                    applyBorders(c);
                } else {
                    rawVal = toNumber(yrData[rowDef.key], 0);
                    if (rowDef.isEPS) {
                        c.value = rawVal;
                        c.numFmt = '#,##0';
                    } else {
                        c.value = rawVal / 1e9;
                        c.numFmt = '#,##0.0';
                    }
                    c.alignment = { horizontal: 'right' };
                    if (rowDef.isGrandTotal) {
                        c.font = { bold: true };
                        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRAND_TOTAL_BG } };
                        applyBorders(c, 'medium');
                    } else if (rowDef.isTotal) {
                        c.font = { bold: true };
                        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
                        applyBorders(c);
                    } else {
                        applyBorders(c);
                    }
                    // Register coord for non-computed rows
                    coordReg[sheetName][rowDef.key] = { col, row: rowNum };
                }
            });

            // YoY growth column (last 2 years)
            if (numYears >= 2 && !rowDef.isComputed) {
                const prevCol = 2 + numYears - 2;
                const lastCol = 2 + numYears - 1;
                const yoyCol  = 2 + numYears;
                const prevC = `${colLetter(prevCol)}${rowNum}`;
                const lastC = `${colLetter(lastCol)}${rowNum}`;
                const gc    = sheet.getCell(rowNum, yoyCol);
                if (!rowDef.isEPS) {
                    gc.value  = { formula: `=IF(${prevC}<>0,(${lastC}-${prevC})/ABS(${prevC}),0)` };
                    gc.numFmt = '+0.0%;-0.0%';
                    gc.font   = { color: { argb: '475569' } };
                }
                applyBorders(gc);
            }

            rowNum++;
        });

        // Column widths
        sheet.getColumn(1).width = 36;
        for (let i = 2; i <= 1 + numYears; i++) sheet.getColumn(i).width = 14;
        if (numYears >= 2) sheet.getColumn(2 + numYears).width = 14;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // CASH FLOW SHEET (separate builder to handle FCF computed row)
    // ═══════════════════════════════════════════════════════════════════════
    private createCFSheet(
        sheet: ExcelJS.Worksheet,
        data: Record<string, unknown>[],
        years: number[],
        symbol: string,
        coordReg: CoordRegistry
    ) {
        const numYears  = years.length;
        const totalCols = 1 + numYears + 1;
        const sheetName = 'Cash Flow';
        if (!coordReg[sheetName]) coordReg[sheetName] = {};

        // Row 1 title
        sheet.mergeCells(1, 1, 1, totalCols);
        const titleCell = sheet.getCell(1, 1);
        titleCell.value = `CASH FLOW STATEMENT — ${symbol}`;
        titleCell.font  = { bold: true, size: 14, color: { argb: 'FFFFFF' } };
        titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 28;

        // Row 2 unit
        sheet.mergeCells(2, 1, 2, totalCols);
        const unitCell = sheet.getCell(2, 1);
        unitCell.value = 'Unit: Billion VND (Tỷ đồng)  |  Monetary values ÷ 1,000,000,000';
        unitCell.font  = { italic: true, color: { argb: '64748B' }, size: 9 };
        unitCell.alignment = { horizontal: 'center' };

        // Row 4 headers
        const HDR_ROW = 4;
        sheet.getCell(HDR_ROW, 1).value = 'Line Item';
        sheet.getCell(HDR_ROW, 1).font  = { bold: true };
        sheet.getCell(HDR_ROW, 1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
        applyBorders(sheet.getCell(HDR_ROW, 1));

        years.forEach((yr, i) => {
            const c = sheet.getCell(HDR_ROW, 2 + i);
            c.value = yr;
            c.font  = { bold: true };
            c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            c.alignment = { horizontal: 'center' };
            applyBorders(c);
        });
        if (numYears >= 2) {
            const yoyC = sheet.getCell(HDR_ROW, 2 + numYears);
            yoyC.value = 'YoY Growth';
            yoyC.font  = { bold: true };
            yoyC.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            yoyC.alignment = { horizontal: 'center' };
            applyBorders(yoyC);
        }
        sheet.getRow(HDR_ROW).height = 18;

        const dataByYear: Record<number, Record<string, unknown>> = {};
        data.forEach(row => {
            const yr = toNumber(row.year);
            if (yr > 0) dataByYear[yr] = row;
        });

        let rowNum = 5;
        let fcfBlankInserted = false;

        CF_ROWS.forEach(rowDef => {
            if (rowDef.isFCF && !fcfBlankInserted) {
                rowNum++;
                fcfBlankInserted = true;
            }

            const labelC = sheet.getCell(rowNum, 1);
            labelC.value = rowDef.label;
            labelC.alignment = { horizontal: 'left', indent: rowDef.indent === 0 ? 1 : 2 };

            if (rowDef.isTotal || rowDef.isFCF) {
                labelC.font = { bold: true };
                labelC.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowDef.isFCF ? GREEN_BG : TOTAL_BG } };
                applyBorders(labelC, rowDef.isFCF ? 'medium' : 'thin');
            } else {
                applyBorders(labelC);
            }

            years.forEach((yr, i) => {
                const col    = 2 + i;
                const c      = sheet.getCell(rowNum, col);
                const yrData = dataByYear[yr] ?? {};

                if (rowDef.isFCF) {
                    // FCF = cfa18 + cfa19 (CapEx is negative in source)
                    const reg = coordReg[sheetName];
                    if (reg['cfa18'] && reg['cfa19']) {
                        const opC  = `${colLetter(col)}${reg['cfa18'].row}`;
                        const cxC  = `${colLetter(col)}${reg['cfa19'].row}`;
                        c.value  = { formula: `=${opC}+${cxC}` };
                        c.numFmt = '#,##0.0';
                        c.font   = { bold: true };
                        c.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_BG } };
                        applyBorders(c, 'medium');
                    }
                    coordReg[sheetName]['fcf'] = { col, row: rowNum };
                } else {
                    const rawVal = toNumber(yrData[rowDef.key], 0);
                    c.value     = rawVal / 1e9;
                    c.numFmt    = '#,##0.0';
                    c.alignment = { horizontal: 'right' };
                    if (rowDef.isTotal) {
                        c.font = { bold: true };
                        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTAL_BG } };
                        applyBorders(c);
                    } else {
                        applyBorders(c);
                    }
                    coordReg[sheetName][rowDef.key] = { col, row: rowNum };
                }
            });

            // YoY growth
            if (numYears >= 2 && !rowDef.isFCF) {
                const prevCol = 2 + numYears - 2;
                const lastCol = 2 + numYears - 1;
                const yoyCol  = 2 + numYears;
                const prevC = `${colLetter(prevCol)}${rowNum}`;
                const lastC = `${colLetter(lastCol)}${rowNum}`;
                const gc    = sheet.getCell(rowNum, yoyCol);
                gc.value  = { formula: `=IF(${prevC}<>0,(${lastC}-${prevC})/ABS(${prevC}),0)` };
                gc.numFmt = '+0.0%;-0.0%';
                gc.font   = { color: { argb: '475569' } };
                applyBorders(gc);
            }

            rowNum++;
        });

        sheet.getColumn(1).width = 36;
        for (let i = 2; i <= 1 + numYears; i++) sheet.getColumn(i).width = 14;
        if (numYears >= 2) sheet.getColumn(2 + numYears).width = 14;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // KEY RATIOS SHEET
    // ═══════════════════════════════════════════════════════════════════════
    private createKeyRatiosSheet(
        sheet: ExcelJS.Worksheet,
        years: number[],
        coordReg: CoordRegistry,
        symbol: string
    ) {
        const numYears  = years.length;
        const totalCols = 1 + numYears;
        const isReg  = coordReg['Income Statement'] ?? {};
        const bsReg  = coordReg['Balance Sheet']    ?? {};
        const cfReg  = coordReg['Cash Flow']        ?? {};

        // Title
        sheet.mergeCells(1, 1, 1, totalCols);
        const titleCell = sheet.getCell(1, 1);
        titleCell.value = `KEY FINANCIAL RATIOS — ${symbol}`;
        titleCell.font  = { bold: true, size: 14, color: { argb: 'FFFFFF' } };
        titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 28;

        sheet.mergeCells(2, 1, 2, totalCols);
        const noteCell = sheet.getCell(2, 1);
        noteCell.value = 'All ratios computed via Excel formulas referencing Income Statement, Balance Sheet, and Cash Flow sheets.';
        noteCell.font  = { italic: true, color: { argb: '64748B' }, size: 9 };
        noteCell.alignment = { horizontal: 'center' };

        // Headers row 4
        const HDR_ROW = 4;
        sheet.getCell(HDR_ROW, 1).value = 'Ratio';
        sheet.getCell(HDR_ROW, 1).font  = { bold: true };
        sheet.getCell(HDR_ROW, 1).fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
        applyBorders(sheet.getCell(HDR_ROW, 1));

        years.forEach((yr, i) => {
            const c = sheet.getCell(HDR_ROW, 2 + i);
            c.value = yr;
            c.font  = { bold: true };
            c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            c.alignment = { horizontal: 'center' };
            applyBorders(c);
        });
        sheet.getRow(HDR_ROW).height = 18;

        const mkFml = (fml: string) => ({ formula: fml });

        // Helper: get cell ref for a field in a sheet at a given year index
        const ref = (reg: Record<string, { col: number; row: number }>, field: string, yearIdx: number): string => {
            const entry = reg[field];
            if (!entry) return '0';
            const col = 2 + yearIdx; // data cols start at 2
            return `${colLetter(col)}${entry.row}`;
        };

        interface RatioDef {
            label: string;
            fmt: string;
            section?: boolean;
            formula: (yi: number) => string;
        }

        const ratioRows: RatioDef[] = [
            { label: 'PROFITABILITY', fmt: '', section: true, formula: () => '' },
            {
                label: 'ROE (Return on Equity)',
                fmt: '0.0%',
                formula: (yi) => {
                    const ni  = ref(isReg, 'isa20', yi);
                    const eq  = ref(bsReg, 'bsa78', yi);
                    return `IF('Balance Sheet'!${eq}<>0,'Income Statement'!${ni}/'Balance Sheet'!${eq},0)`;
                }
            },
            {
                label: 'ROA (Return on Assets)',
                fmt: '0.0%',
                formula: (yi) => {
                    const ni = ref(isReg, 'isa20', yi);
                    const ta = ref(bsReg, 'bsa53', yi);
                    return `IF('Balance Sheet'!${ta}<>0,'Income Statement'!${ni}/'Balance Sheet'!${ta},0)`;
                }
            },
            {
                label: 'Gross Margin',
                fmt: '0.0%',
                formula: (yi) => {
                    const gp  = ref(isReg, 'isa5', yi);
                    const rev = ref(isReg, 'isa1', yi);
                    return `IF('Income Statement'!${rev}<>0,'Income Statement'!${gp}/'Income Statement'!${rev},0)`;
                }
            },
            {
                label: 'EBIT Margin',
                fmt: '0.0%',
                formula: (yi) => {
                    const eb  = ref(isReg, 'isa11', yi);
                    const rev = ref(isReg, 'isa1', yi);
                    return `IF('Income Statement'!${rev}<>0,'Income Statement'!${eb}/'Income Statement'!${rev},0)`;
                }
            },
            {
                label: 'Net Margin',
                fmt: '0.0%',
                formula: (yi) => {
                    const ni  = ref(isReg, 'isa20', yi);
                    const rev = ref(isReg, 'isa1', yi);
                    return `IF('Income Statement'!${rev}<>0,'Income Statement'!${ni}/'Income Statement'!${rev},0)`;
                }
            },
            { label: 'LEVERAGE & LIQUIDITY', fmt: '', section: true, formula: () => '' },
            {
                label: 'Debt / Equity',
                fmt: '0.00x',
                formula: (yi) => {
                    const tl = ref(bsReg, 'bsa54', yi);
                    const eq = ref(bsReg, 'bsa78', yi);
                    return `IF('Balance Sheet'!${eq}<>0,'Balance Sheet'!${tl}/'Balance Sheet'!${eq},0)`;
                }
            },
            {
                label: 'Current Ratio',
                fmt: '0.00x',
                formula: (yi) => {
                    const ca = ref(bsReg, 'bsa1',  yi);
                    const cl = ref(bsReg, 'bsa55', yi);
                    return `IF('Balance Sheet'!${cl}<>0,'Balance Sheet'!${ca}/'Balance Sheet'!${cl},0)`;
                }
            },
            {
                label: 'Interest Coverage (x)',
                fmt: '0.00x',
                formula: (yi) => {
                    const eb = ref(isReg, 'isa11', yi);
                    const ie = ref(isReg, 'isa8',  yi);
                    return `IF(ABS('Income Statement'!${ie})>0,'Income Statement'!${eb}/ABS('Income Statement'!${ie}),0)`;
                }
            },
            { label: 'PER-SHARE METRICS', fmt: '', section: true, formula: () => '' },
            {
                label: 'EPS (VND)',
                fmt: '#,##0',
                formula: (yi) => {
                    const eps = ref(isReg, 'isa23', yi);
                    return `'Income Statement'!${eps}`;
                }
            },
            {
                label: 'FCF (Bn VND)',
                fmt: '#,##0.0',
                formula: (yi) => {
                    const fcfEntry = cfReg['fcf'];
                    if (!fcfEntry) return '0';
                    const fcfC = `${colLetter(2 + yi)}${fcfEntry.row}`;
                    return `'Cash Flow'!${fcfC}`;
                }
            },
        ];

        let rowNum = 5;
        ratioRows.forEach(rd => {
            if (rd.section) {
                // Section divider row
                sectionHeader(sheet, rowNum, `  ${rd.label}`, totalCols);
                rowNum++;
                return;
            }

            const labelC = sheet.getCell(rowNum, 1);
            labelC.value = rd.label;
            labelC.alignment = { horizontal: 'left', indent: 1 };
            applyBorders(labelC);

            years.forEach((_yr, yi) => {
                const col = 2 + yi;
                const c   = sheet.getCell(rowNum, col);
                const fmlStr = rd.formula(yi);
                if (fmlStr && fmlStr !== '0') {
                    c.value = mkFml(`=${fmlStr}`);
                } else {
                    c.value = 0;
                }
                c.numFmt    = rd.fmt;
                c.alignment = { horizontal: 'right' };
                applyBorders(c);
            });

            rowNum++;
        });

        sheet.getColumn(1).width = 36;
        for (let i = 2; i <= 1 + numYears; i++) sheet.getColumn(i).width = 14;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ASSUMPTIONS SHEET (replaces old Inputs sheet — yellow editable cells)
    // ═══════════════════════════════════════════════════════════════════════
    private createAssumptionsSheet(
        sheet: ExcelJS.Worksheet,
        stockData: Record<string, unknown>,
        valuationResults: Record<string, unknown>,
        assumptions: Record<string, unknown>,
        modelWeights: Record<string, unknown>,
        symbol: string,
        incomeRow: Record<string, unknown> | null,
        cashflowRow: Record<string, unknown> | null,
        historical: HistoricalData
    ) {
        const set = (row: number, label: string, value: unknown, fmt?: string, note?: string) => {
            labelValue(sheet, row, label);
            const vc  = sheet.getCell(row, 2);
            vc.value  = (value ?? 0) as ExcelJS.CellValue;
            if (fmt) vc.numFmt = fmt;
            applyBorders(vc, 'thin');
            if (note) setNote(sheet, row, note);
        };

        const inputFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_YLW } };
        const setAssumption = (row: number, label: string, value: number, fmt: string, note?: string) => {
            set(row, label, value, fmt, note);
            sheet.getCell(row, 2).fill = inputFill;
        };

        sheet.mergeCells('A1:E1');
        const title = sheet.getCell('A1');
        title.value = `ASSUMPTIONS & INPUTS — ${symbol}`;
        title.font  = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
        title.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        title.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 32;

        sheet.mergeCells('A2:E2');
        sheet.getCell('A2').value = 'Yellow cells are editable assumptions. All model sheets reference this sheet via formulas.';
        sheet.getCell('A2').font  = { italic: true, color: { argb: '64748B' }, size: 9 };
        sheet.getCell('A2').alignment = { horizontal: 'center' };

        // ── Company Data ──────────────────────────────────────────────────
        sectionHeader(sheet, 4, '  COMPANY DATA', 5);
        set(5, 'Symbol',       symbol);
        set(6, 'Company Name', (stockData.companyName as string) ?? (stockData.company_name as string) ?? symbol);

        const exportMarket = ((valuationResults['export'] as Record<string, unknown> | undefined)?.['market'] as Record<string, unknown> | undefined);
        const cp = toNumber(
            exportMarket?.['current_price']
            ?? (valuationResults?.['inputs'] as Record<string, unknown>)?.['current_price']
            ?? stockData.current_price ?? stockData.price ?? stockData.close, 0
        );
        const eps = toNumber(
            (valuationResults?.['inputs'] as Record<string, unknown>)?.['eps_ttm']
            ?? stockData.eps_ttm ?? stockData.eps, 0
        );
        const bvps = toNumber(
            (valuationResults?.['inputs'] as Record<string, unknown>)?.['bvps']
            ?? stockData.bvps ?? stockData.book_value, 0
        );
        const peRatio = toNumber(stockData.pe_ratio ?? stockData.pe ?? stockData.PE, 0);
        const pbRatio = toNumber(stockData.pb_ratio ?? stockData.pb ?? stockData.PB, 0);
        const roePct  = normalizePercentValue(stockData.roe ?? stockData.ROE ?? 0);
        const roaPct  = normalizePercentValue(stockData.roa ?? stockData.ROA ?? 0);
        const marketCapBn = toNumber(stockData.market_cap, 0) > 0
            ? toNumber(stockData.market_cap, 0) / 1e9
            : toNumber(stockData.marketCap, 0) / 1e9;
        const rawShares = toNumber(
            (valuationResults?.['inputs'] as Record<string, unknown>)?.['shares_outstanding']
            ?? stockData.shares_outstanding ?? stockData.shareOutstanding, 0
        );
        const sharesOutstanding = rawShares > 0 && rawShares < 1_000_000
            ? rawShares * 1_000_000 : rawShares;

        set(I.currentPrice,      'Current Market Price (VND)',   cp,               '#,##0',   'Live price');
        set(I.eps,               'EPS TTM (VND)',                eps,              '#,##0',   'Trailing 12-month EPS');
        set(I.bvps,              'BVPS (VND)',                   bvps,             '#,##0',   'Latest quarterly BVPS');
        set(I.pe,                'P/E Ratio (trailing)',         peRatio,          '0.00');
        set(I.pb,                'P/B Ratio (trailing)',         pbRatio,          '0.00');
        set(I.roe,               'ROE (%)',                      roePct,           '0.00%');
        set(I.roa,               'ROA (%)',                      roaPct,           '0.00%');
        set(I.marketCap,         'Market Cap (Billion VND)',     marketCapBn,      '#,##0.0');
        set(I.sharesOutstanding, 'Shares Outstanding',           sharesOutstanding,'#,##0',   'Used for per-share DCF');

        // ── DCF Assumptions ───────────────────────────────────────────────
        sectionHeader(sheet, 16, '  DCF / GROWTH ASSUMPTIONS', 5);
        sheet.mergeCells('A17:E17');
        sheet.getCell('A17').value = 'Highlighted cells below are key assumptions — edit to recalculate all model sheets.';
        sheet.getCell('A17').font  = { italic: true, color: { argb: '92400E' }, size: 9 };

        const a = assumptions ?? {};
        const growthHigh = toNumber(a.revenueGrowth,  0) > 0
            ? toNumber(a.revenueGrowth, 0) / 100
            : toNumber(a.growthRate ?? a.growth_rate ?? 0.08);
        const growthTerm = toNumber(a.terminalGrowth, 0) > 0
            ? toNumber(a.terminalGrowth, 0) / 100
            : toNumber(a.terminalGrowthRate ?? a.terminal_growth_rate ?? 0.03);
        const ke   = toNumber(a.requiredReturn, 0) > 0
            ? toNumber(a.requiredReturn, 0) / 100
            : toNumber(a.ke ?? a.costOfEquity ?? a.discount_rate ?? 0.12);
        const wacc = toNumber(a.wacc, 0) > 0
            ? toNumber(a.wacc, 0) / 100
            : (toNumber(a.WACC, 0) > 0 ? toNumber(a.WACC, 0) / 100 : ke);

        setAssumption(I.growthHigh,    'High-Growth Rate (g₁)',        growthHigh,    '0.00%', 'Applied to Years 1–10');
        setAssumption(I.growthTerminal,'Terminal Growth Rate (gₙ)',     growthTerm,    '0.00%', 'Gordon Growth, perpetuity');
        setAssumption(I.ke,            'Cost of Equity — Ke',          ke,            '0.00%', 'Discount rate for FCFE');
        setAssumption(I.wacc,          'WACC',                         wacc,          '0.00%', 'Discount rate for FCFF');
        setAssumption(I.dcfYears,      'Projection Years',             PROJ_YEARS,    '0',     'Fixed at 10 years');

        // ── Comparable Multiples ──────────────────────────────────────────
        sectionHeader(sheet, 24, '  COMPARABLE VALUATION MULTIPLES', 5);

        const revPerShare = toNumber((valuationResults?.['inputs'] as Record<string, unknown>)?.['rev_per_share'], 0);
        const peUsed = toNumber(
            (((valuationResults?.['export'] as Record<string, unknown>)?.['calculation'] as Record<string, unknown>)?.['justified_pe'] as Record<string, unknown>)?.['pe_used']
            ?? (valuationResults?.['inputs'] as Record<string, unknown>)?.['industry_median_pe_ttm_used'], 0
        );
        const pbUsed = toNumber(
            (((valuationResults?.['export'] as Record<string, unknown>)?.['calculation'] as Record<string, unknown>)?.['justified_pb'] as Record<string, unknown>)?.['pb_used']
            ?? (valuationResults?.['inputs'] as Record<string, unknown>)?.['industry_median_pb_used'], 0
        );
        const psUsed = toNumber(
            (((valuationResults?.['export'] as Record<string, unknown>)?.['calculation'] as Record<string, unknown>)?.['justified_ps'] as Record<string, unknown>)?.['ps_used']
            ?? (valuationResults?.['inputs'] as Record<string, unknown>)?.['industry_median_ps_used'], 0
        );
        const peVal = toNumber((valuationResults?.['valuations'] as Record<string, unknown>)?.['justified_pe'], 0);
        const pbVal = toNumber((valuationResults?.['valuations'] as Record<string, unknown>)?.['justified_pb'], 0);
        const psVal = toNumber((valuationResults?.['valuations'] as Record<string, unknown>)?.['justified_ps'], 0);

        const peMultiple  = peUsed > 0 ? peUsed : ((peVal > 0 && eps > 0)       ? peVal / eps       : toNumber(a.peRatio, 15));
        const pbMultiple  = pbUsed > 0 ? pbUsed : ((pbVal > 0 && bvps > 0)      ? pbVal / bvps      : toNumber(a.pbRatio, 2));
        const psMultiple  = psUsed > 0 ? psUsed : ((psVal > 0 && revPerShare > 0) ? psVal / revPerShare : toNumber(a.psRatio, 3));

        set(I.revPerShare, 'Revenue / Share (VND)', revPerShare, '#,##0', 'Used by P/S valuation');
        setAssumption(I.peMultiple, 'P/E Multiple Used', peMultiple, '0.00', 'Justified or sector median');
        setAssumption(I.pbMultiple, 'P/B Multiple Used', pbMultiple, '0.00', 'Justified or sector median');
        setAssumption(I.psMultiple, 'P/S Multiple Used', psMultiple, '0.00', 'Justified or sector median');

        // ── FCFE Inputs (seeded from latest historical CF) ────────────────
        sectionHeader(sheet, 30, '  FCFE RAW INPUTS (from latest financial statements)', 5);
        sheet.mergeCells('A31:E31');
        sheet.getCell('A31').value = 'Base FCFE = Net Income + D&A − ΔWorking Capital − CapEx + Net Borrowing';
        sheet.getCell('A31').font  = { italic: true, color: { argb: '475569' }, size: 9 };

        // Use latest year from historical if available, else fallback to legacy rows
        const latestCF    = historical.cashflow.length > 0
            ? historical.cashflow[historical.cashflow.length - 1]
            : (cashflowRow ?? {});
        const latestIncome = historical.income.length > 0
            ? historical.income[historical.income.length - 1]
            : (incomeRow ?? {});

        const fcfeNetIncome = toNumber(latestIncome['isa22'] ?? latestIncome['isa20'], 0);
        const fcfeDepr      = toNumber(latestCF['cfa2'], 0);
        const fcfeCapex     = Math.abs(toNumber(latestCF['cfa19'], 0));
        const fcfeNB        = toNumber(latestCF['cfa29'], 0) + toNumber(latestCF['cfa30'], 0);
        const cfaPeriodLabel = latestCF['year'] ? `Year ${latestCF['year']}` : '';

        set(I.fcfe_netIncome,     'Net Income (Bn VND)',                    fcfeNetIncome / 1e9, '#,##0.00', cfaPeriodLabel);
        set(I.fcfe_depreciation,  'Depreciation & Amortisation (Bn VND)',   fcfeDepr / 1e9,      '#,##0.00');
        set(I.fcfe_workingCapital,'ΔWorking Capital Investment (Bn VND)',   0,                   '#,##0.00');
        set(I.fcfe_capex,         'Capital Expenditure / CapEx (Bn VND)',    fcfeCapex / 1e9,     '#,##0.00');
        set(I.fcfe_netBorrowing,  'Net Borrowing (Bn VND)',                  fcfeNB / 1e9,        '#,##0.00');

        // ── FCFF Inputs ───────────────────────────────────────────────────
        sectionHeader(sheet, 40, '  FCFF RAW INPUTS (from latest financial statements)', 5);
        sheet.mergeCells('A41:E41');
        sheet.getCell('A41').value = 'Base FCFF = Net Income + Interest×(1−t) + D&A − ΔWorking Capital − CapEx';
        sheet.getCell('A41').font  = { italic: true, color: { argb: '475569' }, size: 9 };

        const taxRatePercent   = toNumber(assumptions?.taxRate, 20);
        const taxRate          = Math.max(0, Math.min(1, taxRatePercent / 100));
        const fcffInterestExp  = Math.abs(toNumber(cashflowRow?.['interest_expense_paid'], 0));
        const fcffInterestAT   = fcffInterestExp * (1 - taxRate);

        set(I.fcff_netIncome,      'Net Income (Bn VND)',                   fcfeNetIncome / 1e9,  '#,##0.00');
        set(I.fcff_interestAfterTax,'Interest × (1 − Tax) (Bn VND)',       fcffInterestAT / 1e9, '#,##0.00');
        set(I.fcff_depreciation,   'Depreciation & Amortisation (Bn VND)', fcfeDepr / 1e9,       '#,##0.00');
        set(I.fcff_workingCapital, 'ΔWorking Capital (Bn VND)',             0,                    '#,##0.00');
        set(I.fcff_capex,          'Capital Expenditure / CapEx (Bn VND)',  fcfeCapex / 1e9,      '#,##0.00');

        // ── Graham ────────────────────────────────────────────────────────
        sectionHeader(sheet, 49, '  GRAHAM FORMULA VALUE', 5);
        sheet.getCell('A50').value = 'Graham Intrinsic Value = √( 22.5 × EPS × BVPS )';
        sheet.getCell('A50').font  = { italic: true, color: { argb: '475569' }, size: 9 };
        const grahamVal = toNumber((valuationResults?.['valuations'] as Record<string, unknown>)?.['graham'], 0);
        set(I.grahamValue, 'Graham Value (VND)', grahamVal, '#,##0', 'Computed by backend');

        // ── Model Weights ─────────────────────────────────────────────────
        sectionHeader(sheet, 53, '  MODEL WEIGHTS (%)', 5);
        sheet.mergeCells('A54:E54');
        sheet.getCell('A54').value = 'Weights must sum to 100. Used in Summary weighted average formula.';
        sheet.getCell('A54').font  = { italic: true, color: { argb: '92400E' }, size: 9 };

        const wt = modelWeights ?? {};
        setAssumption(I.wFCFE,  'FCFE Weight (%)',   toNumber(wt.fcfe  ?? wt.FCFE  ?? 25), '0.00');
        setAssumption(I.wFCFF,  'FCFF Weight (%)',   toNumber(wt.fcff  ?? wt.FCFF  ?? 25), '0.00');
        setAssumption(I.wPE,    'P/E Weight (%)',    toNumber(wt.justified_pe ?? wt.pe ?? wt.PE ?? 20), '0.00');
        setAssumption(I.wPB,    'P/B Weight (%)',    toNumber(wt.justified_pb ?? wt.pb ?? wt.PB ?? 20), '0.00');
        setAssumption(I.wGraham,'Graham Weight (%)', toNumber(wt.graham ?? wt.Graham ?? 10), '0.00');
        setAssumption(I.wPS,    'P/S Weight (%)',    toNumber(wt.justified_ps ?? wt.ps ?? wt.PS ?? 10), '0.00');

        const sumRow = I.wPS + 1;
        sheet.getCell(sumRow, 1).value = 'Sum of Weights (must = 100)';
        sheet.getCell(sumRow, 1).font  = { bold: true };
        sheet.getCell(sumRow, 2).value = {
            formula: `=B${I.wFCFE}+B${I.wFCFF}+B${I.wPE}+B${I.wPB}+B${I.wGraham}+B${I.wPS}`
        };
        sheet.getCell(sumRow, 2).numFmt = '0.00';
        sheet.getCell(sumRow, 2).font   = { bold: true };
        applyBorders(sheet.getCell(sumRow, 2), 'medium');

        sheet.getColumn(1).width = 44;
        sheet.getColumn(2).width = 22;
        sheet.getColumn(3).width = 36;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DCF SHEET (FCFE or FCFF)  — shared builder, references Assumptions sheet
    // Note: sheet is named 'FCFE Model' or 'FCFF Model', cross-refs use 'Assumptions'
    // ═══════════════════════════════════════════════════════════════════════
    private buildDCFSheet(sheet: ExcelJS.Worksheet, type: 'FCFE' | 'FCFF', valuationResults: Record<string, unknown>) {
        const isFCFE    = type === 'FCFE';
        const detailsData = isFCFE
            ? (valuationResults?.['fcfe_details'] as Record<string, unknown>)
            : (valuationResults?.['fcff_details'] as Record<string, unknown>);
        const rateRow   = isFCFE ? I.ke   : I.wacc;
        const niRow     = isFCFE ? I.fcfe_netIncome    : I.fcff_netIncome;
        const depRow    = isFCFE ? I.fcfe_depreciation : I.fcff_depreciation;
        const wcRow     = isFCFE ? I.fcfe_workingCapital : I.fcff_workingCapital;
        const cxRow     = isFCFE ? I.fcfe_capex        : I.fcff_capex;
        const label     = isFCFE ? 'FREE CASH FLOW TO EQUITY (FCFE)' : 'FREE CASH FLOW TO FIRM (FCFF)';
        const rateLabel = isFCFE ? 'Cost of Equity — Ke' : 'WACC';

        // Title
        sheet.mergeCells('A1:F1');
        const t = sheet.getCell('A1');
        t.value = `${label} — DISCOUNTED CASH FLOW MODEL`;
        t.font  = { bold: true, size: 15, color: { argb: 'FFFFFF' } };
        t.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 30;

        sheet.mergeCells('A2:F2');
        sheet.getCell('A2').value = 'Formulas reference the Assumptions sheet. To change assumptions, edit yellow cells in Assumptions.';
        sheet.getCell('A2').font  = { italic: true, color: { argb: '64748B' }, size: 9 };
        sheet.getCell('A2').alignment = { horizontal: 'center' };

        // STEP 1: Base Cash Flow
        sectionHeader(sheet, 4, `  STEP 1: BASE YEAR ${type} CALCULATION`, 6);

        const compRows: [string, string, string][] = isFCFE ? [
            ['Net Income (Bn VND)',                 `=Assumptions!B${niRow}`,  '(+) from income statement'],
            ['Depreciation & Amortisation (Bn VND)',`=Assumptions!B${depRow}`, '(+) non-cash charge added back'],
            ['ΔWorking Capital Investment (Bn VND)', `=Assumptions!B${wcRow}`,  '(−) increase in working capital'],
            ['Capital Expenditure (Bn VND)',          `=Assumptions!B${cxRow}`,  '(−) investment in fixed assets'],
            ['Net Borrowing (Bn VND)',               `=Assumptions!B${I.fcfe_netBorrowing}`, '(+) new debt minus repayments'],
        ] : [
            ['Net Income (Bn VND)',                  `=Assumptions!B${niRow}`,  '(+) from income statement'],
            ['Interest × (1 − Tax) (Bn VND)',        `=Assumptions!B${I.fcff_interestAfterTax}`, '(+) after-tax interest cost'],
            ['Depreciation & Amortisation (Bn VND)', `=Assumptions!B${depRow}`, '(+) non-cash charge added back'],
            ['ΔWorking Capital Investment (Bn VND)', `=Assumptions!B${wcRow}`,  '(−) increase in working capital'],
            ['Capital Expenditure (Bn VND)',           `=Assumptions!B${cxRow}`,  '(−) investment in fixed assets'],
        ];

        let r = 5;
        ['Component', 'Amount (Bn VND)', 'Note'].forEach((h, ci) => {
            const c = sheet.getCell(r, ci + 1);
            c.value = h;
            c.font  = { bold: true };
            c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            applyBorders(c);
        });
        r++;

        const compStartRow = r;
        compRows.forEach(([lbl, formula, note]) => {
            sheet.getCell(r, 1).value = lbl;
            const vc = sheet.getCell(r, 2);
            vc.value = { formula };
            vc.numFmt = '#,##0.00';
            applyBorders(vc);
            sheet.getCell(r, 3).value = note;
            sheet.getCell(r, 3).font  = { italic: true, color: { argb: '94A3B8' }, size: 9 };
            r++;
        });

        const sharesRow = r;
        sheet.getCell(r, 1).value = 'Shares Outstanding (for per-share conversion)';
        const sharesCell = sheet.getCell(r, 2);
        sharesCell.value  = { formula: `=Assumptions!B${I.sharesOutstanding}` };
        sharesCell.numFmt = '#,##0';
        applyBorders(sharesCell);
        r++;

        sheet.getCell(r, 1).value = '─'.repeat(60);
        sheet.getCell(r, 1).font  = { color: { argb: 'CBD5E1' } };
        r++;

        // Base FCF per share
        const baseRow = r;
        let baseFml: string;
        if (isFCFE) {
            baseFml = `=(B${compStartRow}+B${compStartRow+1}-B${compStartRow+2}-B${compStartRow+3}+B${compStartRow+4})*1000000000/IF(B${sharesRow}>0,B${sharesRow},1)`;
        } else {
            baseFml = `=(B${compStartRow}+B${compStartRow+1}+B${compStartRow+2}-B${compStartRow+3}-B${compStartRow+4})*1000000000/IF(B${sharesRow}>0,B${sharesRow},1)`;
        }
        sheet.getCell(r, 1).value = `Base ${type} Per Share (Year 0, VND)`;
        sheet.getCell(r, 1).font  = { bold: true };
        const baseCell = sheet.getCell(r, 2);
        const baseCached = detailsData?.['baseFCFE'] ?? detailsData?.['baseFCFF'];
        baseCell.value  = baseCached != null
            ? { formula: baseFml, result: toNumber(baseCached) }
            : { formula: baseFml };
        baseCell.numFmt = '#,##0';
        baseCell.font   = { bold: true };
        baseCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(baseCell, 'medium');
        r += 2;

        // STEP 2: Discount Rate
        sectionHeader(sheet, r, '  STEP 2: DISCOUNT RATE & GROWTH ASSUMPTIONS', 6);
        r++;

        const discRateRow = r;
        sheet.getCell(r, 1).value = rateLabel;
        sheet.getCell(r, 1).font  = { bold: true };
        const drCell = sheet.getCell(r, 2);
        drCell.value  = { formula: `=Assumptions!B${rateRow}` };
        drCell.numFmt = '0.00%';
        drCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(drCell);
        sheet.getCell(r, 3).value = '← edit in Assumptions sheet';
        sheet.getCell(r, 3).font  = { italic: true, color: { argb: '94A3B8' }, size: 9 };
        r++;

        const growthHighRow = r;
        sheet.getCell(r, 1).value = 'High-Growth Rate (g₁) — Years 1–10';
        const ghCell = sheet.getCell(r, 2);
        ghCell.value  = { formula: `=Assumptions!B${I.growthHigh}` };
        ghCell.numFmt = '0.00%';
        ghCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(ghCell);
        r++;

        const growthTermRow = r;
        sheet.getCell(r, 1).value = 'Terminal Growth Rate (gₙ) — Perpetuity';
        const gtCell = sheet.getCell(r, 2);
        gtCell.value  = { formula: `=Assumptions!B${I.growthTerminal}` };
        gtCell.numFmt = '0.00%';
        gtCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(gtCell);
        r += 2;

        // STEP 3: Projection Table
        sectionHeader(sheet, r, '  STEP 3: 10-YEAR CASH FLOW PROJECTIONS', 6);
        r++;

        ['Year', `Projected ${type} (VND)`, 'Formula Note', 'Discount Factor', 'PV of Cash Flow (VND)', 'Cumulative PV'].forEach((h, ci) => {
            const c = sheet.getCell(r, ci + 1);
            c.value = h;
            c.font  = { bold: true };
            c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            c.alignment = { horizontal: 'center' };
            applyBorders(c);
        });
        r++;

        const projDataStart = r;
        for (let yr = 1; yr <= PROJ_YEARS; yr++) {
            sheet.getCell(r, 1).value = yr;
            sheet.getCell(r, 1).alignment = { horizontal: 'center' };
            applyBorders(sheet.getCell(r, 1));

            const fcfCell = sheet.getCell(r, 2);
            fcfCell.value  = { formula: `=B${baseRow}*(1+B${growthHighRow})^A${r}` };
            fcfCell.numFmt = '#,##0';
            applyBorders(fcfCell);

            sheet.getCell(r, 3).value = `BaseFCF × (1+g₁)^${yr}`;
            sheet.getCell(r, 3).font  = { color: { argb: '64748B' }, size: 9, italic: true };

            const dfCell = sheet.getCell(r, 4);
            dfCell.value  = { formula: `=1/(1+B${discRateRow})^A${r}` };
            dfCell.numFmt = '0.0000';
            applyBorders(dfCell);

            const pvCell = sheet.getCell(r, 5);
            pvCell.value  = { formula: `=B${r}*D${r}` };
            pvCell.numFmt = '#,##0';
            applyBorders(pvCell);
            if (yr % 2 === 0) pvCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };

            const cumCell = sheet.getCell(r, 6);
            cumCell.value  = { formula: yr === 1 ? `=E${r}` : `=F${r-1}+E${r}` };
            cumCell.numFmt = '#,##0';
            cumCell.font   = { color: { argb: '475569' } };
            applyBorders(cumCell);
            r++;
        }

        const projDataEnd = r - 1;
        r += 1;

        // STEP 4: Terminal Value
        sectionHeader(sheet, r, '  STEP 4: TERMINAL VALUE (Gordon Growth Model)', 6);
        r++;

        const tvRow = r;
        sheet.getCell(r, 1).value = `Terminal-Year ${type} (Year ${PROJ_YEARS + 1})`;
        sheet.getCell(r, 3).value = `= Year ${PROJ_YEARS} FCF × (1 + gₙ)`;
        sheet.getCell(r, 3).font  = { italic: true, color: { argb: '64748B' }, size: 9 };
        const tvYearCell = sheet.getCell(r, 2);
        tvYearCell.value  = { formula: `=B${projDataEnd}*(1+B${growthTermRow})` };
        tvYearCell.numFmt = '#,##0';
        applyBorders(tvYearCell);
        r++;

        const tvGGRow = r;
        sheet.getCell(r, 1).value = 'Terminal Value (Gordon Growth)';
        sheet.getCell(r, 3).value = `= TV Year FCF ÷ (${rateLabel} − gₙ)`;
        sheet.getCell(r, 3).font  = { italic: true, color: { argb: '64748B' }, size: 9 };
        const tvGGCell = sheet.getCell(r, 2);
        tvGGCell.value  = { formula: `=B${tvRow}/(B${discRateRow}-B${growthTermRow})` };
        tvGGCell.numFmt = '#,##0';
        applyBorders(tvGGCell);
        r++;

        const pvTvRow = r;
        sheet.getCell(r, 1).value = 'PV of Terminal Value';
        sheet.getCell(r, 3).value = `= TV ÷ (1 + ${rateLabel})^${PROJ_YEARS}`;
        sheet.getCell(r, 3).font  = { italic: true, color: { argb: '64748B' }, size: 9 };
        const pvTvCell = sheet.getCell(r, 2);
        pvTvCell.value  = { formula: `=B${tvGGRow}/(1+B${discRateRow})^${PROJ_YEARS}` };
        pvTvCell.numFmt = '#,##0';
        pvTvCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(pvTvCell, 'medium');
        r += 2;

        // STEP 5: Intrinsic Value
        sectionHeader(sheet, r, `  STEP 5: INTRINSIC VALUE PER SHARE — ${type}`, 6);
        r++;

        const sumPVRow = r;
        sheet.getCell(r, 1).value = 'Sum of PV (Cash Flows, Years 1–10)';
        const sumPVCell = sheet.getCell(r, 2);
        sumPVCell.value  = { formula: `=SUM(E${projDataStart}:E${projDataEnd})` };
        sumPVCell.numFmt = '#,##0';
        applyBorders(sumPVCell);
        r++;

        const pvTvRefRow = r;
        sheet.getCell(r, 1).value = 'PV of Terminal Value';
        const pvTvRefCell = sheet.getCell(r, 2);
        pvTvRefCell.value  = { formula: `=B${pvTvRow}` };
        pvTvRefCell.numFmt = '#,##0';
        applyBorders(pvTvRefCell);
        r++;

        sheet.getCell(r, 1).value = '─'.repeat(60);
        sheet.getCell(r, 1).font  = { color: { argb: 'CBD5E1' } };
        r++;

        const intrinsicRow = r;
        sheet.getCell(r, 1).value = `★  INTRINSIC VALUE — ${type} (VND per share)`;
        sheet.getCell(r, 1).font  = { bold: true, size: 12, color: { argb: ACCENT } };
        const intrinsicCell = sheet.getCell(r, 2);
        const intrinsicCached = isFCFE
            ? (valuationResults?.['valuations'] as Record<string, unknown>)?.['fcfe'] ?? detailsData?.['shareValue']
            : (valuationResults?.['valuations'] as Record<string, unknown>)?.['fcff'] ?? detailsData?.['shareValue'];
        intrinsicCell.value = intrinsicCached != null
            ? toNumber(intrinsicCached)
            : { formula: `=B${sumPVRow}+B${pvTvRefRow}` };
        intrinsicCell.numFmt = '#,##0';
        intrinsicCell.font   = { bold: true, size: 13, color: { argb: ACCENT } };
        intrinsicCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(intrinsicCell, 'medium');
        r++;

        sheet.getCell(r, 1).value = 'Current Price (VND)';
        const cpCell = sheet.getCell(r, 2);
        cpCell.value  = { formula: `=Assumptions!B${I.currentPrice}` };
        cpCell.numFmt = '#,##0';
        applyBorders(cpCell);
        r++;

        sheet.getCell(r, 1).value = 'Upside / Downside';
        sheet.getCell(r, 1).font  = { bold: true };
        const upCell = sheet.getCell(r, 2);
        upCell.value  = { formula: `=(B${intrinsicRow}-B${r-1})/B${r-1}` };
        upCell.numFmt = '+0.00%;-0.00%';
        upCell.font   = { bold: true };
        applyBorders(upCell, 'medium');

        sheet.getColumn(1).width = 42;
        sheet.getColumn(2).width = 24;
        sheet.getColumn(3).width = 28;
        sheet.getColumn(4).width = 16;
        sheet.getColumn(5).width = 24;
        sheet.getColumn(6).width = 24;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // COMPARABLES SHEET (P/E section + P/B section on same sheet)
    // ═══════════════════════════════════════════════════════════════════════
    private createComparablesSheet(sheet: ExcelJS.Worksheet, valuationResults: Record<string, unknown>) {
        sheet.mergeCells('A1:H1');
        const t = sheet.getCell('A1');
        t.value = 'COMPARABLE VALUATION — P/E & P/B ANALYSIS';
        t.font  = { bold: true, size: 15, color: { argb: 'FFFFFF' } };
        t.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 30;

        sheet.mergeCells('A2:H2');
        sheet.getCell('A2').value = 'Fair Value = Metric × Multiple  |  All inputs reference Assumptions sheet';
        sheet.getCell('A2').font  = { italic: true, color: { argb: '64748B' }, size: 9 };
        sheet.getCell('A2').alignment = { horizontal: 'center' };

        // Section 1: P/E Analysis (rows 4–21)
        this.buildMultipleSectionOnSheet(sheet, 'PE', valuationResults, 4);

        // Section 2: P/B Analysis (rows 23–40)
        this.buildMultipleSectionOnSheet(sheet, 'PB', valuationResults, 23);

        sheet.getColumn(1).width = 26;
        for (let ci = 2; ci <= 8; ci++) sheet.getColumn(ci).width = 16;
    }

    private buildMultipleSectionOnSheet(
        sheet: ExcelJS.Worksheet,
        type: 'PE' | 'PB',
        valuationResults: Record<string, unknown>,
        startRow: number
    ) {
        const isPE         = type === 'PE';
        const label        = isPE ? 'P/E' : 'P/B';
        const metricLabel  = isPE ? 'EPS TTM (VND)' : 'BVPS (VND)';
        const baseMetricRow = isPE ? I.eps   : I.bvps;
        const multipleRow  = isPE ? I.peMultiple : I.pbMultiple;

        let r = startRow;
        sectionHeader(sheet, r, `  ${label} ANALYSIS`, 8);
        r++;

        // Inputs
        sheet.getCell(r, 1).value = metricLabel;
        sheet.getCell(r, 1).font  = { bold: true };
        const metCell = sheet.getCell(r, 2);
        metCell.value  = { formula: `=Assumptions!B${baseMetricRow}` };
        metCell.numFmt = '#,##0';
        metCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(metCell);
        const metricInputRow = r;
        r++;

        sheet.getCell(r, 1).value = `${label} Multiple Applied`;
        sheet.getCell(r, 1).font  = { bold: true };
        const multCell = sheet.getCell(r, 2);
        multCell.value  = { formula: `=Assumptions!B${multipleRow}` };
        multCell.numFmt = '0.00';
        multCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: INPUT_YLW } };
        applyBorders(multCell, 'medium');
        sheet.getCell(r, 3).value = '← edit in Assumptions sheet';
        sheet.getCell(r, 3).font  = { italic: true, color: { argb: '94A3B8' }, size: 9 };
        const multipleInputRow = r;
        r++;

        // Fair Value
        sheet.getCell(r, 1).value = `★  FAIR VALUE — ${label} (VND/share)`;
        sheet.getCell(r, 1).font  = { bold: true, size: 11, color: { argb: ACCENT } };
        const fairCell = sheet.getCell(r, 2);
        const fairCached = isPE
            ? toNumber((valuationResults?.['valuations'] as Record<string, unknown>)?.['justified_pe'], 0)
            : toNumber((valuationResults?.['valuations'] as Record<string, unknown>)?.['justified_pb'], 0);
        fairCell.value  = fairCached > 0
            ? { formula: `=B${metricInputRow}*B${multipleInputRow}`, result: fairCached }
            : { formula: `=B${metricInputRow}*B${multipleInputRow}` };
        fairCell.numFmt = '#,##0';
        fairCell.font   = { bold: true, size: 12, color: { argb: ACCENT } };
        fairCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(fairCell, 'medium');
        const fairRow = r;
        r++;

        sheet.getCell(r, 1).value = 'Current Market Price (VND)';
        const cpCell = sheet.getCell(r, 2);
        cpCell.value  = { formula: `=Assumptions!B${I.currentPrice}` };
        cpCell.numFmt = '#,##0';
        applyBorders(cpCell);
        r++;

        sheet.getCell(r, 1).value = 'Upside / Downside';
        sheet.getCell(r, 1).font  = { bold: true };
        const upCell = sheet.getCell(r, 2);
        upCell.value  = { formula: `=(B${fairRow}-B${r-1})/B${r-1}` };
        upCell.numFmt = '+0.00%;-0.00%';
        upCell.font   = { bold: true };
        applyBorders(upCell, 'medium');
        r += 2;

        // Sensitivity table (7 multiples × 5 metrics)
        sheet.getCell(r, 1).value = `${label} ↓ / Multiple →`;
        sheet.getCell(r, 1).font  = { bold: true };
        applyBorders(sheet.getCell(r, 1));

        const multipleOffsets = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3];
        const metricOffsets   = [-0.2, -0.1, 0, 0.1, 0.2];

        multipleOffsets.forEach((mo, ci) => {
            const c = sheet.getCell(r, ci + 2);
            c.value  = { formula: `=B${multipleInputRow}*(1+${mo})` };
            c.numFmt = '0.00';
            c.font   = { bold: true };
            c.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            applyBorders(c);
        });
        r++;

        metricOffsets.forEach((mo) => {
            const lc = sheet.getCell(r, 1);
            lc.value  = { formula: `=B${metricInputRow}*(1+${mo})` };
            lc.numFmt = '#,##0';
            lc.font   = { bold: mo === 0 };
            lc.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: mo === 0 ? LIGHT_BG : 'F8FAFC' } };
            applyBorders(lc);

            multipleOffsets.forEach((mmo, ci) => {
                const vc = sheet.getCell(r, ci + 2);
                vc.value  = { formula: `=B${metricInputRow}*(1+${mo})*B${multipleInputRow}*(1+${mmo})` };
                vc.numFmt = '#,##0';
                applyBorders(vc);
                if (mo === 0 && mmo === 0) {
                    vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREEN_BG } };
                    vc.font = { bold: true };
                }
            });
            r++;
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SUMMARY SHEET
    // ═══════════════════════════════════════════════════════════════════════
    private createSummarySheet(
        sheet: ExcelJS.Worksheet,
        stockData: Record<string, unknown>,
        valuationResults: Record<string, unknown>,
        modelWeights: Record<string, unknown>,
        symbol: string
    ) {
        sheet.mergeCells('A1:F1');
        const t = sheet.getCell('A1');
        t.value = `VALUATION SUMMARY — ${symbol}`;
        t.font  = { bold: true, size: 18, color: { argb: 'FFFFFF' } };
        t.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 36;

        const now = new Date();
        sheet.mergeCells('A2:F2');
        sheet.getCell('A2').value =
            `Generated: ${now.toLocaleDateString('vi-VN')}  |  All values VND/share  |  Formulas reference Assumptions, FCFE Model, FCFF Model, Comparables`;
        sheet.getCell('A2').font  = { italic: true, color: { argb: '64748B' }, size: 9 };
        sheet.getCell('A2').alignment = { horizontal: 'center' };

        sectionHeader(sheet, 4, '  KEY MARKET DATA', 6);

        let r = 5;
        const mktRows: [string, string, string][] = [
            ['Current Market Price (VND)', `=Assumptions!B${I.currentPrice}`, '#,##0'],
            ['EPS TTM (VND)',               `=Assumptions!B${I.eps}`,          '#,##0'],
            ['BVPS (VND)',                  `=Assumptions!B${I.bvps}`,         '#,##0'],
            ['Trailing P/E',               `=Assumptions!B${I.pe}`,           '0.00'],
            ['Trailing P/B',               `=Assumptions!B${I.pb}`,           '0.00'],
            ['ROE (%)',                     `=Assumptions!B${I.roe}`,          '0.00%'],
            ['ROA (%)',                     `=Assumptions!B${I.roa}`,          '0.00%'],
            ['Market Cap (Bn VND)',         `=Assumptions!B${I.marketCap}`,    '#,##0.0'],
        ];
        mktRows.forEach(([lbl, fml, fmt]) => {
            sheet.getCell(r, 1).value = lbl;
            const vc  = sheet.getCell(r, 2);
            vc.value  = { formula: fml };
            vc.numFmt = fmt;
            applyBorders(vc);
            r++;
        });
        r++;

        sectionHeader(sheet, r, '  INTRINSIC VALUE BY MODEL', 6);
        r++;

        ['Valuation Model', 'Intrinsic Value (VND)', 'Weight (%)', 'Weighted Contribution (VND)', 'Upside / Downside'].forEach((h, ci) => {
            const c = sheet.getCell(r, ci + 1);
            c.value = h;
            c.font  = { bold: true };
            c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            c.alignment = { horizontal: 'center', wrapText: true };
            applyBorders(c);
        });
        sheet.getRow(r).height = 30;
        r++;

        const fcfeIR = this.computeDCFIntrinsicRow('FCFE');
        const fcffIR = this.computeDCFIntrinsicRow('FCFF');

        const snapshotCp = toNumber(
            ((valuationResults?.['export'] as Record<string, unknown>)?.['market'] as Record<string, unknown>)?.['current_price']
            ?? (valuationResults?.['inputs'] as Record<string, unknown>)?.['current_price']
            ?? stockData?.current_price ?? stockData?.price, 0
        );

        const vals = valuationResults?.['valuations'] as Record<string, unknown> ?? {};
        const wt   = modelWeights ?? {};

        const snapshotModels = [
            { name: 'FCFE (Free Cash Flow to Equity)', value: toNumber(vals.fcfe, 0),          weight: toNumber(wt.fcfe ?? wt.FCFE ?? 25, 0),            formulaRef: `='FCFE Model'!B${fcfeIR}` },
            { name: 'FCFF (Free Cash Flow to Firm)',   value: toNumber(vals.fcff, 0),          weight: toNumber(wt.fcff ?? wt.FCFF ?? 25, 0),            formulaRef: `='FCFF Model'!B${fcffIR}` },
            { name: 'P/E Comparable',                 value: toNumber(vals.justified_pe, 0),  weight: toNumber(wt.justified_pe ?? wt.pe ?? wt.PE ?? 20, 0), formulaRef: `=Comparables!B${this.comparablesFairRow('PE')}` },
            { name: 'P/B Comparable',                 value: toNumber(vals.justified_pb, 0),  weight: toNumber(wt.justified_pb ?? wt.pb ?? wt.PB ?? 20, 0), formulaRef: `=Comparables!B${this.comparablesFairRow('PB')}` },
            { name: 'Graham Formula',                 value: toNumber(vals.graham, 0),         weight: toNumber(wt.graham ?? wt.Graham ?? 10, 0),        formulaRef: `=Assumptions!B${I.grahamValue}` },
            { name: 'P/S Comparable',                 value: toNumber(vals.justified_ps, 0),  weight: toNumber(wt.justified_ps ?? wt.ps ?? wt.PS ?? 10, 0), formulaRef: `=Assumptions!B${I.currentPrice}` },
        ];

        let totalWeight = 0;
        let weightedSum = 0;
        snapshotModels.forEach(m => {
            if (m.value > 0 && m.weight > 0) {
                weightedSum += m.value * m.weight;
                totalWeight += m.weight;
            }
        });
        const weightedAvg = totalWeight > 0 ? weightedSum / totalWeight : 0;
        const snapshotUpside = snapshotCp > 0 ? (weightedAvg - snapshotCp) / snapshotCp : 0;

        snapshotModels.forEach((m, idx) => {
            sheet.getCell(r, 1).value = m.name;

            const vc  = sheet.getCell(r, 2);
            vc.value  = m.value > 0 ? m.value : { formula: m.formulaRef };
            vc.numFmt = '#,##0';
            applyBorders(vc);

            const wc  = sheet.getCell(r, 3);
            wc.value  = m.weight;
            wc.numFmt = '0.00';
            wc.alignment = { horizontal: 'center' };
            applyBorders(wc);

            const cc  = sheet.getCell(r, 4);
            cc.value  = m.value > 0 && m.weight > 0 ? (m.value * m.weight) / totalWeight : 0;
            cc.numFmt = '#,##0';
            applyBorders(cc);

            const uc  = sheet.getCell(r, 5);
            uc.value  = snapshotCp > 0 && m.value > 0 ? (m.value - snapshotCp) / snapshotCp : 0;
            uc.numFmt = '+0.00%;-0.00%';
            applyBorders(uc);

            if (idx % 2 === 0) {
                [1,2,3,4,5].forEach(ci => {
                    sheet.getCell(r, ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                });
            }
            r++;
        });

        r++;
        sheet.getCell(r, 1).value = '★  WEIGHTED AVERAGE INTRINSIC VALUE';
        sheet.getCell(r, 1).font  = { bold: true, size: 12, color: { argb: ACCENT } };

        const wavgCell = sheet.getCell(r, 2);
        wavgCell.value  = weightedAvg;
        wavgCell.numFmt = '#,##0';
        wavgCell.font   = { bold: true, size: 13, color: { argb: ACCENT } };
        wavgCell.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(wavgCell, 'medium');

        const twCell = sheet.getCell(r, 3);
        twCell.value  = totalWeight;
        twCell.numFmt = '0.00';
        twCell.font   = { bold: true };
        applyBorders(twCell, 'medium');

        const tuCell = sheet.getCell(r, 5);
        tuCell.value  = snapshotUpside;
        tuCell.numFmt = '+0.00%;-0.00%';
        tuCell.font   = { bold: true, size: 12 };
        applyBorders(tuCell, 'medium');
        r += 2;

        // Verdict
        sectionHeader(sheet, r, '  INVESTMENT VERDICT', 6);
        r++;

        sheet.getCell(r, 1).value = 'Current Price (VND)';
        const cpV = sheet.getCell(r, 2);
        cpV.value  = snapshotCp;
        cpV.numFmt = '#,##0';
        applyBorders(cpV);
        r++;

        sheet.getCell(r, 1).value = 'Analyst Consensus Fair Value (VND)';
        const fvV = sheet.getCell(r, 2);
        fvV.value  = weightedAvg;
        fvV.numFmt = '#,##0';
        fvV.font   = { bold: true };
        applyBorders(fvV, 'medium');
        r++;

        sheet.getCell(r, 1).value = 'Margin of Safety (Discount to Fair Value)';
        const mosV = sheet.getCell(r, 2);
        mosV.value  = weightedAvg > 0 ? (weightedAvg - snapshotCp) / weightedAvg : 0;
        mosV.numFmt = '+0.00%;-0.00%';
        mosV.font   = { bold: true };
        applyBorders(mosV, 'medium');
        r++;

        sheet.getCell(r, 1).value = 'Signal (Undervalued if Upside > 15%)';
        const sigV = sheet.getCell(r, 2);
        sigV.value  = snapshotUpside > 0.15
            ? 'BUY — Undervalued'
            : snapshotUpside < -0.15 ? 'SELL / Overvalued' : 'HOLD — Fair Value';
        sigV.font   = { bold: true };
        applyBorders(sigV, 'medium');

        sheet.getColumn(1).width = 44;
        sheet.getColumn(2).width = 24;
        sheet.getColumn(3).width = 14;
        sheet.getColumn(4).width = 28;
        sheet.getColumn(5).width = 20;
    }

    // Helper: computes the fair value row number for a multiple section in the Comparables sheet
    private comparablesFairRow(type: 'PE' | 'PB'): number {
        // PE starts at row 4: sectionHeader(4), r=5 (metric), r=6 (multiple), r=7 (fair value)
        if (type === 'PE') return 7;
        // PB starts at row 23: sectionHeader(23), r=24 (metric), r=25 (multiple), r=26 (fair value)
        return 26;
    }

    /**
     * Mirrors row counters in buildDCFSheet to find intrinsicRow without writing cells.
     * FCFE and FCFF have different number of component rows (5 vs 5, same), result = 42.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private computeDCFIntrinsicRow(_type: 'FCFE' | 'FCFF'): number {
        let r = 5;
        r += 1;           // component header
        r += 5;           // 5 component rows
        r += 1;           // shares row
        r += 1;           // divider
        // baseRow = r; no increment
        r += 2;           // r+=2 after base row → step2 sectionHeader
        r += 1;           // after sectionHeader
        r += 1;           // discRateRow
        r += 1;           // growthHighRow
        r += 2;           // growthTermRow + blank → step3 sectionHeader
        r += 1;           // after sectionHeader
        r += 1;           // projection header row
        r += PROJ_YEARS;  // 10 projection rows
        r += 1;           // blank before step4
        r += 1;           // after step4 sectionHeader
        r += 1;           // tvRow
        r += 1;           // tvGGRow
        r += 2;           // pvTvRow + blank
        r += 1;           // after step5 sectionHeader
        r += 1;           // sumPVRow
        r += 1;           // pvTvRefRow
        r += 1;           // divider
        // intrinsicRow = r
        return r;         // 42
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SECTOR PEERS SHEET
    // ═══════════════════════════════════════════════════════════════════════
    private createSectorPeersSheet(sheet: ExcelJS.Worksheet, valuationResults: Record<string, unknown>) {
        const sp          = (valuationResults.sector_peers ?? {}) as Record<string, unknown>;
        const comparables = ((valuationResults?.['export'] as Record<string, unknown>)?.['comparables'] ?? {}) as Record<string, unknown>;
        const detailedPeers: Record<string, unknown>[] = (comparables?.['peers_detailed'] as Record<string, unknown>[] ?? sp.peers_detail as Record<string, unknown>[] ?? []);
        let peers: Record<string, unknown>[] = detailedPeers;

        if (peers.length === 0) {
            const pePeers = Array.isArray(comparables?.['pe_ttm']
                ? (comparables['pe_ttm'] as Record<string, unknown>)?.['peers'] : [])
                ? (comparables['pe_ttm'] as Record<string, unknown>)?.['peers'] as Record<string, unknown>[]
                : [];
            const pbPeers = Array.isArray((comparables?.['pb'] as Record<string, unknown>)?.['peers'])
                ? (comparables['pb'] as Record<string, unknown>)['peers'] as Record<string, unknown>[]
                : [];
            const pbMap = new Map<string, number>(
                pbPeers.map(p => [String(p?.symbol ?? '').toUpperCase(), toNumber(p?.pb, 0)])
            );
            peers = pePeers.map(p => ({
                symbol:    String(p?.symbol ?? '').toUpperCase(),
                market_cap: null,
                pe_ratio:  toNumber(p?.pe, 0),
                pb_ratio:  pbMap.get(String(p?.symbol ?? '').toUpperCase()) ?? null,
                ps_ratio:  null,
                roe:       null,
                roa:       null,
                sector:    (comparables?.['industry'] as string) ?? (sp.sector as string) ?? '',
            }));
        }

        sheet.mergeCells('A1:I1');
        const titleCell = sheet.getCell('A1');
        titleCell.value = 'SECTOR PEERS COMPARISON';
        titleCell.font  = { bold: true, size: 15, color: { argb: 'FFFFFF' } };
        titleCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 30;

        let r = 3;
        sectionHeader(sheet, r, '  SECTOR SUMMARY', 9);
        r++;

        const summaryData: [string, ExcelJS.CellValue, string][] = [
            ['Sector',      ((comparables?.['industry'] as string) ?? (sp.sector as string) ?? 'N/A'), ''],
            ['Median P/E',  toNumber((comparables?.['pe_ttm'] as Record<string, unknown>)?.['used'] ?? sp.median_pe, 0), '0.00'],
            ['Median P/B',  toNumber((comparables?.['pb'] as Record<string, unknown>)?.['used'] ?? sp.median_pb, 0), '0.00'],
            ['Peers Count', peers.length, '0'],
        ];
        summaryData.forEach(([lbl, val, fmt]) => {
            sheet.getCell(r, 1).value = lbl;
            const vc  = sheet.getCell(r, 2);
            vc.value  = val;
            if (fmt) vc.numFmt = fmt;
            applyBorders(vc);
            r++;
        });
        r++;

        sectionHeader(sheet, r, '  PEER COMPANIES', 9);
        r++;

        ['#', 'Symbol', 'Market Cap (Bn VND)', 'P/E', 'P/B', 'P/S', 'ROE (%)', 'ROA (%)', 'Sector'].forEach((h, ci) => {
            const c = sheet.getCell(r, ci + 1);
            c.value = h;
            c.font  = { bold: true };
            c.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            c.alignment = { horizontal: 'center', wrapText: true };
            applyBorders(c);
        });
        sheet.getRow(r).height = 24;
        r++;

        if (peers.length === 0) {
            sheet.mergeCells(r, 1, r, 9);
            sheet.getCell(r, 1).value = 'No peer data available.';
            sheet.getCell(r, 1).font  = { italic: true, color: { argb: '94A3B8' } };
            sheet.getCell(r, 1).alignment = { horizontal: 'center' };
        } else {
            const dataStart = r;
            peers.forEach((p, idx) => {
                sheet.getCell(r, 1).value = idx + 1;
                sheet.getCell(r, 1).alignment = { horizontal: 'center' };
                applyBorders(sheet.getCell(r, 1));

                sheet.getCell(r, 2).value = String(p.symbol ?? '');
                sheet.getCell(r, 2).font  = { bold: true };
                applyBorders(sheet.getCell(r, 2));

                const mc = sheet.getCell(r, 3);
                mc.value  = toNumber(p.market_cap ?? p.marketCap, 0);
                mc.numFmt = '#,##0.0';
                applyBorders(mc);

                const pe = sheet.getCell(r, 4);
                pe.value  = toNumber(p.pe_ratio ?? p.pe, 0);
                pe.numFmt = '0.00';
                applyBorders(pe);

                const pb = sheet.getCell(r, 5);
                pb.value  = toNumber(p.pb_ratio ?? p.pb, 0);
                pb.numFmt = '0.00';
                applyBorders(pb);

                const ps = sheet.getCell(r, 6);
                ps.value  = toNumber(p.ps_ratio ?? p.ps, 0);
                ps.numFmt = '0.00';
                applyBorders(ps);

                const roe = sheet.getCell(r, 7);
                roe.value  = normalizePercentValue(p.roe ?? 0);
                roe.numFmt = '0.00%';
                applyBorders(roe);

                const roa = sheet.getCell(r, 8);
                roa.value  = normalizePercentValue(p.roa ?? 0);
                roa.numFmt = '0.00%';
                applyBorders(roa);

                sheet.getCell(r, 9).value = String(p.sector ?? '');
                applyBorders(sheet.getCell(r, 9));

                if (idx % 2 === 0) {
                    for (let ci = 1; ci <= 9; ci++) {
                        sheet.getCell(r, ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                    }
                }
                r++;
            });

            const dataEnd = r - 1;
            r++;

            // Median row
            sheet.getCell(r, 1).value = 'MEDIAN';
            sheet.getCell(r, 1).font  = { bold: true };
            applyBorders(sheet.getCell(r, 1));

            ([4, 5, 6] as const).forEach(ci => {
                const colLet = colLetter(ci);
                const mc = sheet.getCell(r, ci);
                mc.value  = { formula: `=MEDIAN(${colLet}${dataStart}:${colLet}${dataEnd})` };
                mc.numFmt = '0.00';
                mc.font   = { bold: true };
                mc.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
                applyBorders(mc, 'medium');
            });

            ([7, 8] as const).forEach(ci => {
                const colLet = colLetter(ci);
                const mc = sheet.getCell(r, ci);
                mc.value  = { formula: `=MEDIAN(${colLet}${dataStart}:${colLet}${dataEnd})` };
                mc.numFmt = '0.00%';
                mc.font   = { bold: true };
                mc.fill   = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
                applyBorders(mc, 'medium');
            });
        }

        sheet.getColumn(1).width = 5;
        sheet.getColumn(2).width = 12;
        sheet.getColumn(3).width = 22;
        [4,5,6,7,8].forEach(ci => sheet.getColumn(ci).width = 10);
        sheet.getColumn(9).width = 22;
    }
}
