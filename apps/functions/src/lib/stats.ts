import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import type { SessionDoc, UserMonthlyStatsDoc } from "@nushi/shared";
import { jstHour, jstDayOfWeek, jstTimeString } from "./dateUtils";

const db = () => getFirestore();

// ----------------------------------------------------------------
// Incremental monthly stats update (called from onSessionCreate)
// ----------------------------------------------------------------

/**
 * Incrementally update the parent `stats/monthly/{yearMonth}` document
 * when a new session is created.
 */
export async function incrementMonthlyStats(session: SessionDoc): Promise<void> {
  const { userId, displayName, durationSeconds, yearMonth } = session;

  const ref = db().doc(`stats/monthly/${yearMonth}/_root_`);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? { yearMonth, users: {}, rankings: {} };
    const users = data.users ?? {};

    const existing = users[userId] ?? {
      displayName,
      pictureUrl: null,
      totalSeconds: 0,
      daysPresent: 0,
      sessionCount: 0,
      avgSessionMinutes: 0,
    };

    existing.displayName = displayName;
    existing.totalSeconds += durationSeconds;
    existing.sessionCount += 1;
    existing.avgSessionMinutes = Math.round(existing.totalSeconds / existing.sessionCount / 60);

    users[userId] = existing;
    data.users = users;
    data.updatedAt = FieldValue.serverTimestamp();

    tx.set(ref, data, { merge: true });
  });

  // Update daysPresent separately by checking distinct dates
  await updateDaysPresent(userId, yearMonth);
}

/**
 * Recount distinct days-present for a user in a given month.
 */
async function updateDaysPresent(userId: string, yearMonth: string): Promise<void> {
  const sessionsSnap = await db()
    .collection("sessions")
    .where("userId", "==", userId)
    .where("yearMonth", "==", yearMonth)
    .where("voided", "==", false)
    .get();

  const dates = new Set<string>();
  sessionsSnap.forEach((doc) => {
    const s = doc.data() as SessionDoc;
    dates.add(s.date);
  });

  const ref = db().doc(`stats/monthly/${yearMonth}/_root_`);
  await ref.set(
    {
      [`users.${userId}.daysPresent`]: dates.size,
    },
    { merge: true },
  );
}

// ----------------------------------------------------------------
// User monthly stats update (called from onSessionCreate)
// ----------------------------------------------------------------

/**
 * Incrementally update the per-user monthly stats subdocument
 * `stats/monthly/{yearMonth}/users/{userId}`.
 */
export async function incrementUserMonthlyStats(session: SessionDoc): Promise<void> {
  const {
    userId,
    displayName,
    checkIn,
    checkOut,
    durationSeconds: durSec,
    nightSeconds: nightSec,
    coreSeconds: coreSec,
    isWeekend: weekend,
    dayOfWeek,
  } = session;

  const ref = db().doc(`stats/monthly/${session.yearMonth}/${userId}`);

  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data: UserMonthlyStatsDoc = snap.exists
      ? (snap.data() as UserMonthlyStatsDoc)
      : {
          userId,
          displayName,
          earliestIn: "23:59",
          latestOut: "00:00",
          weekendSeconds: 0,
          nightSeconds: 0,
          coreSeconds: 0,
          maxStreak: 0,
          heatmap: Array(168).fill(0),
          schemaVersion: 1,
        };

    data.displayName = displayName;

    // Earliest in / latest out
    const inTime = jstTimeString(checkIn);
    const outTime = jstTimeString(checkOut);
    if (inTime < data.earliestIn) data.earliestIn = inTime;
    if (outTime > data.latestOut) data.latestOut = outTime;

    // Accumulate seconds
    if (weekend) data.weekendSeconds += durSec;
    data.nightSeconds += nightSec;
    data.coreSeconds += coreSec;

    // Heatmap: add duration to the check-in hour cell
    const hourIn = jstHour(checkIn);
    const dow = dayOfWeek;
    const index = dow * 24 + hourIn; // 日付×24時間 ＋ 時間 で位置を特定
    if (data.heatmap[index] !== undefined) {// @ts-ignore
      data.heatmap[index] += durSec;
    }
    tx.set(ref, data);
  });
}

// ----------------------------------------------------------------
// Full recalculation for a user in a given month
// ----------------------------------------------------------------

/**
 * Recalculate all stats for a user in a given yearMonth from sessions.
 * Used by fixStamp after modifying sessions.
 */
export async function recalcUserMonthlyStats(userId: string, yearMonth: string): Promise<void> {
  const sessionsSnap = await db()
    .collection("sessions")
    .where("userId", "==", userId)
    .where("yearMonth", "==", yearMonth)
    .where("voided", "==", false)
    .orderBy("checkIn", "asc")
    .get();

  let totalSeconds = 0;
  let sessionCount = 0;
  const dates = new Set<string>();
  let earliestIn = "23:59";
  let latestOut = "00:00";
  let weekendSeconds = 0;
  let nightSec = 0;
  let coreSec = 0;
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  let displayName = "";
  let pictureUrl: string | null = null;

  sessionsSnap.forEach((doc) => {
    const s = doc.data() as SessionDoc;
    displayName = s.displayName;
    totalSeconds += s.durationSeconds;
    sessionCount += 1;
    dates.add(s.date);

    const inTime = jstTimeString(s.checkIn);
    const outTime = jstTimeString(s.checkOut);
    if (inTime < earliestIn) earliestIn = inTime;
    if (outTime > latestOut) latestOut = outTime;

    if (s.isWeekend) weekendSeconds += s.durationSeconds;
    nightSec += s.nightSeconds;
    coreSec += s.coreSeconds;

    const dow = s.dayOfWeek;
    const hourIn = jstHour(s.checkIn);
    heatmap[dow][hourIn] += s.durationSeconds;
  });

  // Fetch user doc for pictureUrl
  const userSnap = await db().doc(`users/${userId}`).get();
  if (userSnap.exists) {
    const userData = userSnap.data();
    pictureUrl = userData?.pictureUrl ?? null;
    if (!displayName) displayName = userData?.displayName ?? "";
  }

  // Calculate streak
  const sortedDates = Array.from(dates).sort();
  let maxStreak = 0;
  let currentStreak = 0;
  let lastDate = "";
  for (const date of sortedDates) {
    if (lastDate && isNextDay(lastDate, date)) {
      currentStreak += 1;
    } else {
      currentStreak = 1;
    }
    if (currentStreak > maxStreak) maxStreak = currentStreak;
    lastDate = date;
  }

  // Update user monthly stats subdocument
  const userRef = db().doc(`stats/monthly/${yearMonth}/${userId}`);
  const userMonthly: UserMonthlyStatsDoc = {
    userId,
    displayName,
    earliestIn,
    latestOut,
    weekendSeconds,
    nightSeconds: nightSec,
    coreSeconds: coreSec,
    maxStreak,
    heatmap,
    schemaVersion: 1,
  };
  await userRef.set(userMonthly);

  // Update parent monthly stats
  const parentRef = db().doc(`stats/monthly/${yearMonth}/_root_`);
  await parentRef.set(
    {
      yearMonth,
      updatedAt: FieldValue.serverTimestamp(),
      [`users.${userId}`]: {
        displayName,
        pictureUrl,
        totalSeconds,
        daysPresent: dates.size,
        sessionCount,
        avgSessionMinutes: sessionCount > 0 ? Math.round(totalSeconds / sessionCount / 60) : 0,
      },
    },
    { merge: true },
  );
}

// ----------------------------------------------------------------
// Daily stats update
// ----------------------------------------------------------------

/**
 * Recalculate daily stats for a given date.
 */
export async function recalcDailyStats(date: string): Promise<void> {
  const sessionsSnap = await db()
    .collection("sessions")
    .where("date", "==", date)
    .where("voided", "==", false)
    .get();

  let totalSessions = 0;
  let totalSeconds = 0;
  const uniqueUsers = new Set<string>();

  sessionsSnap.forEach((doc) => {
    const s = doc.data() as SessionDoc;
    totalSessions += 1;
    totalSeconds += s.durationSeconds;
    uniqueUsers.add(s.userId);
  });

  await db().doc(`stats/daily/${date}`).set({
    date,
    totalSessions,
    totalSeconds,
    uniqueUsers: uniqueUsers.size,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function isNextDay(dateA: string, dateB: string): boolean {
  const a = new Date(dateA + "T00:00:00Z");
  const b = new Date(dateB + "T00:00:00Z");
  const diff = b.getTime() - a.getTime();
  return diff === 86400000;
}
