// 참여자 화면용 명단 요약 (public/roster 문서 하나).
// 명단은 사람마다 문서가 따로라 전체를 읽으면 54건이 나가는데, 참여자 화면에 필요한 건 이름·근무지·파트뿐이다.
// 운영 화면이 명단(roster 컬렉션)을 읽다가 요약과 다르면 요약 문서를 다시 쓴다. 운영 화면은 전체 명단을 그대로 쓴다.

// roster 문서 목록 [{ pid, name, loc, part, ... }] → { pid: { name, loc, part } } (pid 순서 고정)
export function rosterSummary(rows) {
  const people = {};
  for (const r of [...rows].sort((a, b) => a.pid.localeCompare(b.pid))) {
    people[r.pid] = { name: r.name ?? "", loc: r.loc ?? null, part: r.part ?? null };
  }
  return people;
}

// 명단 입력 한 줄 → { name, loc, part }. 형식: "이름,근무지,파트". 근무지·파트는 생략할 수 있다("이름,,파트").
// 근무지 칸에 근무지가 아닌 글자가 오면 badLoc으로 알려 준다(오타가 파트로 들어가지 않게).
export function parseRosterLine(line, locs) {
  const [name, locTok = "", partTok = ""] = line.split(/[,\t]/).map((x) => x.trim());
  const out = { name, loc: null, part: partTok || null, badLoc: null };
  if (locTok) {
    if (locs.includes(locTok.toUpperCase())) out.loc = locTok.toUpperCase();
    else out.badLoc = locTok;
  }
  return out;
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
