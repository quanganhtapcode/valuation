import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';
import { API_BASE } from './api';

/**
 * Report Generator Module
 * Professional financial model with Excel formulas.
 * Sheet list (all formula-linked):
 *  1. Inputs          – single source of truth for all inputs/assumptions
 *  2. FCFE Model      – DCF to equity (step-by-step formulas)
 *  3. FCFF Model      – DCF to firm   (step-by-step formulas)
 *  4. PE Analysis     – P/E comparable + sensitivity table
 *  5. PB Analysis     – P/B comparable + sensitivity table
 *  6. Summary         – weighted-average formula referencing all model sheets
 *  7. Sector Peers    – peer table from DB
 */

// ─── Shared style helpers ────────────────────────────────────────────────────
const DARK = '1E293B';
const ACCENT = '2563EB';
const LIGHT_BG = 'EFF6FF';
const HEADER_BG = 'DBEAFE';
const BORDER_THIN: ExcelJS.Border = { style: 'thin', color: { argb: 'CBD5E1' } };
const BORDER_MEDIUM: ExcelJS.Border = { style: 'medium', color: { argb: '64748B' } };

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

function toNumber(value: any, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function normalizePercentValue(value: any): number {
    const n = toNumber(value, 0);
    if (n === 0) return 0;
    return Math.abs(n) > 1 ? n / 100 : n;
}

type StatementModelInputs = {
    netIncome: number;
    depreciation: number;
    workingCapitalInvestment: number;
    fixedCapitalInvestment: number;
    netBorrowing: number;
    interestAfterTax: number;
    periodLabel?: string;
};

type StatementInputsPayload = {
    fcfe: StatementModelInputs;
    fcff: StatementModelInputs;
    source: string;
};

// ─── Row layout constants for the "Inputs" sheet ─────────────────────────────
// These are used by other sheets to write cross-sheet formula strings.
const I = {
    // Company data
    currentPrice: 7,
    eps: 8,
    bvps: 9,
    pe: 10,
    pb: 11,
    roe: 12,
    roa: 13,
    marketCap: 14,
    sharesOutstanding: 15,
    revPerShare: 26,
    // DCF assumptions
    growthHigh: 19,
    growthTerminal: 20,
    ke: 21,
    wacc: 22,
    dcfYears: 23,
    // Comparable multiples
    peMultiple: 27,
    pbMultiple: 28,
    psMultiple: 29,
    // FCFE component inputs
    fcfe_netIncome: 33,
    fcfe_depreciation: 34,
    fcfe_workingCapital: 35,
    fcfe_capex: 36,
    fcfe_netBorrowing: 37,
    // FCFF component inputs
    fcff_netIncome: 43,
    fcff_interestAfterTax: 44,
    fcff_depreciation: 45,
    fcff_workingCapital: 46,
    fcff_capex: 47,
    // Graham (no separate sheet – stored here)
    grahamValue: 52,
    // Model weights (as %, 0-100)
    wFCFE: 57,
    wFCFF: 58,
    wPE: 59,
    wPB: 60,
    wGraham: 61,
    wPS: 62,
};

// Projection row start in FCFE/FCFF sheets
const PROJ_YEARS = 10;  // always model 10 years

export class ReportGenerator {
    private toast: any;

    constructor(toastManager?: any) {
        this.toast = toastManager || { show: console.log, hide: () => { } };
    }

    private showStatus(message: string, type: 'info' | 'error' | 'success' = 'info') {
        if (this.toast?.show) this.toast.show(message, type);
        else console.log(`[${type.toUpperCase()}] ${message}`);
    }

    private async fetchLatestFinancialReportRow(symbol: string, type: 'income' | 'cashflow'): Promise<any | null> {
        const periods: Array<'quarter' | 'year'> = ['quarter', 'year'];

        for (const period of periods) {
            try {
                const resp = await fetch(`/api/financial-report/${symbol}?type=${type}&period=${period}&limit=1`, {
                    cache: 'no-store',
                });
                if (!resp.ok) continue;
                const payload = await resp.json();
                const rows = Array.isArray(payload)
                    ? payload
                    : (Array.isArray(payload?.data) ? payload.data : []);
                if (rows.length > 0) return rows[0];
            } catch {
                // Try next period fallback
            }
        }

        return null;
    }

    private async loadStatementInputs(symbol: string, taxRatePercent: number): Promise<StatementInputsPayload | null> {
        const incomeRow = await this.fetchLatestFinancialReportRow(symbol, 'income');
        const cashflowRow = await this.fetchLatestFinancialReportRow(symbol, 'cashflow');

        if (!incomeRow && !cashflowRow) return null;

        const netIncome = toNumber(
            incomeRow?.net_profit_parent_company
            ?? incomeRow?.net_profit_parent_company_post
            ?? incomeRow?.net_profit,
            0,
        );
        const depreciation = toNumber(cashflowRow?.depreciation_fixed_assets, 0);
        const receivablesChange = toNumber(cashflowRow?.increase_decrease_receivables, 0);
        const inventoriesChange = toNumber(cashflowRow?.increase_decrease_inventory, 0);
        const payablesChange = toNumber(cashflowRow?.increase_decrease_payables, 0);
        const workingCapitalInvestment = receivablesChange + inventoriesChange - payablesChange;

        const purchaseFixedAssets = toNumber(cashflowRow?.purchase_purchase_fixed_assets, 0);
        const proceedsFixedAssets = toNumber(cashflowRow?.proceeds_from_disposal_fixed_assets, 0);
        const fixedCapitalInvestment = Math.max(0, Math.abs(purchaseFixedAssets) - Math.max(0, proceedsFixedAssets));

        const proceedsBorrowings = toNumber(cashflowRow?.proceeds_from_borrowings, 0);
        const repaymentBorrowings = toNumber(cashflowRow?.repayments_of_borrowings, 0);
        const netBorrowing = proceedsBorrowings + repaymentBorrowings;

        const interestExpensePaid = Math.abs(toNumber(cashflowRow?.interest_expense_paid, 0));
        const taxRate = Math.max(0, Math.min(1, taxRatePercent / 100));
        const interestAfterTax = interestExpensePaid * (1 - taxRate);

        const periodLabel = String(
            incomeRow?.period
            ?? cashflowRow?.period
            ?? `${incomeRow?.year || cashflowRow?.year || ''}${incomeRow?.quarter || cashflowRow?.quarter ? `-Q${incomeRow?.quarter || cashflowRow?.quarter}` : ''}`
        ).trim();

        return {
            fcfe: {
                netIncome,
                depreciation,
                workingCapitalInvestment,
                fixedCapitalInvestment,
                netBorrowing,
                interestAfterTax,
                periodLabel,
            },
            fcff: {
                netIncome,
                depreciation,
                workingCapitalInvestment,
                fixedCapitalInvestment,
                netBorrowing,
                interestAfterTax,
                periodLabel,
            },
            source: 'sqlite.financial_report endpoint',
        };
    }

    // ─── Public entry point ──────────────────────────────────────────────────
    async exportReport(
        stockData: any,
        valuationResults: any,
        assumptions: any,
        modelWeights: any,
        symbol: string
    ) {
        if (!stockData || !valuationResults) {
            this.showStatus('No data available to export report', 'error');
            return;
        }

        try {
            this.showStatus('Generating financial model…', 'info');
            const zip = new JSZip();
            const dateStr = new Date().toISOString().split('T')[0];
            const taxRatePercent = toNumber(assumptions?.taxRate, 20);
            const statementInputs = await this.loadStatementInputs(symbol, taxRatePercent);

            const wb = new ExcelJS.Workbook();
            wb.creator = 'quanganh.org';
            wb.created = new Date();
            // Keep workbook values aligned with the exported valuation snapshot.
            wb.calcProperties.fullCalcOnLoad = false;

            // Sheet order matters – Inputs must be first so cross-sheet refs resolve
            const wsInputs = wb.addWorksheet('Inputs', { views: [{ showGridLines: false }] });
            const wsFCFE = wb.addWorksheet('FCFE Model', { views: [{ showGridLines: false }] });
            const wsFCFF = wb.addWorksheet('FCFF Model', { views: [{ showGridLines: false }] });
            const wsPE = wb.addWorksheet('PE Analysis', { views: [{ showGridLines: false }] });
            const wsPB = wb.addWorksheet('PB Analysis', { views: [{ showGridLines: false }] });
            const wsPS = wb.addWorksheet('PS Analysis', { views: [{ showGridLines: false }] });
            const wsSummary = wb.addWorksheet('Summary', { views: [{ showGridLines: false }] });
            const wsPeers = wb.addWorksheet('Sector Peers', { views: [{ showGridLines: false }] });

            this.createInputsSheet(wsInputs, stockData, valuationResults, assumptions, modelWeights, symbol, statementInputs);
            this.createFCFESheet(wsFCFE, valuationResults);
            this.createFCFFSheet(wsFCFF, valuationResults);
            this.createPESheet(wsPE, valuationResults);
            this.createPBSheet(wsPB, valuationResults);
            this.createPSSheet(wsPS, valuationResults);
            this.createSummarySheet(wsSummary, stockData, valuationResults, modelWeights, symbol);
            this.createSectorPeersSheet(wsPeers, valuationResults);

            const buf = await wb.xlsx.writeBuffer();
            zip.file(`${symbol}_Valuation_Model_${dateStr}.xlsx`, buf);

            // Attach source financial statements file via same-origin proxy to avoid browser CORS on R2 URLs.
            const resp = await fetch(`${API_BASE}/download/${encodeURIComponent(symbol)}?proxy=1`, {
                cache: 'no-store',
            });
            if (!resp.ok) {
                throw new Error(`R2 file download failed (${resp.status})`);
            }
            zip.file(`${symbol}_Financial_Statements.xlsx`, await resp.arrayBuffer());

            const blob = await zip.generateAsync({ type: 'blob' });
            saveAs(blob, `${symbol}_Valuation_Package_${dateStr}.zip`);
            this.showStatus('Valuation package downloaded!', 'success');

        } catch (err: any) {
            console.error('ReportGenerator error:', err);
            this.showStatus('Error generating report: ' + err.message, 'error');
        }
    }

// ═══════════════════════════════════════════════════════════════════════
    // SHEET 1 – INPUTS & ASSUMPTIONS (single source of truth)
    // All sheets pull from here via =Inputs!B<row>
    // ═══════════════════════════════════════════════════════════════════════
    private createInputsSheet(
        sheet: ExcelJS.Worksheet,
        stockData: any,
        valuationResults: any,
        assumptions: any,
        modelWeights: any,
        symbol: string,
        statementInputs?: StatementInputsPayload | null,
    ) {
        const set = (row: number, label: string, value: any, fmt?: string, note?: string) => {
            labelValue(sheet, row, label);
            const vc = sheet.getCell(row, 2);
            vc.value = value ?? 0;
            if (fmt) vc.numFmt = fmt;
            applyBorders(vc, 'thin');
            if (note) setNote(sheet, row, note);
        };

        // Title
        sheet.mergeCells('A1:E1');
        const title = sheet.getCell('A1');
        title.value = `INPUTS & ASSUMPTIONS — ${symbol}`;
        title.font = { bold: true, size: 16, color: { argb: 'FFFFFF' } };
        title.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        title.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 32;

        sheet.mergeCells('A2:E2');
        sheet.getCell('A2').value = 'Yellow cells are editable assumptions. All model sheets reference this sheet via formulas.';
        sheet.getCell('A2').font = { italic: true, color: { argb: '64748B' }, size: 9 };
        sheet.getCell('A2').alignment = { horizontal: 'center' };

        // ── Company Data ──────────────────────────────────────────────────
        sectionHeader(sheet, 4, '  COMPANY DATA', 5);
        set(5, 'Symbol', symbol);
        set(6, 'Company Name', stockData.companyName || stockData.company_name || symbol);

        // Prefer valuation inputs (fresh from backend), then fall back to overview fields.
        const rawCp =
            valuationResults?.export?.market?.current_price
            ?? valuationResults?.inputs?.current_price
            ?? stockData.current_price
            ?? stockData.price
            ?? stockData.close
            ?? 0;
        const cp = toNumber(rawCp, 0);

        const eps = toNumber(
            valuationResults?.inputs?.eps_ttm
            ?? stockData.eps_ttm
            ?? stockData.eps,
            0,
        );
        const bvps = toNumber(
            valuationResults?.inputs?.bvps
            ?? stockData.bvps
            ?? stockData.book_value,
            0,
        );

        const peRatio = toNumber(stockData.pe_ratio ?? stockData.pe ?? stockData.PE, 0);
        const pbRatio = toNumber(stockData.pb_ratio ?? stockData.pb ?? stockData.PB, 0);
        const roePct = normalizePercentValue(stockData.roe ?? stockData.ROE ?? 0);
        const roaPct = normalizePercentValue(stockData.roa ?? stockData.ROA ?? 0);
        const marketCapBn =
            toNumber(stockData.market_cap, 0) > 0
                ? toNumber(stockData.market_cap, 0) / 1e9
                : toNumber(stockData.marketCap, 0) / 1e9;
        const rawSharesOutstanding = toNumber(
            valuationResults?.inputs?.shares_outstanding
            ?? stockData.shares_outstanding
            ?? stockData.shareOutstanding,
            0,
        );
        const sharesOutstanding = rawSharesOutstanding > 0 && rawSharesOutstanding < 1_000_000
            ? rawSharesOutstanding * 1_000_000
            : rawSharesOutstanding;
        set(I.currentPrice, 'Current Market Price (VND)', cp, '#,##0', 'Live price');
        set(I.eps, 'EPS TTM (VND)', eps, '#,##0', 'Trailing 12-month EPS');
        set(I.bvps, 'BVPS (VND)', bvps, '#,##0', 'Latest quarterly BVPS');
        set(I.pe, 'P/E Ratio (trailing)', peRatio, '0.00');
        set(I.pb, 'P/B Ratio (trailing)', pbRatio, '0.00');
        set(I.roe, 'ROE (%)', roePct, '0.00%');
        set(I.roa, 'ROA (%)', roaPct, '0.00%');
        set(I.marketCap, 'Market Cap (Billion VND)', marketCapBn, '#,##0.0');
        set(I.sharesOutstanding, 'Shares Outstanding', sharesOutstanding, '#,##0', 'Used to convert FCFE/FCFF into per-share value');

        // ── DCF Assumptions ───────────────────────────────────────────────
        sectionHeader(sheet, 16, '  DCF / GROWTH ASSUMPTIONS', 5);
        sheet.mergeCells('A17:E17');
        sheet.getCell('A17').value = '⚠  Highlighted cells below are key assumptions — edit to recalculate all model sheets.';
        sheet.getCell('A17').font = { italic: true, color: { argb: '92400E' }, size: 9 };

        const a = assumptions ?? {};
        // ValuationTab sends percentages (e.g. 8, 3, 10.5, 12) — divide by 100
        const growthHigh = a.revenueGrowth  != null ? a.revenueGrowth  / 100 : (a.growthRate  ?? a.growth_rate  ?? 0.08);
        const growthTerm = a.terminalGrowth != null ? a.terminalGrowth / 100 : (a.terminalGrowthRate ?? a.terminal_growth_rate ?? 0.03);
        const ke         = a.requiredReturn != null ? a.requiredReturn / 100 : (a.ke ?? a.costOfEquity ?? a.discount_rate ?? 0.12);
        const wacc       = a.wacc           != null ? a.wacc           / 100 : (a.WACC != null ? a.WACC / 100 : ke);

        const inputFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF9C3' } };

        const setAssumption = (row: number, label: string, value: number, fmt: string, note?: string) => {
            set(row, label, value, fmt, note);
            sheet.getCell(row, 2).fill = inputFill;
        };

        setAssumption(I.growthHigh, 'High-Growth Rate (g₁)', growthHigh, '0.00%', 'Applied to Years 1–10');
        setAssumption(I.growthTerminal, 'Terminal Growth Rate (gₙ)', growthTerm, '0.00%', 'Gordon Growth, perpetuity');
        setAssumption(I.ke, 'Cost of Equity — Ke', ke, '0.00%', 'Discount rate for FCFE');
        setAssumption(I.wacc, 'WACC', wacc, '0.00%', 'Discount rate for FCFF');
        setAssumption(I.dcfYears, 'Projection Years', PROJ_YEARS, '0', 'Fixed at 10 years');

        // ── Comparable Multiples ──────────────────────────────────────────
        sectionHeader(sheet, 24, '  COMPARABLE VALUATION MULTIPLES', 5);
        // Derive P/E and P/B multiples from backend fair values and base metrics
        const peVal = toNumber(valuationResults?.valuations?.justified_pe, 0);
        const pbVal = toNumber(valuationResults?.valuations?.justified_pb, 0);
        const sdEps  = stockData?.eps_ttm ?? stockData?.eps ?? 0;
        const sdBvps = stockData?.bvps ?? stockData?.book_value ?? 0;
        const peUsedFromExport = toNumber(
            valuationResults?.export?.calculation?.justified_pe?.pe_used
            ?? valuationResults?.inputs?.industry_median_pe_ttm_used,
            0,
        );
        const pbUsedFromExport = toNumber(
            valuationResults?.export?.calculation?.justified_pb?.pb_used
            ?? valuationResults?.inputs?.industry_median_pb_used,
            0,
        );
        const psVal = toNumber(valuationResults?.valuations?.justified_ps, 0);
        const revPerShare = toNumber(valuationResults?.inputs?.rev_per_share, 0);
        const psUsedFromExport = toNumber(
            valuationResults?.export?.calculation?.justified_ps?.ps_used
            ?? valuationResults?.inputs?.industry_median_ps_used,
            0,
        );
        const peMultipleDerived = peUsedFromExport > 0
            ? peUsedFromExport
            : ((peVal > 0 && toNumber(sdEps, 0) > 0) ? peVal / toNumber(sdEps, 1) : (a.peRatio ?? 15));
        const pbMultipleDerived = pbUsedFromExport > 0
            ? pbUsedFromExport
            : ((pbVal > 0 && toNumber(sdBvps, 0) > 0) ? pbVal / toNumber(sdBvps, 1) : (a.pbRatio ?? 2));
        const psMultipleDerived = psUsedFromExport > 0
            ? psUsedFromExport
            : ((psVal > 0 && revPerShare > 0) ? psVal / revPerShare : (a.psRatio ?? 3));
        set(I.revPerShare, 'Revenue / Share (VND)', revPerShare, '#,##0', 'Used by P/S valuation');
        setAssumption(I.peMultiple, 'P/E Multiple Used', peMultipleDerived, '0.00', 'Justified or sector median');
        setAssumption(I.pbMultiple, 'P/B Multiple Used', pbMultipleDerived, '0.00', 'Justified or sector median');
        setAssumption(I.psMultiple, 'P/S Multiple Used', psMultipleDerived, '0.00', 'Justified or sector median');

        // ── FCFE Inputs ───────────────────────────────────────────────────
        sectionHeader(sheet, 30, '  FCFE RAW INPUTS (from latest financial statements)', 5);
        sheet.mergeCells('A31:E31');
        sheet.getCell('A31').value = 'Base FCFE = Net Income + Depreciation − ΔWorking Capital − CapEx + Net Borrowing';
        sheet.getCell('A31').font = { italic: true, color: { argb: '475569' }, size: 9 };

        const fi = valuationResults.fcfe_details?.inputs
            ?? valuationResults.fcfe?.inputs
            ?? valuationResults?.export?.calculation?.dcf_fcfe?.inputs
            ?? {};
        const sFcfe = statementInputs?.fcfe;

        set(
            I.fcfe_netIncome,
            'Net Income (VND)',
            sFcfe?.netIncome ?? fi.netIncome ?? valuationResults?.export?.calculation?.dcf_fcfe?.details?.base_cashflow_per_share ?? 0,
            '#,##0',
            sFcfe?.periodLabel ? `SQLite period: ${sFcfe.periodLabel}` : undefined,
        );
        set(I.fcfe_depreciation, 'Depreciation & Amortisation (VND)', sFcfe?.depreciation ?? fi.depreciation ?? 0, '#,##0');
        set(I.fcfe_workingCapital, 'ΔWorking Capital Investment (VND)', sFcfe?.workingCapitalInvestment ?? fi.workingCapitalInvestment ?? 0, '#,##0');
        set(I.fcfe_capex, 'Capital Expenditure / CapEx (VND)', sFcfe?.fixedCapitalInvestment ?? fi.fixedCapitalInvestment ?? 0, '#,##0');
        set(I.fcfe_netBorrowing, 'Net Borrowing (VND)', sFcfe?.netBorrowing ?? fi.netBorrowing ?? 0, '#,##0');

        // ── FCFF Inputs ───────────────────────────────────────────────────
        sectionHeader(sheet, 40, '  FCFF RAW INPUTS (from latest financial statements)', 5);
        sheet.mergeCells('A41:E41');
        sheet.getCell('A41').value = 'Base FCFF = Net Income + Interest×(1−t) + Depreciation − ΔWorking Capital − CapEx';
        sheet.getCell('A41').font = { italic: true, color: { argb: '475569' }, size: 9 };

        const ffi = valuationResults.fcff_details?.inputs
            ?? valuationResults.fcff?.inputs
            ?? valuationResults?.export?.calculation?.dcf_fcff?.inputs
            ?? {};
        const sFcff = statementInputs?.fcff;

        set(I.fcff_netIncome, 'Net Income (VND)', sFcff?.netIncome ?? ffi.netIncome ?? valuationResults?.export?.calculation?.dcf_fcff?.details?.base_cashflow_per_share ?? 0, '#,##0');
        set(I.fcff_interestAfterTax, 'Interest × (1 − Tax) (VND)', sFcff?.interestAfterTax ?? ffi.interestAfterTax ?? 0, '#,##0');
        set(I.fcff_depreciation, 'Depreciation & Amortisation (VND)', sFcff?.depreciation ?? ffi.depreciation ?? 0, '#,##0');
        set(I.fcff_workingCapital, 'ΔWorking Capital Investment (VND)', sFcff?.workingCapitalInvestment ?? ffi.workingCapitalInvestment ?? 0, '#,##0');
        set(I.fcff_capex, 'Capital Expenditure / CapEx (VND)', sFcff?.fixedCapitalInvestment ?? ffi.fixedCapitalInvestment ?? 0, '#,##0');

        // ── Graham ────────────────────────────────────────────────────────
        sectionHeader(sheet, 49, '  GRAHAM FORMULA VALUE', 5);
        sheet.getCell('A50').value = 'Graham Intrinsic Value = √( 22.5 × EPS × BVPS )';
        sheet.getCell('A50').font = { italic: true, color: { argb: '475569' }, size: 9 };
        const grahamVal = valuationResults.valuations?.graham ?? 0;
        set(I.grahamValue, 'Graham Value (VND)', grahamVal, '#,##0', 'Computed by backend');

        // ── Model Weights ─────────────────────────────────────────────────
        sectionHeader(sheet, 53, '  MODEL WEIGHTS (%)', 5);
        sheet.mergeCells('A54:E54');
        sheet.getCell('A54').value = 'Weights must sum to 100. Used in Summary weighted average formula.';
        sheet.getCell('A54').font = { italic: true, color: { argb: '92400E' }, size: 9 };

        const wt = modelWeights ?? {};
        setAssumption(I.wFCFE, 'FCFE Weight (%)', wt.fcfe ?? wt.FCFE ?? 25, '0.00');
        setAssumption(I.wFCFF, 'FCFF Weight (%)', wt.fcff ?? wt.FCFF ?? 25, '0.00');
        setAssumption(I.wPE, 'P/E Weight (%)', wt.justified_pe ?? wt.pe ?? wt.PE ?? 20, '0.00');
        setAssumption(I.wPB, 'P/B Weight (%)', wt.justified_pb ?? wt.pb ?? wt.PB ?? 20, '0.00');
        setAssumption(I.wGraham, 'Graham Weight (%)', wt.graham ?? wt.Graham ?? 10, '0.00');
        setAssumption(I.wPS, 'P/S Weight (%)', wt.justified_ps ?? wt.ps ?? wt.PS ?? 10, '0.00');

        const sumRow = I.wPS + 1;
        sheet.getCell(sumRow, 1).value = 'Sum of Weights (must = 100)';
        sheet.getCell(sumRow, 1).font = { bold: true };
        sheet.getCell(sumRow, 2).value = {
            formula: `=B${I.wFCFE}+B${I.wFCFF}+B${I.wPE}+B${I.wPB}+B${I.wGraham}+B${I.wPS}`
        };
        sheet.getCell(sumRow, 2).numFmt = '0.00';
        sheet.getCell(sumRow, 2).font = { bold: true };
        applyBorders(sheet.getCell(sumRow, 2), 'medium');

        sheet.getColumn(1).width = 44;
        sheet.getColumn(2).width = 22;
        sheet.getColumn(3).width = 36;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SHEET 2 – FCFE MODEL
    // ═══════════════════════════════════════════════════════════════════════
    private createFCFESheet(sheet: ExcelJS.Worksheet, valuationResults: any) {
        this.buildDCFSheet(sheet, 'FCFE', valuationResults);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SHEET 3 – FCFF MODEL
    // ═══════════════════════════════════════════════════════════════════════
    private createFCFFSheet(sheet: ExcelJS.Worksheet, valuationResults: any) {
        this.buildDCFSheet(sheet, 'FCFF', valuationResults);
    }

    /**
     * Shared DCF builder for both FCFE (Ke) and FCFF (WACC) models.
     * All calculation rows use Excel formula strings – no pre-computed JS values.
     */
    private buildDCFSheet(sheet: ExcelJS.Worksheet, type: 'FCFE' | 'FCFF', valuationResults: any) {
        const isFCFE = type === 'FCFE';
        const detailsData = isFCFE ? valuationResults?.fcfe_details : valuationResults?.fcff_details;
        const rateRow = isFCFE ? I.ke : I.wacc;
        const niRow = isFCFE ? I.fcfe_netIncome : I.fcff_netIncome;
        const depRow = isFCFE ? I.fcfe_depreciation : I.fcff_depreciation;
        const wcRow = isFCFE ? I.fcfe_workingCapital : I.fcff_workingCapital;
        const cxRow = isFCFE ? I.fcfe_capex : I.fcff_capex;
        const label = isFCFE
            ? 'FREE CASH FLOW TO EQUITY (FCFE)'
            : 'FREE CASH FLOW TO FIRM (FCFF)';
        const rateLabel = isFCFE ? 'Cost of Equity — Ke' : 'WACC';

        // Title
        sheet.mergeCells('A1:F1');
        const t = sheet.getCell('A1');
        t.value = `${label} — DISCOUNTED CASH FLOW MODEL`;
        t.font = { bold: true, size: 15, color: { argb: 'FFFFFF' } };
        t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 30;

        sheet.mergeCells('A2:F2');
        sheet.getCell('A2').value =
            'Formulas reference the Inputs sheet. To change assumptions, edit the yellow cells in Inputs.';
        sheet.getCell('A2').font = { italic: true, color: { argb: '64748B' }, size: 9 };
        sheet.getCell('A2').alignment = { horizontal: 'center' };

        // ── STEP 1: Base Cash Flow ────────────────────────────────────────
        sectionHeader(sheet, 4, `  STEP 1: BASE YEAR ${type} CALCULATION`, 6);

        const compRows: [string, string, string][] = isFCFE ? [
            ['Net Income', `=Inputs!B${niRow}`, '(+) from income statement'],
            ['Depreciation & Amortisation', `=Inputs!B${depRow}`, '(+) non-cash charge added back'],
            ['ΔWorking Capital Investment', `=Inputs!B${wcRow}`, '(−) increase in working capital'],
            ['Capital Expenditure (CapEx)', `=Inputs!B${cxRow}`, '(−) investment in fixed assets'],
            ['Net Borrowing', `=Inputs!B${I.fcfe_netBorrowing}`, '(+) new debt minus repayments'],
        ] : [
            ['Net Income', `=Inputs!B${niRow}`, '(+) from income statement'],
            ['Interest × (1 − Tax Rate)', `=Inputs!B${I.fcff_interestAfterTax}`, '(+) add back after-tax interest cost'],
            ['Depreciation & Amortisation', `=Inputs!B${depRow}`, '(+) non-cash charge added back'],
            ['ΔWorking Capital Investment', `=Inputs!B${wcRow}`, '(−) increase in working capital'],
            ['Capital Expenditure (CapEx)', `=Inputs!B${cxRow}`, '(−) investment in fixed assets'],
        ];

        let r = 5;
        // Header row
        ['Component', 'Amount (VND)', 'Note'].forEach((h, ci) => {
            const c = sheet.getCell(r, ci + 1);
            c.value = h;
            c.font = { bold: true };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            applyBorders(c);
        });
        r++;

        const compStartRow = r;
        compRows.forEach(([lbl, formula, note]) => {
            sheet.getCell(r, 1).value = lbl;
            const vc = sheet.getCell(r, 2);
            vc.value = { formula };
            vc.numFmt = '#,##0';
            applyBorders(vc);
            sheet.getCell(r, 3).value = note;
            sheet.getCell(r, 3).font = { italic: true, color: { argb: '94A3B8' }, size: 9 };
            r++;
        });

        const sharesRow = r;
        sheet.getCell(r, 1).value = 'Shares Outstanding (for per-share conversion)';
        const sharesCell = sheet.getCell(r, 2);
        sharesCell.value = { formula: `=Inputs!B${I.sharesOutstanding}` };
        sharesCell.numFmt = '#,##0';
        applyBorders(sharesCell);
        sheet.getCell(r, 3).value = 'Base FCF ÷ Shares Outstanding';
        sheet.getCell(r, 3).font = { italic: true, color: { argb: '94A3B8' }, size: 9 };
        r++;

        // Divider
        sheet.getCell(r, 1).value = '─'.repeat(60);
        sheet.getCell(r, 1).font = { color: { argb: 'CBD5E1' } };
        r++;

        // Base FCF row (formula sums all components)
        const baseRow = r;
        let baseFml: string;
        if (isFCFE) {
            baseFml = `=(B${compStartRow}+B${compStartRow + 1}-B${compStartRow + 2}-B${compStartRow + 3}+B${compStartRow + 4})/IF(B${sharesRow}>0,B${sharesRow},1)`;
        } else {
            baseFml = `=(B${compStartRow}+B${compStartRow + 1}+B${compStartRow + 2}-B${compStartRow + 3}-B${compStartRow + 4})/IF(B${sharesRow}>0,B${sharesRow},1)`;
        }
        sheet.getCell(r, 1).value = `Base ${type} Per Share (Year 0)`;
        sheet.getCell(r, 1).font = { bold: true };
        const baseCell = sheet.getCell(r, 2);
        const baseCachedResult = detailsData?.baseFCFE ?? detailsData?.baseFCFF ?? undefined;
        baseCell.value = baseCachedResult != null ? { formula: baseFml, result: baseCachedResult } : { formula: baseFml };
        baseCell.numFmt = '#,##0';
        baseCell.font = { bold: true };
        baseCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(baseCell, 'medium');
        r += 2;

        // ── STEP 2: Discount Rate ─────────────────────────────────────────
        sectionHeader(sheet, r, '  STEP 2: DISCOUNT RATE & GROWTH ASSUMPTIONS', 6);
        r++;

        const discRateRow = r;
        sheet.getCell(r, 1).value = rateLabel;
        sheet.getCell(r, 1).font = { bold: true };
        const drCell = sheet.getCell(r, 2);
        drCell.value = { formula: `=Inputs!B${rateRow}` };
        drCell.numFmt = '0.00%';
        drCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(drCell);
        sheet.getCell(r, 3).value = '← edit in Inputs sheet';
        sheet.getCell(r, 3).font = { italic: true, color: { argb: '94A3B8' }, size: 9 };
        r++;

        const growthHighRow = r;
        sheet.getCell(r, 1).value = 'High-Growth Rate (g₁) — Years 1–10';
        const ghCell = sheet.getCell(r, 2);
        ghCell.value = { formula: `=Inputs!B${I.growthHigh}` };
        ghCell.numFmt = '0.00%';
        ghCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(ghCell);
        r++;

        const growthTermRow = r;
        sheet.getCell(r, 1).value = 'Terminal Growth Rate (gₙ) — Perpetuity';
        const gtCell = sheet.getCell(r, 2);
        gtCell.value = { formula: `=Inputs!B${I.growthTerminal}` };
        gtCell.numFmt = '0.00%';
        gtCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(gtCell);
        r += 2;

        // ── STEP 3: Projection Table ──────────────────────────────────────
        sectionHeader(sheet, r, '  STEP 3: 10-YEAR CASH FLOW PROJECTIONS', 6);
        r++;

        ['Year', `Projected ${type} (VND)`, 'Formula', 'Discount Factor', 'PV of Cash Flow (VND)', 'Cumulative PV'].forEach((h, ci) => {
            const c = sheet.getCell(r, ci + 1);
            c.value = h;
            c.font = { bold: true };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
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
            fcfCell.value = { formula: `=B${baseRow}*(1+B${growthHighRow})^A${r}` };
            fcfCell.numFmt = '#,##0';
            applyBorders(fcfCell);

            sheet.getCell(r, 3).value = `=BaseFCF × (1+g₁)^${yr}`;
            sheet.getCell(r, 3).font = { color: { argb: '64748B' }, size: 9, italic: true };

            const dfCell = sheet.getCell(r, 4);
            dfCell.value = { formula: `=1/(1+B${discRateRow})^A${r}` };
            dfCell.numFmt = '0.0000';
            applyBorders(dfCell);

            const pvCell = sheet.getCell(r, 5);
            pvCell.value = { formula: `=B${r}*D${r}` };
            pvCell.numFmt = '#,##0';
            applyBorders(pvCell);
            if (yr % 2 === 0) pvCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };

            const cumCell = sheet.getCell(r, 6);
            cumCell.value = { formula: yr === 1 ? `=E${r}` : `=F${r - 1}+E${r}` };
            cumCell.numFmt = '#,##0';
            cumCell.font = { color: { argb: '475569' } };
            applyBorders(cumCell);
            r++;
        }

        const projDataEnd = r - 1;
        r += 1;

        // ── STEP 4: Terminal Value ────────────────────────────────────────
        sectionHeader(sheet, r, '  STEP 4: TERMINAL VALUE (Gordon Growth Model)', 6);
        r++;

        const tvRow = r;
        sheet.getCell(r, 1).value = `Terminal-Year ${type} (Year ${PROJ_YEARS + 1})`;
        sheet.getCell(r, 3).value = `= Year ${PROJ_YEARS} FCF × (1 + gₙ)`;
        sheet.getCell(r, 3).font = { italic: true, color: { argb: '64748B' }, size: 9 };
        const tvYearCell = sheet.getCell(r, 2);
        tvYearCell.value = { formula: `=B${projDataEnd}*(1+B${growthTermRow})` };
        tvYearCell.numFmt = '#,##0';
        applyBorders(tvYearCell);
        r++;

        const tvGGRow = r;
        sheet.getCell(r, 1).value = 'Terminal Value (Gordon Growth)';
        sheet.getCell(r, 3).value = `= TV Year FCF ÷ (${rateLabel} − gₙ)`;
        sheet.getCell(r, 3).font = { italic: true, color: { argb: '64748B' }, size: 9 };
        const tvGGCell = sheet.getCell(r, 2);
        tvGGCell.value = { formula: `=B${tvRow}/(B${discRateRow}-B${growthTermRow})` };
        tvGGCell.numFmt = '#,##0';
        applyBorders(tvGGCell);
        r++;

        const pvTvRow = r;
        sheet.getCell(r, 1).value = 'PV of Terminal Value';
        sheet.getCell(r, 3).value = `= TV ÷ (1 + ${rateLabel})^${PROJ_YEARS}`;
        sheet.getCell(r, 3).font = { italic: true, color: { argb: '64748B' }, size: 9 };
        const pvTvCell = sheet.getCell(r, 2);
        pvTvCell.value = { formula: `=B${tvGGRow}/(1+B${discRateRow})^${PROJ_YEARS}` };
        pvTvCell.numFmt = '#,##0';
        pvTvCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(pvTvCell, 'medium');
        r += 2;

        // ── STEP 5: Intrinsic Value ───────────────────────────────────────
        sectionHeader(sheet, r, `  STEP 5: INTRINSIC VALUE PER SHARE — ${type}`, 6);
        r++;

        const sumPVRow = r;
        sheet.getCell(r, 1).value = 'Sum of PV (Cash Flows, Years 1–10)';
        const sumPVCell = sheet.getCell(r, 2);
        sumPVCell.value = { formula: `=SUM(E${projDataStart}:E${projDataEnd})` };
        sumPVCell.numFmt = '#,##0';
        applyBorders(sumPVCell);
        r++;

        const pvTvRefRow = r;
        sheet.getCell(r, 1).value = 'PV of Terminal Value';
        const pvTvRefCell = sheet.getCell(r, 2);
        pvTvRefCell.value = { formula: `=B${pvTvRow}` };
        pvTvRefCell.numFmt = '#,##0';
        applyBorders(pvTvRefCell);
        r++;

        sheet.getCell(r, 1).value = '─'.repeat(60);
        sheet.getCell(r, 1).font = { color: { argb: 'CBD5E1' } };
        r++;

        // ★ INTRINSIC VALUE — this is referenced by Summary sheet
        const intrinsicRow = r;
        sheet.getCell(r, 1).value = `★  INTRINSIC VALUE — ${type} (VND per share)`;
        sheet.getCell(r, 1).font = { bold: true, size: 12, color: { argb: ACCENT } };
        const intrinsicCell = sheet.getCell(r, 2);
        const intrinsicCachedResult = isFCFE
            ? valuationResults?.valuations?.fcfe ?? detailsData?.shareValue ?? undefined
            : valuationResults?.valuations?.fcff ?? detailsData?.shareValue ?? undefined;
        intrinsicCell.value = intrinsicCachedResult != null
            ? intrinsicCachedResult
            : { formula: `=B${sumPVRow}+B${pvTvRefRow}` };
        intrinsicCell.numFmt = '#,##0';
        intrinsicCell.font = { bold: true, size: 13, color: { argb: ACCENT } };
        intrinsicCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(intrinsicCell, 'medium');
        r++;

        sheet.getCell(r, 1).value = 'Current Price (VND)';
        const cpCell2 = sheet.getCell(r, 2);
        cpCell2.value = { formula: `=Inputs!B${I.currentPrice}` };
        cpCell2.numFmt = '#,##0';
        applyBorders(cpCell2);
        r++;

        sheet.getCell(r, 1).value = 'Upside / Downside';
        sheet.getCell(r, 1).font = { bold: true };
        const upCell = sheet.getCell(r, 2);
        upCell.value = { formula: `=(B${intrinsicRow}-B${r - 1})/B${r - 1}` };
        upCell.numFmt = '+0.00%;-0.00%';
        upCell.font = { bold: true };
        applyBorders(upCell, 'medium');

        sheet.getColumn(1).width = 42;
        sheet.getColumn(2).width = 24;
        sheet.getColumn(3).width = 28;
        sheet.getColumn(4).width = 16;
        sheet.getColumn(5).width = 24;
        sheet.getColumn(6).width = 24;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SHEET 4 – P/E ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════
    private createPESheet(sheet: ExcelJS.Worksheet, valuationResults: any) {
        this.buildMultipleSheet(sheet, 'PE', valuationResults);
        this.appendPEPeerAndEPSSection(sheet, valuationResults);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SHEET 5 – P/B ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════
    private createPBSheet(sheet: ExcelJS.Worksheet, valuationResults: any) {
        this.buildMultipleSheet(sheet, 'PB', valuationResults);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SHEET 5b – P/S ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════
    private createPSSheet(sheet: ExcelJS.Worksheet, valuationResults: any) {
        this.buildMultipleSheet(sheet, 'PS', valuationResults);
    }

    /**
     * Shared builder for P/E and P/B sheets + sensitivity table.
     * Fair value cell is always at B9 (used by Summary cross-sheet formula).
     */
    private buildMultipleSheet(sheet: ExcelJS.Worksheet, type: 'PE' | 'PB' | 'PS', valuationResults: any) {
        const isPE = type === 'PE';
        const isPB = type === 'PB';
        const baseMetricRow = isPE ? I.eps : (isPB ? I.bvps : I.revPerShare);
        const multipleRow = isPE ? I.peMultiple : (isPB ? I.pbMultiple : I.psMultiple);
        const label = isPE ? 'P/E' : (isPB ? 'P/B' : 'P/S');
        const metricLabel = isPE ? 'EPS TTM (VND)' : (isPB ? 'BVPS (VND)' : 'Revenue/Share (VND)');
        const multipleLabelFull = isPE
            ? 'P/E Multiple Applied'
            : (isPB ? 'P/B Multiple Applied' : 'P/S Multiple Applied');

        sheet.mergeCells('A1:F1');
        const t = sheet.getCell('A1');
        t.value = `${label} COMPARABLE VALUATION MODEL`;
        t.font = { bold: true, size: 15, color: { argb: 'FFFFFF' } };
        t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 30;

        sheet.mergeCells('A2:F2');
        sheet.getCell('A2').value = `Fair Value = ${metricLabel} × ${label} Multiple  |  All inputs from Inputs sheet`;
        sheet.getCell('A2').font = { italic: true, color: { argb: '64748B' }, size: 9 };
        sheet.getCell('A2').alignment = { horizontal: 'center' };

        sectionHeader(sheet, 4, '  VALUATION INPUTS', 6);

        // Row 5: metric
        const epsRow = 5;
        sheet.getCell(5, 1).value = metricLabel;
        sheet.getCell(5, 1).font = { bold: true };
        const epsCell = sheet.getCell(5, 2);
        epsCell.value = { formula: `=Inputs!B${baseMetricRow}` };
        epsCell.numFmt = '#,##0';
        epsCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(epsCell);

        // Row 6: multiple
        const multRow = 6;
        sheet.getCell(6, 1).value = multipleLabelFull;
        sheet.getCell(6, 1).font = { bold: true };
        const multCell = sheet.getCell(6, 2);
        multCell.value = { formula: `=Inputs!B${multipleRow}` };
        multCell.numFmt = '0.00';
        multCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF9C3' } };
        applyBorders(multCell, 'medium');
        sheet.getCell(6, 3).value = '← edit in Inputs sheet';
        sheet.getCell(6, 3).font = { italic: true, color: { argb: '94A3B8' }, size: 9 };

        // Rows 7–8: section header + fair value header
        sectionHeader(sheet, 8, '  FAIR VALUE CALCULATION', 6);

        // Row 9: FAIR VALUE  ← Summary references this exact cell
        const fairRow = 9;
        sheet.getCell(9, 1).value = `★  FAIR VALUE — ${label} (VND per share)`;
        sheet.getCell(9, 1).font = { bold: true, size: 12, color: { argb: ACCENT } };
        const fairCell = sheet.getCell(9, 2);
        const fairCachedResult = isPE
            ? valuationResults?.valuations?.justified_pe ?? undefined
            : (isPB ? valuationResults?.valuations?.justified_pb ?? undefined : valuationResults?.valuations?.justified_ps ?? undefined);
        fairCell.value = fairCachedResult != null
            ? fairCachedResult
            : { formula: `=B${epsRow}*B${multRow}` };
        fairCell.numFmt = '#,##0';
        fairCell.font = { bold: true, size: 13, color: { argb: ACCENT } };
        fairCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(fairCell, 'medium');
        sheet.getCell(9, 3).value = `= ${metricLabel} × ${label} Multiple`;
        sheet.getCell(9, 3).font = { italic: true, color: { argb: '475569' }, size: 10 };

        // Row 10: current price
        sheet.getCell(10, 1).value = 'Current Market Price (VND)';
        const cpCell = sheet.getCell(10, 2);
        cpCell.value = { formula: `=Inputs!B${I.currentPrice}` };
        cpCell.numFmt = '#,##0';
        applyBorders(cpCell);

        // Row 11: upside
        sheet.getCell(11, 1).value = 'Upside / Downside';
        sheet.getCell(11, 1).font = { bold: true };
        const upCell = sheet.getCell(11, 2);
        upCell.value = { formula: `=(B${fairRow}-B10)/B10` };
        upCell.numFmt = '+0.00%;-0.00%';
        upCell.font = { bold: true };
        applyBorders(upCell, 'medium');

        // ── Sensitivity Table ─────────────────────────────────────────────
        sectionHeader(sheet, 13, `  SENSITIVITY TABLE: Fair Value vs ${label} Multiple`, 6);

        sheet.mergeCells('A14:F14');
        sheet.getCell('A14').value =
            `Rows = ${metricLabel} scenarios (−20% to +20%)  |  Columns = ${label} Multiple scenarios`;
        sheet.getCell('A14').font = { italic: true, color: { argb: '64748B' }, size: 9 };
        sheet.getCell('A14').alignment = { horizontal: 'center' };

        const multipleOffsets = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3];
        const metricOffsets = [-0.2, -0.1, 0, 0.1, 0.2];

        let r = 15;
        sheet.getCell(r, 1).value = `${label} ↓ / Multiple →`;
        sheet.getCell(r, 1).font = { bold: true };
        applyBorders(sheet.getCell(r, 1));
        multipleOffsets.forEach((mo, ci) => {
            const c = sheet.getCell(r, ci + 2);
            c.value = { formula: `=B${multRow}*(1+${mo})` };
            c.numFmt = '0.00';
            c.font = { bold: true };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            applyBorders(c);
        });
        r++;

        metricOffsets.forEach((mo) => {
            const labelCell = sheet.getCell(r, 1);
            labelCell.value = { formula: `=B${epsRow}*(1+${mo})` };
            labelCell.numFmt = '#,##0';
            labelCell.font = { bold: mo === 0 };
            labelCell.fill = {
                type: 'pattern', pattern: 'solid',
                fgColor: { argb: mo === 0 ? LIGHT_BG : 'F8FAFC' }
            };
            applyBorders(labelCell);

            multipleOffsets.forEach((mmo, ci) => {
                const valCell = sheet.getCell(r, ci + 2);
                valCell.value = { formula: `=B${epsRow}*(1+${mo})*B${multRow}*(1+${mmo})` };
                valCell.numFmt = '#,##0';
                applyBorders(valCell);
                if (mo === 0 && mmo === 0) {
                    valCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DCFCE7' } };
                    valCell.font = { bold: true };
                }
            });
            r++;
        });

        sheet.getColumn(1).width = 22;
        for (let ci = 2; ci <= 8; ci++) sheet.getColumn(ci).width = 16;
    }

    private appendPEPeerAndEPSSection(sheet: ExcelJS.Worksheet, valuationResults: any) {
        const comparables = valuationResults?.export?.comparables ?? {};
        const detailedPeers = Array.isArray(comparables?.peers_detailed) ? comparables.peers_detailed : [];
        const pePeers = Array.isArray(comparables?.pe_ttm?.peers) ? comparables.pe_ttm.peers : [];
        const peList = (pePeers.length > 0 ? pePeers : detailedPeers)
            .map((p: any) => ({
                symbol: String(p?.symbol ?? '').toUpperCase(),
                pe: toNumber(p?.pe ?? p?.pe_ratio, 0),
            }))
            .filter((p: any) => p.symbol && p.pe > 0 && p.pe <= 80);

        let r = 23;
        sectionHeader(sheet, r, '  PE PEER LIST (from latest VCI screening)', 6);
        r++;

        const peMedian = toNumber(comparables?.pe_ttm?.median_computed ?? comparables?.pe_ttm?.used, 0);
        sheet.getCell(r, 1).value = 'Median P/E Used';
        const med = sheet.getCell(r, 2);
        med.value = peMedian;
        med.numFmt = '0.00';
        med.font = { bold: true };
        med.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(med, 'medium');
        r += 2;

        ['#', 'Symbol', 'Peer P/E'].forEach((h, ci) => {
            const c = sheet.getCell(r, ci + 1);
            c.value = h;
            c.font = { bold: true };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            c.alignment = { horizontal: 'center' };
            applyBorders(c);
        });
        r++;

        if (peList.length === 0) {
            sheet.mergeCells(r, 1, r, 3);
            const c = sheet.getCell(r, 1);
            c.value = 'No peer P/E data available.';
            c.font = { italic: true, color: { argb: '94A3B8' } };
            c.alignment = { horizontal: 'center' };
            r += 2;
        } else {
            peList.slice(0, 50).forEach((p: any, idx: number) => {
                sheet.getCell(r, 1).value = idx + 1;
                sheet.getCell(r, 1).alignment = { horizontal: 'center' };
                applyBorders(sheet.getCell(r, 1));

                sheet.getCell(r, 2).value = p.symbol;
                sheet.getCell(r, 2).font = { bold: true };
                applyBorders(sheet.getCell(r, 2));

                const c = sheet.getCell(r, 3);
                c.value = p.pe;
                c.numFmt = '0.00';
                applyBorders(c);
                r++;
            });
            r += 1;
        }

        sectionHeader(sheet, r, '  EPS HISTORY (Company)', 6);
        r++;

        const epsTtm = toNumber(valuationResults?.inputs?.eps_ttm_current ?? valuationResults?.inputs?.eps_ttm, 0);
        sheet.getCell(r, 1).value = 'EPS TTM (Current)';
        const epsTtmCell = sheet.getCell(r, 2);
        epsTtmCell.value = epsTtm;
        epsTtmCell.numFmt = '#,##0';
        epsTtmCell.font = { bold: true };
        epsTtmCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(epsTtmCell, 'medium');
        r += 2;

        ['Year', 'EPS (VND)'].forEach((h, ci) => {
            const c = sheet.getCell(r, ci + 1);
            c.value = h;
            c.font = { bold: true };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            c.alignment = { horizontal: 'center' };
            applyBorders(c);
        });
        r++;

        const epsHistory = Array.isArray(valuationResults?.inputs?.eps_history_yearly)
            ? valuationResults.inputs.eps_history_yearly
            : [];
        if (epsHistory.length === 0) {
            sheet.mergeCells(r, 1, r, 2);
            const c = sheet.getCell(r, 1);
            c.value = 'No annual EPS history available.';
            c.font = { italic: true, color: { argb: '94A3B8' } };
            c.alignment = { horizontal: 'center' };
        } else {
            epsHistory.forEach((item: any) => {
                const year = toNumber(item?.year, 0);
                const eps = toNumber(item?.eps, 0);
                sheet.getCell(r, 1).value = year;
                sheet.getCell(r, 1).alignment = { horizontal: 'center' };
                applyBorders(sheet.getCell(r, 1));

                const c = sheet.getCell(r, 2);
                c.value = eps;
                c.numFmt = '#,##0';
                applyBorders(c);
                r++;
            });
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SHEET 6 – SUMMARY (cross-sheet formulas link all models)
    // ═══════════════════════════════════════════════════════════════════════
    private createSummarySheet(
        sheet: ExcelJS.Worksheet,
        stockData: any,
        valuationResults: any,
        modelWeights: any,
        symbol: string
    ) {
        sheet.mergeCells('A1:F1');
        const t = sheet.getCell('A1');
        t.value = `VALUATION SUMMARY — ${symbol}`;
        t.font = { bold: true, size: 18, color: { argb: 'FFFFFF' } };
        t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 36;

        const now = new Date();
        sheet.mergeCells('A2:F2');
        sheet.getCell('A2').value =
            `Generated: ${now.toLocaleDateString('vi-VN')}  |  All values VND/share  |  Formulas link to FCFE Model, FCFF Model, PE Analysis, PB Analysis, PS Analysis, Inputs`;
        sheet.getCell('A2').font = { italic: true, color: { argb: '64748B' }, size: 9 };
        sheet.getCell('A2').alignment = { horizontal: 'center' };

        // ── Key Market Data ───────────────────────────────────────────────
        sectionHeader(sheet, 4, '  KEY MARKET DATA', 6);

        let r = 5;
        const mktRows: [string, string, string][] = [
            ['Current Market Price (VND)', `=Inputs!B${I.currentPrice}`, '#,##0'],
            ['EPS TTM (VND)', `=Inputs!B${I.eps}`, '#,##0'],
            ['BVPS (VND)', `=Inputs!B${I.bvps}`, '#,##0'],
            ['Trailing P/E', `=Inputs!B${I.pe}`, '0.00'],
            ['Trailing P/B', `=Inputs!B${I.pb}`, '0.00'],
            ['ROE (%)', `=Inputs!B${I.roe}`, '0.00%'],
            ['ROA (%)', `=Inputs!B${I.roa}`, '0.00%'],
            ['Market Cap (Bn VND)', `=Inputs!B${I.marketCap}`, '#,##0.0'],
        ];
        mktRows.forEach(([lbl, fml, fmt]) => {
            sheet.getCell(r, 1).value = lbl;
            const vc = sheet.getCell(r, 2);
            vc.value = { formula: fml };
            vc.numFmt = fmt;
            applyBorders(vc);
            r++;
        });
        r++;

        // ── Model Results Table ───────────────────────────────────────────
        sectionHeader(sheet, r, '  INTRINSIC VALUE BY MODEL', 6);
        r++;

        ['Valuation Model', 'Intrinsic Value (VND)', 'Weight (%)', 'Weighted Contribution (VND)', 'Upside / Downside'].forEach((h, ci) => {
            const c = sheet.getCell(r, ci + 1);
            c.value = h;
            c.font = { bold: true };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            c.alignment = { horizontal: 'center', wrapText: true };
            applyBorders(c);
        });
        sheet.getRow(r).height = 30;
        r++;

        // Cross-sheet references to each model's intrinsic value.
        // FCFE/FCFF: intrinsic value row is computed by computeDCFIntrinsicRow().
        // PE/PB: fairRow is always B9 (fixed in buildMultipleSheet above).
        const fcfeIR = this.computeDCFIntrinsicRow('FCFE');
        const fcffIR = this.computeDCFIntrinsicRow('FCFF');
        const peIR = 9;
        const pbIR = 9;
        const psIR = 9;

        const snapshotCurrentPrice = toNumber(
            valuationResults?.export?.market?.current_price
            ?? valuationResults?.inputs?.current_price
            ?? stockData?.current_price
            ?? stockData?.price
            ?? 0,
            0,
        );

        const snapshotModels = [
            {
                name: 'FCFE (Free Cash Flow to Equity)',
                value: toNumber(valuationResults?.valuations?.fcfe, 0),
                weight: toNumber(modelWeights?.fcfe, 0),
                formulaRef: `='FCFE Model'!B${fcfeIR}`,
            },
            {
                name: 'FCFF (Free Cash Flow to Firm)',
                value: toNumber(valuationResults?.valuations?.fcff, 0),
                weight: toNumber(modelWeights?.fcff, 0),
                formulaRef: `='FCFF Model'!B${fcffIR}`,
            },
            {
                name: 'P/E Comparable',
                value: toNumber(valuationResults?.valuations?.justified_pe, 0),
                weight: toNumber(modelWeights?.justified_pe, 0),
                formulaRef: `='PE Analysis'!B${peIR}`,
            },
            {
                name: 'P/B Comparable',
                value: toNumber(valuationResults?.valuations?.justified_pb, 0),
                weight: toNumber(modelWeights?.justified_pb, 0),
                formulaRef: `='PB Analysis'!B${pbIR}`,
            },
            {
                name: 'P/S Comparable',
                value: toNumber(valuationResults?.valuations?.justified_ps, 0),
                weight: toNumber(modelWeights?.justified_ps, 0),
                formulaRef: `='PS Analysis'!B${psIR}`,
            },
            {
                name: 'Graham Formula',
                value: toNumber(valuationResults?.valuations?.graham, 0),
                weight: toNumber(modelWeights?.graham, 0),
                formulaRef: `=Inputs!B${I.grahamValue}`,
            },
        ];

        let snapshotWeightedContribution = 0;
        let snapshotTotalWeight = 0;
        snapshotModels.forEach((m) => {
            if (m.value > 0 && m.weight > 0) {
                snapshotWeightedContribution += (m.value * m.weight) / 100.0;
                snapshotTotalWeight += m.weight;
            }
        });
        const snapshotWeightedAverage = snapshotTotalWeight > 0
            ? (snapshotWeightedContribution * 100.0) / snapshotTotalWeight
            : 0;
        const snapshotUpside = snapshotCurrentPrice > 0
            ? ((snapshotWeightedAverage - snapshotCurrentPrice) / snapshotCurrentPrice)
            : 0;

        snapshotModels.forEach((m, idx) => {
            sheet.getCell(r, 1).value = m.name;

            const vc = sheet.getCell(r, 2);
            vc.value = m.value > 0 ? m.value : { formula: m.formulaRef };
            vc.numFmt = '#,##0';
            applyBorders(vc);

            const wc = sheet.getCell(r, 3);
            wc.value = m.weight;
            wc.numFmt = '0.00';
            wc.alignment = { horizontal: 'center' };
            applyBorders(wc);

            const contribCell = sheet.getCell(r, 4);
            contribCell.value = (m.value > 0 && m.weight > 0) ? (m.value * m.weight) / 100.0 : 0;
            contribCell.numFmt = '#,##0';
            applyBorders(contribCell);

            const upCell = sheet.getCell(r, 5);
            upCell.value = snapshotCurrentPrice > 0 ? ((toNumber(m.value, 0) - snapshotCurrentPrice) / snapshotCurrentPrice) : 0;
            upCell.numFmt = '+0.00%;-0.00%';
            applyBorders(upCell);

            if (idx % 2 === 0) {
                [1, 2, 3, 4, 5].forEach(ci => {
                    sheet.getCell(r, ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                });
            }
            r++;
        });

        r++;
        sheet.getCell(r, 1).value = '★  WEIGHTED AVERAGE INTRINSIC VALUE';
        sheet.getCell(r, 1).font = { bold: true, size: 12, color: { argb: ACCENT } };

        const wavgCell = sheet.getCell(r, 2);
        wavgCell.value = snapshotWeightedAverage;
        wavgCell.numFmt = '#,##0';
        wavgCell.font = { bold: true, size: 13, color: { argb: ACCENT } };
        wavgCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
        applyBorders(wavgCell, 'medium');

        const totalWtCell = sheet.getCell(r, 3);
        totalWtCell.value = snapshotTotalWeight;
        totalWtCell.numFmt = '0.00';
        totalWtCell.font = { bold: true };
        applyBorders(totalWtCell, 'medium');

        const totalUpsideCell = sheet.getCell(r, 5);
        totalUpsideCell.value = snapshotUpside;
        totalUpsideCell.numFmt = '+0.00%;-0.00%';
        totalUpsideCell.font = { bold: true, size: 12 };
        applyBorders(totalUpsideCell, 'medium');

        r += 2;

        // ── Verdict ───────────────────────────────────────────────────────
        sectionHeader(sheet, r, '  INVESTMENT VERDICT', 6);
        r++;

        sheet.getCell(r, 1).value = 'Current Price';
        const cpVCell = sheet.getCell(r, 2);
        cpVCell.value = snapshotCurrentPrice;
        cpVCell.numFmt = '#,##0';
        applyBorders(cpVCell);
        r++;

        sheet.getCell(r, 1).value = 'Analyst Consensus Fair Value';
        const wavgRefCell = sheet.getCell(r, 2);
        wavgRefCell.value = snapshotWeightedAverage;
        wavgRefCell.numFmt = '#,##0';
        wavgRefCell.font = { bold: true };
        applyBorders(wavgRefCell, 'medium');
        r++;

        sheet.getCell(r, 1).value = 'Margin of Safety (Discount to Fair Value)';
        const mosCell = sheet.getCell(r, 2);
        mosCell.value = snapshotWeightedAverage > 0 ? ((snapshotWeightedAverage - snapshotCurrentPrice) / snapshotWeightedAverage) : 0;
        mosCell.numFmt = '+0.00%;-0.00%';
        mosCell.font = { bold: true };
        applyBorders(mosCell, 'medium');
        r++;

        sheet.getCell(r, 1).value = 'Signal (Undervalued if Upside > 15%)';
        const signalCell = sheet.getCell(r, 2);
        signalCell.value = snapshotUpside > 0.15
            ? 'BUY — Undervalued'
            : (snapshotUpside < -0.15 ? 'SELL / Overvalued' : 'HOLD — Fair Value');
        signalCell.font = { bold: true };
        applyBorders(signalCell, 'medium');

        sheet.getColumn(1).width = 42;
        sheet.getColumn(2).width = 24;
        sheet.getColumn(3).width = 14;
        sheet.getColumn(4).width = 26;
        sheet.getColumn(5).width = 20;
    }

    /**
     * Simulates row counter in buildDCFSheet to find the intrinsicRow without writing cells.
     * Must mirror the exact row increments in buildDCFSheet.
     * Verified: intrinsicRow = 42 for both FCFE and FCFF (10-year model).
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private computeDCFIntrinsicRow(_type: 'FCFE' | 'FCFF'): number {
        let r = 5;
        r += 1;      // component header row r++ → 6
        r += 5;      // 5 component rows → 11
        r += 1;      // shares row r++ → 12
        r += 1;      // divider r++ → 13
        // baseRow = r = 13 (no separate r increment for assignment)
        r += 2;      // r+=2 after writing base row → 15 (step2 sectionHeader at 15)
        r += 1;      // r++ after step2 sectionHeader → 16 (discRateRow)
        r += 1;      // r++ after discRate → 17 (growthHighRow)
        r += 1;      // r++ after growthHigh → 18 (growthTermRow)
        r += 2;      // r+=2 after growthTerm → 20 (step3 sectionHeader at 20)
        r += 1;      // r++ after step3 sectionHeader → 21 (proj header row)
        r += 1;      // r++ after proj header → 22 (projDataStart)
        r += PROJ_YEARS; // 10 projection rows each r++ → 31
        r += 1;      // r+=1 blank → 33 (step4 sectionHeader at 33)
        r += 1;      // r++ after step4 sectionHeader → 34 (tvRow)
        r += 1;      // r++ after tvRow → 35 (tvGGRow)
        r += 1;      // r++ after tvGGRow → 36 (pvTvRow)
        r += 2;      // r+=2 after pvTvRow → 38 (step5 sectionHeader at 38)
        r += 1;      // r++ after step5 sectionHeader → 39 (sumPVRow)
        r += 1;      // r++ after sumPVRow → 40 (pvTvRefRow)
        r += 1;      // r++ after pvTvRefRow → 41 (divider)
        r += 1;      // r++ after divider → 42 = intrinsicRow
        return r;    // 42
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SHEET 7 – SECTOR PEERS
    // ═══════════════════════════════════════════════════════════════════════
    private createSectorPeersSheet(sheet: ExcelJS.Worksheet, valuationResults: any) {
        const sp = valuationResults.sector_peers ?? {};
        const comparables = valuationResults?.export?.comparables ?? {};

        const detailedPeers: any[] = comparables?.peers_detailed ?? sp.peers_detail ?? [];
        let peers: any[] = detailedPeers;

        if (peers.length === 0) {
            const pePeers = Array.isArray(comparables?.pe_ttm?.peers) ? comparables.pe_ttm.peers : [];
            const pbPeers = Array.isArray(comparables?.pb?.peers) ? comparables.pb.peers : [];
            const psPeers = Array.isArray(comparables?.ps?.peers) ? comparables.ps.peers : [];
            const pbMap = new Map<string, number>(pbPeers.map((p: any) => [String(p?.symbol ?? '').toUpperCase(), toNumber(p?.pb, 0)]));
            const psMap = new Map<string, number>(psPeers.map((p: any) => [String(p?.symbol ?? '').toUpperCase(), toNumber(p?.ps, 0)]));
            peers = pePeers.map((p: any) => {
                const sym = String(p?.symbol ?? '').toUpperCase();
                return {
                    symbol: sym,
                    market_cap: null,
                    pe_ratio: toNumber(p?.pe, 0),
                    pb_ratio: pbMap.get(sym) ?? null,
                    ps_ratio: psMap.get(sym) ?? null,
                    roe: null,
                    roa: null,
                    sector: comparables?.industry ?? sp.sector ?? '',
                };
            });
        }

        sheet.mergeCells('A1:I1');
        const t = sheet.getCell('A1');
        t.value = 'SECTOR PEERS COMPARISON';
        t.font = { bold: true, size: 15, color: { argb: 'FFFFFF' } };
        t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DARK } };
        t.alignment = { horizontal: 'center', vertical: 'middle' };
        sheet.getRow(1).height = 30;

        let r = 3;
        sectionHeader(sheet, r, '  SECTOR SUMMARY', 9);
        r++;

        const summaryData: [string, any, string][] = [
            ['Sector', comparables?.industry ?? sp.sector ?? 'N/A', ''],
            ['Median P/E', comparables?.pe_ttm?.used ?? sp.median_pe ?? 0, '0.00'],
            ['Median P/B', comparables?.pb?.used ?? sp.median_pb ?? 0, '0.00'],
            ['Median P/S', comparables?.ps?.used ?? 0, '0.00'],
            ['Peers Count', peers.length, '0'],
        ];
        summaryData.forEach(([lbl, val, fmt]) => {
            sheet.getCell(r, 1).value = lbl;
            const vc = sheet.getCell(r, 2);
            vc.value = val;
            if (fmt) vc.numFmt = fmt;
            applyBorders(vc);
            r++;
        });
        r++;

        sectionHeader(sheet, r, '  PEER COMPANIES', 9);
        r++;

        const headers = ['#', 'Symbol', 'Market Cap (Bn VND)', 'P/E', 'P/B', 'P/S', 'ROE (%)', 'ROA (%)', 'Sector'];
        headers.forEach((h, ci) => {
            const c = sheet.getCell(r, ci + 1);
            c.value = h;
            c.font = { bold: true };
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
            c.alignment = { horizontal: 'center', wrapText: true };
            applyBorders(c);
        });
        sheet.getRow(r).height = 24;
        r++;

        if (peers.length === 0) {
            sheet.mergeCells(r, 1, r, 9);
            sheet.getCell(r, 1).value = 'No peer data available.';
            sheet.getCell(r, 1).font = { italic: true, color: { argb: '94A3B8' } };
            sheet.getCell(r, 1).alignment = { horizontal: 'center' };
        } else {
            const peerDataStart = r;
            peers.forEach((p: any, idx: number) => {
                sheet.getCell(r, 1).value = idx + 1;
                sheet.getCell(r, 1).alignment = { horizontal: 'center' };
                applyBorders(sheet.getCell(r, 1));

                sheet.getCell(r, 2).value = p.symbol;
                sheet.getCell(r, 2).font = { bold: true };
                applyBorders(sheet.getCell(r, 2));

                const mc = sheet.getCell(r, 3);
                mc.value = p.market_cap ?? p.marketCap ?? 0;
                mc.numFmt = '#,##0.0';
                applyBorders(mc);

                const pe = sheet.getCell(r, 4);
                pe.value = p.pe_ratio ?? p.pe ?? 0;
                pe.numFmt = '0.00';
                applyBorders(pe);

                const pb = sheet.getCell(r, 5);
                pb.value = p.pb_ratio ?? p.pb ?? 0;
                pb.numFmt = '0.00';
                applyBorders(pb);

                const ps = sheet.getCell(r, 6);
                ps.value = p.ps_ratio ?? p.ps ?? 0;
                ps.numFmt = '0.00';
                applyBorders(ps);

                const roe = sheet.getCell(r, 7);
                roe.value = normalizePercentValue(p.roe ?? 0);
                roe.numFmt = '0.00%';
                applyBorders(roe);

                const roa = sheet.getCell(r, 8);
                roa.value = normalizePercentValue(p.roa ?? 0);
                roa.numFmt = '0.00%';
                applyBorders(roa);

                sheet.getCell(r, 9).value = p.sector ?? '';
                applyBorders(sheet.getCell(r, 9));

                if (idx % 2 === 0) {
                    for (let ci = 1; ci <= 9; ci++) {
                        sheet.getCell(r, ci).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
                    }
                }
                r++;
            });

            const peerDataEnd = r - 1;
            r++;

            // Median row with MEDIAN formulas
            sheet.getCell(r, 1).value = 'MEDIAN';
            sheet.getCell(r, 1).font = { bold: true };
            applyBorders(sheet.getCell(r, 1));

            const medPe = sheet.getCell(r, 4);
            medPe.value = { formula: `=MEDIAN(D${peerDataStart}:D${peerDataEnd})` };
            medPe.numFmt = '0.00';
            medPe.font = { bold: true };
            medPe.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
            applyBorders(medPe, 'medium');

            const medPb = sheet.getCell(r, 5);
            medPb.value = { formula: `=MEDIAN(E${peerDataStart}:E${peerDataEnd})` };
            medPb.numFmt = '0.00';
            medPb.font = { bold: true };
            medPb.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
            applyBorders(medPb, 'medium');

            const medPs = sheet.getCell(r, 6);
            medPs.value = { formula: `=MEDIAN(F${peerDataStart}:F${peerDataEnd})` };
            medPs.numFmt = '0.00';
            medPs.font = { bold: true };
            medPs.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
            applyBorders(medPs, 'medium');

            const medRoe = sheet.getCell(r, 7);
            medRoe.value = { formula: `=MEDIAN(G${peerDataStart}:G${peerDataEnd})` };
            medRoe.numFmt = '0.00%';
            medRoe.font = { bold: true };
            medRoe.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
            applyBorders(medRoe, 'medium');

            const medRoa = sheet.getCell(r, 8);
            medRoa.value = { formula: `=MEDIAN(H${peerDataStart}:H${peerDataEnd})` };
            medRoa.numFmt = '0.00%';
            medRoa.font = { bold: true };
            medRoa.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LIGHT_BG } };
            applyBorders(medRoa, 'medium');
        }

        sheet.getColumn(1).width = 5;
        sheet.getColumn(2).width = 12;
        sheet.getColumn(3).width = 22;
        sheet.getColumn(4).width = 10;
        sheet.getColumn(5).width = 10;
        sheet.getColumn(6).width = 10;
        sheet.getColumn(7).width = 10;
        sheet.getColumn(8).width = 10;
        sheet.getColumn(9).width = 22;
    }
}
