import { useEffect } from "react";
import { Icon, iconForTitle } from "./icons.jsx";
import { AVATARS, CARD_HOW, cardHow } from "./lib/constants.js";
import { useApp } from "./App.jsx";

const base = import.meta.env.BASE_URL;

export function avatarSrc(index) {
  return `${base}char/${AVATARS[index % AVATARS.length]}.png`;
}

// 방탈출 캐릭터 그림. 고르지 않은 사람은 ID로 정해진 기본 캐릭터.
// 그 사람의 선택을 읽어 오기 전에는 자리만 잡아 두고 감춘다(기본 캐릭터가 잠깐 보였다 바뀌지 않게).
export function Avatar({ pid, index, size = 56, dim = false }) {
  const app = useApp() || {};
  const fixed = index != null || !app.avatarOf;
  useEffect(() => {
    if (!fixed && pid) app.loadAvatar?.(pid);
  }, [fixed, pid, app.loadAvatar]);
  const i = index ?? (app.avatarOf ? app.avatarOf(pid) : 0);
  const ready = fixed || !pid || app.avatarReady?.(pid);
  return (
    <img className={dim ? "avatar dim" : "avatar"} src={avatarSrc(i)} alt=""
      style={{ height: size, visibility: ready ? "visible" : "hidden" }} />
  );
}

// icon: 제목 앞 픽셀 아이콘 이름(src/icons.jsx). 주지 않으면 제목의 낱말로 고르고, 맞는 것이 없으면 없다. false면 붙이지 않는다.
export function Panel({ title, children, className = "", icon, id }) {
  const name = icon === false ? null : icon || iconForTitle(title);
  return (
    <section className={`panel ${className}`} id={id}>
      {title && <h2 className="panel-title">{name && <Icon name={name} size={22} className="title-icon" />}{title}</h2>}
      {children}
    </section>
  );
}

// 포켓몬식 대사창
export function Dialogue({ speaker, children, tone = "" }) {
  return (
    <div className={`dialogue ${tone}`}>
      {speaker && <span className="dialogue-speaker">{speaker}</span>}
      <div className="dialogue-text">{children}</div>
    </div>
  );
}

// 역할 낱말 강조(사용자가 정함: "내가 누군가의 마니또이고 대상도 마니또라는 개념이 헷갈린다").
// 마니또 = 몰래 챙겨 주는 사람(파랑), 대상 = 마니또가 챙겨 주는 사람(노랑). 화면마다 처음 나오는 곳에 한 번씩 쓴다.
export function Giver({ children = "마니또" }) {
  return <b className="role role-giver">{children}</b>;
}
export function Target({ children = "대상" }) {
  return <b className="role role-target">{children}</b>;
}
// 탭 맨 위 역할 안내: 내 미션(as="giver")에서는 내가 마니또, 추리 보드(as="target")에서는 내가 대상
export function RoleNote({ as }) {
  const giver = as === "giver";
  return (
    <div className={`role-note role-note-${as}`} role="note">
      <p className="role-note-head">이 탭에서 나는 {giver ? <><Giver />예요</> : <><Target />이에요</>}</p>
      <p className="role-flow" aria-hidden="true">
        {giver
          ? <><span className="role-me">나</span><span className="role-arrow">미션 ▶</span><Target>내 대상</Target></>
          : <><Giver>내 마니또 ?</Giver><span className="role-arrow">미션 ▶</span><span className="role-me">나</span></>}
      </p>
      <p className="small">
        {giver
          ? <>내 <Target /> 한 사람을 몰래 챙기는 곳이에요. 내가 받은 미션의 인증은 <a href="#detective">추리 보드</a>에서 해요.</>
          : <>내 <Giver />가 보낸 미션을 받아 인증하고, 그 마니또가 누구인지 추리하는 곳이에요. 내가 할 미션은 <a href="#mission">내 미션</a>에 있어요.</>}
      </p>
    </div>
  );
}

// 카드를 하는 방법 표시: "사이트 쪽지"(쪽지 칸에 써서 보내면 끝) / "실물 전달"(직접 두거나 건네기). 목록에 없는 카드는 표시하지 않는다.
export function HowTag({ card }) {
  const how = cardHow(card);
  if (!how) return null;
  return <span className={`how-tag how-${how}`}>{CARD_HOW[how].label}</span>;
}
