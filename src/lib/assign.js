import { shuffle, makeCode, secureRandom } from "./random.js";
import { MISSION_SLOTS } from "./constants.js";

// 한 그룹 안에서 원형 배정: 원으로 세운 뒤 각자 다음 사람을 맡는다.
// 자기 자신·맞마니또(3명 이상일 때)가 생기지 않고, 같은 파트가 이웃하지 않게 세운다(= 같은 파트끼리는 짝이 안 된다).
// 파트가 비어 있는 사람은 누구와도 이웃할 수 있다.
//
// "무작위로 섞어서 맞을 때까지 반복"은 파트처럼 큰 묶음(예: 18명씩 3개)에서는 사실상 성공하지 못한다(20만 번에 0번).
// 그래서 조건에 맞는 원을 먼저 만들고, 조건을 깨지 않는 자리 맞바꾸기로 섞는다.
//  1) 큰 파트부터 짝수 자리(0,2,4…)를 채우고 이어서 홀수 자리(1,3,5…)를 채운다.
//     가장 큰 파트가 전체의 절반 이하이면 같은 파트가 이웃하지 않는다.
//  2) 두 자리를 무작위로 골라 맞바꾸되, 이웃한 같은 파트 쌍이 늘어나면 되돌린다. 이것을 여러 번 한다.
// 가장 큰 파트가 절반을 넘으면 같은 파트 이웃을 완전히 없앨 수 없다. 그때도 같은 방법으로 되도록 적게 만들고 partOk=false로 알린다.
function cycleWithin(group, rand) {
  const n = group.length;
  if (n < 2) throw new Error("한 그룹에 최소 2명이 필요합니다.");
  const key = (p) => (p.part == null || p.part === "" ? `\u0000${p.pid}` : `p:${p.part}`); // 파트가 없으면 혼자만의 묶음
  const byPart = {};
  for (const p of shuffle(group, rand)) (byPart[key(p)] ||= []).push(p);
  const parts = shuffle(Object.values(byPart), rand).sort((x, y) => y.length - x.length);
  const order = [];
  for (let i = 0; i < n; i += 2) order.push(i);
  for (let i = 1; i < n; i += 2) order.push(i);
  const seat = new Array(n);
  parts.flat().forEach((p, i) => { seat[order[i]] = p; });

  const same = (i, j) => key(seat[(i + n) % n]) === key(seat[(j + n) % n]);
  const clashAround = (i, j) => {
    // i, j 자리를 바꿀 때 영향을 받는 이웃 쌍(중복 없이)에서 같은 파트가 이웃한 수
    const edges = new Set();
    for (const x of [i, j]) {
      edges.add(`${(x - 1 + n) % n}:${x}`);
      edges.add(`${x}:${(x + 1) % n}`);
    }
    let c = 0;
    for (const e of edges) {
      const [a, b] = e.split(":").map(Number);
      if (a !== b && same(a, b)) c++;
    }
    return c;
  };
  for (let t = 0; t < n * 60; t++) {
    const i = Math.floor(rand() * n);
    const j = Math.floor(rand() * n);
    if (i === j || key(seat[i]) === key(seat[j])) continue;
    const before = clashAround(i, j);
    [seat[i], seat[j]] = [seat[j], seat[i]];
    if (clashAround(i, j) > before) [seat[i], seat[j]] = [seat[j], seat[i]];
  }
  const partOk = seat.every((_, i) => !same(i, i + 1));
  return { pairs: seat.map((g, i) => ({ giverPid: g.pid, receiverPid: seat[(i + 1) % n].pid })), partOk };
}

/**
 * 마니또 배정
 * options.siteMode
 *   "any"  (기본) 근무지 상관없이 전원을 한 원으로 잇는다. 다른 근무지끼리도 짝이 된다.
 *   "same" 같은 근무지끼리만 짝을 짓는다(근무지별로 원이 따로 생김).
 *          3명 미만인 근무지는 가장 큰 근무지 원에 합친다.
 * 같은 파트끼리는 짝이 되지 않게 한다. 불가능한 그룹(한 파트가 절반을 넘음)만 되도록 적게 허용하고 경고를 남긴다.
 * people: [{ pid, part, loc }]
 * 반환: { pairs, siteMatched, partExcluded, warnings }
 *   partExcluded  같은 파트 짝이 하나도 없는지(추리 보드가 내 파트를 후보에서 빼도 되는지)
 */
export function assignManito(people, { siteMode = "any", rand = secureRandom } = {}) {
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
  let partExcluded = true;
  for (const g of groups) {
    const r = cycleWithin(g, rand);
    if (!r.partOk) {
      partExcluded = false;
      warnings.push(`${groups.length > 1 ? g[0].loc + " 근무지는 " : ""}한 파트가 절반을 넘어서 같은 파트끼리도 일부 짝이 됐어요.`);
    }
    pairs.push(...r.pairs);
  }
  return { pairs, siteMatched, partExcluded, warnings };
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

// 재배정 때 지울 문서 목록(meta/assignment). 정렬해서 저장한다
// (pairs 순서 그대로 두면 pids[i]의 대상이 pids[i+1]이 되고, codes도 3개씩 마니또 순서와 맞물려 배정 순서가 그대로 드러난다.
//  운영자는 이제 짝을 읽을 수 있어서 비밀 유지에 꼭 필요하지는 않지만, 메모에 짝 정보를 남기지 않는 쪽으로 그대로 둔다).
export function assignmentMemo(pairs, codesByGiver) {
  return {
    codes: Object.values(codesByGiver).flatMap((c) => Object.values(c)).sort(),
    pids: pairs.map((p) => p.giverPid).sort(),
  };
}

export function makeInviteCode(rand = secureRandom) {
  return makeCode(6, rand);
}
