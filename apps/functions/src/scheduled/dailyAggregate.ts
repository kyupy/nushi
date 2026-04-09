import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import type { UserDoc, LogDoc } from "@nushi/shared";
import {
  logicalDate,
  logicalYearMonth,
  jstHour,
  jstDayOfWeek,
  jstYear,
  isWeekend,
} from "../lib/dateUtils";

const db = () => getFirestore();

/**
 * Scheduled: 05:30 JST daily.
 * Auto-close sessions that have been open for more than the threshold (default 12h).
 * Creates an "out" log with method: "auto-close" and updates user status.
 */
export const dailyAggregate = onSchedule(
  {
    schedule: "30 5 * * *",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
  },
  async () => {
    logger.info("Running daily aggregate / auto-close");

    // Load config for auto-close threshold
    const configSnap = await db().doc("config/app").get();
    const thresholdHours = configSnap.exists
      ? configSnap.data()?.autoCloseThresholdHours ?? 12
      : 12;

    const thresholdMs = thresholdHours * 60 * 60 * 1000;
    const now = Date.now();
    const cutoffTs = Timestamp.fromMillis(now - thresholdMs);

    // Find all users currently checked in whose lastActionAt exceeds the threshold
    const usersSnap = await db()
      .collection("users")
      .where("currentStatus", "==", "in")
      .where("lastActionAt", "<", cutoffTs)
      .get();

    if (usersSnap.empty) {
      logger.info("No sessions to auto-close");
      return;
    }

    logger.info(`Auto-closing ${usersSnap.size} sessions`);

    for (const userDoc of usersSnap.docs) {
      const user = userDoc.data() as UserDoc;
      const userId = user.userId;

      try {
        // Find the user's most recent "in" log
        const inLogSnap = await db()
          .collection("logs")
          .where("userId", "==", userId)
          .where("action", "==", "in")
          .where("voided", "==", false)
          .orderBy("timestamp", "desc")
          .limit(1)
          .get();

        if (inLogSnap.empty) {
          logger.warn("No 'in' log found for auto-close, resetting user status", { userId });
          await db().doc(`users/${userId}`).update({
            currentStatus: "out",
            currentSessionId: null,
          });
          continue;
        }

        const inLog = inLogSnap.docs[0].data() as LogDoc;

        // Auto-close time: min(in + threshold, now)
        // Use the threshold time as the checkout time
        const autoCloseTime = Timestamp.fromMillis(
          Math.min(inLog.timestamp.toMillis() + thresholdMs, now),
        );

        // Create an auto-close "out" log
        const logRef = db().collection("logs").doc();
        const outLog: Record<string, unknown> = {
          userId,
          displayName: user.displayName,
          action: "out",
          timestamp: autoCloseTime,
          clientTimestamp: autoCloseTime,
          date: logicalDate(autoCloseTime),
          yearMonth: logicalYearMonth(autoCloseTime),
          year: jstYear(autoCloseTime),
          dayOfWeek: jstDayOfWeek(autoCloseTime),
          hour: jstHour(autoCloseTime),
          isWeekend: isWeekend(autoCloseTime),
          isHoliday: false,
          platform: "other",
          appVersion: "",
          liffVersion: "",
          method: "auto-close",
          voided: false,
          voidedAt: null,
          raw: { autoClosedBy: "dailyAggregate" },
          schemaVersion: 1,
        };

        await db().runTransaction(async (tx) => {
          tx.set(logRef, outLog);
          tx.update(db().doc(`users/${userId}`), {
            currentStatus: "out",
            lastActionAt: autoCloseTime,
            currentSessionId: null,
          });
        });

        logger.info("Auto-closed session", {
          userId,
          logId: logRef.id,
          autoCloseTime: autoCloseTime.toDate().toISOString(),
        });
      } catch (err) {
        logger.error("Failed to auto-close session for user", { userId, error: err });
      }
    }

    logger.info("Daily aggregate / auto-close complete");
  },
);
