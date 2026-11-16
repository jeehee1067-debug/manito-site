import { useEffect } from "react";
import { Icon, iconForTitle } from "./icons.jsx";
import { AVATARS } from "./lib/constants.js";
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
export function Panel({ title, children, className = "", icon }) {
  const name = icon === false ? null : icon || iconForTitle(title);
  return (
    <section className={`panel ${className}`}>
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
