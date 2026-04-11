import { useEffect, useState, useCallback } from "react";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  startAfter,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../hooks/useAuth";
import { useStamp } from "../hooks/useStamp";
import Toast from "../components/Toast";
import type { LogDoc } from "../types";

const PAGE_SIZE = 30;

interface LogEntry extends LogDoc {
  id: string;
}

function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function formatTimestamp(ts: { toDate: () => Date }): string {
  const d = ts.toDate();
  return d.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

const DAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

function roundTo15Min(date: Date): Date {
  const d = new Date(date);
  const m = d.getMinutes();
  d.setMinutes(Math.round(m / 15) * 15, 0, 0);
  return d;
}

export default function History() {
  const { firebaseUser } = useAuth();
  const { fixStamp, fixing, deleteLog, deleting, toast, clearToast } = useStamp();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Fix form state
  const [fixAction, setFixAction] = useState<"in" | "out">("in");
  const [fixDate, setFixDate] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  });
  const [fixTime, setFixTime] = useState(() => {
    const now = roundTo15Min(new Date());
    return now.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  });

  const fetchLogs = useCallback(
    async (after?: QueryDocumentSnapshot) => {
      if (!firebaseUser) return;

      setLoading(true);
      try {
        const logsRef = collection(db, "logs");
        const constraints = [
          where("userId", "==", firebaseUser.uid),
          where("voided", "==", false),
          orderBy("timestamp", "desc"),
          limit(PAGE_SIZE),
        ];

        const q = after
          ? query(logsRef, ...constraints, startAfter(after))
          : query(logsRef, ...constraints);

        const snapshot = await getDocs(q);
        const newLogs: LogEntry[] = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as LogDoc),
        }));

        if (after) {
          setLogs((prev) => [...prev, ...newLogs]);
        } else {
          setLogs(newLogs);
        }

        setLastDoc(snapshot.docs[snapshot.docs.length - 1] ?? null);
        setHasMore(snapshot.docs.length === PAGE_SIZE);
      } catch (err) {
        console.error("Failed to fetch logs:", err);
      } finally {
        setLoading(false);
      }
    },
    [firebaseUser]
  );

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const loadMore = () => {
    if (lastDoc && hasMore && !loading) {
      fetchLogs(lastDoc);
    }
  };

  const handleDelete = async (logId: string) => {
    await deleteLog(logId);
    fetchLogs();
  };

  const handleFixSubmit = async () => {
    const [h, m] = fixTime.split(":").map(Number);
    const [year, month, day] = fixDate.split("-").map(Number);
    const ts = new Date(year, month - 1, day, h, m, 0, 0);

    await fixStamp(fixAction, ts);
    setShowForm(false);
    // Refresh logs
    fetchLogs();
  };

  // Generate 15-minute time options
  const timeOptions: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      timeOptions.push(
        `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`
      );
    }
  }

  // Group logs by date
  const grouped: { date: string; dayOfWeek: number; items: LogEntry[] }[] = [];
  let currentGroup: (typeof grouped)[0] | null = null;
  for (const log of logs) {
    if (!currentGroup || currentGroup.date !== log.date) {
      currentGroup = { date: log.date, dayOfWeek: log.dayOfWeek, items: [] };
      grouped.push(currentGroup);
    }
    currentGroup.items.push(log);
  }

  return (
    <div className="px-4 pt-6">
      <Toast toast={toast} onDismiss={clearToast} />

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-bold text-gray-800">打刻履歴</h2>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-sm font-semibold text-line-green active:opacity-70 transition-opacity"
        >
          {showForm ? "閉じる" : "打刻を追加・修正"}
        </button>
      </div>

      {/* Fix stamp form */}
      {showForm && (
        <div className="card mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">
            打刻を追加・修正
          </h3>

          {/* Action toggle */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setFixAction("in")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors
                ${
                  fixAction === "in"
                    ? "bg-line-green text-white"
                    : "bg-gray-100 text-gray-500"
                }`}
            >
              入室
            </button>
            <button
              onClick={() => setFixAction("out")}
              className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors
                ${
                  fixAction === "out"
                    ? "bg-orange-500 text-white"
                    : "bg-gray-100 text-gray-500"
                }`}
            >
              退室
            </button>
          </div>

          {/* Date picker */}
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">日付</label>
            <input
              type="date"
              value={fixDate}
              onChange={(e) => setFixDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm
                         focus:outline-none focus:ring-2 focus:ring-line-green/30 focus:border-line-green"
            />
          </div>

          {/* Time picker (15-min increments) */}
          <div className="mb-4">
            <label className="block text-xs text-gray-500 mb-1">時刻</label>
            <select
              value={fixTime}
              onChange={(e) => setFixTime(e.target.value)}
              className="w-full px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm
                         focus:outline-none focus:ring-2 focus:ring-line-green/30 focus:border-line-green
                         appearance-none"
            >
              {timeOptions.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={handleFixSubmit}
            disabled={fixing}
            className="w-full btn-primary text-sm disabled:opacity-50"
          >
            {fixing ? "送信中..." : "打刻を送信"}
          </button>
        </div>
      )}

      {/* Logs list */}
      {loading && logs.length === 0 ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 rounded-full border-3 border-gray-200 border-t-line-green animate-spin" />
        </div>
      ) : logs.length === 0 ? (
        <div className="text-center py-12 text-gray-400 text-sm">
          履歴がありません
        </div>
      ) : (
        <>
          {grouped.map((group) => (
            <div key={group.date} className="mb-4">
              {/* Date header */}
              <div className="flex items-center gap-2 mb-2 px-1">
                <span className="text-sm font-semibold text-gray-600">
                  {formatDate(group.date)}
                </span>
                <span
                  className={`text-xs ${
                    group.dayOfWeek === 0
                      ? "text-red-400"
                      : group.dayOfWeek === 6
                        ? "text-blue-400"
                        : "text-gray-400"
                  }`}
                >
                  ({DAY_NAMES[group.dayOfWeek]})
                </span>
              </div>

              {/* Log items */}
              <div className="card space-y-0 divide-y divide-gray-50">
                {group.items.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    {/* Action indicator */}
                    <div
                      className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        log.action === "in" ? "bg-green-500" : "bg-orange-500"
                      }`}
                    />

                    {/* Time */}
                    <span className="text-sm font-medium text-gray-800 tabular-nums w-14">
                      {formatTimestamp(log.timestamp)}
                    </span>

                    {/* Action label */}
                    <span
                      className={`text-xs font-semibold px-2 py-0.5 rounded-md ${
                        log.action === "in"
                          ? "bg-green-50 text-green-600"
                          : "bg-orange-50 text-orange-600"
                      }`}
                    >
                      {log.action === "in" ? "入室" : "退室"}
                    </span>

                    {/* Method badge */}
                    {log.method !== "button" && (
                      <span className="text-[10px] text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">
                        {log.method === "manual-fix"
                          ? "修正"
                          : log.method === "auto-close"
                            ? "自動"
                            : log.method}
                      </span>
                    )}

                    {/* Delete button */}
                    <button
                      onClick={() => handleDelete(log.id)}
                      disabled={deleting}
                      className="ml-auto text-gray-300 active:text-red-400 transition-colors disabled:opacity-30"
                      aria-label="削除"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v6M14 11v6" />
                        <path d="M9 6V4h6v2" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Load more button */}
          {hasMore && (
            <div className="flex justify-center py-4">
              <button
                onClick={loadMore}
                disabled={loading}
                className="text-sm text-line-green font-semibold active:opacity-70 disabled:opacity-50"
              >
                {loading ? "読み込み中..." : "もっと見る"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
