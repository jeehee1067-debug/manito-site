import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, onSnapshot } from "firebase/firestore";
import { auth, db, configured } from "./firebase.js";
import { AVATARS, PHASE, PHASES } from "./lib/constants.js";
import Login from "./pages/Login.jsx";
import Claim from "./pages/Claim.jsx";
import Profile from "./pages/Profile.jsx";
import MyMission from "./pages/MyMission.jsx";
import Detective from "./pages/Detective.jsx";
import Feed from "./pages/Feed.jsx";
import Team from "./pages/Team.jsx";
import Vote from "./pages/Vote.jsx";
import Reveal from "./pages/Reveal.jsx";
import Admin from "./pages/Admin.jsx";
import { Garland, XmasFooter } from "./xmas.jsx";

const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);

function useHashTab(fallback) {
  const [tab, setTab] = useState(() => window.location.hash.slice(1) || fallback);
  useEffect(() => {
    const on = () => setTab(window.location.hash.slice(1) || fallback);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, [fallback]);
  return [tab, (t) => (window.location.hash = t)];
}

function defaultAvatar(pid) {
  let h = 0;
  for (const ch of pid || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % AVATARS.length;
}

export function Loading({ text = "불러오는 중" }) {
  return (
    <div className="loading">
      <span>{text}</span>
      <span className="loading-bar"><i /></span>
    </div>
  );
}

// 기본 구독. 로그인 직후 새 계정 권한이 늦게 반영돼 첫 구독이 거부되는 경우에 대비해 몇 번 다시 시도한다
// (Firestore 구독은 한 번 거부되면 끊기므로, 그대로 두면 새로고침 전까지 "내 이름 연결" 화면에 멈출 수 있다).
function watch(ref, onNext, onFail, tries = 3, options = {}) {
  let off = () => {};
  let stopped = false;
  const start = (left) => {
    off = onSnapshot(ref, options, onNext, (err) => {
      if (!stopped && left > 0 && err?.code === "permission-denied") setTimeout(() => !stopped && start(left - 1), 800);
      else onFail(err);
    });
  };
  start(tries);
  return () => {
    stopped = true;
    off();
  };
}

// 해시(#mission 등)를 지워 다음 사람이 기본 탭에서 시작하게 한다.
function clearHash() {
  if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => (configured ? onAuthStateChanged(auth, setUser) : undefined), []);

  // 같은 기기에서 다른 사람이 로그인할 수 있게 하는 로그아웃.
  // 화면(Firestore 구독)부터 내린 뒤 로그아웃해야 직전 사람의 구독이 권한 없음으로 끊기지 않는다.
  async function logout() {
    setLeaving(true);
    await new Promise((r) => setTimeout(r, 50));
    clearHash();
    try {
      await signOut(auth);
    } finally {
      setLeaving(false);
    }
  }

  if (!configured) {
    return (
      <main className="app narrow">
        <section className="panel">
          <h2 className="panel-title">설정이 필요해요</h2>
          <p><code>src/firebase.config.js</code>에 Firebase 웹 앱 설정값을 넣은 뒤 다시 실행해 주세요.</p>
        </section>
      </main>
    );
  }
  if (user === undefined || leaving) return <Loading text={leaving ? "로그아웃하는 중" : undefined} />;
  if (!user) return <Login />;
  // 사람이 바뀌면 key가 바뀌어 아래 상태(구독·화면)를 통째로 새로 만든다. 직전 사람의 이름·데이터가 남지 않는다.
  return <Session key={user.uid} user={user} logout={logout} />;
}

function Session({ user, logout }) {
  const [config, setConfig] = useState(undefined);
  const [me, setMe] = useState(undefined); // users/{uid}
  const [roster, setRoster] = useState([]);
  const [avatars, setAvatars] = useState({});
  const [tab, setTab] = useHashTab("mission");

  useEffect(() => {
    const offs = [
      watch(doc(db, "config", "app"), (s) => setConfig(s.exists() ? s.data() : null), () => setConfig(null)),
      // 내 users 문서는 서버 저장이 확인된 뒤에만 반영한다. 가입 직후 화면에 먼저 반영하면, 서버 규칙은 아직
      // "연결 전"으로 보고 내 배정·프로필 읽기를 거부해 "아직 배정 전이에요"로 굳는다(실제로 재현됨).
      watch(doc(db, "users", user.uid), (s) => {
        if (!s.metadata.hasPendingWrites) setMe(s.exists() ? s.data() : null);
      }, () => setMe(null), 3, { includeMetadataChanges: true }),
      watch(collection(db, "roster"), (s) => setRoster(s.docs.map((d) => ({ pid: d.id, ...d.data() }))), () => {}),
      watch(collection(db, "avatars"), (s) => setAvatars(Object.fromEntries(s.docs.map((d) => [d.id, d.data().avatar]))), () => {}),
    ];
    return () => offs.forEach((off) => off());
  }, [user]);

  const ctx = useMemo(() => {
    const byPid = Object.fromEntries(roster.map((r) => [r.pid, r]));
    const myPid = me?.personId || null;
    return {
      user,
      config,
      me,
      myPid,
      myTeam: myPid ? byPid[myPid]?.team : null,
      roster,
      byPid,
      nameOf: (pid) => byPid[pid]?.name || "(알 수 없음)",
      avatarOf: (pid) => (avatars[pid] ?? defaultAvatar(pid)),
      isAdmin: Boolean(user && config?.admins?.includes(user.uid)),
    };
  }, [user, config, me, roster, avatars]);

  if (config === undefined || me === undefined) return <Loading />;
  if (config === null) return <Login bootstrap />;

  const phase = config.phase;
  const tabs = [];
  if (ctx.myPid) {
    tabs.push(["mission", "내 미션"], ["detective", "추리 보드"], ["feed", "피드"], ["team", "우리 팀"]);
    if (phase >= PHASE.VOTING) tabs.push(["vote", "투표"]);
    tabs.push(["profile", "내 프로필"]);
  }
  if (phase >= PHASE.REVEAL || ctx.isAdmin) tabs.push(["reveal", "결과"]);
  if (ctx.isAdmin) tabs.push(["admin", "운영"]);

  // 지금 로그인한 사람. 같은 기기를 여러 사람이 쓸 때 남의 계정으로 들어와 있는지 바로 알 수 있게 헤더에 보인다.
  const who = ctx.myPid ? `${ctx.nameOf(ctx.myPid)}님` : ctx.isAdmin ? "운영자" : "";
  const current = tabs.find(([k]) => k === tab)?.[0] || (ctx.isAdmin && !ctx.myPid ? "admin" : tabs[0]?.[0]);

  let body;
  if (!ctx.myPid && !ctx.isAdmin) body = <Claim />;
  else if (current === "mission") body = <MyMission />;
  else if (current === "detective") body = <Detective />;
  else if (current === "feed") body = <Feed />;
  else if (current === "team") body = <Team />;
  else if (current === "vote") body = <Vote />;
  else if (current === "profile") body = <Profile />;
  else if (current === "reveal") body = <Reveal />;
  else if (current === "admin") body = <Admin />;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <header className="hud">
          <Garland />
          <div className="hud-row">
            <span className="hud-logo">S1FA 마니또</span>
            <span className="hud-chip">{PHASES[phase]}{phase === PHASE.RUNNING ? ` ${config.week}주차` : ""}</span>
            <button className="pk-btn ghost sm hud-out" onClick={logout} title="다른 사람이 이 기기에서 로그인하려면 로그아웃하세요">
              {who && <span className="hud-who">{who}</span>}로그아웃
            </button>
          </div>
          {tabs.length > 0 && (
            <nav className="tabs" aria-label="메뉴">
              {tabs.map(([k, label]) => (
                <button key={k} className={k === current ? "chip is-on" : "chip"} aria-current={k === current ? "page" : undefined} onClick={() => setTab(k)}>
                  {label}
                </button>
              ))}
            </nav>
          )}
        </header>
        <main>{body}</main>
        <XmasFooter />
      </div>
    </AppCtx.Provider>
  );
}
