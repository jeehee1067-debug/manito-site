import { shuffle, makeCode, secureRandom } from "./random.js";
import { MISSION_SLOTS } from "./constants.js";

// 사람 목록을 n개 팀으로 고르게 나눈다.
export function splitTeams(pids, teamCount, rand = secureRandom) {
  const order = shuffle(pids, rand);
  const teams = {};
  order.forEach((pid, i) => {
    teams[pid] = (i % teamCount) + 1;
  });
  return teams;
}

// 한 그룹 안에서 원형 배정: 한 줄로 섞은 뒤 다음 사람을 맡는다.
// 자기 자신·맞마니또(3명 이상일 때)가 생기지 않고, 가능하면 같은 팀도 피한다.
function cycleWithin(group, rand, maxTries) {
  if (group.length < 2) throw new Error("한 그룹에 최소 2명이 필요합니다.");
  for (let t = 0; t < maxTries; t++) {
    const a = shuffle(group, rand);
    const next = (i) => a[(i + 1) % a.length];
    if (a.every((p, i) => p.team == null || p.team !== next(i).team)) {
      return { pairs: a.map((g, i) => ({ giverPid: g.pid, receiverPid: next(i).pid })), teamOk: true };
    }
  }
  const a = shuffle(group, rand);
  return { pairs: a.map((g, i) => ({ giverPid: g.pid, receiverPid: a[(i + 1) % a.length].pid })), teamOk: false };
}

/**
 * 마니또 배정
 * options.siteMode
 *   "any"  (기본) 근무지 상관없이 전원을 한 원으로 잇는다. 다른 근무지끼리도 짝이 된다.
 *   "same" 같은 근무지끼리만 짝을 짓는다(근무지별로 원이 따로 생김).
 *          3명 미만인 근무지는 가장 큰 근무지 원에 합친다.
 * 같은 팀은 피한다. 도저히 안 되는 그룹만 팀 조건을 풀고 경고를 남긴다.
 * people: [{ pid, team, loc }]
 * 반환: { pairs, siteMatched, teamExcluded, warnings }
 */
export function assignManito(people, { siteMode = "any", rand = secureRandom, maxTries = 20000 } = {}) {
  if (people.length < 3) throw new Error("최소 3명이 필요합니다.");
  const warnings = [];
  let groups = [people];
  let siteMatched = false;

  if (siteMode === "same") {
    if (people.some((p) => !p.loc)) throw new Error("근무지가 비어 있는 사람이 있어요. 근무지를 먼저 채워 주세요.");
    const byLoc = {};
    for (const p of people) (byLoc[p.loc] ||= []).push(p);
    const big = Object.values(byLoc).filter((g) => g.length >= 3).sort((x, y) => y.length - x.length);
    const small = Object.entries(byLoc).filter(([, g]) => g.length < 3);
    if (!big.length) {
      warnings.push("모든 근무지가 3명 미만이라 근무지 구분 없이 배정했어요.");
    } else {
      groups = big.map((g) => [...g]);
      for (const [loc, g] of small) {
        groups[0].push(...g);
        warnings.push(`${loc} 근무자가 ${g.length}명뿐이라 ${big[0][0].loc} 원에 합쳤어요. 이 사람들은 다른 근무지와 짝이 될 수 있어요.`);
      }
      siteMatched = small.length === 0;
    }
  }

  const pairs = [];
  let teamExcluded = true;
  for (const g of groups) {
    const r = cycleWithin(g, rand, maxTries);
    if (!r.teamOk) {
      teamExcluded = false;
      warnings.push(`${groups.length > 1 ? g[0].loc + " " : ""}그룹은 같은 팀을 피하는 배정이 불가능해 팀 조건 없이 배정했어요.`);
    }
    pairs.push(...r.pairs);
  }
  return { pairs, siteMatched, teamExcluded, warnings };
}

// 이전 이름 호환: 근무지 없이 팀만 피하는 배정
export function assignWithTeams(people, rand = secureRandom, maxTries = 20000) {
  const r = assignManito(people, { siteMode: "any", rand, maxTries });
  if (!r.teamExcluded) throw new Error("같은 팀을 피하는 배정을 찾지 못했습니다. 팀 구성을 확인해 주세요.");
  return r.pairs;
}

// 마니또별 미션 슬롯 코드 생성 (전체에서 중복 없음)
export function generateCodes(giverPids, rand = secureRandom) {
  const used = new Set();
  const byGiver = {};
  for (const pid of giverPids) {
    byGiver[pid] = {};
    for (const slot of MISSION_SLOTS) {
      let code;
      do {
        code = makeCode(4, rand);
      } while (used.has(code));
      used.add(code);
      byGiver[pid][slot] = code;
    }
  }
  return byGiver;
}

export function makeInviteCode(rand = secureRandom) {
  return makeCode(6, rand);
}
