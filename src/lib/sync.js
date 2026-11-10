import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { CLUE_COUNT } from "./constants.js";

// 내 프로필 답변을 내 대상에게 갈 단서로 복사한다(공개 여부는 보안 규칙이 단계별로 막는다).
// ver = config.assignVer(배정 회차). 운영자가 다시 배정하면 회차가 올라가서, 지난 회차 단서는 보안 규칙이 읽지 못하게 하고
// 각자 앱을 열 때(내 미션 화면) progress.cluesVer가 지금 회차와 다르면 새 대상에게 다시 쓴다.
export async function syncClues(myPid, ver = 0) {
  const [assignSnap, profileSnap] = await Promise.all([
    getDoc(doc(db, "assignments", myPid)).catch(() => null),
    getDoc(doc(db, "profiles", myPid)),
  ]);
  if (!assignSnap?.exists() || !profileSnap.exists()) return false;
  const receiverPid = assignSnap.data().receiverPid;
  const answers = profileSnap.data().answers || [];
  // 한 칸씩 따로 쓴다. 이미 공개된 칸은 보안 규칙이 답 변경을 막는데(권한 없음), 그 칸 때문에 나머지 칸까지 막히지 않게.
  const results = await Promise.allSettled(
    Array.from({ length: CLUE_COUNT }, (_, i) =>
      setDoc(doc(db, "clues", `${receiverPid}_${i}`), {
        receiverPid,
        idx: i,
        answer: (answers[i] || "").trim() || "(답변 없음)",
        ver,
      })
    )
  );
  const failed = results.filter((r) => r.status === "rejected" && r.reason?.code !== "permission-denied");
  if (failed.length) throw failed[0].reason;
  await setDoc(doc(db, "progress", myPid), { cluesVer: ver }, { merge: true });
  return true;
}
