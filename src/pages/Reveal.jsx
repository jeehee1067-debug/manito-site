import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, runTransaction, updateDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp, Loading } from "../App.jsx";
import { LEVEL_LABEL, PHASE } from "../lib/constants.js";
import { GOLD_DRAW, PRIZES, TICKET_RULES } from "../config/prizes.js";
import { ONLINE_PRIZE, PAPER_TIERS, PRIZE_ORDER, drawOnline, resolvePrizes, verifyOnline } from "../lib/scoring.js";
import { buildSlides, revealedUpTo } from "../lib/reveal.js";
import { goldWinnerWeeks, shownTitles, titleValue } from "../lib/titles.js";
import { Avatar, Dialogue, Panel } from "../ui.jsx";

const resultRef = () => doc(db, "results", "public");
const rankWord = (p) => p.label.split(" ")[0]; // "6등 응모권 추첨" → "6등"
// 한 장면에 여러 사람이 나올 때 캐릭터 크기: 사람이 많아도 큰 화면 한 장에 다 들어가게 줄인다. 0이면 이름만 보인다.
const crowdSize = (n) => (n <= 6 ? 110 : n <= 12 ? 84 : n <= 20 ? 64 : n <= 32 ? 48 : 0);
// 여러 사람을 한 장면에: 사람 수에 맞춰 캐릭터를 줄이고, 아주 많으면 이름만(crowdSize가 0). size를 주면 그 크기로(두 줄을 같은 크기로 맞출 때)
function Crowd({ pids, nameOf, size, className = "" }) {
  const n = pids.length;
  const px = size ?? crowdSize(n);
  return (
    <div className={`${n > 12 ? "pres-row dense" : "pres-row"} ${className}`.trim()}>
      {pids.map((pid) => (
        <span key={pid} className="pres-person">{px > 0 && <Avatar pid={pid} size={px} />}<b>{nameOf(pid)}</b></span>
      ))}
    </div>
  );
}
const WALL_SPEED = 45; // 칭찬 벽이 흘러가는 빠르기(1초에 몇 px)

// ── 시상·추첨(공개 단계, 발표 화면에서 진행) ─────────────────────────────────────
// 저장하는 것은 세 가지뿐이다(results/public.draws). 2등·3등과 "겹친 자리 다시 채우기"는 이 값들로 계산한다(scoring.js resolvePrizes).
//   seed          현장에서 정한 숫자. 한 번 넣으면 바꿀 수 없다(2등 동점을 가르고 6등 사이트 추첨에 쓴다)
//   grand·t4·t5   현장에서 종이로 뽑힌 이름(운영자가 입력). 6등을 뽑기 전까지는 고칠 수 있다
//   t6            사이트가 뽑은 6등. 뽑은 뒤에는 아무것도 바꿀 수 없다
// 두 번 누르거나 운영자 둘이 동시에 눌러도 덮어쓰지 않게 서버의 지금 값을 읽어 확인한 뒤 쓴다(트랜잭션). 보안 규칙도 같은 것을 막는다.
const prizeInput = (r) => ({
  tickets: r.tickets || {}, tieBreak: r.tieBreak || {}, draws: r.draws || {},
  reviews: r.reviewRank || (r.bestReview ? [r.bestReview] : []), // reviewRank가 없는 예전 집계는 1위 후기만
});
// 그 사람이 지금 받은 상(1~5등). 없으면 null
function prizeOf(res, pid) {
  if (res.grand.includes(pid)) return PRIZES.grand;
  if (res.best.includes(pid)) return PRIZES.bestManito;
  if (res.review?.receiverPid === pid) return PRIZES.bestReview;
  return PAPER_TIERS.find((t) => res[t.key].includes(pid)) || null;
}
// 종이로 뽑힌 이름을 넣을 수 없는 이유(없으면 null)
function paperBlock(res, prize, pid, tickets) {
  if (!((tickets?.[pid] || 0) > 0)) return "응모권이 없는 사람이에요(추첨 대상이 아니에요). 종이를 다시 뽑아 주세요.";
  if (prize.key === PRIZES.grand.key) return res.grand.length >= prize.count ? "1등은 이미 입력했어요. 잘못 입력했으면 이름 옆 ✕로 지운 뒤 다시 넣어 주세요." : null;
  const has = prizeOf(res, pid);
  if (has) return `이미 ${rankWord(has)} 수상자예요. 한 사람은 하나만 받으니 종이를 다시 뽑아 주세요.`;
  if (res.open[prize.key] <= 0) return `${rankWord(prize)}은 이미 다 뽑았어요.`;
  return null;
}
async function saveSeed(seed) {
  await runTransaction(db, async (tx) => {
    const cur = (await tx.get(resultRef())).data();
    if (cur.draws?.seed) throw new Error("이미 숫자를 정했어요. 한 번 정한 숫자는 바꿀 수 없어요.");
    tx.update(resultRef(), { "draws.seed": seed });
  });
}
async function editPaper(prize, pid, add) {
  await runTransaction(db, async (tx) => {
    const cur = (await tx.get(resultRef())).data();
    if (cur.draws?.t6) throw new Error("6등을 뽑은 뒤에는 수상자를 바꿀 수 없어요.");
    const list = cur.draws?.[prize.key]?.winners || [];
    if (add) {
      const why = list.includes(pid) ? "이미 입력한 이름이에요." : paperBlock(resolvePrizes(prizeInput(cur)), prize, pid, cur.tickets);
      if (why) throw new Error(why);
    }
    tx.update(resultRef(), { [`draws.${prize.key}`]: { winners: add ? [...list, pid] : list.filter((x) => x !== pid) } });
  });
}
async function runOnline() {
  await runTransaction(db, async (tx) => {
    const cur = (await tx.get(resultRef())).data();
    if (cur.draws?.t6) throw new Error("이미 뽑았어요. 6등 추첨은 다시 할 수 없어요.");
    const res = resolvePrizes(prizeInput(cur));
    if (res.seed == null) throw new Error("현장 숫자를 먼저 정해 주세요.");
    tx.update(resultRef(), { [`draws.${ONLINE_PRIZE.key}`]: { winners: drawOnline(cur.tickets || {}, res.seed, res.taken) } });
  });
}
const drawError = (err) => (err?.code ? "저장하지 못했어요. 잠시 뒤 다시 눌러 주세요." : err.message);

// 확정 버튼은 한 번 더 눌러 확인한다. 브라우저 확인창(confirm)은 전체 화면을 풀어 버려서 쓰지 않는다.

// 현장 숫자 넣기
function SeedForm() {
  const [seed, setSeed] = useState("");
  const [armed, setArmed] = useState(""); // 확인을 기다리는 숫자
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const s = seed.trim();
  const confirming = Boolean(armed) && armed === s;
  async function go() {
    if (!s) return setMsg("현장에서 정한 숫자를 먼저 넣어 주세요(예: 참석자가 부른 네 자리 숫자).");
    setMsg("");
    if (!confirming) return setArmed(s);
    setBusy(true);
    try { await saveSeed(s); } catch (err) { setMsg(drawError(err)); } finally { setBusy(false); setArmed(""); }
  }
  return (
    <div className="stack tight">
      <div className="inline">
        <input className="pk-input seed-input" value={seed} maxLength={20} inputMode="numeric"
          onChange={(e) => setSeed(e.target.value)} placeholder="현장에서 정한 숫자" aria-label="현장 숫자" />
        <button className="pk-btn gold" disabled={busy} onClick={go}>{confirming ? `숫자 ${armed}로 확정` : "숫자 정하기"}</button>
        {confirming && <button className="pk-btn sm ghost" disabled={busy} onClick={() => setArmed("")}>취소</button>}
      </div>
      {confirming && <p className="small" role="status">한 번 정하면 바꿀 수 없어요. 숫자가 맞으면 한 번 더 눌러 주세요.</p>}
      {msg && <p className="error small" role="alert">{msg}</p>}
    </div>
  );
}

// 종이로 뽑힌 이름 입력: 이름 일부를 치면 후보가 나오고, 누르면 들어간다. 잘못 넣은 이름은 ✕로 지운다.
function PaperForm({ r, prize, res, left }) {
  const { nameOf, byPid } = useApp();
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const people = useMemo(() => Object.entries(r.tickets || {}).filter(([, n]) => n > 0).map(([pid]) => pid)
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b), "ko")), [r.tickets, nameOf]);
  const word = q.trim();
  const hits = word ? people.filter((pid) => nameOf(pid).includes(word)).slice(0, 8) : [];
  async function add(pid) {
    setBusy(true);
    setMsg("");
    try { await editPaper(prize, pid, true); setQ(""); } catch (err) { setMsg(drawError(err)); } finally { setBusy(false); }
  }
  const locked = Boolean(r.draws?.t6);
  if (locked || left <= 0) return msg ? <p className="error small" role="alert">{msg}</p> : null;
  return (
    <form className="paper-form" onSubmit={(e) => { e.preventDefault(); if (hits.length === 1) add(hits[0]); else setMsg(hits.length ? "아래 후보에서 골라 주세요." : "명단에서 찾지 못했어요. 이름을 다시 확인해 주세요."); }}>
      <div className="inline">
        <input className="pk-input name-input" value={q} onChange={(e) => { setQ(e.target.value); setMsg(""); }} placeholder="뽑힌 이름 입력" aria-label={`${rankWord(prize)} 뽑힌 이름`} autoComplete="off" disabled={busy} />
        <span className="small">{rankWord(prize)} 남은 자리 {left}</span>
      </div>
      {hits.length > 0 && (
        <div className="inline name-hits">
          {hits.map((pid) => (
            <button type="button" key={pid} className="pk-btn sm" disabled={busy} onClick={() => add(pid)}>
              {nameOf(pid)}{byPid?.[pid]?.part ? ` (${byPid[pid].part})` : ""} · {res ? r.tickets[pid] : ""}장
            </button>
          ))}
        </div>
      )}
      {msg && <p className="error small" role="alert">{msg}</p>}
    </form>
  );
}

// 입력한 이름 옆의 ✕(잘못 입력했을 때). 6등을 뽑은 뒤에는 없다.
function RemoveName({ r, prize, pid }) {
  const { nameOf } = useApp();
  if (r.draws?.t6) return null;
  return <button type="button" className="text-btn name-x" aria-label={`${nameOf(pid)} 지우기`} title="잘못 입력했으면 지우기" onClick={() => editPaper(prize, pid, false).catch(() => {})}>✕</button>;
}

// 6등 사이트 추첨 버튼(한 번 더 눌러 확정)
function OnlineForm({ ready, why }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function go() {
    setMsg("");
    if (!ready) return setMsg(why);
    if (!armed) return setArmed(true);
    setBusy(true);
    try { await runOnline(); } catch (err) { setMsg(drawError(err)); } finally { setBusy(false); setArmed(false); }
  }
  return (
    <div className="stack tight">
      <div className="inline">
        <button className="pk-btn gold" disabled={busy} onClick={go}>{armed ? `${rankWord(ONLINE_PRIZE)} 추첨 확정` : `${rankWord(ONLINE_PRIZE)} 추첨하기`}</button>
        {armed && <button className="pk-btn sm ghost" disabled={busy} onClick={() => setArmed(false)}>취소</button>}
      </div>
      {armed && <p className="small" role="status">뽑은 뒤에는 1~6등을 모두 바꿀 수 없어요. 1~5등 이름이 맞는지 확인하고 한 번 더 눌러 주세요.</p>}
      {msg && <p className="error small" role="alert">{msg}</p>}
    </div>
  );
}

export default function Reveal() {
  const { config, isAdmin, nameOf, myPid, myPart } = useApp();
  const [r, setR] = useState(undefined);
  const [check, setCheck] = useState(null); // 추첨 검증 결과
  const [presenting, setPresenting] = useState(false);

  useEffect(() => onSnapshot(resultRef(), (s) => setR(s.exists() ? s.data() : null), () => setR(null)), []);
  const slides = useMemo(() => buildSlides(r, nameOf), [r, nameOf]);

  if (r === undefined) return <Loading />;
  if (!r) {
    return (
      <Panel title="결과">
        <p className="muted">{isAdmin ? "운영 탭의 집계 단계에서 집계하기를 누르면 결과가 만들어져요." : "아직 결과가 없어요."}</p>
      </Panel>
    );
  }

  // 참여자 화면은 운영자가 발표 화면에서 넘긴 장면까지만 보인다(무대보다 먼저 결과가 보이지 않게). 운영자는 모두 본다.
  const upto = isAdmin ? slides.length : revealedUpTo(r, slides);
  const shown = new Set(slides.slice(0, upto).map((s) => s.id));
  const pairOpen = (receiverPid) => slides.slice(0, upto).some((s) => s.type === "pairShow" && s.receiverPid === receiverPid);
  const allPairsOpen = shown.has("detective");
  const presentingNow = !isAdmin && upto < slides.length;

  const myManito = r.pairs.find((p) => p.receiverPid === myPid)?.giverPid;
  const mine = myPid ? r.ticketDetail?.[myPid] : null;
  const revealedPairs = r.pairs.filter((p) => pairOpen(p.receiverPid));
  const quickest = noticedTop(r.noticed);
  // 수상자: 무대에서 "겹친 자리 다시 채우기"(refill) 장면이 지나기 전에는 1등을 뽑기 전 모습으로 보인다(무대와 같은 순서로 바뀌게)
  const input = prizeInput(r);
  const final = resolvePrizes(input);
  const view = shown.has("refill") ? final : resolvePrizes({ ...input, withGrand: false });
  const started = final.seed != null;
  const hasReview = input.reviews.length > 0;
  // 1등부터 6등까지 한 줄씩. 참여자에게는 발표된 것만 보인다(운영자는 모두)
  const prizeRows = PRIZE_ORDER.map((prize) => {
    const isBest = prize === PRIZES.bestManito;
    const isReview = prize === PRIZES.bestReview;
    let people = []; // 발표된 사람
    let state = ""; // 아직 보일 것이 없을 때의 안내
    let quote = null; // 3등 후기
    if (isReview && !hasReview) state = "공감을 받은 후기가 없어 수상자가 없어요";
    else if (!started) state = "시상 전";
    else if (isReview) {
      if (!shown.has("bestReview")) state = "발표 전";
      else if (view.review) { people = [view.review.receiverPid]; quote = view.review; }
      else state = "수상자 없음(공감을 받은 후기를 쓴 사람이 모두 더 큰 상을 받았어요)";
    } else if (isBest) {
      const all = view.best;
      people = shown.has("refill") ? all : all.filter((_, k) => shown.has(`best${k}`));
      if (people.length < all.length) state = people.length ? "나머지는 발표 전" : "발표 전";
      else if (all.length === 0) state = "수상자 없음";
    } else if (prize.how === "online") {
      if (!final.t6) state = shown.has(`draw_${prize.key}`) ? "곧 뽑아요" : "발표 전";
      else if (!shown.has(`draw_${prize.key}`)) state = "발표 전";
      else { people = final.t6; if (!people.length) state = "당첨자 없음(응모권이 있는 사람이 앞에서 모두 받았어요)"; }
    } else { // 종이 추첨(1·4·5등)
      const all = prize === PRIZES.grand ? final.grand : view[prize.key];
      if (!shown.has(`draw_${prize.key}`)) state = "발표 전";
      else { people = all; if (people.length < prize.count) state = people.length ? "뽑는 중" : "현장에서 뽑는 중"; }
    }
    return { prize, isBest, isReview, people, state, quote };
  });
  const records = [
    shown.has("detective") && quickest && (
      <li key="quick"><strong>가장 먼저 알아챈 사람</strong> {quickest.pids.map(nameOf).join(", ")} <span className="small">({quickest.week}주차부터 계속 맞힘)</span></li>
    ),
    shown.has("angels") && (r.angels || []).length > 0 && (
      <li key="angels"><strong>숨은 수호천사</strong> {r.angels.map((a) => `${nameOf(a.angelPid)} → ${nameOf(a.receiverPid)}`).join(", ")}</li>
    ),
    ...shownTitles(r).filter((t) => shown.has(`title_${t.key}`)).map((t) => (
      <li key={`title_${t.key}`}>
        <strong>{t.emoji} {t.label}</strong> {t.winners.map(nameOf).join(", ")}
        <span className="small"> ({t.desc}{titleValue(t) ? ` · ${titleValue(t)}` : ""})</span>
        {t.winners.includes(myPid) && <span className="small"> · 축하해요!</span>}
      </li>
    )),
    shown.has("gold") && (
      <li key="gold">
        <strong>☕ 황금 카드 {GOLD_DRAW.prize}</strong> {goldWinnerWeeks(r).map((w) => `${w.week}주차 ${w.winners.map(nameOf).join(", ")}`).join(" · ")}
        {goldWinnerWeeks(r).some((w) => w.winners.includes(myPid)) && <span className="small"> · 축하해요!</span>}
      </li>
    ),
  ].filter(Boolean);

  return (
    <>
      {presenting && <Presenter r={r} slides={slides} onClose={() => setPresenting(false)} />}

      {isAdmin && config.phase === PHASE.REVEAL && (
        <Panel title="발표 화면">
          <p className="small">
            송년회 큰 화면에 띄우는 발표 화면이에요. 장면을 넘기면 참여자 휴대폰의 결과 탭도 같은 장면까지만 열려요(무대보다 먼저 결과가 보이지 않게).
            지금 참여자에게 열린 장면: {Math.min((r.step ?? slides.length - 1) + 1, slides.length)} / {slides.length}
          </p>
          <div className="inline">
            <button className="pk-btn gold" onClick={() => setPresenting(true)}>발표 화면 열기</button>
            <button className="pk-btn sm" onClick={() => window.confirm("발표 화면 없이 참여자에게 모든 결과를 한 번에 보일까요?") && updateDoc(resultRef(), { step: slides.length - 1 })}>발표 없이 모두 공개</button>
          </div>
        </Panel>
      )}

      {presentingNow && (
        <Dialogue speaker="운영진" tone="gold">
          지금 무대에서 결과를 발표하고 있어요! 공개된 것부터 여기에 보여요. ({upto} / {slides.length})
        </Dialogue>
      )}

      {myPid && (
        <section className="panel target">
          {pairOpen(myPid) ? <Avatar pid={myManito} size={140} /> : <div className="avatar-mask" aria-hidden="true">?</div>}
          <div>
            <span className="dialogue-speaker static">내 마니또는</span>
            <p className="target-name">{pairOpen(myPid) ? (myManito ? nameOf(myManito) : "-") : "무대에서 공개돼요"}</p>
            {mine && allPairsOpen && (
              <p className="small">
                내 응모권 {mine.total}장: 미션 {mine.mission} + 카드 {mine.card ?? mine.hard ?? 0}{mine.cost > 0 ? ` + 비용 카드 ${mine.cost}` : ""} + 인증 입력 {mine.entries}
                {mine.comp > 0 && ` + 못 받은 주차 보상 ${mine.comp}`} + 은신 {mine.hidden} + 정답 지목 {mine.guess}
                {mine.partBonus > 0 && ` + 우승 파트 ${mine.partBonus}`}
                {mine.angel > 0 && ` + 수호천사 ${mine.angel}`}
                {mine.assumed > 0 && ` (대상의 인증 없이 인정된 미션 ${mine.assumed}건 포함: 대상 불참, 운영진 확인, 전달된 칭찬 카드. 이런 미션에는 카드 추가분 없음)`}
                {mine.total === 0 && mine.mission + (mine.card ?? mine.hard ?? 0) + (mine.cost || 0) + mine.entries + mine.hidden + mine.guess + (mine.comp || 0) + (mine.partBonus || 0) + (mine.angel || 0) > 0 && " · 수상 제외 또는 중도 이탈로 0장 처리됐어요"}
              </p>
            )}
          </div>
        </section>
      )}

      <Panel title="추첨·시상">
        <p className="small">
          한 사람은 하나만 받아요. 겹치면 큰 상을 받고, 빈 자리는 다시 채워요.
          {" "}{PRIZES.bestManito.label}는 응모권이 가장 많은 {PRIZES.bestManito.count}명이에요(동점이면 내 미션에 달린 후기가 받은 공감(♥), 그래도 같으면 현장 숫자로 가려요).
          {" "}{PRIZES.bestReview.label}은 익명 피드에서 공감(♥)을 가장 많이 받은 후기예요(당사자 두 사람의 공감은 빼고, 동점이면 먼저 쓴 후기).
          {" "}{[...PAPER_TIERS, PRIZES.grand].map(rankWord).join("·")}은 현장에서 응모권 수만큼 넣은 이름 종이로 뽑고, {rankWord(ONLINE_PRIZE)}은 현장 숫자와 응모권 표로 사이트가 뽑아요.
        </p>
        {isAdmin && config.phase === PHASE.REVEAL && !final.t6 && <p className="small note">시상은 위 "발표 화면"에서 진행해요(숫자 정하기, 종이로 뽑힌 이름 입력, {rankWord(ONLINE_PRIZE)} 추첨).</p>}
        {started && <p className="small muted">현장에서 정한 숫자: {final.seed}</p>}
        <ol className="draws">
          {prizeRows.map(({ prize, isBest, people, state, quote }) => (
            <li key={prize.label} className={prize === PRIZES.grand ? "draw grand" : "draw"}>
              <div className="draw-head">
                <strong>{prize.label}</strong>
                <span className="small">{prize.count}명, {prize.prize}</span>
              </div>
              {people.length > 0 && (
                <div className="winner-row">
                  {people.map((pid) => (
                    <span key={pid} className={pid === myPid ? "winner me" : "winner"}>
                      <Avatar pid={pid} size={48} /><span>{nameOf(pid)}</span>
                      {isBest && <span className="small muted">{r.tickets?.[pid] ?? 0}장{r.tieBreak?.[pid] ? ` · ♥ ${r.tieBreak[pid]}` : ""}</span>}
                    </span>
                  ))}
                </div>
              )}
              {quote && <Dialogue speaker={`${nameOf(quote.receiverPid)}${quote.likes ? ` · ♥ 공감 ${quote.likes}` : ""}`}>{quote.review}</Dialogue>}
              {state && <p className="muted small">{state}</p>}
            </li>
          ))}
        </ol>
        {final.t6 && myPid && shown.has(`draw_${ONLINE_PRIZE.key}`) && (
          <p className="note" role="status">
            {(() => { const mineP = prizeOf(final, myPid) || (final.t6.includes(myPid) ? ONLINE_PRIZE : null); return mineP ? `축하해요! ${nameOf(myPid)}님은 ${mineP.label}에 뽑혔어요.` : "이번에는 뽑히지 않았어요. 3주 동안 수고하셨어요!"; })()}
          </p>
        )}
        {final.t6 && (isAdmin || shown.has(`draw_${ONLINE_PRIZE.key}`)) && (
          <div className="stack tight">
            <button type="button" className="pk-btn sm" onClick={() => setCheck(verifyOnline(input))}>{rankWord(ONLINE_PRIZE)} 추첨 검증</button>
            {check && (
              <p className={check.ok ? "small" : "error"} role="status">
                {ONLINE_PRIZE.label}: {check.ok ? "현장 숫자와 응모권 표로 다시 계산한 결과와 같아요" : "다시 계산한 결과와 달라요! 운영진에게 알려 주세요"}
              </p>
            )}
          </div>
        )}
      </Panel>

      {records.length > 0 && (
        <Panel title="그 밖의 기록">
          <ul className="plain awards">{records}</ul>
        </Panel>
      )}

      {shown.has("parts") && (r.partBoard || []).length > 0 && (
        <Panel title="파트 대항전 최종 순위">
          <p className="small">받는 사람이 인증한 미션 기준 완수율이에요. 1위 파트는 내 미션이 {TICKET_RULES.partBonusMinMissions}건 이상 인증된 파트원 모두 응모권 +{TICKET_RULES.partBonus}장을 받았어요.</p>
          <PartBoardList r={r} myPart={myPart} showWinner={shown.has("partWinner")} />
        </Panel>
      )}

      {revealedPairs.length > 0 && (
        <Panel title={`누가 누구의 마니또였을까 (${revealedPairs.length} / ${r.pairs.length})`}>
          <ul className="pairs">
            {[...revealedPairs].sort((a, b) => nameOf(a.receiverPid).localeCompare(nameOf(b.receiverPid), "ko")).map((p) => (
              <li key={p.giverPid}>
                <span className="pair-person"><Avatar pid={p.receiverPid} size={40} />{nameOf(p.receiverPid)}</span>
                <span className="pair-arrow">의 마니또는</span>
                <span className="pair-person"><Avatar pid={p.giverPid} size={40} /><strong>{nameOf(p.giverPid)}</strong></span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {shown.has("praise") && (
        <Panel title="칭찬 벽">
          <div className="wall">
            {(r.praises || []).map((p, i) => (
              <Dialogue key={i} speaker={`to. ${nameOf(p.receiverPid)}`} tone="gold">{p.message}</Dialogue>
            ))}
          </div>
        </Panel>
      )}
    </>
  );
}

// 가장 먼저 알아챈 사람: 알아챈 주차가 가장 이른 사람들(최종 지목에서야 맞힌 4는 제외)
// 발표 화면의 칭찬 벽: 카드가 한 화면을 넘으면 위로 천천히 흘러간다.
// 마지막 카드까지 보이도록 실제 높이를 재서 흘러갈 거리와 시간을 정한다(카드 수와 상관없이 정해진 비율만 움직이면 뒤쪽 카드가 끝내 안 보인다).
function PraiseWall({ praises, nameOf }) {
  const wall = useRef(null);
  const inner = useRef(null);
  const [move, setMove] = useState(null); // { shift: 흘러갈 거리(px), secs }. null = 한 화면에 다 들어감
  useEffect(() => {
    const measure = () => {
      if (!wall.current || !inner.current) return;
      const shift = inner.current.scrollHeight - wall.current.clientHeight;
      setMove(shift > 4 ? { shift, secs: Math.max(12, Math.round(shift / WALL_SPEED)) } : null);
    };
    measure();
    window.addEventListener("resize", measure); // 전체 화면을 켜고 끌 때 다시 잰다
    return () => window.removeEventListener("resize", measure);
  }, [praises.length]);
  return (
    <div className="pres-wall" ref={wall}>
      <div ref={inner} className={move ? "pres-wall-inner moving" : "pres-wall-inner"}
        style={move ? { "--wall-shift": `-${move.shift}px`, animationDuration: `${move.secs}s` } : undefined}>
        {praises.map((p, k) => (
          <Dialogue key={k} speaker={`to. ${nameOf(p.receiverPid)}`} tone="gold">{p.message}</Dialogue>
        ))}
      </div>
    </div>
  );
}

function noticedTop(noticed) {
  const entries = Object.entries(noticed || {}).filter(([, w]) => w < 4);
  if (entries.length === 0) return null;
  const week = Math.min(...entries.map(([, w]) => w));
  return { week, pids: entries.filter(([, w]) => w === week).map(([pid]) => pid) };
}

function PartBoardList({ r, myPart, showWinner = true, big = false }) {
  return (
    <ol className={big ? "board big" : "board"}>
      {r.partBoard.map((x) => {
        const pct = x.max ? Math.round((x.done / x.max) * 100) : 0;
        return (
          <li key={x.part} className={x.part === myPart ? "me" : showWinner && x.winner ? "win" : ""}>
            <span className="board-rank">{1 + r.partBoard.filter((y) => y.done * x.max > x.done * y.max).length}위</span>
            <span className="board-main">
              <span className="board-name">{x.part}{showWinner && x.winner && <span className="loc-tag sm">우승</span>}{x.part === myPart && <span className="loc-tag sm">우리 파트</span>}</span>
              <span className="board-bar" role="img" aria-label={`완수율 ${pct}%`}><i style={{ width: `${pct}%` }} /></span>
            </span>
            <span className="board-num"><strong>{pct}%</strong><span className="small">{x.done} / {x.max} · {x.members}명</span></span>
          </li>
        );
      })}
    </ol>
  );
}

// ── 발표 화면(운영자, 큰 화면용) ────────────────────────────────────────────────
// → / Space / PageDown: 다음, ← / PageUp: 이전, F: 전체 화면. 닫기는 버튼으로만(닫으면 운영자 화면에 모든 결과가 보여서, 실수로 닫히지 않게 Esc로는 닫지 않는다).
// 넘긴 장면 번호를 results/public.step에 남긴다(가장 멀리 간 장면). 참여자 결과 탭은 그 장면까지만 열린다.
// 무대에서는 이름이 잠깐 뒤에 나오므로(짝·2등·3등), 휴대폰에 먼저 보이지 않게 그만큼 늦게 남긴다.
// 종이 추첨·6등 장면은 현장에서 뽑아 입력하는 것이 곧 발표라 바로 남긴다.
const SPIN_MS = 1500; // 6등: 이름이 돌아가는 시간(연출)
const revealDelay = (slide) => (["paper", "refill", "online", "drawGo"].includes(slide.type) ? 300 : 1800);
function Presenter({ r, slides, onClose }) {
  const { nameOf } = useApp();
  const [i, setI] = useState(() => Math.min(r.step ?? 0, slides.length - 1));
  const [auto, setAuto] = useState(false);
  const rootRef = useRef(null);
  const slide = slides[i];
  const last = slides.length - 1;
  const res = resolvePrizes(prizeInput(r));
  const started = res.seed != null;
  // 이 장면에서 할 일이 남았으면 다음으로 넘어가지 않는다(숫자 정하기, 종이로 뽑힌 이름 입력, 겹친 자리 다시 뽑기).
  // 자리를 비워 둔 채 넘어가야 하면 "비워 두고 넘어가기"를 누른다.
  const [skipped, setSkipped] = useState(() => new Set());
  const todo = slide.type === "drawGo" ? (started ? "" : "숫자를 정해야 다음 장면으로 넘어가요")
    : slide.type === "paper" && !res.t6 && res.open[slide.prize.key] > 0 && (slide.prize === PRIZES.grand || res.grand.length === 0) ? `${rankWord(slide.prize)} ${res.open[slide.prize.key]}자리를 더 입력해야 넘어가요`
      : slide.type === "refill" && !res.t6 && PAPER_TIERS.some((t) => res.open[t.key] > 0) ? "비게 된 자리를 다시 뽑아 입력해야 넘어가요"
        : "";
  const mustDraw = Boolean(todo) && !skipped.has(slide.id);
  const canSkip = mustDraw && slide.type !== "drawGo";
  const go = (d) => { if (d > 0 && mustDraw) return; setI((x) => Math.max(0, Math.min(last, x + d))); };

  useEffect(() => {
    if (i <= (r.step ?? -1)) return undefined;
    const t = setTimeout(() => updateDoc(resultRef(), { step: i }).catch(() => {}), revealDelay(slide));
    return () => clearTimeout(t);
  }, [i, r.step]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); go(1); }
      else if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); go(-1); }
      else if (e.key === "f" || e.key === "F") toggleFull();
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });
  // 자동 넘기기: 짝 공개 구간에서만(질문 3초, 정답 5초)
  useEffect(() => {
    if (!auto || !slide || !slide.type.startsWith("pair")) return undefined;
    const t = setTimeout(() => go(1), slide.type === "pairAsk" ? 3000 : 5000);
    return () => clearTimeout(t);
  }, [auto, i]); // eslint-disable-line react-hooks/exhaustive-deps
  function toggleFull() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else rootRef.current?.requestFullscreen?.().catch(() => {});
  }
  const skipPairs = () => setI(Math.max(i, slides.findIndex((s) => s.id === "detective")));
  const pairCount = slides.filter((s) => s.type === "pairShow").length;
  // 추첨한 뒤 발표가 끝나기 전에 닫으면 운영자 화면(결과 탭)에 아직 발표하지 않은 당첨자까지 보인다
  const close = () => {
    if (started && i < last && !window.confirm("발표 화면을 닫을까요?\n\n닫으면 이 화면(운영자 결과 탭)에 아직 발표하지 않은 당첨자까지 모두 보여요. 큰 화면에 띄워 둔 상태라면 발표를 마친 뒤에 닫아 주세요.")) return;
    if (i > (r.step ?? -1)) updateDoc(resultRef(), { step: i }).catch(() => {}); // 늦게 남기려던 장면 번호를 닫기 전에 남긴다
    onClose();
  };

  return (
    <div className="presenter" ref={rootRef} role="dialog" aria-label="발표 화면">
      <div className="pres-stage" key={slide.id}>
        <Slide r={r} slide={slide} nameOf={nameOf} pairCount={pairCount} />
      </div>
      <div className="pres-controls">
        <button className="pk-btn sm" onClick={() => go(-1)} disabled={i === 0}>◀ 이전</button>
        <span className="small">{i + 1} / {slides.length}</span>
        <button className="pk-btn main" onClick={() => go(1)} disabled={i === last || mustDraw}>다음 ▶</button>
        {mustDraw && <span className="small">{todo}</span>}
        {canSkip && <button className="text-btn" onClick={() => setSkipped((x) => new Set(x).add(slide.id))}>비워 두고 넘어가기</button>}
        {slide.type.startsWith("pair") && (
          <>
            <button className={auto ? "pk-btn sm gold" : "pk-btn sm"} aria-pressed={auto} onClick={() => setAuto(!auto)}>{auto ? "자동 넘기기 끄기" : "자동 넘기기"}</button>
            <button className="pk-btn sm" onClick={() => window.confirm("남은 짝 공개를 건너뛸까요? (참여자 화면에는 모든 짝이 열려요)") && skipPairs()}>남은 짝 건너뛰기</button>
          </>
        )}
        <button className="pk-btn sm" onClick={toggleFull}>전체 화면</button>
        <button className="pk-btn sm ghost" onClick={close}>닫기</button>
      </div>
    </div>
  );
}

function Slide({ r, slide, nameOf, pairCount }) {
  const s = r.stats || {};
  switch (slide.type) {
    case "intro":
      return (
        <div className="pres-center">
          <p className="pres-kicker">S1FA 마니또</p>
          <h1 className="pres-title">결과 발표</h1>
          <div className="pres-stats">
            {s.people != null && <span><b>{s.people}</b>명이 참여</span>}
            {s.missions != null && <span><b>{s.missions}</b>개의 미션</span>}
            {s.notes != null && <span><b>{s.notes}</b>통의 추가 쪽지</span>}
            {s.reviews != null && <span><b>{s.reviews}</b>개의 후기</span>}
            {s.likes != null && <span><b>{s.likes}</b>번의 공감</span>}
            {s.toManito != null && <span><b>{s.toManito}</b>번의 "마니또에게 한마디"</span>}
            {s.angelMissions > 0 && <span><b>{s.angelMissions}</b>번의 수호천사 미션</span>}
          </div>
        </div>
      );
    case "parts":
      return (
        <div className="pres-center wide">
          <h2 className="pres-h2">파트 대항전 최종 순위</h2>
          <p className="pres-sub">받는 사람이 인증한 미션 기준 완수율</p>
          <PartBoardList r={r} showWinner={false} big />
        </div>
      );
    case "partWinner": {
      const win = (r.partBoard || []).filter((x) => x.winner).map((x) => x.part);
      return (
        <div className="pres-center">
          <p className="pres-kicker">우승 파트는…</p>
          <h1 className="pres-title pop delay">{win.join(", ") || "없음"}</h1>
          <p className="pres-sub delay2">미션을 {TICKET_RULES.partBonusMinMissions}건 이상 한 파트원 응모권 +{TICKET_RULES.partBonus}장!</p>
        </div>
      );
    }
    case "chainIntro":
      return (
        <div className="pres-center">
          <h1 className="pres-title">이제 정체를 공개합니다</h1>
          <p className="pres-sub">공개된 마니또가 다음 차례의 주인공이 돼요. 이름이 불리면 자리에서 일어나 주세요!</p>
          <p className="pres-sub small">{pairCount}쌍</p>
        </div>
      );
    case "pairAsk": {
      const guess = r.guesses?.[slide.receiverPid];
      return (
        <div className="pres-center">
          <p className="pres-kicker">{slide.i + 1} / {pairCount}</p>
          <Avatar pid={slide.receiverPid} size={180} />
          <h1 className="pres-title">{nameOf(slide.receiverPid)}님의 마니또는…?</h1>
          <p className="pres-sub">{guess ? `${nameOf(slide.receiverPid)}님이 지목한 사람: ${nameOf(guess)}` : "최종 지목을 하지 않았어요"}</p>
        </div>
      );
    }
    case "pairShow": {
      const guess = r.guesses?.[slide.receiverPid];
      const correct = guess === slide.giverPid;
      const week = r.noticed?.[slide.receiverPid];
      const story = r.story?.[slide.giverPid] || [];
      return (
        <div className="pres-center">
          <p className="pres-kicker">{nameOf(slide.receiverPid)}님의 마니또는</p>
          <div className="pop"><Avatar pid={slide.giverPid} size={200} /></div>
          <h1 className="pres-title pop">{nameOf(slide.giverPid)}</h1>
          <p className={correct ? "pres-badge ok" : "pres-badge"}>
            {correct ? (week && week < 4 ? `정답! ${week}주차부터 알고 있었어요` : "정답! 맞혔어요") : "끝까지 들키지 않았어요 · 은신 성공"}
          </p>
          {story.some((x) => x.done) && (
            <ul className="pres-story">
              {story.filter((x) => x.done).map((x) => (
                <li key={x.slot}>{x.slot}주차 {x.level && LEVEL_LABEL[x.level] ? `[${LEVEL_LABEL[x.level]}] ` : ""}{x.level === "praise" ? "칭찬 카드" : x.text}{x.redeemed ? " ✔" : ""}</li>
              ))}
            </ul>
          )}
        </div>
      );
    }
    case "detective": {
      const q = noticedTop(r.noticed);
      // 일찍 알아챈 사람이 많으면(모두가 열심히 추측한 경우 수십 명) 넓게·작게 놓아 한 장에 다 들어가게 한다
      return (
        <div className={q && q.pids.length > 6 ? "pres-center wide" : "pres-center"}>
          <h2 className="pres-h2">명탐정</h2>
          {s.guessed != null && <p className="pres-sub">최종 지목 {s.guessed}명 중 <b>{s.correct}</b>명이 마니또를 맞혔어요</p>}
          {q ? (
            <>
              <p className="pres-kicker">가장 먼저 알아챈 사람 · {q.week}주차 추측부터 끝까지 맞혔어요</p>
              <div className={q.pids.length > 12 ? "pres-row dense pop" : "pres-row pop"}>
                {q.pids.map((pid) => (
                  <span key={pid} className="pres-person">{crowdSize(q.pids.length) > 0 && <Avatar pid={pid} size={crowdSize(q.pids.length)} />}<b>{nameOf(pid)}</b></span>
                ))}
              </div>
            </>
          ) : <p className="pres-sub">일찍부터 맞힌 사람은 없었어요. 모두 감쪽같았네요!</p>}
        </div>
      );
    }
    case "angels":
      return (
        <div className="pres-center wide">
          <p className="pres-kicker">마니또가 바빴던 사람들을 몰래 챙긴</p>
          <h2 className="pres-h2">숨은 수호천사</h2>
          {r.angels.length <= 8 ? (
            <div className="pres-row">
              {r.angels.map((a) => (
                <span key={a.receiverPid} className="pres-person pop">
                  <Avatar pid={a.angelPid} size={r.angels.length <= 4 ? 100 : 72} />
                  <b>{nameOf(a.angelPid)}</b>
                  <span className="small">→ {nameOf(a.receiverPid)}님에게 미션 {a.done}건{a.order ? ` · ${a.order}번째로 지원` : ""}</span>
                </span>
              ))}
            </div>
          ) : (
            // 수호천사가 많으면 캐릭터 없이 한 줄씩(한 장에 다 들어가게)
            <ul className="pres-list pop">
              {r.angels.map((a) => (
                <li key={a.receiverPid}><b>{nameOf(a.angelPid)}</b> → {nameOf(a.receiverPid)}님 · 미션 {a.done}건{a.order ? ` · 지원 ${a.order}번째` : ""}</li>
              ))}
            </ul>
          )}
        </div>
      );
    case "bestReview": {
      // 발표할 때의 모습(1등을 뽑기 전): 2등 수상자를 뺀 공감 1위 후기
      const before = resolvePrizes({ ...prizeInput(r), withGrand: false });
      const rv = before.review;
      return (
        <div className="pres-center">
          <p className="pres-kicker">{PRIZES.bestReview.label} · {PRIZES.bestReview.prize}</p>
          {before.seed == null ? <p className="pres-sub">아직 시상 전이에요. "시상·추첨" 장면에서 숫자를 먼저 정해 주세요.</p>
            : !rv ? <p className="pres-sub">수상자 없음 (공감을 받은 후기를 쓴 사람이 모두 더 큰 상을 받았어요)</p>
              : (
                <>
                  <p className="pres-sub">가장 많은 공감을 받은 후기{rv.likes ? ` ♥ ${rv.likes}` : ""}</p>
                  <blockquote className="pres-quote">{rv.review}</blockquote>
                  <h1 className="pres-title pop delay">{nameOf(rv.receiverPid)}</h1>
                </>
              )}
        </div>
      );
    }
    case "best": {
      // 발표할 때의 모습(1등을 뽑기 전). 1등과 겹쳐 바뀐 자리는 "겹친 자리 다시 채우기" 장면에서 보여 준다
      const before = resolvePrizes({ ...prizeInput(r), withGrand: false });
      const done = before.seed != null;
      const pid = before.best[slide.rank];
      return (
        <div className="pres-center">
          <p className="pres-kicker">{PRIZES.bestManito.label} · {PRIZES.bestManito.prize}</p>
          {!done ? <p className="pres-sub">아직 시상 전이에요. "시상·추첨" 장면에서 숫자를 먼저 정해 주세요.</p>
            : !pid ? <p className="pres-sub">수상자 없음 (응모권이 있는 사람이 모자라요)</p>
              : (
                <>
                  <p className="pres-sub drum">응모권이 가장 많은 {PRIZES.bestManito.count}명 · 두구두구…</p>
                  <div className="pop delay"><Avatar pid={pid} size={200} /></div>
                  <h1 className="pres-title pop delay">{nameOf(pid)}</h1>
                  <p className="pres-sub pop delay">응모권 {r.tickets?.[pid] ?? 0}장{r.tieBreak?.[pid] ? ` · 미션 후기 공감 ♥ ${r.tieBreak[pid]}` : ""}</p>
                </>
              )}
        </div>
      );
    }
    case "praise":
      return (
        <div className="pres-center wide">
          <h2 className="pres-h2">칭찬 벽</h2>
          <PraiseWall praises={r.praises || []} nameOf={nameOf} />
        </div>
      );
    case "title": {
      // 송년회 칭호(응모권과 무관, 집계 때 기록으로 정함 — titles.js). 칭호마다 한 장면
      const t = shownTitles(r).find((x) => x.key === slide.key);
      if (!t) return null;
      return (
        <div className={t.winners.length > 6 ? "pres-center wide" : "pres-center"}>
          <p className="pres-kicker">송년회 칭호</p>
          <h1 className="pres-title"><span className="pres-emoji pop" aria-hidden="true">{t.emoji}</span> {t.label}</h1>
          <p className="pres-sub">{t.desc}</p>
          <Crowd pids={t.winners} nameOf={nameOf} className="pop delay" />
          {titleValue(t) && <p className="pres-badge ok delay2">{titleValue(t)}</p>}
        </div>
      );
    }
    case "gold": {
      // 황금 카드 커피 쿠폰(주차마다 추첨, 운영 화면 "황금 카드 추첨"의 기록을 집계 때 옮겨 둔 것). 송년회에서 발표하며 전달
      const weeks = goldWinnerWeeks(r);
      // 주차를 나란히 놓고 캐릭터를 작게(노트북 1280×720에서도 한 장에 들어가게)
      const size = Math.min(64, crowdSize(weeks.reduce((sum, w) => sum + w.winners.length, 0)));
      return (
        <div className="pres-center wide">
          <p className="pres-kicker">✨ 황금 카드 추첨</p>
          <h2 className="pres-h2">☕ {GOLD_DRAW.prize} 당첨!</h2>
          <p className="pres-sub">황금 카드 미션을 해내고 대상이 "카드와 같아요"로 인증한 마니또 중에서 주마다 뽑았어요</p>
          <div className="pres-groups">
            {weeks.map((w, i) => (
              <div key={w.week} className={i ? "pres-group pop delay" : "pres-group pop"}>
                <p className="pres-kicker">{w.week}주차</p>
                <Crowd pids={w.winners} nameOf={nameOf} size={size} />
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "drawGo":
      return <DrawGoSlide r={r} />;
    case "paper":
      return <PaperSlide r={r} prize={slide.prize} nameOf={nameOf} />;
    case "refill":
      return <RefillSlide r={r} nameOf={nameOf} />;
    case "online":
      return <OnlineSlide r={r} prize={slide.prize} nameOf={nameOf} />;
    default:
      return (
        <div className="pres-center">
          <h1 className="pres-title">모두 수고하셨어요!</h1>
          <p className="pres-sub">한 해 동안 고마웠어요. 메리 크리스마스, 그리고 새해 복 많이 받으세요!</p>
        </div>
      );
  }
}

// 시상 시작 장면: 현장 숫자를 정한다. 이 숫자로 2등 동점을 가르고 6등을 사이트가 뽑는다(한 번 정하면 바꿀 수 없다).
function DrawGoSlide({ r }) {
  const seed = r.draws?.seed;
  return (
    <div className="pres-center wide">
      <p className="pres-kicker">시상·추첨</p>
      <h1 className="pres-title">먼저 숫자 하나!</h1>
      <p className="pres-sub">
        참석자가 부른 숫자를 넣어 주세요. 2등 동점을 가르고 {rankWord(ONLINE_PRIZE)} 사이트 추첨에 써요.
        {" "}{[...PAPER_TIERS, PRIZES.grand].map(rankWord).join("·")}은 통에서 이름 종이를 직접 뽑아요. 한 사람은 하나만 받아요.
      </p>
      {seed
        ? <p className="pres-sub pop">현장에서 정한 숫자 {seed} · 다음 장면부터 시상합니다</p>
        : <SeedForm />}
    </div>
  );
}

// 수상자 줄(큰 화면)
function WinnerRow({ r, prize, pids, nameOf, removable }) {
  return (
    <div className="pres-row winners">
      {pids.map((pid) => (
        <span key={pid} className="pres-person pop">
          <Avatar pid={pid} size={pids.length > 6 ? 64 : pids.length > 1 ? 110 : 200} /><b>{nameOf(pid)}</b>
          {removable && <RemoveName r={r} prize={prize} pid={pid} />}
        </span>
      ))}
    </div>
  );
}

// 종이 추첨 장면(1·4·5등): 통에서 뽑은 이름을 읽고 운영자가 입력한다. 입력하면 참여자 휴대폰에도 바로 보인다.
// 4·5등 장면은 1등을 뽑기 전 모습 그대로 둔다(1등과 겹쳐 비게 된 자리는 "겹친 자리 다시 채우기" 장면에서 뽑는다).
function PaperSlide({ r, prize, nameOf }) {
  const input = prizeInput(r);
  const res = resolvePrizes(input);
  const isGrand = prize === PRIZES.grand;
  const before = resolvePrizes({ ...input, withGrand: false });
  const list = isGrand ? res.grand : before[prize.key];
  const canEdit = isGrand || res.grand.length === 0; // 1등을 뽑은 뒤에는 4·5등 장면에서 고치지 않는다
  const overlap = isGrand && res.grand[0] ? prizeOf(before, res.grand[0]) : null;
  return (
    <div className="pres-center wide">
      <p className="pres-kicker">{prize.prize} · {prize.count}명</p>
      <h1 className="pres-title">{prize.label}</h1>
      {res.seed == null ? <p className="pres-sub">아직 시상 전이에요. "시상·추첨" 장면에서 숫자를 먼저 정해 주세요.</p> : (
        <>
          <p className="pres-sub">
            {isGrand ? "통에서 이름 종이 한 장! 이미 다른 상을 받은 사람이 뽑혀도 1등이에요(그 자리는 다시 채워요)." : "통에서 이름 종이를 뽑아요. 이미 상을 받은 사람이 나오면 다시 뽑아요."}
          </p>
          {list.length > 0 && <WinnerRow r={r} prize={prize} pids={list} nameOf={nameOf} removable={canEdit} />}
          {overlap && <p className="pres-sub pop">{nameOf(res.grand[0])}님은 {rankWord(overlap)} 수상자였어요 → 1등만 받고, {rankWord(overlap)} 한 자리는 다음 장면에서 다시 채워요</p>}
          {canEdit && <PaperForm r={r} prize={prize} res={res} left={res.open[prize.key]} />}
        </>
      )}
    </div>
  );
}

// 겹친 자리 다시 채우기: 1등이 2~5등과 겹쳤으면 그 자리를 채운다. 2등은 다음 순위, 3등은 다음 후기가 자동으로 올라오고,
// 4·5등은 종이를 더 뽑아 입력한다. 2·3등으로 올라간 사람이 4·5등이었다면 그 자리도 다시 뽑는다.
function RefillSlide({ r, nameOf }) {
  const input = prizeInput(r);
  const res = resolvePrizes(input);
  const before = resolvePrizes({ ...input, withGrand: false });
  const moved = (list, now) => list.filter((pid) => !now.includes(pid));
  const lines = [];
  const up = (pid) => { const p = prizeOf(res, pid); return p ? `${nameOf(pid)}님은 ${rankWord(p)}으로` : `${nameOf(pid)}님`; };
  const bestOut = moved(before.best, res.best), bestIn = moved(res.best, before.best);
  if (bestOut.length) lines.push({ key: "best", text: `${PRIZES.bestManito.label}: ${bestOut.map(up).join(", ")} → 다음 순위 ${bestIn.length ? `${bestIn.map(nameOf).join(", ")}님이 받아요` : "없음"}` });
  const rvBefore = before.review?.receiverPid, rvNow = res.review?.receiverPid;
  if (rvBefore && rvBefore !== rvNow) lines.push({ key: "review", text: `${PRIZES.bestReview.label}: ${up(rvBefore)} → ${rvNow ? `다음으로 공감이 많은 후기의 ${nameOf(rvNow)}님이 받아요` : "다음 후기가 없어 수상자 없음"}` });
  const slots = PAPER_TIERS.map((t) => ({ prize: t, out: moved(before[t.key], res[t.key]), added: moved(res[t.key], before[t.key]), open: res.open[t.key] }));
  const anyPaper = slots.some((x) => x.out.length || x.open > 0);
  const nothing = lines.length === 0 && !anyPaper;
  return (
    <div className="pres-center wide">
      <p className="pres-kicker">한 사람은 하나만</p>
      <h2 className="pres-h2">겹친 자리 다시 채우기</h2>
      {res.grand.length === 0 ? <p className="pres-sub">1등을 먼저 뽑아 주세요(앞 장면).</p>
        : nothing ? <p className="pres-sub pop">1등 {nameOf(res.grand[0])}님은 다른 상과 겹치지 않았어요. 그대로 확정!</p>
          : (
            <>
              <p className="pres-sub">1등 {nameOf(res.grand[0])}님이 받았던 자리를 다시 채워요.</p>
              <ul className="pres-story refill-list">
                {lines.map((x) => <li key={x.key}>{x.text}</li>)}
                {slots.filter((x) => x.out.length || x.open > 0).map((x) => (
                  <li key={x.prize.key}>
                    {x.prize.label}: {x.out.length ? `${x.out.map(up).join(", ")} → ` : ""}
                    {x.added.length > 0 && <b>{x.added.map(nameOf).join(", ")}님이 새로 뽑혔어요 </b>}
                    {x.open > 0 && `종이를 ${x.open}장 더 뽑아 주세요`}
                  </li>
                ))}
              </ul>
              {slots.filter((x) => x.open > 0).map((x) => <PaperForm key={x.prize.key} r={r} prize={x.prize} res={res} left={x.open} />)}
            </>
          )}
    </div>
  );
}

// 6등 사이트 추첨: 현장 숫자와 응모권 표로, 1~5등을 받은 사람을 빼고 뽑는다. 뽑으면 각자 휴대폰 결과 탭에서 확인한다.
// 이름이 잠깐 돌아가는 것은 연출이고, 당첨자는 버튼을 누르는 순간 정해져 저장된다.
function OnlineSlide({ r, prize, nameOf }) {
  const res = resolvePrizes(prizeInput(r));
  const drawn = res.t6;
  const openLeft = res.open[PRIZES.grand.key] + PAPER_TIERS.reduce((n, t) => n + res.open[t.key], 0);
  const [force, setForce] = useState(false);
  const why = res.seed == null ? "현장 숫자를 먼저 정해 주세요(\"시상·추첨\" 장면)." : "아직 입력하지 않은 1~5등 자리가 있어요. 앞 장면에서 입력하거나, 아래 \"빈 자리를 비워 둔 채 뽑기\"를 눌러 주세요.";
  const [spinning, setSpinning] = useState(!drawn); // 이미 뽑혀 있던 화면(다시 들어온 경우)은 바로 보인다
  const [flash, setFlash] = useState("");
  const pool = useMemo(() => Object.entries(r.tickets || {}).filter(([pid, n]) => n > 0 && !res.taken.has(pid)).map(([pid]) => pid), [r.tickets, r.draws]); // eslint-disable-line react-hooks/exhaustive-deps
  const isDrawn = Boolean(drawn);
  useEffect(() => {
    if (!isDrawn || !spinning) return undefined;
    if (pool.length === 0) { setSpinning(false); return undefined; }
    const t = setInterval(() => setFlash(pool[Math.floor(Math.random() * pool.length)]), 80);
    const stop = setTimeout(() => setSpinning(false), SPIN_MS);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [isDrawn, spinning]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pres-center wide">
      <p className="pres-kicker">{prize.prize} · {prize.count}명</p>
      <h1 className="pres-title">{prize.label}</h1>
      {!drawn && (
        <>
          <p className="pres-sub">1~5등을 받은 사람을 빼고, 현장 숫자{res.seed ? ` ${res.seed}` : ""}와 응모권 표로 사이트가 뽑아요. 결과는 각자 휴대폰 결과 탭에서 확인!</p>
          <OnlineForm ready={res.seed != null && (openLeft === 0 || force)} why={why} />
          {res.seed != null && openLeft > 0 && !force && <button className="text-btn" onClick={() => setForce(true)}>1~5등 빈 자리 {openLeft}곳을 비워 둔 채 뽑기</button>}
        </>
      )}
      {drawn && spinning && <p className="pres-spin">{flash ? nameOf(flash) : "…"}</p>}
      {drawn && !spinning && (
        <>
          <WinnerRow r={r} prize={prize} pids={drawn} nameOf={nameOf} />
          {drawn.length === 0 && <p className="pres-sub">당첨자 없음 (응모권이 있는 사람이 앞에서 모두 받았어요)</p>}
          <p className="pres-sub">휴대폰 결과 탭에서 내 이름을 확인하세요</p>
        </>
      )}
    </div>
  );
}
