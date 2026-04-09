import liff from "@line/liff";
import type { Platform } from "../types";

let initialized = false;

export async function initLiff(): Promise<void> {
  if (initialized) return;

  const liffId = import.meta.env.VITE_LIFF_ID;
  if (!liffId) {
    throw new Error("VITE_LIFF_ID is not set");
  }

  await liff.init({ liffId });
  initialized = true;

  // If not logged in via LINE, redirect to login
  if (!liff.isLoggedIn()) {
    liff.login();
  }
}

export function getIdToken(): string | null {
  return liff.getIDToken();
}

export function getLiffVersion(): string {
  try {
    // The SDK version is accessible from the module
    return liff.getVersion?.() ?? "unknown";
  } catch {
    return "unknown";
  }
}

export function detectPlatform(): Platform {
  const os = liff.getOS();
  if (os === "ios") return "ios";
  if (os === "android") return "android";
  // liff.getOS() returns "web" for PC browsers
  if (os === "web") return "pc";
  return "other";
}

export function isInLiffBrowser(): boolean {
  return liff.isInClient();
}

export { liff };
