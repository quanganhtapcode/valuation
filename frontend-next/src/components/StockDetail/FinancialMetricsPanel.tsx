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
}

interface FinancialMetricsPanelProps {
    financials: FinancialData;
}

function formatRatio(value?: number, suffix = ''): string {
    if (value === undefined || value === null || value === 0) return '—';
    const normalised = suffix === '%' && Math.abs(value) < 1 ? value * 100 : value;
    return `${normalised.toFixed(suffix === '%' ? 1 : 2)}${suffix}`;
}

export default function FinancialMetricsPanel({ financials }: FinancialMetricsPanelProps) {
    const { lang } = useLanguage();
    const t = translations[lang].detail;
    const groups = [
        {
            title: t.valuation,
            metrics: [
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
                <div>
                    <h3 id="financial-metrics-title" className={styles.sectionTitle}>{t.indicators}</h3>
                    <p className={styles.sectionSubtitle}>{t.ttmData}</p>
                </div>
                <span className={styles.metricsPanelBadge}>TTM</span>
            </div>
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
        </section>
    );
}
