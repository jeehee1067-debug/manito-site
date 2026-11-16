// 현장 시상(사람이 상보다 많은 경우): 24명 명단을 만들고, 집계 결과(응모권·공감 순위)는 에뮬레이터에 직접 넣은 뒤 발표 화면으로 시상을 진행한다.
//  - 숫자를 정하면 2등(응모권 최다 3명)과 3등(2등 수상자를 뺀 공감 1위 후기)이 정해진다
//  - 4·5등: 종이로 뽑힌 이름을 입력한다. 이미 상을 받은 사람·응모권 0장인 사람은 들어가지 않는다(다시 뽑기)
//  - 1등: 2등 수상자가 뽑혀도 1등이다 → 2등은 다음 순위가 받고, 그 사람이 4등이었으면 4등 자리를 다시 뽑는다
//  - 6등: 사이트가 뽑는다(1~5등 제외). 참여자 휴대폰에 내 결과가 보이고, 누구나 검증할 수 있다. 뽑은 뒤에는 고칠 수 없다
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const H = require("./helpers.cjs");
const FS = `http://127.0.0.1:8080/v1/projects/${H.P}/databases/(default)/documents`;
const owner = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const enc = (v) => (v === null ? { nullValue: null } : typeof v === "number" ? { integerValue: String(v) } : typeof v === "string" ? { stringValue: v } : typeof v === "boolean" ? { booleanValue: v }
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } } : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } });
const put = async (path, obj, mask = "") => { const r = await fetch(`${FS}/${path}${mask}`, { method: "PATCH", headers: owner, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(obj).map(([k, x]) => [k, enc(x)])) }) }); if (!r.ok) throw new Error(`${path} ${r.status} ${await r.text()}`); };
const list = (name) => fetch(`${FS}/${name}?pageSize=100`, { headers: owner }).then((r) => r.json()).then((j) => j.documents || []);

(async () => {
  await H.reset();
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const mk = H.maker(browser, errors, dialogs);
  const step = (s) => console.log("▶", s);
  const N = 24;
  const NAMES = Array.from({ length: N }, (_, i) => `사람${String(i + 1).padStart(2, "0")}`);
  const PARTS = ["가파트", "나파트", "다파트", "라파트"];
  const nm = (k) => NAMES[k - 1]; // nm(1) = "사람01"

  step("명단 24명(이름·파트·아이디) → 배정, 사람05만 가입(휴대폰으로 결과를 볼 사람)");
  const admin = await mk("운영자", { width: 1280, height: 720 });
  const inv = await H.setupAdmin(admin, NAMES.map((n, i) => `${n}\t${PARTS[i % 4]}\tuser${i + 1}`));
  const phone = await mk("사람05");
  await H.signup(phone, inv[nm(5)], "p05@example.com");
  await phone.locator(".hud-who", { hasText: "사람05님" }).waitFor();
  const pidOf = Object.fromEntries((await list("roster")).map((d) => [d.fields.name.stringValue, d.name.split("/").pop()]));
  const nameOf = Object.fromEntries(Object.entries(pidOf).map(([n, pid]) => [pid, n]));
  const P = (k) => pidOf[nm(k)];
  const pairs = (await list("assignments")).map((d) => ({ giverPid: d.name.split("/").pop(), receiverPid: d.fields.receiverPid.stringValue }));
  assert.equal(pairs.length, N);

  step("집계 결과를 넣는다: 응모권 사람01 16장 > 사람02 15장 > … (사람24는 0장), 공감 1위 후기는 사람02(2등 수상자), 2위는 사람10");
  const tickets = Object.fromEntries(NAMES.map((n, i) => [pidOf[n], i === N - 1 ? 0 : Math.max(1, 16 - i)]));
  const reviewRank = [
    { code: "AAAA", review: "매주 책상에 놓인 간식이 큰 힘이 됐어요. 고마워요!", receiverPid: P(2), likes: 9 },
    { code: "BBBB", review: "쪽지 덕분에 한 주가 즐거웠어요. 누군지 꼭 알고 싶어요.", receiverPid: P(10), likes: 5 },
    { code: "CCCC", review: "깜짝 선물 정말 감동이었어요!", receiverPid: P(11), likes: 3 },
  ];
  await put("results/public", { pairs, tickets, ticketDetail: {}, draws: {}, step: 0, praises: [], partBoard: [], tieBreak: {}, bestReview: reviewRank[0], reviewRank, guesses: {}, noticed: {}, story: {}, stats: { people: N } });
  await put("config/app", { phase: 5, week: 3 }, "?updateMask.fieldPaths=phase&updateMask.fieldPaths=week");

  step("발표 화면: 짝 공개를 건너뛰고 시상 장면으로");
  await admin.reload();
  await H.tab(admin, "결과");
  await H.panel(admin, "발표 화면").getByRole("button", { name: "발표 화면 열기" }).click();
  const pres = admin.locator(".presenter");
  await pres.waitFor();
  const nextBtn = pres.getByRole("button", { name: "다음 ▶" });
  const next = async () => { await nextBtn.click(); await admin.waitForTimeout(150); };
  const title = (t) => pres.locator(".pres-title", { hasText: t });
  for (let k = 0; k < 6 && !(await pres.getByRole("button", { name: /남은 짝 건너뛰/ }).count()); k++) await next();
  await pres.getByRole("button", { name: /남은 짝 건너뛰/ }).click();
  for (let k = 0; k < 6 && !(await title("먼저 숫자 하나!").count()); k++) await next();
  await title("먼저 숫자 하나!").waitFor();
  await pres.locator(".seed-input").fill("2026");
  await pres.getByRole("button", { name: "숫자 정하기" }).click();
  await pres.getByRole("button", { name: "숫자 2026로 확정" }).click();
  await pres.getByText("현장에서 정한 숫자 2026 · 다음 장면부터 시상합니다").waitFor();

  step("2등(응모권 최다 3명, 한 명씩) → 3등(공감 1위 사람02는 2등 수상자라 다음 순위 사람10)");
  for (const k of [3, 2, 1]) { await next(); await pres.getByText("2등 베스트 마니또 · 각 10만원").waitFor(); await title(nm(k)).waitFor(); }
  await next(); await pres.getByText(/3등 베스트 후기상/).waitFor();
  await pres.getByText("가장 많은 공감을 받은 후기 ♥ 5").waitFor();
  await title(nm(10)).waitFor();
  console.log(`  2등: ${nm(1)}·${nm(2)}·${nm(3)} / 3등: ${nm(10)}(♥ 5. 공감 1위 ${nm(2)}는 2등이라 제외)`);

  // 종이로 뽑힌 이름 입력
  const type = async (name) => { await pres.locator(".name-input").first().fill(name); };
  const pick = async (name) => { await type(name); await pres.locator(".name-hits button", { hasText: name }).first().click(); };
  const enter = async (name) => { await pick(name); await pres.locator(".pres-person b", { hasText: name }).first().waitFor(); };
  const shown = async () => (await pres.locator(".pres-person b").allInnerTexts()).map((t) => t.trim()).sort();

  step("4등(종이 4명): 이미 상을 받은 사람·응모권 0장은 들어가지 않고, 다 뽑으면 입력 칸이 사라진다");
  await next(); await title("4등 응모권 추첨").waitFor();
  assert.ok(await nextBtn.isDisabled(), "4명을 다 입력하기 전에는 넘어가지 않는다");
  await pres.getByText("4등 4자리를 더 입력해야 넘어가요").waitFor();
  await pick(nm(1)); await pres.getByText("이미 2등 수상자예요. 한 사람은 하나만 받으니 종이를 다시 뽑아 주세요.").waitFor();
  await pick(nm(10)); await pres.getByText("이미 3등 수상자예요.").waitFor();
  await type(nm(24)); assert.equal(await pres.locator(".name-hits button").count(), 0, "응모권 0장인 사람은 후보에 없다");
  for (const k of [4, 12, 13, 14]) await enter(nm(k));
  assert.deepEqual(await shown(), [4, 12, 13, 14].map(nm));
  assert.equal(await pres.locator(".name-input").count(), 0);
  assert.ok(await nextBtn.isEnabled());
  // 입력한 이름은 참여자 휴대폰에도 바로 보인다
  await H.tab(phone, "결과");
  const pp = H.panel(phone, "추첨·시상");
  await pp.locator("li.draw", { hasText: "4등 응모권 추첨" }).locator(".winner", { hasText: nm(14) }).waitFor();
  assert.equal(await pp.locator("li.draw", { hasText: "5등 응모권 추첨" }).locator(".winner").count(), 0);

  step("5등(종이 7명): 4등 수상자가 또 뽑히면 다시 뽑는다");
  await next(); await title("5등 응모권 추첨").waitFor();
  await pick(nm(12)); await pres.getByText("이미 4등 수상자예요.").waitFor();
  for (const k of [15, 16, 17, 18, 19, 20, 21]) await enter(nm(k));
  assert.equal(await pres.locator(".name-input").count(), 0);

  step("1등(종이): 2등 수상자 사람01이 뽑혀도 1등 → 1등만 받는다");
  await next(); await title("1등 대추첨").waitFor();
  assert.ok(await nextBtn.isDisabled());
  await enter(nm(1));
  await pres.getByText(`${nm(1)}님은 2등 수상자였어요 → 1등만 받고, 2등 한 자리는 다음 장면에서 다시 채워요`).waitFor();

  step("겹친 자리 다시 채우기: 2등은 다음 순위 사람04(4등이었음)가 받고, 비게 된 4등 한 자리를 다시 뽑는다");
  await next(); await pres.getByText("겹친 자리 다시 채우기").waitFor();
  await pres.getByText(`2등 베스트 마니또: ${nm(1)}님은 1등으로 → 다음 순위 ${nm(4)}님이 받아요`).waitFor();
  await pres.getByText(new RegExp(`4등 응모권 추첨: ${nm(4)}님은 2등으로 → .*종이를 1장 더 뽑아 주세요`)).waitFor();
  assert.ok(await nextBtn.isDisabled(), "빈 자리를 다시 뽑기 전에는 넘어가지 않는다");
  await pick(nm(13)); await pres.getByText("이미 입력한 이름이에요.").waitFor(); // 이미 4등인 사람의 종이가 또 나오면 다시 뽑는다
  await pick(nm(22));
  await pres.getByText(`${nm(22)}님이 새로 뽑혔어요`).waitFor();
  assert.equal(await pres.locator(".name-input").count(), 0);
  assert.ok(await nextBtn.isEnabled());
  const S = await import("../src/lib/scoring.js");
  const res = S.resolvePrizes(await H.prizeInput());
  const got = { 1: res.grand, 2: res.best, 3: [res.review.receiverPid], 4: res.t4, 5: res.t5 };
  assert.deepEqual(Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.map((pid) => nameOf[pid]).sort()])),
    { 1: [nm(1)], 2: [2, 3, 4].map(nm), 3: [nm(10)], 4: [12, 13, 14, 22].map(nm), 5: [15, 16, 17, 18, 19, 20, 21].map(nm) });
  console.log(`  1등 ${nm(1)} / 2등 ${[2, 3, 4].map(nm).join("·")} / 3등 ${nm(10)} / 4등 ${[12, 13, 14, 22].map(nm).join("·")} / 5등 ${nm(15)}~${nm(21)}`);

  step("6등(사이트 추첨): 1~5등 16명을 뺀 응모권 있는 7명 중에서(상이 20자리라 7명 모두)");
  await next(); await title("6등 응모권 추첨").waitFor();
  await pres.getByRole("button", { name: "6등 추첨하기" }).click();
  await pres.getByText("뽑은 뒤에는 1~6등을 모두 바꿀 수 없어요").waitFor();
  await pres.getByRole("button", { name: "6등 추첨 확정" }).click();
  await pres.getByText("휴대폰 결과 탭에서 내 이름을 확인하세요").waitFor({ timeout: 10000 });
  const want6 = [5, 6, 7, 8, 9, 11, 23].map(nm);
  assert.deepEqual(await shown(), want6);
  const draws = (await H.prizeInput()).draws;
  assert.deepEqual(draws.t6.winners.map((pid) => nameOf[pid]).sort(), want6);
  assert.ok(!draws.t6.winners.includes(P(24)), "응모권 0장은 6등에도 없다");
  const over = await admin.evaluate(() => { const st = document.querySelector(".pres-stage"); return st.scrollHeight > st.clientHeight + 2; });
  assert.equal(over, false, "발표 화면이 넘치지 않는다");

  step("참여자 휴대폰(사람05): 내 결과, 수상자 목록, 6등 추첨 검증");
  await pp.getByText(`축하해요! ${nm(5)}님은 6등 응모권 추첨에 뽑혔어요.`).waitFor();
  const row = (label) => pp.locator("li.draw", { hasText: label });
  const rowNames = async (label) => (await row(label).locator(".winner > span:nth-of-type(1)").allInnerTexts()).map((t) => t.trim()).sort();
  assert.deepEqual(await rowNames("2등 베스트 마니또"), [2, 3, 4].map(nm));
  assert.deepEqual(await rowNames("4등 응모권 추첨"), [12, 13, 14, 22].map(nm));
  assert.deepEqual(await rowNames("1등 대추첨"), [nm(1)]);
  assert.equal(await pp.locator(".winner").count(), 1 + 3 + 1 + 4 + 7 + 7, "한 사람이 한 번씩만 나온다");
  await pp.getByRole("button", { name: "6등 추첨 검증" }).click();
  await pp.getByText("6등 응모권 추첨: 현장 숫자와 응모권 표로 다시 계산한 결과와 같아요").waitFor();
  assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "휴대폰 폭에서 가로 스크롤 없음");

  step("6등을 뽑은 뒤에는 고칠 수 없다: 입력 칸·지우기 버튼이 없고, 운영자 권한의 직접 요청도 거부된다");
  await pres.getByRole("button", { name: "◀ 이전" }).click(); // 겹친 자리 장면
  await pres.getByText("겹친 자리 다시 채우기").waitFor();
  assert.equal(await pres.locator(".name-input").count(), 0);
  await pres.getByRole("button", { name: "◀ 이전" }).click(); // 1등 장면
  await title("1등 대추첨").waitFor();
  assert.equal(await pres.locator(".name-x").count(), 0);
  const tok = (await (await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "admin@example.com", password: "secret123", returnSecureToken: true }),
  })).json()).idToken;
  const patch = (mask, body) => fetch(`${FS}/results/public?${mask.map((m) => "updateMask.fieldPaths=" + m).join("&")}`, {
    method: "PATCH", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields: body }),
  }).then((r) => r.status);
  const w = (pids) => enc({ winners: pids });
  const codes = [
    await patch(["draws.grand"], { draws: { mapValue: { fields: { grand: w([P(2)]) } } } }), // 1등 바꾸기
    await patch(["draws.t6"], { draws: { mapValue: { fields: { t6: w([P(5)]) } } } }), // 6등 다시 쓰기
    await patch(["draws.seed"], { draws: { mapValue: { fields: { seed: enc("1") } } } }), // 숫자 바꾸기
    await patch(["step"], { step: enc(3) }), // 발표 진행은 계속 된다
  ];
  assert.deepEqual(codes, [403, 403, 403, 200]);
  assert.deepEqual((await H.prizeInput()).draws, draws, "추첨 결과가 그대로");
  console.log("  직접 요청: 1등 바꾸기 403, 6등 다시 쓰기 403, 숫자 바꾸기 403, 발표 진행(step)은 200");

  await browser.close();
  console.log("\n콘솔 오류·경고", errors.length, "건"); errors.slice(0, 8).forEach((e) => console.log("  ", e));
  if (errors.length) process.exit(1);
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 8).join("\n")); process.exit(1); });
