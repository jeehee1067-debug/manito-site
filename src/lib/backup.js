// 운영 화면 "백업 내려받기"에 쓰는 계산(사용자가 정함: "사람들이 보낸 메시지·기록을 전부 백업해서, 송년회 때 돌아보는 자료로 정리하고 싶다").
// 무료 요금제에는 자동 백업이 없어서, 운영자가 누를 때 전체 자료를 파일로 내려받는다.
// 여기에는 Firestore를 부르는 코드가 없다(읽은 값을 받아 파일 내용만 만든다) — tests/logic.test.js가 확인한다.

// 통째로 읽는 컬렉션(운영자가 목록을 읽을 수 있는 것. firestore.rules의 읽기 권한과 맞아야 한다).
// invites·mailIndex 목록은 처음 운영자만 읽는다(공동 운영자가 받으면 그 둘은 "읽지 못함"으로 남는다).
export const BACKUP_COLLECTIONS = [
  "roster", "users", "invites", "mailIndex", "avatars", "profiles", "prefs",
  "assignments", "giverCodes", "codes", "receiverCodes", "giverMissions", "progress",
  "deliveries", "noteFlags", "redemptions", "feed", "feedLikes", "hiddenFeed",
  "reports", "verdicts", "clues", "nudges", "guesses", "midGuesses", "toManito",
  "angelVolunteers", "angels", "angelGifts", "modNotes", "public", "results", "meta",
];
// 문서 하나만 읽는 것(컬렉션 목록 읽기는 규칙이 허용하지 않는다)
export const BACKUP_DOCS = [["config", "app"]];

// Firestore 값 → JSON에 넣을 수 있는 값. 시각(Timestamp)은 ISO 글자로 바꾼다.
export function toPlain(v) {
  if (v === null || v === undefined) return v ?? null;
  if (typeof v?.toDate === "function") return v.toDate().toISOString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(toPlain);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toPlain(x)]));
  return v;
}

/**
 * 전체 백업 파일 내용.
 * collections: { 이름: { 문서ID: 값 } | null(읽지 못함) }, docs: { "config/app": 값 | null }
 */
export function buildBackup({ collections = {}, docs = {}, at = new Date(), failed = [] }) {
  const counts = Object.fromEntries(Object.entries(collections).map(([n, c]) => [n, c ? Object.keys(c).length : null]));
  return {
    app: "S1FA 마니또",
    kind: "full-backup",
    exportedAt: toPlain(at),
    counts,
    failed, // 읽지 못한 컬렉션 이름(권한 등)
    docs: toPlain(docs),
    collections: toPlain(collections),
  };
}

// 백업에 들어간 문서 수(읽기 수 안내용)
export const backupDocCount = (collections = {}, docs = {}) =>
  Object.values(collections).reduce((n, c) => n + (c ? Object.keys(c).length : 0), 0) + Object.values(docs).filter(Boolean).length;

const KIND_LABEL = {
  mission: "미션 완료 쪽지", praise: "칭찬 카드", note: "추가 쪽지",
  review: "인증 후기", thanks: "감사 답장", toManito: "마니또에게 한마디",
  angel: "수호천사 미션", angelReview: "수호천사 미션 후기",
};

/**
 * 메시지·후기 모음: 사람들이 서로에게 쓴 글을 한 줄씩(송년회 돌아보기 자료용).
 * 누가 누구에게 썼는지가 들어가므로 정체 공개 전에는 운영진만 본다.
 * 반환: [{ kind, kindLabel, slot, from, to, fromPid, toPid, text, at, card, likes, note }] 시각 순
 *   from/to는 이름(nameOf가 없으면 pid). note: 가림·무효·카드와 다름 같은 표시.
 */
export function messageRows({
  nameOf = (pid) => pid, assignments = {}, giverCodes = {}, deliveries = {}, redemptions = {}, feed = {}, hiddenFeed = {},
  toManito = {}, angels = {}, angelGifts = {},
}) {
  const giverOf = {}; // 받는 사람 → 그 사람의 마니또
  for (const [g, a] of Object.entries(assignments)) if (a?.receiverPid) giverOf[a.receiverPid] = g;
  const giverOfCode = {};
  for (const [g, c] of Object.entries(giverCodes)) for (const code of Object.values(c?.codes || {})) giverOfCode[code] = g;
  const rows = [];
  const push = (kind, slot, fromPid, toPid, text, at, extra = {}) => {
    if (!text || !String(text).trim()) return;
    rows.push({
      kind, kindLabel: KIND_LABEL[kind], slot: slot ?? null,
      from: fromPid ? nameOf(fromPid) : "", to: toPid ? nameOf(toPid) : "", fromPid: fromPid || null, toPid: toPid || null,
      text: String(text).trim(), at: toPlain(at) || null, card: extra.card || "", likes: extra.likes ?? null, note: extra.note || "",
    });
  };
  // 마니또 → 대상: 완료 알림 쪽지, 칭찬 카드, 추가 쪽지
  for (const d of Object.values(deliveries)) {
    const kind = d.kind === "praise" ? "praise" : d.kind === "note" ? "note" : "mission";
    push(kind, d.slot, giverOf[d.receiverPid], d.receiverPid, d.message, d.createdAt, {
      card: d.card?.text || "", note: d.hidden ? "운영진이 가린 쪽지" : "",
    });
  }
  // 대상 → 마니또: 인증 후기(익명 피드에 올라간 글), 감사 답장
  for (const [code, r] of Object.entries(redemptions)) {
    const f = r.feedId ? feed[r.feedId] : null;
    const notes = [];
    if (r.voided) notes.push("무효 처리된 인증");
    if (f?.hidden) notes.push("피드에서 가린 글");
    if (r.cardMatch === false) notes.push("카드와 달랐다고 표시");
    if (r.edits) notes.push(`글쓴이가 후기·답장을 ${r.edits}번 고침(지금 글)`);
    const review = r.review || (r.feedId && hiddenFeed[r.feedId]?.review) || f?.review;
    push("review", r.slot, r.receiverPid, giverOfCode[code], review, r.createdAt, { likes: f?.likes ?? 0, note: notes.join(", ") });
    if (f?.thanks) push("thanks", r.slot, r.receiverPid, giverOfCode[code], f.thanks, r.createdAt, { note: "후기에 붙인 답장(시각은 후기 시각)" });
  }
  // 대상 → 마니또: 마니또에게 한마디
  for (const m of Object.values(toManito)) push("toManito", m.slot, m.receiverPid, giverOf[m.receiverPid], m.message, m.createdAt);
  // 수호천사 → 받는 사람: 한 일과 쪽지, 받는 사람의 후기
  for (const g of Object.values(angelGifts)) {
    const angel = angels[g.receiverPid]?.angelPid || null;
    push("angel", null, angel, g.receiverPid, [g.text, g.message].filter(Boolean).join(" / "), g.createdAt);
    if (g.confirmed) push("angelReview", null, g.receiverPid, angel, g.review, g.confirmedAt || g.createdAt);
  }
  return rows.sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")) || a.kind.localeCompare(b.kind));
}

export const MESSAGE_COLUMNS = [
  ["kindLabel", "종류"], ["slot", "주차"], ["from", "쓴 사람"], ["to", "받은 사람"], ["text", "내용"],
  ["card", "고른 카드"], ["likes", "공감 수"], ["at", "시각"], ["note", "비고"],
];

// 엑셀에서 열리는 CSV. 맨 앞에 BOM을 넣어 한글이 깨지지 않게 하고, 사람들이 쓴 글이 수식으로 실행되지 않게
// =, +, -, @ 로 시작하는 칸은 앞에 작은따옴표를 붙인다.
export function toCsv(rows, columns = MESSAGE_COLUMNS) {
  const cell = (v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [columns.map(([, label]) => cell(label)).join(",")];
  for (const r of rows) lines.push(columns.map(([key]) => cell(r[key])).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

// 파일 이름에 넣는 시각 "20261119-0930"
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
