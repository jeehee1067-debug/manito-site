import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";
import { login, signup, claimWithInvite, resetPassword, validateEmail, authErrorMessage } from "../lib/account.js";
import { Garland, Gifts, XMAS_LEADERS, XmasTree } from "../xmas.jsx";

// 첫 운영자 설정 버튼은 주소 끝에 ?setup을 붙였을 때만 보인다(운영자 설정이 끝난 뒤에는 숨김).
// 이미 운영자가 있으면 config 생성이 보안 규칙에 막혀서, 이 주소로 들어와도 운영자가 될 수 없다.
const SHOW_SETUP = new URLSearchParams(window.location.search).has("setup");

// mode: login 로그인 / signup 처음 가입 / reset 비밀번호 찾기 / bootstrap 첫 운영자 설정
export default function Login({ bootstrap = false }) {
  const [mode, setMode] = useState(bootstrap ? "bootstrap" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function go(next) {
    setError("");
    setNotice("");
    setMode(next);
  }

  async function submit(e) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email, password, keep);
      } else if (mode === "signup") {
        if (!invite.trim()) throw new Error("운영진에게 받은 초대 코드를 입력해 주세요.");
        const bad = validateEmail(email);
        if (bad) throw new Error(bad);
        await signup(email, password, keep);
        await claimWithInvite(invite);
      } else if (mode === "reset") {
        const bad = validateEmail(email);
        if (bad) throw new Error(bad);
        await resetPassword(email);
        setNotice("가입된 메일이면 비밀번호 재설정 메일을 보냈어요. 메일의 링크에서 새 비밀번호를 정한 뒤 여기서 로그인해 주세요. 메일이 안 보이면 스팸함도 확인해 주세요.");
      } else if (mode === "bootstrap") {
        if (!auth.currentUser) {
          const bad = validateEmail(email);
          if (bad) throw new Error(bad);
          await signup(email, password, keep);
        }
        await setDoc(doc(db, "config", "app"), { admins: [auth.currentUser.uid], phase: 0, week: 1, cluesReleased: 0 });
      }
    } catch (err) {
      setError(mode === "reset" && err?.code?.includes("user-not-found") ? "이 메일로 가입된 계정이 없어요. 주소를 다시 확인해 주세요." : authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const signedIn = Boolean(auth.currentUser);
  const needsPassword = mode !== "reset" && !(mode === "bootstrap" && signedIn);
  const tabMode = mode === "login" || mode === "signup";

  return (
    <main className="app narrow login">
      <Garland />
      <div className="logo-plate">
        <div className="logo-sub">SAMSUNG · 분석기술팀</div>
        <h1 className="logo-title">S1FA 마니또</h1>
        <div className="logo-tag">4주 동안 몰래 챙기고, 송년회에서 정체를 밝혀라!</div>
        <div><span className="logo-xmas">MERRY CHRISTMAS &amp; HAPPY NEW YEAR</span></div>
      </div>
      <div className="lineup" aria-hidden="true">
        <XmasTree />
        {XMAS_LEADERS.map((src, i) => <img key={i} className="leader" src={src} alt="" />)}
        <Gifts />
      </div>

      <section className="panel">
        {tabMode ? (
          <div className="chip-row" role="tablist">
            <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "chip is-on" : "chip"} onClick={() => go("login")}>로그인</button>
            <button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "chip is-on" : "chip"} onClick={() => go("signup")}>처음 가입</button>
          </div>
        ) : (
          <h2 className="panel-title">{mode === "reset" ? "비밀번호 찾기" : "운영자 설정"}</h2>
        )}
        {mode === "bootstrap" && <p className="note">처음 한 번만 하는 설정이에요. 이 계정이 운영자가 됩니다.</p>}
        {mode === "reset" && <p className="small">가입할 때 쓴 메일 주소를 적으면 비밀번호를 다시 정하는 링크를 보내 드려요.</p>}

        <form onSubmit={submit} className="stack">
          {mode === "signup" && (
            <label>
              <span className="panel-label">초대 코드</span>
              <input className="pk-input" value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" placeholder="운영진에게 받은 6자리" />
            </label>
          )}
          {!(mode === "bootstrap" && signedIn) && (
            <label>
              <span className="panel-label">메일 주소</span>
              <input className="pk-input" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="username" placeholder="자주 확인하는 메일 주소" />
            </label>
          )}
          {needsPassword && (
            <label>
              <span className="panel-label">비밀번호</span>
              <input className="pk-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="6자 이상" />
            </label>
          )}
          {needsPassword && (
            <label className="check">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              이 기기에서 로그인 유지 (여러 사람이 같이 쓰는 기기면 해제)
            </label>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          {notice && <p className="note" role="status">{notice}</p>}
          <button className="pk-btn main" disabled={busy}>
            {{ login: "로그인", signup: "가입하고 내 이름 연결", reset: "재설정 메일 보내기", bootstrap: "운영자로 시작하기" }[mode]}
          </button>
        </form>

        <div className="login-links">
          {mode === "login" && (
            <button type="button" className="text-btn" onClick={() => go("reset")}>비밀번호를 잊었어요</button>
          )}
          {/* 로그인 전에는 config를 읽을 수 없어(보안 규칙) 첫 운영자인지 알 수 없다. 첫 운영자는 여기서 들어간다.
              이미 운영자가 있으면 config 생성이 규칙에 막히고, 만들어진 계정은 초대 코드 연결 화면으로 간다. */}
          {!bootstrap && tabMode && SHOW_SETUP && (
            <button type="button" className="text-btn" onClick={() => go("bootstrap")}>처음 설정하는 운영자인가요?</button>
          )}
          {!bootstrap && !tabMode && (
            <button type="button" className="text-btn" onClick={() => go("login")}>로그인으로 돌아가기</button>
          )}
        </div>
      </section>
      {mode === "signup" && (
        <p className="login-note">비밀번호를 잊으면 로그인 화면의 '비밀번호를 잊었어요'로<br />이 메일에서 다시 정할 수 있어요.</p>
      )}
    </main>
  );
}
