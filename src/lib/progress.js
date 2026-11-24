// "모두의 미션 진행"(사용자가 정함, 11/24: "참여 의지를 북돋기 위해 얼마나 많은 마니또가 이미 미션을 완료했고 참여했는지, 아주 간략하고 명확하게").
// 참여자는 남의 미션 문서를 읽을 수 없어서, 운영자·공동 운영자 화면(progressDigest.js ProgressWriter)이 숫자만 세어 public/progress에 적어 둔다:
//   { v: 1, at, joined: 가입한 사람 수, weeks: { "1": 완료한 마니또 수, "2": …, "3": … } }
// 부서 전체의 숫자만 담는다. 파트별 숫자는 넣지 않는다(실시간 파트 숫자로 마니또의 파트가 드러나지 않게 — 파트 순위는 운영자가 금요일에 발표).
// 여기에는 Firestore를 부르는 코드가 없다(tests/logic.test.js).

export const PROGRESS_EVERY = 5 * 60 * 1000; // 운영자 화면이 다시 세는 간격(화면이 보이는 동안만)

// 다시 쓸 필요가 있는지(시각 at은 빼고 비교)
export function sameProgress(a, b) {
  if (!a || !b) return false;
  const wa = a.weeks || {}, wb = b.weeks || {};
  const keys = new Set([...Object.keys(wa), ...Object.keys(wb)]);
  return a.joined === b.joined && [...keys].every((k) => wa[k] === wb[k]);
}

/**
 * 화면에 보일 값. data: public/progress 문서(없으면 null), week: 지금 열린 주차.
 * 반환 null(보일 것 없음) 또는 { week, done, joined, pct(0~100 정수), past: [{ week, done }](지난 주차, 주차 순), at(Date|null) }
 */
export function progressView(data, week = 1) {
  if (!data || !(data.joined > 0)) return null;
  const weeks = data.weeks || {};
  if (weeks[String(week)] == null) return null; // 이번 주차를 아직 세지 않았다(주차가 막 바뀐 때) — 지난 숫자를 이번 주처럼 보이지 않게
  const done = Math.min(weeks[String(week)], data.joined);
  const past = Object.keys(weeks).map(Number).filter((w) => w < week).sort((a, b) => a - b).map((w) => ({ week: w, done: weeks[String(w)] }));
  const at = data.at?.toDate ? data.at.toDate() : null;
  return { week, done, joined: data.joined, pct: Math.round((done / data.joined) * 100), past, at };
}
