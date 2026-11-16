// 화면 흐름 검증을 차례로 돌린다. 먼저 다른 터미널에서 `npm run dev:emu`를 띄워 둘 것.
// 각 스크립트는 로컬 에뮬레이터(demo-manito 프로젝트)의 데이터를 지우고 시작한다. 실제 Firebase 프로젝트에는 붙지 않는다.
// 필요한 것: Playwright와 Chromium (`npm i --no-save playwright && npx playwright install chromium`)
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SCRIPTS = [
  ["flow.cjs", "전체 흐름: 운영자 설정 → 가입 → 미션·인증·피드 → 단서 → 지목 → 마감 → 집계(응모권 손계산 대조) → 한 번에 추첨·6등부터 발표·검증"],
  ["fairness.cjs", "불공정 사례: 가입 안 한 사람·아무것도 안 하는 사람·중도 이탈"],
  ["guards.cjs", "운영 실수 방지, 예전 자료, 카드와 다름, 나중 카드 확인, 피드에서 가리기, 쪽지 신고"],
  ["account.cjs", "같은 기기 계정 전환, 비밀번호 찾기, 로그인 유지"],
  ["unlink.cjs", "계정 연결 해제와 다시 연결"],
  ["profile-lock.cjs", "공개된 단서 칸 잠금"],
  ["reassign.cjs", "다시 배정했을 때 단서"],
  ["fun.cjs", "이번 주 할 일, 알레르기 칸, 안 읽은 표시, 마니또에게 한마디, 주차별 추측, 피드 공감, 수호천사 자동 연결, 발표 화면의 짝 이야기·명탐정·3등(공감 1위)"],
  ["latejoin.cjs", "가입 유예: 가입 전 배정(엑셀 붙여 넣기 명단), 미션 시작 뒤 가입한 사람의 인증·미션, 수호천사 지원은 미션 시작부터"],
];

async function main() {
  const only = process.argv.slice(2);
  try {
    await fetch("http://localhost:5173/");
  } catch {
    console.error("개발 서버(http://localhost:5173)가 없어요. 다른 터미널에서 `npm run dev:emu`를 먼저 띄워 주세요.");
    process.exit(1);
  }
  const failed = [];
  for (const [file, desc] of SCRIPTS) {
    if (only.length && !only.some((o) => file.startsWith(o))) continue;
    console.log(`\n=== ${file} — ${desc}`);
    const r = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: "inherit" });
    if (r.status !== 0) failed.push(file);
  }
  console.log(failed.length ? `\n실패: ${failed.join(", ")}` : "\n모두 통과");
  process.exit(failed.length ? 1 : 0);
}
main();
