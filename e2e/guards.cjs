// 운영 실수 방지와 예전 자료 처리 확인 (전체 흐름 스크립트가 다루지 않는 것)
//  1) 예전 방식으로 배정된 자료(받는 사람 기준 코드 없음) → 미션 시작 뒤 운영 화면이 채워 넣고 인증이 된다
//  2) 주차를 내릴 때 확인창, 단서 주차당 2개(직접 요청도 거부)
//  3) 명단에 연결된 계정이 운영자 목록에 남아 있는 예전 자료 → 경고와 권한 빼기
const { chromium } = require("playwright");
const assert = require("node:assert/strict");

// 대상 이름은 기본으로 가려져 있다(내 미션 화면). "이름 보기"를 눌러 읽는다.
const readTarget = async (p) => { const b = p.locator(".target-toggle:visible"); await b.waitFor(); if ((await b.getAttribute("aria-pressed")) !== "true") await b.click(); return (await p.locator(".target-name:visible").innerText()).trim(); };
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
  const inv = await H.setupAdmin(admin, ["가나,가파트", "다라,나파트", "마바,다파트"], "gadmin@example.com");

  step("예전 방식 배정 흉내: 받는 사람 기준 코드(receiverCodes)를 지운다");
  for (const d of (await (await fetch(`${FS}/receiverCodes?pageSize=50`, { headers: owner })).json()).documents) {
    await fetch(`http://127.0.0.1:8080/v1/${d.name}`, { method: "DELETE", headers: owner });
  }
  assert.equal(((await (await fetch(`${FS}/receiverCodes?pageSize=50`, { headers: owner })).json()).documents || []).length, 0);

  const u = {}, target = {};
  for (const [i, name] of ["가나", "다라", "마바"].entries()) {
    const p = await mk(name); u[name] = p;
    await H.signup(p, inv[name], `g${i}@example.com`);
    await p.locator(".target-name:visible").waitFor();
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
    await H.pickCard(slot, "hard");
    const hardText = await slot.locator(".chosen .chosen-text").innerText();
    await slot.locator("textarea").fill("가나의 응원 쪽지");
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(g, "1주차 미션 ✔").waitFor();
    const r = u[target["가나"]]; await r.reload(); await H.tab(r, "추리 보드");
    const inbox = H.panel(r, "마니또에게서 온 것"); await inbox.locator("strong.mono").first().waitFor();
    // 받는 사람 화면에 마니또가 고른 카드가 보이고, 인증할 때 받은 것과 맞는지 고를 수 있다
    await inbox.getByText(`마니또가 고른 카드: 도전 · ${hardText}`).waitFor();
    // 받는 쪽에도 카드를 하는 방법(사이트 쪽지 / 실물 전달)이 보인다
    await inbox.locator(".how-hint .how-tag").first().waitFor();
    assert.match(await inbox.locator(".how-hint").first().innerText(), /(사이트 쪽지 카드예요: 사이트로 온 쪽지가 곧 미션이에요|실물 전달 카드예요: 실물이 따로 있어요)/);
    const entry = H.panel(r, "인증하기");
    await entry.getByPlaceholder("쪽지에 적힌 4자리").fill(await inbox.locator("strong.mono").first().innerText());
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
    // 피드 요약(public/feed): 운영자 화면이 최근 글을 한 문서에 모아 두고 참여자는 그것을 읽는다(읽기 줄이기)
    const digestPost = async (pick) => ((await H.readDoc("public/feed")).recent || []).find(pick);
    let inDigest;
    for (let k = 0; k < 60 && !inDigest; k++) { inDigest = await digestPost((x) => x.review === REVIEW); if (!inDigest) await r.waitForTimeout(500); }
    assert.ok(inDigest, "운영자 화면이 피드 요약에 글을 모아 둔다");
    await mod.getByRole("button", { name: "피드에서 가리기" }).click();
    await mod.locator("span.small.muted", { hasText: "· 피드에서 가림" }).waitFor();
    // 화면의 "가림" 표시는 저장이 서버에 닿기 전에도 뜬다. 서버의 글이 비워질 때까지 잠깐 기다린다.
    let fd;
    for (let k = 0; k < 25; k++) {
      fd = (await (await fetch(`${FS}/feed?pageSize=10`, { headers: owner })).json()).documents[0];
      if (fd.fields.hidden?.booleanValue) break;
      await r.waitForTimeout(200);
    }
    const fid = fd.name.split("/").pop();
    assert.equal(fd.fields.review.stringValue, "");
    assert.equal(fd.fields.hidden.booleanValue, true);
    assert.equal((await (await fetch(`${FS}/hiddenFeed/${fid}`, { headers: owner })).json()).fields.review.stringValue, REVIEW);
    // 가리면 피드 요약에서도 바로 후기가 비워진다(가린 후기가 요약에 남아 참여자에게 보이지 않게)
    let dp;
    for (let k = 0; k < 25; k++) { dp = await digestPost((x) => x.id === fid); if (dp?.hidden) break; await r.waitForTimeout(200); }
    assert.equal(dp.hidden, true, "요약에도 가림");
    assert.equal(dp.review, "", "요약의 후기도 빈 값");
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
    for (let k = 0; k < 25; k++) { dp = await digestPost((x) => x.id === fid); if (dp && !dp.hidden) break; await r.waitForTimeout(200); }
    assert.equal(dp.review, REVIEW, "다시 보이면 요약에도 원문");
    console.log("  '피드에 다시 보이기' → 원문으로 되돌아오고 hiddenFeed는 지워짐");

    // 글쓴이의 후기·답장 고치기(11/23: 후기에 실수로 이름을 쓴 경우). 운영자가 먼저 가리고 → 글쓴이가 고치고 → 다시 보이면 고친 글
    const EDIT1 = "응원 쪽지 잘 받았어요. 이름은 지웠어요, 덕분에 힘이 났어요!";
    const EDIT2 = "응원 쪽지 잘 받았어요. 한 번 더 고쳤어요, 덕분에 힘이 났어요!";
    const redDoc = async () => (await (await fetch(`${FS}/redemptions?pageSize=10`, { headers: owner })).json()).documents[0].fields;
    const feedDoc = async () => (await (await fetch(`${FS}/feed/${fid}`, { headers: owner })).json()).fields;
    await mod.getByRole("button", { name: "피드에서 가리기" }).click();
    await mod.locator("span.small.muted", { hasText: "· 피드에서 가림" }).waitFor();
    await H.tab(r, "추리 보드");
    const mine = H.panel(r, "내가 인증한 것");
    await mine.getByText("운영진이 이 후기를 피드에서 가렸어요").waitFor();
    await mine.getByRole("button", { name: "후기 고치기" }).click();
    await mine.getByLabel("고칠 후기").fill(EDIT1);
    await mine.getByRole("button", { name: "고친 내용 저장" }).click();
    await mine.getByText("후기를 고쳤어요. 운영진이 다시 보이게 하면 고친 글이 보여요.").waitFor();
    await mine.locator(".my-review", { hasText: EDIT1 }).waitFor();
    let fdoc = await feedDoc();
    assert.equal(fdoc.review.stringValue, "", "가린 글의 피드 후기는 빈 값 그대로");
    assert.ok(fdoc.editedAt, "고친 시각");
    assert.equal((await (await fetch(`${FS}/hiddenFeed/${fid}`, { headers: owner })).json()).fields.review.stringValue, EDIT1, "원문 자리가 고친 글");
    let red2 = await redDoc();
    assert.equal(red2.review.stringValue, EDIT1);
    assert.equal(Number(red2.edits.integerValue), 1);
    await mod.getByText(EDIT1).waitFor();
    await mod.locator("span.small.muted", { hasText: "· 고침 1번" }).waitFor();
    await mod.getByRole("button", { name: "피드에 다시 보이기" }).click();
    await mod.locator("span.small.muted", { hasText: "· 피드에서 가림" }).waitFor({ state: "detached" });
    for (let k = 0; k < 25; k++) { fdoc = await feedDoc(); if (fdoc.review.stringValue === EDIT1) break; await r.waitForTimeout(200); }
    assert.equal(fdoc.review.stringValue, EDIT1, "다시 보이면 고친 글");
    for (let k = 0; k < 25; k++) { dp = await digestPost((x) => x.id === fid); if (dp?.review === EDIT1) break; await r.waitForTimeout(200); }
    assert.equal(dp.review, EDIT1, "요약에도 고친 글");
    await H.tab(r, "피드");
    await feedPanel.getByRole("button", { name: "새 글 확인" }).click();
    await feedPanel.locator(".dialogue", { hasText: EDIT1 }).locator(".edited-mark").waitFor();
    assert.equal(await feedPanel.getByText(REVIEW).count(), 0);
    console.log("  가린 글을 글쓴이가 고침 → 피드 글은 빈 후기 그대로, 원문 자리(hiddenFeed)·인증 문서가 고친 글 → '다시 보이기'로 고친 글이 '(고침)' 표시와 함께 보임");

    // 보이는 글을 고치면: 피드 요약(운영자 화면이 10초 뒤 다시 씀)이 아직 예전 글이어도 다른 참여자는 고친 글을 본다(editedAt 조회)
    await H.tab(r, "추리 보드");
    await mine.getByRole("button", { name: "후기 고치기" }).click();
    await mine.getByLabel("고칠 후기").fill(EDIT2);
    await mine.getByRole("button", { name: "고친 내용 저장" }).click();
    await mine.getByText("후기를 고쳤어요.", { exact: true }).waitFor();
    for (let k = 0; k < 25; k++) { fdoc = await feedDoc(); if (fdoc.review.stringValue === EDIT2) break; await r.waitForTimeout(200); }
    assert.equal(fdoc.review.stringValue, EDIT2);
    const other = u["가나"];
    await other.reload(); await H.tab(other, "피드");
    await H.panel(other, "익명 피드").locator(".dialogue", { hasText: EDIT2 }).waitFor();
    const staleDigest = (await digestPost((x) => x.id === fid))?.review;
    assert.equal(staleDigest, EDIT1, "이 순간 피드 요약은 아직 예전 글(그래도 고친 글이 보여야 한다)");
    assert.equal(await H.panel(other, "익명 피드").getByText(EDIT1).count(), 0);
    for (let k = 0; k < 60; k++) { dp = await digestPost((x) => x.id === fid); if (dp?.review === EDIT2) break; await r.waitForTimeout(500); }
    assert.equal(dp.review, EDIT2, "운영자 화면이 요약도 다시 쓴다");
    console.log("  보이는 글을 고침 → 피드 요약이 예전 글인 동안에도 다른 참여자 피드에 고친 글(요약 뒤 고친 글 조회), 그 뒤 요약도 고친 글");

    // 감사 답장: 처음 쓰기 → 고치기(후기와 합쳐 3번째) → 횟수를 다 쓰면 고치기 버튼이 없다
    await mine.getByRole("button", { name: "마니또에게 감사 답장 보내기" }).click();
    await mine.getByLabel("감사 답장").fill("첫 답장이에요");
    await mine.getByRole("button", { name: "보내기", exact: true }).click();
    await mine.getByText("보낸 감사 답장: 첫 답장이에요").waitFor();
    await mine.getByRole("button", { name: "답장 고치기" }).click();
    await mine.getByLabel("고칠 답장").fill("고친 답장이에요");
    await mine.getByRole("button", { name: "고친 내용 저장" }).click();
    await mine.getByText("보낸 감사 답장: 고친 답장이에요").waitFor();
    await mine.getByText("고칠 수 있는 횟수를 다 썼어요").waitFor();
    assert.equal(await mine.getByRole("button", { name: "후기 고치기" }).count(), 0);
    assert.equal(await mine.getByRole("button", { name: "답장 고치기" }).count(), 0);
    for (let k = 0; k < 25; k++) { fdoc = await feedDoc(); if (fdoc.thanks?.stringValue === "고친 답장이에요") break; await r.waitForTimeout(200); }
    assert.equal(fdoc.thanks.stringValue, "고친 답장이에요");
    red2 = await redDoc();
    assert.equal(Number(red2.edits.integerValue), 3);
    console.log("  감사 답장 보내기 → 답장 고치기 → 후기·답장 합쳐 3번을 다 쓰면 고치기 버튼이 사라짐");

    // 운영자가 지운 이유(modNotes): 쓴 사람에게만 보이고, 지운 뒤에도 다시 쓸 수 있다(11/23 사용자 요청)
    const R1 = "답장에 이름이 들어 있어서 지웠어요", R2 = "후기에 이름이 들어 있어서 가렸어요";
    await H.tab(r, "피드");
    dialogs.answers = [R1];
    await mod.getByRole("button", { name: "답장 지우기" }).click();
    await mod.getByText(`감사 답장을 지운 이유(쓴 사람에게 보임): ${R1}`).waitFor();
    assert.ok(dialogs.some((m) => m.includes("감사 답장을 지울까요?") && m.includes("이유를 적어 주세요")), "지울 때 이유를 묻는다");
    const bar = r.locator(".reminder-bar");
    await bar.getByText("운영진이 내 후기·감사 답장을 정리하고 이유를 남겼어요.").waitFor();
    await bar.getByRole("button", { name: "이유 보기" }).click();
    await mine.getByText(`이유: ${R1}`).waitFor();
    await mine.getByText("답장은 새로 다시 쓸 수 있어요.").waitFor();
    assert.equal(await bar.getByText("이유를 남겼어요").count(), 0, "추리 보드를 열면 본 것으로 친다");
    await mine.getByRole("button", { name: "마니또에게 감사 답장 보내기" }).click();
    await mine.getByLabel("감사 답장").fill("이름을 뺀 답장이에요");
    await mine.getByRole("button", { name: "보내기", exact: true }).click();
    await mine.getByText("보낸 감사 답장: 이름을 뺀 답장이에요").waitFor();
    console.log("  '답장 지우기'에 이유 → 쓴 사람 화면 맨 위 할 일 줄 '이유 보기' → 이유가 보이고 답장을 새로 다시 씀(고칠 횟수를 다 썼어도)");

    dialogs.answers = [R2];
    await mod.getByRole("button", { name: "피드에서 가리기" }).click();
    await mod.getByText(`피드에서 가린 이유(쓴 사람에게 보임): ${R2}`).waitFor();
    await mine.getByText(`이유: ${R2}`).waitFor();
    await mine.getByRole("button", { name: "후기 고치기" }).waitFor();
    await mine.getByText("후기·답장은 집계 전까지 3번 더 고칠 수 있어요").waitFor();
    for (let k = 0; k < 25; k++) { red2 = await redDoc(); if (Number(red2.edits?.integerValue) === 0) break; await r.waitForTimeout(200); }
    assert.equal(Number(red2.edits.integerValue), 0, "가리면 고친 횟수를 0으로");
    await mod.getByRole("button", { name: "피드에 다시 보이기" }).click();
    await mod.getByText(`피드에서 가린 이유(쓴 사람에게 보임): ${R2}`).waitFor({ state: "detached" });
    await mine.getByText(`이유: ${R2}`).waitFor({ state: "detached" });
    await mine.getByText(`이유: ${R1}`).waitFor(); // 답장을 지운 기록은 남는다
    console.log("  '피드에서 가리기'에 이유 → 쓴 사람에게 이유가 보이고 고칠 횟수가 다시 3번 → 다시 보이면 가린 이유는 지워짐(답장 지운 기록은 남음)");
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
    await H.pickCard(slot, "hard");
    const hardText = await slot.locator(".chosen .chosen-text").innerText();
    const code = (await slot.locator(".code-tag strong").innerText()).trim(); // 실물과 함께 전한 메모의 코드
    // 받는 사람이 완료 알림보다 먼저 인증한다: 카드가 아직 안 보이므로 확인 칸이 없다
    const r = u[target["다라"]]; await H.tab(r, "피드"); await H.tab(r, "추리 보드");
    const entry = H.panel(r, "인증하기");
    await entry.getByPlaceholder("쪽지에 적힌 4자리").fill(code);
    await r.waitForTimeout(800);
    assert.equal(await entry.locator(".card-check").count(), 0, "완료 알림 전에는 카드 확인 칸이 없다");
    await entry.locator("textarea").fill("메모에 적힌 코드로 먼저 인증해요. 잘 받았어요, 고마워요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await r.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    const redDoc = async () => (await (await fetch(`${FS}/redemptions/${code}`, { headers: owner })).json()).fields;
    assert.equal((await redDoc()).cardMatch, undefined, "카드를 못 보고 한 인증에는 cardMatch가 없다");
    // 마니또 화면: 미션은 인증됐지만 카드 추가분은 0, 완료 알리기를 누르라는 안내
    const tk = H.panel(g, "내 응모권 (지금까지)");
    await tk.getByText(/인증된 미션 1 \/ 3 \+ 카드 추가분 0 \/ 6/).waitFor();
    await tk.getByText(/카드 확인 대기/).waitFor();
    await tk.getByText(/1주차 "미션 완료 알리기"를 눌러 주세요/).waitFor();
    await slot.getByText(/이미 인증해서 카드를 바꿀 수 없어요\. 완료 알리기를 눌러 주세요/).waitFor();
    // 운영 화면 '인증 검토'에 '카드 확인 전'
    const mod = H.panel(admin, "인증 검토");
    await mod.locator("span.small.muted", { hasText: "· 카드 확인 전" }).waitFor();
    // 마니또가 완료를 알린다 → 받는 사람의 할 일과 '내가 인증한 것'에 카드 확인이 뜬다
    await slot.locator("textarea").fill("늦었지만 완료를 알려요. 자리 근처를 봐 주세요!");
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
    await tk.getByText(/인증된 미션 1 \/ 3 \+ 카드 추가분 2 \/ 6/).waitFor();
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
