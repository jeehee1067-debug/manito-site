// 운영 화면 "짝 현황" 표와 "받은 게 없어요 확인" 표에 쓰는 계산.
// 운영자는 참여하지 않는 계정이라 짝·진행·지목을 언제든 읽는다(보안 규칙).
import { MISSION_SLOTS } from "./constants.js";

// 주차 상태
//  none      아직 카드를 안 고름
//  chosen    카드를 고름(완료 알리기 전)
//  sent      완료를 알림, 받는 사람의 인증을 기다리는 중
//  reported  완료를 알렸는데 받는 사람이 "받은 게 없어요"로 신고함(운영자 확인 전)
//  confirmed 운영자가 "받았음"으로 확인(마니또의 미션 인정)
//  missing   운영자가 "못 받음"으로 확인(받는 사람에게 보상)
//  auto      3주차 칭찬 카드가 사이트로 전달됨(받는 사람의 인증이 없어도 마니또의 미션으로 인정. scoring.js와 같은 기준)
//  redeemed  받는 사람이 인증함
//  voided    인증했지만 운영자가 무효 처리함(운영자가 "받았음"으로 확인하면 마니또의 미션은 인정된다)
export const SLOT_STATUS_LABEL = {
  none: "-",
  chosen: "카드 고름",
  sent: "인증 대기",
  reported: "받은 게 없다고 신고",
  confirmed: "받았음 확인",
  missing: "못 받음 확인",
  auto: "칭찬 카드 전달(인정)",
  redeemed: "인증됨",
  voided: "인증 무효",
};

/**
 * 마니또별 한 줄.
 * assignments: { giverPid: { receiverPid } }, giverCodes: { giverPid: { codes: { 1: 코드 … } } }
 * missions: { giverPid: { choices: { 주차: { level, text } }, done: { 주차: true }, notes: { 주차: 추가 쪽지 수 } } }
 * redemptions: { 코드: { voided } }, reports: { "받는사람_주차": { active } }, verdicts: { "받는사람_주차": { verdict } }
 * delivered: Set("받는사람_주차") 완료 알림(deliveries)이 있는 주차. 완료 표시(done)와 같이 "완료를 알린 주차"로 본다.
 * autoPraise: Set("받는사람_주차") 사이트가 전달한 칭찬 카드(운영자가 가리지 않은 것). 인증이 없어도 인정된다.
 * guesses: { receiverPid: { guessPid } }
 * 반환: [{ giverPid, receiverPid, slots: { 1: { status, level, text, done, notes, code, reported, verdict }, … }, guessPid, correct }]
 */
export function pairRows({ assignments = {}, giverCodes = {}, missions = {}, redemptions = {}, reports = {}, verdicts = {}, guesses = {}, delivered = new Set(), autoPraise = new Set() }) {
  return Object.entries(assignments).map(([giverPid, a]) => {
    const receiverPid = a.receiverPid;
    const m = missions[giverPid] || {};
    const slots = {};
    for (const slot of MISSION_SLOTS) {
      const code = giverCodes[giverPid]?.codes?.[slot] || null;
      const choice = m.choices?.[slot] || null;
      const key = `${receiverPid}_${slot}`;
      const done = Boolean(m.done?.[slot]) || delivered.has(key);
      const red = code ? redemptions[code] : null;
      const reported = Boolean(reports[key]) && reports[key].active !== false; // 취소한 신고는 active = false (예전 신고는 active 없음)
      const verdict = verdicts[key]?.verdict || null;
      let status = choice ? "chosen" : "none";
      if (red && !red.voided) status = "redeemed";
      else if (red) status = verdict === "received" ? "confirmed" : "voided"; // 무효 처리된 인증: "받았음"으로 확인하면 마니또의 미션은 인정
      else if (done) status = verdict === "received" ? "confirmed" : verdict === "missing" ? "missing" : reported ? "reported" : autoPraise.has(key) ? "auto" : "sent";
      slots[slot] = { status, level: choice?.level || null, text: choice?.text || "", done, notes: m.notes?.[slot] || 0, code, reported, verdict, voided: Boolean(red?.voided) };
    }
    const guessPid = guesses[receiverPid]?.guessPid || null;
    return { giverPid, receiverPid, slots, guessPid, correct: guessPid === giverPid };
  });
}

/**
 * 운영자가 확인해야 하는 주차: 마니또가 완료를 알렸는데 유효한 인증이 없는 것.
 * 반환: [{ giverPid, receiverPid, slot, level, text, reported, verdict, voided }]
 *   onlyReported = true면 받는 사람이 신고했거나 이미 확인 결과가 있는 것만(미션 진행 중에는 아직 인증 전인 것이 많아서).
 *   voided = 인증이 무효 처리된 주차("받았음"으로 확인하면 마니또의 미션만 인정된다. 받는 사람 쪽은 달라지지 않는다).
 *   사이트가 전달한 칭찬 카드(status "auto")는 자동으로 인정되므로 넣지 않는다.
 */
export function unresolvedSlots(rows, { onlyReported = false } = {}) {
  const out = [];
  for (const r of rows) {
    for (const [slot, s] of Object.entries(r.slots)) {
      const open = ["sent", "reported", "confirmed", "missing"].includes(s.status) || s.voided;
      if (!open) continue;
      if (onlyReported && !s.reported && !s.verdict) continue;
      out.push({ giverPid: r.giverPid, receiverPid: r.receiverPid, slot: Number(slot), level: s.level, text: s.text, reported: s.reported, verdict: s.verdict, voided: s.voided });
    }
  }
  return out;
}

// 받는 사람 기준 코드 { receiverPid: { 1: 코드, 2: 코드, 3: 코드 } } (giverCodes를 뒤집은 것).
// 보안 규칙이 "이 피드 글이 그 사람의 실제 인증에 딸린 것인지" 확인할 때 receiverCodes 문서를 읽는다.
export function receiverCodesOf(assignments, giverCodes) {
  const out = {};
  for (const [giverPid, a] of Object.entries(assignments || {})) {
    const codes = giverCodes?.[giverPid]?.codes;
    if (a?.receiverPid && codes) out[a.receiverPid] = { ...codes };
  }
  return out;
}

export const sameCodes = (a, b) =>
  MISSION_SLOTS.every((slot) => (a?.[slot] || null) === (b?.[slot] || null));

// 마니또가 대상에게 낸 단서 6칸: [답 또는 null] (지금 배정 회차의 것만, 예전 화면이 빈 답 대신 쓰던 "(답변 없음)"은 빈 칸으로 본다)
// clues: { "받는사람_칸": { idx, answer, ver } }
export function clueAnswers(clues, receiverPid, ver = 0) {
  return Array.from({ length: 6 }, (_, i) => {
    const c = clues?.[`${receiverPid}_${i}`];
    return c && (c.ver ?? -1) === ver && c.answer && c.answer !== "(답변 없음)" ? c.answer : null;
  });
}

// 단서 6칸을 모두 낸 마니또 Set(giverPid). 은신 응모권 조건(scoring.js computeTickets의 cluesDone)에 쓴다.
export function cluesDoneSet(assignments, clues, ver = 0) {
  return new Set(Object.entries(assignments || {})
    .filter(([, a]) => clueAnswers(clues, a.receiverPid, ver).every(Boolean))
    .map(([giverPid]) => giverPid));
}
