import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { recalcUserMonthlyStats, recalcDailyStats } from "../lib/stats";

const db = () => getFirestore();

interface RecalculateRequest {
  yearMonth: string; // "YYYY-MM"
}

interface RecalculateResponse {
  message: string;
  usersProcessed: number;
}

/**
 * Admin-only callable to fully recalculate stats for a given month.
 * Iterates all users who have sessions in that month and rebuilds stats.
 */
export const recalculate = onCall<RecalculateRequest>(
  { region: "asia-northeast1" },
  async (request): Promise<RecalculateResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    // Check admin role
    const userId = request.auth.uid;
    const userSnap = await db().doc(`users/${userId}`).get();
    if (!userSnap.exists || userSnap.data()?.role !== "admin") {
      throw new HttpsError("permission-denied", "Admin access required");
    }

    const { yearMonth } = request.data;
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new HttpsError("invalid-argument", "yearMonth must be in YYYY-MM format");
    }

    logger.info("Starting full recalculation", { yearMonth, requestedBy: userId });

    // Find all users with sessions in this month
    const sessionsSnap = await db()
      .collection("sessions")
      .where("yearMonth", "==", yearMonth)
      .where("voided", "==", false)
      .get();

    const userIds = new Set<string>();
    const dates = new Set<string>();

    sessionsSnap.forEach((doc) => {
      const data = doc.data();
      userIds.add(data.userId);
      dates.add(data.date);
    });

    // Recalculate for each user
    for (const uid of userIds) {
      await recalcUserMonthlyStats(uid, yearMonth);
    }

    // Recalculate daily stats for each date
    for (const date of dates) {
      await recalcDailyStats(date);
    }

    logger.info("Recalculation complete", {
      yearMonth,
      usersProcessed: userIds.size,
      datesProcessed: dates.size,
    });

    return {
      message: `Recalculated stats for ${yearMonth}`,
      usersProcessed: userIds.size,
    };
  },
);
