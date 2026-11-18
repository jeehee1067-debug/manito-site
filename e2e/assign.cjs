// 배정이 끝까지 저장됐는지: "배정 완료" 전에 미션을 시작할 수 없고, 덜 저장된 배정은 운영 화면이 알려 주고 짝을 다시 뽑지 않고 고친다.
// (11/18 실제로 있었던 일: 배정 저장이 끝나기 전에 "미션 진행"을 눌러 설정·파트 단서가 빠짐)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const H = require("./helpers.cjs");

const FS = `http://127.0.0.1:8080/v1/projects/${H.P}/databases/(default)/documents`;
const owner = { Authorization: "Bearer owner", "Content-Type": "application/json" };
const step = (t) => console.log("▶", t);
const list = async (coll) => ((await (await fetch(`${FS}/${coll}?pageSize=300`, { headers: owner })).json()).documents || []);
// 콘솔에서 고치는 것 흉내(보안 규칙을 거치지 않는다). fields에 없는 칸을 mask에 넣으면 그 칸이 지워진다
const patchConfig = async (fields, mask) => {
  const enc = (v) => (typeof v === "boolean" ? { booleanValue: v } : { integerValue: String(v) });
  const q = mask.map((m) => `updateMask.fieldPaths=${m}`).join("&");
  const r = await fetch(`${FS}/config/app?${q}`, { method: "PATCH", headers: owner, body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, enc(v)])) }) });
  assert.ok(r.ok, await r.text());
};
const pairsNow = async () => Object.fromEntries((await list("assignments")).map((d) => [d.name.split("/").pop(), d.fields.receiverPid.stringValue]));

(async () => {
  await H.reset();
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const mk = H.maker(browser, errors, dialogs);
  const admin = await mk("운영자", { width: 1100, height: 900 });
  const check = () => admin.getByRole("alert", { name: "배정 점검" });

  step("운영자 계정, 명단 9명(3개 파트), 참여자 한 명이 배정 전에 가입해 화면을 열어 둔다");
  await admin.goto(H.BASE + "?setup");
  await admin.getByRole("button", { name: "운영자·공동 운영자 계정 만들기" }).click();
  await admin.getByPlaceholder("Knox ID").fill("admin@example.com");
  await admin.locator('input[type="password"]').fill("secret123");
  await admin.getByRole("button", { name: "운영자 계정 만들기" }).click();
  const lines = ["EFA1", "EFA2", "PFA/VSEM"].flatMap((part, k) => [1, 2, 3].map((i) => `사람${k}${i}\t${part}\tp${k}${i}`));
  await H.panel(admin, "1. 명단").locator("textarea").fill(lines.join("\n"));
  await admin.getByRole("button", { name: "명단에 추가" }).click(); await admin.getByText("9명을 추가했어요.").waitFor();
  const codes = await H.inviteCodes(admin);
  const guest = await mk("사람01");
  await H.signup(guest, codes["사람01"], "p01@samsung.com");
  await H.panel(guest, "아직 배정 전이에요").waitFor();

  step("배정하지 않고는 미션을 시작할 수 없다");
  await admin.getByRole("button", { name: "다음 단계로: 미션 진행" }).click();
  await admin.getByText('아직 배정하지 않았어요. 아래 "배정하기"를 눌러').waitFor();
  assert.equal((await H.readDoc("config/app")).phase, 0);

  step("'배정하기' 직후(저장이 끝나기 전)에 '미션 진행'을 눌러도 넘어가지 않는다 → 배정이 끝난 뒤에는 넘어간다");
  await admin.getByRole("button", { name: "배정하기" }).click();
  await admin.getByRole("button", { name: "다음 단계로: 미션 진행" }).click();
  await admin.getByText(/배정을 저장하는 중이에요\. "○명 배정 완료"가 뜬 뒤에 눌러 주세요\.|아직 배정하지 않았어요|배정이 끝까지 저장되지 않았어요/).waitFor();
  await admin.getByText(/9명 배정 완료/).waitFor();
  let cfg = await H.readDoc("config/app");
  assert.deepEqual([cfg.phase, cfg.assignVer, cfg.partExcluded], [0, 1, true], "배정이 끝까지 저장되고 단계는 그대로");
  assert.equal(await check().count(), 0, "정상이면 준비 단계에서는 점검 경고가 없다");
  // 배정 전부터 열어 둔 참여자 화면: 새로 고치지 않아도 대상이 나타난다
  await guest.locator(".target-toggle").waitFor();
  console.log("  저장 중에는 미션 시작이 막힘 → 배정 완료(회차 1, 다른 파트끼리) → 열어 둔 참여자 화면에 새로 고침 없이 대상이 나타남");
  const before = await pairsNow();
  await admin.getByRole("button", { name: "다음 단계로: 미션 진행" }).click();
  await admin.locator(".hud-chip", { hasText: "미션 진행" }).waitFor();
  await admin.getByText(/배정 점검: 정상이에요\. 명단 9명 모두 짝이 있고, 파트 단서 9건과 설정\(회차 1\)이 맞아요/).waitFor();

  step("미션 시작 뒤 발견: 설정만 빠진 경우(11/18 재현) → 콘솔에 넣을 값을 알려 주고, 넣으면 경고가 사라진다");
  await patchConfig({}, ["assignVer", "partExcluded", "siteMatched"]);
  await check().getByText("짝은 모두 저장됐지만(9명) 배정 마무리가 빠졌어요.").waitFor();
  await check().getByText("assignVer (number) = 1").waitFor();
  await check().getByText("partExcluded (boolean) = true").waitFor();
  await check().getByText("siteMatched (boolean) = false").waitFor();
  await patchConfig({ assignVer: 1, partExcluded: true, siteMatched: false }, ["assignVer", "partExcluded", "siteMatched"]);
  await admin.getByText(/배정 점검: 정상이에요/).waitFor();
  console.log("  설정이 빠짐 → 'assignVer = 1, partExcluded = true, siteMatched = false' 안내 → 콘솔에서 넣으면 정상");

  step("파트 단서까지 빠진 경우 → 준비 단계로 되돌려 '배정 마무리 (짝은 그대로)' → 짝은 그대로, 다시 시작");
  for (const d of await list("clues")) await fetch(`http://127.0.0.1:8080/v1/${d.name}`, { method: "DELETE", headers: owner });
  await patchConfig({}, ["assignVer", "partExcluded", "siteMatched"]);
  await admin.reload();
  await check().getByText(/파트 단서 0 \/ 9건만 저장돼 있어/).waitFor();
  await check().getByText('"배정하기"는 누르지 마세요').waitFor();
  await patchConfig({ phase: 0 }, ["phase"]); // 콘솔에서 phase를 0으로
  await admin.reload();
  const fixBtn = H.panel(admin, "2. 마니또 배정").getByRole("button", { name: "배정 마무리 (짝은 그대로)" });
  await fixBtn.waitFor();
  // 마무리 전에는 미션을 시작할 수 없다
  await admin.getByRole("button", { name: "다음 단계로: 미션 진행" }).click();
  await admin.getByText("배정이 끝까지 저장되지 않았어요.").waitFor();
  await fixBtn.click();
  await admin.getByText('배정을 마무리했어요(짝은 그대로예요).').waitFor().catch(() => {});
  cfg = await H.readDoc("config/app");
  assert.deepEqual([cfg.assignVer, cfg.partExcluded], [1, true]);
  assert.deepEqual(await pairsNow(), before, "짝은 바뀌지 않는다");
  const hints = (await list("clues")).filter((d) => d.fields.idx.integerValue === "6");
  assert.equal(hints.length, 9);
  assert.ok(hints.every((d) => d.fields.ver.integerValue === "1"));
  await admin.getByRole("button", { name: "다음 단계로: 미션 진행" }).click();
  await admin.locator(".hud-chip", { hasText: "미션 진행" }).waitFor();
  await admin.getByText(/배정 점검: 정상이에요/).waitFor();
  console.log("  파트 단서 0건 → 준비 단계로 되돌림 → '배정 마무리 (짝은 그대로)' → 짝 9쌍 그대로, 파트 단서 9건·회차 1 → 미션 시작 → 정상");

  step("짝이 아예 없는 채 미션이 시작된 경우 → 되돌려 다시 배정하라고 알려 준다");
  for (const d of await list("assignments")) await fetch(`http://127.0.0.1:8080/v1/${d.name}`, { method: "DELETE", headers: owner });
  await check().getByText("배정이 저장되지 않았어요").waitFor();
  await check().getByText(/phase를 0\(숫자\)으로 바꾸고/).waitFor();
  console.log("  짝 0건 → '배정이 저장되지 않았어요' + 되돌리는 방법 안내");

  assert.equal(errors.length, 0, errors.join("\n"));
  await browser.close();
  console.log("콘솔 오류 0건\n완료");
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
