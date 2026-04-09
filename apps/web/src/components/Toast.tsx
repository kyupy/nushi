import { useEffect, useState } from "react";
import type { ToastMessage } from "../types";

interface ToastProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
  onUndo?: () => void;
  undoCountdown?: number;
}

export default function Toast({
  toast,
  onDismiss,
  onUndo,
  undoCountdown = 0,
}: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) {
      setVisible(false);
      return;
    }

    // Trigger enter animation
    const showTimer = setTimeout(() => setVisible(true), 10);

    // Auto-dismiss
    const duration = toast.duration ?? 5000;
    const dismissTimer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300); // Wait for exit animation
    }, duration);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(dismissTimer);
    };
  }, [toast, onDismiss]);

  if (!toast) return null;

  const bgColor =
    toast.type === "success"
      ? "bg-line-green"
      : toast.type === "error"
        ? "bg-red-500"
        : "bg-gray-700";

  return (
    <div
      className={`
        fixed top-4 left-4 right-4 z-50 transition-all duration-300 ease-out
        ${visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"}
      `}
    >
      <div
        className={`${bgColor} text-white rounded-xl px-4 py-3 shadow-lg flex items-center justify-between gap-3`}
      >
        <span className="text-sm font-medium flex-1">{toast.text}</span>
        {toast.undoLogId && undoCountdown > 0 && onUndo && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUndo();
            }}
            className="flex-shrink-0 bg-white/20 hover:bg-white/30 text-white text-xs font-bold
                       rounded-lg px-3 py-1.5 transition-colors"
          >
            取消 ({undoCountdown})
          </button>
        )}
      </div>
    </div>
  );
}
