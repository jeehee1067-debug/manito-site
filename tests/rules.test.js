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

let env;

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
const FEED_B1 = "feedB1B1xx"; // 시드: p003이 p002의 1주차 미션(B1B1)을 인증하면서 올라간 피드 글

async function seed({ phase = 1, week = 1, cluesReleased = 2, admins = [ADMIN], results = false, extra } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const b = writeBatch(db);
    b.set(doc(db, "config", "app"), { admins, phase, week, cluesReleased, siteMatched: false, partExcluded: true });
    for (const pid of ["p001", "p002", "p003", "p004", "p005"]) {
      b.set(doc(db, "roster", pid), { name: pid, loc: "SR3", part: PART[pid], uid: UID[pid] || null, disqualified: false });
    }
    b.set(doc(db, "invites", "INV005"), { personId: "p005" });
    b.set(doc(db, "public", "roster"), { people: { p001: { name: "p001", loc: "SR3", part: "가파트" } } });
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
    for (let i = 0; i < 6; i++) b.set(doc(db, "clues", `p002_${i}`), { receiverPid: "p002", idx: i, answer: `답${i}`, ver: 0 });
    b.set(doc(db, "clues", "p002_6"), { receiverPid: "p002", idx: 6, answer: "가파트", ver: 0 }); // 파트 단서(배정 때 운영자 브라우저가 씀)
    b.set(doc(db, "voteCards", "c0"), { reviews: [], part: "가파트" });
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
const p = (pid) => as(UID[pid]);
const admin = () => as(ADMIN);

async function setPhase(phase, more = {}) {
  await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "config", "app"), { phase, ...more }));
}
async function put(path, data) {
  await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), ...path.split("/")), data));
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

  test("profiles·giverMissions·guesses·votes·users·reports·verdicts: 남의 것은 거부", async () => {
    await put("reports/p003_1", { receiverPid: "p003", slot: 1 });
    await put("verdicts/p003_1", { receiverPid: "p003", slot: 1, verdict: "missing" });
    await assertFails(getDoc(doc(p("p002"), "profiles", "p001")));
    await assertFails(getDoc(doc(p("p002"), "giverMissions", "p001")));
    await assertFails(getDoc(doc(p("p002"), "guesses", "p001")));
    await assertFails(getDoc(doc(p("p002"), "votes", "p001")));
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
    await assertFails(getDocs(collection(stranger, "voteCards")));
    await assertFails(getDoc(doc(stranger, "results", "public")));
    // 연결 전에도 필요한 것: 단계 정보(첫 운영자 여부), 초대 코드 하나 확인
    await assertSucceeds(getDoc(doc(stranger, "config", "app")));
    await assertSucceeds(getDoc(doc(stranger, "invites", "INV005")));
    await assertFails(getDocs(collection(stranger, "invites")));
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

  test("미션 진행 단계(1)가 아니면 거부", async () => {
    for (const phase of [0, 2, 3]) {
      await setPhase(phase);
      await assertFails(redeem(p("p002"), "A1A1", "p002", 1));
    }
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
    await assertFails(setDoc(doc(db, "feed", "adminpost000"), post(1))); // 운영자도 피드에 글을 만들 수는 없다
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
    await assertSucceeds(updateDoc(cfg, { cluesReleased: 2 })); // Admin.jsx releaseClues
    await assertFails(updateDoc(cfg, { cluesReleased: 4 })); // 같은 주에 한 번 더
    await assertSucceeds(updateDoc(cfg, { week: 2 }));
    await assertSucceeds(updateDoc(cfg, { cluesReleased: 4 }));
    await assertFails(updateDoc(cfg, { cluesReleased: 6 }));
    await assertFails(updateDoc(cfg, { cluesReleased: 2 })); // 공개한 단서를 다시 잠그기
    await assertSucceeds(updateDoc(cfg, { week: 3 }));
    await assertSucceeds(updateDoc(cfg, { cluesReleased: 6 }));
    await assertFails(updateDoc(cfg, { cluesReleased: 8 }));
    // 주차를 내려도 다른 설정은 바꿀 수 있다(이미 공개한 단서 수는 그대로)
    await assertSucceeds(updateDoc(cfg, { week: 2 }));
    await assertSucceeds(updateDoc(cfg, { notice: "공지" }));
  });

  test("참여자는 config를 바꿀 수 없고, 이미 있는 config를 새로 만들어 운영자가 될 수도 없다", async () => {
    await assertFails(updateDoc(doc(p("p001"), "config", "app"), { phase: 3 }));
    await assertFails(updateDoc(doc(p("p001"), "config", "app"), { cluesReleased: 6 }));
    await assertFails(updateDoc(doc(p("p001"), "config", "app"), { admins: arrayUnion("u1") }));
    await assertFails(setDoc(doc(p("p001"), "config", "app"), { admins: ["u1"], phase: 0, week: 1, cluesReleased: 0 }));
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
  const open = ["assignments", "giverCodes", "codes", "receiverCodes", "giverMissions", "guesses", "progress", "redemptions", "reports", "verdicts", "roster", "users"];

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

  test("쪽지 내용과 투표는 집계 단계부터, 단서·프로필은 끝까지 읽을 수 없다", async () => {
    for (const phase of [1, 2, 3]) {
      await setPhase(phase);
      await assertFails(getDocs(collection(admin(), "deliveries")));
      await assertFails(getDocs(collection(admin(), "votes")));
    }
    await setPhase(4);
    await assertSucceeds(getDocs(collection(admin(), "deliveries")));
    await assertSucceeds(getDocs(collection(admin(), "votes")));
    await assertFails(getDoc(doc(admin(), "clues", "p002_0")));
    await assertFails(getDoc(doc(admin(), "profiles", "p001")));
  });

  test("운영자 계정은 명단에 연결할 수 없다 (초대 코드를 알아도)", async () => {
    const db = asMail(ADMIN, "admin@example.com");
    // 운영자는 명단 문서를 고칠 수 있지만(연결 해제 등), 자기 계정의 연결 문서(users)는 만들 수 없다 → 참여자가 될 수 없다
    await assertSucceeds(updateDoc(doc(db, "roster", "p005"), { uid: ADMIN, inviteUsed: "INV005" }));
    await assertFails(setDoc(doc(db, "users", ADMIN), { personId: "p005", eliminated: [], email: "admin@example.com" }));
    await assertFails(getDoc(doc(db, "profiles", "p005"))); // 연결되지 않았으니 참여자 화면의 자료도 못 읽는다
    // 같은 초대 코드로 일반 계정은 연결된다(운영자가 uid를 지워 준 뒤)
    await assertSucceeds(updateDoc(doc(db, "roster", "p005"), { uid: null }));
    const u5 = asMail("u5", "u5@example.com");
    await assertSucceeds(updateDoc(doc(u5, "roster", "p005"), { uid: "u5", inviteUsed: "INV005" }));
    await assertSucceeds(setDoc(doc(u5, "users", "u5"), { personId: "p005", eliminated: [], email: "u5@example.com" }));
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
    await assertFails(setDoc(doc(co, "users", "co-admin-uid"), { personId: "p005", eliminated: [] }));
    // 권한 빼기: 메모도 같이 지운다. 운영자가 0명이 되게 할 수는 없다
    await assertSucceeds(updateDoc(cfg, { admins: arrayRemove("co-admin-uid"), "adminNotes.co-admin-uid": deleteField() }));
    await assertFails(updateDoc(doc(co, "config", "app"), { week: 3 }));
    await assertFails(getDocs(collection(co, "assignments")));
    await assertFails(updateDoc(cfg, { admins: [] }));
    await assertFails(updateDoc(cfg, { admins: arrayRemove(ADMIN) }));
  });

  test("운영자였던 계정이 권한이 빠지면 일반 계정처럼 초대 코드로 연결할 수 있다", async () => {
    await seed({ phase: 1, admins: [ADMIN, "ex-admin"] });
    const ex = asMail("ex-admin", "ex@example.com");
    await assertFails(setDoc(doc(ex, "users", "ex-admin"), { personId: "p005", eliminated: [], email: "ex@example.com" }));
    await assertSucceeds(updateDoc(doc(admin(), "config", "app"), { admins: arrayRemove("ex-admin") }));
    await assertSucceeds(updateDoc(doc(ex, "roster", "p005"), { uid: "ex-admin", inviteUsed: "INV005" }));
    await assertSucceeds(setDoc(doc(ex, "users", "ex-admin"), { personId: "p005", eliminated: [], email: "ex@example.com" }));
  });

  test("배정은 0단계에서만 쓸 수 있다", async () => {
    await assertSucceeds(setDoc(doc(admin(), "assignments", "p001"), { receiverPid: "p003" }));
    await setPhase(1);
    await assertFails(setDoc(doc(admin(), "assignments", "p001"), { receiverPid: "p002" }));
    await assertFails(setDoc(doc(admin(), "giverCodes", "p001"), { codes: CODES.p001 }));
    await assertFails(setDoc(doc(admin(), "codes", "NEW1"), { receiverPid: "p002", slot: 1 }));
  });

  test("게시된 규칙 버전 확인 (Admin.jsx): 화면이 기대하는 버전만 읽힌다", async () => {
    const { RULES_VERSION } = await import("../src/lib/constants.js");
    await assertSucceeds(getDoc(doc(admin(), "rulesVersion", RULES_VERSION)));
    await assertFails(getDoc(doc(admin(), "rulesVersion", "19990101")));
    await assertFails(setDoc(doc(admin(), "rulesVersion", RULES_VERSION), { x: 1 }));
  });
});

// ───────────────────────── 5. 미션 슬롯: 완료한 슬롯 잠금, 열린 주차까지만 ─────────────────────────
describe("5. 미션 슬롯: 완료한 슬롯의 난이도는 못 바꾸고, 열린 주차까지만 고르고 완료한다", () => {
  const card = (level, id = level[0] + "1") => ({ cardId: id, level, text: `${level} 카드` });
  const praise = { cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" };
  const mine = () => doc(p("p001"), "giverMissions", "p001");
  beforeEach(() => seed({ week: 3 }));

  test("완료 전에는 고르기·다시 고르기가 된다 (MyMission.jsx choose / 다른 카드 고르기)", async () => {
    await assertSucceeds(setDoc(mine(), { choices: { 1: card("easy") } }, { merge: true }));
    await assertSucceeds(setDoc(mine(), { choices: { 1: null } }, { merge: true }));
    await assertSucceeds(setDoc(mine(), { choices: { 1: card("hard") } }, { merge: true }));
  });

  test("완료 후에는 난이도 변경·카드 지우기·완료 취소가 거부된다", async () => {
    await put("giverMissions/p001", { choices: { 1: card("easy") }, done: { 1: true } });
    await assertFails(setDoc(mine(), { choices: { 1: card("hard") } }, { merge: true }));
    await assertFails(setDoc(mine(), { choices: { 1: null } }, { merge: true }));
    await assertFails(setDoc(mine(), { done: { 1: false } }, { merge: true }));
    await assertFails(setDoc(mine(), { choices: {} })); // 덮어쓰기로 통째로 지우기
    await assertFails(updateDoc(mine(), { choices: deleteField() }));
    // 완료하지 않은 다른 슬롯은 여전히 바꿀 수 있다
    await assertSucceeds(setDoc(mine(), { choices: { 2: card("normal") } }, { merge: true }));
  });

  test("완료 표시를 안 했어도, 코드가 이미 인증된 슬롯은 난이도를 못 바꾼다", async () => {
    await put("giverMissions/p001", { choices: { 1: card("easy") } });
    await put("redemptions/A1A1", { receiverPid: "p002", slot: 1, review: review20, voided: false, feedId: feedIdOf("A1A1") });
    await assertFails(setDoc(mine(), { choices: { 1: card("hard") } }, { merge: true }));
    await assertFails(setDoc(mine(), { choices: { 1: null } }, { merge: true }));
    // 늦게라도 완료 표시는 할 수 있다(카드는 그대로)
    await assertSucceeds(setDoc(mine(), { done: { 1: true } }, { merge: true }));
  });

  test("카드를 안 고른 채 코드가 인증된 슬롯에 나중에 도전 카드를 넣을 수 없다", async () => {
    await put("redemptions/A2A2", { receiverPid: "p002", slot: 2, review: review20, voided: false, feedId: feedIdOf("A2A2") });
    await assertFails(setDoc(mine(), { choices: { 2: card("hard") } }, { merge: true })); // 문서가 없을 때(create)
    await put("giverMissions/p001", { choices: { 1: card("easy") } });
    await assertFails(setDoc(mine(), { choices: { 2: card("hard") } }, { merge: true })); // 문서가 있을 때(update)
  });

  test("3주차 칭찬 슬롯에는 칭찬 카드만 들어간다", async () => {
    await assertFails(setDoc(mine(), { choices: { 3: card("hard") } }, { merge: true }));
    await assertSucceeds(setDoc(mine(), { done: { 3: true }, choices: { 3: praise } }, { merge: true }));
  });

  test("남의 giverMissions는 못 쓴다", async () => {
    await assertFails(setDoc(doc(p("p002"), "giverMissions", "p001"), { choices: { 1: card("hard") } }, { merge: true }));
  });

  test("아직 열리지 않은 주차는 카드 고르기도 완료 표시도 거부된다", async () => {
    await setPhase(1, { week: 1 });
    await assertSucceeds(setDoc(mine(), { choices: { 1: card("easy") } }, { merge: true }));
    await assertFails(setDoc(mine(), { choices: { 2: card("easy") } }, { merge: true })); // 2주차 카드 미리 고르기
    await assertFails(setDoc(mine(), { done: { 2: true } }, { merge: true }));
    await assertFails(setDoc(mine(), { done: { 3: true }, choices: { 3: praise } }, { merge: true })); // 칭찬 카드 미리 보내기
    await assertFails(setDoc(mine(), { choices: { 1: card("easy"), 2: card("hard") }, done: { 1: true } })); // 열린 주차와 섞어서
    await assertSucceeds(setDoc(mine(), { done: { 1: true } }, { merge: true })); // 열린 주차는 된다
    await setPhase(1, { week: 2 });
    await assertSucceeds(setDoc(mine(), { choices: { 2: card("hard") } }, { merge: true }));
    await assertSucceeds(setDoc(mine(), { done: { 2: true } }, { merge: true }));
    await assertFails(setDoc(mine(), { done: { 3: true }, choices: { 3: praise } }, { merge: true }));
    // 운영자가 주차를 다시 내려도, 이미 해 둔 2주차는 그대로 둔 채 다른 값을 쓸 수 있다(쪽지 더 보내기 횟수)
    await setPhase(1, { week: 1 });
    await assertSucceeds(setDoc(mine(), { notes: { 1: increment(1) } }, { merge: true }));
  });

  test("미션 진행 단계가 아니면 카드 고르기·완료 표시가 거부된다", async () => {
    for (const phase of [0, 2, 3]) {
      await setPhase(phase);
      await assertFails(setDoc(mine(), { choices: { 1: card("easy") } }, { merge: true }), `${phase}단계`);
      await assertFails(setDoc(mine(), { done: { 1: true } }, { merge: true }), `${phase}단계`);
    }
  });
});

// ───────────────────────── 앱 흐름: 화면이 보내는 요청이 거부되지 않는지 ─────────────────────────
describe("앱 흐름: 참여자 화면", () => {
  beforeEach(() => seed());

  test("가입 후 초대 코드 연결 (account.js claimWithInvite): 명단을 읽지 않고 바로 연결, 로그인한 메일 저장", async () => {
    const db = asMail("u5", "u5@example.com");
    const invite = await assertSucceeds(getDoc(doc(db, "invites", "INV005")));
    const personId = invite.data().personId;
    await assertSucceeds(updateDoc(doc(db, "roster", personId), { uid: "u5", inviteUsed: "INV005" }));
    await assertFails(setDoc(doc(db, "users", "u5"), { personId, eliminated: [], email: "someone@example.com" })); // 남의 메일로 꾸미기
    await assertSucceeds(setDoc(doc(db, "users", "u5"), { personId, eliminated: [], email: "u5@example.com" }));
    // 같은 사람이 같은 초대 코드로 다시 연결: 명단 수정은 거부되지만 users는 통과
    await assertFails(updateDoc(doc(db, "roster", personId), { uid: "u5", inviteUsed: "INV005" }));
    await assertSucceeds(setDoc(doc(db, "users", "u5"), { personId, eliminated: [], email: "u5@example.com" }));
    // 다른 계정이 같은 초대 코드로: 둘 다 거부
    const other = asMail("u6", "u6@example.com");
    await assertFails(updateDoc(doc(other, "roster", personId), { uid: "u6", inviteUsed: "INV005" }));
    await assertFails(setDoc(doc(other, "users", "u6"), { personId, eliminated: [], email: "u6@example.com" }));
  });

  test("예전 가입분(메일 없음)은 그대로 쓰이고, 로그인할 때 내 메일로만 채울 수 있다 (App.jsx)", async () => {
    const db = asMail("u1", "u1@example.com");
    await assertSucceeds(updateDoc(doc(db, "users", "u1"), { eliminated: arrayUnion("p003") })); // 메일 없는 문서
    await assertFails(updateDoc(doc(db, "users", "u1"), { email: "other@example.com" }));
    await assertSucceeds(updateDoc(doc(db, "users", "u1"), { email: "u1@example.com" }));
    await assertSucceeds(updateDoc(doc(db, "users", "u1"), { eliminated: arrayUnion("p004") }));
  });

  test("초대 코드 연결: 남의 초대 코드로 다른 이름 연결·이미 연결된 이름 가로채기·남의 users 만들기는 거부", async () => {
    const db = as("u5");
    await assertFails(updateDoc(doc(db, "roster", "p004"), { uid: "u5", inviteUsed: "INV005" })); // 초대 코드와 다른 이름
    await assertFails(updateDoc(doc(db, "roster", "p001"), { uid: "u5", inviteUsed: "INV005" })); // 이미 가입한 이름
    await assertFails(updateDoc(doc(db, "roster", "p005"), { uid: "u5", inviteUsed: "INV005", part: "나파트" })); // 다른 필드까지
    await assertFails(setDoc(doc(db, "users", "u5"), { personId: "p001", eliminated: [] })); // 남의 이름으로 users
    await assertFails(getDocs(collection(db, "invites"))); // 초대 코드 목록
    await assertFails(updateDoc(doc(p("p001"), "users", "u1"), { personId: "p002" })); // 연결 후 이름 바꾸기
  });

  test("캐릭터·프로필·단서 준비 (Profile.jsx save, sync.js syncClues)", async () => {
    const db = p("p001");
    await assertSucceeds(setDoc(doc(db, "avatars", "p001"), { avatar: 3 }));
    await assertFails(setDoc(doc(db, "avatars", "p001"), { avatar: 8 }));
    await assertFails(setDoc(doc(db, "avatars", "p002"), { avatar: 1 }));
    await assertSucceeds(getDoc(doc(db, "profiles", "p001")));
    await assertSucceeds(setDoc(doc(db, "profiles", "p001"), { answers: ["a", "b", "c", "d", "e", "f"], updatedAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(db, "progress", "p001"), { profileDone: true }, { merge: true }));
    const receiverPid = (await assertSucceeds(getDoc(doc(db, "assignments", "p001")))).data().receiverPid;
    const batch = writeBatch(db);
    for (let i = 0; i < 6; i++) batch.set(doc(db, "clues", `${receiverPid}_${i}`), { receiverPid, idx: i, answer: `답${i}`, ver: 0 });
    await assertSucceeds(batch.commit());
    await assertSucceeds(setDoc(doc(db, "progress", "p001"), { cluesVer: 0 }, { merge: true }));
  });

  test("단서는 내 대상 앞으로만, 문서 ID 규칙대로만 쓸 수 있다", async () => {
    const db = p("p001");
    await assertFails(setDoc(doc(db, "clues", "p003_0"), { receiverPid: "p003", idx: 0, answer: "x", ver: 0 }));
    await assertFails(setDoc(doc(db, "clues", "p002_9"), { receiverPid: "p002", idx: 0, answer: "x", ver: 0 }));
    await assertFails(setDoc(doc(db, "clues", "p002_6"), { receiverPid: "p002", idx: 6, answer: "x", ver: 0 }));
    await assertFails(setDoc(doc(db, "clues", "p002_0"), { receiverPid: "p002", idx: 0, answer: "x" })); // 회차 없음
    await assertFails(setDoc(doc(db, "clues", "p002_0"), { receiverPid: "p002", idx: 0, answer: "x", ver: 1 })); // 다른 회차
  });

  test("이미 공개된 단서는 답을 바꿀 수 없다 (같은 답 다시 쓰기·안 공개된 칸·비어 있던 칸은 됨)", async () => {
    // 시드: cluesReleased = 2, p001(마니또)이 p002(대상)에게 쓴 단서 답0~답5
    const db = p("p001");
    const clue = (idx, answer) => ({ receiverPid: "p002", idx, answer, ver: 0 });
    await assertFails(setDoc(doc(db, "clues", "p002_0"), clue(0, "다른답"))); // 공개된 칸 바꾸기
    await assertFails(setDoc(doc(db, "clues", "p002_1"), clue(1, "다른답")));
    await assertSucceeds(setDoc(doc(db, "clues", "p002_0"), clue(0, "답0"))); // 같은 답으로 다시 쓰기
    await assertSucceeds(setDoc(doc(db, "clues", "p002_2"), clue(2, "새답2"))); // 아직 안 공개된 칸
    // 프로필 저장(6칸 한꺼번에): 공개된 칸이 같으면 통과, 하나라도 바꾸면 통째로 거부
    const ok = writeBatch(db);
    [0, 1, 2, 3, 4, 5].forEach((i) => ok.set(doc(db, "clues", `p002_${i}`), clue(i, i < 2 ? `답${i}` : `고친답${i}`)));
    await assertSucceeds(ok.commit());
    const bad = writeBatch(db);
    [0, 1, 2, 3, 4, 5].forEach((i) => bad.set(doc(db, "clues", `p002_${i}`), clue(i, `몰래바꾼답${i}`)));
    await assertFails(bad.commit());
    // 늦게 쓰는 경우: 공개된 칸이 비어 있었으면 새로 쓸 수 있다
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "clues", "p002_1")));
    await assertSucceeds(setDoc(doc(db, "clues", "p002_1"), clue(1, "늦은답")));
    const snap = await assertSucceeds(getDoc(doc(p("p002"), "clues", "p002_1")));
    if (snap.data().answer !== "늦은답") throw new Error("늦게 쓴 답이 안 보임");
    // 다음 주 공개(2 → 4) 뒤에는 2·3번 칸도 잠긴다
    await setPhase(1, { cluesReleased: 4 });
    await assertFails(setDoc(doc(db, "clues", "p002_2"), clue(2, "또바꿈")));
    await assertSucceeds(setDoc(doc(db, "clues", "p002_4"), clue(4, "아직됨")));
  });

  test("파트 단서(6번): 최종 지목 단계부터 받는 사람만 읽고, 참여자는 쓸 수 없다", async () => {
    const hint = { receiverPid: "p002", idx: 6, answer: "나파트", ver: 0 };
    await assertFails(getDoc(doc(p("p002"), "clues", "p002_6"))); // 1단계: 아직 잠김
    await setPhase(1, { cluesReleased: 6 });
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

  test("단서 답은 1~60자 글자만", async () => {
    const db = p("p001");
    await assertFails(setDoc(doc(db, "clues", "p002_3"), { receiverPid: "p002", idx: 3, answer: "", ver: 0 }));
    await assertFails(setDoc(doc(db, "clues", "p002_3"), { receiverPid: "p002", idx: 3, answer: "가".repeat(61), ver: 0 }));
    await assertFails(setDoc(doc(db, "clues", "p002_3"), { receiverPid: "p002", idx: 3, answer: 123, ver: 0 }));
    await assertSucceeds(setDoc(doc(db, "clues", "p002_3"), { receiverPid: "p002", idx: 3, answer: "가".repeat(60), ver: 0 }));
  });

  test("다시 배정하면(회차 +1) 지난 회차 단서는 안 보이고, 새 마니또가 지금 회차로 다시 쓰면 보인다", async () => {
    // p002의 단서(회차 0)는 p001이 썼다. 운영자가 다시 배정해서 p002의 마니또가 p003이 됐다고 하자.
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await updateDoc(doc(db, "config", "app"), { assignVer: 1 });
      await setDoc(doc(db, "assignments", "p003"), { receiverPid: "p002" });
      await setDoc(doc(db, "assignments", "p001"), { receiverPid: "p004" });
    });
    await assertFails(getDoc(doc(p("p002"), "clues", "p002_0"))); // 예전 마니또(p001)의 답 → 안 보임
    await assertFails(setDoc(doc(p("p001"), "clues", "p002_0"), { receiverPid: "p002", idx: 0, answer: "옛답", ver: 1 })); // 예전 마니또는 더 못 씀
    await assertFails(setDoc(doc(p("p003"), "clues", "p002_0"), { receiverPid: "p002", idx: 0, answer: "새답", ver: 0 })); // 지난 회차로는 못 씀
    await assertSucceeds(setDoc(doc(p("p003"), "clues", "p002_0"), { receiverPid: "p002", idx: 0, answer: "새답", ver: 1 }));
    const snap = await assertSucceeds(getDoc(doc(p("p002"), "clues", "p002_0")));
    if (snap.data().answer !== "새답") throw new Error("새 마니또의 답이 아님");
    await assertFails(getDoc(doc(p("p002"), "clues", "p002_1"))); // 아직 안 다시 쓴 칸은 안 보임
  });

  test("배정 전 프로필 저장: syncClues가 내 배정 문서를 읽어도 거부되지 않는다", async () => {
    await env.withSecurityRulesDisabled((ctx) => deleteDoc(doc(ctx.firestore(), "assignments", "p001")));
    const snap = await assertSucceeds(getDoc(doc(p("p001"), "assignments", "p001")));
    if (snap.exists()) throw new Error("배정 문서가 남아 있음");
  });

  test("최근 접속 남기기 (App.jsx), 내 미션 화면의 받은 미션·내 인증 조회 (MyMission.jsx)", async () => {
    const db = p("p002");
    await assertSucceeds(setDoc(doc(db, "progress", "p002"), { lastSeen: serverTimestamp() }, { merge: true }));
    await assertFails(setDoc(doc(db, "progress", "p001"), { lastSeen: serverTimestamp() }, { merge: true })); // 남의 것
    await assertSucceeds(getDocs(query(collection(db, "deliveries"), where("receiverPid", "==", "p002"))));
    await assertSucceeds(getDocs(query(collection(db, "redemptions"), where("receiverPid", "==", "p002"))));
  });

  test("내 미션 화면 읽기 (MyMission.jsx): 내 코드의 인증(없어도), 그 인증의 피드 글(감사 답장), 신고·확인 결과", async () => {
    const db = p("p001");
    await assertSucceeds(getDoc(doc(db, "giverMissions", "p001")));
    await assertSucceeds(getDoc(doc(db, "progress", "p001")));
    await assertSucceeds(getDoc(doc(db, "nudges", "p002")));
    const none = await assertSucceeds(getDoc(doc(db, "redemptions", "A1A1"))); // 아직 인증 전(문서 없음)
    if (none.exists()) throw new Error("인증 문서가 있음");
    await assertSucceeds(getDoc(doc(db, "reports", "p002_1"))); // 내 대상이 "받은 게 없어요"로 신고했는지(없어도 읽힘)
    await assertSucceeds(getDoc(doc(db, "verdicts", "p002_1")));
    // p002(마니또): 대상 p003이 인증한 B1B1 → 피드 글에서 감사 답장을 읽는다
    const mine = await assertSucceeds(getDoc(doc(p("p002"), "redemptions", "B1B1")));
    await assertSucceeds(getDoc(doc(p("p002"), "feed", mine.data().feedId)));
  });

  test("미션 완료 알리기 (MyMission.jsx complete), 쪽지 더 보내기 (MyMission.jsx sendNote)", async () => {
    const db = p("p001");
    await assertSucceeds(setDoc(doc(db, "giverMissions", "p001"), { choices: { 1: { cardId: "n1", level: "normal", text: "간식" } } }, { merge: true }));
    const note = { receiverPid: "p002", slot: 1, kind: "note", message: "둘째 날 응원이에요", code: null, createdAt: serverTimestamp() };
    await assertFails(addDoc(collection(db, "deliveries"), note)); // 완료를 알리기 전에는 추가 쪽지를 못 보낸다
    await assertSucceeds(addDoc(collection(db, "deliveries"), {
      receiverPid: "p002", slot: 1, kind: "mission", message: "", code: null, createdAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(db, "giverMissions", "p001"), { done: { 1: true } }, { merge: true }));
    await assertSucceeds(setDoc(doc(db, "progress", "p001"), { doneCount: 1 }, { merge: true }));
    await assertFails(setDoc(doc(db, "progress", "p001"), { doneCount: 2 }, { merge: true })); // 열린 주차(1)보다 많이
    await assertFails(setDoc(doc(db, "progress", "p001"), { doneCount: 4 }, { merge: true }));
    // 완료한 주차에 쪽지 더 보내기(3일 연속 쪽지 카드): 쪽지 + 보낸 횟수
    await assertSucceeds(addDoc(collection(db, "deliveries"), note));
    await assertSucceeds(setDoc(doc(db, "giverMissions", "p001"), { notes: { 1: increment(1) } }, { merge: true }));
    await assertFails(addDoc(collection(db, "deliveries"), { ...note, message: "" })); // 빈 쪽지
    await assertFails(addDoc(collection(db, "deliveries"), { ...note, slot: 2 })); // 완료하지 않은(열리지 않은) 주차
    // 받는 사람은 추가 쪽지도 받는다
    const inbox = await assertSucceeds(getDocs(query(collection(p("p002"), "deliveries"), where("receiverPid", "==", "p002"))));
    if (!inbox.docs.some((d) => d.data().kind === "note")) throw new Error("추가 쪽지가 안 보임");
  });

  test("칭찬 카드 보내기 (MyMission.jsx complete, 3주차)", async () => {
    await setPhase(1, { week: 3 });
    const db = p("p001");
    await assertSucceeds(addDoc(collection(db, "deliveries"), {
      receiverPid: "p002", slot: 3, kind: "praise", message: "올해 정말 고마웠어요", code: "A3A3", createdAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(db, "giverMissions", "p001"), {
      done: { 3: true }, choices: { 3: { cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" } },
    }, { merge: true }));
    await assertSucceeds(setDoc(doc(db, "progress", "p001"), { doneCount: 1 }, { merge: true }));
  });

  test("칭찬 카드: 받는 사람이 먼저 인증한 뒤에 완료 표시가 들어가도 거부되지 않는다", async () => {
    await setPhase(1, { week: 3 });
    await put("redemptions/A3A3", { receiverPid: "p002", slot: 3, review: review20, voided: false, feedId: feedIdOf("A3A3") });
    await assertSucceeds(setDoc(doc(p("p001"), "giverMissions", "p001"), {
      done: { 3: true }, choices: { 3: { cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" } },
    }, { merge: true }));
  });

  test("쪽지는 내 대상에게만, 미션 진행 단계에만, 열린 주차까지만, 종류에 맞는 주차로만", async () => {
    const msg = { slot: 1, kind: "mission", message: "", code: null, createdAt: serverTimestamp() };
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p003" }));
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002", message: "가".repeat(501) }));
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002", slot: 2 })); // 1주차인데 2주차 완료 알림
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002", slot: 3, kind: "praise", message: "미리 보내는 칭찬 카드" }));
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002", slot: 0 }));
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002", slot: "1" }));
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002", kind: "praise" })); // 1주차에 칭찬 카드
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002", kind: "공지" }));
    await setPhase(1, { week: 3 });
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002", slot: 3 })); // 3주차는 칭찬 카드만
    await assertSucceeds(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002", slot: 2 }));
    await setPhase(2, { week: 3 });
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002" }));
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
    await assertSucceeds(updateDoc(doc(db, "users", "u2"), { eliminated: arrayUnion("p003") }));
    await assertSucceeds(updateDoc(doc(db, "users", "u2"), { eliminated: arrayRemove("p003") }));
  });

  test("받은 게 없어요 신고 (Detective.jsx Inbox): 내 것만, 열린 주차만, 취소 가능, 확인 결과는 읽기만", async () => {
    const db = p("p002");
    const report = (slot) => ({ receiverPid: "p002", slot, createdAt: serverTimestamp() });
    await assertSucceeds(getDoc(doc(db, "reports", "p002_1"))); // 없는 문서도 읽힌다
    await assertSucceeds(getDoc(doc(db, "verdicts", "p002_1")));
    await assertFails(setDoc(doc(db, "reports", "p002_2"), report(2))); // 아직 안 열린 주차
    await assertFails(setDoc(doc(db, "reports", "p003_1"), { ...report(1), receiverPid: "p003" })); // 남의 이름으로
    await assertFails(setDoc(doc(db, "reports", "p003_1"), report(1)));
    await assertFails(setDoc(doc(db, "reports", "p002_1"), { ...report(1), verdict: "missing" })); // 확인 결과를 스스로 적기
    await assertSucceeds(setDoc(doc(db, "reports", "p002_1"), report(1)));
    await assertFails(setDoc(doc(db, "verdicts", "p002_1"), { receiverPid: "p002", slot: 1, verdict: "missing" })); // 참여자는 확인 결과를 못 쓴다
    await assertFails(setDoc(doc(p("p001"), "verdicts", "p002_1"), { receiverPid: "p002", slot: 1, verdict: "received" })); // 마니또도
    await assertFails(deleteDoc(doc(p("p001"), "reports", "p002_1"))); // 마니또가 신고를 지울 수 없다
    await assertSucceeds(deleteDoc(doc(db, "reports", "p002_1"))); // 신고 취소
    // 미션 마감 뒤(최종 지목·투표 단계)에도 신고할 수 있고, 집계 단계부터는 못 한다
    await setPhase(3, { week: 3 });
    await assertSucceeds(setDoc(doc(db, "reports", "p002_3"), report(3)));
    await setPhase(4, { week: 3 });
    await assertFails(setDoc(doc(db, "reports", "p002_2"), report(2)));
    await assertFails(deleteDoc(doc(db, "reports", "p002_3")));
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

  test("최종 지목 (Detective.jsx submitGuess): 2단계에만, 자기 자신은 거부", async () => {
    const db = p("p002");
    await assertFails(setDoc(doc(db, "guesses", "p002"), { guessPid: "p001", createdAt: serverTimestamp() }));
    await setPhase(2);
    await assertSucceeds(setDoc(doc(db, "guesses", "p002"), { guessPid: "p001", createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(db, "progress", "p002"), { guessed: true }, { merge: true }));
    await assertSucceeds(setDoc(doc(db, "guesses", "p002"), { guessPid: "p004", createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "guesses", "p002"), { guessPid: "p002", createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "guesses", "p001"), { guessPid: "p004", createdAt: serverTimestamp() }));
  });

  test("투표 (Vote.jsx): 3단계에만, 3장까지", async () => {
    await put("voteCards/c1", { reviews: [review20], part: "나파트" });
    const db = p("p001");
    await assertFails(getDocs(collection(db, "voteCards")));
    await setPhase(3);
    await assertSucceeds(getDocs(collection(db, "voteCards")));
    await assertSucceeds(getDoc(doc(db, "votes", "p001")));
    await assertSucceeds(setDoc(doc(db, "votes", "p001"), { cardIds: ["c1"], createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "votes", "p001"), { cardIds: ["a", "b", "c", "d"], createdAt: serverTimestamp() }));
    await assertFails(getDocs(collection(db, "cardOwners")));
    await setPhase(4);
    await assertFails(setDoc(doc(db, "votes", "p001"), { cardIds: ["c1"], createdAt: serverTimestamp() }));
  });

  test("결과는 5단계부터 참여자에게 보인다 (Reveal.jsx)", async () => {
    await put("results/public", { pairs: [], draws: {} });
    await setPhase(4);
    await assertFails(getDoc(doc(p("p001"), "results", "public")));
    await setPhase(5);
    await assertSucceeds(getDoc(doc(p("p001"), "results", "public")));
    await assertFails(updateDoc(doc(p("p001"), "results", "public"), { "draws.t4": ["p001"] }));
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

  test("투표 단계: 투표 카드 만들기·운영진 평가 (Admin.jsx VotingAdmin)", async () => {
    await seed({ phase: 3 });
    const db = admin();
    await assertSucceeds(getDocs(collection(db, "giverCodes")));
    await assertSucceeds(getDocs(collection(db, "redemptions")));
    await assertSucceeds(getDocs(collection(db, "roster"))); // 수상 대상이 아닌 마니또는 카드를 만들지 않는다
    await assertSucceeds(getDocs(collection(db, "voteCards")));
    await assertSucceeds(getDocs(collection(db, "adminEval")));
    const b = writeBatch(db);
    b.set(doc(db, "voteCards", "c1"), { reviews: [review20], part: "가파트" });
    b.set(doc(db, "cardOwners", "c1"), { giverPid: "p001" });
    await assertSucceeds(b.commit());
    const del = writeBatch(db);
    del.delete(doc(db, "voteCards", "c1"));
    del.delete(doc(db, "cardOwners", "c1"));
    await assertSucceeds(del.commit());
    await assertSucceeds(setDoc(doc(db, "adminEval", "c1"), { score: 7 }));
  });

  test("집계 단계: 전부 읽고 결과 쓰기 (Admin.jsx Scoring)", async () => {
    await seed({ phase: 4 });
    const db = admin();
    for (const name of ["assignments", "giverCodes", "redemptions", "giverMissions", "guesses", "votes", "cardOwners", "adminEval", "deliveries", "verdicts", "reports"]) {
      await assertSucceeds(getDocs(collection(db, name)), name);
    }
    await assertSucceeds(setDoc(doc(db, "results", "public"), { pairs: [], tickets: {}, draws: {}, computedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db, "results", "public"), { bestReview: { code: "A1A1", review: review20, receiverPid: "p002" } }));
    await assertSucceeds(setDoc(doc(db, "results", "public"), { pairs: [], tickets: { p001: 3 }, draws: {}, computedAt: serverTimestamp() })); // 다시 집계
    // 추첨은 공개 단계에서만: 집계 단계에 추첨 결과를 미리 넣을 수 없다
    await assertFails(updateDoc(doc(db, "results", "public"), { "draws.t4": ["p001"] }));
    await assertFails(setDoc(doc(db, "results", "public"), { pairs: [], tickets: {}, draws: { grand: ["p001"] } }));
  });

  test("공개 단계: 추첨 결과는 한 번 쓰면 덮어쓰거나 지울 수 없고, 결과의 다른 값도 못 바꾼다 (Reveal.jsx draw)", async () => {
    await seed({ phase: 5, results: true });
    const db = admin();
    const ref = doc(db, "results", "public");
    // 화면은 트랜잭션으로 "아직 안 뽑은 칸"인지 확인하고 쓴다
    await assertSucceeds(runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.data().draws?.t4) throw new Error("이미 뽑음");
      tx.update(ref, { "draws.t4": ["p001", "p002"] });
    }));
    await assertFails(updateDoc(ref, { "draws.t4": ["p003"] })); // 다시 뽑아 덮어쓰기
    await assertFails(updateDoc(ref, { "draws.t4": deleteField() }));
    await assertFails(updateDoc(ref, { draws: {} }));
    await assertFails(updateDoc(ref, { draws: { t3: ["p004"] } })); // 통째로 바꿔 앞 추첨을 지우기
    await assertSucceeds(updateDoc(ref, { "draws.t3": ["p003"] })); // 다음 추첨은 된다
    await assertFails(updateDoc(ref, { tickets: { p001: 99 } })); // 응모권 수 바꾸기
    await assertFails(updateDoc(ref, { "draws.grand": ["p001"], tickets: { p001: 1 } })); // 추첨하면서 다른 값도 같이 바꾸기
    await assertFails(setDoc(ref, { pairs: [], tickets: {}, draws: {} })); // 다시 집계(덮어쓰기)
    await assertFails(deleteDoc(ref));
    const snap = await assertSucceeds(getDoc(ref));
    if (JSON.stringify(snap.data().draws) !== JSON.stringify({ t4: ["p001", "p002"], t3: ["p003"] })) throw new Error("추첨 결과가 바뀜");
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
    await assertSucceeds(setDoc(doc(neu, "users", "u9"), { personId: "p001", eliminated: [], email: "right@example.com" }));
    await assertSucceeds(getDoc(doc(neu, "assignments", "p001")));
    await assertSucceeds(getDoc(doc(neu, "profiles", "p001")));
  });

  test("집계 전(3단계)에는 결과를 쓸 수 없다", async () => {
    await seed({ phase: 3 });
    await assertFails(setDoc(doc(admin(), "results", "public"), { pairs: [], draws: {} }));
  });
});
