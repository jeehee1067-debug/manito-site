import { MISSION_CARDS } from "./constants.js";
import { seededRandom, shuffle } from "./random.js";

// 난이도를 고르면 그 난이도에서 받는 카드 수(사용자가 정함: "난이도 선택하면 랜덤으로 두 장 주고 고르게").
export const DEAL_COUNT = 2;

// 한 사람이 한 주차·한 난이도에서 받는 카드. 사람·주차·난이도가 같으면 항상 같은 카드다(다시 뽑기 없음).
// - 대상이 다른 근무지면 직접 가지 않아도 되는 카드(remote)에서만 뽑는다.
// - 돈이 드는 카드만 나오지 않게 한다: 모두 비용 카드면 마지막 장을 섞인 순서에서 처음 나오는 무비용 카드로 바꾼다
//   (정해진 규칙: 난이도마다 돈이 안 드는 카드를 고를 수 있어야 한다).
export function dealCards(pid, slot, level, remoteOnly = false) {
  const list = (MISSION_CARDS[level] || []).filter((c) => !remoteOnly || c.remote);
  const deck = shuffle(list, seededRandom(`${pid}:${slot}:${level}:${remoteOnly ? "r" : "a"}`)).map((c) => ({ ...c, level }));
  const hand = deck.slice(0, DEAL_COUNT);
  if (hand.length && hand.every((c) => c.cost)) {
    const free = deck.find((c) => !c.cost);
    if (free) hand[hand.length - 1] = free;
  }
  return hand;
}
