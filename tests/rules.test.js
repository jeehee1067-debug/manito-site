// firestore.rules 자동 테스트. Firestore 에뮬레이터가 필요하다.
//   npm run test:rules
// (firebase emulators:exec가 에뮬레이터를 띄우고 FIRESTORE_EMULATOR_HOST를 넘겨 준다. Java 21 이상 필요)
//
// 두 종류를 확인한다.
//   1) 막아야 하는 것: 남의 짝 정보·코드·단서·쪽지 읽기, 남의 코드로 인증, 단계 역행, 운영자의 이른 열람, 완료 슬롯 난이도 변경
//   2) 앱이 실제로 쓰는 요청이 거부되지 않는 것: 각 화면이 Firestore에 보내는 값의 모양을 그대로 옮겨 적었다.
//      화면 코드에서 쓰는 값(필드 이름·타입·길이)을 바꾸면 여기 "앱 흐름" 테스트도 같이 고칠 것.
import { after, before, beforeEach, describe, test } from "node:test";
import { readFileSync } from "node:fs";
import {
  assertFails, assertSucceeds, initializeTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc, arrayRemove, arrayUnion, collection, deleteDoc, deleteField, doc, documentId, getDoc, getDocs, increment, limit, orderBy, query,
  serverTimestamp, setDoc, updateDoc, where, writeBatch,
} from "firebase/firestore";

let env;

// 4명 원형 배정: p001 → p002 → p003 → p004 → p001 (맞마니또 없음, 같은 팀 없음)
// 팀: p001·p003 = 1팀, p002·p004 = 2팀. p005는 아직 가입 전(초대 코드 INV005).
const RECEIVER = { p001: "p002", p002: "p003", p003: "p004", p004: "p001" };
const UID = { p001: "u1", p002: "u2", p003: "u3", p004: "u4" };
const TEAM = { p001: 1, p002: 2, p003: 1, p004: 2, p005: 1 };
const CODES = {
  p001: { 1: "A1A1", 2: "A2A2", 3: "A3A3" },
  p002: { 1: "B1B1", 2: "B2B2", 3: "B3B3" },
  p003: { 1: "C1C1", 2: "C2C2", 3: "C3C3" },
  p004: { 1: "D1D1", 2: "D2D2", 3: "D3D3" },
};
const ADMIN = "admin"; // 참여하지 않는 운영자
const review20 = "가".repeat(20);

async function seed({ phase = 1, cluesReleased = 2, admins = [ADMIN], extra } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const b = writeBatch(db);
    b.set(doc(db, "config", "app"), { admins, phase, week: 1, cluesReleased, siteMatched: false, teamExcluded: true });
    for (const pid of ["p001", "p002", "p003", "p004", "p005"]) {
      b.set(doc(db, "roster", pid), { name: pid, loc: "SR3", team: TEAM[pid], uid: UID[pid] || null, disqualified: false });
    }
    b.set(doc(db, "invites", "INV005"), { personId: "p005" });
    b.set(doc(db, "public", "roster"), { people: { p001: { name: "p001", team: 1, loc: "SR3" } } });
    for (const [pid, uid] of Object.entries(UID)) {
      b.set(doc(db, "users", uid), { personId: pid, eliminated: [] });
      b.set(doc(db, "assignments", pid), { receiverPid: RECEIVER[pid] });
      b.set(doc(db, "giverCodes", pid), { codes: CODES[pid] });
      for (const [slot, code] of Object.entries(CODES[pid])) {
        b.set(doc(db, "codes", code), { receiverPid: RECEIVER[pid], slot: Number(slot) });
      }
      b.set(doc(db, "profiles", pid), { answers: ["1", "2", "3", "4", "5", "6"] });
      b.set(doc(db, "progress", pid), { profileDone: true, cluesVer: 0, doneCount: 0 });
    }
    // p001(마니또)이 p002(받는 사람)에게 남긴 단서와 쪽지
    for (let i = 0; i < 6; i++) b.set(doc(db, "clues", `p002_${i}`), { receiverPid: "p002", idx: i, answer: `답${i}`, ver: 0 });
    b.set(doc(db, "voteCards", "c0"), { reviews: [], team: 1 });
    b.set(doc(db, "results", "public"), { pairs: [] });
    b.set(doc(db, "thanks", "B1B1"), { text: "고마워요" });
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
describe("1. 참여자는 남의 assignments·giverCodes·codes·clues·deliveries를 읽을 수 없다", () => {
  beforeEach(() => seed());

  test("assignments: 내 것만 get, 남의 것·목록은 거부", async () => {
    await assertSucceeds(getDoc(doc(p("p001"), "assignments", "p001")));
    await assertFails(getDoc(doc(p("p001"), "assignments", "p002")));
    await assertFails(getDoc(doc(p("p001"), "assignments", "p004"))); // 내 마니또가 누구인지
    await assertFails(getDocs(collection(p("p001"), "assignments")));
  });

  test("giverCodes: 내 것만 get, 남의 것·목록은 거부", async () => {
    await assertSucceeds(getDoc(doc(p("p001"), "giverCodes", "p001")));
    await assertFails(getDoc(doc(p("p001"), "giverCodes", "p004")));
    await assertFails(getDocs(collection(p("p001"), "giverCodes")));
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

  test("profiles·giverMissions·guesses·votes·users: 남의 것은 거부", async () => {
    await assertFails(getDoc(doc(p("p002"), "profiles", "p001")));
    await assertFails(getDoc(doc(p("p002"), "giverMissions", "p001")));
    await assertFails(getDoc(doc(p("p002"), "guesses", "p001")));
    await assertFails(getDoc(doc(p("p002"), "votes", "p001")));
    await assertFails(getDoc(doc(p("p002"), "users", "u1")));
    await assertFails(getDocs(collection(p("p002"), "guesses")));
  });

  test("로그인하지 않으면 아무것도 못 읽는다", async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, "config", "app")));
    await assertFails(getDocs(collection(anon, "roster")));
    await assertFails(getDocs(collection(anon, "redemptions")));
  });

  test("가입만 하고 명단 연결 전인 계정(외부인)은 비밀은 물론 명단·피드·결과도 못 읽는다", async () => {
    const stranger = as("u-new");
    await assertFails(getDoc(doc(stranger, "assignments", "p001")));
    await assertFails(getDoc(doc(stranger, "codes", "A1A1")));
    await assertFails(getDoc(doc(stranger, "clues", "p002_0")));
    await assertFails(getDocs(collection(stranger, "roster")));
    await assertFails(getDoc(doc(stranger, "roster", "p001")));
    await assertFails(getDoc(doc(stranger, "public", "roster")));
    await assertFails(getDocs(collection(stranger, "avatars")));
    await assertFails(getDocs(collection(stranger, "redemptions")));
    await assertFails(getDocs(collection(stranger, "thanks")));
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

// ───────────────────────── 2. 남의 코드로 인증할 수 없다 ─────────────────────────
describe("2. 다른 사람에게 발급된 코드로 redemptions를 만들 수 없다", () => {
  beforeEach(() => seed());
  // 화면 코드(Detective.jsx CodeEntry)가 보내는 값과 같은 모양
  const redemption = (receiverPid, slot, review = review20) =>
    ({ receiverPid, slot, review, voided: false, createdAt: serverTimestamp() });

  test("받는 사람은 자기에게 온 코드로 인증할 수 있다", async () => {
    await assertSucceeds(setDoc(doc(p("p002"), "redemptions", "A1A1"), redemption("p002", 1)));
  });

  test("남에게 온 코드는 거부: 제3자, 코드를 가진 마니또 본인, 받는 사람 이름을 사칭해도", async () => {
    await assertFails(setDoc(doc(p("p003"), "redemptions", "A1A1"), redemption("p003", 1)));
    await assertFails(setDoc(doc(p("p003"), "redemptions", "A1A1"), redemption("p002", 1)));
    await assertFails(setDoc(doc(p("p001"), "redemptions", "A1A1"), redemption("p002", 1)));
    await assertFails(setDoc(doc(p("p001"), "redemptions", "A1A1"), redemption("p001", 1)));
  });

  test("없는 코드는 거부", async () => {
    await assertFails(setDoc(doc(p("p002"), "redemptions", "ZZZZ"), redemption("p002", 1)));
  });

  test("슬롯 위조, voided: true, 후기 19자·501자는 거부 / 20자·500자는 통과", async () => {
    await assertFails(setDoc(doc(p("p002"), "redemptions", "A1A1"), redemption("p002", 2)));
    await assertFails(setDoc(doc(p("p002"), "redemptions", "A1A1"), { ...redemption("p002", 1), voided: true }));
    await assertFails(setDoc(doc(p("p002"), "redemptions", "A1A1"), redemption("p002", 1, "가".repeat(19))));
    await assertFails(setDoc(doc(p("p002"), "redemptions", "A1A1"), redemption("p002", 1, "가".repeat(501))));
    await assertSucceeds(setDoc(doc(p("p002"), "redemptions", "A1A1"), redemption("p002", 1, "가".repeat(500))));
  });

  test("미션 진행 단계(1)가 아니면 거부", async () => {
    for (const phase of [0, 2, 3]) {
      await setPhase(phase);
      await assertFails(setDoc(doc(p("p002"), "redemptions", "A1A1"), redemption("p002", 1)));
    }
  });

  test("한 번 인증한 것은 받는 사람이 고치거나 지울 수 없다", async () => {
    await assertSucceeds(setDoc(doc(p("p002"), "redemptions", "A1A1"), redemption("p002", 1)));
    await assertFails(setDoc(doc(p("p002"), "redemptions", "A1A1"), redemption("p002", 1, "나".repeat(20))));
    await assertFails(updateDoc(doc(p("p002"), "redemptions", "A1A1"), { voided: true }));
    await assertFails(deleteDoc(doc(p("p002"), "redemptions", "A1A1")));
  });

  test("운영자는 voided만 바꿀 수 있다", async () => {
    await put("redemptions/A1A1", { receiverPid: "p002", slot: 1, review: review20, voided: false });
    await assertSucceeds(updateDoc(doc(admin(), "redemptions", "A1A1"), { voided: true }));
    await assertFails(updateDoc(doc(admin(), "redemptions", "A1A1"), { review: "나".repeat(20) }));
    await assertFails(updateDoc(doc(admin(), "redemptions", "A1A1"), { receiverPid: "p003" }));
  });

  test("감사 답장은 그 코드를 인증한 받는 사람만", async () => {
    await put("redemptions/A1A1", { receiverPid: "p002", slot: 1, review: review20, voided: false });
    await assertFails(setDoc(doc(p("p003"), "thanks", "A1A1"), { text: "고마워요", createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(p("p002"), "thanks", "A2A2"), { text: "고마워요", createdAt: serverTimestamp() })); // 아직 인증 전
    await assertFails(setDoc(doc(p("p002"), "thanks", "A1A1"), { text: "", createdAt: serverTimestamp() }));
    await assertSucceeds(setDoc(doc(p("p002"), "thanks", "A1A1"), { text: "고마워요", createdAt: serverTimestamp() }));
  });
});

// ───────────────────────── 3. 단계는 줄일 수 없다 ─────────────────────────
describe("3. 단계(config.phase)는 줄일 수 없다", () => {
  beforeEach(() => seed({ phase: 2 }));

  test("운영자: 올리기·유지는 가능, 줄이기·지우기·문자로 바꾸기는 거부", async () => {
    await assertSucceeds(updateDoc(doc(admin(), "config", "app"), { phase: 3 }));
    await assertSucceeds(updateDoc(doc(admin(), "config", "app"), { week: 3 }));
    await assertFails(updateDoc(doc(admin(), "config", "app"), { phase: 2 }));
    await assertFails(updateDoc(doc(admin(), "config", "app"), { phase: 0 }));
    await assertFails(updateDoc(doc(admin(), "config", "app"), { phase: deleteField() }));
    await assertFails(updateDoc(doc(admin(), "config", "app"), { phase: "5" }));
  });

  test("참여자는 config를 바꿀 수 없고, 이미 있는 config를 새로 만들어 운영자가 될 수도 없다", async () => {
    await assertFails(updateDoc(doc(p("p001"), "config", "app"), { phase: 3 }));
    await assertFails(updateDoc(doc(p("p001"), "config", "app"), { cluesReleased: 6 }));
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

// ───────────────────────── 4. 운영자도 투표 단계 전에는 짝 정보를 못 읽는다 ─────────────────────────
describe("4. 운영자도 phase 3 전에는 assignments·giverCodes를 읽을 수 없다", () => {
  beforeEach(() => seed({ phase: 0 }));
  const secret = ["assignments", "giverCodes", "codes", "giverMissions", "guesses"];

  test("0·1·2단계: get·목록 모두 거부", async () => {
    for (const phase of [0, 1, 2]) {
      await setPhase(phase);
      for (const name of secret) await assertFails(getDocs(collection(admin(), name)), `${phase}단계 ${name} 목록`);
      await assertFails(getDoc(doc(admin(), "assignments", "p001")));
      await assertFails(getDoc(doc(admin(), "giverCodes", "p001")));
      await assertFails(getDoc(doc(admin(), "codes", "A1A1")));
      await assertFails(getDocs(collection(admin(), "deliveries")));
    }
  });

  test("운영자가 참여자이기도 하면 1단계에서 자기 것만 읽는다", async () => {
    await seed({ phase: 1, admins: [ADMIN, "u1"] });
    await assertSucceeds(getDoc(doc(p("p001"), "assignments", "p001")));
    await assertFails(getDoc(doc(p("p001"), "assignments", "p004")));
    await assertFails(getDocs(collection(p("p001"), "assignments")));
    await assertFails(getDocs(collection(p("p001"), "giverCodes")));
  });

  test("3단계부터 짝 정보 목록을 읽고, 쪽지는 4단계부터", async () => {
    await setPhase(3);
    for (const name of secret) await assertSucceeds(getDocs(collection(admin(), name)));
    await assertFails(getDocs(collection(admin(), "deliveries")));
    await assertFails(getDocs(collection(admin(), "votes")));
    await setPhase(4);
    await assertSucceeds(getDocs(collection(admin(), "deliveries")));
    await assertSucceeds(getDocs(collection(admin(), "votes")));
  });

  test("운영자는 단서·프로필을 읽을 수 없다", async () => {
    await setPhase(1);
    await assertFails(getDoc(doc(admin(), "clues", "p002_0")));
    await assertFails(getDoc(doc(admin(), "profiles", "p001")));
  });

  test("배정은 0단계에서만 쓸 수 있다", async () => {
    await assertSucceeds(setDoc(doc(admin(), "assignments", "p001"), { receiverPid: "p003" }));
    await setPhase(1);
    await assertFails(setDoc(doc(admin(), "assignments", "p001"), { receiverPid: "p002" }));
    await assertFails(setDoc(doc(admin(), "giverCodes", "p001"), { codes: CODES.p001 }));
    await assertFails(setDoc(doc(admin(), "codes", "NEW1"), { receiverPid: "p002", slot: 1 }));
  });
});

// ───────────────────────── 5. 완료한 미션 슬롯의 난이도는 못 바꾼다 ─────────────────────────
describe("5. 완료한 미션 슬롯의 choices 난이도를 바꿀 수 없다", () => {
  const card = (level, id = level[0] + "1") => ({ cardId: id, level, text: `${level} 카드` });
  const mine = () => doc(p("p001"), "giverMissions", "p001");
  beforeEach(() => seed());

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
    await put("redemptions/A1A1", { receiverPid: "p002", slot: 1, review: review20, voided: false });
    await assertFails(setDoc(mine(), { choices: { 1: card("hard") } }, { merge: true }));
    await assertFails(setDoc(mine(), { choices: { 1: null } }, { merge: true }));
    // 늦게라도 완료 표시는 할 수 있다(카드는 그대로)
    await assertSucceeds(setDoc(mine(), { done: { 1: true } }, { merge: true }));
  });

  test("카드를 안 고른 채 코드가 인증된 슬롯에 나중에 도전 카드를 넣을 수 없다", async () => {
    await put("redemptions/A2A2", { receiverPid: "p002", slot: 2, review: review20, voided: false });
    await assertFails(setDoc(mine(), { choices: { 2: card("hard") } }, { merge: true })); // 문서가 없을 때(create)
    await put("giverMissions/p001", { choices: { 1: card("easy") } });
    await assertFails(setDoc(mine(), { choices: { 2: card("hard") } }, { merge: true })); // 문서가 있을 때(update)
  });

  test("3주차 칭찬 슬롯에는 칭찬 카드만 들어간다", async () => {
    await assertFails(setDoc(mine(), { choices: { 3: card("hard") } }, { merge: true }));
    await assertSucceeds(setDoc(mine(), { done: { 3: true }, choices: { 3: { cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" } } }, { merge: true }));
  });

  test("남의 giverMissions는 못 쓴다", async () => {
    await assertFails(setDoc(doc(p("p002"), "giverMissions", "p001"), { choices: { 1: card("hard") } }, { merge: true }));
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
    await assertFails(updateDoc(doc(db, "roster", "p005"), { uid: "u5", inviteUsed: "INV005", team: 2 })); // 다른 필드까지
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

  test("내 미션 화면 읽기 (MyMission.jsx)", async () => {
    const db = p("p001");
    await assertSucceeds(getDoc(doc(db, "giverMissions", "p001")));
    await assertSucceeds(getDoc(doc(db, "progress", "p001")));
    await assertSucceeds(getDoc(doc(db, "nudges", "p002")));
    await assertSucceeds(getDoc(doc(db, "redemptions", "A1A1")));
    await assertSucceeds(getDoc(doc(db, "thanks", "A1A1")));
  });

  test("미션 완료 알리기 (MyMission.jsx complete)", async () => {
    const db = p("p001");
    await assertSucceeds(setDoc(doc(db, "giverMissions", "p001"), { choices: { 1: { cardId: "n1", level: "normal", text: "간식" } } }, { merge: true }));
    await assertSucceeds(addDoc(collection(db, "deliveries"), {
      receiverPid: "p002", slot: 1, kind: "mission", message: "", code: null, createdAt: serverTimestamp(),
    }));
    await assertSucceeds(setDoc(doc(db, "giverMissions", "p001"), { done: { 1: true } }, { merge: true }));
    await assertSucceeds(setDoc(doc(db, "progress", "p001"), { doneCount: 1 }, { merge: true }));
    await assertFails(setDoc(doc(db, "progress", "p001"), { doneCount: 4 }, { merge: true }));
  });

  test("칭찬 카드 보내기 (MyMission.jsx complete, 3주차)", async () => {
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
    await put("redemptions/A3A3", { receiverPid: "p002", slot: 3, review: review20, voided: false });
    await assertSucceeds(setDoc(doc(p("p001"), "giverMissions", "p001"), {
      done: { 3: true }, choices: { 3: { cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" } },
    }, { merge: true }));
  });

  test("쪽지는 내 대상에게만, 미션 진행 단계에만", async () => {
    const msg = { slot: 1, kind: "mission", message: "", code: null, createdAt: serverTimestamp() };
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p003" }));
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002", message: "가".repeat(501) }));
    await setPhase(2);
    await assertFails(addDoc(collection(p("p001"), "deliveries"), { ...msg, receiverPid: "p002" }));
  });

  test("추리 보드 읽기와 후보 지우기 (Detective.jsx)", async () => {
    const db = p("p002");
    await assertSucceeds(getDocs(query(collection(db, "redemptions"), where("receiverPid", "==", "p002"))));
    await assertSucceeds(getDoc(doc(db, "codes", "A1A1")));
    await assertSucceeds(getDoc(doc(db, "redemptions", "A1A1")));
    await assertSucceeds(getDoc(doc(db, "guesses", "p002")));
    await assertSucceeds(updateDoc(doc(db, "users", "u2"), { eliminated: arrayUnion("p003") }));
    await assertSucceeds(updateDoc(doc(db, "users", "u2"), { eliminated: arrayRemove("p003") }));
  });

  test("미공개 단서를 읽으면 거부되고, 화면은 '아직 안 채움'으로 처리한다 (Detective.jsx Clues)", async () => {
    await assertFails(getDoc(doc(p("p003"), "clues", "p003_0"))); // 문서가 없을 때도 거부(화면은 catch로 처리)
  });

  test("피드와 우리 팀, 명단 요약·캐릭터 (Feed.jsx, Team.jsx, App.jsx, ui.jsx Avatar)", async () => {
    const db = p("p001");
    await assertSucceeds(getDocs(query(collection(db, "redemptions"), orderBy("createdAt", "desc"), limit(30))));
    await assertSucceeds(getDocs(query(collection(db, "thanks"), where(documentId(), "in", ["A1A1", "B1B1"]))));
    await assertSucceeds(getDoc(doc(db, "public", "roster")));
    await assertSucceeds(getDoc(doc(db, "avatars", "p003")));
    await assertSucceeds(getDoc(doc(db, "config", "app")));
    await assertSucceeds(getDoc(doc(db, "users", "u1")));
    await assertSucceeds(getDoc(doc(db, "progress", "p003"))); // 같은 1팀
    await assertFails(getDoc(doc(db, "progress", "p002"))); // 다른 팀
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
    await put("voteCards/c1", { reviews: [review20], team: 2 });
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
    await put("results/public", { pairs: [] });
    await setPhase(4);
    await assertFails(getDoc(doc(p("p001"), "results", "public")));
    await setPhase(5);
    await assertSucceeds(getDoc(doc(p("p001"), "results", "public")));
    await assertFails(updateDoc(doc(p("p001"), "results", "public"), { "draws.t4": ["p001"] }));
  });
});

describe("앱 흐름: 운영 화면", () => {
  test("준비 단계: 명단·초대 코드·근무지·팀·배정·명단 요약 (Admin.jsx Setup)", async () => {
    await seed({ phase: 0 });
    const db = admin();
    await assertSucceeds(getDocs(collection(db, "roster")));
    await assertSucceeds(setDoc(doc(db, "public", "roster"), { people: { p001: { name: "가", team: 1, loc: "SR3" } }, at: serverTimestamp() }));
    await assertSucceeds(getDocs(collection(db, "invites")));
    const add = writeBatch(db);
    add.set(doc(db, "roster", "p006"), { name: "새사람", loc: "S1L", team: null, uid: null, disqualified: false });
    add.set(doc(db, "invites", "INV006"), { personId: "p006" });
    await assertSucceeds(add.commit());
    await assertSucceeds(updateDoc(doc(db, "roster", "p006"), { loc: "SR3" }));
    await assertSucceeds(updateDoc(doc(db, "roster", "p006"), { team: 2 }));
    await assertSucceeds(deleteDoc(doc(db, "roster", "p006")));
    await assertSucceeds(deleteDoc(doc(db, "invites", "INV006")));

    // 재배정: 이전 코드·배정 지우고 새로 쓰기, 메모, 근무지 모드 값
    const meta = await assertSucceeds(getDoc(doc(db, "meta", "assignment")));
    const b = writeBatch(db);
    meta.data().codes.forEach((c) => b.delete(doc(db, "codes", c)));
    meta.data().pids.forEach((pid) => { b.delete(doc(db, "assignments", pid)); b.delete(doc(db, "giverCodes", pid)); });
    b.set(doc(db, "assignments", "p001"), { receiverPid: "p003" });
    b.set(doc(db, "giverCodes", "p001"), { codes: { 1: "N1N1", 2: "N2N2", 3: "N3N3" } });
    b.set(doc(db, "codes", "N1N1"), { receiverPid: "p003", slot: 1 });
    b.set(doc(db, "meta", "assignment"), { codes: ["N1N1"], pids: ["p001"], at: serverTimestamp() });
    await assertSucceeds(b.commit());
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { siteMatched: false, teamExcluded: true, assignVer: increment(1) }));
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { phase: 1 }));
  });

  test("준비 단계 외에는 명단을 추가·삭제할 수 없다 (수정은 가능: 수상 제외 표시)", async () => {
    await seed({ phase: 1 });
    const db = admin();
    await assertFails(setDoc(doc(db, "roster", "p006"), { name: "x", loc: "SR3", team: 1, uid: null, disqualified: false }));
    await assertFails(deleteDoc(doc(db, "roster", "p005")));
    await assertSucceeds(updateDoc(doc(db, "roster", "p001"), { disqualified: true }));
    await assertSucceeds(setDoc(doc(db, "public", "roster"), { people: {}, at: serverTimestamp() })); // 시작 후에도 요약 갱신 가능
  });

  test("참여자는 명단·명단 요약·초대·알림·배정을 못 만진다", async () => {
    await seed({ phase: 0 });
    const db = p("p001");
    await assertFails(setDoc(doc(db, "public", "roster"), { people: {} }));
    await assertFails(setDoc(doc(db, "roster", "p009"), { name: "x", loc: "SR3", team: 1, uid: null, disqualified: false }));
    await assertFails(updateDoc(doc(db, "roster", "p002"), { team: 1 }));
    await assertFails(setDoc(doc(db, "invites", "XXXXXX"), { personId: "p001" }));
    await assertFails(setDoc(doc(db, "nudges", "p002"), { at: serverTimestamp() }));
    await assertFails(setDoc(doc(db, "assignments", "p001"), { receiverPid: "p003" }));
    await assertFails(getDoc(doc(db, "meta", "assignment")));
  });

  test("미션 진행: 현황·인증 목록·알림·주차·단서 공개·인증 무효 (Admin.jsx Running, Moderation)", async () => {
    await seed({ phase: 1 });
    await put("redemptions/A1A1", { receiverPid: "p002", slot: 1, review: review20, voided: false });
    const db = admin();
    await assertSucceeds(getDocs(collection(db, "progress")));
    await assertSucceeds(getDocs(collection(db, "redemptions")));
    await assertSucceeds(getDocs(collection(db, "nudges")));
    await assertSucceeds(setDoc(doc(db, "nudges", "p002"), { at: serverTimestamp() }));
    await assertSucceeds(deleteDoc(doc(db, "nudges", "p002")));
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { week: 2 }));
    await assertSucceeds(updateDoc(doc(db, "config", "app"), { cluesReleased: 4 }));
    await assertSucceeds(updateDoc(doc(db, "redemptions", "A1A1"), { voided: true }));
    await assertSucceeds(updateDoc(doc(db, "redemptions", "A1A1"), { voided: false }));
    await assertSucceeds(updateDoc(doc(db, "roster", "p001"), { disqualified: true }));
  });

  test("투표 단계: 투표 카드 만들기·운영진 평가 (Admin.jsx VotingAdmin)", async () => {
    await seed({ phase: 3 });
    const db = admin();
    await assertSucceeds(getDocs(collection(db, "giverCodes")));
    await assertSucceeds(getDocs(collection(db, "redemptions")));
    await assertSucceeds(getDocs(collection(db, "voteCards")));
    await assertSucceeds(getDocs(collection(db, "adminEval")));
    const b = writeBatch(db);
    b.set(doc(db, "voteCards", "c1"), { reviews: [review20], team: 1 });
    b.set(doc(db, "cardOwners", "c1"), { giverPid: "p001" });
    await assertSucceeds(b.commit());
    const del = writeBatch(db);
    del.delete(doc(db, "voteCards", "c1"));
    del.delete(doc(db, "cardOwners", "c1"));
    await assertSucceeds(del.commit());
    await assertSucceeds(setDoc(doc(db, "adminEval", "c1"), { score: 7 }));
  });

  test("집계 단계: 전부 읽고 결과 쓰기, 공개 단계: 추첨 (Admin.jsx Scoring, Reveal.jsx draw)", async () => {
    await seed({ phase: 4 });
    const db = admin();
    for (const name of ["assignments", "giverCodes", "redemptions", "giverMissions", "guesses", "votes", "cardOwners", "adminEval", "deliveries"]) {
      await assertSucceeds(getDocs(collection(db, name)), name);
    }
    await assertSucceeds(setDoc(doc(db, "results", "public"), { pairs: [], tickets: {}, draws: {}, computedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(db, "results", "public"), { bestReview: { code: "A1A1", review: review20, receiverPid: "p002" } }));
    await setPhase(5);
    await assertSucceeds(updateDoc(doc(db, "results", "public"), { "draws.t4": ["p001"] }));
  });

  test("최종 지목 단계: 지목 여부 현황(진행 상황 목록)은 읽고, 지목 내용은 못 읽는다 (Admin.jsx GuessStatus)", async () => {
    await seed({ phase: 2 });
    await assertSucceeds(getDocs(collection(admin(), "progress")));
    await assertSucceeds(getDocs(collection(admin(), "roster")));
    await assertFails(getDocs(collection(admin(), "guesses")));
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
    await assertFails(setDoc(doc(admin(), "results", "public"), { pairs: [] }));
  });
});
