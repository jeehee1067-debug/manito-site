// 수호천사 연결 팝업(사용자가 정함, 11/24: "수호천사로 연결된 사람에게 팝업 띄워 줘").
// 2·3주차를 열 때 지원자가 자동으로 연결되는데(angels.js), 지원자는 내 미션 탭에 "수호천사 미션" 패널이 생긴 것만으로는 모를 수 있다.
// 어느 탭에서나(App.jsx가 참여자에게 띄움) 미션 진행 단계에, 연결된 받는 사람마다 한 번(이 기기에 기억, 다른 기기에서는 한 번 더 뜬다).
// 받는 사람 이름은 팝업에 쓰지 않는다(옆 사람이 화면을 볼 수 있어서 — 내 미션의 "이름 보기"로 본다).
// 읽기: angels where angelPid == 나(대부분 0건 = 읽기 1건). 내 미션 탭의 수호천사 패널과 같은 질의라 같이 열려 있으면 Firestore가 묶어 읽는다.
import { useEffect, useRef, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { PHASE } from "../lib/constants.js";
import { TICKET_RULES } from "../config/prizes.js";

const seenKey = (uid) => `manito:angelSeen:${uid}`;
function loadSeen(uid) {
  try { return JSON.parse(localStorage.getItem(seenKey(uid)) || "[]"); } catch { return []; }
}
function saveSeen(uid, list) {
  try { localStorage.setItem(seenKey(uid), JSON.stringify(list)); } catch { /* 저장소를 못 쓰는 기기: 이번에 연 동안만 기억 */ }
}

export default function AngelPopup({ myPid, uid, phase, go }) {
  const running = phase === PHASE.RUNNING;
  const [targets, setTargets] = useState(null); // 나에게 연결된 받는 사람 pid 목록
  const [seen, setSeen] = useState(() => loadSeen(uid));
  const btn = useRef(null);
  useEffect(() => {
    if (!running) { setTargets(null); return undefined; }
    return onSnapshot(query(collection(db, "angels"), where("angelPid", "==", myPid)), (s) => setTargets(s.docs.map((d) => d.id).sort()), () => setTargets(null));
  }, [myPid, running]);
  const item = (targets || []).find((pid) => !seen.includes(pid)) || null;
  useEffect(() => { if (item) btn.current?.focus(); }, [item]);
  if (!item) return null;

  const close = () => {
    const next = [...new Set([...seen, ...(targets || [])])];
    saveSeen(uid, next);
    setSeen(next);
  };
  const open = () => {
    close();
    go("mission");
    setTimeout(() => document.getElementById("angel-mission")?.scrollIntoView({ block: "start" }), 80);
  };
  return (
    <div className="gold-pop-backdrop" role="dialog" aria-modal="true" aria-labelledby="angel-pop-title">
      <div className="gold-pop is-angel">
        <p className="gold-pop-kicker">수호천사 연결 알림</p>
        <p className="gold-pop-emoji" aria-hidden="true">😇</p>
        <h2 id="angel-pop-title" className="gold-pop-title">수호천사로 연결됐어요!</h2>
        <p>마니또에게 아직 아무것도 받지 못한 동료가 있어요. <b>내 미션</b> 탭의 "수호천사 미션"에서 누구인지 확인하고 몰래 챙겨 주세요.</p>
        <ul className="angel-pop-list">
          <li>원래 내 대상 미션도 그대로 해요.</li>
          <li>수호천사 미션은 {TICKET_RULES.maxAngel}번까지, 상대가 확인할 때마다 응모권 +{TICKET_RULES.angelPerMission}장이에요.</li>
          <li>상대는 수호천사가 누구인지 몰라요. 송년회에서 소개돼요.</li>
        </ul>
        <div className="angel-pop-actions">
          <button ref={btn} type="button" className="pk-btn main gold-pop-btn" onClick={open}>수호천사 미션 보러 가기</button>
          <button type="button" className="pk-btn sm ghost" onClick={close}>나중에</button>
        </div>
      </div>
    </div>
  );
}
