// 참여자 화면용 명단 요약 (public/roster 문서 하나).
// 명단은 사람마다 문서가 따로라 전체를 읽으면 54건이 나가는데, 참여자 화면에 필요한 건 이름·파트뿐이다(근무지는 예전 자료에만 있다).
// 메일(아이디)은 요약에 넣지 않는다: 참여자끼리 서로의 메일을 볼 필요가 없다.
// 운영 화면이 명단(roster 컬렉션)을 읽다가 요약과 다르면 요약 문서를 다시 쓴다. 운영 화면은 전체 명단을 그대로 쓴다.

// roster 문서 목록 [{ pid, name, loc, part, ... }] → { pid: { name, loc, part } } (pid 순서 고정)
export function rosterSummary(rows) {
  const people = {};
  for (const r of [...rows].sort((a, b) => a.pid.localeCompare(b.pid))) {
    people[r.pid] = { name: r.name ?? "", loc: r.loc ?? null, part: r.part ?? null };
    // 중도 이탈로 짝에서 빠진 사람(tools/handover가 명단에 leftGame: true를 남긴다): 이제 누구의 마니또도 아니라 추리 보드 후보에서 뺀다
    if (r.leftGame === true) people[r.pid].out = true;
  }
  return people;
}

// 명단 입력 한 줄 → { name, part, email, bad }. 형식: "이름, 파트, 아이디"(쉼표 또는 탭. 엑셀에서 세 칸을 복사해 붙여 넣으면 탭이다).
// 아이디는 회사 메일의 @ 앞부분이고 domain을 붙여 메일 주소로 만든다. 전체 주소를 적으면 그대로 쓴다.
// 아이디가 메일 주소로 쓸 수 없는 글자면 bad로 알려 준다(예전 형식 "이름,근무지,파트"로 넣은 줄도 여기서 걸린다).
// 아이디를 비우면 email = null: 그 사람은 메일 인증으로는 연결할 수 없고 초대 코드로만 가입한다.
export function parseRosterLine(line, domain) {
  const [name = "", partTok = "", idTok = ""] = line.split(/[,\t]/).map((x) => x.trim());
  const raw = idTok.toLowerCase();
  let email = null;
  let bad = null;
  if (raw) {
    email = raw.includes("@") ? raw : `${raw}@${domain}`;
    if (!/^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(email)) { bad = idTok; email = null; }
  }
  return { name, part: partTok || null, email, bad };
}

// 요약 → 화면에서 쓰는 목록 [{ pid, name, loc, part }]
export function summaryToList(people) {
  return Object.entries(people || {})
    .map(([pid, p]) => ({ pid, ...p }))
    .sort((a, b) => a.pid.localeCompare(b.pid));
}

export function sameSummary(a, b) {
  return JSON.stringify(rosterSummary(summaryToList(a))) === JSON.stringify(rosterSummary(summaryToList(b)));
}
