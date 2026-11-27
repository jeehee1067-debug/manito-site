import test from "node:test";
import assert from "node:assert/strict";
import { assignManito, assignmentMemo, generateCodes } from "../src/lib/assign.js";
import { angelQueue, needyReceivers, matchAngels, angelQueueStatus } from "../src/lib/angels.js";
import { pickBestReview, rankReviews, reviewLikes, missionLikes, cardLevel, cardCost, computeTickets, weightedDraw, partStandings, weeklyPartBoard, seededDraw, seededTop, resolvePrizes, drawOnline, verifyOnline, PRIZE_ORDER, PAPER_TIERS, ONLINE_PRIZE, noticedWeeks } from "../src/lib/scoring.js";
import { pairChain, buildSlides, revealedUpTo } from "../src/lib/reveal.js";
import { readFileSync } from "node:fs";
import { seededRandom } from "../src/lib/random.js";
import { parseRosterLine, rosterSummary, summaryToList, sameSummary } from "../src/lib/roster.js";
import { PRIZES, TICKET_RULES } from "../src/config/prizes.js";
import { DEAL_COUNT, dealCards } from "../src/lib/cards.js";
import { CARD_HOW, MISSION_CARDS, PROFILE_QUESTIONS, cardHow, findCard, CLUE_COUNT, EXTRA_NOTES_MAX, CLUE_DATES, SCHEDULE, daysBetween, profileAnswerError } from "../src/lib/constants.js";
import { cardPicks, codeProblems, pairRows, receiverCodesOf, sameCodes, unresolvedSlots } from "../src/lib/pairs.js";

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

test("명단 입력 한 줄: 이름, 파트, 아이디(쉼표나 탭). 아이디에 회사 메일 도메인을 붙이고, 잘못된 아이디는 알려 준다", () => {
  const D = "corp.example";
  assert.deepEqual(parseRosterLine("홍길동, 공정파트, Gildong.Hong", D), { name: "홍길동", part: "공정파트", email: "gildong.hong@corp.example", bad: null });
  assert.deepEqual(parseRosterLine("김철수\t소자파트\tcs.kim", D), { name: "김철수", part: "소자파트", email: "cs.kim@corp.example", bad: null }, "엑셀에서 붙여 넣은 탭 구분");
  assert.deepEqual(parseRosterLine("이영희,,yh_lee1", D), { name: "이영희", part: null, email: "yh_lee1@corp.example", bad: null }, "파트는 비울 수 있다");
  assert.deepEqual(parseRosterLine("박민수,소자파트", D), { name: "박민수", part: "소자파트", email: null, bad: null }, "아이디가 없으면 초대 코드로만 가입");
  assert.deepEqual(parseRosterLine("최지우,공정파트,jw@other.example", D).email, "jw@other.example", "전체 주소를 적으면 그대로");
  // 예전 형식("이름,근무지,파트")이나 한글·공백이 든 아이디는 받지 않는다
  assert.equal(parseRosterLine("가나,SR3,가파트", D).bad, "가파트");
  assert.equal(parseRosterLine("가나,가파트,ga na", D).bad, "ga na");
  assert.equal(parseRosterLine("가나,가파트,@", D).bad, "@");
  assert.equal(parseRosterLine("가나,가파트,ga@na", D).bad, "ga@na", "도메인에 점이 없는 주소");
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

test("미션 카드: 난이도 기준(쪽지만으로 끝나는 도전은 3일 연속·알아내 맞혀 보기뿐), 손편지 없음, 알아내기는 방법 자유", () => {
  const all = Object.entries(MISSION_CARDS).flatMap(([level, list]) => list.map((c) => ({ level, ...c })));
  const find = (re) => all.filter((c) => re.test(c.text));
  assert.deepEqual(find(/삼행시 쪽지/).map((c) => [c.level, c.remote, Boolean(c.cost)]), [["normal", true, false]]);
  assert.deepEqual(find(/3일 연속/).map((c) => c.level), ["hard"]);
  // 쪽지만으로 끝나는(실물이 아닌) 도전 카드는 3일 연속과 "알아내 맞혀 보기"(guess, 틀리면 추가분 없음)뿐
  const noteOnlyHard = MISSION_CARDS.hard.filter((c) => !c.real);
  assert.ok(noteOnlyHard.every((c) => /3일 연속/.test(c.text) || (c.guess && /맞혀 보기/.test(c.text) && /틀리면 카드 추가분 없음/.test(c.text))), noteOnlyHard.map((c) => c.id).join());
  // 알아내기 카드: 모두 도전, 방법은 자유("직접 묻지 않기" 같은 제한 없음)
  const guesses = all.filter((c) => c.guess);
  assert.ok(guesses.length >= 5 && guesses.every((c) => c.level === "hard" && /방법은 자유/.test(c.text)));
  assert.deepEqual(find(/직접 묻지 않기|몰래 알아내/), []);
  assert.deepEqual(find(/서랍|가방|이상형|손편지|편지/), [], "남의 서랍·가방, 이상형, 긴 편지는 넣지 않는다");
  assert.ok(all.filter((c) => c.cost).every((c) => c.real), "돈이 드는 카드는 모두 실물");
  assert.ok(MISSION_CARDS.easy.every((c) => !c.real && !c.cost && !c.guess));
  const ids = all.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "카드 번호 중복 없음");
});

test("카드 뽑기: 두 장, 사람·주차마다 고정, 보통·도전은 비용 카드 한 장 + 무비용 한 장, 모든 카드가 누군가에게 나옴", () => {
  const seen = { easy: new Set(), normal: new Set(), hard: new Set() };
  for (let i = 1; i <= 54; i++) {
    for (const slot of [1, 2, 3]) {
      for (const level of ["easy", "normal", "hard"]) {
        for (const remote of [false, true]) {
          const hand = dealCards(`p${i}`, slot, level, remote);
          assert.equal(hand.length, DEAL_COUNT);
          assert.equal(new Set(hand.map((c) => c.id)).size, DEAL_COUNT, "서로 다른 카드");
          assert.ok(hand.every((c) => c.level === level && MISSION_CARDS[level].some((m) => m.id === c.id && m.text === c.text)));
          assert.ok(hand.some((c) => !c.cost), "무비용 카드가 한 장은 있다");
          // 돈이 드는 카드가 있는 묶음(보통·도전, 다른 근무지는 도전만)에서는 꼭 한 장(사용자가 정함: 모두에게 비용 카드가 나오게)
          const hasCost = MISSION_CARDS[level].some((m) => m.cost && (!remote || m.remote));
          assert.equal(hand.filter((c) => c.cost).length, hasCost ? 1 : 0, `${level}${remote ? " 원격" : ""}: 비용 카드 한 장`);
          // 실물 카드가 있는 묶음(보통·도전, 다른 근무지는 도전만)에서는 한 장이 꼭 실물이다
          const hasReal = MISSION_CARDS[level].some((m) => m.real && (!remote || m.remote));
          assert.equal(hand.some((c) => c.real), hasReal, `${level}${remote ? " 원격" : ""}: 실물 카드`);
          if (remote) assert.ok(hand.every((c) => c.remote), "다른 근무지면 원격 카드만");
          assert.deepEqual(dealCards(`p${i}`, slot, level, remote), hand, "다시 불러도 같은 카드");
          if (!remote) hand.forEach((c) => seen[level].add(c.id));
        }
      }
    }
  }
  for (const [level, cards] of Object.entries(MISSION_CARDS)) assert.equal(seen[level].size, cards.filter((c) => !c.gold).length, `${level}: 54명·3주에 모든 카드가 한 번은 나온다(황금 카드는 따로)`);
  assert.ok(MISSION_CARDS.normal.some((c) => c.real && !c.cost), "보통에 돈이 안 드는 실물 카드가 있다");
  assert.ok(MISSION_CARDS.hard.some((c) => c.real && !c.cost), "도전에 돈이 안 드는 실물 카드가 있다");
  // 다른 주차에 고른 카드는 다시 나오지 않는다(비용 카드 한 장 + 무비용 한 장은 그대로)
  for (let i = 1; i <= 54; i++) {
    for (const level of ["normal", "hard"]) {
      const first = dealCards(`p${i}`, 1, level);
      const taken = first.map((c) => c.id); // 두 장 다 이미 했다고 쳐도
      const next = dealCards(`p${i}`, 2, level, false, taken);
      assert.ok(next.every((c) => !taken.includes(c.id)), `${level}: 이미 고른 카드가 또 나옴`);
      assert.equal(next.filter((c) => c.cost).length, 1);
      assert.equal(next.length, DEAL_COUNT);
    }
  }
  // 주차가 다르면 다른 카드가 나오는 사람이 있다(매주 같은 카드만 나오지 않는다)
  assert.ok(Array.from({ length: 54 }, (_, i) => `p${i + 1}`).some((p) => dealCards(p, 1, "normal")[0].id !== dealCards(p, 2, "normal")[0].id));
});

test("2주차 새 카드: 1주차에는 안 나오고, 2·3주차 쉬움·보통은 두 장 중 한 장이 새 카드, 황금 카드는 일반 도전 두 장에 안 나온다", async () => {
  const { goldDeal } = await import("../src/lib/cards.js");
  const { isNewCard } = await import("../src/lib/constants.js");
  const fresh = Object.values(MISSION_CARDS).flat().filter((c) => (c.from || 1) >= 2 && !c.gold);
  assert.deepEqual(fresh.map((c) => c.id), ["e7", "n11", "n12", "n13"]);
  for (let i = 1; i <= 54; i++) {
    for (const remote of [false, true]) {
      for (const level of ["easy", "normal", "hard"]) {
        const w1 = dealCards(`p${i}`, 1, level, remote);
        assert.ok(w1.every((c) => (c.from || 1) === 1 && !c.gold), "1주차에는 새 카드·황금 카드가 없다");
        for (const slot of [2, 3]) {
          const hand = dealCards(`p${i}`, slot, level, remote);
          assert.ok(hand.every((c) => !c.gold), "황금 카드는 일반 카드 두 장에 안 나온다");
          if (level !== "hard") assert.equal(hand.filter((c) => isNewCard(c)).length, 1, `${level}: 두 장 중 한 장이 새 카드`);
        }
      }
    }
  }
  // 2주차에 새 카드를 했으면 3주차에는 다른 새 카드(보통은 3장이라 남아 있다)
  const w2 = dealCards("p1", 2, "normal").find((c) => isNewCard(c));
  assert.ok(dealCards("p1", 3, "normal", false, [w2.id]).every((c) => c.id !== w2.id));
  // 1주차에 나오는 두 장은 새 카드를 넣기 전과 같다(1주차는 11/24 12:00까지 열려 있다) — 새 카드가 목록에 없으므로 섞는 대상이 같다
  assert.equal(dealCards("p1", 1, "easy").length, 2);
  void goldDeal;
});

test("황금 카드: 도전 등급, 2주차부터, 두 장(돈 안 드는 것 + 드는 것), 다른 근무지는 원격 카드만", async () => {
  const { goldDeal } = await import("../src/lib/cards.js");
  const { isGoldCard } = await import("../src/lib/constants.js");
  const gold = MISSION_CARDS.hard.filter((c) => c.gold);
  assert.deepEqual(gold.map((c) => c.id), ["h14", "h15", "h16"]);
  assert.ok(gold.every((c) => c.real && (c.from || 1) >= 2), "모두 실물, 2주차부터");
  assert.ok(Object.entries(MISSION_CARDS).every(([lv, cards]) => lv === "hard" || cards.every((c) => !c.gold)), "황금 카드는 도전에만");
  for (let i = 1; i <= 54; i++) {
    assert.deepEqual(goldDeal(`p${i}`, 1), [], "1주차에는 없다");
    for (const slot of [2, 3]) {
      for (const remote of [false, true]) {
        const hand = goldDeal(`p${i}`, slot, remote);
        assert.equal(hand.length, 2);
        assert.ok(hand.every((c) => c.gold && c.level === "hard" && isGoldCard(c)));
        assert.equal(hand.filter((c) => c.cost).length, 1, "돈이 드는 것 한 장");
        assert.equal(hand.filter((c) => !c.cost).length, 1, "돈이 안 드는 것 한 장(돈을 안 써도 같은 추첨 기회)");
        if (remote) assert.ok(hand.every((c) => c.remote), "다른 근무지면 원격 카드만");
        else assert.ok(hand.every((c) => !c.remoteOnly), "같은 근무지에는 다른 근무지용(공범 카페)이 안 나온다");
        assert.deepEqual(goldDeal(`p${i}`, slot, remote), hand, "다시 불러도 같은 카드");
      }
    }
  }
  // 완료 알림에는 번호가 없어서 글로도 찾는다
  assert.ok(isGoldCard({ level: "hard", text: gold[0].text }));
  assert.ok(!isGoldCard({ level: "hard", text: MISSION_CARDS.hard[0].text }));
});

test("황금 카드 추첨: 황금 카드를 완료하고 대상이 '카드와 같아요'로 인증한 마니또만, 앞 주 당첨자 제외, 남은 자리는 다음 주로", async () => {
  const { goldCandidates, goldCount, drawGold, goldWeekClosed } = await import("../src/lib/gold.js");
  const { GOLD_DRAW } = await import("../src/config/prizes.js");
  const gold = { cardId: "h14", level: "hard", text: "x" }, plain = { cardId: "h1", level: "hard", text: "y" };
  const roster = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"].map((pid) => ({ pid, uid: `u${pid}` }));
  roster.push({ pid: "p8" }); // 가입 안 함
  roster.find((r) => r.pid === "p6").dropout = true;
  roster.find((r) => r.pid === "p7").disqualified = true;
  const missions = {
    p1: { choices: { 2: gold }, done: { 2: true } }, // 대상: 인증·카드 같음
    p2: { choices: { 2: gold }, done: { 2: true } }, // 인증했지만 카드와 다름
    p3: { choices: { 2: gold }, done: { 2: true } }, // 아직 인증 안 됨
    p4: { choices: { 2: plain }, done: { 2: true } }, // 일반 도전
    p5: { choices: { 2: gold } }, // 완료를 안 알림
    p6: { choices: { 2: gold }, done: { 2: true } }, // 중도 이탈
    p7: { choices: { 2: gold }, done: { 2: true } }, // 수상 제외
    p8: { choices: { 2: gold }, done: { 2: true } },
  };
  const giverCodes = Object.fromEntries(Object.keys(missions).map((pid) => [pid, { codes: { 2: `C${pid}` } }]));
  const redemptions = { Cp1: { cardMatch: true }, Cp2: { cardMatch: false }, Cp4: { cardMatch: true }, Cp5: { cardMatch: true }, Cp6: { cardMatch: true }, Cp7: { cardMatch: true }, Cp8: { cardMatch: true } };
  assert.deepEqual(goldCandidates({ week: 2, missions, giverCodes, redemptions, roster }), ["p1"]);
  assert.deepEqual(goldCandidates({ week: 2, missions, giverCodes, redemptions: { ...redemptions, Cp1: { cardMatch: true, voided: true } }, roster }), [], "무효 처리된 인증은 빠진다");
  assert.deepEqual(goldCandidates({ week: 2, missions, giverCodes, redemptions, roster, exclude: ["p1"] }), [], "앞 주 당첨자는 빠진다");
  // 몇 명
  assert.equal(GOLD_DRAW.perWeek, 5);
  assert.equal(goldCount(2, {}), 5);
  assert.equal(goldCount(3, {}), 5, "앞 주 추첨이 없으면 넘기는 자리 없음");
  assert.equal(goldCount(3, { 2: { winners: ["a", "b"] } }), 8, "2주차에 2명만 뽑혔으면 3주차는 5 + 3");
  assert.equal(goldCount(3, { 2: { winners: ["a", "b", "c", "d", "e"] } }), 5);
  // 뽑기: 같은 숫자면 같은 결과, 대상 순서와 무관, 대상보다 많이 뽑지 않는다
  const c = ["p3", "p1", "p9", "p4", "p2", "p7", "p8"];
  assert.deepEqual(drawGold(c, 5, "123"), drawGold([...c].reverse(), 5, "123"));
  assert.equal(new Set(drawGold(c, 5, "123")).size, 5);
  assert.deepEqual(drawGold(["p2", "p1"], 5, "1").sort(), ["p1", "p2"]);
  assert.ok(Array.from({ length: 20 }, (_, k) => drawGold(c, 1, String(k))[0]).some((x) => x !== drawGold(c, 1, "0")[0]), "숫자가 다르면 결과가 달라진다");
  // 그 주가 끝났는지
  assert.equal(goldWeekClosed(2, { phase: 1, week: 2 }), false);
  assert.equal(goldWeekClosed(2, { phase: 1, week: 3 }), true);
  assert.equal(goldWeekClosed(3, { phase: 1, week: 3 }), false);
  assert.equal(goldWeekClosed(3, { phase: 2, week: 3 }), true);
});

test("황금 카드 결과 팝업: 황금 카드를 완료한 주차 중 추첨이 끝났고 아직 안 본 것만, 당첨·미당첨 구분", async () => {
  const { goldPopups } = await import("../src/lib/gold.js");
  const gold = { cardId: "h15", level: "hard", text: "x" };
  const missions = { choices: { 2: gold, 3: gold }, done: { 2: true, 3: true } };
  assert.deepEqual(goldPopups({ missions, draws: {}, wins: {} }), [], "추첨 전에는 없음");
  assert.deepEqual(goldPopups({ missions, draws: { 2: { winners: 5 } }, wins: { 2: true } }), [{ week: 2, won: true }]);
  assert.deepEqual(goldPopups({ missions, draws: { 2: { winners: 5 } }, wins: {} }), [{ week: 2, won: false }], "뽑히지 않았으면 위로 팝업");
  assert.deepEqual(goldPopups({ missions, draws: { 2: {}, 3: {} }, wins: { 3: true }, seen: [2] }), [{ week: 3, won: true }], "이미 본 주차는 다시 안 뜬다");
  assert.deepEqual(goldPopups({ missions: { choices: { 2: { cardId: "h1", level: "hard", text: "y" } }, done: { 2: true } }, draws: { 2: {} }, wins: {} }), [], "황금 카드를 안 한 사람에게는 안 뜬다");
  assert.deepEqual(goldPopups({ missions: { choices: { 2: gold } }, draws: { 2: {} }, wins: {} }), [], "고르기만 하고 완료를 안 알렸으면 안 뜬다");
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

test("사이트 추첨(6등): 현장 숫자와 응모권만으로 결과가 정해지고, 누구나 다시 계산해 검증할 수 있다", () => {
  const tickets = Object.fromEntries(pids.slice(0, 20).map((pid, i) => [pid, (i % 4) + 1]));
  tickets.zero = 0;
  const step = { key: "t4", count: 5 };
  const a = seededDraw(tickets, step, "4821");
  assert.deepEqual(a, seededDraw({ ...Object.fromEntries(Object.entries(tickets).reverse()) }, step, " 4821 "), "응모권 순서·앞뒤 공백과 무관하게 같다");
  assert.notDeepEqual(a, seededDraw(tickets, step, "4822"), "숫자가 다르면 결과가 다르다");
  assert.ok(!a.includes("zero"), "0장은 뽑히지 않는다");

  // 6등: 1~5등을 받은 사람을 빼고 뽑는다
  const all = Object.fromEntries(pids.map((pid, i) => [pid, (i % 16) + 1]));
  const draws = { seed: " 2026 ", grand: { winners: [pids[3]] }, t4: { winners: pids.slice(10, 14) }, t5: { winners: pids.slice(20, 27) } };
  const res = resolvePrizes({ tickets: all, draws });
  assert.equal(res.seed, "2026", "숫자는 앞뒤 공백을 빼고 쓴다");
  assert.equal(res.t6, null, "6등은 뽑기 전");
  const t6 = drawOnline(all, res.seed, res.taken);
  assert.equal(t6.length, ONLINE_PRIZE.count);
  assert.ok(t6.every((pid) => !res.taken.has(pid)), "1~5등 수상자는 6등에 뽑히지 않는다");
  const saved = { ...draws, t6: { winners: t6 } };
  assert.equal(verifyOnline({ tickets: all, draws: saved }).ok, true);
  // 당첨자를 바꿔 저장했거나, 응모권 수·종이 추첨 이름을 바꿨으면 검증에서 드러난다
  const other = pids.find((pid) => !t6.includes(pid) && !res.taken.has(pid));
  assert.equal(verifyOnline({ tickets: all, draws: { ...saved, t6: { winners: [other, ...t6.slice(1)] } } }).ok, false);
  assert.equal(verifyOnline({ tickets: { ...all, [t6[0]]: 0 }, draws: saved }).ok, false);
  assert.equal(verifyOnline({ tickets: all, draws: { ...saved, seed: "2027" } }).ok, false);
  assert.equal(verifyOnline({ tickets: all, draws }), null, "아직 안 뽑았으면 검증할 것이 없다");
});

test("시상: 한 사람은 하나만. 2등은 응모권 최다, 3등은 2등 수상자를 뺀 공감 1위, 4·5등은 종이로 뽑힌 이름", () => {
  // 54명: 응모권 1~16장 (p016·p032·p048이 16장, p015·p031·p047이 15장)
  const tickets = Object.fromEntries(pids.map((pid, i) => [pid, (i % 16) + 1]));
  const top3 = [pids[15], pids[31], pids[47]];
  const reviews = [{ code: "A", review: "가", receiverPid: pids[15], likes: 9 }, { code: "B", review: "나", receiverPid: pids[1], likes: 5 }, { code: "C", review: "다", receiverPid: pids[2], likes: 3 }];
  // 숫자를 넣기 전에는 2·3등이 정해지지 않는다
  const none = resolvePrizes({ tickets, reviews, draws: {} });
  assert.deepEqual([none.seed, none.best, none.review], [null, [], null]);
  // 숫자를 넣으면 2등(응모권 최다 3명)과 3등(2등 수상자를 뺀 공감 1위)이 정해진다
  const a = resolvePrizes({ tickets, reviews, draws: { seed: "7" } });
  assert.deepEqual([...a.best].sort(), [...top3].sort());
  assert.equal(a.review.receiverPid, pids[1], "공감 1위(p016)는 2등 수상자라 다음 순위가 3등");
  assert.deepEqual(a.open, { grand: 1, t4: PRIZES.tiers[0].count, t5: PRIZES.tiers[1].count });
  // 종이로 뽑힌 이름: 응모권이 없는 사람·중복·이미 받은 사람은 들어가지 않는다(다시 뽑아야 한다)
  const t4 = [pids[5], pids[5], "nobody", top3[0], pids[6], pids[7], pids[8]];
  const b = resolvePrizes({ tickets: { ...tickets, zero: 0 }, reviews, draws: { seed: "7", t4: { winners: [...t4, "zero"] }, t5: { winners: [pids[5], pids[9]] } } });
  assert.deepEqual(b.t4, [pids[5], pids[6], pids[7], pids[8]]);
  assert.deepEqual(b.dropped.t4, [top3[0]], "2등 수상자가 종이로 뽑히면 빠진다");
  assert.deepEqual(b.t5, [pids[9]], "4등을 받은 사람은 5등에 들어가지 않는다");
  assert.equal(b.open.t4, 0);
  assert.equal(b.open.t5, PRIZES.tiers[1].count - 1);
  const winners = [...b.grand, ...b.best, b.review.receiverPid, ...b.t4, ...b.t5];
  assert.equal(new Set(winners).size, winners.length, "상이 겹치는 사람 없음");
  assert.deepEqual([...b.taken].sort(), [...winners].sort());
  // 응모권 있는 사람이 모자라면 더 뽑을 자리도 그만큼만
  const few = resolvePrizes({ tickets: { a: 3, b: 2, c: 1, d: 1, zero: 0 }, draws: { seed: "5" } });
  assert.deepEqual([few.best.length, few.open.t4, few.open.t5], [3, 1, 1]);
});

test("시상: 1등은 겹쳐도 뽑고, 겹친 자리는 다시 채운다(2등은 다음 순위, 3등은 다음 후기, 4·5등은 다시 뽑기)", () => {
  const tickets = Object.fromEntries(pids.map((pid, i) => [pid, (i % 16) + 1]));
  const top3 = [pids[15], pids[31], pids[47]], next3 = [pids[14], pids[30], pids[46]]; // 16장 3명, 15장 3명
  const reviews = [{ code: "A", review: "가", receiverPid: pids[1], likes: 9 }, { code: "B", review: "나", receiverPid: pids[2], likes: 5 }, { code: "C", review: "다", receiverPid: pids[3], likes: 3 }];
  const paper = { t4: { winners: [pids[5], pids[6], pids[7], pids[8]] }, t5: { winners: pids.slice(20, 27) } };
  const view = (draws, withGrand = true) => resolvePrizes({ tickets, reviews, draws: { seed: "7", ...paper, ...draws }, withGrand });
  // ① 1등이 아무 상도 없던 사람: 그대로
  const plain = view({ grand: { winners: [pids[40]] } });
  assert.deepEqual([plain.grand, [...plain.best].sort(), plain.review.receiverPid, plain.t4, plain.open.t4], [[pids[40]], [...top3].sort(), pids[1], paper.t4.winners, 0]);
  // ② 1등이 2등 수상자: 1등만 받고, 2등은 다음 순위(15장 중 한 명)가 받는다
  const g2 = view({ grand: { winners: [top3[0]] } });
  assert.ok(!g2.best.includes(top3[0]) && g2.best.length === 3);
  assert.ok(next3.includes(g2.best.find((pid) => !top3.includes(pid))), "다음 순위는 응모권 15장인 사람");
  // 1등을 뽑기 전 모습(발표 순서상 앞 장면)은 그대로 볼 수 있다
  assert.deepEqual([...view({ grand: { winners: [top3[0]] } }, false).best].sort(), [...top3].sort());
  assert.deepEqual(view({ grand: { winners: [top3[0]] } }, false).grand, []);
  // ③ 1등이 3등 수상자: 다음으로 공감이 많은 후기가 3등
  assert.equal(view({ grand: { winners: [pids[1]] } }).review.receiverPid, pids[2]);
  // ④ 1등이 4등 수상자: 4등 한 자리가 비고(다시 뽑아야 함), 새로 뽑은 이름이 들어간다
  const g4 = view({ grand: { winners: [pids[5]] } });
  assert.deepEqual([g4.t4, g4.dropped.t4, g4.open.t4], [[pids[6], pids[7], pids[8]], [pids[5]], 1]);
  const refilled = view({ grand: { winners: [pids[5]] }, t4: { winners: [...paper.t4.winners, pids[41]] } });
  assert.deepEqual([refilled.t4, refilled.open.t4], [[pids[6], pids[7], pids[8], pids[41]], 0]);
  assert.deepEqual(view({ grand: { winners: [pids[5]] }, t4: { winners: [...paper.t4.winners, pids[41]] } }, false).t4, paper.t4.winners, "1등을 뽑기 전 모습에는 다시 뽑은 이름이 없다");
  // ⑤ 2등 다음 순위가 이미 5등으로 뽑힌 사람이면: 더 큰 상(2등)으로 올라가고 5등 자리를 다시 뽑는다
  const paper5 = { t5: { winners: [...next3, pids[20], pids[21], pids[22], pids[23]] } };
  const before = view(paper5);
  assert.deepEqual(before.t5, paper5.t5.winners);
  const after = view({ ...paper5, grand: { winners: [top3[0]] } });
  const promoted = after.best.find((pid) => !top3.includes(pid));
  assert.ok(next3.includes(promoted));
  assert.ok(!after.t5.includes(promoted) && after.dropped.t5.includes(promoted) && after.open.t5 === 1, "올라간 사람의 5등 자리는 다시 뽑는다");
  // 어느 경우에도 상이 겹치는 사람은 없다
  for (const r of [plain, g2, g4, refilled, after]) {
    const all = [...r.grand, ...r.best, r.review?.receiverPid, ...r.t4, ...r.t5].filter(Boolean);
    assert.equal(new Set(all).size, all.length);
  }
});

test("2등: 응모권이 많은 순, 1등을 받은 사람은 빠지고 다음 사람이 올라온다. 경계에서 동점이면 숫자로 가른다", () => {
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
});

test("비용 카드: 돈이 드는 카드 미션을 대상이 카드와 같다고 확인하면 +1장, 여러 번 해도 한 번만", () => {
  const costCards = Object.entries(MISSION_CARDS).flatMap(([level, cards]) => cards.filter((c) => c.cost).map((c) => ({ cardId: c.id, level, text: c.text })));
  const freeHard = MISSION_CARDS.hard.find((c) => !c.cost);
  assert.ok(costCards.length >= 2 && freeHard);
  const [c1, c2] = costCards;
  const base = {
    people: [{ pid: "A" }, { pid: "B" }], assignments: { A: "B", B: "A" },
    giverCodes: { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" } }, guesses: {}, deliveries: [],
  };
  const run = (choices, reds) => computeTickets({ ...base, redemptions: reds, missions: { A: { choices, done: { 1: true, 2: true } } } }).A;
  const red = (slot, cardMatch) => ({ receiverPid: "B", slot, voided: false, ...(cardMatch === undefined ? {} : { cardMatch }) });
  assert.equal(cardCost(c1), true);
  assert.equal(cardCost({ cardId: freeHard.id, level: "hard", text: freeHard.text }), false);
  assert.equal(cardCost({ ...c1, text: "다른 글" }), false, "카드 목록과 다르면 인정하지 않는다");
  // 한 번 하면 +1
  assert.equal(run({ 1: c1 }, { A1: red(1, true) }).cost, TICKET_RULES.costBonus);
  // 두 번 해도 +1
  const twice = run({ 1: c1, 2: c2 }, { A1: red(1, true), A2: red(2, true) });
  assert.equal(twice.cost, TICKET_RULES.costBonus);
  assert.equal(twice.total, twice.mission + twice.card + twice.cost + twice.entries + twice.comp + twice.hidden + twice.guess + twice.partBonus + twice.angel);
  // 대상이 "카드와 달라요"로 인증했거나 카드를 확인하지 않았으면 없다. 돈이 안 드는 카드도 없다
  assert.equal(run({ 1: c1 }, { A1: red(1, false) }).cost, 0);
  assert.equal(run({ 1: c1 }, { A1: red(1) }).cost, 0);
  assert.equal(run({ 1: { cardId: freeHard.id, level: "hard", text: freeHard.text } }, { A1: red(1, true) }).cost, 0);
  // 대상의 인증 없이 운영자 확인으로 인정된 미션에도 없다
  assert.equal(computeTickets({ ...base, redemptions: {}, missions: { A: { choices: { 1: c1 }, done: { 1: true } } }, deliveries: [{ receiverPid: "B", slot: 1, kind: "mission" }], verdicts: { B_1: "received" } }).A.cost, 0);
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
  // 시상에도 같은 기준이 들어간다: 1등을 받은 사람을 뺀 공감 순
  const res = resolvePrizes({ tickets, tieBreak: tb, draws: { seed: "2026", grand: { winners: [pids[7]] } } });
  assert.deepEqual(res.best, [pids[20], pids[33], pids[40]]);
  assert.deepEqual(resolvePrizes({ tickets, tieBreak: tb, draws: { seed: "2026", grand: { winners: [pids[7]] } }, withGrand: false }).best, [pids[7], pids[20], pids[33]]);
});

test("3등 후보 순서: 공감 많은 순으로 저장해 두고, 1위가 더 큰 상을 받으면 다음 순위가 받는다", () => {
  const at = (seconds) => [seconds, 0];
  const rows = [
    { code: "C", receiverPid: "c", giverPid: "x", review: "셋", likes: 2, at: at(30) },
    { code: "A", receiverPid: "a", giverPid: "x", review: "하나", likes: 5, at: at(10) },
    { code: "B", receiverPid: "b", giverPid: "x", review: "둘", likes: 5, at: at(20) },
    { code: "Z", receiverPid: "z", giverPid: "x", review: "공감 없음", likes: 0, at: at(1) },
    { code: "D", receiverPid: "d", giverPid: "x", review: "수상 제외", likes: 9, at: at(5) },
  ];
  const rank = rankReviews(rows, new Set(["d"]));
  assert.deepEqual(rank.map((x) => x.code), ["A", "B", "C"], "공감 순, 동점이면 먼저 쓴 후기, 공감 0과 수상 대상이 아닌 사람은 뺀다");
  assert.deepEqual(Object.keys(rank[0]).sort(), ["code", "likes", "receiverPid", "review"]);
  assert.deepEqual(pickBestReview(rows, new Set(["d"])), rank[0]);
  assert.equal(rankReviews(rows, new Set(), 2).length, 2);
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

test("보안 규칙의 추첨 칸 이름이 상품 설정과 같고, 카드 번호가 규칙의 난이도 표기와 맞는다", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const m = rules.match(/function drawsShapeOk\(d\) \{\s*return d\.keys\(\)\.hasOnly\(\[([^\]]+)\]\)/);
  assert.ok(m, "규칙에서 추첨 칸 목록을 찾지 못함");
  const keys = (t) => t.split(",").map((x) => x.trim().replace(/'/g, "")).sort();
  // 저장하는 칸: 현장 숫자(seed), 종이로 뽑는 상(1·4·5등), 사이트가 뽑는 상(6등). 2·3등은 저장하지 않는다(계산한다)
  const stored = ["seed", PRIZES.grand.key, ...PAPER_TIERS.map((t) => t.key), ONLINE_PRIZE.key].sort();
  assert.deepEqual(keys(m[1]), stored, "prizes.js의 key나 정하는 방법(how)을 바꾸면 firestore.rules의 drawsShapeOk도 같이 고친다");
  assert.deepEqual(PRIZE_ORDER.map((x) => x.how), ["paper", "rank", "review", "paper", "paper", "online"]);
  // 카드 번호: 규칙은 e·n·h + 숫자 1~2자리로 난이도를 본다
  const prefix = { easy: "e", normal: "n", hard: "h" };
  for (const [level, cards] of Object.entries(MISSION_CARDS)) {
    for (const c of cards) assert.match(c.id, new RegExp(`^${prefix[level]}[0-9]{1,2}$`), `${level} 카드 번호 ${c.id}`);
  }
});

test("보안 규칙의 후기·답장 고치기 한도가 REVIEW_EDITS_MAX와 같다", async () => {
  const { REVIEW_EDITS_MAX } = await import("../src/lib/constants.js");
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const limits = [...rules.matchAll(/request\.resource\.data\.edits <= (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(limits, [REVIEW_EDITS_MAX]);
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

test("카드 추가분: 쉬움 0, 보통 +1, 도전 +2, 칭찬만 0, 3주차 카드도 붙어 합계 최대 6. 난이도는 카드 목록과 대조한다", () => {
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
  const two = run({ 1: HARD, 2: pickCard("hard", 1), 3: PRAISE });
  assert.deepEqual([two.mission, two.card, two.total], [3, 4, 7 + 2]); // 미션 3 + 카드 4 + 은신 2
  // 3주차: 칭찬 한 줄과 함께 고른 도전 카드도 대상이 카드와 같다고 확인하면 붙는다
  const best = run({ 1: HARD, 2: pickCard("hard", 1), 3: pickCard("hard", 2) });
  assert.deepEqual([best.mission, best.card], [3, 6]);
  assert.equal(TICKET_RULES.maxCardBonus, 3 * TICKET_RULES.cardBonus.hard);
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
  // 시상: 숫자 정하기 → 2등(3명, 한 명씩) → 3등(후기상) → 4등 → 5등(종이) → 1등(종이) → 겹친 자리 다시 채우기 → 6등(사이트)
  const tail = slides.slice(slides.findIndex((x) => x.type === "drawGo")).map((x) => x.id);
  assert.deepEqual(tail, ["drawGo", "best2", "best1", "best0", "bestReview", "draw_t4", "draw_t5", "draw_grand", "refill", "draw_t6", "end"]);
  // 장면 수는 시상 전후가 같다(step이 장면 번호라서)
  assert.equal(buildSlides({ ...r, draws: { seed: "1", grand: { winners: ["A"] }, t6: { winners: ["B"] } } }, (x) => x).length, slides.length);
  // 공감을 받은 후기가 없으면 3등 장면이 없다
  assert.ok(!buildSlides({ ...r, bestReview: null }, (x) => x).some((x) => x.id === "bestReview"));
  assert.ok(buildSlides({ ...r, bestReview: null, reviewRank: [{ code: "A" }] }, (x) => x).some((x) => x.id === "bestReview"));
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

test("일정 타임라인: 일정마다 꼬리표 종류(kind)가 있고, 단서 일정은 clue, 날 수 계산이 맞다", () => {
  const kinds = ["join", "week", "clue", "close", "party"];
  for (const e of SCHEDULE) assert.ok(kinds.includes(e.kind), `${e.date} kind=${e.kind}`);
  assert.equal(new Set(SCHEDULE.map((e) => e.date)).size, SCHEDULE.length, "같은 날짜가 두 번 없다(타임라인의 key)");
  for (const e of SCHEDULE) assert.equal(e.kind === "clue", e.text.startsWith("단서"), e.text);
  assert.equal(daysBetween("2026-11-18", "2026-11-20"), 2);
  assert.equal(daysBetween("2026-11-27", "2026-12-01"), 4);
  assert.equal(daysBetween("2026-12-09", "2026-12-09"), 0);
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

test("가입 안내 메일: 받는 사람(가입 안 한 사람·아이디 있는 사람), 본문의 가입 링크, mailto 주소", async () => {
  const { inviteRecipients, inviteMessage, mailtoHref, joinUrl } = await import("../src/lib/inviteMail.js");
  const roster = [
    { pid: "p1", name: "가", email: "b.kim@samsung.com", uid: null },
    { pid: "p2", name: "나", email: "a.lee@samsung.com", uid: "u2" },
    { pid: "p3", name: "다", email: null, uid: null },
    { pid: "p4", name: "라", email: "c.park@samsung.com" },
  ];
  assert.deepEqual(inviteRecipients(roster), { emails: ["b.kim@samsung.com", "c.park@samsung.com"], noEmail: ["다"] });
  assert.deepEqual(inviteRecipients(roster, { onlyNotJoined: false }).emails, ["a.lee@samsung.com", "b.kim@samsung.com", "c.park@samsung.com"]);
  const url = joinUrl("https://example.web.app", "/");
  assert.equal(url, "https://example.web.app/?join");
  const { subject, body } = inviteMessage({ url, senderHost: "demo.firebaseapp.com" });
  assert.ok(subject.includes("가입"));
  assert.ok(body.includes(url) && body.includes("noreply@demo.firebaseapp.com"));
  assert.ok(!/초대 코드/.test(body), "본문에 초대 코드는 넣지 않는다");
  const href = mailtoHref({ to: "me@samsung.com", bcc: ["b.kim@samsung.com", "c.park@samsung.com"], subject: "제목", body: "줄1\n줄2" });
  assert.ok(href.startsWith("mailto:me%40samsung.com?bcc=b.kim%40samsung.com,c.park%40samsung.com&subject="));
  assert.ok(href.includes("body=%EC%A4%841%0D%0A%EC%A4%842"), "줄바꿈은 %0D%0A");
  assert.ok(href.indexOf("bcc=") < href.indexOf("subject=") && href.indexOf("subject=") < href.indexOf("body="), "잘려도 받는 사람이 먼저 남게");
});

test("배정 미리 보기: 저장 없이 여러 번 돌려 조건 확인(같은 파트 0쌍·맞마니또 없음·한 원), 비슷한 파트 이름과 피할 수 없는 경우를 알려 준다", async () => {
  const { previewAssignments } = await import("../src/lib/assign.js");
  const mk = (sizes) => Object.entries(sizes).flatMap(([part, k]) => Array.from({ length: k }, (_, i) => ({ pid: `${part}${i}`, part })));
  const ok = previewAssignments(mk({ EFA1: 16, EFA2: 15, PFA: 12, VSEM: 10 }), { runs: 100 });
  assert.equal(ok.n, 53);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual([ok.sameMin, ok.sameMax, ok.unavoidable], [0, 0, false]);
  assert.equal(ok.flow.EFA1.EFA1, undefined, "같은 파트로는 가지 않는다");
  assert.equal(Object.values(ok.flow.EFA1).reduce((a, b) => a + b, 0), 16 * 100);
  // 한 파트가 절반을 넘으면 같은 파트 짝을 피할 수 없다(되도록 적게)
  const big = previewAssignments(mk({ A: 30, B: 13, C: 10 }), { runs: 30 });
  assert.equal(big.unavoidable, true);
  assert.ok(big.sameMin >= 30 - 23 && big.sameMax <= 30 - 23, `같은 파트 짝은 최소 개수(7)만: ${big.sameMin}~${big.sameMax}`);
  assert.deepEqual(big.problems, []);
  // 띄어쓰기·대소문자만 다른 파트 이름(같은 파트를 다르게 적은 것일 수 있다)
  const typo = previewAssignments([...mk({ EFA1: 5, PFA: 5 }), { pid: "x", part: "efa 1" }], { runs: 5 });
  assert.deepEqual(typo.similar, [["EFA1", "efa 1"]]);
  assert.equal(typo.blank, 0);
});

test("프로필 작성 안내: 기한은 첫 단서 공개 전날, 받는 사람은 가입했는데 프로필을 저장하지 않은 사람", async () => {
  const { profileRecipients, profileMessage } = await import("../src/lib/inviteMail.js");
  const { PROFILE_DUE, FIRST_CLUE_DATE, shortDate } = await import("../src/lib/constants.js");
  assert.equal(FIRST_CLUE_DATE, "2026-11-20");
  assert.equal(PROFILE_DUE, "2026-11-19");
  assert.equal(shortDate(PROFILE_DUE), "11/19(목)");
  const roster = [
    { pid: "p1", name: "가", email: "a@samsung.com", uid: "u1" }, // 가입, 프로필 저장함
    { pid: "p2", name: "나", email: "b@samsung.com", uid: "u2" }, // 가입, 프로필 없음
    { pid: "p3", name: "다", email: "c@samsung.com", uid: null }, // 가입 안 함
    { pid: "p4", name: "라", email: null, uid: "u4" },            // 가입, 프로필 없음, 아이디 없음
  ];
  const progress = { p1: { profileDone: true }, p2: { doneCount: 1 } };
  assert.deepEqual(profileRecipients(roster, progress), { emails: ["b@samsung.com"], noEmail: ["라"], names: ["나", "라"] });
  assert.deepEqual(profileRecipients(roster, progress, { includeUnjoined: true }).emails, ["b@samsung.com", "c@samsung.com"]);
  const { subject, body } = profileMessage({ url: "https://example.web.app/", due: shortDate(PROFILE_DUE), clueDay: shortDate(FIRST_CLUE_DATE) });
  assert.ok(subject.includes("11/19(목)까지"));
  assert.ok(body.includes("https://example.web.app/") && body.includes("11/20(금)에 첫 단서") && body.includes("은신 응모권"));
});

test("카드 방법 표시: 모든 카드가 사이트 쪽지 또는 실물 전달이고, 카드 글과 어긋나지 않는다", () => {
  const all = Object.entries(MISSION_CARDS).flatMap(([level, cs]) => cs.map((c) => ({ ...c, level })));
  for (const c of all) {
    const how = cardHow({ cardId: c.id });
    assert.equal(how, c.real ? "real" : "site", c.id);
    assert.ok(CARD_HOW[how].label, c.id);
    // 완료 알림(deliveries.card)에는 번호가 없다: 글만으로도 같은 카드를 찾는다
    assert.equal(findCard({ level: c.level, text: c.text })?.id, c.id);
    // 사이트 쪽지 카드는 글에 "쪽지"가 있고, 실물 전달 카드는 글에 "쪽지"가 없다(표시와 글이 서로 다른 말을 하지 않게)
    assert.equal(c.text.includes("쪽지"), how === "site", `${c.id}: ${c.text}`);
  }
  assert.ok(MISSION_CARDS.easy.every((c) => cardHow(c) === "site"), "쉬움은 모두 사이트 쪽지");
  assert.ok(all.filter((c) => c.cost).every((c) => cardHow(c) === "real"), "비용 카드는 모두 실물 전달");
  assert.equal(cardHow({ cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" }), null, "칭찬만은 표시 없음");
  assert.equal(cardHow(null), null);
});

test("운영 화면 고른 미션 카드: 주차별로 카드마다 고른 사람 수·완료·인증, 사람별 카드와 방법", () => {
  const e1 = MISSION_CARDS.easy[0], n1 = MISSION_CARDS.normal.find((c) => c.id === "n1");
  const pick = (c, level) => ({ cardId: c.id, level, text: c.text });
  const rows = pairRows({
    assignments: { A: { receiverPid: "B" }, B: { receiverPid: "C" }, C: { receiverPid: "D" }, D: { receiverPid: "A" } },
    giverCodes: { A: { codes: { 1: "AAAA" } }, B: { codes: { 1: "BBBB" } }, C: { codes: { 1: "CCCC" } }, D: { codes: { 1: "DDDD" } } },
    missions: {
      A: { choices: { 1: pick(e1, "easy") }, done: { 1: true } },
      B: { choices: { 1: pick(e1, "easy") } },
      C: { choices: { 1: pick(n1, "normal") }, done: { 1: true } },
    },
    redemptions: { AAAA: { voided: false } },
  });
  const { people, cards, counts } = cardPicks(rows, 1);
  assert.deepEqual(counts, { easy: 2, normal: 1, hard: 0, praise: 0, none: 1, site: 2, real: 1, done: 2, redeemed: 1, noCode: 1 }); // C는 완료했지만 코드가 실린 알림이 없다
  assert.deepEqual(cards.map((c) => [c.key, c.how, c.picked, c.done, c.redeemed]), [["e1", "site", 2, 1, 1], ["n1", "real", 1, 1, 0]]);
  const by = Object.fromEntries(people.map((p) => [p.giverPid, p]));
  assert.deepEqual([by.A.how, by.A.status, by.B.status, by.C.how, by.C.status, by.D.level, by.D.how], ["site", "redeemed", "chosen", "real", "sent", null, null]);
  // 아직 아무도 고르지 않은 주차
  assert.deepEqual(cardPicks(rows, 2).counts.none, 4);
  assert.equal(cardPicks(rows, 2).cards.length, 0);
});

test("인증 코드: 코드가 실린 알림이 간 주차(codeSent)와 '코드 안 보냄', 코드 문서 점검", () => {
  const e1 = MISSION_CARDS.easy[0];
  const assignments = { A: { receiverPid: "B" }, B: { receiverPid: "C" }, C: { receiverPid: "A" } };
  const giverCodes = { A: { codes: { 1: "AAA1", 2: "AAA2", 3: "AAA3" } }, B: { codes: { 1: "BBB1", 2: "BBB2", 3: "BBB3" } }, C: { codes: { 1: "CCC1", 2: "CCC2", 3: "CCC3" } } };
  const pick = { cardId: e1.id, level: "easy", text: e1.text };
  const rows = pairRows({
    assignments, giverCodes,
    missions: { A: { choices: { 1: pick }, done: { 1: true } }, B: { choices: { 1: pick }, done: { 1: true } }, C: { choices: { 1: pick } } },
    redemptions: {},
    codeSent: new Set(["B_1"]), // A가 B에게 보낸 1주차 알림에는 코드가 있고, B가 C에게 보낸 것에는 없다
  });
  const { people, counts } = cardPicks(rows, 1);
  const by = Object.fromEntries(people.map((p) => [p.giverPid, p]));
  assert.deepEqual([by.A.code, by.A.codeSent, by.A.noCode], ["AAA1", true, false]);
  assert.deepEqual([by.B.code, by.B.codeSent, by.B.noCode], ["BBB1", false, true], "완료했는데 코드가 안 간 것");
  assert.equal(by.C.noCode, false, "아직 완료 전이면 '코드 안 보냄'이 아니다");
  assert.equal(counts.noCode, 1);

  // 코드 문서(codes/{코드} = { receiverPid, slot })가 모두 맞으면 문제 없음
  const codes = {};
  for (const [g, a] of Object.entries(assignments)) for (const [slot, c] of Object.entries(giverCodes[g].codes)) codes[c] = { receiverPid: a.receiverPid, slot: Number(slot) };
  assert.deepEqual(codeProblems(assignments, giverCodes, codes), []);
  // 없는 문서, 다른 대상을 가리키는 문서, 다른 주차를 가리키는 문서
  const broken = { ...codes, BBB1: { receiverPid: "A", slot: 1 }, CCC2: { receiverPid: "A", slot: 3 } };
  delete broken.AAA3;
  assert.deepEqual(codeProblems(assignments, giverCodes, broken).map((x) => `${x.code}:${x.problem}`).sort(), ["AAA3:missing", "BBB1:wrong", "CCC2:wrong"]);
});

test("백업: 메시지·후기 모음(누가 누구에게), CSV(한글 BOM·수식 막기), 시각 변환", async () => {
  const { BACKUP_COLLECTIONS, buildBackup, backupDocCount, messageRows, toCsv, toPlain, stamp } = await import("../src/lib/backup.js");
  const ts = (iso) => ({ toDate: () => new Date(iso) }); // Firestore 시각 흉내
  const name = { A: "가나", B: "다라", C: "마바" };
  const data = {
    assignments: { A: { receiverPid: "B" }, B: { receiverPid: "C" }, C: { receiverPid: "A" } },
    giverCodes: { A: { codes: { 1: "AAA1" } }, B: { codes: { 1: "BBB1" } }, C: { codes: { 1: "CCC1" } } },
    deliveries: {
      B_1: { receiverPid: "B", slot: 1, kind: "mission", message: "오늘도 힘내세요", card: { level: "easy", text: "응원 쪽지" }, createdAt: ts("2026-11-18T03:00:00Z") },
      B_1_n1: { receiverPid: "B", slot: 1, kind: "note", message: "=1+1 장난", hidden: true, createdAt: ts("2026-11-18T05:00:00Z") },
      C_3: { receiverPid: "C", slot: 3, kind: "praise", message: "올해 정말 고마웠어요", createdAt: ts("2026-12-01T03:00:00Z") },
      A_1: { receiverPid: "A", slot: 1, kind: "mission", message: "", createdAt: ts("2026-11-18T04:00:00Z") }, // 빈 쪽지는 넣지 않는다
    },
    redemptions: { AAA1: { receiverPid: "B", slot: 1, review: '덕분에 하루가 "즐거웠어요"', feedId: "f1", voided: false, cardMatch: true, createdAt: ts("2026-11-18T06:00:00Z") } },
    feed: { f1: { likes: 3, thanks: "고마워요 마니또님", review: "x" } },
    toManito: { B_1: { receiverPid: "B", slot: 1, message: "혹시 가파트세요?", createdAt: ts("2026-11-19T01:00:00Z") } },
    angels: { A: { angelPid: "B" } },
    angelGifts: { A_1: { receiverPid: "A", k: 1, text: "귤 두 개", message: "대신 챙겨요", createdAt: ts("2026-11-25T01:00:00Z"), confirmed: true, review: "수호천사님 감사해요!", confirmedAt: ts("2026-11-25T02:00:00Z") } },
  };
  const rows = messageRows({ nameOf: (p) => name[p], ...data });
  const line = (r) => `${r.kindLabel}|${r.slot ?? ""}|${r.from}>${r.to}|${r.text}`;
  assert.deepEqual(rows.map(line), [
    "미션 완료 쪽지|1|가나>다라|오늘도 힘내세요",
    "추가 쪽지|1|가나>다라|=1+1 장난",
    '인증 후기|1|다라>가나|덕분에 하루가 "즐거웠어요"',
    "감사 답장|1|다라>가나|고마워요 마니또님",
    "마니또에게 한마디|1|다라>가나|혹시 가파트세요?",
    "수호천사 미션||다라>가나|귤 두 개 / 대신 챙겨요",
    "수호천사 미션 후기||가나>다라|수호천사님 감사해요!",
    "칭찬 카드|3|다라>마바|올해 정말 고마웠어요",
  ]);
  const review = rows.find((r) => r.kind === "review");
  assert.deepEqual([review.likes, review.at, rows[0].card, rows[1].note], [3, "2026-11-18T06:00:00.000Z", "응원 쪽지", "운영진이 가린 쪽지"]);
  // 피드에서 가린 글: 인증 문서에 후기가 없으면 따로 옮겨 둔 원문(hiddenFeed)을 쓴다
  const hid = messageRows({ ...data, redemptions: { AAA1: { receiverPid: "B", slot: 1, review: "", feedId: "f1" } }, feed: { f1: { hidden: true, review: "" } }, hiddenFeed: { f1: { review: "가려진 원문" } } });
  assert.deepEqual([hid.find((r) => r.kind === "review").text, hid.find((r) => r.kind === "review").note], ["가려진 원문", "피드에서 가린 글"]);

  const csv = toCsv(rows);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.slice(1).trim().split("\r\n");
  assert.equal(lines.length, rows.length + 1);
  assert.ok(lines[2].includes('"\'=1+1 장난"'), "수식으로 시작하는 글은 앞에 작은따옴표");
  assert.ok(lines[3].includes('"덕분에 하루가 ""즐거웠어요"""'), "큰따옴표는 두 번");

  assert.deepEqual(toPlain({ a: ts("2026-11-18T03:00:00Z"), b: [1, { c: null }], d: undefined }), { a: "2026-11-18T03:00:00.000Z", b: [1, { c: null }], d: null });
  const b = buildBackup({ collections: { roster: { A: { name: "가나" } }, invites: null }, docs: { "config/app": { phase: 1 } }, at: new Date("2026-11-19T00:30:00Z"), failed: ["invites"] });
  assert.deepEqual([b.counts, b.failed, b.exportedAt, b.collections.roster.A.name], [{ roster: 1, invites: null }, ["invites"], "2026-11-19T00:30:00.000Z", "가나"]);
  assert.equal(backupDocCount({ roster: { A: {}, B: {} }, invites: null }, { "config/app": {} }), 3);
  assert.match(stamp(new Date(2026, 10, 19, 9, 5)), /^20261119-0905$/);
  // 메시지 모음에 쓰는 컬렉션은 모두 백업 목록에 들어 있어야 한다
  for (const n of Object.keys(data)) assert.ok(BACKUP_COLLECTIONS.includes(n), n);
});

test("예약(자동 진행): 시각이 지난 것만, 앞 단계가 된 뒤에, 이른 것부터 하나씩", async () => {
  const { AUTO_ITEMS, CLAIM_MS, MAX_TRIES, autoPlan, nextDue, localInputToMs, msToLocalInput } = await import("../src/lib/schedule.js");
  assert.deepEqual(AUTO_ITEMS.map((i) => `${i.id}:${i.date}`), ["clues2:2026-11-20", "week2:2026-11-24", "clues4:2026-11-27", "week3:2026-12-01", "clues6:2026-12-04", "close:2026-12-08"], "일정표의 날짜와 같은 순서");
  assert.deepEqual(AUTO_ITEMS.filter((i) => i.time).map((i) => `${i.id}:${i.time}`), ["week2:12:00", "week3:12:00", "close:12:00"], "주차 열기·미션 마감은 일정표 시각 12:00(안내 마감 11:00보다 한 시간 뒤)");
  const T = 1_000_000_000_000;
  const st = (items, config, now = T) => Object.fromEntries(autoPlan({ items, config, now }).map((r) => [r.id, r.state]));
  const run = { phase: 1, week: 1, cluesReleased: 0 };
  // 예약 없음 / 시각 전 / 시각이 됨
  assert.deepEqual(st({}, run), { clues2: "none", week2: "none", clues4: "none", week3: "none", clues6: "none", close: "none" });
  assert.deepEqual(st({ clues2: { at: T + 1 }, week2: { at: T } }, run), { clues2: "waiting", week2: "due", clues4: "none", week3: "none", clues6: "none", close: "none" });
  // 앞 단계가 먼저: 3주차는 2주차 뒤에, 단서 3·4번은 2주차가 열리고 1·2번이 공개된 뒤에
  const all = Object.fromEntries(AUTO_ITEMS.map((i) => [i.id, { at: T - 10 }]));
  assert.deepEqual(st(all, run), { clues2: "due", week2: "due", clues4: "blocked", week3: "blocked", clues6: "blocked", close: "blocked" });
  assert.deepEqual(st(all, { phase: 1, week: 2, cluesReleased: 0 }), { clues2: "due", week2: "done", clues4: "blocked", week3: "due", clues6: "blocked", close: "blocked" });
  assert.deepEqual(st(all, { phase: 1, week: 2, cluesReleased: 2 }), { clues2: "done", week2: "done", clues4: "due", week3: "due", clues6: "blocked", close: "blocked" });
  // 미션 마감은 3주차가 열린 뒤에. 마감되면(단계 2) 끝난 것으로 본다
  assert.deepEqual(st(all, { phase: 1, week: 3, cluesReleased: 6 }), { clues2: "done", week2: "done", clues4: "done", week3: "done", clues6: "done", close: "due" });
  assert.equal(st(all, { phase: 2, week: 3, cluesReleased: 6 }).close, "done");
  // 직접 눌러서 이미 된 것은 예약이 있어도 실행하지 않는다. 주차를 다시 내려도 예약으로 한 번 실행한 것(doneAt)은 다시 하지 않는다
  assert.equal(st({ week2: { at: T - 10, doneAt: { seconds: 1 } } }, run).week2, "done");
  // 미션 진행 단계에서만
  assert.equal(st({ clues6: { at: T - 10 } }, { phase: 2, week: 3, cluesReleased: 4 }).clues6, "off");
  // 여러 번 실패하면 멈춘다
  assert.equal(st({ clues2: { at: T - 10, tries: MAX_TRIES, error: "거부" } }, run).clues2, "failed");
  // 실행할 것: 예약 시각이 이른 것부터 하나
  assert.equal(nextDue({ items: { clues2: { at: T - 5 }, week2: { at: T - 9 } }, config: run, now: T }).id, "week2");
  assert.equal(nextDue({ items: { clues2: { at: T + 5 } }, config: run, now: T }), null);
  // 다른 브라우저가 방금 맡았으면 건너뛰고, 시간이 지나면 다시 해 본다
  assert.equal(nextDue({ items: { clues2: { at: T - 5, claimedMs: T - 1000 } }, config: run, now: T }), null);
  assert.equal(nextDue({ items: { clues2: { at: T - 5, claimedMs: T - CLAIM_MS } }, config: run, now: T }).id, "clues2");
  // 입력 칸 값 ↔ ms
  const ms = localInputToMs("2026-11-20T09:00");
  assert.equal(msToLocalInput(ms), "2026-11-20T09:00");
  assert.deepEqual([localInputToMs(""), msToLocalInput(null)], [null, ""]);
});

test("피드 '공감 많은 후기': 공감 많은 순 3건, 무효·가린 글·공감 없는 글은 빼고, 동점이면 먼저 쓴 글", async () => {
  const { pickTop, TOP_COUNT } = await import("../src/lib/feedTop.js");
  const at = (n) => ({ seconds: n });
  const docs = [
    { id: "a", likes: 2, createdAt: at(30) },
    { id: "b", likes: 5, createdAt: at(20) },
    { id: "c", likes: 5, createdAt: at(10) }, // b와 동점, 먼저 씀
    { id: "d", likes: 9, voided: true, createdAt: at(1) },
    { id: "e", likes: 8, hidden: true, createdAt: at(2) },
    { id: "f", createdAt: at(3) }, // 공감 없음
    { id: "g", likes: 1, createdAt: at(4) },
  ];
  assert.equal(TOP_COUNT, 3);
  assert.deepEqual(pickTop(docs).map((r) => r.id), ["c", "b", "a"]);
  assert.deepEqual(pickTop(docs, 5).map((r) => r.id), ["c", "b", "a", "g"]);
  assert.deepEqual(pickTop([]), []);
});

test("피드 기억: LIST_TTL 안에서만 쓰고, 더 많이 필요하거나 forgetFeed 뒤에는 새로 읽는다", async () => {
  const { LIST_TTL, feedCache, freshList, forgetFeed } = await import("../src/lib/feedCache.js");
  forgetFeed();
  assert.equal(freshList(30), null, "읽은 적 없으면 새로 읽는다");
  const docs = Array.from({ length: 30 }, (_, i) => ({ id: `f${i}` }));
  feedCache.list = { at: 1000, count: 30, docs };
  assert.deepEqual(freshList(30, 1000 + LIST_TTL - 1)?.length, 30, "기억 시간 안에는 읽어 둔 것");
  assert.equal(freshList(30, 1000 + LIST_TTL), null, "기억 시간이 지나면 새로 읽는다");
  assert.equal(freshList(60, 1001), null, "더 보기(더 많이)는 새로 읽는다");
  assert.equal(freshList(10, 1001).length, 10);
  feedCache.top = { at: 1000, docs: [{ id: "x" }] };
  feedCache.forceFull = false;
  forgetFeed();
  assert.equal(freshList(30, 1001), null, "인증·감사 답장을 보낸 뒤에는 지운다");
  assert.deepEqual(feedCache.top, { at: 0, docs: [] });
  assert.equal(feedCache.forceFull, true, "다음에 열 때는 요약 문서 대신 feed를 직접 읽는다");
});

test("피드 요약: 새 글을 앞에 붙이고, 바뀐 것만 다시 쓰고, 운영자의 가리기·답장 지우기를 반영한다", async () => {
  const { mergeDigest, digestKey, patchPosts } = await import("../src/lib/feedCache.js");
  const ts = (s) => ({ seconds: s, nanoseconds: 0 });
  const recent = [3, 2, 1].map((i) => ({ id: `f${i}`, slot: 1, review: `후기${i}`, voided: false, createdAt: ts(i) }));
  const fresh = [{ id: "f5", slot: 1, review: "새 글5", voided: false, createdAt: ts(5) }, { id: "f4", slot: 1, review: "새 글4", voided: false, createdAt: ts(4) }];
  assert.deepEqual(mergeDigest(recent, fresh, 30).map((d) => d.id), ["f5", "f4", "f3", "f2", "f1"]);
  assert.deepEqual(mergeDigest(recent, fresh, 3).map((d) => d.id), ["f5", "f4", "f3"], "PAGE건까지만");
  assert.deepEqual(mergeDigest(recent, [{ ...recent[0], likes: 2 }], 30).filter((d) => d.id === "f3").map((d) => d.likes), [2], "같은 글은 새로 읽은 쪽");
  assert.deepEqual(mergeDigest(recent, [], 30), recent, "새 글이 없으면 요약 그대로");
  const k = digestKey(recent, []);
  assert.equal(digestKey(recent.map((d) => ({ ...d })), []), k, "내용이 같으면 다시 쓰지 않는다");
  assert.notEqual(digestKey(patchPosts(recent, "f2", { likes: 1 }), []), k, "공감 수가 바뀌면 다시 쓴다");
  assert.notEqual(digestKey(recent, [recent[0]]), k, "공감 많은 글이 바뀌면 다시 쓴다");
  const hidden = patchPosts(recent, "f2", { hidden: true, review: "" });
  assert.deepEqual(hidden.find((d) => d.id === "f2"), { id: "f2", slot: 1, review: "", voided: false, createdAt: ts(2), hidden: true });
  assert.equal(hidden.find((d) => d.id === "f3"), recent[0], "다른 글은 그대로");
  const withThanks = patchPosts(recent, "f1", { thanks: "고마워요" });
  assert.equal("thanks" in patchPosts(withThanks, "f1", { thanks: undefined }).find((d) => d.id === "f1"), false, "답장 지우기는 칸을 없앤다");
});

test("피드 요약 뒤에 글쓴이가 고친 글은 요약의 같은 글을 바꿔 넣는다(요약에 없는 글은 더하지 않음)", async () => {
  const { overlayPosts, digestKey } = await import("../src/lib/feedCache.js");
  const ts = (s) => ({ seconds: s, nanoseconds: 0 });
  const recent = [3, 2, 1].map((i) => ({ id: `f${i}`, slot: 1, review: `후기${i}`, voided: false, createdAt: ts(i) }));
  const edited = [{ ...recent[1], review: "이름을 지운 후기", editedAt: ts(9) }, { id: "f9", slot: 1, review: "요약에 없던 글", createdAt: ts(0), editedAt: ts(9) }];
  const out = overlayPosts(recent, edited);
  assert.deepEqual(out.map((d) => d.id), ["f3", "f2", "f1"], "순서·개수는 요약 그대로");
  assert.equal(out[1].review, "이름을 지운 후기");
  assert.equal(out[0], recent[0], "다른 글은 그대로");
  assert.deepEqual(overlayPosts(recent, []), recent);
  assert.notEqual(digestKey([{ ...recent[0], editedAt: ts(9) }], []), digestKey([recent[0]], []), "고친 표시가 생기면 요약을 다시 쓴다");
});

test("재촉: 참여자 할 일(인증·완료 알리기)과 운영 화면 재촉 메일 받는 사람", async () => {
  const { myReminders, reminderTargets, reminderMessage } = await import("../src/lib/reminders.js");
  const { PHASE } = await import("../src/lib/constants.js");
  const inbox = [
    { kind: "mission", slot: 1 }, { kind: "note", slot: 1 }, { kind: "mission", slot: 2, hidden: true }, { kind: "praise", slot: 3 },
  ];
  // 1주차 완료 알림을 받았고 인증 전, 2주차는 운영진이 가림, 3주차는 아직 안 열림
  assert.deepEqual(myReminders({ inbox, mine: [], missions: { done: { 1: true } }, week: 2, phase: PHASE.RUNNING }), { toVerify: [1], toDo: [2], toGuess: [] });
  assert.deepEqual(myReminders({ inbox: [], mine: [], missions: {}, week: 2, phase: PHASE.RUNNING }).toDo, [2], "지난 주차(1주차)는 마감이라 할 일에 넣지 않는다");
  assert.deepEqual(myReminders({ inbox, mine: [{ slot: 1 }], missions: { done: { 1: true, 2: true } }, week: 2, phase: PHASE.RUNNING }), { toVerify: [], toDo: [], toGuess: [] });
  assert.deepEqual(myReminders({ inbox, mine: [], missions: {}, week: 3, phase: PHASE.RUNNING }).toVerify, [1, 3], "칭찬 카드도 인증할 것");
  assert.deepEqual(myReminders({ inbox, mine: [], missions: {}, week: 3, phase: PHASE.GUESSING }), { toVerify: [1, 3], toDo: [], toGuess: [] }, "최종 지목 단계: 인증만");
  assert.deepEqual(myReminders({ inbox, mine: [], missions: {}, week: 3, phase: PHASE.CLOSED }), { toVerify: [], toDo: [], toGuess: [] }, "마감 뒤에는 없음");
  assert.deepEqual(myReminders({ inbox, mine: null, missions: null, week: 1, phase: PHASE.RUNNING }), { toVerify: [], toDo: [], toGuess: [] }, "읽는 중에는 띄우지 않음");

  const roster = [
    { pid: "a", name: "가나", email: "a@x", uid: "u1" }, { pid: "b", name: "다라", email: "b@x", uid: "u2" },
    { pid: "c", name: "마바", email: "c@x", uid: null }, { pid: "d", name: "사아", email: "d@x", uid: "u4", dropout: true },
  ];
  const slot = (status, done) => ({ status, done });
  const rows = [
    { giverPid: "a", receiverPid: "b", slots: { 1: slot("sent", true), 2: slot("chosen", false), 3: slot("none", false) } },
    { giverPid: "b", receiverPid: "c", slots: { 1: slot("sent", true), 2: slot("none", false), 3: slot("none", false) } },
    { giverPid: "c", receiverPid: "d", slots: { 1: slot("none", false), 2: slot("none", false), 3: slot("none", false) } },
    { giverPid: "d", receiverPid: "a", slots: { 1: slot("reported", true), 2: slot("redeemed", true), 3: slot("none", false) } },
  ];
  assert.deepEqual(reminderTargets(rows, roster, { kind: "verify", week: 2 }), [{ pid: "b", name: "다라", email: "b@x", slots: [1] }],
    "가입 안 한 마바·신고한 가나는 빼고 인증 대기인 다라만");
  assert.deepEqual(reminderTargets(rows, roster, { kind: "mission", week: 2 }).map((x) => [x.name, x.slots]), [["가나", [2]], ["다라", [2]]],
    "지금 열린 주차만(지난 주차는 마감), 가입 안 한 마바·중도 이탈 사아는 빼고");
  const missedOld = [{ giverPid: "a", receiverPid: "b", slots: { 1: slot("none", false), 2: slot("sent", true) } }];
  assert.deepEqual(reminderTargets(missedOld, roster, { kind: "mission", week: 2 }), [], "1주차를 놓쳤어도 2주차를 했으면 재촉하지 않는다");
  const auto = [{ giverPid: "a", receiverPid: "b", slots: { 3: slot("auto", true) } }];
  assert.deepEqual(reminderTargets(auto, roster, { kind: "verify", week: 3 }).map((x) => x.slots), [[3]], "칭찬 카드도 대상의 인증 응모권 때문에 재촉");
  for (const kind of ["verify", "mission"]) {
    const m = reminderMessage({ kind, url: "https://example.test/", deadline: "11/24(화) 11:00" });
    assert.ok(m.subject.startsWith("[S1FA 마니또]") && m.body.includes("https://example.test/"));
    for (const n of ["가나", "다라", "마바", "사아"]) assert.ok(!m.body.includes(n), "본문에 이름 없음");
  }
});

test("주차별 미션 마감: 1주차는 2주차 시작, 2주차는 3주차 시작, 3주차는 미션 마감 시각에 닫힌다", async () => {
  const { weekDeadline, SCHEDULE, scheduleLabel } = await import("../src/lib/constants.js");
  assert.deepEqual([1, 2, 3].map((w) => weekDeadline(w)?.label), ["11/24(화) 11:00", "12/1(화) 11:00", "12/8(화) 11:00"]);
  const weeks = SCHEDULE.filter((e) => e.kind === "week");
  assert.equal(weekDeadline(1).date, weeks[1].date);
  assert.equal(weekDeadline(3).date, SCHEDULE.find((e) => e.kind === "close").date);
  for (const e of SCHEDULE) for (const t of [e.time, e.due].filter(Boolean)) assert.match(t, /^\d{2}:\d{2}$/, e.text);
  // 주차 열기·미션 마감은 12:00에 하지만 마감은 11:00으로 안내한다(사용자가 정함: 11/24, 12/1, 12/8 모두)
  const close = SCHEDULE.find((e) => e.kind === "close");
  assert.ok(scheduleLabel(weeks[1]).startsWith("11/24(화) 12:00 "));
  assert.ok(scheduleLabel(weeks[2]).startsWith("12/1(화) 12:00 "));
  assert.ok(scheduleLabel(close).startsWith("12/8(화) 12:00 "));
  for (const e of [weeks[1], weeks[2], close]) {
    assert.equal(e.time, "12:00"); assert.equal(e.due, "11:00");
    assert.match(e.text, /11:00 마감/, "타임라인 글에도 안내 마감 11:00이 보인다");
  }
  assert.deepEqual([1, 2, 3].map((w) => weekDeadline(w).time), ["11:00", "11:00", "11:00"]);
  const { deadlinePassed } = await import("../src/lib/constants.js");
  assert.equal(deadlinePassed(1, new Date("2026-11-24T10:59:00")), false);
  assert.equal(deadlinePassed(1, new Date("2026-11-24T11:00:00")), true, "11:00이 지나면 '마감 시각이 지났어요'(실제로는 12:00 전까지 할 수 있음)");
  assert.equal(deadlinePassed(2, new Date("2026-12-01T10:59:00")), false);
  assert.equal(deadlinePassed(2, new Date("2026-12-01T11:30:00")), true);
  assert.equal(deadlinePassed(3, new Date("2026-12-08T10:00:00")), false);
  assert.equal(deadlinePassed(3, new Date("2026-12-08T11:30:00")), true);
});

test("송년회 칭호: 도전왕·황금손·쪽지 장인·투명 마니또를 기록으로 정하고, 동점은 모두, 불참·수상 제외는 빠진다", async () => {
  const { computeTitles, TITLES, shownTitles, titleValue } = await import("../src/lib/titles.js");
  const card = (id) => { const c = Object.entries(MISSION_CARDS).flatMap(([level, cs]) => cs.map((x) => ({ ...x, level }))).find((x) => x.id === id); return { cardId: c.id, level: c.level, text: c.text }; };
  const people = ["A", "B", "C", "D", "E", "F"].map((pid) => ({ pid, joined: true }));
  people.push({ pid: "G", joined: false }); // 가입 안 함
  people.find((p) => p.pid === "F").disqualified = true;
  // 원: A→B→C→D→E→F→A (G는 짝 없음)
  const assignments = { A: "B", B: "C", C: "D", D: "E", E: "F", F: "A" };
  const giverCodes = Object.fromEntries(Object.keys(assignments).map((g) => [g, { 1: `${g}1`, 2: `${g}2`, 3: `${g}3` }]));
  const missions = {
    A: { choices: { 1: card("h1"), 2: card("h14"), 3: card("h2") } }, // 도전 3(황금 1) — 단 3주차는 카드와 다름
    B: { choices: { 1: card("h1"), 2: card("h15") } }, // 도전 2(황금 1)
    C: { choices: { 1: card("h1"), 2: card("h2") } }, // 도전 2
    D: { choices: { 1: { cardId: "h1", level: "hard", text: "위조" }, 2: card("n1") } }, // 목록과 다른 카드는 안 센다
    F: { choices: { 1: card("h1"), 2: card("h2"), 3: card("h3") } }, // 수상 제외: 도전 3이어도 빠진다
  };
  const ok = { cardMatch: true };
  const redemptions = {
    A1: ok, A2: ok, A3: { cardMatch: false },
    B1: ok, B2: ok,
    C1: ok, C2: ok,
    D1: ok, D2: ok,
    F1: ok, F2: ok, F3: ok,
  };
  const deliveries = [
    { receiverPid: "C", slot: 1, kind: "mission", message: "쪽지" }, // B의 쪽지
    { receiverPid: "C", slot: 1, kind: "note", message: "더" },
    { receiverPid: "C", slot: 1, kind: "note", message: "더 더" },
    { receiverPid: "D", slot: 1, kind: "mission", message: "x" }, // C
    { receiverPid: "D", slot: 1, kind: "note", message: "y" },
    { receiverPid: "D", slot: 1, kind: "note", message: "z" },
    { receiverPid: "D", slot: 1, kind: "note", message: "가림", hidden: true }, // 가린 것은 안 센다
    { receiverPid: "D", slot: 2, kind: "mission", message: "  " }, // 빈 쪽지는 안 센다
    { receiverPid: "A", slot: 1, kind: "note", message: "1" }, { receiverPid: "A", slot: 1, kind: "note", message: "2" },
    { receiverPid: "A", slot: 1, kind: "note", message: "3" }, { receiverPid: "A", slot: 1, kind: "note", message: "4" }, // F(수상 제외)
  ];
  // 은신: A·B·C·E가 은신 응모권을 받음. B는 대상 C가 2주차에 B를 찍은 적이 있다. E의 대상 F는 참여 중이라 센다.
  const tickets = { A: { hidden: 2 }, B: { hidden: 2 }, C: { hidden: 2 }, D: { hidden: 0 }, E: { hidden: 2 }, F: { hidden: 2 } };
  const midGuesses = { C: { 1: "A", 2: "B" }, D: { 1: "A" } };
  const titles = computeTitles({ people, assignments, giverCodes, redemptions, missions, deliveries, midGuesses, tickets });
  assert.deepEqual(titles.map((t) => t.key), TITLES.map((t) => t.key));
  const by = Object.fromEntries(titles.map((t) => [t.key, t]));
  assert.deepEqual(by.challenge.winners, ["A", "B", "C"], "도전 2건 동점(A의 3주차는 카드와 달라 빠짐) — 모두 받는다, 위조 카드·수상 제외는 빠짐");
  assert.equal(by.challenge.value, 2);
  assert.equal(titleValue(by.challenge), "인증받은 도전 미션 2건");
  assert.deepEqual(by.gold.winners, ["A", "B"]);
  assert.equal(titleValue(by.gold), "");
  assert.deepEqual(by.notes.winners, ["B", "C"], "3통 동점, 가린 쪽지·빈 쪽지·수상 제외는 안 센다");
  assert.equal(by.notes.value, 3);
  assert.deepEqual(by.invisible.winners, ["A", "C", "E"], "B는 대상이 주차별 추측에서 한 번 골랐고, D는 은신을 못 받았고, F는 수상 제외");
  // 대상이 가입하지 않았거나 중도 이탈이면 투명 마니또에서 뺀다(추측할 사람이 없어서)
  const dropF = people.map((p) => (p.pid === "F" ? { ...p, dropout: true } : p));
  assert.deepEqual(computeTitles({ people: dropF, assignments, giverCodes, redemptions, missions, deliveries, midGuesses, tickets }).find((t) => t.key === "invisible").winners, ["A", "C"]);
  // 아무도 없으면 빈 목록, 발표에는 받은 사람이 있는 칭호만
  const empty = computeTitles({ people, assignments });
  assert.ok(empty.every((t) => t.winners.length === 0));
  assert.deepEqual(shownTitles({ titles: empty }), []);
  assert.deepEqual(shownTitles({ titles }).map((t) => t.key), ["challenge", "gold", "notes", "invisible"]);
  assert.deepEqual(shownTitles({}), [], "칭호가 없는 예전 집계");
});

test("발표 화면: 칭호는 받은 사람이 있는 것만 한 장면씩, 그다음 황금 카드 커피 쿠폰, 그 뒤 시상", async () => {
  const { goldWinnerWeeks } = await import("../src/lib/titles.js");
  const r = {
    pairs: [{ giverPid: "A", receiverPid: "B" }, { giverPid: "B", receiverPid: "A" }], praises: [{}],
    titles: [{ key: "challenge", winners: ["A"] }, { key: "gold", winners: [] }, { key: "notes", winners: ["B"] }, { key: "invisible", winners: ["A", "B"] }],
    goldWinners: { 3: ["B"], 2: ["A"] },
  };
  const ids = buildSlides(r, (x) => x).map((x) => x.id);
  assert.deepEqual(ids.slice(ids.indexOf("praise"), ids.indexOf("drawGo") + 1), ["praise", "title_challenge", "title_notes", "title_invisible", "gold", "drawGo"]);
  assert.deepEqual(goldWinnerWeeks(r), [{ week: 2, winners: ["A"] }, { week: 3, winners: ["B"] }]);
  // 추첨한 주차가 없거나 당첨자가 없으면 쿠폰 장면이 없다. 예전 집계(칭호·쿠폰 없음)는 장면이 그대로
  assert.ok(!buildSlides({ ...r, goldWinners: { 2: [] } }, (x) => x).some((x) => x.id === "gold"));
  const old = buildSlides({ pairs: r.pairs, praises: [{}] }, (x) => x).map((x) => x.id);
  assert.ok(!old.some((x) => x.startsWith("title_") || x === "gold"));
  // 장면 수는 시상 전후가 같다
  assert.equal(buildSlides({ ...r, draws: { seed: "1", t6: { winners: ["A"] } } }, (x) => x).length, ids.length);
});

test("할 일: 주차별 추측은 이번 주 단서 2개가 나온 뒤부터 그 주차가 닫힐 때까지, 아직 안 남긴 사람에게만", async () => {
  const { myReminders, guessReminderOpen } = await import("../src/lib/reminders.js");
  const { PHASE } = await import("../src/lib/constants.js");
  const base = { inbox: [], mine: [], missions: { done: { 1: true, 2: true } }, phase: PHASE.RUNNING };
  // 1주차: 단서 2개(11/20) 공개 뒤부터
  assert.deepEqual(myReminders({ ...base, week: 1, cluesReleased: 0, guesses: {} }).toGuess, [], "이번 주 단서 전에는 없음");
  assert.deepEqual(myReminders({ ...base, week: 1, cluesReleased: 2, guesses: {} }).toGuess, [1]);
  assert.deepEqual(myReminders({ ...base, week: 1, cluesReleased: 2, guesses: { 1: "p9" } }).toGuess, [], "이미 남겼으면 없음");
  // 2주차: 2주차 단서(3·4번, 11/27)가 나와야. 1주차 추측을 남겼어도 2주차는 따로
  assert.deepEqual(myReminders({ ...base, week: 2, cluesReleased: 2, guesses: { 1: "p9" } }).toGuess, [], "2주차가 열렸어도 2주차 단서 전에는 없음");
  assert.deepEqual(myReminders({ ...base, week: 2, cluesReleased: 4, guesses: { 1: "p9" } }).toGuess, [2]);
  assert.deepEqual(myReminders({ ...base, week: 3, cluesReleased: 6, guesses: { 1: "p9", 2: "p9", 3: "p8" } }).toGuess, []);
  // 추측은 미션 진행 단계에만(최종 지목 단계부터는 주차별 추측이 없다), 읽는 중에는 띄우지 않음
  assert.deepEqual(myReminders({ ...base, week: 3, cluesReleased: 6, guesses: {}, phase: PHASE.GUESSING }).toGuess, []);
  assert.deepEqual(myReminders({ ...base, week: 1, cluesReleased: 2, guesses: null }).toGuess, []);
  // 화면은 이 조건일 때만 내 추측 문서를 읽는다(읽기 수)
  assert.equal(guessReminderOpen({ phase: PHASE.RUNNING, week: 2, cluesReleased: 3 }), false);
  assert.equal(guessReminderOpen({ phase: PHASE.RUNNING, week: 2, cluesReleased: 4 }), true);
  assert.equal(guessReminderOpen({ phase: PHASE.SETUP, week: 1, cluesReleased: 2 }), false);
});

test("모두의 미션 진행: 완료율만 적고 보인다(인원 수 없음), 지난 주차, 이번 주를 아직 안 셌으면 보이지 않음, 같은 비율이면 다시 쓰지 않음", async () => {
  const { progressView, progressPercents, sameProgress } = await import("../src/lib/progress.js");
  // 센 숫자 → 문서에는 완료율(정수 %)만
  assert.deepEqual(progressPercents(54, { 1: 49, 2: 13 }), { 1: 91, 2: 24 });
  assert.deepEqual(progressPercents(3, { 1: 5 }), { 1: 100 }, "100%를 넘지 않게");
  assert.deepEqual(progressPercents(0, { 1: 0 }), {}, "가입한 사람이 없으면 적지 않음");
  const at = { toDate: () => new Date(2026, 10, 24, 14, 5) };
  const v = progressView({ v: 2, weeks: { 1: 91, 2: 24 }, at }, 2);
  assert.deepEqual({ ...v, at: v.at.getMinutes() }, { week: 2, pct: 24, past: [{ week: 1, pct: 91 }], at: 5 });
  assert.ok(!("done" in v) && !("joined" in v), "인원 수는 화면 값에도 없다");
  assert.equal(progressView({ v: 2, weeks: { 1: 91 } }, 2), null, "주차가 막 바뀌어 이번 주를 아직 안 셌으면 지난 숫자를 이번 주처럼 보이지 않는다");
  assert.equal(progressView(null, 1), null);
  assert.equal(progressView({ v: 2, weeks: { 1: 0 } }, 1).pct, 0);
  assert.equal(progressView({ v: 2, weeks: { 1: 0 } }, 1).at, null, "시각이 없으면 null");
  // 배포 전에 적힌 예전 모양(가입 인원·완료 인원)은 비율로 바꿔 보인다
  assert.equal(progressView({ v: 1, joined: 50, weeks: { 1: 45 } }, 1).pct, 90);
  // 다시 쓸지
  assert.equal(sameProgress({ v: 2, weeks: { 1: 91 } }, { v: 2, weeks: { 1: 91 }, at: 1 }), true);
  assert.equal(sameProgress({ v: 2, weeks: { 1: 91 } }, { v: 2, weeks: { 1: 93 } }), false);
  assert.equal(sameProgress({ v: 2, weeks: { 1: 91 } }, { v: 2, weeks: { 1: 91, 2: 0 } }), false, "주차가 늘면 다시 쓴다");
  assert.equal(sameProgress({ v: 1, joined: 50, weeks: { 1: 45 } }, { v: 2, weeks: { 1: 90 } }), false, "예전 모양은 새 모양으로 다시 쓴다");
  assert.equal(sameProgress(null, { v: 2, weeks: {} }), false);
});

test("운영 화면 매주 남긴 마니또 추측: 주차마다 남긴 사람·맞힌 사람, 사람별 추측과 정답 표시, 가입 안 함·중도 이탈은 빼고", async () => {
  const { midGuessStats } = await import("../src/lib/pairs.js");
  const roster = [
    { pid: "a", name: "가나", part: "가", uid: "u1" }, { pid: "b", name: "다라", part: "나", uid: "u2" },
    { pid: "c", name: "마바", part: "가", uid: "u3" }, { pid: "d", name: "사아", part: "나", uid: null },
    { pid: "e", name: "자차", part: "다", uid: "u5", dropout: true },
  ];
  // 원: a→b→c→d→e→a (giver → receiver)
  const assignments = { a: { receiverPid: "b" }, b: { receiverPid: "c" }, c: { receiverPid: "d" }, d: { receiverPid: "e" }, e: { receiverPid: "a" } };
  const midGuesses = {
    b: { guesses: { 1: "a", 2: "a" } }, // b의 마니또는 a → 1·2주차 모두 정답
    c: { guesses: { 1: "a", 2: "b" } }, // c의 마니또는 b → 2주차만 정답
    a: { guesses: { 2: "c" } }, // a의 마니또는 e → 오답
    d: { guesses: { 1: "a" } }, // 가입 안 함 — 빠진다
    e: { guesses: { 1: "d" } }, // 중도 이탈 — 빠진다
  };
  const { summary, rows } = midGuessStats({ midGuesses, assignments, roster, week: 2 });
  assert.deepEqual(summary, [{ week: 1, eligible: 3, guessed: 2, correct: 1 }, { week: 2, eligible: 3, guessed: 3, correct: 2 }]);
  assert.deepEqual(rows.map((r) => r.name), ["가나", "마바", "다라"], "파트·이름순");
  assert.deepEqual(rows.find((r) => r.pid === "c").cells, { 1: { pid: "a", correct: false }, 2: { pid: "b", correct: true } });
  assert.equal(rows.find((r) => r.pid === "a").cells[1], null, "안 남긴 주차는 null");
  assert.deepEqual(midGuessStats({ midGuesses, assignments, roster, week: 1 }).summary.map((x) => x.week), [1], "열린 주차까지만");
});

// 부서 공지용 결산 숫자(tools/report/compute.js): 사이트와 같은 식, 이름·짝은 결과에 없음
import { computeReport, maxTicketsIfMissed } from "../tools/report/compute.js";
test("결산 문구: 놓친 주차가 있어도 모을 수 있는 최대 응모권", () => {
  assert.equal(maxTicketsIfMissed(0), 17, "규칙 탭의 최대 17장과 같다(수호천사 제외)");
  assert.equal(maxTicketsIfMissed(1), 12, "1주차를 놓치면 미션 1·도전 추가분 2·은신 2가 빠진다");
  assert.equal(maxTicketsIfMissed(3), 4, "3주를 다 놓치면 대상으로서 받는 것(입력 3 + 정답 1)만");
});
test("결산 숫자: 완료율은 사이트 식, 인증·쪽지·공감·후기·추측", () => {
  const easySite = MISSION_CARDS.easy.find((c) => !c.real && !c.from);
  const normalReal = MISSION_CARDS.normal.find((c) => c.real && !c.from);
  const pick = (c, level) => ({ level, cardId: c.id, text: c.text });
  const backup = { collections: {
    roster: {
      a: { name: "가나", part: "P1", uid: "ua" }, b: { name: "다라", part: "P2", uid: "ub" }, c: { name: "마바", part: "P3", uid: "uc" },
      d: { name: "사아", part: "P1", uid: "ud", dropout: true }, e: { name: "자차", part: "P2", uid: null },
    },
    assignments: { a: { receiverPid: "b" }, b: { receiverPid: "c" }, c: { receiverPid: "d" }, d: { receiverPid: "e" }, e: { receiverPid: "a" } },
    giverMissions: {
      a: { done: { 1: true }, choices: { 1: pick(easySite, "easy") } },
      b: { done: { 1: true }, choices: { 1: pick(normalReal, "normal") } },
      c: { done: { 2: true }, choices: { 1: pick(easySite, "easy") } },
    },
    redemptions: { K1: { receiverPid: "b", slot: 1 }, K2: { receiverPid: "c", slot: 1, voided: true } },
    deliveries: {
      b_1: { slot: 1, message: "안녕" }, c_1: { slot: 1, message: "반가워" }, c_1_n1: { slot: 1, message: "가린 쪽지", hidden: true },
      x: { slot: 1, message: "  " }, d_2: { slot: 2, message: "2주차" },
    },
    feed: {
      f1: { slot: 1, review: "첫 후기", likes: 3, createdAt: "2026-11-19T01:00:00.000Z" },
      f2: { slot: 1, review: "둘째 후기", likes: 5, createdAt: "2026-11-19T02:00:00.000Z" },
      f3: { slot: 1, review: "", hidden: true, likes: 10 }, f4: { slot: 1, review: "무효", voided: true, likes: 9 },
      f5: { slot: 2, review: "2주차 후기", likes: 7 }, f6: { slot: 1, review: "공감 없음", likes: 0 },
    },
    midGuesses: { b: { guesses: { 1: "a" } }, c: { guesses: { 1: "a" } } },
  } };
  const r = computeReport(backup, { week: 1 });
  assert.equal(r.completion, 50, "완료 2 ÷ 가입 4(uid 있는 사람, 사이트 progressPercents와 같음)");
  assert.equal(r.nextCompletion, 25, "2주차 지금까지 1 ÷ 4");
  assert.equal(r.verifiedPct, 50, "완료한 a·b 중 대상 b만 인증(c의 인증은 무효)");
  assert.equal(r.notes, 2, "가린 쪽지·빈 쪽지·다른 주차 제외");
  assert.equal(r.likes, 8, "가린 글·무효 글·다음 주차 글 제외");
  assert.deepEqual(r.topReviews, [{ text: "둘째 후기", likes: 5 }, { text: "첫 후기", likes: 3 }]);
  assert.deepEqual(r.levelMix, { easy: 50, normal: 50, hard: 0, praise: 0 }, "완료한 주차의 카드만(c의 1주차 카드는 완료 전)");
  assert.deepEqual(r.howMix, { real: 50, site: 50 });
  assert.equal(r.popular.length, 2);
  assert.equal(r.guessPct, 67, "가입했고 중도 이탈이 아닌 3명 중 2명(운영 화면 midGuessStats와 같음)");
  assert.equal(r.guessCorrect, 1, "b의 마니또는 a");
  const out = JSON.stringify(r);
  for (const n of ["가나", "다라", "마바", "사아", "자차", "ua", "P1"]) assert.ok(!out.includes(n), `결과에 ${n} 없음`);
  assert.equal(computeReport(backup, { week: 3 }).nextCompletion, null, "3주차 다음은 없음");
});

// 중도 이탈로 짝 이어 붙이기(lib/handover.js, tools/handover): X → Y → Z에서 Y가 빠지고 X가 2주차부터 Z를 맡는다
import { slotPairs } from "../src/lib/handover.js";
import { assignmentHealth, midGuessStats as midStats } from "../src/lib/pairs.js";
import { computeTitles as titlesOf } from "../src/lib/titles.js";
import { messageRows as messagesOf } from "../src/lib/backup.js";
const HO = (() => {
  const hard = MISSION_CARDS.hard.find((c) => !c.from && !c.gold);
  const normal = MISSION_CARDS.normal.find((c) => !c.from);
  const pick = (c, level) => ({ level, cardId: c.id, text: c.text });
  return {
    // 원래 원: A → X → Y → Z → B → A. Y가 빠져서 지금 짝은 A → X → Z → B → A
    assignments: { A: "X", X: "Z", Z: "B", B: "A" },
    handover: { items: [{ left: "Y", giver: "X", receiver: "Z", fromSlot: 2, at: 1 }] },
    // X는 Y의 남은 주차 코드(y2·y3)를 넘겨받았고, Y에게는 1주차 코드만 남았다
    giverCodes: { A: { 1: "a1", 2: "a2", 3: "a3" }, X: { 1: "x1", 2: "y2", 3: "y3" }, Y: { 1: "y1" }, Z: { 1: "z1", 2: "z2", 3: "z3" }, B: { 1: "b1", 2: "b2", 3: "b3" } },
    missions: { X: { done: { 1: true, 2: true }, choices: { 1: pick(hard, "hard"), 2: pick(normal, "normal") } }, Y: { done: { 1: true } } },
    redemptions: {
      x1: { receiverPid: "Y", slot: 1, cardMatch: true }, // Y가 X의 1주차를 인증
      y1: { receiverPid: "Z", slot: 1 }, // Z가 Y의 1주차를 인증
      y2: { receiverPid: "Z", slot: 2, cardMatch: true }, // Z가 X의 2주차(이어 받은 뒤)를 인증
    },
    people: [
      { pid: "A", part: "P3" }, { pid: "X", part: "P1" }, { pid: "Y", part: "P3", dropout: true }, { pid: "Z", part: "P1" }, { pid: "B", part: "P2" },
    ],
  };
})();

test("이어 붙이기: 주차별 짝", () => {
  const at = slotPairs(HO.assignments, HO.handover);
  assert.equal(at.receiverAt("X", 1), "Y");
  assert.equal(at.receiverAt("X", "2"), "Z");
  assert.equal(at.receiverAt("Y", 1), "Z");
  assert.equal(at.receiverAt("Y", 2), null, "빠진 사람은 이어 받은 뒤 주차에 대상이 없다");
  assert.equal(at.giverAt("Z", 1), "Y");
  assert.equal(at.giverAt("Z", 3), "X");
  assert.equal(at.giverAt("Y", 1), "X");
  assert.equal(at.giverAt("Y", 2), null);
  assert.ok(at.givers.includes("Y"));
  assert.ok(at.takenOver("X") && !at.takenOver("A"));
  // 기록이 없으면 모든 주차가 지금 짝
  const plain = slotPairs(HO.assignments, null);
  assert.equal(plain.receiverAt("X", 1), "Z");
  // 두 번 이어 붙여도: Y가 2주차부터, 그다음 X가 3주차부터 빠지면 A가 3주차에 Z를 맡는다
  const twice = slotPairs({ A: "Z", Z: "B", B: "A" }, [
    { left: "Y", giver: "X", receiver: "Z", fromSlot: 2 }, { left: "X", giver: "A", receiver: "Z", fromSlot: 3 },
  ]);
  assert.deepEqual([1, 2, 3].map((s) => twice.receiverAt("A", s)), ["X", "X", "Z"]);
  assert.deepEqual([1, 2, 3].map((s) => twice.receiverAt("X", s)), ["Y", "Z", null]);
  assert.deepEqual([1, 2, 3].map((s) => twice.giverAt("Z", s)), ["Y", "X", "A"]);
});

test("이어 붙이기: 응모권은 주차마다 그 주차의 짝으로", () => {
  const t = computeTickets({ ...HO, guesses: {}, deliveries: [] });
  assert.equal(t.X.mission, 2, "X: 1주차(Y가 인증) + 2주차(Z가 인증)");
  assert.equal(t.X.card, TICKET_RULES.cardBonus.hard + TICKET_RULES.cardBonus.normal, "두 주차 모두 카드 추가분");
  assert.equal(t.Z.entries, 2, "Z: Y의 1주차·X의 2주차 인증");
  assert.equal(t.Y.mission, 1, "빠진 Y도 1주차 미션은 기록된다(송년회에 오면 이탈 표시를 풀어 반영)");
  assert.equal(t.Y.total, 0, "중도 이탈 표시 중에는 0장");
  const back = computeTickets({ ...HO, people: HO.people.map((p) => ({ ...p, dropout: false })), guesses: {}, deliveries: [] });
  assert.equal(back.Y.mission, 1);
  assert.equal(back.Y.entries, 1, "Y가 인증한 X의 1주차");
  assert.equal(back.Y.comp, 0, "Y는 1주차만 대상이라 보상할 주차가 없다");
  assert.ok(back.Y.total >= 2);
  // 기록 없이 계산하면(예전 코드처럼) X의 1주차가 Z 기준으로 잘못 보인다 — 이 차이를 막는 것이 handover다
  const wrong = computeTickets({ ...HO, handover: null, guesses: {}, deliveries: [] });
  assert.equal(wrong.Y.mission, 0, "기록이 없으면 빠진 사람의 미션이 사라진다");

  // 2주차를 되돌리지 않고 3주차부터 이어 받은 경우: X의 2주차는 빠진 Y에게 한 것(대상 불참이라 확인 없이 인정, 카드 추가분 없음)
  // Z의 2주차는 Y가 안 보냈으므로 보상
  const late = computeTickets({
    ...HO,
    handover: { items: [{ left: "Y", giver: "X", receiver: "Z", fromSlot: 3 }] },
    giverCodes: { ...HO.giverCodes, X: { 1: "x1", 2: "x2", 3: "y3" }, Y: { 1: "y1", 2: "y2" } },
    missions: { ...HO.missions, Z: { done: { 1: true } } }, // 보상은 내 미션이 1건 이상 인증된 사람만
    redemptions: { x1: HO.redemptions.x1, y1: HO.redemptions.y1, z1: { receiverPid: "B", slot: 1 } },
    guesses: {}, deliveries: [],
  });
  assert.equal(late.X.mission, 2, "X의 2주차: 대상(Y)이 중도 이탈이라 확인 없이 인정");
  assert.equal(late.X.assumed, 1);
  assert.equal(late.X.card, TICKET_RULES.cardBonus.hard, "인정된 주차에는 카드 추가분이 없다");
  assert.equal(late.Z.comp, 2, "Z: Y가 안 보낸 2주차 + 아직 안 온 3주차");
});

test("이어 붙이기: 짝 현황·코드·배정 점검·추측·칭호·백업", () => {
  const assignments = Object.fromEntries(Object.entries(HO.assignments).map(([g, r]) => [g, { receiverPid: r }]));
  const giverCodes = Object.fromEntries(Object.entries(HO.giverCodes).map(([g, c]) => [g, { codes: c }]));
  const rows = pairRows({ assignments, giverCodes, missions: HO.missions, redemptions: HO.redemptions, handover: HO.handover });
  const x = rows.find((r) => r.giverPid === "X");
  assert.equal(x.receiverPid, "Z");
  assert.equal(x.slots[1].receiverPid, "Y");
  assert.equal(x.slots[1].status, "redeemed");
  assert.equal(x.slots[2].receiverPid, "Z");
  const y = rows.find((r) => r.giverPid === "Y");
  assert.ok(y && y.left, "빠진 사람의 줄도 있다");
  assert.equal(y.receiverPid, "Z");
  assert.equal(y.slots[1].status, "redeemed");
  assert.equal(y.slots[2].status, "left");
  assert.equal(cardPicks(rows, 2).people.length, 4, "이탈 줄의 이어 받은 뒤 주차는 세지 않는다");
  assert.deepEqual(needyReceivers({ rows, week: 3, people: HO.people.map((p) => ({ ...p, joined: true })) }), ["A", "B", "X"].filter((pid) => !rows.some((r) => Object.values(r.slots).some((s) => s.done && s.receiverPid === pid))),
    "Z는 Y에게 1주차를 받았으므로 수호천사 대상이 아니다");
  assert.ok(!needyReceivers({ rows, week: 3, people: HO.people.map((p) => ({ ...p, joined: true })) }).includes("Z"));

  assert.deepEqual(receiverCodesOf(assignments, giverCodes, HO.handover).Z, { 1: "y1", 2: "y2", 3: "y3" }, "Z의 코드는 그대로");
  assert.deepEqual(receiverCodesOf(assignments, giverCodes, HO.handover).Y, { 1: "x1" });
  const codes = { x1: { receiverPid: "Y", slot: 1 }, y1: { receiverPid: "Z", slot: 1 }, y2: { receiverPid: "Z", slot: 2 }, y3: { receiverPid: "Z", slot: 3 } };
  for (const g of ["A", "Z", "B"]) for (const s of [1, 2, 3]) codes[`${g.toLowerCase()}${s}`] = { receiverPid: HO.assignments[g], slot: s };
  assert.deepEqual(codeProblems(assignments, giverCodes, codes, HO.handover), []);
  assert.ok(codeProblems(assignments, giverCodes, codes).length > 0, "기록 없이 보면 X의 1주차 코드가 어긋나 보인다");

  const roster = HO.people.map((p) => ({ ...p, uid: `u${p.pid}` }));
  const hints = [["X", "A"], ["Z", "X"], ["B", "Z"], ["A", "B"]].map(([receiverPid, giver]) => ({ receiverPid, answer: HO.people.find((p) => p.pid === giver).part, ver: 2 }));
  const health = assignmentHealth({ roster, assignments, hints, config: { assignVer: 2, partExcluded: true }, handover: HO.handover });
  assert.equal(health.status, "ok", "빠진 사람은 명단에서 빼고, 이어 붙인 같은 파트 짝은 다른 파트 검사에서 뺀다");
  assert.equal(assignmentHealth({ roster, assignments, hints, config: { assignVer: 2, partExcluded: true } }).status, "mismatch", "기록 없이 보면 명단과 짝이 안 맞는다");

  const ms = midStats({ midGuesses: { Z: { guesses: { 1: "Y", 2: "X" } } }, assignments, roster, week: 2, handover: HO.handover });
  const z = ms.rows.find((r) => r.pid === "Z");
  assert.equal(z.cells[1].correct, true, "1주차 정답은 그때의 마니또 Y");
  assert.equal(z.cells[2].correct, true);
  assert.equal(noticedWeeks(HO.assignments, { Z: { 1: "Y", 2: "X", 3: "X" } }, { Z: "X" }, HO.handover).Z, 2, "지금 마니또가 맡은 주차부터");

  const people = HO.people.map((p) => ({ ...p, joined: true }));
  const deliveries = [
    { receiverPid: "Y", slot: 1, kind: "mission", message: "X가 Y에게" }, { receiverPid: "Z", slot: 1, kind: "mission", message: "Y가 Z에게" },
    { receiverPid: "Z", slot: 2, kind: "mission", message: "X가 Z에게" },
  ];
  const titles = titlesOf({ people, assignments: HO.assignments, giverCodes: HO.giverCodes, redemptions: HO.redemptions, missions: HO.missions, deliveries, midGuesses: {}, tickets: { X: { hidden: 2 } }, handover: HO.handover });
  const notes = titles.find((t) => t.key === "notes");
  assert.deepEqual(notes.winners, ["X"]);
  assert.equal(notes.value, 2, "X의 쪽지: Y에게 1통 + Z에게 1통(Y가 Z에게 보낸 것은 X 것이 아니다)");
  assert.deepEqual(titles.find((t) => t.key === "invisible").winners, ["X"], "이어 받은 마니또도 투명 마니또는 같은 기준(추리 보드가 내 파트를 빼지 않아 대상이 고를 수 있다)");
  const guessed = titlesOf({ people, assignments: HO.assignments, giverCodes: HO.giverCodes, redemptions: HO.redemptions, missions: HO.missions, deliveries, midGuesses: { Z: { 2: "X" } }, tickets: { X: { hidden: 2 } }, handover: HO.handover });
  assert.deepEqual(guessed.find((t) => t.key === "invisible").winners, [], "대상이 한 번이라도 고르면 아니다");

  const msg = messagesOf({ assignments, giverCodes, deliveries: Object.fromEntries(deliveries.map((d, i) => [`d${i}`, d])), meta: { handover: HO.handover } });
  assert.deepEqual(msg.map((m) => `${m.fromPid}>${m.toPid}:${m.text}`).sort(), ["X>Y:X가 Y에게", "X>Z:X가 Z에게", "Y>Z:Y가 Z에게"]);
});

// 중도 이탈 안내 팝업 글(lib/notices.js → HandoverPopup.jsx): 이름·파트를 쓰지 않는다(대상에게 파트를 알리면 마니또가 드러난다)
import { noticeText } from "../src/lib/notices.js";
test("이어 붙이기 안내 글: 마니또·대상 모두 파트·이름 없이", () => {
  const g = noticeText({ kind: "giver", fromSlot: 2, redo: true });
  const r = noticeText({ kind: "receiver", fromSlot: 2 });
  assert.equal(g.title, "내 대상이 바뀌었어요");
  assert.equal(r.title, "내 마니또가 바뀌었어요");
  assert.ok(g.items.some((x) => x.includes("2주차 미션은 새 대상에게 다시")), "되돌린 주차를 다시 하라고 알린다");
  assert.ok(!noticeText({ kind: "giver", fromSlot: 3 }).items.some((x) => x.includes("다시 해")), "되돌리지 않았으면 그 말은 없다");
  for (const t of [g, r]) {
    const all = [t.lead, ...t.items, t.title].join(" ");
    assert.doesNotMatch(all, /파트|같은 팀|EFA|PFA|VSEM/, "파트 이야기는 없다");
  }
  assert.match(r.lead, /2주차부터는 새 마니또/);
  assert.equal(r.go, "detective"); assert.equal(g.go, "mission");
});

// 운영 화면 "중도 이탈 처리"(lib/handoverPlan.js): 계획 → 적용 → 되돌리면 원래대로
import { DELETE as HO_DEL, planHandover, planUndo } from "../src/lib/handoverPlan.js";
function applyOps(store, ops) {
  const out = structuredClone(store);
  for (const o of ops) {
    const [col, id] = o.path;
    out[col] ||= {};
    if (o.op === "delete") { delete out[col][id]; continue; }
    if (o.op === "set") { out[col][id] = structuredClone(o.data); continue; }
    if (o.op === "merge") {
      const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(a[k] && typeof a[k] === "object" ? a[k] : {}, v) : v; return a; };
      out[col][id] = merge(out[col][id] || {}, structuredClone(o.data));
      continue;
    }
    const docv = out[col][id] ||= {};
    for (const [path, v] of Object.entries(o.data)) {
      const keys = path.split(".");
      let cur = docv;
      for (const k of keys.slice(0, -1)) cur = cur[k] ||= {};
      if (v === HO_DEL) delete cur[keys.at(-1)];
      else cur[keys.at(-1)] = v;
    }
  }
  return out;
}
test("중도 이탈 처리: 계획·적용·되돌리기", () => {
  // 원: A(P3) → X(P1) → Y(P3) → Z(P1) → B(P2) → A. X가 2주차를 Y에게 미리 완료(메뉴판만)
  const store = {
    config: { app: { phase: 1, week: 2, assignVer: 2, cluesReleased: 2 } },
    roster: { A: { name: "가", part: "P3", uid: "a" }, X: { name: "나", part: "P1", uid: "x" }, Y: { name: "다", part: "P3", uid: "y" }, Z: { name: "라", part: "P1", uid: "z" }, B: { name: "마", part: "P2", uid: "b" } },
    assignments: { A: { receiverPid: "X" }, X: { receiverPid: "Y" }, Y: { receiverPid: "Z" }, Z: { receiverPid: "B" }, B: { receiverPid: "A" } },
    giverCodes: { X: { codes: { 1: "x1", 2: "x2", 3: "x3" } }, Y: { codes: { 1: "y1", 2: "y2", 3: "y3" } } },
    receiverCodes: { Y: { codes: { 1: "x1", 2: "x2", 3: "x3" } }, Z: { codes: { 1: "y1", 2: "y2", 3: "y3" } } },
    giverMissions: { X: { done: { 1: true, 2: true }, notes: { 2: 1 }, choices: { 2: { level: "hard", cardId: "h15", text: "카페" } } }, Y: { done: { 1: true } } },
    progress: { X: { doneCount: 2, lastSeen: 1 } },
    deliveries: { Y_1: { slot: 1, message: "1주차" }, Y_2: { slot: 2, message: "메뉴판" }, Y_2_n1: { slot: 2, message: "추가" }, Z_1: { slot: 1, message: "Y가 Z에게" } },
    clues: {
      ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [`Y_${i}`, { receiverPid: "Y", idx: i, answer: `X답${i}`, ver: 2, n: 1 }])),
      ...Object.fromEntries([0, 1, 2, 3, 4, 5].map((i) => [`Z_${i}`, { receiverPid: "Z", idx: i, answer: `Y답${i}`, ver: 2, n: 1 }])),
      Z_6: { receiverPid: "Z", idx: 6, answer: "P3", ver: 2 },
    },
    public: { roster: { people: { Y: { name: "다", part: "P3" } } } },
    notices: {}, meta: {},
  };
  const data = (st) => ({
    config: st.config.app, roster: st.roster, assignments: st.assignments, giverCodes: st.giverCodes, receiverCodes: st.receiverCodes,
    missions: st.giverMissions, progress: st.progress, deliveries: st.deliveries, clues: st.clues, notices: st.notices, handover: st.meta.handover,
    redeemed: new Set(Object.keys(st.redemptions || {})), angels: {},
  });
  assert.equal(planHandover(data(store), { leaver: "Y" }).needChoice, true, "X가 2주차를 완료했으면 되돌릴지 묻는다");
  assert.match(planHandover({ ...data(store), config: { ...store.config.app, phase: 0 } }, { leaver: "Y" }).error, /미션 진행 단계/);
  const p = planHandover(data(store), { leaver: "Y", redo: true, now: 1000 });
  assert.equal(p.error, undefined);
  assert.deepEqual([p.X, p.Y, p.Z, p.F, p.samePart], ["X", "Y", "Z", 2, true]);
  const after = applyOps(store, p.ops);
  assert.deepEqual(after.assignments.X, { receiverPid: "Z" });
  assert.equal(after.assignments.Y, undefined);
  assert.deepEqual(after.giverCodes.X.codes, { 1: "x1", 2: "y2", 3: "y3" });
  assert.deepEqual(after.giverCodes.Y.codes, { 1: "y1" });
  assert.deepEqual(after.receiverCodes.Z.codes, { 1: "y1", 2: "y2", 3: "y3" }, "Z 쪽 코드는 그대로");
  for (let i = 0; i < 6; i++) assert.equal(after.clues[`Z_${i}`].answer, `X답${i}`);
  assert.equal(after.clues.Z_6.answer, "P1");
  assert.deepEqual(after.giverMissions.X.done, { 1: true }, "2주차 완료를 되돌림");
  assert.deepEqual(after.giverMissions.X.notes, {});
  assert.equal(after.giverMissions.X.choices[2].cardId, "h15", "골라 둔 카드는 그대로");
  assert.equal(after.progress.X.doneCount, 1);
  assert.equal(after.progress.X.lastSeen, 1);
  assert.ok(!after.deliveries.Y_2 && !after.deliveries.Y_2_n1 && after.deliveries.Y_1 && after.deliveries.Z_1);
  assert.deepEqual([after.roster.Y.dropout, after.roster.Y.leftGame, after.public.roster.people.Y.out], [true, true, true]);
  assert.equal(after.public.roster.people.Y.name, "다", "요약의 다른 칸은 그대로(merge)");
  assert.deepEqual([after.notices.X.kind, after.notices.Z.kind, after.notices.X.redo], ["giver", "receiver", true]);
  assert.ok(!after.notices.X.id.includes("Y"), "안내 번호에 빠진 사람이 없다");
  assert.equal(after.meta.handover.items.length, 1);
  // 이미 빠진 사람은 다시 못 고른다
  assert.match(planHandover(data(after), { leaver: "Y", redo: true }).error, /짝이 없어요/);
  // 되돌리기
  const u = planUndo(data(after));
  assert.equal(u.error, undefined);
  const back = applyOps(after, u.ops);
  for (const col of ["assignments", "giverCodes", "receiverCodes", "clues", "deliveries"]) assert.deepEqual(back[col], store[col], `되돌리면 ${col}가 원래대로`);
  assert.deepEqual(back.giverMissions.X.done, store.giverMissions.X.done);
  assert.deepEqual(back.giverMissions.X.notes, store.giverMissions.X.notes);
  assert.equal(back.progress.X.doneCount, 2);
  assert.deepEqual([back.roster.Y.dropout, back.roster.Y.leftGame, back.public.roster.people.Y.out], [undefined, undefined, undefined]);
  assert.deepEqual(back.notices, {});
  assert.deepEqual(back.meta.handover.items, []);
  // 이어 받은 뒤 새 대상에게 완료했으면 버튼으로는 되돌리지 않는다
  const done = structuredClone(after); done.giverMissions.X.done[2] = true;
  assert.match(planUndo(data(done)).error, /이미 완료/);
  // 다음 주차부터(되돌리지 않음): X의 2주차는 그대로, 3주차 코드만 옮긴다
  const late = planHandover(data(store), { leaver: "Y", fromSlot: 3, now: 2000 });
  const a2 = applyOps(store, late.ops);
  assert.deepEqual(a2.giverCodes.X.codes, { 1: "x1", 2: "x2", 3: "y3" });
  assert.deepEqual(a2.giverMissions.X.done, { 1: true, 2: true });
  assert.equal(a2.notices.X.redo, false);
  // 맞마니또가 되는 경우는 막는다
  const mutual = structuredClone(store); mutual.assignments.Z = { receiverPid: "X" };
  assert.match(planHandover(data(mutual), { leaver: "Y", redo: true }).error, /맞마니또/);
});

// 마니또에게 한마디: 주차마다 보낼 수 있는 수가 보안 규칙의 문서 ID 모양과 같은지
import { TO_MANITO_MAX } from "../src/lib/constants.js";
test("마니또에게 한마디 횟수와 보안 규칙", () => {
  const rules = readFileSync(new URL("../firestore.rules", import.meta.url), "utf8");
  const block = rules.slice(rules.indexOf("match /toManito/{id}"), rules.indexOf("match /toManito/{id}") + 1500);
  const suffixes = [...block.matchAll(/string\(request\.resource\.data\.slot\) \+ '_(\d)'\n/g)].map((m) => Number(m[1]));
  assert.deepEqual([1, ...suffixes], Array.from({ length: TO_MANITO_MAX }, (_, i) => i + 1), "규칙의 _2·_3 문서 ID가 TO_MANITO_MAX와 맞아야 한다");
});
