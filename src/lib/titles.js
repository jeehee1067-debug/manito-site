// 송년회 칭호(사용자가 정함, 11/23: "칭호도 이대로 가자"). 응모권·상품과는 상관없고, 집계할 때 기록에서 자동으로 정한다.
// Firestore를 부르지 않는 계산만 있다(tests/logic.test.js). 운영 화면 집계(Admin.jsx calcAll)가 results/public.titles로 저장하고,
// 발표 화면(reveal.js buildSlides)이 칭호마다 한 장면씩 보인다.
//
// 공통: 가입했고 중도 이탈·수상 제외가 아닌 마니또만. 1등이 여럿이면(동점) 모두 받는다.
//  🏆 도전왕   대상이 인증하고 "카드와 같아요"를 확인한(무효 아님) 도전 카드 미션(황금 카드 포함)이 가장 많은 마니또. 1건 이상.
//              난이도는 카드 목록과 맞는 카드만 센다(scoring.js cardLevel — 응모권의 카드 추가분과 같은 기준).
//  ✨ 황금손   황금 카드 미션을 위와 같은 조건으로 인증받은 마니또 모두(커피 쿠폰 당첨과는 별개).
//  💌 쪽지 장인 내 대상에게 보낸 쪽지(완료 알림·칭찬 카드·쪽지 더 보내기, 빈 쪽지와 운영진이 가린 것 제외)가 가장 많은 마니또. 1통 이상.
//  🫥 투명 마니또 끝까지 들키지 않고 은신 응모권을 받았고(내 미션 3건 + 단서 6칸까지 채움 — 응모권 계산의 은신 조건),
//              대상이 주차별 추측(midGuesses)에서도 한 번도 나를 고르지 않은 마니또. 대상이 가입하지 않았거나 중도 이탈이면 뺀다(추측할 사람이 없어서).
import { cardLevel } from "./scoring.js";
import { isGoldChoice } from "./gold.js";
import { slotPairs } from "./handover.js";

// measure·unit: 1등의 값을 보일 때 "도전 미션 3건"처럼. 값이 없는 칭호(황금손·투명 마니또)는 비워 둔다
export const TITLES = [
  { key: "challenge", emoji: "🏆", label: "도전왕", desc: "도전 카드 미션(황금 카드 포함)을 가장 많이 해낸 마니또", measure: "인증받은 도전 미션", unit: "건" },
  { key: "gold", emoji: "✨", label: "황금손", desc: "황금 카드 미션을 해내고 대상의 인증까지 받은 마니또", measure: "", unit: "" },
  { key: "notes", emoji: "💌", label: "쪽지 장인", desc: "내 대상에게 쪽지를 가장 많이 보낸 마니또", measure: "보낸 쪽지", unit: "통" },
  { key: "invisible", emoji: "🫥", label: "투명 마니또", desc: "주차별 추측에서도 최종 지목에서도 한 번도 지목되지 않은 마니또", measure: "", unit: "" },
];
// "도전 미션 3건" (값을 보이지 않는 칭호는 "")
export const titleValue = (t) => (t?.measure && t.value > 0 ? `${t.measure} ${t.value}${t.unit}` : "");

const NOTE_KINDS = new Set(["mission", "praise", "note"]);

// 가장 큰 값을 가진 사람들(값이 min 이상일 때만). 반환 { winners: [pid 정렬], value }
function topOf(counts, min = 1) {
  const best = Math.max(0, ...Object.values(counts));
  if (best < min) return { winners: [], value: 0 };
  return { winners: Object.keys(counts).filter((pid) => counts[pid] === best).sort(), value: best };
}

/**
 * people: [{ pid, joined, dropout, disqualified }]
 * assignments: { giverPid: receiverPid }
 * giverCodes: { giverPid: { "1": 코드, ... } }
 * redemptions: { 코드: { voided, cardMatch } }
 * missions: { giverPid: { choices: { "1": { cardId, level, text } } } }
 * deliveries: [{ receiverPid, slot, kind, message, hidden }]
 * midGuesses: { receiverPid: { "1": pid, ... } }
 * tickets: computeTickets 결과 { pid: { hidden } }
 * handover: 중도 이탈로 짝을 이어 붙인 기록(handover.js). 쪽지는 그 주차의 마니또에게 세고, 이어 받은 마니또는 투명 마니또에서 뺀다
 *   (이어 받은 짝은 같은 파트일 수 있는데, 추리 보드가 최종 지목 전까지 내 파트를 후보에서 빼서 대상이 그 사람을 주차별 추측에 고를 수 없었다).
 * 반환: [{ key, emoji, label, desc, measure, unit, winners: [pid], value }] — TITLES 순서, 받은 사람이 없는 칭호도 winners: []로 넣는다
 */
export function computeTitles({ people = [], assignments = {}, giverCodes = {}, redemptions = {}, missions = {}, deliveries = [], midGuesses = {}, tickets = {}, handover = null }) {
  const byPid = Object.fromEntries(people.map((p) => [p.pid, p]));
  const present = (pid) => byPid[pid] && byPid[pid].joined !== false && !byPid[pid].dropout;
  const eligible = (pid) => present(pid) && !byPid[pid].disqualified;
  const givers = Object.keys(assignments).filter(eligible);
  const at = slotPairs(assignments, handover);

  // 대상이 인증하고 카드와 같다고 확인한 미션의 카드 목록
  const confirmedChoices = (giver) => Object.entries(giverCodes[giver] || {})
    .filter(([, code]) => redemptions[code] && !redemptions[code].voided && redemptions[code].cardMatch === true)
    .map(([slot]) => missions[giver]?.choices?.[slot])
    .filter(Boolean);

  const challenge = {};
  const gold = {};
  for (const g of givers) {
    const list = confirmedChoices(g);
    challenge[g] = list.filter((c) => cardLevel(c) === "hard").length;
    const goldCount = list.filter((c) => cardLevel(c) === "hard" && isGoldChoice(c)).length;
    if (goldCount > 0) gold[g] = goldCount;
  }

  const notes = Object.fromEntries(givers.map((g) => [g, 0]));
  for (const d of deliveries) {
    const g = at.giverAt(d.receiverPid, d.slot);
    if (!(g in notes) || !NOTE_KINDS.has(d.kind) || d.hidden || !String(d.message || "").trim()) continue;
    notes[g]++;
  }

  const invisible = givers.filter((g) => {
    const receiver = assignments[g];
    if (!present(receiver) || !((tickets[g]?.hidden || 0) > 0) || at.takenOver(g)) return false;
    return !Object.values(midGuesses[receiver] || {}).includes(g);
  }).sort();

  const found = {
    challenge: topOf(challenge),
    gold: { winners: Object.keys(gold).sort(), value: 0 },
    notes: topOf(notes),
    invisible: { winners: invisible, value: 0 },
  };
  return TITLES.map((t) => ({ ...t, ...found[t.key] }));
}

// 발표·결과 화면에 보일 칭호: 받은 사람이 있는 것만(예전 집계에는 titles가 없다)
export const shownTitles = (r) => (r?.titles || []).filter((t) => (t.winners || []).length > 0);

// 황금 카드 커피 쿠폰 당첨자(집계 때 meta/goldDraw에서 옮겨 둔 것): [{ week, winners }] 추첨한 주차만, 주차 순
export const goldWinnerWeeks = (r) => Object.entries(r?.goldWinners || {})
  .map(([w, winners]) => ({ week: Number(w), winners: winners || [] }))
  .filter((x) => x.winners.length > 0)
  .sort((a, b) => a.week - b.week);
