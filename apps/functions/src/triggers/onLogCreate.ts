import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import type { LogDoc, SessionDoc } from "@nushi/shared";
import {
  durationSeconds,
  jstHour,
  jstDayOfWeek,
  isWeekend,
  nightSeconds,
  coreSeconds,
  logicalDate,
  logicalYearMonth,
} from "../lib/dateUtils";

const db = () => getFirestore();

/**
 * Trigger: when an "out" log is created (not voided), pair it with
 * the most recent "in" log for the same user to create a session document.
 *
 * Sessions created by this trigger will in turn fire onSessionCreate.
 */
export const onLogCreate = onDocumentCreated(
  {
    document: "logs/{logId}",
    region: "asia-northeast1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const log = snap.data() as LogDoc;

    // Only process "out" logs that are not voided and not manual fixes
    // (manual-fix logs are handled by fixStamp which regenerates sessions directly)
    if (log.action !== "out" || log.voided || log.method === "manual-fix") {
      return;
    }

    const { userId } = log;

    // Find the most recent non-voided "in" log for this user before this "out" log
    const inLogsSnap = await db()
      .collection("logs")
      .where("userId", "==", userId)
      .where("action", "==", "in")
      .where("voided", "==", false)
      .where("timestamp", "<", log.timestamp)
      .orderBy("timestamp", "desc")
      .limit(1)
      .get();

    if (inLogsSnap.empty) {
      logger.warn("No matching 'in' log found for 'out' log", {
        logId: event.params.logId,
        userId,
      });
      return;
    }

    const inLog = inLogsSnap.docs[0].data() as LogDoc;
    const checkInTs = inLog.timestamp;
    const checkOutTs = log.timestamp;

    const durSec = durationSeconds(checkInTs, checkOutTs);
    if (durSec <= 0) {
      logger.warn("Non-positive session duration, skipping", {
        logId: event.params.logId,
        durationSeconds: durSec,
      });
      return;
    }

    const checkInMs = checkInTs.toMillis();
    const checkOutMs = checkOutTs.toMillis();

    // Use the check-in timestamp for the session's date classification
    const sessionDate = logicalDate(checkInTs);
    const sessionYearMonth = logicalYearMonth(checkInTs);

    const session: SessionDoc = {
      userId,
      displayName: inLog.displayName,
      checkIn: checkInTs,
      checkOut: checkOutTs,
      durationSeconds: durSec,
      date: sessionDate,
      yearMonth: sessionYearMonth,
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

    const sessionRef = await db().collection("sessions").add(session);
    logger.info("Session created from log pair", {
      sessionId: sessionRef.id,
      userId,
      durationSeconds: durSec,
      date: sessionDate,
    });
  },
);
