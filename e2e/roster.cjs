// 명단 넣기·한 명씩 고치기·지우기와 "저장됐는지" 알려 주기.
// 1) 넣고 고치고 지운 것이 새로 고친 뒤에도 그대로인지
// 2) 저장 요청이 서버에 닿지 않으면(사내망 등) "아직 저장되지 않았어요"가 나오는지 — 화면에만 보이다 새로 고치면 사라지던 문제
// (서버가 거부하는 경우의 안내는 여기서 확인하지 못한다: 화면이 권한을 실시간으로 알아서 버튼이 먼저 꺼진다)
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const H = require("./helpers.cjs");

const step = (t) => console.log("▶", t);

(async () => {
  await H.reset();
  const browser = await chromium.launch();
  const errors = [], dialogs = [];
  const admin = await H.maker(browser, errors, dialogs)("운영자", { width: 1100, height: 900 });
  const rosterPanel = () => H.panel(admin, "명단 ");
  const rows = () => rosterPanel().locator(".pk-table tbody tr");
  const row = (name) => rosterPanel().locator(".pk-table tbody tr", { has: admin.locator("td", { hasText: new RegExp(`^${name}$`) }) });
  const cells = async (name) => (await row(name).locator("td").allInnerTexts()).slice(0, 3);
  const add = async (text) => { await H.panel(admin, "1. 명단").locator("textarea").fill(text); await admin.getByRole("button", { name: "명단에 추가" }).click(); };

  step("운영자 계정 → 명단 3명 넣기 → 새로 고쳐도 그대로");
  await admin.goto(H.BASE + "?setup");
  await admin.getByRole("button", { name: "운영자·공동 운영자 계정 만들기" }).click();
  await admin.getByPlaceholder("Knox ID").fill("admin@example.com");
  await admin.locator('input[type="password"]').fill("secret123");
  await admin.getByRole("button", { name: "운영자 계정 만들기" }).click();
  await H.panel(admin, "1. 명단").getByText('"명단에 추가"를 누르면 바로 저장돼요').waitFor();
  await add("가나\t가파트\tgana.kim\n다라\t가파트\tdara.lee\n마바\t나파트\tmaba.park");
  await admin.getByText("3명을 추가했어요.").waitFor();
  assert.equal(await rosterPanel().getByText("아직 서버에 저장되지 않은 변경이 있어요").count(), 0);
  await admin.reload();
  await row("마바").waitFor();
  assert.equal(await rows().count(), 3);
  assert.deepEqual(await cells("다라"), ["다라", "가파트", "dara.lee"]);
  console.log("  3명 추가 → 새로 고침 뒤에도 3명");

  step("한 명 고치기: 이름·파트·아이디 → 저장 → 새로 고쳐도 그대로, 메일 색인도 같이 바뀜");
  await row("다라").getByRole("button", { name: "수정" }).click();
  const editing = rosterPanel().locator("tr.editing");
  await editing.getByLabel("이름").fill("다라수정");
  await editing.getByLabel("파트").fill("다파트");
  await editing.getByLabel("아이디").fill("Dara.New"); // 대문자로 적어도 소문자 주소가 된다
  await editing.getByRole("button", { name: "저장" }).click();
  await admin.getByText("다라수정님 정보를 저장했어요.").waitFor();
  assert.equal(await rosterPanel().locator("tr.editing").count(), 0);
  await admin.reload();
  await row("다라수정").waitFor();
  assert.deepEqual(await cells("다라수정"), ["다라수정", "다파트", "dara.new"]);
  const p2 = await H.readDoc("roster/p002");
  assert.deepEqual([p2.name, p2.part, p2.email, p2.uid], ["다라수정", "다파트", "dara.new@samsung.com", null]);
  assert.equal((await H.readDoc("mailIndex/dara.new@samsung.com")).personId, "p002");
  assert.equal((await H.readDoc("mailIndex/dara.lee@samsung.com")).personId, undefined, "예전 아이디의 색인은 지워진다");
  // 다른 사람이 쓰는 아이디로는 못 바꾼다, 이름은 비울 수 없다, 취소하면 그대로
  await row("마바").getByRole("button", { name: "수정" }).click();
  await editing.getByLabel("아이디").fill("gana.kim");
  await editing.getByRole("button", { name: "저장" }).click();
  await admin.getByText("이미 다른 사람이 쓰는 아이디예요: gana.kim@samsung.com").waitFor();
  await editing.getByLabel("이름").fill(" ");
  await editing.getByRole("button", { name: "저장" }).click();
  await admin.getByText("이름을 적어 주세요.").waitFor();
  await editing.getByRole("button", { name: "취소" }).click();
  assert.deepEqual(await cells("마바"), ["마바", "나파트", "maba.park"]);
  console.log("  다라 → 다라수정/다파트/dara.new 저장(새로 고침 뒤에도), 겹치는 아이디·빈 이름은 거부, 취소는 그대로");

  step("한 명 지우기 → 새로 고쳐도 그대로");
  await row("마바").getByRole("button", { name: "삭제" }).click();
  await admin.getByText("마바님을 명단에서 지웠어요.").waitFor();
  await admin.reload();
  await row("가나").waitFor();
  assert.equal(await rows().count(), 2);
  assert.equal((await H.readDoc("mailIndex/maba.park@samsung.com")).personId, undefined);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("  마바 삭제 → 2명(새로 고침 뒤에도). 여기까지 콘솔 오류 0건");

  step("저장 요청이 서버에 닿지 않으면(사내망 등): '아직 저장되지 않았어요' + 저장 전 표시, 새로 고치면 사라진다");
  {
    await admin.route("**/google.firestore.v1.Firestore/Write/**", (r) => r.abort());
    await add("자차\t나파트\tjacha.jung");
    await admin.getByText("저장하는 중이에요…").waitFor();
    await row("자차").waitFor(); // 화면에는 바로 보인다(이것 때문에 저장된 줄 안다)
    await rosterPanel().getByText("아직 서버에 저장되지 않은 변경이 있어요").waitFor();
    await admin.getByText(/아직 저장되지 않았어요\. 저장 요청이 서버에 닿지 않고 있어요/).waitFor({ timeout: 20000 });
    assert.equal(await admin.getByText("1명을 추가했어요.").count(), 0, "저장됐다고 하지 않는다");
    await admin.reload();
    await row("가나").waitFor();
    assert.equal(await rows().count(), 2, "새로 고치면 저장 안 된 사람은 없다");
    await admin.unroute("**/google.firestore.v1.Firestore/Write/**");
    // 연결이 돌아오면 다시 넣을 수 있다
    await add("자차\t나파트\tjacha.jung");
    await admin.getByText("1명을 추가했어요.").waitFor();
    await admin.reload();
    await row("자차").waitFor();
    assert.equal(await rows().count(), 3);
    console.log("  연결이 막힘 → 화면에는 보이지만 '아직 저장되지 않았어요'와 저장 전 표시 → 새로 고치면 없음 → 연결이 돌아온 뒤 다시 넣으면 저장됨");
  }

  await browser.close();
  console.log("완료");
})().catch((e) => { console.error("실패:", e.message); process.exit(1); });
