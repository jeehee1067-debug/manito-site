// 피드 탭이 읽어 둔 것(피드 탭은 들어올 때마다 새로 만들어진다: App.jsx REMOUNT).
// 탭을 오갈 때마다 최근 글 30건을 다시 읽지 않도록 LIST_TTL 동안은 읽어 둔 목록을 쓴다("새 글 확인"·"더 보기"는 새로 읽는다).
// 내가 쓴 것은 바로 보이게: 인증(새 피드 글)·감사 답장을 보내면 forgetFeed()로 지우고, 다음에 열 때는 요약 문서(public/feed) 대신
// feed를 직접 읽는다(forceFull). 공감은 Feed.jsx가 숫자를 직접 고친다.
// 여기에는 Firestore를 부르는 코드가 없다(tests/logic.test.js). 읽고 쓰는 것은 lib/feedDigest.js.
export const LIST_TTL = 3 * 60 * 1000;
export const TOP_TTL = 5 * 60 * 1000;
export const feedCache = {
  list: { at: 0, count: 0, docs: [] }, // 최근 글(createdAt 내림차순)
  top: { at: 0, docs: [] }, // 공감 많은 글 후보(likes 내림차순)
  forceFull: false, // 다음에 열 때 요약 문서를 쓰지 않고 feed를 직접 읽는다
};
export function freshList(count, now = Date.now()) {
  const c = feedCache.list;
  return now - c.at < LIST_TTL && c.count >= count ? c.docs.slice(0, count) : null;
}
export function forgetFeed() {
  feedCache.list = { at: 0, count: 0, docs: [] };
  feedCache.top = { at: 0, docs: [] };
  feedCache.forceFull = true;
}

// 요약 문서의 최근 글(recent) 앞에 그 뒤로 새로 올라온 글(fresh, 최신순)을 붙인다. 같은 글은 새로 읽은 쪽을 쓴다.
export function mergeDigest(recent = [], fresh = [], count = 30) {
  const ids = new Set(fresh.map((d) => d.id));
  return [...fresh, ...recent.filter((d) => !ids.has(d.id))].slice(0, count);
}

// 요약 문서를 만든 뒤 글쓴이가 고친 글(fresh)로 같은 글을 바꿔 넣는다(요약에 없는 글은 더하지 않는다).
// 요약은 운영자 화면이 열려 있을 때만 새로 쓰여서, 고친 후기(예: 실수로 쓴 이름을 지운 것)가 요약에 예전 글로 남아 있을 수 있다.
export function overlayPosts(list = [], fresh = []) {
  const byId = new Map(fresh.map((d) => [d.id, d]));
  return list.map((d) => byId.get(d.id) || d);
}

// 요약 문서를 다시 쓸지 비교할 때 쓰는 글자(시각은 초로)
const sec = (t) => (t && typeof t.seconds === "number" ? t.seconds : t ?? null);
const postKey = (d) => [d.id, d.slot, d.review, Boolean(d.voided), Boolean(d.hidden), d.thanks || "", d.likes || 0, sec(d.createdAt), sec(d.editedAt)];
export function digestKey(recent = [], top = []) {
  return JSON.stringify([recent.map(postKey), top.map(postKey)]);
}

// 글 하나의 값을 고친다(운영자의 무효·가리기·답장 지우기를 요약 문서에도 바로 반영). patch의 값이 undefined면 그 칸을 지운다.
export function patchPosts(list = [], id, patch = {}) {
  return list.map((d) => {
    if (d.id !== id) return d;
    const next = { ...d };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = v;
    }
    return next;
  });
}
