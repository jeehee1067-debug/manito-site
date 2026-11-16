// 픽셀 아이콘(16×16 SVG). 그림은 tools/icons/make_icons.py가 글자 격자에서 만든다(src/assets/icons/*.svg).
// 메뉴(탭)와 패널 제목 앞에 붙여 화면마다 무엇을 하는 곳인지 한눈에 보이게 한다. 꾸밈이라 화면 읽기 프로그램에는 숨긴다.
const urls = import.meta.glob("./assets/icons/*.svg", { eager: true, query: "?url", import: "default" });
const ICONS = Object.fromEntries(Object.entries(urls).map(([path, url]) => [path.split("/").pop().replace(".svg", ""), url]));

export function Icon({ name, size = 20, className = "" }) {
  const src = ICONS[name];
  if (!src) return null;
  return <img className={`px-icon ${className}`} src={src} alt="" width={size} height={size} aria-hidden="true" />;
}

// 메뉴 아이콘
export const TAB_ICON = { mission: "gift", detective: "search", feed: "bubble", board: "trophy", profile: "face", rules: "book", reveal: "star", admin: "gear" };

// 패널 제목에 어울리는 아이콘(제목의 낱말로 고른다. 위에서부터 먼저 맞는 것). 맞는 것이 없으면 아이콘 없이 둔다.
const TITLE_ICONS = [
  [/할 일/, "check"],
  [/수호천사/, "heart"],
  [/응모권/, "ticket"],
  [/미션 비용/, "book"],
  [/미션/, "gift"],
  [/메일 인증|온 것|쪽지|한마디|알려 준|알려 줄/, "mail"],
  [/인증/, "stamp"],
  [/단서|용의자|지목|추리/, "search"],
  [/피드/, "bubble"],
  [/순위|대항전/, "trophy"],
  [/프로필|캐릭터|이름 연결|초대 코드|공동 운영자로/, "face"],
  [/상품|추첨|시상|기록|마니또였을까|칭찬 벽/, "star"],
  [/일정/, "calendar"],
  [/규칙|한눈에|재미|지켜|볼 수 있나요/, "book"],
];
export function iconForTitle(title) {
  if (typeof title !== "string") return null;
  return TITLE_ICONS.find(([re]) => re.test(title))?.[1] || null;
}
