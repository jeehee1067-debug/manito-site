import { MISSION_CARDS } from "./constants.js";
import { seededRandom, shuffle } from "./random.js";

// 난이도를 고르면 그 난이도에서 받는 카드 수(사용자가 정함: "난이도 선택하면 랜덤으로 두 장 주고 고르게").
export const DEAL_COUNT = 2;

// 한 사람이 한 주차·한 난이도에서 받는 카드. 사람·주차·난이도가 같으면 항상 같은 카드다(다시 뽑기 없음).
// - 대상이 다른 근무지면 직접 가지 않아도 되는 카드(remote)에서만 뽑는다.
// - 돈이 드는 카드(cost)가 있는 난이도(보통·도전)는 "돈이 드는 카드 한 장 + 돈이 안 드는 카드 한 장"을 준다
//   (사용자가 정함: 모두에게 비용 카드가 한 번 이상 나오게. 그리고 정해진 규칙: 돈이 안 드는 카드도 고를 수 있어야 한다).
//   각각 섞인 순서에서 처음 나오는 것이라, 같은 종류 안에서는 고르게 나온다. 비용 카드는 모두 실물이라 실물도 한 장은 나온다.
// - 돈이 드는 카드가 없는 경우(쉬움, 다른 근무지 대상의 보통): 섞인 순서대로 두 장. 실물 카드가 있는데 한 장도 없으면 마지막 장을 실물로 바꾼다.
// - taken: 다른 주차에 이미 고른 카드 번호. 같은 미션을 또 하지 않게 뺀다(빼고 나서 두 장이 안 되면 빼지 않는다).
export function dealCards(pid, slot, level, remoteOnly = false, taken = []) {
  const all = (MISSION_CARDS[level] || []).filter((c) => !remoteOnly || c.remote);
  const fresh = all.filter((c) => !taken.includes(c.id));
  const list = fresh.length >= DEAL_COUNT && (!all.some((c) => c.cost) || fresh.some((c) => c.cost)) ? fresh : all;
  const deck = shuffle(list, seededRandom(`${pid}:${slot}:${level}:${remoteOnly ? "r" : "a"}`)).map((c) => ({ ...c, level }));
  const paid = deck.find((c) => c.cost);
  const free = deck.find((c) => !c.cost);
  if (paid && free && DEAL_COUNT === 2) return deck.filter((c) => c === paid || c === free); // 섞인 순서 그대로(비용 카드가 늘 앞에 오지 않게)
  const hand = deck.slice(0, DEAL_COUNT);
  if (hand.length && !hand.some((c) => c.real)) {
    const real = deck.find((c) => c.real);
    if (real) hand[hand.length - 1] = real;
  }
  return hand;
}
