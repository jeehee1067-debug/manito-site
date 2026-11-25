// 부서 공지용 "N주차 결산" 숫자 계산(사용자가 정함, 11/25: "진행현황과 흥미를 끌 만한 후기·활동을 한눈에 보는 그림자료와 메일 내용").
// 입력은 운영 화면 "백업 만들기"로 받은 전체 백업 JSON(src/lib/backup.js buildBackup 모양). Firestore를 부르지 않는다(tests/logic.test.js).
// 출력에는 이름·누가 누구의 마니또인지·파트별 숫자를 넣지 않는다. 참여 정도는 비율(%)로만(사용자가 정함, 11/24: "몇 명 중 몇 명이 아니라 비율로").
// 후기는 익명 피드에 이미 공개된 글 중 공감 많은 순(가린 글·무효 글 제외). 그래도 글에 이름이 들어 있을 수 있으니 보내기 전에 사람이 읽어 본다.
import { MISSION_CARDS, cardHow, findCard } from "../../src/lib/constants.js";
import { progressPercents } from "../../src/lib/progress.js";
import { midGuessStats } from "../../src/lib/pairs.js";

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const ms = (t) => (t ? new Date(t).getTime() || 0 : 0); // 백업의 시각은 ISO 글자
const LEVELS = ["easy", "normal", "hard", "praise"];
// 카드 짧은 이름: 이름이 있으면 그것, 없으면 글의 앞부분(괄호 앞, 24자)
export function cardTitle(card) {
  const c = findCard(card) || card || {};
  if (c.name) return c.name;
  const t = String(c.text || "").split(/[(（]/)[0].trim();
  return t.length > 24 ? `${t.slice(0, 23)}…` : t;
}
const clip = (s, n) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/**
 * backup: 전체 백업 JSON, week: 결산할 주차(1~3), topN: 실을 후기 수
 * 반환 { week, completion, nextCompletion(다음 주차 지금까지, 3주차면 null), verifiedPct, notes, likes, levelMix: { easy, normal, hard, praise } (%), howMix: { real, site } (%),
 *        popular: [{ title, level }] (많이 고른 순 3개), guessPct, guessCorrect, topReviews: [{ text, likes }] }
 */
export function computeReport(backup, { week = 1, topN = 3, reviewChars = 90 } = {}) {
  const C = backup?.collections || {};
  const w = String(week);
  const roster = Object.entries(C.roster || {}).map(([pid, r]) => ({ pid, ...r }));
  const missions = C.giverMissions || {};
  const doneIn = (k) => Object.values(missions).filter((m) => m?.done?.[k] === true).length;

  // 미션 완료율: 사이트의 "모두의 미션 진행"과 같은 식(progressDigest.js: 완료 표시가 있는 마니또 수 ÷ 가입한 사람 수)
  // — 참여자가 내 미션 탭에서 본 숫자와 같게. 다음 주차(지금 진행 중)도 같이 센다.
  const joinedAll = roster.filter((r) => r.uid).length;
  const next = week < 3 ? String(week + 1) : null;
  const pcts = progressPercents(joinedAll, { [w]: doneIn(w), ...(next ? { [next]: doneIn(next) } : {}) });

  // 고른 카드: 그 주차를 완료한 마니또의 카드
  const done = Object.entries(missions).filter(([, m]) => m?.done?.[w] === true);
  const choices = done.map(([, m]) => m.choices?.[w]).filter(Boolean);
  const levelCount = Object.fromEntries(LEVELS.map((l) => [l, 0]));
  const howCount = { real: 0, site: 0 };
  const byCard = new Map();
  for (const c of choices) {
    if (c.level in levelCount) levelCount[c.level]++;
    const how = cardHow(c);
    if (how) howCount[how]++;
    if (c.level !== "praise" && c.cardId) {
      const k = c.cardId;
      byCard.set(k, { n: (byCard.get(k)?.n || 0) + 1, card: c });
    }
  }
  const levelTotal = Object.values(levelCount).reduce((a, b) => a + b, 0);
  const howTotal = howCount.real + howCount.site;
  const popular = [...byCard.entries()]
    .sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([, v]) => ({ title: cardTitle(v.card), level: v.card.level }));

  // 인증: 그 주차를 완료한 마니또 중 대상이 그 주차를 인증한(무효 아님) 비율
  const receiverOf = Object.fromEntries(Object.entries(C.assignments || {}).map(([g, a]) => [g, a?.receiverPid]));
  const redeemed = new Set(Object.values(C.redemptions || {}).filter((r) => String(r.slot) === w && !r.voided).map((r) => r.receiverPid));
  const verified = done.filter(([g]) => redeemed.has(receiverOf[g])).length;

  // 쪽지: 그 주차에 오간 쪽지(완료 쪽지·칭찬·추가 쪽지, 빈 쪽지와 운영진이 가린 것 제외)
  const notes = Object.values(C.deliveries || {}).filter((d) => String(d.slot) === w && !d.hidden && String(d.message || "").trim()).length;

  // 피드: 그 주차까지의 글이 받은 공감 합(가린 글·무효 글 제외)과 공감 많은 후기
  const posts = Object.values(C.feed || {}).filter((f) => Number(f.slot) <= week && !f.hidden && !f.voided && String(f.review || "").trim());
  const likes = posts.reduce((s, f) => s + (Number(f.likes) || 0), 0);
  const topReviews = posts
    .filter((f) => (Number(f.likes) || 0) > 0)
    .sort((a, b) => (b.likes || 0) - (a.likes || 0) || ms(a.createdAt) - ms(b.createdAt))
    .slice(0, topN)
    .map((f) => ({ text: clip(f.review, reviewChars), likes: Number(f.likes) || 0 }));

  // 주차별 추측: 운영 화면 "매주 남긴 마니또 추측"과 같은 계산(가입했고 중도 이탈이 아닌 사람 기준). 누가 맞혔는지는 넣지 않는다.
  const g = midGuessStats({ midGuesses: C.midGuesses || {}, assignments: C.assignments || {}, roster, week }).summary.find((x) => x.week === week)
    || { eligible: 0, guessed: 0, correct: 0 };

  return {
    week,
    completion: pcts[w] ?? 0,
    nextCompletion: next ? pcts[next] ?? 0 : null,
    verifiedPct: pct(verified, done.length),
    notes,
    likes,
    levelMix: Object.fromEntries(LEVELS.map((l) => [l, pct(levelCount[l], levelTotal)])),
    howMix: { real: pct(howCount.real, howTotal), site: howTotal ? 100 - pct(howCount.real, howTotal) : 0 },
    popular,
    guessPct: pct(g.guessed, g.eligible),
    guessCorrect: g.correct,
    topReviews,
  };
}

// 2주차부터 새로 나오는 카드 이름(그림·메일의 "NEW 카드")과 황금 카드 이름
export const newCardNames = () => Object.values(MISSION_CARDS).flat().filter((c) => c.from === 2 && !c.gold).map((c) => c.name);
export const goldCardNames = () => Object.values(MISSION_CARDS).flat().filter((c) => c.gold).map((c) => c.name);
