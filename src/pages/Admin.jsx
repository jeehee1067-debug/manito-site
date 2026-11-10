import { useEffect, useState } from "react";
import {
  collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import Claim from "./Claim.jsx";
import { Panel } from "../ui.jsx";
import { PHASE, PHASES, TEAM_COUNT, CLUE_COUNT, LOCS } from "../lib/constants.js";
import { assignManito, assignmentMemo, generateCodes, makeInviteCode, splitTeams } from "../lib/assign.js";
import { computeTickets, pickMostTickets, rankBestManito } from "../lib/scoring.js";
import { PRIZES } from "../config/prizes.js";

// Firestore 배치는 500건 제한이라 나눠서 커밋한다.
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach((op) => op(batch));
    await batch.commit();
  }
}

const NEXT_PHASE_NOTE = {
  0: "미션 진행을 시작합니다. 시작 후에는 명단 수정과 재배정을 할 수 없어요.",
  1: "미션 진행을 마감하고 최종 지목을 받습니다. 이후 인증·미션 완료는 막혀요.",
  2: "지목을 마감하고 투표를 엽니다. 이 단계부터 운영자 화면에서 짝 정보를 읽을 수 있어요.",
  3: "투표를 마감하고 집계 단계로 넘어갑니다.",
  4: "결과를 전원에게 공개합니다.",
};

export default function Admin() {
  const { config, myPid } = useApp();
  const phase = config.phase;

  async function advance() {
    if (!window.confirm(`${PHASES[phase]} → ${PHASES[phase + 1]}\n\n${NEXT_PHASE_NOTE[phase]}\n\n되돌릴 수 없어요. 진행할까요?`)) return;
    await updateDoc(doc(db, "config", "app"), { phase: phase + 1 });
  }

  return (
    <>
      <Panel title="운영 단계">
        <div className="phase-bar">
          {PHASES.map((p, i) => <span key={p} className={i === phase ? "on" : i < phase ? "past" : ""}>{p}</span>)}
        </div>
        {phase < PHASE.REVEAL && <button className="pk-btn red" onClick={advance}>다음 단계로: {PHASES[phase + 1]}</button>}
      </Panel>

      {!myPid && (
        <>
          <p className="login-note">운영자도 참여하려면 명단을 만든 뒤 내 이름의 초대 코드로 연결하세요.</p>
          <Claim />
        </>
      )}

      {phase === PHASE.SETUP && <Setup />}
      {phase === PHASE.RUNNING && <Running />}
      {phase === PHASE.GUESSING && <Panel title="최종 지목 중"><p>지목 결과는 투표 단계부터 집계 화면에서 볼 수 있어요.</p></Panel>}
      {phase >= PHASE.RUNNING && phase <= PHASE.SCORING && <Moderation />}
      {phase === PHASE.VOTING && <VotingAdmin />}
      {phase === PHASE.SCORING && <Scoring />}
      {phase === PHASE.REVEAL && <Panel title="공개"><p>결과 탭에서 추첨을 진행하세요.</p></Panel>}
    </>
  );
}

function Setup() {
  const { roster } = useApp();
  const [text, setText] = useState("");
  const [invites, setInvites] = useState({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [siteMode, setSiteMode] = useState("any");

  useEffect(() => onSnapshot(collection(db, "invites"), (s) => {
    const m = {};
    s.docs.forEach((d) => { m[d.data().personId] = d.id; });
    setInvites(m);
  }), []);

  async function addPeople() {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const start = roster.reduce((m, r) => Math.max(m, Number(r.pid.slice(1)) || 0), 0);
    const ops = [];
    const bad = [];
    lines.forEach((line, i) => {
      // "이름,근무지,팀" — 근무지·팀은 생략 가능, "이름,팀번호"도 받는다
      const [name, second = "", third = ""] = line.split(/[,\t]/).map((x) => x.trim());
      const isTeam = /^\d+$/.test(second);
      const loc = isTeam ? null : (second.toUpperCase() || null);
      const team = isTeam ? Number(second) : third ? Number(third) : null;
      if (loc && !LOCS.includes(loc)) bad.push(`${name}(${second})`);
      const pid = `p${String(start + i + 1).padStart(3, "0")}`;
      const invite = makeInviteCode();
      ops.push((b) => b.set(doc(db, "roster", pid), { name, loc, team, uid: null, disqualified: false }));
      ops.push((b) => b.set(doc(db, "invites", invite), { personId: pid }));
    });
    if (bad.length) return setMsg(`근무지는 ${LOCS.join(", ")} 중 하나로 적어 주세요: ${bad.join(", ")}`);
    setBusy(true);
    await commitInChunks(ops);
    setBusy(false);
    setText("");
    setMsg(`${lines.length}명을 추가했어요.`);
  }

  async function removePerson(r) {
    if (r.uid) return window.alert("이미 가입한 사람은 지울 수 없어요.");
    if (!window.confirm(`${r.name}님을 명단에서 지울까요?`)) return;
    await deleteDoc(doc(db, "roster", r.pid));
    if (invites[r.pid]) await deleteDoc(doc(db, "invites", invites[r.pid]));
  }

  async function cycleLoc(r) {
    const next = LOCS[(LOCS.indexOf(r.loc) + 1) % LOCS.length];
    await updateDoc(doc(db, "roster", r.pid), { loc: next });
  }

  async function autoTeams() {
    if (!window.confirm(`전원을 ${TEAM_COUNT}팀으로 무작위 편성할까요? 기존 팀은 덮어써요.`)) return;
    const teams = splitTeams(roster.map((r) => r.pid), TEAM_COUNT);
    await commitInChunks(Object.entries(teams).map(([pid, team]) => (b) => b.update(doc(db, "roster", pid), { team })));
    setMsg("팀을 편성했어요.");
  }

  async function assign() {
    if (roster.some((r) => !r.team)) return setMsg("팀이 없는 사람이 있어요. 팀을 먼저 정해 주세요.");
    if (!window.confirm("마니또를 배정할까요? 다시 배정하면 이전 배정과 코드는 모두 없어져요.\n\n운영자도 참여한다면 배정 직후 브라우저 개발자 도구를 열지 마세요.")) return;
    setBusy(true);
    try {
      const metaRef = doc(db, "meta", "assignment");
      const prev = await getDoc(metaRef);
      const ops = [];
      if (prev.exists()) {
        const { codes = [], pids = [] } = prev.data();
        codes.forEach((c) => ops.push((b) => b.delete(doc(db, "codes", c))));
        pids.forEach((p) => {
          ops.push((b) => b.delete(doc(db, "assignments", p)));
          ops.push((b) => b.delete(doc(db, "giverCodes", p)));
        });
      }
      const people = roster.map((r) => ({ pid: r.pid, team: r.team, loc: r.loc || null }));
      const { pairs, siteMatched, teamExcluded, warnings } = assignManito(people, { siteMode });
      const codes = generateCodes(pairs.map((p) => p.giverPid));
      const receiverOf = Object.fromEntries(pairs.map((p) => [p.giverPid, p.receiverPid]));
      for (const { giverPid, receiverPid } of pairs) {
        ops.push((b) => b.set(doc(db, "assignments", giverPid), { receiverPid }));
        ops.push((b) => b.set(doc(db, "giverCodes", giverPid), { codes: codes[giverPid] }));
        for (const [slot, code] of Object.entries(codes[giverPid])) {
          ops.push((b) => b.set(doc(db, "codes", code), { receiverPid: receiverOf[giverPid], slot: Number(slot) }));
        }
      }
      ops.push((b) => b.set(metaRef, { ...assignmentMemo(pairs, codes), at: serverTimestamp() }));
      await commitInChunks(ops);
      // 추리 보드가 후보를 줄일 때 쓰는 값 (짝 정보는 아님)
      await updateDoc(doc(db, "config", "app"), { siteMatched, teamExcluded });
      setMsg(`${pairs.length}명 배정 완료.` + (warnings.length ? " " + warnings.join(" ") : siteMatched ? " 같은 근무지·다른 팀으로, 맞마니또 없이 짝지었어요." : " 다른 팀끼리, 맞마니또 없이 짝지었어요. 근무지가 다른 짝은 원격 미션 카드가 나와요."));
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...roster].sort((a, b) => a.pid.localeCompare(b.pid));
  const inviteText = sorted.map((r) => `${r.name}\t${invites[r.pid] || ""}`).join("\n");

  return (
    <>
      <Panel title="1. 명단">
        <p className="small">한 줄에 한 명, "이름,근무지" 형식. 팀까지 직접 정하려면 "이름,근무지,팀번호".</p>
        <textarea className="pk-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"홍길동,SR3\n김철수,S1L,3"} />
        <button className="pk-btn main" onClick={addPeople} disabled={busy}>명단에 추가</button>
      </Panel>

      <Panel title={`2. 팀 (${TEAM_COUNT}팀)`}>
        <button className="pk-btn" onClick={autoTeams} disabled={!roster.length}>무작위로 팀 편성</button>
      </Panel>

      <Panel title="3. 마니또 배정">
        <div className="chip-row">
          <button className={siteMode === "any" ? "chip is-on" : "chip"} onClick={() => setSiteMode("any")}>근무지 상관없이</button>
          <button className={siteMode === "same" ? "chip is-on" : "chip"} onClick={() => setSiteMode("same")}>같은 근무지끼리만</button>
        </div>
        <p className="small">
          {siteMode === "any"
            ? "다른 근무지끼리도 짝이 될 수 있어요. 대상이 다른 근무지면 직접 가지 않아도 되는 미션 카드만 나와요."
            : "같은 근무지끼리만 짝을 지어요. 실물 미션을 모두 할 수 있고, 추리 보드에서 다른 근무지가 후보에서 빠져요."}
        </p>
        <button className="pk-btn main" onClick={assign} disabled={busy || roster.length < 3}>배정하기</button>
      </Panel>

      {msg && <p className="note banner" role="status">{msg}</p>}

      <Panel title={`명단 ${roster.length}명`}>
        <button className="pk-btn sm" onClick={() => navigator.clipboard.writeText(inviteText)}>이름과 초대 코드 복사</button>
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>이름</th><th>근무지</th><th>팀</th><th>초대 코드</th><th>가입</th><th></th></tr></thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.pid}>
                  <td>{r.name}</td>
                  <td><button className="text-btn" onClick={() => cycleLoc(r)} title="눌러서 근무지 바꾸기">{r.loc || "미정"}</button></td>
                  <td>{r.team || "-"}</td>
                  <td className="mono">{invites[r.pid] || "-"}</td>
                  <td>{r.uid ? "완료" : "-"}</td>
                  <td><button className="text-btn" onClick={() => removePerson(r)}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function Running() {
  const { config, roster } = useApp();
  const [progress, setProgress] = useState({});
  const [received, setReceived] = useState({});
  const [nudges, setNudges] = useState(new Set());

  useEffect(() => {
    const offs = [
      onSnapshot(collection(db, "progress"), (s) => setProgress(Object.fromEntries(s.docs.map((d) => [d.id, d.data()])))),
      onSnapshot(collection(db, "redemptions"), (s) => {
        const m = {};
        s.docs.forEach((d) => { if (!d.data().voided) m[d.data().receiverPid] = (m[d.data().receiverPid] || 0) + 1; });
        setReceived(m);
      }),
      onSnapshot(collection(db, "nudges"), (s) => setNudges(new Set(s.docs.map((d) => d.id)))),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  const setWeek = (week) => updateDoc(doc(db, "config", "app"), { week });
  const releaseClues = () => updateDoc(doc(db, "config", "app"), { cluesReleased: Math.min(CLUE_COUNT, (config.cluesReleased || 0) + 2) });

  async function toggleNudge(pid) {
    if (nudges.has(pid)) await deleteDoc(doc(db, "nudges", pid));
    else await setDoc(doc(db, "nudges", pid), { at: serverTimestamp() });
  }

  const rows = [...roster].sort((a, b) => (a.team || 0) - (b.team || 0) || a.name.localeCompare(b.name, "ko"));
  const zero = rows.filter((r) => !received[r.pid]);

  return (
    <>
      <Panel title="주차">
        <div className="chip-row">
          {[1, 2, 3].map((w) => <button key={w} className={config.week === w ? "chip is-on" : "chip"} onClick={() => setWeek(w)}>{w}주차</button>)}
        </div>
        <p className="small">주차를 올리면 그 주차 미션이 열려요. 3주차는 칭찬 카드예요.</p>
      </Panel>

      <Panel title={`단서 공개 (${config.cluesReleased || 0} / ${CLUE_COUNT})`}>
        <button className="pk-btn gold" onClick={releaseClues} disabled={(config.cluesReleased || 0) >= CLUE_COUNT}>이번 주 단서 2개 공개</button>
        <p className="small">매주 금요일에 한 번 눌러 주세요. 전원에게 동시에 공개돼요.</p>
      </Panel>

      <Panel title={`받은 인증이 0건인 사람 ${zero.length}명`}>
        <p className="small">알림을 켜면 그 사람의 마니또 화면에 "대상이 기다리고 있어요"가 떠요. 누가 마니또인지는 여기서 보이지 않아요.</p>
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>팀</th><th>이름</th><th>가입</th><th>프로필</th><th>한 미션</th><th>받은 인증</th><th>알림</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pid} className={!received[r.pid] ? "warn" : ""}>
                  <td>{r.team}</td>
                  <td>{r.name}</td>
                  <td>{r.uid ? "O" : "-"}</td>
                  <td>{progress[r.pid]?.profileDone ? "O" : "-"}</td>
                  <td>{progress[r.pid]?.doneCount || 0}</td>
                  <td>{received[r.pid] || 0}</td>
                  <td><button className="text-btn" onClick={() => toggleNudge(r.pid)}>{nudges.has(r.pid) ? "끄기" : "켜기"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function Moderation() {
  const { roster } = useApp();
  const [items, setItems] = useState([]);
  useEffect(() => onSnapshot(collection(db, "redemptions"), (s) =>
    setItems(s.docs.map((d) => ({ code: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)))
  ), []);

  const toggleVoid = (r) => updateDoc(doc(db, "redemptions", r.code), { voided: !r.voided });
  const toggleDq = (r) => {
    if (!r.disqualified && !window.confirm(`${r.name}님을 응모권·수상에서 제외할까요?`)) return;
    return updateDoc(doc(db, "roster", r.pid), { disqualified: !r.disqualified });
  };

  return (
    <>
      <Panel title="인증 검토">
        <p className="small">내용 없는 인증은 무효 처리하세요. 무효 처리된 인증은 피드와 응모권에서 빠져요.</p>
        <ul className="plain">
          {items.map((r) => (
            <li key={r.code} className={r.voided ? "row-item voided" : "row-item"}>
              <p>{r.review}</p>
              <button className="text-btn" onClick={() => toggleVoid(r)}>{r.voided ? "무효 취소" : "무효 처리"}</button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="수상 제외">
        <p className="small">정체를 미리 알려준 사실이 확인된 경우에만 사용하세요.</p>
        <div className="name-chips">
          {[...roster].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((r) => (
            <button key={r.pid} className={r.disqualified ? "chip is-off" : "chip"} onClick={() => toggleDq(r)}>{r.name}</button>
          ))}
        </div>
      </Panel>
    </>
  );
}

async function readAll(name) {
  const s = await getDocs(collection(db, name));
  return Object.fromEntries(s.docs.map((d) => [d.id, d.data()]));
}

function VotingAdmin() {
  const { byPid } = useApp();
  const [cards, setCards] = useState([]);
  const [evals, setEvals] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const offs = [
      onSnapshot(collection(db, "voteCards"), (s) => setCards(s.docs.map((d) => ({ id: d.id, ...d.data() })))),
      onSnapshot(collection(db, "adminEval"), (s) => setEvals(Object.fromEntries(s.docs.map((d) => [d.id, d.data().score])))),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  async function buildCards() {
    if (cards.length && !window.confirm("투표 카드를 다시 만들까요? 이미 받은 투표와 평가는 무효가 돼요.")) return;
    setBusy(true);
    const [giverCodes, redemptions] = await Promise.all([readAll("giverCodes"), readAll("redemptions")]);
    const ops = cards.map((c) => (b) => { b.delete(doc(db, "voteCards", c.id)); b.delete(doc(db, "cardOwners", c.id)); });
    for (const [giverPid, { codes }] of Object.entries(giverCodes)) {
      const reviews = Object.values(codes).map((c) => redemptions[c]).filter((r) => r && !r.voided).map((r) => r.review);
      const cardId = doc(collection(db, "voteCards")).id;
      ops.push((b) => b.set(doc(db, "voteCards", cardId), { reviews, team: byPid[giverPid]?.team ?? null }));
      ops.push((b) => b.set(doc(db, "cardOwners", cardId), { giverPid }));
    }
    await commitInChunks(ops);
    setBusy(false);
  }

  return (
    <Panel title="투표 카드">
      <p className="small">마니또별로 인증된 후기를 묶어 익명 카드로 만들어요. 운영진 평가(0~10)는 베스트 마니또 점수의 20%예요.</p>
      <button className="pk-btn main" onClick={buildCards} disabled={busy}>{cards.length ? "투표 카드 다시 만들기" : "투표 카드 만들기"}</button>
      <ul className="plain">
        {cards.map((c) => (
          <li key={c.id} className="row-item">
            {c.reviews.length ? c.reviews.map((r, i) => <p key={i}>{r}</p>) : <p className="muted">후기 없음</p>}
            <label className="inline">
              운영진 평가
              <input className="pk-input num" type="number" min={0} max={10} value={evals[c.id] ?? ""} onChange={(e) =>
                setDoc(doc(db, "adminEval", c.id), { score: Math.max(0, Math.min(10, Number(e.target.value))) })} />
            </label>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Scoring() {
  const { roster, nameOf } = useApp();
  const [result, setResult] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const offs = [
      onSnapshot(doc(db, "results", "public"), (s) => setResult(s.exists() ? s.data() : null)),
      onSnapshot(collection(db, "redemptions"), (s) => setReviews(s.docs.map((d) => ({ code: d.id, ...d.data() })).filter((r) => !r.voided))),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  async function compute() {
    setBusy(true);
    const [assignments, giverCodes, redemptions, missions, guesses, votes, owners, evals, deliveries] = await Promise.all(
      ["assignments", "giverCodes", "redemptions", "giverMissions", "guesses", "votes", "cardOwners", "adminEval", "deliveries"].map(readAll)
    );
    const people = roster.map((r) => ({ pid: r.pid, disqualified: Boolean(r.disqualified) }));
    const tickets = computeTickets({
      people,
      assignments: Object.fromEntries(Object.entries(assignments).map(([g, a]) => [g, a.receiverPid])),
      giverCodes: Object.fromEntries(Object.entries(giverCodes).map(([g, c]) => [g, c.codes])),
      redemptions,
      missions,
      guesses: Object.fromEntries(Object.entries(guesses).map(([r, g]) => [r, g.guessPid])),
    });
    const disqualified = new Set(people.filter((p) => p.disqualified).map((p) => p.pid));
    const ranked = rankBestManito({
      cards: Object.entries(owners).map(([cardId, o]) => ({ cardId, giverPid: o.giverPid })),
      votes: Object.fromEntries(Object.entries(votes).map(([v, x]) => [v, x.cardIds || []])),
      adminEval: Object.fromEntries(Object.entries(evals).map(([c, e]) => [c, e.score])),
      tickets,
      disqualified,
    });
    const most = pickMostTickets(tickets);
    const praises = Object.values(deliveries).filter((d) => d.kind === "praise").map((d) => ({ receiverPid: d.receiverPid, message: d.message }));

    await setDoc(doc(db, "results", "public"), {
      pairs: Object.entries(assignments).map(([giverPid, a]) => ({ giverPid, receiverPid: a.receiverPid })),
      tickets: Object.fromEntries(Object.entries(tickets).map(([pid, t]) => [pid, t.total])),
      ticketDetail: tickets,
      bestManito: ranked.slice(0, PRIZES.bestManito.count).map((r) => ({ pid: r.giverPid, score: Math.round(r.score * 1000) / 1000, votes: r.votes })),
      mostTickets: most,
      bestReview: result?.bestReview || null,
      praises,
      draws: result?.draws || {},
      computedAt: serverTimestamp(),
    });
    setBusy(false);
  }

  const pickReview = (r) => updateDoc(doc(db, "results", "public"), { bestReview: { code: r.code, review: r.review, receiverPid: r.receiverPid } });

  return (
    <>
      <Panel title="집계">
        <p className="small">응모권, 베스트 마니또 순위, 최다 응모권상(동점 시 무작위), 칭찬 벽을 계산해요. 다시 누르면 다시 계산돼요(최다 응모권상 동점 추첨도 다시 해요).</p>
        <button className="pk-btn main" onClick={compute} disabled={busy}>{result ? "다시 집계" : "집계하기"}</button>
        {result && (
          <ul className="plain">
            <li>베스트 마니또: {result.bestManito.map((b, i) => `${i + 1}위 ${nameOf(b.pid)}(${b.score})`).join(", ")}</li>
            <li>최다 응모권상: {result.mostTickets ? `${nameOf(result.mostTickets.pid)} ${result.mostTickets.total}장 (동점 ${result.mostTickets.tiedCount}명 중)` : "-"}</li>
          </ul>
        )}
      </Panel>
      {result && (
        <Panel title="베스트 후기상 고르기">
          <ul className="plain">
            {reviews.map((r) => (
              <li key={r.code} className={result.bestReview?.code === r.code ? "row-item picked" : "row-item"}>
                <p>{r.review}</p>
                <span className="small muted">작성: {nameOf(r.receiverPid)}</span>
                <button className="text-btn" onClick={() => pickReview(r)}>{result.bestReview?.code === r.code ? "선택됨" : "이 후기 선택"}</button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
