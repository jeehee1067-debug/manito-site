// 상품 구성은 여기서만 바꾸면 된다(인원·금액을 고치면 규칙 안내·발표 화면·추첨이 같이 바뀐다).
// 선물대 한도 112만원(세금 포함)은 1~5등: 50 + 10×3 + 5 + 5×4 + 1×7 = 112만원. 6등(커피 쿠폰 20명)은 회의비로 따로.
// 추첨: 현장에서 정한 숫자 하나로 큰 상부터(1등 → 2등 → 4등 → 5등 → 6등) 한 번에 정하고, 한 사람은 그중 하나만 받는다(scoring.js drawAll).
//   2등 베스트 마니또는 추첨이 아니라 응모권이 가장 많은 순(1등 당첨자는 빼고, 경계에서 동점이면 같은 숫자로 가른다).
//   3등 베스트 후기상은 운영진이 뽑는 상이라 추첨과 따로다(겹칠 수 있다).
// 발표는 거꾸로 6등 → 5등 → 4등 → 3등 → 2등 → 1등(reveal.js).
export const PRIZES = {
  grand: { key: "grand", label: "1등 대추첨", count: 1, prize: "50만원 상품권" },
  bestManito: { key: "best", label: "2등 베스트 마니또", count: 3, prize: "각 10만원" },
  bestReview: { label: "3등 베스트 후기상", count: 1, prize: "5만원" },
  tiers: [ // 큰 상부터
    { key: "t4", label: "4등 응모권 추첨", count: 4, prize: "5만원" },
    { key: "t5", label: "5등 응모권 추첨", count: 7, prize: "1만원" },
    { key: "t6", label: "6등 응모권 추첨", count: 20, prize: "커피 쿠폰(5천원)" },
  ],
};

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
  maxCardBonus: 4, // 카드 추가분 합계 상한 (1·2주차 모두 도전이면 2 + 2)
  angelPerMission: 1, // 수호천사(지원자): 연결된 사람이 확인한 수호천사 미션마다
  maxAngel: 2, // 수호천사 응모권 상한(수호천사 미션은 받는 사람마다 2번까지)
  maxReceiverEntries: 3,
};
