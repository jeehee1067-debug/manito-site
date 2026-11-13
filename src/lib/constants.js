export const PHASES = ["준비", "미션 진행", "최종 지목", "투표", "집계", "공개"];
export const PHASE = { SETUP: 0, RUNNING: 1, GUESSING: 2, VOTING: 3, SCORING: 4, REVEAL: 5 };

export const REVIEW_MIN = 20;
// 근무지: 방탈출과 같은 구분. 옵션으로 같은 근무지끼리만 마니또 짝을 지을 수 있다(실물 미션이 가능하게).
export const LOCS = ["SR3", "S1L"];
export const MISSION_SLOTS = [1, 2, 3]; // 1·2주차 미션 카드, 3주차 칭찬 카드
export const PRAISE_SLOT = 3;
export const CLUE_COUNT = 6;

// 단서로 쓰이는 프로필 문항. 내가 맡은 사람(대상)에게 매주 2개씩 순서대로 공개된다.
//  - options가 있으면 고르기: 동료가 실제로 관찰할 수 있는 것 위주라 추리에 쓸 수 있고, 대충 쓸 수 없다.
//  - 없으면 직접 쓰기: min자 이상.
// 문항·보기는 여기서 바꾸면 된다(행사 시작 전에만. 답을 받은 뒤 바꾸면 이미 쓴 답과 어긋난다).
export const PROFILE_QUESTIONS = [
  { q: "주로 마시는 음료는?", options: ["아이스 아메리카노", "따뜻한 커피", "라떼·달달한 커피", "차·기타 음료", "물만 마심"] },
  { q: "점심은 주로?", options: ["구내식당에서 먹음", "구내식당 테이크아웃", "밖에서·도시락", "자주 거름"] },
  { q: "평소 출근 시간은?", options: ["8시 전", "8~9시", "9시 이후"] },
  { q: "내 책상에 늘 있는 물건 하나는?", min: 2 },
  { q: "출퇴근은 주로?", options: ["자가용", "통근버스", "대중교통", "걸어서·자전거"] },
  { q: "요즘 빠져 있는 것은? (드라마, 게임, 운동 등)", min: 2 },
];

// 답이 문항 형식에 맞는지. 맞으면 null, 아니면 안내 문구.
export function profileAnswerError(i, value) {
  const { options, min = 1 } = PROFILE_QUESTIONS[i];
  const v = (value || "").trim();
  if (options) return options.includes(v) ? null : `${i + 1}번은 보기 중에서 골라 주세요.`;
  return v.length >= min ? null : `${i + 1}번은 ${min}자 이상 적어 주세요.`;
}

// 파트 단서: 단서 문서의 7번째 칸(idx 6). 마니또의 파트를 배정할 때 운영자 브라우저가 써 두고,
// 최종 지목 단계가 열리면 받는 사람에게 공개된다. 본인이 쓰는 답이 아니라서 거짓이나 대충이 없다.
export const PART_HINT_IDX = 6;

export const LEVEL_LABEL = { easy: "쉬움", normal: "보통", hard: "도전" };

// 돈이 드는 미션의 권장 상한(건당, 원). 안내 문구에 쓴다.
export const SPEND_GUIDE_WON = 5000;

// 완료한 주차에 "쪽지 더 보내기"로 보낼 수 있는 추가 쪽지 수(주차마다). 3일 연속 쪽지 카드를 할 수 있게 둔 것이라 넉넉히 잡았다.
// 화면에서만 세는 값이다(보안 규칙은 쪽지 개수를 세지 못한다).
export const EXTRA_NOTES_MAX = 5;

// 게시돼 있어야 하는 보안 규칙 버전. firestore.rules의 rulesVersion과 같아야 한다.
// 규칙에서 화면이 쓰는 경로·값의 모양을 바꿀 때 양쪽을 같이 올린다. 운영 화면이 이 값으로 "콘솔의 규칙이 예전 것"인지 확인해 알려 준다.
export const RULES_VERSION = "20261113";

// remote: 다른 근무지에 있는 대상에게도 할 수 있는 미션인지.
// 대상이 다른 근무지면 remote 카드만 제시한다. 쉬움 카드는 모두 사이트 쪽지로 하는 무비용 미션.
// cost: 간식·음료·선물처럼 본인 돈이 드는 카드. 카드에 "소액 비용"으로 표시하고, 난이도마다 "다른 카드 보기"로 무비용 카드를 고를 수 있다
// (각 난이도에 무비용 카드가 원격용 포함 2장 이상 있어야 한다. tests/logic.test.js가 확인).
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
    { id: "n1", cost: true, remote: false, text: "대상 책상에 간식 하나 몰래 두기" },
    { id: "n2", remote: false, text: "손편지 써서 몰래 전달하기" },
    { id: "n3", cost: true, remote: false, text: "대상 자리에 음료 한 잔 두기" },
    { id: "n4", remote: false, text: "응원 문구를 쓴 포스트잇 붙여두기" },
    { id: "n5", cost: true, remote: false, text: "대상이 좋아할 것 같은 간식 추측해서 전달하기" },
    { id: "n6", remote: true, text: "대상만을 위한 노래 3곡 플레이리스트 쪽지 보내기" },
    { id: "n7", remote: true, text: "대상의 하루를 응원하는 짧은 시 쪽지 보내기" },
    { id: "n8", cost: true, remote: true, text: "대상 근무지에 갈 일이 생기면 몰래 간식 두기 (못 가게 되면 다른 카드로 바꾸기)" },
    { id: "n9", remote: true, text: "대상 이름 삼행시 쪽지 보내기" },
  ],
  hard: [
    { id: "h1", remote: false, text: "대상 이름으로 삼행시를 지어 손편지로 전달하기" },
    { id: "h2", remote: false, text: "대상에 대한 퀴즈 카드를 만들어 전달하기" },
    { id: "h3", remote: false, text: "종이접기 등 직접 만든 소품 전달하기" },
    { id: "h4", cost: true, remote: false, text: "대상에게 필요할 것 같은 물건을 추측해서 선물하기" },
    { id: "h5", remote: true, text: "3일 연속 매일 다른 응원 쪽지 보내기 (첫날 완료를 알린 뒤 '쪽지 더 보내기'로 이어서)" },
    { id: "h6", cost: true, remote: true, text: "대상 근무지 동료를 공범으로 섭외해 간식 전달하기 (공범에게도 비밀 유지 부탁)" },
    { id: "h7", remote: true, text: "대상에 대한 퀴즈 5문제를 쪽지로 보내기" },
  ],
};

// 캐릭터: 방탈출(office-escape)의 참가자 캐릭터와 같은 그림 (public/char)
export const AVATARS = ["p1", "p2", "p3", "p4"];
