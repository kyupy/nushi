import { Timestamp } from "firebase-admin/firestore";

/**
 * All date/time helpers use Asia/Tokyo (JST, UTC+9).
 * A logical "day" runs from 05:00 JST to the next 04:59 JST.
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_BOUNDARY_HOUR = 5; // 05:00 JST

// ----------------------------------------------------------------
// Core conversions
// ----------------------------------------------------------------

/** Convert a Firestore Timestamp (or epoch-ms number) to a JS Date. */
export function toDate(ts: Timestamp | number): Date {
  if (typeof ts === "number") {
    return new Date(ts);
  }
  return ts.toDate();
}

/** Return a Date representing "now" in absolute UTC (just `new Date()`). */
export function now(): Date {
  return new Date();
}

/** Return the current epoch-ms. */
export function nowMs(): number {
  return Date.now();
}

/** Create a Firestore Timestamp from epoch-ms. */
export function tsFromMs(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

// ----------------------------------------------------------------
// JST helpers
// ----------------------------------------------------------------

/** Get JST-adjusted components from a Date. */
export function jstComponents(d: Date): {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number; // 0=Sun
} {
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
    day: jst.getUTCDate(),
    hour: jst.getUTCHours(),
    minute: jst.getUTCMinutes(),
    second: jst.getUTCSeconds(),
    dayOfWeek: jst.getUTCDay(),
  };
}

// ----------------------------------------------------------------
// Logical date (05:00 boundary)
// ----------------------------------------------------------------

/**
 * Return the logical date string ("YYYY-MM-DD") for a given timestamp.
 * If the time is before 05:00 JST, it belongs to the previous calendar day.
 */
export function logicalDate(ts: Timestamp | number): string {
  const d = toDate(ts);
  const c = jstComponents(d);
  if (c.hour < DAY_BOUNDARY_HOUR) {
    // Belongs to previous calendar day
    const prev = new Date(d.getTime() + JST_OFFSET_MS);
    prev.setUTCDate(prev.getUTCDate() - 1);
    return formatDate(prev.getUTCFullYear(), prev.getUTCMonth() + 1, prev.getUTCDate());
  }
  return formatDate(c.year, c.month, c.day);
}

/** Return "YYYY-MM" yearMonth for a given timestamp (using logical date). */
export function logicalYearMonth(ts: Timestamp | number): string {
  const dateStr = logicalDate(ts);
  return dateStr.substring(0, 7);
}

/** Return the JST hour (0-23) for a given timestamp. */
export function jstHour(ts: Timestamp | number): number {
  return jstComponents(toDate(ts)).hour;
}

/** Return the day-of-week (0=Sun) for a given timestamp in JST. */
export function jstDayOfWeek(ts: Timestamp | number): number {
  return jstComponents(toDate(ts)).dayOfWeek;
}

/** Return the JST year for a given timestamp. */
export function jstYear(ts: Timestamp | number): number {
  return jstComponents(toDate(ts)).year;
}

/** Check if a timestamp falls on a weekend (Sat=6, Sun=0) in JST. */
export function isWeekend(ts: Timestamp | number): boolean {
  const dow = jstDayOfWeek(ts);
  return dow === 0 || dow === 6;
}

/** Format "HH:MM" in JST from a timestamp. */
export function jstTimeString(ts: Timestamp | number): string {
  const c = jstComponents(toDate(ts));
  return `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}`;
}

// ----------------------------------------------------------------
// Night / Core seconds overlap
// ----------------------------------------------------------------

/**
 * Calculate overlap in seconds between a session interval and a recurring
 * daily time window. The window is defined by [startHour, endHour) in JST.
 *
 * Handles windows that span midnight (e.g. 22:00-05:00).
 *
 * @param checkInMs  Session start in epoch-ms
 * @param checkOutMs Session end in epoch-ms
 * @param startHour  Window start hour in JST (0-23)
 * @param endHour    Window end hour in JST (0-23)
 * @param weekdayOnly If true, only count weekday (Mon-Fri) portions
 */
export function overlapSeconds(
  checkInMs: number,
  checkOutMs: number,
  startHour: number,
  endHour: number,
  weekdayOnly: boolean = false,
): number {
  if (checkOutMs <= checkInMs) return 0;

  let total = 0;

  // Iterate day-by-day through the session range.
  // We generate candidate window intervals for each calendar day that could
  // overlap with the session.
  // Work in JST epoch-ms space to simplify.

  // Start from the JST calendar day of checkIn, minus one day for safety (midnight-crossing windows).
  const startDate = toDate(checkInMs);
  const startComp = jstComponents(startDate);
  const startJstMidnight = jstMidnightMs(startComp.year, startComp.month, startComp.day);

  // End from the JST calendar day of checkOut, plus one day for safety.
  const endDate = toDate(checkOutMs);
  const endComp = jstComponents(endDate);
  const endJstMidnight = jstMidnightMs(endComp.year, endComp.month, endComp.day);

  for (let midnightMs = startJstMidnight - 86400000; midnightMs <= endJstMidnight + 86400000; midnightMs += 86400000) {
    // Determine the day-of-week for this JST day
    if (weekdayOnly) {
      const dayDate = new Date(midnightMs - JST_OFFSET_MS); // back to UTC
      const dow = jstComponents(dayDate).dayOfWeek;
      if (dow === 0 || dow === 6) continue; // skip weekends
    }

    let windowStartMs: number;
    let windowEndMs: number;

    if (startHour < endHour) {
      // Same-day window, e.g. 09:00-18:00
      windowStartMs = midnightMs + startHour * 3600000;
      windowEndMs = midnightMs + endHour * 3600000;
    } else {
      // Overnight window, e.g. 22:00-05:00 (starts this day, ends next day)
      windowStartMs = midnightMs + startHour * 3600000;
      windowEndMs = midnightMs + 86400000 + endHour * 3600000;
    }

    // Convert window back to UTC epoch-ms for comparison
    const winStart = windowStartMs - JST_OFFSET_MS;
    const winEnd = windowEndMs - JST_OFFSET_MS;

    // Calculate overlap
    const overlapStart = Math.max(checkInMs, winStart);
    const overlapEnd = Math.min(checkOutMs, winEnd);
    if (overlapEnd > overlapStart) {
      total += overlapEnd - overlapStart;
    }
  }

  return Math.round(total / 1000);
}

/**
 * Calculate night seconds (22:00-05:00 JST) for a session.
 */
export function nightSeconds(checkInMs: number, checkOutMs: number): number {
  return overlapSeconds(checkInMs, checkOutMs, 22, 5);
}

/**
 * Calculate core seconds (weekday 09:00-18:00 JST) for a session.
 */
export function coreSeconds(checkInMs: number, checkOutMs: number): number {
  return overlapSeconds(checkInMs, checkOutMs, 9, 18, true);
}

// ----------------------------------------------------------------
// Duration helpers
// ----------------------------------------------------------------

/** Duration in seconds between two Timestamps. */
export function durationSeconds(start: Timestamp, end: Timestamp): number {
  return Math.round((end.toMillis() - start.toMillis()) / 1000);
}

/** Format seconds as "Xh Ym". */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

function formatDate(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Return a "JST-space" base value for a given JST calendar date.
 *
 * We use Date.UTC(year, month-1, day) as a convenient numeric anchor.
 * In overlapSeconds, we compute window boundaries as:
 *   windowMs = jstMidnightMs(...) + hour * 3600000
 * then convert to real UTC by subtracting JST_OFFSET_MS:
 *   realUtc = windowMs - JST_OFFSET_MS
 *
 * This is correct because:
 *   Date.UTC(y,m,d) + h*3600000 - 9*3600000
 *   = the real UTC epoch when it's h:00 JST on that calendar date.
 */
function jstMidnightMs(year: number, month: number, day: number): number {
  return Date.UTC(year, month - 1, day, 0, 0, 0, 0);
}

// ----------------------------------------------------------------
// Previous month helper
// ----------------------------------------------------------------

/** Given a "YYYY-MM" string, return the previous month as "YYYY-MM". */
export function previousYearMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  if (m === 1) {
    return `${y - 1}-12`;
  }
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Get the current yearMonth in JST. */
export function currentYearMonth(): string {
  const c = jstComponents(new Date());
  return `${c.year}-${String(c.month).padStart(2, "0")}`;
}

/** Get the current logical date string in JST. */
export function currentLogicalDate(): string {
  return logicalDate(Date.now());
}
