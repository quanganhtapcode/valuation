import styles from '../../app/stock/[symbol]/page.module.css';
import { useLanguage } from '@/lib/languageContext';
import { translations } from '@/lib/translations';

interface FinancialData {
    pe?: number;
    pb?: number;
    roe?: number;
    roa?: number;
    netProfitMargin?: number;
    grossMargin?: number;
    debtToEquity?: number;
    currentRatio?: number;
    marketCap?: number;
    sharesOutstanding?: number;
}

interface FinancialMetricsPanelProps {
    financials: FinancialData;
    price?: number;
    targetPrice?: number | null;
    companyDescription?: string;
    companyMeta?: string;
    isDescriptionExpanded?: boolean;
    onDescriptionExpandedChange?: (expanded: boolean) => void;
}

function formatRatio(value?: number, suffix = ''): string {
    if (value === undefined || value === null || value === 0) return '—';
    const normalised = suffix === '%' && Math.abs(value) < 1 ? value * 100 : value;
    return `${normalised.toFixed(suffix === '%' ? 1 : 2)}${suffix}`;
}

function formatCompact(value: number | undefined, lang: 'vi' | 'en'): string {
    if (!value) return '—';
    if (value >= 1_000_000_000_000) return `${(value / 1_000_000_000_000).toFixed(1)} ${lang === 'vi' ? 'nghìn tỷ VND' : 'trillion VND'}`;
    if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} ${lang === 'vi' ? 'tỷ VND' : 'bil VND'}`;
    return value.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { maximumFractionDigits: 0 });
}

export default function FinancialMetricsPanel({
    financials,
    price,
    targetPrice,
    companyDescription,
    companyMeta,
    isDescriptionExpanded = false,
    onDescriptionExpandedChange,
}: FinancialMetricsPanelProps) {
    const { lang } = useLanguage();
    const t = translations[lang].detail;
    const upside = targetPrice && price && price > 0
        ? ((targetPrice - price) / price) * 100
        : null;
    const recommendation = upside === null
        ? null
        : upside >= 15 ? (lang === 'vi' ? 'MUA' : 'BUY') : upside >= 0 ? (lang === 'vi' ? 'THEO DÕI' : 'HOLD') : (lang === 'vi' ? 'GIẢM TỶ TRỌNG' : 'REDUCE');
    const recommendationClass = upside !== null && upside >= 15
        ? 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-950/30 dark:border-emerald-900'
        : upside !== null && upside >= 0
            ? 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-950/30 dark:border-amber-900'
            : 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-400 dark:bg-rose-950/30 dark:border-rose-900';
    const groups = [
        {
            title: t.valuation,
            metrics: [
                [lang === 'vi' ? 'Vốn hóa' : 'Market cap', formatCompact(financials.marketCap, lang)],
                [lang === 'vi' ? 'KLCP lưu hành' : 'Shares outstanding', formatCompact(financials.sharesOutstanding, lang)],
                ['P/E (TTM)', formatRatio(financials.pe)],
                ['P/B (TTM)', formatRatio(financials.pb)],
            ],
        },
        {
            title: t.profitability,
            metrics: [
                ['ROE', formatRatio(financials.roe, '%')],
                ['ROA', formatRatio(financials.roa, '%')],
                [t.netMargin, formatRatio(financials.netProfitMargin, '%')],
                [t.grossMargin, formatRatio(financials.grossMargin, '%')],
            ],
        },
        {
            title: t.financialHealth,
            metrics: [
                [t.debtToEquity, formatRatio(financials.debtToEquity)],
                [t.currentRatio, formatRatio(financials.currentRatio)],
            ],
        },
    ];

    return (
        <section className={`${styles.section} ${styles.sectionMetrics} ${styles.metricsPanel}`} aria-labelledby="financial-metrics-title">
            <div className={styles.metricsPanelHeader}>
                <h3 id="financial-metrics-title" className={styles.sectionTitle}>{t.indicators}</h3>
            </div>
            {targetPrice && upside !== null && (
                <div className={styles.indicatorHighlight}>
                    <div className={styles.indicatorHighlightTop}>
                        <span>{lang === 'vi' ? 'Định giá tham khảo' : 'Reference valuation'}</span>
                        {recommendation && <span className={`${styles.recommendationBadge} ${recommendationClass}`}>{recommendation}</span>}
                    </div>
                    <dl>
                        <div>
                            <dt>{lang === 'vi' ? 'Giá mục tiêu' : 'Target price'}</dt>
                            <dd>{formatCompact(targetPrice, lang)}</dd>
                        </div>
                        <div>
                            <dt>{lang === 'vi' ? 'Tiềm năng tăng/giảm' : 'Upside / downside'}</dt>
                            <dd className={upside >= 0 ? styles.positiveMetric : styles.negativeMetric}>
                                {upside >= 0 ? '+' : ''}{upside.toFixed(1)}%
                            </dd>
                        </div>
                    </dl>
                </div>
            )}
            <div className={styles.metricGroups}>
                {groups.map((group) => (
                    <div key={group.title} className={styles.metricGroup}>
                        <h4>{group.title}</h4>
                        <dl>
                            {group.metrics.map(([label, value]) => (
                                <div key={label} className={styles.metricRow}>
                                    <dt>{label}</dt>
                                    <dd>{value}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>
                ))}
            </div>
            <div className={styles.metricsProfile}>
                <div className={styles.metricsProfileHeader}>
                    <h4>{t.companyProfile}</h4>
                    {companyMeta && <span>{companyMeta}</span>}
                </div>
                {companyDescription ? (
                    <>
                        <p>
                            {isDescriptionExpanded || companyDescription.length <= 220
                                ? companyDescription
                                : `${companyDescription.slice(0, 150)}…`}
                        </p>
                        {companyDescription.length > 150 && onDescriptionExpandedChange && (
                            <button type="button" onClick={() => onDescriptionExpandedChange(!isDescriptionExpanded)}>
                                {isDescriptionExpanded ? t.showLess : t.showMore}
                            </button>
                        )}
                    </>
                ) : (
                    <p className={styles.metricsProfileEmpty}>{t.profileUpdating}</p>
                )}
            </div>
        </section>
    );
}
