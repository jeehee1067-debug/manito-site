import { useEffect, useMemo, useRef, useState } from "react";
import {
  arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";
import { db } from "../firebase.js";
import { forgetFeed } from "../lib/feedCache.js";
import { patchFeedDigest } from "../lib/feedDigest.js";
import { useApp } from "../App.jsx";
import { HowTag, Panel } from "../ui.jsx";
import { PHASE, PHASES, CARD_HOW, CLUE_COUNT, LEVEL_LABEL, MAIL_DOMAIN, PART_HINT_IDX, PRAISE_SLOT, REVIEW_EDITS_MAX, RULES_VERSION } from "../lib/constants.js";
import { SLOT_STATUS_LABEL, assignmentHealth, cardPicks, clueAnswers, codeProblems, cluesDoneSet, midGuessStats, pairRows, receiverCodesOf, sameCodes, unresolvedSlots } from "../lib/pairs.js";
import { assignManito, assignmentMemo, generateCodes, makeInviteCode, previewAssignments } from "../lib/assign.js";
import { computeTickets, missionLikes, noticedWeeks, partStandings, rankReviews, reviewLikes, weeklyPartBoard } from "../lib/scoring.js";
import { angelQueue, angelQueueStatus, matchAngels, needyReceivers } from "../lib/angels.js";
import { GOLD_DRAW, PRIZES, TICKET_RULES as R } from "../config/prizes.js";
import { drawGold, goldCandidates, goldCount, goldWeekClosed, isGoldChoice } from "../lib/gold.js";
import { secureRandom } from "../lib/random.js";
import { TITLES, computeTitles } from "../lib/titles.js";
import { parseRosterLine, rosterSummary, sameSummary } from "../lib/roster.js";
import InviteMail, { ProfileMail, ReminderMail } from "./InviteMail.jsx";
import { AUTO_ITEMS, CLAIM_MS, autoPlan, localInputToMs, msToLocalInput, nextDue } from "../lib/schedule.js";
import { BACKUP_COLLECTIONS, BACKUP_DOCS, backupDocCount, buildBackup, messageRows, stamp, toCsv } from "../lib/backup.js";

// Firestore 배치는 500건 제한이라 나눠서 커밋한다.
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach((op) => op(batch));
    await batch.commit();
  }
}

// 저장 결과를 정확히 알기 위한 도우미. Firestore는 서버가 받기 전에도 화면에는 바로 보여 준다(그래서 "저장된 줄 알았는데 새로 고치니 없다"가 생긴다).
// 서버가 받았을 때만 null을 돌려주고, 거부되거나 SAVE_SLOW_MS 안에 답이 없으면 오류를 돌려준다(던지지 않는다).
const SAVE_SLOW_MS = 12000;
async function trySave(run) {
  let timer;
  const slow = new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("slow"), { code: "manito/slow" })), SAVE_SLOW_MS); });
  try {
    await Promise.race([run(), slow]);
    return null;
  } catch (err) {
    return err;
  } finally {
    clearTimeout(timer);
  }
}
// 명단 저장이 안 된 이유를 사람이 고칠 수 있는 말로. 거부됐을 때는 흔한 원인(예전 규칙, 처음 운영자 아님)을 차례로 확인한다.
async function saveErrorText(err, { isOwner }) {
  const code = String(err?.code || "");
  if (code === "manito/slow" || code.includes("unavailable")) {
    return "아직 저장되지 않았어요. 저장 요청이 서버에 닿지 않고 있어요(화면에 보여도 새로 고치면 사라져요). 사내망에서 연결이 막혔을 수 있어요: 주소 끝에 ?longpoll 을 붙여 다시 열거나, 다른 네트워크(휴대폰 테더링 등)에서 해 보세요.";
  }
  if (code.includes("permission-denied")) {
    // 규칙 버전 확인도 답이 없으면 5초만 기다린다(연결이 나쁠 때 안내가 끝없이 안 나오지 않게)
    const stale = await Promise.race([
      getDoc(doc(db, "rulesVersion", RULES_VERSION)).then(() => false, (e) => e?.code === "permission-denied"),
      new Promise((r) => setTimeout(() => r(false), 5000)),
    ]);
    if (stale) return "저장이 거부됐어요. Firebase 콘솔에 게시된 보안 규칙이 예전 것이에요. 저장소의 firestore.rules 내용을 콘솔 → Firestore Database → 규칙에 붙여 넣고 \"게시\"를 누른 뒤 다시 해 주세요.";
    if (!isOwner) return "저장이 거부됐어요. 명단 추가·삭제와 아이디 고치기는 처음 운영자 계정만 할 수 있어요.";
    return "저장이 거부됐어요(보안 규칙). 처음 운영자 계정으로 로그인했는지 확인해 주세요.";
  }
  return `저장하지 못했어요(${code || err?.message || "알 수 없는 오류"}). 잠시 뒤 다시 해 주세요.`;
}

// 배정을 저장하는 중인지(이 탭). 저장이 끝나기 전에 미션을 시작하면 뒤쪽 저장이 보안 규칙에 거부된다(실제로 있었던 일).
let assigningNow = false;

const NEXT_PHASE_NOTE = {
  0: "미션 진행을 시작합니다. 시작 후에는 명단 추가·삭제와 재배정을 할 수 없어요.",
  1: "미션 진행을 마감하고 최종 지목을 받습니다. 이후 미션 완료 알리기는 막혀요. 받은 미션 인증은 최종 지목이 마감될 때까지 할 수 있어요(마감 직전에 온 미션을 인증할 시간). 파트 순위도 지금 숫자로 마지막 발표를 해요.",
  2: "최종 지목을 마감합니다. 이후에는 지목을 바꿀 수 없고, 받은 미션 인증도 막혀요.",
  3: "집계 단계로 넘어갑니다. 수상 제외·중도 이탈 표시와 '받은 게 없어요' 확인을 마무리해 주세요.",
  4: "공개 단계로 넘어갑니다. 참여자 결과 탭은 결과 탭의 '발표 화면'에서 넘긴 장면까지만 열려요(한 번에 열려면 '발표 없이 모두 공개'). 넘어간 뒤에는 다시 집계할 수 없어요.",
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
  const deliveries = useColl("deliveries");
  const ready = [assignments, giverCodes, missions, redemptions, reports, verdicts, guesses, deliveries].every(Boolean);
  const rows = useMemo(() => {
    if (!ready) return [];
    // 완료 알림 문서가 있는 주차도 "완료를 알린 주차"로 본다(집계 scoring.js와 같은 기준)
    const delivered = new Set(Object.values(deliveries).filter((d) => d.kind !== "note").map((d) => `${d.receiverPid}_${d.slot}`));
    // 사이트가 전달한 3주차 칭찬 카드(운영자가 가리지 않은 것)는 인증이 없어도 마니또의 미션으로 인정된다
    const autoPraise = new Set(Object.values(deliveries).filter((d) => d.kind === "praise" && !d.hidden).map((d) => `${d.receiverPid}_${d.slot}`));
    // 인증 코드가 실린 완료 알림·쪽지가 간 주차(마니또가 "코드 함께 보내기"를 끄면 대상은 코드가 없어 인증할 수 없다)
    const codeSent = new Set(Object.values(deliveries).filter((d) => d.code && !d.hidden).map((d) => `${d.receiverPid}_${d.slot}`));
    return pairRows({ assignments, giverCodes, missions, redemptions, reports, verdicts, guesses, delivered, autoPraise, codeSent });
  }, [ready, assignments, giverCodes, missions, redemptions, reports, verdicts, guesses, deliveries]);
  return { ready, rows, assignments, giverCodes, missions, guesses };
}

// 운영 화면은 명단 전체(가입 여부·수상 제외 포함)를 쓴다. 참여자 화면은 public/roster 요약만 읽는다.
// 같은 질의는 Firestore가 하나로 묶어서 여러 곳에서 써도 한 번만 읽는다.
function useFullRoster() {
  const [rows, setRows] = useState(null);
  // pending: 화면에는 보이지만 아직 서버가 받지 않은 변경이 있다(includeMetadataChanges는 읽기 수를 늘리지 않는다)
  useEffect(() => onSnapshot(collection(db, "roster"), { includeMetadataChanges: true }, (s) => {
    const list = s.docs.map((d) => ({ pid: d.id, ...d.data() }));
    list.pending = s.metadata.hasPendingWrites;
    setRows(list);
  }), []);
  return rows;
}

// 초대 코드: { pid: 코드 }
function useInvites() {
  const [invites, setInvites] = useState({});
  useEffect(() => onSnapshot(collection(db, "invites"), (s) => {
    const m = {};
    s.docs.forEach((d) => { m[d.data().personId] = d.id; });
    setInvites(m);
  }, () => setInvites({})), []); // 초대 코드 목록은 처음 운영자만 읽는다(보안 규칙). 공동 운영자 화면에서는 비어 있다
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
  if (!window.confirm(`${r.name}님의 계정 연결을 풀까요?\n연결된 메일: ${email || "(모름)"}\n\n요청한 사람이 정말 ${r.name}님인지 직접(대면·본인 메신저) 확인했나요? 다른 사람이 "비밀번호를 잊었다"며 요청해 새 초대 코드를 받아 가면 ${r.name}님 행세를 할 수 있어요.\n\n이 계정은 더 이상 ${r.name}님으로 들어올 수 없고, 초대 코드가 새로 바뀌어요. 새 코드는 본인에게만 전달하세요. 기록(프로필·미션·인증)은 그대로 남아요.`)) return null;
  const code = makeInviteCode();
  // 그 계정의 연결 문서가 이 사람을 가리킬 때만 지운다(다른 이름에 연결된 계정의 연결까지 지우지 않게)
  const linked = await getDoc(doc(db, "users", r.uid)).catch(() => null);
  const b = writeBatch(db);
  b.update(doc(db, "roster", r.pid), { uid: null });
  if (linked?.exists() && linked.data().personId === r.pid) b.delete(doc(db, "users", r.uid));
  if (oldCode) b.delete(doc(db, "invites", oldCode));
  b.set(doc(db, "invites", code), { personId: r.pid });
  await b.commit();
  return code;
}

// 초대 코드 새로 만들기(아직 연결 안 한 사람): 예전 코드를 지우고 새 코드를 만든다. 코드가 새어 나갔을 때 쓴다.
async function renewInvite(r, oldCode) {
  if (r.uid) return null;
  if (!window.confirm(`${r.name}님의 초대 코드를 새로 만들까요?\n\n예전 코드(${oldCode || "없음"})는 더 이상 쓸 수 없어요. 새 코드를 본인에게만 전달해 주세요.`)) return null;
  const code = makeInviteCode();
  const b = writeBatch(db);
  if (oldCode) b.delete(doc(db, "invites", oldCode));
  b.set(doc(db, "invites", code), { personId: r.pid });
  await b.commit();
  return code;
}

// 명단이 요약과 다르면 요약 문서를 다시 쓴다(명단 추가·삭제·근무지·파트 변경 후 자동).
// 파트 순위 발표(public/board). 실시간으로 올리지 않고 운영자가 누를 때만 쓴다
// (실시간이면 미션을 받은 직후 어느 파트 숫자가 올랐는지로 마니또의 파트가 드러난다).
// 완료 수는 각자 쓰는 progress.doneCount가 아니라 완료 표시(giverMissions.done)로 센다(완료 알림과 한 묶음으로만 켜지는 값).
// roster: 명단 전체, missions: { pid: { done } }, week: 열린 주차. 반환: 순위에 든 파트 수
const doneCountOf = (m) => [1, 2, 3].filter((slot) => m?.done?.[slot] === true).length; // 1~3주차 칸의 true만 센다
async function publishPartBoard(roster, missions, week) {
  const w = Math.min(3, Math.max(1, week || 1));
  const people = roster.map((r) => ({ pid: r.pid, part: (r.part || "").trim() || null, joined: Boolean(r.uid), dropout: Boolean(r.dropout) }));
  const doneCounts = Object.fromEntries(roster.map((r) => [r.pid, doneCountOf(missions[r.pid])]));
  const parts = weeklyPartBoard(people, doneCounts, w).map(({ part, members, done, max }) => ({ part, members, done, max }));
  await setDoc(doc(db, "public", "board"), { week: w, at: serverTimestamp(), parts });
  return parts.length;
}

async function publishRoster(rows) {
  await setDoc(doc(db, "public", "roster"), { people: rosterSummary(rows), at: serverTimestamp() });
}

// 운영 화면 가볍게 열기(읽기 줄이기, 11/20): 미션 기간(단계 1 이상)에 운영 탭을 새로 열면 단계·공지·예약만 보이고,
// 짝 현황·인증 검토·고른 카드·집계처럼 컬렉션을 통째로 구독하는 패널은 "운영 자료 불러오기"를 눌러야 읽는다
// (54명 기준 한 번에 약 750건, 주차가 지날수록 늘어남. 무료 한도는 하루 5만 건). 준비 단계에서 연 화면은 처음부터 다 보이고,
// 한 번 불러오면 그 페이지를 닫거나 새로 고칠 때까지 그대로다(탭은 숨겨 둘 뿐 닫지 않는다).
// localStorage manito:adminFull = "1"은 검증 스크립트(e2e)용: 미션 단계에서 새로 고친 운영 화면을 바로 다 보이게 한다.
const ADMIN_FULL_KEY = "manito:adminFull";
function adminFullByDefault() {
  try {
    return localStorage.getItem(ADMIN_FULL_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Admin() {
  const { config } = useApp();
  const [full, setFull] = useState(() => config.phase === PHASE.SETUP || adminFullByDefault());
  if (full || config.phase === PHASE.SETUP) return <AdminFull />;
  return <AdminLight onLoad={() => setFull(true)} />;
}

function AdminLight({ onLoad }) {
  const { config, roster } = useApp();
  const phase = config.phase;
  const n = roster.length;
  const est = Math.max(50, Math.round((n * 14) / 50) * 50);
  return (
    <>
      <RulesCheck />
      <Panel title="운영 단계">
        <div className="phase-bar">
          {PHASES.map((p, i) => <span key={p} className={i === phase ? "on" : i < phase ? "past" : ""}>{p}</span>)}
        </div>
        {phase < PHASE.REVEAL && <p className="small muted">지금은 <b>{PHASES[phase]}</b> 단계예요.</p>}
      </Panel>
      <Panel title="운영 자료 불러오기">
        <p>짝 현황·고른 미션 카드·받은 게 없어요·인증 검토·수호천사·집계·단계 넘기기는 <b>운영 자료를 불러와야</b> 보여요.</p>
        <p className="small">사이트 읽기 무료 한도(하루 5만 건)를 아끼려고 처음에는 불러오지 않아요. 한 번 불러오면 참여자 {n}명 기준 대략 {est}건을 읽어요(주차가 지날수록 늘어나요).
          불러온 뒤에는 이 페이지를 닫거나 새로 고칠 때까지 그대로 보여요. 피드만 보거나 예약만 확인할 때는 불러오지 않아도 돼요.</p>
        <button className="pk-btn main" onClick={onLoad}>운영 자료 불러오기</button>
      </Panel>
      <Notice />
      {phase === PHASE.RUNNING && <ScheduleBox />}
    </>
  );
}

function AdminFull() {
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
    // 미션 시작 전: 배정이 끝까지 저장됐는지 확인한다(배정은 여러 번에 나눠 저장되고, 미션이 시작되면 더는 쓸 수 없다)
    if (phase === PHASE.SETUP) {
      if (assigningNow) return setStepMsg("배정을 저장하는 중이에요. \"○명 배정 완료\"가 뜬 뒤에 눌러 주세요.");
      if (!fullRoster) return setStepMsg("명단을 읽는 중이에요. 잠시 뒤 다시 눌러 주세요.");
      const [aSnap, hSnap] = await Promise.all([getDocs(collection(db, "assignments")), getDocs(query(collection(db, "clues"), where("idx", "==", PART_HINT_IDX)))]).catch(() => [null, null]);
      if (!aSnap) return setStepMsg("배정 상태를 확인하지 못했어요. 잠시 뒤 다시 눌러 주세요.");
      const h = assignmentHealth({
        roster: fullRoster, config,
        assignments: Object.fromEntries(aSnap.docs.map((d) => [d.id, d.data()])),
        hints: hSnap.docs.map((d) => d.data()),
      });
      if (h.status === "none") return setStepMsg("아직 배정하지 않았어요. 아래 \"배정하기\"를 눌러 \"○명 배정 완료\"가 뜬 뒤에 시작해 주세요.");
      if (h.status === "mismatch") return setStepMsg(`배정한 뒤에 명단이 바뀌었어요(명단 ${h.n}명, 배정 ${h.assigned}명). \"배정하기\"를 다시 누른 뒤 시작해 주세요.`);
      if (h.status === "partial") return setStepMsg("배정이 끝까지 저장되지 않았어요. 아래 \"2. 마니또 배정\"의 안내대로 마무리한 뒤 시작해 주세요.");
    }
    // 미션 시작 전: 가입 안 한 사람이 있으면 그 사람의 마니또는 인증을 받을 수 없어 미션 응모권이 0장이 된다.
    const unjoined = phase === PHASE.SETUP && fullRoster ? fullRoster.filter((r) => !r.uid) : [];
    const warn = unjoined.length
      ? `\n\n⚠ 아직 가입 안 한 사람 ${unjoined.length}명: ${unjoined.map((r) => r.name).join(", ")}\n이 사람들도 이미 배정돼 있고, 미션이 시작된 뒤에도 가입해 바로 참여할 수 있어요. 가입하기 전까지는 받는 미션을 인증할 수 없고 자기 미션도 못 해요(끝까지 가입하지 않으면 불참으로 처리: 응모권 0장, 그 사람의 마니또가 완료를 알린 미션은 인정). 아예 참여하지 않을 사람이면 명단에서 지우고 다시 배정한 뒤 시작하세요.`
      : "";
    if (!window.confirm(`${PHASES[phase]} → ${PHASES[phase + 1]}\n\n${NEXT_PHASE_NOTE[phase]}${warn}\n\n되돌릴 수 없어요. 진행할까요?`)) return;
    if (phase === PHASE.SETUP && fullRoster) await publishRoster(fullRoster);
    // 미션을 마감할 때 파트 순위를 마지막으로 한 번 더 발표한다(마감 뒤에는 숫자가 더 바뀌지 않는다). 실패해도 단계는 넘긴다.
    if (phase === PHASE.RUNNING && fullRoster) await readAll("giverMissions").then((gm) => publishPartBoard(fullRoster, gm, config.week)).catch(() => {});
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
        {phase < PHASE.REVEAL && <p className="small muted">지금은 <b>{PHASES[phase]}</b> 단계예요. 다음 단계로 넘기는 버튼은 실수로 누르지 않게 이 화면 맨 아래에 있어요.</p>}
      </Panel>

      <Notice />

      {phase >= PHASE.RUNNING && phase <= PHASE.GUESSING && <AssignCheck />}
      {phase >= PHASE.RUNNING && phase <= PHASE.GUESSING && <CodeCheck />}
      {phase === PHASE.SETUP && <Setup />}
      {phase === PHASE.RUNNING && <Running />}
      {phase === PHASE.GUESSING && <GuessStatus />}
      {phase >= PHASE.RUNNING && phase <= PHASE.GUESSING && <Reminders />}
      {phase >= PHASE.RUNNING && phase <= PHASE.CLOSED && <Unresolved />}
      {phase >= PHASE.RUNNING && <Angels />}
      <Pairs />
      {phase >= PHASE.RUNNING && <CardPicks />}
      {phase >= PHASE.RUNNING && <GoldDraw />}
      {phase >= PHASE.RUNNING && <MidGuesses />}
      {phase >= PHASE.RUNNING && phase <= PHASE.SCORING && <Moderation />}
      {phase === PHASE.SCORING && <Scoring />}
      {phase >= PHASE.RUNNING && <Accounts />}
      {phase >= PHASE.RUNNING && <WriteCounts />}
      <Backup />
      <CoAdmins />
      {/* 단계 넘기기는 되돌릴 수 없어서 맨 아래에 둔다(사용자가 정함: "실수로 안 누르게") */}
      {phase < PHASE.REVEAL && (
        <Panel title="다음 단계로 넘기기">
          <p className="small">지금 <b>{PHASES[phase]}</b> → 다음 <b>{PHASES[phase + 1]}</b>. 넘기면 되돌릴 수 없어요. 누르면 무엇이 바뀌는지 확인창이 한 번 더 나와요.</p>
          <button className="pk-btn red" onClick={advance}>다음 단계로: {PHASES[phase + 1]}</button>
          {stepMsg && <p className="error" role="alert">{stepMsg}</p>}
        </Panel>
      )}
      {phase === PHASE.REVEAL && <Panel title="공개"><p><a href="#reveal">결과 탭</a>에서 "발표 화면 열기"로 발표하고 추첨을 진행하세요. 참여자 결과 탭은 발표 화면에서 넘긴 장면까지만 열려요.</p></Panel>}
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

// 처음 운영자(admins[0])인지. 명단 추가·삭제, 초대 코드, 연결 해제, 운영자 목록은 처음 운영자만 한다(보안 규칙).
function useIsOwner() {
  const { config, user } = useApp();
  return user.uid === (config.admins || [])[0];
}
// 초대 코드·메일은 처음에 가려 둔다(사무실에서 화면을 보면 아직 연결 안 한 사람의 코드로 그 사람 행세를 할 수 있어서).
const mask = (v, on) => (on ? v : v ? "●●●●●●" : v);

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
      <p className="small">모든 참여자 화면 위쪽에 보여요. 예: "12/8(화) 오전 11시 미션 마감! 받은 미션은 추리 보드에서 인증해 주세요."</p>
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
  // 운영자 목록은 처음 운영자(admins[0])만 바꾼다(보안 규칙). 공동 운영자가 처음 운영자를 내보내거나 계정을 늘릴 수 없다.
  const founder = admins[0];
  const isFounder = user.uid === founder;

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
      setMsg(`공동 운영자로 지정했어요(${label}). 그 사람이 "지정됐는지 다시 확인"을 누르면 운영 화면으로 바뀌어요.`);
    } catch {
      setMsg("지정하지 못했어요. 명단에 연결된 계정은 운영자가 될 수 없어요.");
    }
  }

  async function remove(id) {
    if (id === founder) return window.alert("처음 운영자의 권한은 뺄 수 없어요.");
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
        운영자 목록은 <b>처음 운영자만</b> 바꿀 수 있고, 처음 운영자는 아무도 뺄 수 없어요.
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
                <strong>{notes[id] || (linked ? `${linked.name} (참여자)` : "운영자")}</strong>{id === founder && " · 처음 운영자"}{id === user.uid && " (나)"}
                <span className="small muted account-id"> 계정 번호 {id}</span>
              </span>
              {isFounder && id !== founder && <button className="text-btn" onClick={() => remove(id)}>권한 빼기</button>}
            </li>
          );
        })}
      </ul>
      {!isFounder && <p className="small muted">공동 운영자는 운영자 목록을 바꿀 수 없어요. 처음 운영자에게 부탁하세요.</p>}
      {isFounder && <form className="stack" onSubmit={add}>
        <label>
          <span className="panel-label">계정 번호</span>
          <input className="pk-input mono" value={uid} onChange={(e) => setUid(e.target.value)} autoComplete="off" placeholder="연결 전 화면에 나오는 계정 번호" aria-label="공동 운영자 계정 번호" />
        </label>
        <label>
          <span className="panel-label">메모 (누구 계정인지)</span>
          <input className="pk-input" value={memo} maxLength={20} onChange={(e) => setMemo(e.target.value)} placeholder="예: PL님" aria-label="공동 운영자 메모" />
        </label>
        <button className="pk-btn main sm" disabled={!uid.trim()}>공동 운영자로 지정</button>
      </form>}
      {msg && <p className="note" role="status">{msg}</p>}
    </Panel>
  );
}

function Setup() {
  const { config } = useApp();
  const isOwner = useIsOwner();
  const [showSecret, setShowSecret] = useState(false);
  const full = useFullRoster();
  const roster = full || [];
  const loaded = full !== null; // 명단을 다 읽기 전에 추가하면 번호(p001…)가 겹칠 수 있다
  const [text, setText] = useState("");
  const invites = useInvites();
  const emails = useAccountEmails();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [siteMode, setSiteMode] = useState("any");
  const [preview, setPreview] = useState(null); // 배정 미리 보기 결과(저장하지 않음)
  const [renameFrom, setRenameFrom] = useState(""); // 파트 이름 한꺼번에 바꾸기(두 파트를 한 파트로 합칠 때도)
  const [renameTo, setRenameTo] = useState("");
  const [edit, setEdit] = useState(null); // 고치는 중인 행: { pid, name, part, id }
  const why = (err) => saveErrorText(err, { isOwner });


  async function addPeople() {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return;
    const start = roster.reduce((m, r) => Math.max(m, Number(r.pid.slice(1)) || 0), 0);
    const ops = [];
    const bad = [];
    const dup = [];
    const used = new Set(roster.map((r) => r.email).filter(Boolean)); // 메일(아이디)은 한 사람에 하나
    lines.forEach((line, i) => {
      // "이름, 파트, 아이디" — 엑셀에서 세 칸을 복사해 붙여 넣으면 된다(탭으로 나뉜다). 아이디는 회사 메일의 @ 앞부분
      const { name, part, email, bad: badId } = parseRosterLine(line, MAIL_DOMAIN);
      if (!name || badId) bad.push(`${name || "(이름 없음)"}${badId ? `(${badId})` : ""}`);
      if (email && used.has(email)) dup.push(`${name}(${email})`);
      if (email) used.add(email);
      const pid = `p${String(start + i + 1).padStart(3, "0")}`;
      const invite = makeInviteCode();
      ops.push((b) => b.set(doc(db, "roster", pid), { name, part, email, uid: null, disqualified: false }));
      ops.push((b) => b.set(doc(db, "invites", invite), { personId: pid }));
      // 메일 → 명단 번호: 메일 인증을 마친 사람이 자기 이름을 찾는 데 쓴다(보안 규칙)
      if (email) ops.push((b) => b.set(doc(db, "mailIndex", email), { personId: pid }));
    });
    if (bad.length) return setMsg(`"이름, 파트, 아이디" 순서로 적어 주세요. 아이디는 회사 메일의 @ 앞부분(영문·숫자)이에요: ${bad.join(", ")}`);
    if (dup.length) return setMsg(`같은 아이디가 두 번 있어요(이미 명단에 있거나 입력에 겹침): ${dup.join(", ")}`);
    setBusy(true);
    setMsg("저장하는 중이에요…");
    const err = await trySave(() => commitInChunks(ops));
    setBusy(false);
    if (err) return setMsg(await why(err)); // 입력한 내용은 그대로 둔다(다시 누를 수 있게)
    setText("");
    setMsg(`${lines.length}명을 추가했어요.`);
  }

  async function removePerson(r) {
    if (r.uid) return window.alert("이미 가입한 사람은 지울 수 없어요. 먼저 연결 해제하세요.");
    if (!window.confirm(`${r.name}님을 명단에서 지울까요?`)) return;
    const b = writeBatch(db);
    b.delete(doc(db, "roster", r.pid));
    if (invites[r.pid]) b.delete(doc(db, "invites", invites[r.pid]));
    if (r.email) b.delete(doc(db, "mailIndex", r.email));
    const err = await trySave(() => b.commit());
    setMsg(err ? await why(err) : `${r.name}님을 명단에서 지웠어요.`);
  }

  // 파트 이름 한꺼번에 바꾸기: 그 파트인 사람 모두의 파트를 새 이름으로. 이미 있는 이름이면 두 파트가 한 파트로 합쳐진다
  // (예: "PFA"와 "VSEM"을 "PFA/VSEM"으로 — 같은 파트끼리는 짝이 안 되고, 파트 단서·파트 순위도 한 파트로 본다)
  async function renamePart(e) {
    e.preventDefault();
    const from = renameFrom;
    const to = renameTo.trim();
    if (!from || !to) return setMsg("바꿀 파트를 고르고 새 이름을 적어 주세요.");
    if (to === from) return undefined;
    const targets = roster.filter((r) => (r.part || "").trim() === from);
    if (!targets.length) return setMsg(`"${from}" 파트인 사람이 없어요.`);
    const merging = roster.some((r) => (r.part || "").trim() === to);
    if (!window.confirm(`"${from}" ${targets.length}명의 파트를 "${to}"(으)로 바꿀까요?${merging ? `\n\n이미 있는 "${to}" 파트와 합쳐져 한 파트가 돼요(서로 마니또가 되지 않고, 파트 단서·파트 순위도 한 파트로 봐요).` : ""}`)) return undefined;
    const ops = targets.map((r) => (b) => b.update(doc(db, "roster", r.pid), { part: to }));
    setBusy(true);
    setMsg("저장하는 중이에요…");
    const err = await trySave(() => commitInChunks(ops));
    setBusy(false);
    if (err) return setMsg(await why(err));
    setRenameFrom("");
    setRenameTo("");
    setPreview(null);
    return setMsg(`"${from}" ${targets.length}명의 파트를 "${to}"(으)로 바꿨어요.${merging ? " 두 파트가 한 파트로 합쳐졌어요." : ""}`
      + (config.assignVer ? " 이미 배정한 뒤라면 '배정하기'를 다시 눌러야 반영돼요." : ""));
  }

  // 한 사람 고치기(명단 표의 "수정"): 이름·파트·아이디. 아이디(회사 메일)를 바꾸면 메일 인증으로 연결되는 주소가 바뀐다
  // (아이디는 처음 운영자만, 보안 규칙. mailIndex도 같이 고친다). 이름·파트는 공동 운영자도 고칠 수 있다.
  const startEdit = (r) => { setMsg(""); setEdit({ pid: r.pid, name: r.name || "", part: r.part || "", id: shortId(r.email) }); };
  async function saveEdit(r) {
    const name = edit.name.trim();
    const part = edit.part.trim() || null;
    if (!name) return setMsg("이름을 적어 주세요.");
    const { email: parsed, bad } = parseRosterLine(`${name},,${edit.id}`, MAIL_DOMAIN);
    const email = isOwner ? parsed : r.email || null; // 공동 운영자는 아이디를 바꿀 수 없다
    if (isOwner && bad) return setMsg(`아이디는 회사 메일의 @ 앞부분(영문·숫자)으로 적어 주세요: ${bad}`);
    if (email && roster.some((x) => x.pid !== r.pid && x.email === email)) return setMsg(`이미 다른 사람이 쓰는 아이디예요: ${email}`);
    const mailChanged = email !== (r.email || null);
    const changed = name !== r.name || part !== (r.part || null) || mailChanged;
    if (!changed) return setEdit(null);
    const b = writeBatch(db);
    b.update(doc(db, "roster", r.pid), { name, part, ...(mailChanged ? { email } : {}) });
    if (mailChanged && r.email) b.delete(doc(db, "mailIndex", r.email));
    if (mailChanged && email) b.set(doc(db, "mailIndex", email), { personId: r.pid });
    setBusy(true);
    setMsg("저장하는 중이에요…");
    const err = await trySave(() => b.commit());
    setBusy(false);
    if (err) return setMsg(await why(err));
    setEdit(null);
    setMsg(`${name}님 정보를 저장했어요.`
      + (mailChanged && r.uid ? " 이미 연결된 계정은 그대로예요." : "")
      + (part !== (r.part || null) && config.assignVer ? " 이미 배정한 뒤라면 '배정하기'를 다시 눌러야 배정(같은 파트 피하기)과 파트 단서에 반영돼요." : ""));
  }

  async function assign() {
    const blank = roster.filter((r) => !(r.part || "").trim()).length;
    const partWarn = blank === roster.length
      ? "\n\n⚠ 파트가 하나도 입력되지 않았어요. 같은 파트끼리 피하는 배정, 파트 단서, 파트 순위가 모두 빠져요."
      : blank ? `\n\n⚠ 파트가 비어 있는 사람이 ${blank}명 있어요. 이 사람들은 누구와도 짝이 될 수 있고 파트 순위에서 빠져요.` : "";
    if (!window.confirm(`마니또를 배정할까요? 다시 배정하면 이전 배정과 코드는 모두 없어져요.${partWarn}`)) return;
    setBusy(true);
    assigningNow = true;
    setMsg("배정을 저장하는 중이에요… \"○명 배정 완료\"가 뜰 때까지 다른 버튼을 누르지 말아 주세요.");
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
        + (siteMatched || !roster.some((r) => r.loc) ? "" : " 근무지가 다른 짝은 원격 미션 카드가 나와요.")
        + " 누가 누구의 마니또인지는 아래 '짝 현황' 표에서 볼 수 있어요.");
    } catch (err) {
      setMsg(err?.code === "permission-denied"
        ? "배정을 저장하지 못했어요(권한 없음). Firebase 콘솔에 게시된 보안 규칙이 예전 것이면 이렇게 돼요. 최신 firestore.rules를 게시한 뒤 '배정하기'를 다시 눌러 주세요."
        : err.message);
    } finally {
      assigningNow = false;
      setBusy(false);
    }
  }

  const sorted = [...roster].sort((a, b) => a.pid.localeCompare(b.pid));
  const partCount = {};
  for (const r of roster) if (r.part) partCount[r.part] = (partCount[r.part] || 0) + 1;
  const parts = Object.entries(partCount).sort((a, b) => b[1] - a[1]);
  const inviteText = sorted.map((r) => `${r.name}\t${invites[r.pid] || ""}`).join("\n");
  const hasLoc = roster.some((r) => r.loc); // 근무지는 예전에 넣은 명단에만 있다(지금은 입력하지 않는다)
  const joined = roster.filter((r) => r.uid).length;
  const notJoined = sorted.filter((r) => !r.uid);
  const shortId = (email) => (email ? (email.endsWith(`@${MAIL_DOMAIN}`) ? email.slice(0, -MAIL_DOMAIN.length - 1) : email) : "");

  return (
    <>
      <Panel title="1. 명단">
        <p className="small">
          한 줄에 한 명, <b>"이름, 파트, 아이디"</b> 순서. 엑셀에서 세 칸을 복사해 그대로 붙여 넣으면 돼요.
          아이디는 Knox ID(회사 메일의 @ 앞부분)예요. 뒤에 @{MAIL_DOMAIN}이 붙어요. 참여자는 이 아이디로 가입하고, 그 메일로 온 인증 링크를 누르면 명단의 자기 이름과 자동으로 연결돼요.
          같은 파트끼리는 마니또가 되지 않게 배정하고, 최종 지목이 열릴 때 "내 마니또는 ○○ 소속" 단서가 자동으로 나가요. 파트 순위도 이 파트로 매겨요.
        </p>
        <textarea className="pk-input" rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder={"홍길동\t공정파트\tgildong.hong\n김철수\t소자파트\tcs.kim"} />
        <button className="pk-btn main" onClick={addPeople} disabled={busy || !loaded || !isOwner}>명단에 추가</button>
        <p className="small muted">"명단에 추가"를 누르면 바로 저장돼요(따로 저장 버튼은 없어요). 아래 표에 나오고 "○명을 추가했어요"가 뜨면 저장된 거예요. 한 명씩 고치려면 아래 표의 "수정"을 눌러 주세요.</p>
        {!isOwner && <p className="small muted">명단 추가·삭제와 초대 코드는 처음 운영자만 할 수 있어요.</p>}
      </Panel>

      <Panel title="2. 마니또 배정">
        <p className="small">
          <b>배정은 미션을 시작하는 날에 누르세요.</b> 배정하는 순간 가입한 사람에게 자기 대상이 보여요.
          명단에 있는 사람은 가입 여부와 상관없이 모두 배정돼요(나중에 가입해도 그대로 참여). 참여하지 않겠다는 사람은 배정 전에 명단에서 지워 주세요.
          {roster.length > 0 && ` 지금 가입 ${joined} / ${roster.length}명.`}
          {notJoined.length > 0 && notJoined.length <= 20 && ` 아직 가입 안 한 사람: ${notJoined.map((r) => r.name).join(", ")}.`}
        </p>
        {hasLoc && (
          <>
            <div className="chip-row">
              <button className={siteMode === "any" ? "chip is-on" : "chip"} onClick={() => setSiteMode("any")}>근무지 상관없이</button>
              <button className={siteMode === "same" ? "chip is-on" : "chip"} onClick={() => setSiteMode("same")}>같은 근무지끼리만</button>
            </div>
            <p className="small">
              {siteMode === "any"
                ? "다른 근무지끼리도 짝이 될 수 있어요. 대상이 다른 근무지면 직접 가지 않아도 되는 미션 카드만 나와요."
                : "같은 근무지끼리만 짝을 지어요. 실물 미션을 모두 할 수 있고, 추리 보드에서 다른 근무지가 후보에서 빠져요."}
            </p>
          </>
        )}
        <p className="small">
          {parts.length
            ? <>파트: {parts.map(([name, n]) => `${name} ${n}명`).join(" · ")}{roster.length - parts.reduce((a, [, n]) => a + n, 0) > 0 && ` · 파트 없음 ${roster.length - parts.reduce((a, [, n]) => a + n, 0)}명`}.
              {parts[0][1] > Math.floor(roster.length / 2) && ` ${parts[0][0]}가 전체의 절반을 넘어서 같은 파트끼리도 일부 짝이 돼요.`}
              {parts.length === 2 && roster.length === parts[0][1] + parts[1][1] && " 파트가 둘뿐이라 마지막 파트 단서는 새 정보가 되지 않아요(처음부터 다른 파트로 정해져 있어요)."}
              {parts.some(([, n]) => n < 6) && " 인원이 적은 파트는 파트 단서만으로 마니또가 거의 드러나요."} 배정한 뒤 파트를 고쳤다면 다시 배정해야 반영돼요.</>
            : "파트가 입력되지 않았어요. 같은 파트 피하기·파트 단서·파트 순위가 빠져요(명단 표의 \"수정\"으로 넣을 수 있어요)."}
        </p>
        {parts.length > 0 && (
          <form className="inline part-rename" onSubmit={renamePart} aria-label="파트 이름 한꺼번에 바꾸기">
            <span className="small">파트 이름 한꺼번에 바꾸기(두 파트를 한 파트로 합칠 때도):</span>
            <select className="pk-input" value={renameFrom} onChange={(e) => setRenameFrom(e.target.value)} aria-label="바꿀 파트">
              <option value="">파트 고르기</option>
              {parts.map(([name, n]) => <option key={name} value={name}>{name} ({n}명)</option>)}
            </select>
            <input className="pk-input" value={renameTo} maxLength={20} onChange={(e) => setRenameTo(e.target.value)} placeholder="새 이름 (예: PFA/VSEM)" aria-label="새 파트 이름" />
            <button className="pk-btn sm" disabled={busy || !renameFrom || !renameTo.trim()}>바꾸기</button>
          </form>
        )}
        <button className="pk-btn" onClick={() => setPreview(previewAssignments(
          roster.map((r) => ({ pid: r.pid, part: (r.part || "").trim() || null, loc: r.loc || null })), { runs: 300, siteMode }))}
          disabled={busy || roster.length < 3}>미리 보기 (저장 안 함)</button>
        {preview && <AssignPreview p={preview} joined={joined} />}
        {!busy && <AssignCheck />}
        <button className="pk-btn main" onClick={assign} disabled={busy || roster.length < 3}>배정하기</button>
      </Panel>

      {msg && <p className="note banner" role="status">{msg}</p>}

      <Panel title={`명단 ${roster.length}명 (가입 ${joined}명)`}>
        <div className="reveal-row">
          <button className="pk-btn sm" aria-pressed={showSecret} onClick={() => setShowSecret(!showSecret)}>{showSecret ? "초대 코드·메일 가리기" : "초대 코드·메일 보기"}</button>
          <button className="pk-btn sm" onClick={() => navigator.clipboard.writeText(inviteText)}>이름과 초대 코드 복사</button>
        </div>
        <p className="small">
          참여자는 아이디로 가입해 회사 메일의 인증 링크를 누르면 연결돼요. <b>초대 코드는 인증 메일이 오지 않는 사람에게만</b> 본인에게 직접 알려 주세요(예비).
          아이디가 "없음"인 사람은 초대 코드로만 가입할 수 있어요. 이름·파트·아이디는 줄 끝의 "수정"으로 고쳐요.
        </p>
        {roster.pending && <p className="error" role="status">⏳ 아직 서버에 저장되지 않은 변경이 있어요. 이 표시가 사라지기 전에 새로 고치면 그 변경은 사라져요.</p>}
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>이름</th><th>파트</th><th>아이디</th><th>초대 코드</th><th>연결된 메일</th><th></th></tr></thead>
            <tbody>
              {sorted.map((r) => (edit?.pid === r.pid ? (
                <tr key={r.pid} className="editing">
                  <td><input className="pk-input cell" value={edit.name} maxLength={20} onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="이름" /></td>
                  <td><input className="pk-input cell" value={edit.part} maxLength={20} onChange={(e) => setEdit({ ...edit, part: e.target.value })} placeholder="파트 없음" aria-label="파트" /></td>
                  <td className="mail-id">{isOwner
                    ? <input className="pk-input cell mono" value={edit.id} maxLength={60} onChange={(e) => setEdit({ ...edit, id: e.target.value })} placeholder="Knox ID" autoCapitalize="none" autoComplete="off" aria-label="아이디" />
                    : shortId(r.email) || "없음"}</td>
                  <td className="mono">{mask(invites[r.pid], showSecret) || "-"}</td>
                  <td className="email">{r.uid ? mask(emails[r.uid], showSecret) || "연결됨" : "-"}</td>
                  <td className="row-actions">
                    <button className="pk-btn main sm" disabled={busy} onClick={() => saveEdit(r)}>저장</button>
                    <button className="text-btn" disabled={busy} onClick={() => setEdit(null)}>취소</button>
                  </td>
                </tr>
              ) : (
                <tr key={r.pid}>
                  <td>{r.name}</td>
                  <td>{r.part || "미정"}</td>
                  <td className="mail-id">{shortId(r.email) || "없음"}</td>
                  <td className="mono">{mask(invites[r.pid], showSecret) || "-"}</td>
                  <td className="email">{r.uid ? mask(emails[r.uid], showSecret) || "연결됨" : "-"}</td>
                  <td className="row-actions">
                    <button className="text-btn" onClick={() => startEdit(r)}>수정</button>
                    {isOwner && (r.uid
                      ? <button className="text-btn" onClick={async () => { const c = await unlinkPerson(r, invites[r.pid], emails[r.uid]); if (c) setMsg(`${r.name}님 연결을 풀었어요. 새 초대 코드: ${c}`); }}>연결 해제</button>
                      : <button className="text-btn" onClick={() => removePerson(r)}>삭제</button>)}
                  </td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      </Panel>

      {loaded && <InviteMail roster={roster} />}
    </>
  );
}

// 배정 점검: 배정이 끝까지 저장됐는지 보고, 덜 됐으면 고치는 방법을 알려 준다(lib/pairs.js assignmentHealth).
// 배정은 ① 짝·코드 ② 파트 단서 ③ 설정 순서로 나눠 저장하는데, "배정 완료"가 뜨기 전에 미션을 시작하면 ②③이 보안 규칙에 거부돼 빠진다
// (11/18 실제로 있었던 일. 지금은 advance가 막는다). 미션이 시작된 뒤에는 화면에서 고칠 수 없어 Firebase 콘솔에서 값을 넣는다.
function AssignCheck() {
  const { config } = useApp();
  const isOwner = useIsOwner();
  const roster = useFullRoster();
  const assignments = useColl("assignments");
  const [hints, setHints] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    getDocs(query(collection(db, "clues"), where("idx", "==", PART_HINT_IDX)))
      .then((s) => alive && setHints(s.docs.map((d) => d.data())), () => alive && setHints([]));
    return () => { alive = false; };
  }, [tick, config.assignVer]);
  if (!roster || !assignments || !hints) return null;
  const h = assignmentHealth({ roster, assignments, hints, config });
  const phase = config.phase;
  if (phase === PHASE.SETUP && (h.status === "none" || h.status === "ok")) return null; // 배정 전이거나 정상: 준비 단계에서는 조용히
  if (h.status === "ok") {
    return <p className="note banner" role="status">배정 점검: 정상이에요. 명단 {h.n}명 모두 짝이 있고, 파트 단서 {h.needHints}건과 설정(회차 {config.assignVer})이 맞아요. 참여자 화면에 "아직 배정 전이에요"가 보이면 새로 고치면 돼요.</p>;
  }

  // 짝은 그대로 두고 마무리(준비 단계에서만 저장된다): 파트 단서를 다시 쓰고 설정을 맞춘다
  async function finish() {
    setBusy(true);
    setMsg("");
    try {
      const partOf = Object.fromEntries(roster.map((r) => [r.pid, (r.part || "").trim()]));
      const newVer = (config.assignVer ?? 0) + 1;
      const ops = Object.entries(assignments).filter(([g]) => partOf[g]).map(([g, a]) => (b) => b.set(doc(db, "clues", `${a.receiverPid}_${PART_HINT_IDX}`), {
        receiverPid: a.receiverPid, idx: PART_HINT_IDX, answer: partOf[g], ver: newVer,
      }));
      await commitInChunks(ops);
      await updateDoc(doc(db, "config", "app"), { assignVer: newVer, partExcluded: h.want.partExcluded, siteMatched: h.want.siteMatched });
      setTick((t) => t + 1);
      setMsg("배정을 마무리했어요(짝은 그대로예요). 이제 \"다음 단계로: 미션 진행\"을 눌러 주세요.");
    } catch (err) {
      setMsg(err?.code === "permission-denied" ? "저장이 거부됐어요. 처음 운영자 계정인지, 준비 단계인지 확인해 주세요." : `마무리하지 못했어요(${err?.code || err?.message}).`);
    } finally {
      setBusy(false);
    }
  }

  const back = <>Firebase 콘솔 → Firestore Database → <code>config</code> → <code>app</code> 문서에서 <code>phase</code>를 <b>0</b>(숫자)으로 바꾸고, 이 화면을 새로 고쳐 주세요.</>;
  return (
    <div className="error banner" role="alert" aria-label="배정 점검">
      {h.status === "none" && (
        <>
          <p><b>⚠ 배정이 저장되지 않았어요</b>(명단 {h.n}명, 짝 0건). "배정 완료"가 뜨기 전에 미션을 시작하면 이렇게 돼요.</p>
          <ol className="small">
            <li>{back}</li>
            <li>"2. 마니또 배정"에서 "배정하기"를 누르고 <b>"○명 배정 완료"가 뜰 때까지</b> 기다려 주세요.</li>
            <li>그다음 "다음 단계로: 미션 진행"을 눌러 주세요. 아직 아무도 미션을 하지 못한 상태라 잃는 것은 없어요.</li>
          </ol>
        </>
      )}
      {h.status === "mismatch" && (
        <>
          <p><b>⚠ 명단과 배정이 맞지 않아요</b>(명단 {h.n}명, 짝 {h.assigned}건). 다시 배정해야 해요. 다시 배정하면 모든 사람의 대상이 바뀌어요.</p>
          {phase !== PHASE.SETUP && <ol className="small"><li>{back}</li><li>"배정하기"를 누르고 "○명 배정 완료"를 확인한 뒤 "다음 단계로: 미션 진행"을 눌러 주세요.</li></ol>}
        </>
      )}
      {h.status === "partial" && (
        <>
          <p>
            <b>⚠ 짝은 모두 저장됐지만({h.assigned}명) 배정 마무리가 빠졌어요.</b> 참여자는 대상을 보고 미션을 할 수 있어요.
            다만 이대로 두면 최종 지목 때 "마니또의 파트" 단서가 안 나오고, 추리 보드가 내 파트를 후보에서 빼지 않아요. <b>짝을 다시 뽑지 않고</b> 고칠 수 있어요.
          </p>
          {phase === PHASE.SETUP ? (
            <>
              <button className="pk-btn main" disabled={busy || !isOwner} onClick={finish}>배정 마무리 (짝은 그대로)</button>
              {!isOwner && <p className="small">처음 운영자만 할 수 있어요.</p>}
            </>
          ) : h.hintsUsable ? (
            <>
              <p className="small">Firebase 콘솔 → Firestore Database → <code>config</code> → <code>app</code> 문서에 아래 세 칸을 넣어 주세요(있으면 값만 고치기). 넣으면 이 경고가 사라져요.</p>
              <ul className="small mono">
                <li>assignVer (number) = {h.want.assignVer}</li>
                <li>partExcluded (boolean) = {String(h.want.partExcluded)}</li>
                <li>siteMatched (boolean) = {String(h.want.siteMatched)}</li>
              </ul>
            </>
          ) : (
            <ol className="small">
              <li>{back} (파트 단서 {h.hintCount} / {h.needHints}건만 저장돼 있어 화면에서 다시 써야 해요. 1~2분이면 돼요)</li>
              <li>"2. 마니또 배정"에 나오는 <b>"배정 마무리 (짝은 그대로)"</b>를 눌러 주세요. "배정하기"는 누르지 마세요(대상이 전부 바뀌어요).</li>
              <li>그다음 "다음 단계로: 미션 진행"을 눌러 주세요.</li>
            </ol>
          )}
        </>
      )}
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}

// 배정 미리 보기: 실제 명단으로 배정을 여러 번 돌려 본 결과(lib/assign.js previewAssignments). 누가 누구를 맡는지는 보이지 않는다.
function AssignPreview({ p, joined }) {
  const parts = Object.entries(p.sizes).sort((a, b) => b[1] - a[1]);
  const pct = (x, total) => `${Math.round((x / total) * 100)}%`;
  const ok = p.problems.length === 0 && p.sameMax === 0 && p.similar.length === 0;
  const poolAfter = parts.length ? [Math.min(...parts.map(([, k]) => k)), Math.max(...parts.map(([, k]) => k))] : null;
  return (
    <div className={ok ? "note" : "error"} role="status" aria-label="배정 미리 보기">
      <p><b>배정을 {p.runs}번 돌려 봤어요(저장하지 않았어요).</b> {ok ? "문제없어요." : "아래를 확인해 주세요."}</p>
      <ul className="small">
        <li>명단 {p.n}명(가입 {joined}명, 가입 안 한 사람도 같이 배정돼요). 파트: {parts.map(([name, k]) => `${name} ${k}명`).join(" · ") || "없음"}{p.blank ? ` · 파트 없음 ${p.blank}명` : ""}</li>
        <li>모두 한 명씩 맡고 한 명에게서 받아요(한 줄로 이어진 원). 자기 자신·맞마니또: {p.problems.length ? `⚠ ${p.problems.join(", ")}` : "없음"}</li>
        <li>같은 파트 짝: {p.sameMax === 0 ? "0쌍" : p.unavoidable
          ? `${p.sameMin === p.sameMax ? p.sameMin : `${p.sameMin}~${p.sameMax}`}쌍 (가장 큰 파트가 ${p.largest}명으로 전체의 절반을 넘어서 피할 수 없어요)`
          : `⚠ ${p.sameMin}~${p.sameMax}쌍`}</li>
        {p.blank > 0 && <li>파트가 없는 {p.blank}명은 누구와도 짝이 될 수 있어요(명단 표의 "수정"으로 넣어 주세요).</li>}
        {p.similar.map((names) => <li key={names.join()}>⚠ 띄어쓰기·대소문자만 다른 파트 이름: {names.map((x) => `"${x}"`).join(", ")}. 같은 파트라면 명단 표의 "수정"으로 하나로 맞춰 주세요(지금은 다른 파트로 봐서 같은 파트끼리 짝이 될 수 있어요).</li>)}
        {parts.length > 1 && (
          <li>
            추리 후보: 처음에는 내 파트를 뺀 사람(파트에 따라 {p.n - parts[0][1]}~{p.n - parts[parts.length - 1][1]}명), 최종 지목 때 마니또의 파트가 공개되면 그 파트 사람({poolAfter[0]}~{poolAfter[1]}명).
          </li>
        )}
      </ul>
      {parts.length > 1 && (
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>마니또의 파트 ↓ / 대상의 파트 →</th>{parts.map(([name]) => <th key={name}>{name}</th>)}</tr></thead>
            <tbody>
              {parts.map(([a]) => {
                const row = p.flow[a] || {};
                const total = Object.values(row).reduce((x, y) => x + y, 0) || 1;
                return <tr key={a}><td>{a}</td>{parts.map(([b]) => <td key={b}>{row[b] ? pct(row[b], total) : "-"}</td>)}</tr>;
              })}
            </tbody>
          </table>
          <p className="small muted">각 줄: 그 파트 사람이 맡게 되는 대상의 파트 비율({p.runs}번 평균). 대각선(같은 파트)이 "-"이면 같은 파트 짝이 없다는 뜻이에요.</p>
        </div>
      )}
    </div>
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
  const missions = useColl("giverMissions") || {};
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
    // 주차를 올리면 그때까지 아무것도 받지 못한 사람에게 수호천사가 자동으로 연결된다(되돌릴 수 없어서 한 번 묻는다)
    if (week > config.week && !window.confirm(`${week}주차를 열까요?\n\n· ${config.week}주차 미션이 마감돼요. 아직 완료를 알리지 않은 마니또는 ${config.week}주차를 더 할 수 없어요(받은 미션 인증은 그대로 돼요).\n· 지금까지 마니또에게 아무것도 받지 못한 사람이 있으면, 수호천사 지원자가 먼저 지원한 순서대로 자동 연결돼요(운영자가 고르지 않아요).\n\n정해진 시각에만 눌러 주세요.`)) return;
    try {
      if (week > config.week) setBoardMsg(await openWeek(week));
      else await updateDoc(doc(db, "config", "app"), { week });
    } catch {
      return setBoardMsg("주차를 바꾸지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    }
  }

  // 단서는 주차마다 2개까지만(공개 개수 ≤ 2 × 주차). 같은 주에 두 번 누르는 실수를 막는다. 보안 규칙도 같은 기준이다.
  const released = config.cluesReleased || 0;
  const clueCap = Math.min(CLUE_COUNT, 2 * (config.week || 1));
  const canRelease = released < clueCap;

  const publishBoard = () => publishPartBoard(roster, missions, config.week);
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
        <p className="small">
          주차를 올리면 그 주차 미션이 열려요. 3주차는 칭찬 카드예요. 2·3주차를 열 때, 그때까지 마니또에게 아무것도 받지 못한 사람에게
          수호천사가 먼저 지원한 순서대로 자동 연결돼요.
        </p>
      </Panel>

      <Panel title={`단서 공개 (${released} / ${CLUE_COUNT})`}>
        <button className="pk-btn gold" onClick={releaseClues} disabled={!canRelease}>이번 주 단서 2개 공개</button>
        <p className="small">
          매주 금요일에 한 번 눌러 주세요. 전원에게 동시에 공개돼요. 누르면 파트 순위도 같이 새로 발표돼요.
          {!canRelease && released < CLUE_COUNT && ` ${config.week}주차 단서는 이미 공개했어요. 다음 단서는 주차를 올린 뒤에 공개할 수 있어요(주차마다 2개까지).`}
          {released >= CLUE_COUNT && " 단서 6개를 모두 공개했어요."}
        </p>
      </Panel>

      <ScheduleBox />

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
                  <td>{doneCountOf(missions[r.pid])}</td>
                  <td>{received[r.pid] || 0}</td>
                  <td><button className="text-btn" onClick={() => toggleNudge(r.pid)}>{nudges.has(r.pid) ? "끄기" : "켜기"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* 가입 안내 메일은 미션 진행 단계에서는 보이지 않는다(사용자가 정함, 11/23: "이제 가입하도록 메일은 보낼 필요 없다"). 준비 단계에는 남아 있다. */}
      {roster.some((r) => !progress[r.pid]?.profileDone) && <ProfileMail roster={roster} progress={progress} />}
    </>
  );
}

// 재촉 메일: 인증 안 한 대상·미션 안 한 마니또(InviteMail.jsx ReminderMail). 짝 현황과 같은 구독을 쓴다(읽기가 늘지 않음).
function Reminders() {
  const { config } = useApp();
  const roster = useFullRoster();
  const { ready, rows } = usePairs();
  if (!roster || !ready) return null;
  return <ReminderMail roster={roster} rows={rows} week={config.week || 1} phase={config.phase} />;
}

// 계정 연결 관리(미션 시작 후). 엉뚱한 사람이 연결됐거나, 메일을 잘못 적었거나, 비밀번호를 못 찾을 때 연결을 푼다.
function Accounts() {
  const isOwner = useIsOwner();
  const [showSecret, setShowSecret] = useState(false);
  const roster = useFullRoster() || [];
  const invites = useInvites();
  const emails = useAccountEmails();
  const [msg, setMsg] = useState("");
  const rows = [...roster].sort(byPartThenName);
  return (
    <Panel title="계정 연결">
      <p className="small">
        이름마다 연결된 메일이 보여요. 다른 사람이 연결됐거나 메일·비밀번호 문제로 새 계정을 써야 하면 "연결 해제"를 누르고, 새로 나온 초대 코드를 본인에게 전달하세요. 기록은 그대로 이어져요.
        아직 연결하지 않은 사람의 초대 코드가 다른 사람에게 알려졌을 수 있으면 "코드 새로 만들기"로 바꾸세요(먼저 연결하는 사람이 그 이름을 가져가요).
      </p>
      {!isOwner && <p className="small muted">연결 해제와 초대 코드 새로 만들기는 처음 운영자만 할 수 있어요.</p>}
      <button className="pk-btn sm" aria-pressed={showSecret} onClick={() => setShowSecret(!showSecret)}>{showSecret ? "초대 코드·메일 가리기" : "초대 코드·메일 보기"}</button>
      {msg && <p className="note" role="status">{msg}</p>}
      <div className="table-wrap">
        <table className="pk-table">
          <thead><tr><th>파트</th><th>이름</th><th>초대 코드</th><th>연결된 메일</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pid} className={r.uid ? "" : "warn"}>
                <td>{r.part || "-"}</td>
                <td>{r.name}</td>
                <td className="mono">{mask(invites[r.pid], showSecret) || "-"}</td>
                <td className="email">{r.uid ? mask(emails[r.uid], showSecret) || "연결됨" : "미연결"}</td>
                <td>{isOwner && (r.uid
                  ? <button className="text-btn" onClick={async () => { const c = await unlinkPerson(r, invites[r.pid], emails[r.uid]); if (c) setMsg(`${r.name}님 연결을 풀었어요. 새 초대 코드: ${c}`); }}>연결 해제</button>
                  : <button className="text-btn" onClick={async () => { const c = await renewInvite(r, invites[r.pid]); if (c) setMsg(`${r.name}님 초대 코드를 새로 만들었어요: ${c} (예전 코드는 못 써요)`); }}>코드 새로 만들기</button>)}</td>
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
  const guesses = useColl("guesses") || {};
  const rows = [...roster].filter((r) => r.uid).sort(byPartThenName);
  const did = (pid) => Boolean(guesses[pid]?.guessPid);
  const notYet = rows.filter((r) => !did(r.pid));
  return (
    <Panel title={`최종 지목 중 (안 한 사람 ${notYet.length}명)`}>
      <p className="small">누구를 지목했는지와 정답 여부는 아래 "짝 현황" 표에서 볼 수 있어요. 지목을 안 하면 그 사람의 마니또가 은신 응모권 2장을 받아요(미션이 1건 이상 인증되고 단서 6칸을 다 낸 마니또만).</p>
      {notYet.length > 0 && <p className="note">아직 안 한 사람: {notYet.map((r) => r.name).join(", ")}</p>}
      <div className="table-wrap">
        <table className="pk-table">
          <thead><tr><th>파트</th><th>이름</th><th>지목</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pid} className={did(r.pid) ? "" : "warn"}>
                <td>{r.part || "-"}</td><td>{r.name}</td><td>{did(r.pid) ? "O" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

const NOTE_KINDS = ["hide", "thanks", "void"];
const NOTE_LABEL = { hide: "피드에서 가린", thanks: "감사 답장을 지운", void: "무효 처리한" };

function Moderation() {
  const { nameOf } = useApp();
  const roster = useFullRoster() || [];
  const feed = useColl("feed") || {};
  const deliveries = useColl("deliveries") || {};
  const notes = useColl("modNotes") || {}; // 가리거나 지우거나 무효 처리한 이유(글쓴이에게 보인다)
  // 카드 확인이 의미 있는 인증: 1·2주차, 그리고 3주차 칭찬과 함께 보통·도전 카드를 고른 것(칭찬 알림에 card가 있다)
  const cardSlot = (r) => r.slot !== PRAISE_SLOT || Boolean(deliveries[`${r.receiverPid}_${r.slot}`]?.card);
  const [items, setItems] = useState([]);
  useEffect(() => onSnapshot(collection(db, "redemptions"), (s) =>
    setItems(s.docs.map((d) => ({ code: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)))
  ), []);

  // 이유 기록(사용자가 정함, 11/23: "무슨 이유로 삭제했는지 기록해서 그 사람이 보게"): modNotes/{인증 코드}의 hide·thanks·void 칸.
  // 글쓴이(받는 사람)만 추리 보드 "내가 인증한 것"에서 보고, 그 미션의 마니또는 못 본다(보안 규칙).
  // 이유는 비워 둘 수 있다(비워도 "운영진이 지웠다"는 기록은 남는다). 되돌리면(다시 보이기·무효 취소) 그 칸을 지운다.
  const askReason = (what) => {
    const v = window.prompt(`${what}\n\n이유를 적어 주세요. 쓴 사람에게만 보여요(마니또에게는 안 보여요). 비워 둬도 돼요.`, "");
    return v === null ? null : v.trim().slice(0, 300);
  };
  // 이유는 원래 작업(가리기 등)이 저장된 뒤에 따로 쓴다: 콘솔의 보안 규칙이 예전 것이어도 가리기·지우기는 되게(이유만 실패하면 알린다)
  const NOTE_FAIL = "이유는 저장하지 못했어요. 콘솔의 보안 규칙이 예전 것일 수 있어요(맨 위 규칙 버전 경고 확인).";
  const writeNote = (r, kind, reason) =>
    setDoc(doc(db, "modNotes", r.code), { receiverPid: r.receiverPid, slot: r.slot, [kind]: { reason, at: serverTimestamp() } }, { merge: true })
      .catch(() => window.alert(`${NOTE_LABEL[kind]} 것은 저장했어요. ${NOTE_FAIL}`));
  const clearNote = (r, kind) => (notes[r.code]?.[kind]
    ? updateDoc(doc(db, "modNotes", r.code), { [kind]: deleteField() }).catch(() => window.alert(`${NOTE_LABEL[kind]} 이유를 지우지 못했어요. 잠시 뒤 다시 확인해 주세요.`))
    : null);
  // 가리거나 무효 처리하면 글쓴이의 고친 횟수를 0으로 되돌린다(운영진이 지운 뒤에도 다시 고쳐 쓸 수 있게). 이것도 원래 작업 뒤에 따로.
  const resetEdits = (r) => (r.edits
    ? updateDoc(doc(db, "redemptions", r.code), { edits: 0 }).catch(() => window.alert(`고칠 수 있는 횟수를 되돌리지 못했어요. ${NOTE_FAIL.replace("이유는 저장하지 못했어요. ", "")}`))
    : null);

  // 인증 문서와 익명 피드 글(받는 사람 정보가 없는 별도 문서)을 같이 바꾼다.
  const toggleVoid = async (r) => {
    let reason = "";
    if (!r.voided) {
      reason = askReason(`${nameOf(r.receiverPid)}님의 ${r.slot}주차 인증을 무효 처리할까요? (인증 응모권과 마니또의 그 미션 응모권이 빠져요)`);
      if (reason === null) return;
    }
    const b = writeBatch(db);
    b.update(doc(db, "redemptions", r.code), { voided: !r.voided });
    if (r.feedId) b.update(doc(db, "feed", r.feedId), { voided: !r.voided });
    const ok = await b.commit().then(() => true, () => { window.alert("바꾸지 못했어요. 잠시 뒤 다시 눌러 주세요."); return false; });
    if (!ok) return;
    forgetFeed(); // 이 기기의 피드 탭에 바로 반영되게
    if (r.feedId) await patchFeedDigest(r.feedId, { voided: !r.voided }).catch(() => {}); // 참여자가 읽는 피드 요약에도 바로
    if (!r.voided) { await resetEdits(r); await writeNote(r, "void", reason); } else await clearNote(r, "void");
  };
  // 피드에서만 가리기(응모권과 무관): 막말 후기로 마니또의 응모권을 깎으려는 경우에도 쓸 수 있게 무효 처리와 따로 둔다.
  // 피드 글은 참여자 누구나 읽을 수 있어서, 가릴 때는 후기를 비우고 원문은 운영자만 읽는 hiddenFeed로 옮긴다(보안 규칙이 확인).
  const toggleHide = async (r) => {
    const f = feed[r.feedId];
    let reason = "";
    if (!f.hidden) {
      reason = askReason(`${nameOf(r.receiverPid)}님의 ${r.slot}주차 후기를 피드에서 가릴까요? (응모권은 그대로예요. 쓴 사람은 고쳐 쓸 수 있고, 다시 보이게 하면 고친 글이 보여요)`);
      if (reason === null) return;
    }
    const b = writeBatch(db);
    let patch;
    if (!f.hidden) {
      b.set(doc(db, "hiddenFeed", r.feedId), { review: f.review });
      b.update(doc(db, "feed", r.feedId), { hidden: true, review: "" });
      patch = { hidden: true, review: "" };
    } else if (f.review === "") {
      const orig = await getDoc(doc(db, "hiddenFeed", r.feedId));
      if (!orig.exists()) return window.alert("가린 후기의 원문을 찾지 못했어요.");
      b.update(doc(db, "feed", r.feedId), { hidden: false, review: orig.data().review });
      b.delete(doc(db, "hiddenFeed", r.feedId));
      patch = { hidden: false, review: orig.data().review };
    } else {
      b.update(doc(db, "feed", r.feedId), { hidden: false }); // 예전 방식으로 가린 글(후기가 남아 있음)
      patch = { hidden: false };
    }
    const ok = await b.commit().then(() => true, () => { window.alert("바꾸지 못했어요. 잠시 뒤 다시 눌러 주세요."); return false; });
    if (!ok) return;
    forgetFeed();
    // 참여자가 읽는 피드 요약(public/feed)에도 바로 반영한다(가린 후기가 요약에 남아 보이지 않게). 이유 기록보다 먼저.
    await patchFeedDigest(r.feedId, patch).catch(() => window.alert("피드 요약에 반영하지 못했어요. 잠시 뒤 운영 화면을 열어 두면 다시 맞춰져요."));
    if (!f.hidden) { await resetEdits(r); await writeNote(r, "hide", reason); } else await clearNote(r, "hide");
  };
  // 감사 답장 지우기: 쓴 사람은 새로 다시 쓸 수 있다(사용자가 정함: "내가 지워도 다시 쓸 수 있게"). 지운 이유는 쓴 사람에게 보인다.
  const removeThanks = async (r) => {
    const reason = askReason(`${nameOf(r.receiverPid)}님의 ${r.slot}주차 감사 답장을 지울까요? 쓴 사람은 새로 다시 쓸 수 있어요(다시 못 쓰게 하려면 "피드에서 가리기").`);
    if (reason === null) return;
    const ok = await updateDoc(doc(db, "feed", r.feedId), { thanks: deleteField() })
      .then(() => true, () => { window.alert("지우지 못했어요. 잠시 뒤 다시 눌러 주세요."); return false; });
    if (!ok) return;
    forgetFeed();
    await patchFeedDigest(r.feedId, { thanks: undefined }).catch(() => {});
    await writeNote(r, "thanks", reason);
  };
  // 받는 사람이 "카드와 달라요"로 인증했거나, 완료 알림보다 먼저 인증해 카드를 확인하지 않은 것: 두 사람에게 확인한 뒤 "같음"으로 고칠 수 있다(카드 추가분)
  const setCardSame = (r) => {
    if (!window.confirm(`${nameOf(r.receiverPid)}님의 ${r.slot}주차 인증을 "받은 것이 카드와 같음"으로 고칠까요?\n\n마니또의 카드 추가분(보통 +${R.cardBonus.normal}, 도전 +${R.cardBonus.hard})이 붙어요. 두 사람에게 확인한 뒤에만 눌러 주세요.`)) return undefined;
    return updateDoc(doc(db, "redemptions", r.code), { cardMatch: true }).catch(() => window.alert("바꾸지 못했어요. 잠시 뒤 다시 눌러 주세요."));
  };
  const toggleDq = (r) => {
    if (!r.disqualified && !window.confirm(`${r.name}님을 응모권·수상에서 제외할까요?`)) return;
    return updateDoc(doc(db, "roster", r.pid), { disqualified: !r.disqualified });
  };
  const toggleDropout = (r) => {
    if (!r.dropout && !window.confirm(`${r.name}님을 중도 이탈로 표시할까요?\n\n· ${r.name}님은 응모권 0장(추첨 제외)\n· ${r.name}님의 마니또가 완료를 알린 미션은 인증된 것으로 인정(카드 추가분은 없음)\n· ${r.name}님이 맡은 사람은 못 받은 주차만큼 응모권 보상\n\n집계 전에는 언제든 되돌릴 수 있어요.`)) return;
    return updateDoc(doc(db, "roster", r.pid), { dropout: !r.dropout });
  };

  return (
    <>
      <Panel title="인증 검토">
        <p className="small">
          내용 없는 인증은 무효 처리하세요. 무효 처리된 인증은 피드와 응모권에서 빠져요(받는 사람의 인증 응모권과 마니또의 그 미션 응모권).
          후기만 성의 없고 미션은 실제로 받은 것이 확인되면, 집계 단계의 "집계 전 확인"에서 그 주차를 "받았음"으로 눌러 마니또의 미션은 인정할 수 있어요.
          미션은 제대로 했는데 후기나 답장만 문제라면 "피드에서 가리기"·"답장 지우기"를 쓰세요(응모권은 그대로예요).
          후기·감사 답장은 쓴 사람이 집계 전까지 합쳐서 {REVIEW_EDITS_MAX}번 고칠 수 있어요(추리 보드 "내가 인증한 것", 피드에 "고침" 표시).
          실수로 이름을 쓴 글은 먼저 "피드에서 가리기"로 가리고 쓴 사람에게 고쳐 달라고 한 뒤, 여기 보이는 후기가 고쳐진 것을 확인하고 "피드에 다시 보이기"를 누르세요(고친 글이 보여요).
          가리기·답장 지우기·무효 처리를 누르면 이유를 묻고, 그 이유는 쓴 사람의 추리 보드 "내가 인증한 것"에 보여요(그 미션의 마니또에게는 안 보여요).
          가리거나 무효 처리하면 고칠 수 있는 횟수가 다시 {REVIEW_EDITS_MAX}번이 되고, 답장을 지우면 쓴 사람이 새로 다시 쓸 수 있어요.
          "카드와 다름"은 받는 사람이 받은 것이 마니또가 고른 카드와 다르다고 한 것이에요(보통·도전 카드면 추가 응모권이 빠져요).
          "카드 확인 전"은 받는 사람이 마니또의 완료 알림보다 먼저 인증해서 카드를 아직 확인하지 않은 것이에요(받는 사람이 추리 보드 "내가 인증한 것"에서 확인하면 추가분이 붙고, 확인이 없으면 붙지 않아요).
        </p>
        <ul className="plain">
          {items.map((r) => {
            const f = r.feedId ? feed[r.feedId] : null;
            return (
              <li key={r.code} className={r.voided ? "row-item voided" : "row-item"}>
                <p>{r.review}</p>
                {f?.thanks && <p className="small">감사 답장: {f.thanks}</p>}
                {NOTE_KINDS.filter((k) => notes[r.code]?.[k]).map((k) => (
                  <p key={k} className="small warn-text">{NOTE_LABEL[k]} 이유(쓴 사람에게 보임): {notes[r.code][k].reason || "(적지 않음)"}</p>
                ))}
                <span className="small muted">
                  {nameOf(r.receiverPid)} · {r.slot}주차{f?.hidden ? " · 피드에서 가림" : ""}{r.edits ? ` · 고침 ${r.edits}번` : ""}{r.cardMatch === false ? " · 카드와 다름" : r.cardMatch === undefined && cardSlot(r) ? " · 카드 확인 전" : ""}
                </span>
                <span className="inline">
                  <button className="text-btn" onClick={() => toggleVoid(r)}>{r.voided ? "무효 취소" : "무효 처리"}</button>
                  {f && <button className="text-btn" onClick={() => toggleHide(r)}>{f.hidden ? "피드에 다시 보이기" : "피드에서 가리기"}</button>}
                  {f?.thanks && <button className="text-btn" onClick={() => removeThanks(r)}>답장 지우기</button>}
                  {r.cardMatch !== true && cardSlot(r) && <button className="text-btn" onClick={() => setCardSame(r)}>카드와 같다고 고치기</button>}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
      <NotesReview />
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

// 쪽지 검토: 익명 쪽지로 괴롭히는 일이 없게 운영자가 미션 중에도 쪽지를 본다(운영자는 참여하지 않는다).
// 받는 사람이 신고한 쪽지(noteFlags)가 먼저 보이고, 가리면 받는 사람 화면에서 내용이 안 보인다.
// 수호천사: 마니또가 아무것도 안 해서 받은 게 없는 사람에게, "수호천사 지원하기"를 누른 참여자를 몰래 연결한다.
// 누구를 연결할지는 운영자가 고르지 않는다: 먼저 지원한 순서대로 자동으로 짝짓는다(기준은 src/lib/angels.js).
// 수호천사가 한 미션을 받는 사람이 확인하면 수호천사는 1건당 응모권 +1(최대 2), 받는 사람은 인증 입력으로 친다(scoring.js).

// 지금 자료를 새로 읽어 angels.js의 기준대로 연결한다. 주차를 올릴 때(자동)와 "지금 순서대로 연결"에서 쓴다.
// 이미 수호천사가 있는 사람은 덮어쓰지 않는다(운영자 둘이 동시에 눌러도 한 번만).
async function linkAngelsNow(week) {
  const [assignments, missions, deliveries, volunteers, angels, roster, skipDoc] = await Promise.all([
    ...["assignments", "giverMissions", "deliveries", "angelVolunteers", "angels", "roster"].map(readAll),
    getDoc(doc(db, "meta", "angelSkips")),
  ]);
  const delivered = new Set(Object.values(deliveries).filter((d) => d.kind !== "note").map((d) => `${d.receiverPid}_${d.slot}`));
  const rows = pairRows({ assignments, missions, delivered });
  const pairs = matchAngels({ rows, volunteers, angels, week, people: angelPeople(Object.entries(roster).map(([pid, r]) => ({ pid, ...r }))), skips: skipDoc.exists() ? skipDoc.data().pairs || {} : {} });
  const made = [];
  for (const p of pairs) {
    try {
      const ok = await runTransaction(db, async (tx) => {
        const ref = doc(db, "angels", p.receiverPid);
        if ((await tx.get(ref)).exists()) return false;
        tx.set(ref, { angelPid: p.angelPid, at: serverTimestamp() });
        return true;
      });
      if (ok) made.push(p);
    } catch { /* 그 사이 지원을 취소했으면 보안 규칙이 거부한다. 다음에 다시 맞춘다 */ }
  }
  return made;
}
const angelPeople = (roster) => roster.map((r) => ({ pid: r.pid, joined: Boolean(r.uid), dropout: Boolean(r.dropout), disqualified: Boolean(r.disqualified) }));
const stampText = (t) => (t?.toDate ? t.toDate().toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");

function Angels() {
  const { nameOf, config } = useApp();
  const { ready, rows } = usePairs();
  const roster = useFullRoster();
  const volunteers = useColl("angelVolunteers");
  const angels = useColl("angels");
  const gifts = useColl("angelGifts");
  const [skips, setSkips] = useState(null); // 운영자가 "다음 순번으로" 넘긴 짝 { 받는사람: [지원자] }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => onSnapshot(doc(db, "meta", "angelSkips"), (d) => setSkips(d.exists() ? d.data().pairs || {} : {}), () => setSkips({})), []);
  if (!ready || !roster || !volunteers || !angels || !gifts || !skips) return null;
  const running = config.phase === PHASE.RUNNING;
  const week = config.week || 1;
  const people = angelPeople(roster);
  const queue = angelQueueStatus({ rows, volunteers, angels, week, people });
  const orderOf = Object.fromEntries(queue.map((v) => [v.pid, v.order]));
  const needy = needyReceivers({ rows, angels, week, people });
  const pending = matchAngels({ rows, volunteers, angels, week, people, skips }); // 지금 누르면 연결될 짝
  const giftsOf = (r) => [1, 2].map((k) => gifts[`${r}_${k}`]).filter(Boolean);
  const STATE = { linked: (v) => `연결됨 → ${nameOf(v.receiverPid)}`, waiting: () => "대기", own: () => `${week - 1}주차까지 자기 미션을 다 하지 않아 건너뜀(하면 연결될 수 있어요)` };

  async function runNow() {
    setBusy(true);
    setMsg("");
    try {
      const made = await linkAngelsNow(week);
      setMsg(made.length ? `지원 순서대로 연결했어요: ${made.map((p) => `${nameOf(p.receiverPid)} ← ${nameOf(p.angelPid)}`).join(", ")}` : "지금 연결할 짝이 없어요.");
    } catch {
      setMsg("연결하지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    } finally {
      setBusy(false);
    }
  }
  // 연결을 풀고 다음 순번에게 넘긴다(수호천사 미션이 오기 전에만). 넘긴 짝은 다시 연결되지 않게 적어 둔다.
  async function passOn(receiverPid, angelPid) {
    if (!window.confirm(`${nameOf(receiverPid)}님의 수호천사(${nameOf(angelPid)}님) 연결을 풀고 다음 순번에게 넘길까요?\n\n${nameOf(angelPid)}님은 이 사람에게 다시 연결되지 않아요(다른 사람에게는 순서대로 연결될 수 있어요). 수호천사가 연락이 안 되거나 못 하겠다고 한 경우에만 쓰세요. 수호천사 미션이 오기 전에만 할 수 있어요.`)) return;
    setBusy(true);
    setMsg("");
    try {
      await deleteDoc(doc(db, "angels", receiverPid));
      await setDoc(doc(db, "meta", "angelSkips"), { pairs: { [receiverPid]: arrayUnion(angelPid) } }, { merge: true });
      const made = await linkAngelsNow(week);
      const next = made.find((p) => p.receiverPid === receiverPid);
      setMsg(next ? `${nameOf(receiverPid)}님의 수호천사를 다음 순번(${nameOf(next.angelPid)}님)으로 넘겼어요.` : `${nameOf(receiverPid)}님의 연결을 풀었어요. 지금 연결할 수 있는 다음 지원자는 없어요.`);
    } catch {
      setMsg("넘기지 못했어요. 이미 수호천사 미션이 왔으면 바꿀 수 없어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title={`수호천사 (지원 ${queue.length}명 · 연결 ${Object.keys(angels).length}명)`}>
      <p className="small">
        마니또가 미션을 안 해서 받은 게 없는 사람에게, 응모권을 더 받고 싶어 지원한 참여자를 몰래 연결해요. <b>누구를 연결할지는 운영자가 고르지 않아요.</b>
        {" "}2·3주차를 열 때, 그때까지 마니또의 완료 알림이 한 건도 없는 사람(가입했고 중도 이탈이 아닌 사람)에게 <b>먼저 지원한 순서대로</b> 자동 연결돼요.
        받는 사람 본인, 그 사람의 마니또, 닫힌 주차의 자기 미션을 다 하지 않은 지원자는 건너뛰고, 한 사람에게 한 명씩만 연결해요.
        수호천사가 한 미션을 받는 사람이 확인하면 수호천사는 1건당 응모권 +1(최대 2), 받는 사람은 인증 입력으로 쳐요(보상과 합쳐 최대 3이라 이중으로 받지 않아요).
        이 화면에 누가 누구를 돕는지 보이니 주의해 주세요.
      </p>
      <p className="small"><b>지원 순서</b>{queue.length === 0 && ": 아직 없어요"}</p>
      {queue.length > 0 && (
        <ol className="plain angel-queue">
          {queue.map((v) => <li key={v.pid} className="small">{v.order}. {nameOf(v.pid)} <span className="muted">({stampText(v.at)} 지원)</span> · {STATE[v.state](v)}</li>)}
        </ol>
      )}
      {running && (
        <>
          <p className="small">
            <b>도움이 필요한 사람</b>(마니또의 완료 알림 0건, 수호천사 없음): {week < 2 ? "2주차가 열리면 그때 정해져요." : needy.length ? needy.map(nameOf).join(", ") : "없어요"}
          </p>
          <div className="inline">
            <button className="pk-btn sm" disabled={busy || pending.length === 0} onClick={runNow}>지금 순서대로 연결 ({pending.length}쌍)</button>
            {pending.length > 0 && <span className="small">연결될 짝: {pending.map((p) => `${nameOf(p.receiverPid)} ← ${nameOf(p.angelPid)}(지원 ${p.order}번째)`).join(", ")}</span>}
          </div>
          <p className="small muted">주차를 열 때 자동으로 연결되므로 보통은 누를 일이 없어요. 그 뒤에 지원자가 생겼거나 자기 미션을 마친 지원자가 있을 때만 짝이 생겨요.</p>
        </>
      )}
      {Object.keys(angels).length > 0 && (
        <ul className="plain">
          {Object.entries(angels).map(([r, a]) => {
            const g = giftsOf(r);
            return (
              <li key={r} className="row-item">
                <span>{nameOf(r)} ← 수호천사 {nameOf(a.angelPid)} <span className="small muted">({orderOf[a.angelPid] ? `지원 ${orderOf[a.angelPid]}번째` : "지금은 지원 취소·제외 상태"}, {stampText(a.at)} 연결)</span> · 미션 {g.length}건, 확인 {g.filter((x) => x.confirmed).length}건</span>
                {g.map((x) => <p key={x.k} className="small">{x.k}번: {x.text}{x.message ? ` — "${x.message}"` : ""}{x.confirmed ? ` (확인: ${x.review})` : " (확인 대기)"}</p>)}
                {running && g.length === 0 && <button className="text-btn" disabled={busy} onClick={() => passOn(r, a.angelPid)}>연결 풀고 다음 순번으로</button>}
              </li>
            );
          })}
        </ul>
      )}
      {msg && <p className="note small" role="status">{msg}</p>}
    </Panel>
  );
}

function NotesReview() {
  const { nameOf } = useApp();
  const deliveries = useColl("deliveries");
  const flags = useColl("noteFlags");
  const assignments = useColl("assignments");
  const [open, setOpen] = useState(false);
  if (!deliveries || !flags || !assignments) return null;
  const giverOf = Object.fromEntries(Object.entries(assignments).map(([g, a]) => [a.receiverPid, g]));
  const list = Object.entries(deliveries)
    .map(([id, d]) => ({ id, ...d, flagged: Boolean(flags[id]) }))
    .filter((d) => d.message)
    .sort((a, b) => Number(b.flagged) - Number(a.flagged) || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  const flaggedN = list.filter((d) => d.flagged && !d.hidden).length;
  const toggleHide = (d) => updateDoc(doc(db, "deliveries", d.id), { hidden: !d.hidden });
  const resolve = (d) => deleteDoc(doc(db, "noteFlags", d.id));
  return (
    <Panel title={`쪽지 검토 (신고 ${flaggedN}건)`}>
      <p className="small">
        마니또가 보낸 쪽지예요. 받는 사람이 신고한 쪽지가 먼저 나와요. 불쾌한 쪽지는 "가리기"를 누르면 받는 사람 화면에서 내용이 안 보여요.
        보낸 사람이 함께 보이니 화면을 다른 사람이 보지 않게 주의해 주세요.
      </p>
      <button type="button" className="pk-btn sm" onClick={() => setOpen(!open)}>{open ? "쪽지 접기" : `쪽지 ${list.length}건 보기`}</button>
      {open && (
        <ul className="plain">
          {list.map((d) => (
            <li key={d.id} className={d.hidden ? "row-item voided" : d.flagged ? "row-item picked" : "row-item"}>
              <p>{d.message}</p>
              <span className="small muted">
                {nameOf(giverOf[d.receiverPid])} → {nameOf(d.receiverPid)} · {d.slot}주차 {d.kind === "note" ? "추가 쪽지" : d.kind === "praise" ? "칭찬 카드" : "완료 알림"}
                {d.flagged && " · 받는 사람이 신고함"}
              </span>
              <span className="inline">
                <button className="text-btn" onClick={() => toggleHide(d)}>{d.hidden ? "다시 보이기" : "가리기"}</button>
                {d.kind === "note" && <button className="text-btn" onClick={() => window.confirm("이 추가 쪽지를 지울까요? 응모권과는 관계없어요.") && deleteDoc(doc(db, "deliveries", d.id))}>지우기</button>}
                {d.flagged && <button className="text-btn" onClick={() => resolve(d)}>신고 확인함</button>}
              </span>
            </li>
          ))}
          {list.length === 0 && <li className="muted small">내용이 있는 쪽지가 없어요.</li>}
        </ul>
      )}
      <ToManitoReview />
    </Panel>
  );
}

// 받는 사람이 마니또에게 보낸 한마디. 불쾌한 내용이면 지운다(받는 사람은 그 주차에 다시 보낼 수 있게 된다).
function ToManitoReview() {
  const { nameOf } = useApp();
  const msgs = useColl("toManito");
  const [open, setOpen] = useState(false);
  if (!msgs) return null;
  const list = Object.entries(msgs).map(([id, m]) => ({ id, ...m })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return (
    <div className="stack tight">
      <button type="button" className="pk-btn sm" onClick={() => setOpen(!open)}>{open ? "한마디 접기" : `마니또에게 한마디 ${list.length}건 보기`}</button>
      {open && (
        <ul className="plain">
          {list.map((m) => (
            <li key={m.id} className="row-item">
              <p>{m.message}</p>
              <span className="small muted">{nameOf(m.receiverPid)} → 그 사람의 마니또 · {m.slot}주차</span>
              <button className="text-btn" onClick={() => window.confirm("이 한마디를 지울까요? 보낸 사람은 그 주차에 다시 보낼 수 있어요.") && deleteDoc(doc(db, "toManito", m.id))}>지우기</button>
            </li>
          ))}
          {list.length === 0 && <li className="muted small">아직 없어요.</li>}
        </ul>
      )}
    </div>
  );
}

// 쓰기 횟수: 참여자가 고칠 수 있는 문서마다 쓴 횟수(n)가 남는다(보안 규칙이 1씩 올리게 한다).
// 무료 한도(하루 쓰기 2만 건)가 갑자기 차면 여기서 누구 문서인지 찾는다. 읽기 반복은 기록되지 않는다.
function WriteCounts() {
  const { nameOf, config } = useApp();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    const names = ["progress", "giverMissions", "profiles", "avatars", "reports", "guesses", "clues", "assignments", "users", "prefs", "midGuesses", "angelVolunteers"];
    const data = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await readAll(n).catch(() => ({}))])));
    const sum = {};
    const add = (pid, n) => { if (pid && n) sum[pid] = (sum[pid] || 0) + n; };
    for (const n of ["progress", "giverMissions", "profiles", "avatars", "guesses", "prefs", "midGuesses", "angelVolunteers"]) {
      Object.entries(data[n] || {}).forEach(([pid, d]) => add(pid, d.n));
    }
    Object.entries(data.reports).forEach(([id, d]) => add(id.split("_")[0], d.n));
    Object.values(data.users).forEach((d) => add(d.personId, d.n));
    // 단서는 받는 사람 앞으로 저장되지만 쓰는 사람은 그 사람의 마니또다
    const giverOf = Object.fromEntries(Object.entries(data.assignments).map(([g, a]) => [a.receiverPid, g]));
    Object.entries(data.clues).forEach(([id, d]) => add(giverOf[id.split("_")[0]], d.n));
    setRows(Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, 10));
    setBusy(false);
  }
  return (
    <Panel title="쓰기 횟수 (많은 순)">
      <p className="small">
        사이트가 갑자기 "저장하지 못했어요"로 멈추면(무료 한도 소진) 눌러 보세요. 사람마다 자기 문서를 고친 횟수예요.
        보통은 수십 번 안쪽이에요. 수천 번이 넘는 사람이 있으면 일부러 반복한 것이라 연결 해제·수상 제외를 검토하세요. 읽기 반복은 기록되지 않아요.
      </p>
      <button type="button" className="pk-btn sm" onClick={load} disabled={busy}>{rows ? "다시 세기" : "쓰기 횟수 보기"}</button>
      {rows && (
        <ol className="plain">
          {rows.map(([pid, n]) => <li key={pid}>{nameOf(pid)}: {n.toLocaleString()}번</li>)}
          {rows.length === 0 && <li className="muted small">기록이 없어요.</li>}
        </ol>
      )}
    </Panel>
  );
}

// ── 예약(자동 진행) ───────────────────────────────────────────────────────
// 주차 열기·단서 공개를 버튼과 예약이 같이 쓴다(확인창 없이 실제 작업만). 실패하면 던진다.
async function openWeek(week) {
  await updateDoc(doc(db, "config", "app"), { week });
  const made = await linkAngelsNow(week).catch(() => null);
  return made == null ? `${week}주차를 열었어요. 수호천사 자동 연결은 하지 못했어요. 아래 "수호천사"에서 "지금 순서대로 연결"을 눌러 주세요.`
    : made.length ? `${week}주차를 열었어요. 수호천사 ${made.length}명을 지원 순서대로 연결했어요(아래 "수호천사"에서 볼 수 있어요).`
      : `${week}주차를 열었어요. 수호천사를 연결할 사람은 없었어요.`;
}
// 미션 마감(단계 1 → 2, 최종 지목 시작): "다음 단계로" 버튼과 같다(파트 순위를 마지막으로 한 번 더 발표한 뒤 단계를 넘긴다).
async function closeMissions(week) {
  try {
    const [roster, missions] = await Promise.all([readAll("roster"), readAll("giverMissions")]);
    await publishPartBoard(Object.entries(roster).map(([pid, r]) => ({ pid, ...r })), missions, week);
  } catch {
    // 파트 순위를 못 발표해도 단계는 넘긴다(버튼과 같음)
  }
  await updateDoc(doc(db, "config", "app"), { phase: PHASE.GUESSING });
  return "미션을 마감하고 최종 지목을 시작했어요(파트 순위도 마지막으로 발표).";
}
async function releaseCluesTo(count, week) {
  await updateDoc(doc(db, "config", "app"), { cluesReleased: count });
  try {
    const [roster, missions] = await Promise.all([readAll("roster"), readAll("giverMissions")]);
    const n = await publishPartBoard(Object.entries(roster).map(([pid, r]) => ({ pid, ...r })), missions, week);
    return n ? "단서를 공개하고 파트 순위도 새로 발표했어요." : "단서를 공개했어요. 파트가 입력되지 않아 파트 순위는 비어 있어요.";
  } catch {
    return "단서는 공개했지만 파트 순위는 발표하지 못했어요. 아래 '파트 순위만 다시 발표'를 눌러 주세요.";
  }
}

const SCHEDULE_REF = () => doc(db, "meta", "schedule");
const AUTO_TICK_MS = 15000;

// 예약 실행기(화면 없음). App이 운영자·공동 운영자 계정에 띄운다: 사이트가 열려 있는 동안 예약 시각이 지난 것을 실행한다.
// 여러 운영자 화면이 동시에 열려 있어도 한 번만 실행되게, 실행 전에 트랜잭션으로 "내가 맡음"(claimedMs)을 적는다.
export function AutoRunner() {
  const { config, user } = useApp();
  const [items, setItems] = useState(null);
  const [tick, setTick] = useState(0);
  const running = useRef(false);
  // 서버가 받은 예약만 본다: 예약을 저장한 직후의 "아직 서버에 안 닿은" 값으로 실행을 맡으려 하면, 서버에는 그 예약이 없어
  // 트랜잭션이 한 번 충돌(failed-precondition)하고 다시 시도된다(결과는 같지만 콘솔에 오류가 남는다 — 11/23 E2E에서 찾음).
  useEffect(() => onSnapshot(SCHEDULE_REF(), { includeMetadataChanges: true }, (s) => {
    if (s.metadata.hasPendingWrites) return;
    setItems(s.exists() ? s.data().items || {} : {});
  }, () => setItems(null)), []);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), AUTO_TICK_MS);
    return () => clearInterval(t);
  }, []);
  const phase = config.phase, week = config.week || 1, released = config.cluesReleased || 0;
  useEffect(() => {
    if (!items || running.current) return;
    const due = nextDue({ items, config: { phase, week, cluesReleased: released }, now: Date.now() });
    if (!due) return;
    running.current = true;
    (async () => {
      const ref = SCHEDULE_REF();
      const mine = await runTransaction(db, async (tx) => {
        const cur = (await tx.get(ref)).data()?.items?.[due.id];
        if (!cur || cur.at !== due.at || cur.doneAt || Date.now() - (cur.claimedMs || 0) < CLAIM_MS) return false;
        tx.update(ref, { [`items.${due.id}.claimedMs`]: Date.now(), [`items.${due.id}.claimedBy`]: user.uid, [`items.${due.id}.tries`]: (cur.tries || 0) + 1 });
        return true;
      }).catch(() => false);
      if (!mine) return;
      try {
        const result = due.type === "week" ? await openWeek(due.target) : due.type === "close" ? await closeMissions(week) : await releaseCluesTo(due.target, week);
        await updateDoc(ref, { [`items.${due.id}.doneAt`]: serverTimestamp(), [`items.${due.id}.result`]: result, [`items.${due.id}.error`]: deleteField() });
      } catch (err) {
        await updateDoc(ref, { [`items.${due.id}.error`]: `실행하지 못했어요(${err?.code || err?.message || "알 수 없는 오류"}). 2분 뒤 다시 해 봐요.` }).catch(() => {});
      }
    })().finally(() => { running.current = false; });
  }, [items, tick, phase, week, released, user]);
  return null;
}

// 예약 패널(미션 진행 단계): 다섯 가지(2·3주차 열기, 단서 공개 세 번)에 시각을 정한다.
function ScheduleBox() {
  const { config } = useApp();
  const [items, setItems] = useState(null);
  const [form, setForm] = useState(null); // { id: "2026-11-20T09:00" }
  const [msg, setMsg] = useState("");
  const [, setNow] = useState(0);
  useEffect(() => onSnapshot(SCHEDULE_REF(), (s) => setItems(s.exists() ? s.data().items || {} : {}), () => setItems({})), []);
  useEffect(() => { const t = setInterval(() => setNow((n) => n + 1), AUTO_TICK_MS); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (items && form === null) setForm(Object.fromEntries(AUTO_ITEMS.map((it) => [it.id, msToLocalInput(items[it.id]?.at)])));
  }, [items, form]);
  if (!items || !form) return null;
  const plan = autoPlan({ items, config, now: Date.now() });
  const when = (ms) => new Date(ms).toLocaleString("ko-KR", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
  const stateText = (r) => ({
    done: r.doneAt ? `예약으로 실행했어요${r.doneAt?.toDate ? ` (${when(r.doneAt.toDate().getTime())})` : ""}. ${r.result}` : "이미 됐어요.",
    none: "예약 없음",
    waiting: `예약됨: ${when(r.at)}`,
    due: "예약 시각이 됐어요. 실행하는 중이에요…",
    blocked: `예약 시각(${r.at ? when(r.at) : ""})이 지났지만 기다리는 중: ${r.why}`,
    failed: r.why,
    off: r.why,
  }[r.state]);
  const fill = () => setForm((f) => Object.fromEntries(AUTO_ITEMS.map((it) => [it.id, f[it.id] || (it.date && plan.find((r) => r.id === it.id).state !== "done" ? `${it.date}T${it.time || "09:00"}` : "")])));

  async function save() {
    setMsg("");
    const next = {};
    const past = [];
    for (const r of plan) {
      const at = localInputToMs(form[r.id]);
      if (r.state === "done") { if (items[r.id]) next[r.id] = items[r.id]; continue; }
      if (at == null) continue; // 비워 두면 예약 취소
      // 시각을 바꾸면 실패 기록을 지우고 새로 시작한다
      next[r.id] = items[r.id]?.at === at ? items[r.id] : { at };
      if (at <= Date.now()) past.push(r.label);
    }
    if (past.length && !window.confirm(`이미 지난 시각이에요: ${past.join(", ")}\n\n저장하면 곧바로 실행돼요(단서 공개·주차 열기·미션 마감은 되돌릴 수 없어요). 저장할까요?`)) return;
    try {
      await setDoc(SCHEDULE_REF(), { items: next });
      setMsg("예약을 저장했어요.");
    } catch {
      setMsg("예약을 저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    }
  }

  return (
    <Panel title="예약 (자동 진행)">
      <p className="small">
        시각을 정해 두면 그때 자동으로 실행돼요(위의 버튼을 누른 것과 같아요: 주차를 열면 수호천사 자동 연결, 단서를 공개하면 파트 순위 발표도 같이).
        칸을 비우고 저장하면 예약이 취소돼요. 시각은 이 기기의 시계 기준이에요.
      </p>
      <p className="small warn-text">
        사이트에는 서버가 없어서, 예약 시각에 운영자나 공동 운영자 중 누군가 이 사이트를 열어 두고 있어야 그 시각에 실행돼요.
        아무도 열어 두지 않았으면 그 뒤 운영자가 사이트를 여는 순간 실행돼요(PC가 절전 상태이면 열려 있는 것이 아니에요).
      </p>
      <ul className="plain auto-list">
        {plan.map((r) => (
          <li key={r.id} className={`auto-item is-${r.state}`}>
            <label>
              <span className="panel-label">{r.label}</span>
              <input type="datetime-local" className="pk-input" value={form[r.id]} disabled={r.state === "done"}
                onChange={(e) => setForm((f) => ({ ...f, [r.id]: e.target.value }))} aria-label={`${r.label} 예약 시각`} />
            </label>
            <span className="small auto-state">{stateText(r)}{r.error && r.state !== "failed" ? ` ${r.error}` : ""}</span>
          </li>
        ))}
      </ul>
      <div className="reveal-row">
        <button type="button" className="pk-btn" onClick={save}>예약 저장</button>
        <button type="button" className="pk-btn sm" onClick={fill}>빈 칸을 일정표 날짜·시각으로 채우기</button>
      </div>
      {msg && <p className="note" role="status">{msg}</p>}
      <p className="small muted">
        채우기를 누르면 주차 열기·미션 마감은 일정표 시각 12:00(참여자에게 안내한 마감 11:00보다 한 시간 뒤), 단서 공개는 오전 9시로 들어가요. 주차를 열면 그 전 주차 미션이 마감되고(지난 주차는 마니또가 나중에 할 수 없어요),
        미션 마감은 "다음 단계로: 최종 지목"을 누른 것과 같아요(되돌릴 수 없어요). 집계·공개(12/9)는 예약하지 않아요. 맨 아래 "다음 단계로"를 직접 눌러 주세요.
      </p>
    </Panel>
  );
}

// 파일로 내려받기(브라우저가 저장한다. 서버로 보내지 않는다)
function saveFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 백업 내려받기(사용자가 정함: "사람들이 보낸 메시지·기록을 전부 백업해서 송년회 때 돌아보는 자료로 정리하고 싶다").
// 무료 요금제에는 자동 백업이 없다. 누르면 운영자가 읽을 수 있는 자료를 모두 한 번 읽어(전체 문서 수만큼 읽기가 든다) 두 파일을 만든다:
//  - 전체 백업(JSON): 모든 컬렉션 그대로. 문제가 생겼을 때 그 시점 기록을 확인하는 용도
//  - 메시지·후기 모음(CSV, 엑셀): 쪽지·칭찬·후기·답장·한마디를 "누가 누구에게"와 함께 한 줄씩. 송년회 자료 정리용
// 두 파일 모두 누가 누구의 마니또인지가 들어 있다(운영자는 원래 볼 수 있는 내용).
function Backup() {
  const { nameOf } = useApp();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState(null); // { at, collections, docs, failed }
  const [msg, setMsg] = useState("");
  async function run() {
    setBusy(true);
    setMsg("자료를 읽는 중이에요…");
    try {
      const failed = [];
      const collections = Object.fromEntries(await Promise.all(BACKUP_COLLECTIONS.map(async (n) => {
        try { return [n, await readAll(n)]; } catch { failed.push(n); return [n, null]; }
      })));
      const docs = Object.fromEntries(await Promise.all(BACKUP_DOCS.map(async ([c, id]) => {
        try { const snap = await getDoc(doc(db, c, id)); return [`${c}/${id}`, snap.exists() ? snap.data() : null]; } catch { failed.push(`${c}/${id}`); return [`${c}/${id}`, null]; }
      })));
      setData({ at: new Date(), collections, docs, failed });
      setMsg("");
    } catch (err) {
      setMsg(`백업을 만들지 못했어요(${err?.code || err?.message || "알 수 없는 오류"}). 다시 눌러 주세요.`);
    } finally {
      setBusy(false);
    }
  }
  const rows = useMemo(() => (data ? messageRows({ nameOf, ...Object.fromEntries(Object.entries(data.collections).map(([k, v]) => [k, v || {}])) }) : []), [data, nameOf]);
  const when = data ? stamp(data.at) : "";
  const kinds = rows.reduce((m, r) => ({ ...m, [r.kindLabel]: (m[r.kindLabel] || 0) + 1 }), {});

  return (
    <Panel title="백업 내려받기">
      <p className="small">
        지금까지 쌓인 자료를 이 PC에 파일로 저장해요(자동 백업이 없어서, 지워지면 되돌릴 방법이 이것뿐이에요).
        매주 단서를 공개하는 날과 미션 마감 직전에 한 번씩 받아 두면 좋아요. 누를 때마다 전체 문서 수만큼 읽기가 들어요.
      </p>
      <p className="small warn-text">파일에는 누가 누구의 마니또인지와 쪽지 내용이 들어 있어요. 송년회 전에는 다른 사람이 볼 수 없는 곳에 보관해 주세요.</p>
      <button type="button" className="pk-btn" disabled={busy} onClick={run}>{data ? "백업 다시 만들기" : "백업 만들기"}</button>
      {msg && <p className="small" role="status">{msg}</p>}
      {data && (
        <div className="stack tight backup-result">
          <p className="note" role="status">
            백업을 만들었어요: 문서 {backupDocCount(data.collections, data.docs).toLocaleString()}건, 메시지·후기 {rows.length}건
            {rows.length > 0 && ` (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(" · ")})`}.
          </p>
          {data.failed.length > 0 && (
            <p className="small warn-text">읽지 못한 것: {data.failed.join(", ")} (초대 코드·메일 색인은 처음 운영자만 읽을 수 있어요). 나머지는 들어 있어요.</p>
          )}
          <div className="reveal-row">
            <button type="button" className="pk-btn sm" onClick={() => saveFile(`manito-backup-${when}.json`, JSON.stringify(buildBackup(data), null, 1), "application/json")}>
              전체 백업 파일 받기 (JSON)
            </button>
            <button type="button" className="pk-btn sm" onClick={() => saveFile(`manito-messages-${when}.csv`, toCsv(rows), "text/csv;charset=utf-8")}>
              메시지·후기 모음 받기 (엑셀용 CSV)
            </button>
          </div>
          <p className="small muted">메시지·후기 모음은 엑셀에서 바로 열려요(종류·주차·쓴 사람·받은 사람·내용·고른 카드·공감 수·시각). 전체 백업은 모든 기록이 그대로 들어 있는 보관용 파일이에요.</p>
          <p className="small muted">자료가 지워졌을 때는 전체 백업 파일로 되살릴 수 있어요(운영자 PC에서 저장소의 <code>tools/restore/restore_backup.py</code> 실행 — 방법은 README "백업과 되살리기"). 기본은 없어진 문서만 되살리고 아무것도 지우지 않아요.</p>
        </div>
      )}
    </Panel>
  );
}

async function readAll(name) {
  const s = await getDocs(collection(db, name));
  return Object.fromEntries(s.docs.map((d) => [d.id, d.data()]));
}

// 받은 게 없어요 확인 / 집계 전 확인: 마니또가 완료를 알렸는데 인증이 없는 주차를 운영자가 주차별로 확인한다.
//  받았음: 그 마니또의 미션으로 인정한다(카드 추가분은 없음). 받는 사람의 인증 입력 응모권은 생기지 않는다.
//  못 받음: 마니또의 미션으로 치지 않고, 받는 사람에게 그 주차 보상 1장을 준다(마니또가 안 보낸 주차와 같게).
//  확인하지 않으면: 어느 쪽에도 응모권이 생기지 않는다. 단, 대상이 가입 안 함·중도 이탈이면 확인 없이도 마니또의 미션으로 인정된다.
// all = false(미션 진행~마감 단계): 받는 사람이 "받은 게 없어요"로 신고했거나 이미 확인한 주차만 보인다.
// all = true(집계 단계): 인증이 없는 완료 알림을 모두 보인다(신고하지 않고 인증만 안 한 경우 포함).
function Unresolved({ all = false }) {
  const { nameOf } = useApp();
  const isOwner = useIsOwner();
  const roster = useFullRoster() || [];
  const { ready, rows } = usePairs();
  const [msg, setMsg] = useState("");
  if (!ready) return null;
  const byPid = Object.fromEntries(roster.map((r) => [r.pid, r]));
  const items = unresolvedSlots(rows, { onlyReported: !all })
    .sort((a, b) => a.slot - b.slot || nameOf(a.receiverPid).localeCompare(nameOf(b.receiverPid), "ko"));
  const autoOf = (pid) => (byPid[pid] && !byPid[pid].uid ? "미가입" : byPid[pid]?.dropout ? "중도 이탈" : null);
  // 꼭 확인해야 하는 것: 인증 기록이 없는 완료 알림. 인증이 무효 처리된 주차는 "받았음"을 누를 수 있게 보이기만 한다
  const waiting = items.filter((x) => !x.verdict && !x.voided && !autoOf(x.receiverPid)).length;
  const praiseAuto = rows.reduce((n, r) => n + Object.values(r.slots).filter((x) => x.status === "auto").length, 0);

  async function decide(it, verdict) {
    setMsg("");
    const ref = doc(db, "verdicts", `${it.receiverPid}_${it.slot}`);
    const undo = it.verdict === verdict; // 같은 버튼을 다시 누르면 확인 취소
    // "못 받음"은 마니또가 그 미션의 응모권을 잃는 결정이라, 처음 운영자가 두 사람에게 확인한 뒤에만 확정한다(신고만으로는 아무것도 바뀌지 않는다)
    if (verdict === "missing" && !undo && !window.confirm(
      `${nameOf(it.receiverPid)}님의 ${it.slot}주차를 "못 받음"으로 확정할까요?\n\n`
      + `· 마니또 ${nameOf(it.giverPid)}님: 이 미션의 응모권(미션 ${R.perRedeemedMission}장과 카드 추가분)을 받지 못하고, 미션 ${R.hiddenMinMissions}건을 채우지 못하면 은신 ${R.hidden}장도 받지 못해요.\n`
      + `· 받는 사람 ${nameOf(it.receiverPid)}님: 그 주차 보상 ${R.compPerMissedWeek}장을 받아요.\n\n`
      + "두 사람 모두에게 확인한 뒤에 눌러 주세요. 집계 전까지는 같은 버튼을 다시 눌러 취소할 수 있어요.")) return;
    try {
      if (undo) await deleteDoc(ref);
      else await setDoc(ref, { receiverPid: it.receiverPid, slot: it.slot, verdict, at: serverTimestamp() });
    } catch {
      setMsg("저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    }
  }

  return (
    <Panel title={all ? `집계 전 확인: 인증이 없는 완료 알림 (확인 안 한 것 ${waiting}건)` : `받은 게 없어요 신고 (확인 안 한 것 ${waiting}건)`}>
      <p className="small">
        {all
          ? "마니또가 미션 완료를 알렸는데 받는 사람의 유효한 인증이 없는 주차예요. 집계하기 전에 두 사람에게 확인하고 주차마다 눌러 주세요."
          : "마니또가 완료를 알렸는데 받는 사람이 \"받은 게 없어요\"로 알린 주차예요. 신고만으로는 아무것도 바뀌지 않아요. 두 사람에게 확인하고 주차마다 눌러 주세요."}
        {" "}<b>받았음</b>: 마니또의 미션으로 인정해요(카드 추가분은 없고, 받는 사람의 인증 입력 응모권은 생기지 않아요).
        {" "}<b>못 받음</b>: 마니또의 미션으로 치지 않고, 받는 사람에게 그 주차 응모권 1장을 보상해요. <b>처음 운영자만</b> 확정할 수 있어요.
        {" "}확인하지 않으면 어느 쪽에도 응모권이 생기지 않아요. 같은 버튼을 다시 누르면 취소돼요.
        {all && " 인증이 무효 처리된 주차도 나와요: 후기만 문제였고 미션은 실제로 받았다면 \"받았음\"을 눌러 마니또의 미션을 인정할 수 있어요(받는 사람 쪽은 달라지지 않아요)."}
        {all && praiseAuto > 0 && ` 3주차 칭찬 카드 ${praiseAuto}건은 사이트로 전달된 것이라 인증이 없어도 자동으로 인정돼요(막말 등은 "쪽지 검토"에서 가리면 여기에 나와요).`}
      </p>
      {items.length === 0 ? <p className="muted">{all ? "해당하는 주차가 없어요." : "신고가 없어요."}</p> : (
        <div className="table-wrap">
          <table className="pk-table">
            <thead><tr><th>주차</th><th>받는 사람</th><th>마니또</th><th>카드</th><th>신고</th><th>확인</th></tr></thead>
            <tbody>
              {items.map((it) => {
                const auto = it.voided ? null : autoOf(it.receiverPid);
                return (
                  <tr key={`${it.receiverPid}_${it.slot}`} className={!it.verdict && !auto && !it.voided ? "warn" : ""}>
                    <td>{it.slot}주차</td>
                    <td>{nameOf(it.receiverPid)}{auto && ` (${auto})`}</td>
                    <td>{nameOf(it.giverPid)}</td>
                    <td className="left" title={it.text}>{it.level === "praise" ? "칭찬 카드" : `${LEVEL_LABEL[it.level] || ""} ${it.text}`}</td>
                    <td>{it.voided ? "인증 무효" : it.reported ? "받은 게 없어요" : "-"}</td>
                    <td>
                      <button className={it.verdict === "received" ? "chip sm is-on" : "chip sm"} aria-pressed={it.verdict === "received"} onClick={() => decide(it, "received")}>받았음</button>
                      {!it.voided && (
                        <button className={it.verdict === "missing" ? "chip sm is-on" : "chip sm"} aria-pressed={it.verdict === "missing"} disabled={!isOwner}
                          title={isOwner ? undefined : "못 받음은 처음 운영자만 확정할 수 있어요"} onClick={() => decide(it, "missing")}>못 받음</button>
                      )}
                      {auto && !it.verdict && <span className="small muted"> 확인 없으면 자동 인정</span>}
                      {it.voided && !it.verdict && <span className="small muted"> 누르지 않으면 인정 안 됨</span>}
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
  const [shown, setShown] = useState(false); // 사무실에서 화면이 보일 수 있어서 처음에는 접어 둔다
  const [clues, setClues] = useState(null); // 단서 확인(누를 때만 읽는다)

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

  const ver = config.assignVer ?? 0;
  const clueCell = (r) => {
    const a = clueAnswers(clues, r.receiverPid, ver);
    const n = a.filter(Boolean).length;
    return (
      <td className={n === 6 ? "" : "st-sent"}>
        <details>
          <summary>{n} / 6</summary>
          <ol className="clue-list">{a.map((x, i) => <li key={i}>{x ?? "(빈 칸)"}</li>)}</ol>
        </details>
      </td>
    );
  };

  return (
    <Panel title={`짝 현황 (${rows.length}쌍)`}>
      <p className="small">
        누가 누구의 마니또인지와 주차별 진행이에요. 운영자 화면에만 보여요(운영자·공동 운영자는 참여하지 않는 계정이에요).
        {" "}인증됨 {count("redeemed")} · 인증 대기 {count("sent")} · 신고 {count("reported")} · 받았음 확인 {count("confirmed")} · 못 받음 확인 {count("missing")}
        {count("voided") > 0 && ` · 인증 무효 ${count("voided")}`}
      </p>
      <div className="reveal-row">
        <button type="button" className="pk-btn sm" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? "짝 현황 가리기" : "짝 현황 보기"}</button>
        {shown && (
          <button type="button" className="pk-btn sm" onClick={() => readAll("clues").then(setClues).catch(() => setClues({}))}>
            {clues ? "단서 다시 불러오기" : "마니또가 낸 단서 보기"}
          </button>
        )}
      </div>
      {!shown && <p className="small muted">사무실에서 옆 사람이 볼 수 있어서 접어 뒀어요. 볼 때만 펼치세요.</p>}
      {shown && clues && <p className="small">단서: 마니또가 대상에게 낸 프로필 답이에요. 사실과 다르면(거짓 단서) 수상 제외를 검토하세요. 6칸을 다 내지 않은 마니또는 은신 응모권이 없어요.</p>}
      {shown && <div className="table-wrap">
        <table className="pk-table pair-table">
          <thead>
            <tr><th>마니또</th><th>대상</th><th>1주차</th><th>2주차</th><th>3주차</th>{showGuess && <th>대상의 지목</th>}{clues && <th>단서</th>}</tr>
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
                {clues && clueCell(r)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
    </Panel>
  );
}

// 고른 미션 카드(사용자가 정함: "실제 어떤 카드를 각자 뽑아서 하고 있는지 내가 보게"). 짝 현황과 같은 자료(usePairs)를 쓴다.
// 카드별 인원(이름 없음)은 바로 보이고, 누가 어떤 카드를 골랐는지는 "사람별 보기"를 눌러야 보인다(사무실에서 화면이 보일 수 있어서).
// 황금 카드 추첨(사용자가 정함, 11/23): 그 주가 끝나면(2주차는 3주차가 열린 뒤, 3주차는 미션 마감 뒤) 운영자가 누른다.
// 대상: 그 주에 황금 카드를 골라 완료를 알렸고 대상이 "카드와 같아요"로 인증한 마니또(lib/gold.js). 같은 확률로 GOLD_DRAW.perWeek명,
// 앞 주 당첨자는 빼고, 앞 주에 남은 자리는 넘긴다. 한 번만(트랜잭션으로 확인). 기록은 meta/goldDraw(운영자만: 대상·당첨자·숫자),
// 참여자에게는 public/goldDraw(주차별 추첨 여부·인원 수만)와 goldWins/{당첨자}(본인만 읽음). 당첨자 이름은 송년회 전까지 공개하지 않는다.
// 매주 남긴 마니또 추측(사용자가 정함, 11/25: "운영자가 볼 수 있게"). 참여자가 용의자 보드 아래에서 주차마다 남긴 추측(midGuesses).
// 주차마다 남긴 사람·맞힌 사람 수는 바로 보이고, 누가 누구를 골랐는지(= 짝이 드러남)는 "사람별 보기"를 눌러야 보인다.
// 읽기: midGuesses 컬렉션(가입한 사람 수만큼)과 배정·명단(다른 패널과 같은 구독). "운영 자료 불러오기"를 눌렀을 때만(AdminFull).
// 패널 제목에 "주차"를 넣지 않는다(E2E가 "주차" 패널을 제목으로 찾는다).
function MidGuesses() {
  const { config } = useApp();
  const roster = useFullRoster();
  const midGuesses = useColl("midGuesses");
  const assignments = useColl("assignments");
  const [shown, setShown] = useState(false);
  if (!roster || !midGuesses || !assignments) return null;
  const week = config.week || 1;
  const { summary, rows } = midGuessStats({ midGuesses, assignments, roster, week });
  const nameOfPid = (pid) => roster.find((r) => r.pid === pid)?.name || "(알 수 없음)";
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const open = (w) => config.phase === PHASE.RUNNING && w === week;
  return (
    <Panel title="매주 남긴 마니또 추측">
      <p className="small">
        참여자가 추리 보드의 용의자 보드 아래에서 매주 남긴 "내 마니또는 이 사람 같아요" 추측이에요. 지금 열린 주차만 남기거나 바꿀 수 있고,
        다음 주차가 열리면 그 주차는 마감돼요. 응모권과는 상관없고, 송년회에서 명탐정("가장 먼저 알아챈 사람")과 투명 마니또 칭호에 쓰여요.
      </p>
      <ul className="plain mid-guess-summary">
        {summary.map((x) => (
          <li key={x.week}>
            <b>{x.week}주차</b> {open(x.week) ? <span className="small">(받는 중)</span> : <span className="small muted">(마감)</span>}
            {" "}· 남김 <b>{x.guessed}</b>/{x.eligible}명({pct(x.guessed, x.eligible)}%) · 맞힘 <b>{x.correct}</b>명
          </li>
        ))}
      </ul>
      <p className="small muted">가입한 사람(중도 이탈 제외) 기준이에요.</p>
      <div className="reveal-row">
        <button type="button" className="pk-btn sm" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? "사람별 가리기" : "사람별 보기"}</button>
        {shown && <span className="small warn-text">누가 누구를 맞혔는지(= 짝)가 보여요. 화면을 공유할 때는 가려 주세요.</span>}
      </div>
      {shown && (
        <div className="table-wrap">
          <table className="pk-table pick-table mid-guess-table">
            <thead>
              <tr><th className="left">추측한 사람</th>{summary.map((x) => <th key={x.week}>{x.week}주차</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.pid}>
                  <td className="left">{r.name}{r.part && <span className="small muted"> {r.part}</span>}</td>
                  {summary.map((x) => {
                    const c = r.cells[x.week];
                    return <td key={x.week} className={c?.correct ? "mid-hit" : ""}>{c ? `${nameOfPid(c.pid)}${c.correct ? " ✔" : ""}` : <span className="muted">-</span>}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted">✔ = 실제 마니또를 맞힌 추측</p>
        </div>
      )}
    </Panel>
  );
}

function GoldDraw() {
  const { config, nameOf } = useApp();
  const roster = useFullRoster();
  const missions = useColl("giverMissions");
  const giverCodes = useColl("giverCodes");
  const redemptions = useColl("redemptions");
  const [record, setRecord] = useState(undefined);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => onSnapshot(doc(db, "meta", "goldDraw"), (s) => setRecord(s.exists() ? s.data().weeks || {} : {}), () => setRecord({})), []);
  if (!roster || !missions || !giverCodes || !redemptions || record === undefined) return null;

  const names = (pids) => pids.map(nameOf).join(", ") || "없음";
  const rows = GOLD_DRAW.weeks.map((w) => {
    const done = record[String(w)] || null;
    const exclude = GOLD_DRAW.weeks.filter((x) => x < w).flatMap((x) => record[String(x)]?.winners || []);
    const candidates = goldCandidates({ week: w, missions, giverCodes, redemptions, roster, exclude });
    const chose = Object.entries(missions).filter(([, m]) => isGoldChoice(m.choices?.[String(w)])).map(([pid]) => pid);
    const completed = chose.filter((pid) => missions[pid].done?.[String(w)] === true);
    const prevDone = GOLD_DRAW.weeks.filter((x) => x < w).every((x) => record[String(x)]);
    return { w, done, candidates, chose, completed, count: goldCount(w, record), closed: goldWeekClosed(w, config), prevDone };
  });

  async function run(row) {
    setMsg("");
    if (!window.confirm(`${row.w}주차 황금 카드 추첨을 할까요?\n\n추첨 대상 ${row.candidates.length}명(황금 카드를 하고 대상이 "카드와 같아요"로 인증한 마니또) 중 ${Math.min(row.count, row.candidates.length)}명을 뽑아요.\n대상의 인증이 아직 안 온 마니또는 빠져요. 한 번만 할 수 있어요.`)) return;
    setBusy(true);
    try {
      await runTransaction(db, async (tx) => {
        const ref = doc(db, "meta", "goldDraw");
        const cur = await tx.get(ref);
        const weeks = cur.exists() ? cur.data().weeks || {} : {};
        if (weeks[String(row.w)]) throw new Error("already");
        const seed = String(Math.floor(secureRandom() * 1e9)).padStart(9, "0");
        const winners = drawGold(row.candidates, row.count, seed);
        tx.set(ref, { weeks: { [row.w]: { at: serverTimestamp(), seed, count: row.count, candidates: row.candidates, winners } } }, { merge: true });
        tx.set(doc(db, "public", "goldDraw"), { weeks: { [row.w]: { at: serverTimestamp(), candidates: row.candidates.length, winners: winners.length } } }, { merge: true });
        for (const pid of winners) tx.set(doc(db, "goldWins", pid), { weeks: { [row.w]: true }, at: serverTimestamp() }, { merge: true });
      });
      setMsg(`${row.w}주차 추첨을 마쳤어요. 뽑힌 마니또는 자기 내 미션 화면에서 확인할 수 있어요.`);
    } catch (e) {
      setMsg(e.message === "already" ? "이미 추첨한 주차예요." : "추첨하지 못했어요. 잠시 뒤 다시 눌러 주세요. 계속 안 되면 콘솔의 보안 규칙이 최신인지 확인해 주세요.");
    }
    setBusy(false);
  }

  return (
    <Panel title="황금 카드 추첨">
      <p className="small">
        주차가 끝나면(2주차는 3주차가 열린 뒤, 3주차는 미션 마감 뒤) 누르세요. 그 주에 황금 카드를 하고 대상이 "카드와 같아요"로 인증한 마니또 중
        {" "}{GOLD_DRAW.perWeek}명을 같은 확률로 뽑아요({GOLD_DRAW.prize}, 송년회에서 발표하며 전달). 2주차 당첨자는 3주차 추첨에서 빠지고, 대상이 {GOLD_DRAW.perWeek}명보다 적으면 남은 자리는 다음 주로 넘어가요.
        누르는 시점까지 인증된 것만 세니, 대상의 인증을 하루 이틀 기다렸다 눌러도 돼요.
      </p>
      <p className="small warn-text">당첨자 이름은 송년회 전까지 알리지 마세요. 황금 카드를 받은 대상이 당첨자 명단으로 자기 마니또를 좁힐 수 있어요. 당첨자는 자기 화면에서만 확인해요.</p>
      <ul className="plain">
        {rows.map((row) => (
          <li key={row.w} className="row-item">
            <p><b>{row.w}주차</b> · 황금 카드 고름 {row.chose.length}명 · 완료 {row.completed.length}명 · 추첨 대상 {row.candidates.length}명 · 뽑을 수 {row.count}명</p>
            {row.done ? (
              <p className="small">
                추첨 완료: <b>{names(row.done.winners || [])}</b> (대상 {(row.done.candidates || []).length}명, 숫자 {row.done.seed})
              </p>
            ) : (
              <>
                {row.candidates.length > 0 && <p className="small muted">추첨 대상: {names(row.candidates)}</p>}
                <button type="button" className="pk-btn sm" disabled={busy || !row.closed || !row.prevDone || row.candidates.length === 0} onClick={() => run(row)}>
                  {row.w}주차 황금 카드 추첨하기
                </button>
                {!row.closed && <span className="small muted"> {row.w}주차가 끝나면 누를 수 있어요.</span>}
                {row.closed && !row.prevDone && <span className="small muted"> 앞 주차 추첨을 먼저 해 주세요.</span>}
                {row.closed && row.prevDone && row.candidates.length === 0 && <span className="small muted"> 아직 추첨 대상이 없어요.</span>}
              </>
            )}
          </li>
        ))}
      </ul>
      {msg && <p className="note" role="status">{msg}</p>}
    </Panel>
  );
}

function CardPicks() {
  const { config, nameOf, byPid } = useApp();
  const { ready, rows } = usePairs();
  const [slot, setSlot] = useState(() => Math.min(3, Math.max(1, config.week || 1)));
  const [shown, setShown] = useState(false);
  if (!ready || rows.length === 0) return null;

  const { people, cards, counts } = cardPicks(rows, slot);
  const picked = rows.length - counts.none;
  const levelLabel = (lv) => (lv === "praise" ? "칭찬만" : LEVEL_LABEL[lv] || lv);
  const partOf = (pid) => byPid[pid]?.part || "";
  const sorted = [...people].sort((a, b) => Number(!a.level) - Number(!b.level)
    || partOf(a.giverPid).localeCompare(partOf(b.giverPid), "ko") || nameOf(a.giverPid).localeCompare(nameOf(b.giverPid), "ko"));
  const open = slot <= (config.week || 1);

  return (
    <Panel title={`고른 미션 카드 (${picked} / ${rows.length}명)`}>
      <p className="small">
        주차마다 마니또들이 고른 카드예요. 카드별 인원은 이름 없이 보이고, 누가 골랐는지는 "사람별 보기"를 눌러야 보여요.
        "사람별 보기"의 인증 코드는 대상이 코드를 못 받았을 때 알려 주는 용도예요(코드로는 마니또가 누구인지 알 수 없어요).
      </p>
      <div className="chip-row" role="group" aria-label="주차 고르기">
        {[1, 2, 3].map((s) => (
          <button key={s} type="button" className={s === slot ? "chip is-on" : "chip"} aria-pressed={s === slot} onClick={() => setSlot(s)}>{s}주차</button>
        ))}
      </div>
      {!open && <p className="small muted">{slot}주차는 아직 열리지 않았어요.</p>}
      <p className="small pick-counts">
        {slot === PRAISE_SLOT ? <>칭찬만 <b>{counts.praise}</b> · </> : <>쉬움 <b>{counts.easy}</b> · </>}보통 <b>{counts.normal}</b> · 도전 <b>{counts.hard}</b> · 아직 안 고름 <b>{counts.none}</b>
        <br />
        <span className="how-tag how-site">{CARD_HOW.site.label}</span> <b>{counts.site}</b> · <span className="how-tag how-real">{CARD_HOW.real.label}</span> <b>{counts.real}</b>
        {" "}· 완료 알림 <b>{counts.done}</b> · 인증됨 <b>{counts.redeemed}</b>
        {counts.noCode > 0 && <><br /><span className="warn-text">코드 안 보냄 <b>{counts.noCode}</b>: 완료를 알렸지만 쪽지에 인증 코드를 넣지 않아 대상이 인증할 수 없어요. "사람별 보기"에서 코드를 확인해 대상에게 알려 주세요.</span></>}
      </p>
      {cards.length === 0 ? <p className="muted">아직 고른 카드가 없어요.</p> : (
        <div className="table-wrap">
          <table className="pk-table pick-table">
            <thead><tr><th>카드</th><th>고름</th><th>완료</th><th>인증</th></tr></thead>
            <tbody>
              {cards.map((c) => (
                <tr key={c.key}>
                  <td className="card-cell"><span className="small">{levelLabel(c.level)}</span> <HowTag card={{ cardId: c.key, text: c.text }} /> {c.text}</td>
                  <td>{c.picked}</td><td>{c.done}</td><td>{c.redeemed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="reveal-row">
        <button type="button" className="pk-btn sm" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? "사람별 가리기" : "사람별 보기"}</button>
      </div>
      {shown && (
        <div className="table-wrap">
          <table className="pk-table pair-table pick-table">
            <thead><tr><th>마니또</th><th>대상</th><th>고른 카드</th><th>상태 · 인증 코드</th></tr></thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.giverPid}>
                  <td className="left">{nameOf(p.giverPid)}{partOf(p.giverPid) && <span className="small muted"> {partOf(p.giverPid)}</span>}</td>
                  <td className="left">{nameOf(p.receiverPid)}</td>
                  <td className="card-cell">
                    {p.level ? <><span className="small">{levelLabel(p.level)}</span> <HowTag card={p} /> {p.text}</> : <span className="muted">아직 안 고름</span>}
                  </td>
                  <td className={`status-cell ${p.noCode ? "st-reported" : `st-${p.status}`}`}>
                    {p.status === "none" ? "-" : SLOT_STATUS_LABEL[p.status]}{p.notes > 0 && <span className="small"> +쪽지 {p.notes}</span>}
                    <br /><span className="mono small">{p.code || "----"}</span>
                    {p.status !== "none" && p.status !== "chosen" && <span className="small"> {p.codeSent ? "쪽지로 보냄" : p.noCode ? "코드 안 보냄" : ""}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// 인증 코드 점검(미션 진행·최종 지목): 마니또의 코드마다 codes/{코드}가 맞는 대상·주차를 가리키는지.
// 어긋나면 대상이 맞는 코드를 넣어도 "나에게 온 코드가 아니에요"가 된다. 보안 규칙상 codes는 준비 단계에만 쓸 수 있어서
// 미션 중에는 Firebase 콘솔에서 고친다(넣을 값을 보여 준다).
function CodeCheck() {
  const { nameOf } = useApp();
  const assignments = useColl("assignments"); // 짝 현황과 같은 구독(한 번만 읽는다)
  const giverCodes = useColl("giverCodes");
  // 코드 문서(54명 기준 162건)는 운영 탭을 열 때마다 읽지 않고 "점검하기"를 누를 때만 읽는다(읽기 줄이기)
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    try { setCodes(await readAll("codes")); } catch { setCodes(undefined); } finally { setBusy(false); }
  }
  if (!assignments || !giverCodes) return null;
  const total = Object.keys(assignments).length * 3;
  if (!total) return null;
  if (!codes) {
    return (
      <p className="small code-check">
        인증 코드 점검: 대상이 맞는 코드를 넣었는데도 "나에게 온 코드가 아니에요"가 뜬다는 문의가 있을 때 눌러 보세요(코드 {total}건을 읽어요).{" "}
        <button type="button" className="pk-btn sm" disabled={busy} onClick={run}>인증 코드 점검하기</button>
        {codes === undefined && <span className="error"> 읽지 못했어요. 다시 눌러 주세요.</span>}
      </p>
    );
  }
  const bad = codeProblems(assignments, giverCodes, codes);
  if (!bad.length) return <p className="note banner" role="status">인증 코드 점검: 정상이에요. 코드 {total}개가 모두 맞는 대상·주차를 가리켜요.</p>;
  return (
    <section className="panel warn-panel" role="alert">
      <p><b>⚠ 인증 코드 점검: {bad.length}개가 어긋나요.</b> 이 코드를 받은 대상은 맞는 코드를 넣어도 "나에게 온 코드가 아니에요"가 떠요.</p>
      <p className="small">Firebase 콘솔 → Firestore → <span className="mono">codes</span> 컬렉션에서 아래 문서를 만들거나 고쳐 주세요(필드 <span className="mono">receiverPid</span>는 문자열, <span className="mono">slot</span>은 숫자). 고친 뒤 다시 점검하세요.</p>
      <ul className="small">
        {bad.map((b) => (
          <li key={`${b.giverPid}_${b.slot}`}>
            {nameOf(b.giverPid)} → {nameOf(b.receiverPid)} {b.slot}주차: {b.code
              ? <>문서 ID <span className="mono">{b.code}</span>, receiverPid = <span className="mono">{b.receiverPid}</span>, slot = <span className="mono">{b.slot}</span>{b.problem === "wrong" ? ` (지금은 ${b.got?.receiverPid ?? "?"} · ${b.got?.slot ?? "?"}주차로 돼 있음)` : " (문서 없음)"}</>
              : "마니또의 코드 자체가 없어요(giverCodes)."}
          </li>
        ))}
      </ul>
      <button type="button" className="pk-btn sm" disabled={busy} onClick={run}>다시 점검하기</button>
    </section>
  );
}

// 응모권 계산에 필요한 자료를 모두 읽어 계산한다. 집계하기와 검산이 같이 쓴다.
// awards = false(검산): 응모권만 다시 계산한다(3등·2등 동점 기준에 쓰는 공감 문서는 읽지 않는다)
async function calcAll(roster, assignVer, { awards = true } = {}) {
  const [assignments, giverCodes, redemptions, missions, guesses, deliveries, verdicts, clues, midGuesses, toManito, feed, angels, angelGifts, angelVolunteers] = await Promise.all(
    ["assignments", "giverCodes", "redemptions", "giverMissions", "guesses", "deliveries", "verdicts", "clues", "midGuesses", "toManito", "feed", "angels", "angelGifts", "angelVolunteers"]
      .map((n) => readAll(n).catch(() => ({}))) // 새 기능 컬렉션(중간 추측·한마디)이 비어 있거나 예전 규칙이어도 집계는 되게
  );
  const people = roster.map((r) => ({
    pid: r.pid, part: (r.part || "").trim() || null,
    disqualified: Boolean(r.disqualified), joined: Boolean(r.uid), dropout: Boolean(r.dropout),
  }));
  const tickets = computeTickets({
    deliveries: Object.values(deliveries).map((d) => ({ receiverPid: d.receiverPid, slot: d.slot, kind: d.kind, hidden: Boolean(d.hidden) })),
    people,
    assignments: Object.fromEntries(Object.entries(assignments).map(([g, a]) => [g, a.receiverPid])),
    giverCodes: Object.fromEntries(Object.entries(giverCodes).map(([g, c]) => [g, c.codes])),
    redemptions,
    missions,
    guesses: Object.fromEntries(Object.entries(guesses).map(([r, g]) => [r, g.guessPid])),
    // 운영자의 주차별 확인 결과: 받았음 → 마니또의 미션 인정, 못 받음 → 받는 사람 보상
    verdicts: Object.fromEntries(Object.entries(verdicts).map(([id, v]) => [id, v.verdict])),
    // 단서 6개를 다 낸 마니또만 은신 응모권
    cluesDone: cluesDoneSet(assignments, clues, assignVer ?? 0),
    // 수호천사: 연결(받는 사람 → 수호천사)과 수호천사 미션(받는 사람이 확인한 것만 센다)
    angels: Object.fromEntries(Object.entries(angels).map(([r, a]) => [r, a.angelPid])),
    angelGifts: Object.values(angelGifts).map((g) => ({ receiverPid: g.receiverPid, k: g.k, confirmed: Boolean(g.confirmed) })),
  });
  // 송년회 발표용 자료(응모권과 무관)
  const finalGuess = Object.fromEntries(Object.entries(guesses).map(([r, g]) => [r, g.guessPid]));
  const assignMap = Object.fromEntries(Object.entries(assignments).map(([g, a]) => [g, a.receiverPid]));
  const noticed = noticedWeeks(assignMap, Object.fromEntries(Object.entries(midGuesses).map(([r, m]) => [r, m.guesses || {}])), finalGuess);
  // 마니또별 미션 이야기: 주차마다 고른 카드와 인증 여부
  const story = Object.fromEntries(Object.entries(assignments).map(([g]) => {
    const codes = giverCodes[g]?.codes || {};
    return [g, [1, 2, 3].map((slot) => {
      const c = missions[g]?.choices?.[slot];
      const red = redemptions[codes[slot]];
      return { slot, level: c?.level || null, text: c?.text || "", done: missions[g]?.done?.[slot] === true, redeemed: Boolean(red && !red.voided) };
    })];
  }));
  const feedList = Object.values(feed).filter((f) => !f.voided && !f.hidden);
  // 후기별 "남이 누른 공감 수" → 3등 베스트 후기상(가장 많이 받은 후기)과 2등 동점 기준(마니또마다 내 미션 후기가 받은 공감의 합).
  // 당사자 두 사람(후기를 쓴 받는 사람, 그 미션을 한 마니또)이 누른 공감은 뺀다. 공감 문서(feedLikes)를 통째로 읽으면 최대 수천 건이라,
  // 공감을 받은 후기마다 두 사람의 문서(ID가 "글ID_pid"로 정해져 있다)만 골라 읽는다.
  let reviewRank = []; // 공감 많은 순 후기(3등 후보 순서). 1위가 더 큰 상을 받으면 다음 순위가 3등이 된다
  let tieBreak = {};
  if (awards) {
    const giverOfCode = {};
    for (const [g, c] of Object.entries(giverCodes)) for (const code of Object.values(c.codes || {})) giverOfCode[code] = g;
    const ownIds = Object.entries(redemptions)
      .filter(([, r]) => !r.voided && r.feedId && (feed[r.feedId]?.likes || 0) > 0)
      .flatMap(([code, r]) => [r.receiverPid, giverOfCode[code]].filter(Boolean).map((pid) => `${r.feedId}_${pid}`));
    const ownLikes = new Set((await Promise.all(ownIds.map(async (id) => ((await getDoc(doc(db, "feedLikes", id))).exists() ? id : null)))).filter(Boolean));
    const likeRows = reviewLikes({ redemptions, feed, giverOfCode, ownLikes });
    reviewRank = rankReviews(likeRows, new Set(people.filter((p) => p.disqualified || !p.joined || p.dropout).map((p) => p.pid)));
    tieBreak = missionLikes(likeRows);
  }
  const stats = {
    people: people.filter((p) => p.joined && !p.dropout).length,
    missions: Object.values(tickets).reduce((s, t) => s + (t.mission || 0), 0),
    notes: Object.values(deliveries).filter((d) => d.kind === "note").length,
    reviews: feedList.length,
    likes: feedList.reduce((s, f) => s + (f.likes || 0), 0),
    toManito: Object.keys(toManito).length,
    angelMissions: Object.values(angelGifts).filter((g) => g.confirmed).length,
    correct: Object.entries(finalGuess).filter(([r, g]) => assignMap[g] === r).length,
    guessed: Object.keys(finalGuess).length,
  };
  // 송년회 "숨은 수호천사" 장면: 확인된 미션이 1건 이상인 연결. order = 몇 번째로 지원했는지(먼저 지원한 순서대로 연결했음을 보이려고)
  const volunteerOrder = Object.fromEntries(angelQueue(angelVolunteers, people).map((v) => [v.pid, v.order]));
  const angelList = Object.entries(angels).map(([receiverPid, a]) => ({
    angelPid: a.angelPid, receiverPid, done: Object.values(angelGifts).filter((g) => g.receiverPid === receiverPid && g.confirmed).length,
    ...(volunteerOrder[a.angelPid] ? { order: volunteerOrder[a.angelPid] } : {}),
  })).filter((x) => x.done > 0);
  // 송년회 칭호 4개(응모권과 무관, titles.js)와 황금 카드 커피 쿠폰 당첨자(운영 화면 "황금 카드 추첨"의 기록 meta/goldDraw에서 옮김).
  // 당첨자는 추첨 기록 그대로 보인다(집계 뒤에 추첨했으면 다시 집계해야 발표 화면에 들어간다 — 집계 패널이 알려 준다).
  const titles = computeTitles({
    people,
    assignments: assignMap,
    giverCodes: Object.fromEntries(Object.entries(giverCodes).map(([g, c]) => [g, c.codes || {}])),
    redemptions, missions,
    deliveries: Object.values(deliveries),
    midGuesses: Object.fromEntries(Object.entries(midGuesses).map(([r, m]) => [r, m.guesses || {}])),
    tickets,
  });
  const goldRecord = awards ? await getDoc(doc(db, "meta", "goldDraw")).then((s) => (s.exists() ? s.data().weeks || {} : {})).catch(() => ({})) : {};
  const goldWinners = Object.fromEntries(GOLD_DRAW.weeks.filter((w) => goldRecord[String(w)])
    .map((w) => [String(w), goldRecord[String(w)].winners || []]));
  const extras = { guesses: finalGuess, noticed, story, stats, bestReview: reviewRank[0] || null, reviewRank, tieBreak, angels: angelList, titles, goldWinners };
  return { assignments, deliveries, people, tickets, extras };
}

function Scoring() {
  const { nameOf, config } = useApp();
  const fullRoster = useFullRoster();
  const roster = fullRoster || [];
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [audit, setAudit] = useState(null); // 검산 결과

  useEffect(() => {
    return onSnapshot(doc(db, "results", "public"), (s) => setResult(s.exists() ? s.data() : null));
  }, []);
  // 황금 카드 추첨 기록: 집계 전에 추첨을 끝냈는지, 집계 뒤에 추첨해서 발표 화면에 아직 안 들어갔는지 알려 준다
  const [goldRecord, setGoldRecord] = useState(null);
  useEffect(() => onSnapshot(doc(db, "meta", "goldDraw"), (s) => setGoldRecord(s.exists() ? s.data().weeks || {} : {}), () => setGoldRecord(null)), []);
  const goldMissing = goldRecord ? GOLD_DRAW.weeks.filter((w) => !goldRecord[String(w)]) : [];
  const goldStale = Boolean(result && goldRecord) && GOLD_DRAW.weeks.some((w) =>
    JSON.stringify(goldRecord[String(w)]?.winners || null) !== JSON.stringify(result.goldWinners?.[String(w)] || null));

  const [error, setError] = useState("");
  async function compute() {
    setBusy(true);
    setAudit(null);
    setError("");
    try {
      await computeAndSave();
    } catch (err) {
      setError(`집계를 저장하지 못했어요(${err?.code || err?.message || "알 수 없는 오류"}). 쪽지가 비정상적으로 많으면 "쪽지 검토"에서 정리한 뒤 다시 눌러 주세요.`);
    } finally {
      setBusy(false);
    }
  }
  async function computeAndSave() {
    const { assignments, deliveries, people, tickets, extras } = await calcAll(roster, config.assignVer);
    // 칭찬 벽: 받는 사람마다 1건(예전 방식으로 여러 건이 쌓였어도), 운영진이 가린 것은 빼고, 너무 길면 자른다
    const praiseBy = {};
    Object.values(deliveries)
      .filter((d) => d.kind === "praise" && !d.hidden && d.message)
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0))
      .forEach((d) => { praiseBy[d.receiverPid] ||= { receiverPid: d.receiverPid, message: String(d.message).slice(0, 500) }; });
    const praises = Object.values(praiseBy);

    // 추첨은 공개 단계에서만 한다(보안 규칙: 집계 단계의 결과에는 추첨 결과가 비어 있어야 한다).
    await setDoc(doc(db, "results", "public"), {
      pairs: Object.entries(assignments).map(([giverPid, a]) => ({ giverPid, receiverPid: a.receiverPid })),
      tickets: Object.fromEntries(Object.entries(tickets).map(([pid, t]) => [pid, t.total])),
      ticketDetail: tickets,
      partBoard: partStandings(people, tickets).map(({ part, members, done, max, winner }) => ({ part, members, done, max, winner })),
      praises,
      ...extras, // 발표용: 최종 지목, 알아챈 주차, 마니또별 미션 이야기, 숫자, 공감 1위 후기, 칭호, 황금 카드 당첨자
      draws: {},
      step: 0, // 발표 화면 진행. 참여자 결과 화면은 운영자가 넘긴 장면까지만 보인다
      computedAt: serverTimestamp(),
    });
  }

  // 검산: 저장된 결과의 응모권을 지금 자료로 다시 계산해 비교한다(저장하지 않음).
  // 다른 운영자가 집계했거나 집계 뒤에 결과가 바뀌었는지 확인할 때 쓴다. 공개 단계에서도 결과 탭에서 볼 수 있다.
  async function check() {
    setBusy(true);
    const { tickets } = await calcAll(roster, config.assignVer, { awards: false });
    const saved = result?.tickets || {};
    const diff = [...new Set([...Object.keys(saved), ...Object.keys(tickets)])]
      .filter((pid) => (saved[pid] ?? 0) !== (tickets[pid]?.total ?? 0))
      .map((pid) => ({ pid, saved: saved[pid] ?? 0, now: tickets[pid]?.total ?? 0 }));
    setAudit(diff);
    setBusy(false);
  }

  return (
    <>
      <Unresolved all />
      <Panel title="집계">
        <p className="small">
          응모권, 파트 대항전 순위, {PRIZES.bestReview.label}(공감을 가장 많이 받은 후기), 칭찬 벽을 계산해요. 위 "집계 전 확인"과 수상 제외·중도 이탈 표시를 먼저 끝내고 누르세요.
          다시 누르면 다시 계산돼요. 집계해야 공개 단계로 넘어갈 수 있고, 공개 단계로 넘어간 뒤에는 다시 집계할 수 없어요.
          {" "}시상은 공개 단계의 발표 화면에서 해요: 현장 숫자를 넣으면 {PRIZES.bestManito.label}(응모권 최다 {PRIZES.bestManito.count}명)와 {PRIZES.bestReview.label}이 정해지고,
          4·5등과 1등은 현장에서 종이로 뽑아 이름을 입력하고, 6등은 사이트가 뽑아요. 한 사람은 하나만 받아요(겹치면 큰 상).
        </p>
        <p className="small">
          송년회 칭호 {TITLES.map((t) => `${t.emoji} ${t.label}`).join(" · ")}(응모권과 무관, 기록으로 자동)와 황금 카드 커피 쿠폰 당첨자도 같이 저장해 발표 화면에 나와요.
        </p>
        {goldMissing.length > 0 && (
          <p className="warn-text small" role="alert">
            {goldMissing.join("·")}주차 황금 카드 추첨을 아직 안 했어요. 위 "황금 카드 추첨"에서 먼저 뽑고 집계하세요(추첨하지 않은 주차는 발표 화면에 안 나와요).
          </p>
        )}
        {goldStale && goldMissing.length < GOLD_DRAW.weeks.length && (
          <p className="warn-text small" role="alert">집계한 뒤에 황금 카드 추첨 결과가 바뀌었어요. 다시 집계해야 발표 화면에 들어가요.</p>
        )}
        <div className="reveal-row">
          <button className="pk-btn main" onClick={compute} disabled={busy || !fullRoster}>{result ? "다시 집계" : "집계하기"}</button>
          {result && <button className="pk-btn sm" onClick={check} disabled={busy || !fullRoster}>검산(다시 계산해 비교)</button>}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        {audit && (audit.length === 0
          ? <p className="note" role="status">검산: 저장된 응모권이 지금 자료로 다시 계산한 값과 모두 같아요.</p>
          : <p className="error" role="alert">검산: {audit.length}명이 달라요 — {audit.map((x) => `${nameOf(x.pid)} 저장 ${x.saved}장/다시 계산 ${x.now}장`).join(", ")}. 집계 뒤에 확인·제외 표시가 바뀌었으면 다시 집계하세요.</p>)}
        {result && (
          <ul className="plain">
            <li>응모권 상위({PRIZES.bestManito.label} 후보, 1등으로 뽑힌 사람은 빠지고 다음 순위가 받아요): {Object.entries(result.tickets || {}).filter(([, n]) => n > 0)
              .sort((x, y) => y[1] - x[1] || (result.tieBreak?.[y[0]] || 0) - (result.tieBreak?.[x[0]] || 0) || nameOf(x[0]).localeCompare(nameOf(y[0]), "ko")).slice(0, PRIZES.bestManito.count + 3)
              .map(([pid, n]) => `${nameOf(pid)} ${n}장${result.tieBreak?.[pid] ? `(♥ ${result.tieBreak[pid]})` : ""}`).join(", ") || "-"}
              {" "}— 동점이면 내 미션 후기가 받은 공감(♥)이 많은 사람, 그래도 같으면 현장 숫자로 정해요</li>
            <li>{PRIZES.bestReview.label}: {result.bestReview
              ? `${nameOf(result.bestReview.receiverPid)} (♥ ${result.bestReview.likes ?? "-"}, 당사자 공감 제외) "${String(result.bestReview.review).slice(0, 40)}…"`
              : "공감을 받은 후기가 없어 수상자가 없어요"}{result.bestReview ? " — 이 사람이 1·2등을 받으면 다음으로 공감이 많은 후기가 받아요" : ""}</li>
            <li>송년회 칭호: {(result.titles || []).map((t) => `${t.emoji} ${t.label} ${(t.winners || []).length
              ? `${t.winners.map(nameOf).join(", ")}${t.value && t.unit ? `(${t.value}${t.unit})` : ""}` : "없음"}`).join(" · ") || "다시 집계하면 계산돼요"}</li>
            <li>황금 카드 커피 쿠폰: {GOLD_DRAW.weeks.map((w) => `${w}주차 ${result.goldWinners?.[String(w)]
              ? (result.goldWinners[String(w)].map(nameOf).join(", ") || "당첨자 없음") : "추첨 전"}`).join(" · ")}</li>
            <li>파트 대항전: {(result.partBoard || []).length
              ? result.partBoard.map((x) => `${x.part} ${x.done}/${x.max}${x.winner ? " (우승)" : ""}`).join(", ")
              : "파트가 입력되지 않아 없음"}</li>
          </ul>
        )}
        {result && <SlipSheet tickets={result.tickets || {}} roster={roster} />}
      </Panel>
    </>
  );
}

// 현장 종이 추첨용: 사람마다 응모권 수만큼 이름 종이를 인쇄한다(잘라서 본인이 접어 통에 넣는다). 1·4·5등을 이 종이로 뽑는다.
function SlipSheet({ tickets, roster }) {
  const [open, setOpen] = useState(false);
  const rows = roster
    .map((r) => ({ pid: r.pid, name: r.name, part: r.part || "", n: tickets[r.pid] || 0 }))
    .filter((x) => x.n > 0)
    .sort(byPartThenName);
  const total = rows.reduce((s, x) => s + x.n, 0);
  return (
    <div className="stack tight">
      <p className="small">
        <b>현장 종이 추첨 준비</b> 응모권이 있는 사람 {rows.length}명, 이름 종이 {total}장(응모권 1장 = 종이 1장).
        아래를 인쇄해 잘라서 각자 자기 종이를 접어 통에 넣게 하세요. 집계를 다시 하면 장수가 바뀔 수 있으니 마지막 집계 뒤에 인쇄하세요.
      </p>
      <div className="inline">
        <button type="button" className="pk-btn sm" aria-pressed={open} onClick={() => setOpen(!open)}>{open ? "이름 종이 접기" : `이름 종이 ${total}장 보기`}</button>
        {open && <button type="button" className="pk-btn sm" onClick={() => window.print()}>인쇄</button>}
      </div>
      {open && (
        <div className="print-area">
          <h3 className="print-title">응모권 수 ({rows.length}명, {total}장)</h3>
          <ul className="slip-counts">
            {rows.map((x) => <li key={x.pid}>{x.name}{x.part ? ` (${x.part})` : ""} <b>{x.n}장</b></li>)}
          </ul>
          <div className="slips">
            {rows.flatMap((x) => Array.from({ length: x.n }, (_, k) => (
              <span key={`${x.pid}_${k}`} className="slip"><b>{x.name}</b>{x.part && <small>{x.part}</small>}</span>
            )))}
          </div>
        </div>
      )}
    </div>
  );
}
