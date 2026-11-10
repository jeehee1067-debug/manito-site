import { TICKET_RULES as R, SCORE_WEIGHTS as W } from "../config/prizes.js";
import { secureRandom } from "./random.js";

/**
 * 응모권 계산
 * people: [{ pid, disqualified }]
 * assignments: { giverPid: receiverPid }
 * giverCodes: { giverPid: { 1: code, 2: code, 3: code } }
 * redemptions: { code: { receiverPid, slot, voided } }
 * missions: { giverPid: { choices: { slot: { level } } } }
 * guesses: { receiverPid: guessPid }
 */
export function computeTickets({ people, assignments, giverCodes, redemptions, missions, guesses }) {
  const out = {};
  for (const p of people) {
    out[p.pid] = { mission: 0, hard: 0, entries: 0, hidden: 0, guess: 0, total: 0, completion: 0 };
  }
  const valid = (code) => redemptions[code] && !redemptions[code].voided;

  for (const [giver, receiver] of Object.entries(assignments)) {
    if (!out[giver]) continue;
    const codes = giverCodes[giver] || {};
    let redeemed = 0;
    let hard = 0;
    for (const [slot, code] of Object.entries(codes)) {
      if (!valid(code)) continue;
      redeemed++;
      if (missions[giver]?.choices?.[slot]?.level === "hard") hard++;
    }
    redeemed = Math.min(redeemed, R.maxMissions);
    hard = Math.min(hard, R.maxHard);
    out[giver].mission = redeemed * R.perRedeemedMission;
    out[giver].hard = hard * R.perHardMission;
    out[giver].completion = redeemed / R.maxMissions;

    if (guesses[receiver] === giver) {
      if (out[receiver]) out[receiver].guess = R.correctGuess;
    } else {
      out[giver].hidden = R.hidden;
    }
  }

  const entries = {};
  for (const r of Object.values(redemptions)) {
    if (r.voided) continue;
    entries[r.receiverPid] = (entries[r.receiverPid] || 0) + 1;
  }
  for (const [pid, n] of Object.entries(entries)) {
    if (out[pid]) out[pid].entries = Math.min(n, R.maxReceiverEntries) * R.perReceiverEntry;
  }

  const dq = new Set(people.filter((p) => p.disqualified).map((p) => p.pid));
  for (const [pid, t] of Object.entries(out)) {
    t.total = dq.has(pid) ? 0 : t.mission + t.hard + t.entries + t.hidden + t.guess;
  }
  return out;
}

/**
 * 베스트 마니또 점수: 완수율·전체 투표·운영진 평가
 * cards: [{ cardId, giverPid }], votes: { voterPid: [cardId] }, adminEval: { cardId: 0~10 }
 */
export function rankBestManito({ cards, votes, adminEval, tickets, disqualified = new Set() }) {
  const voteCount = {};
  for (const ids of Object.values(votes)) for (const id of ids) voteCount[id] = (voteCount[id] || 0) + 1;
  const maxVotes = Math.max(1, ...Object.values(voteCount));
  return cards
    .filter((c) => !disqualified.has(c.giverPid))
    .map((c) => {
      const completion = tickets[c.giverPid]?.completion || 0;
      const vote = (voteCount[c.cardId] || 0) / maxVotes;
      const evalScore = Math.min(10, Math.max(0, Number(adminEval[c.cardId] || 0)));
      const score = W.completion * completion + W.vote * vote + W.admin * (evalScore / 10);
      return { ...c, completion, votes: voteCount[c.cardId] || 0, admin: evalScore, score };
    })
    .sort((a, b) => b.score - a.score);
}

// 응모권 수에 비례한 비복원 추첨
export function weightedDraw(entries, count, rand = secureRandom, exclude = new Set()) {
  const pool = entries.filter((e) => e.weight > 0 && !exclude.has(e.pid)).map((e) => ({ ...e }));
  const winners = [];
  while (winners.length < count && pool.length) {
    const total = pool.reduce((s, e) => s + e.weight, 0);
    let x = rand() * total;
    let idx = pool.findIndex((e) => (x -= e.weight) < 0);
    if (idx < 0) idx = pool.length - 1;
    winners.push(pool[idx].pid);
    pool.splice(idx, 1);
  }
  return winners;
}

// 최다 응모권상: 최댓값 동점자 중 무작위 1명
export function pickMostTickets(tickets, rand = secureRandom) {
  const rows = Object.entries(tickets).filter(([, t]) => t.total > 0);
  if (!rows.length) return null;
  const max = Math.max(...rows.map(([, t]) => t.total));
  const tied = rows.filter(([, t]) => t.total === max).map(([pid]) => pid);
  return { pid: tied[Math.floor(rand() * tied.length)], total: max, tiedCount: tied.length };
}
