const { chromium } = require("playwright");
const assert = require("node:assert/strict");

// 대상 이름은 기본으로 가려져 있다(내 미션 화면). "이름 보기"를 눌러 읽는다.
const readTarget = async (p) => { const b = p.locator(".target-toggle:visible"); await b.waitFor(); if ((await b.getAttribute("aria-pressed")) !== "true") await b.click(); return (await p.locator(".target-name:visible").innerText()).trim(); };
// 운영 화면의 초대 코드·메일은 기본으로 가려져 있다.
const showSecrets = async (p) => { for (const b of await p.getByRole("button", { name: "초대 코드·메일 보기" }).all()) await b.click(); };
const H = require("./helpers.cjs");
(async () => {
  const { PROFILE_QUESTIONS: PQ } = await import(require("node:url").pathToFileURL(require("node:path").join(__dirname, "../src/lib/constants.js")).href);
  await H.reset();
  const b = await chromium.launch(); const errs = []; const mk = H.maker(b, errs);
  const PEOPLE = [["가나", "가파트"], ["다라", "나파트"], ["마바", "다파트"], ["사아", "라파트"]]; // 파트를 모두 다르게: 파트 단서로 마니또가 누구인지 확인
  const partOf = Object.fromEntries(PEOPLE);
  const admin = await mk("운영자");
  const inv = await H.setupAdmin(admin, PEOPLE.map(([n, part]) => `${n},${part}`));
  const u = {}, ans = {};
  for (const [i, [name]] of PEOPLE.entries()) {
    const p = await mk(name); u[name] = p;
    await H.signup(p, inv[name], `r${i}@example.com`);
    await p.locator(".target-name:visible").waitFor();
    ans[name] = H.answersFor(PQ, i, name); // 1번 답(음료)이 사람마다 다름
    await H.fillProfile(p, ans[name], PQ);
  }
  const targetsOf = async () => { const t = {}; for (const [name] of PEOPLE) { const p = u[name]; await p.goto(H.BASE + "#mission"); await p.reload(); await p.locator(".target-name:visible").waitFor(); t[name] = await readTarget(p); } return t; };
  const before = await targetsOf();
  let after;
  for (let k = 0; k < 8; k++) {
    await admin.getByRole("button", { name: "배정하기" }).click(); await admin.getByText(/4명 배정 완료/).waitFor(); await admin.waitForTimeout(300);
    after = await targetsOf();
    if (Object.keys(after).some((g) => after[g] !== before[g])) break;
  }
  console.log("1차:", JSON.stringify(before), "\n재배정:", JSON.stringify(after));
  for (const [name] of PEOPLE) { await u[name].waitForTimeout(600); }
  await admin.getByRole("button", { name: /다음 단계로: 미션 진행/ }).click();
  await admin.getByRole("button", { name: "이번 주 단서 2개 공개" }).click();
  await admin.locator("h2", { hasText: "단서 공개 (2 / 6)" }).waitFor();
  await admin.getByRole("button", { name: /다음 단계로: 최종 지목/ }).click();
  await admin.locator(".hud-chip", { hasText: "최종 지목" }).waitFor();
  const giverOf = Object.fromEntries(Object.entries(after).map(([g, r]) => [r, g]));
  let wrong = 0;
  for (const [name] of PEOPLE) {
    const p = u[name];
    await p.goto(H.BASE + "#detective"); await p.reload();
    const c = H.panel(p, "단서 2 / 6"); await c.waitFor(); await p.waitForTimeout(1500);
    const texts = await c.locator(".clue-a").allInnerTexts();
    const ok = texts[0] === ans[giverOf[name]][0] && texts[6] === partOf[giverOf[name]];
    if (!ok) wrong++;
    console.log(`${name}: 지금 마니또=${giverOf[name]}, 단서1="${texts[0]}", 파트 단서="${texts[6]}" ${ok ? "맞음" : "틀림"}`);
  }
  assert.equal(wrong, 0);
  console.log("재배정 후 단서·파트 단서가 틀린 사람 0 / 4, 콘솔 오류·경고", errs.length, "건"); errs.slice(0, 5).forEach((e) => console.log("  ", e));
  await b.close();
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 4).join("\n")); process.exit(1); });
