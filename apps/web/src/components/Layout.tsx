import { NavLink, Outlet } from "react-router-dom";
import NetworkBanner from "./NetworkBanner";
import type { TabId } from "../types";

interface TabDef {
  id: TabId;
  path: string;
  icon: string;
  label: string;
}

const tabs: TabDef[] = [
  { id: "home", path: "/", icon: "🏠", label: "ホーム" },
  { id: "ranking", path: "/ranking", icon: "📊", label: "ランキング" },
  { id: "history", path: "/history", icon: "📋", label: "履歴" },
  { id: "stats", path: "/stats", icon: "📈", label: "統計" },
  { id: "profile", path: "/profile", icon: "👤", label: "設定" },
];

export default function Layout() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <NetworkBanner />

      {/* Main content area with bottom padding for tab bar */}
      <main className="flex-1 pb-20 overflow-y-auto">
        <Outlet />
      </main>

      {/* Bottom tab navigation */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 safe-area-bottom z-30">
        <div className="flex items-stretch h-16">
          {tabs.map((tab) => (
            <NavLink
              key={tab.id}
              to={tab.path}
              end={tab.path === "/"}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors
                ${
                  isActive
                    ? "text-line-green font-semibold"
                    : "text-gray-400 hover:text-gray-600"
                }`
              }
            >
              <span className="text-lg leading-none">{tab.icon}</span>
              <span>{tab.label}</span>
            </NavLink>
          ))}
        </div>
        {/* iOS safe area spacer */}
        <div className="h-[env(safe-area-inset-bottom)]" />
      </nav>
    </div>
  );
}
