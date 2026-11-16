// 운영 실수 방지와 예전 자료 처리 확인 (전체 흐름 스크립트가 다루지 않는 것)
//  1) 예전 방식으로 배정된 자료(받는 사람 기준 코드 없음) → 미션 시작 뒤 운영 화면이 채워 넣고 인증이 된다
//  2) 주차를 내릴 때 확인창, 단서 주차당 2개(직접 요청도 거부)
//  3) 명단에 연결된 계정이 운영자 목록에 남아 있는 예전 자료 → 경고와 권한 빼기
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

// 대상 이름은 기본으로 가려져 있다(내 미션 화면). "이름 보기"를 눌러 읽는다.
const readTarget = async (p) => { const b = p.locator(".target-toggle"); await b.waitFor(); if ((await b.getAttribute("aria-pressed")) !== "true") await b.click(); return (await p.locator(".target-name").innerText()).trim(); };
// 운영 화면의 초대 코드·메일은 기본으로 가려져 있다.
const showSecrets = async (p) => { for (const b of await p.getByRole("button", { name: "초대 코드·메일 보기" }).all()) await b.click(); };
const H = require("./helpers.cjs");
const FS = `http://127.0.0.1:8080/v1/projects/${H.P}/databases/(default)/documents`;
const owner = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const step = (s) => console.log("▶", s);
async function tokenOf(email) {
  const r = await (await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "secret123", returnSecureToken: true }),
  })).json();
  return r.idToken;
}
(async () => {
  await H.reset();
  const b = await chromium.launch(); const errs = []; const dialogs = []; const mk = H.maker(b, errs, dialogs);
  const admin = await mk("운영자", { width: 1000, height: 900 });
  const inv = await H.setupAdmin(admin, ["가나,SR3,가파트", "다라,SR3,나파트", "마바,S1L,다파트"], "gadmin@example.com");

  step("예전 방식 배정 흉내: 받는 사람 기준 코드(receiverCodes)를 지운다");
  for (const d of (await (await fetch(`${FS}/receiverCodes?pageSize=50`, { headers: owner })).json()).documents) {
    await fetch(`http://127.0.0.1:8080/v1/${d.name}`, { method: "DELETE", headers: owner });
  }
  assert.equal(((await (await fetch(`${FS}/receiverCodes?pageSize=50`, { headers: owner })).json()).documents || []).length, 0);

  const u = {}, target = {};
  for (const [i, name] of ["가나", "다라", "마바"].entries()) {
    const p = await mk(name); u[name] = p;
    await H.signup(p, inv[name], `g${i}@example.com`);
    await p.locator(".target-name").waitFor();
    target[name] = await readTarget(p);
  }
  const giverOf = Object.fromEntries(Object.entries(target).map(([g, r]) => [r, g]));
  await admin.getByRole("button", { name: /다음 단계로: 미션 진행/ }).click();
  await admin.locator(".hud-chip", { hasText: "미션 진행" }).waitFor();
  // 운영 화면(짝 현황)이 채워 넣는다
  let rc = [];
  for (let t = 0; t < 20 && rc.length < 3; t++) { await admin.waitForTimeout(300); rc = (await (await fetch(`${FS}/receiverCodes?pageSize=50`, { headers: owner })).json()).documents || []; }
  assert.equal(rc.length, 3, "받는 사람 기준 코드가 채워짐");
  const gc = Object.fromEntries((await (await fetch(`${FS}/giverCodes?pageSize=50`, { headers: owner })).json()).documents.map((d) => [d.name.split("/").pop(), JSON.stringify(d.fields.codes)]));
  const asg = Object.fromEntries((await (await fetch(`${FS}/assignments?pageSize=50`, { headers: owner })).json()).documents.map((d) => [d.name.split("/").pop(), d.fields.receiverPid.stringValue]));
  for (const d of rc) { const pid = d.name.split("/").pop(); const giver = Object.keys(asg).find((g) => asg[g] === pid); assert.equal(JSON.stringify(d.fields.codes), gc[giver], "채운 코드가 그 사람의 마니또 코드와 같음"); }
  console.log("  미션 시작 뒤 운영 화면이 받는 사람 기준 코드 3건을 채움(마니또의 코드와 일치)");

  step("채운 뒤 인증이 된다: 가나 1주차 완료 → 대상이 인증 → 피드에 글");
  {
    const g = u["가나"]; await g.reload();
    const slot = H.panel(g, "1주차 미션");
    await slot.locator(".card.level-hard").click(); await slot.locator(".chosen").waitFor();
    const hardText = await slot.locator(".chosen span").nth(1).innerText();
    await slot.locator("textarea").fill("가나의 응원 쪽지");
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(g, "1주차 미션 ✔").waitFor();
    const r = u[target["가나"]]; await r.reload(); await H.tab(r, "추리 보드");
    const inbox = H.panel(r, "마니또에게서 온 것"); await inbox.locator("strong.mono").first().waitFor();
    // 받는 사람 화면에 마니또가 고른 카드가 보이고, 인증할 때 받은 것과 맞는지 고를 수 있다
    await inbox.getByText(`마니또가 고른 카드: 도전 · ${hardText}`).waitFor();
    const entry = H.panel(r, "인증하기");
    await entry.getByPlaceholder("K7Q2").fill(await inbox.locator("strong.mono").first().innerText());
    await entry.locator(".card-check").getByText(hardText).waitFor();
    await entry.getByRole("checkbox", { name: /받은 것이 이 카드 내용과 같아요/ }).uncheck();
    await entry.locator("textarea").fill("응원 쪽지 잘 받았어요. 덕분에 힘이 났어요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await r.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    await H.tab(r, "피드"); await H.panel(r, "익명 피드").getByText("응원 쪽지 잘 받았어요. 덕분에 힘이 났어요!").waitFor();
    console.log(`  ${target["가나"]}이(가) 인증 → 익명 피드에 글이 올라감`);
    const red = (await (await fetch(`${FS}/redemptions?pageSize=10`, { headers: owner })).json()).documents[0].fields;
    assert.equal(red.cardMatch.booleanValue, false);
    console.log(`  도전 카드("${hardText}")를 받는 사람이 "카드와 달라요"로 인증 → 인증 문서 cardMatch=false(도전 추가분 없음)`);
    await H.tab(admin, "운영");
    const mod = H.panel(admin, "인증 검토");
    const mismatch = mod.locator("span.small.muted", { hasText: "· 카드와 다름" });
    await mismatch.waitFor();
    await mod.getByRole("button", { name: "카드와 같다고 고치기" }).click();
    await mismatch.waitFor({ state: "detached" });
    console.log("  운영자 '인증 검토'에 '카드와 다름' 표시 → '카드와 같다고 고치기'로 되돌림");

    // 피드에서 가리기: 피드 글의 후기는 비우고 원문은 운영자만 읽는 hiddenFeed로 옮긴다(직접 요청으로도 내용이 안 보이게)
    const REVIEW = "응원 쪽지 잘 받았어요. 덕분에 힘이 났어요!";
    const feedPanel = H.panel(r, "익명 피드");
    await mod.getByRole("button", { name: "피드에서 가리기" }).click();
    await mod.locator("span.small.muted", { hasText: "· 피드에서 가림" }).waitFor();
    const fd = (await (await fetch(`${FS}/feed?pageSize=10`, { headers: owner })).json()).documents[0];
    const fid = fd.name.split("/").pop();
    assert.equal(fd.fields.review.stringValue, "");
    assert.equal(fd.fields.hidden.booleanValue, true);
    assert.equal((await (await fetch(`${FS}/hiddenFeed/${fid}`, { headers: owner })).json()).fields.review.stringValue, REVIEW);
    // 피드는 실시간으로 바뀌지 않는다: 열어 둔 화면에는 "새 글 확인"을 누르기 전까지 그대로 보인다
    await feedPanel.getByRole("button", { name: "새 글 확인" }).click();
    await feedPanel.getByText("첫 인증이 올라오면 여기에 보여요.").waitFor();
    assert.equal(await feedPanel.getByText(REVIEW).count(), 0);
    // 운영 화면에는 인증 문서의 후기가 그대로 보인다
    await mod.getByText(REVIEW).waitFor();
    console.log("  '피드에서 가리기' → 피드 문서의 후기는 빈 값, 원문은 hiddenFeed(운영자 전용), 참여자 피드에서 사라짐");
    await mod.getByRole("button", { name: "피드에 다시 보이기" }).click();
    await mod.locator("span.small.muted", { hasText: "· 피드에서 가림" }).waitFor({ state: "detached" });
    await feedPanel.getByRole("button", { name: "새 글 확인" }).click();
    await feedPanel.getByText(REVIEW).waitFor();
    assert.equal((await fetch(`${FS}/hiddenFeed/${fid}`, { headers: owner })).status, 404);
    console.log("  '피드에 다시 보이기' → 원문으로 되돌아오고 hiddenFeed는 지워짐");
  }

  step("쪽지 신고: 받는 사람이 신고 → 운영자 '쪽지 검토'에 먼저 보임 → 가리기 → 받는 사람 화면에서 내용이 가려짐");
  {
    const g = u["가나"]; await H.tab(g, "추리 보드"); await H.tab(g, "내 미션");
    const slot = H.panel(g, "1주차 미션 ✔");
    await slot.getByRole("button", { name: "쪽지 더 보내기" }).click();
    await slot.locator(".more-notes textarea").fill("기분 나쁜 장난 쪽지(시험)");
    await slot.getByRole("button", { name: "쪽지 보내기" }).click();
    await slot.getByText("이 주차에 더 보낸 쪽지 1건").waitFor();
    const r = u[target["가나"]]; await H.tab(r, "피드"); await H.tab(r, "추리 보드");
    const inbox = H.panel(r, "마니또에게서 온 것");
    const d = inbox.locator(".dialogue", { hasText: "기분 나쁜 장난 쪽지(시험)" });
    await d.waitFor();
    await d.getByRole("button", { name: "이 쪽지 신고" }).click();
    await d.getByText("운영진에게 신고한 쪽지예요.").waitFor();
    const nr = H.panel(admin, "쪽지 검토 (신고 1건)");
    await nr.waitFor();
    await nr.getByRole("button", { name: /쪽지 \d+건 보기/ }).click();
    const item = nr.locator("li", { hasText: "기분 나쁜 장난 쪽지(시험)" });
    await item.getByText("받는 사람이 신고함").waitFor();
    console.log("  운영자 화면:", (await item.locator(".small.muted").innerText()).replace(/\s+/g, " "));
    await item.getByRole("button", { name: "가리기" }).click();
    await H.panel(admin, "쪽지 검토 (신고 0건)").waitFor();
    await inbox.getByText("운영진이 가린 쪽지예요.").waitFor();
    assert.equal(await inbox.getByText("기분 나쁜 장난 쪽지(시험)").count(), 0);
    console.log("  가리기 후 받는 사람 화면: '운영진이 가린 쪽지예요.'");
  }

  step("나중 카드 확인: 완료 알림보다 먼저 인증하면 카드 추가분이 바로 붙지 않고, 알림이 온 뒤 받는 사람이 카드를 확인해야 붙는다");
  {
    const g = u["다라"]; await H.tab(g, "추리 보드"); await H.tab(g, "내 미션");
    const slot = H.panel(g, "1주차 미션");
    await slot.locator(".card.level-hard").click(); await slot.locator(".chosen").waitFor();
    const hardText = await slot.locator(".chosen span").nth(1).innerText();
    const code = (await slot.locator(".code-tag strong").innerText()).trim(); // 실물과 함께 전한 메모의 코드
    // 받는 사람이 완료 알림보다 먼저 인증한다: 카드가 아직 안 보이므로 확인 칸이 없다
    const r = u[target["다라"]]; await H.tab(r, "피드"); await H.tab(r, "추리 보드");
    const entry = H.panel(r, "인증하기");
    await entry.getByPlaceholder("K7Q2").fill(code);
    await r.waitForTimeout(800);
    assert.equal(await entry.locator(".card-check").count(), 0, "완료 알림 전에는 카드 확인 칸이 없다");
    await entry.locator("textarea").fill("메모에 적힌 코드로 먼저 인증해요. 잘 받았어요, 고마워요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await r.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    const redDoc = async () => (await (await fetch(`${FS}/redemptions/${code}`, { headers: owner })).json()).fields;
    assert.equal((await redDoc()).cardMatch, undefined, "카드를 못 보고 한 인증에는 cardMatch가 없다");
    // 마니또 화면: 미션은 인증됐지만 카드 추가분은 0, 완료 알리기를 누르라는 안내
    const tk = H.panel(g, "내 응모권 (지금까지)");
    await tk.getByText(/인증된 미션 1 \/ 3 \+ 카드 추가분 0 \/ 4/).waitFor();
    await tk.getByText(/카드 확인 대기/).waitFor();
    await tk.getByText(/1주차 "미션 완료 알리기"를 눌러 주세요/).waitFor();
    await slot.getByText(/이미 인증해서 카드를 바꿀 수 없어요\. 완료 알리기를 눌러 주세요/).waitFor();
    // 운영 화면 '인증 검토'에 '카드 확인 전'
    const mod = H.panel(admin, "인증 검토");
    await mod.locator("span.small.muted", { hasText: "· 카드 확인 전" }).waitFor();
    // 마니또가 완료를 알린다 → 받는 사람의 할 일과 '내가 인증한 것'에 카드 확인이 뜬다
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(g, "1주차 미션 ✔").waitFor();
    await tk.getByText(/대상이 추리 보드에서 "카드와 같았어요"를 누르면 카드 추가분이 붙어요/).waitFor();
    await H.tab(r, "내 미션");
    await r.getByText("인증한 미션 1건의 카드 확인하기").waitFor();
    await H.tab(r, "추리 보드");
    const check = H.panel(r, "내가 인증한 것").locator(".card-check");
    await check.getByText(hardText).waitFor();
    await check.getByRole("button", { name: "카드와 같았어요" }).click();
    await check.waitFor({ state: "detached" });
    assert.equal((await redDoc()).cardMatch.booleanValue, true);
    await tk.getByText(/인증된 미션 1 \/ 3 \+ 카드 추가분 2 \/ 4/).waitFor();
    assert.equal(await tk.getByText(/카드 확인 대기/).count(), 0);
    await mod.locator("span.small.muted", { hasText: "· 카드 확인 전" }).waitFor({ state: "detached" });
    await H.tab(r, "내 미션");
    assert.equal(await r.getByText("인증한 미션 1건의 카드 확인하기").count(), 0);
    // 한 번 남긴 확인은 받는 사람이 다시 바꿀 수 없다(직접 요청)
    const tok = await tokenOf(`g${["가나", "다라", "마바"].indexOf(target["다라"])}@example.com`);
    const again = await fetch(`${FS}/redemptions/${code}?updateMask.fieldPaths=cardMatch`, {
      method: "PATCH", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields: { cardMatch: { booleanValue: false } } }),
    });
    assert.equal(again.status, 403);
    console.log(`  ${target["다라"]}이(가) 알림보다 먼저 인증 → 다라의 카드 추가분 0, '카드 확인 대기' → 완료 알리기 → ${target["다라"]}이(가) "카드와 같았어요" → 추가분 2(도전), 다시 바꾸기 403`);
  }

  step("주차 내리기 확인창, 단서 주차당 2개(직접 요청)");
  {
    await H.panel(admin, "주차").getByRole("button", { name: "2주차" }).click();
    await admin.locator(".hud-chip", { hasText: "2주차" }).waitFor();
    const before = dialogs.length;
    await H.panel(admin, "주차").getByRole("button", { name: "1주차" }).click();
    await admin.locator(".hud-chip", { hasText: "1주차" }).waitFor();
    const d = dialogs.slice(before).join(" ");
    assert.match(d, /2주차 → 1주차로 내릴까요\?/);
    console.log("  주차를 내릴 때 확인창:", d.split("\n")[0]);
    const tok = await tokenOf("gadmin@example.com");
    const patch = (n) => fetch(`${FS}/config/app?updateMask.fieldPaths=cluesReleased`, {
      method: "PATCH", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields: { cluesReleased: { integerValue: String(n) } } }),
    }).then((x) => x.status);
    assert.deepEqual([await patch(4), await patch(2), await patch(4), await patch(0)], [403, 200, 403, 403]);
    console.log("  1주차에 단서 4개 공개 요청 403, 2개 200, 한 번 더(4개) 403, 다시 잠그기(0개) 403");
  }

  step("예전 자료: 명단에 연결된 계정이 운영자 목록에 남아 있으면 경고하고 권한을 뺄 수 있다");
  {
    const cfg = await (await fetch(`${FS}/config/app`, { headers: owner })).json();
    const admins = cfg.fields.admins.arrayValue.values.map((v) => v.stringValue);
    const roster = (await (await fetch(`${FS}/roster?pageSize=50`, { headers: owner })).json()).documents;
    const ganaUid = roster.find((d) => d.fields.name.stringValue === "가나").fields.uid.stringValue;
    await fetch(`${FS}/config/app?updateMask.fieldPaths=admins`, { method: "PATCH", headers: owner, body: JSON.stringify({ fields: { admins: { arrayValue: { values: [...admins, ganaUid].map((x) => ({ stringValue: x })) } } } }) });
    const cp = H.panel(admin, "공동 운영자 (운영자 2명)");
    await cp.getByText("명단에 연결된 계정이 운영자로 남아 있어요: 가나").waitFor();
    await cp.locator(".admin-list li", { hasText: "가나 (참여자)" }).getByRole("button", { name: "권한 빼기" }).click();
    await H.panel(admin, "공동 운영자 (운영자 1명)").waitFor();
    assert.equal(await admin.getByText("명단에 연결된 계정이 운영자로 남아 있어요").count(), 0);
    console.log("  경고 표시 → '권한 빼기' → 운영자 1명, 경고 사라짐");
  }
  assert.equal(await admin.locator(".error.banner").count(), 0, "규칙 버전 경고 없음(새 규칙)");
  console.log("\n콘솔 오류·경고", errs.length, "건"); errs.slice(0, 6).forEach((e) => console.log("  ", e));
  await b.close();
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 5).join("\n")); process.exit(1); });
