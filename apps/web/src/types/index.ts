import type { Timestamp } from "firebase/firestore";

// Re-export shared types but with client-side Timestamp
// The shared package uses firebase-admin Timestamp; we mirror the shapes here
// using the client SDK Timestamp for frontend use.

export type { Timestamp };

export type StampMethod = "button" | "auto-close" | "manual-fix" | "undo";
export type Platform = "ios" | "android" | "pc" | "other";
export type UserStatus = "in" | "out";

export interface UserDoc {
  userId: string;
  displayName: string;
  pictureUrl: string | null;
  joinedAt: Timestamp;
  currentStatus: UserStatus;
  lastActionAt: Timestamp;
  currentSessionId: string | null;
  optOut: boolean;
  role: "member" | "admin";
  schemaVersion: number;
}

export interface LogDoc {
  userId: string;
  displayName: string;
  action: "in" | "out";
  timestamp: Timestamp;
  clientTimestamp: Timestamp;
  date: string;
  yearMonth: string;
  year: number;
  dayOfWeek: number;
  hour: number;
  isWeekend: boolean;
  isHoliday: boolean;
  platform: Platform;
  appVersion: string;
  liffVersion: string;
  method: StampMethod;
  voided: boolean;
  voidedAt: Timestamp | null;
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
  nightSeconds: number;
  coreSeconds: number;
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
  earliestIn: string;
  latestOut: string;
  weekendSeconds: number;
  nightSeconds: number;
  coreSeconds: number;
  maxStreak: number;
  heatmap: number[][];
  schemaVersion: number;
}

// Callable types (mirrored from shared)
export interface AuthWithLineRequest {
  idToken: string;
}

export interface AuthWithLineResponse {
  customToken: string;
}

export interface CheckInRequest {
  clientTimestamp: number;
  platform: Platform;
  appVersion: string;
  liffVersion: string;
}

export interface CheckInResponse {
  action: "in" | "out";
  logId: string;
  durationSeconds?: number;
  message: string;
}

export interface FixStampRequest {
  action: "in" | "out";
  timestamp: number;
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

export interface UpdateProfileRequest {
  optOut?: boolean;
  displayName?: string;
}

export interface UpdateProfileResponse {
  success: boolean;
}

// Frontend-specific types

export interface ToastMessage {
  id: string;
  text: string;
  type: "success" | "error" | "info";
  undoLogId?: string;
  duration?: number;
}

export type TabId = "home" | "ranking" | "history" | "stats" | "profile";
