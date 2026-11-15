// 송년회 발표 화면의 장면 순서. 운영자 화면(발표 화면)과 참여자 결과 화면이 같은 순서를 계산해서,
// 운영자가 넘긴 장면(results/public.step)까지만 참여자 화면에도 보인다.
import { PRIZES } from "../config/prizes.js";

const DRAW_ORDER = [...PRIZES.tiers.map((t) => ({ ...t, tier: true })), { key: "grand", ...PRIZES.grand, tier: false }];
export { DRAW_ORDER };

/**
 * 원형 배정을 따라 짝을 잇는다: A의 마니또는 B → 그럼 B의 마니또는? → … (공개한 마니또가 다음 차례의 주인공이 된다)
 * 근무지별로 원이 여러 개면 다음 원으로 넘어간다. 시작은 이름순으로 처음인 받는 사람(모두 같은 순서를 얻게).
 * pairs: [{ giverPid, receiverPid }], nameOf(pid) → 이름
 */
export function pairChain(pairs, nameOf = (x) => x) {
  const giverOf = Object.fromEntries(pairs.map((p) => [p.receiverPid, p.giverPid]));
  const receivers = pairs.map((p) => p.receiverPid).sort((a, b) => String(nameOf(a)).localeCompare(String(nameOf(b)), "ko") || a.localeCompare(b));
  const seen = new Set();
  const out = [];
  for (const start of receivers) {
    let r = start;
    while (r && !seen.has(r) && giverOf[r]) {
      seen.add(r);
      out.push({ receiverPid: r, giverPid: giverOf[r] });
      r = giverOf[r]; // 방금 공개된 마니또가 다음 차례의 받는 사람
    }
  }
  return out;
}

/**
 * 발표 장면 목록. 짝 공개는 "누구의 마니또는?"(ask)과 "정답"(show) 두 장면씩.
 * r: results/public 문서
 */
export function buildSlides(r, nameOf) {
  if (!r) return [];
  const s = [{ id: "intro", type: "intro" }];
  if ((r.partBoard || []).length > 0) s.push({ id: "parts", type: "parts" }, { id: "partWinner", type: "partWinner" });
  s.push({ id: "chainIntro", type: "chainIntro" });
  pairChain(r.pairs || [], nameOf).forEach((p, i) => {
    s.push({ id: `ask${i}`, type: "pairAsk", i, ...p }, { id: `show${i}`, type: "pairShow", i, ...p });
  });
  s.push({ id: "detective", type: "detective" });
  if (r.likesTop) s.push({ id: "likesTop", type: "likesTop" });
  if (r.bestReview) s.push({ id: "bestReview", type: "bestReview" });
  if (r.mostTickets) s.push({ id: "mostTickets", type: "mostTickets" });
  const best = r.bestManito || [];
  for (let k = best.length - 1; k >= 0; k--) s.push({ id: `best${k}`, type: "best", rank: k });
  if ((r.praises || []).length > 0) s.push({ id: "praise", type: "praise" });
  DRAW_ORDER.forEach((d, i) => s.push({ id: `draw_${d.key}`, type: "draw", step: d, index: i }));
  s.push({ id: "end", type: "end" });
  return s;
}

// 참여자 화면에 무엇을 보일지: 운영자가 넘긴 장면(step)까지. step이 없는 예전 결과는 모두 보인다.
export function revealedUpTo(r, slides) {
  if (r?.step == null) return slides.length;
  return Math.min(r.step + 1, slides.length);
}
