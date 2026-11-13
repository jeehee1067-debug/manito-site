import { useEffect, useState } from "react";
import { doc, onSnapshot, runTransaction } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp, Loading } from "../App.jsx";
import { PHASE } from "../lib/constants.js";
import { PRIZES, TICKET_RULES } from "../config/prizes.js";
import { weightedDraw } from "../lib/scoring.js";
import { Avatar, Dialogue, Panel } from "../ui.jsx";

const DRAW_ORDER = [...PRIZES.tiers, { key: "grand", ...PRIZES.grand }];

export default function Reveal() {
  const { config, isAdmin, nameOf, myPid, myPart } = useApp();
  const [r, setR] = useState(undefined);
  const [drawing, setDrawing] = useState(false);
  const [drawMsg, setDrawMsg] = useState("");

  useEffect(() => onSnapshot(doc(db, "results", "public"), (s) => setR(s.exists() ? s.data() : null), () => setR(null)), []);

  if (r === undefined) return <Loading />;
  if (!r) {
    return (
      <Panel title="결과">
        <p className="muted">{isAdmin ? "운영 탭의 집계 단계에서 집계하기를 누르면 결과가 만들어져요." : "아직 결과가 없어요."}</p>
      </Panel>
    );
  }

  const draws = r.draws || {};
  const canDraw = isAdmin && config.phase === PHASE.REVEAL;
  const myManito = r.pairs.find((p) => p.receiverPid === myPid)?.giverPid;
  const mine = myPid ? r.ticketDetail?.[myPid] : null;

  // 추첨 결과는 한 번 쓰면 바꿀 수 없다. 두 번 누르거나 운영자 둘이 동시에 눌러도 덮어쓰지 않게,
  // 서버의 지금 값을 읽어 "아직 안 뽑은 순서"일 때만 쓴다(트랜잭션). 보안 규칙도 이미 있는 추첨 결과의 변경·삭제를 거부한다.
  async function draw(step, index) {
    if (drawing) return;
    setDrawing(true);
    setDrawMsg("");
    const ref = doc(db, "results", "public");
    try {
      await runTransaction(db, async (tx) => {
        const cur = (await tx.get(ref)).data();
        const done = cur.draws || {};
        if (done[step.key]) throw new Error("already");
        if (DRAW_ORDER.slice(0, index).some((s) => !done[s.key])) throw new Error("order");
        // 2~4등끼리는 중복 당첨 없음, 대추첨은 전원 대상
        const exclude = step.key === "grand" ? new Set() : new Set(PRIZES.tiers.flatMap((t) => done[t.key] || []));
        const entries = Object.entries(cur.tickets).map(([pid, weight]) => ({ pid, weight }));
        tx.update(ref, { [`draws.${step.key}`]: weightedDraw(entries, step.count, undefined, exclude) });
      });
    } catch (err) {
      setDrawMsg(err.message === "order" ? "앞 순서 추첨을 먼저 해 주세요."
        : err.message === "already" ? "이미 추첨한 순서예요. 추첨 결과는 다시 뽑거나 바꿀 수 없어요."
          : "추첨하지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    } finally {
      setDrawing(false);
    }
  }

  return (
    <>
      {myPid && (
        <section className="panel target">
          <Avatar pid={myManito} size={140} />
          <div>
            <span className="dialogue-speaker static">내 마니또는</span>
            <p className="target-name">{myManito ? nameOf(myManito) : "-"}</p>
            {mine && (
              <p className="small">
                내 응모권 {mine.total}장: 미션 {mine.mission} + 도전 {mine.hard} + 인증 입력 {mine.entries}
                {mine.comp > 0 && ` + 못 받은 주차 보상 ${mine.comp}`} + 은신 {mine.hidden} + 정답 지목 {mine.guess}
                {mine.partBonus > 0 && ` + 우승 파트 ${mine.partBonus}`}
                {mine.assumed > 0 && ` (대상 불참·운영진 확인으로 인정된 미션 ${mine.assumed}건 포함, 인정된 미션에는 도전 추가분 없음)`}
                {mine.total === 0 && mine.mission + mine.hard + mine.entries + mine.hidden + mine.guess + (mine.comp || 0) + (mine.partBonus || 0) > 0 && " · 수상 제외 또는 중도 이탈로 0장 처리됐어요"}
              </p>
            )}
          </div>
        </section>
      )}

      <Panel title="추첨">
        <p className="small">응모권 수에 비례해 뽑아요. 순서: {DRAW_ORDER.map((s) => s.label).join(" → ")}. 한 번 뽑은 결과는 다시 뽑을 수 없어요.</p>
        {drawMsg && <p className="error" role="alert">{drawMsg}</p>}
        <ol className="draws">
          {DRAW_ORDER.map((step, i) => (
            <li key={step.key} className={step.key === "grand" ? "draw grand" : "draw"}>
              <div className="draw-head">
                <strong>{step.label}</strong>
                <span className="small">{step.count}명, {step.prize}</span>
              </div>
              {draws[step.key] ? (
                <div className="winner-row">
                  {draws[step.key].map((pid) => (
                    <span key={pid} className="winner"><Avatar pid={pid} size={48} /><span>{nameOf(pid)}</span></span>
                  ))}
                </div>
              ) : canDraw ? (
                <button className={step.key === "grand" ? "pk-btn gold" : "pk-btn main"} disabled={drawing} onClick={() => draw(step, i)}>추첨하기</button>
              ) : (
                <p className="muted small">추첨 전</p>
              )}
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title="시상">
        <div className="podium">
          {r.bestManito.map((b, i) => (
            <div key={b.pid} className={`podium-step rank-${i + 1}`}>
              <Avatar pid={b.pid} size={96} />
              <strong>{nameOf(b.pid)}</strong>
              <span className="small">{PRIZES.bestManito.label} {i + 1}위</span>
            </div>
          ))}
        </div>
        <ul className="plain awards">
          <li>
            <strong>{PRIZES.bestReview.label}</strong> {r.bestReview ? nameOf(r.bestReview.receiverPid) : "미정"} <span className="small">({PRIZES.bestReview.prize})</span>
            {r.bestReview && <Dialogue speaker={nameOf(r.bestReview.receiverPid)}>{r.bestReview.review}</Dialogue>}
          </li>
          <li>
            <strong>{PRIZES.mostTickets.label}</strong> {r.mostTickets ? `${nameOf(r.mostTickets.pid)} (${r.mostTickets.total}장)` : "-"} <span className="small">({PRIZES.mostTickets.prize})</span>
          </li>
        </ul>
      </Panel>

      {(r.partBoard || []).length > 0 && (
        <Panel title="파트 대항전 최종 순위">
          <p className="small">받는 사람이 인증한 미션 기준 완수율이에요. 1위 파트는 내 미션이 {TICKET_RULES.partBonusMinMissions}건 이상 인증된 파트원 모두 응모권 +{TICKET_RULES.partBonus}장을 받았어요.</p>
          <ol className="board">
            {r.partBoard.map((x) => {
              const pct = x.max ? Math.round((x.done / x.max) * 100) : 0;
              return (
                <li key={x.part} className={x.part === myPart ? "me" : ""}>
                  <span className="board-rank">{1 + r.partBoard.filter((y) => y.done * x.max > x.done * y.max).length}위</span>
                  <span className="board-main">
                    <span className="board-name">{x.part}{x.winner && <span className="loc-tag sm">우승</span>}{x.part === myPart && <span className="loc-tag sm">우리 파트</span>}</span>
                    <span className="board-bar" role="img" aria-label={`완수율 ${pct}%`}><i style={{ width: `${pct}%` }} /></span>
                  </span>
                  <span className="board-num"><strong>{pct}%</strong><span className="small">{x.done} / {x.max} · {x.members}명</span></span>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}

      <Panel title="누가 누구의 마니또였을까">
        <ul className="pairs">
          {[...r.pairs].sort((a, b) => nameOf(a.receiverPid).localeCompare(nameOf(b.receiverPid), "ko")).map((p) => (
            <li key={p.giverPid}>
              <span className="pair-person"><Avatar pid={p.receiverPid} size={40} />{nameOf(p.receiverPid)}</span>
              <span className="pair-arrow">의 마니또는</span>
              <span className="pair-person"><Avatar pid={p.giverPid} size={40} /><strong>{nameOf(p.giverPid)}</strong></span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="칭찬 벽">
        <div className="wall">
          {r.praises.map((p, i) => (
            <Dialogue key={i} speaker={`to. ${nameOf(p.receiverPid)}`} tone="gold">{p.message}</Dialogue>
          ))}
        </div>
      </Panel>
    </>
  );
}
