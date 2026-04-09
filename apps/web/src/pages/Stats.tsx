import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../hooks/useAuth";
import type { MonthlyStatsDoc, UserMonthlyStatsDoc } from "../types";

function getCurrentYearMonth(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 7);
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) {
    return `${h}時間${m.toString().padStart(2, "0")}分`;
  }
  return `${m}分`;
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
}

function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="card text-center">
      <p className="text-xs text-gray-400 mb-1">{label}</p>
      <p className="text-xl font-bold text-gray-800">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

const DAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"];

export default function Stats() {
  const { firebaseUser } = useAuth();
  const [monthlyUser, setMonthlyUser] = useState<{
    totalSeconds: number;
    daysPresent: number;
    sessionCount: number;
    avgSessionMinutes: number;
  } | null>(null);
  const [userStats, setUserStats] = useState<UserMonthlyStatsDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [yearMonth] = useState(getCurrentYearMonth);

  useEffect(() => {
    if (!firebaseUser) return;

    const load = async () => {
      setLoading(true);
      try {
        // Fetch monthly stats for current user's data
        const monthlyRef = doc(db, "monthlyStats", yearMonth);
        const monthlySnap = await getDoc(monthlyRef);
        if (monthlySnap.exists()) {
          const data = monthlySnap.data() as MonthlyStatsDoc;
          const userEntry = data.users[firebaseUser.uid];
          if (userEntry) {
            setMonthlyUser(userEntry);
          }
        }

        // Fetch detailed user monthly stats
        const userStatsRef = doc(
          db,
          "userMonthlyStats",
          `${firebaseUser.uid}_${yearMonth}`
        );
        const userStatsSnap = await getDoc(userStatsRef);
        if (userStatsSnap.exists()) {
          setUserStats(userStatsSnap.data() as UserMonthlyStatsDoc);
        }
      } catch (err) {
        console.error("Failed to load stats:", err);
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [firebaseUser, yearMonth]);

  const formatMonth = (ym: string): string => {
    const [y, m] = ym.split("-").map(Number);
    return `${y}年${m}月`;
  };

  if (loading) {
    return (
      <div className="flex justify-center pt-20">
        <div className="w-8 h-8 rounded-full border-3 border-gray-200 border-t-line-green animate-spin" />
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 pb-4">
      <h2 className="text-lg font-bold text-gray-800 mb-1">
        個人統計
      </h2>
      <p className="text-xs text-gray-400 mb-6">{formatMonth(yearMonth)}</p>

      {!monthlyUser ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          今月のデータがまだありません
        </div>
      ) : (
        <>
          {/* Summary grid */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <StatCard
              label="合計滞在時間"
              value={formatDuration(monthlyUser.totalSeconds)}
            />
            <StatCard
              label="出席日数"
              value={`${monthlyUser.daysPresent}日`}
            />
            <StatCard
              label="平均セッション"
              value={`${Math.round(monthlyUser.avgSessionMinutes)}分`}
            />
            <StatCard
              label="セッション数"
              value={`${monthlyUser.sessionCount}回`}
            />
          </div>

          {/* Time details */}
          {userStats && (
            <>
              <div className="grid grid-cols-2 gap-3 mb-6">
                <StatCard
                  label="最も早い入室"
                  value={userStats.earliestIn || "--:--"}
                />
                <StatCard
                  label="最も遅い退室"
                  value={userStats.latestOut || "--:--"}
                />
                <StatCard
                  label="コアタイム"
                  value={formatDuration(userStats.coreSeconds)}
                  sub="平日 9:00-18:00"
                />
                <StatCard
                  label="夜間"
                  value={formatDuration(userStats.nightSeconds)}
                  sub="22:00-5:00"
                />
              </div>

              {/* Heatmap */}
              {userStats.heatmap && userStats.heatmap.length === 7 && (
                <div className="card">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">
                    活動ヒートマップ
                  </h3>
                  <div className="overflow-x-auto">
                    <div className="min-w-[320px]">
                      {/* Hour labels */}
                      <div className="flex gap-px ml-8 mb-1">
                        {Array.from({ length: 24 }, (_, h) => (
                          <div
                            key={h}
                            className="flex-1 text-center text-[8px] text-gray-400"
                          >
                            {h % 3 === 0 ? h : ""}
                          </div>
                        ))}
                      </div>

                      {/* Heatmap rows */}
                      {userStats.heatmap.map((hours, dayIdx) => {
                        const maxVal = Math.max(
                          ...userStats.heatmap.flat(),
                          1
                        );
                        return (
                          <div key={dayIdx} className="flex items-center gap-px mb-px">
                            <span
                              className={`w-7 text-[10px] text-right pr-1 flex-shrink-0 ${
                                dayIdx === 0
                                  ? "text-red-400"
                                  : dayIdx === 6
                                    ? "text-blue-400"
                                    : "text-gray-500"
                              }`}
                            >
                              {DAY_LABELS[dayIdx]}
                            </span>
                            {hours.map((val, hIdx) => {
                              const intensity = val / maxVal;
                              const bg =
                                val === 0
                                  ? "bg-gray-100"
                                  : intensity < 0.25
                                    ? "bg-green-100"
                                    : intensity < 0.5
                                      ? "bg-green-200"
                                      : intensity < 0.75
                                        ? "bg-green-400"
                                        : "bg-green-600";
                              return (
                                <div
                                  key={hIdx}
                                  className={`flex-1 aspect-square rounded-sm ${bg}`}
                                  title={`${DAY_LABELS[dayIdx]} ${hIdx}時: ${val}分`}
                                />
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="flex items-center justify-end gap-1 mt-2">
                    <span className="text-[9px] text-gray-400">少</span>
                    <div className="w-3 h-3 rounded-sm bg-gray-100" />
                    <div className="w-3 h-3 rounded-sm bg-green-100" />
                    <div className="w-3 h-3 rounded-sm bg-green-200" />
                    <div className="w-3 h-3 rounded-sm bg-green-400" />
                    <div className="w-3 h-3 rounded-sm bg-green-600" />
                    <span className="text-[9px] text-gray-400">多</span>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
