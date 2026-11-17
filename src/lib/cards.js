import { MISSION_CARDS } from "./constants.js";
import { seededRandom, shuffle } from "./random.js";

// 난이도를 고르면 그 난이도에서 받는 카드 수(사용자가 정함: "난이도 선택하면 랜덤으로 두 장 주고 고르게").
export const DEAL_COUNT = 2;

// 한 사람이 한 주차·한 난이도에서 받는 카드. 사람·주차·난이도가 같으면 항상 같은 카드다(다시 뽑기 없음).
// - 대상이 다른 근무지면 직접 가지 않아도 되는 카드(remote)에서만 뽑는다.
// - 돈이 드는 카드만 나오지 않게 한다: 모두 비용 카드면 마지막 장을 섞인 순서에서 처음 나오는 무비용 카드로 바꾼다
//   (정해진 규칙: 난이도마다 돈이 안 드는 카드를 고를 수 있어야 한다).
// - 실물 카드(real)가 한 장은 나오게 한다(사용자가 정함): 한 장도 없으면 마지막 장을 처음 나오는 실물 카드로 바꾼다.
//   쉬움(모두 쪽지)과, 다른 근무지 대상의 보통(원격 카드가 모두 쪽지)에는 실물 카드가 없어 그대로 둔다.
//   비용 카드가 아예 안 나와 "비용 카드 +1장"을 받을 길이 없는 사람을 줄이려는 것이기도 하다(보통의 실물 3장 중 2장이 비용 카드).
//   두 조건은 서로 깨지 않는다: 비용 카드 두 장에서 한 장을 바꿔도 실물이 한 장 남고, 쪽지 두 장에서 한 장을 바꿔도 무비용 쪽지가 남는다.
export function dealCards(pid, slot, level, remoteOnly = false) {
  const list = (MISSION_CARDS[level] || []).filter((c) => !remoteOnly || c.remote);
  const deck = shuffle(list, seededRandom(`${pid}:${slot}:${level}:${remoteOnly ? "r" : "a"}`)).map((c) => ({ ...c, level }));
  const hand = deck.slice(0, DEAL_COUNT);
  if (hand.length && hand.every((c) => c.cost)) {
    const free = deck.find((c) => !c.cost);
    if (free) hand[hand.length - 1] = free;
  }
  if (hand.length && !hand.some((c) => c.real)) {
    const real = deck.find((c) => c.real);
    if (real) hand[hand.length - 1] = real;
  }
  return hand;
}
