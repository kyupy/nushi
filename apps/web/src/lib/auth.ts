import { signInWithCustomToken } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "./firebase";
import { getIdToken } from "./liff";
import type { AuthWithLineRequest, AuthWithLineResponse } from "../types";

/**
 * Full auth flow:
 * 1. Get LINE ID token from LIFF SDK
 * 2. Call authWithLine callable function to exchange it for a Firebase custom token
 * 3. Sign in to Firebase with the custom token
 */
export async function authenticateWithLine(): Promise<void> {
  const idToken = getIdToken();
  if (!idToken) {
    throw new Error("LINE ID token not available. Make sure LIFF is initialized and user is logged in.");
  }

  const authWithLine = httpsCallable<AuthWithLineRequest, AuthWithLineResponse>(
    functions,
    "authWithLine"
  );

  const result = await authWithLine({ idToken });
  const { customToken } = result.data;

  await signInWithCustomToken(auth, customToken);
}

export function getCurrentUserId(): string | null {
  return auth.currentUser?.uid ?? null;
}

export function isAuthenticated(): boolean {
  return auth.currentUser !== null;
}
