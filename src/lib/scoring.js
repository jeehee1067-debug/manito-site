import { TICKET_RULES as R, SCORE_WEIGHTS as W } from "../config/prizes.js";
import { secureRandom } from "./random.js";

/**
 * 응모권 계산
 * people: [{ pid, part, disqualified, joined, dropout }]
 *   part        소속 파트(파트 대항전에 쓴다. 없으면 대항전에서 빠진다)
 *   joined      초대 코드로 가입했는지(생략하면 가입한 것으로 본다)
 *   dropout     운영자가 "중도 이탈"로 표시했는지
 * assignments: { giverPid: receiverPid }
 * giverCodes: { giverPid: { 1: code, 2: code, 3: code } }
 * redemptions: { code: { receiverPid, slot, voided } }
 * missions: { giverPid: { choices: { slot: { level } } } }
 * guesses: { receiverPid: guessPid }
 * deliveries: [{ receiverPid, slot }]  마니또가 "완료 알리기"(또는 쪽지 더 보내기)를 누를 때마다 1건
 * verdicts: { "받는사람pid_주차": "received" | "missing" }
 *   마니또가 완료를 알렸는데 인증이 없는 주차를 운영자가 확인한 결과(받는 사람이 "받은 게 없어요"로 신고한 주차 포함).
 *
 * 규칙
 *  - 마니또: 인증된 미션 1장씩(최대 3), 도전 +1(최대 2), 끝까지 안 들키면 은신 2장.
 *    은신은 내 미션이 1건 이상 인증된 마니또만 받는다(아무것도 안 한 사람이 가장 안 들키는 문제).
 *    도전 추가분은 받는 사람이 직접 인증한 미션에만 준다(아래 ②로 인정된 미션에는 주지 않는다).
 *  - 받는 사람: 인증 입력 1장씩(최대 3), 정답 지목 1장.
 *  - 상대방 때문에 손해 보지 않게:
 *    ① 내 마니또가 미션을 안 보낸 주차, 그리고 완료를 알렸지만 운영자가 "못 받음"으로 확인한 주차는 인증 입력 대신 1장(보상).
 *       인증 입력과 합쳐 최대 3장. 내 미션이 1건 이상 인증된 사람만.
 *    ② 완료를 알렸는데 인증이 없는 미션은, 대상이 불참(가입 안 함·중도 이탈)이거나 운영자가 "받았음"으로 확인하면 인증된 것으로 인정한다.
 *       운영자의 확인이 불참 자동 인정보다 먼저다("못 받음"이면 불참이어도 인정하지 않는다). 무효 처리된 인증은 인정하지 않는다.
 *    ③ 확인이 없는 미인증 주차(대상이 참여 중)는 마니또도 받는 사람도 받지 못한다.
 *  - 파트 대항전: 미션 완수율 1위 파트원에게 1장(동률이면 모두). 내 미션이 1건 이상 인증된 사람만.
 *  - 가입 안 한 사람, 중도 이탈, 수상 제외는 0장.
 */
export function computeTickets({ people, assignments, giverCodes, redemptions, missions, guesses, deliveries = [], verdicts = {} }) {
  const out = {};
  const absent = new Set(); // 불참: 가입 안 함 또는 중도 이탈
  for (const p of people) {
    out[p.pid] = { mission: 0, hard: 0, entries: 0, comp: 0, hidden: 0, guess: 0, partBonus: 0, total: 0, completion: 0, assumed: 0 };
    if (p.joined === false || p.dropout) absent.add(p.pid);
  }
  const valid = (code) => redemptions[code] && !redemptions[code].voided;
  const delivered = new Set(deliveries.map((d) => `${d.receiverPid}:${d.slot}`));
  const verdictOf = (receiver, slot) => verdicts[`${receiver}_${slot}`] || null;
  const credited = {}; // giverPid -> 인증(또는 인정)된 미션 수

  for (const [giver, receiver] of Object.entries(assignments)) {
    if (!out[giver]) continue;
    const codes = giverCodes[giver] || {};
    let redeemed = 0;
    let hard = 0;
    let assumed = 0;
    for (const [slot, code] of Object.entries(codes)) {
      const byReceiver = valid(code);
      const v = verdictOf(receiver, slot);
      const byConfirm = !redemptions[code] && delivered.has(`${receiver}:${slot}`)
        && (v === "received" || (v == null && absent.has(receiver)));
      if (!byReceiver && !byConfirm) continue;
      redeemed++;
      if (byConfirm) assumed++;
      else if (missions[giver]?.choices?.[slot]?.level === "hard") hard++; // 도전 추가분은 직접 인증된 미션만
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

  // ① 보상: 인증 기록이 없는 주차 중, 마니또가 완료를 알리지 않았거나 운영자가 "못 받음"으로 확인한 주차
  for (const [giver, receiver] of Object.entries(assignments)) {
    if (!out[receiver] || (credited[receiver] || 0) < R.compMinMissions) continue;
    const codes = giverCodes[giver] || {};
    let missed = 0;
    for (const [slot, code] of Object.entries(codes)) {
      if (redemptions[code]) continue;
      if (!delivered.has(`${receiver}:${slot}`) || verdictOf(receiver, slot) === "missing") missed++;
    }
    const room = R.maxReceiverEntries * R.perReceiverEntry - out[receiver].entries;
    out[receiver].comp = Math.max(0, Math.min(missed * R.compPerMissedWeek, room));
  }

  const zero = new Set(people.filter((p) => p.disqualified).map((p) => p.pid));
  for (const pid of absent) zero.add(pid);

  // 파트 대항전
  const winners = new Set(partStandings(people, out).filter((x) => x.winner).map((x) => x.part));
  for (const p of people) {
    if (winners.has(p.part) && !zero.has(p.pid) && (credited[p.pid] || 0) >= R.partBonusMinMissions) out[p.pid].partBonus = R.partBonus;
  }

  for (const [pid, t] of Object.entries(out)) {
    t.total = zero.has(pid) ? 0 : t.mission + t.hard + t.entries + t.comp + t.hidden + t.guess + t.partBonus;
  }
  return out;
}

const hasPart = (p) => p.part != null && p.part !== "";
const active = (p) => hasPart(p) && p.joined !== false && !p.dropout; // 대항전에 세는 사람: 파트가 있고 불참이 아닌 사람

// 순위 매기기: 완수율(done / max) 내림차순. 나눗셈 오차 없이 비교한다. winner = 완수율이 0보다 크고 1위(동률 포함)
function rankParts(byPart) {
  const rows = Object.entries(byPart)
    .filter(([, x]) => x.max > 0)
    .map(([part, x]) => ({ part, ...x, rate: x.done / x.max }))
    .sort((a, b) => b.done * a.max - a.done * b.max || a.part.localeCompare(b.part, "ko"));
  const top = rows[0];
  return rows.map((x) => ({ ...x, winner: Boolean(top) && top.done > 0 && x.done * top.max === top.done * x.max }));
}

/**
 * 파트 대항전 최종 순위: 인증(인정)된 미션 수 / (파트 인원 × 3)
 * tickets: computeTickets 결과(mission = 인증·인정된 미션 수)
 * 반환: [{ part, members, done, max, rate, winner }] 완수율 높은 순
 */
export function partStandings(people, tickets) {
  const byPart = {};
  for (const p of people) {
    if (!active(p)) continue;
    const x = (byPart[p.part] ||= { members: 0, done: 0, max: 0 });
    x.members++;
    x.done += tickets[p.pid]?.mission || 0;
    x.max += R.maxMissions;
  }
  return rankParts(byPart);
}

/**
 * 파트 대항전 주간 순위(행사 중 발표용): 각자 "완료 알리기"를 누른 수 / (파트 인원 × 지금까지 열린 주차)
 * 주간 순위는 완료 알림 수 기준이다(처음 만들 때는 운영자도 짝을 읽을 수 없어 인증을 파트별로 셀 수 없었다.
 * 지금은 운영자가 짝을 읽지만 기준은 그대로 두었다). 최종 순위(partStandings)는 인증 기준이다.
 * doneCounts: { pid: 완료 알린 미션 수 }, week: 열린 주차(1~3)
 */
export function weeklyPartBoard(people, doneCounts, week) {
  const byPart = {};
  for (const p of people) {
    if (!active(p)) continue;
    const x = (byPart[p.part] ||= { members: 0, done: 0, max: 0 });
    x.members++;
    x.done += Math.min(week, doneCounts[p.pid] || 0);
    x.max += week;
  }
  return rankParts(byPart);
}

/**
 * 투표 집계. 투표 화면은 내 파트 카드를 숨기므로(Vote.jsx) 파트 인원이 다르면 카드마다 볼 수 있는 사람 수가 다르다.
 * 그래서 표 수를 그대로 쓰지 않고 "기대 득표"로 나눈다.
 *   기대 득표 = 그 카드를 볼 수 있었던 투표자마다 (고른 수 ÷ 그 사람에게 보인 카드 수)를 더한 값
 *             = 모두가 보이는 카드 중에서 고르게 찍었을 때 받는 표 수
 * 파트 인원이 모두 같으면(또는 파트가 없으면) 기대 득표가 카드마다 같아서 표 수 그대로 비교하는 것과 같다.
 * 화면에서 고를 수 없는 표(내 파트 카드, 없는 카드, 같은 카드 중복)는 세지 않는다. 보안 규칙은 장수(3장)만 확인하기 때문이다.
 * cards: [{ cardId, giverPid }], votes: { voterPid: [cardId] }, partOf: { pid: part }
 * 반환: { count: { cardId: 표 수 }, expected: { cardId: 기대 득표 } }
 */
export function tallyVotes(cards, votes, partOf = {}) {
  const sees = (voter, card) => !partOf[voter] || partOf[card.giverPid] !== partOf[voter];
  const count = Object.fromEntries(cards.map((c) => [c.cardId, 0]));
  const expected = { ...count };
  for (const [voter, ids] of Object.entries(votes)) {
    const visible = cards.filter((c) => sees(voter, c));
    const ok = new Set(visible.map((c) => c.cardId));
    const picks = [...new Set(ids || [])].filter((id) => ok.has(id));
    if (!picks.length) continue;
    for (const id of picks) count[id]++;
    for (const c of visible) expected[c.cardId] += picks.length / visible.length;
  }
  return { count, expected };
}

/**
 * 베스트 마니또 점수: 완수율·전체 투표·운영진 평가
 * cards: [{ cardId, giverPid }], votes: { voterPid: [cardId] }, adminEval: { cardId: 0~10 }, partOf: { pid: part }
 * disqualified: 수상 대상이 아닌 마니또(수상 제외·불참). 이 사람들의 카드는 처음부터 없는 것으로 보고 집계한다.
 *   그 카드에 간 표는 버리고, 그 카드가 표를 많이 받았어도 다른 카드의 투표 점수가 낮아지지 않는다.
 * 투표 점수 = (표 수 ÷ 기대 득표)를 수상 대상 카드 중 가장 높은 카드가 1이 되게 맞춘 값(tallyVotes 설명 참고).
 * 동점이면 인증된 미션이 많은 쪽 → 투표 점수가 높은 쪽 → 운영진 평가가 높은 쪽 → 무작위(집계할 때 한 번 뽑아 결과에 저장).
 */
export function rankBestManito({ cards, votes, adminEval, tickets, disqualified = new Set(), partOf = {}, rand = secureRandom }) {
  const eligible = cards.filter((c) => !disqualified.has(c.giverPid));
  const { count, expected } = tallyVotes(eligible, votes, partOf);
  const lift = (id) => (expected[id] > 0 ? count[id] / expected[id] : 0);
  const maxLift = Math.max(0, ...eligible.map((c) => lift(c.cardId))) || 1;
  const EPS = 1e-9;
  return eligible
    .map((c) => {
      const completion = tickets[c.giverPid]?.completion || 0;
      const vote = lift(c.cardId) / maxLift;
      const evalScore = Math.min(10, Math.max(0, Number(adminEval[c.cardId] || 0)));
      const score = W.completion * completion + W.vote * vote + W.admin * (evalScore / 10);
      return { ...c, completion, votes: count[c.cardId], vote, admin: evalScore, score, tieBreak: rand() };
    })
    .sort((a, b) =>
      Math.abs(b.score - a.score) > EPS ? b.score - a.score
        : b.completion !== a.completion ? b.completion - a.completion
          : Math.abs(b.vote - a.vote) > EPS ? b.vote - a.vote
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
