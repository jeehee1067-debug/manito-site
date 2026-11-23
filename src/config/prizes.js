// 상품 구성은 여기서만 바꾸면 된다(인원·금액을 고치면 규칙 안내·발표 화면·추첨이 같이 바뀐다).
// 선물대 한도 112만원(세금 포함)은 1~5등: 50 + 10×3 + 5 + 5×4 + 1×7 = 112만원. 6등(커피 쿠폰 20명)은 회의비로 따로.
// 정하는 방법(how):
//   "paper"  송년회 현장 종이 추첨. 응모권 수만큼 이름 종이를 통에 넣고 뽑아, 운영자가 뽑힌 이름을 발표 화면에 입력한다(1·4·5등)
//   "rank"   응모권이 가장 많은 순(2등 베스트 마니또). 동점이면 내 미션 후기가 받은 공감, 그래도 같으면 현장 숫자로 가른다
//   "review" 익명 피드에서 공감을 가장 많이 받은 후기(3등 베스트 후기상)
//   "online" 사이트 추첨(6등). 현장에서 정한 숫자와 응모권 표로 정하고, 각자 휴대폰으로 확인한다
// 한 사람은 하나만 받는다. 겹치면 큰 상이 우선이다(1등 > 2등 > 3등 > 4등 > 5등 > 6등, scoring.js resolvePrizes).
// 현장 순서: 숫자 받기 → 2등 → 3등 → 4등 → 5등 → 1등(겹쳐도 뽑고, 겹친 자리는 다시 채운다) → 6등(사이트)
export const PRIZES = {
  grand: { key: "grand", label: "1등 대추첨", count: 1, prize: "50만원 상품권", how: "paper" },
  bestManito: { key: "best", label: "2등 베스트 마니또", count: 3, prize: "각 10만원", how: "rank" },
  bestReview: { key: "review", label: "3등 베스트 후기상", count: 1, prize: "5만원", how: "review" },
  tiers: [ // 큰 상부터
    { key: "t4", label: "4등 응모권 추첨", count: 4, prize: "5만원", how: "paper" },
    { key: "t5", label: "5등 응모권 추첨", count: 7, prize: "1만원", how: "paper" },
    { key: "t6", label: "6등 응모권 추첨", count: 20, prize: "커피 쿠폰(5천원)", how: "online" },
  ],
};

// 참여자에게 금액·인원을 알린 상(규칙 탭). 여기 없는 상은 이름과 정하는 방법만 보이고 금액·인원은 "추후 공지"로 나온다.
// 확정해서 알릴 때 key("best", "review", "t4", "t5", "t6")를 더한다. 송년회 발표 화면·결과 탭은 이 값과 상관없이 모두 보인다.
export const PRIZES_ANNOUNCED = ["grand"];

// 황금 카드 추첨(사용자가 정함, 11/23): 2·3주차에 매주 5명, 5천원 커피 쿠폰. 송년회에서 발표하면서 준다(송년회 1~6등과 별개).
// 그 주에 황금 카드를 골라 완료를 알렸고, 대상이 인증하면서 "카드와 같아요"를 확인한 마니또 중에서 같은 확률로 뽑는다(lib/gold.js).
// 추첨은 그 주가 끝난 뒤 운영 화면에서 하고, 뽑힌 마니또만 자기 내 미션 화면에서 확인한다(누가 뽑혔는지는 송년회 전까지 비밀).
export const GOLD_DRAW = { weeks: [2, 3], perWeek: 5, prize: "5천원 커피 쿠폰" };

export const TICKET_RULES = {
  perRedeemedMission: 1, // 마니또: 미션이 인증될 때마다
  cardBonus: { normal: 1, hard: 2 }, // 마니또: 보통·도전 카드 미션이 받는 사람에게 직접 인증되면 추가 (쉬움·칭찬 카드는 없음)
  perReceiverEntry: 1, // 받는 사람: 인증 입력할 때마다
  hidden: 2, // 마니또: 끝까지 안 들킴
  hiddenMinMissions: 3, // 은신 응모권은 내 미션이 이만큼(3주 모두) 인증·인정된 마니또만 (1주만 하고 쉬어도 받는 것 방지)
  hiddenNeedsClues: true, // 은신 응모권은 프로필을 채워 단서 6개가 대상에게 간 마니또만 (단서를 안 내서 안 들키는 것 방지)
  correctGuess: 1, // 받는 사람: 정답 지목
  compPerMissedWeek: 1, // 받는 사람: 내 마니또가 미션을 안 보낸 주차마다 대신 받는 응모권 (인증 입력과 합쳐 maxReceiverEntries까지)
  compMinMissions: 1, // 위 보상은 내 미션이 이만큼 이상 인증된 사람만
  partBonus: 1, // 파트 대항전: 마지막 집계에서 미션 완수율 1위 파트원에게 (동률이면 모두)
  partBonusMinMissions: 1, // 위 응모권은 내 미션이 이만큼 이상 인증된 사람만 (아무것도 안 하고 받는 것 방지)
  maxMissions: 3,
  maxCardBonus: 6, // 카드 추가분 합계 상한 (1·2·3주차 모두 도전이면 2 + 2 + 2. 3주차는 칭찬 한 줄과 함께 고른 카드)
  costBonus: 1, // 마니또: 돈이 드는 카드(소액 비용) 미션을 대상이 직접 인증하고 카드와 같다고 확인하면 추가. 한 사람에 한 번만(여러 번 해도 1장)
  angelPerMission: 1, // 수호천사(지원자): 연결된 사람이 확인한 수호천사 미션마다
  maxAngel: 2, // 수호천사 응모권 상한(수호천사 미션은 받는 사람마다 2번까지)
  maxReceiverEntries: 3,
};
