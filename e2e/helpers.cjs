// 검증 스크립트 공통 도구
const BASE = "http://localhost:5173/", P = "demo-manito";
// 대상 이름은 기본으로 가려져 있다(내 미션 화면). "이름 보기"를 눌러 읽는다.
const readTarget = async (p) => { const b = p.locator(".target-toggle:visible"); await b.waitFor(); if ((await b.getAttribute("aria-pressed")) !== "true") await b.click(); return (await p.locator(".target-name:visible").innerText()).trim(); };
// 운영 화면의 초대 코드·메일은 기본으로 가려져 있다.
const showSecrets = async (p) => { for (const b of await p.getByRole("button", { name: "초대 코드·메일 보기" }).all()) await b.click(); };

const panel = (page, title) => page.locator("section.panel:visible", { has: page.locator("h2.panel-title", { hasText: title }) });
const tab = (page, name) => page.locator("nav.tabs button", { hasText: name }).click();
async function reset() {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${P}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/accounts`, { method: "DELETE" });
}
function maker(browser, errors, dialogs = []) {
  return async (label, viewport = { width: 420, height: 900 }) => {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(() => { try { localStorage.setItem("manito:adminFull", "1"); } catch {} }); // 검증용: 미션 단계에서 새로 연 운영 화면도 바로 다 보이게(실제 기본은 "운영 자료 불러오기"를 눌러야 함)
    const page = await ctx.newPage();
    // 입력창(prompt)에 넣을 글: dialogs.answers에 넣어 두면 차례로 쓴다(없으면 기본값 그대로 확인)
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(d.type() === "prompt" && dialogs.answers?.length ? dialogs.answers.shift() : undefined); });
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !m.text().includes("TUNNEL") && errors.push(`[${label}] ${m.text().slice(0, 160)}`));
    page.on("pageerror", (e) => errors.push(`[${label}] pageerror ${e.message}`));
    return page;
  };
}
async function setupAdmin(admin, lines, email = "admin@example.com") {
  await admin.goto(BASE + "?setup");
  await admin.getByRole("button", { name: "운영자·공동 운영자 계정 만들기" }).click();
  await admin.getByPlaceholder("Knox ID").fill(email);
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
  await page.getByPlaceholder("Knox ID").fill(email);
  await page.locator('input[type="password"]').fill("secret123");
  await page.getByRole("button", { name: "가입하기" }).click();
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
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByText(/저장했어요/).waitFor();
}
const answersFor = (PQ, i, name) => PQ.map((x, q) => (x.options ? x.options[(i + q) % x.options.length] : `${name}의답${q + 1}`));

// ── 에뮬레이터 직접 읽기(관리자 권한) ──
const FS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`;
const fsVal = (v) => ("stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue : "booleanValue" in v ? v.booleanValue
  : "nullValue" in v ? null : "arrayValue" in v ? (v.arrayValue.values || []).map(fsVal) : "mapValue" in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, fsVal(x)])) : v.timestampValue ?? null);
const readDoc = async (path) => { const d = await (await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } })).json(); return Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fsVal(v)])); };
// 수상자 계산에 들어가는 값(results/public에서)
const prizeInput = async () => { const r = await readDoc("results/public"); return { tickets: r.tickets || {}, tieBreak: r.tieBreak || {}, reviews: r.reviewRank || [], draws: r.draws || {} }; };

// 그 주소로 나간 인증 메일 수(에뮬레이터)
async function verifyMailCount(email) {
  const list = (await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/oobCodes`)).json()).oobCodes || [];
  return list.filter((c) => c.email === email && c.requestType === "VERIFY_EMAIL").length;
}
// 인증 메일의 링크 누르기(에뮬레이터): 그 주소로 온 가장 최근 인증 링크를 연다
async function verifyMail(email) {
  const list = (await (await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/oobCodes`)).json()).oobCodes || [];
  const mine = list.filter((c) => c.email === email && c.requestType === "VERIFY_EMAIL");
  if (!mine.length) throw new Error(`인증 메일이 없음: ${email}`);
  await fetch(mine[mine.length - 1].oobLink);
}

/**
 * 발표 화면의 시상 장면을 끝까지 진행한다. 지금 장면이 "먼저 숫자 하나!"(숫자 정하기)여야 한다.
 * 숫자 정하기 → 2등·3등 장면 넘기기 → 4·5등: 아직 상이 없는 사람을 차례로 입력 → 1등 입력(pickGrand로 고르거나, 없으면 아직 상이 없는 사람·없으면 2등 1위)
 * → 겹친 자리 다시 채우기 → 6등 사이트 추첨. nameOf(pid) → 이름.
 * 반환: { S, before(1등을 뽑기 전), after(최종), t6 }
 */
async function runAwards(admin, { seed, nameOf, pickGrand, onSlide }) {
  const S = await import("../src/lib/scoring.js");
  const pres = admin.locator(".presenter");
  const next = async () => { await pres.getByRole("button", { name: "다음 ▶" }).click(); await admin.waitForTimeout(150); };
  const enter = async (name) => { await pres.locator(".name-input").fill(name); await pres.locator(".name-hits button", { hasText: name }).first().click(); await pres.locator(".pres-person b", { hasText: name }).first().waitFor(); };
  const free = (res, tickets) => Object.keys(tickets).filter((pid) => tickets[pid] > 0 && !res.taken.has(pid)).sort();
  await pres.locator(".pres-title", { hasText: "먼저 숫자 하나!" }).waitFor();
  await pres.locator(".seed-input").fill(seed);
  await pres.getByRole("button", { name: "숫자 정하기" }).click();
  await pres.getByRole("button", { name: `숫자 ${seed}로 확정` }).click();
  await pres.getByText(`현장에서 정한 숫자 ${seed} · 다음 장면부터 시상합니다`).waitFor({ timeout: 8000 });
  const before = S.resolvePrizes({ ...(await prizeInput()), withGrand: false });
  // 2등(한 명씩)·3등 장면
  for (let k = 0; k < 8; k++) {
    await next();
    if (onSlide) await onSlide(pres, before);
    if (await pres.locator(".pres-title", { hasText: S.PAPER_TIERS[0].label }).count()) break;
  }
  // 종이 추첨(4·5등): 아직 상이 없는 사람을 차례로
  for (const [i, tier] of S.PAPER_TIERS.entries()) {
    if (i > 0) await next();
    await pres.locator(".pres-title", { hasText: tier.label }).waitFor();
    for (;;) {
      const inp = await prizeInput(); const res = S.resolvePrizes(inp);
      const cand = free(res, inp.tickets);
      if (res.open[tier.key] <= 0 || !cand.length) break;
      await enter(nameOf(cand[0]));
    }
  }
  // 1등
  await next(); await pres.locator(".pres-title", { hasText: "1등 대추첨" }).waitFor();
  {
    const inp = await prizeInput(); const res = S.resolvePrizes(inp);
    const g = (pickGrand && pickGrand(res, inp)) || free(res, inp.tickets)[0] || res.best[0];
    await enter(nameOf(g));
  }
  // 겹친 자리 다시 채우기
  await next(); await pres.getByText("겹친 자리 다시 채우기").waitFor();
  for (;;) {
    const inp = await prizeInput(); const res = S.resolvePrizes(inp);
    const tier = S.PAPER_TIERS.find((t) => res.open[t.key] > 0);
    const cand = free(res, inp.tickets);
    if (!tier || !cand.length) break;
    await pres.locator(".name-input").first().fill(nameOf(cand[0]));
    await pres.locator(".name-hits button", { hasText: nameOf(cand[0]) }).first().click();
    await admin.waitForTimeout(400);
  }
  // 6등
  await next(); await pres.locator(".pres-title", { hasText: S.ONLINE_PRIZE.label }).waitFor();
  await pres.getByRole("button", { name: "6등 추첨하기" }).click();
  await pres.getByRole("button", { name: "6등 추첨 확정" }).click();
  await pres.getByText(/당첨자 없음|휴대폰 결과 탭에서 내 이름을 확인하세요/).first().waitFor({ timeout: 10000 });
  const after = S.resolvePrizes(await prizeInput());
  return { S, before, after, t6: after.t6 || [] };
}
// 미션 카드: 난이도를 고르면 그 난이도의 카드 두 장이 나온다. 그중 하나(기본: 첫 장)를 고른다.
async function pickCard(slot, level, nth = 0) {
  await slot.locator(`.level-pick.level-${level}:not(.is-gold)`).click();
  await slot.locator(`.dealt .card.level-${level}`).nth(nth).click();
  await slot.locator(".chosen").waitFor();
}
module.exports = { verifyMailCount, pickCard, readTarget, showSecrets, BASE, P, panel, tab, reset, maker, setupAdmin, inviteCodes, signup, fillProfile, answersFor, readDoc, prizeInput, verifyMail, runAwards };
