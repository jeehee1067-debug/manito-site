// 검증 스크립트 공통 도구
const BASE = "http://localhost:5173/", P = "demo-manito";
// 대상 이름은 기본으로 가려져 있다(내 미션 화면). "이름 보기"를 눌러 읽는다.
const readTarget = async (p) => { const b = p.locator(".target-toggle"); await b.waitFor(); if ((await b.getAttribute("aria-pressed")) !== "true") await b.click(); return (await p.locator(".target-name").innerText()).trim(); };
// 운영 화면의 초대 코드·메일은 기본으로 가려져 있다.
const showSecrets = async (p) => { for (const b of await p.getByRole("button", { name: "초대 코드·메일 보기" }).all()) await b.click(); };

const panel = (page, title) => page.locator("section.panel", { has: page.locator("h2.panel-title", { hasText: title }) });
const tab = (page, name) => page.locator("nav.tabs button", { hasText: name }).click();
async function reset() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${P}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/accounts`, { method: "DELETE" });
}
function maker(browser, errors, dialogs = []) {
  return async (label, viewport = { width: 420, height: 900 }) => {
    const page = await (await browser.newContext({ viewport })).newPage();
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !m.text().includes("TUNNEL") && errors.push(`[${label}] ${m.text().slice(0, 160)}`));
    page.on("pageerror", (e) => errors.push(`[${label}] pageerror ${e.message}`));
    return page;
  };
}
async function setupAdmin(admin, lines, email = "admin@example.com") {
  await admin.goto(BASE + "?setup");
  await admin.getByRole("button", { name: "운영자·공동 운영자 계정 만들기" }).click();
  await admin.getByPlaceholder("자주 확인하는 메일 주소").fill(email);
  await admin.locator('input[type="password"]').fill("secret123");
  await admin.getByRole("button", { name: "운영자 계정 만들기" }).click();
  await panel(admin, "1. 명단").locator("textarea").fill(lines.join("\n"));
  await admin.getByRole("button", { name: "명단에 추가" }).click(); await admin.getByText(`${lines.length}명을 추가했어요.`).waitFor();
  await admin.getByRole("button", { name: "배정하기" }).click(); await admin.getByText(new RegExp(`${lines.length}명 배정 완료`)).waitFor();
  return inviteCodes(admin);
}
async function inviteCodes(admin) {
  await showSecrets(admin);
  const table = panel(admin, "명단 ").locator(".pk-table");
  const heads = await table.locator("thead th").allInnerTexts();
  const out = {};
  for (const r of await table.locator("tbody tr").all()) { const c = await r.locator("td").allInnerTexts(); out[c[0]] = c[heads.indexOf("초대 코드")]; }
  return out;
}
async function signup(page, code, email) {
  await page.goto(BASE);
  await page.getByRole("tab", { name: "처음 가입" }).click();
  await page.getByPlaceholder("운영진에게 받은 6자리").fill(code);
  await page.getByPlaceholder("자주 확인하는 메일 주소").fill(email);
  await page.locator('input[type="password"]').fill("secret123");
  await page.getByRole("button", { name: "가입하고 내 이름 연결" }).click();
}
// answers: 6개 답(고르기는 보기 글자 그대로). null인 칸은 건드리지 않는다.
async function fillProfile(page, answers, PQ) {
  await tab(page, "내 프로필");
  const qs = page.locator(".profile-q");
  await qs.first().waitFor();
  for (let q = 0; q < 6; q++) {
    if (answers[q] == null) continue;
    if (PQ[q].options) await qs.nth(q).getByRole("radio", { name: answers[q], exact: true }).click();
    else await qs.nth(q).locator("input").fill(answers[q]);
  }
  await page.getByRole("button", { name: "저장" }).click();
  await page.getByText(/저장했어요/).waitFor();
}
const answersFor = (PQ, i, name) => PQ.map((x, q) => (x.options ? x.options[(i + q) % x.options.length] : `${name}의답${q + 1}`));
module.exports = { readTarget, showSecrets, BASE, P, panel, tab, reset, maker, setupAdmin, inviteCodes, signup, fillProfile, answersFor };
