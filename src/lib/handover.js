// 중도 이탈로 짝을 이어 붙인 기록(사용자가 정함, 11/26: 병가로 빠지는 참여자가 생겨 "그 사람만 쏙 빠지게").
// meta/handover = { items: [{ left, giver, receiver, fromSlot, at, saved }] } — 운영자만 읽고 쓴다(tools/handover/handover.py가 쓴다).
//   left(빠지는 사람)의 마니또였던 giver가 fromSlot 주차부터 left의 대상이던 receiver를 맡는다.
//   fromSlot 전의 주차는 원래 짝(giver → left → receiver) 그대로다(그 주차의 미션·인증·보상은 원래 짝 기준).
//   saved: 바꾸기 전 값(left의 짝·코드, receiver가 보던 단서 등). 송년회에 left가 오면 응모권 계산에 쓰고, 되돌릴 때 쓴다.
// 짝(assignments)은 지금 짝만 담고 있어서, 지난 주차의 "누가 누구에게"는 이 기록과 함께 계산한다(scoring·pairs·titles·backup).
// 여기에는 Firestore를 부르는 코드가 없다(tests/logic.test.js).
import { MISSION_SLOTS } from "./constants.js";

const recv = (a) => (typeof a === "string" ? a : a?.receiverPid) || null;

// 문서(또는 items 배열) → 쓸 수 있는 기록만, 적힌 순서(= 일어난 순서) 그대로
export function handoverItems(doc) {
  const list = Array.isArray(doc) ? doc : doc?.items || [];
  return list
    .filter((x) => x && x.left && x.giver && x.receiver && Number(x.fromSlot) >= 1)
    .map((x) => ({ ...x, fromSlot: Number(x.fromSlot) }));
}

/**
 * 주차별 짝. assignments: { 마니또: 받는사람 } 또는 { 마니또: { receiverPid } }(지금 짝), handover: meta/handover 문서·items 배열·null
 * 반환 {
 *   pairsAt(slot) → { 마니또: 받는사람 } 그 주차의 짝
 *   receiverAt(마니또, slot) → 그 주차에 그 마니또가 챙긴 사람(없으면 null — 빠진 사람의 이어 받은 뒤 주차)
 *   giverAt(받는사람, slot) → 그 주차에 그 사람을 챙긴 마니또(없으면 null)
 *   givers → 한 주차라도 마니또였던 사람(빠진 사람 포함)
 *   left → 빠진 사람 Set, items → 기록, takenOver(마니또) → 그 마니또가 이어 받은 기록(없으면 null)
 * }
 */
export function slotPairs(assignments = {}, handover = null) {
  const items = handoverItems(handover);
  const now = Object.fromEntries(Object.entries(assignments || {}).map(([g, a]) => [g, recv(a)]).filter(([, r]) => r));
  const bySlot = {};
  const inv = {};
  for (const slot of MISSION_SLOTS) {
    const s = Number(slot);
    const m = { ...now };
    // 가장 최근 기록부터 거꾸로 되돌린다: 여러 번 이어 붙여도(빠진 사람이 둘이어도) 주차마다 맞는 짝이 된다
    for (const it of [...items].reverse()) {
      if (s < it.fromSlot) {
        m[it.giver] = it.left;
        m[it.left] = it.receiver;
      } else {
        delete m[it.left];
      }
    }
    bySlot[s] = m;
    inv[s] = Object.fromEntries(Object.entries(m).map(([g, r]) => [r, g]));
  }
  const givers = [...new Set(Object.values(bySlot).flatMap((m) => Object.keys(m)))];
  const left = new Set(items.map((x) => x.left));
  return {
    items,
    left,
    givers,
    pairsAt: (slot) => bySlot[Number(slot)] || { ...now },
    receiverAt: (giver, slot) => (bySlot[Number(slot)] || now)[giver] || null,
    giverAt: (receiver, slot) => (inv[Number(slot)] || {})[receiver] || null,
    takenOver: (giver) => [...items].reverse().find((x) => x.giver === giver) || null,
  };
}
