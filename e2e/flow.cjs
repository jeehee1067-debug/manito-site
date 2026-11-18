// 에뮬레이터에 붙은 개발 서버(npm run dev:emu)를 대상으로 전체 흐름을 실제 화면으로 진행한다. (운영자 비참여·피드 분리·받은 게 없어요·쪽지 더 보내기 반영판: 6명, 3개 파트)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

// 대상 이름은 기본으로 가려져 있다(내 미션 화면). "이름 보기"를 눌러 읽는다.
const readTarget = async (p) => { const b = p.locator(".target-toggle"); await b.waitFor(); if ((await b.getAttribute("aria-pressed")) !== "true") await b.click(); return (await p.locator(".target-name").innerText()).trim(); };
// 운영 화면의 초대 코드·메일은 기본으로 가려져 있다.
const showSecrets = async (p) => { for (const b of await p.getByRole("button", { name: "초대 코드·메일 보기" }).all()) await b.click(); };

const BASE = "http://localhost:5173/";
const FS = "http://127.0.0.1:8080";
const AUTH = "http://127.0.0.1:9099";
const PROJECT = "demo-manito";
const SHOT = __dirname + "/shots/flow/";
require("node:fs").mkdirSync(SHOT, { recursive: true });

const PEOPLE = [
  { name: "가나", loc: "SR3", part: "가파트", id: "user1@example.com" },
  { name: "다라", loc: "SR3", part: "가파트", id: "user2@example.com" },
  { name: "마바", loc: "S1L", part: "나파트", id: "user3@example.com" },
  { name: "사아", loc: "S1L", part: "나파트", id: "user4@example.com" },
  { name: "자차", loc: "SR3", part: "다파트", id: "user5@example.com" },
  { name: "카타", loc: "S1L", part: "다파트", id: "user6@example.com" },
];
const N = PEOPLE.length;
const PARTS = ["가파트", "나파트", "다파트"];
const partOf = Object.fromEntries(PEOPLE.map((p) => [p.name, p.part]));
const PW = "secret123";
const errors = [];
const dialogsSeen = [];
const OLD = process.env.OLD_RULES === "1"; // 콘솔에 예전 규칙이 게시된 상태를 흉내 낼 때: 새 규칙이 있어야만 되는 확인 두 가지는 기록만 한다
let shotNo = 0;

async function reset() {
  await fetch(`${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`${AUTH}/emulator/v1/projects/${PROJECT}/accounts`, { method: "DELETE" });
}
const fsVal = (v) => v.stringValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.booleanValue ?? (v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fsVal(x)])) : v.arrayValue ? (v.arrayValue.values || []).map(fsVal) : null));
const fields = (d) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fsVal(v)]));
// 참여자 계정으로 로그인해 받은 토큰으로 Firestore에 직접 요청한다(보안 규칙이 그 사람 권한으로 판단한다)
async function tokenOf(email) {
  const r = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: PW, returnSecureToken: true }),
  })).json();
  assert.ok(r.idToken, "로그인 토큰: " + email);
  return r.idToken;
}
async function getAs(token, path) {
  const r = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  return r.status === 200 ? { ok: true, data: j } : { ok: false, status: j.error?.status || r.status };
}
async function readDoc(path) {
  const r = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, { headers: { Authorization: "Bearer owner" } });
  return r.json();
}
async function newUser(browser, label) {
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on("dialog", (d) => { dialogsSeen.push(d.message()); d.accept(); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (t.includes("ERR_TUNNEL_CONNECTION_FAILED")) return; // 외부 글꼴(jsDelivr) — 이 환경 프록시 문제
    errors.push(`[${label}] ${t}`);
  });
  page.on("pageerror", (e) => errors.push(`[${label}] pageerror ${e.message}`));
  return page;
}
const panel = (page, title) => page.locator("section.panel", { has: page.locator("h2.panel-title", { hasText: title }) });
async function shot(page, name, full = true) {
  shotNo++;
  await page.screenshot({ path: `${SHOT}${String(shotNo).padStart(2, "0")}-${name}.png`, fullPage: full });
}
const tab = (page, name) => page.locator("nav.tabs button", { hasText: name }).click();
async function advance(admin, to) {
  await admin.getByRole("button", { name: `다음 단계로: ${to}` }).click();
  await admin.locator(".hud-chip", { hasText: to }).waitFor();
}
const step = (s) => console.log("▶", s);

(async () => {
  const { PROFILE_QUESTIONS } = await import(require("node:url").pathToFileURL(require("node:path").join(__dirname, "../src/lib/constants.js")).href);
  // i번째 사람이 q번 문항에 넣는 답: 고르기는 보기를 돌려 가며, 직접 쓰기는 "이름의답N"
  const answerOf = (i, q) => (PROFILE_QUESTIONS[q].options ? PROFILE_QUESTIONS[q].options[(i + q) % PROFILE_QUESTIONS[q].options.length] : `${PEOPLE[i].name}의답${q + 1}`);
  const answersOf = (name) => PROFILE_QUESTIONS.map((_, q) => answerOf(PEOPLE.findIndex((p) => p.name === name), q));

  await reset();
  const browser = await chromium.launch();

  step("첫 운영자 설정");
  const admin = await newUser(browser, "운영자");
  await admin.goto(BASE);
  assert.equal(await admin.getByRole("button", { name: "운영자·공동 운영자 계정 만들기" }).count(), 0, "기본 주소에서는 숨김");
  await admin.goto(BASE + "?setup");
  await admin.getByRole("button", { name: "운영자·공동 운영자 계정 만들기" }).click();
  await admin.getByPlaceholder("Knox ID").fill("admin1@example.com");
  await admin.locator('input[type="password"]').fill(PW);
  await admin.getByRole("button", { name: "운영자 계정 만들기" }).click();
  await panel(admin, "운영 단계").waitFor();
  assert.equal(await admin.locator(".hud-who").innerText(), "운영자");
  assert.equal(await admin.getByText("내 이름 연결").count(), 0, "운영 화면에는 초대 코드 연결 칸이 없다(운영자는 참여하지 않는다)");
  assert.equal(await admin.locator(".error.banner").count(), 0, "규칙 버전 경고 없음");
  await panel(admin, "짝 현황").getByText("아직 배정 전이에요.").waitFor();

  step("명단(파트 포함) 입력, 배정 (팀 편성 단계 없음)");
  await panel(admin, "1. 명단").locator("textarea").fill(PEOPLE.map((p) => `${p.name},${p.part},${p.id.split("@")[0]}`).join("\n"));
  await admin.getByRole("button", { name: "명단에 추가" }).click();
  await admin.getByText(`${N}명을 추가했어요.`).waitFor();
  assert.equal(await admin.getByRole("button", { name: "무작위로 팀 편성" }).count(), 0, "팀 편성 버튼 없음");
  assert.equal(await admin.getByText("팀").count(), 0, "운영 화면에 '팀' 글자 없음");
  console.log("  파트 안내:", (await panel(admin, "2. 마니또 배정").locator("p.small").last().innerText()).slice(0, 110));
  await admin.getByRole("button", { name: "배정하기" }).click();
  await admin.getByText(new RegExp(`${N}명 배정 완료`)).waitFor();
  console.log("  배정 결과 문구:", await admin.locator(".note.banner").innerText());
  assert.match(await admin.locator(".note.banner").innerText(), /다른 파트끼리, 맞마니또 없이 짝지었어요/);
  assert.ok(!dialogsSeen.some((d) => d.includes("개발자 도구")), "배정 확인창에 개발자 도구 경고가 없다");
  // 짝 현황 표: 배정 직후부터 누가 누구의 마니또인지 보인다
  await panel(admin, `짝 현황 (${N}쌍)`).waitFor();
  const pairTable = async () => {
    const tog = panel(admin, "짝 현황").getByRole("button", { name: /짝 현황 (보기|가리기)/ });
    if ((await tog.getAttribute("aria-pressed")) !== "true") await tog.click();
    await panel(admin, "짝 현황").locator("tbody tr").first().waitFor();
    const rows = {};
    for (const tr of await panel(admin, "짝 현황").locator("tbody tr").all()) {
      const c = (await tr.locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
      rows[c[0].split(" ")[0]] = { receiver: c[1].split(" ")[0], w: [c[2], c[3], c[4]], guess: c[5] };
    }
    return rows;
  };
  const adminPairs = await pairTable();
  assert.equal(Object.keys(adminPairs).length, N);
  const rcDocs = (await readDoc("receiverCodes?pageSize=50")).documents;
  assert.equal(rcDocs.length, N, "받는 사람 기준 코드 문서");
  const cfg = await readDoc("config/app");
  assert.equal(cfg.fields.partExcluded.booleanValue, true, "config.partExcluded");
  assert.equal(cfg.fields.teamExcluded, undefined, "teamExcluded는 더 쓰지 않음");
  await showSecrets(admin);
  const heads = await panel(admin, "명단 ").locator(".pk-table thead th").allInnerTexts();
  const invite = {};
  for (const r of await panel(admin, "명단 ").locator(".pk-table tbody tr").all()) {
    const cells = await r.locator("td").allInnerTexts();
    invite[cells[0]] = cells[heads.indexOf("초대 코드")];
    assert.equal(cells[heads.indexOf("파트")], partOf[cells[0]], "명단 표의 파트");
  }
  assert.ok(!heads.includes("팀"), "명단 표에 팀 열 없음");
  const rosterDocs = (await readDoc("roster?pageSize=50")).documents;
  assert.ok(rosterDocs.every((d) => d.fields.team === undefined), "명단 문서에 team 필드 없음");
  await shot(admin, "admin-setup");
  const meta = await readDoc("meta/assignment");
  const memoPids = meta.fields.pids.arrayValue.values.map((v) => v.stringValue);
  assert.deepEqual(memoPids, [...memoPids].sort(), "meta.pids 정렬");

  const users = {};
  for (const [i, p] of PEOPLE.entries()) {
    step(`${p.name} 가입·프로필`);
    const page = await newUser(browser, p.name);
    users[p.name] = page;
    await page.goto(BASE);
    await page.getByRole("tab", { name: "처음 가입" }).click();
    await page.getByPlaceholder("운영진에게 받은 6자리").fill(invite[p.name]);
    await page.getByPlaceholder("Knox ID").fill(p.id);
    await page.locator('input[type="password"]').fill(PW);
    await page.getByRole("button", { name: "가입하기" }).click();
    await page.locator("nav.tabs button", { hasText: "내 미션" }).waitFor();
    await tab(page, "내 프로필");
    await page.locator(".avatar-cell").nth(i % 4).click();
    const qs = page.locator(".profile-q");
    if (i === 0) {
      // 형식 검사: 고르기를 안 고르면, 직접 쓰기가 한 글자면 저장되지 않는다
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await page.getByText("1번은 보기 중에서 골라 주세요.").waitFor();
    }
    for (let q = 0; q < 6; q++) {
      if (PROFILE_QUESTIONS[q].options) await qs.nth(q).getByRole("radio", { name: answerOf(i, q), exact: true }).click();
      else await qs.nth(q).locator("input").fill(i === 0 && q === 3 ? "." : answerOf(i, q));
    }
    if (i === 0) {
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await page.getByText("4번은 2자 이상 적어 주세요.").waitFor();
      console.log("  프로필 형식 검사: 안 고른 보기·한 글자 답은 저장 안 됨");
      await qs.nth(3).locator("input").fill(answerOf(i, 3));
    }
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByText("저장했어요. 내 대상에게 갈 단서도 준비됐어요.").waitFor();
    if (i === 0) await shot(page, "profile");
  }

  step("공지 올리기, 미션 진행 시작");
  await panel(admin, "공지").locator("textarea").fill("1주차 미션은 금요일까지! 받은 미션은 추리 보드에서 인증해 주세요.");
  await panel(admin, "공지").getByRole("button", { name: "공지 올리기" }).click();
  await users["가나"].locator(".notice-banner", { hasText: "1주차 미션은 금요일까지!" }).waitFor();
  console.log("  참여자 화면 공지:", await users["가나"].locator(".notice-banner").innerText());
  await advance(admin, "미션 진행");

  const target = {};
  for (const p of PEOPLE) {
    const page = users[p.name];
    await tab(page, "내 미션");
    await page.locator(".target-name").waitFor();
    target[p.name] = await readTarget(page);
  }
  console.log("  화면에 나온 짝(마니또 → 대상):", target);
  const giverOf = Object.fromEntries(Object.entries(target).map(([g, r]) => [r, g]));
  assert.equal(new Set(Object.values(target)).size, N, "대상 중복 없음");
  for (const [g, r] of Object.entries(target)) { assert.notEqual(g, r); assert.notEqual(target[r], g, "맞마니또 없음"); assert.notEqual(partOf[g], partOf[r], "같은 파트끼리 짝이 됨"); }
  console.log("  같은 파트끼리 짝이 된 경우 0건");
  for (const [g, r] of Object.entries(target)) assert.equal(adminPairs[g].receiver, r, `운영 화면 짝 현황: ${g}의 대상`);
  console.log("  운영 화면 '짝 현황' 표의 6쌍이 참여자 화면의 대상과 모두 같음");
  const pidOf = Object.fromEntries((await readDoc("roster?pageSize=50")).documents.map((d) => [d.fields.name.stringValue, d.name.split("/").pop()]));
  const uidOf = Object.fromEntries((await readDoc("roster?pageSize=50")).documents.map((d) => [d.fields.name.stringValue, d.fields.uid.stringValue]));

  step("추리 보드: 처음부터 우리 파트는 후보에서 빠짐 / 파트 순위 탭: 아직 발표 전");
  for (const p of PEOPLE) {
    const page = users[p.name];
    await tab(page, "추리 보드");
    const board = panel(page, "용의자 보드");
    await board.getByText("우리 파트 사람은 내 마니또가 될 수 없어서 처음부터 빠져 있어요.").waitFor();
    const names = await board.locator(".suspect span").allInnerTexts();
    const want = PEOPLE.filter((x) => x.part !== p.part).map((x) => x.name).sort((a, b) => a.localeCompare(b, "ko"));
    assert.deepEqual(names, want, `${p.name}의 처음 용의자`);
    assert.equal(await page.locator("nav.tabs button", { hasText: "우리 팀" }).count(), 0, "'우리 팀' 탭 없음");
    await tab(page, "파트 순위");
    await panel(page, "파트 순위").getByText("아직 발표된 순위가 없어요.").waitFor();
    await tab(page, "내 미션");
  }
  console.log("  6명 모두: 용의자 4명(다른 두 파트), 파트 순위는 발표 전 안내");

  step("규칙 탭");
  {
    const page = users["다라"];
    await tab(page, "규칙");
    await panel(page, "응모권 받는 법 (최대 17장, 수호천사는 +2장)").waitFor();
    await panel(page, "파트 대항전").getByText("같은 파트끼리는 마니또가 되지 않아요.").waitFor();
    await panel(page, "응모권 받는 법").getByText("마지막 집계에서 미션 완수율 1위").waitFor();
    await panel(page, "응모권 받는 법").getByText("끝까지 해야 받는 것이 있어요.").waitFor();
    await panel(page, "미션 카드 난이도").getByText(/분석실 신발장을 이용해 보세요/).waitFor();
    await panel(page, "응모권 받는 법").getByText("내 미션 3건이 모두 인증되고").waitFor();
    await panel(page, "상품과 추첨").getByText("한 사람은 하나만 받아요.").waitFor();
    await panel(page, "상품과 추첨").getByText("각자 응모권 수만큼 자기 이름 종이를 통에 넣고 직접 뽑아요").waitFor();
    {
      // 금액·인원은 1등만 알린다: 나머지 상은 "추후 공지"
      const prizeRows = (await panel(page, "상품과 추첨").locator(".rules-table tr").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
      assert.match(prizeRows[0], /^1등 대추첨 1명, 50만원 상품권 /);
      assert.equal(prizeRows.filter((t) => t.includes("추후 공지")).length, 5, prizeRows.join(" | "));
      assert.equal(await panel(page, "상품과 추첨").getByText(/10만원|5만원|1만원|커피 쿠폰/).count(), 0, "2~6등의 금액은 아직 보이지 않는다");
      assert.equal(await page.getByText("사이트 관리 계정").count(), 0, "사이트 관리 계정 설명은 지웠다");
    }
    assert.equal(await page.getByText("투표").count(), 0, "규칙 탭에 '투표' 글자 없음(투표는 없앰)");
    assert.equal(await page.getByText("팀").count(), 0, "규칙 탭에 '팀' 글자 없음");
    await panel(page, "단서와 최종 지목").getByText("마니또의 파트").waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "규칙 탭: 휴대폰 폭에서 가로 스크롤 없음(표가 화면 밖으로 밀리지 않음)");
    await shot(page, "rules");
    await tab(page, "내 미션");
    // 내 응모권: 미션 3건이 모두 인증되기 전에는 "끝까지 해야 받는 응모권" 안내가 보인다
    const mine = panel(page, "내 응모권 (지금까지)");
    await mine.getByText("끝까지 해야 받는 응모권").waitFor();
    const warn = (await mine.locator(".warn-line").innerText()).replace(/\s+/g, " ");
    assert.match(warn, /은신 \+2장은 미션 3건이 모두 인증돼야 받아요 \(지금 인증 \d건/, warn);
    console.log("  내 미션 화면:", warn);
  }

  step("가나 1주차: 난이도 고르기 → 카드 두 장 → 도전 카드 고르고 완료");
  {
    const page = users["가나"];
    const slot = panel(page, "1주차 미션");
    // 처음에는 난이도 세 칸만 보이고 카드는 아직 없다
    assert.equal(await slot.locator(".level-pick").count(), 3);
    assert.equal(await slot.locator(".dealt .card").count(), 0);
    await slot.locator(".tip-line", { hasText: "분석실 신발장" }).waitFor(); // 난이도 고르기 화면의 작은 꿀팁
    await shot(page, "levels");
    const dealt = async (level) => {
      await slot.locator(`.level-pick.level-${level}`).click();
      await slot.locator(".dealt .card").first().waitFor();
      const texts = await slot.locator(".dealt .card .card-text").allInnerTexts();
      const free = await slot.locator(".dealt .card:not(:has(.cost-tag))").count();
      assert.equal(texts.length, 2, `${level} 카드는 두 장`);
      assert.equal(new Set(texts).size, 2);
      assert.equal(free, 1, "돈이 안 드는 카드 한 장");
      assert.equal(texts.length - free, 1, "돈이 드는 카드 한 장(모두에게 비용 카드가 나오게)");
      assert.equal(await slot.getByRole("button", { name: /다른 .* 카드 보기/ }).count(), 0, "다시 뽑는 버튼은 없다");
      assert.equal(await slot.locator(".tip-line", { hasText: "분석실 신발장" }).count(), 1, "카드 두 장 화면의 작은 꿀팁(비용 카드는 실물)");
      await slot.getByRole("button", { name: "난이도 다시 고르기" }).click();
      await slot.locator(".level-pick").first().waitFor();
      return texts;
    };
    const normal1 = await dealt("normal");
    const normal2 = await dealt("normal");
    assert.deepEqual(normal2, normal1, "난이도를 다시 골라도 같은 두 장");
    console.log("  보통 카드 두 장(다시 골라도 같음):", normal1.join(" / "));
    await slot.locator(".level-pick.level-hard").click();
    await slot.locator(".dealt .card").first().waitFor();
    await shot(page, "cards");
    await slot.getByRole("button", { name: "난이도 다시 고르기" }).click();
  }
  let ganaCost = 0; // 가나가 고른 도전 카드가 "소액 비용" 카드면 비용 카드 추가분 +1
  for (const p of PEOPLE) {
    const page = users[p.name];
    const slot = panel(page, "1주차 미션");
    await require("./helpers.cjs").pickCard(slot, p.name === "가나" ? "hard" : "easy");
    if (p.name === "가나") ganaCost = (await slot.locator(".chosen .cost-tag").count()) > 0 ? 1 : 0;
    if (p.name === "가나") {
      // 실물 카드를 고르면 꿀팁(분석실 신발장)이 보인다. 쪽지만으로 끝나는 카드면 안 보인다
      const MC = (await import("../src/lib/constants.js")).MISSION_CARDS;
      const chosenText = (await slot.locator(".chosen span").nth(1).innerText()).trim();
      const real = Boolean(MC.hard.find((c) => c.text === chosenText)?.real);
      assert.equal(await slot.getByText(/분석실 신발장을 이용해 보세요/).count(), real ? 1 : 0, `실물(${real}) 카드의 꿀팁`);
    }
    const box = slot.locator('input[type="checkbox"]');
    if (!(await box.isChecked())) await box.check();
    await slot.locator("textarea").fill(`${p.name}가 보낸 1주차 쪽지`);
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await panel(page, "1주차 미션 ✔").waitFor();
  }

  step("받는 사람: 미인증 알림 → 인증 → 알림 사라짐");
  for (const p of PEOPLE) {
    const page = users[p.name];
    await tab(page, "내 미션");
    await page.getByText("내 마니또가 보낸 미션 1건을 아직 인증하지 않았어요.").waitFor();
    await tab(page, "추리 보드");
    const inbox = panel(page, "마니또에게서 온 것");
    await inbox.locator("strong.mono").first().waitFor();
    const code = await inbox.locator("strong.mono").first().innerText();
    const entry = panel(page, "인증하기");
    if (p.name === "가나") {
      // 아직 열리지 않은 주차(2주차)의 코드는 인증되지 않는다
      const code2 = fields(await readDoc("giverCodes/" + pidOf[giverOf[p.name]])).codes["2"];
      await entry.getByPlaceholder("K7Q2").fill(code2);
      await entry.locator("textarea").fill("아직 열리지 않은 주차의 코드를 미리 넣어 보는 중이에요.");
      await entry.getByRole("button", { name: "인증하기" }).click();
      await page.getByText("2주차 코드예요. 2주차가 열리면 인증할 수 있어요.").waitFor();
      console.log("  1주차에 2주차 코드를 넣으면: 2주차 코드예요. 2주차가 열리면 인증할 수 있어요.");
    }
    await entry.getByPlaceholder("K7Q2").fill(code.toLowerCase());
    await entry.locator("textarea").fill(`${giverOf[p.name]}님 덕분에 오늘 하루가 즐거웠어요. 정말 고마워요!`);
    await entry.getByRole("button", { name: "인증하기" }).click();
    await page.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    await tab(page, "내 미션");
    await page.locator(".target-name").waitFor();
    await page.waitForTimeout(400);
    assert.equal(await page.getByText("아직 인증하지 않았어요").count(), 0, "인증 후 알림 사라짐");
  }
  {
    const g = users["가나"];
    const t = panel(g, "내 응모권");
    await t.getByText("마니또로서: 인증된 미션 1 / 3 + 카드 추가분 2 / 6(보통 +1, 도전 +2)").waitFor();
    await t.getByText("받는 사람으로서: 인증 입력 1 / 3").waitFor();
    await t.getByText("우리 파트가 완수율 1위면 +1").waitFor();
    await t.getByText(`비용 카드 ${ganaCost} / 1`).waitFor();
    assert.equal((await t.locator(".ticket-count").innerText()).replace(/\s/g, ""), `${4 + ganaCost}장`);
    console.log(`  가나 내 응모권(지금까지): ${4 + ganaCost}장 = 미션 1 + 카드 추가분 2(도전) + 비용 카드 ${ganaCost} + 인증 입력 1`);
    await shot(g, "my-mission");
  }

  step("익명 피드: 받는 사람 정보가 없는 별도 문서, 인증 문서·명단 원본은 남이 못 읽음");
  {
    const feedDocs = (await readDoc("feed?pageSize=50")).documents;
    assert.equal(feedDocs.length, N, "피드 글 수");
    for (const d of feedDocs) assert.deepEqual(Object.keys(d.fields).sort(), ["createdAt", "review", "slot", "voided"], "피드 문서 필드");
    const redDocs = (await readDoc("redemptions?pageSize=50")).documents;
    assert.ok(redDocs.every((d) => !feedDocs.some((f) => f.name.split("/").pop() === d.name.split("/").pop())), "피드 문서 ID는 인증 코드가 아님");
    console.log(`  피드 문서 ${feedDocs.length}건: 필드는 createdAt·review·slot·voided뿐(받는 사람·코드 없음), 문서 ID도 코드와 다름`);
    // 마바 계정으로 직접 요청
    const tok = await tokenOf("user3@example.com");
    const myCode = redDocs.find((d) => d.fields.receiverPid.stringValue === pidOf["마바"]).name.split("/").pop();
    const otherCode = redDocs.find((d) => ![pidOf["마바"], pidOf[target["마바"]]].includes(d.fields.receiverPid.stringValue)).name.split("/").pop();
    const givenCode = redDocs.find((d) => d.fields.receiverPid.stringValue === pidOf[target["마바"]]).name.split("/").pop(); // 마바가 보낸 미션의 인증
    const res = {
      "피드 목록": (await getAs(tok, "feed?pageSize=5")).ok,
      "내가 입력한 인증": (await getAs(tok, "redemptions/" + myCode)).ok,
      "내 미션의 인증(내가 마니또)": (await getAs(tok, "redemptions/" + givenCode)).ok,
      "남의 인증": (await getAs(tok, "redemptions/" + otherCode)).status,
      "인증 전체 목록": (await getAs(tok, "redemptions?pageSize=5")).status,
      "명단 원본(내 것)": (await getAs(tok, "roster/" + pidOf["마바"])).status,
      "명단 원본 목록": (await getAs(tok, "roster?pageSize=5")).status,
      "명단 요약": (await getAs(tok, "public/roster")).ok,
    };
    console.log("  마바 계정으로 직접 읽기:", JSON.stringify(res));
    assert.deepEqual(res, { "피드 목록": true, "내가 입력한 인증": true, "내 미션의 인증(내가 마니또)": true, "남의 인증": "PERMISSION_DENIED", "인증 전체 목록": "PERMISSION_DENIED", "명단 원본(내 것)": "PERMISSION_DENIED", "명단 원본 목록": "PERMISSION_DENIED", "명단 요약": true });
    // 피드 화면
    const page = users["카타"];
    await tab(page, "피드");
    await panel(page, "익명 피드").locator(".dialogue").nth(N - 1).waitFor();
    assert.equal(await panel(page, "익명 피드").locator(".dialogue").count(), N);
    // 공감: 가나의 후기에 세 사람이 공감한다 — 다른 사람 1명, 글쓴이(가나), 그 미션을 한 마니또.
    // 3등(베스트 후기상)과 2등 동점 기준은 당사자 두 사람의 공감을 빼고 세므로 1표다
    const outsider = PEOPLE.map((x) => x.name).find((n) => n !== "가나" && n !== giverOf["가나"]);
    for (const who of [outsider, "가나", giverOf["가나"]]) {
      const pg = users[who];
      await tab(pg, "피드");
      const post = panel(pg, "익명 피드").locator(".dialogue", { hasText: `${giverOf["가나"]}님 덕분에` });
      await post.waitFor();
      await post.getByRole("button", { name: /공감/ }).click();
      await post.locator(".like-btn.is-on").waitFor();
      await tab(pg, "내 미션");
    }
    // 피드는 실시간으로 바뀌지 않는다: 열어 둔 화면(카타)은 "새 글 확인"을 눌러야 공감 수가 바뀐다
    await tab(page, "피드");
    const liked = panel(page, "익명 피드").locator(".dialogue", { hasText: `${giverOf["가나"]}님 덕분에` });
    await liked.waitFor();
    await panel(page, "익명 피드").getByRole("button", { name: "새 글 확인" }).click();
    await liked.getByText(/♥ 공감 3/).waitFor();
    // 감사 답장: 사아가 보내면 → 피드 글에 붙고, 미션을 보낸 마니또 화면에 보인다
    const r = users["사아"];
    await tab(r, "추리 보드");
    const mineP = panel(r, "내가 인증한 것");
    await mineP.getByRole("button", { name: "마니또에게 감사 답장 보내기" }).click();
    await mineP.locator("input.pk-input").fill("덕분에 한 주가 든든했어요!");
    await mineP.getByRole("button", { name: "보내기" }).click();
    await mineP.getByText("보낸 감사 답장: 덕분에 한 주가 든든했어요!").waitFor();
    const gv = users[giverOf["사아"]];
    await tab(gv, "피드");
    await tab(gv, "내 미션");
    await panel(gv, "1주차 미션 ✔").getByText("덕분에 한 주가 든든했어요!").waitFor();
    await tab(page, "내 미션");
    await tab(page, "피드");
    await panel(page, "익명 피드").getByText("마니또에게 보낸 답장: 덕분에 한 주가 든든했어요!").waitFor();
    console.log(`  감사 답장: 사아 → 피드 글에 붙음 → 마니또(${giverOf["사아"]})의 내 미션 화면과 피드에 보임`);
    await shot(page, "feed");
  }

  step("쪽지 더 보내기: 완료한 주차에 쪽지를 더 보낸다(3일 연속 쪽지 카드용)");
  {
    const g = users["가나"];
    await tab(g, "내 미션");
    assert.equal(await g.locator(".target-name").innerText(), "● ● ●", "대상 이름은 기본으로 가려져 있다");
    assert.equal(await g.getByText(target["가나"]).count(), 0, "가려 둔 동안 화면 어디에도 대상 이름이 없다");
    await readTarget(g); // 이름 보기(1분)
    const slot = panel(g, "1주차 미션 ✔");
    await slot.getByRole("button", { name: "쪽지 더 보내기" }).click();
    await slot.locator(".more-notes textarea").fill("둘째 날 응원이에요. 오늘도 힘내세요!");
    await slot.getByRole("button", { name: "쪽지 보내기" }).click();
    await slot.getByText(`${target["가나"]}님에게 쪽지를 보냈어요.`).waitFor();
    await slot.getByText("이 주차에 더 보낸 쪽지 1건").waitFor();
    await slot.getByRole("button", { name: "쪽지 더 보내기" }).click();
    await slot.locator(".more-notes textarea").fill("셋째 날 응원이에요. 이번 주도 수고 많았어요!");
    await slot.getByRole("button", { name: "쪽지 보내기" }).click();
    await slot.getByText("이 주차에 더 보낸 쪽지 2건").waitFor();
    assert.equal(await panel(g, "1주차 미션 ✔").locator(".chosen").count(), 1, "완료 표시와 고른 카드는 그대로");
    const r = users[target["가나"]];
    await tab(r, "내 미션");
    await tab(r, "추리 보드");
    const inbox = panel(r, "마니또에게서 온 것");
    await inbox.locator(".dialogue", { hasText: "셋째 날 응원이에요" }).waitFor();
    const speakers = await inbox.locator(".dialogue-speaker").allInnerTexts();
    assert.deepEqual(speakers.sort(), ["마니또 · 1주차", "마니또 · 1주차 쪽지", "마니또 · 1주차 쪽지"]);
    assert.equal(await inbox.locator(".report-box").count(), 0, "이미 인증한 주차에는 '받은 게 없어요'가 없다");
    await tab(admin, "운영");
    const row = (await pairTable())["가나"];
    assert.match(row.w[0], /^도전 · 인증됨 \+쪽지 2$/, row.w[0]);
    console.log(`  가나가 1주차에 쪽지 2건을 더 보냄 → ${target["가나"]}의 받은 것 3건(완료 알림 1 + 쪽지 2), 운영 화면 짝 현황: "${row.w[0]}"`);
  }

  step("운영: 최근 접속, 공동 운영자 지정·해제");
  {
    await tab(admin, "운영");
    const heads2 = await panel(admin, "받은 인증이").locator("thead th").allInnerTexts();
    const seenCells = [];
    for (const r of await panel(admin, "받은 인증이").locator("tbody tr").all()) seenCells.push((await r.locator("td").allInnerTexts())[heads2.indexOf("최근 접속")]);
    assert.deepEqual(seenCells, Array(N).fill("오늘"));
    assert.equal(heads2[0], "파트", "진행 표 첫 열은 파트");
    assert.equal(await users["다라"].locator("nav.tabs button", { hasText: "운영" }).count(), 0);
    console.log("  최근 접속 6명 '오늘'");
  }

  step("공동 운영자: 참여하지 않는 계정을 '연결 전' 화면의 계정 번호로 지정");
  const co = await newUser(browser, "공동 운영자");
  {
    await co.goto(BASE + "?setup");
    await co.getByRole("button", { name: "운영자·공동 운영자 계정 만들기" }).click();
    await co.getByPlaceholder("Knox ID").fill("coadmin@example.com");
    await co.locator('input[type="password"]').fill(PW);
    await co.getByRole("button", { name: "운영자 계정 만들기" }).click();
    // 이미 운영자가 있으므로 운영자가 되지 않고 "연결 전" 화면이 나온다
    await panel(co, "공동 운영자로 지정받을 계정이라면").waitFor();
    assert.equal(await co.locator("nav.tabs button").count(), 0, "연결 전 계정에는 메뉴가 없다");
    const accountNo = (await co.locator(".account-no strong").innerText()).trim();
    assert.match(accountNo, /^[A-Za-z0-9]{20,40}$/);
    const coTok = await tokenOf("coadmin@example.com");
    assert.equal((await getAs(coTok, "assignments?pageSize=5")).status, "PERMISSION_DENIED", "지정 전에는 짝을 못 읽는다");
    console.log("  연결 전 화면의 계정 번호:", accountNo.slice(0, 6) + "…", `(${accountNo.length}자)`);

    await tab(admin, "운영");
    const cp = panel(admin, "공동 운영자");
    // 참여자(명단에 연결된 계정)는 지정할 수 없다
    await cp.getByLabel("공동 운영자 계정 번호").fill(uidOf["다라"]);
    await cp.getByRole("button", { name: "공동 운영자로 지정" }).click();
    await cp.getByText("다라님으로 명단에 연결된 계정이에요. 참여자는 운영자가 될 수 없어요").waitFor();
    await cp.getByLabel("공동 운영자 계정 번호").fill(accountNo);
    await cp.getByLabel("공동 운영자 메모").fill("PL님");
    await cp.getByRole("button", { name: "공동 운영자로 지정" }).click();
    await panel(admin, "공동 운영자 (운영자 2명)").waitFor();
    await cp.locator(".admin-list li", { hasText: "PL님" }).waitFor();
    // 공동 운영자 화면이 운영 화면으로 바뀌고, 짝 현황이 보인다
    await co.getByRole("button", { name: "지정됐는지 다시 확인" }).click(); // 연결 전 화면은 다시 확인을 눌러야(또는 다른 창에 갔다 오면) 바뀐다
    await co.locator("nav.tabs button", { hasText: "운영" }).waitFor();
    // 메뉴가 다 그려질 때까지 잠깐 기다린 뒤 확인한다(그려지는 도중에 읽어 한 번 실패한 적이 있다)
    await co.waitForFunction(() => [...document.querySelectorAll("nav.tabs button")].map((b) => b.innerText.trim()).join("|") === "규칙|결과|운영", null, { timeout: 10000 }).catch(() => {});
    assert.deepEqual((await co.locator("nav.tabs button").allInnerTexts()).map((t) => t.trim()), ["규칙", "결과", "운영"], "운영자 메뉴(참여자 메뉴 없음)");
    await panel(co, `짝 현황 (${N}쌍)`).waitFor();
    assert.equal(await co.locator(".hud-who").innerText(), "운영자");
    assert.equal((await getAs(await tokenOf("coadmin@example.com"), "assignments?pageSize=5")).ok, true);
    // 운영자 계정은 초대 코드를 알아도 명단에 연결할 수 없다(규칙): 직접 요청해 본다
    const body = { fields: { personId: { stringValue: pidOf["가나"] }, eliminated: { arrayValue: {} } } };
    const tryLink = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/users?documentId=${accountNo}`, {
      method: "POST", headers: { Authorization: `Bearer ${await tokenOf("coadmin@example.com")}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(tryLink.status, 403, "운영자 계정의 명단 연결은 거부");
    // 참여자를 운영자로 넣는 요청도 거부(운영자 권한으로 직접 요청)
    const cfgNow = await readDoc("config/app");
    const adminsNow = cfgNow.fields.admins.arrayValue.values.map((v) => v.stringValue);
    const addParticipant = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/config/app?updateMask.fieldPaths=admins`, {
      method: "PATCH", headers: { Authorization: `Bearer ${await tokenOf("admin1@example.com")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { admins: { arrayValue: { values: [...adminsNow, uidOf["다라"]].map((x) => ({ stringValue: x })) } } } }),
    });
    assert.equal(addParticipant.status, 403, "참여자를 운영자로 지정하는 요청은 거부");
    console.log("  PL님 계정을 공동 운영자로 지정 → 그 화면에 운영 탭·짝 현황. 참여자 지정(화면·직접 요청)과 운영자 계정의 명단 연결(직접 요청)은 거부");
    await shot(co, "coadmin");
  }

  step("2주차: 가나(실물 메모로 먼저 인증된 뒤 완료 알림), 자차(완료 알림만, 받는 사람이 끝까지 인증 안 함)");
  await panel(admin, "주차").getByRole("button", { name: "2주차" }).click();
  {
    const g = users["가나"];
    await tab(g, "추리 보드");
    await tab(g, "내 미션");
    const slot = panel(g, "2주차 미션");
    await require("./helpers.cjs").pickCard(slot, "easy");
    await slot.getByRole("button", { name: "다른 카드 고르기" }).waitFor();
    const code2 = await slot.locator(".code-tag strong").innerText();
    const r = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/redemptions/${code2}`, {
      method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
      body: JSON.stringify({ fields: {
        receiverPid: { stringValue: (await readDoc("codes/" + code2)).fields.receiverPid.stringValue },
        slot: { integerValue: "2" }, review: { stringValue: "실물 메모의 코드로 먼저 인증했어요. 고마워요!" }, voided: { booleanValue: false },
        createdAt: { timestampValue: new Date().toISOString() },
      } }),
    });
    assert.equal(r.status, 200);
    await slot.getByText("이미 인증해서 카드를 바꿀 수 없어요").waitFor();
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await panel(g, "2주차 미션 ✔").waitFor();
  }
  {
    const g = users["자차"];
    await tab(g, "추리 보드");
    await tab(g, "내 미션");
    const slot = panel(g, "2주차 미션");
    await require("./helpers.cjs").pickCard(slot, "easy");
    await slot.locator(".chosen").waitFor();
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await panel(g, "2주차 미션 ✔").waitFor();
  }

  step("받은 게 없어요: 받는 사람이 신고 → 마니또 화면에 알림 → 운영자가 '못 받음'으로 확인");
  {
    const rName = target["자차"];
    const r = users[rName];
    await tab(r, "내 미션");
    await tab(r, "추리 보드");
    const box = panel(r, "마니또에게서 온 것").locator(".report-box");
    await box.getByText("2주차: 마니또가 미션을 했다고 알렸는데 아직 인증하지 않았어요.").waitFor();
    assert.equal(await box.count(), 1, "인증하지 않은 2주차만");
    await box.getByRole("button", { name: "받은 게 없어요" }).click();
    await box.getByText("받은 게 없다고 운영진에게 알렸어요.").waitFor();
    // 마니또(자차) 화면
    const g = users["자차"];
    await tab(g, "추리 보드");
    await tab(g, "내 미션");
    await readTarget(g);
    await panel(g, "2주차 미션 ✔").getByText(`${rName}님이 2주차에 받은 게 없다고 운영진에게 알렸어요.`).waitFor();
    // 운영 화면
    await tab(admin, "운영");
    const up = panel(admin, "받은 게 없어요 신고 (확인 안 한 것 1건)");
    await up.waitFor();
    const cells = (await up.locator("tbody tr").first().locator("td").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    assert.deepEqual(cells.slice(0, 3), ["2주차", rName, "자차"]);
    assert.equal(cells[4], "받은 게 없어요");
    assert.equal((await pairTable())["자차"].w[1], "쉬움 · 받은 게 없다고 신고");
    // 신고만으로는 아무것도 바뀌지 않는다. "못 받음"은 처음 운영자만 확정할 수 있다: 공동 운영자 화면에서는 버튼이 꺼져 있다
    await tab(co, "운영");
    const coUp = panel(co, "받은 게 없어요 신고 (확인 안 한 것 1건)");
    await coUp.waitFor();
    assert.ok(await coUp.getByRole("button", { name: "못 받음" }).isDisabled(), "공동 운영자는 '못 받음'을 확정할 수 없다");
    assert.ok(await coUp.getByRole("button", { name: "받았음" }).isEnabled());
    await up.getByRole("button", { name: "못 받음" }).click();
    assert.ok(dialogsSeen.some((d) => d.includes('"못 받음"으로 확정할까요?') && d.includes("두 사람 모두에게 확인한 뒤에")), "못 받음을 확정하기 전에 결과를 알리고 한 번 묻는다");
    await panel(admin, "받은 게 없어요 신고 (확인 안 한 것 0건)").waitFor();
    assert.equal((await pairTable())["자차"].w[1], "쉬움 · 못 받음 확인");
    await box.getByText("운영진 확인: 못 받은 것으로 처리됐어요.").waitFor();
    await panel(g, "2주차 미션 ✔").getByText("운영진이 전달되지 않은 것으로 확인했어요. 이 주차는 미션으로 인정되지 않아요.").waitFor();
    console.log(`  ${rName}이(가) 2주차 '받은 게 없어요' 신고 → 자차 화면에 알림 → 운영자 '못 받음' → 두 사람 화면에 확인 결과, 짝 현황 "쉬움 · 못 받음 확인"`);
    await shot(admin, "admin-report");
    // 공동 운영자 권한 빼기
    await panel(admin, "공동 운영자").locator(".admin-list li", { hasText: "PL님" }).getByRole("button", { name: "권한 빼기" }).click();
    await panel(admin, "공동 운영자 (운영자 1명)").waitFor();
    await panel(co, "공동 운영자로 지정받을 계정이라면").waitFor();
    console.log("  공동 운영자 권한을 빼면 그 계정은 다시 '연결 전' 화면");
  }

  // 여기까지 완료를 알린 수: 가나 2, 자차 2, 나머지 1. 파트 순위(2주차 기준) 손계산
  const boardText = async (page) => (await panel(page, "파트 순위").locator("ol.board li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const wantBoard = (done, week) => {
    const rows = PARTS.map((part) => {
      const mem = PEOPLE.filter((p) => p.part === part);
      const d = mem.reduce((a, p) => a + Math.min(week, done[p.name]), 0), max = mem.length * week;
      return { part, d, max, n: mem.length };
    }).sort((a, b) => b.d / b.max - a.d / a.max || a.part.localeCompare(b.part, "ko"));
    return rows.map((x) => ({ ...x, rank: 1 + rows.filter((y) => y.d / y.max > x.d / x.max).length, pct: Math.round((x.d / x.max) * 100) }));
  };
  const checkBoard = async (page, me, done, week, label) => {
    await panel(page, `파트 순위 (${week}주차 기준)`).waitFor();
    const got = await boardText(page);
    const want = wantBoard(done, week).map((x) => `${x.rank}위 ${x.part}${x.part === partOf[me] ? "우리 파트" : ""} ${x.pct}%${x.d} / ${x.max} · ${x.n}명`);
    assert.deepEqual(got.map((t) => t.replace(/ /g, "")), want.map((t) => t.replace(/ /g, "")), `${label}: ${me} 화면의 파트 순위`);
    return got;
  };
  const doneNow = { 가나: 2, 다라: 1, 마바: 1, 사아: 1, 자차: 2, 카타: 1 };

  step("파트 순위는 실시간이 아님: 미션이 진행됐어도 발표 전에는 비어 있음");
  await tab(users["마바"], "파트 순위");
  await panel(users["마바"], "파트 순위").getByText("아직 발표된 순위가 없어요.").waitFor();

  step("단서 2개 공개 → 파트 순위도 같이 발표");
  await admin.getByRole("button", { name: "이번 주 단서 2개 공개" }).click();
  await panel(admin, "단서 공개 (2 / 6)").waitFor();
  await admin.getByText("단서를 공개하고 파트 순위도 새로 발표했어요.").waitFor();
  for (const p of PEOPLE) {
    const page = users[p.name];
    await tab(page, "파트 순위");
    const got = await checkBoard(page, p.name, doneNow, 2, "첫 발표");
    if (!OLD) await panel(page, "파트 순위").getByText(`나는 지금까지 미션 ${doneNow[p.name]}건을 완료했다고 알렸어요`).waitFor();
    else if (p.name === "마바") console.log("  [예전 규칙] '나는 지금까지 n건' 줄:", await panel(page, "파트 순위").getByText("나는 지금까지 미션").count() ? "보임" : "안 보임(내 진행 문서를 못 읽음)");
    if (p.name === "마바") { console.log("  마바 화면:", got.join(" | ")); await shot(page, "part-board"); }
  }
  console.log("  6명 화면 모두 손계산과 일치 (가파트 3/4·다파트 3/4 공동 1위, 나파트 2/4 3위). 개인별 숫자는 본인 것만 표시");
  // 다른 사람의 진행 문서는 참여자 권한으로 읽을 수 없어야 한다(화면이 아니라 서버 규칙으로 막히는지)
  {
    const pids = Object.fromEntries((await readDoc("roster?pageSize=50")).documents.map((d) => [d.fields.name.stringValue, d.name.split("/").pop()]));
    // 마바의 계정으로 로그인해 받은 토큰으로 Firestore에 직접 요청한다(보안 규칙이 그 사람 권한으로 판단한다)
    const login = await (await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user3@example.com", password: PW, returnSecureToken: true }),
    })).json();
    assert.ok(login.idToken, "마바 로그인 토큰");
    const asMaba = async (pid) => {
      const r = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/progress/${pid}`, { headers: { Authorization: `Bearer ${login.idToken}` } });
      const j = await r.json();
      return r.status === 200 ? `읽힘(doneCount ${j.fields?.doneCount?.integerValue})` : j.error?.status === "PERMISSION_DENIED" ? "permission-denied" : `HTTP ${r.status}`;
    };
    const denied = { other: await asMaba(pids["사아"]), mine: await asMaba(pids["마바"]) };
    console.log("  마바 계정으로 직접 읽기 — 같은 파트 사아의 진행:", denied.other, "/ 내 진행:", denied.mine, denied.error || "");
    if (!OLD) {
      assert.equal(denied.other, "permission-denied", "남의 진행 문서는 읽을 수 없어야 함");
      assert.match(String(denied.mine), /읽힘/);
    }
  }
  for (const p of PEOPLE) {
    const page = users[p.name];
    await tab(page, "내 미션");
    await tab(page, "추리 보드");
    const clues = panel(page, "단서 2 / 6");
    await clues.waitFor();
    const want = answersOf(giverOf[p.name]);
    await clues.locator(".clue-a", { hasText: want[1] }).first().waitFor({ timeout: 5000 });
    const answers = await clues.locator(".clue-a").allInnerTexts();
    assert.deepEqual(answers.slice(0, 3), [want[0], want[1], "잠김"], `${p.name}의 단서`);
    assert.equal(answers[6], "잠김 (최종 지목이 열리면 공개)", "파트 단서는 아직 잠김");
  }
  console.log("  단서: 각자 자기 마니또가 고른 답 1·2번만 보이고, 나머지와 파트 단서는 잠김");

  step("3주차 (다라): 칭찬 한 줄 + 도전 카드(돈 안 드는 쪽) → 대상이 카드와 같다고 인증 → 카드 추가분 +2");
  await panel(admin, "주차").getByRole("button", { name: "3주차" }).click();
  let daraHard = "";
  {
    const g = users["다라"];
    await tab(g, "추리 보드");
    await tab(g, "내 미션");
    const slot = panel(g, "3주차 공통 미션");
    // 3주차 고르기: 칭찬만 / 칭찬 + 보통 / 칭찬 + 도전
    await slot.locator(".level-pick").first().waitFor();
    assert.deepEqual((await slot.locator(".level-pick .card-level").allInnerTexts()), ["칭찬만", "보통", "도전"]);
    assert.deepEqual((await slot.locator(".level-pick .card-reward").allInnerTexts()), ["응모권 +1", "응모권 +2", "응모권 +3"]);
    await slot.locator(".level-pick.level-hard").click();
    await slot.locator(".dealt .card:not(:has(.cost-tag))").click();
    daraHard = (await slot.locator(".chosen span").nth(1).innerText()).trim();
    await slot.locator("textarea").fill("올해 늘 웃으며 도와줘서 정말 고마웠어요!");
    await slot.getByRole("button", { name: "칭찬 보내고 미션 완료 알리기" }).click();
    await panel(g, "3주차 공통 미션: 올해의 칭찬 한 줄 ✔").waitFor();
    const r = users[target["다라"]];
    await tab(r, "피드");
    await tab(r, "추리 보드");
    const inbox = panel(r, "마니또에게서 온 것");
    await inbox.locator(".dialogue.gold strong.mono").waitFor();
    await inbox.getByText(`마니또가 고른 카드: 도전 · ${daraHard}`).waitFor();
    const code = await inbox.locator(".dialogue.gold strong.mono").innerText();
    const entry = panel(r, "인증하기");
    await entry.getByPlaceholder("K7Q2").fill(code);
    await entry.locator(".card-check").getByText(daraHard).waitFor(); // 3주차도 고른 카드를 보고 확인한다
    assert.ok(await entry.getByRole("checkbox", { name: /받은 것이 이 카드 내용과 같아요/ }).isChecked());
    await entry.locator("textarea").fill("칭찬 카드 받고 눈물 날 뻔했어요. 고마워요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await r.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    console.log(`  다라 3주차: 칭찬 + 도전 카드("${daraHard}") → 대상이 카드를 보고 같다고 인증`);
  }

  step("파트 순위는 다시 발표하기 전까지 그대로 → '파트 순위만 다시 발표' 후 바뀜");
  {
    const page = users["사아"];
    await tab(page, "파트 순위");
    await page.waitForTimeout(1500);
    await checkBoard(page, "사아", doneNow, 2, "다라가 3주차 미션을 한 뒤(발표 전)"); // 다라의 3주차 완료가 아직 반영되지 않음
    doneNow["다라"] = 2;
    await tab(admin, "운영");
    await panel(admin, "파트 순위 발표").getByRole("button", { name: "파트 순위만 다시 발표" }).click();
    await admin.getByText("파트 순위를 새로 발표했어요.").waitFor();
    const got = await checkBoard(page, "사아", doneNow, 3, "다시 발표 후");
    console.log("  다시 발표 후 사아 화면:", got.join(" | "));
    console.log("  운영 화면 발표 내용:", (await panel(admin, "파트 순위 발표").locator("ul").innerText()).replace(/\n/g, " / "));
  }

  step("마바가 3주차 칭찬 카드를 보냄(끝까지 인증 안 됨) → 미션 마감 때 파트 순위가 자동으로 마지막 발표됨");
  {
    const g = users["마바"];
    await tab(g, "추리 보드");
    await tab(g, "내 미션");
    const slot = panel(g, "3주차 공통 미션");
    await slot.locator(".level-pick.level-easy").click(); // 칭찬만
    await slot.locator("textarea").fill("늘 먼저 인사해 줘서 고마웠어요. 내년에도 잘 부탁해요!");
    await slot.getByRole("button", { name: "칭찬 카드 보내기" }).click();
    await panel(g, "3주차 공통 미션: 올해의 칭찬 한 줄 ✔").waitFor();
    doneNow["마바"] = 2;
  }
  await advance(admin, "최종 지목");
  {
    const page = users["자차"];
    await tab(page, "파트 순위");
    const got = await checkBoard(page, "자차", doneNow, 3, "미션 마감 뒤");
    console.log("  미션 마감 뒤 자차 화면(따로 발표 버튼을 누르지 않음):", got.join(" | "));
  }

  step("최종 지목: 파트 단서 공개, 용의자 보드가 그 파트로 좁혀짐");
  await panel(admin, `최종 지목 중 (안 한 사람 ${PEOPLE.length}명)`).waitFor();
  const correct = new Set();
  let notGuessed = 0;
  for (const p of PEOPLE) {
    const page = users[p.name];
    await tab(page, "내 미션");
    await tab(page, "추리 보드");
    const giver = giverOf[p.name];
    const hint = panel(page, "단서").locator("li.part-hint .clue-a");
    await hint.waitFor();
    await page.waitForFunction((want) => document.querySelector("li.part-hint .clue-a")?.textContent === want, partOf[giver], { timeout: 6000 });
    const names = await panel(page, "용의자 보드").locator(".suspect span").allInnerTexts();
    const expectNames = PEOPLE.filter((x) => x.name !== p.name && x.part === partOf[giver]).map((x) => x.name).sort((a, b) => a.localeCompare(b, "ko"));
    assert.deepEqual(names, expectNames, `${p.name}의 용의자`);
    assert.ok(names.includes(giver));
    assert.equal(names.length, 2, "파트 단서 뒤에는 그 파트 2명만 남음");
    const wantCorrect = p.name === "가나" || p.name === "마바";
    const wrong = names.find((n) => n !== giver);
    if (p.name === "카타") { notGuessed++; p.guess = "(지목 안 함)"; continue; } // 한 명은 지목하지 않는다
    const pick = wantCorrect ? giver : wrong;
    await page.locator("select.pk-input").selectOption({ label: pick });
    await page.getByRole("button", { name: "이 사람으로 지목" }).click();
    await page.getByText("지목했어요. 마감 전까지는 바꿀 수 있어요.").waitFor();
    p.guess = pick;
    if (pick === giver) correct.add(p.name);
    if (p.name === "가나") await shot(page, "detective-hint");
  }
  await panel(admin, `최종 지목 중 (안 한 사람 ${notGuessed}명)`).waitFor();
  {
    const t = await pairTable();
    for (const g of Object.keys(target)) {
      const rp = PEOPLE.find((x) => x.name === target[g]);
      const want = rp.guess === "(지목 안 함)" ? "지목 안 함" : `${rp.guess} (${rp.guess === g ? "정답" : "오답"})`;
      assert.equal(t[g].guess, want, `짝 현황의 지목 열: ${g} 줄`);
    }
    console.log("  운영 화면 짝 현황 '대상의 지목' 열이 6명의 지목(정답·오답·안 함)과 같음");
    await shot(admin, "admin-pairs");
  }
  console.log("  파트 단서·용의자 좁히기 확인. 지목:", Object.fromEntries(PEOPLE.map((p) => [p.name, `${p.guess}${correct.has(p.name) ? "(정답)" : ""}`])), `/ 운영 화면: 안 한 사람 ${notGuessed}명`);

  step("마감 → 집계 → 공개");
  await advance(admin, "마감");
  // 투표는 없앴다: 마감 단계에도 참여자 메뉴에 투표 탭이 없고, 운영 화면에 투표 카드 패널이 없다
  for (const p of PEOPLE) assert.equal(await users[p.name].locator("nav.tabs button", { hasText: "투표" }).count(), 0, `${p.name}: 투표 탭 없음`);
  assert.equal(await panel(admin, "투표 카드").count(), 0);
  console.log("  마감 단계: 참여자 메뉴에 투표 탭 없음, 운영 화면에 투표 카드 패널 없음");
  await advance(admin, "집계");
  // 집계 전 확인: 자차의 2주차(못 받음 확인)만 나온다.
  // 마바의 3주차 칭찬 카드(받는 사람이 인증 안 함)는 사이트로 전달된 것이라 자동으로 인정되어 확인할 목록에 없다
  {
    const up = panel(admin, "집계 전 확인: 인증이 없는 완료 알림 (확인 안 한 것 0건)");
    await up.waitFor();
    const list = [];
    for (const tr of await up.locator("tbody tr").all()) list.push((await tr.locator("td").allInnerTexts()).slice(0, 3).join(" "));
    assert.deepEqual(list, [`2주차 ${target["자차"]} 자차`]);
    await up.getByText("3주차 칭찬 카드 1건은 사이트로 전달된 것이라 인증이 없어도 자동으로 인정돼요").waitFor();
    console.log("  집계 전 확인: 마바의 3주차(칭찬 카드, 인증 없음)는 자동 인정이라 목록에 없음. 확인 안 한 것 0건");
  }
  // 집계 없이 공개 단계로 넘어갈 수 없다
  await admin.getByRole("button", { name: "다음 단계로: 공개" }).click();
  await panel(admin, "다음 단계로 넘기기").getByText("아직 집계하지 않았어요.").waitFor();
  await admin.locator(".hud-chip", { hasText: "집계" }).waitFor();
  {
    const direct = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/config/app?updateMask.fieldPaths=phase`, {
      method: "PATCH", headers: { Authorization: `Bearer ${await tokenOf("admin1@example.com")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { phase: { integerValue: "5" } } }),
    });
    assert.equal(direct.status, 403, "집계 결과 없이 공개로 넘기는 직접 요청도 거부");
    console.log("  집계 전에 '다음 단계로: 공개' → 화면이 막고(아직 집계하지 않았어요), 직접 요청도 거부(403)");
  }
  await admin.getByRole("button", { name: "집계하기" }).click();
  await admin.getByText(/^응모권 상위/).waitFor();
  const scoreText = (await panel(admin, "집계").locator("ul.plain").first().innerText()).replace(/\n/g, " / ");
  {
    // 현장 종이 추첨용 이름 종이: 사람마다 응모권 수만큼(인쇄해서 잘라 통에 넣는다)
    const sp = panel(admin, "집계");
    const m = (await sp.getByText(/이름 종이 \d+장\(응모권 1장 = 종이 1장\)/).innerText()).match(/응모권이 있는 사람 (\d+)명, 이름 종이 (\d+)장/);
    await sp.getByRole("button", { name: `이름 종이 ${m[2]}장 보기` }).click();
    assert.equal(await sp.locator(".slips .slip").count(), +m[2], "이름 종이 수 = 응모권 합계");
    const saved = fields(await readDoc("results/public")).tickets;
    assert.equal(+m[2], Object.values(saved).reduce((a, b) => a + b, 0));
    assert.equal(+m[1], Object.values(saved).filter((n) => n > 0).length);
    await sp.getByRole("button", { name: "이름 종이 접기" }).click();
    console.log(`  종이 추첨 준비: 응모권이 있는 ${m[1]}명, 이름 종이 ${m[2]}장(응모권 합계와 같음)`);
  }
  console.log("  ", scoreText);
  // 3등 베스트 후기상은 운영자가 고르지 않는다: 공감을 가장 많이 받은 후기(자기 공감 제외)
  assert.equal(await panel(admin, "베스트 후기상 고르기").count(), 0, "운영자가 후기를 고르는 칸이 없다");
  assert.match(scoreText, /3등 베스트 후기상: 가나 \(♥ 1, 당사자 공감 제외\)/, "공감 3개 중 글쓴이와 그 미션의 마니또가 누른 2개는 뺀다");
  await advance(admin, "공개");
  step("송년회 발표 화면: 넘긴 장면까지만 참여자 결과 탭에 열린다, 짝은 원을 따라 공개, 추첨도 발표 화면에서");
  for (const p of PEOPLE) await tab(users[p.name], "결과");
  {
    const g = users["가나"];
    await g.getByText("무대에서 공개돼요").waitFor();
    await g.getByText(/지금 무대에서 결과를 발표하고 있어요/).waitFor();
    assert.equal(await panel(g, "누가 누구의 마니또였을까").count(), 0);
    assert.equal(await panel(g, "그 밖의 기록").count(), 0);
    assert.equal(await panel(g, "추첨·시상").locator(".winner").count(), 0);
    assert.equal(await panel(g, "추첨·시상").getByText("시상 전", { exact: true }).count(), 6, "1~6등 모두 시상 전");
    assert.equal(await panel(g, "파트 대항전 최종 순위").count(), 0);
    console.log("  발표 전 참여자 결과 탭: '무대에서 공개돼요', 짝·시상·파트 순위 없음");
  }
  await tab(admin, "결과");
  await panel(admin, "발표 화면").getByRole("button", { name: "발표 화면 열기" }).click();
  const pres = admin.locator(".presenter");
  await pres.waitFor();
  const next = async () => { await pres.getByRole("button", { name: "다음 ▶" }).click(); await admin.waitForTimeout(150); };
  await pres.locator(".pres-title", { hasText: "결과 발표" }).waitFor();
  console.log("  1장(숫자):", (await pres.locator(".pres-stats").innerText()).replace(/\s+/g, " "));
  await next(); await pres.getByText("파트 대항전 최종 순위").waitFor();
  await next(); await pres.getByText("우승 파트는…").waitFor(); await pres.locator(".pres-title", { hasText: "가파트" }).waitFor();
  await next(); await pres.getByText("이제 정체를 공개합니다").waitFor();
  const chain = [];
  for (let k = 0; k < N; k++) {
    await next();
    const ask = await pres.locator(".pres-title").innerText();
    const rName = ask.replace(/님의 마니또는…\?$/, "").trim();
    if (k > 0) assert.equal(rName, chain[k - 1][1], "공개된 마니또가 다음 차례의 주인공");
    await next();
    await pres.locator(".pres-kicker", { hasText: `${rName}님의 마니또는` }).waitFor();
    const gName = (await pres.locator(".pres-title").innerText()).trim();
    assert.equal(gName, giverOf[rName], `${rName}의 마니또`);
    chain.push([rName, gName]);
    if (k === 0) {
      await users[rName].locator(".target .target-name", { hasText: gName }).waitFor();
      assert.equal(await users[gName].locator(".target .target-name").innerText(), "무대에서 공개돼요");
      console.log(`  첫 짝 공개 → ${rName}의 휴대폰에만 마니또(${gName})가 열리고, ${gName}의 휴대폰은 아직 가려져 있음`);
    }
  }
  console.log("  짝 공개 순서:", chain.map(([r, g]) => `${r}←${g}`).join(" → "));
  await next(); await pres.getByText("명탐정").waitFor();
  console.log("  명탐정:", (await pres.locator(".pres-center").innerText()).replace(/\s+/g, " "));
  await next(); await pres.getByText("칭찬 벽").waitFor();
  // 시상: 숫자 정하기 → 2등(한 명씩) → 3등 → 4등·5등(종이로 뽑힌 이름 입력) → 1등(종이, 겹쳐도 됨) → 겹친 자리 다시 채우기 → 6등(사이트 추첨)
  // 6명뿐이라 상이 사람보다 많다(자리가 남는다). 사람이 넉넉한 경우의 다시 뽑기는 awards.cjs가 확인한다.
  const S = await import("../src/lib/scoring.js"); // 저장된 값(숫자·종이로 뽑힌 이름)에서 정해지는 수상자를 같은 규칙으로 계산해 화면과 비교한다
  const SEED = "4821";
  const gPrize = panel(users["가나"], "추첨·시상");
  const nameByPid = Object.fromEntries(PEOPLE.map((x) => [pidOf[x.name], x.name]));
  const prizeIn = async () => { const r = fields(await readDoc("results/public")); return { tickets: r.tickets, tieBreak: r.tieBreak || {}, reviews: r.reviewRank || [], draws: r.draws || {} }; };
  const names = (list) => list.map((pid) => nameByPid[pid]);
  const presNames = async () => (await pres.locator(".pres-person b").allInnerTexts()).map((t) => t.trim());
  const phoneWinners = () => gPrize.locator(".winner").count();
  const phoneBecomes = async (want, label) => {
    for (let k = 0; k < 60 && (await phoneWinners()) !== want; k++) await users["가나"].waitForTimeout(150);
    assert.equal(await phoneWinners(), want, label);
  };
  const nextBtn = pres.getByRole("button", { name: "다음 ▶" });
  // 종이로 뽑힌 이름 입력: 이름을 치면 후보가 나오고 누르면 들어간다
  const enter = async (name) => { await pres.locator(".name-input").fill(name); await pres.locator(".name-hits button", { hasText: name }).first().click(); };

  await next(); await pres.locator(".pres-title", { hasText: "먼저 숫자 하나!" }).waitFor();
  assert.ok(await nextBtn.isDisabled(), "숫자를 정하기 전에는 다음 장면으로 넘어갈 수 없다");
  await pres.getByRole("button", { name: "숫자 정하기" }).click(); // 숫자 없이 누르면 안내만 나온다
  await pres.getByText("현장에서 정한 숫자를 먼저 넣어 주세요").waitFor();
  await pres.locator(".seed-input").fill(SEED);
  await pres.getByRole("button", { name: "숫자 정하기" }).click();
  await pres.getByText("한 번 정하면 바꿀 수 없어요").waitFor(); // 한 번 더 눌러야 정해진다(브라우저 확인창은 전체 화면을 풀어서 쓰지 않는다)
  assert.equal((await prizeIn()).draws.seed, undefined, "확정하기 전에는 저장되지 않는다");
  await pres.getByRole("button", { name: `숫자 ${SEED}로 확정` }).click();
  await pres.getByText(`현장에서 정한 숫자 ${SEED} · 다음 장면부터 시상합니다`).waitFor({ timeout: 8000 });
  assert.equal(await pres.getByRole("button", { name: "숫자 정하기" }).count(), 0, "정한 뒤에는 숫자를 바꿀 수 없다");
  await shot(admin, "pres-draw-go");
  const before = S.resolvePrizes({ ...(await prizeIn()), withGrand: false }); // 1등을 뽑기 전: 2등 = 응모권 최다 3명, 3등 = 그 3명을 뺀 공감 1위
  assert.equal(before.seed, SEED);
  console.log(`  숫자 ${SEED} → 2등 [${names(before.best).join(", ")}], 3등 ${before.review ? nameByPid[before.review.receiverPid] : "없음(공감 1위가 2등 수상자)"}`);
  await gPrize.getByText(`현장에서 정한 숫자: ${SEED}`).waitFor();
  assert.equal(await phoneWinners(), 0, "발표 전에는 참여자 화면에 수상자가 없다");
  assert.equal(await gPrize.getByText("발표 전", { exact: true }).count(), 6, "1~6등 모두 발표 전");

  // 2등: 한 명씩(3번째 → 1번째)
  let shownCount = 0;
  for (const rank of [2, 1, 0]) {
    await next(); await pres.getByText("2등 베스트 마니또 · 각 10만원").waitFor();
    assert.equal(await phoneWinners(), shownCount, "2등: 무대에서 뜸 들이는 동안 휴대폰에는 아직 안 보인다");
    const pid = before.best[rank];
    if (pid) { await pres.locator(".pres-title", { hasText: nameByPid[pid] }).waitFor(); shownCount += 1; if (rank === 0) { await admin.waitForTimeout(1200); await shot(admin, "pres-best"); } }
    else await pres.getByText("수상자 없음").waitFor();
    await phoneBecomes(shownCount, `2등 ${3 - rank}번째까지 발표: 참여자 화면에 ${shownCount}명`);
  }
  // 3등: 2등 수상자를 뺀 공감 1위 후기(가나의 후기가 유일하게 공감을 받았다)
  await next(); await pres.getByText(/3등 베스트 후기상/).waitFor();
  if (before.review) {
    assert.equal(nameByPid[before.review.receiverPid], "가나");
    await pres.getByText("가장 많은 공감을 받은 후기 ♥ 1").waitFor();
    await pres.locator(".pres-title", { hasText: "가나" }).waitFor();
    shownCount += 1;
  } else {
    assert.ok(names(before.best).includes("가나"), "공감 1위(가나)가 2등 수상자일 때만 3등이 없다");
    await pres.getByText("수상자 없음 (공감을 받은 후기를 쓴 사람이 모두 더 큰 상을 받았어요)").waitFor();
  }
  await phoneBecomes(shownCount, "3등 발표");

  // 4등(종이): 이미 상을 받은 사람이 뽑히면 거부(다시 뽑기), 남은 사람을 차례로 입력, 잘못 넣은 이름은 ✕로 지운다
  await next(); await pres.locator(".pres-title", { hasText: "4등 응모권 추첨" }).waitFor();
  await pres.getByText("통에서 이름 종이를 뽑아요").waitFor();
  await enter(nameByPid[before.best[0]]);
  await pres.getByText("이미 2등 수상자예요. 한 사람은 하나만 받으니 종이를 다시 뽑아 주세요.").waitFor();
  const freeNames = names(Object.keys(before.tickets ? {} : {}).length ? [] : Object.entries((await prizeIn()).tickets).filter(([pid, n]) => n > 0 && !before.taken.has(pid)).map(([pid]) => pid));
  assert.ok(freeNames.length >= 1 && freeNames.length <= 4, `아직 상이 없는 사람 ${freeNames.length}명(6명 중 2등 3명${before.review ? ", 3등 1명" : ""} 제외)`);
  assert.ok(await nextBtn.isDisabled(), "뽑을 사람이 남아 있으면 다음으로 넘어가지 않는다");
  await enter(freeNames[0]);
  await pres.locator(".pres-person b", { hasText: freeNames[0] }).waitFor();
  await enter(freeNames[0]);
  await pres.getByText(/이미 입력한 이름이에요|이미 4등 수상자예요/).waitFor(); // 같은 사람의 종이가 또 나오면 다시 뽑는다
  await pres.locator(".name-x").first().click(); // 잘못 입력했을 때: 지우고 다시
  await pres.locator(".pres-person").first().waitFor({ state: "detached" });
  for (const n of freeNames) { await enter(n); await pres.locator(".pres-person b", { hasText: n }).waitFor(); }
  assert.deepEqual((await presNames()).sort(), [...freeNames].sort());
  shownCount += freeNames.length;
  await phoneBecomes(shownCount, "4등: 입력한 이름이 참여자 화면에도 바로 보인다");
  assert.equal(await pres.locator(".name-input").count(), 0, "더 뽑을 사람이 없으면 입력 칸이 사라진다");
  assert.ok(await nextBtn.isEnabled());
  await shot(admin, "pres-t4");
  // 5등(종이): 응모권이 있는 6명이 모두 상을 받아 더 뽑을 사람이 없다
  await next(); await pres.locator(".pres-title", { hasText: "5등 응모권 추첨" }).waitFor();
  assert.equal(await pres.locator(".name-input").count(), 0);
  assert.equal(await pres.locator(".pres-person").count(), 0);
  // 1등(종이): 이미 2등인 사람이 뽑혀도 1등이다 → 그 사람은 1등만 받고 2등 자리는 다음 순위가 받는다
  await next(); await pres.locator(".pres-title", { hasText: "1등 대추첨" }).waitFor();
  assert.ok(await nextBtn.isDisabled(), "1등을 입력하기 전에는 넘어가지 않는다");
  const grandName = nameByPid[before.best[0]];
  await enter(grandName);
  await pres.locator(".pres-person b", { hasText: grandName }).waitFor();
  await pres.getByText(`${grandName}님은 2등 수상자였어요 → 1등만 받고, 2등 한 자리는 다음 장면에서 다시 채워요`).waitFor();
  await admin.waitForTimeout(600); await shot(admin, "pres-grand");
  await phoneBecomes(shownCount + 1, "1등: 입력하면 참여자 화면에도 보인다(겹친 자리 정리 전이라 2등에도 아직 남아 있다)");
  // 겹친 자리 다시 채우기: 2등은 다음 순위(이미 3·4등이던 사람이면 더 큰 상으로 올라간다)
  await next(); await pres.getByText("겹친 자리 다시 채우기").waitFor();
  const after = S.resolvePrizes(await prizeIn());
  const promoted = after.best.find((pid) => !before.best.includes(pid));
  assert.deepEqual(after.grand, [before.best[0]]);
  assert.ok(promoted && !before.best.includes(promoted), "2등 빈 자리에 다음 순위가 올라온다");
  await pres.getByText(new RegExp(`2등 베스트 마니또: ${grandName}님은 1등으로 → 다음 순위 ${nameByPid[promoted]}님이 받아요`)).waitFor();
  assert.equal(after.open.t4 + after.open.t5, 0, "6명이 모두 상을 받아 더 뽑을 사람이 없다");
  assert.ok(await nextBtn.isEnabled());
  await shot(admin, "pres-refill");
  const finalWinners = [...after.grand, ...after.best, ...(after.review ? [after.review.receiverPid] : []), ...after.t4, ...after.t5];
  assert.equal(new Set(finalWinners).size, finalWinners.length, "한 사람은 하나만");
  await phoneBecomes(finalWinners.length, "겹친 자리 정리 뒤 참여자 화면: 한 사람이 한 번씩만 나온다");
  console.log(`  1등 ${grandName}(2등이었음) → 2등 [${names(after.best).join(", ")}](${nameByPid[promoted]} 올라옴), 3등 ${after.review ? nameByPid[after.review.receiverPid] : "없음"}, 4등 [${names(after.t4).join(", ")}], 5등 [${names(after.t5).join(", ")}]`);
  // 6등(사이트 추첨): 1~5등을 받은 사람을 빼고 뽑는다. 6명이 모두 받았으므로 당첨자가 없다
  await next(); await pres.locator(".pres-title", { hasText: "6등 응모권 추첨" }).waitFor();
  await pres.getByRole("button", { name: "6등 추첨하기" }).click();
  await pres.getByText("뽑은 뒤에는 1~6등을 모두 바꿀 수 없어요").waitFor();
  assert.equal((await prizeIn()).draws.t6, undefined, "확정하기 전에는 뽑지 않는다");
  await pres.getByRole("button", { name: "6등 추첨 확정" }).click();
  const want6 = S.drawOnline((await prizeIn()).tickets, SEED, after.taken);
  if (want6.length === 0) await pres.getByText("당첨자 없음").waitFor({ timeout: 8000 });
  else { await pres.locator(".pres-person").first().waitFor({ timeout: 8000 }); assert.deepEqual((await presNames()).sort(), names(want6).sort()); }
  const draws = (await prizeIn()).draws;
  assert.deepEqual(draws.t6.winners, want6);
  assert.deepEqual(Object.keys(draws).sort(), ["grand", "seed", "t4", "t6"], "저장하는 것: 숫자, 종이로 뽑힌 이름(1·4등), 6등. 2·3등은 저장하지 않는다(계산한다)");
  await next(); await pres.getByText("모두 수고하셨어요!").waitFor();
  await pres.getByRole("button", { name: "닫기" }).click();
  const stepNow = fields(await readDoc("results/public")).step;
  console.log(`  발표 화면 마지막 장면까지 진행(step ${stepNow}). 시상은 2등 → 3등 → 4·5등(종이) → 1등(종이) → 겹친 자리 → 6등(사이트) 순서로 참여자 화면에 열림`);
  await panel(admin, "추첨·시상").locator(".winner").first().waitFor();
  {
    // 참여자 화면: 내가 받은 상 안내, 6등 추첨 검증
    const g = users["가나"];
    await tab(g, "결과");
    const mine = S.PRIZE_ORDER.find((pz) => (pz.key === "review" ? after.review?.receiverPid === pidOf["가나"] : (after[pz.key] || []).includes(pidOf["가나"])));
    await gPrize.getByText(`축하해요! 가나님은 ${mine.label}에 뽑혔어요.`).waitFor();
    await gPrize.getByRole("button", { name: "6등 추첨 검증" }).click();
    await gPrize.getByText("6등 응모권 추첨: 현장 숫자와 응모권 표로 다시 계산한 결과와 같아요").waitFor();
    console.log(`  참여자 화면: "축하해요! 가나님은 ${mine.label}에 뽑혔어요", '6등 추첨 검증' 통과`);
  }
  {
    // 6등을 뽑은 뒤에는 수상자를 바꿀 수 없다: 화면에는 입력 칸이 없고, 운영자 권한으로 직접 고치는 요청도 거부된다
    const tok = await tokenOf("admin1@example.com");
    const patch = (mask, body) => fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/results/public?${mask.map((m) => "updateMask.fieldPaths=" + m).join("&")}`, {
      method: "PATCH", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields: body }),
    }).then((r) => r.status);
    // 지금 1등과 반드시 다른 사람으로 바꿔 본다(같은 값을 다시 쓰는 것은 바뀌는 것이 없어 거부 대상이 아니다)
    const other = PEOPLE.map((x) => pidOf[x.name]).find((pid) => pid !== draws.grand.winners[0]);
    const forged = { mapValue: { fields: { winners: { arrayValue: { values: [{ stringValue: other }] } } } } };
    const regrand = await patch(["draws.grand"], { draws: { mapValue: { fields: { grand: forged } } } });
    const reseed = await patch(["draws.seed"], { draws: { mapValue: { fields: { seed: { stringValue: "1" } } } } });
    const wipe = await patch(["draws"], { draws: { mapValue: { fields: {} } } });
    const tickets = await patch(["tickets"], { tickets: { mapValue: { fields: { [pidOf["가나"]]: { integerValue: "99" } } } } });
    assert.deepEqual([regrand, reseed, wipe, tickets], [403, 403, 403, 403]);
    assert.deepEqual((await prizeIn()).draws, draws, "추첨 결과가 그대로");
    console.log("  1등 바꾸기·숫자 바꾸기·추첨 결과 지우기·응모권 수 바꾸기 직접 요청은 모두 거부(403), 결과 그대로");
  }

  // 응모권: 화면 표시를 이 스크립트가 따로 계산한 값과 대조 (앱의 계산 코드를 쓰지 않음)
  // 받는 사람이 직접 인증한 주차 / 완료를 알린 주차 / 운영자 확인(받았음·못 받음)
  const realSlots = { 가나: [1, 2], 다라: [1, 3], 마바: [1], 사아: [1], 자차: [1], 카타: [1] };
  const sentSlots = { 가나: [1, 2], 다라: [1, 3], 마바: [1, 3], 사아: [1], 자차: [1, 2], 카타: [1] };
  const confirmed = { 마바: [3] }; // 전달된 칭찬 카드: 받는 사람의 인증이 없어도 마니또의 미션으로 인정(카드 추가분 없음)
  const missingV = { 자차: [2] }; // 못 받음: 인정하지 않고 받는 사람에게 보상
  // 인증·인정된 미션 수
  const redeemed = Object.fromEntries(PEOPLE.map((p) => [p.name, realSlots[p.name].length + (confirmed[p.name] || []).length]));
  assert.deepEqual(redeemed, { 가나: 2, 다라: 2, 마바: 2, 사아: 1, 자차: 1, 카타: 1 });
  const cardBonus = { 가나: 2, 다라: 2 }; // 가나 1주차 도전 카드, 다라 3주차 칭찬과 함께 고른 도전 카드(둘 다 직접 인증) +2. 나머지는 쉬움 카드·칭찬만
  // 파트 대항전 최종: 인증된 미션 합 ÷ (인원 × 3)
  const finalBoard = PARTS.map((part) => {
    const mem = PEOPLE.filter((p) => p.part === part);
    return { part, d: mem.reduce((a, p) => a + redeemed[p.name], 0), max: mem.length * 3, n: mem.length };
  });
  const topRate = Math.max(...finalBoard.map((x) => x.d / x.max));
  const winParts = new Set(finalBoard.filter((x) => x.d > 0 && x.d / x.max === topRate).map((x) => x.part));
  console.log("  파트 최종 손계산:", finalBoard.map((x) => `${x.part} ${x.d}/${x.max}${winParts.has(x.part) ? " 우승" : ""}`).join(", "));
  assert.deepEqual([...winParts], ["가파트"]);
  assert.match(scoreText, /파트 대항전: 가파트 4\/6 \(우승\), 나파트 3\/6, 다파트 2\/6/);
  let allOk = true;
  const wantTotals = {};
  for (const p of PEOPLE) {
    const page = users[p.name];
    await tab(page, "결과");
    await page.locator(".target .target-name").waitFor();
    assert.equal(await page.locator(".target .target-name").innerText(), giverOf[p.name], `${p.name}의 마니또 공개`);
    const text = (await page.locator(".target .small").innerText()).replace(/\s+/g, " ");
    const m = text.match(/내 응모권 (\d+)장: 미션 (\d+) \+ 카드 (\d+)(?: \+ 비용 카드 (\d+))? \+ 인증 입력 (\d+)(?: \+ 못 받은 주차 보상 (\d+))? \+ 은신 (\d+) \+ 정답 지목 (\d+)(?: \+ 우승 파트 (\d+))?/);
    assert.ok(m, text);
    const shown = { total: +m[1], mission: +m[2], card: +m[3], cost: +(m[4] || 0), entries: +m[5], comp: +(m[6] || 0), hidden: +m[7], guess: +m[8], partBonus: +(m[9] || 0) };
    const gv = giverOf[p.name];
    const entries = realSlots[gv].length; // 내가 입력한 인증
    // 보상: 인증이 없는 주차 중, 마니또가 완료를 알리지 않았거나 운영자가 '못 받음'으로 확인한 주차 (인증 입력과 합쳐 3장까지)
    const missed = [1, 2, 3].filter((sl) => !realSlots[gv].includes(sl) && (!sentSlots[gv].includes(sl) || (missingV[gv] || []).includes(sl))).length;
    const want = {
      mission: redeemed[p.name], card: cardBonus[p.name] || 0, cost: p.name === "가나" ? ganaCost : 0, entries, // 비용 카드: 가나의 도전 카드가 소액 비용 카드였으면 +1(한 번만)
      comp: redeemed[p.name] >= 1 ? Math.min(3 - entries, missed) : 0,
      hidden: redeemed[p.name] >= 3 && !correct.has(target[p.name]) ? 2 : 0, // 미션 3건이 모두 인정되고 내 대상이 나를 못 맞혔을 때만
      guess: correct.has(p.name) ? 1 : 0,
      partBonus: winParts.has(p.part) && redeemed[p.name] >= 1 ? 1 : 0,
    };
    want.total = want.mission + want.card + want.cost + want.entries + want.comp + want.hidden + want.guess + want.partBonus;
    wantTotals[p.name] = want.total;
    const ok = JSON.stringify(shown) === JSON.stringify({ total: want.total, mission: want.mission, card: want.card, cost: want.cost, entries: want.entries, comp: want.comp, hidden: want.hidden, guess: want.guess, partBonus: want.partBonus });
    allOk = allOk && ok;
    console.log(`  ${p.name}: ${text} → 손계산 ${want.total}장 ${ok ? "일치" : "불일치 " + JSON.stringify(want)}`);
  }
  assert.ok(allOk, "응모권이 손계산과 다름");
  {
    // 시상 결과를 손계산한 응모권으로 확인: 2등은 (1등을 뺀) 응모권 최다 3명, 응모권 0장은 없음
    const totals = Object.fromEntries(PEOPLE.map((p) => [p.name, wantTotals[p.name]]));
    assert.ok(names(finalWinners).every((n) => totals[n] > 0), "응모권 0장은 상을 받지 않는다");
    const sortedAll = PEOPLE.map((p) => totals[p.name]).filter((n) => n > 0).sort((a, b) => b - a);
    assert.deepEqual(names(before.best).map((n) => totals[n]), sortedAll.slice(0, 3), "2등(1등을 뽑기 전)은 응모권 최다 3명(많은 순)");
    const rest = PEOPLE.map((p) => p.name).filter((n) => n !== grandName && totals[n] > 0).map((n) => totals[n]).sort((a, b) => b - a);
    assert.deepEqual(names(after.best).map((n) => totals[n]), rest.slice(0, 3), "1등이 2등 수상자였으면 그 사람을 뺀 응모권 최다 3명");
    console.log(`  시상 손계산 확인: 2등 ${names(after.best).map((n) => `${n}(${totals[n]}장)`).join("·")} = 1등(${grandName} ${totals[grandName]}장)을 뺀 응모권 최다 3명, 상이 겹치는 사람 없음`);
  }
  {
    const page = users["가나"];
    const fin = panel(page, "파트 대항전 최종 순위");
    const rows = (await fin.locator("ol.board li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
    console.log("  결과 화면 파트 최종 순위(가나):", rows.join(" | "));
    assert.match(rows[0], /^1위 가파트\s*우승\s*우리 파트 67% 4 \/ 6 · 2명$/);
    assert.equal(rows.length, 3);
    assert.match(rows[1], /^2위 나파트 50% 3 \/ 6 · 2명$/);
    assert.match(rows[2], /^3위 다파트 33% 2 \/ 6 · 2명$/);
    // 운영자 확인으로 인정된 미션은 결과 화면에 표시된다
    const mabaText = (await users["마바"].locator(".target .small").innerText()).replace(/\s+/g, " ");
    assert.match(mabaText, /대상의 인증 없이 인정된 미션 1건 포함/);
  }
  await shot(users["가나"], "reveal");

  await browser.close();
  console.log("\n콘솔 오류", errors.length, "건");
  for (const e of errors) console.log("  ", e.slice(0, 300));
  console.log("완료");
})().catch(async (e) => {
  console.error("실패:", e.message.split("\n").slice(0, 6).join("\n"));
  console.log("콘솔 오류", errors.length, "건");
  for (const er of errors) console.log("  ", er.slice(0, 300));
  process.exit(1);
});
