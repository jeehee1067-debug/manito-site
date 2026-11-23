// 황금 카드 추첨(사용자가 정함, 11/23). 화면과 운영 화면이 같이 쓰는 계산만 있다(Firestore를 부르지 않는다 — tests/logic.test.js).
// - 추첨 대상: 그 주에 황금 카드를 골라 완료를 알렸고(done === true), 그 주 인증 코드의 인증이 무효가 아니며
//   대상이 "카드와 같아요"(cardMatch === true)를 확인한 마니또. 가입 안 한 사람·중도 이탈·수상 제외와 앞 주 당첨자는 뺀다.
// - 몇 명: 매주 GOLD_DRAW.perWeek명. 대상이 그보다 적으면 모두 당첨이고, 남은 자리는 다음 주로 넘긴다.
// - 뽑기: 대상 번호를 정렬한 뒤 기록해 둔 숫자(seed)로 섞어 앞에서부터. 같은 숫자면 누가 다시 계산해도 같은 결과다.
import { MISSION_CARDS } from "./constants.js";
import { seededRandom, shuffle } from "./random.js";
import { GOLD_DRAW } from "../config/prizes.js";

export const GOLD_IDS = MISSION_CARDS.hard.filter((c) => c.gold).map((c) => c.id);
export const isGoldChoice = (choice) => Boolean(choice && GOLD_IDS.includes(choice.cardId));

/**
 * missions: giverMissions 문서들 { pid: { choices, done } }, giverCodes: { pid: { codes: { "2": 코드 } } },
 * redemptions: { 코드: { voided, cardMatch } }, roster: [{ pid, uid, dropout, disqualified }], exclude: 뺄 pid(앞 주 당첨자)
 */
export function goldCandidates({ week, missions = {}, giverCodes = {}, redemptions = {}, roster = [], exclude = [] }) {
  const w = String(week);
  return roster
    .filter((r) => r.uid && !r.dropout && !r.disqualified && !exclude.includes(r.pid))
    .filter((r) => {
      const m = missions[r.pid] || {};
      if (!isGoldChoice(m.choices?.[w]) || m.done?.[w] !== true) return false;
      const red = redemptions[giverCodes[r.pid]?.codes?.[w]];
      return Boolean(red && !red.voided && red.cardMatch === true);
    })
    .map((r) => r.pid)
    .sort();
}

// 이번 주에 뽑을 수: perWeek + 앞 주에 남은 자리(앞 주 추첨이 있었을 때만)
export function goldCount(week, draws = {}) {
  const prev = GOLD_DRAW.weeks.filter((x) => x < week);
  const left = prev.reduce((sum, x) => {
    const d = draws[String(x)];
    return d ? sum + Math.max(0, goldCount(x, draws) - (d.winners || []).length) : sum;
  }, 0);
  return GOLD_DRAW.perWeek + left;
}

export function drawGold(candidates = [], count = GOLD_DRAW.perWeek, seed = "") {
  return shuffle([...candidates].sort(), seededRandom(`gold:${seed}`)).slice(0, Math.max(0, count));
}

// 그 주가 끝났는지(추첨할 수 있는지): 2주차는 3주차가 열린 뒤, 3주차는 미션이 마감된(최종 지목 단계) 뒤
export function goldWeekClosed(week, config = {}) {
  if (week < 3) return (config.week || 1) > week || (config.phase || 0) >= 2;
  return (config.phase || 0) >= 2;
}

// 사이트에 들어오면 띄울 추첨 결과 팝업(사용자가 정함, 11/23: "당첨 안 된 사람에게도 아쉽다는 메시지, 된 사람은 축하, 들어오자마자 팝업으로").
// missions: 내 giverMissions 문서, draws: public/goldDraw의 weeks, wins: goldWins/{나}의 weeks, seen: 이 기기에서 이미 본 주차.
// 황금 카드를 골라 완료를 알린 주차 중 추첨이 끝났고 아직 안 본 것. 반환 [{ week, won }] (주차 순)
export function goldPopups({ missions = {}, draws = {}, wins = {}, seen = [] }) {
  return GOLD_DRAW.weeks
    .filter((w) => isGoldChoice(missions.choices?.[String(w)]) && missions.done?.[String(w)] === true)
    .filter((w) => draws[String(w)] && !seen.includes(w))
    .map((w) => ({ week: w, won: wins[String(w)] === true }));
}
