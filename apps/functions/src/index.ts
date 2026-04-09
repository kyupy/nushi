import { initializeApp } from "firebase-admin/app";

// Initialize Firebase Admin SDK
initializeApp();

// ---- Callable functions ----
export { authWithLine } from "./callable/authWithLine";
export { checkIn } from "./callable/checkIn";
export { fixStamp } from "./callable/fixStamp";
export { recalculate } from "./callable/recalculate";

// ---- Firestore triggers ----
export { onLogCreate } from "./triggers/onLogCreate";
export { onSessionCreate } from "./triggers/onSessionCreate";

// ---- Scheduled functions ----
export { dailyAggregate } from "./scheduled/dailyAggregate";
export { checkForgottenCheckout } from "./scheduled/checkForgottenCheckout";
export { monthlyRankingPost } from "./scheduled/monthlyRankingPost";

// ---- HTTP endpoints ----
export { lineBot } from "./webhook/lineBot";
