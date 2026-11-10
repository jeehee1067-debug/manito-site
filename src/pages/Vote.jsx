import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import { PHASE } from "../lib/constants.js";
import { seededRandom, shuffle } from "../lib/random.js";
import { Panel } from "../ui.jsx";

export default function Vote() {
  const { myPid, myTeam, config } = useApp();
  const [cards, setCards] = useState([]);
  const [picked, setPicked] = useState([]);
  const [saved, setSaved] = useState(null);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    getDocs(collection(db, "voteCards")).then((s) => setCards(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
    getDoc(doc(db, "votes", myPid)).then((s) => {
      if (s.exists()) {
        setSaved(s.data().cardIds);
        setPicked(s.data().cardIds);
      }
    }).catch(() => {});
  }, [myPid]);

  // 내 팀 마니또의 카드(내 카드 포함)는 빼고, 사람마다 다른 순서·번호로 보여준다.
  const visible = useMemo(
    () => shuffle(cards.filter((c) => c.team !== myTeam), seededRandom(`vote:${myPid}`)),
    [cards, myTeam, myPid]
  );
  const open = config.phase === PHASE.VOTING;

  function toggle(id) {
    if (!open) return;
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));
  }

  async function submit() {
    try {
      await setDoc(doc(db, "votes", myPid), { cardIds: picked, createdAt: serverTimestamp() });
      setSaved(picked);
      setMsg("투표했어요. 마감 전까지 바꿀 수 있어요.");
    } catch {
      setMsg("지금은 투표할 수 없는 단계예요.");
    }
  }

  return (
    <Panel title={`베스트 마니또 투표 (${picked.length} / 3)`}>
      <p className="small">
        마니또별로 받은 사람들이 남긴 후기를 모았어요. 마음에 드는 카드를 최대 3장 고르세요.
        카드 번호는 사람마다 다르게 보여서 "몇 번 찍어줘"는 통하지 않아요.
      </p>
      {cards.length === 0 && <p className="muted">운영진이 투표 카드를 만들면 여기에 보여요.</p>}
      <div className="vote-grid">
        {visible.map((c, i) => (
          <button key={c.id} className={picked.includes(c.id) ? "vote-card is-on" : "vote-card"} aria-pressed={picked.includes(c.id)} onClick={() => toggle(c.id)}>
            <span className="vote-no">{i + 1}번 마니또</span>
            {c.reviews.length === 0 && <span className="muted small">인증된 후기가 없어요</span>}
            {c.reviews.map((r, j) => <span key={j} className="vote-review">{r}</span>)}
          </button>
        ))}
      </div>
      {open && (
        <div className="sticky-bar">
          <button className="pk-btn main" onClick={submit} disabled={picked.length === 0}>{saved ? "투표 바꾸기" : "투표하기"}</button>
        </div>
      )}
      {msg && <p className="note" role="status">{msg}</p>}
    </Panel>
  );
}
