import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarWeek, shiftCalendarDate, summarizeEventDay } from './eventCalendar';

test('Monday to Sunday weeks cross month, year and leap-day boundaries', () => {
    assert.deepEqual(calendarWeek('2026-11-01'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    assert.equal(calendarWeek('2027-01-01')[0], '2026-12-28');
    assert.equal(shiftCalendarDate('2024-02-28', 1), '2024-02-29');
    assert.equal(shiftCalendarDate('2026-10-26', -7), '2026-10-19');
});

test('day cards group by event date, count top types and preserve other events', () => {
    const item = (eventNameVi: string, displayDate1: string | null = '2026-10-26T00:00:00') => ({ eventNameVi, eventNameEn: `${eventNameVi} EN`, displayDate1 });
    const events = [item('A'), item('A'), item('B'), item('C'), item('D'), item('A', '2026-10-27T00:00:00'), item('A', null)];
    const day = summarizeEventDay(events, '2026-10-26', 'vi');
    assert.equal(day.events.length, 5);
    assert.deepEqual(day.groups, [{ label: 'A', count: 2 }, { label: 'B', count: 1 }]);
    assert.equal(day.other, 2);
    assert.equal(summarizeEventDay(events, '2026-10-26', 'en').groups[0].label, 'A EN');
    assert.deepEqual(summarizeEventDay(events, '2026-10-28', 'vi'), { events: [], groups: [], other: 0 });
});

test('includes secondary calendar dates without duplicating same-day events', () => {
    const events = [
        { eventNameVi: 'Meeting', displayDate1: '2026-12-01T00:00:00', displayDate2: '2026-10-30T00:00:00' },
        { eventNameVi: 'Dividend', displayDate1: '2026-10-30T00:00:00', displayDate2: '2026-10-30T00:00:00' },
    ];
    assert.equal(summarizeEventDay(events, '2026-10-30', 'vi').events.length, 2);
    assert.equal(summarizeEventDay(events, '2026-12-01', 'vi').events.length, 1);
});
