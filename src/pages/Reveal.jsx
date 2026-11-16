import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, runTransaction, updateDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp, Loading } from "../App.jsx";
import { LEVEL_LABEL, PHASE } from "../lib/constants.js";
import { PRIZES, TICKET_RULES } from "../config/prizes.js";
import { drawAll, verifyDraws } from "../lib/scoring.js";
import { DRAW_ORDER, buildSlides, revealedUpTo } from "../lib/reveal.js";
import { Avatar, Dialogue, Panel } from "../ui.jsx";

// 추첨 결과 한 칸: { seed, winners }
const winnersOf = (d) => d?.winners || [];
const resultRef = () => doc(db, "results", "public");
const rankWord = (p) => p.label.split(" ")[0]; // "6등 응모권 추첨" → "6등"

// 검증할 수 있는 추첨: 당첨자는 "현장에서 정한 숫자 + 응모권 표"만으로 정해진다(scoring.js drawAll).
// 숫자 하나로 큰 상부터(1등 → 2등 → 4등 → 5등 → 6등) 한 번에 정해 저장하고, 발표만 6등부터 한 장면씩 한다.
// 운영자가 미리 여러 번 돌려 보고 마음에 드는 결과를 고를 수 없게, 숫자는 추첨 직전에 참석자에게 받아 화면에 보이면서 넣는다.
// 추첨 결과는 한 번 쓰면 바꿀 수 없다. 두 번 누르거나 운영자 둘이 동시에 눌러도 덮어쓰지 않게,
// 서버의 지금 값을 읽어 "아직 안 뽑았을 때"만 쓴다(트랜잭션). 보안 규칙도 이미 있는 추첨 결과의 변경·삭제를 거부한다.
async function runDrawAll(seed) {
  await runTransaction(db, async (tx) => {
    const cur = (await tx.get(resultRef())).data();
    if (Object.keys(cur.draws || {}).length > 0) throw new Error("already");
    tx.update(resultRef(), { draws: drawAll(cur.tickets, seed, DRAW_ORDER, cur.tieBreak || {}) });
  });
}
const drawError = (err) => (err.message === "already" ? "이미 추첨했어요. 추첨 결과는 다시 뽑거나 바꿀 수 없어요."
  : "추첨하지 못했어요. 잠시 뒤 다시 눌러 주세요.");

// 숫자를 넣고 "추첨하기"를 누르면 한 번 더 눌러 확인한다. 브라우저 확인창(confirm)은 전체 화면을 풀어 버려서 쓰지 않는다.
function DrawForm({ onDrawn }) {
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
    try {
      await runDrawAll(s);
      onDrawn?.();
    } catch (err) {
      setMsg(drawError(err));
    } finally {
      setBusy(false);
      setArmed("");
    }
  }
  return (
    <div className="stack tight">
      <div className="inline">
        <input className="pk-input seed-input" value={seed} maxLength={20} inputMode="numeric"
          onChange={(e) => setSeed(e.target.value)} placeholder="현장에서 정한 숫자" aria-label="추첨 숫자" />
        <button className="pk-btn gold" disabled={busy} onClick={go}>{confirming ? `숫자 ${armed}로 추첨 확정` : "추첨하기"}</button>
        {confirming && <button className="pk-btn sm ghost" disabled={busy} onClick={() => setArmed("")}>취소</button>}
      </div>
      {confirming && <p className="small" role="status">{DRAW_ORDER.map(rankWord).join("·")}이 한 번에 정해지고 다시 뽑을 수 없어요. 숫자가 맞으면 한 번 더 눌러 주세요.</p>}
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

  const draws = r.draws || {};
  const myManito = r.pairs.find((p) => p.receiverPid === myPid)?.giverPid;
  const mine = myPid ? r.ticketDetail?.[myPid] : null;
  const revealedPairs = r.pairs.filter((p) => pairOpen(p.receiverPid));
  const drawn = Object.keys(draws).length > 0;
  const quickest = noticedTop(r.noticed);
  // 1등부터 6등까지 한 줄씩. 참여자에게는 발표된 것만 보인다(운영자는 모두)
  const prizeRows = [PRIZES.grand, PRIZES.bestManito, PRIZES.bestReview, ...PRIZES.tiers].map((prize) => {
    const isBest = prize === PRIZES.bestManito;
    const isReview = prize === PRIZES.bestReview;
    let people = []; // 발표된 사람
    let state = ""; // 아직 보일 것이 없을 때의 안내
    if (isReview) {
      if (!r.bestReview) state = "공감을 받은 후기가 없어 수상자가 없어요";
      else if (shown.has("bestReview")) people = [r.bestReview.receiverPid];
      else state = "발표 전";
    } else if (!drawn) {
      state = "추첨 전";
    } else {
      const all = winnersOf(draws[prize.key]);
      // 2등은 한 명씩 발표하므로 발표된 사람만, 나머지 순서는 그 장면이 열렸을 때 모두
      const open = isBest ? Array.from({ length: prize.count }, (_, k) => shown.has(`best${k}`)).every(Boolean) : shown.has(`draw_${prize.key}`);
      people = isBest ? all.filter((_, k) => shown.has(`best${k}`)) : open ? all : [];
      if (!open) state = people.length ? "나머지는 발표 전" : "발표 전";
      else if (all.length === 0) state = "당첨자 없음(응모권이 있는 사람이 앞 순서에서 모두 받았어요)";
    }
    return { prize, isBest, isReview, people, state };
  });
  const records = [
    shown.has("detective") && quickest && (
      <li key="quick"><strong>가장 먼저 알아챈 사람</strong> {quickest.pids.map(nameOf).join(", ")} <span className="small">({quickest.week}주차부터 계속 맞힘)</span></li>
    ),
    shown.has("angels") && (r.angels || []).length > 0 && (
      <li key="angels"><strong>숨은 수호천사</strong> {r.angels.map((a) => `${nameOf(a.angelPid)} → ${nameOf(a.receiverPid)}`).join(", ")}</li>
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
                내 응모권 {mine.total}장: 미션 {mine.mission} + 카드 {mine.card ?? mine.hard ?? 0} + 인증 입력 {mine.entries}
                {mine.comp > 0 && ` + 못 받은 주차 보상 ${mine.comp}`} + 은신 {mine.hidden} + 정답 지목 {mine.guess}
                {mine.partBonus > 0 && ` + 우승 파트 ${mine.partBonus}`}
                {mine.angel > 0 && ` + 수호천사 ${mine.angel}`}
                {mine.assumed > 0 && ` (대상의 인증 없이 인정된 미션 ${mine.assumed}건 포함: 대상 불참, 운영진 확인, 전달된 칭찬 카드. 이런 미션에는 카드 추가분 없음)`}
                {mine.total === 0 && mine.mission + (mine.card ?? mine.hard ?? 0) + mine.entries + mine.hidden + mine.guess + (mine.comp || 0) + (mine.partBonus || 0) + (mine.angel || 0) > 0 && " · 수상 제외 또는 중도 이탈로 0장 처리됐어요"}
              </p>
            )}
          </div>
        </section>
      )}

      <Panel title="추첨·시상">
        <p className="small">
          현장에서 정한 숫자 하나(예: 참석자가 부른 네 자리 숫자)로 큰 상부터 한 번에 정해요: {DRAW_ORDER.map(rankWord).join(" → ")}. 한 사람은 그중 하나만 받아요.
          {" "}{PRIZES.bestManito.label}는 추첨이 아니라 1등 당첨자를 뺀 응모권 최다 {PRIZES.bestManito.count}명이에요.
          동점이면 내 미션에 달린 후기가 받은 공감(♥)이 많은 사람, 그래도 같으면 같은 숫자로 가려요.
          {" "}{PRIZES.bestReview.label}은 익명 피드에서 공감(♥)을 가장 많이 받은 후기예요(동점이면 먼저 쓴 후기). 공감 수에서 그 미션의 당사자 두 사람(후기를 쓴 사람과 그 미션을 한 마니또)이 누른 것은 빼요. 발표는 {rankWord(PRIZES.tiers[PRIZES.tiers.length - 1])}부터 하고, 한 번 뽑은 결과는 다시 뽑을 수 없어요.
          같은 숫자로 누가 다시 계산해도 같은 결과가 나오니 발표가 끝나면 아래 "추첨 검증"으로 확인할 수 있어요.
        </p>
        {!drawn && isAdmin && config.phase === PHASE.REVEAL && <DrawForm />}
        {drawn && <p className="small muted">현장에서 정한 숫자: {draws[DRAW_ORDER[0].key]?.seed}</p>}
        <ol className="draws">
          {prizeRows.map(({ prize, isBest, isReview, people, state }) => (
            <li key={prize.label} className={prize === PRIZES.grand ? "draw grand" : "draw"}>
              <div className="draw-head">
                <strong>{prize.label}</strong>
                <span className="small">{prize.count}명, {prize.prize}</span>
              </div>
              {people.length > 0 && (
                <div className="winner-row">
                  {people.map((pid) => (
                    <span key={pid} className="winner">
                      <Avatar pid={pid} size={48} /><span>{nameOf(pid)}</span>
                      {isBest && <span className="small muted">{r.tickets?.[pid] ?? 0}장{r.tieBreak?.[pid] ? ` · ♥ ${r.tieBreak[pid]}` : ""}</span>}
                    </span>
                  ))}
                </div>
              )}
              {isReview && people.length > 0 && <Dialogue speaker={`${nameOf(r.bestReview.receiverPid)}${r.bestReview.likes ? ` · ♥ 공감 ${r.bestReview.likes}` : ""}`}>{r.bestReview.review}</Dialogue>}
              {state && <p className="muted small">{state}</p>}
            </li>
          ))}
        </ol>
        {drawn && (isAdmin || shown.has(`draw_${PRIZES.grand.key}`)) && (
          <div className="stack tight">
            <button type="button" className="pk-btn sm" onClick={() => setCheck(verifyDraws(r.tickets, draws, DRAW_ORDER, r.tieBreak || {}))}>추첨 검증</button>
            {check && (
              <ul className="plain">
                {check.map((x) => (
                  <li key={x.key} className={x.ok ? "small" : "error"}>
                    {DRAW_ORDER.find((d) => d.key === x.key)?.label}: {x.ok ? "숫자와 응모권으로 다시 계산한 결과와 같아요" : "다시 계산한 결과와 달라요! 운영진에게 알려 주세요"}
                  </li>
                ))}
              </ul>
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
// 무대에서는 이름이 잠깐 뒤에 나오거나(짝·시상) 이름이 돌아간 뒤에 당첨자가 나오므로(추첨), 휴대폰에 먼저 보이지 않게 그만큼 늦게 남긴다.
const spinMs = (step) => (step.key === PRIZES.grand.key ? 3000 : 1500);
const revealDelay = (slide) => (slide.type === "draw" ? spinMs(slide.step) + 400 : 1800);
function Presenter({ r, slides, onClose }) {
  const { nameOf } = useApp();
  const [i, setI] = useState(() => Math.min(r.step ?? 0, slides.length - 1));
  const [auto, setAuto] = useState(false);
  const rootRef = useRef(null);
  const slide = slides[i];
  const last = slides.length - 1;
  const drawn = Object.keys(r.draws || {}).length > 0;
  const mustDraw = slide.type === "drawGo" && !drawn; // 추첨하기 전에는 발표 장면으로 넘어가지 않는다(먼저 넘겨 두면 추첨하는 순간 휴대폰에 한꺼번에 열린다)
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
    if (drawn && i < last && !window.confirm("발표 화면을 닫을까요?\n\n닫으면 이 화면(운영자 결과 탭)에 아직 발표하지 않은 당첨자까지 모두 보여요. 큰 화면에 띄워 둔 상태라면 발표를 마친 뒤에 닫아 주세요.")) return;
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
        {mustDraw && <span className="small">숫자를 넣고 추첨해야 다음 장면으로 넘어가요</span>}
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
      return (
        <div className="pres-center">
          <h2 className="pres-h2">명탐정</h2>
          {s.guessed != null && <p className="pres-sub">최종 지목 {s.guessed}명 중 <b>{s.correct}</b>명이 마니또를 맞혔어요</p>}
          {q ? (
            <>
              <p className="pres-kicker">가장 먼저 알아챈 사람</p>
              <div className="pres-row pop">{q.pids.map((pid) => <span key={pid} className="pres-person"><Avatar pid={pid} size={110} /><b>{nameOf(pid)}</b></span>)}</div>
              <p className="pres-sub">{q.week}주차 추측부터 끝까지 맞혔어요</p>
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
          <div className="pres-row">
            {r.angels.map((a) => (
              <span key={a.receiverPid} className="pres-person pop">
                <Avatar pid={a.angelPid} size={100} />
                <b>{nameOf(a.angelPid)}</b>
                <span className="small">→ {nameOf(a.receiverPid)}님에게 미션 {a.done}건{a.order ? ` · ${a.order}번째로 지원` : ""}</span>
              </span>
            ))}
          </div>
        </div>
      );
    case "bestReview":
      return (
        <div className="pres-center">
          <p className="pres-kicker">{PRIZES.bestReview.label} · {PRIZES.bestReview.prize}</p>
          <p className="pres-sub">가장 많은 공감을 받은 후기{r.bestReview.likes ? ` ♥ ${r.bestReview.likes}` : ""}</p>
          <blockquote className="pres-quote">{r.bestReview.review}</blockquote>
          <h1 className="pres-title pop delay">{nameOf(r.bestReview.receiverPid)}</h1>
        </div>
      );
    case "best": {
      const done = Boolean(r.draws?.[PRIZES.bestManito.key]);
      const pid = winnersOf(r.draws?.[PRIZES.bestManito.key])[slide.rank];
      return (
        <div className="pres-center">
          <p className="pres-kicker">{PRIZES.bestManito.label} · {PRIZES.bestManito.prize}</p>
          {!done ? <p className="pres-sub">아직 추첨 전이에요. "응모권 추첨" 장면에서 숫자를 넣어 주세요.</p>
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
          <div className="pres-wall">
            <div className="pres-wall-inner">
              {(r.praises || []).map((p, k) => (
                <Dialogue key={k} speaker={`to. ${nameOf(p.receiverPid)}`} tone="gold">{p.message}</Dialogue>
              ))}
            </div>
          </div>
        </div>
      );
    case "drawGo":
      return <DrawGoSlide r={r} />;
    case "draw":
      return <DrawSlide r={r} step={slide.step} nameOf={nameOf} />;
    default:
      return (
        <div className="pres-center">
          <h1 className="pres-title">모두 수고하셨어요!</h1>
          <p className="pres-sub">한 해 동안 고마웠어요. 메리 크리스마스, 그리고 새해 복 많이 받으세요!</p>
        </div>
      );
  }
}

// 추첨 장면: 숫자 하나를 넣으면 1·2·4·5·6등이 한 번에 정해져 저장된다. 발표는 다음 장면부터 작은 상 → 큰 상 순서로.
function DrawGoSlide({ r }) {
  const done = Object.keys(r.draws || {}).length > 0;
  return (
    <div className="pres-center wide">
      <p className="pres-kicker">응모권 추첨</p>
      <h1 className="pres-title">숫자 하나로 한 번에!</h1>
      <p className="pres-sub">현장에서 정한 숫자를 넣으면 큰 상부터 차례로 정해져요. 한 사람은 하나만 받고, 발표는 {rankWord(PRIZES.tiers[PRIZES.tiers.length - 1])}부터 합니다.</p>
      {done
        ? <p className="pres-sub pop">추첨 완료! 현장에서 정한 숫자 {r.draws[DRAW_ORDER[0].key]?.seed} · 다음 장면부터 발표합니다</p>
        : <DrawForm />}
    </div>
  );
}

// 발표 장면: 장면에 들어오면 응모권이 있는 사람 이름이 잠깐 돌아간 뒤 당첨자가 나온다.
// (돌아가는 이름은 연출일 뿐, 당첨자는 추첨 장면에서 숫자와 응모권 표로 이미 정해져 저장된 것이다)
function DrawSlide({ r, step, nameOf }) {
  const done = Boolean(r.draws?.[step.key]); // 당첨자가 0명인 순서(앞 순서에서 모두 받음)도 뽑은 것이다
  const drawn = winnersOf(r.draws?.[step.key]);
  const [spinning, setSpinning] = useState(true);
  const [flash, setFlash] = useState("");
  const pool = useMemo(() => Object.entries(r.tickets || {}).filter(([, n]) => n > 0).map(([pid]) => pid), [r.tickets]);
  const ms = spinMs(step);
  useEffect(() => {
    if (!done || !spinning) return undefined;
    if (pool.length === 0) { setSpinning(false); return undefined; }
    const t = setInterval(() => setFlash(pool[Math.floor(Math.random() * pool.length)]), 80);
    const stop = setTimeout(() => setSpinning(false), ms);
    return () => { clearInterval(t); clearTimeout(stop); };
  }, [done, spinning, pool, ms]);
  return (
    <div className="pres-center wide">
      <p className="pres-kicker">{step.prize} · {step.count}명</p>
      <h1 className="pres-title">{step.label}</h1>
      {!done && <p className="pres-sub">아직 추첨 전이에요. "응모권 추첨" 장면에서 숫자를 넣어 주세요.</p>}
      {done && spinning && <p className="pres-spin">{flash ? nameOf(flash) : "…"}</p>}
      {done && !spinning && (
        <div className="pres-row winners">
          {drawn.map((pid) => <span key={pid} className="pres-person pop"><Avatar pid={pid} size={drawn.length > 6 ? 64 : 110} /><b>{nameOf(pid)}</b></span>)}
          {drawn.length === 0 && <p className="pres-sub">당첨자 없음 (응모권이 있는 사람이 앞 순서에서 모두 받았어요)</p>}
        </div>
      )}
    </div>
  );
}
