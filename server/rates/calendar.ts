/**
 * Business-day calendars for interest-rate benchmarks (oracle architecture section 5).
 *
 * Weekends and listed holidays are never business days, so they never make a value stale.
 * Past years were checked against the gaps in each source's own history (SOFR 2025-2026,
 * KESONIA Sept 2025 to Oct 2026). Future dates marked provisional follow announced rules
 * (Eid dates depend on the moon; Kenya also gazettes one-off holidays at short notice), so
 * an unexpected gap is reported as DELAYED and an operator can add the date here.
 */
import type { CalendarId } from "@shared/rates/benchmarks";

type HolidayList = { confirmed: string[]; provisional: string[] };

// US government securities market (SIFMA recommendation), which is when SOFR is published.
const US_FED: HolidayList = {
  confirmed: [
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01",
    "2025-10-13", "2025-11-11", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
    "2026-10-12",
  ],
  provisional: [
    "2026-11-11", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06",
    "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24",
  ],
};

// Kenya public holidays (Public Holidays Act; a Sunday holiday moves to Monday).
const KE_CBK: HolidayList = {
  confirmed: [
    "2025-10-10", "2025-10-17", "2025-10-20", "2025-12-12", "2025-12-25", "2025-12-26",
    "2026-01-01", "2026-03-20", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-27", "2026-06-01",
  ],
  provisional: [
    "2026-10-20", "2026-12-25",
    "2027-01-01", "2027-03-10", "2027-03-26", "2027-03-29", "2027-05-17", "2027-06-01", "2027-10-11", "2027-10-20",
    "2027-12-13", "2027-12-27",
  ],
};

// Federal Reserve (Fedwire) holidays, when EFFR is not published. Unlike the bond market, the
// Fed is open on Good Friday, and a Saturday holiday is not moved to Friday.
const US_FEDWIRE: HolidayList = {
  confirmed: [
    "2025-01-01", "2025-01-20", "2025-02-17", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-10-13",
    "2025-11-11", "2025-11-27", "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-09-07", "2026-10-12",
  ],
  provisional: [
    "2026-11-11", "2026-11-26", "2026-12-25",
    "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31", "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25",
  ],
};

// TARGET2 closing days (when €STR is not published).
const TARGET2: HolidayList = {
  confirmed: [
    "2025-01-01", "2025-04-18", "2025-04-21", "2025-05-01", "2025-12-25", "2025-12-26",
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01",
  ],
  provisional: ["2026-12-25", "2027-01-01", "2027-03-26", "2027-03-29"],
};

// Ghana public holidays, from the gaps in the Bank of Ghana interbank series.
const GH: HolidayList = {
  confirmed: [
    "2025-01-01", "2025-01-07", "2025-03-06", "2025-03-31", "2025-04-01", "2025-04-18", "2025-04-21", "2025-05-01",
    "2025-06-06", "2025-07-04", "2025-09-22", "2025-12-05", "2025-12-25", "2025-12-26",
    "2026-01-01", "2026-01-09", "2026-03-06", "2026-03-20", "2026-03-23", "2026-04-03", "2026-04-06", "2026-05-01",
    "2026-05-27", "2026-07-03", "2026-09-21",
  ],
  provisional: [
    "2026-12-04", "2026-12-25",
    "2027-01-01", "2027-01-07", "2027-03-08", "2027-03-10", "2027-03-26", "2027-03-29", "2027-05-17", "2027-07-01",
    "2027-08-04", "2027-09-21", "2027-12-03", "2027-12-27", "2027-12-28",
  ],
};

// Nigeria public holidays, from the gaps in the CBN NOFR series (published since April 2026).
const NG_CBN: HolidayList = {
  confirmed: ["2026-05-01", "2026-05-27", "2026-05-28", "2026-06-12", "2026-08-25", "2026-10-01"],
  provisional: [
    "2026-12-25", "2026-12-28",
    "2027-01-01", "2027-03-10", "2027-03-11", "2027-03-26", "2027-03-29", "2027-05-03", "2027-05-17", "2027-05-18",
    "2027-06-14", "2027-08-16", "2027-10-01", "2027-12-27", "2027-12-28",
  ],
};

// A policy rate is in force every day; observations are taken each weekday.
const WEEKDAYS: HolidayList = { confirmed: [], provisional: [] };

const CALENDARS: Partial<Record<CalendarId, HolidayList>> = { US_FED, US_FEDWIRE, KE_CBK, TARGET2, GH, NG_CBN, WEEKDAYS };

/** Years each calendar covers; outside them every weekday counts as a business day and is flagged. */
export const CALENDAR_COVERAGE = { from: "2025-01-01", to: "2027-12-31" };

function holidaysFor(calendar: CalendarId): Set<string> {
  const list = CALENDARS[calendar];
  if (!list) throw new Error(`No holiday calendar for ${calendar}`);
  return new Set([...list.confirmed, ...list.provisional]);
}

export function hasCalendar(calendar: CalendarId): boolean {
  return Boolean(CALENDARS[calendar]);
}

export function isProvisionalHoliday(calendar: CalendarId, date: string): boolean {
  return Boolean(CALENDARS[calendar]?.provisional.includes(date));
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isValidIsoDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === date;
}

export function isBusinessDay(calendar: CalendarId, date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (day === 0 || day === 6) return false;
  return !holidaysFor(calendar).has(date);
}

export function previousBusinessDay(calendar: CalendarId, date: string): string {
  let d = addDays(date, -1);
  while (!isBusinessDay(calendar, d)) d = addDays(d, -1);
  return d;
}

export function nextBusinessDay(calendar: CalendarId, date: string): string {
  let d = addDays(date, 1);
  while (!isBusinessDay(calendar, d)) d = addDays(d, 1);
  return d;
}

/** Business days in [from, to], both inclusive. */
export function businessDaysBetween(calendar: CalendarId, from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isBusinessDay(calendar, d)) out.push(d);
  return out;
}

// ── Local time in the administrator's zone ───────────────────────────────────

/** Local calendar date and "HH:MM" of an instant in a time zone. */
export function localParts(instant: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** The UTC instant of a local date and "HH:MM" in a time zone (handles daylight saving). */
export function zonedInstant(date: string, time: string, timeZone: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  // Shift by the zone's offset at the guess, then once more in case the offset changed across it.
  let instant = guess;
  for (let i = 0; i < 2; i++) {
    const p = localParts(instant, timeZone);
    const asUtc = new Date(`${p.date}T${p.time}:00Z`).getTime();
    instant = new Date(instant.getTime() - (asUtc - guess.getTime()));
  }
  return instant;
}
