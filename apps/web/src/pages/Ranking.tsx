import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../hooks/useAuth";
import type { MonthlyStatsDoc } from "../types";

interface RankEntry {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
  totalSeconds: number;
  daysPresent: number;
  rank: number;
}

const rankBadges: Record<number, string> = {
  1: "🥇",
  2: "🥈",
  3: "🥉",
};

function getCurrentYearMonth(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 7);
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m.toString().padStart(2, "0")}m`;
}

export default function Ranking() {
  const { firebaseUser } = useAuth();
  const [entries, setEntries] = useState<RankEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [yearMonth, setYearMonth] = useState(getCurrentYearMonth);

  // Navigate months
  const prevMonth = () => {
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m - 2, 1);
    setYearMonth(
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`
    );
  };

  const nextMonth = () => {
    const current = getCurrentYearMonth();
    const [y, m] = yearMonth.split("-").map(Number);
    const d = new Date(y, m, 1);
    const next = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;
    if (next <= current) {
      setYearMonth(next);
    }
  };

  const isCurrentMonth = yearMonth === getCurrentYearMonth();

  useEffect(() => {
    setLoading(true);
    const docRef = doc(db, "stats", "monthly", yearMonth, "_root_");
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setEntries([]);
          setLoading(false);
          return;
        }

        const data = snapshot.data() as MonthlyStatsDoc;

        // Build ranked entries from users map, excluding opted-out users
        const ranked: RankEntry[] = Object.entries(data.users)
          .map(([userId, user]) => ({
            userId,
            displayName: user.displayName,
            pictureUrl: user.pictureUrl,
            totalSeconds: user.totalSeconds,
            daysPresent: user.daysPresent,
            rank: 0,
          }))
          .sort((a, b) => b.totalSeconds - a.totalSeconds)
          .map((entry, index) => ({ ...entry, rank: index + 1 }));

        setEntries(ranked);
        setLoading(false);
      },
      (err) => {
        console.error("Failed to fetch monthly stats:", err);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [yearMonth]);

  const formatMonthDisplay = (ym: string): string => {
    const [y, m] = ym.split("-").map(Number);
    return `${y}年${m}月`;
  };

  return (
    <div className="px-4 pt-6">
      {/* Month selector */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={prevMonth}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 active:bg-gray-200 transition-colors text-gray-600"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12 15L7 10L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        <h2 className="text-lg font-bold text-gray-800">
          {formatMonthDisplay(yearMonth)}
        </h2>

        <button
          onClick={nextMonth}
          disabled={isCurrentMonth}
          className={`w-10 h-10 flex items-center justify-center rounded-full transition-colors
            ${isCurrentMonth
              ? "text-gray-300 cursor-not-allowed"
              : "hover:bg-gray-100 active:bg-gray-200 text-gray-600"
            }`}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M8 5L13 10L8 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Ranking list */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 rounded-full border-3 border-gray-200 border-t-line-green animate-spin" />
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          データがありません
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => {
            const isMe = entry.userId === firebaseUser?.uid;
            return (
              <div
                key={entry.userId}
                className={`card flex items-center gap-3 ${
                  isMe ? "ring-2 ring-line-green/30 bg-green-50/50" : ""
                }`}
              >
                {/* Rank */}
                <div className="w-8 text-center flex-shrink-0">
                  {rankBadges[entry.rank] ? (
                    <span className="text-xl">{rankBadges[entry.rank]}</span>
                  ) : (
                    <span className="text-sm font-bold text-gray-400">
                      {entry.rank}
                    </span>
                  )}
                </div>

                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-gray-200 overflow-hidden flex-shrink-0">
                  {entry.pictureUrl ? (
                    <img
                      src={entry.pictureUrl}
                      alt=""
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-lg">
                      👤
                    </div>
                  )}
                </div>

                {/* Name & days */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate">
                    {entry.displayName}
                    {isMe && (
                      <span className="ml-1 text-xs text-line-green font-normal">
                        (自分)
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-400">
                    {entry.daysPresent}日間
                  </p>
                </div>

                {/* Total time */}
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-bold text-gray-800 tabular-nums">
                    {formatDuration(entry.totalSeconds)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
