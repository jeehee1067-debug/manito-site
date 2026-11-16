// 상품 구성은 여기서만 바꾸면 된다. 추첨 순서는 tiers 배열 순서(작은 상부터) → 대추첨.
export const PRIZES = {
  grand: { label: "대추첨", count: 1, prize: "50만원 상품권" },
  bestManito: { label: "베스트 마니또", count: 3, prize: "각 10만원" },
  bestReview: { label: "베스트 후기상", count: 1, prize: "2만원" },
  mostTickets: { label: "최다 응모권상", count: 1, prize: "2만원" },
  tiers: [
    { key: "t4", label: "응모권 추첨 4등", count: 12, prize: "5천원" },
    { key: "t3", label: "응모권 추첨 3등", count: 14, prize: "1만원" },
    { key: "t2", label: "응모권 추첨 2등", count: 4, prize: "2만원" },
  ],
};

export const TICKET_RULES = {
  perRedeemedMission: 1, // 마니또: 미션이 인증될 때마다
  cardBonus: { normal: 1, hard: 2 }, // 마니또: 보통·도전 카드 미션이 받는 사람에게 직접 인증되면 추가 (쉬움·칭찬 카드는 없음)
  perReceiverEntry: 1, // 받는 사람: 인증 입력할 때마다
  hidden: 2, // 마니또: 끝까지 안 들킴
  hiddenMinMissions: 1, // 은신 응모권은 내 미션이 이만큼 이상 인증된 마니또만 (아무것도 안 하고 받는 것 방지)
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

export const SCORE_WEIGHTS = { completion: 0.3, vote: 0.5, admin: 0.2 };
