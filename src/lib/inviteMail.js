import { SCHEDULE, scheduleLabel } from "./constants.js";

// 가입 안내 메일(운영 화면 "가입 안내 메일"). 사이트는 서버가 없어 메일을 직접 보내지 못한다.
// 운영자의 회사 메일로 보내도록 받는 사람·제목·본문·가입 링크를 만들어 준다(메일 앱으로 열기 또는 복사해서 붙여 넣기).

// 가입 링크: 이 주소로 열면 로그인 화면이 "처음 가입" 탭으로 열린다(Login.jsx JOIN).
export const JOIN_PARAM = "join";
export function joinUrl(origin, pathname) {
  return `${origin}${pathname}?${JOIN_PARAM}`;
}

// 받는 사람: 명단에서 아이디(메일)가 있는 사람. onlyNotJoined면 아직 가입(연결)하지 않은 사람만.
// noEmail: 아이디가 없어 메일을 보낼 수 없는 사람(초대 코드로 따로 알려야 한다)
export function inviteRecipients(roster, { onlyNotJoined = true } = {}) {
  const pool = roster.filter((r) => !onlyNotJoined || !r.uid);
  const emails = [...new Set(pool.map((r) => r.email).filter(Boolean))].sort();
  const noEmail = pool.filter((r) => !r.email).map((r) => r.name);
  return { emails, noEmail };
}

// 메일 제목과 본문. senderHost = Firebase 인증 메일을 보내는 주소의 도메인(프로젝트ID.firebaseapp.com)
export function inviteMessage({ url, senderHost }) {
  const first = SCHEDULE[0];
  const start = SCHEDULE[1];
  const party = SCHEDULE[SCHEDULE.length - 1];
  const subject = "[S1FA 마니또] 송년회 마니또 사이트 가입 안내";
  const body = [
    "안녕하세요! 부서 송년회 마니또 사이트 가입 안내드려요.",
    "",
    `▶ 가입 링크: ${url}`,
    "",
    "[가입 방법]",
    "1. 링크를 열고 \"처음 가입\"에서 Knox ID(회사 메일의 @ 앞부분)와 새 비밀번호를 정해 주세요. 회사 비밀번호와 다르게 정해 주세요.",
    `2. 회사 메일로 오는 인증 메일(보낸 사람: noreply@${senderHost})의 링크를 누르면 명단의 내 이름과 연결돼요.`,
    "   메일이 안 보이면 스팸함을 확인하거나, 사이트의 \"인증 메일 다시 보내기\"를 눌러 주세요.",
    "3. 연결되면 내 프로필 6문항과 \"내 마니또에게 알려 줄 것\"(좋아하는 간식, 못 먹는 음식)을 채워 주세요.",
    "",
    "[일정]",
    ...[first, start, party].filter(Boolean).map((e) => `- ${scheduleLabel(e)}`),
    "",
    "자세한 규칙은 사이트의 \"규칙\" 탭에 있어요.",
    "문의: 운영진",
  ].join("\n");
  return { subject, body };
}

// 메일 앱으로 여는 주소. 받는 사람(나)에게 보내고 참여자는 숨은 참조(BCC)로 넣는다(서로의 주소가 안 보이고 전체 답장이 안 가게).
// 순서: bcc → subject → body. 메일 앱이 긴 주소를 자르면 뒤쪽(본문)부터 잘려서 받는 사람이 빠지는 일을 줄인다.
// 줄바꿈은 RFC 6068대로 %0D%0A.
export function mailtoHref({ to = "", bcc = [], subject = "", body = "" }) {
  const enc = (s) => encodeURIComponent(s.replace(/\r?\n/g, "\r\n"));
  const parts = [];
  if (bcc.length) parts.push(`bcc=${bcc.map(encodeURIComponent).join(",")}`);
  if (subject) parts.push(`subject=${enc(subject)}`);
  if (body) parts.push(`body=${enc(body)}`);
  return `mailto:${encodeURIComponent(to)}${parts.length ? `?${parts.join("&")}` : ""}`;
}
// 이보다 긴 mailto 주소는 일부 메일 앱(예전 Outlook 등)에서 잘릴 수 있다(정확한 한도는 앱마다 다르다)
export const MAILTO_SAFE_LEN = 2000;
