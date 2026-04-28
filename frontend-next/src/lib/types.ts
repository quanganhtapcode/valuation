/**
 * TypeScript Types for Stock Data
 * These types correspond to SQLite database schema
 */

// ==================== COMPANY DATA ====================

/**
 * Company information from 'companies' table
 */
export interface Company {
    symbol: string;
    name: string;
    exchange: 'HOSE' | 'HNX' | 'UPCOM' | string;
    industry: string;
    company_profile?: string;
    updated_at?: string;
}

/**
 * Stock overview from 'stock_overview' table
 * Contains latest snapshot of all key metrics
 */
export interface StockOverview {
    symbol: string;
    exchange?: string;
    industry?: string;

    // Valuation Ratios
    pe?: number;
    pb?: number;
    ps?: number;
    pcf?: number;
    ev_ebitda?: number;

    // Per Share Metrics
    eps_ttm?: number;
    bvps?: number;
    dividend_per_share?: number;

    // Profitability Ratios
    roe?: number;
    roa?: number;
    roic?: number;
    net_profit_margin?: number;
    gross_margin?: number;
    operating_margin?: number;

    // Liquidity & Leverage
    current_ratio?: number;
    quick_ratio?: number;
    cash_ratio?: number;
    debt_to_equity?: number;
    interest_coverage?: number;

    // Efficiency Ratios
    asset_turnover?: number;
    inventory_turnover?: number;
    receivables_turnover?: number;

    // Financial Snapshot (TTM/Year)
    revenue?: number;
    net_income?: number;
    total_assets?: number;
    total_equity?: number;
    total_debt?: number;
    cash?: number;
    ebitda?: number;

    // Market Data
    market_cap?: number;
    shares_outstanding?: number;
    current_price?: number;

    updated_at?: string;
}

// ==================== FINANCIAL STATEMENTS ====================

/**
 * Base interface for all financial report items
 */
export interface FinancialReportBase {
    year?: number;
    quarter?: number;  // 0 for annual reports
    [key: string]: any;  // Dynamic fields from financial statements
}

/**
 * Income Statement specific fields (common ones)
 */
export interface IncomeStatement extends FinancialReportBase {
    revenue?: number;
    cost_of_goods_sold?: number;
    gross_profit?: number;
    operating_expenses?: number;
    operating_income?: number;
    interest_expense?: number;
    pretax_income?: number;
    income_tax?: number;
    net_income?: number;
    eps?: number;
}

/**
 * Balance Sheet specific fields (common ones)
 */
export interface BalanceSheet extends FinancialReportBase {
    total_assets?: number;
    current_assets?: number;
    cash_and_equivalents?: number;
    accounts_receivable?: number;
    inventory?: number;
    fixed_assets?: number;
    total_liabilities?: number;
    current_liabilities?: number;
    long_term_debt?: number;
    total_equity?: number;
    retained_earnings?: number;
}

/**
 * Cash Flow Statement specific fields (common ones)
 */
export interface CashFlowStatement extends FinancialReportBase {
    operating_cash_flow?: number;
    investing_cash_flow?: number;
    financing_cash_flow?: number;
    net_change_in_cash?: number;
    depreciation?: number;
    capital_expenditure?: number;
    dividends_paid?: number;
    free_cash_flow?: number;
}

/**
 * Financial Ratios
 */
export interface FinancialRatios extends FinancialReportBase {
    // Valuation
    pe?: number;
    pb?: number;
    ps?: number;
    ev_ebitda?: number;

    // Profitability
    roe?: number;
    roa?: number;
    roic?: number;
    gross_margin?: number;
    operating_margin?: number;
    net_margin?: number;

    // Liquidity
    current_ratio?: number;
    quick_ratio?: number;
    cash_ratio?: number;

    // Leverage
    debt_to_equity?: number;
    debt_to_assets?: number;
    interest_coverage?: number;

    // Efficiency
    asset_turnover?: number;
    inventory_turnover?: number;
    receivables_turnover?: number;
    days_inventory?: number;
    days_receivables?: number;
    days_payables?: number;
}

// ==================== PRICE DATA ====================

/**
 * OHLCV Price Data
 */
export interface PriceData {
    time: string;  // YYYY-MM-DD format
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

/**
 * Real-time price data (from trading session)
 */
export interface RealtimePrice {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    open: number;
    high: number;
    low: number;
    volume: number;
    value: number;
    ceiling: number;
    floor: number;
    ref: number;
    time?: string;
}

// ==================== API RESPONSE TYPES ====================

export interface APIResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
    cached?: boolean;
}

export interface PaginatedResponse<T> {
    success: boolean;
    data: T[];
    total: number;
    page: number;
    pageSize: number;
}

// ==================== DATABASE STATS ====================

export interface DatabaseStats {
    companies: number;
    overviews: number;
    financial_statements: number;
    price_records: number;
    db_size_mb: number;
}

export interface DataFreshness {
    overview_updated?: string;
    financials_updated?: string;
    latest_price_date?: string;
}

// ==================== SEARCH & FILTER ====================

export interface SearchResult {
    symbol: string;
    name: string;
    exchange: string;
    industry?: string;
}

export interface StockListItem {
    symbol: string;
    name: string;
    exchange: string;
    industry?: string;
    pe?: number;
    pb?: number;
    market_cap?: number;
}

// ==================== VALUATION MODELS ====================

export interface DCFInputs {
    symbol: string;
    revenue: number;
    revenueGrowth: number[];  // Array of growth rates for projection years
    operatingMargin: number;
    taxRate: number;
    capexRatio: number;
    workingCapitalRatio: number;
    wacc: number;
    terminalGrowth: number;
    sharesOutstanding: number;
}

export interface DCFResult {
    enterpriseValue: number;
    equityValue: number;
    fairValuePerShare: number;
    currentPrice: number;
    upside: number;
    projections: {
        year: number;
        revenue: number;
        ebit: number;
        fcf: number;
        discountedFcf: number;
    }[];
}

export interface MultiplesValuation {
    symbol: string;
    pe: number;
    pb: number;
    ps: number;
    ev_ebitda: number;
    industry_pe?: number;
    industry_pb?: number;
    fair_value_pe?: number;
    fair_value_pb?: number;
}

// ==================== HISTORICAL CHART DATA ====================

/** One period record returned by /api/historical-chart-data/<symbol> */
export interface HistoricalChartRecord {
    period: string;           // e.g. "Q1 '24" or "2024"
    roe: number | null;
    roa: number | null;
    pe: number | null;
    pb: number | null;
    currentRatio: number | null;
    quickRatio: number | null;
    cashRatio: number | null;
    nim: number | null;
    netMargin: number | null;
}

export interface HistoricalChartData {
    symbol: string;
    period: string;
    count: number;
    records: HistoricalChartRecord[];  // oldest → newest
}

// ==================== STOCK API RESPONSE (/api/stock/:symbol) ====================

/**
 * Shape returned by backend /api/stock/:symbol (from _get_data_from_db)
 * All fields are optional — DB coverage varies by symbol.
 */
export interface StockApiData extends StockOverview {
    name?: string;
    company_name?: string;
    sector?: string;
    data_source?: string;
    data_period?: 'year' | 'quarter';
    success?: boolean;

    // Aliases kept for backward compat
    pe_ratio?: number;
    pb_ratio?: number;
    profit_growth?: number;
    revenue_growth?: number;
    gross_margin?: number;
    net_profit_margin?: number;
    debt_to_equity?: number;
    eps_ttm?: number;
    eps?: number;
    bvps?: number;
    dividend_per_share?: number;

    // Price data (populated when fetch_price=true or from DB)
    price?: number;
    close?: number;
    current_price?: number;
    price_change?: number;
    price_change_percent?: number;

    // Chart series from ratio_wide
    years?: string[];
    roe_data?: number[];
    roa_data?: number[];
    pe_ratio_data?: number[];
    pb_ratio_data?: number[];
    ps_ratio_data?: number[];
    revenue_data?: number[];
    profit_data?: number[];
    current_ratio_data?: number[];
    quick_ratio_data?: number[];
    debt_to_equity_data?: number[];
    nim_data?: number[];
    casa_data?: number[];
    npl_data?: number[];

    // Banking metrics
    nim?: number;
    casa?: number;
    npl_ratio?: number;
    ldr?: number;
    cof?: number;
    cir?: number;

    // Company description
    overview?: { description?: string };
}

// ==================== VALUATION API RESPONSE ====================

export interface ValuationModelResult {
    fcfe?: number;
    fcff?: number;
    justified_pe?: number;
    justified_pb?: number;
    graham?: number;
    justified_ps?: number;
    weighted_average?: number;
}

export interface ValuationScenario {
    valuations: ValuationModelResult;
    upside_pct?: number;
    assumptions?: {
        growth?: number;
        wacc?: number;
        required_return?: number;
    };
}

export interface WaccSuggestion {
    wacc: number;
    ke: number;
    beta: number;
    rf: number;
    erp: number;
    is_fallback: boolean;
    beta_source: string;
    note?: string;
}

export interface ValuationResult {
    success: boolean;
    symbol?: string;
    wacc_used?: number;
    growth_used?: number;
    wacc_suggestion?: WaccSuggestion;
    valuations?: ValuationModelResult;
    fcfe_details?: { inputs?: Record<string, unknown>; [key: string]: unknown };
    fcff_details?: { inputs?: Record<string, unknown>; [key: string]: unknown };
    upside_pct?: number;
    recommendation?: string;
    scenarios?: {
        bear?: ValuationScenario;
        base?: ValuationScenario;
        bull?: ValuationScenario;
    };
    metrics?: StockApiData;
    quality?: {
        score: number;
        grade: string;
        raw_points: number;
        max_points: number;
        checks: Array<{ name: string; passed: boolean; points: number; max_points: number; detail: string }>;
    } | null;
    inputs?: {
        current_price?: number;
        eps_ttm?: number;
        eps_history_yearly?: Array<{ year: number; eps: number }>;
        wacc_used?: number;
        growth_used?: number;
        is_bank?: boolean;
        [key: string]: unknown;
    };
    export?: {
        market?: { current_price?: number; current_price_source?: string };
        comparables?: Record<string, unknown>;
        calculation?: Record<string, unknown>;
        inputs_sources?: Record<string, unknown>;
        scenarios?: Record<string, unknown>;
        quality?: Record<string, unknown> | null;
        [key: string]: unknown;
    };
}

// ==================== NEWS ====================

export interface StockNews {
    Title: string;
    Link?: string;
    NewsUrl?: string;
    ImageThumb?: string;
    Avatar?: string;
    PostDate?: string;
    PublishDate?: string;
    Symbol?: string;
}
