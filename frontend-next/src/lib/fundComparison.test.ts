import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareFundHistories } from './fundComparison';

test('rebases unequal publication schedules over the common history window', () => {
    const rows = compareFundHistories({
        A: [{ date: '2026-01-01', nav: 100 }, { date: '2026-01-03', nav: 110 }, { date: '2026-01-06', nav: 120 }],
        B: [{ date: '2026-01-02', nav: 200 }, { date: '2026-01-04', nav: 220 }, { date: '2026-01-05', nav: 240 }],
    }, 'all');
    assert.equal(rows[0].time, Date.parse('2026-01-02T00:00:00Z'));
    assert.equal(rows[0].A, 0);
    assert.equal(rows[0].B, 0);
    assert.equal(rows.at(-1)!.time, Date.parse('2026-01-05T00:00:00Z'));
    assert.ok(Math.abs(rows.at(-1)!.A - 10) < 1e-9);
    assert.ok(Math.abs(rows.at(-1)!.B - 20) < 1e-9);
});

test('does not fabricate a comparison for histories without an overlap', () => {
    assert.deepEqual(compareFundHistories({
        A: [{ date: '2025-01-01', nav: 100 }, { date: '2025-02-01', nav: 110 }],
        B: [{ date: '2026-01-01', nav: 200 }, { date: '2026-02-01', nav: 220 }],
    }, 'all'), []);
});

test('clamps month-end ranges and uses the last NAV before the boundary', () => {
    const rows = compareFundHistories({ A: [
        { date: '2026-02-27', nav: 100 }, { date: '2026-03-01', nav: 110 }, { date: '2026-03-31', nav: 120 },
    ] }, '1m');
    assert.equal(rows[0].time, Date.parse('2026-02-28T00:00:00Z'));
    assert.equal(rows[0].A, 0);
    assert.ok(Math.abs(rows.at(-1)!.A - 20) < 1e-9);
});

test('handles empty histories and invalid NAVs', () => {
    assert.deepEqual(compareFundHistories({}, 'all'), []);
    assert.deepEqual(compareFundHistories({ A: [{ date: '2026-01-01', nav: 0 }, { date: '2026-02-01', nav: 10 }] }, 'all'), []);
});
