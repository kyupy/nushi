import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { logger } from "firebase-functions/v2";
import type { SessionDoc } from "@nushi/shared";
import { incrementMonthlyStats, incrementUserMonthlyStats, recalcDailyStats } from "../lib/stats";

/**
 * Trigger: when a session document is created, incrementally update
 * the monthly stats (both parent and per-user) and daily stats.
 */
export const onSessionCreate = onDocumentCreated(
  {
    document: "sessions/{sessionId}",
    region: "asia-northeast1",
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const session = snap.data() as SessionDoc;

    // Skip voided sessions
    if (session.voided) {
      return;
    }

    try {
      // Update parent monthly stats (aggregated across users)
      await incrementMonthlyStats(session);

      // Update per-user monthly stats
      await incrementUserMonthlyStats(session);

      // Update daily stats
      await recalcDailyStats(session.date);

      logger.info("Stats updated for new session", {
        sessionId: event.params.sessionId,
        userId: session.userId,
        yearMonth: session.yearMonth,
        date: session.date,
      });
    } catch (err) {
      logger.error("Failed to update stats for session", {
        sessionId: event.params.sessionId,
        error: err,
      });
      throw err; // Re-throw to allow retry
    }
  },
);
