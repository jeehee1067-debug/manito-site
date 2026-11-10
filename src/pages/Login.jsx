import { useState } from "react";
import { doc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";
import { login, signup, claimWithInvite, validateLoginId, authErrorMessage } from "../lib/account.js";
import { AVATARS } from "../lib/constants.js";
import { avatarSrc } from "../ui.jsx";
import { Garland, Gifts, XmasTree } from "../xmas.jsx";

export default function Login({ bootstrap = false }) {
  const [mode, setMode] = useState(bootstrap ? "bootstrap" : "login");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      if (mode === "login") {
        await login(loginId, password);
      } else if (mode === "signup") {
        const bad = validateLoginId(loginId);
        if (bad) throw new Error(bad);
        if (!invite.trim()) throw new Error("운영진에게 받은 초대 코드를 입력해 주세요.");
        await signup(loginId, password);
        await claimWithInvite(invite);
      } else if (mode === "bootstrap") {
        if (!auth.currentUser) {
          const bad = validateLoginId(loginId);
          if (bad) throw new Error(bad);
          await signup(loginId, password);
        }
        await setDoc(doc(db, "config", "app"), { admins: [auth.currentUser.uid], phase: 0, week: 1, cluesReleased: 0 });
      }
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const signedIn = Boolean(auth.currentUser);

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
        <XmasTree scale={5} />
        {AVATARS.map((_, i) => <img key={i} src={avatarSrc(i)} alt="" />)}
        <Gifts scale={3} />
      </div>

      <section className="panel">
        {mode === "bootstrap" ? (
          <h2 className="panel-title">운영자 설정</h2>
        ) : (
          <div className="chip-row" role="tablist">
            <button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "chip is-on" : "chip"} onClick={() => setMode("login")}>로그인</button>
            <button role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "chip is-on" : "chip"} onClick={() => setMode("signup")}>처음 가입</button>
          </div>
        )}
        {mode === "bootstrap" && <p className="note">처음 한 번만 하는 설정이에요. 이 계정이 운영자가 됩니다.</p>}

        <form onSubmit={submit} className="stack">
          {mode === "signup" && (
            <label>
              <span className="panel-label">초대 코드</span>
              <input className="pk-input" value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" placeholder="운영진에게 받은 6자리" />
            </label>
          )}
          {!(mode === "bootstrap" && signedIn) && (
            <>
              <label>
                <span className="panel-label">아이디</span>
                <input className="pk-input" value={loginId} onChange={(e) => setLoginId(e.target.value)} autoComplete="username" placeholder="영문·숫자 3~20자" />
              </label>
              <label>
                <span className="panel-label">비밀번호</span>
                <input className="pk-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder="6자 이상" />
              </label>
            </>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="pk-btn main" disabled={busy}>
            {mode === "login" ? "로그인" : mode === "signup" ? "가입하고 내 이름 연결" : "운영자로 시작하기"}
          </button>
        </form>
        {/* 로그인 전에는 config를 읽을 수 없어(보안 규칙) 첫 운영자인지 알 수 없다. 첫 운영자는 여기서 들어간다.
            이미 운영자가 있으면 config 생성이 규칙에 막히고, 만들어진 계정은 초대 코드 연결 화면으로 간다. */}
        {!bootstrap && mode !== "bootstrap" && (
          <button type="button" className="text-btn" onClick={() => { setError(""); setMode("bootstrap"); }}>처음 설정하는 운영자인가요?</button>
        )}
        {!bootstrap && mode === "bootstrap" && (
          <button type="button" className="text-btn" onClick={() => { setError(""); setMode("login"); }}>로그인으로 돌아가기</button>
        )}
      </section>
      {mode === "signup" && <p className="login-note">비밀번호는 본인만 알아요. 운영진도 볼 수 없으니 잊지 않게 정해 주세요.</p>}
    </main>
  );
}
