// 참여자 화면용 명단 요약 (public/roster 문서 하나).
// 명단은 사람마다 문서가 따로라 전체를 읽으면 56건이 나가는데, 참여자 화면에 필요한 건 이름·팀·근무지·파트뿐이다.
// 운영 화면이 명단(roster 컬렉션)을 읽다가 요약과 다르면 요약 문서를 다시 쓴다. 운영 화면은 전체 명단을 그대로 쓴다.

// roster 문서 목록 [{ pid, name, team, loc, part, ... }] → { pid: { name, team, loc, part } } (pid 순서 고정)
export function rosterSummary(rows) {
  const people = {};
  for (const r of [...rows].sort((a, b) => a.pid.localeCompare(b.pid))) {
    people[r.pid] = { name: r.name ?? "", team: r.team ?? null, loc: r.loc ?? null, part: r.part ?? null };
  }
  return people;
}

// 명단 입력 한 줄 → { name, loc, part, team }. 형식: "이름,근무지,파트" 또는 "이름,근무지,파트,팀번호".
// 근무지·파트·팀은 생략할 수 있다. 숫자만 있는 칸은 팀 번호로 본다(예전 형식 "이름,근무지,3"·"이름,3"도 받는다).
export function parseRosterLine(line, locs) {
  const [name, ...rest] = line.split(/[,\t]/).map((x) => x.trim());
  const out = { name, loc: null, part: null, team: null, badLoc: null };
  rest.forEach((tok, i) => {
    if (!tok) return;
    if (/^\d+$/.test(tok)) out.team = Number(tok);
    else if (i === 0) {
      if (locs.includes(tok.toUpperCase())) out.loc = tok.toUpperCase();
      else out.badLoc = tok;
    } else out.part = tok;
  });
  return out;
}

// 요약 → 화면에서 쓰는 목록 [{ pid, name, team, loc, part }]
export function summaryToList(people) {
  return Object.entries(people || {})
    .map(([pid, p]) => ({ pid, ...p }))
    .sort((a, b) => a.pid.localeCompare(b.pid));
}

export function sameSummary(a, b) {
  return JSON.stringify(rosterSummary(summaryToList(a))) === JSON.stringify(rosterSummary(summaryToList(b)));
}
