import test from "node:test";
import assert from "node:assert/strict";
import { splitTeams, assignWithTeams, assignManito, assignmentMemo, generateCodes } from "../src/lib/assign.js";
import { computeTickets, weightedDraw, pickMostTickets, rankBestManito } from "../src/lib/scoring.js";
import { seededRandom } from "../src/lib/random.js";
import { parseRosterLine, rosterSummary, summaryToList, sameSummary } from "../src/lib/roster.js";
import { MISSION_CARDS, PROFILE_QUESTIONS, CLUE_COUNT, profileAnswerError } from "../src/lib/constants.js";

const pids = Array.from({ length: 56 }, (_, i) => `p${String(i + 1).padStart(3, "0")}`);

test("56명을 8팀 7명씩 나눈다", () => {
  const teams = splitTeams(pids, 8, seededRandom("t"));
  const counts = {};
  for (const t of Object.values(teams)) counts[t] = (counts[t] || 0) + 1;
  assert.deepEqual(Object.values(counts).sort(), Array(8).fill(7));
});

test("원형 배정: 전원 1명씩 주고받고, 자기 자신·같은 팀·맞마니또 없음", () => {
  for (let k = 0; k < 20; k++) {
    const rand = seededRandom("a" + k);
    const teams = splitTeams(pids, 8, rand);
    const people = pids.map((pid) => ({ pid, team: teams[pid] }));
    const pairs = assignWithTeams(people, rand);
    const giverSet = new Set(pairs.map((p) => p.giverPid));
    const receiverSet = new Set(pairs.map((p) => p.receiverPid));
    assert.equal(giverSet.size, 56);
    assert.equal(receiverSet.size, 56);
    const map = Object.fromEntries(pairs.map((p) => [p.giverPid, p.receiverPid]));
    for (const { giverPid, receiverPid } of pairs) {
      assert.notEqual(giverPid, receiverPid);
      assert.notEqual(teams[giverPid], teams[receiverPid]);
      assert.notEqual(map[receiverPid], giverPid, "맞마니또");
    }
    // 하나의 원으로 이어져 있는지
    let cur = pids[0];
    const seen = new Set();
    while (!seen.has(cur)) { seen.add(cur); cur = map[cur]; }
    assert.equal(seen.size, 56);
  }
});

function checkPairs(people, r) {
  const byPid = Object.fromEntries(people.map((p) => [p.pid, p]));
  const map = Object.fromEntries(r.pairs.map((p) => [p.giverPid, p.receiverPid]));
  assert.equal(new Set(r.pairs.map((p) => p.giverPid)).size, people.length, "모두 한 명씩 맡음");
  assert.equal(new Set(r.pairs.map((p) => p.receiverPid)).size, people.length, "모두 한 명씩 받음");
  for (const { giverPid, receiverPid } of r.pairs) {
    assert.notEqual(giverPid, receiverPid);
    assert.notEqual(map[receiverPid], giverPid, "맞마니또");
    if (r.siteMatched) assert.equal(byPid[giverPid].loc, byPid[receiverPid].loc, "같은 근무지");
    if (r.teamExcluded) assert.notEqual(byPid[giverPid].team, byPid[receiverPid].team, "같은 팀");
  }
}

test("기본 배정(근무지 상관없음): 다른 근무지끼리도 짝이 되고, 같은 팀·맞마니또는 없음", () => {
  let cross = 0;
  for (let k = 0; k < 10; k++) {
    const rand = seededRandom("any" + k);
    const teams = splitTeams(pids, 8, rand);
    const people = pids.map((pid, i) => ({ pid, team: teams[pid], loc: i < 30 ? "SR3" : "S1L" }));
    const r = assignManito(people, { rand });
    assert.equal(r.siteMatched, false);
    assert.equal(r.teamExcluded, true);
    checkPairs(people, r);
    const loc = Object.fromEntries(people.map((p) => [p.pid, p.loc]));
    cross += r.pairs.filter((p) => loc[p.giverPid] !== loc[p.receiverPid]).length;
  }
  assert.ok(cross > 0, "다른 근무지 짝이 실제로 생긴다");
});

test("같은 근무지 모드: 56명 SR3/S1L 모든 비율(3~53명)에서 같은 근무지·다른 팀으로 짝지어짐", () => {
  for (let sr3 = 3; sr3 <= 53; sr3++) {
    const rand = seededRandom("loc" + sr3);
    const teams = splitTeams(pids, 8, rand);
    const people = pids.map((pid, i) => ({ pid, team: teams[pid], loc: i < sr3 ? "SR3" : "S1L" }));
    const r = assignManito(people, { siteMode: "same", rand });
    assert.equal(r.siteMatched, true, `SR3 ${sr3}명`);
    checkPairs(people, r);
  }
});

test("같은 근무지 모드: 3명 미만 근무지는 큰 근무지 원에 합치고 경고", () => {
  const rand = seededRandom("small");
  const teams = splitTeams(pids, 8, rand);
  const people = pids.map((pid, i) => ({ pid, team: teams[pid], loc: i < 54 ? "SR3" : "S1L" }));
  const r = assignManito(people, { siteMode: "same", rand });
  assert.equal(r.siteMatched, false);
  assert.ok(r.warnings.some((w) => w.includes("S1L")));
  checkPairs(people, r);
});

test("한 근무지가 전부 같은 팀이면 팀 조건만 풀고 경고", () => {
  const people = [
    ...["a", "b", "c", "d"].map((pid) => ({ pid, team: 1, loc: "S1L" })),
    ...["e", "f", "g", "h", "i"].map((pid, i) => ({ pid, team: 2 + (i % 2), loc: "SR3" })),
  ];
  const r = assignManito(people, { siteMode: "same", rand: seededRandom("sameteam") });
  assert.equal(r.siteMatched, true);
  assert.equal(r.teamExcluded, false);
  assert.ok(r.warnings.length > 0);
  checkPairs(people, r);
});

test("같은 근무지 모드에서 근무지가 비어 있으면 배정을 막는다", () => {
  assert.throws(() => assignManito([{ pid: "a", loc: "SR3" }, { pid: "b", loc: null }, { pid: "c", loc: "SR3" }], { siteMode: "same" }));
});

test("코드는 전체에서 중복이 없다", () => {
  const codes = generateCodes(pids, seededRandom("c"));
  const all = Object.values(codes).flatMap((c) => Object.values(c));
  assert.equal(all.length, 168);
  assert.equal(new Set(all).size, 168);
  assert.ok(all.every((c) => /^[2-9A-HJ-NP-Z]{4}$/.test(c)));
});

test("재배정 메모(meta/assignment)는 정렬돼 있어 배정 순서를 드러내지 않는다", () => {
  const rand = seededRandom("memo");
  const teams = splitTeams(pids, 8, rand);
  const { pairs } = assignManito(pids.map((pid) => ({ pid, team: teams[pid] })), { rand });
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
    // B: 인정 2건 → 미션 2 + 도전 1 + 은신 2 + 보상 3(A가 3주 모두 안 보냄) = 8
    assert.deepEqual([t.B.mission, t.B.hard, t.B.assumed, t.B.hidden, t.B.comp, t.B.total], [2, 1, 2, 2, 3, 8]);
    assert.equal(t.C.total, 0);
    assert.equal(t.A.total, 0); // 아무것도 안 함
  }
  // 대상이 참여 중이면 완료 알림만으로는 인정되지 않는다(받는 사람이 인증해야 함)
  const people = ["A", "B", "C"].map((pid) => ({ pid, joined: true }));
  const t = computeTickets({ ...base, people, guesses: {} });
  assert.deepEqual([t.B.mission, t.B.hard, t.B.assumed, t.B.hidden], [0, 0, 0, 0]);
});

test("받고도 인증하지 않은 사람: 운영자가 표시하면 그 마니또의 미션을 인정하고, 본인 응모권은 그대로", () => {
  const giverCodes = { A: { 1: "A1", 2: "A2", 3: "A3" }, B: { 1: "B1", 2: "B2", 3: "B3" }, C: { 1: "C1", 2: "C2", 3: "C3" } };
  const base = {
    assignments: { A: "B", B: "C", C: "A" }, giverCodes, missions: {}, guesses: {},
    // B → C: 3건 완료 알림. C는 1주차만 인증했고 2주차 인증은 운영자가 무효 처리, 3주차는 인증 안 함.  C → A: 1건(A 인증)
    deliveries: [{ receiverPid: "C", slot: 1 }, { receiverPid: "C", slot: 2 }, { receiverPid: "C", slot: 3 }, { receiverPid: "A", slot: 1 }],
    redemptions: { B1: { receiverPid: "C", slot: 1, voided: false }, B2: { receiverPid: "C", slot: 2, voided: true }, C1: { receiverPid: "A", slot: 1, voided: false } },
  };
  const plain = computeTickets({ ...base, people: ["A", "B", "C"].map((pid) => ({ pid })) });
  assert.deepEqual([plain.B.mission, plain.B.assumed], [1, 0]);
  const marked = computeTickets({ ...base, people: [{ pid: "A" }, { pid: "B" }, { pid: "C", creditGiver: true }] });
  // B: 1주차(인증) + 3주차(인정) = 2. 2주차는 무효 처리된 인증이 있어 인정하지 않는다
  assert.deepEqual([marked.B.mission, marked.B.assumed, marked.B.hidden], [2, 1, 2]);
  // C 본인: 미션 1 + 은신 2 + 인증 입력 1(무효 제외) 그대로. 0장이 되지 않는다
  assert.deepEqual([marked.C.mission, marked.C.entries, marked.C.total], [1, 1, plain.C.total]);
  assert.ok(marked.C.total > 0);
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

test("베스트 마니또 동점: 인증된 미션 → 득표 → 운영진 평가 → 무작위 순", () => {
  const cards = [{ cardId: "x", giverPid: "A" }, { cardId: "y", giverPid: "B" }];
  // A: 완수 1(0.3). B: 완수 0 + 득표 1/5(0.1) + 평가 10(0.2) = 0.3 → 점수 동점, 완수율이 높은 A가 위
  const votes = { v1: ["y", "z"], v2: ["z"], v3: ["z"], v4: ["z"], v5: ["z"] };
  const byCompletion = rankBestManito({ cards, votes, adminEval: { y: 10 }, tickets: { A: { completion: 1 }, B: { completion: 0 } } });
  assert.deepEqual(byCompletion.map((r) => r.giverPid), ["A", "B"]);
  // 완전히 같으면 무작위(주어진 난수 순서대로 결정)
  const same = { tickets: { A: { completion: 1 }, B: { completion: 1 } }, votes: {}, adminEval: {} };
  const seq = (...xs) => () => xs.shift();
  assert.deepEqual(rankBestManito({ cards, ...same, rand: seq(0.9, 0.1) }).map((r) => r.giverPid), ["A", "B"]);
  assert.deepEqual(rankBestManito({ cards, ...same, rand: seq(0.1, 0.9) }).map((r) => r.giverPid), ["B", "A"]);
});

test("명단 요약: 이름·팀·근무지만, pid 순서 고정, 가입 여부·수상 제외 변화는 같은 요약", () => {
  const rows = [
    { pid: "p002", name: "다라", team: 2, loc: "S1L", uid: null, disqualified: false, inviteUsed: "X" },
    { pid: "p001", name: "가나", team: 1, loc: "SR3", uid: "u1", disqualified: false },
  ];
  const sum = rosterSummary(rows);
  assert.deepEqual(Object.keys(sum), ["p001", "p002"]);
  assert.deepEqual(sum.p002, { name: "다라", team: 2, loc: "S1L", part: null });
  assert.ok(!sameSummary(sum, rosterSummary(rows.map((r) => (r.pid === "p001" ? { ...r, part: "가파트" } : r)))), "파트가 바뀌면 다시 쓴다");
  assert.deepEqual(summaryToList(sum).map((r) => r.pid), ["p001", "p002"]);
  const claimed = rows.map((r) => ({ ...r, uid: "u-" + r.pid, disqualified: true }));
  assert.ok(sameSummary(sum, rosterSummary(claimed)), "가입·제외만 바뀌면 다시 쓰지 않는다");
  assert.ok(!sameSummary(sum, rosterSummary(rows.map((r) => (r.pid === "p001" ? { ...r, team: 3 } : r)))), "팀이 바뀌면 다시 쓴다");
  assert.ok(sameSummary({ p002: sum.p002, p001: sum.p001 }, sum), "키 순서가 달라도 같은 요약");
});

test("명단 입력 한 줄: 이름,근무지,파트[,팀번호] (예전 형식도 받음), 근무지 오타는 알려 준다", () => {
  const L = ["SR3", "S1L"];
  assert.deepEqual(parseRosterLine("홍길동,SR3,공정파트", L), { name: "홍길동", loc: "SR3", part: "공정파트", team: null, badLoc: null });
  assert.deepEqual(parseRosterLine("김철수, s1l , 소자파트 , 3", L), { name: "김철수", loc: "S1L", part: "소자파트", team: 3, badLoc: null });
  assert.deepEqual(parseRosterLine("이영희", L), { name: "이영희", loc: null, part: null, team: null, badLoc: null });
  assert.deepEqual(parseRosterLine("박민수,SR3,3", L), { name: "박민수", loc: "SR3", part: null, team: 3, badLoc: null });
  assert.equal(parseRosterLine("오타,SR33,가파트", L).badLoc, "SR33");
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
