// 피드 탭이 읽어 둔 것(피드 탭은 들어올 때마다 새로 만들어진다: App.jsx REMOUNT).
// 탭을 오갈 때마다 최근 글 30건을 다시 읽지 않도록 LIST_TTL 동안은 읽어 둔 목록을 쓴다("새 글 확인"·"더 보기"는 새로 읽는다).
// 내가 쓴 것은 바로 보이게: 인증(새 피드 글)·감사 답장을 보내면 forgetFeed()로 지운다. 공감은 Feed.jsx가 숫자를 직접 고친다.
export const LIST_TTL = 3 * 60 * 1000;
export const TOP_TTL = 5 * 60 * 1000;
export const feedCache = {
  list: { at: 0, count: 0, docs: [] }, // 최근 글(createdAt 내림차순)
  top: { at: 0, docs: [] }, // 공감 많은 글 후보(likes 내림차순)
};
export function freshList(count, now = Date.now()) {
  const c = feedCache.list;
  return now - c.at < LIST_TTL && c.count >= count ? c.docs.slice(0, count) : null;
}
export function forgetFeed() {
  feedCache.list = { at: 0, count: 0, docs: [] };
  feedCache.top = { at: 0, docs: [] };
}
