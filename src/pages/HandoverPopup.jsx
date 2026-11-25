// 중도 이탈 안내 팝업(사용자가 정함, 11/26: 대상이 바뀐 마니또와 마니또가 바뀐 대상에게 "안내 메시지도 써줘. 팝업으로 뜨게 해줘").
// tools/handover/handover.py가 짝을 이어 붙일 때 두 사람에게 notices/{pid} = { id, kind, fromSlot, redo, at }를 쓴다.
//   kind "giver"    — 대상이 바뀐 마니또(빠진 사람의 마니또였던 사람)
//   kind "receiver" — 마니또가 바뀐 대상(빠진 사람의 대상이었던 사람)
// 이 문서는 본인과 운영자만 읽는다(보안 규칙 20261128). 대부분의 사람은 문서가 없다(읽기 1건).
// 글에는 누구의 이름도, 파트도 쓰지 않는다: 대상에게 "같은 파트일 수 있다"를 알리면 마니또의 파트가 드러난다(사용자가 정함).
// 같은 안내는 기기마다 한 번(localStorage manito:noticeSeen:{uid}, 다른 기기에서는 한 번 더 뜬다).
import { useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { PHASE } from "../lib/constants.js";
import { noticeText } from "../lib/notices.js";

const seenKey = (uid) => `manito:noticeSeen:${uid}`;
function loadSeen(uid) {
  try { return JSON.parse(localStorage.getItem(seenKey(uid)) || "[]"); } catch { return []; }
}
function saveSeen(uid, list) {
  try { localStorage.setItem(seenKey(uid), JSON.stringify(list)); } catch { /* 저장소를 못 쓰는 기기: 이번에 연 동안만 기억 */ }
}

export default function HandoverPopup({ myPid, uid, phase, go }) {
  const on = phase === PHASE.RUNNING || phase === PHASE.GUESSING;
  const [notice, setNotice] = useState(null);
  const [seen, setSeen] = useState(() => loadSeen(uid));
  const btn = useRef(null);
  useEffect(() => {
    if (!on) { setNotice(null); return undefined; }
    let alive = true;
    getDoc(doc(db, "notices", myPid))
      .then((s) => alive && setNotice(s.exists() ? s.data() : null))
      .catch(() => alive && setNotice(null)); // 콘솔의 규칙이 예전 것이면 조용히 넘어간다
    return () => { alive = false; };
  }, [myPid, on]);
  const show = notice && notice.id && !seen.includes(notice.id) && (notice.kind === "giver" || notice.kind === "receiver");
  useEffect(() => { if (show) btn.current?.focus(); }, [show]);
  if (!show) return null;

  const t = noticeText(notice);
  const close = () => {
    const next = [...new Set([...seen, notice.id])];
    saveSeen(uid, next);
    setSeen(next);
  };
  const open = () => { close(); go(t.go); };
  return (
    <div className="gold-pop-backdrop" role="dialog" aria-modal="true" aria-labelledby="notice-pop-title">
      <div className="gold-pop is-angel is-notice">
        <p className="gold-pop-kicker">{t.kicker}</p>
        <p className="gold-pop-emoji" aria-hidden="true">{t.emoji}</p>
        <h2 id="notice-pop-title" className="gold-pop-title">{t.title}</h2>
        <p>{t.lead}</p>
        <ul className="angel-pop-list">{t.items.map((x) => <li key={x}>{x}</li>)}</ul>
        <div className="angel-pop-actions">
          <button ref={btn} type="button" className="pk-btn main gold-pop-btn" onClick={open}>{t.goLabel}</button>
          <button type="button" className="pk-btn sm ghost" onClick={close}>확인</button>
        </div>
      </div>
    </div>
  );
}
