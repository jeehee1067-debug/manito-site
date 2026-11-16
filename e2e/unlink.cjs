const { chromium } = require("playwright");
const assert = require("node:assert/strict");
require("node:fs").mkdirSync(__dirname + "/shots", { recursive: true });

// 대상 이름은 기본으로 가려져 있다(내 미션 화면). "이름 보기"를 눌러 읽는다.
const readTarget = async (p) => { const b = p.locator(".target-toggle"); await b.waitFor(); if ((await b.getAttribute("aria-pressed")) !== "true") await b.click(); return (await p.locator(".target-name").innerText()).trim(); };
// 운영 화면의 초대 코드·메일은 기본으로 가려져 있다.
const showSecrets = async (p) => { for (const b of await p.getByRole("button", { name: "초대 코드·메일 보기" }).all()) await b.click(); };
const BASE = "http://localhost:5173/", P = "demo-manito", FS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`;
(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${P}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/accounts`, { method: "DELETE" });
  const b = await chromium.launch();
  const errs = [], dialogs = [];
  const mk = async (label) => {
    const p = await (await b.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
    p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !m.text().includes("TUNNEL") && errs.push(`[${label}] ${m.text().slice(0, 140)}`));
    return p;
  };
  const step = (t) => console.log("▶", t);
  const signup = async (p, code, email) => {
    await p.goto(BASE);
    await p.getByRole("tab", { name: "처음 가입" }).click();
    await p.getByPlaceholder("운영진에게 받은 6자리").fill(code);
    await p.getByPlaceholder("회사 메일 아이디").fill(email);
    await p.locator('input[type="password"]').fill("secret123");
    await p.getByRole("button", { name: "가입하기" }).click();
  };
  const tableRow = (page, name) => page.locator(".pk-table tbody tr", { has: page.locator("td", { hasText: new RegExp(`^${name}$`) }) });

  step("운영자 설정, 명단 3명, 배정");
  const admin = await mk("운영자");
  await admin.goto(BASE + "?setup");
  await admin.getByRole("button", { name: "운영자·공동 운영자 계정 만들기" }).click();
  await admin.getByPlaceholder("회사 메일 아이디").fill("admin@example.com");
  await admin.locator('input[type="password"]').fill("secret123");
  await admin.getByRole("button", { name: "운영자 계정 만들기" }).click();
  await admin.locator("section.panel", { has: admin.locator("h2", { hasText: "1. 명단" }) }).locator("textarea").fill("가나,가파트\n다라,가파트\n마바,나파트");
  await admin.getByRole("button", { name: "명단에 추가" }).click(); await admin.getByText("3명을 추가했어요.").waitFor();
  await admin.getByRole("button", { name: "배정하기" }).click(); await admin.getByText(/3명 배정 완료/).waitFor();
  console.log("  배정 결과 문구(가파트 2명/3명이라 같은 파트를 피할 수 없는 경우):", await admin.locator(".note.banner").innerText());
  await showSecrets(admin);
  const invCol = (await admin.locator(".pk-table thead th").allInnerTexts()).indexOf("초대 코드");
  const code = async (name) => (await tableRow(admin, name).locator("td").nth(invCol).innerText()).trim();
  const oldCode = await code("가나");

  step("가나 초대 코드를 엉뚱한 사람이 사용(잘못된 메일), 프로필 작성");
  const wrong = await mk("엉뚱한 사람");
  await signup(wrong, oldCode, "intruder@example.com");
  await wrong.locator(".hud-who", { hasText: "가나님" }).waitFor();
  await wrong.locator("nav.tabs button", { hasText: "내 프로필" }).click();
  const { PROFILE_QUESTIONS: PQ } = await import(require("node:url").pathToFileURL(require("node:path").join(__dirname, "../src/lib/constants.js")).href);
  const H = require("./helpers.cjs");
  const gAns = H.answersFor(PQ, 0, "가나");
  await H.fillProfile(wrong, gAns, PQ);
  const dara = await mk("다라");
  await signup(dara, await code("다라"), "dara@example.com");
  await dara.locator(".hud-who", { hasText: "다라님" }).waitFor();

  step("운영 화면: 연결된 메일 확인 → 연결 해제");
  await tableRow(admin, "가나").locator("td.email", { hasText: "intruder@example.com" }).waitFor();
  console.log("  운영 화면 메일: 가나 =", await tableRow(admin, "가나").locator("td.email").innerText(), "/ 다라 =", await tableRow(admin, "다라").locator("td.email").innerText(), "/ 마바 =", await tableRow(admin, "마바").locator("td.email").innerText());
  await tableRow(admin, "가나").getByRole("button", { name: "연결 해제" }).click();
  await admin.getByText(/가나님 연결을 풀었어요. 새 초대 코드: /).waitFor();
  const newCode = (await admin.getByText(/새 초대 코드: /).innerText()).split(": ").pop().trim();
  console.log("  확인창:", dialogs.pop().split("\n")[0], "/ 새 초대 코드:", newCode, "(이전", oldCode + ")");
  assert.notEqual(newCode, oldCode);
  assert.equal(await code("가나"), newCode);

  step("예전 계정: 새로고침하면 '내 이름 연결' 화면, 예전 코드로 재연결 불가");
  await wrong.reload();
  await wrong.getByPlaceholder("초대 코드 6자리").waitFor();
  await wrong.getByPlaceholder("초대 코드 6자리").fill(oldCode);
  await wrong.getByRole("button", { name: "연결하기" }).click();
  await wrong.locator(".error").waitFor();
  console.log("  예전 코드로 연결 시도:", await wrong.locator(".error").innerText());

  step("진짜 가나: 새 코드로 가입 → 기록 이어짐");
  const real = await mk("진짜 가나");
  await signup(real, newCode, "ganada@example.com");
  await real.locator(".hud-who", { hasText: "가나님" }).waitFor();
  await real.locator("nav.tabs button", { hasText: "내 프로필" }).click();
  await real.getByText("로그인한 메일: ganada@example.com").waitFor();
  const picked = await real.locator(".profile-q").first().locator('[role=radio][aria-checked="true"]').innerText();
  const text4 = await real.locator(".profile-q").nth(3).locator("input").inputValue();
  console.log("  진짜 가나 프로필(이전 계정이 쓴 것): 1번", picked, "/ 4번", text4);
  assert.equal(picked, gAns[0]); assert.equal(text4, gAns[3]);
  await tableRow(admin, "가나").locator("td.email", { hasText: "ganada@example.com" }).waitFor();
  console.log("  운영 화면 가나 메일 →", await tableRow(admin, "가나").locator("td.email").innerText());

  step("예전 가입분(메일 없음): 로그인하면 메일이 채워짐");
  const r = await fetch(`${FS}/users?pageSize=50`, { headers: { Authorization: "Bearer owner" } });
  const daraDoc = (await r.json()).documents.find((d) => d.fields.email?.stringValue === "dara@example.com");
  await fetch(`${FS}/users/${daraDoc.name.split("/").pop()}?updateMask.fieldPaths=email`, { method: "PATCH", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify({ fields: {} }) });
  await admin.reload(); await tableRow(admin, "다라").waitFor(); await showSecrets(admin);
  console.log("  메일 지운 뒤 운영 화면 다라 =", await tableRow(admin, "다라").locator("td.email").innerText());
  await dara.reload(); await dara.locator(".hud-who", { hasText: "다라님" }).waitFor();
  await tableRow(admin, "다라").locator("td.email", { hasText: "dara@example.com" }).waitFor();
  console.log("  다라 다시 로그인 후 운영 화면 다라 =", await tableRow(admin, "다라").locator("td.email").innerText());

  step("미션 진행 단계: 계정 연결 패널");
  await admin.getByRole("button", { name: /다음 단계로: 미션 진행/ }).click();
  const acc = admin.locator("section.panel", { has: admin.locator("h2", { hasText: "계정 연결" }) });
  await acc.waitFor();
  console.log("  계정 연결 패널:", (await acc.locator("tbody").innerText()).replace(/\t/g, " ").replace(/\n+/g, " | "));
  await admin.screenshot({ path: __dirname + "/shots/accounts-panel.png", fullPage: true });
  console.log("\n콘솔 오류·경고", errs.length, "건"); errs.slice(0, 8).forEach((e) => console.log("  ", e));
  await b.close();
})().catch((e) => { console.error("실패:", e.message.split("\n")[0]); process.exit(1); });
