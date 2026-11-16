// 불공정 사례 시나리오: 가입 안 한 사람(자차), 아무것도 안 하는 사람(마바), 중도 이탈(사아)
// 집계 결과를 이 스크립트가 따로 계산한 값과 대조한다(앱의 계산 코드를 쓰지 않음).
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

// 대상 이름은 기본으로 가려져 있다(내 미션 화면). "이름 보기"를 눌러 읽는다.
const readTarget = async (p) => { const b = p.locator(".target-toggle"); await b.waitFor(); if ((await b.getAttribute("aria-pressed")) !== "true") await b.click(); return (await p.locator(".target-name").innerText()).trim(); };
// 운영 화면의 초대 코드·메일은 기본으로 가려져 있다.
const showSecrets = async (p) => { for (const b of await p.getByRole("button", { name: "초대 코드·메일 보기" }).all()) await b.click(); };
const H = require("./helpers.cjs");
const BASE = "http://localhost:5173/", P = "demo-manito";
const FS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`;
const JOIN = ["가나", "다라", "마바", "사아"], ALL = [...JOIN, "자차"];
const PART = { 가나: "가파트", 다라: "가파트", 마바: "나파트", 사아: "나파트", 자차: "다파트" };
const errors = [], dialogs = [];
const step = (s) => console.log("▶", s);
const panel = (page, title) => page.locator("section.panel", { has: page.locator("h2.panel-title", { hasText: title }) });
const tab = (page, name) => page.locator("nav.tabs button", { hasText: name }).click();
const rest = async (path) => (await fetch(`${FS}/${path}`, { headers: { Authorization: "Bearer owner" } })).json();
const val = (v) => v.stringValue ?? (v.integerValue !== undefined ? Number(v.integerValue) : v.booleanValue ?? (v.mapValue ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, val(x)])) : null));

(async () => {
  const { PROFILE_QUESTIONS: PQ } = await import(require("node:url").pathToFileURL(require("node:path").join(__dirname, "../src/lib/constants.js")).href);
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${P}/databases/(default)/documents`, { method: "DELETE" });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${P}/accounts`, { method: "DELETE" });
  const browser = await chromium.launch();
  const mk = async (label) => {
    const page = await (await browser.newContext({ viewport: { width: 420, height: 900 } })).newPage();
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    page.on("console", (m) => m.type() === "error" && !m.text().includes("TUNNEL") && errors.push(`[${label}] ${m.text().slice(0, 160)}`));
    page.on("pageerror", (e) => errors.push(`[${label}] pageerror ${e.message}`));
    return page;
  };
  const advance = async (to) => { await admin.getByRole("button", { name: `다음 단계로: ${to}` }).click(); await admin.locator(".hud-chip", { hasText: to }).waitFor(); };

  step("운영자, 명단 5명(자차는 가입 안 함), 배정");
  const admin = await mk("운영자");
  await admin.goto(BASE + "?setup");
  await admin.getByRole("button", { name: "운영자·공동 운영자 계정 만들기" }).click();
  await admin.getByPlaceholder("자주 확인하는 메일 주소").fill("fadmin@example.com");
  await admin.locator('input[type="password"]').fill("secret123");
  await admin.getByRole("button", { name: "운영자 계정 만들기" }).click();
  await panel(admin, "1. 명단").locator("textarea").fill(ALL.map((n) => `${n},SR3,${PART[n]}`).join("\n"));
  await admin.getByRole("button", { name: "명단에 추가" }).click(); await admin.getByText("5명을 추가했어요.").waitFor();
  await admin.getByRole("button", { name: "배정하기" }).click(); await admin.getByText(/5명 배정 완료/).waitFor();
  await showSecrets(admin);
  const heads = await admin.locator(".pk-table thead th").allInnerTexts();
  const invite = {};
  for (const r of await admin.locator(".pk-table tbody tr").all()) { const c = await r.locator("td").allInnerTexts(); invite[c[0]] = c[heads.indexOf("초대 코드")]; }
  const users = {};
  for (const [i, name] of JOIN.entries()) {
    const page = await mk(name); users[name] = page;
    await page.goto(BASE);
    await page.getByRole("tab", { name: "처음 가입" }).click();
    await page.getByPlaceholder("운영진에게 받은 6자리").fill(invite[name]);
    await page.getByPlaceholder("자주 확인하는 메일 주소").fill(`f${i}@example.com`);
    await page.locator('input[type="password"]').fill("secret123");
    await page.getByRole("button", { name: "가입하고 내 이름 연결" }).click();
    await page.locator(".target-name").waitFor();
    // 프로필을 채워야 단서 6개가 대상에게 가고 은신 응모권 자격이 생긴다
    await H.fillProfile(page, H.answersFor(PQ, i, name), PQ);
    await H.tab(page, "내 미션");
  }
  await advance("미션 진행");
  console.log("  시작 확인창 경고:", dialogs.find((d) => d.includes("가입 안 한 사람")).split("\n").find((l) => l.includes("가입 안 한")));

  const target = {};
  for (const name of JOIN) { await users[name].reload(); await users[name].locator(".target-name").waitFor(); target[name] = await readTarget(users[name]); }
  target["자차"] = ALL.find((n) => !Object.values(target).includes(n)); // 남은 한 명이 자차의 대상
  const giverOf = Object.fromEntries(Object.entries(target).map(([g, r]) => [r, g]));
  console.log("  짝(마니또 → 대상):", target);
  for (const [g, r] of Object.entries(target)) assert.notEqual(PART[g], PART[r], "같은 파트끼리 짝이 됨");

  step("1주차: 가나·다라·사아만 미션 완료 알림 (마바는 아무것도 안 함)");
  const DELIVER = ["가나", "다라", "사아"];
  for (const name of DELIVER) {
    const page = users[name], slot = panel(page, "1주차 미션");
    await slot.locator(".card.level-easy").click();
    await slot.locator(".chosen").waitFor();
    await slot.locator("textarea").fill(`${name}의 쪽지`);
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await panel(page, "1주차 미션 ✔").waitFor();
  }
  const absent = new Set(["자차", "사아"]);
  const delivered = (g) => (DELIVER.includes(g) ? 1 : 0);
  // 받고도 인증하지 않는 사람(가입·활동은 함): 미션을 보낸 마니또의 대상 중 한 명
  const lazy = [target["가나"], target["다라"], target["사아"]].find((n) => ["가나", "다라", "마바"].includes(n)); // 가나·다라(참여 중인 마니또)의 대상을 먼저 본다
  step(`받은 사람 인증: 가나·다라·마바 중 ${lazy}만 빼고 (${lazy}는 받고도 인증 안 함, 사아는 나중에 중도 이탈)`);
  const redeemedDoc = (r) => !absent.has(r) && r !== lazy && delivered(giverOf[r]) === 1;
  for (const name of ["가나", "다라", "마바"]) {
    if (!redeemedDoc(name)) continue;
    const page = users[name];
    await tab(page, "추리 보드");
    const inbox = panel(page, "마니또에게서 온 것");
    await inbox.locator("strong.mono").first().waitFor();
    const entry = panel(page, "인증하기");
    await entry.getByPlaceholder("K7Q2").fill(await inbox.locator("strong.mono").first().innerText());
    await entry.locator("textarea").fill("잘 받았어요. 덕분에 기분 좋은 하루였어요. 고마워요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await page.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
  }

  step("운영: 사아를 중도 이탈로 표시");
  await tab(admin, "운영");
  await panel(admin, "중도 이탈").getByRole("button", { name: "사아", exact: true }).click();
  await panel(admin, "중도 이탈").locator("button.is-off", { hasText: "사아" }).waitFor();
  console.log("  확인창:", dialogs.find((d) => d.includes("중도 이탈로 표시")).split("\n").filter(Boolean).slice(0, 4).join(" / "));
  console.log("  중도 이탈 칩:", (await panel(admin, "중도 이탈").locator(".name-chips").innerText()).replace(/\n/g, " "));

  step("지목(아무도 안 함) → 마감 → 집계 → 공개");
  await advance("최종 지목"); await advance("마감");
  assert.equal(await panel(admin, "투표 카드").count(), 0, "투표는 없앴다: 운영 화면에 투표 카드 패널이 없다");
  await advance("집계");
  const roster = (await rest("roster?pageSize=50")).documents;
  const pidOf = Object.fromEntries(roster.map((d) => [d.fields.name.stringValue, d.name.split("/").pop()]));
  let res, tickets, detail;
  // 별도 손계산과 저장된 결과(results/public) 대조. credit = 받은 완료 알림을 인증 없이 인정해 주는 사람들
  // credit: 받은 완료 알림을 인증 없이 인정해 주는 사람(불참 자동 인정 + 운영자 '받았음'), missing: 운영자가 '못 받음'으로 확인한 사람(1주차)
  const check = async (label, credit, missing = new Set()) => {
    await admin.getByRole("button", { name: /집계하기|다시 집계/ }).click();
    await admin.waitForTimeout(1500);
    const credited = (g) => (delivered(g) && (redeemedDoc(target[g]) || (credit.has(target[g]) && !missing.has(target[g]))) ? 1 : 0);
    res = (await rest("results/public")).fields; tickets = val(res.tickets); detail = val(res.ticketDetail);
    let ok = true;
    console.log(`  [${label}]`);
    // 파트 대항전 손계산: 불참(가입 안 함·중도 이탈)을 뺀 파트원의 인증·인정된 미션 합 ÷ (인원 × 3). 1위(동률 포함) 파트가 우승
    const byPart = {};
    for (const p of ALL) { if (absent.has(p)) continue; const x = (byPart[PART[p]] ||= { members: 0, done: 0, max: 0 }); x.members++; x.done += credited(p); x.max += 3; }
    const top = Math.max(...Object.values(byPart).map((x) => x.done / x.max));
    const winners = new Set(Object.entries(byPart).filter(([, x]) => x.done > 0 && x.done / x.max === top).map(([k]) => k));
    const board = (res.partBoard?.arrayValue?.values || []).map((v) => val(v));
    const boardWant = Object.entries(byPart).map(([part, x]) => ({ part, ...x, winner: winners.has(part) }));
    const norm = (rows) => JSON.stringify(rows.map((x) => [x.part, x.members, x.done, x.max, x.winner]).sort());
    console.log(`    파트 순위(저장): ${board.map((x) => `${x.part} ${x.done}/${x.max}${x.winner ? " 우승" : ""}`).join(", ")} → 손계산 ${norm(board) === norm(boardWant) ? "일치" : "불일치 " + JSON.stringify(boardWant)}`);
    ok = ok && norm(board) === norm(boardWant);
    for (const p of ALL) {
      const mission = credited(p), hidden = credited(p) >= 3 ? 2 : 0, entries = redeemedDoc(p) ? 1 : 0; // 은신은 미션 3건이 모두 인정돼야(여기서는 1주차만 해서 모두 0)
      const missed = 3 - delivered(giverOf[p]) + (delivered(giverOf[p]) && missing.has(p) ? 1 : 0); // 안 보낸 주차 + '못 받음'으로 확인된 주차
      const comp = credited(p) >= 1 ? Math.min(3 - entries, missed) : 0;
      const assumed = delivered(p) && credit.has(target[p]) && !redeemedDoc(target[p]) ? 1 : 0;
      const partBonus = winners.has(PART[p]) && !absent.has(p) && credited(p) >= 1 ? 1 : 0;
      const e = { mission, card: 0, entries, comp, hidden, guess: 0, partBonus, assumed, total: absent.has(p) ? 0 : mission + entries + comp + hidden + partBonus };
      const d = detail[pidOf[p]];
      const same = tickets[pidOf[p]] === e.total && ["mission", "card", "entries", "comp", "hidden", "guess", "partBonus", "assumed"].every((k) => d[k] === e[k]);
      ok = ok && same;
      const kind = p === "자차" ? "가입 안 함" : p === "사아" ? "중도 이탈" : p === lazy ? "받고도 인증 안 함" : p === "마바" ? "아무것도 안 함" : "참여";
      console.log(`    ${p}(${kind}${p === "마바" && lazy === "마바" ? ", 아무것도 안 함" : ""}): 저장된 응모권 ${tickets[pidOf[p]]}장 [미션 ${d.mission} 입력 ${d.entries} 보상 ${d.comp} 은신 ${d.hidden} 우승파트 ${d.partBonus} 인정 ${d.assumed}] → 손계산 ${e.total}장 ${same ? "일치" : "불일치 " + JSON.stringify(e)}`);
    }
    assert.ok(ok, "집계가 손계산과 다름: " + label);
    return { tickets: { ...tickets }, detail: JSON.parse(JSON.stringify(detail)) };
  };
  const un = panel(admin, "집계 전 확인: 인증이 없는 완료 알림");
  await un.waitFor();
  console.log("  집계 전 확인 표:", (await un.locator("tbody").innerText()).replace(/\t/g, " ").replace(/\n+/g, " | "));
  const before = await check("표시 전", absent);
  // 표의 줄: [주차, 받는 사람, 마니또, …]. 받는 사람이 lazy인 줄을 찾는다(다른 줄의 마니또 칸에도 같은 이름이 나올 수 있다)
  const rowOf = async (name) => {
    for (const tr of await un.locator("tbody tr").all()) if (((await tr.locator("td").nth(1).innerText()).trim().split(" ")[0]) === name) return tr;
    throw new Error("줄을 못 찾음: " + name);
  };
  const lazyRow = await rowOf(lazy);
  await lazyRow.getByRole("button", { name: "받았음" }).click();
  await lazyRow.locator('button[aria-pressed="true"]', { hasText: "받았음" }).waitFor();
  const after = await check(`${lazy}의 1주차를 '받았음'으로 확인한 뒤`, new Set([...absent, lazy]));
  const g = giverOf[lazy];
  console.log(`  ${lazy}의 마니또(${g}${absent.has(g) ? ", 불참이라 합계는 0장" : ""}): 인정된 미션 ${before.detail[pidOf[g]].mission} → ${after.detail[pidOf[g]].mission}건, 합계 ${before.tickets[pidOf[g]]}장 → ${after.tickets[pidOf[g]]}장 / ${lazy} 본인: ${before.tickets[pidOf[lazy]]}장 → ${after.tickets[pidOf[lazy]]}장`);
  assert.equal(after.detail[pidOf[g]].mission, before.detail[pidOf[g]].mission + 1, "마니또의 미션이 인정됨");
  if (!absent.has(g)) assert.ok(after.tickets[pidOf[g]] > before.tickets[pidOf[g]], "마니또의 응모권이 늘어남");
  assert.equal(after.tickets[pidOf[lazy]], before.tickets[pidOf[lazy]], "본인 응모권은 그대로");
  // '못 받음'으로 바꾸면: 마니또의 미션은 인정되지 않고, 받는 사람(lazy)이 그 주차 보상을 받는다(본인 미션이 1건 이상 인증된 경우)
  await lazyRow.getByRole("button", { name: "못 받음" }).click();
  await lazyRow.locator('button[aria-pressed="true"]', { hasText: "못 받음" }).waitFor();
  const miss = await check(`${lazy}의 1주차를 '못 받음'으로 바꾼 뒤`, absent, new Set([lazy]));
  assert.equal(miss.detail[pidOf[g]].mission, before.detail[pidOf[g]].mission, "마니또의 미션은 인정되지 않음");
  console.log(`  '못 받음'일 때 ${lazy} 본인: 보상 ${before.detail[pidOf[lazy]].comp} → ${miss.detail[pidOf[lazy]].comp}장 (본인 미션 ${miss.detail[pidOf[lazy]].mission}건)`);
  // 같은 버튼을 다시 누르면 확인 취소 → 처음과 같아진다. 그 뒤 '받았음'으로 되돌려 둔다
  await lazyRow.getByRole("button", { name: "못 받음" }).click();
  await lazyRow.locator('button[aria-pressed="true"]').waitFor({ state: "detached" });
  const undone = await check("확인을 취소한 뒤(처음과 같아야 함)", absent);
  assert.deepEqual(undone.tickets, before.tickets);
  await lazyRow.getByRole("button", { name: "받았음" }).click();
  await lazyRow.locator('button[aria-pressed="true"]', { hasText: "받았음" }).waitFor();
  await check(`다시 '받았음'으로`, new Set([...absent, lazy]));
  await advance("공개");
  assert.equal(tickets[pidOf["자차"]], 0); assert.equal(tickets[pidOf["사아"]], 0);
  assert.equal(detail[pidOf["마바"]].hidden, 0, "아무것도 안 한 사람은 은신 없음");

  step("결과 화면 (발표 화면 없이 '모두 공개')");
  await tab(admin, "결과");
  await panel(admin, "발표 화면").getByRole("button", { name: "발표 없이 모두 공개" }).click();
  await panel(admin, "발표 화면").getByText(/지금 참여자에게 열린 장면: (\d+) \/ \1/).waitFor();
  for (const name of JOIN) {
    const page = users[name];
    await page.reload();
    await tab(page, "결과");
    await page.locator(".target .small").waitFor();
    console.log(`  ${name}:`, (await page.locator(".target .small").innerText()).replace(/\s+/g, " "));
  }
  await tab(admin, "결과");
  // 추첨: 숫자 하나로 1·2·4·5·6등을 한 번에. 불참(가입 안 함·중도 이탈)은 응모권 0장이라 2등(응모권 최다)에도 추첨에도 없다
  const prize = panel(admin, "추첨·시상");
  await prize.locator(".seed-input").fill("11");
  await prize.getByRole("button", { name: "추첨하기" }).click();
  await prize.getByRole("button", { name: "숫자 11로 추첨 확정" }).click(); // 한 번 더 눌러 확정
  await prize.getByText("현장에서 정한 숫자: 11").waitFor();
  const winners = (await prize.locator(".winner").allInnerTexts()).map((t) => t.trim().split("\n")[0].trim());
  assert.ok(winners.length > 0, "당첨자가 있어야 한다");
  assert.equal(new Set(winners).size, winners.length, "한 사람은 하나만");
  assert.ok(!winners.includes("자차") && !winners.includes("사아"), "0장인 사람은 당첨되지 않음");
  const rawDraws = (await rest("results/public")).fields.draws.mapValue.fields;
  const won = (k) => (rawDraws[k].mapValue.fields.winners.arrayValue.values || []).map((x) => x.stringValue);
  assert.deepEqual(Object.keys(rawDraws).sort(), ["best", "grand", "t4", "t5", "t6"]);
  const withTickets = ALL.filter((n) => tickets[pidOf[n]] > 0);
  assert.equal(winners.length, withTickets.length, "응모권이 있는 사람은(5명 이하라) 모두 큰 상부터 채워진다");
  assert.equal(won("grand").length, 1);
  assert.equal(won("best").length, Math.min(3, withTickets.length - 1), "2등은 1등을 뺀 응모권 최다 순");
  assert.ok(![...won("grand"), ...won("best")].some((pid) => pid === pidOf["자차"] || pid === pidOf["사아"]), "불참자는 1·2등에 없다");
  await prize.getByRole("button", { name: "추첨 검증" }).click();
  const lines = await prize.locator("ul.plain li").allInnerTexts();
  assert.ok(lines.length === 5 && lines.every((t) => t.includes("다시 계산한 결과와 같아요")), lines.join(" | "));
  console.log("  추첨 당첨자(자차·사아 없음, 중복 없음, 검증 통과):", winners.join(", "));
  await browser.close();
  console.log("\n콘솔 오류", errors.length, "건"); errors.slice(0, 8).forEach((e) => console.log("  ", e));
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 5).join("\n")); console.log("콘솔 오류", errors.length); errors.slice(0, 5).forEach((x) => console.log("  ", x)); process.exit(1); });
