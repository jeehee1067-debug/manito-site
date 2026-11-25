// 중도 이탈 이어 붙이기(tools/handover/handover.py + lib/handover.js)를 실제 화면으로 확인한다 (npm run dev:emu 대상, 4명·2개 파트)
//  원: 가파트 → 나파트 → 가파트 → 나파트(파트가 번갈아 원이 된다). 나파트 Y가 빠지면 Y의 마니또 X(가파트)가 Y의 대상 Z(가파트)를 맡는다 = 같은 파트 짝.
//  1주차 모두 완료·인증 → 단서 2개 공개 → 2주차에 X가 Y에게 미리 '완료'(마니또 카페처럼) → 스크립트로 Y를 빼고 X의 2주차를 되돌림
//  → 되돌리기(--undo)·다시 적용 → X가 Z에게 2주차를 새로 하고 Z가 인증 → Z의 단서가 X의 답으로, 추리 보드에서 Y가 빠짐
//  → 운영 화면 짝 현황·배정 점검·코드 점검 → 최종 지목 단계에서 파트 단서가 내 파트면 내 파트도 후보 → 집계 응모권
// Python 패키지가 필요하다: pip install google-cloud-firestore (다른 Python이면 PYTHON=경로)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const H = require("./helpers.cjs");
const step = (s) => console.log("▶", s);
const PY = process.env.PYTHON || "python3";
const SCRIPT = path.join(__dirname, "../tools/handover/handover.py");
const run = (...args) => execFileSync(PY, [SCRIPT, "--emulator", "127.0.0.1:8080", "--project", H.P, ...args], { encoding: "utf8", cwd: require("node:os").tmpdir() });
const runFail = (...args) => { try { run(...args); return null; } catch (e) { return `${e.stdout || ""}${e.stderr || ""}`; } };

(async () => {
  try { execFileSync(PY, ["-c", "import google.cloud.firestore"], { stdio: "ignore" }); } catch {
    console.error(`실패: ${PY}에 google-cloud-firestore가 없어요. pip install google-cloud-firestore 후 다시(다른 Python이면 PYTHON=경로).`);
    process.exit(1);
  }
  await H.reset();
  const { PROFILE_QUESTIONS: PQ } = await import(require("node:url").pathToFileURL(path.join(__dirname, "../src/lib/constants.js")).href);
  const b = await chromium.launch(); const errs = []; const mk = H.maker(b, errs);
  const admin = await mk("운영자", { width: 1200, height: 900 });
  const NAMES = ["가나", "다라", "마바", "사아"];
  const PART = { 가나: "가파트", 다라: "나파트", 마바: "가파트", 사아: "나파트" };
  const inv = await H.setupAdmin(admin, NAMES.map((n) => `${n},${PART[n]}`), "hadmin@example.com");
  const advance = async (to) => { await admin.getByRole("button", { name: `다음 단계로: ${to}` }).click(); await admin.locator(".hud-chip", { hasText: to }).waitFor(); };

  step("가입·프로필(사람마다 다른 답)");
  const u = {}, target = {}, answers = {};
  for (const [i, name] of NAMES.entries()) {
    const p = await mk(name); u[name] = p;
    await H.signup(p, inv[name], `h${i}@example.com`);
    await p.locator(".target-name:visible").waitFor();
    target[name] = await H.readTarget(p);
    answers[name] = H.answersFor(PQ, i, name);
    await H.tab(p, "내 프로필");
    await H.fillProfile(p, answers[name], PQ);
  }
  const giverOf = Object.fromEntries(Object.entries(target).map(([g, r]) => [r, g]));
  const Y = NAMES.find((n) => PART[n] === "나파트"); // 빠질 사람(나파트) — 마니또와 대상이 둘 다 가파트
  const X = giverOf[Y], Z = target[Y];
  assert.equal(PART[X], "가파트"); assert.equal(PART[Z], "가파트");
  const pidOf = Object.fromEntries(Object.entries((await H.readDoc("public/roster")).people).map(([pid, v]) => [v.name, pid]));
  console.log(`  짝: ${Object.entries(target).map(([g, r]) => `${g}→${r}`).join(", ")} / 빠질 사람 ${Y}(마니또 ${X}, 대상 ${Z})`);

  step("1주차: 모두 완료 → 대상이 인증");
  await advance("미션 진행");
  for (const n of NAMES) {
    const g = u[n]; await H.tab(g, "내 미션");
    const slot = H.panel(g, "1주차 미션");
    await H.pickCard(slot, "easy");
    await slot.locator("textarea").fill(`${n}의 1주차 쪽지`);
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(g, "1주차 미션 ✔").waitFor();
  }
  for (const n of NAMES) {
    const r = u[n]; await H.tab(r, "추리 보드");
    const inbox = H.panel(r, "마니또에게서 온 것");
    const code = await inbox.locator("strong.mono").first().innerText();
    const entry = H.panel(r, "인증하기");
    await entry.getByPlaceholder("쪽지에 적힌 4자리").fill(code);
    await entry.locator("textarea").fill(`${n}: 1주차 쪽지 고마워요. 덕분에 즐거웠어요!`);
    await entry.getByRole("button", { name: "인증하기" }).click();
    await r.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
  }

  step("단서 2개 공개 → 2주차 열기 → X가 Y에게 2주차 '완료'(메뉴판만 보낸 상황)");
  await H.tab(admin, "운영");
  await admin.getByRole("button", { name: "이번 주 단서 2개 공개" }).click();
  await admin.getByText("단서를 공개하고 파트 순위도 새로 발표했어요.").waitFor();
  {
    const z = u[Z]; await z.reload(); await H.tab(z, "추리 보드");
    const clues = H.panel(z, "단서 2 / 6");
    await clues.locator(".clue-a", { hasText: answers[Y][0] }).first().waitFor();
    console.log(`  ${Z}: 공개된 1번 단서 = ${Y}의 답 "${answers[Y][0]}"`);
  }
  await H.panel(admin, "주차").getByRole("button", { name: "2주차" }).click();
  await admin.locator(".hud-chip", { hasText: "2주차" }).waitFor();
  {
    const g = u[X]; await g.reload(); await H.tab(g, "내 미션");
    const slot = H.panel(g, "2주차 미션");
    await H.pickCard(slot, "easy");
    await slot.locator("textarea").fill("메뉴판: 1) 커피 2) 차 3) 초코");
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(g, "2주차 미션 ✔").waitFor();
  }
  const yPid = pidOf[Y], xPid = pidOf[X], zPid = pidOf[Z];
  const before = { codesX: (await H.readDoc(`giverCodes/${xPid}`)).codes, codesY: (await H.readDoc(`giverCodes/${yPid}`)).codes, rcZ: (await H.readDoc(`receiverCodes/${zPid}`)).codes };

  step("스크립트: 계획 보기 → 막히는 경우 → 적용");
  {
    const out = runFail("--leaver", Y);
    assert.match(out, /이미 .*'완료'했어요/, "X가 2주차를 완료했으면 --redo나 --from-slot을 요구");
    const plan = run("--leaver", Y, "--redo");
    assert.match(plan, /같은 파트\(가파트\) 짝이 돼요/);
    assert.match(plan, /계획만 보여 드렸어요/);
    assert.equal((await H.readDoc(`assignments/${xPid}`)).receiverPid, yPid, "계획만 보면 아무것도 안 바뀜");
    const done = run("--leaver", Y, "--redo", "--apply", "--yes");
    assert.match(done, /끝났어요/);
  }
  const checkApplied = async () => {
    assert.equal((await H.readDoc(`assignments/${xPid}`)).receiverPid, zPid, "X → Z");
    assert.deepEqual(await H.readDoc(`assignments/${yPid}`), {}, "Y의 짝은 지움");
    const gx = (await H.readDoc(`giverCodes/${xPid}`)).codes;
    assert.deepEqual(gx, { 1: before.codesX[1], 2: before.codesY[2], 3: before.codesY[3] }, "X: 1주차는 자기 코드, 2·3주차는 Y가 갖고 있던 Z 앞 코드");
    assert.deepEqual((await H.readDoc(`giverCodes/${yPid}`)).codes, { 1: before.codesY[1] });
    assert.deepEqual((await H.readDoc(`receiverCodes/${zPid}`)).codes, before.rcZ, "Z 쪽 코드는 그대로");
    for (let i = 0; i < 6; i++) assert.equal((await H.readDoc(`clues/${zPid}_${i}`)).answer, answers[X][i], `Z의 단서 ${i + 1}번 = X의 답`);
    assert.equal((await H.readDoc(`clues/${zPid}_6`)).answer, "가파트", "파트 단서 = X의 파트");
    const m = await H.readDoc(`giverMissions/${xPid}`);
    assert.equal(m.done["2"], undefined, "X의 2주차 완료를 되돌림");
    assert.equal(m.done["1"], true);
    assert.deepEqual(await H.readDoc(`deliveries/${yPid}_2`), {}, "Y에게 간 2주차 알림은 지움(기록에 저장)");
    const r = await H.readDoc(`roster/${yPid}`);
    assert.equal(r.dropout, true); assert.equal(r.leftGame, true);
    assert.equal((await H.readDoc("public/roster")).people[yPid].out, true);
    const ho = (await H.readDoc("meta/handover")).items;
    assert.equal(ho.length, 1); assert.equal(ho[0].fromSlot, 2);
    assert.equal(ho[0].saved.deliveriesRemoved[`${yPid}_2`].message, "메뉴판: 1) 커피 2) 차 3) 초코");
  };
  await checkApplied();
  console.log(`  적용: ${X} → ${Z}(2주차부터), ${X}의 2주차 완료 되돌림, ${Z}의 단서 6칸 = ${X}의 답, 파트 단서 가파트, ${Y} 중도 이탈`);

  step("되돌리기(--undo) → 원래대로 → 다시 적용");
  {
    assert.match(run("--undo"), /계획만 보여 드렸어요/);
    run("--undo", "--apply", "--yes");
    assert.equal((await H.readDoc(`assignments/${xPid}`)).receiverPid, yPid);
    assert.equal((await H.readDoc(`assignments/${yPid}`)).receiverPid, zPid);
    assert.deepEqual((await H.readDoc(`giverCodes/${xPid}`)).codes, before.codesX);
    assert.equal((await H.readDoc(`clues/${zPid}_0`)).answer, answers[Y][0], "Z의 단서가 Y의 답으로 돌아옴");
    assert.equal((await H.readDoc(`clues/${zPid}_6`)).answer, "나파트");
    assert.equal((await H.readDoc(`giverMissions/${xPid}`)).done["2"], true, "X의 2주차 완료 표시가 돌아옴");
    assert.equal((await H.readDoc(`deliveries/${yPid}_2`)).message, "메뉴판: 1) 커피 2) 차 3) 초코", "지운 알림도 되살림");
    assert.equal((await H.readDoc(`roster/${yPid}`)).dropout, undefined);
    assert.equal((await H.readDoc("public/roster")).people[yPid].out, undefined);
    assert.deepEqual((await H.readDoc("meta/handover")).items || [], []);
    run("--leaver", Y, "--redo", "--apply", "--yes");
    await checkApplied();
    console.log("  되돌리기도 그대로 원래 값으로 돌아오고, 다시 적용해도 같다");
  }

  step(`${X}: 내 미션의 대상이 ${Z}로, 2주차를 새로 해서 완료 → ${Z}가 그 코드로 인증`);
  {
    const g = u[X]; await g.reload(); await H.tab(g, "내 미션");
    assert.equal(await H.readTarget(g), Z);
    await H.panel(g, "1주차 미션 ✔").getByText(/이전 대상이 인증했어요/).waitFor(); // 1주차는 Y가 인증(지금 대상 이름으로 적지 않는다)
    const slot = H.panel(g, "2주차 미션");
    await slot.locator(".chosen").waitFor();
    // 완료 전 쪽지(규칙 20261128): 메뉴판·예고를 먼저 보내고, 미션을 다 한 뒤에 완료를 알린다. 이 쪽지에는 코드가 없다
    await slot.getByRole("button", { name: "완료 전에 쪽지 먼저 보내기" }).click();
    await slot.locator(".pre-notes textarea").fill("마니또 카페 메뉴판: 1) 커피 2) 차 3) 초코");
    await slot.locator(".pre-notes").getByRole("button", { name: "쪽지 보내기" }).click();
    await slot.getByText(/미션을 다 한 뒤에 위의 "미션 완료 알리기"를 눌러 주세요/).waitFor();
    assert.equal(await H.panel(g, "2주차 미션 ✔").count(), 0, "쪽지만 보내면 완료가 아니다");
    {
      const z = u[Z]; await z.reload(); await H.tab(z, "추리 보드");
      const inbox = H.panel(z, "마니또에게서 온 것");
      await inbox.getByText("마니또 카페 메뉴판: 1) 커피 2) 차 3) 초코").waitFor();
      assert.equal(await z.getByRole("button", { name: /받은 게 없어요/ }).count(), 0, "완료 전 쪽지만 온 주차에는 '받은 게 없어요'가 없다");
      assert.equal(await z.locator(".reminder-bar p", { hasText: "인증" }).count(), 0, "완료 전 쪽지만으로는 인증하라는 할 일이 뜨지 않는다");
      const n = await H.readDoc(`deliveries/${zPid}_2_n1`);
      assert.equal(n.kind, "note"); assert.equal(n.code, null);
      console.log(`  ${X}: 완료 전에 메뉴판 쪽지를 먼저 보냄(코드 없음) → ${Z}의 받은 것에 보이고, 완료·인증 요청은 아직 아님`);
    }
    await slot.locator("textarea").first().fill("2주차는 새 대상에게!");
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(g, "2주차 미션 ✔").waitFor();
    const z = u[Z]; await z.reload(); await H.tab(z, "추리 보드");
    const inbox = H.panel(z, "마니또에게서 온 것");
    await inbox.getByText("2주차는 새 대상에게!").waitFor();
    await inbox.getByText(`${Y}의 1주차 쪽지`).waitFor(); // 1주차에 받은 것(Y가 보냄)은 그대로
    const entry = H.panel(z, "인증하기");
    await entry.getByPlaceholder("쪽지에 적힌 4자리").fill(before.codesY[2]);
    await entry.locator("textarea").fill("2주차 쪽지도 잘 받았어요. 새 마니또님 고마워요!");
    await entry.getByRole("button", { name: "인증하기" }).click();
    await z.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    // 단서: X의 답, 용의자 보드: Y는 빠지고(이제 누구의 마니또도 아님), 미션 기간에는 내 파트(가파트)도 빠짐
    const clues = H.panel(z, "단서 2 / 6");
    await clues.locator(".clue-a", { hasText: answers[X][0] }).first().waitFor();
    const opts = await H.panel(z, "용의자 보드").locator("select").first().locator("option").allInnerTexts();
    assert.ok(!opts.includes(Y), `용의자 보드에 ${Y}가 없다: ${opts}`);
    assert.ok(!opts.includes(X), "미션 기간에는 내 파트를 뺀다(최종 지목 단계의 파트 단서 전까지)");
    console.log(`  ${Z}: 1번 단서 "${answers[X][0]}"(${X}의 답), 용의자 후보 ${opts.filter((o) => o && !o.includes("고르")).join("·")}`);
    // 다른 사람의 용의자 보드에서도 Y는 빠진다
    const o = u[NAMES.find((n) => ![X, Y, Z].includes(n))]; await o.reload(); await H.tab(o, "추리 보드");
    assert.ok(!(await H.panel(o, "용의자 보드").locator("select").first().locator("option").allInnerTexts()).includes(Y));
  }

  step("운영 화면: 짝 현황·배정 점검·코드 점검");
  {
    await admin.reload(); await H.tab(admin, "운영");
    await admin.getByText(/배정 점검: 정상이에요/).waitFor();
    const pairs = H.panel(admin, "짝 현황");
    assert.match(await pairs.locator("h2").innerText(), /짝 현황 \(3쌍\)/);
    await pairs.getByRole("button", { name: "짝 현황 보기" }).click();
    const yRow = pairs.locator("tr.row-left");
    await yRow.getByText("(중도 이탈)").waitFor();
    assert.match(await yRow.innerText(), /인증됨/);
    assert.match(await yRow.innerText(), /이탈\(이어 받음\)/);
    const xRow = pairs.locator("tr", { has: admin.locator("td.left", { hasText: new RegExp(`^${X}`) }) }).first();
    assert.match(await xRow.innerText(), new RegExp(`→ ${Y}`), "X의 1주차는 Y에게 한 것으로 표시");
    await admin.getByRole("button", { name: "인증 코드 점검하기" }).click();
    await admin.getByText(/인증 코드 점검: 정상이에요/).waitFor();
    console.log("  배정 점검·코드 점검 정상, 짝 현황 3쌍 + 중도 이탈 줄, X의 1주차는 (→ Y)");
  }

  step("최종 지목: 파트 단서가 내 파트(가파트)면 내 파트도 후보 → Z가 X를 지목");
  await H.panel(admin, "주차").getByRole("button", { name: "3주차" }).click();
  await admin.locator(".hud-chip", { hasText: "3주차" }).waitFor();
  await advance("최종 지목");
  {
    const z = u[Z]; await z.reload(); await H.tab(z, "추리 보드");
    await H.panel(z, "단서 2 / 6").locator(".part-hint .clue-a", { hasText: "가파트" }).waitFor();
    const board = H.panel(z, "용의자 보드");
    const opts = await board.locator("select").first().locator("option").allInnerTexts();
    assert.ok(opts.includes(X), `파트 단서가 내 파트면 내 파트 사람도 후보: ${opts}`);
    assert.ok(!opts.includes(Y));
    await board.locator("select").first().selectOption({ label: X });
    await board.getByRole("button", { name: "이 사람으로 지목" }).click();
    await board.getByText(`내 지목: ${X}`).waitFor();
    console.log(`  ${Z}: 마지막 단서 가파트 → 후보에 ${X} 포함, ${X}를 지목`);
  }

  step("집계: 응모권은 주차마다 그 주차의 짝으로");
  await advance("마감");
  await advance("집계");
  await admin.getByRole("button", { name: "집계하기" }).click();
  for (let k = 0; k < 50 && !(await H.readDoc("results/public")).ticketDetail; k++) await admin.waitForTimeout(200);
  {
    const t = (await H.readDoc("results/public")).ticketDetail;
    assert.equal(t[xPid].mission, 2, `${X}: 1주차(${Y} 인증) + 2주차(${Z} 인증)`);
    assert.equal(t[yPid].total, 0, `${Y}: 중도 이탈 표시 중 0장`);
    assert.equal(t[zPid].guess, 1, `${Z}: 정답 지목(${X})`);
    assert.ok(t[zPid].entries >= 2, `${Z}: ${Y}의 1주차 + ${X}의 2주차 인증`);
    console.log(`  ${X} 미션 ${t[xPid].mission}, ${Z} 인증 입력 ${t[zPid].entries}·정답 ${t[zPid].guess}, ${Y} 0장`);
  }

  await b.close();
  console.log("\n콘솔 오류·경고", errs.length, "건"); errs.slice(0, 8).forEach((e) => console.log("  ", e));
  if (errs.length) process.exit(1);
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 8).join("\n")); process.exit(1); });
