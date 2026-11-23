// 예약(자동 진행): 주차 열기와 단서 공개를 운영자가 정한 시각에 실행한다(사용자가 정함: "시간 설정해 두면 자동으로 되게").
// 사이트에는 서버가 없어서, 예약 시각이 지난 뒤 운영자·공동 운영자 중 누군가의 화면이 열려 있을 때(또는 여는 순간) 그 브라우저가 실행한다
// (Admin.jsx AutoRunner). 예약은 meta/schedule { items: { id: { at(ms), doneAt, result, claimedMs, tries, error } } }에 둔다(운영자만 읽고 씀).
// 여기에는 Firestore를 부르는 코드가 없다 — 무엇을 언제 실행할지만 계산한다(tests/logic.test.js).
import { PHASE, SCHEDULE } from "./constants.js";

const weekRows = SCHEDULE.filter((e) => e.kind === "week"); // [1주차, 2주차, 3주차]
const clueDates = SCHEDULE.filter((e) => e.kind === "clue").map((e) => e.date);
const closeRow = SCHEDULE.find((e) => e.kind === "close");

// 예약할 수 있는 여섯 가지. target: 주차는 열 주차, 단서는 공개 개수, 마감은 넘어갈 단계.
// date·time: 일정표의 날짜·시각(입력 칸 채우기용. 시각이 없으면 오전 9시).
// 주차를 열면 그 전 주차 미션이 마감된다(사용자가 정함, 11/23: 지난 주차 몰아서 하기 금지 — 보안 규칙도 열린 주차만 받는다).
// 미션 마감(12/8)도 예약할 수 있다(사용자가 정함: "12/8 11:00에 최종 미션 마감해서 그 이후 지목"). 집계·공개(12/9)는 예약하지 않는다.
// 주차 열기·미션 마감의 일정표 시각(time)은 12:00이고, 화면에 안내하는 마감은 11:00(due)이다(사용자가 정함, 11/23).
export const AUTO_ITEMS = [
  { id: "clues2", type: "clues", target: 2, label: "단서 1·2번 공개", date: clueDates[0] || null },
  { id: "week2", type: "week", target: 2, label: "2주차 열기 (1주차 미션 마감)", date: weekRows[1]?.date || null, time: weekRows[1]?.time },
  { id: "clues4", type: "clues", target: 4, label: "단서 3·4번 공개", date: clueDates[1] || null },
  { id: "week3", type: "week", target: 3, label: "3주차 열기 (2주차 미션 마감)", date: weekRows[2]?.date || null, time: weekRows[2]?.time },
  { id: "clues6", type: "clues", target: 6, label: "단서 5·6번 공개", date: clueDates[2] || null },
  { id: "close", type: "close", target: PHASE.GUESSING, label: "미션 마감 (3주차 마감 · 최종 지목 시작)", date: closeRow?.date || null, time: closeRow?.time },
];

export const CLAIM_MS = 2 * 60 * 1000; // 한 브라우저가 실행을 맡은 뒤 이 시간 동안 다른 브라우저는 건드리지 않는다
export const MAX_TRIES = 5; // 계속 실패하면 멈추고 운영자에게 알린다

/**
 * 예약 상태.
 * items: meta/schedule.items, config: { phase, week, cluesReleased }, now: ms
 * 반환: [{ ...AUTO_ITEM, at, state, why }] (AUTO_ITEMS 순서)
 *   state: "done"(이미 됨: 예약으로 했든 직접 눌렀든) | "none"(예약 없음) | "waiting"(시각 전) | "due"(지금 실행할 것)
 *        | "blocked"(시각은 지났지만 앞 단계가 먼저 필요) | "failed"(여러 번 실패해 멈춤) | "off"(미션 진행 단계가 아님)
 */
export function autoPlan({ items = {}, config = {}, now = Date.now() }) {
  const week = config.week || 1;
  const released = config.cluesReleased || 0;
  return AUTO_ITEMS.map((it) => {
    const s = items[it.id] || {};
    const at = typeof s.at === "number" ? s.at : null;
    const reached = it.type === "week" ? week >= it.target : it.type === "close" ? (config.phase ?? 0) >= it.target : released >= it.target;
    const base = { ...it, at, doneAt: s.doneAt || null, result: s.result || "", error: s.error || "" };
    if (reached || s.doneAt) return { ...base, state: "done", why: "" };
    if (at == null) return { ...base, state: "none", why: "" };
    if (config.phase !== PHASE.RUNNING) return { ...base, state: "off", why: "미션 진행 단계에서만 실행돼요." };
    if ((s.tries || 0) >= MAX_TRIES) return { ...base, state: "failed", why: s.error || "여러 번 실패해서 멈췄어요. 위의 버튼으로 직접 눌러 주세요." };
    if (now < at) return { ...base, state: "waiting", why: "" };
    // 시각이 지났다. 보안 규칙과 같은 조건: 주차는 한 칸씩, 단서는 한 번에 2개까지이고 2 × 주차를 넘지 못한다
    if (it.type === "week" && week !== it.target - 1) return { ...base, state: "blocked", why: `${it.target - 1}주차를 먼저 열어야 해요.` };
    if (it.type === "close" && week !== 3) return { ...base, state: "blocked", why: "3주차를 먼저 열어야 해요." };
    if (it.type === "clues" && released < it.target - 2) return { ...base, state: "blocked", why: "앞의 단서를 먼저 공개해야 해요." };
    if (it.type === "clues" && it.target > 2 * week) return { ...base, state: "blocked", why: `${it.target / 2}주차를 먼저 열어야 해요.` };
    return { ...base, state: "due", why: "" };
  });
}

// 지금 실행할 것 하나(예약 시각이 이른 것부터). 다른 브라우저가 방금 맡았으면(claimedMs) 건너뛴다.
export function nextDue({ items = {}, config = {}, now = Date.now() }) {
  return autoPlan({ items, config, now })
    .filter((r) => r.state === "due" && now - (items[r.id]?.claimedMs || 0) >= CLAIM_MS)
    .sort((a, b) => a.at - b.at)[0] || null;
}

// datetime-local 칸의 값("2026-11-20T09:00", 이 기기의 시간대) ↔ ms
export function localInputToMs(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}
export function msToLocalInput(ms) {
  if (typeof ms !== "number") return "";
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
