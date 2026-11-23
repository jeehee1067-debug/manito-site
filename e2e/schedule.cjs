// 예약(자동 진행): 운영 화면에서 시각을 정해 두면 주차 열기·단서 공개가 그 시각에 실행되는지.
//  - 아직 안 된 시각은 실행되지 않는다
//  - 화면을 열어 둔 채 예약 시각이 되면 실행된다: 단서 공개 + 파트 순위 발표
//  - 지난 시각으로 저장하면(확인창) 곧바로 실행된다
//  - 앞 단계가 필요한 것은 기다렸다가 차례로 실행된다(3주차는 2주차 뒤, 단서 5·6번은 3주차 뒤)
//  - 참여자 화면은 아무것도 누르지 않아도 바뀐다
// 먼저 `npm run dev:emu`를 띄워 둘 것. 로컬 에뮬레이터 데이터를 지우고 시작한다.
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const H = require("./helpers.cjs");

const step = (t) => console.log("▶ " + t);
const local = (d) => { const p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const DAY = 24 * 60 * 60 * 1000;

(async () => {
  await H.reset();
  const b = await chromium.launch();
  const errs = [], dialogs = [];
  const mk = H.maker(b, errs, dialogs);
  const admin = await mk("운영자");
  const NAMES = ["가나", "다라", "마바"];
  const inv = await H.setupAdmin(admin, NAMES.map((n, i) => `${n},${"가나다"[i]}파트`));
  const u = {};
  for (const [i, name] of NAMES.entries()) {
    const p = await mk(name); u[name] = p;
    await H.signup(p, inv[name], `s${i}@example.com`);
    await p.locator(".target-name:visible").waitFor();
  }
  await admin.getByRole("button", { name: /다음 단계로: 미션 진행/ }).click();
  await admin.locator(".hud-chip", { hasText: "미션 진행 1주차" }).waitFor();

  const box = H.panel(admin, "예약 (자동 진행)");
  const input = (label) => box.getByLabel(`${label} 예약 시각`);
  const item = (label) => box.locator(".auto-item", { hasText: label });
  const cfg = () => H.readDoc("config/app");
  const W2 = "2주차 열기 (1주차 미션 마감)", W3 = "3주차 열기 (2주차 미션 마감)", CLOSE = "미션 마감 (3주차 마감 · 최종 지목 시작)";

  step("아직 안 된 시각으로 예약: 저장만 되고 실행되지 않는다");
  await box.waitFor();
  assert.equal(await box.locator(".auto-item").count(), 6, "예약할 수 있는 것은 여섯 가지(미션 마감 포함)");
  await input("단서 1·2번 공개").fill(local(new Date(Date.now() + DAY)));
  await box.getByRole("button", { name: "예약 저장" }).click();
  await box.getByText("예약을 저장했어요.").waitFor();
  await item("단서 1·2번 공개").getByText(/예약됨:/).waitFor();
  await admin.waitForTimeout(3000);
  assert.equal((await cfg()).cluesReleased || 0, 0, "시각 전에는 단서가 공개되지 않는다");
  assert.equal(dialogs.filter((d) => d.includes("이미 지난 시각")).length, 0);

  step("곧 다가오는 시각으로 바꿔 저장 → 화면을 열어 둔 채 기다리면 그 시각에 실행: 단서 2개 공개 + 파트 순위 발표");
  // 입력 칸은 분 단위라, 다음 분(5초 안쪽으로 남았으면 그다음 분)으로 맞춘다
  const soon = new Date(Math.ceil((Date.now() + 5000) / 60000) * 60000);
  await input("단서 1·2번 공개").fill(local(soon));
  await box.getByRole("button", { name: "예약 저장" }).click();
  await item("단서 1·2번 공개").getByText(/예약됨:/).waitFor();
  assert.equal((await cfg()).cluesReleased || 0, 0, "아직 시각 전");
  await admin.locator("h2", { hasText: "단서 공개 (2 / 6)" }).waitFor({ timeout: soon.getTime() - Date.now() + 40000 });
  assert.ok(Date.now() >= soon.getTime(), "예약 시각보다 먼저 실행되지 않는다");
  console.log(`  예약 ${local(soon)} → ${Math.round((Date.now() - soon.getTime()) / 1000)}초 뒤 실행됨(아무것도 누르지 않음)`);
  assert.equal(dialogs.filter((d) => d.includes("이미 지난 시각")).length, 0, "앞으로 올 시각은 묻지 않는다");
  await item("단서 1·2번 공개").getByText(/예약으로 실행했어요.*단서를 공개하고 파트 순위도 새로 발표했어요/).waitFor({ timeout: 20000 });
  assert.equal((await cfg()).cluesReleased, 2);
  assert.equal((await H.readDoc("public/board")).week, 1, "파트 순위도 같이 발표됨");
  assert.equal(await input("단서 1·2번 공개").isDisabled(), true, "끝난 것은 고칠 수 없다");
  console.log("  단서 1·2번: 예약 시각이 지나자 공개되고 파트 순위도 발표됨");

  step("참여자 화면: 아무것도 누르지 않아도 단서가 열려 있다");
  {
    const p = u["가나"];
    await H.tab(p, "추리 보드");
    await H.panel(p, "단서 2 / 6").waitFor({ timeout: 15000 });
  }

  step("여러 개를 한꺼번에(모두 지난 시각): 2주차 → 단서 3·4번 → 3주차 → 단서 5·6번 차례로");
  const t0 = Date.now() - DAY;
  await input(W2).fill(local(new Date(t0)));
  await input("단서 3·4번 공개").fill(local(new Date(t0 + 60000)));
  await input(W3).fill(local(new Date(t0 + 120000)));
  await input("단서 5·6번 공개").fill(local(new Date(t0 + 180000)));
  await box.getByRole("button", { name: "예약 저장" }).click();
  await admin.locator(".hud-chip", { hasText: "미션 진행 2주차" }).waitFor({ timeout: 40000 });
  assert.equal(dialogs.filter((d) => d.includes(`이미 지난 시각이에요: ${W2}, 단서 3·4번 공개, ${W3}, 단서 5·6번 공개`)).length, 1, "지난 시각이면 저장 전에 한 번 묻는다");
  await admin.locator("h2", { hasText: "단서 공개 (6 / 6)" }).waitFor({ timeout: 120000 });
  await admin.locator(".hud-chip", { hasText: "미션 진행 3주차" }).waitFor();
  const c = await cfg();
  assert.deepEqual([c.week, c.cluesReleased, c.phase], [3, 6, 1]);
  for (const label of ["2주차 열기", "단서 3·4번 공개", "3주차 열기", "단서 5·6번 공개"]) await item(label).getByText(/예약으로 실행했어요/).waitFor({ timeout: 20000 });
  await item("2주차 열기").getByText(/2주차를 열었어요/).waitFor();
  console.log("  2주차 → 단서 4개 → 3주차 → 단서 6개: 앞 단계가 끝난 뒤에 차례로 실행됨");

  step("참여자 화면: 새로 고침 없이 3주차가 열려 있다");
  {
    const p = u["다라"];
    await p.locator(".hud-chip", { hasText: "미션 진행 3주차" }).waitFor({ timeout: 15000 });
  }

  step("직접 눌러서 이미 된 것은 예약 칸이 닫혀 있다(새 운영 화면에서도)");
  await admin.reload();
  await box.waitFor();
  for (const label of ["단서 1·2번 공개", W2, "단서 3·4번 공개", W3, "단서 5·6번 공개"]) assert.equal(await input(label).isDisabled(), true, label);

  step("미션 마감도 예약할 수 있다: 지난 시각으로 저장 → 최종 지목 단계로 넘어가고 파트 순위도 마지막으로 발표");
  {
    await input(CLOSE).fill(local(new Date(Date.now() - 60000)));
    await box.getByRole("button", { name: "예약 저장" }).click();
    await admin.locator(".hud-chip", { hasText: "최종 지목" }).waitFor({ timeout: 40000 });
    assert.equal((await cfg()).phase, 2);
    assert.ok(dialogs.some((d) => d.includes(`이미 지난 시각이에요: ${CLOSE}`)), "지난 시각이면 묻는다");
    await u["가나"].locator(".hud-chip", { hasText: "최종 지목" }).waitFor({ timeout: 15000 });
    console.log("  미션 마감 예약 → 단계 2(최종 지목), 참여자 화면도 바뀜");
  }

  console.log("콘솔 오류·경고", errs.length, "건"); errs.slice(0, 5).forEach((e) => console.log("  ", e));
  await b.close();
  if (errs.length) process.exit(1);
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
