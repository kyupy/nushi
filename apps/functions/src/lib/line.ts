import axios from "axios";
import { defineSecret } from "firebase-functions/params";
import { logger } from "firebase-functions/v2";

// ----------------------------------------------------------------
// Params (all managed via Secret Manager)
// ----------------------------------------------------------------

export const lineChannelId = defineSecret("LINE_CHANNEL_ID");
export const lineChannelSecret = defineSecret("LINE_CHANNEL_SECRET");
export const lineMessagingToken = defineSecret("LINE_MESSAGING_TOKEN");
export const lineGroupId = defineSecret("LINE_GROUP_ID");

// ----------------------------------------------------------------
// LINE Messaging API helpers
// ----------------------------------------------------------------

const MESSAGING_API_BASE = "https://api.line.me/v2/bot";

interface LineMessage {
  type: string;
  text?: string;
  [key: string]: unknown;
}

/**
 * Send a push message to a user or group.
 */
export async function pushMessage(
  to: string,
  messages: LineMessage[],
): Promise<void> {
  const token = lineMessagingToken.value();
  try {
    await axios.post(
      `${MESSAGING_API_BASE}/message/push`,
      { to, messages },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      logger.error("LINE push message failed", {
        status: err.response?.status,
        data: err.response?.data,
      });
    }
    throw err;
  }
}

/**
 * Reply to a webhook event using a reply token.
 */
export async function replyMessage(
  replyToken: string,
  messages: LineMessage[],
): Promise<void> {
  const token = lineMessagingToken.value();
  try {
    await axios.post(
      `${MESSAGING_API_BASE}/message/reply`,
      { replyToken, messages },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err: unknown) {
    if (axios.isAxiosError(err)) {
      logger.error("LINE reply message failed", {
        status: err.response?.status,
        data: err.response?.data,
      });
    }
    throw err;
  }
}

/**
 * Send a text push message to a single user.
 */
export async function pushTextMessage(to: string, text: string): Promise<void> {
  await pushMessage(to, [{ type: "text", text }]);
}

/**
 * Send a push message with quick reply actions.
 */
export async function pushMessageWithQuickReply(
  to: string,
  text: string,
  quickReplyItems: Array<{
    type: "action";
    action: { type: string; label: string; data?: string; text?: string; uri?: string };
  }>,
): Promise<void> {
  await pushMessage(to, [
    {
      type: "text",
      text,
      quickReply: { items: quickReplyItems },
    },
  ]);
}

/**
 * Send a push message to the configured LINE group.
 */
export async function pushToGroup(messages: LineMessage[]): Promise<void> {
  const groupId = lineGroupId.value();
  await pushMessage(groupId, messages);
}

/**
 * Send a text message to the configured LINE group.
 */
export async function pushTextToGroup(text: string): Promise<void> {
  await pushToGroup([{ type: "text", text }]);
}

// ----------------------------------------------------------------
// LINE Login / ID Token verification
// ----------------------------------------------------------------

/**
 * Verify a LINE ID token and return the user profile.
 */
export async function verifyIdToken(
  idToken: string,
): Promise<{
  sub: string; // LINE userId
  name: string;
  picture?: string;
}> {
  const channelId = lineChannelId.value();
  const resp = await axios.post(
    "https://api.line.me/oauth2/v2.1/verify",
    new URLSearchParams({
      id_token: idToken,
      client_id: channelId,
    }).toString(),
    {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    },
  );
  return resp.data;
}
