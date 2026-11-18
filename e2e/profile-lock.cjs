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
  const NAMES = ["가나", "다라", "마바"];
  const admin = await mk("운영자");
  const inv = await H.setupAdmin(admin, NAMES.map((n) => `${n},가파트`));
  const u = {}, target = {}, ans = {};
  for (const [i, name] of NAMES.entries()) {
    const p = await mk(name); u[name] = p;
    await H.signup(p, inv[name], `l${i}@example.com`);
    await p.locator(".target-name:visible").waitFor();
    target[name] = await readTarget(p);
    ans[name] = H.answersFor(PQ, i, name);
    if (name !== "마바") await H.fillProfile(p, ans[name], PQ); // 마바는 나중에 쓴다
  }
  const clueTexts = async (p, n) => { await p.goto(H.BASE + "#detective"); await p.reload(); const c = H.panel(p, `단서 ${n} / 6`); await c.waitFor(); await p.waitForTimeout(1500); return c.locator(".clue-a").allInnerTexts(); };
  await admin.getByRole("button", { name: /다음 단계로: 미션 진행/ }).click();
  await admin.getByRole("button", { name: "이번 주 단서 2개 공개" }).click();
  await admin.locator("h2", { hasText: "단서 공개 (2 / 6)" }).waitFor();

  const g = u["가나"];
  await g.reload(); await H.tab(g, "내 프로필");
  const qs = g.locator(".profile-q"); await qs.first().waitFor();
  const lockedOf = async (q) => (PQ[q].options ? qs.nth(q).getByRole("radio").first().isDisabled() : qs.nth(q).locator("input").isDisabled());
  const locked = []; for (let q = 0; q < 6; q++) locked.push(await lockedOf(q));
  console.log("가나 잠김 여부(1~6번):", locked.map((d) => (d ? "잠김" : "가능")).join(", "));
  assert.deepEqual(locked, [true, true, false, false, false, false]);
  const new3 = PQ[2].options.find((o) => o !== ans["가나"][2]);
  await H.fillProfile(g, [null, null, new3, null, null, null], PQ);
  let seen = await clueTexts(u[target["가나"]], 2);
  assert.deepEqual(seen.slice(0, 3), [ans["가나"][0], ans["가나"][1], "잠김"]);
  console.log(`가나의 대상(${target["가나"]}) 단서 1·2번 그대로:`, seen.slice(0, 2).join(" / "));
  // 단서는 주차마다 2개까지만: 1주차에 한 번 더 누를 수 없고, 주차를 올려야 다음 단서를 공개할 수 있다
  const relBtn = admin.getByRole("button", { name: "이번 주 단서 2개 공개" });
  assert.equal(await relBtn.isDisabled(), true, "같은 주차에 두 번 공개할 수 없다");
  await H.panel(admin, "단서 공개").getByText("1주차 단서는 이미 공개했어요. 다음 단서는 주차를 올린 뒤에 공개할 수 있어요").waitFor();
  console.log("1주차에 단서를 한 번 더 공개하려 하면: 버튼이 꺼져 있고 '1주차 단서는 이미 공개했어요' 안내");
  await H.panel(admin, "주차").getByRole("button", { name: "2주차" }).click();
  await admin.locator(".hud-chip", { hasText: "2주차" }).waitFor();
  await relBtn.click();
  await admin.locator("h2", { hasText: "단서 공개 (4 / 6)" }).waitFor();
  assert.equal(await relBtn.isDisabled(), true, "2주차에도 2개까지만");
  seen = await clueTexts(u[target["가나"]], 4);
  assert.equal(seen[2], new3);
  console.log("다음 공개 때 고친 3번이 보임:", seen[2], `(원래 ${ans["가나"][2]})`);
  // 탭은 숨겨 둔 채 남는다: 대상이 추리 보드를 열어 둔 채(새로 고침 없이) 다른 탭에 갔다 오면, 공개 뒤 늦게 채운 단서가 보인다
  const rm = u[target["마바"]];
  await rm.goto(H.BASE + "#detective"); await rm.reload();
  const c4 = H.panel(rm, "단서 4 / 6"); await c4.waitFor(); await rm.waitForTimeout(1500);
  assert.equal(await c4.getByText("아직 마니또가 프로필을 안 채웠어요").count(), 4, "마바가 아직 프로필을 안 채움");
  const m = u["마바"];
  await m.reload(); await H.fillProfile(m, ans["마바"], PQ);
  let shownLate = false;
  for (let k = 0; k < 6 && !shownLate; k++) {
    await H.tab(rm, "규칙"); await H.tab(rm, "추리 보드"); await rm.waitForTimeout(800);
    shownLate = (await c4.locator(".clue-a", { hasText: ans["마바"][3] }).count()) > 0;
  }
  assert.ok(shownLate, "새로 고침 없이 탭을 다시 열면 늦게 채운 단서가 보인다");
  console.log("새로 고침 없이 추리 보드를 다시 열면 늦게 채운 단서가 보임");
  seen = await clueTexts(u[target["마바"]], 4);
  assert.deepEqual(seen.slice(0, 4), ans["마바"].slice(0, 4));
  console.log(`늦게 쓴 마바의 단서 1~4번이 대상(${target["마바"]})에게 보임`);
  console.log("콘솔 오류·경고", errs.length, "건"); errs.slice(0, 5).forEach((e) => console.log("  ", e));
  await b.close();
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 4).join("\n")); process.exit(1); });
