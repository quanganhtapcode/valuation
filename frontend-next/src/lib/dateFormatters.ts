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
        const timestamp = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
        if (!timestamp) return null;
        const d = new Date(Number(timestamp[1]));
        return isNaN(d.getTime()) ? null : d;
    }

    // Some sources append timezone like: "Feb 21, 2026, 06:09 PM | +03:02"
    if (value.includes('|')) {
        value = value.split('|')[0]?.trim() || value;
    }

    // Parse Vietnamese dates before native parsing, which treats ambiguous
    // slash-separated dates as mm/dd/yyyy in several browsers.
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
        const d = new Date(year, month, day, hour, minute, second);
        if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day
            || d.getHours() !== hour || d.getMinutes() !== minute || d.getSeconds() !== second) {
            return null;
        }
        return d;
    }

    // Native parsing handles ISO, RFC2822 and named-month dates.
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}

/**
 * Format date from various formats (including CafeF /Date()/ format)
 */
export function formatDate(dateStr: string | number | undefined): string {
    const date = parseDateInput(dateStr);
    if (!date) return '';

    try {
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
