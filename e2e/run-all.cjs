// 화면 흐름 검증을 차례로 돌린다. 먼저 다른 터미널에서 `npm run dev:emu`를 띄워 둘 것.
// 각 스크립트는 로컬 에뮬레이터(demo-manito 프로젝트)의 데이터를 지우고 시작한다. 실제 Firebase 프로젝트에는 붙지 않는다.
// 필요한 것: Playwright와 Chromium (`npm i --no-save playwright && npx playwright install chromium`)
// restore.cjs는 Python 패키지도 필요하다: pip install google-cloud-firestore (다른 Python을 쓰려면 PYTHON=경로 npm run test:e2e)
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const SCRIPTS = [
  ["flow.cjs", "전체 흐름: 운영자 설정 → 가입 → 미션·인증·피드 → 단서 → 지목 → 마감 → 집계(응모권 손계산 대조) → 한 번에 추첨·6등부터 발표·검증"],
  ["fairness.cjs", "불공정 사례: 가입 안 한 사람·아무것도 안 하는 사람·중도 이탈"],
  ["guards.cjs", "운영 실수 방지, 예전 자료, 카드와 다름, 나중 카드 확인, 피드에서 가리기, 글쓴이의 후기·답장 고치기, 쪽지 신고"],
  ["roster.cjs", "명단: 넣기·한 명씩 고치기(이름·파트·아이디)·지우기가 새로 고친 뒤에도 그대로인지, 저장이 서버에 닿지 않을 때의 안내, 가입 안내 메일(받는 사람·본문·가입 링크)"],
  ["assign.cjs", "배정 저장: 배정이 끝나기 전에는 미션 시작이 막힘, 덜 저장된 배정을 운영 화면이 알려 주고 짝은 그대로 둔 채 고침"],
  ["account.cjs", "같은 기기 계정 전환, 비밀번호 찾기, 로그인 유지"],
  ["unlink.cjs", "계정 연결 해제와 다시 연결"],
  ["profile-lock.cjs", "공개된 단서 칸 잠금"],
  ["reassign.cjs", "다시 배정했을 때 단서"],
  ["fun.cjs", "이번 주 할 일, 알레르기 칸, 안 읽은 표시, 마니또에게 한마디, 주차별 추측, 피드 공감, 수호천사 자동 연결, 발표 화면의 짝 이야기·명탐정·3등(공감 1위)"],
  ["latejoin.cjs", "가입 유예와 회사 메일 인증: 가입 전 배정(엑셀 붙여 넣기 명단: 이름·파트·아이디), 미션 시작 뒤 메일 인증으로 가입한 사람의 인증·미션, 명단에 없는 아이디, 수호천사 지원은 미션 시작부터"],
  ["schedule.cjs", "예약(자동 진행): 정한 시각에 단서 공개·주차 열기가 실행되는지, 앞 단계 순서, 참여자 화면 반영"],
  ["awards.cjs", "현장 시상(24명): 2등·3등 순위, 4·5등 종이로 뽑힌 이름 입력, 1등이 겹칠 때 자리 다시 채우기와 다시 뽑기, 6등 사이트 추첨·검증, 뽑은 뒤 고치기 거부"],
  ["gold.cjs", "2주차 새 카드와 황금 카드: NEW 카드, 황금 카드 고르기·완료·인증, 주차가 끝난 뒤 추첨, 뽑힌 마니또만 자기 화면에서 확인"],
  ["restore.cjs", "백업 되살리기(tools/restore): 통째로 지운 뒤 되살리면 문서가 백업과 같음, 기본은 없어진 것만·덮어쓰기는 설정 제외, 되살린 뒤 사이트 동작"],
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
