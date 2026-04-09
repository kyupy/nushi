import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import type { MonthlyStatsDoc } from "@nushi/shared";
import {
  pushTextToGroup,
  lineChannelSecret,
  lineMessagingToken,
  lineGroupId,
} from "../lib/line";
import { previousYearMonth, formatDuration } from "../lib/dateUtils";

const db = () => getFirestore();

/**
 * Scheduled: 09:00 JST on the 1st of every month.
 * Posts the previous month's ranking to the LINE group.
 */
export const monthlyRankingPost = onSchedule(
  {
    schedule: "0 9 1 * *",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
    secrets: [lineChannelSecret, lineMessagingToken],
  },
  async () => {
    // Determine previous month
    const now = new Date();
    const jstNow = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    const currentYm = `${jstNow.getUTCFullYear()}-${String(jstNow.getUTCMonth() + 1).padStart(2, "0")}`;
    const prevYm = previousYearMonth(currentYm);

    logger.info("Generating monthly ranking post", { yearMonth: prevYm });

    // Fetch monthly stats
    const statsSnap = await db().doc(`stats/monthly/${prevYm}/_root_`).get();
    if (!statsSnap.exists) {
      logger.warn("No stats found for previous month", { yearMonth: prevYm });
      return;
    }

    const stats = statsSnap.data() as MonthlyStatsDoc;
    const { users } = stats;

    if (!users || Object.keys(users).length === 0) {
      logger.info("No users with stats for ranking", { yearMonth: prevYm });
      return;
    }

    // Build rankings
    type UserStats = MonthlyStatsDoc["users"][string];
    const userEntries = Object.entries(users).map(([uid, data]: [string, UserStats]) => ({
      userId: uid,
      ...data,
    }));

    // Sort by total time (descending)
    const byTotalTime = [...userEntries].sort((a, b) => b.totalSeconds - a.totalSeconds);

    // Sort by days present (descending)
    const byDaysPresent = [...userEntries].sort((a, b) => b.daysPresent - a.daysPresent);

    // Build message
    const medal = (i: number) => {
      if (i === 0) return "\u{1F947}"; // gold
      if (i === 1) return "\u{1F948}"; // silver
      if (i === 2) return "\u{1F949}"; // bronze
      return `${i + 1}.`;
    };

    const [year, month] = prevYm.split("-");
    let message = `${year}年${parseInt(month)}月 研究室ランキング\n\n`;

    // Total time ranking
    message += "【滞在時間ランキング】\n";
    byTotalTime.slice(0, 10).forEach((u, i) => {
      message += `${medal(i)} ${u.displayName}: ${formatDuration(u.totalSeconds)}\n`;
    });

    message += "\n【出席日数ランキング】\n";
    byDaysPresent.slice(0, 10).forEach((u, i) => {
      message += `${medal(i)} ${u.displayName}: ${u.daysPresent}日\n`;
    });

    // Fetch per-user stats for special awards
    const userStatsSnap = await db()
      .collection(`stats/monthly/${prevYm}/users`)
      .get();

    if (!userStatsSnap.empty) {
      const userStats = userStatsSnap.docs.map((doc) => ({
        userId: doc.id,
        ...doc.data(),
      }));

      // Early bird: earliest check-in
      const earlyBirds = userStats
        .filter((u: any) => u.earliestIn && u.earliestIn !== "23:59")
        .sort((a: any, b: any) => a.earliestIn.localeCompare(b.earliestIn));

      if (earlyBirds.length > 0) {
        message += "\n【早起きで賞】\n";
        earlyBirds.slice(0, 3).forEach((u: any, i: number) => {
          message += `${medal(i)} ${u.displayName}: ${u.earliestIn}\n`;
        });
      }

      // Night owl: latest check-out
      const nightOwls = userStats
        .filter((u: any) => u.latestOut && u.latestOut !== "00:00")
        .sort((a: any, b: any) => b.latestOut.localeCompare(a.latestOut));

      if (nightOwls.length > 0) {
        message += "\n【夜型で賞】\n";
        nightOwls.slice(0, 3).forEach((u: any, i: number) => {
          message += `${medal(i)} ${u.displayName}: ${u.latestOut}\n`;
        });
      }

      // Weekend warrior: most weekend seconds
      const weekendWarriors = userStats
        .filter((u: any) => (u.weekendSeconds ?? 0) > 0)
        .sort((a: any, b: any) => (b.weekendSeconds ?? 0) - (a.weekendSeconds ?? 0));

      if (weekendWarriors.length > 0) {
        message += "\n【休日も研究で賞】\n";
        weekendWarriors.slice(0, 3).forEach((u: any, i: number) => {
          message += `${medal(i)} ${u.displayName}: ${formatDuration(u.weekendSeconds)}\n`;
        });
      }
    }

    message += "\nお疲れ様でした！今月も頑張りましょう！";

    // Save rankings back to the stats document
    await db().doc(`stats/monthly/${prevYm}/_root_`).update({
      rankings: {
        totalTime: byTotalTime.map((u) => u.userId),
        daysPresent: byDaysPresent.map((u) => u.userId),
        earlyBird: [],
        nightOwl: [],
        weekendWarrior: [],
        streak: [],
      },
    });

    // Post to LINE group
    await pushTextToGroup(message);
    logger.info("Monthly ranking posted to LINE group", { yearMonth: prevYm });
  },
);
