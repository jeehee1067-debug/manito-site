// "모두의 미션 진행" 숫자를 세어 적는 쪽(운영자·공동 운영자 화면, App.jsx가 띄움). 계산과 화면 값은 progress.js.
// 읽기 수: 문서를 통째로 읽지 않고 개수만 세는 집계(count, 최대 1,000건까지 1회 읽기)로 센다 — 한 번에 (열린 주차 수 + 1)건.
// 화면이 보이는 동안 PROGRESS_EVERY(5분)마다, 그리고 다시 보일 때(1분 넘게 지났으면) 센다. 숫자가 같으면 쓰지 않는다.
// 운영자 화면이 하나도 열려 있지 않으면 숫자가 그대로 머문다(서버가 없어서). 참여자 화면에는 "몇 시 기준"을 같이 보인다.
// public/* 쓰기는 원래 운영자만이라 보안 규칙 변경 없음.
import { useEffect, useRef } from "react";
import { collection, doc, getCountFromServer, getDoc, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { PHASE } from "./constants.js";
import { PROGRESS_EVERY, sameProgress } from "./progress.js";

export const progressRef = () => doc(db, "public", "progress");

async function countNow(week) {
  const weeks = Array.from({ length: Math.max(1, Math.min(3, week)) }, (_, i) => i + 1);
  const [joined, ...done] = await Promise.all([
    getCountFromServer(query(collection(db, "roster"), where("uid", "!=", null))),
    ...weeks.map((w) => getCountFromServer(query(collection(db, "giverMissions"), where(`done.${w}`, "==", true)))),
  ]);
  return { joined: joined.data().count, weeks: Object.fromEntries(weeks.map((w, i) => [String(w), done[i].data().count])) };
}

// 미션 진행·최종 지목 단계에만 센다(최종 지목 단계에는 완료가 늘지 않지만, 미션 마감 직전 숫자를 마지막으로 맞춰 둔다)
export function ProgressWriter({ phase, week }) {
  const written = useRef(undefined); // 지금 문서의 숫자(처음 한 번 읽는다)
  useEffect(() => {
    if (phase !== PHASE.RUNNING && phase !== PHASE.GUESSING) return undefined;
    let stop = false;
    let last = 0;
    let busy = false;
    const run = async () => {
      if (stop || busy || document.visibilityState !== "visible") return;
      busy = true;
      last = Date.now();
      try {
        if (written.current === undefined) {
          const s = await getDoc(progressRef());
          written.current = s.exists() ? s.data() : null;
        }
        const next = await countNow(week);
        if (!stop && !sameProgress(written.current, next)) {
          await setDoc(progressRef(), { v: 1, at: serverTimestamp(), ...next });
          written.current = next;
        }
      } catch {
        // 콘솔의 규칙이 예전 것이거나 연결이 막힌 때: 다음 차례에 다시 해 본다
      } finally {
        busy = false;
      }
    };
    run();
    const t = setInterval(run, PROGRESS_EVERY);
    const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - last > 60 * 1000) run(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, [phase, week]);
  return null;
}
