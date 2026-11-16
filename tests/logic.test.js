import test from "node:test";
import assert from "node:assert/strict";
import { assignManito, assignmentMemo, generateCodes } from "../src/lib/assign.js";
import { angelQueue, needyReceivers, matchAngels, angelQueueStatus } from "../src/lib/angels.js";
import { pickBestReview, reviewLikes, missionLikes, cardLevel, computeTickets, weightedDraw, partStandings, weeklyPartBoard, seededDraw, seededTop, drawAll, verifyDraws, DRAW_ORDER, noticedWeeks } from "../src/lib/scoring.js";
import { pairChain, buildSlides, revealedUpTo } from "../src/lib/reveal.js";
import { readFileSync } from "node:fs";
import { seededRandom } from "../src/lib/random.js";
import { parseRosterLine, rosterSummary, summaryToList, sameSummary } from "../src/lib/roster.js";
import { MISSION_CARDS, PROFILE_QUESTIONS, CLUE_COUNT, EXTRA_NOTES_MAX, CLUE_DATES, SCHEDULE, profileAnswerError } from "../src/lib/constants.js";
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

// 카드 추가분 테스트에 쓰는 실제 카드(목록의 번호·난이도·글 그대로)
const pickCard = (level, i = 0) => ({ cardId: MISSION_CARDS[level][i].id, level, text: MISSION_CARDS[level][i].text });
const HARD = pickCard("hard"), NORMAL = pickCard("normal"), EASY_CARD = pickCard("easy");
const PRAISE = { cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" };

test("응모권 계산: 미션·도전·입력·은신·정답", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const assignments = { A: "B", B: "C", C: "A" };
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const redemptions = {
    A1: { receiverPid: "B", slot: 1, voided: false, cardMatch: true },
    A2: { receiverPid: "B", slot: 2, voided: false, cardMatch: true },
    A3: { receiverPid: "B", slot: 3, voided: true },
    B1: { receiverPid: "C", slot: 1, voided: false },
  };
  const missions = { A: { choices: { 1: HARD, 2: EASY_CARD } } };
  const guesses = { B: "A", C: "A" }; // B는 정답(A), C는 오답(실제 B)
  const t = computeTickets({ people, assignments, giverCodes, redemptions, missions, guesses });
  // A: 미션 2(무효 1건 제외) + 카드 2(1주차 도전) + 받은 입력 0 + 은신 0(들킴) + 보상 3(C가 3주 모두 안 보냄) = 7
  assert.equal(t.A.card, 2);
  assert.equal(t.A.total, 7);
  assert.equal(t.A.comp, 3);
  // B: 미션 1 + 받은 입력 2 + 정답 1 = 4. C가 틀렸지만 미션이 3건이 아니라 은신 없음. 3주차는 무효 처리된 인증이 있어 보상 없음
  assert.equal(t.B.total, 4);
  assert.equal(t.B.hidden, 0);
  assert.equal(t.B.comp, 0);
  // C: 미션 0 + 받은 입력 1 = 1. 인증된 미션이 없어 은신 0, 보상도 0
  assert.equal(t.C.total, 1);
  assert.deepEqual([t.C.hidden, t.C.comp], [0, 0]);
});

test("정체를 알려주면 둘의 합계가 1장 줄어든다 (미션 3건이 모두 인증된 마니또)", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const base = {
    people, assignments: { A: "B", B: "C", C: "A" }, giverCodes: { A: { 1: "A1", 2: "A2", 3: "A3" } },
    redemptions: Object.fromEntries([1, 2, 3].map((slot) => [`A${slot}`, { receiverPid: "B", slot, voided: false }])),
    missions: {}, deliveries: [1, 2, 3].map((slot) => ({ receiverPid: "B", slot })),
  };
  const hidden = computeTickets({ ...base, guesses: {} });
  const leaked = computeTickets({ ...base, guesses: { B: "A" } });
  assert.equal(hidden.A.total, 5); // 미션 3 + 은신 2
  assert.equal(leaked.A.total, 3); // 은신을 잃음
  assert.equal(leaked.A.total + leaked.B.total - (hidden.A.total + hidden.B.total), -1);
});

test("은신 2장은 미션 3건이 모두 인증된 마니또만: 1~2건만 하고 쉬거나 아무것도 안 하면 0장", () => {
  // A → B → C → D → A.  A는 3건 모두 인증, B는 2건만, C·D는 아무것도 안 함
  const people = ["A", "B", "C", "D"].map((pid) => ({ pid }));
  const base = {
    people, assignments: { A: "B", B: "C", C: "D", D: "A" }, missions: {},
    giverCodes: Object.fromEntries(["A", "B", "C", "D"].map((g) => [g, { 1: `${g}1`, 2: `${g}2`, 3: `${g}3` }])),
    redemptions: {
      A1: { receiverPid: "B", slot: 1, voided: false }, A2: { receiverPid: "B", slot: 2, voided: false }, A3: { receiverPid: "B", slot: 3, voided: false },
      B1: { receiverPid: "C", slot: 1, voided: false }, B2: { receiverPid: "C", slot: 2, voided: false },
    },
    deliveries: [{ receiverPid: "B", slot: 1 }, { receiverPid: "B", slot: 2 }, { receiverPid: "B", slot: 3 }, { receiverPid: "C", slot: 1 }, { receiverPid: "C", slot: 2 }],
  };
  const t = computeTickets({ ...base, guesses: {} });
  assert.deepEqual([t.A.hidden, t.B.hidden, t.C.hidden, t.D.hidden], [2, 0, 0, 0]);
  assert.deepEqual([t.A.mission, t.B.mission], [3, 2], "미션 응모권은 한 만큼 그대로");
  assert.equal(t.D.total, 0, "아무것도 안 한 사람은 추첨 대상이 아니다");
  // 3건을 못 채운 마니또(B)는 잃을 은신이 없어서, 정체를 알려주면 받는 사람(C)만 +1이 된다(합계 −1 구조가 적용되지 않는 경우)
  const leak = computeTickets({ ...base, guesses: { C: "B" } });
  assert.equal(leak.C.total - t.C.total, 1);
  assert.equal(leak.B.total, t.B.total);
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
  // A: 미션 1 + 보상 3(C가 3주 모두 안 보냄) = 4. 미션이 3건이 아니라 은신은 없다
  assert.deepEqual([t.A.mission, t.A.hidden, t.A.entries, t.A.comp, t.A.total], [1, 0, 0, 3, 4]);
  // B: 미션 1 + 입력 1 + 보상 1(3주차만. 2주차는 받았는데 인증을 안 한 것이라 보상 없음) = 3
  assert.deepEqual([t.B.mission, t.B.hidden, t.B.entries, t.B.comp, t.B.total], [1, 0, 1, 1, 3]);
  // C: 입력 1. 내 미션이 0건이라 보상 없음, 은신 없음
  assert.deepEqual([t.C.mission, t.C.hidden, t.C.entries, t.C.comp, t.C.total], [0, 0, 1, 0, 1]);

  // 무효 처리된 인증이 있는 주차는 보상하지 않는다(받기는 받았다)
  const v = computeTickets({
    people, assignments: { A: "B", B: "C", C: "A" }, giverCodes, guesses: {}, missions: {},
    deliveries: [{ receiverPid: "C", slot: 1 }],
    redemptions: { B1: { receiverPid: "C", slot: 1, voided: false }, C1: { receiverPid: "A", slot: 1, voided: true }, A1: { receiverPid: "B", slot: 1, voided: false } },
  });
  // A: 미션 1 + 보상 2(C의 2·3주차. 1주차는 무효 처리된 인증이 있음) = 3
  assert.deepEqual([v.A.entries, v.A.comp, v.A.total], [0, 2, 3]);
});

test("불참(가입 안 함·중도 이탈)은 0장, 그 사람의 마니또는 완료 알린 미션을 인정받는다", () => {
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const base = {
    assignments: { A: "B", B: "C", C: "A" }, giverCodes, redemptions: {},
    missions: { B: { choices: { 1: HARD, 2: EASY_CARD } } },
    deliveries: [{ receiverPid: "C", slot: 1 }, { receiverPid: "C", slot: 2 }, { receiverPid: "C", slot: 3 }], // B가 C에게 3건 완료 알림
  };
  for (const flag of [{ joined: false }, { joined: true, dropout: true }]) {
    const people = [{ pid: "A", joined: true }, { pid: "B", joined: true }, { pid: "C", ...flag }];
    const t = computeTickets({ ...base, people, guesses: { C: "B" } }); // 불참자의 지목은 세지 않는다
    // B: 인정 3건 → 미션 3 + 은신 2(인정된 미션도 3건에 센다) + 보상 3(A가 3주 모두 안 보냄) = 8. 인정된 미션에는 카드 추가분이 없다(1주차가 도전 카드여도 0)
    assert.deepEqual([t.B.mission, t.B.card, t.B.assumed, t.B.hidden, t.B.comp, t.B.total], [3, 0, 3, 2, 3, 8]);
    assert.equal(t.C.total, 0);
    assert.equal(t.A.total, 0); // 아무것도 안 함
  }
  // 대상이 참여 중이면 완료 알림만으로는 인정되지 않는다(받는 사람이 인증해야 함)
  const people = ["A", "B", "C"].map((pid) => ({ pid, joined: true }));
  const t = computeTickets({ ...base, people, guesses: {} });
  assert.deepEqual([t.B.mission, t.B.card, t.B.assumed, t.B.hidden], [0, 0, 0, 0]);
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
  // 2주차(인증이 무효 처리됨)와 3주차(인증 없음)를 모두 '받았음'으로 확인하면 둘 다 인정된다
  // (무효가 된 것은 받는 사람의 후기이고, 미션은 실제로 받았다고 운영자가 확인한 것). 3건이 모두 인정돼 은신도 받는다
  const marked = computeTickets({ ...base, verdicts: { C_2: "received", C_3: "received" } });
  assert.deepEqual([marked.B.mission, marked.B.card, marked.B.assumed, marked.B.hidden], [3, 0, 2, 2]);
  // 무효 처리된 인증은 '받았음' 확인이 없으면 인정되지 않는다(예전과 같다)
  const only3 = computeTickets({ ...base, verdicts: { C_3: "received" } });
  assert.deepEqual([only3.B.mission, only3.B.assumed, only3.B.hidden], [2, 1, 0]);
  // C 본인: 미션 1 + 인증 입력 1(무효 제외) 그대로. 받았다고 확인된 주차는 보상도 없다
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

test("카드 추가분은 받는 사람이 직접 인증한 미션만: 불참·운영자 확인으로 인정된 미션에는 없다", () => {
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const base = {
    assignments: { A: "B", B: "C", C: "A" }, giverCodes, guesses: {},
    people: ["A", "B", "C"].map((pid) => ({ pid })),
    missions: { A: { choices: { 1: HARD, 2: pickCard("hard", 1) } } }, // A는 1·2주차 모두 도전 카드
    deliveries: [{ receiverPid: "B", slot: 1 }, { receiverPid: "B", slot: 2 }],
    redemptions: { A1: { receiverPid: "B", slot: 1, voided: false, cardMatch: true } }, // 1주차만 직접 인증(카드 확인)
  };
  const confirmed = computeTickets({ ...base, verdicts: { B_2: "received" } });
  assert.deepEqual([confirmed.A.mission, confirmed.A.card, confirmed.A.assumed], [2, 2, 1], "직접 인증된 1주차 도전 +2만, 확인으로 인정된 2주차에는 없다");
  const both = computeTickets({ ...base, redemptions: { ...base.redemptions, A2: { receiverPid: "B", slot: 2, voided: false, cardMatch: true } } });
  assert.deepEqual([both.A.mission, both.A.card, both.A.assumed], [2, 4, 0], "둘 다 직접 인증되면 도전 2 + 2");
  const absent = computeTickets({ ...base, redemptions: {}, people: [{ pid: "A" }, { pid: "B", joined: false }, { pid: "C" }] });
  assert.deepEqual([absent.A.mission, absent.A.card, absent.A.assumed], [2, 0, 2], "대상 불참으로 인정된 미션에도 없다");
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
  // A1: 미션 2 + 보상 3(B2가 아무것도 안 보냄) + 우승 파트 1 = 6 (미션이 3건이 아니라 은신 없음)
  assert.equal(t.A1.total, 6);
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
  // 인증이 무효 처리된 주차(A의 3주차)도 나온다: '받았음'으로 확인하면 마니또의 미션은 인정되기 때문
  assert.deepEqual(unresolvedSlots(pairRows(data)).map(key).sort(), ["A>B:2:신고:-", "A>B:3:-:-", "B>C:1:신고:missing", "B>C:2:-:received"]);
  assert.equal(unresolvedSlots(pairRows(data)).find((x) => x.giverPid === "A" && x.slot === 3).voided, true);
  // 무효 처리된 인증을 '받았음'으로 확인하면 상태가 "받았음 확인"이 된다
  assert.equal(pairRows({ ...data, verdicts: { B_3: { verdict: "received" } } }).find((r) => r.giverPid === "A").slots[3].status, "confirmed");
  // 사이트가 전달한 칭찬 카드(운영자가 가리지 않은 것)는 인증이 없어도 인정: 확인할 목록에 나오지 않는다
  const praise = pairRows({ ...data, redemptions: { A1: { voided: false } }, autoPraise: new Set(["B_3"]) });
  assert.equal(praise.find((r) => r.giverPid === "A").slots[3].status, "auto");
  assert.ok(!unresolvedSlots(praise).some((x) => x.giverPid === "A" && x.slot === 3));
  // 미션 진행 중에는 신고됐거나 이미 확인한 것만 본다
  const quiet = { ...data, reports: {}, verdicts: {} };
  assert.equal(unresolvedSlots(pairRows(quiet)).length, 4);
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

test("은신 2장은 단서 6개를 낸 마니또만: 프로필을 안 채워 단서를 안 내면 0장", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const base = {
    people, assignments: { A: "B", B: "C", C: "A" }, guesses: {}, missions: {},
    giverCodes: { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } },
    redemptions: Object.fromEntries([1, 2, 3].flatMap((slot) => [
      [`A${slot}`, { receiverPid: "B", slot, voided: false }], [`B${slot}`, { receiverPid: "C", slot, voided: false }],
    ])), // A·B 모두 3건 인증
  };
  const all = computeTickets({ ...base, cluesDone: new Set(["A", "B"]) });
  assert.deepEqual([all.A.hidden, all.B.hidden], [2, 2]);
  const noB = computeTickets({ ...base, cluesDone: new Set(["A"]) });
  assert.deepEqual([noB.A.hidden, noB.B.hidden], [2, 0], "B는 단서를 다 안 내서 은신 없음");
  assert.equal(noB.B.mission, 3, "미션 응모권은 그대로");
  assert.deepEqual([computeTickets(base).B.hidden], [2], "단서 정보를 주지 않으면(예전 호출) 조건을 보지 않는다");
});

test("완료 알림은 알림 문서와 완료 표시 둘 다 본다(어느 한쪽만 있는 예전 자료도 같은 기준)", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const base = { people, assignments: { A: "B", B: "C", C: "A" }, giverCodes, guesses: {}, redemptions: { B1: { receiverPid: "C", slot: 1, voided: false } } };
  // A는 1주차에 완료 표시만 있고 알림 문서는 없다 → B는 1주차를 "받았는데 인증 안 함"으로 본다(보상 없음), 운영자가 확인할 수 있다
  const doneOnly = computeTickets({ ...base, missions: { A: { done: { 1: true } } }, deliveries: [] });
  const none = computeTickets({ ...base, missions: {}, deliveries: [] });
  assert.deepEqual([none.B.comp, doneOnly.B.comp], [3, 2]);
  const confirmed = computeTickets({ ...base, missions: { A: { done: { 1: true } } }, deliveries: [], verdicts: { B_1: "received" } });
  assert.deepEqual([confirmed.A.mission, confirmed.A.assumed], [1, 1], "완료 표시만 있어도 운영자 확인으로 인정된다");
  // 짝 현황(운영 화면)도 알림 문서만 있는 주차를 "완료를 알린 주차"로 보여 준다
  const rows = pairRows({
    assignments: { A: { receiverPid: "B" } }, giverCodes: { A: { codes: giverCodes.A } }, missions: {}, redemptions: {},
    reports: { B_1: { active: true }, B_2: { active: false } }, verdicts: {}, guesses: {}, delivered: new Set(["B_1", "B_2"]),
  });
  assert.deepEqual([rows[0].slots[1].status, rows[0].slots[2].status], ["reported", "sent"], "취소한 신고(active=false)는 신고가 아님");
  assert.equal(unresolvedSlots(rows, { onlyReported: true }).length, 1);
});

test("추첨: 현장에서 정한 숫자와 응모권만으로 결과가 정해지고, 누구나 다시 계산해 검증할 수 있다", () => {
  const tickets = Object.fromEntries(pids.slice(0, 20).map((pid, i) => [pid, (i % 4) + 1]));
  tickets.zero = 0;
  const step = { key: "t4", count: 5 };
  const a = seededDraw(tickets, step, "4821");
  assert.deepEqual(a, seededDraw({ ...Object.fromEntries(Object.entries(tickets).reverse()) }, step, " 4821 "), "응모권 순서·앞뒤 공백과 무관하게 같다");
  assert.notDeepEqual(a, seededDraw(tickets, step, "4822"), "숫자가 다르면 결과가 다르다");
  assert.ok(!a.includes("zero"), "0장은 뽑히지 않는다");

  const draws = drawAll(tickets, " 4821 ");
  assert.deepEqual(Object.keys(draws), DRAW_ORDER.map((x) => x.key), "1등 → 2등 → 4등 → 5등 → 6등 순서로 모두 정한다");
  assert.ok(Object.values(draws).every((d) => d.seed === "4821"), "숫자는 앞뒤 공백을 빼고 저장");
  assert.deepEqual(verifyDraws(tickets, draws).map((x) => x.ok), DRAW_ORDER.map(() => true));
  // 당첨자를 바꿔 저장했거나, 응모권 수를 바꿨으면 검증에서 드러난다
  const other = Object.keys(tickets).find((p) => p !== draws.grand.winners[0] && tickets[p] > 0);
  const forged = { ...draws, grand: { seed: "4821", winners: [other] } };
  assert.equal(verifyDraws(tickets, forged).find((x) => x.key === "grand").ok, false);
  assert.equal(verifyDraws({ ...tickets, [draws.grand.winners[0]]: 0 }, draws).find((x) => x.key === "grand").ok, false);
  // 한 번에 뽑은 결과가 아니면(칸이 빠졌거나 숫자가 칸마다 다르면) 검증에 통과하지 못한다
  const { t6, ...partial } = draws;
  assert.ok(verifyDraws(tickets, partial).every((x) => x.ok === false));
  assert.ok(verifyDraws(tickets, { ...draws, t6: { ...t6, seed: "1" } }).every((x) => x.ok === false));
  assert.deepEqual(verifyDraws(tickets, {}), []);
});

test("추첨: 큰 상부터 정하고 한 사람은 하나만. 2등은 1등을 뺀 응모권 최다 순, 동점은 숫자로 가른다", () => {
  // 54명: 응모권 1~16장
  const tickets = Object.fromEntries(pids.map((pid, i) => [pid, (i % 16) + 1]));
  const d = drawAll(tickets, "2026");
  const all = DRAW_ORDER.flatMap((x) => d[x.key].winners);
  assert.equal(new Set(all).size, all.length, "1·2·4·5·6등끼리 중복 당첨 없음");
  assert.deepEqual(DRAW_ORDER.map((x) => d[x.key].winners.length), DRAW_ORDER.map((x) => x.count), "응모권 있는 사람이 충분하면 정해진 인원만큼");
  // 2등: 1등 당첨자를 뺀 사람 중 응모권이 가장 많은 순
  const first = d.grand.winners[0];
  const rest = Object.entries(tickets).filter(([pid]) => pid !== first).map(([, n]) => n).sort((a, b) => b - a);
  assert.deepEqual(d.best.winners.map((pid) => tickets[pid]), rest.slice(0, 3));
  // 1등이 응모권 최다인 사람이면 그 사람은 2등에서 빠지고 다음 사람이 올라온다
  const t = { a: 10, b: 9, c: 8, d: 7, e: 1 };
  assert.deepEqual(seededTop(t, { key: "best", count: 3 }, "1", new Set(["a"])), ["b", "c", "d"]);
  assert.deepEqual(seededTop(t, { key: "best", count: 3 }, "1"), ["a", "b", "c"]);
  // 경계에서 동점이면 숫자에 따라 갈리고(같은 숫자면 항상 같은 결과), 확실히 많은 사람은 항상 들어간다
  const tie = { a: 10, b: 7, c: 7, d: 7, e: 7, zero: 0 };
  const picks = new Set();
  for (let i = 0; i < 40; i++) {
    const w = seededTop(tie, { key: "best", count: 3 }, String(i));
    assert.equal(w[0], "a");
    assert.deepEqual(w, seededTop(tie, { key: "best", count: 3 }, String(i)));
    w.slice(1).forEach((pid) => picks.add(pid));
  }
  assert.deepEqual([...picks].sort(), ["b", "c", "d", "e"], "동점자는 누구나 뽑힐 수 있다");
  // 응모권 있는 사람이 모자라면 큰 상부터 채우고 남는 순서는 당첨자 없음
  const few = drawAll({ a: 3, b: 2, c: 1, zero: 0 }, "5");
  assert.equal(few.grand.winners.length, 1);
  assert.equal(few.best.winners.length, 2);
  assert.deepEqual([few.t4.winners, few.t5.winners, few.t6.winners], [[], [], []]);
});

test("추첨: 큰 상부터 정하면 응모권이 많을수록 더 큰 상을 받는다(작은 상에 먼저 뽑혀 큰 상을 놓치지 않는다)", () => {
  const tickets = Object.fromEntries(pids.map((pid, i) => [pid, i < 8 ? 16 : i < 30 ? 8 : 2])); // 16장 8명, 8장 22명, 2장 24명
  const hit = { 16: { t4: 0, any: 0 }, 8: { t4: 0, any: 0 }, 2: { t4: 0, any: 0 } };
  const N = 400;
  for (let i = 0; i < N; i++) {
    const d = drawAll(tickets, `s${i}`);
    for (const pid of d.t4.winners) hit[tickets[pid]].t4++;
    for (const x of DRAW_ORDER) for (const pid of d[x.key].winners) hit[tickets[pid]].any++;
  }
  const per = (n, k, members) => hit[n][k] / N / members;
  assert.ok(per(16, "any", 8) > per(8, "any", 22) && per(8, "any", 22) > per(2, "any", 24), "응모권이 많을수록 뭐라도 받을 확률이 높다");
  assert.ok(per(8, "t4", 22) > per(2, "t4", 24) * 2, "4등(큰 추첨 상)도 응모권이 많은 쪽이 더 자주");
  assert.ok(per(16, "any", 8) > 0.95, "응모권 최다 그룹은 거의 항상 받는다");
});

test("3주차 칭찬 카드는 사이트가 전달하므로 받는 사람이 인증하지 않아도 마니또의 미션으로 인정한다", () => {
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const base = {
    people: ["A", "B", "C"].map((pid) => ({ pid })), assignments: { A: "B", B: "C", C: "A" }, giverCodes, missions: {}, guesses: {},
    // A → B: 1·2주차는 B가 인증, 3주차 칭찬 카드는 전달만 됨(B가 인증 안 함)
    redemptions: { A1: { receiverPid: "B", slot: 1, voided: false }, A2: { receiverPid: "B", slot: 2, voided: false } },
    deliveries: [{ receiverPid: "B", slot: 1, kind: "mission" }, { receiverPid: "B", slot: 2, kind: "mission" }, { receiverPid: "B", slot: 3, kind: "praise" }],
  };
  const t = computeTickets(base);
  assert.deepEqual([t.A.mission, t.A.assumed, t.A.hidden], [3, 1, 2], "칭찬 카드가 인정돼 3건을 채우고 은신도 받는다");
  // 받는 사람(B)은 인증해야 자기 응모권을 받는다. 받았는데 인증을 안 한 것이라 보상도 없다
  assert.deepEqual([t.B.entries, t.B.comp], [2, 0]);
  // 1·2주차 완료 알림(mission)은 자동으로 인정되지 않는다
  const noRed = computeTickets({ ...base, redemptions: {} });
  assert.deepEqual([noRed.A.mission, noRed.A.assumed], [1, 1], "칭찬 카드만 인정");
  // 운영자가 가린 칭찬 카드(막말 등)는 자동으로 인정하지 않는다
  const hidden = computeTickets({ ...base, deliveries: base.deliveries.map((d) => (d.kind === "praise" ? { ...d, hidden: true } : d)) });
  assert.deepEqual([hidden.A.mission, hidden.A.hidden], [2, 0]);
  // 운영자가 "못 받음"으로 확인하면 인정하지 않고(확인이 먼저), 받는 사람에게 그 주차 보상
  const missing = computeTickets({ ...base, verdicts: { B_3: "missing" } });
  assert.deepEqual([missing.A.mission, missing.A.hidden, missing.B.comp], [2, 0, 0], "B는 자기 미션이 0건이라 보상 조건이 안 된다");
  // 받는 사람이 칭찬 카드를 인증했는데 운영자가 무효 처리했다면 자동으로 인정하지 않는다('받았음' 확인이 있어야 한다)
  const voided = { ...base, redemptions: { ...base.redemptions, A3: { receiverPid: "B", slot: 3, voided: true } } };
  assert.equal(computeTickets(voided).A.mission, 2);
  assert.equal(computeTickets({ ...voided, verdicts: { B_3: "received" } }).A.mission, 3);
});

test("3등 베스트 후기상: 남에게 공감을 가장 많이 받은 후기(당사자 두 사람의 공감 제외), 동점이면 먼저 쓴 후기", () => {
  const ts = (seconds) => ({ seconds, nanoseconds: 0 });
  // 후기를 쓴 사람(받는 사람) → 그 미션을 한 마니또: A ← G1, B ← G2, C ← G3, D ← G4
  const redemptions = {
    K1: { receiverPid: "A", review: "첫 후기", feedId: "f1", createdAt: ts(100), voided: false },
    K2: { receiverPid: "B", review: "둘째 후기", feedId: "f2", createdAt: ts(200), voided: false },
    K3: { receiverPid: "C", review: "무효 후기", feedId: "f3", createdAt: ts(50), voided: true },
    K4: { receiverPid: "D", review: "가린 후기", feedId: "f4", createdAt: ts(60), voided: false },
  };
  const giverOfCode = { K1: "G1", K2: "G2", K3: "G3", K4: "G4" };
  // f1: 공감 4개 중 글쓴이 A와 마니또 G1이 누른 2개는 빼서 2.  f2: 2.  f3(무효)·f4(가림)는 표가 많아도 제외
  const feed = { f1: { likes: 4 }, f2: { likes: 2 }, f3: { likes: 9, voided: true }, f4: { likes: 9, hidden: true } };
  const ownLikes = new Set(["f1_A", "f1_G1"]);
  const rows = reviewLikes({ redemptions, feed, giverOfCode, ownLikes });
  assert.deepEqual(rows.map((x) => [x.code, x.likes, x.giverPid]), [["K1", 2, "G1"], ["K2", 2, "G2"]]);
  // 동점(2)이면 먼저 쓴 후기
  assert.deepEqual(pickBestReview(rows), { code: "K1", review: "첫 후기", receiverPid: "A", likes: 2 });
  // 한 표가 더 들어오면 그 후기가 된다
  assert.equal(pickBestReview(reviewLikes({ redemptions, feed: { ...feed, f2: { likes: 3 } }, giverOfCode, ownLikes })).code, "K2");
  // 당사자의 공감만 있는 후기는 0표라 수상하지 못한다. 공감이 하나도 없으면 수상자가 없다
  assert.equal(pickBestReview(reviewLikes({ redemptions, feed: { f1: { likes: 2 }, f2: { likes: 0 } }, giverOfCode, ownLikes })), null);
  assert.equal(pickBestReview(reviewLikes({ redemptions, feed: { f1: {}, f2: {} }, giverOfCode })), null);
  // 수상 대상이 아닌 사람(불참·수상 제외)의 후기는 뺀다
  assert.equal(pickBestReview(rows, new Set(["A"])).code, "K2");
  // 2등 동점 기준: 마니또마다 내 미션 후기가 남에게 받은 공감의 합
  assert.deepEqual(missionLikes(rows), { G1: 2, G2: 2 });
  assert.deepEqual(missionLikes([...rows, { code: "K9", giverPid: "G1", likes: 3 }, { code: "K8", giverPid: "G5", likes: 0 }]), { G1: 5, G2: 2 });
});

test("2등 동점: 응모권이 같으면 내 미션 후기가 받은 공감이 많은 사람, 그래도 같을 때만 추첨 숫자", () => {
  // 모두가 열심히 해서 54명이 모두 13장인 경우
  const tickets = Object.fromEntries(pids.map((pid) => [pid, 13]));
  const step = { key: "best", count: 3 };
  // 공감 기준이 없으면 숫자에 따라 누구나 될 수 있다(운)
  const lucky = new Set();
  for (let i = 0; i < 60; i++) seededTop(tickets, step, String(i)).forEach((pid) => lucky.add(pid));
  assert.ok(lucky.size > 40, `숫자만으로 가르면 ${lucky.size}명이 번갈아 뽑힌다`);
  // 공감 기준이 있으면 숫자와 상관없이 공감이 많은 순서로 정해진다
  const tb = { [pids[7]]: 9, [pids[20]]: 6, [pids[33]]: 4, [pids[40]]: 1 };
  for (let i = 0; i < 20; i++) assert.deepEqual(seededTop(tickets, step, String(i), new Set(), tb), [pids[7], pids[20], pids[33]]);
  // 응모권이 먼저다: 공감이 많아도 응모권이 적으면 뒤
  assert.deepEqual(seededTop({ a: 14, b: 13, c: 13, d: 13 }, step, "1", new Set(), { d: 50, c: 2 }), ["a", "d", "c"]);
  // 공감도 같으면 그 사람들끼리만 숫자로 가른다: 확실한 두 명은 항상 들어가고, 남은 한 자리만 바뀐다
  const tb2 = { [pids[1]]: 5, [pids[2]]: 5, [pids[3]]: 2, [pids[4]]: 2, [pids[5]]: 2 };
  const third = new Set();
  for (let i = 0; i < 40; i++) {
    const w = seededTop(tickets, step, String(i), new Set(), tb2);
    assert.deepEqual(w.slice(0, 2).sort(), [pids[1], pids[2]].sort());
    third.add(w[2]);
  }
  assert.deepEqual([...third].sort(), [pids[3], pids[4], pids[5]].sort());
  // 한 번에 추첨과 검증에도 같은 기준이 들어간다(기준이 다르면 검증에 통과하지 못한다)
  const d = drawAll(tickets, "2026", DRAW_ORDER, tb);
  const rest = [pids[7], pids[20], pids[33], pids[40]].filter((pid) => pid !== d.grand.winners[0]).slice(0, 3);
  assert.deepEqual(d.best.winners, rest, "1등 당첨자를 뺀 공감 순");
  assert.ok(verifyDraws(tickets, d, DRAW_ORDER, tb).every((x) => x.ok));
  assert.equal(verifyDraws(tickets, d, DRAW_ORDER, {}).find((x) => x.key === "best").ok, false);
});

// ── 수호천사 자동 연결 ─────────────────────────────────────────────────────────
// 원: A → B → C → D → E → F → A (마니또 → 대상). 주차별 완료 알림은 done으로 준다
function angelRows(done = {}) {
  const ring = ["A", "B", "C", "D", "E", "F"];
  return ring.map((g, i) => ({
    giverPid: g, receiverPid: ring[(i + 1) % ring.length],
    slots: Object.fromEntries([1, 2, 3].map((s) => [s, { done: (done[g] || []).includes(s) }])),
  }));
}
const at = (seconds, nanoseconds = 0) => ({ seconds, nanoseconds });
const angelPeople = ["A", "B", "C", "D", "E", "F"].map((pid) => ({ pid, joined: true }));

test("수호천사 순서: 지원 시각이 이른 순서, 취소·불참·수상 제외는 빠진다", () => {
  const volunteers = {
    C: { active: true, at: at(300) }, A: { active: true, at: at(100, 5) }, B: { active: true, at: at(100, 2) },
    D: { active: false, at: at(50) }, // 가장 먼저 눌렀지만 취소
    E: { active: true, at: at(10) }, F: { active: true, at: at(20) },
  };
  const people = angelPeople.map((p) => (p.pid === "E" ? { ...p, dropout: true } : p.pid === "F" ? { ...p, disqualified: true } : p));
  assert.deepEqual(angelQueue(volunteers, people).map((v) => [v.pid, v.order]), [["B", 1], ["A", 2], ["C", 3]]);
  // 같은 시각이면 명단 순서(pid)로 — 순서가 실행할 때마다 바뀌지 않게
  assert.deepEqual(angelQueue({ B: { active: true, at: at(1) }, A: { active: true, at: at(1) } }, angelPeople).map((v) => v.pid), ["A", "B"]);
  // 명단에 없는 사람·가입 안 한 사람의 지원은 세지 않는다
  assert.deepEqual(angelQueue({ Z: { active: true, at: at(1) }, A: { active: true, at: at(2) } }, [{ pid: "A", joined: false }]), []);
});

test("수호천사 대상: 2주차가 열린 뒤, 마니또의 완료 알림이 한 건도 없고 참여 중인 사람만", () => {
  // A는 1주차를 했고(대상 B는 받음), 나머지 마니또는 아무것도 안 함
  const rows = angelRows({ A: [1] });
  assert.deepEqual(needyReceivers({ rows, week: 1, people: angelPeople }), [], "1주차 중에는 연결하지 않는다");
  assert.deepEqual(needyReceivers({ rows, week: 2, people: angelPeople }), ["A", "C", "D", "E", "F"], "받은 게 있는 B만 빠진다(명단 순서)");
  // 이미 수호천사가 있는 사람, 가입 안 한 사람, 중도 이탈은 대상이 아니다
  const people = angelPeople.map((p) => (p.pid === "D" ? { ...p, joined: false } : p.pid === "E" ? { ...p, dropout: true } : p));
  assert.deepEqual(needyReceivers({ rows, week: 3, people, angels: { C: { angelPid: "A" } } }), ["A", "F"]);
});

test("수호천사 연결: 먼저 지원한 순서대로, 본인·그 사람의 마니또·자기 미션을 안 한 사람·이미 연결된 사람은 건너뛴다", () => {
  // 2주차가 열림. 1주차 미션을 한 마니또: A, B, C, D (E, F는 안 함 → E의 대상 F와 F의 대상 A가 받은 게 없다)
  const rows = angelRows({ A: [1], B: [1], C: [1], D: [1] });
  assert.deepEqual(needyReceivers({ rows, week: 2, people: angelPeople }), ["A", "F"]);
  // 지원 순서: F(10) → E(20) → A(30) → B(40) → C(50)
  const volunteers = { F: { active: true, at: at(10) }, E: { active: true, at: at(20) }, A: { active: true, at: at(30) }, B: { active: true, at: at(40) }, C: { active: true, at: at(50) } };
  const m = matchAngels({ rows, volunteers, week: 2, people: angelPeople });
  // F·E는 가장 먼저 지원했지만 자기 1주차 미션을 안 해서 건너뛴다. A는 받는 사람 본인이라 A에게는 못 붙고 다음 차례(F)에게 간다
  assert.deepEqual(m, [{ receiverPid: "A", angelPid: "B", order: 4 }, { receiverPid: "F", angelPid: "A", order: 3 }]);
  // E가 뒤늦게 1주차 미션을 하면(F는 받았으니 대상에서 빠지고) 그때부터 E도 연결될 수 있다
  const late = angelRows({ A: [1], B: [1], C: [1], D: [1], E: [1] });
  assert.deepEqual(matchAngels({ rows: late, volunteers, week: 2, people: angelPeople }), [{ receiverPid: "A", angelPid: "E", order: 2 }]);
  // 그 사람의 마니또는 수호천사가 될 수 없다: A의 마니또 F가 자기 미션을 했더라도(그러면 A는 받았으니 대상이 아니다) — 대상 C로 확인
  const rowsC = angelRows({ A: [1], C: [1], D: [1], E: [1], F: [1] }); // B가 안 해서 C가 받은 게 없다
  const onlyB = matchAngels({ rows: rowsC, volunteers: { B: { active: true, at: at(1) } }, week: 2, people: angelPeople });
  assert.deepEqual(onlyB, [], "B는 자기 미션도 안 했고, C의 마니또이기도 하다");
  // 한 사람에게 한 명씩: 이미 연결된 지원자는 다시 쓰지 않고, 이미 수호천사가 있는 사람은 대상이 아니다
  const again = matchAngels({ rows, volunteers, week: 2, people: angelPeople, angels: { A: { angelPid: "B" } } });
  assert.deepEqual(again, [{ receiverPid: "F", angelPid: "A", order: 3 }]);
  // 운영자가 "다음 순번으로" 넘긴 짝은 다시 붙지 않는다
  const skipped = matchAngels({ rows, volunteers, week: 2, people: angelPeople, skips: { A: ["B"] } });
  assert.deepEqual(skipped, [{ receiverPid: "A", angelPid: "C", order: 5 }, { receiverPid: "F", angelPid: "A", order: 3 }]);
  // 3주차: 1·2주차를 모두 한 지원자만
  const w3 = angelRows({ A: [1], B: [1, 2], C: [1, 2], D: [1, 2] });
  assert.deepEqual(matchAngels({ rows: w3, volunteers, week: 3, people: angelPeople }).map((x) => x.angelPid), ["B", "C"], "A는 2주차를 안 해서 건너뛴다");
  // 운영 화면 표시: 순서와 상태
  assert.deepEqual(angelQueueStatus({ rows, volunteers, week: 2, people: angelPeople, angels: { A: { angelPid: "B" } } }).map((v) => `${v.order}${v.pid}:${v.state}`),
    ["1F:own", "2E:own", "3A:waiting", "4B:linked", "5C:waiting"]);
});

test("보안 규칙의 추첨 칸 이름이 상품 설정(DRAW_ORDER)과 같고, 카드 번호가 규칙의 난이도 표기와 맞는다", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const m = rules.match(/d\.keys\(\)\.hasOnly\(\[([^\]]+)\]\) && d\.keys\(\)\.hasAll\(\[([^\]]+)\]\)/);
  assert.ok(m, "규칙에서 추첨 칸 목록을 찾지 못함");
  const keys = (t) => t.split(",").map((x) => x.trim().replace(/'/g, "")).sort();
  assert.deepEqual(keys(m[1]), DRAW_ORDER.map((x) => x.key).sort(), "prizes.js의 추첨 key를 바꾸면 firestore.rules의 drawsShapeOk도 같이 고친다");
  assert.deepEqual(keys(m[2]), DRAW_ORDER.map((x) => x.key).sort());
  // 카드 번호: 규칙은 e·n·h + 숫자 1~2자리로 난이도를 본다
  const prefix = { easy: "e", normal: "n", hard: "h" };
  for (const [level, cards] of Object.entries(MISSION_CARDS)) {
    for (const c of cards) assert.match(c.id, new RegExp(`^${prefix[level]}[0-9]{1,2}$`), `${level} 카드 번호 ${c.id}`);
  }
});

test("보안 규칙의 추가 쪽지 한도가 EXTRA_NOTES_MAX와 같다", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const limits = [...rules.matchAll(/(?:noteCount\(getAfter\(myMissions\(\)\)\.data, string\(request\.resource\.data\.slot\)\)|n1) <= (\d+)/g)].map((m) => Number(m[1]));
  assert.equal(limits.length, 2, "규칙에서 쪽지 한도 두 곳(deliveries, giverMissions)을 찾지 못함");
  limits.forEach((n) => assert.equal(n, EXTRA_NOTES_MAX));
});

test("보안 규칙의 단서 형식(clueAnswerOk)이 프로필 문항(PROFILE_QUESTIONS)과 같다", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const fn = rules.slice(rules.indexOf("function clueAnswerOk"), rules.indexOf("function clueWriteOk")).replace(/",\s+"/g, '","');
  PROFILE_QUESTIONS.forEach((q, i) => {
    const want = q.options ? `(i == ${i} && a in ${JSON.stringify(q.options)})` : `(i == ${i} && a.trim().size() >= ${q.min || 1})`;
    assert.ok(fn.includes(want), `${i + 1}번 문항이 규칙과 다름: ${want}`);
  });
  assert.equal((fn.match(/\(i == \d/g) || []).length, PROFILE_QUESTIONS.length, "문항 수");
});

test("카드 추가분: 받는 사람이 카드를 보고 '같아요'라고 한 미션만. '달라요'나 확인 없음은 없다", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const base = {
    people, assignments: { A: "B", B: "C", C: "A" }, guesses: {},
    giverCodes: { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } },
    missions: { A: { choices: { 1: HARD, 2: pickCard("hard", 1) } } },
  };
  const red = (cardMatch) => ({ A1: { receiverPid: "B", slot: 1, voided: false, cardMatch: true }, A2: { receiverPid: "B", slot: 2, voided: false, ...(cardMatch === undefined ? {} : { cardMatch }) } });
  const ok = computeTickets({ ...base, redemptions: red(true) });
  const bad = computeTickets({ ...base, redemptions: red(false) });
  const unseen = computeTickets({ ...base, redemptions: red(undefined) });
  assert.deepEqual([ok.A.mission, ok.A.card], [2, 4]);
  assert.deepEqual([bad.A.mission, bad.A.card], [2, 2], "미션 응모권은 그대로, 그 주차 카드 추가분만 빠진다");
  // 완료 알림보다 먼저 인증해서 받는 사람이 카드를 못 봤고 나중에도 확인하지 않은 경우: 추가분이 없다
  // (도전 카드를 골라 놓고 간단한 것만 건넨 뒤 완료를 알리지 않아 확인을 피하는 것을 막는다)
  assert.deepEqual([unseen.A.mission, unseen.A.card], [2, 2]);
});

test("카드 추가분: 쉬움 0, 보통 +1, 도전 +2, 칭찬 카드 0, 합계 최대 4. 난이도는 카드 목록과 대조한다", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const red = (slots) => Object.fromEntries(slots.map((s) => [`A${s}`, { receiverPid: "B", slot: s, voided: false, cardMatch: true }]));
  const run = (choices) => computeTickets({
    people, assignments: { A: "B", B: "C", C: "A" }, guesses: {},
    giverCodes: { A: { 1: "A1", 2: "A2", 3: "A3" } }, redemptions: red([1, 2, 3]),
    missions: { A: { choices } },
  }).A;
  assert.equal(run({ 1: EASY_CARD, 2: pickCard("easy", 1), 3: PRAISE }).card, 0);
  assert.equal(run({ 1: NORMAL, 2: EASY_CARD, 3: PRAISE }).card, 1);
  assert.equal(run({ 1: NORMAL, 2: HARD, 3: PRAISE }).card, 3);
  const best = run({ 1: HARD, 2: pickCard("hard", 1), 3: PRAISE });
  assert.deepEqual([best.mission, best.card, best.total], [3, 4, 7 + 2]); // 미션 3 + 카드 4 + 은신 2
  assert.equal(run({}).card, 0); // 카드를 고르지 않은 채 인증된 미션
  // 위조: 쉬운 카드 번호에 "도전"이라고 적거나, 도전 카드 번호에 쉬운 카드 글을 적거나, 목록에 없는 번호는 추가분이 없다
  assert.equal(cardLevel(HARD), "hard");
  assert.equal(run({ 1: { ...EASY_CARD, level: "hard" }, 2: EASY_CARD }).card, 0, "쉬운 카드를 도전이라고 적음");
  assert.equal(run({ 1: { ...HARD, text: EASY_CARD.text }, 2: EASY_CARD }).card, 0, "도전 카드 번호에 쉬운 카드 글(받는 사람은 쉬운 카드 글을 보고 '같아요'라고 한다)");
  assert.equal(run({ 1: { cardId: "h99", level: "hard", text: "없는 카드" }, 2: EASY_CARD }).card, 0, "목록에 없는 번호");
  assert.equal(run({ 1: { level: "hard" }, 2: EASY_CARD }).card, 0, "번호 없이 난이도만");
});

test("완료 표시는 정확히 true일 때만: 문자열·숫자로 완료처럼 보이게 써도 받는 사람의 보상이 줄지 않는다", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const base = {
    people, assignments: { A: "B", B: "C", C: "A" }, guesses: {},
    giverCodes: { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } },
    redemptions: { B1: { receiverPid: "C", slot: 1, voided: false } }, // B는 자기 미션 1건 인증(보상 조건)
  };
  // A가 아무것도 보내지 않고 완료 표시만 위조: B는 못 받은 3주 보상을 그대로 받는다
  const faked = computeTickets({ ...base, missions: { A: { done: { 1: "yes", 2: 1, 3: 1 } } } });
  assert.equal(faked.B.comp, 3);
  const real = computeTickets({ ...base, missions: { A: { done: { 1: true } } } });
  assert.equal(real.B.comp, 2, "진짜 완료 표시(true)는 완료를 알린 주차로 친다");
  const rows = pairRows({ assignments: { A: { receiverPid: "B" } }, missions: { A: { done: { 1: "yes", 2: true } } } });
  assert.deepEqual([rows[0].slots[1].done, rows[0].slots[2].done], [false, true]);
});

test("알아챈 주차: 최종 지목이 맞고, 중간 추측을 끝까지 계속 맞힌 첫 주차", () => {
  const assignments = { A: "B", B: "C", C: "D", D: "A" }; // B의 마니또 A, C의 마니또 B, D의 마니또 C, A의 마니또 D
  const mid = {
    B: { 1: "A", 2: "A", 3: "A" }, // 1주차부터 계속
    C: { 1: "B", 2: "D", 3: "B" }, // 2주차에 바꿨다가 3주차에 다시 → 3주차부터
    D: { 1: "C" }, // 1주차에 맞혔지만 2·3주차를 비움 → 최종에서야(4)
    A: { 1: "D", 2: "D", 3: "D" }, // 계속 맞혔지만 최종 지목이 틀림 → 없음
  };
  const guesses = { B: "A", C: "B", D: "C", A: "B" };
  assert.deepEqual(noticedWeeks(assignments, mid, guesses), { B: 1, C: 3, D: 4 });
  assert.deepEqual(noticedWeeks(assignments, {}, {}), {});
});

test("발표 화면: 짝은 원을 따라 잇고(공개된 마니또가 다음 주인공), 장면은 짝마다 질문·정답 두 장", () => {
  const pairs = [{ giverPid: "A", receiverPid: "B" }, { giverPid: "B", receiverPid: "C" }, { giverPid: "C", receiverPid: "A" },
    { giverPid: "X", receiverPid: "Y" }, { giverPid: "Y", receiverPid: "X" }]; // 근무지별 원 두 개(가정)
  const chain = pairChain(pairs);
  assert.deepEqual(chain.map((p) => `${p.receiverPid}<-${p.giverPid}`), ["A<-C", "C<-B", "B<-A", "X<-Y", "Y<-X"]);
  const r = { pairs, partBoard: [{ part: "가" }], praises: [{}], bestReview: { review: "x" } };
  const slides = buildSlides(r, (x) => x);
  assert.equal(slides.filter((x) => x.type === "pairAsk").length, 5);
  assert.equal(slides.filter((x) => x.type === "pairShow").length, 5);
  // 추첨은 숫자 넣는 장면 하나, 발표는 6등 → 5등 → 4등 → 3등(후기상) → 2등(3명, 응모권 적은 순부터) → 1등
  const tail = slides.slice(slides.findIndex((x) => x.type === "drawGo")).map((x) => x.id);
  assert.deepEqual(tail, ["drawGo", "draw_t6", "draw_t5", "draw_t4", "bestReview", "best2", "best1", "best0", "draw_grand", "end"]);
  // 장면 수는 추첨 전후가 같다(step이 장면 번호라서)
  assert.equal(buildSlides({ ...r, draws: { best: { seed: "1", winners: ["A"] } } }, (x) => x).length, slides.length);
  assert.equal(slides[0].type, "intro");
  assert.equal(slides.at(-1).type, "end");
  // 참여자 화면: 넘긴 장면까지만, step이 없는 예전 결과는 모두
  assert.equal(revealedUpTo({ step: 0 }, slides), 1);
  assert.equal(revealedUpTo({ step: 999 }, slides), slides.length);
  assert.equal(revealedUpTo({}, slides), slides.length);
});

test("일정: 단서 공개 날이 단서 수 ÷ 2번(주차마다 2개)이고 날짜 순서대로, 모두 금요일", () => {
  assert.equal(CLUE_DATES.length, CLUE_COUNT / 2);
  assert.ok(CLUE_DATES.every((d) => d.endsWith("(금)")), CLUE_DATES.join(", "));
  const dates = SCHEDULE.map((e) => e.date);
  assert.deepEqual(dates, [...dates].sort(), "일정은 날짜 순서대로");
});

test("수호천사: 확인된 미션 1건마다 +1(최대 2), 받는 사람은 인증 입력으로 치되 보상과 합쳐 3장까지", () => {
  // A → B → C → D → A. B의 마니또 A가 아무것도 안 함. D가 수호천사로 B에게 연결됨
  const people = ["A", "B", "C", "D"].map((pid) => ({ pid }));
  const base = {
    people, assignments: { A: "B", B: "C", C: "D", D: "A" }, guesses: {}, missions: {},
    giverCodes: { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" } },
    redemptions: { B1: { receiverPid: "C", slot: 1, voided: false } }, // B는 자기 미션 1건이 인증됨(보상 조건)
  };
  const none = computeTickets(base);
  assert.deepEqual([none.B.entries, none.B.comp], [0, 3], "수호천사가 없으면 못 받은 3주 보상");
  const gifts = [{ receiverPid: "B", k: 1, confirmed: true }, { receiverPid: "B", k: 2, confirmed: true }];
  const t = computeTickets({ ...base, angels: { B: "D" }, angelGifts: gifts });
  assert.deepEqual([t.B.entries, t.B.comp], [2, 1], "확인 2건은 인증 입력, 보상은 남은 1장만(합계 3 그대로)");
  assert.equal(t.D.angel, 2);
  assert.equal(t.D.total, 2, "수호천사 응모권만(D는 자기 미션이 없어 은신 없음)");
  assert.equal(t.D.mission, 0, "수호천사 미션은 내 미션 수에 들어가지 않는다");
  // 확인 안 된 것, 연결이 없는 것은 세지 않는다
  const half = computeTickets({ ...base, angels: { B: "D" }, angelGifts: [{ receiverPid: "B", k: 1, confirmed: true }, { receiverPid: "B", k: 2 }] });
  assert.deepEqual([half.D.angel, half.B.entries], [1, 1]);
  const unlinked = computeTickets({ ...base, angelGifts: gifts });
  assert.deepEqual([unlinked.D.angel, unlinked.B.entries], [0, 0]);
  // 수상 제외된 수호천사는 0장
  const dq = computeTickets({ ...base, people: people.map((x) => (x.pid === "D" ? { ...x, disqualified: true } : x)), angels: { B: "D" }, angelGifts: gifts });
  assert.equal(dq.D.total, 0);
  // 한 사람이 두 명을 도와도 최대 2장
  const two = computeTickets({ ...base, angels: { B: "D", C: "D" }, angelGifts: [...gifts, { receiverPid: "C", k: 1, confirmed: true }] });
  assert.equal(two.D.angel, 2);
});

test("발표 화면: 수호천사가 있으면 명탐정 다음에 '숨은 수호천사' 장면", () => {
  const r = { pairs: [{ giverPid: "A", receiverPid: "B" }, { giverPid: "B", receiverPid: "A" }], angels: [{ angelPid: "A", receiverPid: "B", done: 1 }] };
  const ids = buildSlides(r, (x) => x).map((x) => x.id);
  assert.equal(ids[ids.indexOf("detective") + 1], "angels");
  assert.ok(!buildSlides({ ...r, angels: [] }, (x) => x).some((x) => x.id === "angels"));
});
