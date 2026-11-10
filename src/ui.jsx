import { useEffect } from "react";
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

export function Panel({ title, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      {title && <h2 className="panel-title">{title}</h2>}
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
