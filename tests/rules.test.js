// firestore.rules 자동 테스트. Firestore 에뮬레이터가 필요하다.
//   npm run test:rules
// (firebase emulators:exec가 에뮬레이터를 띄우고 FIRESTORE_EMULATOR_HOST를 넘겨 준다. Java 21 이상 필요)
//
// 두 종류를 확인한다.
//   1) 막아야 하는 것: 남의 짝 정보·코드·단서·쪽지·인증·명단 읽기, 남의 코드로 인증, 인증 없는 피드 글,
//      단계 건너뛰기·역행, 안 열린 주차의 인증·완료·카드 고르기, 운영자의 명단 연결, 추첨 결과 덮어쓰기
//   2) 앱이 실제로 쓰는 요청이 거부되지 않는 것: 각 화면이 Firestore에 보내는 값의 모양을 그대로 옮겨 적었다.
//      화면 코드에서 쓰는 값(필드 이름·타입·길이)을 바꾸면 여기 "앱 흐름" 테스트도 같이 고칠 것.
import { after, before, beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, getDoc, getDocs, increment, limit, orderBy, query,
  runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";

import { PROFILE_QUESTIONS, RULES_VERSION } from "../src/lib/constants.js";

let env;
const N = increment(1); // 참여자가 고치는 문서에는 쓴 횟수(n)를 1 올려서 같이 쓴다
// 단서·프로필 i번 문항의 형식에 맞는 답(k번째 보기 또는 직접 쓴 글)
const A = (i, k = 0) => (PROFILE_QUESTIONS[i].options ? PROFILE_QUESTIONS[i].options[k % PROFILE_QUESTIONS[i].options.length] : `직접쓴답${k}`);

// 4명 원형 배정: p001 → p002 → p003 → p004 → p001 (맞마니또 없음, 같은 파트 없음)
// 파트: p001·p003 = 가파트, p002·p004 = 나파트. p005는 아직 가입 전(초대 코드 INV005).
const RECEIVER = { p001: "p002", p002: "p003", p003: "p004", p004: "p001" };
const UID = { p001: "u1", p002: "u2", p003: "u3", p004: "u4" };
const PART = { p001: "가파트", p002: "나파트", p003: "가파트", p004: "나파트", p005: "가파트" };
const CODES = {
  p001: { 1: "A1A1", 2: "A2A2", 3: "A3A3" },
  p002: { 1: "B1B1", 2: "B2B2", 3: "B3B3" },
  p003: { 1: "C1C1", 2: "C2C2", 3: "C3C3" },
  p004: { 1: "D1D1", 2: "D2D2", 3: "D3D3" },
};
const ADMIN = "admin"; // 운영자(참여하지 않는 계정, 명단에 연결되지 않음)
const review20 = "가".repeat(20);
// 한 번에 쓰는 추첨 결과(Reveal.jsx runDrawAll, scoring.js drawAll): 다섯 칸, 같은 숫자
// 추첨 결과(src/lib/scoring.js resolvePrizes가 읽는 모양): 현장 숫자, 종이로 뽑힌 1·4·5등 이름, 사이트가 뽑은 6등
const DRAWS = { seed: "4821", grand: { winners: ["p001"] }, t4: { winners: ["p004"] }, t5: { winners: [] }, t6: { winners: ["p002"] } };
const FEED_B1 = "feedB1B1xx"; // 시드: p003이 p002의 1주차 미션(B1B1)을 인증하면서 올라간 피드 글

async function seed({ phase = 1, week = 1, cluesReleased = 2, admins = [ADMIN], results = false, extra } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const b = writeBatch(db);
    b.set(doc(db, "config", "app"), { admins, phase, week, cluesReleased, siteMatched: false, partExcluded: true });
    for (const pid of ["p001", "p002", "p003", "p004", "p005"]) {
      b.set(doc(db, "roster", pid), { name: pid, part: PART[pid], email: `${pid}@corp.example`, uid: UID[pid] || null, disqualified: false });
      b.set(doc(db, "mailIndex", `${pid}@corp.example`), { personId: pid });
    }
    b.set(doc(db, "invites", "INV005"), { personId: "p005" });
    b.set(doc(db, "public", "roster"), { people: Object.fromEntries(["p001", "p002", "p003", "p004", "p005"].map((pid) => [pid, { name: pid, loc: "SR3", part: PART[pid] }])) });
    b.set(doc(db, "public", "board"), { week: 1, parts: [{ part: "가파트", members: 2, done: 1, max: 2 }] });
    for (const [pid, uid] of Object.entries(UID)) {
      b.set(doc(db, "users", uid), { personId: pid, eliminated: [] });
      b.set(doc(db, "assignments", pid), { receiverPid: RECEIVER[pid] });
      b.set(doc(db, "giverCodes", pid), { codes: CODES[pid] });
      b.set(doc(db, "receiverCodes", RECEIVER[pid]), { codes: CODES[pid] }); // 받는 사람 기준으로 뒤집은 코드
      for (const [slot, code] of Object.entries(CODES[pid])) {
        b.set(doc(db, "codes", code), { receiverPid: RECEIVER[pid], slot: Number(slot) });
      }
      b.set(doc(db, "profiles", pid), { answers: ["1", "2", "3", "4", "5", "6"] });
      b.set(doc(db, "progress", pid), { profileDone: true, cluesVer: 0, doneCount: 0 });
    }
    // p001(마니또)이 p002(받는 사람)에게 남긴 단서와 쪽지
    for (let i = 0; i < 6; i++) b.set(doc(db, "clues", `p002_${i}`), { receiverPid: "p002", idx: i, answer: A(i), ver: 0 });
    b.set(doc(db, "clues", "p002_6"), { receiverPid: "p002", idx: 6, answer: "가파트", ver: 0 }); // 파트 단서(배정 때 운영자 브라우저가 씀)
    if (results) b.set(doc(db, "results", "public"), { pairs: [], tickets: {}, draws: {} });
    // p002(마니또) → p003(받는 사람): 1주차 미션이 인증돼 있고 피드에 글이 올라가 있다
    b.set(doc(db, "giverMissions", "p002"), { choices: { 1: { cardId: "e1", level: "easy", text: "쪽지" } }, done: { 1: true } });
    b.set(doc(db, "redemptions", "B1B1"), { receiverPid: "p003", slot: 1, review: review20, voided: false, feedId: FEED_B1, createdAt: new Date(2026, 10, 1) });
    b.set(doc(db, "feed", FEED_B1), { slot: 1, review: review20, voided: false, createdAt: new Date(2026, 10, 1) });
    b.set(doc(db, "nudges", "p002"), { at: 1 });
    b.set(doc(db, "deliveries", "dv1"), { receiverPid: "p002", slot: 1, kind: "mission", message: "책상 확인", code: "A1A1" });
    b.set(doc(db, "meta", "assignment"), { codes: Object.values(CODES).flatMap((c) => Object.values(c)).sort(), pids: Object.keys(UID).sort() });
    await b.commit();
    if (extra) await extra(db);
  });
}

const as = (uid) => env.authenticatedContext(uid).firestore();
const asMail = (uid, email) => env.authenticatedContext(uid, { email }).firestore();
const CO = "co"; // 공동 운영자 계정(seed({ admins: [ADMIN, CO] })로 지정)
// 메일 인증을 마친 계정(토큰의 email_verified = true)
const asVerified = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
const p = (pid) => as(UID[pid]);
const admin = () => as(ADMIN);

async function setPhase(phase, more = {}) {
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "config", "app"), { phase, ...more }));
}
async function put(path, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), ...path.split("/")), data));
}
// 미션 완료 알리기(MyMission.jsx complete): 정해진 ID의 알림(고른 카드 포함)과 완료 표시를 한 묶음으로 쓴다
const EASY = { cardId: "e1", level: "easy", text: "easy 카드" };
function sendMission(db, slot, { receiverPid = "p002", kind, message, id, gm, delivery = {}, choice = EASY } = {}) {
  const k = kind || (slot === 3 ? "praise" : "mission");
  const b = writeBatch(db);
  const card = k === "mission" && choice ? { card: { level: choice.level, text: choice.text } } : {};
  b.set(doc(db, "deliveries", id || `${receiverPid}_${slot}`), {
    receiverPid, slot, kind: k, message: message ?? (slot === 3 ? "올해 정말 고마웠어요!" : ""), code: null, createdAt: serverTimestamp(), ...card, ...delivery,
  });
  const upd = gm || {
    done: { [slot]: true }, n: N,
    choices: { [slot]: slot === 3 ? { cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" } : choice },
  };
  if (upd !== "skip") b.set(doc(db, "giverMissions", "p001"), upd, { merge: true });
  return b.commit();
}
// 쪽지 더 보내기(MyMission.jsx MoreNotes): 쪽지(문서 ID = 받는사람_주차_n순번)와 쪽지 수(notes)를 한 묶음으로 쓴다
function sendNote(db, slot, k, { message = "또 응원해요", bump = true, id } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "deliveries", id || `p002_${slot}_n${k}`), { receiverPid: "p002", slot, kind: "note", message, code: null, createdAt: serverTimestamp() });
  if (bump) b.set(doc(db, "giverMissions", "p001"), { notes: { [slot]: N }, n: N }, { merge: true });
  return b.commit();
}

// 화면 코드(Detective.jsx CodeEntry)가 보내는 값과 같은 모양: 인증 문서와 피드 글을 한 묶음으로 쓴다
const feedIdOf = (code) => `feed${code}xx`;
const redemption = (receiverPid, slot, code, review = review20) =>
  ({ receiverPid, slot, review, voided: false, feedId: feedIdOf(code), createdAt: serverTimestamp() });
const post = (slot, review = review20) => ({ slot, review, voided: false, createdAt: serverTimestamp() });
function redeem(db, code, receiverPid, slot, { review = review20, r = {}, f = {}, feedId = feedIdOf(code) } = {}) {
  const b = writeBatch(db);
  b.set(doc(db, "redemptions", code), { ...redemption(receiverPid, slot, code, review), ...r });
  b.set(doc(db, "feed", feedId), { ...post(slot, review), ...f });
  return b.commit();
}

before(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("FIRESTORE_EMULATOR_HOST가 없습니다. `npm run test:rules`로 실행해 주세요.");
  }
  env = await initializeTestEnvironment({
    projectId: "demo-manito",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") },
  });
});
after(() => env?.cleanup());

// ───────────────────────── 1. 참여자는 남의 비밀을 읽을 수 없다 ─────────────────────────
describe("1. 참여자는 남의 assignments·giverCodes·codes·clues·deliveries·redemptions·roster를 읽을 수 없다", () => {
  beforeEach(() => seed());

  test("assignments: 내 것만 get, 남의 것·목록은 거부", async () => {
    await assertSucceeds(getDoc(doc(p("p001"), "assignments", "p001")));
    await assertFails(getDoc(doc(p("p001"), "assignments", "p002")));
    await assertFails(getDoc(doc(p("p001"), "assignments", "p004"))); // 내 마니또가 누구인지
    await assertFails(getDocs(collection(p("p001"), "assignments")));
  });

  test("giverCodes: 내 것만 get, 남의 것·목록은 거부 / receiverCodes(내 앞으로 발급된 코드)는 본인도 못 읽는다", async () => {
    await assertSucceeds(getDoc(doc(p("p001"), "giverCodes", "p001")));
    await assertFails(getDoc(doc(p("p001"), "giverCodes", "p004")));
    await assertFails(getDocs(collection(p("p001"), "giverCodes")));
    await assertFails(getDoc(doc(p("p002"), "receiverCodes", "p002"))); // 아직 안 받은 주차의 코드가 들어 있다
    await assertFails(getDoc(doc(p("p001"), "receiverCodes", "p002")));
    await assertFails(getDocs(collection(p("p002"), "receiverCodes")));
    await assertFails(setDoc(doc(p("p002"), "receiverCodes", "p002"), { codes: { 1: "A1A1" } }));
  });

  test("codes: 나에게 온 코드만 get, 남에게 온 코드·없는 코드·목록은 거부", async () => {
    await assertSucceeds(getDoc(doc(p("p002"), "codes", "A1A1"))); // p001 → p002
    await assertFails(getDoc(doc(p("p001"), "codes", "A1A1"))); // 보낸 사람(마니또)도 받는 사람용 코드 문서는 못 읽음
    await assertFails(getDoc(doc(p("p003"), "codes", "A1A1")));
    await assertFails(getDoc(doc(p("p002"), "codes", "ZZZZ")));
    await assertFails(getDocs(collection(p("p002"), "codes")));
  });

  test("clues: 내 단서 중 공개된 것만, 남의 단서·미공개·목록은 거부", async () => {
    await assertSucceeds(getDoc(doc(p("p002"), "clues", "p002_0")));
    await assertSucceeds(getDoc(doc(p("p002"), "clues", "p002_1")));
    await assertFails(getDoc(doc(p("p002"), "clues", "p002_2"))); // cluesReleased = 2
    await assertFails(getDoc(doc(p("p003"), "clues", "p002_0")));
    await assertFails(getDoc(doc(p("p001"), "clues", "p002_0"))); // 단서를 쓴 마니또도 못 읽음
    await assertFails(getDocs(collection(p("p002"), "clues")));
  });

  test("deliveries: 내 앞으로 온 것만, 남의 것·목록은 거부", async () => {
    await assertSucceeds(getDocs(query(collection(p("p002"), "deliveries"), where("receiverPid", "==", "p002"))));
    await assertSucceeds(getDoc(doc(p("p002"), "deliveries", "dv1")));
    await assertFails(getDoc(doc(p("p003"), "deliveries", "dv1")));
    await assertFails(getDoc(doc(p("p001"), "deliveries", "dv1"))); // 보낸 사람도 다시 못 읽음
    await assertFails(getDocs(query(collection(p("p003"), "deliveries"), where("receiverPid", "==", "p002"))));
    await assertFails(getDocs(collection(p("p002"), "deliveries")));
  });

  test("redemptions(인증 문서): 인증한 받는 사람과 그 코드의 마니또만. 다른 참여자·전체 목록은 거부", async () => {
    // B1B1: p002(마니또) → p003(받는 사람)이 인증함
    await assertSucceeds(getDoc(doc(p("p003"), "redemptions", "B1B1"))); // 받는 사람
    await assertSucceeds(getDoc(doc(p("p002"), "redemptions", "B1B1"))); // 그 코드를 가진 마니또
    await assertSucceeds(getDocs(query(collection(p("p003"), "redemptions"), where("receiverPid", "==", "p003"))));
    await assertFails(getDoc(doc(p("p001"), "redemptions", "B1B1")));
    await assertFails(getDoc(doc(p("p004"), "redemptions", "B1B1")));
    await assertFails(getDocs(collection(p("p003"), "redemptions"))); // 전체 목록(예전 익명 피드가 읽던 방식)
    await assertFails(getDocs(query(collection(p("p001"), "redemptions"), orderBy("createdAt", "desc"), limit(30))));
    await assertFails(getDocs(query(collection(p("p001"), "redemptions"), where("receiverPid", "==", "p003"))));
    await assertFails(getDocs(query(collection(p("p002"), "redemptions"), where("receiverPid", "==", "p003")))); // 마니또도 목록으로는 못 읽음
  });

  test("feed(익명 피드): 참여자는 읽지만 받는 사람 정보·코드가 없는 문서다", async () => {
    const snap = await assertSucceeds(getDocs(query(collection(p("p001"), "feed"), orderBy("createdAt", "desc"), limit(30))));
    const data = snap.docs[0].data();
    if (snap.docs[0].id !== FEED_B1 || "receiverPid" in data || "feedId" in data || "code" in data) throw new Error("피드 문서에 받는 사람 정보가 있음");
    if (Object.keys(data).sort().join() !== "createdAt,review,slot,voided") throw new Error("피드 문서 필드: " + Object.keys(data));
  });

  test("roster(명단 원본): 참여자는 못 읽는다. 요약(public/roster)만 읽는다", async () => {
    await assertFails(getDoc(doc(p("p001"), "roster", "p001"))); // 내 것도(연결된 계정 uid, 수상 제외 표시가 들어 있다)
    await assertFails(getDoc(doc(p("p001"), "roster", "p002")));
    await assertFails(getDocs(collection(p("p001"), "roster")));
    await assertSucceeds(getDoc(doc(p("p001"), "public", "roster")));
  });

  test("profiles·giverMissions·guesses·users·reports·verdicts: 남의 것은 거부", async () => {
    await put("reports/p003_1", { receiverPid: "p003", slot: 1 });
    await put("verdicts/p003_1", { receiverPid: "p003", slot: 1, verdict: "missing" });
    await assertFails(getDoc(doc(p("p002"), "profiles", "p001")));
    await assertFails(getDoc(doc(p("p002"), "giverMissions", "p001")));
    await assertFails(getDoc(doc(p("p002"), "guesses", "p001")));
    await assertFails(getDoc(doc(p("p002"), "users", "u1")));
    await assertFails(getDocs(collection(p("p002"), "guesses")));
    // 신고·확인 결과: 받는 사람(p003)과 그 사람의 마니또(p002)만
    await assertSucceeds(getDoc(doc(p("p003"), "reports", "p003_1")));
    await assertSucceeds(getDoc(doc(p("p002"), "verdicts", "p003_1")));
    await assertFails(getDoc(doc(p("p001"), "reports", "p003_1")));
    await assertFails(getDoc(doc(p("p004"), "verdicts", "p003_1")));
    await assertFails(getDocs(collection(p("p003"), "reports")));
    await assertFails(getDocs(collection(p("p003"), "verdicts")));
  });

  test("로그인하지 않으면 아무것도 못 읽는다", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "config", "app")));
    await assertFails(getDocs(collection(anon, "roster")));
    await assertFails(getDocs(collection(anon, "feed")));
    await assertFails(getDoc(doc(anon, "rulesVersion", "20261113")));
  });

  test("가입만 하고 명단 연결 전인 계정(외부인)은 비밀은 물론 명단·피드·결과도 못 읽는다", async () => {
    await put("results/public", { pairs: [] });
    const stranger = as("u-new");
    await assertFails(getDoc(doc(stranger, "assignments", "p001")));
    await assertFails(getDoc(doc(stranger, "codes", "A1A1")));
    await assertFails(getDoc(doc(stranger, "clues", "p002_0")));
    await assertFails(getDocs(collection(stranger, "roster")));
    await assertFails(getDoc(doc(stranger, "roster", "p001")));
    await assertFails(getDoc(doc(stranger, "public", "roster")));
    await assertFails(getDocs(collection(stranger, "avatars")));
    await assertFails(getDocs(collection(stranger, "redemptions")));
    await assertFails(getDocs(collection(stranger, "feed")));
    await assertFails(getDoc(doc(stranger, "feed", FEED_B1)));
    await assertFails(getDocs(collection(stranger, "nudges")));
    await setPhase(5);
    await assertFails(getDoc(doc(stranger, "results", "public")));
    // 설정(공지, 운영자 계정 번호·메모)도 못 읽는다. 연결 전에 필요한 것은 초대 코드 하나 확인뿐
    await assertFails(getDoc(doc(stranger, "config", "app")));
    await assertSucceeds(getDoc(doc(stranger, "invites", "INV005")));
    await assertFails(getDocs(collection(stranger, "invites")));
    // 아직 설정이 없을 때만 "없음"을 확인할 수 있다(첫 운영자 설정 화면)
    await env.clearFirestore();
    const none = await assertSucceeds(getDoc(doc(stranger, "config", "app")));
    if (none.exists()) throw new Error("설정이 있음");
  });
});

// ───────────────────────── 2. 인증과 익명 피드 ─────────────────────────
describe("2. 인증은 나에게 온 코드로만, 피드 글은 내 실제 인증에 딸린 것만", () => {
  beforeEach(() => seed());

  test("받는 사람은 자기에게 온 코드로 인증하고, 같은 묶음으로 피드 글이 올라간다", async () => {
    await assertSucceeds(redeem(p("p002"), "A1A1", "p002", 1));
    const snap = await assertSucceeds(getDoc(doc(p("p004"), "feed", feedIdOf("A1A1")))); // 다른 참여자가 피드에서 읽음
    if (snap.data().review !== review20 || snap.data().slot !== 1) throw new Error("피드 글 내용이 다름");
  });

  test("인증만(피드 글 없이), 피드 글만(인증 없이)은 거부", async () => {
    await assertFails(setDoc(doc(p("p002"), "redemptions", "A1A1"), redemption("p002", 1, "A1A1")));
    await assertFails(setDoc(doc(p("p002"), "feed", feedIdOf("A1A1")), post(1)));
    await assertFails(setDoc(doc(p("p001"), "feed", "spamspamspam"), post(1))); // 아무 참여자나 피드에 글 올리기
    await assertFails(addDoc(collection(p("p004"), "feed"), post(1)));
  });

  test("피드 글은 인증과 맞아야 한다: 후기·주차·문서 ID가 다르거나 받는 사람 정보를 넣으면 거부", async () => {
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { f: { review: "나".repeat(20) } })); // 후기가 다름
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { f: { slot: 2 } })); // 주차가 다름
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { feedId: "otherfeedid" })); // 인증이 가리키는 글이 아님
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { f: { receiverPid: "p002" } })); // 받는 사람 정보
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { f: { code: "A1A1" } }));
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { f: { voided: true } }));
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { f: { createdAt: new Date(2020, 0, 1) } })); // 시각을 꾸며 순서 바꾸기
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { r: { feedId: "short" } }));
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { r: { createdAt: new Date(2020, 0, 1) } })); // 인증 시각 꾸미기
    // 남의 기존 피드 글을 가리키는 인증(피드 글 없이 인증 + 남의 글에 감사 답장 위조)
    await assertFails(setDoc(doc(p("p002"), "redemptions", "A1A1"), { ...redemption("p002", 1, "A1A1"), feedId: FEED_B1 }));
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { r: { extra: 1 } })); // 인증 문서에 다른 필드
    await assertSucceeds(redeem(p("p002"), "A1A1", "p002", 1));
    // 이미 인증한 뒤에 그 인증에 글을 하나 더 붙일 수 없다
    await assertFails(setDoc(doc(p("p002"), "feed", "secondpost00"), post(1)));
    // 남의 인증에 딸린 글을 내가 만들 수 없다(p003의 인증 B1B1 → 피드 FEED_B1은 이미 있고, 다른 ID로도 안 됨)
    await assertFails(setDoc(doc(p("p004"), "feed", "feedB1B1yy"), post(1)));
  });

  test("남에게 온 코드는 거부: 제3자, 코드를 가진 마니또 본인, 받는 사람 이름을 사칭해도", async () => {
    await assertFails(redeem(p("p003"), "A1A1", "p003", 1));
    await assertFails(redeem(p("p003"), "A1A1", "p002", 1));
    await assertFails(redeem(p("p001"), "A1A1", "p002", 1));
    await assertFails(redeem(p("p001"), "A1A1", "p001", 1));
  });

  test("없는 코드는 거부", async () => {
    await assertFails(redeem(p("p002"), "ZZZZ", "p002", 1));
  });

  test("슬롯 위조, voided: true, 후기 19자·501자는 거부 / 20자·500자는 통과", async () => {
    await assertFails(redeem(p("p002"), "A1A1", "p002", 2));
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { r: { voided: true } }));
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { review: "가".repeat(19) }));
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { review: "가".repeat(501) }));
    await assertSucceeds(redeem(p("p002"), "A1A1", "p002", 1, { review: "가".repeat(500) }));
  });

  test("아직 열리지 않은 주차의 코드로는 인증할 수 없다", async () => {
    await assertFails(redeem(p("p002"), "A2A2", "p002", 2)); // 1주차인데 2주차 코드
    await assertFails(redeem(p("p002"), "A3A3", "p002", 3));
    await setPhase(1, { week: 2 });
    await assertSucceeds(redeem(p("p002"), "A2A2", "p002", 2));
    await assertFails(redeem(p("p002"), "A3A3", "p002", 3));
    await setPhase(1, { week: 3 });
    await assertSucceeds(redeem(p("p002"), "A3A3", "p002", 3));
    await assertSucceeds(redeem(p("p002"), "A1A1", "p002", 1)); // 지난 주차 것은 늦게라도 된다
  });

  test("인증은 미션 진행(1)·최종 지목(2) 단계에만: 미션이 마감된 뒤에도 지목이 마감될 때까지는 된다", async () => {
    for (const phase of [0, 3, 4, 5]) {
      await setPhase(phase);
      await assertFails(redeem(p("p002"), "A1A1", "p002", 1));
    }
    await setPhase(2);
    await assertSucceeds(redeem(p("p002"), "A1A1", "p002", 1));
  });

  test("한 묶음에서 두 주차 인증이 피드 글 하나를 같이 가리킬 수 없다(글의 주차가 인증의 주차와 같아야 한다)", async () => {
    await setPhase(1, { week: 2 });
    const db = p("p002");
    const b = writeBatch(db);
    b.set(doc(db, "redemptions", "A1A1"), redemption("p002", 1, "A1A1", review20));
    b.set(doc(db, "redemptions", "A2A2"), { ...redemption("p002", 2, "A2A2", review20), feedId: feedIdOf("A1A1") });
    b.set(doc(db, "feed", feedIdOf("A1A1")), post(1, review20));
    await assertFails(b.commit());
  });

  test("인증할 때 카드 확인(cardMatch)은 마니또의 완료 알림이 있을 때만 같이 남길 수 있다", async () => {
    // 완료 알림(카드)이 없는데 "카드와 같아요"를 넣어 인증할 수 없다(카드를 보지 않고 확인한 것)
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { r: { cardMatch: true } }));
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { r: { cardMatch: false } }));
    await put("deliveries/p002_1", { receiverPid: "p002", slot: 1, kind: "mission", message: "", code: null, card: { level: "hard", text: "도전 카드" } });
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { r: { cardMatch: "yes" } }));
    await assertSucceeds(redeem(p("p002"), "A1A1", "p002", 1, { r: { cardMatch: true } }));
  });

  test("받는 사람의 나중 카드 확인: 완료 알림보다 먼저 인증한 경우, 알림이 온 뒤 한 번만 남긴다", async () => {
    // p002가 실물 코드로 먼저 인증(카드를 못 봐서 cardMatch 없음)
    await assertSucceeds(redeem(p("p002"), "A1A1", "p002", 1));
    const ref = doc(p("p002"), "redemptions", "A1A1");
    await assertFails(updateDoc(ref, { cardMatch: true })); // 아직 완료 알림(카드)이 없다
    await put("deliveries/p002_1", { receiverPid: "p002", slot: 1, kind: "mission", message: "", code: null, card: { level: "hard", text: "도전 카드" } });
    await assertFails(updateDoc(ref, { cardMatch: "yes" }));
    await assertFails(updateDoc(ref, { cardMatch: true, review: "가".repeat(30) })); // 다른 값은 못 바꾼다
    await assertFails(updateDoc(doc(p("p001"), "redemptions", "A1A1"), { cardMatch: true })); // 마니또가 스스로
    await assertFails(updateDoc(doc(p("p003"), "redemptions", "A1A1"), { cardMatch: true })); // 남
    await assertSucceeds(updateDoc(ref, { cardMatch: false }));
    await assertFails(updateDoc(ref, { cardMatch: true })); // 한 번 남기면 받는 사람은 못 바꾼다
    await assertSucceeds(updateDoc(doc(admin(), "redemptions", "A1A1"), { cardMatch: true })); // 운영자는 고칠 수 있다
  });

  test("한 번 인증한 것은 받는 사람이 고치거나 지울 수 없다(피드 글도)", async () => {
    await assertSucceeds(redeem(p("p002"), "A1A1", "p002", 1));
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1, { review: "나".repeat(20) }));
    await assertFails(updateDoc(doc(p("p002"), "redemptions", "A1A1"), { voided: true }));
    await assertFails(deleteDoc(doc(p("p002"), "redemptions", "A1A1")));
    await assertFails(updateDoc(doc(p("p002"), "feed", feedIdOf("A1A1")), { review: "나".repeat(20) }));
    await assertFails(updateDoc(doc(p("p002"), "feed", feedIdOf("A1A1")), { voided: true }));
    await assertFails(deleteDoc(doc(p("p002"), "feed", feedIdOf("A1A1"))));
  });

  test("운영자는 인증과 피드 글의 voided만 바꿀 수 있다 (Admin.jsx Moderation)", async () => {
    const db = admin();
    const b = writeBatch(db);
    b.update(doc(db, "redemptions", "B1B1"), { voided: true });
    b.update(doc(db, "feed", FEED_B1), { voided: true });
    await assertSucceeds(b.commit());
    await assertFails(updateDoc(doc(db, "redemptions", "B1B1"), { review: "나".repeat(20) }));
    await assertFails(updateDoc(doc(db, "redemptions", "B1B1"), { receiverPid: "p004" }));
    await assertFails(updateDoc(doc(db, "feed", FEED_B1), { review: "나".repeat(20) }));
    await assertFails(updateDoc(doc(db, "feed", FEED_B1), { thanks: "운영자가 쓴 답장" }));
    // 감사 답장 지우기
    await put("feed/" + FEED_B1, { slot: 1, review: review20, voided: false, createdAt: new Date(2026, 10, 1), thanks: "막말 답장" });
    await assertSucceeds(updateDoc(doc(db, "feed", FEED_B1), { thanks: deleteField() }));
    await assertFails(updateDoc(doc(p("p004"), "feed", FEED_B1), { hidden: true }));
    await assertFails(setDoc(doc(db, "feed", "adminpost000"), post(1))); // 운영자도 피드에 글을 만들 수는 없다
  });

  test("피드에서 가리기 (Admin.jsx Moderation): 후기를 비우고 원문은 운영자만 읽는 hiddenFeed로, 되돌리기는 원문으로만", async () => {
    const db = admin();
    const hide = (review = review20, feedReview = "") => {
      const b = writeBatch(db);
      b.set(doc(db, "hiddenFeed", FEED_B1), { review });
      b.update(doc(db, "feed", FEED_B1), { hidden: true, review: feedReview });
      return b.commit();
    };
    await assertFails(updateDoc(doc(db, "feed", FEED_B1), { hidden: true })); // 표시만 하면 직접 요청으로 내용이 보이므로 거부
    await assertFails(updateDoc(doc(db, "feed", FEED_B1), { hidden: true, review: "" })); // 원문을 옮기지 않고 지우기
    await assertFails(hide("나".repeat(20))); // 옮긴 원문이 실제 후기와 다름
    await assertFails(hide(review20, "가린 글")); // 후기를 다른 글로 바꾸기
    await assertSucceeds(hide());
    // 참여자에게는 빈 후기만 보이고, 원문은 못 읽는다
    const seen = await assertSucceeds(getDoc(doc(p("p004"), "feed", FEED_B1)));
    if (seen.data().review !== "" || seen.data().hidden !== true) throw new Error("가린 글의 후기가 남아 있음");
    await assertFails(getDoc(doc(p("p004"), "hiddenFeed", FEED_B1)));
    await assertFails(getDoc(doc(p("p003"), "hiddenFeed", FEED_B1))); // 글쓴이도
    await assertFails(setDoc(doc(p("p003"), "hiddenFeed", FEED_B1), { review: "바꿔치기" }));
    await assertSucceeds(getDoc(doc(db, "hiddenFeed", FEED_B1)));
    // 가린 글에는 감사 답장을 붙일 수 없다(후기가 인증 문서와 달라짐)
    await assertFails(updateDoc(doc(p("p003"), "feed", FEED_B1), { thanks: "고마워요" }));
    // 다시 보이기: hiddenFeed의 원문으로만
    await assertFails(updateDoc(doc(db, "feed", FEED_B1), { hidden: false, review: "나".repeat(20) }));
    await assertFails(updateDoc(doc(db, "feed", FEED_B1), { hidden: true, review: review20 })); // 가린 채로 내용 되살리기
    const b = writeBatch(db);
    b.update(doc(db, "feed", FEED_B1), { hidden: false, review: review20 });
    b.delete(doc(db, "hiddenFeed", FEED_B1));
    await assertSucceeds(b.commit());
    // 예전 방식으로 가린 글(hidden만 있고 후기가 남은 것)은 다시 보이기만 된다
    await put("feed/" + FEED_B1, { slot: 1, review: review20, voided: false, hidden: true, createdAt: new Date(2026, 10, 1) });
    await assertSucceeds(updateDoc(doc(db, "feed", FEED_B1), { hidden: false }));
  });

  test("감사 답장은 그 글을 쓴 받는 사람만, 한 번만 (Detective.jsx ThanksForm)", async () => {
    // FEED_B1은 p003이 쓴 글(p002가 보낸 1주차 미션)
    await assertFails(updateDoc(doc(p("p004"), "feed", FEED_B1), { thanks: "고마워요" })); // 다른 참여자
    await assertFails(updateDoc(doc(p("p002"), "feed", FEED_B1), { thanks: "고마워요" })); // 미션을 보낸 마니또
    await assertFails(updateDoc(doc(p("p003"), "feed", FEED_B1), { thanks: "" }));
    await assertFails(updateDoc(doc(p("p003"), "feed", FEED_B1), { thanks: "가".repeat(201) }));
    await assertFails(updateDoc(doc(p("p003"), "feed", FEED_B1), { thanks: "고마워요", review: "나".repeat(20) }));
    await assertSucceeds(updateDoc(doc(p("p003"), "feed", FEED_B1), { thanks: "고마워요" }));
    await assertFails(updateDoc(doc(p("p003"), "feed", FEED_B1), { thanks: "다시 씀" })); // 한 번만
  });

  // 글쓴이의 고치기(Detective.jsx MyPost)가 보내는 묶음. FEED_B1은 p003이 쓴 글(인증 문서 B1B1)
  const reviewEdit = (db, text, { hidden = false, bumpBy = 1, editedAt = serverTimestamp(), skipFeed = false, skipRed = false, extraRed = {} } = {}) => {
    const b = writeBatch(db);
    if (!skipRed) b.update(doc(db, "redemptions", "B1B1"), { review: text, edits: increment(bumpBy), ...extraRed });
    if (hidden) {
      b.update(doc(db, "hiddenFeed", FEED_B1), { review: text });
      if (!skipFeed) b.update(doc(db, "feed", FEED_B1), { editedAt });
    } else if (!skipFeed) {
      b.update(doc(db, "feed", FEED_B1), { review: text, editedAt });
    }
    return b.commit();
  };
  const thanksEdit = (db, thanks, { bumpRed = true } = {}) => {
    const b = writeBatch(db);
    if (bumpRed) b.update(doc(db, "redemptions", "B1B1"), { review: review20, edits: increment(1) });
    b.update(doc(db, "feed", FEED_B1), { thanks, editedAt: serverTimestamp() });
    return b.commit();
  };
  const fixed = "다".repeat(25); // 이름을 지운 후기

  test("글쓴이의 후기 고치기 (Detective.jsx MyPost): 인증 문서와 피드 글을 한 묶음으로 같은 글로, 고친 시각을 남긴다", async () => {
    const me = p("p003");
    await assertFails(reviewEdit(p("p004"), fixed)); // 다른 참여자
    await assertFails(reviewEdit(p("p002"), fixed)); // 그 미션을 보낸 마니또
    await assertFails(reviewEdit(admin(), fixed)); // 운영자도 남의 후기를 고칠 수 없다
    await assertFails(reviewEdit(me, fixed, { skipFeed: true })); // 인증 문서만(피드 글은 예전 후기)
    await assertFails(reviewEdit(me, fixed, { skipRed: true })); // 피드 글만
    await assertFails(updateDoc(doc(me, "feed", FEED_B1), { review: fixed })); // 피드 글만, 고친 시각도 없이
    await assertFails(reviewEdit(me, fixed, { editedAt: new Date(2026, 10, 1) })); // 고친 시각을 지어내기
    await assertFails(reviewEdit(me, fixed, { bumpBy: 2 })); // 횟수는 1씩
    await assertFails(reviewEdit(me, "짧은 후기")); // 20자 미만
    await assertFails(reviewEdit(me, "가".repeat(501)));
    await assertFails(reviewEdit(me, fixed, { extraRed: { voided: false, cardMatch: true } })); // 다른 칸까지
    {
      const b = writeBatch(me); // 인증 문서와 피드 글을 서로 다른 글로
      b.update(doc(me, "redemptions", "B1B1"), { review: fixed, edits: increment(1) });
      b.update(doc(me, "feed", FEED_B1), { review: "라".repeat(25), editedAt: serverTimestamp() });
      await assertFails(b.commit());
    }
    await assertSucceeds(reviewEdit(me, fixed));
    const f = (await assertSucceeds(getDoc(doc(p("p004"), "feed", FEED_B1)))).data();
    if (f.review !== fixed || !f.editedAt) throw new Error("고친 후기·시각이 피드 글에 없음");
    const r = (await assertSucceeds(getDoc(doc(me, "redemptions", "B1B1")))).data();
    if (r.review !== fixed || r.edits !== 1) throw new Error("인증 문서의 후기·횟수가 다름");
    // 고친 뒤에도 감사 답장(처음 쓰기)·공감은 그대로 된다
    await assertSucceeds(updateDoc(doc(me, "feed", FEED_B1), { thanks: "고마워요" }));
  });

  test("고치기는 후기·답장 합쳐 3번까지, 집계 전(단계 1~3)까지만", async () => {
    const me = p("p003");
    for (let k = 1; k <= 3; k++) await assertSucceeds(reviewEdit(me, `${k}번째로 고친 후기예요. 이름은 지웠어요.`));
    await assertFails(reviewEdit(me, "네 번째로 고친 후기예요. 이름은 지웠어요."));
    await seed();
    await setPhase(3);
    await assertSucceeds(reviewEdit(me, fixed)); // 마감(지목 끝, 집계 전)
    await setPhase(4);
    await assertFails(reviewEdit(me, "집계 뒤에 고친 후기예요. 이름은 지웠어요."));
  });

  test("감사 답장 고치기: 이미 쓴 답장만, 인증 문서의 횟수와 한 묶음으로(지우기는 안 됨)", async () => {
    const me = p("p003");
    await assertFails(thanksEdit(me, "고친 답장")); // 아직 답장이 없으면 고치기가 아니라 처음 쓰기로
    await assertSucceeds(updateDoc(doc(me, "feed", FEED_B1), { thanks: "고마워요" }));
    await assertFails(thanksEdit(me, "고친 답장", { bumpRed: false })); // 횟수 없이
    await assertFails(thanksEdit(me, ""));
    await assertFails(thanksEdit(me, "가".repeat(201)));
    await assertFails(thanksEdit(me, deleteField()));
    await assertFails(thanksEdit(p("p004"), "남이 고친 답장"));
    await assertSucceeds(thanksEdit(me, "정말 고마워요"));
    const f = (await getDoc(doc(me, "feed", FEED_B1))).data();
    if (f.thanks !== "정말 고마워요" || !f.editedAt) throw new Error("고친 답장이 없음");
  });

  test("가린 글: 글쓴이는 원문 자리(hiddenFeed)를 고치고 피드 글은 빈 후기 그대로, 운영자가 다시 보이면 고친 글", async () => {
    const db = admin();
    const me = p("p003");
    {
      const b = writeBatch(db);
      b.set(doc(db, "hiddenFeed", FEED_B1), { review: review20 });
      b.update(doc(db, "feed", FEED_B1), { hidden: true, review: "" });
      await assertSucceeds(b.commit());
    }
    await assertFails(reviewEdit(me, fixed)); // 가린 글의 피드 후기를 다시 채우기
    await assertFails(reviewEdit(me, fixed, { hidden: true, skipFeed: true })); // 고친 시각 없이
    await assertFails(reviewEdit(p("p004"), fixed, { hidden: true }));
    await assertFails(updateDoc(doc(me, "hiddenFeed", FEED_B1), { review: fixed })); // 원문 자리만
    await assertFails(thanksEdit(me, "가린 글의 답장")); // 가린 글은 답장도 못 고친다
    await assertSucceeds(reviewEdit(me, fixed, { hidden: true }));
    const f = (await getDoc(doc(p("p004"), "feed", FEED_B1))).data();
    if (f.review !== "" || f.hidden !== true) throw new Error("가린 글의 후기가 보임");
    await assertFails(getDoc(doc(me, "hiddenFeed", FEED_B1))); // 글쓴이도 원문 자리는 못 읽는다
    if ((await getDoc(doc(db, "hiddenFeed", FEED_B1))).data().review !== fixed) throw new Error("원문 자리가 고쳐지지 않음");
    // 운영자의 "피드에 다시 보이기"(Admin.jsx toggleHide): 원문 자리의 글(고친 글)로
    const b = writeBatch(db);
    b.update(doc(db, "feed", FEED_B1), { hidden: false, review: fixed });
    b.delete(doc(db, "hiddenFeed", FEED_B1));
    await assertSucceeds(b.commit());
    // 다시 보인 글은 후기가 인증 문서와 같아서 감사 답장도 다시 된다
    await assertSucceeds(updateDoc(doc(me, "feed", FEED_B1), { thanks: "고마워요" }));
  });

  // 운영진이 지운 이유(Admin.jsx Moderation setNote): modNotes/{인증 코드}
  const note = (db, kind, reason = "이름이 들어 있어서 지웠어요", more = {}) =>
    setDoc(doc(db, "modNotes", "B1B1"), { receiverPid: "p003", slot: 1, [kind]: { reason, at: serverTimestamp() }, ...more }, { merge: true });

  test("지운 이유(modNotes): 운영자만 쓰고, 글쓴이와 운영자만 읽는다(그 미션의 마니또는 못 읽음)", async () => {
    const db = admin();
    await assertFails(note(p("p003"), "thanks")); // 글쓴이가 직접 쓰기
    await assertFails(setDoc(doc(db, "modNotes", "B1B1"), { receiverPid: "p004", slot: 1, thanks: { reason: "", at: serverTimestamp() } })); // 다른 사람 앞으로
    await assertFails(setDoc(doc(db, "modNotes", "B1B1"), { receiverPid: "p003", slot: 2, thanks: { reason: "", at: serverTimestamp() } })); // 다른 주차
    await assertFails(note(db, "thanks", "가".repeat(301)));
    await assertFails(note(db, "other"));
    await assertFails(setDoc(doc(db, "modNotes", "B1B1"), { receiverPid: "p003", slot: 1, hide: { reason: "", at: new Date(2026, 10, 1) } })); // 시각 지어내기
    await assertFails(setDoc(doc(db, "modNotes", "B1B1"), { receiverPid: "p003", slot: 1, hide: { reason: "", at: serverTimestamp(), by: "x" } }));
    await assertSucceeds(note(db, "thanks"));
    await assertSucceeds(note(db, "hide", "")); // 이유는 비워도 된다(지웠다는 기록은 남음)
    await assertSucceeds(updateDoc(doc(db, "modNotes", "B1B1"), { hide: deleteField() })); // 되돌리면 그 칸을 지운다
    const mine = await assertSucceeds(getDoc(doc(p("p003"), "modNotes", "B1B1")));
    if (mine.data().thanks.reason !== "이름이 들어 있어서 지웠어요") throw new Error("이유가 다름");
    await assertSucceeds(getDocs(query(collection(p("p003"), "modNotes"), where("receiverPid", "==", "p003"))));
    await assertFails(getDoc(doc(p("p002"), "modNotes", "B1B1"))); // 그 미션의 마니또
    await assertFails(getDoc(doc(p("p004"), "modNotes", "B1B1")));
    await assertFails(getDocs(query(collection(p("p004"), "modNotes"), where("receiverPid", "==", "p003"))));
    await assertFails(getDocs(collection(p("p003"), "modNotes"))); // 목록 전체
  });

  test("운영자가 지운 뒤에도 다시 쓴다: 답장 지우기(이유와 한 묶음) 뒤 새로 쓰기, 가리기·무효 처리하면 고칠 횟수를 0으로", async () => {
    const db = admin();
    const me = p("p003");
    await assertSucceeds(updateDoc(doc(me, "feed", FEED_B1), { thanks: "이름이 들어간 답장" }));
    {
      const b = writeBatch(db); // Admin.jsx removeThanks
      b.update(doc(db, "feed", FEED_B1), { thanks: deleteField() });
      b.set(doc(db, "modNotes", "B1B1"), { receiverPid: "p003", slot: 1, thanks: { reason: "이름이 들어 있어요", at: serverTimestamp() } }, { merge: true });
      await assertSucceeds(b.commit());
    }
    await assertSucceeds(updateDoc(doc(me, "feed", FEED_B1), { thanks: "이름을 뺀 답장" })); // 새로 다시 쓰기(고치기 횟수와 무관)
    // 고칠 횟수를 다 쓴 글
    for (let k = 1; k <= 3; k++) await assertSucceeds(reviewEdit(me, `${k}번째로 고친 후기예요. 이름은 지웠어요.`));
    await assertFails(reviewEdit(me, fixed));
    await assertFails(updateDoc(doc(db, "redemptions", "B1B1"), { edits: 5 })); // 운영자도 0으로 되돌리기만
    await assertFails(updateDoc(doc(me, "redemptions", "B1B1"), { edits: 0 })); // 글쓴이가 스스로 되돌리기
    {
      const b = writeBatch(db); // Admin.jsx toggleHide(가리기): 원문 옮기기 + 고친 횟수 0 + 이유
      const cur = (await getDoc(doc(db, "feed", FEED_B1))).data().review;
      b.set(doc(db, "hiddenFeed", FEED_B1), { review: cur });
      b.update(doc(db, "feed", FEED_B1), { hidden: true, review: "" });
      b.update(doc(db, "redemptions", "B1B1"), { edits: 0 });
      b.set(doc(db, "modNotes", "B1B1"), { receiverPid: "p003", slot: 1, hide: { reason: "이름이 들어 있어요", at: serverTimestamp() } }, { merge: true });
      await assertSucceeds(b.commit());
    }
    await assertSucceeds(reviewEdit(me, fixed, { hidden: true })); // 다시 고칠 수 있다
    {
      const b = writeBatch(db); // Admin.jsx toggleVoid(무효 처리): 고친 횟수 0 + 이유
      b.update(doc(db, "redemptions", "B1B1"), { voided: true, edits: 0 });
      b.update(doc(db, "feed", FEED_B1), { voided: true });
      b.set(doc(db, "modNotes", "B1B1"), { receiverPid: "p003", slot: 1, void: { reason: "후기 내용이 미션과 달라요", at: serverTimestamp() } }, { merge: true });
      await assertSucceeds(b.commit());
    }
  });
});

// ───────────────────────── 3. 단계·주차·단서·운영자 목록 ─────────────────────────
describe("3. 단계는 한 칸씩 앞으로만, 주차와 단서 공개에도 한도가 있다", () => {
  beforeEach(() => seed({ phase: 2, week: 3, cluesReleased: 6 }));

  test("운영자: 한 칸 올리기·유지는 가능, 건너뛰기·줄이기·지우기·문자로 바꾸기는 거부", async () => {
    const db = admin();
    await assertFails(updateDoc(doc(db, "config", "app"), { phase: 4 })); // 2 → 4 건너뛰기
    await assertFails(updateDoc(doc(db, "config", "app"), { phase: 5 }));
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { phase: 3 }));
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { notice: "투표해 주세요" })); // 단계 유지
    await assertFails(updateDoc(doc(db, "config", "app"), { phase: 2 }));
    await assertFails(updateDoc(doc(db, "config", "app"), { phase: 0 }));
    await assertFails(updateDoc(doc(db, "config", "app"), { phase: deleteField() }));
    await assertFails(updateDoc(doc(db, "config", "app"), { phase: "4" }));
  });

  test("집계 결과가 없으면 공개 단계(5)로 넘어갈 수 없다", async () => {
    await setPhase(4);
    await assertFails(updateDoc(doc(admin(), "config", "app"), { phase: 5 }));
    await assertSucceeds(setDoc(doc(admin(), "results", "public"), { pairs: [], tickets: {}, draws: {}, computedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(admin(), "config", "app"), { phase: 5 }));
  });

  test("주차는 1~3, 단서는 주차마다 2개까지만 공개되고 줄일 수 없다", async () => {
    await seed({ phase: 1, week: 1, cluesReleased: 0 });
    const cfg = doc(admin(), "config", "app");
    await assertFails(updateDoc(cfg, { week: 4 }));
    await assertFails(updateDoc(cfg, { week: 0 }));
    await assertFails(updateDoc(cfg, { week: "2" }));
    await assertFails(updateDoc(cfg, { cluesReleased: 4 })); // 1주차에 4개
    await assertFails(updateDoc(cfg, { cluesReleased: 3 }));
    await assertFails(updateDoc(cfg, { week: 3, cluesReleased: 6 })); // 주차를 건너뛰며 단서 6개 한꺼번에
    await assertFails(updateDoc(cfg, { week: 3 })); // 주차 건너뛰기
    await assertSucceeds(updateDoc(cfg, { cluesReleased: 2 })); // Admin.jsx releaseClues
    await assertFails(updateDoc(cfg, { cluesReleased: 4 })); // 같은 주에 한 번 더
    await assertSucceeds(updateDoc(cfg, { week: 2 }));
    await assertSucceeds(updateDoc(cfg, { cluesReleased: 4 }));
    await assertFails(updateDoc(cfg, { cluesReleased: 6 }));
    await assertFails(updateDoc(cfg, { cluesReleased: 2 })); // 공개한 단서를 다시 잠그기
    await assertSucceeds(updateDoc(cfg, { week: 3 }));
    await assertFails(updateDoc(cfg, { cluesReleased: 8 }));
    await assertSucceeds(updateDoc(cfg, { cluesReleased: 6 }));
    await assertFails(updateDoc(cfg, { cluesReleased: 8 }));
    // 주차를 내려도 다른 설정은 바꿀 수 있다(이미 공개한 단서 수는 그대로)
    await assertSucceeds(updateDoc(cfg, { week: 2 }));
    await assertSucceeds(updateDoc(cfg, { notice: "공지" }));
    // 배정 관련 값은 준비 단계에서만 바뀐다(미션 중에 회차를 올리면 파트 단서를 못 읽고 공개된 단서를 다시 쓸 수 있게 된다)
    await assertFails(updateDoc(cfg, { assignVer: 5 }));
    await assertFails(updateDoc(cfg, { partExcluded: false }));
    await setPhase(0);
    await assertSucceeds(updateDoc(cfg, { assignVer: 5, partExcluded: false, siteMatched: true }));
  });

  test("참여자는 config를 바꿀 수 없고, 이미 있는 config를 새로 만들어 운영자가 될 수도 없다", async () => {
    await assertFails(updateDoc(doc(p("p001"), "config", "app"), { phase: 3 }));
    await assertFails(updateDoc(doc(p("p001"), "config", "app"), { cluesReleased: 6 }));
    await assertFails(updateDoc(doc(p("p001"), "config", "app"), { admins: arrayUnion("u1") }));
    await assertFails(setDoc(doc(p("p001"), "config", "app"), { admins: ["u1"], phase: 0, week: 1, cluesReleased: 0 }));
  });

  test("운영자 목록은 처음 운영자만 바꾸고, 처음 운영자는 아무도 뺄 수 없다", async () => {
    await seed({ phase: 1, admins: [ADMIN, "co1"] });
    const co = as("co1");
    await assertFails(updateDoc(doc(co, "config", "app"), { admins: arrayRemove(ADMIN) })); // 공동 운영자가 처음 운영자를 내보내기
    await assertFails(updateDoc(doc(co, "config", "app"), { admins: arrayUnion("co2") })); // 공동 운영자가 다른 계정 추가
    await assertFails(updateDoc(doc(co, "config", "app"), { "adminNotes.co1": "사장님" })); // 공동 운영자가 메모 바꾸기
    await assertSucceeds(updateDoc(doc(co, "config", "app"), { week: 2 })); // 다른 운영 기능은 된다
    await assertFails(updateDoc(doc(admin(), "config", "app"), { admins: ["co1", ADMIN] })); // 순서를 바꿔 처음 운영자 자리 넘기기
    await assertFails(updateDoc(doc(admin(), "config", "app"), { admins: arrayRemove(ADMIN) })); // 처음 운영자 스스로도 빠질 수 없다
    await assertSucceeds(updateDoc(doc(admin(), "config", "app"), { admins: arrayUnion("co2"), "adminNotes.co2": "PL님" }));
    await assertSucceeds(updateDoc(doc(admin(), "config", "app"), { admins: arrayRemove("co1") }));
    await assertFails(updateDoc(doc(co, "config", "app"), { week: 3 })); // 빠진 계정은 운영 기능을 못 쓴다
  });

  test("첫 운영자 생성: 자기 자신만, 0단계로만", async () => {
    await env.clearFirestore();
    await assertFails(setDoc(doc(as("x"), "config", "app"), { admins: ["x", "y"], phase: 0, week: 1, cluesReleased: 0 }));
    await assertFails(setDoc(doc(as("x"), "config", "app"), { admins: ["x"], phase: 3, week: 1, cluesReleased: 0 }));
    // Login.jsx bootstrap이 보내는 값
    await assertSucceeds(setDoc(doc(as("x"), "config", "app"), { admins: ["x"], phase: 0, week: 1, cluesReleased: 0 }));
  });
});

// ───────────────────────── 4. 운영자는 참여하지 않는 계정이고, 짝·진행·지목을 언제든 본다 ─────────────────────────
describe("4. 운영자(공동 운영자)는 참여하지 않는 계정: 명단에 연결할 수 없고, 짝·진행·지목은 언제든 읽는다", () => {
  beforeEach(() => seed({ phase: 0 }));
  const open = ["assignments", "giverCodes", "codes", "receiverCodes", "giverMissions", "guesses", "progress", "redemptions", "reports", "verdicts", "roster", "users", "clues", "profiles", "deliveries", "noteFlags"];

  test("0·1·2단계 어디서나 짝·코드·미션 진행·지목·인증·신고를 읽는다 (Admin.jsx 짝 현황)", async () => {
    for (const phase of [0, 1, 2]) {
      await setPhase(phase);
      for (const name of open) await assertSucceeds(getDocs(collection(admin(), name)), `${phase}단계 ${name} 목록`);
      await assertSucceeds(getDoc(doc(admin(), "assignments", "p001")));
      await assertSucceeds(getDoc(doc(admin(), "giverCodes", "p001")));
      await assertSucceeds(getDoc(doc(admin(), "codes", "A1A1")));
      await assertSucceeds(getDoc(doc(admin(), "guesses", "p002")));
    }
  });

  test("쪽지·단서·프로필도 언제든 읽는다(괴롭힘·거짓 단서 확인)", async () => {
    for (const phase of [1, 2, 3, 4]) {
      await setPhase(phase);
      await assertSucceeds(getDocs(collection(admin(), "deliveries")));
      await assertSucceeds(getDoc(doc(admin(), "clues", "p002_0")));
      await assertSucceeds(getDoc(doc(admin(), "profiles", "p001")));
    }
  });

  test("없앤 투표 경로(votes·voteCards·voteViews·cardOwners·adminEval)는 누구도 읽고 쓸 수 없다", async () => {
    await setPhase(4);
    for (const name of ["votes", "voteCards", "voteViews", "cardOwners", "adminEval"]) {
      await assertFails(getDocs(collection(admin(), name)), name);
      await assertFails(setDoc(doc(admin(), name, "x"), { a: 1 }), name);
      await assertFails(setDoc(doc(p("p001"), name, "p001"), { a: 1 }), name);
    }
  });

  test("운영자 계정은 명단에 연결할 수 없다 (초대 코드를 알아도)", async () => {
    const db = asMail(ADMIN, "admin@example.com");
    // 운영자는 명단 문서를 고칠 수 있지만(연결 해제 등), 자기 계정의 연결 문서(users)는 만들 수 없다 → 참여자가 될 수 없다
    await assertSucceeds(updateDoc(doc(db, "roster", "p005"), { uid: ADMIN, inviteUsed: "INV005" }));
    await assertFails(setDoc(doc(db, "users", ADMIN), { personId: "p005", eliminated: [], email: "admin@example.com", n: N }));
    // 같은 초대 코드로 일반 계정은 연결된다(운영자가 uid를 지워 준 뒤)
    await assertSucceeds(updateDoc(doc(db, "roster", "p005"), { uid: null }));
    const u5 = asMail("u5", "u5@example.com");
    await assertSucceeds(updateDoc(doc(u5, "roster", "p005"), { uid: "u5", inviteUsed: "INV005" }));
    await assertSucceeds(setDoc(doc(u5, "users", "u5"), { personId: "p005", eliminated: [], email: "u5@example.com", n: N }));
  });

  test("공동 운영자 지정 (Admin.jsx CoAdmins): 연결 전 계정의 계정 번호로, 한 번에 한 명, 참여자는 지정 불가", async () => {
    await seed({ phase: 1 });
    const cfg = doc(admin(), "config", "app");
    const co = as("co-admin-uid"); // 가입만 한 계정(연결 전 화면에 계정 번호가 보인다)
    await assertFails(getDocs(collection(co, "assignments")));
    await assertFails(updateDoc(doc(co, "config", "app"), { week: 2 }));
    // 참여자(명단에 연결된 계정)는 운영자가 될 수 없다
    await assertFails(updateDoc(cfg, { admins: arrayUnion("u1") }));
    await assertFails(updateDoc(cfg, { admins: [ADMIN, "u1"] }));
    await assertFails(updateDoc(cfg, { admins: arrayUnion("co-admin-uid", "another-uid") })); // 한 번에 두 명
    // 화면이 보내는 값: 운영자 목록에 추가 + 메모
    await assertSucceeds(updateDoc(cfg, { admins: arrayUnion("co-admin-uid"), "adminNotes.co-admin-uid": "PL님" }));
    // 공동 운영자도 운영 기능과 짝 현황을 쓴다
    await assertSucceeds(updateDoc(doc(co, "config", "app"), { week: 2 }));
    await assertSucceeds(getDocs(collection(co, "assignments")));
    await assertSucceeds(getDocs(collection(co, "progress")));
    await assertSucceeds(getDocs(collection(co, "guesses")));
    // 공동 운영자도 명단에 연결할 수 없다
    await put("invites/INV005", { personId: "p005" });
    await assertFails(setDoc(doc(co, "users", "co-admin-uid"), { personId: "p005", eliminated: [], n: N }));
    // 권한 빼기: 메모도 같이 지운다. 운영자가 0명이 되게 할 수는 없다
    await assertSucceeds(updateDoc(cfg, { admins: arrayRemove("co-admin-uid"), "adminNotes.co-admin-uid": deleteField() }));
    await assertFails(updateDoc(doc(co, "config", "app"), { week: 3 }));
    await assertFails(getDocs(collection(co, "assignments")));
    await assertFails(updateDoc(cfg, { admins: [] }));
    await assertFails(updateDoc(cfg, { admins: arrayRemove(ADMIN) }));
  });

  test("초대 코드·연결 해제·명단 추가는 처음 운영자만, 명단의 연결 계정은 비우기만 된다(바꿔 끼워 사칭 방지)", async () => {
    await seed({ phase: 1, admins: [ADMIN, "co1"] });
    const co = as("co1");
    await assertFails(setDoc(doc(co, "invites", "NEWCO1"), { personId: "p005" })); // 공동 운영자가 초대 코드 만들기
    await assertFails(deleteDoc(doc(co, "invites", "INV005")));
    await assertFails(deleteDoc(doc(co, "users", "u1"))); // 공동 운영자가 연결 해제
    await assertFails(updateDoc(doc(co, "roster", "p001"), { uid: null }));
    await assertFails(updateDoc(doc(admin(), "roster", "p001"), { uid: "someone-else" })); // 처음 운영자도 다른 계정으로 바꿔 끼울 수 없다
    await assertSucceeds(updateDoc(doc(co, "roster", "p001"), { disqualified: true })); // 다른 표시는 공동 운영자도 된다
    await assertSucceeds(updateDoc(doc(admin(), "roster", "p001"), { uid: null })); // 처음 운영자의 연결 해제
    await assertSucceeds(deleteDoc(doc(admin(), "users", "u1")));
    await assertSucceeds(setDoc(doc(admin(), "invites", "NEW001"), { personId: "p001" }));
    await setPhase(0);
    await assertFails(setDoc(doc(co, "roster", "p009"), { name: "x", uid: null }));
    await assertFails(setDoc(doc(admin(), "roster", "p009"), { name: "x", uid: "u-fake" })); // 연결된 채로 명단 만들기
    await assertSucceeds(setDoc(doc(admin(), "roster", "p009"), { name: "x", uid: null }));
  });

  test("이미 연결된 참여자는 남의 초대 코드로 다른 이름을 하나 더 가져갈 수 없다", async () => {
    const db = asMail("u1", "u1@example.com"); // p001로 연결된 계정
    await assertFails(updateDoc(doc(db, "roster", "p005"), { uid: "u1", inviteUsed: "INV005" }));
  });

  test("운영자였던 계정이 권한이 빠지면 일반 계정처럼 초대 코드로 연결할 수 있다", async () => {
    await seed({ phase: 1, admins: [ADMIN, "ex-admin"] });
    const ex = asMail("ex-admin", "ex@example.com");
    await assertFails(setDoc(doc(ex, "users", "ex-admin"), { personId: "p005", eliminated: [], email: "ex@example.com", n: N }));
    await assertSucceeds(updateDoc(doc(admin(), "config", "app"), { admins: arrayRemove("ex-admin") }));
    await assertSucceeds(updateDoc(doc(ex, "roster", "p005"), { uid: "ex-admin", inviteUsed: "INV005" }));
    await assertSucceeds(setDoc(doc(ex, "users", "ex-admin"), { personId: "p005", eliminated: [], email: "ex@example.com", n: N }));
  });

  test("배정은 0단계에서만 쓸 수 있다", async () => {
    await assertSucceeds(setDoc(doc(admin(), "assignments", "p001"), { receiverPid: "p003" }));
    await setPhase(1);
    await assertFails(setDoc(doc(admin(), "assignments", "p001"), { receiverPid: "p002" }));
    await assertFails(setDoc(doc(admin(), "giverCodes", "p001"), { codes: CODES.p001 }));
    await assertFails(setDoc(doc(admin(), "codes", "NEW1"), { receiverPid: "p002", slot: 1 }));
  });

  test("게시된 규칙 버전 확인 (Admin.jsx): 화면이 기대하는 버전만 읽힌다", async () => {
    await assertSucceeds(getDoc(doc(admin(), "rulesVersion", RULES_VERSION)));
    await assertFails(getDoc(doc(admin(), "rulesVersion", "20261113"))); // 지난 버전
    await assertFails(getDoc(doc(admin(), "rulesVersion", "19990101")));
    await assertFails(setDoc(doc(admin(), "rulesVersion", RULES_VERSION), { x: 1 }));
    await assertFails(getDoc(doc(p("p001"), "rulesVersion", RULES_VERSION))); // 참여자·외부인은 못 읽는다(반복 읽기 대상이 되지 않게)
    await assertFails(getDoc(doc(as("stranger"), "rulesVersion", RULES_VERSION)));
  });
});

// ───────────────────────── 5. 미션 슬롯: 완료한 슬롯 잠금, 지금 열린 주차만 ─────────────────────────
describe("5. 미션 슬롯: 완료한 슬롯의 난이도는 못 바꾸고, 지금 열린 주차만 고르고 완료한다(지난 주차는 마감)", () => {
  const card = (level, id = level[0] + "1") => ({ cardId: id, level, text: `${level} 카드` });
  const praise = { cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" };
  const mine = () => doc(p("p001"), "giverMissions", "p001");
  const gm = (data) => setDoc(mine(), { ...data, n: N }, { merge: true });
  beforeEach(() => seed({ week: 1 }));

  test("완료 전에는 고르기·다시 고르기가 된다 (MyMission.jsx choose / 다른 카드 고르기)", async () => {
    await assertSucceeds(gm({ choices: { 1: card("easy") } }));
    await assertSucceeds(gm({ choices: { 1: null } }));
    await assertSucceeds(gm({ choices: { 1: card("hard") } }));
  });

  test("쓴 횟수(n)를 1 올리지 않거나, 카드 모양이 틀리거나, 다른 필드를 넣으면 거부", async () => {
    await assertFails(setDoc(mine(), { choices: { 1: card("easy") } }, { merge: true })); // n 없음
    await assertFails(setDoc(mine(), { choices: { 1: card("easy") }, n: 5 }, { merge: true })); // n을 마음대로
    await assertFails(gm({ choices: { 1: { cardId: "x", level: "legend", text: "?" } } })); // 없는 난이도
    await assertFails(gm({ choices: { 1: { ...card("easy"), text: "가".repeat(201) } } }));
    await assertFails(gm({ choices: { 1: { ...card("easy"), extra: 1 } } }));
    await assertFails(gm({ junk: "x" }));
    await assertSucceeds(gm({ choices: { 1: card("easy") } }));
    const snap = await getDoc(mine());
    if (snap.data().n !== 1) throw new Error("n이 1이 아님: " + snap.data().n);
  });

  test("완료 후에는 난이도 변경·카드 지우기·완료 취소가 거부된다", async () => {
    await put("giverMissions/p001", { choices: { 1: card("easy") }, done: { 1: true } });
    await assertFails(gm({ choices: { 1: card("hard") } }));
    await assertFails(gm({ choices: { 1: null } }));
    await assertFails(gm({ done: { 1: false } }));
    await assertFails(setDoc(mine(), { choices: {}, n: N })); // 덮어쓰기로 통째로 지우기
    await assertFails(updateDoc(mine(), { choices: deleteField(), n: N }));
    // 완료하지 않은 다른 슬롯은 그 주차가 열리면 바꿀 수 있다
    await setPhase(1, { week: 2 });
    await assertSucceeds(gm({ choices: { 2: card("normal") } }));
  });

  test("완료 표시는 그 주차 완료 알림과 한 묶음으로만 켤 수 있다", async () => {
    await assertSucceeds(gm({ choices: { 1: card("easy") } }));
    await assertFails(gm({ done: { 1: true } })); // 알림 없이 완료 표시만
    await assertSucceeds(sendMission(p("p001"), 1));
  });

  test("완료 표시를 안 했어도, 코드가 이미 인증된 슬롯은 난이도를 못 바꾼다", async () => {
    await put("giverMissions/p001", { choices: { 1: EASY } });
    await put("redemptions/A1A1", { receiverPid: "p002", slot: 1, review: review20, voided: false, feedId: feedIdOf("A1A1") });
    await assertFails(gm({ choices: { 1: card("hard") } }));
    await assertFails(gm({ choices: { 1: null } }));
    // 늦게라도 완료 알리기는 할 수 있다(카드는 그대로)
    await assertSucceeds(sendMission(p("p001"), 1));
  });

  test("카드를 안 고른 채 코드가 인증된 슬롯에 나중에 도전 카드를 넣을 수 없다", async () => {
    await setPhase(1, { week: 2 });
    await put("redemptions/A2A2", { receiverPid: "p002", slot: 2, review: review20, voided: false, feedId: feedIdOf("A2A2") });
    await assertFails(gm({ choices: { 2: card("hard") } })); // 문서가 없을 때(create)
    await put("giverMissions/p001", { choices: { 1: card("easy") } });
    await assertFails(gm({ choices: { 2: card("hard") } })); // 문서가 있을 때(update)
  });

  // 3주차(MyMission.jsx complete): 칭찬 한 줄은 모두 보내고, 원하면 보통·도전 카드를 같이 골라 카드 추가분을 받는다.
  // 칭찬 알림(kind praise)에는 고른 카드(난이도·글)가 같이 있어야 한다(받는 사람이 카드를 보고 확인). 칭찬만이면 카드 없음.
  const sendPraise = (db, { choice = praise, card: c, message = "올해 정말 고마웠어요!" } = {}) => {
    const b = writeBatch(db);
    b.set(doc(db, "deliveries", "p002_3"), { receiverPid: "p002", slot: 3, kind: "praise", message, code: null, createdAt: serverTimestamp(), ...(c ? { card: c } : {}) });
    b.set(doc(db, "giverMissions", "p001"), { done: { 3: true }, choices: { 3: choice }, n: N }, { merge: true });
    return b.commit();
  };
  const asDelivery = (c) => ({ level: c.level, text: c.text });

  test("3주차: 칭찬만, 또는 칭찬과 함께 보통·도전 카드(쉬움은 없음). 알림의 카드는 고른 카드와 같아야 한다", async () => {
    await setPhase(1, { week: 3 });
    await assertFails(gm({ choices: { 3: card("easy") } })); // 3주차 쉬움 = 칭찬만
    await assertSucceeds(gm({ choices: { 3: card("hard") } }));
    await assertSucceeds(gm({ choices: { 3: null } }));
    await assertSucceeds(gm({ choices: { 3: card("normal") } }));
    await assertFails(sendPraise(p("p001"), { choice: card("hard") })); // 도전 카드를 골랐는데 알림에 카드가 없음
    await assertFails(sendPraise(p("p001"), { choice: card("hard"), card: { level: "hard", text: "다른 글" } })); // 카드 글이 다름
    await assertFails(sendPraise(p("p001"), { choice: card("hard"), card: asDelivery(card("hard")), message: "짧아요" })); // 칭찬은 10자 이상
    await assertFails(sendPraise(p("p001"), { choice: praise, card: asDelivery(card("hard")) })); // 칭찬만인데 카드를 붙임
    await assertSucceeds(sendPraise(p("p001"), { choice: card("hard"), card: asDelivery(card("hard")) }));
    // 완료한 뒤에는 다른 카드로 못 바꾼다(칭찬만으로 내리는 것은 추가분이 없어 된다)
    await assertFails(gm({ choices: { 3: card("normal") } }));
    await assertFails(gm({ choices: { 3: null } }));
    await assertSucceeds(gm({ choices: { 3: praise } }));
  });

  test("3주차: 칭찬만 보내기(예전과 같음), 코드가 먼저 인증된 뒤에는 도전 카드를 새로 넣을 수 없다", async () => {
    await setPhase(1, { week: 3 });
    await assertSucceeds(sendMission(p("p001"), 3));
    await seed({ week: 3 });
    await put("redemptions/A3A3", { receiverPid: "p002", slot: 3, review: review20, voided: false, feedId: feedIdOf("A3A3") });
    await assertFails(gm({ choices: { 3: card("hard") } }));
    await assertSucceeds(sendPraise(p("p001"))); // 칭찬만은 된다
  });

  test("남의 giverMissions는 못 쓴다", async () => {
    await assertFails(setDoc(doc(p("p002"), "giverMissions", "p001"), { choices: { 1: card("hard") }, n: N }, { merge: true }));
  });

  test("아직 열리지 않은 주차는 카드 고르기도 완료 표시도 거부된다", async () => {
    await setPhase(1, { week: 1 });
    await assertSucceeds(gm({ choices: { 1: card("easy") } }));
    await assertFails(gm({ choices: { 2: card("easy") } })); // 2주차 카드 미리 고르기
    await assertFails(sendMission(p("p001"), 2));
    await assertFails(sendMission(p("p001"), 3)); // 칭찬 카드 미리 보내기
    await assertFails(setDoc(mine(), { choices: { 1: card("easy"), 2: card("hard") }, n: N })); // 열린 주차와 섞어서
    await assertSucceeds(sendMission(p("p001"), 1)); // 열린 주차는 된다
    await setPhase(1, { week: 2 });
    await assertSucceeds(gm({ choices: { 2: card("hard") } }));
    await assertSucceeds(sendMission(p("p001"), 2));
    await assertFails(sendMission(p("p001"), 3));
    // 운영자가 주차를 다시 내려도, 이미 해 둔 2주차는 그대로 둔 채 다른 값을 쓸 수 있다(쪽지 더 보내기)
    await setPhase(1, { week: 1 });
    await assertSucceeds(sendNote(p("p001"), 1, 1));
  });

  test("지난 주차는 마감: 다음 주차가 열리면 그 전 주차의 카드 고르기·완료 알리기가 거부된다(몰아서 하기 방지)", async () => {
    await assertSucceeds(gm({ choices: { 1: card("easy") } })); // 1주차에 카드만 골라 두고 완료를 안 알림
    await setPhase(1, { week: 2 });
    await assertFails(gm({ choices: { 1: card("hard") } })); // 지난 주차 카드 바꾸기
    await assertFails(gm({ choices: { 1: null } }));
    await assertFails(sendMission(p("p001"), 1)); // 지난 주차 완료 알리기
    await assertSucceeds(gm({ choices: { 2: card("normal") } })); // 지금 열린 주차는 된다
    await assertSucceeds(sendMission(p("p001"), 2));
    await setPhase(1, { week: 3 });
    await assertFails(sendMission(p("p001"), 1));
    await assertSucceeds(sendNote(p("p001"), 2, 1)); // 완료한 지난 주차의 쪽지 더 보내기는 된다(응모권과 무관)
    await assertSucceeds(sendMission(p("p001"), 3)); // 3주차(칭찬)는 된다
  });

  test("미션 진행 단계가 아니면 카드 고르기·완료 표시가 거부된다", async () => {
    for (const phase of [0, 2, 3]) {
      await setPhase(phase);
      await assertFails(gm({ choices: { 1: card("easy") } }), `${phase}단계`);
      await assertFails(sendMission(p("p001"), 1), `${phase}단계`);
    }
  });
});

// ───────────────────────── 앱 흐름: 화면이 보내는 요청이 거부되지 않는지 ─────────────────────────
describe("앱 흐름: 참여자 화면", () => {
  beforeEach(() => seed());

  test("가입 후 회사 메일 인증으로 연결 (account.js claimWithMail): 초대 코드 없이, 인증된 메일이 명단의 메일과 같을 때", async () => {
    const db = asVerified("u5", "p005@corp.example");
    const idx = await assertSucceeds(getDoc(doc(db, "mailIndex", "p005@corp.example"))); // 내 메일로 명단 번호 찾기
    const personId = idx.data().personId;
    if (personId !== "p005") throw new Error("색인이 가리키는 사람이 다름");
    await assertSucceeds(updateDoc(doc(db, "roster", personId), { uid: "u5", inviteUsed: "@mail" }));
    await assertSucceeds(setDoc(doc(db, "users", "u5"), { personId, eliminated: [], email: "p005@corp.example", n: N }, { merge: true }));
    await assertSucceeds(getDoc(doc(db, "config", "app"))); // 연결되면 참여자 화면을 읽을 수 있다
    // 같은 사람이 다시 눌러도: 명단 수정은 거부되지만 users는 통과(화면은 이 거부를 넘긴다)
    await assertFails(updateDoc(doc(db, "roster", personId), { uid: "u5", inviteUsed: "@mail" }));
    await assertSucceeds(setDoc(doc(db, "users", "u5"), { personId, eliminated: [], email: "p005@corp.example", n: N }, { merge: true }));
  });

  test("회사 메일 인증 연결이 막는 것: 인증 전 메일, 남의 메일, 다른 이름, 메일이 없는 이름, 남의 색인", async () => {
    // 인증하지 않은 메일(누구나 남의 주소로 계정은 만들 수 있다): 연결되지 않는다
    const unverified = asMail("u5", "p005@corp.example");
    await assertFails(updateDoc(doc(unverified, "roster", "p005"), { uid: "u5", inviteUsed: "@mail" }));
    await assertFails(setDoc(doc(unverified, "users", "u5"), { personId: "p005", eliminated: [], email: "p005@corp.example", n: N }));
    // 인증은 했지만 명단의 그 사람 메일이 아님
    const other = asVerified("u6", "someone@corp.example");
    await assertFails(updateDoc(doc(other, "roster", "p005"), { uid: "u6", inviteUsed: "@mail" }));
    await assertFails(getDoc(doc(other, "mailIndex", "p005@corp.example"))); // 남의 메일 색인은 못 읽는다
    await assertFails(getDocs(collection(other, "mailIndex")));
    await assertFails(setDoc(doc(other, "mailIndex", "someone@corp.example"), { personId: "p005" })); // 색인을 꾸며 넣기
    // 내 메일이 맞아도: 이미 연결된 이름, 다른 값까지 바꾸기, 표시를 다르게 쓰기
    const me = asVerified("u5", "p005@corp.example");
    await assertFails(updateDoc(doc(me, "roster", "p004"), { uid: "u5", inviteUsed: "@mail" }));
    await assertFails(updateDoc(doc(me, "roster", "p005"), { uid: "u5", inviteUsed: "@mail", part: "나파트" }));
    await assertFails(updateDoc(doc(me, "roster", "p005"), { uid: "u5", inviteUsed: "mail" }));
    await assertFails(updateDoc(doc(me, "roster", "p005"), { uid: "u9", inviteUsed: "@mail" })); // 남의 계정을 연결
    // 명단에 메일(아이디)이 없는 이름은 메일 인증으로 연결할 수 없다(초대 코드로만)
    await put("roster/p006", { name: "p006", part: "가파트", email: null, uid: null, disqualified: false });
    await assertFails(updateDoc(doc(asVerified("u7", "p006@corp.example"), "roster", "p006"), { uid: "u7", inviteUsed: "@mail" }));
    // 운영자 계정은 메일이 맞아도 참여자가 될 수 없다
    await put("roster/p006", { name: "p006", part: "가파트", email: "boss@corp.example", uid: null, disqualified: false });
    await assertFails(setDoc(doc(env.authenticatedContext(ADMIN, { email: "boss@corp.example", email_verified: true }).firestore(), "users", ADMIN),
      { personId: "p006", eliminated: [], email: "boss@corp.example", n: N }));
  });

  test("명단의 메일(아이디)과 메일 색인은 처음 운영자만 바꾼다 (Admin.jsx 명단)", async () => {
    await seed({ phase: 0, admins: [ADMIN, CO] });
    // 공동 운영자가 남의 이름에 자기 메일을 넣고 메일 인증으로 그 사람인 척 연결하는 것을 막는다
    await assertFails(updateDoc(doc(as(CO), "roster", "p005"), { email: "co@corp.example" }));
    await assertFails(setDoc(doc(as(CO), "mailIndex", "co@corp.example"), { personId: "p005" }));
    await assertFails(getDocs(collection(as(CO), "mailIndex")));
    await assertSucceeds(updateDoc(doc(as(CO), "roster", "p005"), { disqualified: true })); // 다른 운영 표시는 된다
    // 처음 운영자: 명단 추가(메일 + 색인 + 초대 코드), 아이디 고치기, 삭제
    const db = admin();
    const add = writeBatch(db);
    add.set(doc(db, "roster", "p006"), { name: "새사람", part: "가파트", email: "new@corp.example", uid: null, disqualified: false });
    add.set(doc(db, "invites", "INV006"), { personId: "p006" });
    add.set(doc(db, "mailIndex", "new@corp.example"), { personId: "p006" });
    await assertSucceeds(add.commit());
    const fix = writeBatch(db);
    fix.update(doc(db, "roster", "p006"), { email: "fixed@corp.example" });
    fix.delete(doc(db, "mailIndex", "new@corp.example"));
    fix.set(doc(db, "mailIndex", "fixed@corp.example"), { personId: "p006" });
    await assertSucceeds(fix.commit());
    const del = writeBatch(db);
    del.delete(doc(db, "roster", "p006"));
    del.delete(doc(db, "invites", "INV006"));
    del.delete(doc(db, "mailIndex", "fixed@corp.example"));
    await assertSucceeds(del.commit());
  });

  test("가입 후 초대 코드 연결 (account.js claimWithInvite): 명단을 읽지 않고 바로 연결, 로그인한 메일 저장", async () => {
    const db = asMail("u5", "u5@example.com");
    const invite = await assertSucceeds(getDoc(doc(db, "invites", "INV005")));
    const personId = invite.data().personId;
    const me = (email) => ({ personId, eliminated: [], email, n: N });
    await assertSucceeds(updateDoc(doc(db, "roster", personId), { uid: "u5", inviteUsed: "INV005" }));
    await assertFails(setDoc(doc(db, "users", "u5"), me("someone@example.com"), { merge: true })); // 남의 메일로 꾸미기
    await assertSucceeds(setDoc(doc(db, "users", "u5"), me("u5@example.com"), { merge: true }));
    // 같은 사람이 같은 초대 코드로 다시 연결: 명단 수정은 거부되지만 users는 통과
    await assertFails(updateDoc(doc(db, "roster", personId), { uid: "u5", inviteUsed: "INV005" }));
    await assertSucceeds(setDoc(doc(db, "users", "u5"), me("u5@example.com"), { merge: true }));
    // 다른 계정이 같은 초대 코드로: 둘 다 거부
    const other = asMail("u6", "u6@example.com");
    await assertFails(updateDoc(doc(other, "roster", personId), { uid: "u6", inviteUsed: "INV005" }));
    await assertFails(setDoc(doc(other, "users", "u6"), { personId, eliminated: [], email: "u6@example.com", n: N }));
  });

  test("예전 가입분(메일·n 없음)은 그대로 쓰이고, 로그인할 때 내 메일로만 채울 수 있다 (App.jsx)", async () => {
    const db = asMail("u1", "u1@example.com");
    await assertSucceeds(updateDoc(doc(db, "users", "u1"), { eliminated: arrayUnion("p003"), n: N })); // 메일·n 없는 문서
    await assertFails(updateDoc(doc(db, "users", "u1"), { email: "other@example.com", n: N }));
    await assertSucceeds(updateDoc(doc(db, "users", "u1"), { email: "u1@example.com", n: N }));
    await assertSucceeds(updateDoc(doc(db, "users", "u1"), { eliminated: arrayUnion("p004"), n: N }));
    await assertFails(updateDoc(doc(db, "users", "u1"), { junk: "x".repeat(1000), n: N })); // 다른 필드
    await assertFails(updateDoc(doc(db, "users", "u1"), { eliminated: arrayUnion("p002") })); // n을 안 올림
  });

  test("초대 코드 연결: 남의 초대 코드로 다른 이름 연결·이미 연결된 이름 가로채기·남의 users 만들기는 거부", async () => {
    const db = as("u5");
    await assertFails(updateDoc(doc(db, "roster", "p004"), { uid: "u5", inviteUsed: "INV005" })); // 초대 코드와 다른 이름
    await assertFails(updateDoc(doc(db, "roster", "p001"), { uid: "u5", inviteUsed: "INV005" })); // 이미 가입한 이름
    await assertFails(updateDoc(doc(db, "roster", "p005"), { uid: "u5", inviteUsed: "INV005", part: "나파트" })); // 다른 필드까지
    await assertFails(setDoc(doc(db, "users", "u5"), { personId: "p001", eliminated: [], n: N })); // 남의 이름으로 users
    await assertFails(getDocs(collection(db, "invites"))); // 초대 코드 목록
    await assertFails(updateDoc(doc(p("p001"), "users", "u1"), { personId: "p002", n: N })); // 연결 후 이름 바꾸기
  });

  test("캐릭터·프로필·단서 준비 (Profile.jsx save, sync.js syncClues)", async () => {
    const db = p("p001");
    await assertSucceeds(setDoc(doc(db, "avatars", "p001"), { avatar: 3, n: N }, { merge: true }));
    await assertFails(setDoc(doc(db, "avatars", "p001"), { avatar: 8, n: N }, { merge: true }));
    await assertFails(setDoc(doc(db, "avatars", "p002"), { avatar: 1, n: N }, { merge: true }));
    await assertSucceeds(getDoc(doc(db, "profiles", "p001")));
    const answers = PROFILE_QUESTIONS.map((_, i) => A(i));
    await assertSucceeds(setDoc(doc(db, "profiles", "p001"), { answers, updatedAt: serverTimestamp(), n: N }, { merge: true }));
    await assertFails(setDoc(doc(db, "profiles", "p001"), { answers: ["x".repeat(500000)], n: N }, { merge: true })); // 큰 값·개수 틀림
    await assertFails(setDoc(doc(db, "profiles", "p001"), { answers, junk: 1, n: N }, { merge: true }));
    await assertSucceeds(setDoc(doc(db, "progress", "p001"), { profileDone: true, n: N }, { merge: true }));
    const receiverPid = (await assertSucceeds(getDoc(doc(db, "assignments", "p001")))).data().receiverPid;
    // 한 칸씩 쓴다(공개된 칸이 같은 답이면 통과)
    for (let i = 0; i < 6; i++) {
      await assertSucceeds(setDoc(doc(db, "clues", `${receiverPid}_${i}`), { receiverPid, idx: i, answer: A(i), ver: 0, n: N }, { merge: true }));
    }
    await assertSucceeds(setDoc(doc(db, "progress", "p001"), { cluesVer: 0, n: N }, { merge: true }));
  });

  test("단서는 내 대상 앞으로만, 문서 ID 규칙대로만, 형식에 맞는 답만 쓸 수 있다", async () => {
    const db = p("p001");
    const w = (id, data) => setDoc(doc(db, "clues", id), { n: N, ...data }, { merge: true });
    await assertFails(w("p003_0", { receiverPid: "p003", idx: 0, answer: A(0), ver: 0 }));
    await assertFails(w("p002_9", { receiverPid: "p002", idx: 0, answer: A(0), ver: 0 }));
    await assertFails(w("p002_6", { receiverPid: "p002", idx: 6, answer: "가파트", ver: 0 }));
    await assertFails(setDoc(doc(db, "clues", "p002_2"), { receiverPid: "p002", idx: 2, answer: A(2, 1), n: N })); // 회차 없음(덮어쓰기)
    await assertFails(w("p002_2", { receiverPid: "p002", idx: 2, answer: A(2, 1), ver: 1 })); // 다른 회차
    // 고르기 문항은 보기 중 하나만(거짓·장난 답 방지), 직접 쓰기 문항은 2자 이상
    await assertFails(w("p002_2", { receiverPid: "p002", idx: 2, answer: "저는 다파트입니다 ㅋㅋ", ver: 0 }));
    await assertFails(w("p002_4", { receiverPid: "p002", idx: 4, answer: " 가 ", ver: 0 })); // TMI(직접 쓰기)도 2자 이상
    await assertFails(w("p002_3", { receiverPid: "p002", idx: 3, answer: " 가 ", ver: 0 }));
    await assertFails(w("p002_2", { receiverPid: "p002", idx: 2, answer: "(답변 없음)", ver: 0 })); // 예전 화면이 빈 답 대신 쓰던 글
    await assertFails(setDoc(doc(db, "clues", "p002_2"), { receiverPid: "p002", idx: 2, answer: A(2, 1), ver: 0 }, { merge: true })); // n 없음
    await assertFails(w("p002_2", { receiverPid: "p002", idx: 2, answer: A(2, 1), ver: 0, extra: "x" }));
    await assertSucceeds(w("p002_2", { receiverPid: "p002", idx: 2, answer: A(2, 1), ver: 0 }));
    await assertSucceeds(w("p002_3", { receiverPid: "p002", idx: 3, answer: "머그컵", ver: 0 }));
    await assertSucceeds(w("p002_4", { receiverPid: "p002", idx: 4, answer: "헬리콥터 조종 자격증", ver: 0 }));
  });

  test("이미 공개된 단서는 답을 바꿀 수 없다 (같은 답 다시 쓰기·안 공개된 칸·비어 있던 칸은 됨)", async () => {
    // 시드: cluesReleased = 2, p001(마니또)이 p002(대상)에게 쓴 단서 A(0)~A(5)
    const db = p("p001");
    const clue = (idx, answer) => ({ receiverPid: "p002", idx, answer, ver: 0, n: N });
    const w = (idx, answer) => setDoc(doc(db, "clues", `p002_${idx}`), clue(idx, answer), { merge: true });
    await assertFails(w(0, A(0, 1))); // 공개된 칸 바꾸기
    await assertFails(w(1, A(1, 1)));
    await assertSucceeds(w(0, A(0))); // 같은 답으로 다시 쓰기
    await assertSucceeds(w(2, A(2, 1))); // 아직 안 공개된 칸
    // 늦게 쓰는 경우: 공개된 칸이 비어 있었으면 새로 쓸 수 있다
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "clues", "p002_1")));
    await assertSucceeds(w(1, A(1, 2)));
    const snap = await assertSucceeds(getDoc(doc(p("p002"), "clues", "p002_1")));
    if (snap.data().answer !== A(1, 2)) throw new Error("늦게 쓴 답이 안 보임");
    // 다음 주 공개(2 → 4) 뒤에는 2·3번 칸도 잠긴다
    await setPhase(1, { cluesReleased: 4, week: 2 });
    await assertFails(w(2, A(2, 2)));
    await assertSucceeds(w(4, A(4, 1)));
  });

  test("파트 단서(6번): 최종 지목 단계부터 받는 사람만 읽고, 참여자는 쓸 수 없다", async () => {
    const hint = { receiverPid: "p002", idx: 6, answer: "나파트", ver: 0, n: N };
    await assertFails(getDoc(doc(p("p002"), "clues", "p002_6"))); // 1단계: 아직 잠김
    await setPhase(1, { cluesReleased: 6, week: 3 });
    await assertFails(getDoc(doc(p("p002"), "clues", "p002_6"))); // 단서 6개가 다 공개돼도 파트 단서는 지목 단계부터
    await assertFails(setDoc(doc(p("p001"), "clues", "p002_6"), hint)); // 마니또 본인도 못 씀(거짓 파트 방지)
    await assertFails(setDoc(doc(p("p002"), "clues", "p002_6"), hint));
    await assertFails(setDoc(doc(admin(), "clues", "p002_6"), hint)); // 운영자도 시작 후에는 못 바꿈
    await setPhase(2);
    const snap = await assertSucceeds(getDoc(doc(p("p002"), "clues", "p002_6")));
    if (snap.data().answer !== "가파트") throw new Error("파트 단서가 다름");
    await assertFails(getDoc(doc(p("p003"), "clues", "p002_6"))); // 남의 파트 단서
    await assertFails(getDoc(doc(p("p001"), "clues", "p002_6")));
    // 다시 배정한 뒤의 지난 회차 파트 단서는 안 보인다
    await setPhase(2, { assignVer: 1 });
    await assertFails(getDoc(doc(p("p002"), "clues", "p002_6")));
  });

  test("단서 답은 60자까지", async () => {
    const db = p("p001");
    const w = (answer) => setDoc(doc(db, "clues", "p002_3"), { receiverPid: "p002", idx: 3, answer, ver: 0, n: N }, { merge: true });
    await assertFails(w(""));
    await assertFails(w("가".repeat(61)));
    await assertFails(w(123));
    await assertSucceeds(w("가".repeat(60)));
  });

  test("다시 배정하면(회차 +1) 지난 회차 단서는 안 보이고, 새 마니또가 지금 회차로 다시 쓰면 보인다", async () => {
    // p002의 단서(회차 0)는 p001이 썼다. 운영자가 다시 배정해서 p002의 마니또가 p003이 됐다고 하자.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await updateDoc(doc(db, "config", "app"), { assignVer: 1 });
      await setDoc(doc(db, "assignments", "p003"), { receiverPid: "p002" });
      await setDoc(doc(db, "assignments", "p001"), { receiverPid: "p004" });
    });
    const clue = (ver) => ({ receiverPid: "p002", idx: 0, answer: A(0, 3), ver, n: N });
    await assertFails(getDoc(doc(p("p002"), "clues", "p002_0"))); // 예전 마니또(p001)의 답 → 안 보임
    await assertFails(setDoc(doc(p("p001"), "clues", "p002_0"), clue(1), { merge: true })); // 예전 마니또는 더 못 씀
    await assertFails(setDoc(doc(p("p003"), "clues", "p002_0"), clue(0), { merge: true })); // 지난 회차로는 못 씀
    await assertSucceeds(setDoc(doc(p("p003"), "clues", "p002_0"), clue(1), { merge: true }));
    const snap = await assertSucceeds(getDoc(doc(p("p002"), "clues", "p002_0")));
    if (snap.data().answer !== A(0, 3)) throw new Error("새 마니또의 답이 아님");
    await assertFails(getDoc(doc(p("p002"), "clues", "p002_1"))); // 아직 안 다시 쓴 칸은 안 보임
  });

  test("배정 전 프로필 저장: syncClues가 내 배정 문서를 읽어도 거부되지 않는다", async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "assignments", "p001")));
    const snap = await assertSucceeds(getDoc(doc(p("p001"), "assignments", "p001")));
    if (snap.exists()) throw new Error("배정 문서가 남아 있음");
  });

  test("최근 접속 남기기 (App.jsx): 서버 시각으로만, 내 것만 / 받은 미션·내 인증 조회 (MyMission.jsx)", async () => {
    const db = p("p002");
    await assertSucceeds(setDoc(doc(db, "progress", "p002"), { lastSeen: serverTimestamp(), n: N }, { merge: true }));
    await assertFails(setDoc(doc(db, "progress", "p001"), { lastSeen: serverTimestamp(), n: N }, { merge: true })); // 남의 것
    await assertFails(setDoc(doc(db, "progress", "p002"), { lastSeen: new Date(2020, 0, 1), n: N }, { merge: true })); // 시각 꾸미기
    await assertFails(setDoc(doc(db, "progress", "p002"), { lastSeen: serverTimestamp() }, { merge: true })); // n 안 올림
    await assertFails(setDoc(doc(db, "progress", "p002"), { junk: "x", n: N }, { merge: true }));
    await assertFails(setDoc(doc(db, "progress", "p002"), { doneCount: -5, n: N }, { merge: true })); // 음수
    await assertFails(setDoc(doc(db, "progress", "p002"), { doneCount: "1", n: N }, { merge: true }));
    await assertSucceeds(getDocs(query(collection(db, "deliveries"), where("receiverPid", "==", "p002"))));
    await assertSucceeds(getDocs(query(collection(db, "redemptions"), where("receiverPid", "==", "p002"))));
  });

  test("내 미션 화면 읽기 (MyMission.jsx): 내 코드의 인증(없어도), 그 인증의 피드 글(감사 답장), 신고·확인 결과", async () => {
    const db = p("p001");
    await assertSucceeds(getDoc(doc(db, "giverMissions", "p001")));
    await assertSucceeds(getDoc(doc(db, "progress", "p001")));
    await assertSucceeds(getDoc(doc(db, "nudges", "p002"))); // 내 대상에게 온 운영자 알림
    await assertFails(getDoc(doc(p("p003"), "nudges", "p002"))); // 남의 대상(누가 받은 게 없는지)
    await assertFails(getDocs(collection(db, "nudges")));
    const none = await assertSucceeds(getDoc(doc(db, "redemptions", "A1A1"))); // 아직 인증 전(문서 없음)
    if (none.exists()) throw new Error("인증 문서가 있음");
    await assertSucceeds(getDoc(doc(db, "reports", "p002_1"))); // 내 대상이 "받은 게 없어요"로 신고했는지(없어도 읽힘)
    await assertSucceeds(getDoc(doc(db, "verdicts", "p002_1")));
    // p002(마니또): 대상 p003이 인증한 B1B1 → 피드 글에서 감사 답장을 읽는다
    const mine = await assertSucceeds(getDoc(doc(p("p002"), "redemptions", "B1B1")));
    await assertSucceeds(getDoc(doc(p("p002"), "feed", mine.data().feedId)));
  });

  test("미션 완료 알리기 (MyMission.jsx complete): 주차마다 한 번, 완료 표시·고른 카드와 한 묶음으로만", async () => {
    const db = p("p001");
    const NORMAL = { cardId: "n1", level: "normal", text: "간식" };
    await assertSucceeds(setDoc(doc(db, "giverMissions", "p001"), { choices: { 1: NORMAL }, n: N }, { merge: true }));
    await assertFails(sendMission(db, 1, { choice: NORMAL, delivery: { card: { level: "hard", text: "간식" } } })); // 고른 카드와 다른 카드로 알리기
    await assertFails(sendMission(db, 1, { choice: NORMAL, delivery: { card: null } }));
    await assertFails(sendMission(db, 1, { choice: NORMAL, delivery: { code: "A1A1A1" } })); // 코드는 4자
    await assertFails(sendMission(db, 1, { choice: NORMAL, delivery: { createdAt: new Date(2020, 0, 1) } }));
    // 완료 표시 없이 알림만 보내기(받는 사람의 보상을 막고 운영자 화면에는 안 보이게 하는 방법) → 거부
    await assertFails(sendMission(db, 1, { gm: "skip" }));
    await assertFails(addDoc(collection(db, "deliveries"), { receiverPid: "p002", slot: 1, kind: "mission", message: "", code: null, createdAt: serverTimestamp() }));
    await assertFails(sendMission(db, 1, { id: "아무ID아무ID" })); // 정해진 ID가 아님
    await assertSucceeds(sendMission(db, 1, { choice: NORMAL, delivery: { code: "A1A1", message: "책상 확인" } }));
    await assertFails(sendMission(db, 1)); // 같은 주차 두 번
    await assertSucceeds(setDoc(doc(db, "progress", "p001"), { doneCount: 1, n: N }, { merge: true }));
    await assertFails(setDoc(doc(db, "progress", "p001"), { doneCount: 2, n: N }, { merge: true })); // 열린 주차(1)보다 많이
    await assertFails(setDoc(doc(db, "progress", "p001"), { doneCount: 4, n: N }, { merge: true }));
    const inbox = await assertSucceeds(getDocs(query(collection(p("p002"), "deliveries"), where("receiverPid", "==", "p002"))));
    if (!inbox.docs.some((d) => d.id === "p002_1")) throw new Error("완료 알림이 안 보임");
  });

  test("쪽지 더 보내기 (MyMission.jsx MoreNotes): 완료한 주차에만, 쪽지 수와 순번을 맞춰서, 주차마다 5건까지", async () => {
    const db = p("p001");
    await assertFails(sendNote(db, 1, 1)); // 완료를 알리기 전
    await assertSucceeds(sendMission(db, 1));
    await assertFails(sendNote(db, 1, 1, { bump: false })); // 쪽지 수를 안 올림(개수 제한 우회)
    await assertFails(sendNote(db, 1, 1, { message: "" })); // 빈 쪽지
    await assertFails(sendNote(db, 1, 1, { id: "아무ID아무ID" })); // 순번 ID가 아님
    await assertFails(sendNote(db, 1, 3)); // 순번 건너뛰기
    await assertFails(sendNote(db, 2, 1)); // 완료하지 않은(열리지 않은) 주차
    await assertFails(setDoc(doc(db, "giverMissions", "p001"), { notes: { 1: 3 }, n: N }, { merge: true })); // 쪽지 없이 숫자만(가짜 "+쪽지 3")
    for (let i = 1; i <= 5; i++) await assertSucceeds(sendNote(db, 1, i, { message: `${i + 1}번째 날 응원` }));
    await assertFails(sendNote(db, 1, 6)); // 6건째
    const gm = await getDoc(doc(db, "giverMissions", "p001"));
    if (gm.data().notes["1"] !== 5) throw new Error("쪽지 수가 5가 아님");
    // 받는 사람은 추가 쪽지도 받는다
    const inbox = await assertSucceeds(getDocs(query(collection(p("p002"), "deliveries"), where("receiverPid", "==", "p002"))));
    if (inbox.docs.filter((d) => d.data().kind === "note").length !== 5) throw new Error("추가 쪽지 수가 다름");
  });

  test("칭찬 카드 보내기 (MyMission.jsx complete, 3주차)", async () => {
    await setPhase(1, { week: 3 });
    const db = p("p001");
    await assertFails(sendMission(db, 3, { message: "" })); // 빈 칭찬 카드(10자 미만)
    await assertFails(sendMission(db, 3, { message: "고마워요" }));
    await assertSucceeds(sendMission(db, 3, { message: "올해 정말 고마웠어요", delivery: { code: "A3A3" } }));
    await assertSucceeds(setDoc(doc(db, "progress", "p001"), { doneCount: 1, n: N }, { merge: true }));
  });

  test("칭찬 카드: 받는 사람이 먼저 인증한 뒤에 완료 표시가 들어가도 거부되지 않는다", async () => {
    await setPhase(1, { week: 3 });
    await put("redemptions/A3A3", { receiverPid: "p002", slot: 3, review: review20, voided: false, feedId: feedIdOf("A3A3") });
    await assertSucceeds(sendMission(p("p001"), 3, { message: "올해 정말 고마웠어요" }));
  });

  test("완료 알림은 내 대상에게만, 미션 진행 단계에만, 지금 열린 주차만, 종류에 맞는 주차로만", async () => {
    const db = p("p001");
    await assertFails(sendMission(db, 1, { receiverPid: "p003" }));
    await assertFails(sendMission(db, 1, { message: "가".repeat(501) }));
    await assertFails(sendMission(db, 2)); // 1주차인데 2주차 완료 알림
    await assertFails(sendMission(db, 3, { message: "미리 보내는 칭찬 카드" }));
    await assertFails(sendMission(db, 1, { kind: "praise", message: "1주차에 보내는 칭찬 카드예요" })); // 1주차에 칭찬 카드
    await assertFails(sendMission(db, 1, { kind: "공지" }));
    await assertFails(sendMission(db, 1, { delivery: { slot: "1" } }));
    await assertFails(sendMission(db, 1, { delivery: { extra: "x" } }));
    await setPhase(1, { week: 2 });
    await assertSucceeds(sendMission(db, 2)); // 지금 열린 주차
    await setPhase(1, { week: 3 });
    await assertFails(sendMission(db, 3, { kind: "mission", choice: EASY, gm: { done: { 3: true }, n: N } })); // 3주차 알림은 칭찬(kind praise)으로만
    await assertFails(sendMission(db, 1)); // 지난 주차(1주차)는 마감
    await setPhase(2, { week: 3 });
    await assertFails(sendMission(db, 1));
  });

  test("쪽지 신고 (Detective.jsx Inbox): 나에게 온 쪽지만, 한 번만", async () => {
    await assertSucceeds(setDoc(doc(p("p002"), "noteFlags", "dv1"), { at: serverTimestamp() }));
    await assertSucceeds(getDoc(doc(p("p002"), "noteFlags", "dv1")));
    await assertFails(setDoc(doc(p("p002"), "noteFlags", "dv1"), { at: serverTimestamp() })); // 두 번
    await assertFails(setDoc(doc(p("p003"), "noteFlags", "dv1"), { at: serverTimestamp() })); // 남에게 온 쪽지
    await assertFails(getDoc(doc(p("p001"), "noteFlags", "dv1"))); // 보낸 마니또는 신고됐는지 못 본다
    await assertFails(deleteDoc(doc(p("p002"), "noteFlags", "dv1")));
  });

  test("추리 보드: 코드 확인 → 인증 + 피드 글 → 감사 답장, 후보 지우기 (Detective.jsx)", async () => {
    const db = p("p002");
    await assertSucceeds(getDocs(query(collection(db, "redemptions"), where("receiverPid", "==", "p002"))));
    await assertSucceeds(getDoc(doc(db, "codes", "A1A1")));
    const existing = await assertSucceeds(getDoc(doc(db, "redemptions", "A1A1"))); // 이미 인증했는지 확인(아직 없는 문서)
    if (existing.exists()) throw new Error("이미 인증돼 있음");
    const feedId = doc(collection(db, "feed")).id; // 화면은 무작위 문서 ID를 쓴다(20자)
    const b = writeBatch(db);
    b.set(doc(db, "redemptions", "A1A1"), { receiverPid: "p002", slot: 1, review: review20, voided: false, feedId, createdAt: serverTimestamp() });
    b.set(doc(db, "feed", feedId), { slot: 1, review: review20, voided: false, createdAt: serverTimestamp() });
    await assertSucceeds(b.commit());
    await assertSucceeds(getDoc(doc(db, "feed", feedId)));
    await assertSucceeds(updateDoc(doc(db, "feed", feedId), { thanks: "덕분에 힘이 났어요" }));
    await assertSucceeds(getDoc(doc(db, "guesses", "p002")));
    await assertSucceeds(updateDoc(doc(db, "users", "u2"), { eliminated: arrayUnion("p003"), n: N }));
    await assertSucceeds(updateDoc(doc(db, "users", "u2"), { eliminated: arrayRemove("p003"), n: N }));
  });

  test("추리 보드: 카드를 보고 인증(cardMatch 같이), 알림보다 먼저 인증했으면 나중에 카드 확인 (Detective.jsx CodeEntry·CardCheck)", async () => {
    const db = p("p002");
    const notice = (slot) => ({ receiverPid: "p002", slot, kind: "mission", message: "", code: null, card: { level: "normal", text: "보통 카드" } });
    // 완료 알림보다 먼저 인증: 카드를 못 봤으므로 cardMatch 없이 쓴다 → 알림이 온 뒤 CardCheck가 한 번 남긴다
    await assertSucceeds(redeem(db, "A1A1", "p002", 1));
    await put("deliveries/p002_1", notice(1));
    await assertSucceeds(updateDoc(doc(db, "redemptions", "A1A1"), { cardMatch: true }));
    // 완료 알림이 온 뒤 인증: 카드가 보이므로 cardMatch를 같이 쓴다
    await setPhase(1, { week: 2 });
    await put("deliveries/p002_2", notice(2));
    await assertSucceeds(redeem(db, "A2A2", "p002", 2, { r: { cardMatch: false } }));
  });

  test("받은 게 없어요 신고 (Detective.jsx ReportBox): 내 것만, 열린 주차만, 취소는 active=false, 지울 수 없음", async () => {
    const db = p("p002");
    const report = (slot) => ({ receiverPid: "p002", slot, active: true, createdAt: serverTimestamp(), n: N });
    await assertSucceeds(getDoc(doc(db, "reports", "p002_1"))); // 없는 문서도 읽힌다
    await assertSucceeds(getDoc(doc(db, "verdicts", "p002_1")));
    await assertFails(setDoc(doc(db, "reports", "p002_2"), report(2))); // 아직 안 열린 주차
    await assertFails(setDoc(doc(db, "reports", "p003_1"), { ...report(1), receiverPid: "p003" })); // 남의 이름으로
    await assertFails(setDoc(doc(db, "reports", "p003_1"), report(1)));
    await assertFails(setDoc(doc(db, "reports", "p002_1"), { ...report(1), verdict: "missing" })); // 확인 결과를 스스로 적기
    await assertFails(setDoc(doc(db, "reports", "p002_1"), { ...report(1), createdAt: new Date(2020, 0, 1) })); // 시각 꾸미기
    await assertSucceeds(setDoc(doc(db, "reports", "p002_1"), report(1)));
    await assertFails(setDoc(doc(db, "verdicts", "p002_1"), { receiverPid: "p002", slot: 1, verdict: "missing" })); // 참여자는 확인 결과를 못 쓴다
    await assertFails(setDoc(doc(p("p001"), "verdicts", "p002_1"), { receiverPid: "p002", slot: 1, verdict: "received" })); // 마니또도
    await assertFails(updateDoc(doc(p("p001"), "reports", "p002_1"), { active: false, n: N })); // 마니또가 신고를 취소할 수 없다
    await assertFails(deleteDoc(doc(db, "reports", "p002_1"))); // 지우기는 안 된다(쓴 횟수가 남게)
    await assertFails(updateDoc(doc(db, "reports", "p002_1"), { active: false })); // n 안 올림
    await assertSucceeds(updateDoc(doc(db, "reports", "p002_1"), { active: false, n: N })); // 신고 취소
    await assertSucceeds(updateDoc(doc(db, "reports", "p002_1"), { active: true, createdAt: serverTimestamp(), n: N })); // 다시 신고
    // 미션 마감 뒤(최종 지목·투표 단계)에도 신고할 수 있고, 집계 단계부터는 못 한다
    await setPhase(3, { week: 3 });
    await assertSucceeds(setDoc(doc(db, "reports", "p002_3"), report(3)));
    await setPhase(4, { week: 3 });
    await assertFails(setDoc(doc(db, "reports", "p002_2"), report(2)));
    await assertFails(updateDoc(doc(db, "reports", "p002_3"), { active: false, n: N }));
    await setPhase(0);
    await assertFails(setDoc(doc(db, "reports", "p002_1"), report(1)));
  });

  test("미공개 단서를 읽으면 거부되고, 화면은 '아직 안 채움'으로 처리한다 (Detective.jsx Clues)", async () => {
    await assertFails(getDoc(doc(p("p003"), "clues", "p003_0"))); // 문서가 없을 때도 거부(화면은 catch로 처리)
  });

  test("피드와 파트 순위, 명단 요약·캐릭터 (Feed.jsx, PartBoard.jsx, App.jsx, ui.jsx Avatar)", async () => {
    const db = p("p001");
    await assertSucceeds(getDocs(query(collection(db, "feed"), orderBy("createdAt", "desc"), limit(30))));
    await assertSucceeds(getDoc(doc(db, "public", "roster")));
    await assertSucceeds(getDoc(doc(db, "avatars", "p003")));
    await assertSucceeds(getDoc(doc(db, "config", "app")));
    await assertSucceeds(getDoc(doc(db, "users", "u1")));
    await assertSucceeds(getDoc(doc(db, "public", "board"))); // 주 1회 발표되는 파트 순위
    await assertFails(setDoc(doc(db, "public", "board"), { week: 3, parts: [] })); // 참여자는 순위를 고칠 수 없다
    // 진행 상황은 본인 것만: 남의 것을 실시간으로 보면 미션을 받은 순간 누구 숫자가 올랐는지로 마니또가 드러난다
    await assertSucceeds(getDoc(doc(db, "progress", "p001")));
    await assertFails(getDoc(doc(db, "progress", "p003"))); // 같은 파트 사람
    await assertFails(getDoc(doc(db, "progress", "p004"))); // 내 마니또
    await assertFails(getDocs(collection(db, "progress")));
  });

  test("최종 지목 (Detective.jsx submitGuess): 2단계에만, 명단에 있는 다른 사람만", async () => {
    const db = p("p002");
    const g = (guessPid) => setDoc(doc(db, "guesses", "p002"), { guessPid, createdAt: serverTimestamp(), n: N }, { merge: true });
    await assertFails(g("p001"));
    await setPhase(2);
    await assertSucceeds(g("p001"));
    await assertSucceeds(setDoc(doc(db, "progress", "p002"), { guessed: true, n: N }, { merge: true }));
    await assertSucceeds(g("p004"));
    await assertFails(g("p002")); // 자기 자신
    await assertFails(g("nobody")); // 명단에 없는 사람
    await assertFails(setDoc(doc(db, "guesses", "p002"), { guessPid: "p001", createdAt: new Date(2020, 0, 1), n: N }, { merge: true }));
    await assertFails(setDoc(doc(db, "guesses", "p001"), { guessPid: "p004", createdAt: serverTimestamp(), n: N }, { merge: true }));
  });

  test("결과는 5단계부터 참여자에게 보인다 (Reveal.jsx)", async () => {
    await put("results/public", { pairs: [], draws: {} });
    await setPhase(4);
    await assertFails(getDoc(doc(p("p001"), "results", "public")));
    await setPhase(5);
    await assertSucceeds(getDoc(doc(p("p001"), "results", "public")));
    await assertFails(updateDoc(doc(p("p001"), "results", "public"), { "draws.t4": { seed: "1", winners: ["p001"] } }));
  });
});

describe("앱 흐름: 운영 화면", () => {
  test("준비 단계: 명단·초대 코드·근무지·파트·배정·명단 요약 (Admin.jsx Setup)", async () => {
    await seed({ phase: 0 });
    const db = admin();
    await assertSucceeds(getDocs(collection(db, "roster")));
    await assertSucceeds(setDoc(doc(db, "public", "roster"), { people: { p001: { name: "가", loc: "SR3", part: "가파트" } }, at: serverTimestamp() }));
    await assertSucceeds(getDocs(collection(db, "invites")));
    const add = writeBatch(db);
    add.set(doc(db, "roster", "p006"), { name: "새사람", loc: "S1L", part: "가파트", uid: null, disqualified: false });
    add.set(doc(db, "invites", "INV006"), { personId: "p006" });
    await assertSucceeds(add.commit());
    await assertSucceeds(updateDoc(doc(db, "roster", "p006"), { loc: "SR3" }));
    await assertSucceeds(updateDoc(doc(db, "roster", "p006"), { part: "나파트" }));
    await assertSucceeds(deleteDoc(doc(db, "roster", "p006")));
    await assertSucceeds(deleteDoc(doc(db, "invites", "INV006")));

    // 재배정: 이전 코드·배정 지우고 새로 쓰기(받는 사람 기준 코드 포함), 메모, 근무지 모드 값
    const meta = await assertSucceeds(getDoc(doc(db, "meta", "assignment")));
    const b = writeBatch(db);
    meta.data().codes.forEach((c) => b.delete(doc(db, "codes", c)));
    meta.data().pids.forEach((pid) => { b.delete(doc(db, "assignments", pid)); b.delete(doc(db, "giverCodes", pid)); b.delete(doc(db, "receiverCodes", pid)); });
    b.set(doc(db, "assignments", "p001"), { receiverPid: "p003" });
    b.set(doc(db, "giverCodes", "p001"), { codes: { 1: "N1N1", 2: "N2N2", 3: "N3N3" } });
    b.set(doc(db, "receiverCodes", "p003"), { codes: { 1: "N1N1", 2: "N2N2", 3: "N3N3" } });
    b.set(doc(db, "codes", "N1N1"), { receiverPid: "p003", slot: 1 });
    b.set(doc(db, "clues", "p003_6"), { receiverPid: "p003", idx: 6, answer: "가파트", ver: 1 }); // 파트 단서
    b.set(doc(db, "meta", "assignment"), { codes: ["N1N1"], pids: ["p001"], at: serverTimestamp() });
    await assertSucceeds(b.commit());
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { siteMatched: false, partExcluded: true, assignVer: 1 }));
    await assertSucceeds(updateDoc(doc(db, "roster", "p001"), { part: "나파트" })); // 파트 고치기
    // 배정 결과를 바로 읽는다(짝 현황 표)
    await assertSucceeds(getDocs(collection(db, "assignments")));
    // 운영자는 파트 단서(6번) 말고는 단서를 쓸 수 없고, 형식이 틀리면 거부
    await assertFails(setDoc(doc(db, "clues", "p003_0"), { receiverPid: "p003", idx: 0, answer: "x", ver: 1 }));
    await assertFails(setDoc(doc(db, "clues", "p003_6"), { receiverPid: "p004", idx: 6, answer: "가파트", ver: 1 }));
    await assertFails(setDoc(doc(db, "clues", "p003_6"), { receiverPid: "p003", idx: 6, answer: "", ver: 1 }));
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { phase: 1 }));
  });

  test("준비 단계 외에는 명단을 추가·삭제할 수 없다 (수정은 가능: 수상 제외 표시)", async () => {
    await seed({ phase: 1 });
    const db = admin();
    await assertFails(setDoc(doc(db, "roster", "p006"), { name: "x", loc: "SR3", part: "가파트", uid: null, disqualified: false }));
    await assertFails(deleteDoc(doc(db, "roster", "p005")));
    await assertSucceeds(updateDoc(doc(db, "roster", "p001"), { disqualified: true }));
    await assertSucceeds(setDoc(doc(db, "public", "roster"), { people: {}, at: serverTimestamp() })); // 시작 후에도 요약 갱신 가능
  });

  test("참여자는 명단·명단 요약·초대·알림·배정을 못 만진다", async () => {
    await seed({ phase: 0 });
    const db = p("p001");
    await assertFails(setDoc(doc(db, "public", "roster"), { people: {} }));
    await assertFails(setDoc(doc(db, "roster", "p009"), { name: "x", loc: "SR3", part: "가파트", uid: null, disqualified: false }));
    await assertFails(updateDoc(doc(db, "roster", "p002"), { part: "가파트" }));
    await assertFails(setDoc(doc(db, "invites", "XXXXXX"), { personId: "p001" }));
    await assertFails(setDoc(doc(db, "nudges", "p002"), { at: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "assignments", "p001"), { receiverPid: "p003" }));
    await assertFails(getDoc(doc(db, "meta", "assignment")));
  });

  test("미션 진행: 현황·짝 현황·알림·주차·단서 공개·인증 무효 (Admin.jsx Running, Pairs, Moderation)", async () => {
    await seed({ phase: 1 });
    const db = admin();
    for (const name of ["progress", "redemptions", "nudges", "assignments", "giverCodes", "giverMissions", "reports", "verdicts", "receiverCodes"]) {
      await assertSucceeds(getDocs(collection(db, name)), name);
    }
    await assertSucceeds(setDoc(doc(db, "nudges", "p002"), { at: serverTimestamp() }));
    await assertSucceeds(deleteDoc(doc(db, "nudges", "p002")));
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { week: 2 }));
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { cluesReleased: 4 }));
    await assertSucceeds(setDoc(doc(db, "public", "board"), { week: 2, at: serverTimestamp(), parts: [{ part: "가파트", members: 2, done: 3, max: 4 }] })); // 파트 주간 순위 발표
    // 인증 무효: 인증 문서와 피드 글을 같이 바꾼다
    const off = writeBatch(db);
    off.update(doc(db, "redemptions", "B1B1"), { voided: true });
    off.update(doc(db, "feed", FEED_B1), { voided: true });
    await assertSucceeds(off.commit());
    const on = writeBatch(db);
    on.update(doc(db, "redemptions", "B1B1"), { voided: false });
    on.update(doc(db, "feed", FEED_B1), { voided: false });
    await assertSucceeds(on.commit());
    await assertSucceeds(updateDoc(doc(db, "roster", "p001"), { disqualified: true }));
    // 쪽지 검토: 미션 진행 중에도 쪽지를 읽고, 신고된 쪽지를 보고, 숨길 수 있다(숨김만 바꿀 수 있음)
    await put("noteFlags/dv1", { at: new Date() });
    await assertSucceeds(getDocs(collection(db, "deliveries")));
    await assertSucceeds(getDocs(collection(db, "noteFlags")));
    await assertSucceeds(updateDoc(doc(db, "deliveries", "dv1"), { hidden: true }));
    await assertFails(updateDoc(doc(db, "deliveries", "dv1"), { message: "운영자가 고친 쪽지" }));
    await assertFails(updateDoc(doc(p("p002"), "deliveries", "dv1"), { hidden: true })); // 받는 사람은 못 숨긴다(신고만)
    await assertSucceeds(deleteDoc(doc(db, "noteFlags", "dv1")));
    await assertFails(deleteDoc(doc(p("p002"), "deliveries", "dv1")));
    await assertSucceeds(deleteDoc(doc(db, "deliveries", "dv1"))); // 운영자는 지울 수 있다(장난 쪽지 정리)
    // 받는 사람이 "카드와 달라요"로 인증한 것을 운영자가 고칠 수 있다(도전 추가분)
    await assertSucceeds(updateDoc(doc(db, "redemptions", "B1B1"), { cardMatch: false }));
    await assertFails(updateDoc(doc(db, "redemptions", "B1B1"), { cardMatch: "no" }));
  });

  test("예전 방식으로 배정된 자료: 운영 화면이 받는 사람 기준 코드를 채워 넣는다 (Admin.jsx 짝 현황, 미션 진행 중에도)", async () => {
    await seed({ phase: 1 });
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "receiverCodes", "p002")));
    await assertFails(redeem(p("p002"), "A1A1", "p002", 1)); // 채우기 전에는 피드 글을 확인할 수 없어 인증이 안 된다
    await assertSucceeds(setDoc(doc(admin(), "receiverCodes", "p002"), { codes: CODES.p001 }));
    await assertSucceeds(redeem(p("p002"), "A1A1", "p002", 1));
  });

  test("받은 게 없어요 확인 (Admin.jsx Unresolved): 주차별 받았음·못 받음, 집계 단계까지 바꾸고 취소할 수 있다", async () => {
    await seed({ phase: 1 });
    await put("reports/p002_1", { receiverPid: "p002", slot: 1 });
    const db = admin();
    await assertSucceeds(getDocs(collection(db, "reports")));
    const verdict = (v, slot = 1) => ({ receiverPid: "p002", slot, verdict: v, at: serverTimestamp() });
    await assertSucceeds(setDoc(doc(db, "verdicts", "p002_1"), verdict("missing")));
    await assertSucceeds(setDoc(doc(db, "verdicts", "p002_1"), verdict("received")));
    await assertFails(setDoc(doc(db, "verdicts", "p002_1"), verdict("maybe")));
    await assertFails(setDoc(doc(db, "verdicts", "p002_2"), verdict("missing"))); // 문서 ID와 주차가 다름
    await assertFails(setDoc(doc(db, "verdicts", "p003_1"), verdict("missing"))); // 문서 ID와 받는 사람이 다름
    await assertSucceeds(deleteDoc(doc(db, "verdicts", "p002_1"))); // 확인 취소
    // 받는 사람과 그 마니또는 결과를 읽는다
    await assertSucceeds(setDoc(doc(db, "verdicts", "p002_1"), verdict("missing")));
    const seen = await assertSucceeds(getDoc(doc(p("p002"), "verdicts", "p002_1")));
    if (seen.data().verdict !== "missing") throw new Error("확인 결과가 다름");
    await assertSucceeds(getDoc(doc(p("p001"), "verdicts", "p002_1")));
    await setPhase(4);
    await assertSucceeds(setDoc(doc(db, "verdicts", "p002_3"), verdict("received", 3))); // 집계 전 확인 표
    await setPhase(5);
    await assertFails(setDoc(doc(db, "verdicts", "p002_3"), verdict("missing", 3))); // 공개 뒤에는 바꿀 수 없다
    await assertFails(deleteDoc(doc(db, "verdicts", "p002_3")));
  });

  test("집계 단계: 전부 읽고 결과 쓰기 (Admin.jsx Scoring)", async () => {
    await seed({ phase: 4 });
    const db = admin();
    for (const name of ["assignments", "giverCodes", "redemptions", "giverMissions", "guesses", "deliveries", "verdicts", "reports", "clues", "users"]) {
      await assertSucceeds(getDocs(collection(db, name)), name);
    }
    await assertSucceeds(setDoc(doc(db, "results", "public"), { pairs: [], tickets: {}, draws: {}, computedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db, "results", "public"), { bestReview: { code: "A1A1", review: review20, receiverPid: "p002" } }));
    await assertSucceeds(setDoc(doc(db, "results", "public"), { pairs: [], tickets: { p001: 3 }, draws: {}, computedAt: serverTimestamp() })); // 다시 집계
    // 추첨은 공개 단계에서만: 집계 단계에 추첨 결과를 미리 넣을 수 없다
    await assertFails(updateDoc(doc(db, "results", "public"), { "draws.t4": ["p001"] }));
    await assertFails(setDoc(doc(db, "results", "public"), { pairs: [], tickets: {}, draws: { grand: ["p001"] } }));
  });

  test("공개 단계의 시상: 숫자는 한 번만, 종이로 뽑힌 이름은 6등을 뽑기 전까지 고칠 수 있고, 6등을 뽑으면 아무것도 못 바꾼다 (Reveal.jsx)", async () => {
    await seed({ phase: 5, results: true });
    const db = admin();
    const ref = doc(db, "results", "public");
    // 숫자 없이 6등부터 쓸 수 없다, 모르는 칸·모양이 다른 값은 거부
    await assertFails(updateDoc(ref, { "draws.t6": { winners: ["p002"] } }));
    await assertFails(updateDoc(ref, { "draws.best": { winners: ["p002"] } })); // 2등은 저장하지 않는다(계산한다)
    await assertFails(updateDoc(ref, { "draws.seed": 4821 })); // 숫자는 글자로
    await assertFails(updateDoc(ref, { "draws.seed": "" }));
    await assertFails(updateDoc(ref, { "draws.seed": "1".repeat(21) }));
    await assertFails(updateDoc(ref, { "draws.t4": ["p004"] })); // { winners: [...] } 모양이 아님
    await assertFails(updateDoc(ref, { "draws.t4": { winners: ["p004"], seed: "9" } }));
    await assertFails(updateDoc(ref, { "draws.grand": { winners: ["p001", "p002"] } })); // 1등 두 명
    await assertFails(updateDoc(ref, { "draws.seed": "4821", tickets: { p001: 1 } })); // 다른 값도 같이 바꾸기
    // 화면은 트랜잭션으로 지금 값을 확인하고 쓴다: ① 숫자 정하기
    await assertSucceeds(runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.data().draws?.seed) throw new Error("이미 정함");
      tx.update(ref, { "draws.seed": "4821" });
    }));
    await assertFails(updateDoc(ref, { "draws.seed": "9999" })); // 숫자 바꾸기(결과를 보고 고르기)
    await assertFails(updateDoc(ref, { draws: {} })); // 숫자 지우기
    // ② 종이로 뽑힌 이름 입력, 잘못 넣은 이름 고치기
    await assertSucceeds(updateDoc(ref, { "draws.t4": { winners: ["p003"] } }));
    await assertSucceeds(updateDoc(ref, { "draws.t4": { winners: ["p004"] } }));
    await assertSucceeds(updateDoc(ref, { "draws.t5": { winners: [] } }));
    await assertSucceeds(updateDoc(ref, { "draws.grand": { winners: ["p001"] } }));
    await assertFails(updateDoc(doc(p("p001"), "results", "public"), { "draws.grand": { winners: ["p001"] } })); // 참여자
    // ③ 6등 사이트 추첨: 쓴 뒤에는 추첨 결과 전체를 바꿀 수 없다
    await assertSucceeds(runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.data().draws?.t6) throw new Error("이미 뽑음");
      tx.update(ref, { "draws.t6": { winners: ["p002"] } });
    }));
    await assertFails(updateDoc(ref, { "draws.t6": { winners: ["p003"] } })); // 다시 뽑아 덮어쓰기
    await assertFails(updateDoc(ref, { "draws.grand": { winners: ["p003"] } })); // 6등을 뽑은 뒤 1등 바꾸기
    await assertFails(updateDoc(ref, { "draws.t4": deleteField() }));
    await assertFails(updateDoc(ref, { draws: {} }));
    await assertFails(updateDoc(ref, { tickets: { p001: 99 } })); // 응모권 수 바꾸기
    await assertFails(setDoc(ref, { pairs: [], tickets: {}, draws: {} })); // 다시 집계(덮어쓰기)
    await assertFails(deleteDoc(ref));
    await assertSucceeds(updateDoc(ref, { step: 7 })); // 발표 진행은 계속 된다
    const snap = await assertSucceeds(getDoc(ref));
    const d = snap.data().draws; // 거부된 요청들이 아무것도 바꾸지 못했는지
    if (d.seed !== DRAWS.seed || ["grand", "t4", "t5", "t6"].some((k) => JSON.stringify(d[k]) !== JSON.stringify(DRAWS[k]))) throw new Error("추첨 결과가 바뀜");
  });

  test("공지·중도 이탈 (Admin.jsx Notice, Moderation)", async () => {
    await seed({ phase: 1 });
    const db = admin();
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { notice: "1주차 미션은 금요일까지!" }));
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { notice: "" }));
    await assertSucceeds(updateDoc(doc(db, "roster", "p003"), { dropout: true }));
    await assertSucceeds(updateDoc(doc(db, "roster", "p003"), { dropout: false }));
    // 참여자는 공지·운영자 목록·중도 이탈 표시를 바꿀 수 없다
    await assertFails(updateDoc(doc(p("p001"), "config", "app"), { notice: "가짜 공지" }));
    await assertFails(updateDoc(doc(p("p001"), "config", "app"), { admins: arrayUnion("u1") }));
    await assertFails(updateDoc(doc(p("p001"), "roster", "p002"), { dropout: true }));
  });

  test("최종 지목 단계: 지목 여부와 지목 내용을 읽는다 (Admin.jsx GuessStatus, 짝 현황)", async () => {
    await seed({ phase: 2 });
    await put("guesses/p002", { guessPid: "p001" });
    await assertSucceeds(getDocs(collection(admin(), "progress")));
    await assertSucceeds(getDocs(collection(admin(), "roster")));
    const snap = await assertSucceeds(getDocs(collection(admin(), "guesses")));
    if (snap.docs[0].data().guessPid !== "p001") throw new Error("지목 내용이 다름");
  });

  test("계정 연결 해제 (Admin.jsx unlinkPerson): 예전 계정은 못 읽고, 새 초대 코드로 다시 연결하면 기록이 이어진다", async () => {
    await seed({ phase: 1 });
    await put("invites/INV001", { personId: "p001" });
    await put("users/u1", { personId: "p001", eliminated: [], email: "wrong@example.com" });
    const db = admin();
    await assertSucceeds(getDocs(collection(db, "users"))); // 운영 화면 "연결된 메일"
    await assertFails(getDocs(collection(p("p002"), "users"))); // 참여자는 남의 메일 못 봄
    await assertFails(deleteDoc(doc(p("p001"), "users", "u1"))); // 참여자는 연결 해제 못 함
    const b = writeBatch(db);
    b.update(doc(db, "roster", "p001"), { uid: null });
    b.delete(doc(db, "users", "u1"));
    b.delete(doc(db, "invites", "INV001"));
    b.set(doc(db, "invites", "NEW001"), { personId: "p001" });
    await assertSucceeds(b.commit());
    // 예전 계정: 더 이상 p001로 못 읽음, 예전 초대 코드로 재연결 불가
    const old = asMail("u1", "wrong@example.com");
    await assertFails(getDoc(doc(old, "assignments", "p001")));
    await assertFails(getDoc(doc(old, "profiles", "p001")));
    await assertFails(updateDoc(doc(old, "roster", "p001"), { uid: "u1", inviteUsed: "INV001" }));
    // 새 계정: 새 초대 코드로 연결 → p001의 배정·프로필이 그대로 보인다
    const neu = asMail("u9", "right@example.com");
    await assertSucceeds(getDoc(doc(neu, "invites", "NEW001")));
    await assertSucceeds(updateDoc(doc(neu, "roster", "p001"), { uid: "u9", inviteUsed: "NEW001" }));
    await assertSucceeds(setDoc(doc(neu, "users", "u9"), { personId: "p001", eliminated: [], email: "right@example.com", n: N }, { merge: true }));
    await assertSucceeds(getDoc(doc(neu, "assignments", "p001")));
    await assertSucceeds(getDoc(doc(neu, "profiles", "p001")));
  });

  test("집계 전(3단계)에는 결과를 쓸 수 없다", async () => {
    await seed({ phase: 3 });
    await assertFails(setDoc(doc(admin(), "results", "public"), { pairs: [], draws: {} }));
  });
});

describe("참여 재미 기능: 취향·알레르기, 마니또에게 한마디, 중간 추측, 피드 공감, 발표 화면", () => {
  beforeEach(() => seed());

  test("내 마니또에게 알려 줄 것 (Profile.jsx Prefs, MyMission.jsx TargetPrefs): 본인이 쓰고, 나를 맡은 마니또·운영자만 읽는다", async () => {
    const mine = doc(p("p002"), "prefs", "p002");
    await assertSucceeds(setDoc(mine, { likes: "초코 과자", avoid: "땅콩 알레르기", nope: "", n: N }));
    await assertSucceeds(setDoc(mine, { likes: "초코 과자, 귤", avoid: "땅콩 알레르기", nope: "향 강한 것", n: N }, { merge: true }));
    await assertFails(setDoc(mine, { likes: "바꿈", n: 5 }, { merge: true })); // 쓴 횟수 건너뛰기
    await assertFails(setDoc(mine, { likes: "가".repeat(101), n: N }, { merge: true })); // 100자 초과
    await assertFails(setDoc(mine, { hint: "다른 필드", n: N }, { merge: true }));
    await assertFails(setDoc(doc(p("p001"), "prefs", "p002"), { likes: "남의 것", n: N })); // 남의 것 쓰기
    await assertSucceeds(getDoc(doc(p("p001"), "prefs", "p002"))); // p001은 p002의 마니또
    await assertSucceeds(getDoc(mine));
    await assertFails(getDoc(doc(p("p003"), "prefs", "p002"))); // p003은 p002의 대상(마니또가 아님)
    await assertFails(getDoc(doc(p("p004"), "prefs", "p002")));
    await assertFails(getDocs(collection(p("p001"), "prefs"))); // 목록은 운영자만
    await assertSucceeds(getDocs(collection(admin(), "prefs")));
    await assertFails(getDoc(doc(as("stranger"), "prefs", "p002")));
  });

  test("마니또에게 한마디 (Detective.jsx ToManito, MyMission.jsx FromReceiver): 주차마다 한 번, 열린 주차까지, 받는 사람과 그 마니또만 읽는다", async () => {
    const msg = (slot, more = {}) => ({ receiverPid: "p002", slot, message: "혹시 커피 좋아하세요?", createdAt: serverTimestamp(), ...more });
    const db = p("p002"); // p002의 마니또는 p001
    await assertFails(setDoc(doc(db, "toManito", "p002_2"), msg(2))); // 아직 안 열린 주차
    await assertFails(setDoc(doc(db, "toManito", "p002_1"), msg(1, { message: "  " }))); // 빈 말
    await assertFails(setDoc(doc(db, "toManito", "p002_1"), msg(1, { message: "가".repeat(201) })));
    await assertFails(setDoc(doc(db, "toManito", "p002_1"), msg(1, { createdAt: new Date(2020, 0, 1) })));
    await assertFails(setDoc(doc(db, "toManito", "p002_x"), msg(1))); // 문서 ID 규칙
    await assertFails(setDoc(doc(p("p003"), "toManito", "p002_1"), msg(1))); // 남의 이름으로
    await assertSucceeds(setDoc(doc(db, "toManito", "p002_1"), msg(1)));
    await assertFails(setDoc(doc(db, "toManito", "p002_1"), msg(1, { message: "다시 씀" }))); // 한 번만(고칠 수 없음)
    await assertFails(deleteDoc(doc(db, "toManito", "p002_1")));
    // 읽기: 마니또(p001)는 내 대상 앞으로 온 것만, 받는 사람은 자기가 보낸 것만
    await assertSucceeds(getDocs(query(collection(p("p001"), "toManito"), where("receiverPid", "==", "p002"))));
    await assertSucceeds(getDocs(query(collection(db, "toManito"), where("receiverPid", "==", "p002"))));
    await assertFails(getDocs(query(collection(p("p003"), "toManito"), where("receiverPid", "==", "p002"))));
    await assertFails(getDocs(collection(p("p001"), "toManito")));
    await assertSucceeds(getDocs(collection(admin(), "toManito")));
    await assertSucceeds(deleteDoc(doc(admin(), "toManito", "p002_1"))); // 운영자는 지울 수 있다
    await setPhase(3);
    await assertFails(setDoc(doc(p("p004"), "toManito", "p004_1"), { ...msg(1), receiverPid: "p004" })); // 투표 단계부터는 못 보냄
  });

  test("주차별 중간 추측 (Detective.jsx MidGuess): 열린 주차 칸만, 명단에 있는 다른 사람만, 본인·운영자만 읽는다", async () => {
    const mine = doc(p("p002"), "midGuesses", "p002");
    await assertFails(setDoc(mine, { guesses: { 1: "p002" }, n: N })); // 나 자신
    await assertFails(setDoc(mine, { guesses: { 1: "nobody" }, n: N })); // 명단에 없는 사람
    await assertFails(setDoc(mine, { guesses: { 2: "p004" }, n: N })); // 아직 안 열린 주차
    await assertFails(setDoc(mine, { guesses: { 1: "p004" } })); // 쓴 횟수 없음
    await assertSucceeds(setDoc(mine, { guesses: { 1: "p004" }, n: N }));
    await assertSucceeds(setDoc(mine, { guesses: { 1: "p001" }, n: N }, { merge: true })); // 그 주 안에는 바꿀 수 있다
    await assertSucceeds(getDoc(mine));
    await assertFails(getDoc(doc(p("p001"), "midGuesses", "p002"))); // 마니또도 못 본다(맞혔는지 드러남)
    await assertSucceeds(getDoc(doc(admin(), "midGuesses", "p002")));
    await setPhase(1, { week: 2 });
    await assertFails(setDoc(mine, { guesses: { 1: "p003" }, n: N }, { merge: true })); // 지난 주차는 그대로
    await assertSucceeds(setDoc(mine, { guesses: { 2: "p001" }, n: N }, { merge: true }));
    await setPhase(2);
    await assertFails(setDoc(mine, { guesses: { 2: "p004" }, n: N }, { merge: true })); // 최종 지목 단계에는 중간 추측 없음
  });

  test("피드 공감 (Feed.jsx): 글마다 한 번, 공감 표시와 한 묶음으로만, 누가 공감했는지는 본인만", async () => {
    const like = (pid, feedId = FEED_B1, more = {}) => {
      const db = p(pid);
      const b = writeBatch(db);
      b.update(doc(db, "feed", feedId), { likes: increment(1), ...more.feed });
      if (!more.noMark) b.set(doc(db, "feedLikes", `${feedId}_${pid}`), { pid, feedId, at: serverTimestamp(), ...more.mark });
      return b.commit();
    };
    await assertFails(like("p001", FEED_B1, { noMark: true })); // 공감 표시 없이 숫자만
    await assertFails(like("p001", FEED_B1, { feed: { likes: 5 } })); // 숫자를 마음대로
    await assertFails(like("p001", FEED_B1, { mark: { pid: "p004" } })); // 남의 이름으로
    await assertSucceeds(like("p001"));
    await assertFails(like("p001")); // 같은 글에 두 번
    await assertSucceeds(like("p004"));
    const f = await getDoc(doc(p("p003"), "feed", FEED_B1));
    if (f.data().likes !== 2) throw new Error(`공감 수가 2가 아님: ${f.data().likes}`);
    await assertSucceeds(getDocs(query(collection(p("p001"), "feedLikes"), where("pid", "==", "p001"))));
    await assertFails(getDocs(query(collection(p("p003"), "feedLikes"), where("pid", "==", "p001")))); // 남이 누구에게 공감했는지
    await assertFails(deleteDoc(doc(p("p001"), "feedLikes", `${FEED_B1}_p001`))); // 취소 없음
    // 가린 글·무효 글에는 공감할 수 없다
    await put(`feed/${FEED_B1}`, { slot: 1, review: "", voided: false, hidden: true, likes: 2, createdAt: new Date(2026, 10, 1) });
    await assertFails(like("p002"));
  });

  test("발표 화면 (Reveal.jsx Presenter): 공개 단계에 운영자만 진행 단계(step)를 바꾸고, 추첨 결과는 그대로 지켜진다", async () => {
    await seed({ phase: 5, results: true });
    const ref = doc(admin(), "results", "public");
    await assertSucceeds(updateDoc(ref, { step: 3 }));
    await assertSucceeds(updateDoc(ref, { step: 1 })); // 앞 장면으로 돌아가기
    await assertFails(updateDoc(ref, { step: "다음" }));
    await assertFails(updateDoc(ref, { step: 4, tickets: { p001: 99 } })); // 진행하면서 다른 값 바꾸기
    await assertFails(updateDoc(doc(p("p001"), "results", "public"), { step: 9 })); // 참여자
    await assertSucceeds(updateDoc(ref, { draws: DRAWS }));
    await assertFails(updateDoc(ref, { step: 5, "draws.t4": { winners: ["p002"] } })); // 6등을 뽑은 뒤에는 진행하면서도 추첨 결과를 못 바꾼다
    await assertSucceeds(updateDoc(ref, { step: 5 }));
  });
});

describe("수호천사: 지원한 참여자를 마니또가 미션을 안 한 사람에게 연결", () => {
  beforeEach(() => seed());
  // 시드 배정: p001 → p002 → p003 → p004 → p001. p002의 마니또는 p001.
  const volunteer = (pid, active = true) => setDoc(doc(p(pid), "angelVolunteers", pid), { active, at: serverTimestamp(), n: N }, { merge: true });
  const link = (db, receiverPid, angelPid) => setDoc(doc(db, "angels", receiverPid), { angelPid, at: serverTimestamp() });
  const gift = (db, receiverPid, k, more = {}) => setDoc(doc(db, "angelGifts", `${receiverPid}_${k}`), { receiverPid, k, text: "책상에 귤 두기", message: "힘내세요!", createdAt: serverTimestamp(), ...more });

  test("지원 (MyMission.jsx AngelCard): 본인만, 쓴 횟수와 서버 시각으로, 본인·운영자만 읽는다", async () => {
    await assertFails(setDoc(doc(p("p003"), "angelVolunteers", "p003"), { active: true, at: serverTimestamp() })); // n 없음
    await assertFails(setDoc(doc(p("p003"), "angelVolunteers", "p003"), { active: true, at: new Date(2020, 0, 1), n: N }));
    await assertFails(setDoc(doc(p("p004"), "angelVolunteers", "p003"), { active: true, at: serverTimestamp(), n: N })); // 남의 것
    await assertSucceeds(volunteer("p003"));
    await assertSucceeds(volunteer("p003", false)); // 취소
    await assertSucceeds(volunteer("p003", true));
    await assertSucceeds(getDoc(doc(p("p003"), "angelVolunteers", "p003")));
    await assertFails(getDoc(doc(p("p004"), "angelVolunteers", "p003")));
    await assertSucceeds(getDocs(collection(admin(), "angelVolunteers")));
    await setPhase(2);
    await assertFails(volunteer("p004")); // 미션 진행이 끝나면 지원할 수 없다
  });

  test("연결 (Admin.jsx Angels): 운영자만, 지원 중인 사람만, 받는 사람 본인·그 사람의 마니또는 안 된다", async () => {
    await volunteer("p001"); await volunteer("p003");
    await assertFails(link(admin(), "p002", "p004")); // 지원하지 않은 사람
    await assertFails(link(admin(), "p002", "p001")); // p002의 마니또
    await volunteer("p002");
    await assertFails(link(admin(), "p002", "p002")); // 본인
    await assertFails(link(p("p003"), "p002", "p003")); // 참여자가 스스로 연결
    await assertFails(setDoc(doc(admin(), "angels", "p002"), { angelPid: "p003", at: new Date(2020, 0, 1) }));
    await assertSucceeds(link(admin(), "p002", "p003"));
    // 수호천사는 내가 맡은 사람을 알 수 있다(내 것만)
    await assertSucceeds(getDocs(query(collection(p("p003"), "angels"), where("angelPid", "==", "p003"))));
    await assertFails(getDocs(query(collection(p("p004"), "angels"), where("angelPid", "==", "p003"))));
    await assertFails(getDoc(doc(p("p002"), "angels", "p002"))); // 받는 사람은 누가 수호천사인지 모른다
    await volunteer("p004");
    await assertSucceeds(link(admin(), "p002", "p004")); // 미션이 오기 전에는 바꿀 수 있다
    await assertSucceeds(link(admin(), "p002", "p003"));
    await setPhase(0);
    await assertFails(link(admin(), "p003", "p004")); // 준비 단계에는 연결하지 않는다
  });

  test("수호천사 미션과 받는 사람 확인 (MyMission.jsx AngelCard, Detective.jsx AngelInbox)", async () => {
    await volunteer("p003"); await volunteer("p004");
    await link(admin(), "p002", "p003");
    await assertFails(gift(p("p004"), "p002", 1)); // 연결되지 않은 사람
    await assertFails(gift(p("p003"), "p002", 3)); // 1·2번만
    await assertFails(setDoc(doc(p("p003"), "angelGifts", "p002_x"), { receiverPid: "p002", k: 1, text: "귤", message: "", createdAt: serverTimestamp() }));
    await assertFails(gift(p("p003"), "p002", 1, { text: "가" })); // 한 것은 2자 이상
    await assertFails(gift(p("p003"), "p002", 1, { angelPid: "p003" })); // 보낸 사람 정보 넣기
    await assertFails(gift(p("p003"), "p002", 1, { createdAt: new Date(2020, 0, 1) }));
    await assertSucceeds(gift(p("p003"), "p002", 1));
    await assertFails(gift(p("p003"), "p002", 1, { text: "다시 씀" })); // 한 번만
    // 읽기: 받는 사람(목록·문서), 수호천사(문서, 아직 없는 2번도 확인 가능), 다른 사람은 못 읽음
    await assertSucceeds(getDocs(query(collection(p("p002"), "angelGifts"), where("receiverPid", "==", "p002"))));
    await assertSucceeds(getDoc(doc(p("p003"), "angelGifts", "p002_1")));
    await assertSucceeds(getDoc(doc(p("p003"), "angelGifts", "p002_2")));
    await assertFails(getDoc(doc(p("p004"), "angelGifts", "p002_1")));
    await assertFails(getDoc(doc(p("p001"), "angelGifts", "p002_1"))); // 원래 마니또도 못 봄
    // 확인: 받는 사람만, 한 번만, 후기 10자 이상
    const ok = { confirmed: true, review: "귤 맛있게 먹었어요 고마워요!", confirmedAt: serverTimestamp() };
    await assertFails(updateDoc(doc(p("p003"), "angelGifts", "p002_1"), ok)); // 수호천사가 스스로
    await assertFails(updateDoc(doc(p("p002"), "angelGifts", "p002_1"), { ...ok, review: "고마워요" }));
    await assertFails(updateDoc(doc(p("p002"), "angelGifts", "p002_1"), { ...ok, text: "바꿈" }));
    await assertSucceeds(updateDoc(doc(p("p002"), "angelGifts", "p002_1"), ok));
    await assertFails(updateDoc(doc(p("p002"), "angelGifts", "p002_1"), { ...ok, review: "다시 쓴 후기입니다 열 자 넘게" }));
    // 미션이 온 뒤에는 연결을 바꾸거나 풀 수 없다
    await assertFails(link(admin(), "p002", "p004"));
    await assertFails(deleteDoc(doc(admin(), "angels", "p002")));
    // 수호천사는 받는 사람의 "내 마니또에게 알려 줄 것"(알레르기)을 읽는다
    await put("prefs/p002", { avoid: "땅콩", likes: "", nope: "", n: 1 });
    await assertSucceeds(getDoc(doc(p("p003"), "prefs", "p002")));
    await assertFails(getDoc(doc(p("p004"), "prefs", "p002")));
    await setPhase(2);
    await assertFails(gift(p("p003"), "p002", 2)); // 미션 진행이 끝나면 못 보냄
    await assertSucceeds(getDocs(collection(admin(), "angelGifts")));
  });
});

describe("보안 점검에서 막은 것: 위조·권한 넘기", () => {
  beforeEach(() => seed());

  test("카드 난이도 위조: 카드 번호와 난이도가 맞아야 한다(쉬운 카드를 도전이라고 적을 수 없다)", async () => {
    const gm = doc(p("p001"), "giverMissions", "p001");
    const choose = (c) => setDoc(gm, { choices: { 1: c }, n: N }, { merge: true });
    await assertFails(choose({ cardId: "e1", level: "hard", text: "easy 카드" }));
    await assertFails(choose({ cardId: "x", level: "hard", text: "아무 글" }));
    await assertFails(choose({ cardId: "h1e1", level: "hard", text: "아무 글" }));
    await assertFails(choose({ level: "hard", text: "번호 없음" }));
    await assertFails(choose({ cardId: "praise", level: "hard", text: "칭찬" }));
    await assertSucceeds(choose({ cardId: "h3", level: "hard", text: "도전 카드" }));
    await assertSucceeds(choose({ cardId: "n12", level: "normal", text: "보통 카드" }));
  });

  test("완료 표시 위조: done은 true만, 칸은 1~3만(문자열·숫자로 완료처럼 보이게 쓸 수 없다)", async () => {
    const gm = doc(p("p001"), "giverMissions", "p001");
    await assertFails(setDoc(gm, { done: { 1: "yes" }, n: N }, { merge: true })); // 완료 알림 없이 완료처럼 보이게
    await assertFails(setDoc(gm, { done: { 1: 1 }, n: N }, { merge: true }));
    await assertFails(setDoc(gm, { done: { 9: true }, n: N }, { merge: true }));
    await assertFails(setDoc(gm, { done: { 1: false }, n: N }, { merge: true }));
    await assertFails(setDoc(gm, { choices: { 7: EASY }, n: N }, { merge: true }));
    await assertFails(setDoc(gm, { choices: { 1: EASY, big: "가".repeat(5000) }, n: N }, { merge: true }));
    await assertFails(setDoc(gm, { notes: { 9: 1 }, n: N }, { merge: true }));
    await assertFails(setDoc(gm, { done: "yes", n: N }, { merge: true }));
    await assertFails(setDoc(gm, { done: { 1: true }, n: N }, { merge: true })); // true도 완료 알림과 한 묶음이어야 한다
    await assertSucceeds(sendMission(p("p001"), 1));
  });

  test("단서는 최종 지목 단계까지만 쓴다(지목이 마감된 뒤 채워서 은신 조건만 맞출 수 없다)", async () => {
    const clue = (i) => setDoc(doc(p("p001"), "clues", `p002_${i}`), { receiverPid: "p002", idx: i, answer: A(i), ver: 0, n: N });
    await setPhase(2, { cluesReleased: 6, week: 3 });
    await assertSucceeds(clue(5));
    for (const phase of [3, 4, 5]) {
      await setPhase(phase, { cluesReleased: 6, week: 3 });
      await assertFails(clue(4));
    }
  });

  test("초대 코드 목록은 처음 운영자만(공동 운영자가 가입 안 한 사람의 코드를 읽어 다른 계정을 연결할 수 없다)", async () => {
    await seed({ admins: [ADMIN, CO] });
    await assertSucceeds(getDocs(collection(admin(), "invites")));
    await assertFails(getDocs(collection(as(CO), "invites")));
    await assertSucceeds(getDoc(doc(as(CO), "invites", "INV005"))); // 코드를 아는 사람은 그 한 건을 확인할 수 있다(가입 화면)
  });

  test("단계는 공개(5)가 마지막이다", async () => {
    await seed({ phase: 5, results: true });
    await assertFails(updateDoc(doc(admin(), "config", "app"), { phase: 6 }));
  });

  test('"못 받음"은 처음 운영자만 정하고 바꾸고 취소한다. 공동 운영자는 "받았음"만', async () => {
    await seed({ admins: [ADMIN, CO] });
    const v = (verdict) => ({ receiverPid: "p002", slot: 1, verdict, at: serverTimestamp() });
    const co = doc(as(CO), "verdicts", "p002_1");
    const own = doc(admin(), "verdicts", "p002_1");
    await assertFails(setDoc(co, v("missing")));
    await assertSucceeds(setDoc(co, v("received")));
    await assertFails(setDoc(co, v("missing"))); // 받았음 → 못 받음으로 바꾸기
    await assertSucceeds(deleteDoc(co)); // 받았음 취소
    await assertSucceeds(setDoc(own, v("missing")));
    await assertFails(setDoc(co, v("received"))); // 처음 운영자가 정한 못 받음을 뒤집기
    await assertFails(deleteDoc(co));
    await assertFails(setDoc(own, { ...v("missing"), note: "가".repeat(5000) })); // 정해진 값만
    await assertSucceeds(setDoc(own, v("received")));
    await assertSucceeds(deleteDoc(own));
  });

  test("수호천사 지원은 미션 진행 단계에만(준비 단계에 먼저 지원해 순서를 앞당길 수 없다)", async () => {
    const volunteer = () => setDoc(doc(p("p003"), "angelVolunteers", "p003"), { active: true, at: serverTimestamp(), n: N }, { merge: true });
    await setPhase(0);
    await assertFails(volunteer());
    await setPhase(1);
    await assertSucceeds(volunteer());
    await setPhase(2);
    await assertFails(volunteer());
  });

  test("수호천사 미션 확인도 최종 지목 단계까지 된다", async () => {
    await put("angelVolunteers/p003", { active: true, n: 1 });
    await put("angels/p002", { angelPid: "p003" });
    await put("angelGifts/p002_1", { receiverPid: "p002", k: 1, text: "책상에 귤 두기", message: "" });
    const ok = { confirmed: true, review: "귤 덕분에 오후가 상큼했어요", confirmedAt: serverTimestamp() };
    await setPhase(3);
    await assertFails(updateDoc(doc(p("p002"), "angelGifts", "p002_1"), ok));
    await setPhase(2);
    await assertSucceeds(updateDoc(doc(p("p002"), "angelGifts", "p002_1"), ok));
  });

  test("큰 값을 넣을 수 없다: 진행 상황·프로필·제외한 용의자 목록", async () => {
    const big = "가".repeat(5000);
    await assertFails(setDoc(doc(p("p001"), "progress", "p001"), { guessed: big, n: N }, { merge: true }));
    await assertFails(setDoc(doc(p("p001"), "progress", "p001"), { profileDone: big, n: N }, { merge: true }));
    await assertSucceeds(setDoc(doc(p("p001"), "progress", "p001"), { guessed: true, n: N }, { merge: true }));
    const answers = [0, 1, 2, 3, 4, 5].map((i) => A(i));
    await assertFails(setDoc(doc(p("p001"), "profiles", "p001"), { answers, updatedAt: big, n: N }, { merge: true }));
    await assertSucceeds(setDoc(doc(p("p001"), "profiles", "p001"), { answers, updatedAt: serverTimestamp(), n: N }, { merge: true }));
    await assertFails(updateDoc(doc(p("p001"), "users", "u1"), { eliminated: [big], n: N }));
    await assertFails(updateDoc(doc(p("p001"), "users", "u1"), { eliminated: [{ big }], n: N })); // 글자가 아닌 큰 값
    await assertSucceeds(updateDoc(doc(p("p001"), "users", "u1"), { eliminated: ["p003", "p004"], n: N }));
  });
});

// ───────────────────────── 황금 카드 추첨(사용자가 정함, 11/23) ─────────────────────────
describe("황금 카드 추첨: 당첨은 운영자만 쓰고, 당첨된 본인과 운영자만 읽는다", () => {
  beforeEach(() => seed({ phase: 1, week: 3 }));

  test("운영자의 추첨(Admin.jsx GoldDraw): meta/goldDraw·public/goldDraw·goldWins를 한 번에", async () => {
    const db = admin();
    await assertSucceeds(runTransaction(db, async (tx) => {
      tx.set(doc(db, "meta", "goldDraw"), { weeks: { 2: { at: serverTimestamp(), seed: "000000001", count: 5, candidates: ["p003"], winners: ["p003"] } } }, { merge: true });
      tx.set(doc(db, "public", "goldDraw"), { weeks: { 2: { at: serverTimestamp(), candidates: 1, winners: 1 } } }, { merge: true });
      tx.set(doc(db, "goldWins", "p003"), { weeks: { 2: true }, at: serverTimestamp() }, { merge: true });
    }));
    // 3주차에도 뽑히면 칸이 늘어난다
    await assertSucceeds(setDoc(doc(db, "goldWins", "p003"), { weeks: { 3: true }, at: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(doc(db, "goldWins", "p004"), { weeks: { 4: true }, at: serverTimestamp() })); // 없는 주차
    await assertFails(setDoc(doc(db, "goldWins", "p004"), { weeks: { 2: "yes" }, at: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "goldWins", "p004"), { weeks: { 2: true }, at: new Date(2026, 10, 1) })); // 시각 지어내기
    await assertFails(setDoc(doc(db, "goldWins", "p004"), { weeks: { 2: true }, at: serverTimestamp(), prize: "x" }));
  });

  test("당첨 확인: 본인만 자기 문서를 읽고(없어도 확인 가능), 남의 당첨·목록·추첨 기록은 못 읽고, 쓰지도 못한다", async () => {
    await put("goldWins/p003", { weeks: { 2: true }, at: new Date(2026, 11, 1) });
    await put("meta/goldDraw", { weeks: { 2: { winners: ["p003"], candidates: ["p003"], seed: "1", count: 5 } } });
    await put("public/goldDraw", { weeks: { 2: { candidates: 1, winners: 1 } } });
    await assertSucceeds(getDoc(doc(p("p003"), "goldWins", "p003")));
    await assertSucceeds(getDoc(doc(p("p004"), "goldWins", "p004"))); // 안 뽑힌 사람도 자기 것은 확인(없음)
    await assertFails(getDoc(doc(p("p004"), "goldWins", "p003"))); // 남의 당첨
    await assertFails(getDoc(doc(p("p002"), "goldWins", "p003"))); // p003의 마니또여도
    await assertFails(getDocs(collection(p("p003"), "goldWins")));
    await assertFails(getDoc(doc(p("p003"), "meta", "goldDraw")));
    await assertSucceeds(getDoc(doc(p("p004"), "public", "goldDraw"))); // 추첨 여부·인원 수만
    await assertFails(setDoc(doc(p("p003"), "goldWins", "p003"), { weeks: { 3: true }, at: serverTimestamp() }));
    await assertFails(setDoc(doc(p("p004"), "goldWins", "p004"), { weeks: { 2: true }, at: serverTimestamp() }));
    await assertFails(setDoc(doc(p("p003"), "public", "goldDraw"), { weeks: {} }));
    await assertSucceeds(getDoc(doc(admin(), "goldWins", "p003")));
  });
});
