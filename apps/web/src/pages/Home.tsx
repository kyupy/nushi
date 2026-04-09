import { useEffect, useState } from "react";
import { doc, onSnapshot, collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../hooks/useAuth";
import { useStamp } from "../hooks/useStamp";
import Toast from "../components/Toast";
import type { SessionDoc } from "../types";

export default function Home() {
  const { userDoc, firebaseUser } = useAuth();
  const { stamp, undo, stamping, undoing, toast, clearToast, undoCountdown } = useStamp();
  const [todaySeconds, setTodaySeconds] = useState(0);
  const [currentSessionStart, setCurrentSessionStart] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const isIn = userDoc?.currentStatus === "in";

  // Get today's date string in JST
  const getTodayDateStr = (): string => {
    const now = new Date();
    const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
  };

  // Fetch today's total time from completed sessions
  useEffect(() => {
    if (!firebaseUser) return;

    const today = getTodayDateStr();
    const sessionsRef = collection(db, "sessions");
    const q = query(
      sessionsRef,
      where("userId", "==", firebaseUser.uid),
      where("date", "==", today),
      where("voided", "==", false),
      orderBy("checkIn", "desc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let total = 0;
      snapshot.forEach((doc) => {
        const session = doc.data() as SessionDoc;
        total += session.durationSeconds;
      });
      setTodaySeconds(total);
    });

    return unsubscribe;
  }, [firebaseUser]);

  // Track current session start time from lastActionAt when status is "in"
  useEffect(() => {
    if (isIn && userDoc?.lastActionAt) {
      setCurrentSessionStart(userDoc.lastActionAt.toDate());
    } else {
      setCurrentSessionStart(null);
    }
  }, [isIn, userDoc?.lastActionAt]);

  // Elapsed timer for current session
  useEffect(() => {
    if (!currentSessionStart) {
      setElapsed(0);
      return;
    }

    const update = () => {
      const now = Date.now();
      setElapsed(Math.floor((now - currentSessionStart.getTime()) / 1000));
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [currentSessionStart]);

  const formatTime = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) {
      return `${h}時間${m.toString().padStart(2, "0")}分`;
    }
    return `${m}分`;
  };

  const formatTimeLarge = (seconds: number): { hours: string; minutes: string } => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return { hours: h.toString(), minutes: m.toString().padStart(2, "0") };
  };

  const handleStamp = async () => {
    if (stamping || undoing) return;
    await stamp();
  };

  const totalDisplay = formatTimeLarge(todaySeconds + (isIn ? elapsed : 0));

  return (
    <div className="flex flex-col items-center px-6 pt-8">
      <Toast
        toast={toast}
        onDismiss={clearToast}
        onUndo={undo}
        undoCountdown={undoCountdown}
      />

      {/* Header */}
      <h1 className="text-lg font-bold text-gray-800 mb-1">
        院生室プレゼンス
      </h1>
      <p className="text-xs text-gray-400 mb-8">
        {userDoc?.displayName ?? "..."}
      </p>

      {/* Status badge */}
      <div
        className={`
          inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold mb-6
          ${isIn
            ? "bg-green-100 text-green-700"
            : "bg-gray-100 text-gray-500"
          }
        `}
      >
        <span
          className={`w-2.5 h-2.5 rounded-full ${
            isIn ? "bg-green-500 animate-pulse" : "bg-gray-400"
          }`}
        />
        {isIn ? "在室中" : "退室中"}
      </div>

      {/* Large stamp button */}
      <button
        onClick={handleStamp}
        disabled={stamping || undoing}
        className={`
          relative w-40 h-40 rounded-full shadow-lg transition-all duration-200
          active:scale-90 disabled:opacity-70 disabled:active:scale-100
          flex items-center justify-center
          ${isIn
            ? "bg-gradient-to-br from-orange-400 to-red-500 shadow-red-200"
            : "bg-gradient-to-br from-green-400 to-line-green shadow-green-200"
          }
        `}
      >
        {stamping ? (
          <div className="w-8 h-8 rounded-full border-3 border-white border-t-transparent animate-spin" />
        ) : (
          <span className="text-white text-xl font-bold">
            {isIn ? "退室する" : "入室する"}
          </span>
        )}
      </button>

      {/* Current session elapsed */}
      {isIn && (
        <div className="mt-6 text-center">
          <p className="text-xs text-gray-400 mb-1">現在のセッション</p>
          <p className="text-2xl font-bold text-gray-800 tabular-nums">
            {formatTime(elapsed)}
          </p>
        </div>
      )}

      {/* Today's total */}
      <div className="mt-8 card w-full max-w-xs text-center">
        <p className="text-xs text-gray-400 mb-2">今日の滞在時間</p>
        <div className="flex items-baseline justify-center gap-1">
          <span className="text-4xl font-bold text-gray-800 tabular-nums">
            {totalDisplay.hours}
          </span>
          <span className="text-sm text-gray-500">時間</span>
          <span className="text-4xl font-bold text-gray-800 tabular-nums">
            {totalDisplay.minutes}
          </span>
          <span className="text-sm text-gray-500">分</span>
        </div>
      </div>
    </div>
  );
}
