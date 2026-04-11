import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/v2";
import { validateSignature } from "@line/bot-sdk";
import {
  replyMessage,
  lineChannelSecret,
  lineMessagingToken,
} from "../lib/line";

/**
 * LINE Bot webhook endpoint.
 * Handles postback events from quick reply actions (forgotten checkout notifications).
 */
export const lineBot = onRequest(
  {
    region: "asia-northeast1",
    secrets: [lineChannelSecret, lineMessagingToken],
    invoker: "public",
  },
  async (req, res): Promise<void> => {
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

    const channelSecret = lineChannelSecret.value().trim();

    // Obtain raw body bytes for HMAC-SHA256 signature verification.
    //
    // Priority:
    //  1. req.rawBody (Buffer) — set by GCF/Cloud Run in production
    //  2. req.rawBody (string) — unlikely but safe to handle
    //  3. JSON.stringify(req.body) — body already parsed by Express middleware
    //  4. Read from the request stream — no body-parser in the pipeline
    //
    // NOTE: The TypeScript type declares rawBody as Buffer (non-optional), but
    // in practice it can be undefined in some configurations, hence the
    // explicit runtime checks below.
    const rawBodyBuf: Buffer = await (async () => {
      const rb = req.rawBody as Buffer | undefined;
      if (rb != null) {
        return Buffer.isBuffer(rb) ? rb : Buffer.from(rb);
      }
      if (req.body !== undefined && typeof req.body === "object") {
        return Buffer.from(JSON.stringify(req.body), "utf8");
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
      }
      return Buffer.concat(chunks);
    })();

    if (!validateSignature(rawBodyBuf, channelSecret, signature)) {
      logger.warn("Invalid LINE webhook signature");
      res.status(401).send("Invalid signature");
      return;
    }

    // Parse body if the stream was read directly (req.body not yet set).
    const parsedBody: { events?: unknown[] } =
      req.body && typeof req.body === "object"
        ? (req.body as { events?: unknown[] })
        : JSON.parse(rawBodyBuf.toString("utf8"));

    // Process events
    const events = parsedBody.events ?? [];

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
  // --- TEMP: log groupId for setup ---
  if (event.source?.groupId) {
    logger.info("LINE groupId", { groupId: event.source.groupId, eventType: event.type });
  }
  // --- END TEMP ---

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
    case "already_left": {
      const liffUrl = data.get("liffUrl") ?? "";
      await handleAlreadyLeft(replyToken, liffUrl);
      break;
    }

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
 * Handle "already left" postback - reply with a link to the history/fix screen.
 */
async function handleAlreadyLeft(replyToken: string, liffUrl: string): Promise<void> {
  const text = liffUrl
    ? `打刻を修正してください👇\n${liffUrl}`
    : "アプリの履歴画面から打刻を修正してください。";
  await replyMessage(replyToken, [{ type: "text", text }]);
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
