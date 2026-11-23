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
import Admin, { AutoRunner } from "./pages/Admin.jsx";
import { FeedDigestWriter } from "./lib/feedDigest.js";
import Rules from "./pages/Rules.jsx";
import { Garland, XmasFooter } from "./xmas.jsx";
import { Icon, TAB_ICON } from "./icons.jsx";
import { Giver, Panel } from "./ui.jsx";
import { myReminders } from "./lib/reminders.js";

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

// 캐릭터 번호는 참여자 누구나 읽는 값(비밀 아님)이라 이 기기에 기억해 두고 AVATAR_TTL 동안 다시 읽지 않는다.
// 추리 보드는 열 때마다 후보(54명이면 약 45명)의 캐릭터를 읽어서, 휴대폰으로 사이트를 새로 열 때마다 그만큼 읽기가 들었다.
// 다른 사람이 캐릭터를 바꾸면 최대 AVATAR_TTL만큼 늦게 보인다(캐릭터는 보통 처음에 한 번 고른다). 내 캐릭터는 바로 바뀐다.
const AVATAR_TTL = 6 * 60 * 60 * 1000;
const AVATAR_STORE = "manito:avatars"; // { pid: [번호 | null, 읽은 시각 ms] }
function loadAvatarStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(AVATAR_STORE) || "{}");
    const now = Date.now();
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => Array.isArray(v) && now - v[1] < AVATAR_TTL));
  } catch {
    return {};
  }
}
function saveAvatarStore(pid, value, at) {
  try {
    const cur = loadAvatarStore();
    cur[pid] = [value, at];
    localStorage.setItem(AVATAR_STORE, JSON.stringify(cur));
  } catch {
    // 저장소를 못 쓰는 기기(사생활 보호 모드 등)는 기억하지 않고 매번 읽는다
  }
}
// 설정(config/app)을 읽을 수 없는 계정: 아직 명단에도 운영자 목록에도 없는 "연결 전" 계정(보안 규칙).
// 재촉 알림(사용자가 정함: "미션을 안 했거나 받은 미션을 인증 안 한 경우 재촉하는 알림"). 서버가 없어 휴대폰 알림은 못 보내고,
// 사이트를 열면 어느 탭에서나 맨 위에 뜬다(lib/reminders.js myReminders). 지금 보고 있는 탭이 그 일을 하는 탭이면 그 줄은 숨긴다
// (내 미션 탭에는 "이번 주 할 일", 추리 보드에는 인증 칸이 이미 있다). "닫기"는 이번에 연 동안만 숨긴다.
// 내 인증·내 미션 문서는 내 미션·추리 보드 탭과 같은 질의라 Firestore가 하나로 묶어 읽는다(읽기가 늘지 않음).
function ReminderBar({ myPid, config, inbox, current, go }) {
  const [mine, setMine] = useState(null);
  const [missions, setMissions] = useState(null);
  const [closed, setClosed] = useState(false);
  useEffect(() => onSnapshot(query(collection(db, "redemptions"), where("receiverPid", "==", myPid)),
    (s) => setMine(s.docs.map((d) => d.data())), () => setMine(null)), [myPid]);
  useEffect(() => onSnapshot(doc(db, "giverMissions", myPid),
    (s) => setMissions(s.exists() ? s.data() : {}), () => setMissions(null)), [myPid]);
  const { toVerify, toDo } = myReminders({ inbox, mine, missions, week: config.week || 1, phase: config.phase });
  const showDo = toDo.length > 0 && current !== "mission";
  const showVerify = toVerify.length > 0 && current !== "detective";
  if (closed || (!showDo && !showVerify)) return null;
  const weeks = (list) => list.map((s) => `${s}주차`).join("·");
  return (
    <div className="reminder-bar" role="status">
      <b className="reminder-label">할 일</b>
      <div className="reminder-lines">
        {showDo && (
          <p>
            <b>{weeks(toDo)} 미션</b>을 아직 완료하지 않았어요(나는 <Giver>마니또</Giver>).{" "}
            <button type="button" className="text-btn" onClick={() => go("mission")}>내 미션으로 가기</button>
          </p>
        )}
        {showVerify && (
          <p>
            <Giver>내 마니또</Giver>가 보낸 <b>{weeks(toVerify)} 미션</b>을 아직 인증하지 않았어요. 인증해야 나와 마니또 모두 응모권이 쌓여요.{" "}
            <button type="button" className="text-btn" onClick={() => go("detective")}>추리 보드에서 인증하기</button>
          </p>
        )}
      </div>
      <button type="button" className="text-btn small reminder-close" onClick={() => setClosed(true)} aria-label="할 일 알림 닫기">닫기</button>
    </div>
  );
}

const LOCKED = "locked";
// 설정을 읽지 못함(권한 거부가 아닌 오류). 가장 흔한 것은 무료 한도(하루 읽기 5만 건, 한국 시간 오후 5시쯤 초기화) 초과: resource-exhausted.
// 예전에는 이것도 "설정 없음"(null)으로 처리해서, 한도가 차면 모두에게 "운영자 계정 만들기(처음 한 번만 하는 설정)" 화면이 떴다.
const FAILED = "failed";

function LoadFailed({ code, retry, logout }) {
  const quota = code === "resource-exhausted";
  return (
    <div className="app">
      <header className="hud">
        <Garland />
        <div className="hud-row">
          <span className="hud-logo"><span className="hud-logo-pre">S1FA </span><b>마니또</b></span>
          <button className="hud-out" onClick={logout}><span className="hud-out-label">로그아웃</span></button>
        </div>
      </header>
      <main>
        <Panel title={quota ? "오늘은 여기까지 불러올 수 있어요" : "데이터를 불러오지 못했어요"}>
          {quota ? (
            <p>사이트가 하루에 불러올 수 있는 양(무료 한도)을 오늘 다 썼어요. <b>한국 시간 오후 5시쯤</b> 다시 풀리니 그때 다시 열어 주세요. 지금까지 보낸 미션·쪽지·인증 기록은 지워지지 않아요.</p>
          ) : (
            <p>잠시 뒤 다시 시도해 주세요({code || "알 수 없는 오류"}). 회사 PC에서 계속 안 되면 주소 끝에 <code>?longpoll</code>을 붙여 한 번 열어 보세요.</p>
          )}
          <button className="pk-btn main" onClick={retry}>다시 시도</button>
        </Panel>
      </main>
      <XmasFooter />
    </div>
  );
}

// 탭 → 화면. 화면은 active(지금 보이는지)를 받는다: 숨겨 둔 동안 놓친 값(다른 탭에서 바꾼 것)을 다시 보일 때 읽는 데 쓴다.
const REMOUNT = new Set(["feed", "reveal"]); // 숨겨 두지 않고 열 때마다 새로 만드는 탭
const PAGES = { mission: MyMission, detective: Detective, feed: Feed, board: PartBoard, profile: Profile, rules: Rules, reveal: Reveal, admin: Admin };

function Session({ user, logout }) {
  const [config, setConfig] = useState(undefined); // undefined 불러오는 중, null 설정 없음(첫 운영자 설정), LOCKED 연결 전 계정, FAILED 읽기 실패
  const [failCode, setFailCode] = useState("");
  const [recheckNo, setRecheckNo] = useState(0); // 공동 운영자로 지정됐는지 다시 확인할 때 올린다
  const [me, setMe] = useState(undefined); // users/{uid}
  // public/roster 요약. member = 이 값을 읽기 시작할 때의 "명단을 읽을 수 있는 계정인지"(아래 roster 설명)
  const [rosterState, setRosterState] = useState({ member: null, list: undefined });
  // 화면에 나온 사람만 한 번씩 읽어 둔다 { pid: 번호 | null }. 이 기기에 기억해 둔 것(AVATAR_TTL 안)부터 쓴다.
  const [avatarStore] = useState(loadAvatarStore);
  const [avatars, setAvatars] = useState(() => Object.fromEntries(Object.entries(avatarStore).map(([pid, v]) => [pid, v[0]])));
  const asked = useRef(new Map(Object.entries(avatarStore).map(([pid, v]) => [pid, v[1]]))); // pid → 마지막으로 읽은 시각
  const [tab, setTab] = useHashTab("mission");
  // 한 번 연 탭(읽기 줄이기: 아래 PAGES 설명)
  const visited = useRef(new Set());

  // 설정은 참여자·운영자만 읽는다. 연결 전 계정은 거부되고(LOCKED) "내 이름 연결" 화면을 본다.
  // 초대 코드로 연결되면(personId가 생기면) 다시 구독한다.
  const linkedPid = me?.personId || null;
  useEffect(() => watch(doc(db, "config", "app"),
    (s) => setConfig(s.exists() ? s.data() : null),
    (err) => {
      if (err?.code === "permission-denied") return setConfig(LOCKED);
      setFailCode(err?.code || "");
      setConfig(FAILED);
    }), [user, linkedPid, recheckNo]);

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
  const assignVer = config && config !== LOCKED && config !== FAILED ? config.assignVer ?? 0 : null;
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
      setRosterState({ member: false, list: [] });
      return undefined;
    }
    return watch(doc(db, "public", "roster"),
      (s) => setRosterState({ member: true, list: summaryToList(s.exists() ? s.data().people : {}) }),
      () => setRosterState({ member: true, list: [] }));
  }, [member]);
  // 명단을 읽을 수 있게 된 직후(설정·내 users 문서가 막 도착한 렌더)에는 예전 값(빈 명단)으로 화면을 그리지 않고 기다린다.
  // 예전에는 그 한 번의 렌더에 화면이 열려 구독을 모두 연 뒤, 곧바로 "불러오는 중"으로 바뀌며 구독을 닫고 다시 열어
  // 처음부터 다시 읽었다(11/20 측정: 운영 화면은 열 때마다 모든 컬렉션을 두 번, 참여자는 불러오는 순서에 따라 내 미션 탭을 두 번).
  const roster = rosterState.member === member ? rosterState.list : undefined;

  // 읽기 줄이기: 캐릭터 선택은 전원 것을 구독하지 않고, 화면에 나온 사람 것만 읽어 둔다.
  // 읽어 둔 값은 AVATAR_TTL이 지나면 그 사람이 다시 화면에 나올 때 새로 읽는다
  // (다른 사람이 캐릭터를 바꾸면 최대 그만큼 늦게 보인다. 캐릭터는 보통 처음에 한 번 고른다).
  // force: 기억해 둔 값이 있어도 새로 읽는다(내 프로필의 내 캐릭터 — 다른 기기에서 바꿨을 수 있어서)
  const loadAvatar = useCallback((pid, force = false) => {
    const now = Date.now();
    if (!pid || (!force && now - (asked.current.get(pid) ?? -Infinity) < AVATAR_TTL)) return;
    asked.current.set(pid, now);
    getDoc(doc(db, "avatars", pid))
      .then((s) => {
        const v = s.exists() ? s.data().avatar : null;
        setAvatars((p) => ({ ...p, [pid]: v }));
        saveAvatarStore(pid, v, now);
      })
      .catch(() => setAvatars((p) => ({ ...p, [pid]: null })));
  }, []);
  const setAvatarLocal = useCallback((pid, index) => {
    const now = Date.now();
    asked.current.set(pid, now);
    setAvatars((p) => ({ ...p, [pid]: index }));
    saveAvatarStore(pid, index, now);
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

  if (config === FAILED) return <LoadFailed code={failCode} retry={() => { setConfig(undefined); setRecheckNo((n) => n + 1); }} logout={logout} />;
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
  // 운영자·공동 운영자(참여하지 않는 계정)도 익명 피드와 "공감 많은 후기"를 본다(사용자가 정함: "나도 볼 수 있게"). 보기만 하고 공감은 못 누른다.
  if (ctx.isAdmin && !ctx.myPid) tabs.push(["feed", "피드"]);
  // 연결 전 계정(참여자도 운영자도 아님)에는 메뉴가 없다
  if ((phase >= PHASE.REVEAL && ctx.myPid) || ctx.isAdmin) tabs.push(["reveal", "결과"]);
  if (ctx.isAdmin) tabs.push(["admin", "운영"]);

  // 지금 로그인한 사람. 같은 기기를 여러 사람이 쓸 때 남의 계정으로 들어와 있는지 바로 알 수 있게 헤더에 보인다.
  // 운영자·공동 운영자는 참여하지 않는 계정이라 이름 대신 "운영자"로 보인다.
  const who = ctx.myPid ? `${ctx.nameOf(ctx.myPid)}님` : ctx.isAdmin ? "운영자" : "";
  const current = tabs.find(([k]) => k === tab)?.[0] || (ctx.isAdmin && !ctx.myPid ? "admin" : tabs[0]?.[0]);

  let body;
  if (!ctx.myPid && !ctx.isAdmin) body = <Claim />;
  else {
    // 읽기 줄이기(11/18 실측: 하루 읽기가 무료 한도 5만 건에 거의 닿음): 예전에는 탭을 옮길 때마다 그 화면을 새로 만들어서
    // 구독을 모두 닫았다가 다시 열었고, 그때마다 서버에서 처음부터 다시 읽었다(내 미션 약 27건, 운영 탭은 54명 기준 약 1,500건).
    // 이제 한 번 연 탭은 닫지 않고 숨겨 둔다. 구독은 열린 채로 남아 바뀐 문서만 새로 읽는다.
    // 피드는 들어올 때마다 최근 글을 새로 불러오고(30건, 방금 쓴 답장·공감이 바로 보이게), 결과 탭은 발표 화면이 실제 크기를 재서 그리므로
    // 이 둘은 예전처럼 열 때마다 새로 만든다.
    if (current) visited.current.add(current);
    body = tabs
      .filter(([k]) => k === current || (!REMOUNT.has(k) && visited.current.has(k)))
      .map(([k]) => {
        const Page = PAGES[k];
        return <div key={k} className="tab-page" hidden={k !== current}><Page active={k === current} /></div>;
      });
  }

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
                  <Icon name={TAB_ICON[k]} size={20} className="tab-icon" />
                  <span className="tab-label">{label}</span>
                  {unread[k] > 0 && <span className="tab-badge" aria-label={`새 소식 ${unread[k]}건`}>{unread[k]}</span>}
                </button>
              ))}
            </nav>
          )}
        </header>
        {config.notice && (ctx.myPid || ctx.isAdmin) && <p className="notice-banner" role="status"><b>공지</b>{config.notice}</p>}
        {ctx.myPid && <ReminderBar myPid={ctx.myPid} config={config} inbox={inbox} current={current} go={setTab} />}
        {/* 예약(자동 진행) 실행기: 운영자·공동 운영자의 화면이 열려 있는 동안 예약 시각이 지난 작업을 실행한다 */}
        {ctx.isAdmin && <AutoRunner />}
        {ctx.isAdmin && <FeedDigestWriter />}
        <main>{body}</main>
        <XmasFooter />
      </div>
    </AppCtx.Provider>
  );
}
