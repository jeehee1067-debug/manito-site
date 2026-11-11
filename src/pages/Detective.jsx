import { useEffect, useMemo, useState } from "react";
import {
  arrayRemove, arrayUnion, collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import { Avatar, Dialogue, Panel } from "../ui.jsx";
import { PHASE, PROFILE_QUESTIONS, REVIEW_MIN, CLUE_COUNT, PART_HINT_IDX } from "../lib/constants.js";
import { normalizeCode } from "../lib/random.js";

export default function Detective() {
  const { myPid, config, roster } = useApp();
  // 파트 단서: 최종 지목 단계부터 읽을 수 있다(보안 규칙). undefined = 아직 안 읽음, null = 없음
  const partsInUse = roster.some((r) => r.part);
  const hintOpen = partsInUse && config.phase >= PHASE.GUESSING;
  const [hintPart, setHintPart] = useState(undefined);
  useEffect(() => {
    if (!hintOpen) return;
    getDoc(doc(db, "clues", `${myPid}_${PART_HINT_IDX}`))
      .then((s) => setHintPart(s.exists() ? s.data().answer : null))
      .catch(() => setHintPart(null));
  }, [myPid, hintOpen, config.assignVer]);

  return (
    <>
      <Inbox myPid={myPid} />
      <CodeEntry myPid={myPid} />
      <MyRedemptions myPid={myPid} />
      <Clues myPid={myPid} partsInUse={partsInUse} hintOpen={hintOpen} hintPart={hintPart} />
      <Suspects myPid={myPid} hintPart={hintOpen ? hintPart : null} />
    </>
  );
}

function Inbox({ myPid }) {
  const [items, setItems] = useState([]);
  const [redeemed, setRedeemed] = useState(new Set());
  useEffect(() => {
    const offs = [
      onSnapshot(query(collection(db, "deliveries"), where("receiverPid", "==", myPid)), (s) =>
        setItems(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)))
      ),
      onSnapshot(query(collection(db, "redemptions"), where("receiverPid", "==", myPid)), (s) =>
        setRedeemed(new Set(s.docs.map((d) => d.id)))
      ),
    ];
    return () => offs.forEach((o) => o());
  }, [myPid]);

  return (
    <Panel title="마니또에게서 온 것">
      {items.length === 0 && <p className="muted">아직 도착한 게 없어요. 마니또가 미션을 하면 여기에 알림이 와요.</p>}
      <div className="stack">
        {items.map((it) => (
          <Dialogue key={it.id} speaker={it.kind === "praise" ? "마니또의 칭찬 카드" : `마니또 · ${it.slot}주차`} tone={it.kind === "praise" ? "gold" : ""}>
            <p>{it.message || "마니또가 미션을 했대요. 주변을 살펴보세요!"}</p>
            {it.code && (
              <p className="small">인증 코드 <strong className="mono">{it.code}</strong>{redeemed.has(it.code) ? " (인증 완료)" : ""}</p>
            )}
          </Dialogue>
        ))}
      </div>
    </Panel>
  );
}

function CodeEntry({ myPid }) {
  const { config } = useApp();
  const [code, setCode] = useState("");
  const [review, setReview] = useState("");
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [busy, setBusy] = useState(false);
  const running = config.phase === PHASE.RUNNING;

  async function submit(e) {
    e.preventDefault();
    const c = normalizeCode(code);
    if (c.length !== 4) return setMsg({ type: "error", text: "인증 코드는 4자리예요." });
    if (review.trim().length < REVIEW_MIN) return setMsg({ type: "error", text: `후기를 ${REVIEW_MIN}자 이상 써 주세요. 지금 ${review.trim().length}자예요.` });
    setBusy(true);
    setMsg({ type: "", text: "" });
    try {
      const codeSnap = await getDoc(doc(db, "codes", c)).catch(() => null);
      if (!codeSnap || !codeSnap.exists()) throw new Error("이 코드는 나에게 온 마니또 코드가 아니에요. 다시 확인해 주세요.");
      const existing = await getDoc(doc(db, "redemptions", c));
      if (existing.exists()) throw new Error("이미 인증한 코드예요.");
      await setDoc(doc(db, "redemptions", c), {
        receiverPid: myPid,
        slot: codeSnap.data().slot,
        review: review.trim(),
        voided: false,
        createdAt: serverTimestamp(),
      });
      setCode("");
      setReview("");
      setMsg({ type: "ok", text: "인증했어요. 응모권 1장이 쌓였어요." });
    } catch (err) {
      setMsg({ type: "error", text: err.code === "permission-denied" ? "지금은 인증할 수 없는 단계예요." : err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="인증하기">
      {!running && <p className="muted">인증은 미션 진행 기간에만 할 수 있어요.</p>}
      <form className="stack" onSubmit={submit}>
        <label>
          <span className="panel-label">인증 코드</span>
          <input className="pk-input code-input" value={code} maxLength={6} onChange={(e) => setCode(e.target.value)} placeholder="K7Q2" disabled={!running} autoComplete="off" />
        </label>
        <label className="with-counter">
          <span className="panel-label">후기 ({REVIEW_MIN}자 이상, 익명 피드에 올라가요)</span>
          <textarea className="pk-input" rows={3} maxLength={500} value={review} onChange={(e) => setReview(e.target.value)} disabled={!running}
            placeholder="무엇을 받았고 어땠는지 적어 주세요" />
          <span className="counter">{review.trim().length}자</span>
        </label>
        {msg.text && <p className={msg.type === "error" ? "error" : "note"} role="status">{msg.text}</p>}
        <button className="pk-btn main" disabled={busy || !running}>인증하기</button>
      </form>
    </Panel>
  );
}

function MyRedemptions({ myPid }) {
  const [rows, setRows] = useState([]);
  const [thanks, setThanks] = useState({});
  useEffect(() => {
    return onSnapshot(query(collection(db, "redemptions"), where("receiverPid", "==", myPid)), (s) =>
      setRows(s.docs.map((d) => ({ code: d.id, ...d.data() })))
    );
  }, [myPid]);
  useEffect(() => {
    const offs = rows.map((r) => onSnapshot(doc(db, "thanks", r.code), (s) => setThanks((p) => ({ ...p, [r.code]: s.exists() ? s.data().text : null }))));
    return () => offs.forEach((o) => o());
  }, [rows]);

  if (!rows.length) return null;
  return (
    <Panel title="내가 인증한 것">
      <ul className="plain">
        {rows.map((r) => (
          <li key={r.code} className="row-item">
            <p>{r.review}</p>
            {r.voided && <p className="error small">운영진이 무효 처리한 인증이에요.</p>}
            {thanks[r.code] ? <p className="small muted">보낸 감사 답장: {thanks[r.code]}</p> : <ThanksForm code={r.code} />}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ThanksForm({ code }) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  if (!open) return <button className="text-btn" onClick={() => setOpen(true)}>마니또에게 감사 답장 보내기</button>;
  return (
    <form className="inline" onSubmit={async (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      await setDoc(doc(db, "thanks", code), { text: text.trim(), createdAt: serverTimestamp() });
    }}>
      <input className="pk-input" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="마니또에게 익명으로 전해져요" />
      <button className="pk-btn main sm">보내기</button>
    </form>
  );
}

function Clues({ myPid, partsInUse, hintOpen, hintPart }) {
  const { config } = useApp();
  const released = Math.min(config.cluesReleased || 0, CLUE_COUNT);
  const [clues, setClues] = useState({});
  useEffect(() => {
    for (let i = 0; i < released; i++) {
      getDoc(doc(db, "clues", `${myPid}_${i}`))
        .then((s) => setClues((p) => ({ ...p, [i]: s.exists() ? s.data().answer : null })))
        .catch(() => setClues((p) => ({ ...p, [i]: null })));
    }
  }, [myPid, released]);

  return (
    <Panel title={`단서 ${released} / ${CLUE_COUNT}`}>
      <p className="small">
        내 마니또의 프로필 답변이에요. 매주 금요일 2개씩 공개돼요.
        {partsInUse && " 최종 지목이 열리면 마지막 단서로 마니또의 파트가 공개돼요."}
      </p>
      <ol className="clues">
        {PROFILE_QUESTIONS.map(({ q }, i) => (
          <li key={i} className={i < released ? "open" : "closed"}>
            <span className="clue-q">{q}</span>
            <span className="clue-a">{i < released ? clues[i] ?? "아직 마니또가 프로필을 안 채웠어요" : "잠김"}</span>
          </li>
        ))}
        {partsInUse && (
          <li className={hintOpen ? "open part-hint" : "closed"}>
            <span className="clue-q">마지막 단서 · 내 마니또의 파트는?</span>
            <span className="clue-a">
              {!hintOpen ? "잠김 (최종 지목이 열리면 공개)" : hintPart === undefined ? "불러오는 중" : hintPart ?? "파트 정보가 없어요"}
            </span>
          </li>
        )}
      </ol>
    </Panel>
  );
}

function Suspects({ myPid, hintPart }) {
  const { roster, byPid, me, user, config, myPart } = useApp();
  const myLoc = byPid[myPid]?.loc;
  const bySite = Boolean(config.siteMatched && myLoc);
  // 같은 파트끼리 짝이 하나도 없게 배정됐을 때만 내 파트를 뺀다(예전 배정이나 한 파트가 절반을 넘는 경우는 빼지 않는다).
  const byPart = config.partExcluded === true && Boolean(myPart);
  const [guess, setGuess] = useState(null);
  const [pick, setPick] = useState("");
  const [msg, setMsg] = useState("");
  const eliminated = new Set(me?.eliminated || []);
  // 배정 조건(같은 근무지, 다른 파트)에 맞지 않는 사람은 처음부터 후보에서 뺀다.
  // 파트 단서가 공개되면 그 파트 사람만 남긴다(단서는 배정 때 명단에서 만든 값이라 사실이다).
  const suspects = useMemo(
    () =>
      roster
        .filter((r) => r.pid !== myPid && (!byPart || r.part !== myPart) && (!bySite || r.loc === myLoc) && (!hintPart || r.part === hintPart))
        .sort((a, b) => a.name.localeCompare(b.name, "ko")),
    [roster, myPid, myPart, myLoc, byPart, bySite, hintPart]
  );
  const remaining = suspects.filter((s) => !eliminated.has(s.pid));

  useEffect(() => {
    getDoc(doc(db, "guesses", myPid)).then((s) => setGuess(s.exists() ? s.data().guessPid : null)).catch(() => {});
  }, [myPid]);

  async function toggle(pid) {
    await updateDoc(doc(db, "users", user.uid), { eliminated: eliminated.has(pid) ? arrayRemove(pid) : arrayUnion(pid) });
  }

  async function submitGuess(e) {
    e.preventDefault();
    if (!pick) return;
    try {
      await setDoc(doc(db, "guesses", myPid), { guessPid: pick, createdAt: serverTimestamp() });
      // 운영자가 지목 안 한 사람을 알 수 있게 "지목함"만 표시한다(누구를 지목했는지는 남기지 않음).
      await setDoc(doc(db, "progress", myPid), { guessed: true }, { merge: true });
      setGuess(pick);
      setMsg("지목했어요. 마감 전까지는 바꿀 수 있어요.");
    } catch {
      setMsg("지금은 지목할 수 없는 단계예요.");
    }
  }

  return (
    <Panel title={`용의자 보드 (남은 후보 ${remaining.length}명)`}>
      <p className="small">
        {byPart && bySite ? "우리 파트와 다른 근무지 사람은 " : byPart ? "우리 파트 사람은 " : bySite ? "다른 근무지 사람은 " : ""}
        {byPart || bySite ? "내 마니또가 될 수 없어서 처음부터 빠져 있어요. " : ""}
        {hintPart ? `마지막 단서에 따라 ${hintPart} 사람만 남겼어요. ` : ""}
        아닌 것 같은 사람을 눌러 지워 보세요.
      </p>
      <div className="suspect-grid">
        {suspects.map((s) => (
          <button key={s.pid} className={eliminated.has(s.pid) ? "suspect out" : "suspect"} aria-pressed={eliminated.has(s.pid)} onClick={() => toggle(s.pid)}>
            <Avatar pid={s.pid} size={52} dim={eliminated.has(s.pid)} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>

      {config.phase === PHASE.GUESSING && (
        <form className="stack guess" onSubmit={submitGuess}>
          <label>
            <span className="panel-label">최종 지목</span>
            <select className="pk-input" value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">후보 중에서 고르기</option>
              {remaining.map((s) => <option key={s.pid} value={s.pid}>{s.name}</option>)}
            </select>
          </label>
          <button className="pk-btn gold" disabled={!pick}>이 사람으로 지목</button>
        </form>
      )}
      {guess && <p className="note">내 지목: {byPid[guess]?.name}</p>}
      {msg && <p className="note" role="status">{msg}</p>}
    </Panel>
  );
}
