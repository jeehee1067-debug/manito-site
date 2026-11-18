import { useEffect, useMemo, useRef, useState } from "react";
import {
  arrayRemove, arrayUnion, collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import { Avatar, Dialogue, Giver, HowTag, Panel, RoleNote } from "../ui.jsx";
import { cardHow, LEVEL_LABEL, PHASE, PRAISE_SLOT, PROFILE_QUESTIONS, REVIEW_MIN, CLUE_COUNT, PART_HINT_IDX, clueScheduleText } from "../lib/constants.js";
import { normalizeCode } from "../lib/random.js";
import { bump } from "../lib/writes.js";
import { TICKET_RULES } from "../config/prizes.js";

// 고른 카드가 실린 알림: 1·2주차 완료 알림(mission), 그리고 3주차 칭찬과 함께 카드를 고른 경우의 칭찬 알림(praise)
const carriesCard = (it) => (it.kind === "mission" || it.kind === "praise") && it.card;
// "알아내 맞혀 보기" 카드(constants.js guess)는 맞혔을 때만 "카드와 같다"로 확인한다
const isGuessCard = (card) => /맞혀 보기|좋아하는 게 아니면/.test(card?.text || "");

// 받는 쪽 안내: 사이트 쪽지 카드면 위 쪽지가 곧 미션이고(실물 없음), 실물 전달 카드면 실물을 찾아야 한다
const howHint = (card) => (cardHow(card) === "site"
  ? "카드예요: 사이트로 온 쪽지가 곧 미션이에요. 따로 받을 실물은 없어요."
  : "카드예요: 실물이 따로 있어요. 쪽지에 적힌 곳이나 자리 주변을 살펴보세요.");

// 받는 쪽이 자기 미션 탭의 코드(내가 마니또로서 내 대상에게 주는 코드)를 넣었을 때
const OWN_CODE_MSG = "이 코드는 내가 마니또로서 내 대상에게 주는 코드예요(\"내 미션\" 탭에 보이는 코드). 여기에는 내 마니또가 보낸 쪽지(위 \"마니또에게서 온 것\")에 적힌 코드를 넣어 주세요.";

const CARD_BONUS = TICKET_RULES.cardBonus; // 카드 추가 응모권(보통·도전만)

export default function Detective() {
  const { myPid, config, roster, inbox: items } = useApp();
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

  // 마니또에게서 온 것(완료 알림·쪽지)은 App이 한 번 구독해 둔 것을 쓴다(안 읽은 표시와 같이)
  // "이 코드로 인증하기": 받은 쪽지의 코드를 인증 칸에 그대로 넣는다(손으로 옮겨 적다 틀리는 일을 막으려고). at은 같은 코드를 다시 눌러도 반응하게
  const [fill, setFill] = useState(null);

  return (
    <>
      <RoleNote as="target" />
      <Inbox myPid={myPid} items={items} onUseCode={(code) => setFill({ code, at: Date.now() })} />
      <AngelInbox />
      <CodeEntry myPid={myPid} items={items} prefill={fill} />
      <ToManito myPid={myPid} />
      <MyRedemptions myPid={myPid} items={items} />
      <Clues myPid={myPid} partsInUse={partsInUse} hintOpen={hintOpen} hintPart={hintPart} />
      <Suspects myPid={myPid} hintPart={hintOpen ? hintPart : null} />
    </>
  );
}

function Inbox({ myPid, items, onUseCode }) {
  const { config } = useApp();
  const [mine, setMine] = useState(null); // 내가 입력한 인증 [{ code, slot }]. null = 아직 불러오는 중
  useEffect(() => onSnapshot(query(collection(db, "redemptions"), where("receiverPid", "==", myPid)), (s) =>
    setMine(s.docs.map((d) => ({ code: d.id, slot: d.data().slot }))), () => setMine([])), [myPid]);

  const redeemedCodes = new Set((mine || []).map((r) => r.code));
  const redeemedSlots = new Set((mine || []).map((r) => r.slot));
  // 마니또가 완료를 알렸는데 내가 아직 인증하지 않은 1·2주차(3주차 칭찬 카드는 사이트로 바로 오므로 "받은 게 없어요"가 없다)
  const waiting = [...new Set(items.filter((it) => it.slot !== PRAISE_SLOT).map((it) => it.slot))]
    .filter((slot) => !redeemedSlots.has(slot))
    .sort((a, b) => a - b);
  const canRedeem = config.phase === PHASE.RUNNING || config.phase === PHASE.GUESSING;
  // 완료 알림이 온 주차 중 코드가 실린 것(완료 알림·추가 쪽지)이 하나도 없고 아직 인증하지 않은 주차
  const noCodeSlots = [...new Set(items.filter((it) => it.kind !== "note").map((it) => it.slot))]
    .filter((slot) => !redeemedSlots.has(slot) && !items.some((it) => it.slot === slot && it.code && !it.hidden))
    .sort((a, b) => a - b);
  const speaker = (it) => (it.kind === "praise" ? "마니또의 칭찬 카드" : it.kind === "note" ? `마니또 · ${it.slot}주차 쪽지` : `마니또 · ${it.slot}주차`);

  return (
    <Panel title="마니또에게서 온 것">
      {items.length === 0 && <p className="muted">아직 도착한 게 없어요. 내 <Giver />가 미션을 하면 여기에 알림이 와요.</p>}
      <div className="stack">
        {items.map((it) => (
          <Dialogue key={it.id} speaker={speaker(it)} tone={it.kind === "praise" ? "gold" : ""}>
            {it.hidden
              ? <p className="muted">운영진이 가린 쪽지예요.</p>
              : <p>{it.message || (cardHow(it.card) === "site"
                ? "마니또가 미션을 했다고 알렸는데 쪽지 내용이 비어 있어요. 종이 쪽지로 줬을 수도 있으니 주변을 살펴보세요."
                : "마니또가 미션을 했대요. 주변을 살펴보세요!")}</p>}
            {it.card && <p className="small">마니또가 고른 카드: {LEVEL_LABEL[it.card.level] || it.card.level} · {it.card.text}</p>}
            {it.card && cardHow(it.card) && <p className="small how-hint"><HowTag card={it.card} /> {howHint(it.card)}</p>}
            {it.code && (
              <p className="small">
                인증 코드 <strong className="mono">{it.code}</strong>{redeemedCodes.has(it.code) ? " (인증 완료)" : ""}
                {!redeemedCodes.has(it.code) && mine && canRedeem && (
                  <> <button type="button" className="text-btn" onClick={() => onUseCode(it.code)}>이 코드로 인증하기</button></>
                )}
              </p>
            )}
            {it.message && !it.hidden && <FlagNote id={it.id} />}
          </Dialogue>
        ))}
      </div>
      {/* 완료 알림은 왔는데 그 주차에 코드가 실린 쪽지가 하나도 없음: 마니또가 "코드 함께 보내기"를 끄고 보냈다(예전 화면은 사이트 쪽지 카드도 끌 수 있었다) */}
      {mine && canRedeem && noCodeSlots.map((slot) => (
        <p key={`nc${slot}`} className="warn-line" role="status">
          <b>{slot}주차 인증 코드가 아직 안 왔어요.</b> 내 마니또가 쪽지에 코드를 넣지 않고 보냈어요. 실물과 함께 둔 메모가 있으면 거기 적힌 코드를 넣어 주세요.
          없으면 마니또가 "쪽지 더 보내기"로 코드를 보낼 때까지 기다리거나, 운영진에게 알려 주세요(운영진이 코드를 확인해 줄 수 있어요).
        </p>
      ))}
      {/* 내 인증 목록이 오기 전에는 띄우지 않는다(이미 인증한 주차에 "받은 게 없어요"가 잠깐 보이지 않게) */}
      {mine && waiting.map((slot) => <ReportBox key={slot} myPid={myPid} slot={slot} phase={config.phase} />)}
    </Panel>
  );
}

// 수호천사가 보낸 것: 마니또가 미션을 안 해서 운영진이 연결한 지원자가 대신 챙겨 준 것. 누구인지는 송년회에서 공개된다.
// "받았어요"로 확인하면 나는 인증 입력 응모권, 수호천사는 수호천사 응모권을 받는다(한 번만, 미션 진행 단계에만).
function AngelInbox() {
  const { angelInbox, config } = useApp();
  const [review, setReview] = useState({});
  const [error, setError] = useState("");
  if (!angelInbox.length) return null;
  const running = config.phase === PHASE.RUNNING || config.phase === PHASE.GUESSING; // 확인은 최종 지목 단계가 끝날 때까지
  async function confirm(g) {
    const text = (review[g.id] || "").trim();
    if (text.length < 10) return setError("후기를 10자 이상 써 주세요.");
    setError("");
    await updateDoc(doc(db, "angelGifts", g.id), { confirmed: true, review: text, confirmedAt: serverTimestamp() })
      .catch(() => setError("확인하지 못했어요. 확인은 최종 지목이 마감되기 전까지 할 수 있어요."));
  }
  return (
    <Panel title="수호천사가 보낸 것">
      <p className="small">마니또가 바빴는지 아직 미션이 없어서, 운영진이 연결한 수호천사가 몰래 챙겨 줬어요. 누구인지는 송년회에서 공개돼요. 받았다면 "받았어요"를 눌러 주세요(나와 수호천사 모두 응모권을 받아요).</p>
      {angelInbox.map((g) => (
        <Dialogue key={g.id} speaker={`수호천사 · ${g.k}번째`} tone="gold">
          <p><b>{g.text}</b></p>
          {g.message && <p>{g.message}</p>}
          {g.confirmed
            ? <p className="small muted">받았어요: {g.review}</p>
            : running && (
              <div className="stack tight">
                <textarea className="pk-input" rows={2} maxLength={500} value={review[g.id] || ""} onChange={(e) => setReview({ ...review, [g.id]: e.target.value })}
                  placeholder="무엇을 받았고 어땠는지 (10자 이상)" aria-label={`수호천사 ${g.k}번째 후기`} />
                <button className="pk-btn sm" onClick={() => confirm(g)}>받았어요</button>
              </div>
            )}
        </Dialogue>
      ))}
      {error && <p className="error small" role="alert">{error}</p>}
    </Panel>
  );
}

// 마니또에게 한마디: 받는 사람이 내 마니또에게 주차마다 한 번 익명으로 말을 건다(고칠 수 없음).
// "혹시 ○○파트세요?"처럼 찔러보기도 된다. 마니또는 "쪽지 더 보내기"로 답할 수 있다.
function ToManito({ myPid }) {
  const { config } = useApp();
  const [sent, setSent] = useState(undefined); // { slot: message }
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => onSnapshot(query(collection(db, "toManito"), where("receiverPid", "==", myPid)), (s) =>
    setSent(Object.fromEntries(s.docs.map((d) => [d.data().slot, d.data().message]))), () => setSent({})), [myPid]);
  const open = config.phase === PHASE.RUNNING || config.phase === PHASE.GUESSING;
  const week = config.week || 1;
  if (sent === undefined || (!open && Object.keys(sent).length === 0)) return null;

  async function send(e) {
    e.preventDefault();
    const message = text.trim();
    if (!message) return;
    if (!window.confirm(`${week}주차 한마디는 한 번만 보낼 수 있어요. 보낼까요?\n\n"${message}"`)) return;
    setBusy(true);
    setError("");
    try {
      await setDoc(doc(db, "toManito", `${myPid}_${week}`), { receiverPid: myPid, slot: week, message, createdAt: serverTimestamp() });
      setText("");
    } catch {
      setError("보내지 못했어요. 이번 주에 이미 보냈거나 보낼 수 없는 단계예요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="마니또에게 한마디">
      <p className="small"><Giver>내 마니또</Giver>에게만 보여요. 주차마다 한 번, 200자까지. 고맙다는 말도, "혹시 ○○파트세요?" 같은 찔러보기도 좋아요. 마니또는 쪽지로 답할 수 있어요.</p>
      {Object.entries(sent).sort(([a], [b]) => a - b).map(([slot, m]) => (
        <Dialogue key={slot} speaker={`나 → 마니또 · ${slot}주차`}><p>{m}</p></Dialogue>
      ))}
      {open && !sent[week] && (
        <form className="stack" onSubmit={send}>
          <textarea className="pk-input" rows={2} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder={`${week}주차 한마디`} aria-label={`${week}주차 마니또에게 한마디`} />
          <button className="pk-btn sm" disabled={busy || !text.trim()}>보내기</button>
        </form>
      )}
      {open && sent[week] && <p className="small muted">{week}주차 한마디는 보냈어요. 다음 주차에 또 보낼 수 있어요.</p>}
      {error && <p className="error small" role="alert">{error}</p>}
    </Panel>
  );
}

// 받은 게 없어요: 마니또가 완료를 알렸는데 찾아봐도 받은 것이 없을 때 주차별로 운영진에게 알린다.
// 운영진이 두 사람에게 확인한 뒤 "받았음"(마니또의 미션 인정) 또는 "못 받음"(나에게 그 주차 보상)으로 정한다.
// 쪽지 신고: 기분 나쁜 쪽지를 받았을 때 운영진에게 알린다. 운영진은 누가 보냈는지 알 수 있고 쪽지를 가릴 수 있다.
// 보낸 마니또에게는 신고했다는 사실이 보이지 않는다.
function FlagNote({ id }) {
  const [flagged, setFlagged] = useState(undefined);
  useEffect(() => onSnapshot(doc(db, "noteFlags", id), (s) => setFlagged(s.exists()), () => setFlagged(false)), [id]);
  async function flag() {
    if (!window.confirm("이 쪽지를 운영진에게 신고할까요?\n\n불쾌하거나 괴롭히는 내용일 때 써 주세요. 운영진이 확인하고 가릴 수 있어요. 마니또에게는 알려지지 않아요.")) return;
    await setDoc(doc(db, "noteFlags", id), { at: serverTimestamp() }).catch(() => {});
  }
  if (flagged === undefined) return null;
  return flagged
    ? <p className="small muted">운영진에게 신고한 쪽지예요.</p>
    : <button type="button" className="text-btn small" onClick={flag}>이 쪽지 신고</button>;
}

function ReportBox({ myPid, slot, phase }) {
  const [reported, setReported] = useState(false);
  const [reportDoc, setReportDoc] = useState(false); // 신고 문서가 있는지(취소한 신고는 active = false로 남는다)
  const [verdict, setVerdict] = useState(null);
  const [error, setError] = useState("");
  const rid = `${myPid}_${slot}`;
  useEffect(() => {
    const offs = [
      onSnapshot(doc(db, "reports", rid), (s) => { setReportDoc(s.exists()); setReported(s.exists() && s.data().active !== false); }, () => {}),
      onSnapshot(doc(db, "verdicts", rid), (s) => setVerdict(s.exists() ? s.data().verdict : null), () => {}),
    ];
    return () => offs.forEach((o) => o());
  }, [rid]);
  const canReport = phase >= PHASE.RUNNING && phase <= PHASE.CLOSED; // 미션 마감 뒤에도 집계 전까지는 알릴 수 있다

  async function report() {
    setError("");
    if (!window.confirm(`${slot}주차에 받은 게 없다고 운영진에게 알릴까요?\n\n주변(책상, 서랍, 자리 근처)과 위 쪽지를 한 번 더 확인해 주세요. 운영진이 마니또에게도 확인해요.`)) return;
    const write = reportDoc
      ? updateDoc(doc(db, "reports", rid), { active: true, createdAt: serverTimestamp(), ...bump() })
      : setDoc(doc(db, "reports", rid), { receiverPid: myPid, slot, active: true, createdAt: serverTimestamp(), ...bump() });
    await write.catch(() => setError("알리지 못했어요. 잠시 뒤 다시 눌러 주세요."));
  }
  const cancel = () => updateDoc(doc(db, "reports", rid), { active: false, ...bump() }).catch(() => setError("취소하지 못했어요."));

  return (
    <div className="report-box">
      <p className="small">
        <b>{slot}주차</b>: 마니또가 미션을 했다고 알렸는데 아직 인증하지 않았어요. 받았다면 아래 "인증하기"에 코드와 후기를 입력해 주세요.
      </p>
      {verdict === "received" && <p className="small note">운영진 확인: 전달된 것으로 확인됐어요. {phase === PHASE.RUNNING || phase === PHASE.GUESSING ? "코드를 찾으면 지금이라도 인증할 수 있어요." : ""}</p>}
      {verdict === "missing" && <p className="small note">운영진 확인: 못 받은 것으로 처리됐어요. 이 주차는 인증 입력 대신 응모권 1장으로 보상돼요(내 미션이 1건 이상 인증된 경우).</p>}
      {!verdict && reported && (
        <p className="small">
          받은 게 없다고 운영진에게 알렸어요. 운영진이 확인한 뒤 처리해요.
          {canReport && <> <button type="button" className="text-btn" onClick={cancel}>알림 취소</button></>}
        </p>
      )}
      {!verdict && !reported && canReport && (
        <button type="button" className="pk-btn sm" onClick={report}>받은 게 없어요</button>
      )}
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  );
}

function CodeEntry({ myPid, items, prefill }) {
  const { config } = useApp();
  const [code, setCode] = useState("");
  const [review, setReview] = useState("");
  const [msg, setMsg] = useState({ type: "", text: "" });
  const [busy, setBusy] = useState(false);
  const [slotOf, setSlotOf] = useState(null); // 입력한 코드의 주차(나에게 온 코드일 때)
  const [cardMatch, setCardMatch] = useState(true);
  // 내가 이미 인증한 주차. 인증을 마친 뒤에도 입력 칸이 그대로 있어 "제대로 인증됐나?" 하고 헷갈린다는 문의가 있어서,
  // 열린 주차를 모두 인증했으면 입력 칸 대신 "인증 완료"를 보인다(같은 조회를 Inbox·MyRedemptions도 써서 읽기는 늘지 않는다).
  const [mine, setMine] = useState(null);
  const [showForm, setShowForm] = useState(false);
  // 받은 쪽지의 "이 코드로 인증하기": 코드를 넣고 입력 칸을 열어 그쪽으로 옮긴다
  useEffect(() => {
    if (!prefill) return;
    setCode(prefill.code);
    setShowForm(true);
    setMsg({ type: "", text: "" });
    requestAnimationFrame(() => {
      const el = document.getElementById("code-entry-form");
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.querySelector("textarea")?.focus({ preventScroll: true });
    });
  }, [prefill]);
  // 내가 마니또로서 내 대상에게 주는 코드(내 미션 탭에 크게 보이는 코드)를 여기에 넣는 실수가 있어서, 그 코드면 따로 알려 준다.
  // 필요할 때만 한 번 읽는다(읽기 수).
  const ownCodes = useRef(null);
  async function isOwnCode(c) {
    if (!ownCodes.current) {
      ownCodes.current = await getDoc(doc(db, "giverCodes", myPid)).then((s) => Object.values(s.data()?.codes || {})).catch(() => []);
    }
    return ownCodes.current.includes(c);
  }
  const [own, setOwn] = useState(false);
  useEffect(() => onSnapshot(query(collection(db, "redemptions"), where("receiverPid", "==", myPid)), (s) =>
    setMine(s.docs.map((d) => d.data().slot)), () => setMine([])), [myPid]);
  const openWeeks = Array.from({ length: Math.min(3, Math.max(1, config.week || 1)) }, (_, i) => i + 1);
  const doneWeeks = openWeeks.filter((w) => (mine || []).includes(w));
  const leftWeeks = openWeeks.filter((w) => !doneWeeks.includes(w));
  const allDone = mine !== null && leftWeeks.length === 0;
  // 미션(완료 알리기)은 미션 진행 단계에 마감되지만, 인증은 최종 지목 단계가 끝날 때까지 받는다(마감 직전에 온 미션을 인증할 시간)
  const running = config.phase === PHASE.RUNNING || config.phase === PHASE.GUESSING;
  // 4자리를 다 넣으면 어느 주차 코드인지 확인하고, 그 주차에 마니또가 고른 카드를 보여 준다(받은 것과 맞는지 확인)
  const typed = normalizeCode(code);
  useEffect(() => {
    setSlotOf(null);
    setCardMatch(true);
    setOwn(false);
    if (typed.length !== 4) return;
    let alive = true;
    getDoc(doc(db, "codes", typed)).then((s) => alive && setSlotOf(s.exists() ? s.data().slot : null))
      .catch(() => isOwnCode(typed).then((yes) => alive && setOwn(yes)));
    return () => { alive = false; };
  }, [typed]);
  const card = slotOf ? items.find((it) => carriesCard(it) && it.slot === slotOf)?.card : null;

  async function submit(e) {
    e.preventDefault();
    const c = normalizeCode(code);
    if (c.length !== 4) return setMsg({ type: "error", text: "인증 코드는 4자리예요." });
    if (review.trim().length < REVIEW_MIN) return setMsg({ type: "error", text: `후기를 ${REVIEW_MIN}자 이상 써 주세요. 지금 ${review.trim().length}자예요.` });
    setBusy(true);
    setMsg({ type: "", text: "" });
    try {
      const codeSnap = await getDoc(doc(db, "codes", c)).catch(() => null);
      if (!codeSnap || !codeSnap.exists()) {
        throw new Error(await isOwnCode(c) ? OWN_CODE_MSG
          : "이 코드는 나에게 온 마니또 코드가 아니에요. 위 \"마니또에게서 온 것\"에 적힌 코드를 그대로 넣어 주세요(\"이 코드로 인증하기\"를 누르면 자동으로 들어가요). 코드에는 0·1·O·I가 없어요.");
      }
      const slot = codeSnap.data().slot;
      if (slot > (config.week || 1)) throw new Error(`${slot}주차 코드예요. ${slot}주차가 열리면 인증할 수 있어요.`);
      const existing = await getDoc(doc(db, "redemptions", c));
      if (existing.exists()) throw new Error("이미 인증한 코드예요.");
      // 인증 문서(받는 사람·코드가 들어 있어 나·마니또·운영자만 읽음)와 익명 피드 글(받는 사람 정보 없음)을 한 묶음으로 쓴다.
      // 보안 규칙은 둘이 같이 있을 때만 받는다(인증 없이 피드 글만, 또는 그 반대는 거부).
      const feedId = doc(collection(db, "feed")).id;
      const batch = writeBatch(db);
      batch.set(doc(db, "redemptions", c), {
        receiverPid: myPid, slot, review: review.trim(), voided: false, feedId, createdAt: serverTimestamp(),
        ...(card ? { cardMatch } : {}),
      });
      batch.set(doc(db, "feed", feedId), { slot, review: review.trim(), voided: false, createdAt: serverTimestamp() });
      await batch.commit();
      setCode("");
      setReview("");
      setShowForm(false); // 열린 주차를 다 인증했으면 다시 "인증 완료"만 보이게
      setMsg({ type: "ok", text: "인증했어요. 응모권 1장이 쌓였어요." });
    } catch (err) {
      setMsg({ type: "error", text: err.code === "permission-denied" ? "지금은 인증할 수 없어요. 미션 진행 기간이 맞는지 확인하고, 계속 안 되면 운영진에게 알려 주세요." : err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={allDone ? "인증하기 ✔" : "인증하기"}>
      {!running && <p className="muted">인증은 미션 진행 기간과 최종 지목 기간에 할 수 있어요.</p>}
      {config.phase === PHASE.GUESSING && <p className="small note">미션은 마감됐어요. 받은 미션은 최종 지목이 마감되기 전까지 인증할 수 있어요.</p>}
      {mine !== null && (
        <ul className="plain redeem-status" aria-label="주차별 인증 상태">
          {openWeeks.map((w) => (
            <li key={w} className={doneWeeks.includes(w) ? "done" : ""}>{w}주차 {doneWeeks.includes(w) ? "✔ 인증 완료" : "인증 전"}</li>
          ))}
        </ul>
      )}
      {allDone && (
        <div className="stack tight">
          <p className="note" role="status">
            <b>✔ 인증을 마쳤어요.</b> {openWeeks.length > 1 ? `${openWeeks.length}주차까지 ` : ""}받은 미션을 모두 인증해서 지금은 더 입력할 것이 없어요.
            {(config.week || 1) < 3 && running ? " 다음 주차 미션을 받으면 여기에 입력 칸이 다시 나와요." : ""} 내 후기는 아래 "내가 인증한 것"에서 볼 수 있어요.
          </p>
          {msg.type === "ok" && msg.text && <p className="note" role="status">{msg.text}</p>}
          {!showForm && running && <button type="button" className="text-btn" onClick={() => setShowForm(true)}>코드 입력 칸 열기</button>}
        </div>
      )}
      {!allDone && doneWeeks.length > 0 && running && (
        <p className="small">{doneWeeks.join("·")}주차는 인증을 마쳤어요 ✔. 아직 인증하지 않은 주차: {leftWeeks.join("·")}주차(마니또의 미션을 받으면 코드를 입력해 주세요).</p>
      )}
      {(!allDone || showForm) && <form className="stack" id="code-entry-form" onSubmit={submit}>
        <label>
          <span className="panel-label">인증 코드</span>
          <input className="pk-input code-input" value={code} maxLength={6} onChange={(e) => setCode(e.target.value)} placeholder="K7Q2" disabled={!running} autoComplete="off" />
        </label>
        {own && <p className="error" role="alert">{OWN_CODE_MSG}</p>}
        {!own && <p className="small muted">내 마니또가 보낸 쪽지("마니또에게서 온 것")에 적힌 코드예요. "내 미션" 탭의 코드는 내가 내 대상에게 주는 코드라 여기에 넣지 않아요.</p>}
        <label className="with-counter">
          <span className="panel-label">후기 ({REVIEW_MIN}자 이상, 익명 피드에 올라가요)</span>
          <textarea className="pk-input" rows={3} maxLength={500} value={review} onChange={(e) => setReview(e.target.value)} disabled={!running}
            placeholder="무엇을 받았고 어땠는지 적어 주세요" />
          <span className="counter">{review.trim().length}자</span>
        </label>
        {card && (
          <div className="card-check">
            <p className="small">마니또가 고른 카드: <b>{LEVEL_LABEL[card.level] || card.level}</b> · {card.text}</p>
            {cardHow(card) && <p className="small how-hint"><HowTag card={card} /> {howHint(card)}</p>}
            <label className="check">
              <input type="checkbox" checked={cardMatch} onChange={(e) => setCardMatch(e.target.checked)} />
              받은 것이 이 카드 내용과 같아요 (다르면 체크를 풀어 주세요. 보통·도전 카드일 때 마니또의 추가 응모권에 영향이 있어요)
            </label>
            {isGuessCard(card) && <p className="small"><b>알아내 맞혀 보기 카드예요.</b> 마니또가 맞혔을 때만 체크해 주세요(틀렸으면 체크를 풀어 주세요).</p>}
          </div>
        )}
        {msg.text && !(allDone && msg.type === "ok") && <p className={msg.type === "error" ? "error" : "note"} role="status">{msg.text}</p>}
        <button className="pk-btn main" disabled={busy || !running}>인증하기</button>
      </form>}
    </Panel>
  );
}

function MyRedemptions({ myPid, items }) {
  const { config } = useApp();
  const [rows, setRows] = useState([]);
  useEffect(() => {
    return onSnapshot(query(collection(db, "redemptions"), where("receiverPid", "==", myPid)), (s) =>
      setRows(s.docs.map((d) => ({ code: d.id, ...d.data() })).sort((a, b) => a.slot - b.slot))
    );
  }, [myPid]);
  // 카드 확인도 인증과 같은 기간(미션 진행 ~ 최종 지목 마감)에만 받는다(보안 규칙)
  const open = config.phase === PHASE.RUNNING || config.phase === PHASE.GUESSING;
  // 완료 알림보다 먼저 인증해서 카드를 못 보고 인증한 미션: 알림이 온 뒤 그 카드를 보여 주고 한 번 확인받는다.
  // 추가 응모권이 있는 카드(보통·도전)만 묻는다. 확인이 없으면 마니또의 카드 추가분이 붙지 않는다(scoring.js).
  const cardToCheck = (r) => (r.cardMatch === undefined && !r.voided
    ? items.find((it) => carriesCard(it) && it.slot === r.slot && CARD_BONUS[it.card.level] > 0)?.card
    : null) || null;

  if (!rows.length) return null;
  return (
    <Panel title="내가 인증한 것">
      <ul className="plain">
        {rows.map((r) => {
          const card = cardToCheck(r);
          return (
            <li key={r.code} className="row-item">
              <p>{r.review}</p>
              {r.voided && <p className="error small">운영진이 무효 처리한 인증이에요.</p>}
              {card && open && <CardCheck code={r.code} slot={r.slot} card={card} />}
              {r.cardMatch === false && <p className="small muted">받은 것이 마니또가 고른 카드와 달랐다고 표시했어요.</p>}
              {r.feedId && <Thanks feedId={r.feedId} />}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// 나중 카드 확인: 인증할 때는 마니또의 완료 알림이 아직 없어 카드를 못 봤던 미션. 한 번만 남길 수 있다(보안 규칙).
function CardCheck({ code, slot, card }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const answer = async (cardMatch) => {
    setBusy(true);
    setError("");
    try {
      await updateDoc(doc(db, "redemptions", code), { cardMatch });
    } catch {
      setError("저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.");
      setBusy(false);
    }
  };
  return (
    <div className="card-check">
      <p className="small">
        <b>{slot}주차 카드 확인</b> 인증한 뒤에 마니또의 완료 알림이 왔어요. 마니또가 고른 카드: <b>{LEVEL_LABEL[card.level] || card.level}</b> · {card.text} <HowTag card={card} />
      </p>
      <p className="small">받은 것이 이 카드 내용과 같았나요? (같았다고 해야 마니또가 카드 추가 응모권을 받아요. 한 번만 고를 수 있어요){isGuessCard(card) ? " 알아내 맞혀 보기 카드는 맞혔을 때만 \"같았어요\"를 눌러 주세요." : ""}</p>
      <span className="inline">
        <button type="button" className="pk-btn" disabled={busy} onClick={() => answer(true)}>카드와 같았어요</button>
        <button type="button" className="pk-btn" disabled={busy} onClick={() => answer(false)}>카드와 달랐어요</button>
      </span>
      {error && <p className="error small" role="alert">{error}</p>}
    </div>
  );
}

// 감사 답장은 익명 피드 글에 붙는다(글쓴이만 한 번 쓸 수 있다). 마니또는 자기 미션의 피드 글에서 읽는다.
function Thanks({ feedId }) {
  const [sent, setSent] = useState(undefined); // undefined = 불러오는 중, null = 아직 안 씀
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => onSnapshot(doc(db, "feed", feedId), (s) => setSent(s.exists() ? s.data().thanks || null : null), () => setSent(null)), [feedId]);

  if (sent === undefined) return null;
  if (sent) return <p className="small muted">보낸 감사 답장: {sent}</p>;
  if (!open) return <button className="text-btn" onClick={() => setOpen(true)}>마니또에게 감사 답장 보내기</button>;
  return (
    <form className="inline" onSubmit={async (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      setError("");
      await updateDoc(doc(db, "feed", feedId), { thanks: text.trim() }).catch(() => setError("보내지 못했어요."));
    }}>
      <input className="pk-input" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="마니또에게 익명으로 전해져요 (피드에도 보여요)" />
      <button className="pk-btn main sm">보내기</button>
      {error && <span className="error small" role="alert">{error}</span>}
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
        <Giver>내 마니또</Giver>의 프로필 답변이에요. 매주 금요일 2개씩 공개돼요({clueScheduleText()}).
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

  // 주차별 중간 추측: 맞았는지는 알려 주지 않는다. 송년회에서 "몇 주차부터 알아챘나"가 공개된다(응모권과는 상관없음).
  const [mid, setMid] = useState({});
  const [midPick, setMidPick] = useState("");
  const [midMsg, setMidMsg] = useState("");
  useEffect(() => onSnapshot(doc(db, "midGuesses", myPid), (s) => setMid(s.exists() ? s.data().guesses || {} : {}), () => {}), [myPid]);
  const week = config.week || 1;
  async function saveMid(e) {
    e.preventDefault();
    if (!midPick) return;
    try {
      await setDoc(doc(db, "midGuesses", myPid), { guesses: { [week]: midPick }, ...bump() }, { merge: true });
      setMidMsg(`${week}주차 추측을 남겼어요. 이번 주 안에는 바꿀 수 있어요.`);
      setMidPick("");
    } catch {
      setMidMsg("지금은 남길 수 없어요.");
    }
  }

  async function toggle(pid) {
    await updateDoc(doc(db, "users", user.uid), { eliminated: eliminated.has(pid) ? arrayRemove(pid) : arrayUnion(pid), ...bump() });
  }

  async function submitGuess(e) {
    e.preventDefault();
    if (!pick) return;
    try {
      await setDoc(doc(db, "guesses", myPid), { guessPid: pick, createdAt: serverTimestamp(), ...bump() }, { merge: true });
      // 운영자가 지목 안 한 사람을 알 수 있게 "지목함"만 표시한다(누구를 지목했는지는 남기지 않음).
      await setDoc(doc(db, "progress", myPid), { guessed: true, ...bump() }, { merge: true });
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

      {config.phase === PHASE.RUNNING && (
        <form className="stack guess" onSubmit={saveMid}>
          <label>
            <span className="panel-label">{week}주차 추측 (맞았는지는 송년회에서 공개)</span>
            <select className="pk-input" value={midPick} onChange={(e) => setMidPick(e.target.value)}>
              <option value="">지금 가장 의심되는 사람</option>
              {remaining.map((s) => <option key={s.pid} value={s.pid}>{s.name}</option>)}
            </select>
          </label>
          <button className="pk-btn sm" disabled={!midPick}>이번 주 추측 남기기</button>
          <p className="small muted">응모권과는 상관없어요. 일찍부터 계속 맞힌 사람은 송년회에서 "가장 먼저 알아챈 사람"으로 발표돼요.</p>
        </form>
      )}
      {Object.keys(mid).length > 0 && (
        <p className="small">내 추측: {Object.entries(mid).sort(([a], [b]) => a - b).map(([w, pid]) => `${w}주차 ${byPid[pid]?.name || "?"}`).join(" · ")}</p>
      )}
      {midMsg && <p className="note small" role="status">{midMsg}</p>}

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
