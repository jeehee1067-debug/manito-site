import { useEffect, useState } from "react";
import {
  arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import Claim from "./Claim.jsx";
import { Panel } from "../ui.jsx";
import { PHASE, PHASES, TEAM_COUNT, CLUE_COUNT, LOCS, PART_HINT_IDX } from "../lib/constants.js";
import { assignManito, assignmentMemo, generateCodes, makeInviteCode, splitTeams } from "../lib/assign.js";
import { computeTickets, pickMostTickets, rankBestManito } from "../lib/scoring.js";
import { PRIZES } from "../config/prizes.js";
import { parseRosterLine, rosterSummary, sameSummary } from "../lib/roster.js";

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

// 운영 화면은 명단 전체(가입 여부·수상 제외 포함)를 쓴다. 참여자 화면은 public/roster 요약만 읽는다.
// 같은 질의는 Firestore가 하나로 묶어서 여러 곳에서 써도 한 번만 읽는다.
function useFullRoster() {
  const [rows, setRows] = useState(null);
  useEffect(() => onSnapshot(collection(db, "roster"), (s) => setRows(s.docs.map((d) => ({ pid: d.id, ...d.data() })))), []);
  return rows;
}

// 초대 코드: { pid: 코드 }
function useInvites() {
  const [invites, setInvites] = useState({});
  useEffect(() => onSnapshot(collection(db, "invites"), (s) => {
    const m = {};
    s.docs.forEach((d) => { m[d.data().personId] = d.id; });
    setInvites(m);
  }), []);
  return invites;
}

// 연결된 계정의 메일: { uid: 메일 } (users 문서는 본인과 운영자만 읽는다)
function useAccountEmails() {
  const [emails, setEmails] = useState({});
  useEffect(() => onSnapshot(collection(db, "users"), (s) =>
    setEmails(Object.fromEntries(s.docs.map((d) => [d.id, d.data().email || ""])))), []);
  return emails;
}

// 연결 해제: 명단의 연결을 풀고, 그 계정의 연결 문서를 지우고, 초대 코드를 새로 만든다.
// 예전 계정은 "연결 전"으로 돌아가 아무것도 못 읽고, 예전 초대 코드도 더는 못 쓴다.
// 그 사람의 프로필·미션·인증 기록은 명단 번호(pid)에 붙어 있어서, 새 코드로 다시 연결하면 그대로 이어진다.
async function unlinkPerson(r, oldCode, email) {
  if (!r.uid) return null;
  if (!window.confirm(`${r.name}님의 계정 연결을 풀까요?\n연결된 메일: ${email || "(모름)"}\n\n이 계정은 더 이상 ${r.name}님으로 들어올 수 없고, 초대 코드가 새로 바뀌어요. 새 코드를 본인에게 전달하면 새 계정(또는 같은 계정)으로 다시 연결할 수 있어요. 기록(프로필·미션·인증)은 그대로 남아요.`)) return null;
  const code = makeInviteCode();
  const b = writeBatch(db);
  b.update(doc(db, "roster", r.pid), { uid: null });
  b.delete(doc(db, "users", r.uid));
  if (oldCode) b.delete(doc(db, "invites", oldCode));
  b.set(doc(db, "invites", code), { personId: r.pid });
  await b.commit();
  return code;
}

// 명단이 요약과 다르면 요약 문서를 다시 쓴다(명단 추가·삭제·근무지·팀 변경 후 자동).
async function publishRoster(rows) {
  await setDoc(doc(db, "public", "roster"), { people: rosterSummary(rows), at: serverTimestamp() });
}

export default function Admin() {
  const { config, myPid, roster: summaryList, rosterReady } = useApp();
  const phase = config.phase;
  const fullRoster = useFullRoster();

  useEffect(() => {
    if (!fullRoster || !rosterReady) return;
    const current = Object.fromEntries(summaryList.map(({ pid, ...p }) => [pid, p]));
    if (!sameSummary(rosterSummary(fullRoster), current)) publishRoster(fullRoster).catch(() => {});
  }, [fullRoster, summaryList, rosterReady]);

  async function advance() {
    // 미션 시작 전: 가입 안 한 사람이 있으면 그 사람의 마니또는 인증을 받을 수 없어 미션 응모권이 0장이 된다.
    const unjoined = phase === PHASE.SETUP && fullRoster ? fullRoster.filter((r) => !r.uid) : [];
    const warn = unjoined.length
      ? `\n\n⚠ 아직 가입 안 한 사람 ${unjoined.length}명: ${unjoined.map((r) => r.name).join(", ")}\n이 사람들의 마니또는 인증을 받을 수 없어요. 참여하지 않을 사람이면 명단에서 지우고 다시 배정한 뒤 시작하세요.`
      : "";
    if (!window.confirm(`${PHASES[phase]} → ${PHASES[phase + 1]}\n\n${NEXT_PHASE_NOTE[phase]}${warn}\n\n되돌릴 수 없어요. 진행할까요?`)) return;
    if (phase === PHASE.SETUP && fullRoster) await publishRoster(fullRoster);
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

      <Notice />

      {phase === PHASE.SETUP && <Setup />}
      {phase === PHASE.RUNNING && <Running />}
      {phase === PHASE.GUESSING && <GuessStatus />}
      {phase >= PHASE.RUNNING && phase <= PHASE.SCORING && <Moderation />}
      {phase === PHASE.VOTING && <VotingAdmin />}
      {phase === PHASE.SCORING && <Scoring />}
      {phase >= PHASE.RUNNING && <Accounts />}
      <CoAdmins />
      {phase === PHASE.REVEAL && <Panel title="공개"><p>결과 탭에서 추첨을 진행하세요.</p></Panel>}
    </>
  );
}

// 공지: 모든 참여자 화면 위쪽에 보인다. 마감 날짜, 이번 주 할 일 같은 안내에 쓴다.
function Notice() {
  const { config } = useApp();
  const [text, setText] = useState(config.notice || "");
  const [saved, setSaved] = useState(false);
  useEffect(() => setText(config.notice || ""), [config.notice]);
  const save = async (value) => {
    await updateDoc(doc(db, "config", "app"), { notice: value.trim() });
    setSaved(true);
  };
  return (
    <Panel title="공지">
      <p className="small">모든 참여자 화면 위쪽에 보여요. 예: "1주차 미션은 금요일까지! 받은 미션은 추리 보드에서 인증해 주세요."</p>
      <textarea className="pk-input" rows={2} maxLength={200} value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} placeholder="공지 내용 (200자까지)" aria-label="공지 내용" />
      <div className="inline">
        <button className="pk-btn main sm" onClick={() => save(text)}>공지 올리기</button>
        {config.notice && <button className="pk-btn sm" onClick={() => save("")}>공지 내리기</button>}
        {saved && <span className="note small" role="status">{config.notice ? "올렸어요." : "내렸어요."}</span>}
      </div>
    </Panel>
  );
}

// 공동 운영자: 운영자가 자리를 비워도 주차 올리기·단서 공개·단계 넘기기를 다른 사람이 할 수 있게 한다.
// 공동 운영자는 운영자와 권한이 같다(투표 단계부터 짝 정보도 볼 수 있다).
function CoAdmins() {
  const { config, user } = useApp();
  const roster = useFullRoster() || [];
  const admins = config.admins || [];
  const linked = roster.filter((r) => r.uid).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const others = admins.filter((uid) => !linked.some((r) => r.uid === uid)).length; // 참여하지 않는 운영자 계정 수

  async function toggle(r) {
    const isAdmin = admins.includes(r.uid);
    if (isAdmin && r.uid === user.uid) return window.alert("내 운영자 권한은 여기서 뺄 수 없어요. 다른 운영자에게 부탁하세요.");
    const ask = isAdmin
      ? `${r.name}님의 운영자 권한을 뺄까요?`
      : `${r.name}님을 공동 운영자로 지정할까요?\n\n운영 탭의 모든 기능(주차·단서 공개, 단계 넘기기, 인증 무효, 집계·추첨)을 쓸 수 있고, 투표 단계부터는 짝 정보도 볼 수 있어요.`;
    if (!window.confirm(ask)) return;
    await updateDoc(doc(db, "config", "app"), { admins: isAdmin ? arrayRemove(r.uid) : arrayUnion(r.uid) });
  }

  return (
    <Panel title={`공동 운영자 (운영자 ${admins.length}명)`}>
      <p className="small">
        운영자가 자리를 비워도 진행이 멈추지 않게 한 명 이상 더 지정해 두는 것을 권해요. 가입한 사람만 지정할 수 있어요.
        {others > 0 && ` 참여하지 않는 운영자 계정 ${others}개는 아래에 나오지 않아요.`}
      </p>
      <div className="name-chips">
        {linked.map((r) => (
          <button key={r.pid} className={admins.includes(r.uid) ? "chip is-on" : "chip"} aria-pressed={admins.includes(r.uid)} onClick={() => toggle(r)}>{r.name}</button>
        ))}
        {linked.length === 0 && <span className="muted small">아직 가입한 사람이 없어요.</span>}
      </div>
    </Panel>
  );
}

function Setup() {
  const { config } = useApp();
  const full = useFullRoster();
  const roster = full || [];
  const loaded = full !== null; // 명단을 다 읽기 전에 추가하면 번호(p001…)가 겹칠 수 있다
  const [text, setText] = useState("");
  const invites = useInvites();
  const emails = useAccountEmails();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [siteMode, setSiteMode] = useState("any");


  async function addPeople() {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const start = roster.reduce((m, r) => Math.max(m, Number(r.pid.slice(1)) || 0), 0);
    const ops = [];
    const bad = [];
    lines.forEach((line, i) => {
      // "이름,근무지,파트" 또는 "이름,근무지,파트,팀번호" — 근무지·파트·팀은 생략 가능
      const { name, loc, part, team, badLoc } = parseRosterLine(line, LOCS);
      if (badLoc) bad.push(`${name}(${badLoc})`);
      const pid = `p${String(start + i + 1).padStart(3, "0")}`;
      const invite = makeInviteCode();
      ops.push((b) => b.set(doc(db, "roster", pid), { name, loc, part, team, uid: null, disqualified: false }));
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
    if (r.uid) return window.alert("이미 가입한 사람은 지울 수 없어요. 먼저 연결 해제하세요.");
    if (!window.confirm(`${r.name}님을 명단에서 지울까요?`)) return;
    await deleteDoc(doc(db, "roster", r.pid));
    if (invites[r.pid]) await deleteDoc(doc(db, "invites", invites[r.pid]));
  }

  async function cycleLoc(r) {
    const next = LOCS[(LOCS.indexOf(r.loc) + 1) % LOCS.length];
    await updateDoc(doc(db, "roster", r.pid), { loc: next });
  }

  async function editPart(r) {
    const next = window.prompt(`${r.name}님의 파트 (비우면 파트 없음)`, r.part || "");
    if (next === null) return;
    await updateDoc(doc(db, "roster", r.pid), { part: next.trim() || null });
    if (config.assignVer) setMsg("파트를 바꿨어요. 이미 배정한 뒤라면 '배정하기'를 다시 눌러야 파트 단서에 반영돼요.");
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
      // 파트 단서: 받는 사람마다 "내 마니또의 파트"를 단서 7번째 칸에 써 둔다. 최종 지목 단계가 열리면 받는 사람에게만 공개된다
      // (운영자는 단서를 읽을 수 없다). 본인이 쓰는 답이 아니라 거짓·대충이 없고, 마니또가 접속을 안 해도 나간다.
      const newVer = (config.assignVer ?? 0) + 1;
      const partOf = Object.fromEntries(roster.map((r) => [r.pid, (r.part || "").trim()]));
      for (const { giverPid, receiverPid } of pairs) {
        if (!partOf[giverPid]) continue;
        ops.push((b) => b.set(doc(db, "clues", `${receiverPid}_${PART_HINT_IDX}`), {
          receiverPid, idx: PART_HINT_IDX, answer: partOf[giverPid], ver: newVer,
        }));
      }
      ops.push((b) => b.set(metaRef, { ...assignmentMemo(pairs, codes), at: serverTimestamp() }));
      await commitInChunks(ops);
      // 추리 보드가 후보를 줄일 때 쓰는 값 (짝 정보는 아님)
      // 배정 회차를 올린다(배정 문서를 다 쓴 뒤에). 지난 회차 단서는 보안 규칙이 읽지 못하게 하고,
      // 각 마니또가 앱을 열 때 새 대상에게 단서를 다시 보낸다.
      await updateDoc(doc(db, "config", "app"), { siteMatched, teamExcluded, assignVer: newVer });
      const noPart = roster.filter((r) => !partOf[r.pid]).length;
      setMsg(`${pairs.length}명 배정 완료.` + (noPart && noPart < roster.length ? ` 파트가 비어 있는 ${noPart}명이 마니또인 경우는 파트 단서가 나가지 않아요.` : "") + (warnings.length ? " " + warnings.join(" ") : siteMatched ? " 같은 근무지·다른 팀으로, 맞마니또 없이 짝지었어요." : " 다른 팀끼리, 맞마니또 없이 짝지었어요. 근무지가 다른 짝은 원격 미션 카드가 나와요."));
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...roster].sort((a, b) => a.pid.localeCompare(b.pid));
  const partCount = {};
  for (const r of roster) if (r.part) partCount[r.part] = (partCount[r.part] || 0) + 1;
  const parts = Object.entries(partCount).sort((a, b) => b[1] - a[1]);
  const inviteText = sorted.map((r) => `${r.name}\t${invites[r.pid] || ""}`).join("\n");

  return (
    <>
      <Panel title="1. 명단">
        <p className="small">
          한 줄에 한 명, "이름,근무지,파트" 형식. 팀까지 직접 정하려면 "이름,근무지,파트,팀번호".
          파트를 넣으면 최종 지목이 열릴 때 "내 마니또는 ○○ 소속" 단서가 자동으로 나가요.
        </p>
        <textarea className="pk-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"홍길동,SR3,공정파트\n김철수,S1L,소자파트"} />
        <button className="pk-btn main" onClick={addPeople} disabled={busy || !loaded}>명단에 추가</button>
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
        <p className="small">
          {parts.length
            ? <>파트 단서: {parts.map(([name, n]) => `${name} ${n}명`).join(" · ")}{roster.length - parts.reduce((a, [, n]) => a + n, 0) > 0 && ` · 파트 없음 ${roster.length - parts.reduce((a, [, n]) => a + n, 0)}명`}.
              {parts.some(([, n]) => n < 6) && " 인원이 적은 파트는 파트 단서만으로 마니또가 거의 드러나요."} 배정한 뒤 파트를 고쳤다면 다시 배정해야 반영돼요.</>
            : "파트가 입력되지 않아 파트 단서는 나가지 않아요(명단 표의 파트 칸을 눌러 넣을 수 있어요)."}
        </p>
        <button className="pk-btn main" onClick={assign} disabled={busy || roster.length < 3}>배정하기</button>
      </Panel>

      {msg && <p className="note banner" role="status">{msg}</p>}

      <Panel title={`명단 ${roster.length}명`}>
        <button className="pk-btn sm" onClick={() => navigator.clipboard.writeText(inviteText)}>이름과 초대 코드 복사</button>
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>이름</th><th>근무지</th><th>파트</th><th>팀</th><th>초대 코드</th><th>연결된 메일</th><th></th></tr></thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.pid}>
                  <td>{r.name}</td>
                  <td><button className="text-btn" onClick={() => cycleLoc(r)} title="눌러서 근무지 바꾸기">{r.loc || "미정"}</button></td>
                  <td><button className="text-btn" onClick={() => editPart(r)} title="눌러서 파트 바꾸기">{r.part || "미정"}</button></td>
                  <td>{r.team || "-"}</td>
                  <td className="mono">{invites[r.pid] || "-"}</td>
                  <td className="email">{r.uid ? emails[r.uid] || "연결됨" : "-"}</td>
                  <td>
                    {r.uid
                      ? <button className="text-btn" onClick={async () => { const c = await unlinkPerson(r, invites[r.pid], emails[r.uid]); if (c) setMsg(`${r.name}님 연결을 풀었어요. 새 초대 코드: ${c}`); }}>연결 해제</button>
                      : <button className="text-btn" onClick={() => removePerson(r)}>삭제</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

// 최근 접속 표시: 오늘이면 "오늘", 아니면 "n일 전"
function seenText(ts) {
  if (!ts?.toDate) return "-";
  const days = Math.floor((Date.now() - ts.toDate().getTime()) / 86400000);
  return days <= 0 ? "오늘" : `${days}일 전`;
}

function Running() {
  const { config } = useApp();
  const roster = useFullRoster() || [];
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
        <p className="small">
          알림을 켜면 그 사람의 마니또 화면에 "대상이 기다리고 있어요"가 떠요. 누가 마니또인지는 여기서 보이지 않아요.
          받은 인증이 0건인 이유는 마니또가 아직 안 했거나, 본인이 받은 미션을 인증하지 않은 것 둘 중 하나예요. 최근 접속이 오래된 사람은 따로 알려 주세요.
        </p>
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>팀</th><th>이름</th><th>가입</th><th>최근 접속</th><th>프로필</th><th>한 미션</th><th>받은 인증</th><th>알림</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pid} className={!received[r.pid] ? "warn" : ""}>
                  <td>{r.team}</td>
                  <td>{r.name}</td>
                  <td>{r.uid ? "O" : "-"}</td>
                  <td>{seenText(progress[r.pid]?.lastSeen)}</td>
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

// 계정 연결 관리(미션 시작 후). 엉뚱한 사람이 연결됐거나, 메일을 잘못 적었거나, 비밀번호를 못 찾을 때 연결을 푼다.
function Accounts() {
  const roster = useFullRoster() || [];
  const invites = useInvites();
  const emails = useAccountEmails();
  const [msg, setMsg] = useState("");
  const rows = [...roster].sort((a, b) => (a.team || 0) - (b.team || 0) || a.name.localeCompare(b.name, "ko"));
  return (
    <Panel title="계정 연결">
      <p className="small">
        이름마다 연결된 메일이 보여요. 다른 사람이 연결됐거나 메일·비밀번호 문제로 새 계정을 써야 하면 "연결 해제"를 누르고, 새로 나온 초대 코드를 본인에게 전달하세요. 기록은 그대로 이어져요.
      </p>
      {msg && <p className="note" role="status">{msg}</p>}
      <div className="table-wrap">
        <table className="pk-table">
          <thead><tr><th>팀</th><th>이름</th><th>초대 코드</th><th>연결된 메일</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pid} className={r.uid ? "" : "warn"}>
                <td>{r.team}</td>
                <td>{r.name}</td>
                <td className="mono">{invites[r.pid] || "-"}</td>
                <td className="email">{r.uid ? emails[r.uid] || "연결됨" : "미연결"}</td>
                <td>{r.uid && (
                  <button className="text-btn" onClick={async () => { const c = await unlinkPerson(r, invites[r.pid], emails[r.uid]); if (c) setMsg(`${r.name}님 연결을 풀었어요. 새 초대 코드: ${c}`); }}>연결 해제</button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// 최종 지목 단계: 누가 지목했는지만 보인다(누구를 지목했는지는 투표 단계 전까지 운영자도 못 읽음).
// 지목을 안 하면 그 사람의 마니또가 은신 응모권 2장을 자동으로 받는다.
function GuessStatus() {
  const roster = useFullRoster() || [];
  const [progress, setProgress] = useState({});
  useEffect(() => onSnapshot(collection(db, "progress"), (s) => setProgress(Object.fromEntries(s.docs.map((d) => [d.id, d.data()])))), []);
  const rows = [...roster].filter((r) => r.uid).sort((a, b) => (a.team || 0) - (b.team || 0) || a.name.localeCompare(b.name, "ko"));
  const notYet = rows.filter((r) => !progress[r.pid]?.guessed);
  return (
    <Panel title={`최종 지목 중 (안 한 사람 ${notYet.length}명)`}>
      <p className="small">누구를 지목했는지는 투표 단계부터 집계 화면에서 볼 수 있어요. 지목을 안 하면 그 사람의 마니또가 은신 응모권 2장을 받아요.</p>
      {notYet.length > 0 && <p className="note">아직 안 한 사람: {notYet.map((r) => r.name).join(", ")}</p>}
      <div className="table-wrap">
        <table className="pk-table">
          <thead><tr><th>팀</th><th>이름</th><th>지목</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pid} className={progress[r.pid]?.guessed ? "" : "warn"}>
                <td>{r.team}</td><td>{r.name}</td><td>{progress[r.pid]?.guessed ? "O" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Moderation() {
  const roster = useFullRoster() || [];
  const [items, setItems] = useState([]);
  useEffect(() => onSnapshot(collection(db, "redemptions"), (s) =>
    setItems(s.docs.map((d) => ({ code: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)))
  ), []);

  const toggleVoid = (r) => updateDoc(doc(db, "redemptions", r.code), { voided: !r.voided });
  const toggleDq = (r) => {
    if (!r.disqualified && !window.confirm(`${r.name}님을 응모권·수상에서 제외할까요?`)) return;
    return updateDoc(doc(db, "roster", r.pid), { disqualified: !r.disqualified });
  };
  const toggleDropout = (r) => {
    if (!r.dropout && !window.confirm(`${r.name}님을 중도 이탈로 표시할까요?\n\n· ${r.name}님은 응모권 0장(추첨 제외)\n· ${r.name}님의 마니또가 완료를 알린 미션은 인증된 것으로 인정\n· ${r.name}님이 맡은 사람은 못 받은 주차만큼 응모권 보상\n\n집계 전에는 언제든 되돌릴 수 있어요.`)) return;
    return updateDoc(doc(db, "roster", r.pid), { dropout: !r.dropout });
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
        <p className="small">정체를 미리 알려준 사실 등 규칙 위반이 확인된 경우에만 사용하세요. 줄이 그어진 사람이 제외된 사람이에요.</p>
        <div className="name-chips">
          {[...roster].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((r) => (
            <button key={r.pid} className={r.disqualified ? "chip is-off" : "chip"} aria-pressed={Boolean(r.disqualified)} onClick={() => toggleDq(r)}>{r.name}</button>
          ))}
        </div>
      </Panel>
      <Panel title="중도 이탈">
        <p className="small">
          휴직·이동 등으로 더 참여할 수 없게 된 사람을 표시하세요(줄이 그어진 사람). 본인은 추첨에서 빠지고,
          그 사람의 마니또와 그 사람이 맡은 사람은 손해 보지 않게 집계돼요. 가입하지 않은 사람은 표시하지 않아도 같은 방식으로 처리돼요.
        </p>
        <div className="name-chips">
          {[...roster].sort((a, b) => a.name.localeCompare(b.name, "ko")).map((r) => (
            <button key={r.pid} className={r.dropout ? "chip is-off" : "chip"} aria-pressed={Boolean(r.dropout)} onClick={() => toggleDropout(r)}>{r.name}{!r.uid && " (미가입)"}</button>
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

// 집계 전 확인: 마니또가 완료를 알렸는데 받는 사람이 인증하지 않은 미션.
// 그대로 두면 그 마니또는 미션 응모권을 못 받고, 인증이 하나도 없으면 은신·보상 자격도 없다(상대방 때문에 생기는 손해).
// 운영자가 본인에게 확인한 뒤 "마니또 미션 인정"을 누르면, 인증 기록이 없는 완료 알림을 인증된 것으로 쳐 준다.
// 가입 안 한 사람과 중도 이탈로 표시한 사람은 누르지 않아도 인정된다. (쪽지·짝 정보는 집계 단계부터 운영자가 읽을 수 있다)
function Unredeemed({ roster }) {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.all([readAll("deliveries"), readAll("redemptions")]).then(([deliveries, redemptions]) => {
      const sent = {};
      const got = {};
      Object.values(deliveries).forEach((d) => (sent[d.receiverPid] ||= new Set()).add(d.slot));
      Object.values(redemptions).forEach((r) => (got[r.receiverPid] ||= new Set()).add(r.slot));
      const list = Object.entries(sent)
        .map(([pid, slots]) => ({ pid, sent: slots.size, missing: [...slots].filter((slot) => !got[pid]?.has(slot)).length }))
        .filter((x) => x.missing > 0);
      if (alive) setRows(list);
    }).catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, []);

  const byPid = Object.fromEntries(roster.map((r) => [r.pid, r]));
  const toggle = (r) => updateDoc(doc(db, "roster", r.pid), { creditGiver: !r.creditGiver });
  if (!rows) return null;

  return (
    <Panel title={`집계 전 확인: 받고도 인증하지 않은 사람 ${rows.length}명`}>
      <p className="small">
        마니또가 미션 완료를 알렸는데 인증하지 않은 사람이에요. 그대로 두면 그 사람의 마니또가 응모권을 못 받아요.
        본인에게 실제로 받았는지 확인한 뒤 "마니또 미션 인정"을 누르면, 인증 안 된 완료 알림을 인증된 것으로 쳐요(본인의 인증 입력 응모권은 생기지 않아요).
        가입 안 한 사람과 중도 이탈은 누르지 않아도 인정돼요.
      </p>
      {rows.length === 0 ? <p className="muted">해당하는 사람이 없어요.</p> : (
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>이름</th><th>받은 완료 알림</th><th>미인증</th><th>처리</th></tr></thead>
            <tbody>
              {rows.map((x) => {
                const r = byPid[x.pid];
                if (!r) return null;
                const auto = !r.uid ? "미가입 (자동 인정)" : r.dropout ? "중도 이탈 (자동 인정)" : null;
                return (
                  <tr key={x.pid}>
                    <td>{r.name}</td><td>{x.sent}건</td><td>{x.missing}건</td>
                    <td>{auto || <button className="text-btn" aria-pressed={Boolean(r.creditGiver)} onClick={() => toggle(r)}>{r.creditGiver ? "인정함 (취소)" : "마니또 미션 인정"}</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function Scoring() {
  const { nameOf } = useApp();
  const fullRoster = useFullRoster();
  const roster = fullRoster || [];
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
    const people = roster.map((r) => ({
      pid: r.pid, disqualified: Boolean(r.disqualified), joined: Boolean(r.uid), dropout: Boolean(r.dropout), creditGiver: Boolean(r.creditGiver),
    }));
    const tickets = computeTickets({
      deliveries: Object.values(deliveries).map((d) => ({ receiverPid: d.receiverPid, slot: d.slot })),
      people,
      assignments: Object.fromEntries(Object.entries(assignments).map(([g, a]) => [g, a.receiverPid])),
      giverCodes: Object.fromEntries(Object.entries(giverCodes).map(([g, c]) => [g, c.codes])),
      redemptions,
      missions,
      guesses: Object.fromEntries(Object.entries(guesses).map(([r, g]) => [r, g.guessPid])),
    });
    // 수상 제외·불참(가입 안 함, 중도 이탈)은 베스트 마니또에서도 뺀다
    const disqualified = new Set(people.filter((p) => p.disqualified || !p.joined || p.dropout).map((p) => p.pid));
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
      <Unredeemed roster={roster} />
      <Panel title="집계">
        <p className="small">
          응모권, 베스트 마니또 순위, 최다 응모권상, 칭찬 벽을 계산해요. 수상 제외·중도 이탈 표시를 먼저 끝내고 누르세요.
          다시 누르면 다시 계산돼요(동점을 무작위로 가른 것도 다시 뽑아요).
        </p>
        <button className="pk-btn main" onClick={compute} disabled={busy || !fullRoster}>{result ? "다시 집계" : "집계하기"}</button>
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
