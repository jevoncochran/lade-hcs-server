import { addDays, dateIn, startOfDay } from './zoned-date.js';

const ZONE = 'America/New_York';

describe('zoned dates', () => {
  it('finds midnight in summer (EDT, UTC-4) and winter (EST, UTC-5)', () => {
    expect(startOfDay('2026-07-04', ZONE).toISOString()).toBe(
      '2026-07-04T04:00:00.000Z',
    );
    expect(startOfDay('2026-12-25', ZONE).toISOString()).toBe(
      '2026-12-25T05:00:00.000Z',
    );
  });

  it('handles the days the clocks change', () => {
    // Clocks go back 2026-11-01 and forward 2026-03-08, both at 2 a.m.
    expect(startOfDay('2026-11-01', ZONE).toISOString()).toBe(
      '2026-11-01T04:00:00.000Z',
    );
    expect(startOfDay('2026-11-02', ZONE).toISOString()).toBe(
      '2026-11-02T05:00:00.000Z',
    );
    expect(startOfDay('2026-03-08', ZONE).toISOString()).toBe(
      '2026-03-08T05:00:00.000Z',
    );
    expect(startOfDay('2026-03-09', ZONE).toISOString()).toBe(
      '2026-03-09T04:00:00.000Z',
    );
  });

  it("gives an instant's local date", () => {
    // 11:30 p.m. in Tampa is already the next day in UTC.
    expect(dateIn(new Date('2026-10-22T03:30:00Z'), ZONE)).toBe('2026-10-21');
    expect(dateIn(new Date('2026-10-22T04:30:00Z'), ZONE)).toBe('2026-10-22');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
