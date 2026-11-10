// 연말·크리스마스 장식 (시즌 한정)
// 기본 디자인(방탈출과 같은 색·테두리·버튼·대사창)은 styles.css 그대로 두고, 장식은 이 파일과 xmas.css에만 있다.
// 시즌이 끝나면: main.jsx의 xmas import 두 줄, App.jsx의 <Garland />·<XmasFooter />, Login.jsx의 장식 몇 줄을 지우면 된다.
// 그림은 src/assets/xmas/*.svg (픽셀 아트, 방탈출 잉크색 #1d2029 테두리)
import treeUrl from "./assets/xmas/tree.svg";
import giftRedUrl from "./assets/xmas/gift-red.svg";
import giftGreenUrl from "./assets/xmas/gift-green.svg";
import leader1 from "./assets/xmas/leader1.png";
import leader2 from "./assets/xmas/leader2.png";
import leader3 from "./assets/xmas/leader3.png";
import leader4 from "./assets/xmas/leader4.png";

// 로그인 화면 주인공: 방탈출의 파트장님·PL님(public/char/boss1~4.png)에 크리스마스 소품을 얹은 그림.
// 순서: 김주헌 파트장님(루돌프), 김진석 파트장님(엘프 모자), 윤지혜 파트장님(털모자), 손승준 PL님(산타 모자).
// 시즌이 끝나면 Login.jsx에서 원본(public/char/boss1~4.png)을 쓰면 된다.
export const XMAS_LEADERS = [leader1, leader2, leader3, leader4];

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
// scale을 안 주면 크기는 CSS(xmas.css의 .px-tree, .px-gift-a/b)가 정한다(로그인 화면은 화면 폭에 따라 다름).
export function XmasTree({ scale }) {
  return <img className="px-art px-tree" src={treeUrl} alt="" style={scale ? { height: 22 * scale } : undefined} />;
}

export function Gifts({ scale }) {
  return (
    <span className="gifts" aria-hidden="true">
      <img className="px-art px-gift-a" src={giftRedUrl} alt="" style={scale ? { height: 12 * scale } : undefined} />
      <img className="px-art px-gift-b" src={giftGreenUrl} alt="" style={scale ? { height: 12 * (scale - 1) } : undefined} />
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
