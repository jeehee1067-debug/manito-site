// 수호천사 연결: 운영자가 고르지 않는다. 정해진 기준으로 자동으로 짝짓는다(Admin.jsx linkAngelsNow가 이 계산대로 쓴다).
//
//  도움이 필요한 사람(needyReceivers): 2주차가 열린 뒤(열린 주차 ≥ 2)에, 내 마니또의 완료 알림이 아직 한 건도 없고,
//    수호천사가 없고, 참여 중(가입했고 중도 이탈이 아님)인 받는 사람. 명단 순서(pid)대로.
//    1주차 중에는 "아직 안 한 것"과 "안 하는 것"을 가를 수 없어서 연결하지 않는다.
//  지원자 순서(angelQueue): 지원 중(active)이고 참여 중이며 수상 제외가 아닌 사람을 지원 시각(at, 서버 시각)이 이른 순서로.
//    지원을 취소했다가 다시 지원하면 그때 시각으로 바뀌어 맨 뒤로 간다.
//  연결할 수 있는 지원자(matchAngels): 순서가 가장 빠른 사람 중에서
//    - 아직 다른 사람과 연결되지 않았고(한 사람에게 한 명씩)
//    - 받는 사람 본인도, 그 사람의 마니또도 아니고
//    - 닫힌 주차(열린 주차 − 1)까지 자기 마니또 미션을 모두 완료 알린 사람
//      (자기 대상은 챙기지 않으면서 수호천사 응모권만 받는 것 방지. 나중에 완료하면 그때부터 연결될 수 있다)
//    - 운영자가 그 받는 사람에게서 "다음 순번으로" 넘긴 사람(skips)이 아닌 사람
import { MISSION_SLOTS } from "./constants.js";

// Firestore Timestamp({ seconds, nanoseconds }) 비교용. 값이 없으면 맨 뒤로.
const stamp = (t) => (t && typeof t.seconds === "number" ? [t.seconds, t.nanoseconds || 0] : [Infinity, 0]);
const byAtThenPid = (a, b) => {
  const [as, an] = stamp(a.at);
  const [bs, bn] = stamp(b.at);
  return as - bs || an - bn || (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0);
};
const takingPart = (p) => Boolean(p) && p.joined !== false && !p.dropout;

/**
 * 지원자 순서.
 * volunteers: { pid: { active, at } }, people: [{ pid, joined, dropout, disqualified }]
 * 반환: [{ pid, at, order }] (order는 1부터)
 */
export function angelQueue(volunteers = {}, people = []) {
  const byPid = Object.fromEntries(people.map((p) => [p.pid, p]));
  return Object.entries(volunteers)
    .filter(([pid, v]) => v?.active && takingPart(byPid[pid]) && !byPid[pid].disqualified)
    .map(([pid, v]) => ({ pid, at: v.at || null }))
    .sort(byAtThenPid)
    .map((v, i) => ({ ...v, order: i + 1 }));
}

/**
 * 도움이 필요한 사람(받는 사람 pid 목록, 명단 순서).
 * rows: pairs.js pairRows 결과([{ giverPid, receiverPid, slots: { 주차: { done } } }]), angels: { 받는사람: { angelPid } }, week: 열린 주차
 */
export function needyReceivers({ rows = [], angels = {}, week = 1, people = [] }) {
  if (week < 2) return [];
  const byPid = Object.fromEntries(people.map((p) => [p.pid, p]));
  // 받은 적이 있는 사람: 주차마다 그 주차의 대상 기준(중도 이탈로 마니또가 바뀐 사람은 앞 마니또에게 받은 것도 센다)
  const got = new Set(rows.flatMap((r) => MISSION_SLOTS.filter((s) => r.slots?.[s]?.done).map((s) => r.slots[s].receiverPid || r.receiverPid)));
  return rows
    .filter((r) => !r.left && !got.has(r.receiverPid) && !angels[r.receiverPid] && takingPart(byPid[r.receiverPid]))
    .map((r) => r.receiverPid)
    .sort();
}

// 닫힌 주차까지 자기 마니또 미션을 모두 완료 알렸는지
export function ownMissionsDone(rows, pid, week) {
  const mine = rows.find((r) => r.giverPid === pid);
  if (!mine) return false;
  return MISSION_SLOTS.filter((s) => s < week).every((s) => mine.slots?.[s]?.done);
}

/**
 * 지금 연결할 짝. 도움이 필요한 사람마다(명단 순서) 연결할 수 있는 지원자 중 가장 먼저 지원한 사람.
 * skips: { 받는사람: [넘긴 지원자 pid] }
 * 반환: [{ receiverPid, angelPid, order }]
 */
export function matchAngels({ rows = [], volunteers = {}, angels = {}, week = 1, people = [], skips = {} }) {
  const giverOf = Object.fromEntries(rows.filter((r) => !r.left).map((r) => [r.receiverPid, r.giverPid]));
  const taken = new Set(Object.values(angels).map((a) => a.angelPid));
  const free = angelQueue(volunteers, people).filter((v) => !taken.has(v.pid) && ownMissionsDone(rows, v.pid, week));
  const out = [];
  for (const r of needyReceivers({ rows, angels, week, people })) {
    const i = free.findIndex((v) => v.pid !== r && v.pid !== giverOf[r] && !(skips[r] || []).includes(v.pid));
    if (i < 0) continue;
    const [v] = free.splice(i, 1);
    out.push({ receiverPid: r, angelPid: v.pid, order: v.order });
  }
  return out;
}

/**
 * 운영 화면에 보일 지원자 상태(순서대로).
 * 반환: [{ pid, at, order, state: "linked" | "waiting" | "own", receiverPid? }]
 *   own = 닫힌 주차의 자기 미션을 아직 다 하지 않아 지금은 건너뛰는 사람
 */
export function angelQueueStatus({ rows = [], volunteers = {}, angels = {}, week = 1, people = [] }) {
  const linkedTo = Object.fromEntries(Object.entries(angels).map(([r, a]) => [a.angelPid, r]));
  return angelQueue(volunteers, people).map((v) => (linkedTo[v.pid]
    ? { ...v, state: "linked", receiverPid: linkedTo[v.pid] }
    : { ...v, state: ownMissionsDone(rows, v.pid, week) ? "waiting" : "own" }));
}
