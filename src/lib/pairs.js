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
//  redeemed  받는 사람이 인증함
//  voided    인증했지만 운영자가 무효 처리함
export const SLOT_STATUS_LABEL = {
  none: "-",
  chosen: "카드 고름",
  sent: "인증 대기",
  reported: "받은 게 없다고 신고",
  confirmed: "받았음 확인",
  missing: "못 받음 확인",
  redeemed: "인증됨",
  voided: "인증 무효",
};

/**
 * 마니또별 한 줄.
 * assignments: { giverPid: { receiverPid } }, giverCodes: { giverPid: { codes: { 1: 코드 … } } }
 * missions: { giverPid: { choices: { 주차: { level, text } }, done: { 주차: true }, notes: { 주차: 추가 쪽지 수 } } }
 * redemptions: { 코드: { voided } }, reports: { "받는사람_주차": {…} }, verdicts: { "받는사람_주차": { verdict } }
 * guesses: { receiverPid: { guessPid } }
 * 반환: [{ giverPid, receiverPid, slots: { 1: { status, level, text, done, notes, code, reported, verdict }, … }, guessPid, correct }]
 */
export function pairRows({ assignments = {}, giverCodes = {}, missions = {}, redemptions = {}, reports = {}, verdicts = {}, guesses = {} }) {
  return Object.entries(assignments).map(([giverPid, a]) => {
    const receiverPid = a.receiverPid;
    const m = missions[giverPid] || {};
    const slots = {};
    for (const slot of MISSION_SLOTS) {
      const code = giverCodes[giverPid]?.codes?.[slot] || null;
      const choice = m.choices?.[slot] || null;
      const done = Boolean(m.done?.[slot]);
      const red = code ? redemptions[code] : null;
      const key = `${receiverPid}_${slot}`;
      const reported = Boolean(reports[key]);
      const verdict = verdicts[key]?.verdict || null;
      let status = choice ? "chosen" : "none";
      if (red) status = red.voided ? "voided" : "redeemed";
      else if (done) status = verdict === "received" ? "confirmed" : verdict === "missing" ? "missing" : reported ? "reported" : "sent";
      slots[slot] = { status, level: choice?.level || null, text: choice?.text || "", done, notes: m.notes?.[slot] || 0, code, reported, verdict };
    }
    const guessPid = guesses[receiverPid]?.guessPid || null;
    return { giverPid, receiverPid, slots, guessPid, correct: guessPid === giverPid };
  });
}

/**
 * 운영자가 확인해야 하는 주차: 마니또가 완료를 알렸는데 인증이 없는 것.
 * 반환: [{ giverPid, receiverPid, slot, level, text, reported, verdict }]
 *   onlyReported = true면 받는 사람이 신고했거나 이미 확인 결과가 있는 것만(미션 진행 중에는 아직 인증 전인 것이 많아서).
 */
export function unresolvedSlots(rows, { onlyReported = false } = {}) {
  const out = [];
  for (const r of rows) {
    for (const [slot, s] of Object.entries(r.slots)) {
      if (!["sent", "reported", "confirmed", "missing"].includes(s.status)) continue;
      if (onlyReported && !s.reported && !s.verdict) continue;
      out.push({ giverPid: r.giverPid, receiverPid: r.receiverPid, slot: Number(slot), level: s.level, text: s.text, reported: s.reported, verdict: s.verdict });
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
