import { TICKET_RULES as R, SCORE_WEIGHTS as W } from "../config/prizes.js";
import { secureRandom } from "./random.js";

/**
 * 응모권 계산
 * people: [{ pid, disqualified, joined, dropout, creditGiver }]
 *   joined      초대 코드로 가입했는지(생략하면 가입한 것으로 본다)
 *   dropout     운영자가 "중도 이탈"로 표시했는지
 *   creditGiver 운영자가 "받고도 인증하지 않음 → 마니또의 미션 인정"으로 표시했는지(본인 응모권은 그대로)
 * assignments: { giverPid: receiverPid }
 * giverCodes: { giverPid: { 1: code, 2: code, 3: code } }
 * redemptions: { code: { receiverPid, slot, voided } }
 * missions: { giverPid: { choices: { slot: { level } } } }
 * guesses: { receiverPid: guessPid }
 * deliveries: [{ receiverPid, slot }]  마니또가 "완료 알리기"를 누를 때마다 1건(쪽지를 안 써도 생긴다)
 *
 * 규칙
 *  - 마니또: 인증된 미션 1장씩(최대 3), 도전 +1(최대 2), 끝까지 안 들키면 은신 2장.
 *    은신은 내 미션이 1건 이상 인증된 마니또만 받는다(아무것도 안 한 사람이 가장 안 들키는 문제).
 *  - 받는 사람: 인증 입력 1장씩(최대 3), 정답 지목 1장.
 *  - 상대방 때문에 손해 보지 않게:
 *    ① 내 마니또가 미션을 안 보낸 주차는 인증 입력 대신 1장(보상). 인증 입력과 합쳐 최대 3장. 내 미션이 1건 이상 인증된 사람만.
 *    ② 내 대상이 불참(가입 안 함·중도 이탈)이거나, 받고도 인증하지 않은 것을 운영자가 확인해 표시하면,
 *       내가 완료 알린 미션(인증 기록이 없는 것)은 인증된 것으로 인정한다. 운영자가 무효 처리한 인증은 인정하지 않는다.
 *  - 가입 안 한 사람, 중도 이탈, 수상 제외는 0장.
 */
export function computeTickets({ people, assignments, giverCodes, redemptions, missions, guesses, deliveries = [] }) {
  const out = {};
  const absent = new Set(); // 불참: 가입 안 함 또는 중도 이탈
  const credit = new Set(); // 이 사람이 받은 완료 알림은 인증 없이도 마니또의 미션으로 인정
  for (const p of people) {
    out[p.pid] = { mission: 0, hard: 0, entries: 0, comp: 0, hidden: 0, guess: 0, total: 0, completion: 0, assumed: 0 };
    if (p.joined === false || p.dropout) absent.add(p.pid);
    if (p.joined === false || p.dropout || p.creditGiver) credit.add(p.pid);
  }
  const valid = (code) => redemptions[code] && !redemptions[code].voided;
  const delivered = new Set(deliveries.map((d) => `${d.receiverPid}:${d.slot}`));
  const credited = {}; // giverPid -> 인증(또는 인정)된 미션 수

  for (const [giver, receiver] of Object.entries(assignments)) {
    if (!out[giver]) continue;
    const codes = giverCodes[giver] || {};
    let redeemed = 0;
    let hard = 0;
    let assumed = 0;
    for (const [slot, code] of Object.entries(codes)) {
      const byReceiver = valid(code);
      const byAbsence = !redemptions[code] && credit.has(receiver) && delivered.has(`${receiver}:${slot}`);
      if (!byReceiver && !byAbsence) continue;
      redeemed++;
      if (byAbsence) assumed++;
      if (missions[giver]?.choices?.[slot]?.level === "hard") hard++;
    }
    credited[giver] = redeemed;
    redeemed = Math.min(redeemed, R.maxMissions);
    hard = Math.min(hard, R.maxHard);
    out[giver].mission = redeemed * R.perRedeemedMission;
    out[giver].hard = hard * R.perHardMission;
    out[giver].completion = redeemed / R.maxMissions;
    out[giver].assumed = assumed;

    if (guesses[receiver] === giver && !absent.has(receiver)) {
      if (out[receiver]) out[receiver].guess = R.correctGuess;
    } else if (credited[giver] >= R.hiddenMinMissions) {
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

  // ① 보상: 마니또가 아무것도 안 보낸 주차(완료 알림도, 인증 기록도 없는 슬롯)
  for (const [giver, receiver] of Object.entries(assignments)) {
    if (!out[receiver] || (credited[receiver] || 0) < R.compMinMissions) continue;
    const codes = giverCodes[giver] || {};
    let missed = 0;
    for (const [slot, code] of Object.entries(codes)) {
      if (!delivered.has(`${receiver}:${slot}`) && !redemptions[code]) missed++;
    }
    const room = R.maxReceiverEntries * R.perReceiverEntry - out[receiver].entries;
    out[receiver].comp = Math.max(0, Math.min(missed * R.compPerMissedWeek, room));
  }

  const zero = new Set(people.filter((p) => p.disqualified).map((p) => p.pid));
  for (const pid of absent) zero.add(pid);
  for (const [pid, t] of Object.entries(out)) {
    t.total = zero.has(pid) ? 0 : t.mission + t.hard + t.entries + t.comp + t.hidden + t.guess;
  }
  return out;
}

/**
 * 베스트 마니또 점수: 완수율·전체 투표·운영진 평가
 * cards: [{ cardId, giverPid }], votes: { voterPid: [cardId] }, adminEval: { cardId: 0~10 }
 * 동점이면 인증된 미션이 많은 쪽 → 득표가 많은 쪽 → 운영진 평가가 높은 쪽 → 무작위(집계할 때 한 번 뽑아 결과에 저장).
 */
export function rankBestManito({ cards, votes, adminEval, tickets, disqualified = new Set(), rand = secureRandom }) {
  const voteCount = {};
  for (const ids of Object.values(votes)) for (const id of ids) voteCount[id] = (voteCount[id] || 0) + 1;
  const maxVotes = Math.max(1, ...Object.values(voteCount));
  const EPS = 1e-9;
  return cards
    .filter((c) => !disqualified.has(c.giverPid))
    .map((c) => {
      const completion = tickets[c.giverPid]?.completion || 0;
      const vote = (voteCount[c.cardId] || 0) / maxVotes;
      const evalScore = Math.min(10, Math.max(0, Number(adminEval[c.cardId] || 0)));
      const score = W.completion * completion + W.vote * vote + W.admin * (evalScore / 10);
      return { ...c, completion, votes: voteCount[c.cardId] || 0, admin: evalScore, score, tieBreak: rand() };
    })
    .sort((a, b) =>
      Math.abs(b.score - a.score) > EPS ? b.score - a.score
        : b.completion !== a.completion ? b.completion - a.completion
          : b.votes !== a.votes ? b.votes - a.votes
            : b.admin !== a.admin ? b.admin - a.admin
              : b.tieBreak - a.tieBreak);
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
