// 가입 유예와 회사 메일 인증: 가입하지 않은 사람도 명단에 있으면 배정되고, 미션이 시작된 뒤에 가입해도 바로 참여할 수 있는지 확인한다.
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
  const inv = await H.setupAdmin(admin, PEOPLE.map(([n, part], i) => `${n}\t${part}\tlate${i}`));
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
  assert.ok(warn && warn.includes("미션이 시작된 뒤에도 가입해 바로 참여할 수 있어요"), warn);
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
    // 사아는 초대 코드 없이 Knox ID(late3)로 가입한다: 인증 메일의 링크를 눌러야 명단의 이름과 연결된다
    const p = await mk(LATE); u[LATE] = p;
    await p.goto(H.BASE);
    await p.getByRole("tab", { name: "처음 가입" }).click();
    await p.getByPlaceholder("Knox ID").fill("Late3"); // 대문자로 적어도 소문자 주소가 된다
    await p.getByText("late3@samsung.com로 인증 메일이 가요.").waitFor();
    await p.locator('input[type="password"]').fill("secret123");
    await p.getByRole("button", { name: "가입하기" }).click();
    const verify = H.panel(p, "회사 메일 인증");
    await verify.getByText("late3@samsung.com").waitFor();
    assert.equal(await p.locator("nav.tabs").count(), 0, "인증 전에는 메뉴가 없다(아무것도 읽을 수 없다)");
    await verify.getByRole("button", { name: "인증했어요 · 연결하기" }).click();
    await verify.getByText("아직 메일 인증 전이에요").waitFor(); // 링크를 누르기 전에는 연결되지 않는다
    await verify.getByRole("button", { name: "인증 메일 다시 보내기" }).click();
    await verify.getByText(/인증 메일을 다시 보냈어요|조금 전에 보냈어요/).waitFor();
    await H.verifyMail("late3@samsung.com"); // 메일의 링크 누르기(에뮬레이터)
    await verify.getByRole("button", { name: "인증했어요 · 연결하기" }).click();
    await p.locator(".target-name").waitFor();
    await p.locator(".hud-who", { hasText: "사아님" }).waitFor();
    console.log("  사아: 아이디 late3로 가입 → 인증 전에는 연결 안 됨 → 메일의 링크를 누른 뒤 '인증했어요 · 연결하기' → 명단의 사아로 자동 연결(초대 코드 없이)");
    {
      // 명단에 없는 아이디로 가입한 사람은 메일을 인증해도 연결되지 않는다
      const x = await mk("외부인");
      await x.goto(H.BASE);
      await x.getByRole("tab", { name: "처음 가입" }).click();
      await x.getByPlaceholder("Knox ID").fill("stranger");
      await x.locator('input[type="password"]').fill("secret123");
      await x.getByRole("button", { name: "가입하기" }).click();
      await H.panel(x, "회사 메일 인증").getByText("stranger@samsung.com").waitFor();
      await H.verifyMail("stranger@samsung.com");
      await H.panel(x, "회사 메일 인증").getByRole("button", { name: "인증했어요 · 연결하기" }).click();
      await H.panel(x, "회사 메일 인증").getByText("명단에 없는 메일이에요(stranger@samsung.com)").waitFor();
      assert.equal(await x.locator("nav.tabs").count(), 0);
      console.log("  명단에 없는 아이디(stranger)는 메일을 인증해도 '명단에 없는 메일이에요'");
    }
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

  step("미션 마감 뒤(최종 지목 단계)에도 받은 미션은 인증할 수 있다: 마감 직전에 온 미션을 인증할 시간");
  {
    await H.tab(admin, "운영");
    await admin.getByRole("button", { name: "다음 단계로: 최종 지목" }).click();
    await admin.locator(".hud-chip", { hasText: "최종 지목" }).waitFor();
    assert.ok(dialogs.some((d) => d.includes("받은 미션 인증은 최종 지목이 마감될 때까지 할 수 있어요")), "미션 마감 확인창에 인증 유예 안내");
    const t = u[target[LATE]]; // 사아의 대상: 사아가 보낸 1주차 미션을 아직 인증하지 않았다
    await t.reload();
    await H.tab(t, "추리 보드");
    await H.panel(t, "인증하기").getByText("미션은 마감됐어요. 받은 미션은 최종 지목이 마감되기 전까지 인증할 수 있어요.").waitFor();
    const inbox = H.panel(t, "마니또에게서 온 것");
    const entry = H.panel(t, "인증하기");
    await entry.getByPlaceholder("K7Q2").fill(await inbox.locator("strong.mono").first().innerText());
    await entry.locator("textarea").fill("마감 뒤에 인증해요. 늦게 시작했는데도 챙겨 줘서 고마워요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await t.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    // 미션(완료 알리기)은 마감됐다: 마니또 화면에 완료 알리기 버튼이 없다
    const g = u[EARLY.find((n) => n !== lateGiver && n !== target[LATE]) || EARLY[0]];
    await g.reload();
    await g.locator(".target-name").waitFor();
    assert.equal(await g.getByRole("button", { name: "미션 완료 알리기" }).count(), 0, "미션 마감 뒤에는 완료를 알릴 수 없다");
    console.log(`  최종 지목 단계: ${target[LATE]}이(가) 사아의 미션을 인증함(유예), 완료 알리기는 닫힘`);
    // 지목까지 마감되면 인증도 닫힌다
    await admin.getByRole("button", { name: "다음 단계로: 마감" }).click();
    await admin.locator(".hud-chip", { hasText: "마감" }).waitFor();
    await t.reload();
    await H.tab(t, "추리 보드");
    await H.panel(t, "인증하기").getByText("인증은 미션 진행 기간과 최종 지목 기간에 할 수 있어요.").waitFor();
    assert.ok(await H.panel(t, "인증하기").getByRole("button", { name: "인증하기" }).isDisabled());
  }

  await browser.close();
  console.log("\n콘솔 오류·경고", errors.length, "건"); errors.slice(0, 8).forEach((e) => console.log("  ", e));
  if (errors.length) process.exit(1);
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
