import { onRequest } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import * as crypto from "crypto";
import type { UserDoc, LogDoc } from "@nushi/shared";
import {
  replyMessage,
  lineChannelSecret,
  lineMessagingToken,
} from "../lib/line";
import {
  logicalDate,
  logicalYearMonth,
  jstHour,
  jstDayOfWeek,
  jstYear,
  isWeekend,
  formatDuration,
  durationSeconds,
} from "../lib/dateUtils";

const db = () => getFirestore();

/**
 * LINE Bot webhook endpoint.
 * Handles postback events from quick reply actions (forgotten checkout notifications).
 */
export const lineBot = onRequest(
  {
    region: "asia-northeast1",
    secrets: [lineChannelSecret, lineMessagingToken],
  },
  async (req, res) => {
    // Only accept POST
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    // Verify LINE signature
    const signature = req.headers["x-line-signature"] as string;
    if (!signature) {
      res.status(401).send("Missing signature");
      return;
    }

    const channelSecret = lineChannelSecret.value();
    const body = JSON.stringify(req.body);
    const expectedSig = crypto
      .createHmac("sha256", channelSecret)
      .update(body)
      .digest("base64");

    if (signature !== expectedSig) {
      logger.warn("Invalid LINE webhook signature");
      res.status(401).send("Invalid signature");
      return;
    }

    // Process events
    const events = req.body?.events ?? [];

    for (const event of events) {
      try {
        await handleEvent(event);
      } catch (err) {
        logger.error("Error handling LINE event", { event, error: err });
      }
    }

    // LINE expects 200 OK
    res.status(200).json({ status: "ok" });
  },
);

async function handleEvent(event: any): Promise<void> {
  if (event.type === "postback") {
    await handlePostback(event);
  }
  // Other event types can be added here
}

async function handlePostback(event: any): Promise<void> {
  const data = new URLSearchParams(event.postback.data);
  const action = data.get("action");
  const userId = data.get("userId");
  const replyToken = event.replyToken;

  if (!userId) {
    logger.warn("Postback missing userId", { data: event.postback.data });
    return;
  }

  switch (action) {
    case "checkout_now":
      await handleCheckoutNow(userId, replyToken);
      break;

    case "still_here":
      await handleStillHere(userId, replyToken);
      break;

    default:
      logger.warn("Unknown postback action", { action });
      if (replyToken) {
        await replyMessage(replyToken, [
          { type: "text", text: "不明なアクションです。" },
        ]);
      }
  }
}

/**
 * Handle "checkout now" postback from forgotten checkout notification.
 */
async function handleCheckoutNow(userId: string, replyToken: string): Promise<void> {
  const userRef = db().doc(`users/${userId}`);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    await replyMessage(replyToken, [
      { type: "text", text: "ユーザーが見つかりません。" },
    ]);
    return;
  }

  const user = userSnap.data() as UserDoc;

  if (user.currentStatus !== "in") {
    await replyMessage(replyToken, [
      { type: "text", text: "すでにチェックアウト済みです。" },
    ]);
    return;
  }

  const serverNow = Timestamp.now();

  // Find the check-in log for duration calculation
  const inLogSnap = await db()
    .collection("logs")
    .where("userId", "==", userId)
    .where("action", "==", "in")
    .where("voided", "==", false)
    .orderBy("timestamp", "desc")
    .limit(1)
    .get();

  let durSec: number | undefined;
  if (!inLogSnap.empty) {
    const inLog = inLogSnap.docs[0].data() as LogDoc;
    durSec = durationSeconds(inLog.timestamp, serverNow);
  }

  // Create checkout log
  const logRef = db().collection("logs").doc();
  const outLog: Record<string, unknown> = {
    userId,
    displayName: user.displayName,
    action: "out",
    timestamp: serverNow,
    clientTimestamp: serverNow,
    date: logicalDate(serverNow),
    yearMonth: logicalYearMonth(serverNow),
    year: jstYear(serverNow),
    dayOfWeek: jstDayOfWeek(serverNow),
    hour: jstHour(serverNow),
    isWeekend: isWeekend(serverNow),
    isHoliday: false,
    platform: "other",
    appVersion: "",
    liffVersion: "",
    method: "button",
    voided: false,
    voidedAt: null,
    raw: { source: "line-postback" },
    schemaVersion: 1,
  };

  await db().runTransaction(async (tx) => {
    tx.set(logRef, outLog);
    tx.update(userRef, {
      currentStatus: "out",
      lastActionAt: serverNow,
      currentSessionId: null,
    });
  });

  const durationMsg = durSec !== undefined ? `滞在時間: ${formatDuration(durSec)}` : "";
  await replyMessage(replyToken, [
    {
      type: "text",
      text: `チェックアウトしました！${durationMsg ? "\n" + durationMsg : ""}`,
    },
  ]);

  logger.info("Checkout via LINE postback", { userId, logId: logRef.id });
}

/**
 * Handle "still here" postback - just acknowledge.
 */
async function handleStillHere(userId: string, replyToken: string): Promise<void> {
  await replyMessage(replyToken, [
    {
      type: "text",
      text: "了解しました！引き続き頑張ってください！",
    },
  ]);
  logger.info("User confirmed still present via LINE postback", { userId });
}
