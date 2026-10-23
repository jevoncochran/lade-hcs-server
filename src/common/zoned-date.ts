// Calendar days in the business time zone. Staff think in Tampa days ("rides
// on Oct 21"), but times are stored in UTC, so a day becomes a UTC range.

// The zone's offset from UTC at that instant, in ms (e.g. -4h in summer).
const offsetMs = (instant: Date, timeZone: string) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

// "2026-10-21" → the instant that day starts in the zone. Midnight always
// exists in US zones (clocks change at 2 a.m.).
export const startOfDay = (date: string, timeZone: string): Date => {
  const [year, month, day] = date.split('-').map(Number);
  const midnightUtc = Date.UTC(year, month - 1, day);
  // Two passes: the offset can differ between the guess and the answer on
  // days the clocks change.
  const guess = midnightUtc - offsetMs(new Date(midnightUtc), timeZone);
  return new Date(midnightUtc - offsetMs(new Date(guess), timeZone));
};

// The calendar date ("2026-10-21") of an instant in the zone.
export const dateIn = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone }).format(instant);

// "2026-10-21" + 1 → "2026-10-22".
export const addDays = (date: string, days: number): string => {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
};
