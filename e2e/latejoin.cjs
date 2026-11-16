// 가입 유예: 가입하지 않은 사람도 명단에 있으면 배정되고, 미션이 시작된 뒤에 가입해도 바로 참여할 수 있는지 확인한다.
//  - 명단은 엑셀에서 붙여 넣은 모양(탭으로 구분)으로 넣는다
//  - 아무도 가입하기 전에 배정 → 3명만 가입 → 미션 시작(가입 안 한 사람 안내) → 가입 안 한 사람의 마니또가 미션
//  - 늦게 가입한 사람: 내 대상이 보이고, 가입 전에 온 미션을 인증하고, 자기 미션도 한다
//  - 수호천사 지원은 미션이 시작된 뒤에만(먼저 가입한 사람이 가입 기간에 앞서 지원하지 못하게)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const H = require("./helpers.cjs");

(async () => {
  await H.reset();
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const mk = H.maker(browser, errors, dialogs);
  const step = (s) => console.log("▶", s);
  const PEOPLE = [["가나", "가파트"], ["다라", "나파트"], ["마바", "다파트"], ["사아", "라파트"]];
  const EARLY = ["가나", "다라", "마바"], LATE = "사아";
  const ANGEL_PANEL = "수호천사 지원 (응모권을 더 받고 싶다면)";

  step("명단(엑셀에서 붙여 넣은 탭 구분) 4명 → 아무도 가입하기 전에 배정");
  const admin = await mk("운영자");
  const inv = await H.setupAdmin(admin, PEOPLE.map(([n, part]) => `${n}\tSR3\t${part}`));
  assert.deepEqual(Object.keys(inv).sort(), PEOPLE.map(([n]) => n).sort(), "탭으로 구분한 줄도 이름·근무지·파트로 읽는다");
  console.log("  4명 배정 완료(가입한 사람 0명). 초대 코드 4개 발급");

  step("3명만 가입(준비 단계): 수호천사 지원은 아직 열리지 않는다");
  const u = {}, target = {};
  for (const [i, name] of EARLY.entries()) {
    const p = await mk(name); u[name] = p;
    await H.signup(p, inv[name], `late${i}@example.com`);
    await p.locator(".target-name").waitFor();
    target[name] = await H.readTarget(p);
  }
  {
    const p = u["가나"];
    const ap = H.panel(p, ANGEL_PANEL);
    await ap.getByText("미션이 시작되면 여기에서 수호천사로 지원할 수 있어요").waitFor();
    assert.equal(await ap.getByRole("button", { name: "수호천사 지원하기" }).count(), 0, "준비 단계에는 지원 버튼이 없다");
  }
  const lateGiver = EARLY.find((n) => target[n] === LATE); // 사아의 마니또
  assert.ok(lateGiver, "가입 안 한 사아도 누군가의 대상으로 배정돼 있다");
  console.log(`  배정(가입한 3명 기준): ${EARLY.map((n) => `${n}→${target[n]}`).join(", ")} / 사아의 마니또는 ${lateGiver}`);

  step("미션 시작: 가입 안 한 사람이 있어도 시작할 수 있고, 나중에 가입할 수 있다고 안내한다");
  await H.tab(admin, "운영");
  await admin.getByRole("button", { name: "다음 단계로: 미션 진행" }).click();
  await admin.locator(".hud-chip", { hasText: "미션 진행" }).waitFor();
  const warn = dialogs.find((d) => d.includes("아직 가입 안 한 사람 1명: 사아"));
  assert.ok(warn && warn.includes("미션이 시작된 뒤에도 초대 코드로 가입해 바로 참여할 수 있어요"), warn);
  for (const name of EARLY) { await u[name].reload(); await u[name].locator(".target-name").waitFor(); }
  await H.panel(u["가나"], ANGEL_PANEL).getByRole("button", { name: "수호천사 지원하기" }).waitFor();
  console.log("  미션 시작 뒤에는 수호천사 지원 버튼이 열린다");

  step(`${lateGiver}이(가) 아직 가입 안 한 사아에게 1주차 미션을 하고 완료를 알린다`);
  {
    const p = u[lateGiver], slot = H.panel(p, "1주차 미션");
    await slot.locator(".card.level-easy").click();
    await slot.locator(".chosen").waitFor();
    await slot.locator("textarea").fill("가입하면 보세요! 책상 위에 간식을 두었어요.");
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(p, "1주차 미션 ✔").waitFor();
  }

  step("사아가 미션 시작 뒤에 가입: 내 대상이 보이고, 가입 전에 온 미션을 인증하고, 자기 미션도 한다");
  {
    const p = await mk(LATE); u[LATE] = p;
    await H.signup(p, inv[LATE], "late9@example.com");
    await p.locator(".target-name").waitFor();
    target[LATE] = await H.readTarget(p);
    assert.ok(EARLY.includes(target[LATE]), `사아의 대상: ${target[LATE]}`);
    assert.equal(new Set(Object.values(target)).size, 4, "네 사람이 서로 다른 한 사람씩 맡는다(가입 순서와 상관없이 처음 배정 그대로)");
    // 가입 전에 온 완료 알림이 받은 것에 보이고, 인증된다
    await H.tab(p, "추리 보드");
    const inbox = H.panel(p, "마니또에게서 온 것");
    await inbox.getByText("가입하면 보세요! 책상 위에 간식을 두었어요.").waitFor();
    const entry = H.panel(p, "인증하기");
    await entry.getByPlaceholder("K7Q2").fill(await inbox.locator("strong.mono").first().innerText());
    await entry.locator("textarea").fill("늦게 가입했는데도 간식이 기다리고 있었어요. 고마워요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await p.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    // 자기 1주차 미션
    await H.tab(p, "내 미션");
    const slot = H.panel(p, "1주차 미션");
    await slot.locator(".card.level-easy").click();
    await slot.locator(".chosen").waitFor();
    await slot.locator("textarea").fill("늦었지만 저도 시작해요!");
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(p, "1주차 미션 ✔").waitFor();
    await H.panel(p, ANGEL_PANEL).getByRole("button", { name: "수호천사 지원하기" }).waitFor();
    // 사아의 대상에게 완료 알림이 간다
    const t = u[target[LATE]];
    await H.tab(t, "피드"); await H.tab(t, "추리 보드");
    await H.panel(t, "마니또에게서 온 것").getByText("늦었지만 저도 시작해요!").waitFor();
    console.log(`  사아 가입 → 대상 ${target[LATE]} 표시, ${lateGiver}이(가) 가입 전에 보낸 미션 인증, 자기 1주차 미션 완료 → ${target[LATE]}에게 전달`);
  }
  // 마니또 화면에도 인증이 반영된다
  await H.panel(u[lateGiver], "1주차 미션 ✔").getByText(/인증했어요\.$/).waitFor(); // 대상 이름은 가려져 있을 수 있다("내 대상이 인증했어요.")

  await browser.close();
  console.log("\n콘솔 오류·경고", errors.length, "건"); errors.slice(0, 8).forEach((e) => console.log("  ", e));
  if (errors.length) process.exit(1);
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
