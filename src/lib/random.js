// 추첨·배정용 난수. 브라우저/Node 모두 crypto.getRandomValues 사용.
export function secureRandom() {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] / 2 ** 32;
}

// 같은 사람에게 항상 같은 결과가 나와야 하는 곳(미션 카드 3장 제시, 투표 카드 순서)에 쓰는 시드 난수
export function seededRandom(seedText) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, rand = secureRandom) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 0/O, 1/I 처럼 헷갈리는 글자는 뺀다.
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function makeCode(length = 4, rand = secureRandom) {
  let s = "";
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

// 입력값 정리: 대문자로, 공백·기호 제거. 코드에 없는 O/I는 사람이 0/1을 잘못 본 것으로 보고 고치지 않고 그대로 둔다.
export function normalizeCode(input) {
  return (input || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}
