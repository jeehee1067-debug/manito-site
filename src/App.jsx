import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where } from "firebase/firestore";
import { auth, db, configured } from "./firebase.js";
import { bump } from "./lib/writes.js";
import { AVATARS, PHASE, PHASES } from "./lib/constants.js";
import { summaryToList } from "./lib/roster.js";
import Login from "./pages/Login.jsx";
import Claim from "./pages/Claim.jsx";
import Profile from "./pages/Profile.jsx";
import MyMission from "./pages/MyMission.jsx";
import Detective from "./pages/Detective.jsx";
import Feed from "./pages/Feed.jsx";
import PartBoard from "./pages/PartBoard.jsx";
import Reveal from "./pages/Reveal.jsx";
import Admin from "./pages/Admin.jsx";
import Rules from "./pages/Rules.jsx";
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

// 안 읽은 표시: 이 기기에서 본 쪽지·한마디의 ID를 사람별로 기억한다(다른 기기에서는 처음에 모두 새 것으로 보인다).
const seenKey = (uid) => `manito:seen:${uid}`;
function loadSeen(uid) {
  try {
    const v = JSON.parse(localStorage.getItem(seenKey(uid)) || "{}");
    return { inbox: v.inbox || [], manito: v.manito || [], angel: v.angel || [] };
  } catch {
    return { inbox: [], manito: [], angel: [] };
  }
}
function saveSeen(uid, seen) {
  try {
    localStorage.setItem(seenKey(uid), JSON.stringify(seen));
  } catch {
    /* 저장소를 못 쓰는 기기: 표시만 다시 뜬다 */
  }
}
const BASE_TITLE = document.title;

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

const AVATAR_TTL = 10 * 60 * 1000;
// 설정(config/app)을 읽을 수 없는 계정: 아직 명단에도 운영자 목록에도 없는 "연결 전" 계정(보안 규칙).
const LOCKED = "locked";

function Session({ user, logout }) {
  const [config, setConfig] = useState(undefined); // undefined 불러오는 중, null 설정 없음(첫 운영자 설정), LOCKED 연결 전 계정
  const [recheckNo, setRecheckNo] = useState(0); // 공동 운영자로 지정됐는지 다시 확인할 때 올린다
  const [me, setMe] = useState(undefined); // users/{uid}
  const [roster, setRoster] = useState(undefined); // public/roster 요약 → [{ pid, name, loc, part }]
  const [avatars, setAvatars] = useState({}); // 화면에 나온 사람만 한 번씩 읽어 둔다 { pid: 번호 | null }
  const asked = useRef(new Map()); // pid → 마지막으로 읽은 시각
  const [tab, setTab] = useHashTab("mission");

  // 설정은 참여자·운영자만 읽는다. 연결 전 계정은 거부되고(LOCKED) "내 이름 연결" 화면을 본다.
  // 초대 코드로 연결되면(personId가 생기면) 다시 구독한다.
  const linkedPid = me?.personId || null;
  useEffect(() => watch(doc(db, "config", "app"),
    (s) => setConfig(s.exists() ? s.data() : null),
    (err) => setConfig(err?.code === "permission-denied" ? LOCKED : null)), [user, linkedPid, recheckNo]);

  // 연결 전 화면에서 다른 창에 갔다 오면(운영자에게 계정 번호를 알려 주고 돌아오면) 지정됐는지 다시 확인한다.
  useEffect(() => {
    if (config !== LOCKED) return undefined;
    const on = () => document.visibilityState === "visible" && setRecheckNo((n) => n + 1);
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, [config]);

  useEffect(() => {
    const offs = [
      // 내 users 문서는 서버 저장이 확인된 뒤에만 반영한다. 가입 직후 화면에 먼저 반영하면, 서버 규칙은 아직
      // "연결 전"으로 보고 내 배정·프로필 읽기를 거부해 "아직 배정 전이에요"로 굳는다(실제로 재현됨).
      watch(doc(db, "users", user.uid), (s) => {
        if (!s.metadata.hasPendingWrites) setMe(s.exists() ? s.data() : null);
      }, () => setMe(null), 3, { includeMetadataChanges: true }),
    ];
    return () => offs.forEach((off) => off());
  }, [user]);

  // 예전에 가입해서 users 문서에 메일이 없으면 채워 둔다(운영 화면 "연결된 메일"용).
  useEffect(() => {
    if (me && user.email && me.email !== user.email) updateDoc(doc(db, "users", user.uid), { email: user.email, ...bump() }).catch(() => {});
  }, [me, user]);

  // 최근 접속: 로그인(또는 새로고침)할 때 한 번 남긴다. 운영 화면에서 오래 안 들어온 사람을 챙기는 데 쓴다.
  const myPidForSeen = me?.personId || null;
  useEffect(() => {
    if (myPidForSeen) setDoc(doc(db, "progress", myPidForSeen), { lastSeen: serverTimestamp(), ...bump() }, { merge: true }).catch(() => {});
  }, [myPidForSeen]);

  // 내 대상(내가 마니또로서 챙길 사람). 대상이 보낸 한마디를 받으려고 읽는다. 다시 배정하면(회차) 다시 읽는다.
  const [myReceiver, setMyReceiver] = useState(null);
  const assignVer = config && config !== LOCKED ? config.assignVer ?? 0 : null;
  useEffect(() => {
    if (!myPidForSeen) return setMyReceiver(null);
    getDoc(doc(db, "assignments", myPidForSeen))
      .then((s) => setMyReceiver(s.exists() ? s.data().receiverPid : null))
      .catch(() => setMyReceiver(null));
  }, [myPidForSeen, assignVer]);

  // 마니또에게서 온 것(완료 알림·쪽지): 내 미션(인증 안 한 미션 알림), 추리 보드, 안 읽은 표시가 같이 쓴다(한 번만 읽기).
  const [inbox, setInbox] = useState([]);
  useEffect(() => {
    if (!myPidForSeen) return setInbox([]);
    return onSnapshot(query(collection(db, "deliveries"), where("receiverPid", "==", myPidForSeen)), (s) =>
      setInbox(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))), () => {});
  }, [myPidForSeen]);
  // 수호천사가 나에게 보낸 미션(마니또가 미션을 안 했을 때 운영진이 연결한 지원자)
  const [angelInbox, setAngelInbox] = useState([]);
  useEffect(() => {
    if (!myPidForSeen) return setAngelInbox([]);
    return onSnapshot(query(collection(db, "angelGifts"), where("receiverPid", "==", myPidForSeen)), (s) =>
      setAngelInbox(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.k - b.k)), () => setAngelInbox([]));
  }, [myPidForSeen]);
  // 내 대상이 나(마니또)에게 보낸 한마디
  const [fromReceiver, setFromReceiver] = useState([]);
  useEffect(() => {
    if (!myReceiver) return setFromReceiver([]);
    return onSnapshot(query(collection(db, "toManito"), where("receiverPid", "==", myReceiver)), (s) =>
      setFromReceiver(s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.slot - b.slot)), () => setFromReceiver([]));
  }, [myReceiver]);

  const [seen, setSeen] = useState(() => loadSeen(user.uid));
  const markSeen = useCallback((kind, ids) => {
    setSeen((prev) => {
      if (ids.every((id) => prev[kind].includes(id))) return prev;
      const next = { ...prev, [kind]: [...new Set([...prev[kind], ...ids])] };
      saveSeen(user.uid, next);
      return next;
    });
  }, [user.uid]);
  const unread = {
    detective: inbox.filter((d) => !seen.inbox.includes(d.id)).length + angelInbox.filter((g) => !seen.angel.includes(g.id)).length,
    mission: fromReceiver.filter((m) => !seen.manito.includes(m.id)).length,
  };
  const unreadTotal = unread.detective + unread.mission;
  // 그 탭을 열어 두면 본 것으로 친다(추리 보드 맨 위가 받은 쪽지, 내 미션에 대상의 한마디)
  useEffect(() => {
    if (tab === "detective" && inbox.length) markSeen("inbox", inbox.map((d) => d.id));
    if (tab === "detective" && angelInbox.length) markSeen("angel", angelInbox.map((g) => g.id));
    if ((tab === "mission" || !tab) && fromReceiver.length) markSeen("manito", fromReceiver.map((m) => m.id));
  }, [tab, inbox, angelInbox, fromReceiver, markSeen]);
  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) ${BASE_TITLE}` : BASE_TITLE;
    return () => { document.title = BASE_TITLE; };
  }, [unreadTotal]);

  // 명단은 초대 코드로 연결된 참여자와 운영자만 읽을 수 있다(보안 규칙). 연결되면 그때 구독한다.
  // 읽기 줄이기: 명단 54건 대신 요약 문서 1건 (운영 화면이 명단과 맞춰 둔다)
  const member = Boolean(me?.personId) || Boolean(config?.admins?.includes(user.uid));
  useEffect(() => {
    if (!member) {
      setRoster([]);
      return undefined;
    }
    setRoster(undefined);
    return watch(doc(db, "public", "roster"), (s) => setRoster(summaryToList(s.exists() ? s.data().people : {})), () => setRoster([]));
  }, [member]);

  // 읽기 줄이기: 캐릭터 선택은 전원 것을 구독하지 않고, 화면에 나온 사람 것만 읽어 둔다.
  // 읽어 둔 값은 AVATAR_TTL이 지나면 그 사람이 다시 화면에 나올 때 새로 읽는다
  // (다른 사람이 캐릭터를 바꾸면 최대 그만큼 늦게 보인다. 캐릭터는 보통 처음에 한 번 고른다).
  const loadAvatar = useCallback((pid) => {
    const now = Date.now();
    if (!pid || now - (asked.current.get(pid) ?? -Infinity) < AVATAR_TTL) return;
    asked.current.set(pid, now);
    getDoc(doc(db, "avatars", pid))
      .then((s) => setAvatars((p) => ({ ...p, [pid]: s.exists() ? s.data().avatar : null })))
      .catch(() => setAvatars((p) => ({ ...p, [pid]: null })));
  }, []);
  const setAvatarLocal = useCallback((pid, index) => {
    asked.current.set(pid, Date.now());
    setAvatars((p) => ({ ...p, [pid]: index }));
  }, []);

  const ctx = useMemo(() => {
    const list = roster || [];
    const byPid = Object.fromEntries(list.map((r) => [r.pid, r]));
    const myPid = me?.personId || null;
    return {
      user,
      config,
      me,
      myPid,
      myPart: (myPid && byPid[myPid]?.part) || null,
      roster: list,
      rosterReady: roster !== undefined,
      byPid,
      nameOf: (pid) => byPid[pid]?.name || "(알 수 없음)",
      avatarOf: (pid) => (avatars[pid] ?? defaultAvatar(pid)),
      avatarReady: (pid) => pid in avatars,
      loadAvatar,
      setAvatarLocal,
      isAdmin: Boolean(user && config?.admins?.includes(user.uid)),
      myReceiver,
      inbox,
      angelInbox,
      fromReceiver,
    };
  }, [user, config, me, roster, avatars, loadAvatar, setAvatarLocal, myReceiver, inbox, angelInbox, fromReceiver]);

  if (config === undefined || me === undefined || roster === undefined) return <Loading />;
  if (config === null) return <Login bootstrap />;
  if (config === LOCKED) {
    // 연결 전 계정: 초대 코드 연결, 또는 공동 운영자로 지정받을 계정 번호. 설정(공지·단계)은 읽을 수 없다.
    return (
      <AppCtx.Provider value={{ user, recheck: () => setRecheckNo((n) => n + 1) }}>
        <div className="app">
          <header className="hud">
            <Garland />
            <div className="hud-row">
              <span className="hud-logo"><span className="hud-logo-pre">S1FA </span><b>마니또</b></span>
              <button className="hud-out" onClick={logout}><span className="hud-out-label">로그아웃</span></button>
            </div>
          </header>
          <main><Claim /></main>
          <XmasFooter />
        </div>
      </AppCtx.Provider>
    );
  }

  const phase = config.phase;
  const tabs = [];
  if (ctx.myPid) {
    tabs.push(["mission", "내 미션"], ["detective", "추리 보드"], ["feed", "피드"], ["board", "파트 순위"]);
    tabs.push(["profile", "내 프로필"]);
  }
  if (ctx.myPid || ctx.isAdmin) tabs.push(["rules", "규칙"]);
  // 연결 전 계정(참여자도 운영자도 아님)에는 메뉴가 없다
  if ((phase >= PHASE.REVEAL && ctx.myPid) || ctx.isAdmin) tabs.push(["reveal", "결과"]);
  if (ctx.isAdmin) tabs.push(["admin", "운영"]);

  // 지금 로그인한 사람. 같은 기기를 여러 사람이 쓸 때 남의 계정으로 들어와 있는지 바로 알 수 있게 헤더에 보인다.
  // 운영자·공동 운영자는 참여하지 않는 계정이라 이름 대신 "운영자"로 보인다.
  const who = ctx.myPid ? `${ctx.nameOf(ctx.myPid)}님` : ctx.isAdmin ? "운영자" : "";
  const current = tabs.find(([k]) => k === tab)?.[0] || (ctx.isAdmin && !ctx.myPid ? "admin" : tabs[0]?.[0]);

  let body;
  if (!ctx.myPid && !ctx.isAdmin) body = <Claim />;
  else if (current === "mission") body = <MyMission />;
  else if (current === "detective") body = <Detective />;
  else if (current === "feed") body = <Feed />;
  else if (current === "board") body = <PartBoard />;
  else if (current === "profile") body = <Profile />;
  else if (current === "rules") body = <Rules />;
  else if (current === "reveal") body = <Reveal />;
  else if (current === "admin") body = <Admin />;

  return (
    <AppCtx.Provider value={ctx}>
      <div className="app">
        <header className="hud">
          <Garland />
          <div className="hud-row">
            <span className="hud-logo"><span className="hud-logo-pre">S1FA </span><b>마니또</b></span>
            <span className="hud-chip">{PHASES[phase]}{phase === PHASE.RUNNING ? ` ${config.week}주차` : ""}</span>
            <button className="hud-out" onClick={logout} title="다른 사람이 이 기기에서 로그인하려면 로그아웃하세요">
              {who && <span className="hud-who">{who}</span>}<span className="hud-out-label">로그아웃</span>
            </button>
          </div>
          {tabs.length > 0 && (
            <nav className="tabs" aria-label="메뉴">
              {tabs.map(([k, label]) => (
                <button key={k} className={k === current ? "tab is-on" : "tab"} aria-current={k === current ? "page" : undefined} onClick={() => setTab(k)}>
                  {label}
                  {unread[k] > 0 && <span className="tab-badge" aria-label={`새 소식 ${unread[k]}건`}>{unread[k]}</span>}
                </button>
              ))}
            </nav>
          )}
        </header>
        {config.notice && (ctx.myPid || ctx.isAdmin) && <p className="notice-banner" role="status"><b>공지</b>{config.notice}</p>}
        <main>{body}</main>
        <XmasFooter />
      </div>
    </AppCtx.Provider>
  );
}
