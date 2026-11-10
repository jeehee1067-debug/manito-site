import { doc, getDoc, setDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase.js";
import { CLUE_COUNT } from "./constants.js";

// 내 프로필 답변을 내 대상에게 갈 단서로 복사한다(공개 여부는 보안 규칙이 단계별로 막는다).
export async function syncClues(myPid) {
  const [assignSnap, profileSnap] = await Promise.all([
    getDoc(doc(db, "assignments", myPid)).catch(() => null),
    getDoc(doc(db, "profiles", myPid)),
  ]);
  if (!assignSnap?.exists() || !profileSnap.exists()) return false;
  const receiverPid = assignSnap.data().receiverPid;
  const answers = profileSnap.data().answers || [];
  const batch = writeBatch(db);
  for (let i = 0; i < CLUE_COUNT; i++) {
    batch.set(doc(db, "clues", `${receiverPid}_${i}`), {
      receiverPid,
      idx: i,
      answer: (answers[i] || "").trim() || "(답변 없음)",
    });
  }
  await batch.commit();
  await setDoc(doc(db, "progress", myPid), { cluesSynced: true }, { merge: true });
  return true;
}
