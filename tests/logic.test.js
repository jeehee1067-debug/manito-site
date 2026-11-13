import test from "node:test";
import assert from "node:assert/strict";
import { assignManito, assignmentMemo, generateCodes } from "../src/lib/assign.js";
import { computeTickets, weightedDraw, pickMostTickets, rankBestManito, tallyVotes, partStandings, weeklyPartBoard } from "../src/lib/scoring.js";
import { seededRandom } from "../src/lib/random.js";
import { parseRosterLine, rosterSummary, summaryToList, sameSummary } from "../src/lib/roster.js";
import { MISSION_CARDS, PROFILE_QUESTIONS, CLUE_COUNT, profileAnswerError } from "../src/lib/constants.js";
import { pairRows, receiverCodesOf, sameCodes, unresolvedSlots } from "../src/lib/pairs.js";

// 참여자 54명(부서 56명 중 운영자·PL님 제외). 파트 크기를 주면 { pid, part } 목록을 만든다.
const pids = Array.from({ length: 54 }, (_, i) => `p${String(i + 1).padStart(3, "0")}`);
const withParts = (sizes, names = ["가파트", "나파트", "다파트", "라파트"]) => {
  const parts = sizes.flatMap((n, g) => Array(n).fill(names[g]));
  return pids.slice(0, parts.length).map((pid, i) => ({ pid, part: parts[i] }));
};

function checkPairs(people, r) {
  const byPid = Object.fromEntries(people.map((p) => [p.pid, p]));
  const map = Object.fromEntries(r.pairs.map((p) => [p.giverPid, p.receiverPid]));
  assert.equal(new Set(r.pairs.map((p) => p.giverPid)).size, people.length, "모두 한 명씩 맡음");
  assert.equal(new Set(r.pairs.map((p) => p.receiverPid)).size, people.length, "모두 한 명씩 받음");
  for (const { giverPid, receiverPid } of r.pairs) {
    assert.notEqual(giverPid, receiverPid);
    assert.notEqual(map[receiverPid], giverPid, "맞마니또");
    if (r.siteMatched) assert.equal(byPid[giverPid].loc, byPid[receiverPid].loc, "같은 근무지");
    if (r.partExcluded && byPid[giverPid].part != null) assert.notEqual(byPid[giverPid].part, byPid[receiverPid].part, "같은 파트");
  }
  return map;
}
const oneCycle = (people, map) => {
  let cur = people[0].pid;
  const seen = new Set();
  while (!seen.has(cur)) { seen.add(cur); cur = map[cur]; }
  return seen.size === people.length;
};

test("원형 배정: 전원 1명씩 주고받고, 자기 자신·같은 파트·맞마니또 없음 (파트 크기 여러 가지)", () => {
  for (const sizes of [[18, 18, 18], [20, 17, 12, 5], [27, 15, 12], [27, 27], [25, 25, 4], [1, 1, 1], [2, 2]]) {
    for (let k = 0; k < 10; k++) {
      const people = withParts(sizes);
      const r = assignManito(people, { rand: seededRandom(sizes.join("-") + k) });
      assert.equal(r.partExcluded, true, sizes.join("/"));
      assert.deepEqual(r.warnings, []);
      const map = checkPairs(people, r);
      if (people.length >= 3) assert.ok(oneCycle(people, map), "하나의 원");
    }
  }
});

test("한 파트가 절반을 넘으면 같은 파트 짝을 되도록 적게 만들고 경고한다", () => {
  const people = withParts([30, 14, 10]);
  const part = Object.fromEntries(people.map((p) => [p.pid, p.part]));
  for (let k = 0; k < 10; k++) {
    const r = assignManito(people, { rand: seededRandom("big" + k) });
    assert.equal(r.partExcluded, false);
    assert.ok(r.warnings.length > 0);
    checkPairs(people, r);
    // 30명 파트 사이에 끼울 다른 파트가 24명뿐이라 같은 파트 짝은 최소 6쌍
    assert.equal(r.pairs.filter((p) => part[p.giverPid] === part[p.receiverPid]).length, 6);
  }
});

test("파트가 비어 있는 사람은 누구와도 짝이 되고, 파트가 있는 사람끼리는 여전히 같은 파트를 피한다", () => {
  const people = [...withParts([10, 10]), ...pids.slice(20, 28).map((pid) => ({ pid, part: null }))];
  for (let k = 0; k < 10; k++) {
    const r = assignManito(people, { rand: seededRandom("null" + k) });
    assert.equal(r.partExcluded, true);
    checkPairs(people, r);
  }
  const none = pids.map((pid) => ({ pid, part: null }));
  checkPairs(none, assignManito(none, { rand: seededRandom("none") }));
});

test("배정이 고르게 섞인다: 한 사람의 대상이 다른 파트 전원에게 퍼지고 두 파트로 반반", () => {
  const people = withParts([18, 18, 18]);
  const rand = seededRandom("mix");
  const cnt = {};
  const N = 1500;
  for (let t = 0; t < N; t++) {
    const r = assignManito(people, { rand }).pairs.find((p) => p.giverPid === "p001").receiverPid;
    cnt[r] = (cnt[r] || 0) + 1;
  }
  assert.equal(Object.keys(cnt).length, 36, "다른 파트 36명 모두 대상이 될 수 있다");
  const toB = people.filter((p) => p.part === "나파트").reduce((a, p) => a + (cnt[p.pid] || 0), 0);
  assert.ok(toB / N > 0.42 && toB / N < 0.58, `나파트로 간 비율 ${toB / N}`);
  assert.ok(Math.max(...Object.values(cnt)) < (N / 36) * 2, "특정 사람에게 몰리지 않는다");
});

test("기본 배정(근무지 상관없음): 다른 근무지끼리도 짝이 되고, 같은 파트·맞마니또는 없음", () => {
  let cross = 0;
  for (let k = 0; k < 10; k++) {
    const people = withParts([18, 18, 18]).map((p, i) => ({ ...p, loc: i % 2 ? "SR3" : "S1L" }));
    const r = assignManito(people, { rand: seededRandom("any" + k) });
    assert.equal(r.siteMatched, false);
    assert.equal(r.partExcluded, true);
    checkPairs(people, r);
    const loc = Object.fromEntries(people.map((p) => [p.pid, p.loc]));
    cross += r.pairs.filter((p) => loc[p.giverPid] !== loc[p.receiverPid]).length;
  }
  assert.ok(cross > 0, "다른 근무지 짝이 실제로 생긴다");
});

test("같은 근무지 모드: 54명 SR3/S1L 모든 비율(3~51명)에서 같은 근무지·다른 파트로 짝지어짐", () => {
  for (let sr3 = 3; sr3 <= 51; sr3++) {
    // 파트 4개를 번갈아 넣어 어느 근무지에서도 한 파트가 절반을 넘지 않게 한다
    const people = pids.map((pid, i) => ({ pid, part: ["가파트", "나파트", "다파트", "라파트"][i % 4], loc: i < sr3 ? "SR3" : "S1L" }));
    const r = assignManito(people, { siteMode: "same", rand: seededRandom("loc" + sr3) });
    assert.equal(r.siteMatched, true, `SR3 ${sr3}명`);
    assert.equal(r.partExcluded, true, `SR3 ${sr3}명`);
    checkPairs(people, r);
  }
});

test("같은 근무지 모드: 3명 미만 근무지는 큰 근무지 원에 합치고 경고", () => {
  const people = withParts([18, 18, 18]).map((p, i) => ({ ...p, loc: i < 52 ? "SR3" : "S1L" }));
  const r = assignManito(people, { siteMode: "same", rand: seededRandom("small") });
  assert.equal(r.siteMatched, false);
  assert.ok(r.warnings.some((w) => w.includes("S1L")));
  checkPairs(people, r);
});

test("한 근무지가 전부 같은 파트이면 그 근무지만 같은 파트 짝을 허용하고 경고", () => {
  const people = [
    ...["a", "b", "c", "d"].map((pid) => ({ pid, part: "가파트", loc: "S1L" })),
    ...["e", "f", "g", "h", "i"].map((pid, i) => ({ pid, part: ["나파트", "다파트", "라파트"][i % 3], loc: "SR3" })),
  ];
  const r = assignManito(people, { siteMode: "same", rand: seededRandom("samepart") });
  assert.equal(r.siteMatched, true);
  assert.equal(r.partExcluded, false);
  assert.ok(r.warnings.length > 0);
  checkPairs(people, r);
});

test("같은 근무지 모드에서 근무지가 비어 있으면 배정을 막는다", () => {
  assert.throws(() => assignManito([{ pid: "a", loc: "SR3" }, { pid: "b", loc: null }, { pid: "c", loc: "SR3" }], { siteMode: "same" }));
});

test("코드는 전체에서 중복이 없다", () => {
  const codes = generateCodes(pids, seededRandom("c"));
  const all = Object.values(codes).flatMap((c) => Object.values(c));
  assert.equal(all.length, 162);
  assert.equal(new Set(all).size, 162);
  assert.ok(all.every((c) => /^[2-9A-HJ-NP-Z]{4}$/.test(c)));
});

test("재배정 메모(meta/assignment)는 정렬돼 있어 배정 순서를 드러내지 않는다", () => {
  const rand = seededRandom("memo");
  const { pairs } = assignManito(withParts([18, 18, 18]), { rand });
  const codes = generateCodes(pairs.map((p) => p.giverPid), rand);
  const memo = assignmentMemo(pairs, codes);
  assert.deepEqual(memo.pids, [...pids].sort());
  const allCodes = Object.values(codes).flatMap((c) => Object.values(c));
  assert.deepEqual(memo.codes, [...allCodes].sort());
  // 배정 순서 그대로였다면 pids[i]의 대상이 항상 pids[i+1]이 된다
  const map = Object.fromEntries(pairs.map((p) => [p.giverPid, p.receiverPid]));
  const raw = pairs.map((p) => p.giverPid);
  assert.ok(raw.every((g, i) => map[g] === raw[(i + 1) % raw.length]), "정렬 전 순서는 배정 원 순서");
  assert.ok(!memo.pids.every((g, i) => map[g] === memo.pids[(i + 1) % memo.pids.length]), "저장 순서는 배정 원 순서가 아님");
});

test("응모권 계산: 미션·도전·입력·은신·정답", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const assignments = { A: "B", B: "C", C: "A" };
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const redemptions = {
    A1: { receiverPid: "B", slot: 1, voided: false },
    A2: { receiverPid: "B", slot: 2, voided: false },
    A3: { receiverPid: "B", slot: 3, voided: true },
    B1: { receiverPid: "C", slot: 1, voided: false },
  };
  const missions = { A: { choices: { 1: { level: "hard" }, 2: { level: "easy" } } } };
  const guesses = { B: "A", C: "A" }; // B는 정답(A), C는 오답(실제 B)
  const t = computeTickets({ people, assignments, giverCodes, redemptions, missions, guesses });
  // A: 미션 2(무효 1건 제외) + 도전 1 + 받은 입력 0 + 은신 0(들킴) + 보상 3(C가 3주 모두 안 보냄) = 6
  assert.equal(t.A.total, 6);
  assert.equal(t.A.comp, 3);
  // B: 미션 1 + 받은 입력 2 + 정답 1 + 은신 2(C가 틀림) = 6. 3주차는 무효 처리된 인증이 있어 보상 없음
  assert.equal(t.B.total, 6);
  assert.equal(t.B.comp, 0);
  // C: 미션 0 + 받은 입력 1 = 1. 인증된 미션이 없어 은신 0, 보상도 0
  assert.equal(t.C.total, 1);
  assert.deepEqual([t.C.hidden, t.C.comp], [0, 0]);
});

test("정체를 알려주면 둘의 합계가 1장 줄어든다 (미션이 1건 이상 인증된 마니또)", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const base = {
    people, assignments: { A: "B", B: "C", C: "A" }, giverCodes: { A: { 1: "A1", 2: "A2", 3: "A3" } },
    redemptions: { A1: { receiverPid: "B", slot: 1, voided: false } }, missions: {}, deliveries: [{ receiverPid: "B", slot: 1 }],
  };
  const hidden = computeTickets({ ...base, guesses: {} });
  const leaked = computeTickets({ ...base, guesses: { B: "A" } });
  assert.equal(hidden.A.total, 3); // 미션 1 + 은신 2
  assert.equal(leaked.A.total, 1); // 은신을 잃음
  assert.equal(leaked.A.total + leaked.B.total - (hidden.A.total + hidden.B.total), -1);
});

test("은신 2장은 미션이 1건 이상 인증된 마니또만: 아무것도 안 하면 0장", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const t = computeTickets({
    people, assignments: { A: "B", B: "C", C: "A" }, guesses: {}, missions: {},
    giverCodes: { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } },
    redemptions: { A1: { receiverPid: "B", slot: 1, voided: false } }, deliveries: [{ receiverPid: "B", slot: 1 }],
  });
  assert.deepEqual([t.A.hidden, t.B.hidden, t.C.hidden], [2, 0, 0]);
  assert.equal(t.C.total, 0, "아무것도 안 한 사람은 추첨 대상이 아니다");
  // 미션 0건인 마니또(B)는 잃을 은신이 없어서, 정체를 알려주면 받는 사람(C)만 +1이 된다(합계 −1 구조가 적용되지 않는 경우)
  const leak = computeTickets({
    people, assignments: { A: "B", B: "C", C: "A" }, guesses: { C: "B" }, missions: {},
    giverCodes: { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } },
    redemptions: { A1: { receiverPid: "B", slot: 1, voided: false } }, deliveries: [{ receiverPid: "B", slot: 1 }],
  });
  assert.equal(leak.C.total - t.C.total, 1);
});

test("보상: 마니또가 안 보낸 주차만 1장씩, 인증 입력과 합쳐 최대 3장, 내 미션이 0건이면 없음", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const t = computeTickets({
    people, assignments: { A: "B", B: "C", C: "A" }, giverCodes, guesses: {}, missions: {},
    // A → B: 1주차 보냄(B 인증), 2주차 보냄(B가 인증 안 함), 3주차 안 보냄.  B → C: 1주차만 보냄(C 인증).  C → A: 아무것도 안 보냄
    deliveries: [{ receiverPid: "B", slot: 1 }, { receiverPid: "B", slot: 2 }, { receiverPid: "C", slot: 1 }],
    redemptions: { A1: { receiverPid: "B", slot: 1, voided: false }, B1: { receiverPid: "C", slot: 1, voided: false } },
  });
  // A: 미션 1 + 은신 2 + 보상 3(C가 3주 모두 안 보냄) = 6
  assert.deepEqual([t.A.mission, t.A.hidden, t.A.entries, t.A.comp, t.A.total], [1, 2, 0, 3, 6]);
  // B: 미션 1 + 은신 2 + 입력 1 + 보상 1(3주차만. 2주차는 받았는데 인증을 안 한 것이라 보상 없음) = 5
  assert.deepEqual([t.B.mission, t.B.hidden, t.B.entries, t.B.comp, t.B.total], [1, 2, 1, 1, 5]);
  // C: 입력 1. 내 미션이 0건이라 보상 없음, 은신 없음
  assert.deepEqual([t.C.mission, t.C.hidden, t.C.entries, t.C.comp, t.C.total], [0, 0, 1, 0, 1]);

  // 무효 처리된 인증이 있는 주차는 보상하지 않는다(받기는 받았다)
  const v = computeTickets({
    people, assignments: { A: "B", B: "C", C: "A" }, giverCodes, guesses: {}, missions: {},
    deliveries: [{ receiverPid: "C", slot: 1 }],
    redemptions: { B1: { receiverPid: "C", slot: 1, voided: false }, C1: { receiverPid: "A", slot: 1, voided: true }, A1: { receiverPid: "B", slot: 1, voided: false } },
  });
  // A: 미션 1 + 은신 2 + 보상 2(C의 2·3주차. 1주차는 무효 처리된 인증이 있음) = 5
  assert.deepEqual([v.A.entries, v.A.comp, v.A.total], [0, 2, 5]);
});

test("불참(가입 안 함·중도 이탈)은 0장, 그 사람의 마니또는 완료 알린 미션을 인정받는다", () => {
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const base = {
    assignments: { A: "B", B: "C", C: "A" }, giverCodes, redemptions: {},
    missions: { B: { choices: { 1: { level: "hard" }, 2: { level: "easy" } } } },
    deliveries: [{ receiverPid: "C", slot: 1 }, { receiverPid: "C", slot: 2 }], // B가 C에게 2건 완료 알림
  };
  for (const flag of [{ joined: false }, { joined: true, dropout: true }]) {
    const people = [{ pid: "A", joined: true }, { pid: "B", joined: true }, { pid: "C", ...flag }];
    const t = computeTickets({ ...base, people, guesses: { C: "B" } }); // 불참자의 지목은 세지 않는다
    // B: 인정 2건 → 미션 2 + 은신 2 + 보상 3(A가 3주 모두 안 보냄) = 7. 인정된 미션에는 도전 추가분이 없다(1주차가 도전 카드여도 0)
    assert.deepEqual([t.B.mission, t.B.hard, t.B.assumed, t.B.hidden, t.B.comp, t.B.total], [2, 0, 2, 2, 3, 7]);
    assert.equal(t.C.total, 0);
    assert.equal(t.A.total, 0); // 아무것도 안 함
  }
  // 대상이 참여 중이면 완료 알림만으로는 인정되지 않는다(받는 사람이 인증해야 함)
  const people = ["A", "B", "C"].map((pid) => ({ pid, joined: true }));
  const t = computeTickets({ ...base, people, guesses: {} });
  assert.deepEqual([t.B.mission, t.B.hard, t.B.assumed, t.B.hidden], [0, 0, 0, 0]);
});

test("운영자 확인 '받았음': 인증이 없는 완료 알림을 그 마니또의 미션으로 인정하고, 받는 사람 응모권은 그대로", () => {
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const base = {
    assignments: { A: "B", B: "C", C: "A" }, giverCodes, missions: {}, guesses: {},
    people: ["A", "B", "C"].map((pid) => ({ pid })),
    // B → C: 3건 완료 알림. C는 1주차만 인증했고 2주차 인증은 운영자가 무효 처리, 3주차는 인증 안 함.  C → A: 1건(A 인증)
    deliveries: [{ receiverPid: "C", slot: 1 }, { receiverPid: "C", slot: 2 }, { receiverPid: "C", slot: 3 }, { receiverPid: "A", slot: 1 }],
    redemptions: { B1: { receiverPid: "C", slot: 1, voided: false }, B2: { receiverPid: "C", slot: 2, voided: true }, C1: { receiverPid: "A", slot: 1, voided: false } },
  };
  const plain = computeTickets(base);
  assert.deepEqual([plain.B.mission, plain.B.assumed], [1, 0], "확인이 없으면 인정되지 않는다");
  // 2주차(무효 처리된 인증이 있음)와 3주차를 모두 '받았음'으로 확인해도 3주차만 인정된다
  const marked = computeTickets({ ...base, verdicts: { C_2: "received", C_3: "received" } });
  assert.deepEqual([marked.B.mission, marked.B.assumed, marked.B.hidden], [2, 1, 2]);
  // C 본인: 미션 1 + 은신 2 + 인증 입력 1(무효 제외) 그대로. 받았다고 확인된 주차는 보상도 없다
  assert.deepEqual([marked.C.mission, marked.C.entries, marked.C.comp, marked.C.total], [1, 1, 0, plain.C.total]);
  assert.ok(marked.C.total > 0);
  // 확인은 주차별이다: 다른 주차·다른 사람의 확인은 영향이 없다
  const other = computeTickets({ ...base, verdicts: { C_1: "received", A_3: "received", B_3: "received" } });
  assert.deepEqual([other.B.mission, other.B.assumed], [1, 0]);
});

test("운영자 확인 '못 받음': 그 주차는 마니또가 안 보낸 것으로 보고 받는 사람에게 보상한다", () => {
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const base = {
    assignments: { A: "B", B: "C", C: "A" }, giverCodes, missions: {}, guesses: {},
    people: ["A", "B", "C"].map((pid) => ({ pid })),
    // A → B: 1·2·3주차 모두 완료 알림. B는 1주차만 인증하고 2주차는 "받은 게 없어요"로 신고.  B → C: 1주차(C 인증)
    deliveries: [{ receiverPid: "B", slot: 1 }, { receiverPid: "B", slot: 2 }, { receiverPid: "B", slot: 3 }, { receiverPid: "C", slot: 1 }],
    redemptions: { A1: { receiverPid: "B", slot: 1, voided: false }, B1: { receiverPid: "C", slot: 1, voided: false } },
  };
  const plain = computeTickets(base);
  // 확인 전: A는 1건만, B는 받았는데 인증 안 한 것으로 보여 2·3주차 보상이 없다
  assert.deepEqual([plain.A.mission, plain.B.entries, plain.B.comp], [1, 1, 0]);
  const t = computeTickets({ ...base, verdicts: { B_2: "missing", B_3: "received" } });
  // A: 1주차(인증) + 3주차(받았음 확인) = 2. 2주차는 못 받음이라 인정되지 않는다
  assert.deepEqual([t.A.mission, t.A.assumed], [2, 1]);
  // B: 인증 입력 1 + 보상 1(2주차 못 받음). 3주차는 받았다고 확인됐으니 보상이 없다
  assert.deepEqual([t.B.entries, t.B.comp, t.B.total - plain.B.total], [1, 1, 1]);
  // 보상은 인증 입력과 합쳐 3장까지, 내 미션이 0건이면 없다
  const all = computeTickets({ ...base, verdicts: { B_2: "missing", B_3: "missing" } });
  assert.deepEqual([all.B.entries, all.B.comp], [1, 2]);
  const lazy = computeTickets({ ...base, redemptions: { A1: base.redemptions.A1 }, verdicts: { B_2: "missing" } }); // B의 미션(B1)이 인증되지 않은 경우
  assert.deepEqual([lazy.B.mission, lazy.B.comp], [0, 0]);
  // 받는 사람이 나중에 직접 인증했으면 확인 결과는 쓰지 않는다(인증이 먼저)
  const later = computeTickets({ ...base, redemptions: { ...base.redemptions, A2: { receiverPid: "B", slot: 2, voided: false } }, verdicts: { B_2: "missing" } });
  assert.deepEqual([later.A.mission, later.A.assumed, later.B.entries, later.B.comp], [2, 0, 2, 0]);
  // 불참자에게 보낸 미션은 자동으로 인정되지만, 운영자가 '못 받음'으로 확인했으면 인정하지 않는다
  const people = [{ pid: "A" }, { pid: "B", dropout: true }, { pid: "C" }];
  assert.equal(computeTickets({ ...base, people }).A.mission, 3);
  assert.deepEqual([computeTickets({ ...base, people, verdicts: { B_2: "missing" } }).A.mission], [2]);
});

test("도전 추가분은 받는 사람이 직접 인증한 미션만: 불참·운영자 확인으로 인정된 미션에는 없다", () => {
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const base = {
    assignments: { A: "B", B: "C", C: "A" }, giverCodes, guesses: {},
    people: ["A", "B", "C"].map((pid) => ({ pid })),
    missions: { A: { choices: { 1: { level: "hard" }, 2: { level: "hard" } } } }, // A는 1·2주차 모두 도전 카드
    deliveries: [{ receiverPid: "B", slot: 1 }, { receiverPid: "B", slot: 2 }],
    redemptions: { A1: { receiverPid: "B", slot: 1, voided: false } }, // 1주차만 직접 인증
  };
  const confirmed = computeTickets({ ...base, verdicts: { B_2: "received" } });
  assert.deepEqual([confirmed.A.mission, confirmed.A.hard, confirmed.A.assumed], [2, 1, 1], "확인으로 인정된 2주차에는 도전 추가분이 없다");
  const both = computeTickets({ ...base, redemptions: { ...base.redemptions, A2: { receiverPid: "B", slot: 2, voided: false } } });
  assert.deepEqual([both.A.mission, both.A.hard, both.A.assumed], [2, 2, 0], "둘 다 직접 인증되면 2장");
  const absent = computeTickets({ ...base, redemptions: {}, people: [{ pid: "A" }, { pid: "B", joined: false }, { pid: "C" }] });
  assert.deepEqual([absent.A.mission, absent.A.hard, absent.A.assumed], [2, 0, 2], "대상 불참으로 인정된 미션에도 없다");
});

test("가중 추첨: 중복 없이 지정 인원, 제외 대상 빠짐, 0장은 제외", () => {
  const entries = pids.map((pid, i) => ({ pid, weight: i % 5 }));
  const exclude = new Set(pids.slice(0, 10));
  const w = weightedDraw(entries, 12, seededRandom("d"), exclude);
  assert.equal(w.length, 12);
  assert.equal(new Set(w).size, 12);
  assert.ok(w.every((pid) => !exclude.has(pid)));
  assert.ok(w.every((pid) => entries.find((e) => e.pid === pid).weight > 0));
});

test("가중 추첨: 응모권이 많을수록 자주 뽑힌다", () => {
  const entries = [{ pid: "low", weight: 1 }, { pid: "high", weight: 9 }];
  const rand = seededRandom("freq");
  let high = 0;
  for (let i = 0; i < 5000; i++) if (weightedDraw(entries, 1, rand)[0] === "high") high++;
  assert.ok(high / 5000 > 0.85 && high / 5000 < 0.95);
});

test("최다 응모권상: 동점자 중 1명", () => {
  const r = pickMostTickets({ A: { total: 5 }, B: { total: 7 }, C: { total: 7 } }, seededRandom("m"));
  assert.ok(["B", "C"].includes(r.pid));
  assert.equal(r.tiedCount, 2);
});

test("베스트 마니또: 가중치 반영 정렬, 실격자 제외", () => {
  const cards = [{ cardId: "x", giverPid: "A" }, { cardId: "y", giverPid: "B" }, { cardId: "z", giverPid: "C" }];
  const tickets = { A: { completion: 1 }, B: { completion: 1 }, C: { completion: 1 } };
  const ranked = rankBestManito({
    cards, tickets,
    votes: { v1: ["x", "y"], v2: ["x"], v3: ["z"] },
    adminEval: { x: 5, y: 10, z: 10 },
    disqualified: new Set(["C"]),
  });
  assert.deepEqual(ranked.map((r) => r.giverPid), ["A", "B"]);
});

test("베스트 마니또 동점: 인증된 미션 → 투표 점수 → 운영진 평가 → 무작위 순", () => {
  const cards = [{ cardId: "x", giverPid: "A" }, { cardId: "y", giverPid: "B" }, { cardId: "z", giverPid: "C" }];
  // C: 득표 5표(최다) → 0.5.  A: 완수 1(0.3).  B: 완수 0 + 득표 1표(최다의 1/5 → 0.1) + 평가 10(0.2) = 0.3
  // A와 B는 점수가 같고, 완수율이 높은 A가 위
  const votes = { v1: ["y", "z"], v2: ["z"], v3: ["z"], v4: ["z"], v5: ["z"] };
  const ranked = rankBestManito({
    cards, votes, adminEval: { y: 10 },
    tickets: { A: { completion: 1 }, B: { completion: 0 }, C: { completion: 0 } },
  });
  assert.deepEqual(ranked.map((r) => r.giverPid), ["C", "A", "B"]);
  assert.ok(Math.abs(ranked[1].score - ranked[2].score) < 1e-9, "A와 B의 점수는 같다");
  assert.equal(ranked[2].votes, 1);
  // 완전히 같으면 무작위(주어진 난수 순서대로 결정)
  const two = cards.slice(0, 2);
  const same = { tickets: { A: { completion: 1 }, B: { completion: 1 } }, votes: {}, adminEval: {} };
  const seq = (...xs) => () => xs.shift();
  assert.deepEqual(rankBestManito({ cards: two, ...same, rand: seq(0.9, 0.1) }).map((r) => r.giverPid), ["A", "B"]);
  assert.deepEqual(rankBestManito({ cards: two, ...same, rand: seq(0.1, 0.9) }).map((r) => r.giverPid), ["B", "A"]);
});

test("수상 대상이 아닌 마니또의 카드는 없는 것으로 집계: 그 카드가 표를 많이 받아도 다른 사람의 투표 점수가 낮아지지 않는다", () => {
  const cards = [{ cardId: "x", giverPid: "A" }, { cardId: "y", giverPid: "B" }, { cardId: "z", giverPid: "C" }];
  const tickets = { A: { completion: 1 }, B: { completion: 1 }, C: { completion: 1 } };
  // z(C)가 5표로 최다, x는 2표, y는 1표
  const votes = { v1: ["x", "z"], v2: ["x", "z"], v3: ["y", "z"], v4: ["z"], v5: ["z"] };
  const withC = rankBestManito({ cards, votes, adminEval: {}, tickets });
  assert.ok(withC.find((r) => r.giverPid === "A").vote < 1, "C가 수상 대상이면 A의 투표 점수는 C(최다)보다 낮다");
  const ranked = rankBestManito({ cards, votes, adminEval: {}, tickets, disqualified: new Set(["C"]) });
  assert.deepEqual(ranked.map((r) => r.giverPid), ["A", "B"]);
  // C가 빠지면 남은 카드 중 최다인 A가 1, B는 그 절반(2표 대 1표, 기대 득표가 같음)
  assert.ok(Math.abs(ranked[0].vote - 1) < 1e-9);
  assert.ok(Math.abs(ranked[1].vote - 0.5) < 1e-9);
  assert.deepEqual(ranked.map((r) => r.votes), [2, 1], "C 카드에 간 표는 세지 않는다");
  // C에게만 표를 준 사람(v4, v5)이 있어도 A·B의 점수는 그 사람들이 투표하지 않은 것과 같다
  const without = rankBestManito({ cards: cards.slice(0, 2), votes: { v1: ["x"], v2: ["x"], v3: ["y"] }, adminEval: {}, tickets });
  assert.deepEqual(ranked.map((r) => [r.giverPid, r.vote]), without.map((r) => [r.giverPid, r.vote]));
});

test("투표 집계: 파트 인원이 달라도 고르게 찍으면 투표 점수가 같다(내 파트 카드는 못 보므로 표 수는 달라진다)", () => {
  // 가파트 3명, 나파트 2명. 각자 카드 1장. 가파트 사람은 나파트 카드 2장만, 나파트 사람은 가파트 카드 3장만 본다.
  const partOf = { a1: "가", a2: "가", a3: "가", b1: "나", b2: "나" };
  const cards = Object.keys(partOf).map((pid) => ({ cardId: `c-${pid}`, giverPid: pid }));
  const votes = {
    a1: ["c-b1", "c-b2"], a2: ["c-b1", "c-b2"], a3: ["c-b1", "c-b2"],
    b1: ["c-a1", "c-a2", "c-a3"], b2: ["c-a1", "c-a2", "c-a3"],
  };
  const { count, expected } = tallyVotes(cards, votes, partOf);
  assert.deepEqual(count, { "c-a1": 2, "c-a2": 2, "c-a3": 2, "c-b1": 3, "c-b2": 3 }, "표 수는 작은 파트 카드가 더 많다");
  assert.deepEqual(expected, { "c-a1": 2, "c-a2": 2, "c-a3": 2, "c-b1": 3, "c-b2": 3 });
  const tickets = Object.fromEntries(Object.keys(partOf).map((pid) => [pid, { completion: 1 }]));
  const ranked = rankBestManito({ cards, votes, adminEval: {}, tickets, partOf });
  assert.ok(ranked.every((r) => Math.abs(r.vote - 1) < 1e-9), "투표 점수는 모두 같다");
  // 파트 정보를 주지 않으면(전원이 전부 보는 것으로 계산) 표 수 그대로라 작은 파트가 유리해진다 → 그래서 partOf를 넘긴다
  const raw = rankBestManito({ cards, votes, adminEval: {}, tickets });
  assert.ok(raw.find((r) => r.giverPid === "b1").vote > raw.find((r) => r.giverPid === "a1").vote);
  // 한 카드가 실제로 더 많이 뽑히면 그 카드가 앞선다
  const liked = rankBestManito({ cards, votes: { ...votes, b1: ["c-a1"], b2: ["c-a1"] }, adminEval: {}, tickets, partOf });
  assert.equal(liked[0].giverPid, "a1");
});

test("투표 집계: 화면에서 고를 수 없는 표(내 파트 카드·내 카드, 없는 카드, 같은 카드 중복)는 세지 않는다", () => {
  const partOf = { a1: "가", a2: "가", b1: "나", b2: "나", n1: null };
  const cards = ["a1", "a2", "b1", "b2"].map((pid) => ({ cardId: `c-${pid}`, giverPid: pid }));
  const { count } = tallyVotes(cards, {
    a1: ["c-a1", "c-a2", "c-b1"], // 내 카드, 같은 파트 카드는 빠지고 c-b1만
    b1: ["c-a1", "c-a1", "c-a1"], // 중복은 1표
    b2: ["없는카드"],
    n1: ["c-a1", "c-b1", "c-b2"], // 파트가 없는 사람은 전부 볼 수 있다
  }, partOf);
  assert.deepEqual(count, { "c-a1": 2, "c-a2": 0, "c-b1": 2, "c-b2": 1 });
});

test("명단 요약: 이름·근무지·파트만, pid 순서 고정, 가입 여부·수상 제외 변화는 같은 요약", () => {
  const rows = [
    { pid: "p002", name: "다라", loc: "S1L", part: "나파트", uid: null, disqualified: false, inviteUsed: "X" },
    { pid: "p001", name: "가나", loc: "SR3", part: null, uid: "u1", disqualified: false, team: 3 },
  ];
  const sum = rosterSummary(rows);
  assert.deepEqual(Object.keys(sum), ["p001", "p002"]);
  assert.deepEqual(sum.p002, { name: "다라", loc: "S1L", part: "나파트" });
  assert.deepEqual(sum.p001, { name: "가나", loc: "SR3", part: null }, "예전 명단에 남은 team 값은 요약에 넣지 않는다");
  assert.deepEqual(summaryToList(sum).map((r) => r.pid), ["p001", "p002"]);
  const claimed = rows.map((r) => ({ ...r, uid: "u-" + r.pid, disqualified: true, dropout: true }));
  assert.ok(sameSummary(sum, rosterSummary(claimed)), "가입·제외·이탈만 바뀌면 다시 쓰지 않는다");
  assert.ok(!sameSummary(sum, rosterSummary(rows.map((r) => (r.pid === "p001" ? { ...r, part: "가파트" } : r)))), "파트가 바뀌면 다시 쓴다");
  assert.ok(sameSummary({ p002: sum.p002, p001: sum.p001 }, sum), "키 순서가 달라도 같은 요약");
});

test("명단 입력 한 줄: 이름,근무지,파트. 근무지 오타는 알려 준다", () => {
  const L = ["SR3", "S1L"];
  assert.deepEqual(parseRosterLine("홍길동,SR3,공정파트", L), { name: "홍길동", loc: "SR3", part: "공정파트", badLoc: null });
  assert.deepEqual(parseRosterLine("김철수\t s1l \t 소자파트 ", L), { name: "김철수", loc: "S1L", part: "소자파트", badLoc: null });
  assert.deepEqual(parseRosterLine("이영희", L), { name: "이영희", loc: null, part: null, badLoc: null });
  assert.deepEqual(parseRosterLine("박민수,,공정파트", L), { name: "박민수", loc: null, part: "공정파트", badLoc: null });
  assert.equal(parseRosterLine("오타,SR33,가파트", L).badLoc, "SR33");
  assert.equal(parseRosterLine("칸이 밀림,공정파트", L).badLoc, "공정파트", "근무지 칸에 파트를 쓰면 알려 준다");
});

test("프로필 문항: 6개, 고르기는 보기 중 하나만, 직접 쓰기는 최소 글자 수", () => {
  assert.equal(PROFILE_QUESTIONS.length, CLUE_COUNT);
  PROFILE_QUESTIONS.forEach(({ q, options, min }, i) => {
    assert.ok(q);
    if (options) {
      assert.ok(options.length >= 3 && new Set(options).size === options.length && options.every((o) => o.length <= 60));
      assert.equal(profileAnswerError(i, options[0]), null);
      assert.ok(profileAnswerError(i, "없음"));
      assert.ok(profileAnswerError(i, ""));
    } else {
      assert.ok(profileAnswerError(i, "."), "한 글자 답은 받지 않는다");
      assert.equal(profileAnswerError(i, "가".repeat(min)), null);
    }
  });
});

test("미션 카드: 난이도마다 돈이 안 드는 카드가 2장 이상(다른 근무지용 포함), 쉬움은 전부 무비용", () => {
  for (const [level, cards] of Object.entries(MISSION_CARDS)) {
    assert.ok(cards.filter((c) => !c.cost).length >= 2, level);
    assert.ok(cards.filter((c) => !c.cost && c.remote).length >= 2, level + " 원격");
  }
  assert.ok(MISSION_CARDS.easy.every((c) => !c.cost && c.remote));
});

test("미션 카드: 삼행시 쪽지는 보통 카드, 3일 연속 쪽지는 도전 카드", () => {
  const find = (re) => Object.entries(MISSION_CARDS).flatMap(([level, list]) => list.filter((c) => re.test(c.text)).map((c) => ({ level, ...c })));
  const poem = find(/삼행시 쪽지/);
  assert.deepEqual(poem.map((c) => [c.level, c.remote, Boolean(c.cost)]), [["normal", true, false]]);
  assert.deepEqual(find(/3일 연속/).map((c) => c.level), ["hard"]);
  const ids = Object.values(MISSION_CARDS).flat().map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "카드 번호 중복 없음");
});

test("파트 대항전: 완수율 1위 파트원에게 +1, 내 미션이 0건이면 없음, 불참자는 인원에서 빼고 0장", () => {
  // 원: A1 → B1 → A2 → B2 → A1.  가파트 = A1, A2, A3(가입 안 함)  나파트 = B1, B2
  const people = [
    { pid: "A1", part: "가파트" }, { pid: "A2", part: "가파트" }, { pid: "A3", part: "가파트", joined: false },
    { pid: "B1", part: "나파트" }, { pid: "B2", part: "나파트" },
  ];
  const giverCodes = Object.fromEntries(["A1", "A2", "B1", "B2"].map((g) => [g, { 1: g + "1", 2: g + "2", 3: g + "3" }]));
  const base = { people, assignments: { A1: "B1", B1: "A2", A2: "B2", B2: "A1" }, giverCodes, missions: {}, guesses: {} };
  // A1이 2건 인증받음. A2는 0건. B1은 1건. B2는 0건
  const redemptions = {
    A11: { receiverPid: "B1", slot: 1, voided: false }, A12: { receiverPid: "B1", slot: 2, voided: false },
    B11: { receiverPid: "A2", slot: 1, voided: false },
  };
  const deliveries = [{ receiverPid: "B1", slot: 1 }, { receiverPid: "B1", slot: 2 }, { receiverPid: "A2", slot: 1 }];
  const t = computeTickets({ ...base, redemptions, deliveries });
  const st = partStandings(people, t);
  // 가파트: 2건 / (2명 × 3) = 33% (A3은 가입을 안 해 인원에서 빠짐).  나파트: 1건 / 6 = 17%
  assert.deepEqual(st.map((x) => [x.part, x.members, x.done, x.max, x.winner]), [["가파트", 2, 2, 6, true], ["나파트", 2, 1, 6, false]]);
  assert.deepEqual([t.A1.partBonus, t.A2.partBonus, t.A3.partBonus, t.B1.partBonus, t.B2.partBonus], [1, 0, 0, 0, 0]);
  // A1: 미션 2 + 은신 2 + 보상 3(B2가 아무것도 안 보냄) + 우승 파트 1 = 8
  assert.equal(t.A1.total, 8);
  assert.equal(t.A2.total, 1, "미션 0건인 A2는 우승 파트여도 +1이 없다(인증 입력 1장만)");
  assert.equal(t.A3.total, 0);

  // 동률이면 두 파트 모두, 전부 0건이면 우승 파트 없음
  const tie = computeTickets({ ...base, deliveries, redemptions: { A11: redemptions.A11, B11: redemptions.B11 } });
  assert.deepEqual(partStandings(people, tie).map((x) => x.winner), [true, true]);
  assert.deepEqual([tie.A1.partBonus, tie.B1.partBonus, tie.A2.partBonus], [1, 1, 0]);
  const none = computeTickets({ ...base, deliveries: [], redemptions: {} });
  assert.ok(partStandings(people, none).every((x) => !x.winner));
  // 파트가 없는 사람은 대항전에서 빠진다
  const noPart = computeTickets({ ...base, people: people.map((p) => ({ ...p, part: null })), redemptions, deliveries });
  assert.deepEqual(partStandings(people.map((p) => ({ ...p, part: null })), noPart), []);
  assert.equal(noPart.A1.partBonus, 0);
});

test("파트 주간 순위: 완료 알린 수 / (참여 인원 × 열린 주차), 불참자는 빼고, 열린 주차보다 많이 세지 않는다", () => {
  const people = [
    { pid: "a", part: "가파트" }, { pid: "b", part: "가파트" }, { pid: "c", part: "가파트", dropout: true },
    { pid: "d", part: "나파트" }, { pid: "e", part: "나파트" }, { pid: "f", part: null },
  ];
  const board = weeklyPartBoard(people, { a: 2, b: 1, c: 2, d: 3, e: 0, f: 2 }, 2);
  // 가파트: (2 + 1) / (2명 × 2주) = 75%.  나파트: d는 2주차까지라 2로 셈 → 2 / 4 = 50%
  assert.deepEqual(board.map((x) => [x.part, x.members, x.done, x.max, x.winner]), [["가파트", 2, 3, 4, true], ["나파트", 2, 2, 4, false]]);
});

test("짝 현황: 마니또별 주차 상태(카드 고름·인증 대기·신고·확인·인증·무효)와 대상의 지목", () => {
  const data = {
    assignments: { A: { receiverPid: "B" }, B: { receiverPid: "C" }, C: { receiverPid: "A" } },
    giverCodes: { A: { codes: { 1: "A1", 2: "A2", 3: "A3" } }, B: { codes: { 1: "B1", 2: "B2", 3: "B3" } }, C: { codes: { 1: "C1", 2: "C2", 3: "C3" } } },
    missions: {
      A: { choices: { 1: { level: "hard", text: "퀴즈" }, 2: { level: "easy", text: "쪽지" }, 3: { level: "praise", text: "칭찬" } }, done: { 1: true, 2: true, 3: true }, notes: { 1: 2 } },
      B: { choices: { 1: { level: "normal", text: "간식" }, 2: { level: "easy", text: "쪽지" } }, done: { 1: true, 2: true } },
      C: { choices: { 1: { level: "easy", text: "쪽지" } } },
    },
    redemptions: { A1: { voided: false }, A3: { voided: true }, C2: { voided: false } }, // C2: 완료 알림 전에 실물 코드로 먼저 인증
    reports: { B_2: {}, C_1: {} },
    verdicts: { C_1: { verdict: "missing" }, C_2: { verdict: "received" } },
    guesses: { B: { guessPid: "A" }, C: { guessPid: "A" } },
  };
  const rows = Object.fromEntries(pairRows(data).map((r) => [r.giverPid, r]));
  assert.deepEqual([1, 2, 3].map((s) => rows.A.slots[s].status), ["redeemed", "reported", "voided"]);
  assert.deepEqual([rows.A.slots[1].level, rows.A.slots[1].notes, rows.A.slots[1].code], ["hard", 2, "A1"]);
  assert.deepEqual([1, 2, 3].map((s) => rows.B.slots[s].status), ["missing", "confirmed", "none"]);
  assert.deepEqual([1, 2, 3].map((s) => rows.C.slots[s].status), ["chosen", "redeemed", "none"]);
  // 지목: 받는 사람의 지목이 그 줄의 마니또와 같으면 정답
  assert.deepEqual([rows.A.guessPid, rows.A.correct], ["A", true]); // B가 A를 지목(정답)
  assert.deepEqual([rows.B.guessPid, rows.B.correct], ["A", false]); // C가 A를 지목(실제 마니또는 B)
  assert.deepEqual([rows.C.guessPid, rows.C.correct], [null, false]); // A는 지목 안 함

  // 운영자가 확인할 주차: 완료를 알렸는데 인증이 없는 것(인증됐거나 무효 처리된 것은 빠진다)
  const key = (x) => `${x.giverPid}>${x.receiverPid}:${x.slot}:${x.reported ? "신고" : "-"}:${x.verdict || "-"}`;
  assert.deepEqual(unresolvedSlots(pairRows(data)).map(key).sort(), ["A>B:2:신고:-", "B>C:1:신고:missing", "B>C:2:-:received"]);
  // 미션 진행 중에는 신고됐거나 이미 확인한 것만 본다
  const quiet = { ...data, reports: {}, verdicts: {} };
  assert.equal(unresolvedSlots(pairRows(quiet)).length, 3);
  assert.equal(unresolvedSlots(pairRows(quiet), { onlyReported: true }).length, 0);
  assert.equal(unresolvedSlots(pairRows(data), { onlyReported: true }).length, 3);
});

test("받는 사람 기준 코드: 마니또의 코드를 그 대상 앞으로 뒤집는다(피드 글 확인용)", () => {
  const assignments = { A: { receiverPid: "B" }, B: { receiverPid: "C" }, C: { receiverPid: "A" } };
  const giverCodes = { A: { codes: { 1: "A1", 2: "A2", 3: "A3" } }, B: { codes: { 1: "B1", 2: "B2", 3: "B3" } } };
  assert.deepEqual(receiverCodesOf(assignments, giverCodes), { B: { 1: "A1", 2: "A2", 3: "A3" }, C: { 1: "B1", 2: "B2", 3: "B3" } });
  assert.ok(sameCodes({ 1: "A1", 2: "A2", 3: "A3" }, { 3: "A3", 2: "A2", 1: "A1" }));
  assert.ok(!sameCodes({ 1: "A1", 2: "A2" }, { 1: "A1", 2: "A2", 3: "A3" }));
  assert.ok(!sameCodes(undefined, { 1: "A1", 2: "A2", 3: "A3" }));
});
