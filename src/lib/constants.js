export const PHASES = ["준비", "미션 진행", "최종 지목", "마감", "집계", "공개"];
// 마감(3): 지목까지 끝나고 집계를 기다리는 단계. 예전에는 투표 단계였다(투표는 없앴고, 단계는 한 칸씩만 넘어가므로 번호는 그대로 둔다)
export const PHASE = { SETUP: 0, RUNNING: 1, GUESSING: 2, CLOSED: 3, SCORING: 4, REVEAL: 5 };

export const REVIEW_MIN = 20;
// 글쓴이가 후기·감사 답장을 고칠 수 있는 횟수(합쳐서, 집계 전까지). firestore.rules의 redemptions edits 한도와 같아야 한다(npm test가 확인).
export const REVIEW_EDITS_MAX = 3;
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
  { q: "나만 아는 의외의 TMI 하나는?", min: 2, hint: "예: 숨은 특기, 어릴 때 별명 (바로 누군지 드러나는 건 빼고)" },
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
// 실물 미션 꿀팁(사용자가 정함): 서로 먼 사무실이라 오가기 힘들 때. 내 미션 화면(실물 카드)과 규칙 탭에 보인다.
export const DROP_TIP = "서로 먼 사무실이라 오가기 힘들면 분석실 신발장을 이용해 보세요. 물건을 두고 쪽지로 위치를 알려 주면 돼요.";
// 난이도 고르기·카드 두 장 화면의 작은 한 줄(사용자가 정함: "카드 뽑을 때도 신발장으로 어렵지 않게 전달할 수 있다는 꿀팁 작게")
export const DROP_TIP_SHORT = "실물 미션도 어렵지 않아요. 사무실이 멀면 분석실 신발장에 두고 쪽지로 위치만 알려 주세요.";

// 완료한 주차에 "쪽지 더 보내기"로 보낼 수 있는 추가 쪽지 수(주차마다). 3일 연속 쪽지 카드를 할 수 있게 둔 것이라 넉넉히 잡았다.
// firestore.rules에도 같은 숫자(5)가 적혀 있다(giverMissions.notes와 쪽지 문서 ID 순번으로 센다). 바꾸면 규칙도 같이 고칠 것 — npm test가 같은지 확인한다.
export const EXTRA_NOTES_MAX = 5;

// 행사 일정(참여자 화면 "이번 주 할 일"과 규칙 탭에 보인다). 바꾸면 화면에 바로 반영된다.
// 주차를 올리고 단서를 공개하는 것은 운영자가 그날 운영 탭에서 직접 누른다(자동으로 바뀌지 않음).
// kind: 규칙 탭 타임라인의 꼬리표·색(join 가입, week 주차 미션, clue 단서, close 마감·지목, party 송년회)
export const SCHEDULE = [
  { date: "2026-11-17", kind: "join", text: "가입 시작 (회사 메일 인증, 프로필 작성)" },
  { date: "2026-11-18", kind: "week", text: "마니또 배정 · 1주차 미션 시작" },
  { date: "2026-11-20", kind: "clue", text: "단서 2개 공개" },
  // 주차 열기·미션 마감은 12:00에 실행하고(그 전 주차도 그때 실제로 닫힌다), 마감은 11:00으로 안내한다(due).
  // 사용자가 정함, 11/23: "11시까지라고 홍보해 뒀고 진작 하시란 의미로 말은 그렇게", 12/1·12/8도 "다 같은 방식으로"
  { date: "2026-11-24", time: "12:00", due: "11:00", kind: "week", text: "2주차 미션 시작 (1주차 미션은 11:00 마감)" },
  { date: "2026-11-27", kind: "clue", text: "단서 2개 공개" },
  { date: "2026-12-01", time: "12:00", due: "11:00", kind: "week", text: "3주차 미션 시작 (2주차 미션은 11:00 마감 · 전원 칭찬 한 줄 + 원하면 카드 미션)" },
  { date: "2026-12-04", kind: "clue", text: "단서 2개 공개" },
  { date: "2026-12-08", time: "12:00", due: "11:00", kind: "close", text: "최종 지목 시작 (3주차 미션은 11:00 마감 · 마지막 단서: 파트)" },
  { date: "2026-12-09", kind: "party", text: "송년회: 응모권 집계, 정체 공개, 시상, 추첨" },
];
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
// 이 기기의 오늘 날짜 "YYYY-MM-DD"(한국 시간 기기 기준)
export function todayYmd(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
export function shortDate(date) {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY[d.getDay()]})`;
}
export function scheduleLabel({ date, time, text }) {
  return `${shortDate(date)}${time ? ` ${time}` : ""} ${text}`;
}

// 주차별 미션 마감(사용자가 정함, 11/23: "지난 주차를 마니또가 몰아서 하는 것은 안 된다"): 그 주차 미션(카드 고르기·완료 알리기)은
// 다음 주차가 열릴 때(일정표의 다음 "week" 날짜·시각), 3주차는 미션 마감("close") 때 닫힌다. 보안 규칙은 열린 주차(config.week)만 받는다.
// 받는 사람의 인증은 지난 주차도 최종 지목이 마감될 때까지 된다.
// 일정에 due가 있으면 그것이 안내하는 마감 시각이다(실제로 닫히는 것은 다음 주차를 여는·미션을 마감하는 time — 11:00 안내, 12:00에 닫힘).
// 반환 { date, time, label: "11/24(화) 11:00" } 또는 null
export function weekDeadline(week) {
  const weeks = SCHEDULE.filter((e) => e.kind === "week");
  const e = week < weeks.length ? weeks[week] : SCHEDULE.find((x) => x.kind === "close");
  if (!e) return null;
  const t = e.due || e.time || "";
  return { date: e.date, time: t, label: `${shortDate(e.date)}${t ? ` ${t}` : ""}` };
}
// 안내한 마감 시각이 지났는지(이 기기의 시계 기준). 지났어도 다음 주차가 열리기 전까지는 실제로 할 수 있다.
export function deadlinePassed(week, now = new Date()) {
  const d = weekDeadline(week);
  if (!d) return false;
  return now.getTime() >= new Date(`${d.date}T${d.time || "23:59"}:00`).getTime();
}
// 두 날짜("YYYY-MM-DD") 사이의 날 수(to - from). 타임라인의 "D-2" 표시에 쓴다.
export function daysBetween(from, to) {
  return Math.round((new Date(`${to}T00:00:00`) - new Date(`${from}T00:00:00`)) / 86400000);
}
// 프로필 작성 기한: 첫 단서 공개 전날(사용자가 정함: "이번 주 목요일까지 작성해 달라"). 단서는 프로필 답에서 나간다.
const dayBefore = (date) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const FIRST_CLUE_DATE = SCHEDULE.find((e) => e.text.startsWith("단서"))?.date || null;
export const PROFILE_DUE = FIRST_CLUE_DATE ? dayBefore(FIRST_CLUE_DATE) : null;
// 단서 공개 날짜 3개(1·2번, 3·4번, 5·6번). 일정에서 "단서"로 시작하는 날을 순서대로 쓴다.
export const CLUE_DATES = SCHEDULE.filter((e) => e.text.startsWith("단서")).map((e) => shortDate(e.date));
export const clueScheduleText = () => (CLUE_DATES.length >= 3
  ? `${CLUE_DATES[0]} 1·2번 → ${CLUE_DATES[1]} 3·4번 → ${CLUE_DATES[2]} 5·6번`
  : "1·2번 → 3·4번 → 5·6번");

// 회사 메일 도메인. 명단에는 아이디(@ 앞부분)만 넣고, 가입·로그인 화면에서도 아이디만 적으면 이 도메인을 붙인다.
// 가입한 사람은 이 메일로 온 인증 링크를 눌러 명단의 자기 이름과 연결한다(초대 코드는 메일이 안 올 때의 예비).
export const MAIL_DOMAIN = "samsung.com";
// 메일 인증으로 연결했을 때 명단의 inviteUsed 칸에 남기는 표시(초대 코드로 연결하면 그 코드가 남는다). firestore.rules와 같아야 한다.
export const MAIL_LINK = "@mail";

// 게시돼 있어야 하는 보안 규칙 버전. firestore.rules의 rulesVersion과 같아야 한다.
// 규칙에서 화면이 쓰는 경로·값의 모양을 바꿀 때 양쪽을 같이 올린다. 운영 화면이 이 값으로 "콘솔의 규칙이 예전 것"인지 확인해 알려 준다.
export const RULES_VERSION = "20261127";

// remote: 다른 근무지에 있는 대상에게도 할 수 있는 미션인지.
// 대상이 다른 근무지면 remote 카드만 제시한다. 쉬움 카드는 모두 사이트 쪽지로 하는 무비용 미션.
// real: 실물을 전달하는 카드(쪽지만으로 끝나지 않는 것).
// cost: 간식·음료·선물처럼 본인 돈이 드는 카드(모두 실물). 카드에 "소액 비용"으로 표시한다.
//   보통·도전을 고르면 나오는 두 장은 "돈이 드는 카드 한 장 + 돈이 안 드는 카드 한 장"이다(lib/cards.js dealCards. 사용자가 정함:
//   모두에게 비용 카드가 한 번 이상 나오게). 각 난이도에 무비용 카드가 원격용 포함 2장 이상 있어야 한다(tests/logic.test.js가 확인).
// guess: 대상에 대해 알아내 맞혀 보는 카드. 방법은 자유(사용자가 정함: 본인에게 물어봐도 된다. 대신 들킬 수 있다).
//   대상이 인증할 때 "카드와 같아요"를 맞혔을 때만 체크한다 → 틀리면 카드 추가분이 없다(Detective.jsx가 안내).
// 난이도 기준(같은 응모권이면 같은 수고가 되게 맞춘 것. 카드를 더할 때 이 기준으로 넣는다):
//   쉬움(+0) = 사이트 쪽지 한 통
//   보통(+1) = 공들여 지어 쓰는 사이트 쪽지(시·삼행시·퀴즈·별명·장점) 또는 간단한 실물(포스트잇·간식·음료·핫팩)
//   도전(+2) = 직접 만든 것을 몰래 전달(상장·그림·소품·포스트잇 아트), 선물, 여러 날 이어서 하는 것, 대상에 대해 알아내 맞혀 보기
// 쪽지만으로 끝나는 도전 카드는 "3일 연속"과 "알아내 맞혀 보기"(틀리면 추가분 없음)뿐이다. 긴 편지(손편지)는 넣지 않는다(사용자가 정함).
// from: 이 주차부터 나오는 카드(사용자가 정함, 11/23: 2주차에 새 카드. 1주차 카드 뽑기는 그대로 두려고 1주차에는 넣지 않는다).
//   2주차부터는 두 장 중 한 장이 새 카드(lib/cards.js dealCards). 미션이 시작된 뒤에는 글·번호를 바꾸지 말고 새 번호로 더하기만 한다.
// gold: 황금 카드(사용자가 정함, 11/23). 2·3주차에 누구나 고를 수 있는 특별 도전 미션. 응모권은 도전 카드와 같고,
//   그 주에 황금 카드를 해서 대상이 "카드와 같아요"로 인증한 마니또 중 매주 추첨으로 커피 쿠폰(config/prizes.js GOLD_DRAW, lib/gold.js).
//   일반 도전 카드 두 장에는 나오지 않고 "황금 카드"를 고르면 따로 두 장(돈이 드는 것 + 안 드는 것)이 나온다(lib/cards.js goldDeal).
//   remoteOnly: 다른 근무지 대상에게만 나오는 황금 카드. name: 규칙 탭에 적는 짧은 이름(새 카드·황금 카드).
export const MISSION_CARDS = {
  easy: [
    { id: "e1", remote: true, text: "사이트 쪽지로 오늘 하루 응원 메시지 보내기" },
    { id: "e2", remote: true, text: "대상의 최근 업무에 대한 칭찬 한 줄 쪽지 보내기" },
    { id: "e3", remote: true, text: "대상에게 어울리는 노래 한 곡 추천 쪽지 보내기" },
    { id: "e4", remote: true, text: "직접 쓴 오늘의 운세 쪽지 보내기" },
    { id: "e5", remote: true, text: "대상이 좋아할 만한 점심 메뉴 추천 쪽지 보내기" },
    { id: "e6", remote: true, text: "퇴근길에 힘이 되는 한마디 쪽지 보내기" },
    // 2주차 새 카드
    { id: "e7", name: "밸런스 게임", from: 2, remote: true, text: "회사 생활 밸런스 게임 3문제를 쪽지로 보내기 (예: 평생 아아 vs 평생 뜨아. 대상은 '마니또에게 한마디'로 답할 수 있어요)" },
  ],
  normal: [
    // 간단한 실물(돈이 드는 것 3장 + 안 드는 것 1장)
    { id: "n1", real: true, cost: true, remote: false, text: "대상 책상 위에 간식 하나 몰래 두기" },
    { id: "n2", real: true, cost: true, remote: false, text: "대상 자리에 음료 한 잔 두기" },
    { id: "n3", real: true, cost: true, remote: false, text: "추운 날 대상 자리에 핫팩이나 따뜻한 차 티백 몰래 두기" },
    { id: "n4", real: true, remote: false, text: "응원 문구를 쓴 포스트잇 붙여두기" },
    // 공들여 지어 쓰는 쪽지
    { id: "n5", remote: true, text: "대상만을 위한 노래 3곡 플레이리스트 쪽지 보내기" },
    { id: "n6", remote: true, text: "대상의 하루를 응원하는 짧은 시 쪽지 보내기" },
    { id: "n7", remote: true, text: "대상 이름 삼행시 쪽지 보내기" },
    { id: "n8", remote: true, text: "대상에 대한 O/X 퀴즈 5문제를 쪽지로 보내기 (예: '○○님은 아침형 인간이다'. 내용이 맞는지는 상관없어요)" },
    { id: "n9", remote: true, text: "대상의 장점 3가지를 찾아 쪽지로 보내기" },
    { id: "n10", remote: true, text: "대상에게 어울리는 멋진 별명을 지어 이유와 함께 쪽지로 보내기" },
    // 2주차 새 카드
    { id: "n11", name: "방탈출 쪽지", from: 2, remote: true, text: "수수께끼 3개를 풀면 응원 문구가 완성되는 방탈출 쪽지 보내기" },
    { id: "n12", name: "비밀 지령", from: 2, remote: true, text: "대상에게 오늘 하루 '비밀 지령' 쪽지 보내기 (예: 오후 3시에 기지개 켜기처럼 남에게 티 안 나는 것. 성공했는지는 '마니또에게 한마디'로 보고받기)" },
    { id: "n13", name: "실황 중계", from: 2, remote: true, text: "대상의 하루를 스포츠 실황 중계처럼 쓴 쪽지 보내기 (출근부터 퇴근까지, 과장 환영)" },
  ],
  hard: [
    // 직접 만든 것을 몰래 전달
    { id: "h1", real: true, remote: false, text: "대상에게 줄 '오늘의 상' 상장을 직접 만들어 몰래 전달하기 (예: 미소 천사상, 야근 요정상)" },
    { id: "h2", real: true, remote: false, text: "대상을 닮은 귀여운 동물이나 캐릭터를 그려 이유 한 줄과 함께 몰래 전달하기" },
    { id: "h3", real: true, remote: false, text: "종이접기 등 직접 만든 소품 몰래 전달하기" },
    { id: "h4", real: true, remote: false, text: "포스트잇 여러 장으로 대상 자리에 응원 그림이나 글자를 만들어 두기 (업무에 방해되지 않게)" },
    // 선물(돈이 드는 것)
    { id: "h5", real: true, cost: true, remote: false, text: "대상에게 필요할 것 같은 작은 물건을 골라 선물하기 (5천원 이하면 충분해요)" },
    // 공범: 전달을 부탁하는 한 사람에게만 알린다(규칙 탭 "지켜 주세요"의 예외). 다른 근무지 대상에게 실물을 보내는 방법
    { id: "h6", real: true, cost: true, remote: true, text: "동료를 공범으로 섭외해 간식을 대신 전달하게 하기 (인증 코드 메모를 함께, 공범에게도 비밀 유지 부탁)" },
    { id: "h7", real: true, cost: true, guess: true, remote: false, text: "대상이 좋아하는 것을 알아내 그와 관련된 작은 선물하기 (방법은 자유, 5천원 이하. 좋아하는 게 아니면 카드 추가분 없음)" },
    // 여러 날
    { id: "h8", remote: true, text: "3일 연속 매일 다른 응원 쪽지 보내기 (첫날 완료를 알린 뒤 '쪽지 더 보내기'로 이어서)" },
    // 알아내 맞혀 보기: 방법은 자유(주변에 묻기, 관찰, 본인에게 슬쩍 묻기 — 들킬 수 있다). 맞았는지는 대상이 인증할 때 확인한다
    { id: "h9", guess: true, remote: true, text: "대상이 요즘 해 보고 싶은 취미를 알아내 쪽지로 맞혀 보기 (방법은 자유, 틀리면 카드 추가분 없음)" },
    { id: "h10", guess: true, remote: true, text: "대상이 요즘 즐겨 보는 드라마·유튜브를 알아내 쪽지로 맞혀 보기 (방법은 자유, 틀리면 카드 추가분 없음)" },
    { id: "h11", guess: true, remote: true, text: "대상의 어릴 적 꿈(장래희망)을 알아내 쪽지로 맞혀 보기 (방법은 자유, 틀리면 카드 추가분 없음)" },
    { id: "h12", guess: true, remote: true, text: "대상이 꼭 가 보고 싶은 여행지를 알아내 쪽지로 맞혀 보기 (방법은 자유, 틀리면 카드 추가분 없음)" },
    { id: "h13", guess: true, remote: true, text: "대상이 쉬는 날 주로 하는 일을 알아내 쪽지로 맞혀 보기 (방법은 자유, 틀리면 카드 추가분 없음)" },
    // 황금 카드(2주차부터, 일반 도전 카드 두 장에는 안 나온다)
    { id: "h14", name: "타임어택 배달", gold: true, from: 2, real: true, remote: true, text: "타임어택 배달: '오늘 오후 ○시에 선물이 도착합니다'라고 미리 알린 뒤, 그 시각에 맞춰 직접 만든 것(그림·상장·종이접기 등)이 대상 자리에 나타나게 하기 (다른 근무지면 공범이 대신 전달)" },
    { id: "h15", name: "마니또 카페", gold: true, from: 2, real: true, cost: true, remote: false, text: "마니또 카페: 간식·음료 3가지 메뉴판을 사이트로 보내고, 대상이 '마니또에게 한마디'로 주문하면 그 메뉴를 몰래 배달하기 (5천원 이하. 주문이 없으면 마니또가 골라서)" },
    { id: "h16", name: "공범 카페", gold: true, from: 2, real: true, cost: true, remote: true, remoteOnly: true, text: "공범 카페: 간식·음료 3가지 메뉴판을 사이트로 보내고, 대상이 '마니또에게 한마디'로 주문하면 공범을 섭외해 그 메뉴를 대신 배달하게 하기 (5천원 이하. 공범에게도 비밀 유지 부탁)" },
  ],
};

// 카드를 하는 방법(사용자가 정함: "실물 쪽지를 실제로 줘야 하는 것과 이 사이트에서 쪽지를 보내면 되는 과제가 헷갈리지 않게").
// 카드 글에 "쪽지 보내기"라고만 적힌 카드가 많은데, 미션이 시작된 뒤에는 글을 바꿀 수 없어서(cardLevel) 글 대신 표시로 구분한다.
//   site(사이트 쪽지): 이 사이트의 쪽지 칸에 써서 보내면 끝나는 카드(종이 쪽지 아님). real이 없는 카드 전부.
//   real(실물 전달): 실물을 직접 두거나 건네는 카드(real: true).
export const CARD_HOW = {
  site: { label: "사이트 쪽지", desc: "이 사이트의 쪽지 칸에 써서 보내면 끝이에요 (종이 쪽지를 따로 줄 필요 없어요)" },
  real: { label: "실물 전달", desc: "실물을 직접 두거나 건네야 해요 (사이트 쪽지만 보내면 카드와 달라요)" },
};
const CARD_LIST = Object.entries(MISSION_CARDS).flatMap(([level, cards]) => cards.map((c) => ({ ...c, level })));
// 번호(cardId·id)나 글로 카드를 찾는다. 완료 알림(deliveries.card)에는 번호가 없어서 글로 찾는다.
export function findCard(card) {
  if (!card) return null;
  const id = card.cardId || card.id;
  return (id && CARD_LIST.find((c) => c.id === id)) || CARD_LIST.find((c) => c.text === card.text) || null;
}
// 황금 카드인지(번호나 글로 찾는다. 완료 알림의 card에는 번호가 없다)
export const isGoldCard = (card) => Boolean(findCard(card)?.gold);
// 2주차부터 새로 들어온 카드인지
export const isNewCard = (card) => (findCard(card)?.from || 1) >= 2;
// "site" | "real" | null(목록에 없는 카드: 3주차 "칭찬만" 등)
export function cardHow(card) {
  const c = findCard(card);
  return c ? (c.real ? "real" : "site") : null;
}

// 캐릭터: 방탈출(office-escape)의 참가자 캐릭터와 같은 그림 (public/char)
export const AVATARS = ["p1", "p2", "p3", "p4"];
