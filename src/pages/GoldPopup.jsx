// 황금 카드 추첨 결과 팝업(사용자가 정함, 11/23: "당첨 안 된 사람에게도 아쉽다는 메시지 띄워 줘, 된 사람에게는 축하.
// 사이트 들어오자마자 알 수 있게 팝업으로 화려하게"). 어느 탭에서나(App.jsx가 참여자에게 띄움), 주차마다 한 번(이 기기에 기억).
// 읽기: 내 giverMissions는 내 미션·할 일 알림과 같은 문서라 Firestore가 묶어 읽는다. 황금 카드를 완료한 사람만 추첨 문서 2건(public/goldDraw, goldWins/{나})을 더 읽는다.
import { useEffect, useRef, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase.js";
import { GOLD_DRAW } from "../config/prizes.js";
import { goldPopups, isGoldChoice } from "../lib/gold.js";

const seenKey = (uid) => `manito:goldSeen:${uid}`;
function loadSeen(uid) {
  try { return JSON.parse(localStorage.getItem(seenKey(uid)) || "[]"); } catch { return []; }
}
function saveSeen(uid, weeks) {
  try { localStorage.setItem(seenKey(uid), JSON.stringify(weeks)); } catch { /* 저장소를 못 쓰는 기기: 이번에 연 동안만 기억 */ }
}

const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  x: (i * 37) % 100, d: (i % 7) * 0.18, r: (i * 53) % 360, c: ["#f2c230", "#e85d4a", "#3aa76d", "#4a7fd1", "#ffffff"][i % 5],
}));

export default function GoldPopup({ myPid, uid }) {
  const [missions, setMissions] = useState(null);
  const [draws, setDraws] = useState(null);
  const [wins, setWins] = useState(null);
  const [seen, setSeen] = useState(() => loadSeen(uid));
  const btn = useRef(null);
  useEffect(() => onSnapshot(doc(db, "giverMissions", myPid), (s) => setMissions(s.exists() ? s.data() : {}), () => setMissions({})), [myPid]);
  const tried = Boolean(missions && GOLD_DRAW.weeks.some((w) => isGoldChoice(missions.choices?.[String(w)]) && missions.done?.[String(w)] === true));
  useEffect(() => {
    if (!tried) return undefined;
    const offs = [
      onSnapshot(doc(db, "public", "goldDraw"), (s) => setDraws(s.exists() ? s.data().weeks || {} : {}), () => setDraws({})),
      onSnapshot(doc(db, "goldWins", myPid), (s) => setWins(s.exists() ? s.data().weeks || {} : {}), () => setWins({})),
    ];
    return () => offs.forEach((off) => off());
  }, [tried, myPid]);
  const item = tried && draws && wins ? goldPopups({ missions, draws, wins, seen })[0] : null;
  useEffect(() => { if (item) btn.current?.focus(); }, [item?.week, item?.won]);
  if (!item) return null;

  const close = () => {
    const next = [...new Set([...seen, item.week])];
    saveSeen(uid, next);
    setSeen(next);
  };
  const nextWeek = GOLD_DRAW.weeks.find((w) => w > item.week);
  return (
    <div className="gold-pop-backdrop" role="dialog" aria-modal="true" aria-labelledby="gold-pop-title">
      <div className={`gold-pop ${item.won ? "is-win" : "is-lose"}`}>
        {item.won && (
          <div className="gold-confetti" aria-hidden="true">
            {CONFETTI.map((p, i) => <span key={i} style={{ left: `${p.x}%`, animationDelay: `${p.d}s`, background: p.c, transform: `rotate(${p.r}deg)` }} />)}
          </div>
        )}
        <p className="gold-pop-kicker">✨ {item.week}주차 황금 카드 추첨 결과 ✨</p>
        {item.won ? (
          <>
            <p className="gold-pop-emoji" aria-hidden="true">🏆</p>
            <h2 id="gold-pop-title" className="gold-pop-title">축하해요! 당첨이에요!</h2>
            <p>황금 카드 미션에 도전한 마니또 중 추첨으로 뽑혔어요.</p>
            <p className="gold-pop-prize">☕ {GOLD_DRAW.prize}</p>
            <p className="small">쿠폰은 송년회에서 발표하면서 드려요. 황금 카드를 한 마니또라는 게 알려지면 정체가 드러날 수 있으니, 그때까지는 <b>비밀</b>로 해 주세요!</p>
          </>
        ) : (
          <>
            <p className="gold-pop-emoji" aria-hidden="true">🍀</p>
            <h2 id="gold-pop-title" className="gold-pop-title">아쉽게도 이번엔 뽑히지 않았어요</h2>
            <p>황금 카드에 도전해 줘서 고마워요!</p>
            <p>{nextWeek ? `${nextWeek}주차에도 황금 카드 추첨이 있어요. 다시 도전해 보세요!` : "송년회에서 더 큰 상을 노려 봐요!"}</p>
          </>
        )}
        <button ref={btn} type="button" className="pk-btn main gold-pop-btn" onClick={close}>{item.won ? "야호! 확인" : "확인"}</button>
      </div>
    </div>
  );
}
