import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import { verifyIdToken, lineChannelSecret, lineMessagingToken } from "../lib/line";
import type { AuthWithLineRequest, AuthWithLineResponse, UserDoc } from "@nushi/shared";

const db = () => getFirestore();

export const authWithLine = onCall<AuthWithLineRequest>(
  {
    region: "asia-northeast1",
    secrets: [lineChannelSecret, lineMessagingToken],
  },
  async (request): Promise<AuthWithLineResponse> => {
    const { idToken } = request.data;

    if (!idToken || typeof idToken !== "string") {
      throw new HttpsError("invalid-argument", "idToken is required");
    }

    // Verify LINE ID token
    let lineProfile: { sub: string; name: string; picture?: string };
    try {
      lineProfile = await verifyIdToken(idToken);
    } catch (err) {
      logger.error("LINE ID token verification failed", err);
      throw new HttpsError("unauthenticated", "Invalid LINE ID token");
    }

    const userId = lineProfile.sub;
    const displayName = lineProfile.name;
    const pictureUrl = lineProfile.picture ?? null;

    // Create or update user document in Firestore
    const userRef = db().doc(`users/${userId}`);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      // New user
      const newUser: Omit<UserDoc, "joinedAt" | "lastActionAt"> & {
        joinedAt: ReturnType<typeof FieldValue.serverTimestamp>;
        lastActionAt: ReturnType<typeof FieldValue.serverTimestamp>;
      } = {
        userId,
        displayName,
        pictureUrl,
        joinedAt: FieldValue.serverTimestamp() as any,
        currentStatus: "out",
        lastActionAt: FieldValue.serverTimestamp() as any,
        currentSessionId: null,
        optOut: false,
        role: "member",
        schemaVersion: 1,
      };
      await userRef.set(newUser);
      logger.info("New user created", { userId, displayName });
    } else {
      // Update display name and picture
      await userRef.update({
        displayName,
        pictureUrl,
      });
    }

    // Ensure Firebase Auth user exists
    try {
      await getAuth().getUser(userId);
    } catch {
      await getAuth().createUser({
        uid: userId,
        displayName,
        photoURL: pictureUrl ?? undefined,
      });
    }

    // Create custom token
    const customToken = await getAuth().createCustomToken(userId);

    return { customToken };
  },
);
