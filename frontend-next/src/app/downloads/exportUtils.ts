import ExcelJS from 'exceljs';

import {
    DATE_FIELD_CANDIDATES,
    DATE_FIELD_HINT,
    type ExportFormat,
    type FlatRow,
} from './config';

export async function fetchJson(endpoint: string): Promise<unknown> {
    const res = await fetch(endpoint, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

export function triggerBlobDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export function valueToString(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    return JSON.stringify(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function flattenObjectWithoutArrays(input: Record<string, unknown>, prefix = ''): FlatRow {
    const out: FlatRow = {};
    for (const [key, value] of Object.entries(input)) {
        const k = prefix ? `${prefix}.${key}` : key;
        if (Array.isArray(value)) continue;
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            out[k] = value;
            continue;
        }
        if (isObjectRecord(value)) {
            Object.assign(out, flattenObjectWithoutArrays(value, k));
            continue;
        }
        out[k] = String(value);
    }
    return out;
}

function flattenObject(input: Record<string, unknown>, prefix = ''): FlatRow {
    const out: FlatRow = {};
    for (const [key, value] of Object.entries(input)) {
        const k = prefix ? `${prefix}.${key}` : key;
        if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            out[k] = value;
            continue;
        }
        if (Array.isArray(value)) {
            out[k] = JSON.stringify(value);
            continue;
        }
        if (typeof value === 'object') {
            Object.assign(out, flattenObject(value as Record<string, unknown>, k));
            continue;
        }
        out[k] = String(value);
    }
    return out;
}

function expandSeriesArrayToRows(items: unknown[]): FlatRow[] | null {
    if (!items.every(isObjectRecord)) return null;
    if (!items.every(item => Array.isArray(item.data))) return null;

    const rows: FlatRow[] = [];
    for (const item of items) {
        const { data, ...meta } = item;
        const metaFlat = flattenObject(meta);
        const points = Array.isArray(data) ? data : [];
        if (points.length === 0) {
            rows.push(metaFlat);
            continue;
        }
        for (const point of points) {
            if (isObjectRecord(point)) {
                rows.push({ ...metaFlat, ...flattenObject(point) });
            } else {
                rows.push({ ...metaFlat, value: valueToString(point) });
            }
        }
    }
    return rows;
}

function expandNestedArrayFieldToRows(items: unknown[]): FlatRow[] | null {
    if (!items.every(isObjectRecord)) return null;
    const rows: FlatRow[] = [];
    let hasExpanded = false;

    for (const item of items) {
        const arrayEntries = Object.entries(item).filter(([, value]) => Array.isArray(value));
        if (arrayEntries.length !== 1) {
            rows.push(flattenObject(item));
            continue;
        }

        const [arrayKey, nestedItems] = arrayEntries[0] as [string, unknown[]];
        const baseRow = flattenObjectWithoutArrays(item);

        if (nestedItems.length === 0) {
            rows.push(baseRow);
            continue;
        }

        hasExpanded = true;
        for (const nested of nestedItems) {
            if (isObjectRecord(nested)) {
                rows.push({ ...baseRow, ...flattenObject(nested) });
            } else {
                rows.push({ ...baseRow, [arrayKey]: valueToString(nested) });
            }
        }
    }

    return hasExpanded ? rows : null;
}

export function normalizeToRows(payload: unknown): FlatRow[] {
    if (Array.isArray(payload)) {
        const expanded = expandSeriesArrayToRows(payload);
        if (expanded) return expanded;
        const expandedNested = expandNestedArrayFieldToRows(payload);
        if (expandedNested) return expandedNested;
        return payload.map((item, idx) => {
            if (isObjectRecord(item)) return flattenObject(item);
            return { value: valueToString(item), index: idx };
        });
    }
    if (isObjectRecord(payload)) {
        const obj = payload as Record<string, unknown>;
        if (Array.isArray(obj.data)) {
            return (obj.data as unknown[]).map((item, idx) => {
                if (isObjectRecord(item)) return flattenObject(item);
                return { value: valueToString(item), index: idx };
            });
        }

        const arrayKey = DATE_FIELD_CANDIDATES
            .map(c => Object.keys(obj).find(k => k.toLowerCase() === c.toLowerCase()))
            .find(Boolean)
            || Object.keys(obj).find(k => Array.isArray(obj[k]) && (obj[k] as unknown[]).length > 0);
        if (arrayKey && Array.isArray(obj[arrayKey])) {
            const expanded = expandSeriesArrayToRows(obj[arrayKey] as unknown[]);
            if (expanded) return expanded;
            const expandedNested = expandNestedArrayFieldToRows(obj[arrayKey] as unknown[]);
            if (expandedNested) return expandedNested;
            return (obj[arrayKey] as unknown[]).map((item, idx) => {
                if (isObjectRecord(item)) return flattenObject(item);
                return { value: valueToString(item), index: idx };
            });
        }

        const isRecordMap = Object.values(obj).every(v => v && typeof v === 'object' && !Array.isArray(v));
        if (isRecordMap) return Object.entries(obj).map(([key, value]) => ({ key, ...flattenObject(value as Record<string, unknown>) }));
        return [flattenObject(obj)];
    }
    return [{ value: valueToString(payload) }];
}

export function getColumns(rows: FlatRow[]): string[] {
    const set = new Set<string>();
    rows.forEach(r => Object.keys(r).forEach(k => set.add(k)));
    return Array.from(set);
}

export function guessType(rows: FlatRow[], col: string): string {
    const s = rows.map(r => r[col]).find(v => v !== null && v !== undefined && v !== '');
    if (s === undefined) return '-';
    if (typeof s === 'number') return 'number';
    if (typeof s === 'boolean') return 'boolean';
    if (typeof s === 'string' && !Number.isNaN(Date.parse(s))) return 'date';
    return 'string';
}

export function detectDateField(rows: FlatRow[], columns: string[]): string | null {
    const hinted = columns.find(c => DATE_FIELD_HINT.test(c));
    if (hinted) return hinted;
    for (const col of columns) {
        const samples = rows.map(r => r[col]).filter((v): v is string => typeof v === 'string').slice(0, 20);
        if (samples.length > 0 && samples.filter(v => !Number.isNaN(Date.parse(v))).length >= Math.ceil(samples.length * 0.7)) return col;
    }
    return null;
}

export function filterByDate(rows: FlatRow[], field: string | null, from: string, to: string): FlatRow[] {
    if (!field || (!from && !to)) return rows;
    const fromTs = from ? new Date(from).getTime() : -Infinity;
    const toTs = to ? new Date(`${to}T23:59:59`).getTime() : Infinity;
    return rows.filter(r => {
        const v = r[field];
        if (typeof v !== 'string' && typeof v !== 'number') return false;
        const ts = new Date(v).getTime();
        return !Number.isNaN(ts) && ts >= fromTs && ts <= toTs;
    });
}

export function toCsv(rows: FlatRow[], cols: string[]): string {
    const esc = (v: unknown) => `"${valueToString(v).replace(/"/g, '""')}"`;
    return '\uFEFF' + [cols.map(esc).join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n');
}

export async function toXlsxBuf(rows: FlatRow[], cols: string[], sheet = 'Data'): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(sheet.slice(0, 31));
    ws.addRow(cols);
    rows.forEach(r => ws.addRow(cols.map(c => r[c] ?? '')));
    ws.getRow(1).font = { bold: true };
    ws.columns = cols.map(c => ({ header: c, key: c, width: Math.min(Math.max(c.length + 4, 14), 40) }));
    return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export async function doExport(rows: FlatRow[], cols: string[], format: ExportFormat, filename: string) {
    if (format === 'CSV') {
        triggerBlobDownload(new Blob([toCsv(rows, cols)], { type: 'text/csv;charset=utf-8' }), filename);
        return;
    }
    triggerBlobDownload(
        new Blob([await toXlsxBuf(rows, cols)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
        filename,
    );
}
