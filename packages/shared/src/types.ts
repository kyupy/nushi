import type { Timestamp } from "firebase-admin/firestore";

// ============================================================
// Firestore Document Types
// ============================================================

export interface UserDoc {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
  joinedAt: Timestamp;
  currentStatus: "in" | "out";
  lastActionAt: Timestamp;
  currentSessionId: string | null;
  optOut: boolean;
  role: "member" | "admin";
  schemaVersion: number;
}

export type StampMethod = "button" | "auto-close" | "manual-fix" | "undo";
export type Platform = "ios" | "android" | "pc" | "other";

export interface LogDoc {
  userId: string;
  displayName: string;
  action: "in" | "out";
  timestamp: Timestamp;
  clientTimestamp: Timestamp;

  // Time decomposition (redundant for query efficiency)
  date: string; // "2026-04-08"
  yearMonth: string; // "2026-04"
  year: number;
  dayOfWeek: number; // 0=Sun
  hour: number;
  isWeekend: boolean;
  isHoliday: boolean;

  // Environment
  platform: Platform;
  appVersion: string;
  liffVersion: string;

  // Method
  method: StampMethod;

  // Soft delete (undo tap)
  voided: boolean;
  voidedAt: Timestamp | null;

  // Extension
  raw: Record<string, unknown>;
  schemaVersion: number;
}

export interface SessionDoc {
  userId: string;
  displayName: string;
  checkIn: Timestamp;
  checkOut: Timestamp;
  durationSeconds: number;

  date: string;
  yearMonth: string;
  dayOfWeek: number;
  hourIn: number;
  hourOut: number;
  isWeekend: boolean;
  isHoliday: boolean;

  nightSeconds: number; // 22:00–05:00
  coreSeconds: number; // weekday 09:00–18:00

  autoClosed: boolean;
  voided: boolean;
  schemaVersion: number;
}

export interface MonthlyStatsDoc {
  yearMonth: string;
  updatedAt: Timestamp;

  users: {
    [userId: string]: {
      displayName: string;
      pictureUrl: string | null;
      totalSeconds: number;
      daysPresent: number;
      sessionCount: number;
      avgSessionMinutes: number;
    };
  };

  rankings: {
    totalTime: string[];
    daysPresent: string[];
    earlyBird: string[];
    nightOwl: string[];
    weekendWarrior: string[];
    streak: string[];
  };
}

export interface UserMonthlyStatsDoc {
  userId: string;
  displayName: string;
  earliestIn: string; // "07:32"
  latestOut: string; // "23:45"
  weekendSeconds: number;
  nightSeconds: number;
  coreSeconds: number;
  maxStreak: number;
  heatmap: number[]; // 168要素のフラットな配列に変更 (dayOfWeek * 24 + hour)
  schemaVersion: number;
}

export interface DailyStatsDoc {
  date: string;
  totalSessions: number;
  totalSeconds: number;
  uniqueUsers: number;
  updatedAt: Timestamp;
}

export interface ConfigDoc {
  autoCloseThresholdHours: number;
  forgottenCheckoutNotifyHours: number;
  timezone: string;
  dayBoundaryHour: number; // 5 = 05:00 JST
}

// ============================================================
// Callable Function Request/Response Types
// ============================================================

export interface AuthWithLineRequest {
  idToken: string;
}

export interface AuthWithLineResponse {
  customToken: string;
}

export interface CheckInRequest {
  clientTimestamp: number; // epoch ms
  platform: Platform;
  appVersion: string;
  liffVersion: string;
}

export interface CheckInResponse {
  action: "in" | "out";
  logId: string;
  durationSeconds?: number; // only on checkout
  message: string;
}

export interface FixStampRequest {
  action: "in" | "out";
  timestamp: number; // epoch ms of the corrected time
  platform: Platform;
  appVersion: string;
  liffVersion: string;
}

export interface FixStampResponse {
  logId: string;
  message: string;
}

export interface VoidLogRequest {
  logId: string;
}

export interface VoidLogResponse {
  success: boolean;
}
