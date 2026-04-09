import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import type {
  CheckInRequest,
  CheckInResponse,
  UserDoc,
  LogDoc,
} from "@nushi/shared";
import {
  logicalDate,
  logicalYearMonth,
  jstHour,
  jstDayOfWeek,
  jstYear,
  isWeekend,
  durationSeconds,
  formatDuration,
  tsFromMs,
} from "../lib/dateUtils";

const db = () => getFirestore();

export const checkIn = onCall<CheckInRequest>(
  { region: "asia-northeast1" },
  async (request): Promise<CheckInResponse> => {
    // Auth check
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const userId = request.auth.uid;

    const { clientTimestamp, platform, appVersion, liffVersion } = request.data;

    if (!clientTimestamp || !platform) {
      throw new HttpsError("invalid-argument", "clientTimestamp and platform are required");
    }

    const serverNow = Timestamp.now();
    const clientTs = tsFromMs(clientTimestamp);

    // Read user document
    const userRef = db().doc(`users/${userId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new HttpsError("not-found", "User not found. Please register first.");
    }
    const user = userSnap.data() as UserDoc;

    // Determine action: toggle current status
    const action: "in" | "out" = user.currentStatus === "in" ? "out" : "in";

    // Build log document
    const logRef = db().collection("logs").doc();
    const log: Omit<LogDoc, "timestamp" | "voidedAt"> & {
      timestamp: Timestamp;
      voidedAt: null;
    } = {
      userId,
      displayName: user.displayName,
      action,
      timestamp: serverNow,
      clientTimestamp: clientTs,
      date: logicalDate(serverNow),
      yearMonth: logicalYearMonth(serverNow),
      year: jstYear(serverNow),
      dayOfWeek: jstDayOfWeek(serverNow),
      hour: jstHour(serverNow),
      isWeekend: isWeekend(serverNow),
      isHoliday: false, // Holiday detection not implemented; can be extended
      platform,
      appVersion: appVersion || "",
      liffVersion: liffVersion || "",
      method: "button",
      voided: false,
      voidedAt: null,
      raw: {},
      schemaVersion: 1,
    };

    let responseMsg: string;
    let durSec: number | undefined;

    if (action === "in") {
      // Check in
      await db().runTransaction(async (tx) => {
        tx.set(logRef, log);
        tx.update(userRef, {
          currentStatus: "in",
          lastActionAt: serverNow,
          currentSessionId: logRef.id,
        });
      });
      responseMsg = "Checked in!";
      logger.info("User checked in", { userId, logId: logRef.id });
    } else {
      // Check out - calculate duration from most recent "in" log
      const inLogsSnap = await db()
        .collection("logs")
        .where("userId", "==", userId)
        .where("action", "==", "in")
        .where("voided", "==", false)
        .orderBy("timestamp", "desc")
        .limit(1)
        .get();

      if (!inLogsSnap.empty) {
        const inLog = inLogsSnap.docs[0].data() as LogDoc;
        durSec = durationSeconds(inLog.timestamp, serverNow);
      }

      await db().runTransaction(async (tx) => {
        tx.set(logRef, log);
        tx.update(userRef, {
          currentStatus: "out",
          lastActionAt: serverNow,
          currentSessionId: null,
        });
      });

      responseMsg = durSec !== undefined
        ? `Checked out! Duration: ${formatDuration(durSec)}`
        : "Checked out!";
      logger.info("User checked out", { userId, logId: logRef.id, durationSeconds: durSec });
    }

    return {
      action,
      logId: logRef.id,
      durationSeconds: durSec,
      message: responseMsg,
    };
  },
);
