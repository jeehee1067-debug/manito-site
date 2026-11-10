import { AVATARS } from "./lib/constants.js";
import { useApp } from "./App.jsx";

const base = import.meta.env.BASE_URL;

export function avatarSrc(index) {
  return `${base}char/${AVATARS[index % AVATARS.length]}.png`;
}

// 방탈출 캐릭터 그림. 고르지 않은 사람은 ID로 정해진 기본 캐릭터.
export function Avatar({ pid, index, size = 56, dim = false }) {
  const { avatarOf } = useApp() || {};
  const i = index ?? (avatarOf ? avatarOf(pid) : 0);
  return <img className={dim ? "avatar dim" : "avatar"} src={avatarSrc(i)} alt="" style={{ height: size }} />;
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
