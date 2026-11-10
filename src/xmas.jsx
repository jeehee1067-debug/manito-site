// 연말·크리스마스 장식 (시즌 한정)
// 기본 디자인(방탈출과 같은 색·테두리·버튼·대사창)은 styles.css 그대로 두고, 장식은 이 파일과 xmas.css에만 있다.
// 시즌이 끝나면: main.jsx의 xmas import 두 줄, App.jsx의 <Garland />·<XmasFooter />, Login.jsx의 장식 몇 줄을 지우면 된다.
// 그림은 src/assets/xmas/*.svg (픽셀 아트, 방탈출 잉크색 #1d2029 테두리)
import treeUrl from "./assets/xmas/tree.svg";
import giftRedUrl from "./assets/xmas/gift-red.svg";
import giftGreenUrl from "./assets/xmas/gift-green.svg";

// 화면 뒤에서 내리는 눈. 패널 뒤(배경)에만 보인다.
export function Snow() {
  return (
    <div className="snow" aria-hidden="true">
      <i />
      <i />
    </div>
  );
}

// 상단 전구 줄
export function Garland() {
  return <div className="garland" aria-hidden="true" />;
}

// 픽셀 그림은 원본 크기(트리 22px, 선물 12px)의 정수 배로 그려야 픽셀이 고르게 보인다.
export function XmasTree({ scale = 5 }) {
  return <img className="px-art" src={treeUrl} alt="" style={{ height: 22 * scale }} />;
}

export function Gifts({ scale = 3 }) {
  return (
    <span className="gifts" aria-hidden="true">
      <img className="px-art" src={giftRedUrl} alt="" style={{ height: 12 * scale }} />
      <img className="px-art" src={giftGreenUrl} alt="" style={{ height: 12 * (scale - 1) }} />
    </span>
  );
}

export function XmasFooter() {
  return (
    <footer className="xmas-footer">
      <XmasTree scale={3} />
      <p>MERRY CHRISTMAS<br />&amp; HAPPY NEW YEAR</p>
      <Gifts scale={3} />
    </footer>
  );
}
