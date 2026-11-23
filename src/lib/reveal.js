// 송년회 발표 화면의 장면 순서. 운영자 화면(발표 화면)과 참여자 결과 화면이 같은 순서를 계산해서,
// 운영자가 넘긴 장면(results/public.step)까지만 참여자 화면에도 보인다.
import { PRIZES } from "../config/prizes.js";
import { ONLINE_PRIZE, PAPER_TIERS } from "./scoring.js";
import { goldWinnerWeeks, shownTitles } from "./titles.js";

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
  if ((r.angels || []).length > 0) s.push({ id: "angels", type: "angels" });
  if ((r.praises || []).length > 0) s.push({ id: "praise", type: "praise" });
  // 송년회 칭호(받은 사람이 있는 것만, 칭호마다 한 장면)와 황금 카드 커피 쿠폰 당첨자(추첨한 주차가 있을 때 한 장면). 집계 때 정해져 장면 수가 바뀌지 않는다
  shownTitles(r).forEach((t) => s.push({ id: `title_${t.key}`, type: "title", key: t.key }));
  if (goldWinnerWeeks(r).length > 0) s.push({ id: "gold", type: "gold" });
  // 시상·추첨(현장 순서): 숫자 받기(drawGo) → 2등(한 명씩) → 3등 → 4등·5등(종이) → 1등(종이, 겹쳐도 뽑는다)
  //   → 겹친 자리 다시 채우기(refill) → 6등(사이트 추첨, 각자 휴대폰으로 확인).
  // 2·3등을 먼저 발표하는 이유: 종이로 뽑힌 사람이 2·3등 수상자면 다시 뽑아야 하는데, 발표 전이면 그 사람이 수상자라는 것이 미리 드러난다.
  // 장면 수는 진행 중에 바뀌면 안 된다(results/public.step이 장면 번호라서): 2등은 항상 정해진 인원만큼, 겹친 자리 장면은 항상 둔다.
  s.push({ id: "drawGo", type: "drawGo" });
  for (let k = PRIZES.bestManito.count - 1; k >= 0; k--) s.push({ id: `best${k}`, type: "best", rank: k });
  if ((r.reviewRank || []).length > 0 || r.bestReview) s.push({ id: "bestReview", type: "bestReview" });
  [...PAPER_TIERS, PRIZES.grand].forEach((d) => s.push({ id: `draw_${d.key}`, type: "paper", prize: d }));
  s.push({ id: "refill", type: "refill" });
  s.push({ id: `draw_${ONLINE_PRIZE.key}`, type: "online", prize: ONLINE_PRIZE });
  s.push({ id: "end", type: "end" });
  return s;
}

// 참여자 화면에 무엇을 보일지: 운영자가 넘긴 장면(step)까지. step이 없는 예전 결과는 모두 보인다.
export function revealedUpTo(r, slides) {
  if (r?.step == null) return slides.length;
  return Math.min(r.step + 1, slides.length);
}
