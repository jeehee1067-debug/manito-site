import { useEffect, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp, Loading } from "../App.jsx";
import { PHASE } from "../lib/constants.js";
import { PRIZES } from "../config/prizes.js";
import { weightedDraw } from "../lib/scoring.js";
import { Avatar, Dialogue, Panel } from "../ui.jsx";

const DRAW_ORDER = [...PRIZES.tiers, { key: "grand", ...PRIZES.grand }];

export default function Reveal() {
  const { config, isAdmin, nameOf, myPid } = useApp();
  const [r, setR] = useState(undefined);

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

  async function draw(step, index) {
    const prevKeys = DRAW_ORDER.slice(0, index).map((s) => s.key);
    if (prevKeys.some((k) => !draws[k])) return window.alert("앞 순서 추첨을 먼저 해 주세요.");
    // 2~4등끼리는 중복 당첨 없음, 대추첨은 전원 대상
    const exclude = step.key === "grand" ? new Set() : new Set(PRIZES.tiers.flatMap((t) => draws[t.key] || []));
    const entries = Object.entries(r.tickets).map(([pid, weight]) => ({ pid, weight }));
    const winners = weightedDraw(entries, step.count, undefined, exclude);
    await updateDoc(doc(db, "results", "public"), { [`draws.${step.key}`]: winners });
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
                내 응모권 {mine.total}장: 미션 {mine.mission} + 도전 {mine.hard} + 인증 입력 {mine.entries} + 은신 {mine.hidden} + 정답 지목 {mine.guess}
              </p>
            )}
          </div>
        </section>
      )}

      <Panel title="추첨">
        <p className="small">응모권 수에 비례해 뽑아요. 순서: {DRAW_ORDER.map((s) => s.label).join(" → ")}.</p>
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
                <button className={step.key === "grand" ? "pk-btn gold" : "pk-btn main"} onClick={() => draw(step, i)}>추첨하기</button>
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
