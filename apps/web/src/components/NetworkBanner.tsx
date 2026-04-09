import { useEffect, useState } from "react";

export default function NetworkBanner() {
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (online) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-40 bg-amber-500 text-white text-center text-xs font-medium py-1.5 px-4">
      オフラインです。一部の機能が利用できません。
    </div>
  );
}
