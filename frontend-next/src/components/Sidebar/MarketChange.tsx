type MarketChangeProps = {
    value?: number | null;
    unit?: string;
    title?: string;
};

/** Signed market movement shared by sidebar feeds. */
export default function MarketChange({ value, unit = '%', title }: MarketChangeProps) {
    const rounded = typeof value === 'number' && Number.isFinite(value)
        ? Number(value.toFixed(2))
        : null;
    const color = rounded === null || rounded === 0
        ? 'text-gray-500 dark:text-gray-400'
        : rounded > 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-500 dark:text-rose-400';

    return (
        <span title={title} className={`inline-flex items-center text-xs font-semibold tabular-nums whitespace-nowrap ${color}`}>
            {rounded === null ? '—' : `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}${unit}`}
        </span>
    );
}
