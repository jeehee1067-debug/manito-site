import test from "node:test";
import assert from "node:assert/strict";
import { splitTeams, assignWithTeams, assignManito, assignmentMemo, generateCodes } from "../src/lib/assign.js";
import { computeTickets, weightedDraw, pickMostTickets, rankBestManito } from "../src/lib/scoring.js";
import { seededRandom } from "../src/lib/random.js";
import { rosterSummary, summaryToList, sameSummary } from "../src/lib/roster.js";

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
  // A: 미션 2(무효 1건 제외) + 도전 1 + 받은 입력 0 + 은신 0(들킴) = 3
  assert.equal(t.A.total, 3);
  // B: 미션 1 + 받은 입력 2 + 정답 1 + 은신 2(C가 틀림) = 6
  assert.equal(t.B.total, 6);
  // C: 미션 0 + 받은 입력 1 + 은신 2(A가 지목 안 함) = 3
  assert.equal(t.C.total, 3);
});

test("정체를 알려주면 둘의 합계가 1장 줄어든다", () => {
  const people = ["A", "B", "C"].map((pid) => ({ pid }));
  const base = { people, assignments: { A: "B", B: "C", C: "A" }, giverCodes: {}, redemptions: {}, missions: {} };
  const hidden = computeTickets({ ...base, guesses: {} });
  const leaked = computeTickets({ ...base, guesses: { B: "A" } });
  assert.equal(leaked.A.total + leaked.B.total - (hidden.A.total + hidden.B.total), -1);
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

test("명단 요약: 이름·팀·근무지만, pid 순서 고정, 가입 여부·수상 제외 변화는 같은 요약", () => {
  const rows = [
    { pid: "p002", name: "다라", team: 2, loc: "S1L", uid: null, disqualified: false, inviteUsed: "X" },
    { pid: "p001", name: "가나", team: 1, loc: "SR3", uid: "u1", disqualified: false },
  ];
  const sum = rosterSummary(rows);
  assert.deepEqual(Object.keys(sum), ["p001", "p002"]);
  assert.deepEqual(sum.p002, { name: "다라", team: 2, loc: "S1L" });
  assert.deepEqual(summaryToList(sum).map((r) => r.pid), ["p001", "p002"]);
  const claimed = rows.map((r) => ({ ...r, uid: "u-" + r.pid, disqualified: true }));
  assert.ok(sameSummary(sum, rosterSummary(claimed)), "가입·제외만 바뀌면 다시 쓰지 않는다");
  assert.ok(!sameSummary(sum, rosterSummary(rows.map((r) => (r.pid === "p001" ? { ...r, team: 3 } : r)))), "팀이 바뀌면 다시 쓴다");
  assert.ok(sameSummary({ p002: sum.p002, p001: sum.p001 }, sum), "키 순서가 달라도 같은 요약");
});
