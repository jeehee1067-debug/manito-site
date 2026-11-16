import { PRIZES, TICKET_RULES as R } from "../config/prizes.js";
import { secureRandom, seededRandom } from "./random.js";

/**
 * 응모권 계산
 * people: [{ pid, part, disqualified, joined, dropout }]
 *   part        소속 파트(파트 대항전에 쓴다. 없으면 대항전에서 빠진다)
 *   joined      초대 코드로 가입했는지(생략하면 가입한 것으로 본다)
 *   dropout     운영자가 "중도 이탈"로 표시했는지
 * assignments: { giverPid: receiverPid }
 * giverCodes: { giverPid: { 1: code, 2: code, 3: code } }
 * redemptions: { code: { receiverPid, slot, voided, cardMatch } }
 *   cardMatch = false: 받는 사람이 "받은 것이 마니또가 고른 카드와 달라요"로 인증함 → 카드 추가분 없음
 * missions: { giverPid: { choices: { slot: { level } } } }
 * guesses: { receiverPid: guessPid }
 * deliveries: [{ receiverPid, slot }]  마니또가 "완료 알리기"(또는 쪽지 더 보내기)를 누를 때마다 1건
 *   missions의 완료 표시(done)도 완료 알림으로 친다(둘 중 하나만 있는 예전 자료도 같은 기준으로 보도록. 운영 화면 pairs.js와 같은 기준)
 * cluesDone: Set(giverPid) 프로필을 채워 단서 6개가 지금 대상에게 간 마니또. 주지 않으면(null) 은신 조건에서 단서를 보지 않는다.
 * angels: { receiverPid: angelPid } 운영자가 연결한 수호천사(마니또가 미션을 안 한 사람에게 지원자를 연결)
 * angelGifts: [{ receiverPid, k, confirmed }] 수호천사 미션(받는 사람이 확인하면 confirmed)
 * verdicts: { "받는사람pid_주차": "received" | "missing" }
 *   마니또가 완료를 알렸는데 인증이 없는 주차를 운영자가 확인한 결과(받는 사람이 "받은 게 없어요"로 신고한 주차 포함).
 *
 * 규칙
 *  - 마니또: 인증된 미션 1장씩(최대 3), 카드 추가분(보통 +1, 도전 +2, 합계 최대 4), 끝까지 안 들키면 은신 2장.
 *    은신은 내 미션이 1건 이상 인증된 마니또만 받는다(아무것도 안 한 사람이 가장 안 들키는 문제).
 *    그리고 단서 6개를 낸 마니또만 받는다(프로필을 안 채워 단서를 안 내면 덜 들키는 문제).
 *    카드 추가분은 받는 사람이 직접 인증한 미션에만 준다(아래 ②로 인정된 미션에는 주지 않는다).
 *  - 받는 사람: 인증 입력 1장씩(최대 3), 정답 지목 1장. 수호천사 미션을 확인한 것도 인증 입력으로 친다(보상과 합쳐 최대 3이라 이중으로 받지 않는다).
 *  - 수호천사: 확인된 수호천사 미션 1건마다 1장(최대 2). 내 미션 인증 수(은신·보상·우승 파트 조건)에는 넣지 않는다.
 *  - 상대방 때문에 손해 보지 않게:
 *    ① 내 마니또가 미션을 안 보낸 주차, 그리고 완료를 알렸지만 운영자가 "못 받음"으로 확인한 주차는 인증 입력 대신 1장(보상).
 *       인증 입력과 합쳐 최대 3장. 내 미션이 1건 이상 인증된 사람만.
 *    ② 완료를 알렸는데 인증이 없는 미션은, 대상이 불참(가입 안 함·중도 이탈)이거나 운영자가 "받았음"으로 확인하면 인증된 것으로 인정한다.
 *       운영자의 확인이 불참 자동 인정보다 먼저다("못 받음"이면 불참이어도 인정하지 않는다). 무효 처리된 인증은 인정하지 않는다.
 *    ③ 확인이 없는 미인증 주차(대상이 참여 중)는 마니또도 받는 사람도 받지 못한다.
 *  - 파트 대항전: 미션 완수율 1위 파트원에게 1장(동률이면 모두). 내 미션이 1건 이상 인증된 사람만.
 *  - 가입 안 한 사람, 중도 이탈, 수상 제외는 0장.
 */
export function computeTickets({ people, assignments, giverCodes, redemptions, missions, guesses, deliveries = [], verdicts = {}, cluesDone = null, angels = {}, angelGifts = [] }) {
  const out = {};
  const absent = new Set(); // 불참: 가입 안 함 또는 중도 이탈
  for (const p of people) {
    out[p.pid] = { mission: 0, card: 0, entries: 0, comp: 0, hidden: 0, guess: 0, partBonus: 0, angel: 0, total: 0, completion: 0, assumed: 0 };
    if (p.joined === false || p.dropout) absent.add(p.pid);
  }
  const valid = (code) => redemptions[code] && !redemptions[code].voided;
  const delivered = new Set(deliveries.map((d) => `${d.receiverPid}:${d.slot}`));
  for (const [giver, receiver] of Object.entries(assignments)) {
    for (const [slot, on] of Object.entries(missions[giver]?.done || {})) if (on) delivered.add(`${receiver}:${slot}`);
  }
  const cluesOk = (giver) => !R.hiddenNeedsClues || cluesDone == null || cluesDone.has(giver);
  const verdictOf = (receiver, slot) => verdicts[`${receiver}_${slot}`] || null;
  const credited = {}; // giverPid -> 인증(또는 인정)된 미션 수

  for (const [giver, receiver] of Object.entries(assignments)) {
    if (!out[giver]) continue;
    const codes = giverCodes[giver] || {};
    let redeemed = 0;
    let card = 0;
    let assumed = 0;
    for (const [slot, code] of Object.entries(codes)) {
      const byReceiver = valid(code);
      const v = verdictOf(receiver, slot);
      const byConfirm = !redemptions[code] && delivered.has(`${receiver}:${slot}`)
        && (v === "received" || (v == null && absent.has(receiver)));
      if (!byReceiver && !byConfirm) continue;
      redeemed++;
      if (byConfirm) assumed++;
      // 카드 추가분(보통·도전)은 받는 사람이 직접 인증했고, 받은 것이 고른 카드와 같다고 한 미션만
      else if (redemptions[code].cardMatch !== false) card += R.cardBonus[missions[giver]?.choices?.[slot]?.level] || 0;
    }
    credited[giver] = redeemed;
    redeemed = Math.min(redeemed, R.maxMissions);
    out[giver].mission = redeemed * R.perRedeemedMission;
    out[giver].card = Math.min(card, R.maxCardBonus);
    out[giver].completion = redeemed / R.maxMissions;
    out[giver].assumed = assumed;

    if (guesses[receiver] === giver && !absent.has(receiver)) {
      if (out[receiver]) out[receiver].guess = R.correctGuess;
    } else if (credited[giver] >= R.hiddenMinMissions && cluesOk(giver)) {
      out[giver].hidden = R.hidden;
    }
  }

  const entries = {};
  for (const r of Object.values(redemptions)) {
    if (r.voided) continue;
    entries[r.receiverPid] = (entries[r.receiverPid] || 0) + 1;
  }
  // 수호천사 미션: 받는 사람이 확인한 것만. 받는 사람에게는 인증 입력, 연결된 수호천사에게는 수호천사 응모권
  const angelCount = {};
  for (const g of angelGifts) {
    const angel = angels[g.receiverPid];
    if (!g.confirmed || !angel) continue;
    entries[g.receiverPid] = (entries[g.receiverPid] || 0) + 1;
    angelCount[angel] = (angelCount[angel] || 0) + 1;
  }
  for (const [pid, n] of Object.entries(angelCount)) {
    if (out[pid]) out[pid].angel = Math.min(n, R.maxAngel) * R.angelPerMission;
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
    t.total = zero.has(pid) ? 0 : t.mission + t.card + t.entries + t.comp + t.hidden + t.guess + t.partBonus + t.angel;
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

/**
 * 검증할 수 있는 추첨: 현장에서 정한 숫자(seed)와 응모권 표만으로 결과가 정해진다.
 * 같은 seed·같은 응모권이면 누가 다시 계산해도 같은 당첨자가 나온다(결과 화면의 "추첨 검증").
 * 운영자가 미리 여러 번 돌려 보고 고를 수 없게, seed는 추첨 직전에 현장에서 정한다(예: 참석자가 부른 숫자).
 * tickets: { pid: 장수 }, step: { key, count }, exclude: 앞 순서에서 이미 받은 사람
 */
export function seededDraw(tickets, step, seed, exclude = new Set()) {
  const entries = Object.entries(tickets).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([pid, weight]) => ({ pid, weight }));
  return weightedDraw(entries, step.count, seededRandom(`${String(seed).trim()}|${step.key}`), exclude);
}

/**
 * 응모권이 많은 순으로 count명(2등 베스트 마니또). 추첨이 아니라 순위이고, 경계에서 동점일 때만 seed로 가른다.
 * 반환은 응모권이 많은 순서. 응모권 0장과 exclude(1등 당첨자)는 뺀다.
 */
export function seededTop(tickets, step, seed, exclude = new Set()) {
  const rand = seededRandom(`${String(seed).trim()}|${step.key}`);
  return Object.entries(tickets)
    .filter(([pid, n]) => n > 0 && !exclude.has(pid))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([pid, n]) => ({ pid, n, tie: rand() }))
    .sort((a, b) => b.n - a.n || a.tie - b.tie)
    .slice(0, step.count)
    .map((x) => x.pid);
}

// 정하는 순서(큰 상부터). kind: "draw" = 응모권 수에 비례한 추첨, "top" = 응모권이 많은 순
export const DRAW_ORDER = [
  { ...PRIZES.grand, kind: "draw" },
  { ...PRIZES.bestManito, kind: "top" },
  ...PRIZES.tiers.map((t) => ({ ...t, kind: "draw" })),
];

/**
 * 한 번에 추첨: 현장 숫자 하나로 큰 상부터 차례로 정한다. 앞에서 받은 사람은 뒤 순서에서 빠진다(한 사람은 하나만).
 * 작은 상부터 뽑으면 응모권이 많은 사람일수록 작은 상에 먼저 뽑혀 큰 상 기회를 잃기 때문에 큰 상부터 정한다.
 * 반환: { grand: { seed, winners }, best: { seed, winners }, t4: …, t5: …, t6: … } (results/public.draws에 그대로 저장)
 */
export function drawAll(tickets, seed, order = DRAW_ORDER) {
  const s = String(seed).trim();
  const won = new Set();
  const out = {};
  for (const step of order) {
    const winners = step.kind === "top" ? seededTop(tickets, step, s, won) : seededDraw(tickets, step, s, won);
    winners.forEach((pid) => won.add(pid));
    out[step.key] = { seed: s, winners };
  }
  return out;
}

/**
 * 추첨 검증: 저장된 결과(draws)를 저장된 숫자로 다시 계산해 같은지 본다.
 * 반환: [{ key, ok, expected, saved }]. 한 번에 뽑은 결과가 아니면(칸이 빠졌거나 숫자가 칸마다 다르면) 모두 ok = false.
 */
export function verifyDraws(tickets, draws, order = DRAW_ORDER) {
  const have = order.filter((s) => draws?.[s.key]);
  if (have.length === 0) return [];
  const seeds = new Set(have.map((s) => draws[s.key].seed ?? null));
  const seed = have.length === order.length && seeds.size === 1 ? [...seeds][0] : null;
  const expected = seed == null ? null : drawAll(tickets, seed, order);
  return order.map((s) => {
    const saved = draws?.[s.key]?.winners || [];
    const exp = expected ? expected[s.key].winners : null;
    return { key: s.key, ok: exp != null && JSON.stringify(exp) === JSON.stringify(saved), expected: exp, saved };
  });
}

/**
 * 알아챈 주차: 받는 사람이 최종 지목에서 마니또를 맞혔을 때, 중간 추측(1~3주차)부터 끝까지 계속 맞힌 첫 주차.
 * assignments: { giverPid: receiverPid }, midGuesses: { receiverPid: { 1: pid, 2: pid, 3: pid } }, guesses: { receiverPid: guessPid }
 * 반환: { receiverPid: 1 | 2 | 3 | 4 } (4 = 최종 지목에서야 맞힘). 최종 지목이 틀렸거나 없으면 넣지 않는다.
 * 중간에 다른 사람을 찍었거나 비운 주차가 있으면 그다음 주차부터 센다. 응모권과는 상관없다(송년회 발표용 칭호).
 */
export function noticedWeeks(assignments, midGuesses = {}, guesses = {}) {
  const out = {};
  for (const [giver, receiver] of Object.entries(assignments)) {
    if (guesses[receiver] !== giver) continue;
    let week = 4;
    for (let w = 3; w >= 1; w--) {
      if (midGuesses[receiver]?.[w] === giver) week = w;
      else break;
    }
    out[receiver] = week;
  }
  return out;
}
