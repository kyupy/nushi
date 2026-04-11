import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import type { UserDoc } from "@nushi/shared";
import {
  pushMessageWithQuickReply,
  lineChannelSecret,
  lineMessagingToken,
} from "../lib/line";
import { formatDuration } from "../lib/dateUtils";

const db = () => getFirestore();

/**
 * Scheduled: 12:00 JST daily.
 * Notify users who have been checked in for 6+ hours without checking out.
 * Sends a LINE push message with quick reply buttons.
 */
export const checkForgottenCheckout = onSchedule(
  {
    schedule: "0 12 * * *",
    timeZone: "Asia/Tokyo",
    region: "asia-northeast1",
    secrets: [lineChannelSecret, lineMessagingToken],
  },
  async () => {
    logger.info("Running forgotten checkout check");

    // Load config for threshold (default 6 hours) and LIFF URL
    const configSnap = await db().doc("config/app").get();
    const configData = configSnap.exists ? configSnap.data() : {};
    const notifyHours = configData?.forgottenCheckoutNotifyHours ?? 6;
    const liffUrl: string = configData?.liffUrl ?? "";

    const thresholdMs = notifyHours * 60 * 60 * 1000;
    const now = Date.now();
    const cutoffTs = Timestamp.fromMillis(now - thresholdMs);

    // Find users currently checked in whose lastActionAt is before the cutoff
    const usersSnap = await db()
      .collection("users")
      .where("currentStatus", "==", "in")
      .where("lastActionAt", "<", cutoffTs)
      .get();

    if (usersSnap.empty) {
      logger.info("No forgotten checkouts found");
      return;
    }

    logger.info(`Found ${usersSnap.size} users with potential forgotten checkout`);

    const notifications: Promise<void>[] = [];

    for (const doc of usersSnap.docs) {
      const user = doc.data() as UserDoc;
      const elapsedMs = now - user.lastActionAt.toMillis();
      const elapsedSec = Math.round(elapsedMs / 1000);

      const message =
        `${user.displayName} さん、${formatDuration(elapsedSec)}以上チェックインしたままです。\n` +
        `チェックアウトを忘れていませんか？`;

      notifications.push(
        pushMessageWithQuickReply(user.userId, message, [
          {
            type: "action",
            action: {
              type: "postback",
              label: "すでに帰った",
              data: `action=already_left&userId=${user.userId}&liffUrl=${encodeURIComponent(`${liffUrl}/history`)}`,
            },
          },
          {
            type: "action",
            action: {
              type: "postback",
              label: "まだ在室中",
              data: `action=still_here&userId=${user.userId}`,
            },
          },
        ]).catch((err) => {
          logger.error("Failed to send forgotten checkout notification", {
            userId: user.userId,
            error: err,
          });
        }),
      );
    }

    await Promise.all(notifications);
    logger.info("Forgotten checkout notifications sent", { count: usersSnap.size });
  },
);
