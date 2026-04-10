import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { logger } from "firebase-functions/v2";
import type { VoidLogRequest, VoidLogResponse, LogDoc } from "@nushi/shared";

const db = () => getFirestore();

export const voidLog = onCall<VoidLogRequest>(
  { region: "asia-northeast1" },
  async (request): Promise<VoidLogResponse> => {
    // 1. 認証チェック
    const userId = request.auth?.uid;
    if (!userId) {
      throw new HttpsError("unauthenticated", "ログインが必要です");
    }

    const { logId } = request.data;
    if (!logId) {
      throw new HttpsError("invalid-argument", "logIdが必要です");
    }

    const logRef = db().doc(`logs/${logId}`);
    const logSnap = await logRef.get();

    if (!logSnap.exists) {
      throw new HttpsError("not-found", "該当のログが見つかりません");
    }

    const logData = logSnap.data() as LogDoc;
    
    // 他人のログは消せないようにする
    if (logData.userId !== userId) {
      throw new HttpsError("permission-denied", "自分の打刻のみ取り消せます");
    }

    // 2. ログ自体を「無効(voided)」にする
    await logRef.update({ voided: true });

    // 3. もし「退室(out)」の取り消しなら、一緒に作られてしまったセッション記録も無効化する
    if (logData.action === "out") {
      const sessionsSnap = await db()
        .collection("sessions")
        .where("userId", "==", userId)
        .where("checkOut", "==", logData.timestamp)
        .where("voided", "==", false)
        .get();

      const batch = db().batch();
      sessionsSnap.forEach((doc) => {
        batch.update(doc.ref, { voided: true });
      });
      await batch.commit();
    }

    // 4. ユーザーの現在のステータスを逆に戻す（入室の取り消しなら退室状態へ）
    const newStatus = logData.action === "in" ? "out" : "in";
    const prevLogsSnap = await db()
      .collection("logs")
      .where("userId", "==", userId)
      .where("voided", "==", false) // 有効なものだけ
      .orderBy("timestamp", "desc") // 最新順に
      .limit(1)
      .get();

    // 1つ前の打刻時刻があればそれを、無ければそのままの時間をセット
    let revertedLastActionAt = logData.timestamp; 
    if (!prevLogsSnap.empty) {
      revertedLastActionAt = prevLogsSnap.docs[0].data().timestamp;
    }

    // currentStatus と一緒に lastActionAt も巻き戻す！
    await db().doc(`users/${userId}`).update({
      currentStatus: newStatus,
      lastActionAt: revertedLastActionAt, // 👈 ここが鍵！
    });

    logger.info("打刻を取り消しました", { logId, userId, action: logData.action });

    return { success: true };
  }
);