export const PHASES = ["준비", "미션 진행", "최종 지목", "투표", "집계", "공개"];
export const PHASE = { SETUP: 0, RUNNING: 1, GUESSING: 2, VOTING: 3, SCORING: 4, REVEAL: 5 };

export const REVIEW_MIN = 20;
export const TEAM_COUNT = 8;
// 근무지: 방탈출과 같은 구분. 같은 근무지끼리만 마니또 짝을 지어 실물 미션이 가능하게 한다.
export const LOCS = ["SR3", "S1L"];
export const MISSION_SLOTS = [1, 2, 3]; // 1·2주차 미션 카드, 3주차 칭찬 카드
export const PRAISE_SLOT = 3;
export const CLUE_COUNT = 6;

export const PROFILE_QUESTIONS = [
  "가장 좋아하는 간식은?",
  "출근하면 제일 먼저 하는 일은?",
  "커피, 차, 둘 다 안 마심 중에서는?",
  "주말에 주로 하는 것은?",
  "요즘 빠져 있는 것은? (드라마, 게임, 운동 등)",
  "올해를 한 단어로 표현하면?",
];

export const LEVEL_LABEL = { easy: "쉬움", normal: "보통", hard: "도전" };

// remote: 다른 근무지에 있는 대상에게도 할 수 있는 미션인지.
// 대상이 다른 근무지면 remote 카드만 제시한다. 쉬움 카드는 모두 사이트 쪽지로 하는 무비용 미션.
export const MISSION_CARDS = {
  easy: [
    { id: "e1", remote: true, text: "사이트 쪽지로 오늘 하루 응원 메시지 보내기" },
    { id: "e2", remote: true, text: "대상의 최근 업무에 대한 칭찬 한 줄 쪽지 보내기" },
    { id: "e3", remote: true, text: "대상에게 어울리는 노래 한 곡 추천 쪽지 보내기" },
    { id: "e4", remote: true, text: "직접 쓴 오늘의 운세 쪽지 보내기" },
    { id: "e5", remote: true, text: "대상이 좋아할 만한 점심 메뉴 추천 쪽지 보내기" },
    { id: "e6", remote: true, text: "퇴근길에 힘이 되는 한마디 쪽지 보내기" },
  ],
  normal: [
    { id: "n1", remote: false, text: "대상 책상에 간식 하나 몰래 두기" },
    { id: "n2", remote: false, text: "손편지 써서 몰래 전달하기" },
    { id: "n3", remote: false, text: "대상 자리에 음료 한 잔 두기" },
    { id: "n4", remote: false, text: "응원 문구를 쓴 포스트잇 붙여두기" },
    { id: "n5", remote: false, text: "대상이 좋아할 것 같은 간식 추측해서 전달하기" },
    { id: "n6", remote: true, text: "대상만을 위한 노래 3곡 플레이리스트 쪽지 보내기" },
    { id: "n7", remote: true, text: "대상의 하루를 응원하는 짧은 시 쪽지 보내기" },
    { id: "n8", remote: true, text: "대상 근무지에 갈 일이 생기면 몰래 간식 두기 (못 가게 되면 다른 카드로 바꾸기)" },
  ],
  hard: [
    { id: "h1", remote: false, text: "대상 이름으로 삼행시를 지어 손편지로 전달하기" },
    { id: "h2", remote: false, text: "대상에 대한 퀴즈 카드를 만들어 전달하기" },
    { id: "h3", remote: false, text: "종이접기 등 직접 만든 소품 전달하기" },
    { id: "h4", remote: false, text: "대상에게 필요할 것 같은 물건을 추측해서 선물하기" },
    { id: "h5", remote: true, text: "3일 연속 매일 다른 응원 쪽지 보내기" },
    { id: "h6", remote: true, text: "대상 근무지 동료를 공범으로 섭외해 간식 전달하기 (공범에게도 비밀 유지 부탁)" },
    { id: "h7", remote: true, text: "대상에 대한 퀴즈 5문제를 쪽지로 보내기" },
    { id: "h8", remote: true, text: "대상 이름 삼행시 쪽지 보내기" },
  ],
};

// 캐릭터: 방탈출(office-escape)의 참가자 캐릭터와 같은 그림 (public/char)
export const AVATARS = ["p1", "p2", "p3", "p4"];
