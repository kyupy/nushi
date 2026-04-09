import { useState, useCallback, useRef, useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { detectPlatform, getLiffVersion } from "../lib/liff";
import type {
  CheckInRequest,
  CheckInResponse,
  FixStampRequest,
  FixStampResponse,
  VoidLogRequest,
  VoidLogResponse,
  ToastMessage,
} from "../types";

const APP_VERSION = "1.0.0";

interface UseStampResult {
  /** Execute check-in or check-out */
  stamp: () => Promise<void>;
  /** Undo the last stamp action */
  undo: () => Promise<void>;
  /** Fix/add a manual stamp */
  fixStamp: (action: "in" | "out", timestamp: Date) => Promise<void>;
  /** Whether a stamp operation is in progress */
  stamping: boolean;
  /** Whether an undo is in progress */
  undoing: boolean;
  /** Whether a fix operation is in progress */
  fixing: boolean;
  /** Toast to display */
  toast: ToastMessage | null;
  /** Clear the current toast */
  clearToast: () => void;
  /** Seconds remaining for undo (0 = expired) */
  undoCountdown: number;
}

export function useStamp(): UseStampResult {
  const [stamping, setStamping] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(0);
  const lastLogIdRef = useRef<string | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Clean up undo timer on unmount
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) {
        clearInterval(undoTimerRef.current);
      }
    };
  }, []);

  const startUndoCountdown = useCallback((logId: string) => {
    lastLogIdRef.current = logId;
    setUndoCountdown(10);

    if (undoTimerRef.current) {
      clearInterval(undoTimerRef.current);
    }

    undoTimerRef.current = setInterval(() => {
      setUndoCountdown((prev) => {
        if (prev <= 1) {
          if (undoTimerRef.current) {
            clearInterval(undoTimerRef.current);
            undoTimerRef.current = null;
          }
          lastLogIdRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const clearToast = useCallback(() => {
    setToast(null);
  }, []);

  const formatDuration = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) {
      return `${h}時間${m}分`;
    }
    return `${m}分`;
  };

  const stamp = useCallback(async () => {
    setStamping(true);
    try {
      const checkIn = httpsCallable<CheckInRequest, CheckInResponse>(
        functions,
        "checkIn"
      );

      const result = await checkIn({
        clientTimestamp: Date.now(),
        platform: detectPlatform(),
        appVersion: APP_VERSION,
        liffVersion: getLiffVersion(),
      });

      const { action, logId, durationSeconds, message } = result.data;

      let toastText: string;
      if (action === "in") {
        toastText = "入室しました";
      } else {
        toastText = durationSeconds
          ? `退室しました（滞在 ${formatDuration(durationSeconds)}）`
          : "退室しました";
      }

      setToast({
        id: logId,
        text: toastText,
        type: "success",
        undoLogId: logId,
        duration: 10000,
      });

      startUndoCountdown(logId);

      // Log for debugging
      console.log("Stamp result:", message);
    } catch (err) {
      const message = err instanceof Error ? err.message : "打刻に失敗しました";
      setToast({
        id: crypto.randomUUID(),
        text: message,
        type: "error",
        duration: 5000,
      });
    } finally {
      setStamping(false);
    }
  }, [startUndoCountdown]);

  const undo = useCallback(async () => {
    const logId = lastLogIdRef.current;
    if (!logId) return;

    setUndoing(true);
    try {
      const voidLog = httpsCallable<VoidLogRequest, VoidLogResponse>(
        functions,
        "voidLog"
      );

      await voidLog({ logId });

      // Clear undo timer
      if (undoTimerRef.current) {
        clearInterval(undoTimerRef.current);
        undoTimerRef.current = null;
      }
      setUndoCountdown(0);
      lastLogIdRef.current = null;

      setToast({
        id: crypto.randomUUID(),
        text: "取り消しました",
        type: "info",
        duration: 3000,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "取り消しに失敗しました";
      setToast({
        id: crypto.randomUUID(),
        text: message,
        type: "error",
        duration: 5000,
      });
    } finally {
      setUndoing(false);
    }
  }, []);

  const fixStamp = useCallback(
    async (action: "in" | "out", timestamp: Date) => {
      setFixing(true);
      try {
        const fix = httpsCallable<FixStampRequest, FixStampResponse>(
          functions,
          "fixStamp"
        );

        const result = await fix({
          action,
          timestamp: timestamp.getTime(),
          platform: detectPlatform(),
          appVersion: APP_VERSION,
          liffVersion: getLiffVersion(),
        });

        setToast({
          id: result.data.logId,
          text: `打刻を${action === "in" ? "入室" : "退室"}として修正しました`,
          type: "success",
          duration: 5000,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "修正に失敗しました";
        setToast({
          id: crypto.randomUUID(),
          text: message,
          type: "error",
          duration: 5000,
        });
      } finally {
        setFixing(false);
      }
    },
    []
  );

  return {
    stamp,
    undo,
    fixStamp,
    stamping,
    undoing,
    fixing,
    toast,
    clearToast,
    undoCountdown,
  };
}
