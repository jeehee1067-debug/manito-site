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
  const inv = await H.setupAdmin(admin, ["가나,가파트", "다라,나파트", "마바,가파트", "사아,나파트"], "fadmin@example.com");
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
    await p.locator(".target-name:visible").waitFor();
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
    // 탭은 숨겨 둔 채 남는다: 대상이 나중에 고치면 마니또가 새로 고침 없이 탭을 다시 열 때 보인다
    await H.tab(p, "내 프로필");
    await f.getByPlaceholder(/땅콩 알레르기/).fill("땅콩·새우 알레르기");
    await f.getByRole("button", { name: "알려 주기 저장" }).click();
    // 서버에 저장된 것을 확인한 뒤(저장 전에 탭을 오가면 예전 값을 읽는다) 마니또가 탭을 한 번 오간다
    const rPid = Object.entries((await H.readDoc("public/roster")).people || {}).find(([, v]) => v.name === R)?.[0];
    for (let k = 0; k < 50 && (await H.readDoc(`prefs/${rPid}`)).avoid !== "땅콩·새우 알레르기"; k++) await p.waitForTimeout(200);
    assert.equal((await H.readDoc(`prefs/${rPid}`)).avoid, "땅콩·새우 알레르기", "대상의 수정이 저장됨");
    await H.tab(g, "추리 보드"); await H.tab(g, "내 미션");
    await tp.locator(".warn-line", { hasText: "땅콩·새우 알레르기" }).waitFor({ timeout: 10000 });
    console.log("  대상이 나중에 고친 알레르기도 마니또가 탭을 다시 열면 보임(새로 고침 없이)");
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
    await H.pickCard(slot, "normal");
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
    const sb = p.locator("section.panel:visible", { has: p.locator("h2.panel-title", { hasText: "용의자 보드" }) });
    await sb.locator("select").first().selectOption({ label: who });
    await sb.getByRole("button", { name: "이번 주 추측 남기기" }).click();
    await sb.getByText(/추측을 남겼어요/).waitFor();
  };
  {
    const r = u[R];
    assert.match(await todoOf(r), /1주차 추측 남기기/);
    // 맨 위 할 일 줄: 이번 주 단서 2개가 공개되기 전에는 추측 줄이 없다 → 공개되면 다른 탭에서도 뜨고, 누르면 용의자 보드로 간다
    await H.tab(r, "피드");
    const guessLine = r.locator(".reminder-bar p", { hasText: "1주차 추측" });
    assert.equal(await guessLine.count(), 0, "이번 주 단서 전에는 추측 줄 없음");
    await H.tab(admin, "운영");
    await admin.getByRole("button", { name: "이번 주 단서 2개 공개" }).click();
    await admin.getByText("단서를 공개하고 파트 순위도 새로 발표했어요.").waitFor();
    await guessLine.waitFor();
    assert.match(await guessLine.innerText(), /1주차 추측을 아직 남기지 않았어요/);
    await guessLine.getByRole("button", { name: "용의자 보드에서 추측하기" }).click();
    await r.locator("nav.tabs button.is-on", { hasText: "추리 보드" }).waitFor();
    assert.equal(await r.locator(".reminder-bar p", { hasText: "추측" }).count(), 0, "추리 보드에서는 추측 줄을 숨김");
    console.log(`  ${R}: 단서 공개 전에는 할 일 줄에 추측 없음 → 단서 2개 공개 뒤 피드 탭 맨 위에 '1주차 추측을 아직 남기지 않았어요' → 누르면 추리 보드`);
    await guessWeek(r, "가나");
    await r.getByText("내 추측: 1주차 가나").waitFor();
    assert.doesNotMatch(await todoOf(r), /추측 남기기/);
    await H.tab(r, "피드");
    await r.waitForTimeout(400);
    assert.equal(await r.locator(".reminder-bar p", { hasText: "추측" }).count(), 0, "추측을 남기면 할 일 줄에서 사라짐");
    // 인증
    await H.tab(r, "추리 보드");
    const inbox = H.panel(r, "마니또에게서 온 것");
    const code = await inbox.locator("strong.mono").first().innerText();
    const entry = H.panel(r, "인증하기");
    await entry.getByPlaceholder("쪽지에 적힌 4자리").fill(code);
    await entry.locator("textarea").fill("서랍 속 간식 덕분에 오후가 행복했어요. 고마워요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await r.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    // 공감: 두 사람이 공감, 같은 사람은 한 번만
    for (const n of NAMES.filter((x) => x !== R && x !== "가나")) { // 글쓴이(R)와 그 미션의 마니또(가나)가 아닌 두 사람: 이 두 사람의 공감만 센다
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
    // 피드 맨 위 "공감 많은 후기": 공감을 받은 글이 모여 보인다(이름 없이). "새 글 확인"을 누르면 다시 읽는다
    await H.panel(r, "익명 피드").getByRole("button", { name: "새 글 확인" }).click();
    const topPanel = H.panel(r, "공감 많은 후기");
    const topPost = topPanel.locator(".dialogue", { hasText: "서랍 속 간식 덕분에" });
    await topPost.getByText("공감 1위").waitFor();
    await topPost.getByText("♥ 공감 2").waitFor();
    assert.equal(await topPanel.locator(".dialogue").count(), 1, "공감을 받은 글만 나온다");
    for (const n of NAMES) assert.equal(await topPanel.getByText(n, { exact: true }).count(), 0, "공감 많은 후기에도 이름이 없다");
    // 다른 탭에 갔다 와도 그대로 보인다(읽어 둔 것을 쓴다)
    await H.tab(r, "규칙"); await H.tab(r, "피드");
    await H.panel(r, "공감 많은 후기").locator(".dialogue", { hasText: "서랍 속 간식 덕분에" }).waitFor();
    console.log(`  ${R}: 1주차 추측(가나) → 할 일에서 사라짐, 인증 → 피드 글에 두 사람이 공감(♥ 2, 같은 사람은 한 번만)`);
  }
  step("수호천사: 지원 순서 → 2주차를 열 때 자동 연결(운영자가 고르지 않음, 자기 미션을 안 한 지원자는 건너뜀) → 미션 → 받는 사람 확인");
  // 1주차 미션을 한 마니또는 가나뿐이다. 받은 게 없는 사람은 가나의 대상을 뺀 모두
  const ANGEL = "가나";
  const LAZY = NAMES.find((n) => n !== "가나"); // 자기 1주차 미션을 안 한 사람이 먼저 지원한다
  let X; // 자동으로 연결된 받는 사람
  {
    const volunteer = async (name) => {
      const p = u[name];
      await H.tab(p, "피드"); await H.tab(p, "내 미션");
      const ap = H.panel(p, "수호천사 지원 (응모권을 더 받고 싶다면)");
      await ap.getByText("먼저 지원한 순서대로 자동 연결돼요").waitFor();
      await ap.getByRole("button", { name: "수호천사 지원하기" }).click();
      await ap.getByText("지원 중이에요").waitFor();
    };
    await volunteer(LAZY);
    await volunteer(ANGEL);
    const a = u[ANGEL];
    await H.tab(admin, "운영");
    const panelOf = (n) => admin.locator("section.panel:visible", { has: admin.locator("h2.panel-title", { hasText: new RegExp(`^수호천사 \\(지원 2명 · 연결 ${n}명`) }) });
    const before = panelOf(0);
    await before.waitFor();
    assert.equal(await before.locator("select").count(), 0, "운영 화면에 수호천사를 고르는 칸이 없다");
    const q = await before.locator(".angel-queue li").allInnerTexts();
    assert.ok(q.length === 2 && q[0].startsWith(`1. ${LAZY} `) && q[1].startsWith(`2. ${ANGEL} `), q.join(" | "));
    // 1주차 중에는 연결하지 않는다
    await before.getByText("2주차가 열리면 그때 정해져요.").waitFor();
    assert.ok(await before.getByRole("button", { name: "지금 순서대로 연결 (0쌍)" }).isDisabled());
    // 2주차를 열면 자동으로 연결된다
    await H.panel(admin, "주차").getByRole("button", { name: "2주차" }).click();
    await admin.locator(".hud-chip", { hasText: "2주차" }).waitFor();
    await admin.getByText("2주차를 열었어요. 수호천사 1명을 지원 순서대로 연결했어요").waitFor();
    const panel = panelOf(1);
    await panel.waitFor();
    const line = (await panel.locator("li.row-item").first().innerText()).replace(/\s+/g, " ");
    const m = line.match(/^(\S+) ← 수호천사 (\S+) \(지원 (\d+)번째/);
    assert.ok(m, line);
    X = m[1];
    assert.equal(m[2], ANGEL);
    assert.equal(m[3], "2", "가나는 두 번째로 지원했지만 연결됨(첫 번째 지원자는 자기 미션을 안 해서 건너뜀)");
    assert.ok(X !== ANGEL && giverOf[X] !== "가나", `받은 게 없는 사람(${X})에게 연결`);
    const q2 = await panel.locator(".angel-queue li").allInnerTexts();
    assert.match(q2[0], /1주차까지 자기 미션을 다 하지 않아 건너뜀/);
    assert.ok(q2[1].includes(`연결됨 → ${X}`), q2[1]);
    assert.ok(await panel.getByRole("button", { name: "지금 순서대로 연결 (0쌍)" }).isDisabled(), "남은 지원자는 자기 미션을 안 해서 더 연결할 짝이 없다");
    console.log(`  지원 순서: 1. ${LAZY}(자기 1주차 미션 안 함 → 건너뜀) 2. ${ANGEL} → 2주차를 열자 ${X} ← ${ANGEL} 자동 연결`);
    // 연결 풀고 다음 순번으로: 넘긴 짝은 다시 붙지 않고, 풀린 지원자는 순서대로 다른 "받은 게 없는 사람"에게 간다
    const first = X;
    await panel.locator("li.row-item").first().getByRole("button", { name: "연결 풀고 다음 순번으로" }).click();
    await panel.getByText(`${first}님의 연결을 풀었어요. 지금 연결할 수 있는 다음 지원자는 없어요.`).waitFor();
    await panel.locator("li.row-item", { hasText: `← 수호천사 ${ANGEL}` }).filter({ hasNotText: `${first} ←` }).waitFor();
    const line2 = (await panel.locator("li.row-item").first().innerText()).replace(/\s+/g, " ");
    X = line2.match(/^(\S+) ← 수호천사 (\S+) \(지원 2번째/)[1];
    assert.ok(X !== first && X !== ANGEL && giverOf[X] !== "가나", line2);
    assert.equal(await panel.locator("li.row-item").count(), 1, "연결은 여전히 한 쌍");
    assert.ok(await panel.getByRole("button", { name: "지금 순서대로 연결 (0쌍)" }).isDisabled(), `넘긴 짝(${first} ← ${ANGEL})은 다시 붙지 않는다`);
    console.log(`  "연결 풀고 다음 순번으로": ${first}에게는 다시 붙지 않고, ${ANGEL}은(는) 순서대로 ${X}에게 연결됨`);
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
    console.log(`  ${X}(마니또 ${giverOf[X]}가 아무것도 안 함)에게 ${ANGEL}이(가) 수호천사 미션 → ${X}이(가) '받았어요'(수호천사 이름은 안 보임)`);
  }
  for (const w of [2, 3]) {
    await H.panel(admin, "주차").getByRole("button", { name: `${w}주차` }).click();
    await admin.locator(".hud-chip", { hasText: `${w}주차` }).waitFor();
    await guessWeek(u[R], "가나");
  }
  await u[R].getByText("내 추측: 1주차 가나 · 2주차 가나 · 3주차 가나").waitFor();
  console.log(`  ${R}: 1·2·3주차 모두 가나로 추측`);

  step("최종 지목 → 마감 → 집계 → 공개(발표 화면)");
  await advance("최종 지목");
  {
    const r = u[R];
    await H.tab(r, "피드"); await H.tab(r, "추리 보드");
    const sb = r.locator("section.panel:visible", { has: r.locator("h2.panel-title", { hasText: "용의자 보드" }) });
    await sb.locator("select").selectOption({ label: "가나" });
    await sb.getByRole("button", { name: "이 사람으로 지목" }).click();
    await r.getByText("지목했어요.").waitFor();
  }
  await advance("마감");
  await advance("집계");
  await admin.getByRole("button", { name: "집계하기" }).click();
  await admin.getByText(/^응모권 상위/).waitFor();
  await advance("공개");
  await H.tab(admin, "결과");
  await H.panel(admin, "발표 화면").getByRole("button", { name: "발표 화면 열기" }).click();
  const pres = admin.locator(".presenter");
  await pres.waitFor();
  const stats = (await pres.locator(".pres-stats").innerText()).replace(/\s+/g, " ");
  assert.match(stats, /2번의 공감/); assert.match(stats, /1번의 "마니또에게 한마디"/);
  console.log("  첫 장면 숫자:", stats);
  const next = async () => { await pres.getByRole("button", { name: "다음 ▶" }).click(); await admin.waitForTimeout(120); };
  let sawPair = false, sawDetective = false, sawAngel = false;
  for (let k = 0; k < 40; k++) {
    await next();
    if (await pres.locator(".pres-title", { hasText: "먼저 숫자 하나!" }).count()) break; // 추첨 장면: 추첨해야 다음으로 넘어간다
    const kicker = await pres.locator(".pres-kicker").first().innerText().catch(() => "");
    if (kicker === `${R}님의 마니또는`) {
      await pres.getByText("정답! 1주차부터 알고 있었어요").waitFor();
      await pres.locator(".pres-story", { hasText: "1주차 [보통]" }).waitFor();
      sawPair = true;
    }
    if (await pres.getByText("명탐정").count()) {
      await pres.getByText("가장 먼저 알아챈 사람").waitFor();
      await pres.locator(".pres-person", { hasText: R }).waitFor();
      await pres.getByText("가장 먼저 알아챈 사람 · 1주차 추측부터 끝까지 맞혔어요").waitFor();
      sawDetective = true;
    }
    if (await pres.getByText("숨은 수호천사").count()) {
      await pres.locator(".pres-person", { hasText: ANGEL }).getByText(`→ ${X}님에게 미션 1건`).waitFor();
      sawAngel = true;
    }
  }
  assert.ok(sawPair && sawDetective && sawAngel, `짝 이야기 ${sawPair}, 명탐정 ${sawDetective}, 수호천사 ${sawAngel}`);
  // 시상: 숫자를 정하면 2등(응모권 최다 3명)과 3등(2등 수상자를 뺀 공감 1위 후기)이 정해진다(운영자가 고르지 않는다).
  // 4명뿐이라 공감 1위(R)가 2등 수상자일 수 있다. 그때는 3등 수상자가 없다(상이 겹치지 않는다).
  const S = await import("../src/lib/scoring.js");
  await pres.locator(".seed-input").fill("7");
  await pres.getByRole("button", { name: "숫자 정하기" }).click();
  await pres.getByRole("button", { name: "숫자 7로 확정" }).click();
  await pres.getByText("현장에서 정한 숫자 7 · 다음 장면부터 시상합니다").waitFor({ timeout: 8000 });
  const inp = await H.prizeInput();
  const before = S.resolvePrizes({ ...inp, withGrand: false });
  const pidOfName = Object.fromEntries((await Promise.all(Object.keys(inp.tickets).map(async (pid) => [(await H.readDoc(`roster/${pid}`)).name, pid]))));
  assert.equal(inp.reviews[0].receiverPid, pidOfName[R], "공감 1위 후기는 R의 후기");
  assert.equal(inp.reviews[0].likes, 2);
  const rIsBest = before.best.includes(pidOfName[R]);
  for (let k = 0; k < 4; k++) await next();
  await pres.getByText(/3등 베스트 후기상/).waitFor();
  if (rIsBest) await pres.getByText("수상자 없음 (공감을 받은 후기를 쓴 사람이 모두 더 큰 상을 받았어요)").waitFor();
  else { await pres.getByText("가장 많은 공감을 받은 후기 ♥ 2").waitFor(); await pres.locator(".pres-title", { hasText: R }).waitFor(); }
  {
    const a = u[ANGEL];
    await H.tab(a, "결과");
    const lineEl = a.locator(".target:visible .small", { hasText: "내 응모권" });
    await lineEl.waitFor();
    const line = (await lineEl.innerText()).replace(/\s+/g, " ");
    assert.match(line, /\+ 수호천사 1/, line);
    console.log(`  발표 화면 '숨은 수호천사: ${ANGEL} → ${X}', ${ANGEL}의 응모권: ${line}`);
  }
  console.log(`  발표 화면: ${R}의 짝 장면에 "정답! 1주차부터 알고 있었어요"와 가나의 미션(1주차 [보통] …), 명탐정 "가장 먼저 알아챈 사람: ${R}", 3등 베스트 후기상 = ${rIsBest ? `수상자 없음(공감 1위 ${R}님이 2등 수상자)` : `공감 1위 후기(♥ 2, ${R}님)`}`);
  // 참여자 결과 탭에도 같은 장면까지 열린다
  {
    const r = u[R];
    await H.tab(r, "결과");
    await H.panel(r, "그 밖의 기록").getByText("가장 먼저 알아챈 사람").waitFor();
    const third = H.panel(r, "추첨·시상").locator("li.draw", { hasText: "3등 베스트 후기상" });
    if (rIsBest) await third.getByText("수상자 없음(공감을 받은 후기를 쓴 사람이 모두 더 큰 상을 받았어요)").waitFor();
    else await third.getByText(`${R} · ♥ 공감 2`).waitFor();
    console.log(`  ${R}의 결과 탭에도 '가장 먼저 알아챈 사람'과 3등 베스트 후기상(${rIsBest ? "수상자 없음" : `${R} · ♥ 공감 2`})이 열림`);
  }
  await pres.getByRole("button", { name: "닫기" }).click();

  await b.close();
  console.log("\n콘솔 오류·경고", errs.length, "건"); errs.slice(0, 8).forEach((e) => console.log("  ", e));
  if (errs.length) process.exit(1);
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 6).join("\n")); process.exit(1); });
