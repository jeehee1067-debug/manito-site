// 같은 기기 계정 전환, 비밀번호 찾기, 로그인 유지 선택을 실제 화면으로 확인한다 (npm run dev:emu 대상).
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
require("node:fs").mkdirSync(__dirname + "/shots", { recursive: true });

// 대상 이름은 기본으로 가려져 있다(내 미션 화면). "이름 보기"를 눌러 읽는다.
const readTarget = async (p) => { const b = p.locator(".target-toggle"); await b.waitFor(); if ((await b.getAttribute("aria-pressed")) !== "true") await b.click(); return (await p.locator(".target-name").innerText()).trim(); };
// 운영 화면의 초대 코드·메일은 기본으로 가려져 있다.
const showSecrets = async (p) => { for (const b of await p.getByRole("button", { name: "초대 코드·메일 보기" }).all()) await b.click(); };
const BASE = "http://localhost:5173/", P = "demo-manito", AUTH = "http://127.0.0.1:9099";
const PW = "secret123";
const MAIL = { 운영자: "admin1@example.com", 가나: "user1@example.com", 다라: "user2@example.com" };
const errors = [];
const step = (s) => console.log("▶", s);

function watchPage(page, label) {
  page.on("dialog", (d) => d.accept());
  page.on("console", (m) => {
    if ((m.type() === "error" || m.type() === "warning") && !m.text().includes("TUNNEL")) errors.push(`[${label}] ${m.text().slice(0, 160)}`);
  });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror ${e.message}`));
}
const mailBox = (page) => page.getByPlaceholder("Knox ID");
async function logout(page) {
  await page.locator(".hud-out").click();
  await mailBox(page).waitFor();
}
async function login(page, who, pw = PW, keep = true) {
  await mailBox(page).fill(MAIL[who]);
  await page.locator('input[type="password"]').fill(pw);
  const box = page.getByRole("checkbox", { name: /로그인 유지/ });
  if ((await box.isChecked()) !== keep) await box.setChecked(keep);
  await page.getByRole("button", { name: "로그인", exact: true }).last().click();
}
async function expectSession(page, who) {
  await page.locator(".hud-out").waitFor();
  await page.locator(".hud-who", { hasText: who === "운영자" ? "운영자" : `${who}님` }).waitFor({ timeout: 8000 });
  if (who === "운영자") await page.locator("h2.panel-title", { hasText: "운영 단계" }).waitFor();
  else await page.locator(".target-name").waitFor();
}

(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${P}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${AUTH}/emulator/v1/projects/${P}/accounts`, { method: "DELETE" });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watchPage(page, "공용 기기");

  step("운영자 설정(메일) → 명단 3명 → 배정");
  await page.goto(BASE + "?setup");
  await page.getByRole("button", { name: "운영자·공동 운영자 계정 만들기" }).click();
  await mailBox(page).fill(MAIL.운영자);
  await page.locator('input[type="password"]').fill(PW);
  await page.getByRole("button", { name: "운영자 계정 만들기" }).click();
  await page.locator("section.panel", { has: page.locator("h2", { hasText: "1. 명단" }) }).locator("textarea").fill("가나,가파트\n다라,가파트\n마바,나파트");
  await page.getByRole("button", { name: "명단에 추가" }).click(); await page.getByText("3명을 추가했어요.").waitFor();
  await page.getByRole("button", { name: "배정하기" }).click(); await page.getByText(/3명 배정 완료/).waitFor();
  const inv = {};
  await showSecrets(page);
  const invCol = (await page.locator(".pk-table thead th").allInnerTexts()).indexOf("초대 코드");
  for (const r of await page.locator(".pk-table tbody tr").all()) { const c = await r.locator("td").allInnerTexts(); inv[c[0]] = c[invCol]; }
  await expectSession(page, "운영자");

  step("같은 브라우저에서 가나·다라 차례로 가입");
  for (const who of ["가나", "다라"]) {
    await logout(page);
    assert.equal(await page.evaluate(() => location.hash), "", "로그아웃하면 탭 주소가 지워진다");
    await page.getByRole("tab", { name: "처음 가입" }).click();
    await page.getByPlaceholder("운영진에게 받은 6자리").fill(inv[who]);
    await mailBox(page).fill(MAIL[who]);
    await page.locator('input[type="password"]').fill(PW);
    await page.getByRole("button", { name: "가입하기" }).click();
    for (let t = 0; t < 6; t++) {
      await page.waitForTimeout(700);
      console.log(`  [${who} +${((t + 1) * 0.7).toFixed(1)}s]`, (await page.locator("body").innerText()).replace(/\n+/g, " | ").replace(/^.*?HAPPY NEW YEAR \| /, "").slice(0, 150));
    }
    await expectSession(page, who);
    await page.locator("nav.tabs button", { hasText: "내 프로필" }).click();
    await page.getByText(`로그인한 메일: ${MAIL[who]}`).waitFor();
    console.log(`  ${who}: 헤더 "${await page.locator(".hud-out").innerText()}", 프로필에 ${MAIL[who]} 표시`);
  }
  await page.screenshot({ path: __dirname + "/shots/acct-profile.png" });

  step("같은 브라우저에서 계정 전환 12회");
  const order = ["가나", "운영자", "다라", "가나", "다라", "운영자", "가나", "다라", "가나", "운영자", "다라", "가나"];
  const before = errors.length;
  for (const who of order) {
    await logout(page);
    await login(page, who);
    await expectSession(page, who);
    // 다른 사람 이름이 프로필 제목에 남지 않았는지
    if (who !== "운영자") {
      await page.locator("nav.tabs button", { hasText: "내 프로필" }).click();
      await page.locator("h2.panel-title", { hasText: `${who}님의 프로필` }).waitFor();
    }
  }
  console.log(`  전환 ${order.length}회 모두 본인 화면, 이 구간 콘솔 오류·경고 ${errors.length - before}건`);
  await logout(page);
  await page.screenshot({ path: __dirname + "/shots/acct-login.png" });

  step("틀린 비밀번호 → 비밀번호 찾기 → 재설정 → 새 비밀번호로 로그인");
  await login(page, "가나", "wrongpass1");
  console.log("  틀린 비밀번호 안내:", await page.locator(".error").innerText());
  await page.getByRole("button", { name: "비밀번호를 잊었어요" }).click();
  await mailBox(page).fill("nobody@example.com");
  await page.getByRole("button", { name: "재설정 메일 보내기" }).click();
  await page.locator(".error, .note[role=status]").first().waitFor();
  console.log("  없는 메일:", await page.locator(".error, .note[role=status]").first().innerText());
  await mailBox(page).fill(MAIL.가나);
  await page.getByRole("button", { name: "재설정 메일 보내기" }).click();
  await page.locator(".note[role=status]").waitFor();
  console.log("  가입된 메일:", await page.locator(".note[role=status]").innerText());
  await page.screenshot({ path: __dirname + "/shots/acct-reset.png" });
  const oob = await (await fetch(`${AUTH}/emulator/v1/projects/${P}/oobCodes`)).json();
  const code = oob.oobCodes.filter((c) => c.requestType === "PASSWORD_RESET" && c.email === MAIL.가나).pop();
  assert.ok(code, "재설정 코드가 발급됨");
  console.log("  에뮬레이터가 만든 재설정 링크:", code.oobLink.replace(/oobCode=[^&]+/, "oobCode=…"));
  const r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=demo-key`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ oobCode: code.oobCode, newPassword: "newpass456" }),
  });
  assert.equal(r.status, 200, "재설정 링크로 새 비밀번호 저장");
  await page.getByRole("button", { name: "로그인으로 돌아가기" }).click();
  await login(page, "가나", PW);
  await page.locator(".error").waitFor();
  console.log("  옛 비밀번호:", await page.locator(".error").innerText().then((t) => t.slice(0, 30)) + "…");
  await login(page, "가나", "newpass456");
  await expectSession(page, "가나");
  console.log("  새 비밀번호로 로그인 성공");

  step("로그인 유지 해제 → 새 탭에서는 로그아웃 상태, 같은 탭 새로고침은 유지");
  {
    const c2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const a = await c2.newPage(); watchPage(a, "유지 해제");
    await a.goto(BASE);
    // 처음 쓰는 기기에서는 "로그인 유지"가 꺼져 있다(공용 PC·자리 비움 대비)
    await mailBox(a).waitFor();
    assert.equal(await a.getByRole("checkbox", { name: /로그인 유지/ }).isChecked(), false, "로그인 유지 기본값이 꺼짐이 아님");
    console.log("  처음 쓰는 기기: '로그인 유지' 기본 꺼짐");
    await login(a, "다라", PW, false);
    await expectSession(a, "다라");
    await a.reload();
    await expectSession(a, "다라");
    const b = await c2.newPage(); watchPage(b, "유지 해제 새 탭");
    await b.goto(BASE);
    await mailBox(b).waitFor({ timeout: 8000 });
    console.log("  유지 해제: 새로고침 → 로그인 유지됨 / 새 탭 → 로그인 화면");
    await c2.close();
  }
  {
    const c3 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const a = await c3.newPage(); watchPage(a, "유지");
    await a.goto(BASE);
    await login(a, "다라", PW, true);
    await expectSession(a, "다라");
    const b = await c3.newPage(); watchPage(b, "유지 새 탭");
    await b.goto(BASE);
    await expectSession(b, "다라");
    console.log("  유지(체크): 새 탭에서도 로그인 상태");
    await c3.close();
  }

  await browser.close();
  console.log(`\n전체 콘솔 오류·경고 ${errors.length}건`);
  errors.slice(0, 10).forEach((e) => console.log("  ", e));
  console.log("완료");
})().catch((e) => {
  console.error("실패:", e.message.split("\n")[0]);
  console.log(`콘솔 오류·경고 ${errors.length}건`);
  errors.slice(0, 10).forEach((er) => console.log("  ", er));
  process.exit(1);
});
