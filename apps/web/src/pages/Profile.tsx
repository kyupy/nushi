import { useState, useCallback } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import { useAuth } from "../hooks/useAuth";
import Toast from "../components/Toast";
import type { ToastMessage, UpdateProfileRequest, UpdateProfileResponse } from "../types";

export default function Profile() {
  const { userDoc, firebaseUser } = useAuth();
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [toggling, setToggling] = useState(false);

  const clearToast = useCallback(() => setToast(null), []);

  const handleOptOutToggle = async () => {
    if (!userDoc || toggling) return;

    setToggling(true);
    try {
      const updateProfile = httpsCallable<UpdateProfileRequest, UpdateProfileResponse>(
        functions,
        "updateProfile"
      );

      await updateProfile({ optOut: !userDoc.optOut });

      setToast({
        id: crypto.randomUUID(),
        text: userDoc.optOut
          ? "ランキングに表示されるようになりました"
          : "ランキングから非表示になりました",
        type: "success",
        duration: 3000,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "更新に失敗しました";
      setToast({
        id: crypto.randomUUID(),
        text: message,
        type: "error",
        duration: 5000,
      });
    } finally {
      setToggling(false);
    }
  };

  const formatDate = (ts: { toDate: () => Date } | undefined): string => {
    if (!ts) return "--";
    const d = ts.toDate();
    return d.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  return (
    <div className="px-4 pt-6">
      <Toast toast={toast} onDismiss={clearToast} />

      <h2 className="text-lg font-bold text-gray-800 mb-6">プロフィール</h2>

      {/* User card */}
      <div className="card flex items-center gap-4 mb-6">
        <div className="w-16 h-16 rounded-full bg-gray-200 overflow-hidden flex-shrink-0">
          {userDoc?.pictureUrl ? (
            <img
              src={userDoc.pictureUrl}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-400 text-2xl">
              👤
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-semibold text-gray-800 truncate">
            {userDoc?.displayName ?? "..."}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {firebaseUser?.uid
              ? `ID: ${firebaseUser.uid.slice(0, 8)}...`
              : ""}
          </p>
        </div>
      </div>

      {/* Info items */}
      <div className="card mb-6 divide-y divide-gray-50">
        <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
          <span className="text-sm text-gray-600">登録日</span>
          <span className="text-sm text-gray-800">
            {formatDate(userDoc?.joinedAt)}
          </span>
        </div>

        <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
          <span className="text-sm text-gray-600">ステータス</span>
          <span
            className={`text-sm font-semibold ${
              userDoc?.currentStatus === "in"
                ? "text-green-600"
                : "text-gray-500"
            }`}
          >
            {userDoc?.currentStatus === "in" ? "在室中" : "退室中"}
          </span>
        </div>

        <div className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
          <span className="text-sm text-gray-600">権限</span>
          <span className="text-sm text-gray-800">
            {userDoc?.role === "admin" ? "管理者" : "メンバー"}
          </span>
        </div>
      </div>

      {/* Settings */}
      <div className="card mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">設定</h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700">ランキング非表示</p>
            <p className="text-xs text-gray-400 mt-0.5">
              オンにするとランキングに表示されなくなります
            </p>
          </div>
          <button
            onClick={handleOptOutToggle}
            disabled={toggling}
            className={`
              relative w-12 h-7 rounded-full transition-colors duration-200 flex-shrink-0
              ${userDoc?.optOut ? "bg-line-green" : "bg-gray-300"}
              ${toggling ? "opacity-50" : ""}
            `}
            role="switch"
            aria-checked={userDoc?.optOut ?? false}
          >
            <span
              className={`
                absolute top-0.5 w-6 h-6 bg-white rounded-full shadow transition-transform duration-200
                ${userDoc?.optOut ? "translate-x-5" : "translate-x-0.5"}
              `}
            />
          </button>
        </div>
      </div>

      {/* App info */}
      <div className="text-center text-xs text-gray-300 mt-8">
        <p>院生室ランキング v1.0.0</p>
      </div>
    </div>
  );
}
