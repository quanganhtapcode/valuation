import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDate, parseDateInput } from './dateFormatters';

test('Vietnamese dates take precedence over ambiguous native month/day parsing', () => {
    const date = parseDateInput('03/04/2026 05:06:07');
    assert.ok(date);
    assert.deepEqual([
        date.getFullYear(), date.getMonth() + 1, date.getDate(),
        date.getHours(), date.getMinutes(), date.getSeconds(),
    ], [2026, 4, 3, 5, 6, 7]);
    assert.equal(parseDateInput('13/04/2026')?.getDate(), 13);
});

test('invalid calendar dates and times cannot silently roll into another day', () => {
    for (const value of ['31/02/2026', '29/02/2025', '31/04/2026',
        '01/13/2026', '00/04/2026', '12/12/2026 24:00',
        '12/12/2026 10:60', '12/12/2026 10:30:60']) {
        assert.equal(parseDateInput(value), null, value);
    }
    assert.equal(parseDateInput('29/02/2024')?.getDate(), 29);
});

test('CafeF timestamps preserve the epoch sign and reject malformed wrappers', () => {
    assert.equal(parseDateInput('/Date(-1000+0700)/')?.getTime(), -1000);
    assert.equal(parseDateInput('/Date(1700000000000)/')?.getTime(), 1700000000000);
    for (const value of ['/Date(nope)/', '/Date()/', '/Date(123junk)/']) {
        assert.equal(parseDateInput(value), null, value);
    }
});

test('display dates share the parser and retain numeric epoch zero', () => {
    assert.notEqual(formatDate(0), '');
    assert.equal(formatDate('not a date'), '');
    assert.equal(formatDate('31/02/2026'), '');
    assert.equal(formatDate('03/04/2026'), formatDate(new Date(2026, 3, 3).getTime()));
    assert.equal(parseDateInput('2026-04-03T05:06:07Z')?.toISOString(), '2026-04-03T05:06:07.000Z');
    assert.equal(parseDateInput(new Date(NaN)), null);
});
