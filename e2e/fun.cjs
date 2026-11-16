// 참여 재미 기능을 실제 화면으로 확인한다 (npm run dev:emu 대상, 4명·2개 파트)
//  이번 주 할 일, 내 마니또에게 알려 줄 것(알레르기), 안 읽은 표시(탭 숫자·탭 제목), 마니또에게 한마디,
//  주차별 추측 → 송년회 "가장 먼저 알아챈 사람", 피드 공감 → "가장 많은 공감을 받은 후기", 발표 화면의 짝 이야기
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const H = require("./helpers.cjs");
const step = (s) => console.log("▶", s);

(async () => {
  await H.reset();
  const { PROFILE_QUESTIONS: PQ } = await import(require("node:url").pathToFileURL(require("node:path").join(__dirname, "../src/lib/constants.js")).href);
  const b = await chromium.launch(); const errs = []; const mk = H.maker(b, errs);
  const admin = await mk("운영자", { width: 1100, height: 900 });
  const NAMES = ["가나", "다라", "마바", "사아"];
  const inv = await H.setupAdmin(admin, ["가나,SR3,가파트", "다라,SR3,나파트", "마바,SR3,가파트", "사아,SR3,나파트"], "fadmin@example.com");
  const advance = async (to) => { await admin.getByRole("button", { name: `다음 단계로: ${to}` }).click(); await admin.locator(".hud-chip", { hasText: to }).waitFor(); };
  // 이번 주 할 일 목록의 항목만(아래 '다음 일정' 줄은 빼고)
  const todoOf = async (p) => {
    await H.tab(p, "내 프로필"); await H.tab(p, "내 미션");
    const t = H.panel(p, "이번 주 할 일"); await t.waitFor(); await p.waitForTimeout(300);
    return (await t.locator(".todo-list li").allInnerTexts()).join(" | ");
  };

  step("가입·프로필(6번 TMI 문항은 직접 쓰기)");
  const u = {}, target = {};
  for (const [i, name] of NAMES.entries()) {
    const p = await mk(name); u[name] = p;
    await H.signup(p, inv[name], `f${i}@example.com`);
    await p.locator(".target-name").waitFor();
    target[name] = await H.readTarget(p);
    await H.tab(p, "내 프로필");
    if (i === 0) {
      const tmi = p.locator(".profile-q").nth(4);
      assert.match(await tmi.innerText(), /나만 아는 의외의 TMI/);
      assert.match(await tmi.locator("input").getAttribute("placeholder"), /숨은 특기/);
    }
    await H.fillProfile(p, H.answersFor(PQ, i, name), PQ);
  }
  const giverOf = Object.fromEntries(Object.entries(target).map(([g, r]) => [r, g]));
  const R = target["가나"]; // 가나가 챙기는 사람(이 사람의 마니또가 가나)
  console.log(`  짝: ${Object.entries(target).map(([g, r]) => `${g}→${r}`).join(", ")} / 이 스크립트의 주인공: ${R}(마니또 가나)`);

  step("이번 주 할 일(준비 단계) + 내 마니또에게 알려 줄 것");
  assert.match(await todoOf(u[R]), /내 마니또에게 알려 줄 것/);
  {
    const p = u[R];
    await H.tab(p, "내 프로필");
    const f = H.panel(p, "내 마니또에게 알려 줄 것");
    await f.getByPlaceholder(/땅콩 알레르기/).fill("땅콩 알레르기");
    await f.getByPlaceholder(/초코 과자/).fill("귤, 초코 과자");
    await f.getByRole("button", { name: "알려 주기 저장" }).click();
    await f.getByText("저장했어요. 내 마니또가 미션을 고를 때 볼 수 있어요.").waitFor();
    assert.doesNotMatch(await todoOf(p), /내 마니또에게 알려 줄 것/);
    const g = u["가나"]; await g.reload(); await H.tab(g, "내 미션");
    const tp = H.panel(g, "내 대상이 알려 준 것");
    await tp.locator(".warn-line", { hasText: "땅콩 알레르기" }).waitFor();
    await tp.getByText("귤, 초코 과자").waitFor();
    console.log(`  ${R}이 적은 알레르기·좋아하는 간식이 마니또(가나) 화면에 보임(이름은 가린 채 '내 대상')`);
    const other = u[NAMES.find((n) => n !== "가나" && target[n] !== R && n !== R)];
    await other.reload(); await H.tab(other, "내 미션");
    await H.panel(other, "내 대상이 알려 준 것").getByText("아직 적지 않았어요").waitFor();
  }

  step("미션 시작: 이번 주 할 일이 단계에 따라 바뀐다");
  await advance("미션 진행");
  {
    const g = u["가나"];
    assert.match(await todoOf(g), /1주차 미션 카드 고르기/);
    const slot = H.panel(g, "1주차 미션");
    await slot.getByText(/보통은 응모권 1장, 도전은 2장을 더 받아요/).waitFor();
    await slot.locator(".card.level-normal").click(); await slot.locator(".chosen").waitFor();
    assert.match(await todoOf(g), /1주차 미션 하고 "완료 알리기"/);
    await H.tab(g, "피드"); // 가나는 다른 탭에 있다가 나중에 한마디 표시를 본다
  }

  step("안 읽은 표시: 마니또가 완료를 알리면 받는 사람 메뉴에 숫자, 탭 제목에 (1)");
  {
    const r = u[R];
    await H.tab(r, "피드");
    const g = u["가나"];
    await H.tab(g, "내 미션");
    const slot = H.panel(g, "1주차 미션");
    await slot.locator("textarea").fill("책상 서랍을 열어 보세요!");
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(g, "1주차 미션 ✔").waitFor();
    assert.doesNotMatch(await todoOf(g), /1주차 미션/);
    const badge = r.locator("nav.tabs button", { hasText: "추리 보드" }).locator(".tab-badge");
    await badge.waitFor();
    assert.equal(await badge.innerText(), "1");
    assert.match(await r.title(), /^\(1\) /);
    await H.tab(r, "추리 보드");
    await badge.waitFor({ state: "detached" });
    assert.doesNotMatch(await r.title(), /^\(/);
    console.log(`  ${R}: '추리 보드' 탭에 1, 탭 제목 "${"(1) …"}" → 추리 보드를 열면 사라짐`);
    await H.tab(g, "피드");
  }

  step("마니또에게 한마디: 주차마다 한 번, 마니또 메뉴에 숫자");
  {
    const r = u[R];
    const tm = H.panel(r, "마니또에게 한마디");
    await tm.locator("textarea").fill("혹시 가파트세요? 서랍 간식 잘 먹었어요!");
    await tm.getByRole("button", { name: "보내기" }).click();
    await tm.getByText("1주차 한마디는 보냈어요").waitFor();
    assert.equal(await tm.locator("textarea").count(), 0, "같은 주차에는 다시 못 보냄");
    const g = u["가나"];
    const badge = g.locator("nav.tabs button", { hasText: "내 미션" }).locator(".tab-badge");
    await badge.waitFor();
    await H.tab(g, "내 미션");
    await H.panel(g, "내 대상이 보낸 한마디").getByText("혹시 가파트세요? 서랍 간식 잘 먹었어요!").waitFor();
    await badge.waitFor({ state: "detached" });
    console.log("  받는 사람이 보낸 한마디 → 마니또 '내 미션' 탭에 숫자 → 열면 '내 대상이 보낸 한마디'에 보이고 숫자 사라짐");
  }

  step("주차별 추측과 인증·공감");
  const guessWeek = async (p, who) => {
    await H.tab(p, "피드"); await H.tab(p, "추리 보드");
    const sb = p.locator("section.panel", { has: p.locator("h2.panel-title", { hasText: "용의자 보드" }) });
    await sb.locator("select").first().selectOption({ label: who });
    await sb.getByRole("button", { name: "이번 주 추측 남기기" }).click();
    await sb.getByText(/추측을 남겼어요/).waitFor();
  };
  {
    const r = u[R];
    assert.match(await todoOf(r), /1주차 추측 남기기/);
    await guessWeek(r, "가나");
    await r.getByText("내 추측: 1주차 가나").waitFor();
    assert.doesNotMatch(await todoOf(r), /추측 남기기/);
    // 인증
    await H.tab(r, "추리 보드");
    const inbox = H.panel(r, "마니또에게서 온 것");
    const code = await inbox.locator("strong.mono").first().innerText();
    const entry = H.panel(r, "인증하기");
    await entry.getByPlaceholder("K7Q2").fill(code);
    await entry.locator("textarea").fill("서랍 속 간식 덕분에 오후가 행복했어요. 고마워요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await r.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    // 공감: 두 사람이 공감, 같은 사람은 한 번만
    for (const n of NAMES.filter((x) => x !== R).slice(0, 2)) {
      const p = u[n];
      await H.tab(p, "피드");
      const post = H.panel(p, "익명 피드").locator(".dialogue", { hasText: "서랍 속 간식 덕분에" });
      await post.waitFor();
      await post.getByRole("button", { name: /공감/ }).click();
      await post.locator(".like-btn.is-on").waitFor();
      assert.ok(await post.locator(".like-btn").isDisabled(), "한 번 누르면 다시 못 누름");
    }
    await H.tab(r, "내 미션"); await H.tab(r, "피드");
    await H.panel(r, "익명 피드").locator(".dialogue", { hasText: "서랍 속 간식 덕분에" }).getByText("♥ 공감 2").waitFor();
    console.log(`  ${R}: 1주차 추측(가나) → 할 일에서 사라짐, 인증 → 피드 글에 두 사람이 공감(♥ 2, 같은 사람은 한 번만)`);
  }
  step("수호천사: 지원 → 운영자가 받은 게 없는 사람에게 연결 → 미션 → 받는 사람 확인");
  const X = NAMES.map((n) => target[n]).find((r) => giverOf[r] !== "가나"); // 마니또가 아무것도 안 한 사람
  const ANGEL = NAMES.find((n) => n !== X && n !== giverOf[X]);
  {
    const a = u[ANGEL];
    await H.tab(a, "피드"); await H.tab(a, "내 미션");
    const ap = H.panel(a, "수호천사 지원 (응모권을 더 받고 싶다면)");
    await ap.getByRole("button", { name: "수호천사 지원하기" }).click();
    await ap.getByText("지원 중이에요").waitFor();
    await H.tab(admin, "운영");
    const panel = admin.locator("section.panel", { has: admin.locator("h2.panel-title", { hasText: /^수호천사 \(지원 1명/ }) });
    await panel.waitFor();
    const row = panel.locator("li.row-item", { has: admin.locator("select") }).filter({ hasText: X });
    await row.locator("select").selectOption({ label: ANGEL });
    // 받는 사람 본인과 그 사람의 마니또는 고를 수 없다
    const opts = await row.locator("option").allInnerTexts();
    assert.ok(!opts.includes(X) && !opts.includes(giverOf[X]), opts.join(","));
    await row.getByRole("button", { name: "연결" }).click();
    await panel.getByText(`${X} ← ${ANGEL} 연결했어요.`).waitFor();
    // 수호천사 화면: 수호천사 미션 + 이번 주 할 일
    assert.match(await todoOf(a), /수호천사 미션 하기/);
    const mp = H.panel(a, "수호천사 미션");
    await mp.getByPlaceholder("예: 책상에 귤 두 개 두기").fill("책상에 귤 두 개 두기");
    await mp.locator("textarea").fill("마니또 대신 제가 챙길게요!");
    const r = u[X];
    await H.tab(r, "피드"); // 다른 탭에 있다가 숫자를 본다
    await mp.getByRole("button", { name: "수호천사 미션 완료 알리기" }).click();
    await mp.getByText("1번: 책상에 귤 두 개 두기 — 확인 기다리는 중").waitFor();
    const badge = r.locator("nav.tabs button", { hasText: "추리 보드" }).locator(".tab-badge");
    await badge.waitFor();
    assert.match(await todoOf(r), /수호천사가 보낸 것 확인하기/);
    await H.tab(r, "추리 보드");
    const ai = H.panel(r, "수호천사가 보낸 것");
    await ai.getByText("책상에 귤 두 개 두기").waitFor();
    assert.equal(await ai.getByText(ANGEL).count(), 0, "받는 사람 화면에 수호천사 이름이 없다");
    await ai.locator("textarea").fill("귤 덕분에 오후가 상큼했어요. 고마워요!");
    await ai.getByRole("button", { name: "받았어요" }).click();
    await ai.getByText("받았어요: 귤 덕분에 오후가 상큼했어요. 고마워요!").waitFor();
    await mp.getByText(/1번: 책상에 귤 두 개 두기 — 확인됨/).waitFor();
    console.log(`  ${ANGEL}이(가) 지원 → 운영자가 ${X}(마니또 ${giverOf[X]}가 아무것도 안 함)에게 연결 → 수호천사 미션 → ${X}이(가) '받았어요'(수호천사 이름은 안 보임)`);
  }
  for (const w of [2, 3]) {
    await H.panel(admin, "주차").getByRole("button", { name: `${w}주차` }).click();
    await admin.locator(".hud-chip", { hasText: `${w}주차` }).waitFor();
    await guessWeek(u[R], "가나");
  }
  await u[R].getByText("내 추측: 1주차 가나 · 2주차 가나 · 3주차 가나").waitFor();
  console.log(`  ${R}: 1·2·3주차 모두 가나로 추측`);

  step("최종 지목 → 투표 → 집계 → 공개(발표 화면)");
  await advance("최종 지목");
  {
    const r = u[R];
    await H.tab(r, "피드"); await H.tab(r, "추리 보드");
    const sb = r.locator("section.panel", { has: r.locator("h2.panel-title", { hasText: "용의자 보드" }) });
    await sb.locator("select").selectOption({ label: "가나" });
    await sb.getByRole("button", { name: "이 사람으로 지목" }).click();
    await r.getByText("지목했어요.").waitFor();
  }
  await advance("투표");
  await admin.getByRole("button", { name: "투표 카드 만들기" }).click();
  await H.panel(admin, "투표 카드").getByText(/투표 카드 \d+장을 만들었어요/).waitFor();
  await advance("집계");
  await admin.getByRole("button", { name: "집계하기" }).click();
  await admin.getByText(/^베스트 마니또: /).waitFor();
  await advance("공개");
  await H.tab(admin, "결과");
  await H.panel(admin, "발표 화면").getByRole("button", { name: "발표 화면 열기" }).click();
  const pres = admin.locator(".presenter");
  await pres.waitFor();
  const stats = (await pres.locator(".pres-stats").innerText()).replace(/\s+/g, " ");
  assert.match(stats, /2번의 공감/); assert.match(stats, /1번의 "마니또에게 한마디"/);
  console.log("  첫 장면 숫자:", stats);
  const next = async () => { await pres.getByRole("button", { name: "다음 ▶" }).click(); await admin.waitForTimeout(120); };
  let sawPair = false, sawDetective = false, sawLikes = false, sawAngel = false;
  for (let k = 0; k < 40; k++) {
    await next();
    const kicker = await pres.locator(".pres-kicker").first().innerText().catch(() => "");
    if (kicker === `${R}님의 마니또는`) {
      await pres.getByText("정답! 1주차부터 알고 있었어요").waitFor();
      await pres.locator(".pres-story", { hasText: "1주차 [보통]" }).waitFor();
      sawPair = true;
    }
    if (await pres.getByText("명탐정").count()) {
      await pres.getByText("가장 먼저 알아챈 사람").waitFor();
      await pres.locator(".pres-person", { hasText: R }).waitFor();
      await pres.getByText("1주차 추측부터 끝까지 맞혔어요").waitFor();
      sawDetective = true;
    }
    if (await pres.getByText("숨은 수호천사").count()) {
      await pres.locator(".pres-person", { hasText: ANGEL }).getByText(`→ ${X}님에게 미션 1건`).waitFor();
      sawAngel = true;
    }
    if (kicker.startsWith("가장 많은 공감을 받은 후기")) {
      assert.match(kicker, /♥ 2/);
      await pres.getByText(`— ${R}님`).waitFor();
      sawLikes = true;
      break;
    }
  }
  assert.ok(sawPair && sawDetective && sawLikes && sawAngel, `짝 이야기 ${sawPair}, 명탐정 ${sawDetective}, 공감 1위 ${sawLikes}, 수호천사 ${sawAngel}`);
  {
    const a = u[ANGEL];
    await H.tab(a, "결과");
    const lineEl = a.locator(".target .small", { hasText: "내 응모권" });
    await lineEl.waitFor();
    const line = (await lineEl.innerText()).replace(/\s+/g, " ");
    assert.match(line, /\+ 수호천사 1/, line);
    console.log(`  발표 화면 '숨은 수호천사: ${ANGEL} → ${X}', ${ANGEL}의 응모권: ${line}`);
  }
  console.log(`  발표 화면: ${R}의 짝 장면에 "정답! 1주차부터 알고 있었어요"와 가나의 미션(1주차 [보통] …), 명탐정 "가장 먼저 알아챈 사람: ${R}", 공감 1위 후기(♥ 2, ${R}님)`);
  // 참여자 결과 탭에도 같은 장면까지 열린다
  {
    const r = u[R];
    await H.tab(r, "결과");
    await H.panel(r, "시상").getByText("가장 먼저 알아챈 사람").waitFor();
    await H.panel(r, "시상").getByText("가장 많은 공감을 받은 후기").waitFor();
    console.log(`  ${R}의 결과 탭 '시상'에도 '가장 먼저 알아챈 사람'·'가장 많은 공감을 받은 후기'가 열림`);
  }
  await pres.getByRole("button", { name: "닫기" }).click();

  await b.close();
  console.log("\n콘솔 오류·경고", errs.length, "건"); errs.slice(0, 8).forEach((e) => console.log("  ", e));
  if (errs.length) process.exit(1);
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
