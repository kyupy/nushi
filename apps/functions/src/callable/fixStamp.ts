import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import type {
  FixStampRequest,
  FixStampResponse,
  UserDoc,
  LogDoc,
  SessionDoc,
} from "@nushi/shared";
import {
  logicalDate,
  logicalYearMonth,
  jstHour,
  jstDayOfWeek,
  jstYear,
  isWeekend,
  durationSeconds,
  nightSeconds,
  coreSeconds,
  tsFromMs,
} from "../lib/dateUtils";
import { recalcUserMonthlyStats, recalcDailyStats } from "../lib/stats";

const db = () => getFirestore();

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export const fixStamp = onCall<FixStampRequest>(
  { region: "asia-northeast1" },
  async (request): Promise<FixStampResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const userId = request.auth.uid;
    const { action, timestamp: epochMs, platform, appVersion, liffVersion } = request.data;

    if (!action || !epochMs || !platform) {
      throw new HttpsError("invalid-argument", "action, timestamp, and platform are required");
    }

    if (action !== "in" && action !== "out") {
      throw new HttpsError("invalid-argument", "action must be 'in' or 'out'");
    }

    const fixTs = tsFromMs(epochMs);
    const now = Date.now();

    // Validate: within 1 week
    if (now - epochMs > ONE_WEEK_MS) {
      throw new HttpsError(
        "failed-precondition",
        "Manual fixes are only allowed within 1 week.",
      );
    }

    if (epochMs > now) {
      throw new HttpsError("invalid-argument", "Cannot set a future timestamp.");
    }

    // Read user
    const userRef = db().doc(`users/${userId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found.");
    }
    const user = userSnap.data() as UserDoc;

    // Validate ordering: fetch surrounding logs to ensure no overlap
    // Get the log immediately before the fix timestamp
    const beforeSnap = await db()
      .collection("logs")
      .where("userId", "==", userId)
      .where("voided", "==", false)
      .where("timestamp", "<", fixTs)
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    // Get the log immediately after the fix timestamp
    const afterSnap = await db()
      .collection("logs")
      .where("userId", "==", userId)
      .where("voided", "==", false)
      .where("timestamp", ">", fixTs)
      .orderBy("timestamp", "asc")
      .limit(1)
      .get();

    // Validate ordering constraints
    if (!beforeSnap.empty) {
      const prevLog = beforeSnap.docs[0].data() as LogDoc;
      if (prevLog.action === action) {
        throw new HttpsError(
          "failed-precondition",
          `Cannot insert "${action}" after another "${action}". Check the ordering.`,
        );
      }
    }

    if (!afterSnap.empty) {
      const nextLog = afterSnap.docs[0].data() as LogDoc;
      if (nextLog.action === action) {
        throw new HttpsError(
          "failed-precondition",
          `Cannot insert "${action}" before another "${action}". Check the ordering.`,
        );
      }
    }

    // Create the fix log
    const logRef = db().collection("logs").doc();
    const fixDate = logicalDate(fixTs);
    const fixYearMonth = logicalYearMonth(fixTs);

    const logData: Omit<LogDoc, "timestamp" | "clientTimestamp" | "voidedAt"> & {
      timestamp: Timestamp;
      clientTimestamp: Timestamp;
      voidedAt: null;
    } = {
      userId,
      displayName: user.displayName,
      action,
      timestamp: fixTs,
      clientTimestamp: fixTs,
      date: fixDate,
      yearMonth: fixYearMonth,
      year: jstYear(fixTs),
      dayOfWeek: jstDayOfWeek(fixTs),
      hour: jstHour(fixTs),
      isWeekend: isWeekend(fixTs),
      isHoliday: false,
      platform,
      appVersion: appVersion || "",
      liffVersion: liffVersion || "",
      method: "manual-fix",
      voided: false,
      voidedAt: null,
      raw: {},
      schemaVersion: 1,
    };

    await logRef.set(logData);
    logger.info("Manual fix log created", { userId, logId: logRef.id, action, fixDate });

    // Regenerate affected sessions for this user
    await regenerateSessionsForUser(userId, fixDate, fixYearMonth);

    // Recalculate stats
    await recalcUserMonthlyStats(userId, fixYearMonth);
    await recalcDailyStats(fixDate);

    return {
      logId: logRef.id,
      message: `Manual ${action} stamp recorded for ${fixDate}.`,
    };
  },
);

/**
 * Regenerate sessions from logs for a user on the affected date.
 * Voids existing sessions for that date and recreates from paired logs.
 */
async function regenerateSessionsForUser(
  userId: string,
  date: string,
  yearMonth: string,
): Promise<void> {
  // Void existing sessions for this user on this date
  const existingSessionsSnap = await db()
    .collection("sessions")
    .where("userId", "==", userId)
    .where("date", "==", date)
    .where("voided", "==", false)
    .get();

  const batch = db().batch();
  existingSessionsSnap.forEach((doc) => {
    batch.update(doc.ref, { voided: true });
  });
  await batch.commit();

  // Fetch all non-voided logs for this user on this date, ordered by timestamp
  const logsSnap = await db()
    .collection("logs")
    .where("userId", "==", userId)
    .where("date", "==", date)
    .where("voided", "==", false)
    .orderBy("timestamp", "asc")
    .get();

  // Pair in/out logs to create sessions
  let pendingIn: LogDoc | null = null;

  for (const doc of logsSnap.docs) {
    const log = doc.data() as LogDoc;

    if (log.action === "in") {
      pendingIn = log;
    } else if (log.action === "out" && pendingIn) {
      // Create session
      const checkInTs = pendingIn.timestamp;
      const checkOutTs = log.timestamp;
      const durSec = durationSeconds(checkInTs, checkOutTs);
      const checkInMs = checkInTs.toMillis();
      const checkOutMs = checkOutTs.toMillis();

      const sessionData: SessionDoc = {
        userId,
        displayName: pendingIn.displayName,
        checkIn: checkInTs,
        checkOut: checkOutTs,
        durationSeconds: durSec,
        date,
        yearMonth,
        dayOfWeek: jstDayOfWeek(checkInTs),
        hourIn: jstHour(checkInTs),
        hourOut: jstHour(checkOutTs),
        isWeekend: isWeekend(checkInTs),
        isHoliday: false,
        nightSeconds: nightSeconds(checkInMs, checkOutMs),
        coreSeconds: coreSeconds(checkInMs, checkOutMs),
        autoClosed: log.method === "auto-close",
        voided: false,
        schemaVersion: 1,
      };

      await db().collection("sessions").add(sessionData);
      pendingIn = null;
    }
  }
}
