// ============ Utility Functions ============

export function parseDateInput(input: string | number | Date | undefined | null): Date | null {
    if (input == null) return null;
    if (input instanceof Date) {
        return isNaN(input.getTime()) ? null : input;
    }

    if (typeof input === 'number') {
        const d = new Date(input);
        return isNaN(d.getTime()) ? null : d;
    }

    let value = String(input).trim();
    if (!value) return null;

    // CafeF style: \/Date(1700000000000)\/
    if (value.includes('/Date(')) {
        const ms = parseInt(value.match(/\d+/)?.[0] || '0', 10);
        const d = new Date(ms);
        return isNaN(d.getTime()) ? null : d;
    }

    // Some sources append timezone like: "Feb 21, 2026, 06:09 PM | +03:02"
    if (value.includes('|')) {
        value = value.split('|')[0]?.trim() || value;
    }

    // Try native parsing first (ISO, RFC2822, etc.)
    let d = new Date(value);
    if (!isNaN(d.getTime())) return d;

    // Try dd/mm/yyyy[ hh:mm[:ss]] (common Vietnamese format)
    const m = value.match(
        /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[\sT](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (m) {
        const day = parseInt(m[1], 10);
        const month = parseInt(m[2], 10) - 1;
        const year = parseInt(m[3], 10);
        const hour = m[4] ? parseInt(m[4], 10) : 0;
        const minute = m[5] ? parseInt(m[5], 10) : 0;
        const second = m[6] ? parseInt(m[6], 10) : 0;
        d = new Date(year, month, day, hour, minute, second);
        return isNaN(d.getTime()) ? null : d;
    }

    return null;
}

/**
 * Format date from various formats (including CafeF /Date()/ format)
 */
export function formatDate(dateStr: string | number | undefined): string {
    if (!dateStr) return '';

    try {
        let date: Date;

        if (typeof dateStr === 'string' && dateStr.includes('/Date(')) {
            const ms = parseInt(dateStr.match(/\d+/)?.[0] || '0');
            date = new Date(ms);
        } else {
            date = new Date(dateStr);
        }

        return date.toLocaleString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
        });
    } catch {
        return '';
    }
}

/**
 * Format time as relative text (e.g. "3 giờ trước", "2 ngày trước").
 */
export function formatRelativeTime(
    input: string | number | Date | undefined,
    locale: string = 'vi-VN'
): string {
    const date = parseDateInput(input);
    if (!date) return '';

    const now = new Date();
    const diffSeconds = Math.round((date.getTime() - now.getTime()) / 1000);
    const abs = Math.abs(diffSeconds);

    if (abs < 5) return locale.startsWith('vi') ? 'vừa xong' : 'just now';

    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

    const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
        ['year', 60 * 60 * 24 * 365],
        ['month', 60 * 60 * 24 * 30],
        ['week', 60 * 60 * 24 * 7],
        ['day', 60 * 60 * 24],
        ['hour', 60 * 60],
        ['minute', 60],
        ['second', 1],
    ];

    for (const [unit, secondsInUnit] of units) {
        if (abs >= secondsInUnit || unit === 'second') {
            const value = Math.round(diffSeconds / secondsInUnit);
            return rtf.format(value, unit);
        }
    }

    return rtf.format(diffSeconds, 'second');
}
