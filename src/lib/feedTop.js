// 피드 맨 위 "공감 많은 후기"에 보일 글 고르기(Feed.jsx).
// 무효 처리했거나 운영진이 가린 글, 공감이 없는 글은 빼고, 공감 많은 순. 같은 공감 수면 먼저 쓴 글이 위
// (3등 베스트 후기상의 동점 기준과 같다. 다만 여기 숫자는 당사자의 공감도 포함한 화면용 숫자라 시상 순위와 다를 수 있다).
export const TOP_COUNT = 3;
export const pickTop = (docs, n = TOP_COUNT) => docs
  .filter((r) => !r.voided && !r.hidden && (r.likes || 0) > 0)
  .sort((a, b) => (b.likes || 0) - (a.likes || 0) || (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0))
  .slice(0, n);
