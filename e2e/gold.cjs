// 2주차 새 카드와 황금 카드(사용자가 정함, 11/23):
//  - 2주차부터 쉬움·보통 카드 두 장 중 한 장은 새 카드(NEW), 난이도 칸 옆에 "✨ 황금 카드" 칸(1주차에는 없음)
//  - 황금 카드 두 장(돈이 드는 것 + 안 드는 것) → 고르고 완료 → 대상 화면에 황금 표시 → 대상이 "카드와 같아요"로 인증
//  - 주차가 끝나기 전에는 추첨 버튼이 꺼져 있고, 끝나면 추첨 대상(황금 카드 + 인증 + 카드와 같음)만 뽑힌다
//  - 사이트에 들어오면 결과 팝업(당첨 축하·미당첨 위로, 한 번 닫으면 다시 안 뜸), 내 미션 화면에서도 확인, 남의 당첨은 못 읽는다
// 먼저 `npm run dev:emu`를 띄워 둘 것. 로컬 에뮬레이터 데이터를 지우고 시작한다.
// 화면 사진은 e2e/shots/gold(또는 GOLD_SHOTS=경로)에 남긴다(사람이 보는 용도라 2배 해상도).
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const H = require("./helpers.cjs");

const step = (s) => console.log("▶ " + s);
const FS = `http://127.0.0.1:8080/v1/projects/${H.P}/databases/(default)/documents`;
const owner = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const SHOTS = process.env.GOLD_SHOTS || path.join(__dirname, "shots", "gold");
let shotNo = 0;
const shot = (loc, name) => loc.screenshot({ path: path.join(SHOTS, `${String(++shotNo).padStart(2, "0")}-${name}.png`) });
const setWeek = async (week) => {
  const r = await fetch(`${FS}/config/app?updateMask.fieldPaths=week`, { method: "PATCH", headers: owner, body: JSON.stringify({ fields: { week: { integerValue: String(week) } } }) });
  assert.ok(r.ok, `주차 바꾸기 ${r.status}`);
};
async function tokenOf(email) {
  const r = await (await fetch("http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "secret123", returnSecureToken: true }),
  })).json();
  return r.idToken;
}

(async () => {
  await H.reset();
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch();
  const errs = [], dialogs = [];
  // 사람이 볼 사진이라 2배 해상도로 연다(그 밖에는 helpers.cjs maker와 같다)
  const mk = async (label, viewport = { width: 420, height: 900 }) => {
    const ctx = await b.newContext({ viewport, deviceScaleFactor: 2 });
    await ctx.addInitScript(() => { try { localStorage.setItem("manito:adminFull", "1"); } catch {} });
    const page = await ctx.newPage();
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && !m.text().includes("TUNNEL") && errs.push(`[${label}] ${m.text().slice(0, 160)}`));
    page.on("pageerror", (e) => errs.push(`[${label}] pageerror ${e.message}`));
    return page;
  };
  const admin = await mk("운영자", { width: 1000, height: 900 });
  const NAMES = ["가나", "다라", "마바", "사아"];
  const inv = await H.setupAdmin(admin, NAMES.map((n, i) => `${n},${"가나다라"[i]}파트`));
  const u = {}, target = {}, email = {};
  for (const [i, name] of NAMES.entries()) {
    const p = await mk(name); u[name] = p; email[name] = `gold${i}@example.com`;
    await H.signup(p, inv[name], email[name]);
    await p.locator(".target-name:visible").waitFor();
  }
  await admin.getByRole("button", { name: "다음 단계로: 미션 진행" }).click();
  await admin.locator(".hud-chip", { hasText: "미션 진행 1주차" }).waitFor();
  const roster = (await (await fetch(`${FS}/roster?pageSize=20`, { headers: owner })).json()).documents;
  const pidOf = Object.fromEntries(roster.map((d) => [d.fields.name.stringValue, d.name.split("/").pop()]));
  for (const n of NAMES) { await u[n].reload(); target[n] = await H.readTarget(u[n]); }

  step("1주차에는 황금 카드 칸이 없다");
  {
    const s1 = H.panel(u["가나"], "1주차 미션");
    await s1.locator(".level-pick").first().waitFor();
    assert.equal(await s1.locator(".level-pick").count(), 3);
    assert.equal(await s1.locator(".level-pick.is-gold").count(), 0);
  }

  step("2주차: 난이도 칸 옆에 ✨ 황금 카드, 쉬움·보통은 두 장 중 한 장이 NEW");
  await setWeek(2);
  for (const n of NAMES) await u[n].locator(".hud-chip", { hasText: "미션 진행 2주차" }).waitFor();
  {
    const g = u["가나"];
    const slot = H.panel(g, "2주차 미션");
    await slot.locator(".level-pick.is-gold").waitFor();
    assert.equal(await slot.locator(".level-pick").count(), 4, "쉬움·보통·도전·황금");
    await shot(slot, "level-tiles");
    // 보통: 두 장 중 한 장이 새 카드
    await slot.locator(".level-pick.level-normal").click();
    await slot.locator(".dealt .card").first().waitFor();
    assert.equal(await slot.locator(".dealt .card").count(), 2);
    assert.equal(await slot.locator(".dealt .card .new-tag").count(), 1, "보통 두 장 중 NEW 한 장");
    await shot(slot, "normal-with-new");
    await slot.getByRole("button", { name: "난이도 다시 고르기" }).click();
    // 황금 카드 두 장: 돈이 드는 것 한 장 + 안 드는 것 한 장
    await slot.locator(".level-pick.is-gold").click();
    const goldCards = slot.locator(".dealt .card.is-gold");
    await goldCards.first().waitFor();
    assert.equal(await goldCards.count(), 2);
    assert.equal(await slot.locator(".dealt .card.is-gold .cost-tag").count(), 1, "돈이 드는 황금 카드 한 장");
    await slot.getByText("특별 도전 미션이에요").waitFor();
    await shot(slot, "gold-deal");
    await goldCards.filter({ hasNot: g.locator(".cost-tag") }).click(); // 돈 안 드는 타임어택 배달
    await slot.locator(".chosen.is-gold .gold-tag", { hasText: "✨ 황금 카드" }).waitFor();
    await slot.locator("textarea").fill("오후 3시에 분석실 신발장 맨 위 칸을 확인해 보세요!");
    await shot(slot, "gold-chosen");
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(g, "2주차 미션 ✔").waitFor();
    await H.panel(g, "2주차 미션 ✔").getByText("황금 카드 추첨은 2주차가 끝난 뒤에 해요").waitFor();
  }
  {
    // 다라: 보통의 새 카드(사이트 쪽지)
    const d = u["다라"];
    const slot = H.panel(d, "2주차 미션");
    await slot.locator(".level-pick.level-normal").click();
    await slot.locator(".dealt .card .new-tag").waitFor();
    await slot.locator(".dealt .card", { has: d.locator(".new-tag") }).click();
    await slot.locator(".chosen").waitFor();
    await slot.locator("textarea").fill("새 카드 미션 쪽지예요. 오늘도 힘내세요!");
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(d, "2주차 미션 ✔").waitFor();
    // 마바: 돈이 드는 황금 카드(마니또 카페), 사아: 돈 안 드는 황금 카드
    for (const [n, paid] of [["마바", true], ["사아", false]]) {
      const p = u[n];
      const s = H.panel(p, "2주차 미션");
      await s.locator(".level-pick.is-gold").click();
      const cards = s.locator(".dealt .card.is-gold");
      await cards.first().waitFor();
      await (paid ? cards.filter({ has: p.locator(".cost-tag") }) : cards.filter({ hasNot: p.locator(".cost-tag") })).click();
      await s.locator(".chosen.is-gold").waitFor();
      await s.locator("textarea").fill(`${n}의 황금 미션: 자리를 확인해 보세요`);
      await s.getByRole("button", { name: "미션 완료 알리기" }).click();
      await H.panel(p, "2주차 미션 ✔").waitFor();
    }
    console.log("  가나·사아: 돈 안 드는 황금 카드, 마바: 돈 드는 황금 카드, 다라: 보통 NEW 카드로 완료");
  }

  step("대상: 황금 카드 표시를 보고 인증(가나의 대상은 '카드와 같아요', 마바의 대상은 '카드와 달라요', 사아의 대상은 인증 안 함)");
  async function verify(giver, same) {
    const r = u[target[giver]];
    await r.reload(); await H.tab(r, "추리 보드");
    const inbox = H.panel(r, "마니또에게서 온 것");
    await inbox.locator(".gold-tag", { hasText: "✨ 황금 카드" }).first().waitFor();
    if (giver === "가나") await shot(inbox, "receiver-inbox");
    const entry = H.panel(r, "인증하기");
    await entry.getByPlaceholder("쪽지에 적힌 4자리").fill(await inbox.locator("strong.mono").first().innerText());
    await entry.locator(".card-check .gold-tag").waitFor();
    await entry.getByText("그래야 내 마니또가 커피 쿠폰 추첨 대상이 돼요").waitFor();
    if (!same) await entry.getByRole("checkbox", { name: /받은 것이 이 카드 내용과 같아요/ }).uncheck();
    await entry.locator("textarea").fill("황금 카드 미션 잘 받았어요. 정말 깜짝 놀랐어요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await entry.getByText(/^인증했어요\./).first().waitFor();
  }
  await verify("가나", true);
  await verify("마바", false);
  console.log(`  ${target["가나"]}: 카드와 같아요로 인증, ${target["마바"]}: 카드와 달라요로 인증, ${target["사아"]}: 인증 안 함`);

  step("운영 화면 추첨: 주차가 끝나기 전에는 못 누르고, 끝나면 추첨 대상(가나 1명)만 뽑힌다");
  {
    await H.tab(admin, "운영");
    const gp = H.panel(admin, "황금 카드 추첨");
    const row2 = gp.locator(".row-item", { hasText: "2주차" });
    await row2.getByText("황금 카드 고름 3명 · 완료 3명 · 추첨 대상 1명").waitFor();
    assert.equal(await row2.getByRole("button", { name: "2주차 황금 카드 추첨하기" }).isDisabled(), true, "2주차가 끝나기 전에는 못 누른다");
    await row2.getByText("2주차가 끝나면 누를 수 있어요.").waitFor();
    await setWeek(3);
    await admin.locator(".hud-chip", { hasText: "미션 진행 3주차" }).waitFor();
    await row2.getByRole("button", { name: "2주차 황금 카드 추첨하기" }).click();
    await row2.getByText(/추첨 완료: 가나/).waitFor();
    assert.ok(dialogs.some((m) => m.includes("2주차 황금 카드 추첨을 할까요?") && m.includes("추첨 대상 1명")), "추첨 전에 확인창");
    await shot(gp, "admin-draw");
    const meta = await H.readDoc("meta/goldDraw");
    assert.deepEqual(meta.weeks["2"].winners, [pidOf["가나"]]);
    assert.deepEqual(meta.weeks["2"].candidates, [pidOf["가나"]]);
    const pub = await H.readDoc("public/goldDraw");
    assert.equal(pub.weeks["2"].winners, 1);
    assert.equal(pub.weeks["2"].candidates, 1);
    assert.equal(JSON.stringify(Object.keys(pub.weeks["2"]).sort()), JSON.stringify(["at", "candidates", "winners"]), "참여자가 읽는 문서에는 이름이 없다");
    assert.equal((await H.readDoc(`goldWins/${pidOf["가나"]}`)).weeks["2"], true);
    // 3주차 행: 뽑을 수 = 5 + 2주차에 남은 4자리
    await gp.locator(".row-item", { hasText: "3주차" }).getByText("뽑을 수 9명").waitFor();
    console.log("  2주차가 끝난 뒤 추첨: 대상 1명(가나) → 가나 당첨, 3주차는 남은 4자리를 더해 9명");
  }

  step("사이트에 들어오면 결과 팝업: 당첨자는 축하, 황금 카드를 했지만 안 뽑힌 사람은 위로, 한 번 닫으면 다시 안 뜸");
  {
    const g = u["가나"]; await g.reload();
    const win = g.locator(".gold-pop.is-win");
    await win.getByText("축하해요! 당첨이에요!").waitFor();
    await win.getByText("2주차 황금 카드 추첨 결과").waitFor();
    await win.getByText("5천원 커피 쿠폰").waitFor();
    await g.waitForTimeout(900); // 팝업이 커지는 효과가 끝난 뒤 사진
    await g.screenshot({ path: path.join(SHOTS, `${String(++shotNo).padStart(2, "0")}-popup-win.png`) });
    await win.getByRole("button", { name: "야호! 확인" }).click();
    await win.waitFor({ state: "detached" });
    await g.reload(); await H.tab(g, "내 미션");
    await g.waitForTimeout(1500);
    assert.equal(await g.locator(".gold-pop").count(), 0, "한 번 닫으면 다시 안 뜬다");
    for (const n of ["마바", "사아"]) {
      const p = u[n]; await p.reload();
      const lose = p.locator(".gold-pop.is-lose");
      await lose.getByText("아쉽게도 이번엔 뽑히지 않았어요").waitFor();
      await lose.getByText("3주차에도 황금 카드 추첨이 있어요").waitFor();
      if (n === "마바") { await p.waitForTimeout(900); await p.screenshot({ path: path.join(SHOTS, `${String(++shotNo).padStart(2, "0")}-popup-lose.png`) }); }
      await lose.getByRole("button", { name: "확인" }).click();
      await lose.waitFor({ state: "detached" });
    }
    const d = u["다라"]; await d.reload(); await H.tab(d, "내 미션");
    await d.waitForTimeout(1500);
    assert.equal(await d.locator(".gold-pop").count(), 0, "황금 카드를 안 한 사람에게는 팝업이 없다");
    console.log("  가나: 축하 팝업 → 닫으면 다시 안 뜸, 마바·사아: 위로 팝업, 다라(황금 안 함): 팝업 없음");
  }

  step("내 미션 화면에서도 결과 확인, 남의 당첨은 못 읽는다");
  {
    const g = u["가나"];
    const w2 = H.panel(g, "2주차 미션 ✔");
    await w2.getByText("2주차 황금 카드 추첨에 뽑혔어요!").waitFor();
    await shot(w2, "winner");
    for (const n of ["마바", "사아"]) {
      const p = u[n];
      await H.tab(p, "내 미션"); // 새로 고치면 마지막에 보던 탭이 열린다(대상으로 인증한 사람은 추리 보드)
      await H.panel(p, "2주차 미션 ✔").getByText("이번 주에는 뽑히지 않았어요").waitFor();
    }
    await shot(H.panel(u["마바"], "2주차 미션 ✔"), "not-winner");
    await H.panel(u["다라"], "2주차 미션 ✔").waitFor();
    assert.equal(await H.panel(u["다라"], "2주차 미션 ✔").getByText(/황금 카드 추첨/).count(), 0, "황금 카드를 안 한 사람에게는 안 보인다");
    const tok = await tokenOf(email["마바"]);
    const other = await fetch(`${FS}/goldWins/${pidOf["가나"]}`, { headers: { Authorization: `Bearer ${tok}` } });
    assert.equal(other.status, 403, "남의 당첨은 못 읽는다");
    const metaRead = await fetch(`${FS}/meta/goldDraw`, { headers: { Authorization: `Bearer ${tok}` } });
    assert.equal(metaRead.status, 403, "추첨 기록(당첨자 이름)은 못 읽는다");
    console.log("  가나: '뽑혔어요', 마바·사아: '뽑히지 않았어요', 다라(황금 안 함): 표시 없음, 마바가 가나의 당첨·추첨 기록 직접 읽기 403");
  }

  step("규칙 탭: 새 카드와 황금 카드 설명");
  {
    const g = u["가나"];
    await H.tab(g, "규칙");
    const gold = H.panel(g, "2주차부터: 새 카드와 ✨ 황금 카드");
    await gold.getByText("매주 5명").waitFor();
    await gold.getByText("밸런스 게임, 방탈출 쪽지, 비밀 지령, 실황 중계").waitFor();
    await shot(gold, "rules-gold");
    await shot(H.panel(g, "미션 카드"), "rules-cards");
    await g.screenshot({ path: path.join(SHOTS, `${String(++shotNo).padStart(2, "0")}-rules-full.png`), fullPage: true });
    assert.ok(await g.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "휴대폰 폭에서 가로 스크롤 없음");
  }

  await b.close();
  console.log(`콘솔 오류·경고 ${errs.length} 건`);
  if (errs.length) { console.log(errs.join("\n")); process.exit(1); }
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
