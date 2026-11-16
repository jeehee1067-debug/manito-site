import { PRIZES, TICKET_RULES as R } from "../config/prizes.js";
import { secureRandom, seededRandom } from "./random.js";
import { MISSION_CARDS } from "./constants.js";

// 카드 목록(번호 → 난이도·글). 고른 카드(choice)의 번호·난이도·글이 목록과 모두 같을 때만 그 난이도를 인정한다.
// 저장된 난이도를 그대로 믿으면, 쉬운 카드를 "도전"이라고 적어 추가 응모권을 받을 수 있다(보안 규칙은 번호와 난이도가 맞는지만 본다).
const CARD_BY_ID = Object.fromEntries(Object.entries(MISSION_CARDS).flatMap(([level, cards]) => cards.map((c) => [c.id, { level, text: c.text, cost: Boolean(c.cost) }])));
const knownCard = (choice) => {
  const c = choice && CARD_BY_ID[choice.cardId];
  return c && c.level === choice.level && c.text === choice.text ? c : null;
};
export function cardLevel(choice) {
  return knownCard(choice)?.level ?? null;
}
// 돈이 드는 카드("소액 비용")인지. 카드 목록과 맞는 카드만 인정한다.
export function cardCost(choice) {
  return Boolean(knownCard(choice)?.cost);
}

/**
 * 응모권 계산
 * people: [{ pid, part, disqualified, joined, dropout }]
 *   part        소속 파트(파트 대항전에 쓴다. 없으면 대항전에서 빠진다)
 *   joined      초대 코드로 가입했는지(생략하면 가입한 것으로 본다)
 *   dropout     운영자가 "중도 이탈"로 표시했는지
 * assignments: { giverPid: receiverPid }
 * giverCodes: { giverPid: { 1: code, 2: code, 3: code } }
 * redemptions: { code: { receiverPid, slot, voided, cardMatch } }
 *   cardMatch = true: 받는 사람이 마니또가 고른 카드를 보고 "받은 것이 이 카드와 같아요"라고 함 → 카드 추가분이 붙는다.
 *   false("달라요")이거나 값이 없으면(완료 알림보다 먼저 인증해서 카드를 못 봤고, 나중에도 확인하지 않음) 카드 추가분이 없다.
 * missions: { giverPid: { choices: { slot: { cardId, level, text } }, done: { slot: true } } }
 *   카드 추가분의 난이도는 cardLevel로 정한다(번호·난이도·글이 카드 목록과 같을 때만). 완료 표시는 정확히 true일 때만 센다.
 * guesses: { receiverPid: guessPid }
 * deliveries: [{ receiverPid, slot, kind, hidden }]  마니또가 "완료 알리기"(또는 쪽지 더 보내기)를 누를 때마다 1건
 *   kind = "praise"(3주차 칭찬 카드)이고 운영자가 가리지 않은(hidden 아님) 것은 사이트가 직접 전달한 것이라 인증 없이도 인정한다(아래 ②)
 *   missions의 완료 표시(done)도 완료 알림으로 친다(둘 중 하나만 있는 예전 자료도 같은 기준으로 보도록. 운영 화면 pairs.js와 같은 기준)
 * cluesDone: Set(giverPid) 프로필을 채워 단서 6개가 지금 대상에게 간 마니또. 주지 않으면(null) 은신 조건에서 단서를 보지 않는다.
 * angels: { receiverPid: angelPid } 운영자가 연결한 수호천사(마니또가 미션을 안 한 사람에게 지원자를 연결)
 * angelGifts: [{ receiverPid, k, confirmed }] 수호천사 미션(받는 사람이 확인하면 confirmed)
 * verdicts: { "받는사람pid_주차": "received" | "missing" }
 *   마니또가 완료를 알렸는데 인증이 없는 주차를 운영자가 확인한 결과(받는 사람이 "받은 게 없어요"로 신고한 주차 포함).
 *
 * 규칙
 *  - 마니또: 인증된 미션 1장씩(최대 3), 카드 추가분(보통 +1, 도전 +2, 합계 최대 4), 끝까지 안 들키면 은신 2장.
 *    돈이 드는 카드(소액 비용) 미션이 카드 추가분과 같은 조건(대상이 직접 인증하고 카드와 같다고 확인)으로 인증되면 +1장, 한 사람에 한 번만.
 *    은신은 내 미션이 hiddenMinMissions건(3건 모두) 인증·인정된 마니또만 받는다(아무것도 안 하거나 1주만 하고 쉬어도 안 들켜서 받는 문제).
 *    그리고 단서 6개를 낸 마니또만 받는다(프로필을 안 채워 단서를 안 내면 덜 들키는 문제).
 *    카드 추가분은 받는 사람이 직접 인증한 미션에만 준다(아래 ②로 인정된 미션에는 주지 않는다).
 *  - 받는 사람: 인증 입력 1장씩(최대 3), 정답 지목 1장. 수호천사 미션을 확인한 것도 인증 입력으로 친다(보상과 합쳐 최대 3이라 이중으로 받지 않는다).
 *  - 수호천사: 확인된 수호천사 미션 1건마다 1장(최대 2). 내 미션 인증 수(은신·보상·우승 파트 조건)에는 넣지 않는다.
 *  - 상대방 때문에 손해 보지 않게:
 *    ① 내 마니또가 미션을 안 보낸 주차, 그리고 완료를 알렸지만 운영자가 "못 받음"으로 확인한 주차는 인증 입력 대신 1장(보상).
 *       인증 입력과 합쳐 최대 3장. 내 미션이 1건 이상 인증된 사람만.
 *    ② 받는 사람의 유효한 인증이 없는 미션도 다음 경우에는 마니또의 미션으로 인정한다(카드 추가분은 없음).
 *       - 운영자가 "받았음"으로 확인: 인증이 없을 때도, 인증이 무효 처리됐을 때도(후기가 성의 없어 무효가 됐지만 미션은 실제로 받은 경우).
 *       - 확인이 없고 인증 기록도 없을 때: 대상이 불참(가입 안 함·중도 이탈)이거나, 사이트가 전달한 3주차 칭찬 카드(운영자가 가리지 않은 것).
 *       운영자의 확인이 자동 인정보다 먼저다("못 받음"이면 불참이어도, 칭찬 카드여도 인정하지 않는다).
 *       무효 처리된 인증은 운영자가 "받았음"으로 확인하지 않으면 인정하지 않는다.
 *    ③ 확인이 없는 미인증 주차(대상이 참여 중)는 마니또도 받는 사람도 받지 못한다.
 *  - 파트 대항전: 미션 완수율 1위 파트원에게 1장(동률이면 모두). 내 미션이 1건 이상 인증된 사람만.
 *  - 가입 안 한 사람, 중도 이탈, 수상 제외는 0장.
 */
export function computeTickets({ people, assignments, giverCodes, redemptions, missions, guesses, deliveries = [], verdicts = {}, cluesDone = null, angels = {}, angelGifts = [] }) {
  const out = {};
  const absent = new Set(); // 불참: 가입 안 함 또는 중도 이탈
  for (const p of people) {
    out[p.pid] = { mission: 0, card: 0, cost: 0, entries: 0, comp: 0, hidden: 0, guess: 0, partBonus: 0, angel: 0, total: 0, completion: 0, assumed: 0 };
    if (p.joined === false || p.dropout) absent.add(p.pid);
  }
  const valid = (code) => redemptions[code] && !redemptions[code].voided;
  const delivered = new Set(deliveries.map((d) => `${d.receiverPid}:${d.slot}`));
  const autoPraise = new Set(deliveries.filter((d) => d.kind === "praise" && !d.hidden).map((d) => `${d.receiverPid}:${d.slot}`));
  for (const [giver, receiver] of Object.entries(assignments)) {
    for (const [slot, on] of Object.entries(missions[giver]?.done || {})) if (on === true) delivered.add(`${receiver}:${slot}`);
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
    let paid = false; // 돈이 드는 카드 미션이 대상의 확인까지 받았는지
    for (const [slot, code] of Object.entries(codes)) {
      const byReceiver = valid(code);
      const v = verdictOf(receiver, slot);
      const key = `${receiver}:${slot}`;
      const hasRecord = Boolean(redemptions[code]); // 무효 처리된 인증도 "받는 사람이 코드를 넣은 기록"이다
      const byConfirm = !byReceiver && (
        (v === "received" && (delivered.has(key) || hasRecord))
        || (v == null && !hasRecord && delivered.has(key) && (absent.has(receiver) || autoPraise.has(key))));
      if (!byReceiver && !byConfirm) continue;
      redeemed++;
      if (byConfirm) assumed++;
      // 카드 추가분(보통·도전)은 받는 사람이 직접 인증했고, 카드를 보고 받은 것과 같다고 한 미션만. 난이도는 카드 목록으로 확인한다
      else if (redemptions[code].cardMatch === true) {
        card += R.cardBonus[cardLevel(missions[giver]?.choices?.[slot])] || 0;
        if (cardCost(missions[giver]?.choices?.[slot])) paid = true;
      }
    }
    credited[giver] = redeemed;
    redeemed = Math.min(redeemed, R.maxMissions);
    out[giver].mission = redeemed * R.perRedeemedMission;
    out[giver].card = Math.min(card, R.maxCardBonus);
    out[giver].cost = paid ? R.costBonus : 0; // 여러 번 해도 한 번만
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
    t.total = zero.has(pid) ? 0 : t.mission + t.card + t.cost + t.entries + t.comp + t.hidden + t.guess + t.partBonus + t.angel;
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
 * 응모권이 많은 순으로 count명(2등 베스트 마니또). 추첨이 아니라 순위다.
 * 동점이면 tieBreak(내 미션에 달린 후기가 남에게 받은 공감 수, missionLikes)가 많은 쪽, 그래도 같을 때만 seed로 가른다.
 * 모두가 열심히 하면 응모권이 같은 사람이 수십 명 나올 수 있어서(지목·은신만 갈린다), 운으로만 정해지지 않게 한 것이다.
 * 반환은 순위 순서. 응모권 0장과 exclude(더 큰 상을 받은 사람 = 1등)는 뺀다.
 */
export function seededTop(tickets, step, seed, exclude = new Set(), tieBreak = {}) {
  const rand = seededRandom(`${String(seed).trim()}|${step.key}`);
  return Object.entries(tickets)
    .filter(([pid, n]) => n > 0 && !exclude.has(pid))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([pid, n]) => ({ pid, n, likes: tieBreak[pid] || 0, tie: rand() }))
    .sort((a, b) => b.n - a.n || b.likes - a.likes || a.tie - b.tie)
    .slice(0, step.count)
    .map((x) => x.pid);
}

// 상 목록(큰 상부터). 한 사람은 하나만 받고, 겹치면 앞(큰 상)이 우선이다.
export const PRIZE_ORDER = [PRIZES.grand, PRIZES.bestManito, PRIZES.bestReview, ...PRIZES.tiers];
export const PAPER_TIERS = PRIZES.tiers.filter((t) => t.how === "paper"); // 종이로 뽑는 4·5등(1등도 종이지만 겹침 처리가 달라 따로 다룬다)
export const ONLINE_PRIZE = PRIZES.tiers.find((t) => t.how === "online"); // 사이트가 뽑는 6등

/**
 * 수상자 정하기. 입력이 같으면 누구 화면에서 계산해도 같은 결과가 나온다(저장하는 것은 현장 숫자와 종이로 뽑힌 이름뿐).
 *   tickets:  { pid: 장수 }           tieBreak: { pid: 내 미션 후기가 받은 공감 수 }
 *   reviews:  공감 많은 순 후기 목록(rankReviews 결과, results/public.reviewRank)
 *   draws:    results/public.draws = { seed, grand: { winners }, t4: { winners }, t5: { winners }, t6: { winners } }
 *             seed = 현장에서 정한 숫자(2등 동점을 가르고 6등 사이트 추첨에 쓴다). grand·t4·t5 = 종이로 뽑혀 운영자가 입력한 이름(입력한 순서).
 *             t6 = 사이트가 뽑아 저장한 6등(저장한 뒤에는 아무것도 바꿀 수 없다. 보안 규칙).
 *   withGrand: false면 1등을 뽑기 전 모습(발표 순서가 2등 → 3등 → 4등 → 5등 → 1등이라, 앞 장면은 1등을 뽑기 전 그대로 보여 준다)
 *
 * 큰 상이 우선이다: 1등(종이, 누구든) → 2등(1등을 뺀 응모권 최다) → 3등(앞 사람을 뺀 공감 1위 후기) → 4등 → 5등(종이로 뽑힌 이름 중 앞에서 받지 않은 사람).
 *   - 1등이 2~5등과 겹치면 그 사람은 1등만 받고, 그 자리는 다시 채운다: 2등은 다음 순위, 3등은 다음 후기, 4·5등은 종이를 더 뽑는다(open).
 *   - 2·3등 자리를 채운 사람이 이미 4·5등으로 뽑혀 있었다면 더 큰 상으로 올라가고, 비게 된 4·5등 자리를 다시 뽑는다.
 *     (응모권이 더 많은 사람이 더 작은 상에 머물지 않게. 상을 받는 사람 수는 같다)
 * 반환: { seed, grand: [pid], best: [pid], review: 후기|null, t4: [pid], t5: [pid], t6: [pid]|null(아직 안 뽑음),
 *         open: { grand, t4, t5 } 더 뽑아야 하는 수, dropped: { t4: [pid], t5: [pid] } 더 큰 상을 받아 빠진 이름, taken: Set(1~5등 수상자) }
 */
export function resolvePrizes({ tickets = {}, tieBreak = {}, reviews = [], draws = {}, withGrand = true }) {
  const seed = draws?.seed != null && String(draws.seed).trim() !== "" ? String(draws.seed).trim() : null;
  const has = (pid) => (tickets[pid] || 0) > 0;
  const entered = (key) => [...new Set((draws?.[key]?.winners || []).filter(has))]; // 응모권이 없는 이름·중복은 버린다
  const taken = new Set();
  const left = () => Object.keys(tickets).filter((pid) => has(pid) && !taken.has(pid)).length;
  const out = { seed, grand: [], best: [], review: null, t6: draws?.t6 ? [...(draws.t6.winners || [])] : null, open: {}, dropped: {}, taken };

  const grandEntered = entered(PRIZES.grand.key).slice(0, PRIZES.grand.count);
  out.grand = withGrand ? grandEntered : [];
  out.grand.forEach((pid) => taken.add(pid));
  out.open[PRIZES.grand.key] = withGrand ? Math.max(0, Math.min(PRIZES.grand.count - out.grand.length, left())) : 0;

  if (seed != null) { // 2·3등은 숫자를 넣은 뒤에 정해진다
    out.best = seededTop(tickets, PRIZES.bestManito, seed, taken, tieBreak);
    out.best.forEach((pid) => taken.add(pid));
    out.review = reviews.find((x) => !taken.has(x.receiverPid)) || null;
    if (out.review) taken.add(out.review.receiverPid);
  }
  for (const p of PAPER_TIERS) {
    const names = entered(p.key);
    out[p.key] = names.filter((pid) => !taken.has(pid)).slice(0, p.count);
    out.dropped[p.key] = names.filter((pid) => taken.has(pid));
    out[p.key].forEach((pid) => taken.add(pid));
    out.open[p.key] = Math.max(0, Math.min(p.count - out[p.key].length, left()));
  }
  return out;
}

// 6등 사이트 추첨: 현장 숫자와 응모권 표로, 1~5등을 받은 사람을 빼고 응모권 수에 비례해 뽑는다.
export function drawOnline(tickets, seed, taken = new Set(), prize = ONLINE_PRIZE) {
  return seededDraw(tickets, prize, seed, taken);
}

/**
 * 6등 사이트 추첨 검증: 저장된 숫자·응모권 표·1~5등 수상자로 다시 뽑아 저장된 결과와 같은지 본다.
 * 반환: null(아직 안 뽑음) 또는 { ok, expected, saved }
 */
export function verifyOnline({ tickets = {}, tieBreak = {}, reviews = [], draws = {} }) {
  if (!draws?.t6) return null;
  const res = resolvePrizes({ tickets, tieBreak, reviews, draws });
  const saved = res.t6 || [];
  const expected = res.seed == null ? null : drawOnline(tickets, res.seed, res.taken);
  return { ok: expected != null && JSON.stringify(expected) === JSON.stringify(saved), expected, saved };
}

/**
 * 후기별 "남이 누른 공감 수". 피드 글의 공감 수(feed.likes)에서 그 미션의 당사자 두 사람
 * (후기를 쓴 받는 사람, 그 미션을 한 마니또)이 누른 공감을 뺀다. 피드 글에는 글쓴이가 없어서 보안 규칙으로는 막을 수 없다.
 * 무효 처리됐거나 피드에서 가린 후기는 뺀다.
 * redemptions: { 코드: { receiverPid, review, voided, feedId, createdAt } }, feed: { 글ID: { likes, voided, hidden } }
 * giverOfCode: { 코드: giverPid }, ownLikes: Set("글ID_pid") 당사자가 누른 공감 문서 ID(feedLikes에서 그 문서만 골라 읽은 것)
 * 반환: [{ code, receiverPid, giverPid, review, likes, at: [초, 나노초] }]
 */
export function reviewLikes({ redemptions = {}, feed = {}, giverOfCode = {}, ownLikes = new Set() }) {
  const when = (t) => (t && typeof t.seconds === "number" ? [t.seconds, t.nanoseconds || 0] : [Infinity, 0]);
  const seen = new Set(); // 피드 글 하나는 한 번만 센다(보안 규칙도 두 인증이 글 하나를 같이 가리키지 못하게 한다)
  return Object.entries(redemptions)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .filter(([, r]) => !r.voided && r.feedId && feed[r.feedId] && !feed[r.feedId].voided && !feed[r.feedId].hidden && !seen.has(r.feedId) && seen.add(r.feedId))
    .map(([code, r]) => {
      const giverPid = giverOfCode[code] || null;
      const own = [r.receiverPid, giverPid].filter((pid) => pid && ownLikes.has(`${r.feedId}_${pid}`)).length;
      return { code, receiverPid: r.receiverPid, giverPid, review: String(r.review || "").slice(0, 300), likes: Math.max(0, (feed[r.feedId].likes || 0) - own), at: when(r.createdAt) };
    });
}

/**
 * 3등 베스트 후기상: 남에게 공감을 가장 많이 받은 후기(reviewLikes 결과에서). 운영진이 고르지 않는다.
 * 수상 대상이 아닌 사람(불참·수상 제외)의 후기는 빼고, 공감이 1개도 없으면 수상자가 없다.
 * 동점이면 먼저 쓴 후기(인증 시각), 그래도 같으면 코드 순.
 * 반환: { code, review, receiverPid, likes } 또는 null
 */
export function pickBestReview(rows, ineligible = new Set()) {
  return rankReviews(rows, ineligible)[0] || null;
}

/**
 * 공감 많은 순 후기 목록(3등 후보 순서). 1위가 더 큰 상(1·2등)을 받으면 다음 순위가 3등이 되므로 순서대로 저장해 둔다.
 * 기준은 pickBestReview와 같다. 반환: [{ code, review, receiverPid, likes }] (공감 0개는 없음, 최대 limit건)
 */
export function rankReviews(rows, ineligible = new Set(), limit = 30) {
  return rows
    .filter((x) => x.likes > 0 && !ineligible.has(x.receiverPid))
    .sort((a, b) => b.likes - a.likes || a.at[0] - b.at[0] || a.at[1] - b.at[1] || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .slice(0, limit)
    .map(({ code, review, receiverPid, likes }) => ({ code, review, receiverPid, likes }));
}

/**
 * 2등 동점을 가르는 값: 마니또마다 "내 미션에 달린 후기가 남에게 받은 공감 수"의 합(reviewLikes 결과에서).
 * 반환: { giverPid: 합 } (0인 사람은 넣지 않는다)
 */
export function missionLikes(rows) {
  const out = {};
  for (const x of rows) if (x.giverPid && x.likes > 0) out[x.giverPid] = (out[x.giverPid] || 0) + x.likes;
  return out;
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
