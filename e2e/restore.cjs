// 백업 되살리기(tools/restore/restore_backup.py): 운영 화면에서 받은 전체 백업으로 지워진 자료를 그대로 되살리는지.
//  - 미션 진행(완료 알림·인증·피드·공감·예약·피드 요약) → 운영 화면 "백업 만들기"로 JSON 받기
//  - Firestore 자료를 통째로 지우고 → 스크립트로 되살리면 문서 하나하나가 백업 파일과 같다(시각은 밀리초까지)
//  - 기본은 없어진 문서만 되살리고 바뀐 문서는 그대로, --overwrite는 바뀐 문서도(설정은 --include-config일 때만)
//  - 되살린 뒤 참여자·운영자로 다시 로그인해 사이트가 그대로 동작한다
// 먼저 `npm run dev:emu`를 띄워 둘 것. 로컬 에뮬레이터 데이터를 지우고 시작한다.
// Python 패키지가 필요하다: pip install google-cloud-firestore (다른 Python을 쓰려면 PYTHON=경로)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const H = require("./helpers.cjs");

const step = (t) => console.log("▶ " + t);
const PY = process.env.PYTHON || "python3";
const SCRIPT = path.join(__dirname, "..", "tools", "restore", "restore_backup.py");
const FS = `http://127.0.0.1:8080/v1/projects/${H.P}/databases/(default)/documents`;
const owner = { Authorization: "Bearer owner", "Content-Type": "application/json" };

// REST 값 → 백업 파일과 같은 모양(시각은 밀리초까지의 ISO 글자)
const ms = (t) => new Date(t).toISOString();
const plain = (v) => ("stringValue" in v ? v.stringValue : "integerValue" in v ? Number(v.integerValue) : "doubleValue" in v ? v.doubleValue
  : "booleanValue" in v ? v.booleanValue : "nullValue" in v ? null : "timestampValue" in v ? ms(v.timestampValue)
  : "arrayValue" in v ? (v.arrayValue.values || []).map(plain) : "mapValue" in v ? Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, plain(x)])) : `?${Object.keys(v)}`);
async function readCollection(name) {
  const out = {};
  let token = "";
  do {
    const j = await (await fetch(`${FS}/${name}?pageSize=300${token ? `&pageToken=${token}` : ""}`, { headers: owner })).json();
    for (const d of j.documents || []) out[d.name.split("/").pop()] = Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, plain(v)]));
    token = j.nextPageToken || "";
  } while (token);
  return out;
}
async function readDocPlain(p) {
  const r = await fetch(`${FS}/${p}`, { headers: owner });
  if (r.status === 404) return null;
  const d = await r.json();
  return Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, plain(v)]));
}
const restore = (file, ...args) => execFileSync(PY, [SCRIPT, file, "--emulator", "127.0.0.1:8080", "--project", H.P, ...args], { encoding: "utf8" });
const rowOf = (out, name) => {
  const line = out.split("\n").find((l) => l.startsWith(name + " ") || l.startsWith(name + "\t") || new RegExp(`^${name.replace("/", "\\/")}\\s`).test(l));
  assert.ok(line, `계획 표에 ${name} 줄이 있다`);
  const [n, miss, diff, newer, todo] = line.trim().split(/\s+/).slice(1).map(Number);
  return { n, miss, diff, newer, todo };
};

(async () => {
  try { execFileSync(PY, ["-c", "import google.cloud.firestore"], { stdio: "ignore" }); } catch {
    console.error(`실패: ${PY}에 google-cloud-firestore가 없어요. pip install google-cloud-firestore 후 다시(다른 Python이면 PYTHON=경로).`);
    process.exit(1);
  }
  await H.reset();
  const b = await chromium.launch();
  const errs = [], dialogs = [];
  const mk = H.maker(b, errs, dialogs);
  const admin = await mk("운영자");
  const NAMES = ["가나", "다라", "마바"];
  const inv = await H.setupAdmin(admin, NAMES.map((n, i) => `${n},${"가나다"[i]}파트`));
  const u = {}, target = {};
  for (const [i, name] of NAMES.entries()) {
    const p = await mk(name); u[name] = p;
    await H.signup(p, inv[name], `r${i}@example.com`);
    await p.locator(".target-name:visible").waitFor();
  }
  await admin.getByRole("button", { name: "다음 단계로: 미션 진행" }).click();
  await admin.locator(".hud-chip", { hasText: "미션 진행 1주차" }).waitFor();

  step("미션 진행: 완료 알림 → 인증(피드 글) → 공감, 예약 저장");
  const REVIEW = "되살리기 시험용 후기예요. 쪽지 잘 받았어요!";
  {
    for (const n of NAMES) { await u[n].reload(); target[n] = await H.readTarget(u[n]); }
    const g = u["가나"];
    const slot = H.panel(g, "1주차 미션");
    await H.pickCard(slot, "easy");
    await slot.locator("textarea").fill("가나의 응원 쪽지");
    await slot.getByRole("button", { name: "미션 완료 알리기" }).click();
    await H.panel(g, "1주차 미션 ✔").waitFor();
    const r = u[target["가나"]]; await r.reload(); await H.tab(r, "추리 보드");
    const inbox = H.panel(r, "마니또에게서 온 것"); await inbox.locator("strong.mono").first().waitFor();
    const entry = H.panel(r, "인증하기");
    await entry.getByPlaceholder("쪽지에 적힌 4자리").fill(await inbox.locator("strong.mono").first().innerText());
    await entry.locator("textarea").fill(REVIEW);
    await entry.getByRole("button", { name: "인증하기" }).click();
    await r.getByText("인증했어요. 응모권 1장이 쌓였어요.").waitFor();
    const other = NAMES.find((n) => n !== "가나" && n !== target["가나"]) || "가나";
    const o = u[other]; await H.tab(o, "피드");
    const post = H.panel(o, "익명 피드").locator(".dialogue", { hasText: REVIEW });
    await post.getByRole("button", { name: /공감/ }).click();
    await post.locator(".like-btn.is-on").waitFor();
    const box = H.panel(admin, "예약 (자동 진행)");
    await box.getByLabel("단서 1·2번 공개 예약 시각").fill("2026-12-31T09:00");
    await box.getByRole("button", { name: "예약 저장" }).click();
    await box.getByText("예약을 저장했어요.").waitFor();
    // 피드 요약(public/feed)에 공감까지 들어갈 때까지 기다린다(백업에 같이 들어간다)
    let ok = false;
    for (let k = 0; k < 60 && !ok; k++) { ok = ((await H.readDoc("public/feed")).recent || []).some((x) => x.review === REVIEW && x.likes === 1); if (!ok) await admin.waitForTimeout(500); }
    assert.ok(ok, "피드 요약에 글과 공감 수가 들어감");
  }

  step("운영 화면 '백업 만들기' → 전체 백업(JSON) 받기, 화면을 모두 닫는다");
  const file = path.join(os.tmpdir(), `manito-restore-${Date.now()}.json`);
  let backup;
  {
    await H.tab(admin, "운영");
    const bk = H.panel(admin, "백업 내려받기");
    await bk.getByRole("button", { name: "백업 만들기" }).click();
    await bk.getByText(/백업을 만들었어요: 문서 [\d,]+건/).waitFor();
    const [dl] = await Promise.all([admin.waitForEvent("download"), bk.getByRole("button", { name: "전체 백업 파일 받기 (JSON)" }).click()]);
    fs.copyFileSync(await dl.path(), file);
    backup = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(backup.failed, []);
    // 화면이 열려 있으면 지운 뒤에 다시 쓰는 것(피드 요약·최근 접속)이 생기므로 모두 닫는다
    for (const ctx of b.contexts()) await ctx.close();
  }
  const names = Object.keys(backup.collections);
  const total = names.reduce((n, c) => n + Object.keys(backup.collections[c]).length, 0) + 1;
  console.log(`  백업 문서 ${total}건(컬렉션 ${names.length}개 + 설정)`);

  step("파일만 확인(DB 접속 없이)");
  {
    const out = execFileSync(PY, [SCRIPT, file], { encoding: "utf8" });
    assert.match(out, /DB에 접속하지 않았어요/);
  }

  step("Firestore 자료를 통째로 지운다 → 계획 보기(쓰지 않음) → 되살리기");
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${H.P}/databases/(default)/documents`, { method: "DELETE" });
  assert.equal(await readDocPlain("config/app"), null, "지워짐");
  {
    const plan = restore(file);
    assert.match(plan, /계획만 보여 드렸어요/);
    assert.equal(rowOf(plan, "roster").miss, NAMES.length, "명단 3건이 없어짐");
    assert.equal(await readDocPlain("config/app"), null, "--apply 없이는 아무것도 쓰지 않는다");
    const out = restore(file, "--apply", "--yes");
    assert.match(out, /끝났어요/);
  }
  {
    let compared = 0;
    for (const c of names) {
      const now = await readCollection(c);
      assert.deepEqual(now, backup.collections[c], `${c}: 되살린 문서가 백업과 같다`);
      compared += Object.keys(now).length;
    }
    assert.deepEqual(await readDocPlain("config/app"), backup.docs["config/app"], "설정이 백업과 같다");
    console.log(`  되살린 뒤 문서 ${compared + 1}건이 백업 파일과 하나하나 같음(시각 포함)`);
  }

  step("기본은 없어진 것만: 지운 글은 되살리고, 바뀐 문서는 그대로 둔다");
  {
    const fid = Object.keys(backup.collections.feed)[0];
    await fetch(`${FS}/feed/${fid}`, { method: "DELETE", headers: owner });
    await fetch(`${FS}/config/app?updateMask.fieldPaths=notice`, { method: "PATCH", headers: owner, body: JSON.stringify({ fields: { notice: { stringValue: "백업 뒤에 바꾼 공지" } } }) });
    await fetch(`${FS}/meta/schedule?updateMask.fieldPaths=note`, { method: "PATCH", headers: owner, body: JSON.stringify({ fields: { note: { stringValue: "백업 뒤 변경" } } }) });
    const plan = restore(file);
    assert.deepEqual([rowOf(plan, "feed").miss, rowOf(plan, "config/app").diff, rowOf(plan, "meta").diff], [1, 1, 1]);
    restore(file, "--apply", "--yes");
    assert.deepEqual(await readDocPlain(`feed/${fid}`), backup.collections.feed[fid], "지운 글이 돌아옴");
    assert.equal((await readDocPlain("config/app")).notice, "백업 뒤에 바꾼 공지", "바뀐 설정은 그대로");
    assert.equal((await readDocPlain("meta/schedule")).note, "백업 뒤 변경", "바뀐 문서는 그대로");
    console.log("  지운 피드 글 1건 되살림, 백업 뒤에 바뀐 설정·예약 문서는 그대로");

    restore(file, "--apply", "--yes", "--overwrite");
    assert.equal((await readDocPlain("meta/schedule")).note, undefined, "--overwrite: 바뀐 문서를 백업 값으로");
    assert.equal((await readDocPlain("config/app")).notice, "백업 뒤에 바꾼 공지", "--overwrite만으로는 설정을 덮어쓰지 않는다");
    restore(file, "--apply", "--yes", "--overwrite", "--include-config");
    assert.deepEqual(await readDocPlain("config/app"), backup.docs["config/app"], "--include-config: 설정도 백업 값으로");
    console.log("  --overwrite: 바뀐 문서를 백업 값으로(설정 제외), --include-config: 설정까지");
  }

  step("되살린 뒤 사이트: 참여자는 대상·피드 글이 그대로, 운영자는 짝 현황이 보인다");
  {
    const mk2 = H.maker(b, errs, dialogs);
    const login = async (p, email) => {
      await p.goto(H.BASE);
      await p.getByPlaceholder("Knox ID").fill(email);
      await p.locator('input[type="password"]').fill("secret123");
      await p.getByRole("button", { name: "로그인", exact: true }).click();
    };
    const g = await mk2("가나(되살린 뒤)");
    await login(g, "r0@example.com");
    assert.equal(await H.readTarget(g), target["가나"], "대상이 그대로");
    await H.panel(g, "1주차 미션 ✔").waitFor();
    await H.tab(g, "피드");
    await H.panel(g, "익명 피드").locator(".dialogue", { hasText: REVIEW }).getByText("♥ 공감 1").waitFor();
    const a = await mk2("운영자(되살린 뒤)");
    await login(a, "admin@example.com");
    await H.panel(a, "짝 현황").waitFor();
    console.log("  가나: 대상·1주차 완료·피드 글(공감 1) 그대로, 운영자: 짝 현황 보임");
  }

  fs.rmSync(file, { force: true });
  console.log("콘솔 오류·경고", errs.length, "건"); errs.slice(0, 5).forEach((e) => console.log("  ", e));
  await b.close();
  if (errs.length) process.exit(1);
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message.split("\n").slice(0, 8).join("\n")); process.exit(1); });
