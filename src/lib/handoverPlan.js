// 중도 이탈 이어 붙이기의 "무엇을 바꿀지" 계산(운영 화면 "중도 이탈 처리" 버튼, 사용자가 정함 11/26: "운영 화면 버튼으로 만들어줘").
// tools/handover/handover.py와 같은 일을 한다. 여기에는 Firestore를 부르는 코드가 없다(tests/logic.test.js):
// 화면(Admin.jsx HandoverPanel)이 자료를 읽어 넘기고, 돌려받은 ops를 한 묶음(writeBatch)으로 쓴다.
// 보안 규칙(handoverBatch)은 처음 운영자가 미션 진행 단계에 meta/handover 기록을 같은 묶음에서 바꿀 때만 짝·코드·단서를 바꾸게 한다.
//
// 원: X(빠지는 사람의 마니또) → Y(빠지는 사람) → Z(Y의 대상). X가 F주차부터 Z를 맡는다.
// ops: [{ op: "set" | "merge" | "update" | "delete", path: [컬렉션, 문서ID], data }] — data 안의 DELETE는 그 칸을 지운다.
export const DELETE = "__handover_delete__";
const SLOTS = [1, 2, 3];
const CLUE_COUNT = 6;
const PART_HINT_IDX = 6;
const NOTES_MAX = 5; // constants.js EXTRA_NOTES_MAX

const codesOf = (d) => Object.fromEntries(Object.entries(d?.codes || {}).filter(([, v]) => v).map(([k, v]) => [String(k), v]));
const doneSlots = (m) => Object.entries(m?.done || {}).filter(([, v]) => v === true).map(([k]) => Number(k)).sort((a, b) => a - b);

/**
 * d: { config, roster: { pid: { name, part, uid, dropout, leftGame } }, assignments: { 마니또: { receiverPid } },
 *      giverCodes: { pid: { codes } }, receiverCodes: { pid: { codes } }, missions: { pid: giverMissions 문서 },
 *      deliveries: { 문서ID: 값 }, redeemed: Set(인증된 코드), clues: { 문서ID: 값 }, progress: { pid: 값 },
 *      notices: { pid: 값 }, handover: meta/handover 문서, angels: { 받는사람: { angelPid } } }
 * opt: { leaver(pid), fromSlot(기본: 열린 주차), redo(그 주차의 X 완료를 되돌리기), now(ms) }
 * 반환: { error } 또는 { X, Y, Z, F, samePart, xDoneLate, needChoice, lines, warnings, ops, item }
 *   needChoice = X가 F주차를 이미 완료했는데 redo를 정하지 않음(화면이 "되돌리기 / 다음 주차부터"를 묻는다)
 */
export function planHandover(d, { leaver: Y, fromSlot, redo = false, now = Date.now() } = {}) {
  const cfg = d.config || {};
  const week = Number(cfg.week) || 1;
  const ver = cfg.assignVer ?? 0;
  const released = Number(cfg.cluesReleased) || 0;
  const roster = d.roster || {};
  const name = (pid) => roster[pid]?.name || pid;
  const part = (pid) => String(roster[pid]?.part || "").trim();
  if (Number(cfg.phase) !== 1) return { error: "미션 진행 단계에서만 할 수 있어요. 준비 단계라면 명단에서 빼고 다시 배정하면 돼요." };
  const A = Object.fromEntries(Object.entries(d.assignments || {}).map(([g, a]) => [g, a?.receiverPid]).filter(([, r]) => r));
  if (!Y || !roster[Y]) return { error: "빠지는 사람을 골라 주세요." };
  if (!A[Y]) return { error: `${name(Y)}의 짝이 없어요. 이미 빠졌을 수 있어요(아래 기록을 확인하세요).` };
  const Z = A[Y];
  const givers = Object.keys(A).filter((g) => A[g] === Y);
  if (givers.length !== 1) return { error: `${name(Y)}의 마니또를 하나로 찾지 못했어요.` };
  const X = givers[0];
  if (X === Z) return { error: "빠지는 사람의 마니또와 대상이 같은 사람이에요(두 사람만 남는 경우). 이어 붙일 수 없어요." };
  if (A[Z] === X) return { error: `이어 붙이면 ${name(X)}·${name(Z)}가 서로의 마니또(맞마니또)가 돼요. 이 방법으로는 할 수 없어요.` };
  const F = Number(fromSlot) || week;
  if (F < week || !SLOTS.includes(F)) return { error: `시작 주차는 지금 열린 주차(${week}) 이상 3 이하여야 해요(닫힌 주차의 짝은 바꾸지 않아요).` };

  const gmX = d.missions?.[X] || {};
  const gmY = d.missions?.[Y] || {};
  const gcX = codesOf(d.giverCodes?.[X]);
  const gcY = codesOf(d.giverCodes?.[Y]);
  const yLate = doneSlots(gmY).filter((s) => s >= F);
  if (yLate.length) return { error: `${name(Y)}이(가) ${yLate.join("·")}주차를 이미 ${name(Z)}에게 완료했어요. ${Math.max(...yLate) + 1}주차부터 이어 받아야 해요.` };
  const xDoneLate = doneSlots(gmX).filter((s) => s >= F);
  if (xDoneLate.length && !redo) return { needChoice: true, X, Y, Z, F, xDoneLate };
  const redeemed = d.redeemed || new Set();
  const used = SLOTS.filter((s) => s >= F).flatMap((s) => [gcX[s], gcY[s]]).filter((c) => c && redeemed.has(c));
  if (used.length) return { error: `${F}주차 이후 코드로 이미 인증한 기록이 있어요(${used.join(", ")}). 이 상태에서는 이어 붙이지 않아요.` };
  const missing = SLOTS.filter((s) => s >= F && !gcY[s]);
  if (missing.length) return { error: `${name(Y)}의 ${missing.join("·")}주차 코드가 없어요. 위의 "인증 코드 점검하기"로 먼저 확인해 주세요.` };

  const newX = { ...Object.fromEntries(SLOTS.filter((s) => s < F && gcX[s]).map((s) => [String(s), gcX[s]])), ...Object.fromEntries(SLOTS.filter((s) => s >= F).map((s) => [String(s), gcY[s]])) };
  const newY = Object.fromEntries(SLOTS.filter((s) => s < F && gcY[s]).map((s) => [String(s), gcY[s]]));
  const rcY = Object.fromEntries(SLOTS.filter((s) => s < F && gcX[s]).map((s) => [String(s), gcX[s]]));
  const rcZ = { ...codesOf(d.receiverCodes?.[Z]), ...Object.fromEntries(SLOTS.filter((s) => gcY[s]).map((s) => [String(s), gcY[s]])) };

  const clues = d.clues || {};
  const clueOps = [];
  const clueLines = [];
  for (let i = 0; i < CLUE_COUNT; i++) {
    const src = clues[`${Y}_${i}`];
    const before = clues[`${Z}_${i}`];
    const shown = i < released ? "공개됨" : "아직 비공개";
    if (src && (src.ver ?? -1) === ver && String(src.answer || "").trim()) {
      clueOps.push({ op: "set", path: ["clues", `${Z}_${i}`], data: { receiverPid: Z, idx: i, answer: src.answer, ver, n: before?.n ?? src.n ?? 0 } });
      clueLines.push(`단서 ${i + 1}번 [${shown}]: "${before?.answer ?? "(빈 칸)"}" → "${src.answer}"`);
    } else if (before) {
      clueOps.push({ op: "delete", path: ["clues", `${Z}_${i}`] });
      clueLines.push(`단서 ${i + 1}번 [${shown}]: "${before.answer ?? ""}" → (비움: ${name(X)}이(가) 아직 안 채움)`);
    }
  }
  const hintBefore = clues[`${Z}_${PART_HINT_IDX}`];
  clueOps.push({ op: "set", path: ["clues", `${Z}_${PART_HINT_IDX}`], data: { receiverPid: Z, idx: PART_HINT_IDX, answer: part(X) || null, ver } });
  clueLines.push(`파트 단서 [최종 지목 때 공개]: "${hintBefore?.answer ?? "(없음)"}" → "${part(X)}"`);

  const removed = {};
  if (redo) {
    for (const s of xDoneLate) {
      for (const id of [`${Y}_${s}`, ...Array.from({ length: NOTES_MAX }, (_, k) => `${Y}_${s}_n${k + 1}`)]) {
        if (d.deliveries?.[id]) removed[id] = d.deliveries[id];
      }
    }
  }
  const keepDone = doneSlots(gmX).filter((s) => s < F || !redo);
  const items = Array.isArray(d.handover?.items) ? d.handover.items : [];
  const saved = {
    assignmentY: { receiverPid: Z },
    giverCodesX: gcX, giverCodesY: gcY,
    receiverCodesY: codesOf(d.receiverCodes?.[Y]), receiverCodesZ: codesOf(d.receiverCodes?.[Z]),
    cluesZ: Object.fromEntries(Array.from({ length: CLUE_COUNT + 1 }, (_, i) => [`${Z}_${i}`, clues[`${Z}_${i}`]]).filter(([, v]) => v)),
    giverMissionsX: { done: gmX.done || {}, notes: gmX.notes || {} },
    progressX: d.progress?.[X] ? { doneCount: d.progress[X].doneCount ?? 0 } : {},
    rosterY: Object.fromEntries(["dropout", "leftGame"].filter((k) => roster[Y]?.[k] !== undefined).map((k) => [k, roster[Y][k]])),
    deliveriesRemoved: removed,
    notices: Object.fromEntries([X, Z].filter((p) => d.notices?.[p]).map((p) => [p, d.notices[p]])),
  };
  const item = { left: Y, giver: X, receiver: Z, fromSlot: F, at: now, saved };
  const noticeId = `handover-${now}`; // 빠진 사람의 번호는 넣지 않는다(대상이 명단 요약과 맞춰 보면 이전 마니또를 알 수 있다)
  const redid = redo && xDoneLate.length > 0;

  const ops = [
    { op: "set", path: ["assignments", X], data: { receiverPid: Z } },
    { op: "delete", path: ["assignments", Y] },
    { op: "set", path: ["giverCodes", X], data: { codes: newX } },
    { op: "set", path: ["giverCodes", Y], data: { codes: newY } },
    { op: "set", path: ["receiverCodes", Y], data: { codes: rcY } },
    { op: "set", path: ["receiverCodes", Z], data: { codes: rcZ } },
    ...clueOps,
    { op: "update", path: ["roster", Y], data: { dropout: true, leftGame: true } },
    { op: "merge", path: ["public", "roster"], data: { people: { [Y]: { out: true } } } },
  ];
  if (redid) {
    ops.push({ op: "update", path: ["giverMissions", X], data: Object.fromEntries(xDoneLate.flatMap((s) => [[`done.${s}`, DELETE], [`notes.${s}`, DELETE]])) });
    if (d.progress?.[X]) ops.push({ op: "update", path: ["progress", X], data: { doneCount: keepDone.length } });
    for (const id of Object.keys(removed)) ops.push({ op: "delete", path: ["deliveries", id] });
  }
  ops.push(
    { op: "set", path: ["notices", X], data: { id: noticeId, kind: "giver", fromSlot: F, redo: redid, at: now } },
    { op: "set", path: ["notices", Z], data: { id: noticeId, kind: "receiver", fromSlot: F, redo: false, at: now } },
    { op: "set", path: ["meta", "handover"], data: { items: [...items, item] } },
  );

  const samePart = Boolean(part(X)) && part(X) === part(Z);
  const warnings = [];
  if (samePart) warnings.push(`같은 파트(${part(X)}) 짝이 돼요. 참여자 규칙·추리 보드에는 같은 파트 제외가 없어서 그대로 진행해도 돼요.`);
  if (d.angels?.[Y]) warnings.push(`${name(Y)}에게 수호천사가 연결돼 있어요. 아래 "수호천사 연결"에서 확인해 주세요(그대로 둡니다).`);
  const angelBy = Object.entries(d.angels || {}).filter(([, a]) => a?.angelPid === Y).map(([r]) => name(r));
  if (angelBy.length) warnings.push(`${name(Y)}이(가) 수호천사로 연결된 사람이 있어요(${angelBy.join(", ")}). "수호천사 연결"에서 풀어 주세요(그대로 둡니다).`);
  const lines = [
    `원래: ${name(X)} [${part(X)}] → ${name(Y)} [${part(Y)}] → ${name(Z)} [${part(Z)}]`,
    `바뀐 뒤: ${name(X)} → ${name(Z)} (${F}주차부터. 그 전 주차는 원래 짝 그대로 셉니다)`,
    `코드: ${name(Y)}이(가) 갖고 있던 ${F}주차 이후 코드를 ${name(X)}에게 옮겨요(${name(Z)} 쪽 코드는 그대로)`,
    ...clueLines,
    `${name(Y)}: 중도 이탈 표시, 추리 보드 후보에서 빼기`,
    ...(redid ? [`${name(X)}의 ${xDoneLate.join("·")}주차 '완료'를 되돌려요(완료 알림·추가 쪽지 ${Object.keys(removed).length}건 삭제, 내용은 기록에 저장). ${name(Z)}에게 새로 해야 해요.`] : []),
    `${name(X)}·${name(Z)}에게 안내 팝업(이름·파트는 쓰지 않음)`,
  ];
  return { X, Y, Z, F, samePart, xDoneLate, redid, lines, warnings, ops, item };
}

/**
 * 가장 최근 이어 붙이기를 되돌린다. d: { handover, missions, redeemed: Set }
 * 반환: { error } 또는 { item, lines, ops }
 */
export function planUndo(d) {
  const items = Array.isArray(d.handover?.items) ? d.handover.items : [];
  if (!items.length) return { error: "되돌릴 기록이 없어요." };
  const it = items[items.length - 1];
  const { left: Y, giver: X, receiver: Z } = it;
  const F = Number(it.fromSlot);
  const sv = it.saved || {};
  const late = doneSlots(d.missions?.[X]).filter((s) => s >= F);
  if (late.length) return { error: `이어 받은 뒤 ${late.join("·")}주차를 새 대상에게 이미 완료했어요. 되돌리면 그 기록이 어긋나서 버튼으로는 되돌리지 않아요.` };
  const redeemed = d.redeemed || new Set();
  const used = SLOTS.filter((s) => s >= F).map((s) => sv.giverCodesY?.[s]).filter((c) => c && redeemed.has(c));
  if (used.length) return { error: `이어 받은 뒤 대상이 그 코드로 인증했어요(${used.join(", ")}). 되돌리지 않아요.` };
  const ops = [
    { op: "set", path: ["assignments", X], data: { receiverPid: Y } },
    { op: "set", path: ["assignments", Y], data: sv.assignmentY || { receiverPid: Z } },
    { op: "set", path: ["giverCodes", X], data: { codes: sv.giverCodesX || {} } },
    { op: "set", path: ["giverCodes", Y], data: { codes: sv.giverCodesY || {} } },
    { op: "set", path: ["receiverCodes", Y], data: { codes: sv.receiverCodesY || {} } },
    { op: "set", path: ["receiverCodes", Z], data: { codes: sv.receiverCodesZ || {} } },
  ];
  for (let i = 0; i <= CLUE_COUNT; i++) {
    const id = `${Z}_${i}`;
    ops.push(sv.cluesZ?.[id] ? { op: "set", path: ["clues", id], data: sv.cluesZ[id] } : { op: "delete", path: ["clues", id] });
  }
  const ry = sv.rosterY || {};
  ops.push(
    { op: "update", path: ["roster", Y], data: { dropout: "dropout" in ry ? ry.dropout : DELETE, leftGame: "leftGame" in ry ? ry.leftGame : DELETE } },
    { op: "update", path: ["public", "roster"], data: { [`people.${Y}.out`]: DELETE } },
  );
  // 되돌린 완료 표시·쪽지 수(되돌렸던 주차만), 완료 수, 지운 완료 알림
  const gm = sv.giverMissionsX || {};
  const back = {};
  for (const s of SLOTS.filter((x) => x >= F)) {
    if (gm.done?.[s] === true) back[`done.${s}`] = true;
    if (gm.done?.[s] === true) back[`notes.${s}`] = gm.notes?.[s] ?? DELETE;
  }
  if (Object.keys(back).length) ops.push({ op: "update", path: ["giverMissions", X], data: back });
  if (sv.progressX && sv.progressX.doneCount != null) ops.push({ op: "update", path: ["progress", X], data: { doneCount: sv.progressX.doneCount } });
  for (const [id, data] of Object.entries(sv.deliveriesRemoved || {})) ops.push({ op: "set", path: ["deliveries", id], data });
  for (const p of [X, Z]) ops.push(sv.notices?.[p] ? { op: "set", path: ["notices", p], data: sv.notices[p] } : { op: "delete", path: ["notices", p] });
  ops.push({ op: "set", path: ["meta", "handover"], data: { items: items.slice(0, -1) } });
  return { item: it, lines: [`원래 원으로: ${X} → ${Y} → ${Z}`, `짝·코드·단서·명단 표시·안내를 바꾸기 전 값으로, 지운 완료 알림 ${Object.keys(sv.deliveriesRemoved || {}).length}건 되살리기`], ops };
}
