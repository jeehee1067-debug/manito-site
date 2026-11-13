import { useEffect, useMemo, useState } from "react";
import {
  arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc, writeBatch,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import { Panel } from "../ui.jsx";
import { PHASE, PHASES, CLUE_COUNT, LEVEL_LABEL, LOCS, PART_HINT_IDX, RULES_VERSION } from "../lib/constants.js";
import { SLOT_STATUS_LABEL, pairRows, receiverCodesOf, sameCodes, unresolvedSlots } from "../lib/pairs.js";
import { assignManito, assignmentMemo, generateCodes, makeInviteCode } from "../lib/assign.js";
import { computeTickets, partStandings, pickMostTickets, rankBestManito, weeklyPartBoard } from "../lib/scoring.js";
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
  1: "미션 진행을 마감하고 최종 지목을 받습니다. 이후 인증·미션 완료는 막혀요. 파트 순위도 지금 숫자로 마지막 발표를 해요.",
  2: "지목을 마감하고 투표를 엽니다. 넘어간 뒤 '투표 카드 만들기'를 눌러 주세요.",
  3: "투표를 마감하고 집계 단계로 넘어갑니다.",
  4: "결과를 전원에게 공개합니다. 넘어간 뒤에는 다시 집계할 수 없어요.",
};

// 컬렉션 전체를 구독해 { 문서ID: 값 }으로 돌려준다(불러오기 전에는 null). 운영 화면 전용.
// 운영자는 참여하지 않는 계정이라 짝·진행·지목을 언제든 읽는다(보안 규칙).
// 같은 질의는 Firestore가 하나로 묶어서 여러 패널에서 써도 한 번만 읽는다.
function useColl(name) {
  const [map, setMap] = useState(null);
  useEffect(() => onSnapshot(collection(db, name),
    (s) => setMap(Object.fromEntries(s.docs.map((d) => [d.id, d.data()]))),
    () => setMap({})), [name]);
  return map;
}

// 짝 현황: 마니또별 주차 상태와 지목. "짝 현황" 표와 "받은 게 없어요 확인" 표가 같이 쓴다.
function usePairs() {
  const assignments = useColl("assignments");
  const giverCodes = useColl("giverCodes");
  const missions = useColl("giverMissions");
  const redemptions = useColl("redemptions");
  const reports = useColl("reports");
  const verdicts = useColl("verdicts");
  const guesses = useColl("guesses");
  const ready = [assignments, giverCodes, missions, redemptions, reports, verdicts, guesses].every(Boolean);
  const rows = useMemo(
    () => (ready ? pairRows({ assignments, giverCodes, missions, redemptions, reports, verdicts, guesses }) : []),
    [ready, assignments, giverCodes, missions, redemptions, reports, verdicts, guesses]
  );
  return { ready, rows, assignments, giverCodes };
}

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

// 명단이 요약과 다르면 요약 문서를 다시 쓴다(명단 추가·삭제·근무지·파트 변경 후 자동).
// 파트 순위 발표(public/board). 실시간으로 올리지 않고 운영자가 누를 때만 쓴다
// (실시간이면 미션을 받은 직후 어느 파트 숫자가 올랐는지로 마니또의 파트가 드러난다).
// roster: 명단 전체, progress: { pid: { doneCount } }, week: 열린 주차. 반환: 순위에 든 파트 수
async function publishPartBoard(roster, progress, week) {
  const w = Math.min(3, Math.max(1, week || 1));
  const people = roster.map((r) => ({ pid: r.pid, part: (r.part || "").trim() || null, joined: Boolean(r.uid), dropout: Boolean(r.dropout) }));
  const doneCounts = Object.fromEntries(Object.entries(progress).map(([pid, p]) => [pid, p.doneCount || 0]));
  const parts = weeklyPartBoard(people, doneCounts, w).map(({ part, members, done, max }) => ({ part, members, done, max }));
  await setDoc(doc(db, "public", "board"), { week: w, at: serverTimestamp(), parts });
  return parts.length;
}

async function publishRoster(rows) {
  await setDoc(doc(db, "public", "roster"), { people: rosterSummary(rows), at: serverTimestamp() });
}

export default function Admin() {
  const { config, roster: summaryList, rosterReady } = useApp();
  const phase = config.phase;
  const fullRoster = useFullRoster();
  const [stepMsg, setStepMsg] = useState("");

  useEffect(() => {
    if (!fullRoster || !rosterReady) return;
    const current = Object.fromEntries(summaryList.map(({ pid, ...p }) => [pid, p]));
    if (!sameSummary(rosterSummary(fullRoster), current)) publishRoster(fullRoster).catch(() => {});
  }, [fullRoster, summaryList, rosterReady]);

  async function advance() {
    setStepMsg("");
    // 집계 없이 공개 단계로 넘어가면 결과 화면이 비고 추첨도 할 수 없다(보안 규칙도 막는다).
    if (phase === PHASE.SCORING) {
      const res = await getDoc(doc(db, "results", "public")).catch(() => null);
      if (!res?.exists()) return setStepMsg("아직 집계하지 않았어요. 아래 '집계하기'를 먼저 눌러 주세요. 집계 결과가 있어야 공개 단계로 넘어갈 수 있어요.");
    }
    // 미션 시작 전: 가입 안 한 사람이 있으면 그 사람의 마니또는 인증을 받을 수 없어 미션 응모권이 0장이 된다.
    const unjoined = phase === PHASE.SETUP && fullRoster ? fullRoster.filter((r) => !r.uid) : [];
    const warn = unjoined.length
      ? `\n\n⚠ 아직 가입 안 한 사람 ${unjoined.length}명: ${unjoined.map((r) => r.name).join(", ")}\n이 사람들의 마니또는 인증을 받을 수 없어요. 참여하지 않을 사람이면 명단에서 지우고 다시 배정한 뒤 시작하세요.`
      : "";
    if (!window.confirm(`${PHASES[phase]} → ${PHASES[phase + 1]}\n\n${NEXT_PHASE_NOTE[phase]}${warn}\n\n되돌릴 수 없어요. 진행할까요?`)) return;
    if (phase === PHASE.SETUP && fullRoster) await publishRoster(fullRoster);
    // 미션을 마감할 때 파트 순위를 마지막으로 한 번 더 발표한다(마감 뒤에는 숫자가 더 바뀌지 않는다). 실패해도 단계는 넘긴다.
    if (phase === PHASE.RUNNING && fullRoster) await readAll("progress").then((pr) => publishPartBoard(fullRoster, pr, config.week)).catch(() => {});
    try {
      await updateDoc(doc(db, "config", "app"), { phase: phase + 1 });
    } catch {
      setStepMsg("단계를 넘기지 못했어요. 잠시 뒤 다시 눌러 주세요. 계속 안 되면 Firebase 콘솔의 보안 규칙이 최신인지 확인해 주세요.");
    }
  }

  return (
    <>
      <RulesCheck />
      <Panel title="운영 단계">
        <div className="phase-bar">
          {PHASES.map((p, i) => <span key={p} className={i === phase ? "on" : i < phase ? "past" : ""}>{p}</span>)}
        </div>
        {phase < PHASE.REVEAL && <button className="pk-btn red" onClick={advance}>다음 단계로: {PHASES[phase + 1]}</button>}
        {stepMsg && <p className="error" role="alert">{stepMsg}</p>}
      </Panel>

      <Notice />

      {phase === PHASE.SETUP && <Setup />}
      {phase === PHASE.RUNNING && <Running />}
      {phase === PHASE.GUESSING && <GuessStatus />}
      {phase >= PHASE.RUNNING && phase <= PHASE.VOTING && <Unresolved />}
      <Pairs />
      {phase >= PHASE.RUNNING && phase <= PHASE.SCORING && <Moderation />}
      {phase === PHASE.VOTING && <VotingAdmin />}
      {phase === PHASE.SCORING && <Scoring />}
      {phase >= PHASE.RUNNING && <Accounts />}
      <CoAdmins />
      {phase === PHASE.REVEAL && <Panel title="공개"><p>결과 탭에서 추첨을 진행하세요.</p></Panel>}
    </>
  );
}

// 콘솔에 게시된 보안 규칙이 이 화면이 기대하는 버전인지 확인한다. 규칙은 코드와 따로(콘솔에서 손으로) 게시하기 때문에
// 게시를 잊으면 인증·피드 같은 기록이 통째로 거부된다. 규칙이 예전 것이면 rulesVersion 문서 읽기가 거부된다.
function RulesCheck() {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    getDoc(doc(db, "rulesVersion", RULES_VERSION)).then(() => setStale(false), (err) => setStale(err?.code === "permission-denied"));
  }, []);
  if (!stale) return null;
  return (
    <p className="error banner" role="alert">
      ⚠ Firebase 콘솔에 게시된 보안 규칙이 지금 사이트와 맞지 않아요(예전 규칙). 저장소의 <code>firestore.rules</code> 내용을
      콘솔 → Firestore Database → 규칙에 붙여 넣고 "게시"를 눌러 주세요. 게시하기 전에는 인증, 피드, 짝 현황이 동작하지 않아요.
    </p>
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
// 운영자와 공동 운영자는 참여하지 않는 계정이다. 명단에 연결된 계정(참여자)은 지정할 수 없고(보안 규칙),
// 운영자 계정은 초대 코드로 명단에 연결할 수 없다. 그래서 짝·진행·지목을 언제든 봐도 된다.
// 지정 방법: 그 사람이 계정을 만들고(주소 끝에 ?setup) 로그인하면 "연결 전" 화면에 계정 번호가 나온다. 그 번호를 여기에 넣는다.
function CoAdmins() {
  const { config, user } = useApp();
  const roster = useFullRoster() || [];
  const admins = config.admins || [];
  const notes = config.adminNotes || {};
  const [uid, setUid] = useState("");
  const [memo, setMemo] = useState("");
  const [msg, setMsg] = useState("");
  // 예전 방식(참여자를 공동 운영자로 지정)으로 남아 있는 계정. 참여자가 짝을 볼 수 있게 되므로 정리해야 한다.
  const linkedAdmins = roster.filter((r) => r.uid && admins.includes(r.uid));

  async function add(e) {
    e.preventDefault();
    const id = uid.trim();
    if (!/^[A-Za-z0-9]{20,40}$/.test(id)) return setMsg("계정 번호를 다시 확인해 주세요. 지정할 사람의 '연결 전' 화면에 나오는 글자를 그대로 붙여 넣으면 돼요.");
    if (admins.includes(id)) return setMsg("이미 운영자인 계정이에요.");
    const who = roster.find((r) => r.uid === id);
    if (who) return setMsg(`${who.name}님으로 명단에 연결된 계정이에요. 참여자는 운영자가 될 수 없어요(운영자는 짝을 볼 수 있어서요). 참여하지 않는 별도 계정을 지정해 주세요.`);
    const label = memo.trim() || "공동 운영자";
    if (!window.confirm(`이 계정을 공동 운영자로 지정할까요?\n\n메모: ${label}\n계정 번호: ${id}\n\n운영 탭의 모든 기능을 쓸 수 있고, 누가 누구의 마니또인지와 진행 상황·지목을 볼 수 있어요. 이 계정은 마니또에 참여할 수 없어요.`)) return;
    try {
      await updateDoc(doc(db, "config", "app"), { admins: arrayUnion(id), [`adminNotes.${id}`]: label });
      setUid("");
      setMemo("");
      setMsg(`공동 운영자로 지정했어요(${label}). 그 계정 화면이 운영 화면으로 바뀌어요.`);
    } catch {
      setMsg("지정하지 못했어요. 명단에 연결된 계정은 운영자가 될 수 없어요.");
    }
  }

  async function remove(id) {
    if (id === user.uid) return window.alert("내 운영자 권한은 여기서 뺄 수 없어요. 다른 운영자에게 부탁하세요.");
    if (!window.confirm(`${notes[id] || "이 계정"}의 운영자 권한을 뺄까요?`)) return;
    await updateDoc(doc(db, "config", "app"), { admins: arrayRemove(id), [`adminNotes.${id}`]: deleteField() });
    setMsg("운영자 권한을 뺐어요.");
  }

  return (
    <Panel title={`공동 운영자 (운영자 ${admins.length}명)`}>
      <p className="small">
        운영자가 자리를 비워도 진행이 멈추지 않게 한 명 이상 더 지정해 두는 것을 권해요. 운영자와 공동 운영자는 <b>마니또에 참여하지 않는 계정</b>이에요
        (짝과 진행 상황을 볼 수 있어서요). 지정할 사람이 사이트 주소 끝에 <code>?setup</code>을 붙여 들어가 "운영자 계정 만들기"로 계정을 만들면
        화면에 <b>계정 번호</b>가 나와요. 그 번호를 받아 아래에 넣어 주세요.
      </p>
      {linkedAdmins.length > 0 && (
        <p className="error" role="alert">
          ⚠ 명단에 연결된 계정이 운영자로 남아 있어요: {linkedAdmins.map((r) => r.name).join(", ")}. 이 사람은 참여자이면서 짝을 볼 수 있어요.
          아래에서 권한을 빼고, 운영이 필요하면 참여하지 않는 별도 계정을 지정해 주세요.
        </p>
      )}
      <ul className="plain admin-list">
        {admins.map((id) => {
          const linked = roster.find((r) => r.uid === id);
          return (
            <li key={id} className="row-item">
              <span>
                <strong>{notes[id] || (linked ? `${linked.name} (참여자)` : "운영자")}</strong>{id === user.uid && " (나)"}
                <span className="small muted account-id"> 계정 번호 {id}</span>
              </span>
              {id !== user.uid && <button className="text-btn" onClick={() => remove(id)}>권한 빼기</button>}
            </li>
          );
        })}
      </ul>
      <form className="stack" onSubmit={add}>
        <label>
          <span className="panel-label">계정 번호</span>
          <input className="pk-input mono" value={uid} onChange={(e) => setUid(e.target.value)} autoComplete="off" placeholder="연결 전 화면에 나오는 계정 번호" aria-label="공동 운영자 계정 번호" />
        </label>
        <label>
          <span className="panel-label">메모 (누구 계정인지)</span>
          <input className="pk-input" value={memo} maxLength={20} onChange={(e) => setMemo(e.target.value)} placeholder="예: PL님" aria-label="공동 운영자 메모" />
        </label>
        <button className="pk-btn main sm" disabled={!uid.trim()}>공동 운영자로 지정</button>
      </form>
      {msg && <p className="note" role="status">{msg}</p>}
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
      // "이름,근무지,파트" — 근무지·파트는 생략 가능
      const { name, loc, part, badLoc } = parseRosterLine(line, LOCS);
      if (badLoc) bad.push(`${name}(${badLoc})`);
      const pid = `p${String(start + i + 1).padStart(3, "0")}`;
      const invite = makeInviteCode();
      ops.push((b) => b.set(doc(db, "roster", pid), { name, loc, part, uid: null, disqualified: false }));
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
    if (config.assignVer) setMsg("파트를 바꿨어요. 이미 배정한 뒤라면 '배정하기'를 다시 눌러야 배정(같은 파트 피하기)과 파트 단서에 반영돼요.");
  }

  async function assign() {
    const blank = roster.filter((r) => !(r.part || "").trim()).length;
    const partWarn = blank === roster.length
      ? "\n\n⚠ 파트가 하나도 입력되지 않았어요. 같은 파트끼리 피하는 배정, 파트 단서, 파트 순위가 모두 빠져요."
      : blank ? `\n\n⚠ 파트가 비어 있는 사람이 ${blank}명 있어요. 이 사람들은 누구와도 짝이 될 수 있고 파트 순위에서 빠져요.` : "";
    if (!window.confirm(`마니또를 배정할까요? 다시 배정하면 이전 배정과 코드는 모두 없어져요.${partWarn}`)) return;
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
          ops.push((b) => b.delete(doc(db, "receiverCodes", p)));
        });
      }
      const people = roster.map((r) => ({ pid: r.pid, part: (r.part || "").trim() || null, loc: r.loc || null }));
      const { pairs, siteMatched, partExcluded, warnings } = assignManito(people, { siteMode });
      const codes = generateCodes(pairs.map((p) => p.giverPid));
      const receiverOf = Object.fromEntries(pairs.map((p) => [p.giverPid, p.receiverPid]));
      for (const { giverPid, receiverPid } of pairs) {
        ops.push((b) => b.set(doc(db, "assignments", giverPid), { receiverPid }));
        ops.push((b) => b.set(doc(db, "giverCodes", giverPid), { codes: codes[giverPid] }));
        // 받는 사람 기준으로 뒤집은 코드. 피드 글이 그 사람의 실제 인증에 딸린 것인지 보안 규칙이 확인할 때 쓴다(참여자는 못 읽음).
        ops.push((b) => b.set(doc(db, "receiverCodes", receiverPid), { codes: codes[giverPid] }));
        for (const [slot, code] of Object.entries(codes[giverPid])) {
          ops.push((b) => b.set(doc(db, "codes", code), { receiverPid: receiverOf[giverPid], slot: Number(slot) }));
        }
      }
      // 파트 단서: 받는 사람마다 "내 마니또의 파트"를 단서 7번째 칸에 써 둔다. 최종 지목 단계가 열리면 받는 사람에게만 공개된다.
      // 본인이 쓰는 답이 아니라 거짓·대충이 없고, 마니또가 접속을 안 해도 나간다.
      const newVer = (config.assignVer ?? 0) + 1;
      const partOf = Object.fromEntries(roster.map((r) => [r.pid, (r.part || "").trim()]));
      const hintOps = [];
      for (const { giverPid, receiverPid } of pairs) {
        if (!partOf[giverPid]) continue;
        hintOps.push((b) => b.set(doc(db, "clues", `${receiverPid}_${PART_HINT_IDX}`), {
          receiverPid, idx: PART_HINT_IDX, answer: partOf[giverPid], ver: newVer,
        }));
      }
      ops.push((b) => b.set(metaRef, { ...assignmentMemo(pairs, codes), at: serverTimestamp() }));
      await commitInChunks(ops);
      // 파트 단서는 따로 저장한다. 콘솔에 게시된 보안 규칙이 예전 것이면 이 저장만 거부되는데, 그래도 배정 자체는 되게.
      let hintFailed = false;
      await commitInChunks(hintOps).catch(() => { hintFailed = true; });
      // 추리 보드가 후보를 줄일 때 쓰는 값 (짝 정보는 아님)
      // 배정 회차를 올린다(배정 문서를 다 쓴 뒤에). 지난 회차 단서는 보안 규칙이 읽지 못하게 하고,
      // 각 마니또가 앱을 열 때 새 대상에게 단서를 다시 보낸다.
      await updateDoc(doc(db, "config", "app"), { siteMatched, partExcluded, assignVer: newVer });
      const noPart = roster.filter((r) => !partOf[r.pid]).length;
      setMsg(`${pairs.length}명 배정 완료.`
        + (hintFailed ? " ⚠ 파트 단서는 저장하지 못했어요. Firebase 콘솔에 최신 보안 규칙(firestore.rules)을 게시한 뒤 '배정하기'를 다시 눌러 주세요." : "")
        + (noPart && noPart < roster.length ? ` 파트가 비어 있는 ${noPart}명이 마니또인 경우는 파트 단서가 나가지 않아요.` : "")
        + (warnings.length ? " " + warnings.join(" ") : "")
        + ` ${siteMatched ? "같은 근무지끼리, " : ""}${partExcluded && noPart < roster.length ? "다른 파트끼리, " : ""}맞마니또 없이 짝지었어요.`
        + (siteMatched ? "" : " 근무지가 다른 짝은 원격 미션 카드가 나와요.")
        + " 누가 누구의 마니또인지는 아래 '짝 현황' 표에서 볼 수 있어요.");
    } catch (err) {
      setMsg(err?.code === "permission-denied"
        ? "배정을 저장하지 못했어요(권한 없음). Firebase 콘솔에 게시된 보안 규칙이 예전 것이면 이렇게 돼요. 최신 firestore.rules를 게시한 뒤 '배정하기'를 다시 눌러 주세요."
        : err.message);
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
          한 줄에 한 명, "이름,근무지,파트" 형식. 같은 파트끼리는 마니또가 되지 않게 배정하고,
          최종 지목이 열릴 때 "내 마니또는 ○○ 소속" 단서가 자동으로 나가요. 파트 순위도 이 파트로 매겨요.
        </p>
        <textarea className="pk-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"홍길동,SR3,공정파트\n김철수,S1L,소자파트"} />
        <button className="pk-btn main" onClick={addPeople} disabled={busy || !loaded}>명단에 추가</button>
      </Panel>

      <Panel title="2. 마니또 배정">
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
            ? <>파트: {parts.map(([name, n]) => `${name} ${n}명`).join(" · ")}{roster.length - parts.reduce((a, [, n]) => a + n, 0) > 0 && ` · 파트 없음 ${roster.length - parts.reduce((a, [, n]) => a + n, 0)}명`}.
              {parts[0][1] > Math.floor(roster.length / 2) && ` ${parts[0][0]}가 전체의 절반을 넘어서 같은 파트끼리도 일부 짝이 돼요.`}
              {parts.length === 2 && roster.length === parts[0][1] + parts[1][1] && " 파트가 둘뿐이라 마지막 파트 단서는 새 정보가 되지 않아요(처음부터 다른 파트로 정해져 있어요)."}
              {parts.some(([, n]) => n < 6) && " 인원이 적은 파트는 파트 단서만으로 마니또가 거의 드러나요."} 배정한 뒤 파트를 고쳤다면 다시 배정해야 반영돼요.</>
            : "파트가 입력되지 않았어요. 같은 파트 피하기·파트 단서·파트 순위가 빠져요(명단 표의 파트 칸을 눌러 넣을 수 있어요)."}
        </p>
        <button className="pk-btn main" onClick={assign} disabled={busy || roster.length < 3}>배정하기</button>
      </Panel>

      {msg && <p className="note banner" role="status">{msg}</p>}

      <Panel title={`명단 ${roster.length}명`}>
        <button className="pk-btn sm" onClick={() => navigator.clipboard.writeText(inviteText)}>이름과 초대 코드 복사</button>
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>이름</th><th>근무지</th><th>파트</th><th>초대 코드</th><th>연결된 메일</th><th></th></tr></thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.pid}>
                  <td>{r.name}</td>
                  <td><button className="text-btn" onClick={() => cycleLoc(r)} title="눌러서 근무지 바꾸기">{r.loc || "미정"}</button></td>
                  <td><button className="text-btn" onClick={() => editPart(r)} title="눌러서 파트 바꾸기">{r.part || "미정"}</button></td>
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

const byPartThenName = (a, b) => (a.part || "").localeCompare(b.part || "", "ko") || a.name.localeCompare(b.name, "ko");

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

  const [boardMsg, setBoardMsg] = useState("");
  const [board, setBoard] = useState(undefined); // 지금 발표돼 있는 파트 순위(public/board)
  useEffect(() => onSnapshot(doc(db, "public", "board"), (s) => setBoard(s.exists() ? s.data() : null)), []);

  // 주차를 내리면 닫히는 주차의 카드 고르기·완료 알림·인증이 막힌다(보안 규칙이 열린 주차까지만 받는다). 실수로 누르지 않게 한 번 묻는다.
  async function setWeek(week) {
    if (week === config.week) return;
    if (week < config.week && !window.confirm(`${config.week}주차 → ${week}주차로 내릴까요?\n\n${week + 1}주차부터는 다시 잠겨서, 그 주차의 카드 고르기·완료 알리기·인증이 막혀요. 실수로 올린 것을 되돌릴 때만 쓰세요.`)) return;
    try {
      await updateDoc(doc(db, "config", "app"), { week });
    } catch {
      setBoardMsg("주차를 바꾸지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    }
  }

  // 단서는 주차마다 2개까지만(공개 개수 ≤ 2 × 주차). 같은 주에 두 번 누르는 실수를 막는다. 보안 규칙도 같은 기준이다.
  const released = config.cluesReleased || 0;
  const clueCap = Math.min(CLUE_COUNT, 2 * (config.week || 1));
  const canRelease = released < clueCap;

  const publishBoard = () => publishPartBoard(roster, progress, config.week);
  async function releaseClues() {
    if (!canRelease) return;
    try {
      await updateDoc(doc(db, "config", "app"), { cluesReleased: Math.min(clueCap, released + 2) });
    } catch {
      return setBoardMsg("단서를 공개하지 못했어요. 이번 주차 단서는 이미 공개했을 수 있어요.");
    }
    try {
      const n = await publishBoard();
      setBoardMsg(n ? "단서를 공개하고 파트 순위도 새로 발표했어요." : "단서를 공개했어요. 파트가 입력되지 않아 파트 순위는 비어 있어요.");
    } catch {
      setBoardMsg("단서는 공개했지만 파트 순위는 발표하지 못했어요. 아래 '파트 순위만 다시 발표'를 눌러 주세요.");
    }
  }
  async function republishBoard() {
    try {
      const n = await publishBoard();
      setBoardMsg(n ? "파트 순위를 새로 발표했어요." : "파트가 입력된 참여자가 없어서 파트 순위가 비어 있어요.");
    } catch {
      setBoardMsg("파트 순위를 발표하지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    }
  }

  async function toggleNudge(pid) {
    if (nudges.has(pid)) await deleteDoc(doc(db, "nudges", pid));
    else await setDoc(doc(db, "nudges", pid), { at: serverTimestamp() });
  }

  const rows = [...roster].sort(byPartThenName);
  const zero = rows.filter((r) => !received[r.pid]);

  return (
    <>
      <Panel title="주차">
        <div className="chip-row">
          {[1, 2, 3].map((w) => <button key={w} className={config.week === w ? "chip is-on" : "chip"} onClick={() => setWeek(w)}>{w}주차</button>)}
        </div>
        <p className="small">주차를 올리면 그 주차 미션이 열려요. 3주차는 칭찬 카드예요.</p>
      </Panel>

      <Panel title={`단서 공개 (${released} / ${CLUE_COUNT})`}>
        <button className="pk-btn gold" onClick={releaseClues} disabled={!canRelease}>이번 주 단서 2개 공개</button>
        <p className="small">
          매주 금요일에 한 번 눌러 주세요. 전원에게 동시에 공개돼요. 누르면 파트 순위도 같이 새로 발표돼요.
          {!canRelease && released < CLUE_COUNT && ` ${config.week}주차 단서는 이미 공개했어요. 다음 단서는 주차를 올린 뒤에 공개할 수 있어요(주차마다 2개까지).`}
          {released >= CLUE_COUNT && " 단서 6개를 모두 공개했어요."}
        </p>
      </Panel>

      <Panel title="파트 순위 발표">
        <p className="small">
          참여자의 "파트 순위" 탭에 보이는 표예요. 파트별로 완료를 알린 미션 수 ÷ (가입한 인원 × 열린 주차)로 매겨요.
          실시간이 아니라 발표할 때의 숫자로 멈춰 있어요(실시간이면 미션을 받은 직후 어느 파트 숫자가 올랐는지로 마니또의 파트가 드러나요).
        </p>
        {board === undefined ? null : board && board.parts?.length ? (
          <ul className="plain">
            {board.parts.map((x) => <li key={x.part}>{x.part}: {x.done} / {x.max} ({x.members}명)</li>)}
            <li className="small muted">{board.week}주차 기준{board.at?.toDate ? `, ${board.at.toDate().toLocaleString("ko-KR")} 발표` : ""}</li>
          </ul>
        ) : <p className="muted small">아직 발표한 순위가 없어요.</p>}
        <button className="pk-btn" onClick={republishBoard} disabled={!roster.length}>파트 순위만 다시 발표</button>
        {boardMsg && <p className="note" role="status">{boardMsg}</p>}
      </Panel>

      <Panel title={`받은 인증이 0건인 사람 ${zero.length}명`}>
        <p className="small">
          알림을 켜면 그 사람의 마니또 화면에 "대상이 기다리고 있어요"가 떠요. 누가 마니또인지와 주차별 진행은 아래 "짝 현황" 표에서 볼 수 있어요.
          받은 인증이 0건인 이유는 마니또가 아직 안 했거나, 본인이 받은 미션을 인증하지 않은 것 둘 중 하나예요. 최근 접속이 오래된 사람은 따로 알려 주세요.
        </p>
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>파트</th><th>이름</th><th>가입</th><th>최근 접속</th><th>프로필</th><th>한 미션</th><th>받은 인증</th><th>알림</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pid} className={!received[r.pid] ? "warn" : ""}>
                  <td>{r.part || "-"}</td>
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
  const rows = [...roster].sort(byPartThenName);
  return (
    <Panel title="계정 연결">
      <p className="small">
        이름마다 연결된 메일이 보여요. 다른 사람이 연결됐거나 메일·비밀번호 문제로 새 계정을 써야 하면 "연결 해제"를 누르고, 새로 나온 초대 코드를 본인에게 전달하세요. 기록은 그대로 이어져요.
      </p>
      {msg && <p className="note" role="status">{msg}</p>}
      <div className="table-wrap">
        <table className="pk-table">
          <thead><tr><th>파트</th><th>이름</th><th>초대 코드</th><th>연결된 메일</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pid} className={r.uid ? "" : "warn"}>
                <td>{r.part || "-"}</td>
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

// 최종 지목 단계: 아직 지목하지 않은 사람을 챙긴다. 누구를 지목했는지와 정답 여부는 "짝 현황" 표에 나온다.
// 지목을 안 하면 그 사람의 마니또가 은신 응모권 2장을 자동으로 받는다.
function GuessStatus() {
  const roster = useFullRoster() || [];
  const [progress, setProgress] = useState({});
  useEffect(() => onSnapshot(collection(db, "progress"), (s) => setProgress(Object.fromEntries(s.docs.map((d) => [d.id, d.data()])))), []);
  const rows = [...roster].filter((r) => r.uid).sort(byPartThenName);
  const notYet = rows.filter((r) => !progress[r.pid]?.guessed);
  return (
    <Panel title={`최종 지목 중 (안 한 사람 ${notYet.length}명)`}>
      <p className="small">누구를 지목했는지와 정답 여부는 아래 "짝 현황" 표에서 볼 수 있어요. 지목을 안 하면 그 사람의 마니또가 은신 응모권 2장을 받아요(미션이 1건 이상 인증된 마니또만).</p>
      {notYet.length > 0 && <p className="note">아직 안 한 사람: {notYet.map((r) => r.name).join(", ")}</p>}
      <div className="table-wrap">
        <table className="pk-table">
          <thead><tr><th>파트</th><th>이름</th><th>지목</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pid} className={progress[r.pid]?.guessed ? "" : "warn"}>
                <td>{r.part || "-"}</td><td>{r.name}</td><td>{progress[r.pid]?.guessed ? "O" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Moderation() {
  const { nameOf } = useApp();
  const roster = useFullRoster() || [];
  const [items, setItems] = useState([]);
  useEffect(() => onSnapshot(collection(db, "redemptions"), (s) =>
    setItems(s.docs.map((d) => ({ code: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)))
  ), []);

  // 인증 문서와 익명 피드 글(받는 사람 정보가 없는 별도 문서)을 같이 바꾼다.
  const toggleVoid = async (r) => {
    const b = writeBatch(db);
    b.update(doc(db, "redemptions", r.code), { voided: !r.voided });
    if (r.feedId) b.update(doc(db, "feed", r.feedId), { voided: !r.voided });
    await b.commit();
  };
  const toggleDq = (r) => {
    if (!r.disqualified && !window.confirm(`${r.name}님을 응모권·수상에서 제외할까요?`)) return;
    return updateDoc(doc(db, "roster", r.pid), { disqualified: !r.disqualified });
  };
  const toggleDropout = (r) => {
    if (!r.dropout && !window.confirm(`${r.name}님을 중도 이탈로 표시할까요?\n\n· ${r.name}님은 응모권 0장(추첨 제외)\n· ${r.name}님의 마니또가 완료를 알린 미션은 인증된 것으로 인정(도전 추가분은 없음)\n· ${r.name}님이 맡은 사람은 못 받은 주차만큼 응모권 보상\n\n집계 전에는 언제든 되돌릴 수 있어요.`)) return;
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
              <span className="small muted">{nameOf(r.receiverPid)} · {r.slot}주차</span>
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
  const fullRoster = useFullRoster();
  const [cards, setCards] = useState([]);
  const [evals, setEvals] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

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
    // 수상 대상이 아닌 마니또(가입 안 함·중도 이탈·수상 제외)는 카드를 만들지 않는다. 뽑힐 수 없는 카드에 표가 가지 않게.
    const byPid = Object.fromEntries(fullRoster.map((r) => [r.pid, r]));
    const eligible = (pid) => Boolean(byPid[pid]?.uid) && !byPid[pid].dropout && !byPid[pid].disqualified;
    let made = 0;
    let skipped = 0;
    for (const [giverPid, { codes }] of Object.entries(giverCodes)) {
      if (!eligible(giverPid)) { skipped++; continue; }
      const reviews = Object.values(codes).map((c) => redemptions[c]).filter((r) => r && !r.voided).map((r) => r.review);
      const cardId = doc(collection(db, "voteCards")).id;
      ops.push((b) => b.set(doc(db, "voteCards", cardId), { reviews, part: (byPid[giverPid].part || "").trim() || null }));
      ops.push((b) => b.set(doc(db, "cardOwners", cardId), { giverPid }));
      made++;
    }
    await commitInChunks(ops);
    setMsg(`투표 카드 ${made}장을 만들었어요.${skipped ? ` 수상 대상이 아닌 마니또 ${skipped}명(가입 안 함·중도 이탈·수상 제외)은 뺐어요.` : ""}`);
    setBusy(false);
  }

  return (
    <Panel title="투표 카드">
      <p className="small">
        마니또별로 인증된 후기를 묶어 익명 카드로 만들어요. 운영진 평가(0~10)는 베스트 마니또 점수의 20%예요.
        수상 대상이 아닌 마니또(가입 안 함·중도 이탈·수상 제외)는 카드에서 빠져요. 수상 제외·중도 이탈 표시를 먼저 끝내고 만들어 주세요
        (카드를 만든 뒤에 제외한 사람은 집계에서 빠지고, 그 카드에 간 표는 세지 않아요).
      </p>
      <button className="pk-btn main" onClick={buildCards} disabled={busy || !fullRoster}>{cards.length ? "투표 카드 다시 만들기" : "투표 카드 만들기"}</button>
      {msg && <p className="note" role="status">{msg}</p>}
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

// 받은 게 없어요 확인 / 집계 전 확인: 마니또가 완료를 알렸는데 인증이 없는 주차를 운영자가 주차별로 확인한다.
//  받았음: 그 마니또의 미션으로 인정한다(도전 추가분은 없음). 받는 사람의 인증 입력 응모권은 생기지 않는다.
//  못 받음: 마니또의 미션으로 치지 않고, 받는 사람에게 그 주차 보상 1장을 준다(마니또가 안 보낸 주차와 같게).
//  확인하지 않으면: 어느 쪽에도 응모권이 생기지 않는다. 단, 대상이 가입 안 함·중도 이탈이면 확인 없이도 마니또의 미션으로 인정된다.
// all = false(미션 진행~투표 단계): 받는 사람이 "받은 게 없어요"로 신고했거나 이미 확인한 주차만 보인다.
// all = true(집계 단계): 인증이 없는 완료 알림을 모두 보인다(신고하지 않고 인증만 안 한 경우 포함).
function Unresolved({ all = false }) {
  const { nameOf } = useApp();
  const roster = useFullRoster() || [];
  const { ready, rows } = usePairs();
  const [msg, setMsg] = useState("");
  if (!ready) return null;
  const byPid = Object.fromEntries(roster.map((r) => [r.pid, r]));
  const items = unresolvedSlots(rows, { onlyReported: !all })
    .sort((a, b) => a.slot - b.slot || nameOf(a.receiverPid).localeCompare(nameOf(b.receiverPid), "ko"));
  const autoOf = (pid) => (byPid[pid] && !byPid[pid].uid ? "미가입" : byPid[pid]?.dropout ? "중도 이탈" : null);
  const waiting = items.filter((x) => !x.verdict && !autoOf(x.receiverPid)).length;

  async function decide(it, verdict) {
    setMsg("");
    const ref = doc(db, "verdicts", `${it.receiverPid}_${it.slot}`);
    try {
      if (it.verdict === verdict) await deleteDoc(ref); // 같은 버튼을 다시 누르면 확인 취소
      else await setDoc(ref, { receiverPid: it.receiverPid, slot: it.slot, verdict, at: serverTimestamp() });
    } catch {
      setMsg("저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    }
  }

  return (
    <Panel title={all ? `집계 전 확인: 인증이 없는 완료 알림 (확인 안 한 것 ${waiting}건)` : `받은 게 없어요 신고 (확인 안 한 것 ${waiting}건)`}>
      <p className="small">
        {all
          ? "마니또가 미션 완료를 알렸는데 받는 사람이 인증하지 않은 주차예요. 집계하기 전에 두 사람에게 확인하고 주차마다 눌러 주세요."
          : "마니또가 완료를 알렸는데 받는 사람이 \"받은 게 없어요\"로 알린 주차예요. 두 사람에게 확인하고 주차마다 눌러 주세요."}
        {" "}<b>받았음</b>: 마니또의 미션으로 인정해요(도전 추가분은 없고, 받는 사람의 인증 입력 응모권은 생기지 않아요).
        {" "}<b>못 받음</b>: 마니또의 미션으로 치지 않고, 받는 사람에게 그 주차 응모권 1장을 보상해요.
        {" "}확인하지 않으면 어느 쪽에도 응모권이 생기지 않아요. 같은 버튼을 다시 누르면 취소돼요.
      </p>
      {items.length === 0 ? <p className="muted">{all ? "해당하는 주차가 없어요." : "신고가 없어요."}</p> : (
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>주차</th><th>받는 사람</th><th>마니또</th><th>카드</th><th>신고</th><th>확인</th></tr></thead>
            <tbody>
              {items.map((it) => {
                const auto = autoOf(it.receiverPid);
                return (
                  <tr key={`${it.receiverPid}_${it.slot}`} className={!it.verdict && !auto ? "warn" : ""}>
                    <td>{it.slot}주차</td>
                    <td>{nameOf(it.receiverPid)}{auto && ` (${auto})`}</td>
                    <td>{nameOf(it.giverPid)}</td>
                    <td className="left" title={it.text}>{it.level === "praise" ? "칭찬 카드" : `${LEVEL_LABEL[it.level] || ""} ${it.text}`}</td>
                    <td>{it.reported ? "받은 게 없어요" : "-"}</td>
                    <td>
                      <button className={it.verdict === "received" ? "chip sm is-on" : "chip sm"} aria-pressed={it.verdict === "received"} onClick={() => decide(it, "received")}>받았음</button>
                      <button className={it.verdict === "missing" ? "chip sm is-on" : "chip sm"} aria-pressed={it.verdict === "missing"} onClick={() => decide(it, "missing")}>못 받음</button>
                      {auto && !it.verdict && <span className="small muted"> 확인 없으면 자동 인정</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {msg && <p className="error" role="alert">{msg}</p>}
    </Panel>
  );
}

// 짝 현황: 누가 누구의 마니또인지와 주차별 진행. 운영자는 참여하지 않는 계정이라 언제든 볼 수 있다.
function Pairs() {
  const { config, nameOf, byPid } = useApp();
  const { ready, rows, assignments, giverCodes } = usePairs();
  const receiverCodes = useColl("receiverCodes");
  const phase = config.phase;

  // 예전 방식으로 배정된 자료에는 "받는 사람 기준 코드"가 없어서 인증(피드 글 확인)이 거부된다. 미션이 시작된 뒤에는 여기서 채워 넣는다.
  // (준비 단계에서는 배정할 때 같이 쓰므로 건드리지 않는다. 다시 배정하는 중간 상태를 덮어쓰지 않게)
  useEffect(() => {
    if (phase < PHASE.RUNNING || !assignments || !giverCodes || !receiverCodes) return;
    const want = receiverCodesOf(assignments, giverCodes);
    const fix = Object.entries(want).filter(([pid, codes]) => !sameCodes(receiverCodes[pid]?.codes, codes));
    if (!fix.length) return;
    const b = writeBatch(db);
    fix.forEach(([pid, codes]) => b.set(doc(db, "receiverCodes", pid), { codes }));
    b.commit().catch(() => {});
  }, [phase, assignments, giverCodes, receiverCodes]);

  if (!ready) return null;
  if (rows.length === 0) {
    return <Panel title="짝 현황"><p className="muted">아직 배정 전이에요. 준비 단계에서 "배정하기"를 누르면 누가 누구의 마니또인지 여기에 나와요.</p></Panel>;
  }

  const partOf = (pid) => byPid[pid]?.part || "";
  const sorted = [...rows].sort((a, b) => partOf(a.giverPid).localeCompare(partOf(b.giverPid), "ko") || nameOf(a.giverPid).localeCompare(nameOf(b.giverPid), "ko"));
  const count = (st) => rows.reduce((n, r) => n + Object.values(r.slots).filter((x) => x.status === st).length, 0);
  const showGuess = phase >= PHASE.GUESSING;
  const cell = (r, slot) => {
    const x = r.slots[slot];
    const level = x.level === "praise" ? "칭찬" : LEVEL_LABEL[x.level];
    return (
      <td key={slot} className={`st-${x.status}`} title={x.text || undefined}>
        {x.status === "none" ? "-" : <>{level && <span className="small">{level} · </span>}{SLOT_STATUS_LABEL[x.status]}{x.notes > 0 && <span className="small"> +쪽지 {x.notes}</span>}</>}
      </td>
    );
  };

  return (
    <Panel title={`짝 현황 (${rows.length}쌍)`}>
      <p className="small">
        누가 누구의 마니또인지와 주차별 진행이에요. 운영자 화면에만 보여요(운영자·공동 운영자는 참여하지 않는 계정이에요). 화면을 다른 사람이 보지 않게 주의해 주세요.
        {" "}인증됨 {count("redeemed")} · 인증 대기 {count("sent")} · 신고 {count("reported")} · 받았음 확인 {count("confirmed")} · 못 받음 확인 {count("missing")}
        {count("voided") > 0 && ` · 인증 무효 ${count("voided")}`}
      </p>
      <div className="table-wrap">
        <table className="pk-table pair-table">
          <thead>
            <tr><th>마니또</th><th>대상</th><th>1주차</th><th>2주차</th><th>3주차</th>{showGuess && <th>대상의 지목</th>}</tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.giverPid}>
                <td className="left">{nameOf(r.giverPid)}{partOf(r.giverPid) && <span className="small muted"> {partOf(r.giverPid)}</span>}</td>
                <td className="left">{nameOf(r.receiverPid)}{partOf(r.receiverPid) && <span className="small muted"> {partOf(r.receiverPid)}</span>}</td>
                {[1, 2, 3].map((slot) => cell(r, slot))}
                {showGuess && (
                  <td className={r.guessPid ? (r.correct ? "st-redeemed" : "") : "st-sent"}>
                    {r.guessPid ? `${nameOf(r.guessPid)} (${r.correct ? "정답" : "오답"})` : "지목 안 함"}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
    const [assignments, giverCodes, redemptions, missions, guesses, votes, owners, evals, deliveries, verdicts] = await Promise.all(
      ["assignments", "giverCodes", "redemptions", "giverMissions", "guesses", "votes", "cardOwners", "adminEval", "deliveries", "verdicts"].map(readAll)
    );
    const people = roster.map((r) => ({
      pid: r.pid, part: (r.part || "").trim() || null,
      disqualified: Boolean(r.disqualified), joined: Boolean(r.uid), dropout: Boolean(r.dropout),
    }));
    const tickets = computeTickets({
      deliveries: Object.values(deliveries).map((d) => ({ receiverPid: d.receiverPid, slot: d.slot })),
      people,
      assignments: Object.fromEntries(Object.entries(assignments).map(([g, a]) => [g, a.receiverPid])),
      giverCodes: Object.fromEntries(Object.entries(giverCodes).map(([g, c]) => [g, c.codes])),
      redemptions,
      missions,
      guesses: Object.fromEntries(Object.entries(guesses).map(([r, g]) => [r, g.guessPid])),
      // 운영자의 주차별 확인 결과: 받았음 → 마니또의 미션 인정, 못 받음 → 받는 사람 보상
      verdicts: Object.fromEntries(Object.entries(verdicts).map(([id, v]) => [id, v.verdict])),
    });
    // 수상 제외·불참(가입 안 함, 중도 이탈)은 베스트 마니또에서도 뺀다
    const disqualified = new Set(people.filter((p) => p.disqualified || !p.joined || p.dropout).map((p) => p.pid));
    const ranked = rankBestManito({
      cards: Object.entries(owners).map(([cardId, o]) => ({ cardId, giverPid: o.giverPid })),
      votes: Object.fromEntries(Object.entries(votes).map(([v, x]) => [v, x.cardIds || []])),
      adminEval: Object.fromEntries(Object.entries(evals).map(([c, e]) => [c, e.score])),
      tickets,
      disqualified,
      partOf: Object.fromEntries(people.map((p) => [p.pid, p.part])), // 내 파트 카드는 못 보므로 파트 인원 차이를 보정한다
    });
    const most = pickMostTickets(tickets);
    const praises = Object.values(deliveries).filter((d) => d.kind === "praise").map((d) => ({ receiverPid: d.receiverPid, message: d.message }));

    // 추첨은 공개 단계에서만 한다(보안 규칙: 집계 단계의 결과에는 추첨 결과가 비어 있어야 한다).
    await setDoc(doc(db, "results", "public"), {
      pairs: Object.entries(assignments).map(([giverPid, a]) => ({ giverPid, receiverPid: a.receiverPid })),
      tickets: Object.fromEntries(Object.entries(tickets).map(([pid, t]) => [pid, t.total])),
      ticketDetail: tickets,
      partBoard: partStandings(people, tickets).map(({ part, members, done, max, winner }) => ({ part, members, done, max, winner })),
      bestManito: ranked.slice(0, PRIZES.bestManito.count).map((r) => ({ pid: r.giverPid, score: Math.round(r.score * 1000) / 1000, votes: r.votes })),
      mostTickets: most,
      bestReview: result?.bestReview || null,
      praises,
      draws: {},
      computedAt: serverTimestamp(),
    });
    setBusy(false);
  }

  const pickReview = (r) => updateDoc(doc(db, "results", "public"), { bestReview: { code: r.code, review: r.review, receiverPid: r.receiverPid } });

  return (
    <>
      <Unresolved all />
      <Panel title="집계">
        <p className="small">
          응모권, 베스트 마니또 순위, 최다 응모권상, 칭찬 벽을 계산해요. 위 "집계 전 확인"과 수상 제외·중도 이탈 표시를 먼저 끝내고 누르세요.
          다시 누르면 다시 계산돼요(동점을 무작위로 가른 것도 다시 뽑아요). 집계해야 공개 단계로 넘어갈 수 있고, 공개 단계로 넘어간 뒤에는 다시 집계할 수 없어요.
        </p>
        <button className="pk-btn main" onClick={compute} disabled={busy || !fullRoster}>{result ? "다시 집계" : "집계하기"}</button>
        {result && (
          <ul className="plain">
            <li>베스트 마니또: {result.bestManito.map((b, i) => `${i + 1}위 ${nameOf(b.pid)}(${b.score})`).join(", ")}</li>
            <li>최다 응모권상: {result.mostTickets ? `${nameOf(result.mostTickets.pid)} ${result.mostTickets.total}장 (동점 ${result.mostTickets.tiedCount}명 중)` : "-"}</li>
            <li>파트 대항전: {(result.partBoard || []).length
              ? result.partBoard.map((x) => `${x.part} ${x.done}/${x.max}${x.winner ? " (우승)" : ""}`).join(", ")
              : "파트가 입력되지 않아 없음"}</li>
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
