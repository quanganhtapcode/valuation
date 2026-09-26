/**
 * Format number with Vietnamese locale
 */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return value.toLocaleString('en-US', {
        maximumFractionDigits: 2,
        ...options
    });
}

/**
 * Format currency (VND)
 */
export function formatCurrency(value: number): string {
    return formatNumber(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

/**
 * Format percentage change with sign
 */
export function formatPercentChange(value: number): string {
    const sign = value >= 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
}
