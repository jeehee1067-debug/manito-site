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
  perHardMission: 1, // 마니또: 도전 미션으로 인증되면 추가
  perReceiverEntry: 1, // 받는 사람: 인증 입력할 때마다
  hidden: 2, // 마니또: 끝까지 안 들킴
  correctGuess: 1, // 받는 사람: 정답 지목
  maxMissions: 3,
  maxHard: 2,
  maxReceiverEntries: 3,
};

export const SCORE_WEIGHTS = { completion: 0.3, vote: 0.5, admin: 0.2 };
