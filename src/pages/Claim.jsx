import { useEffect, useState } from "react";
import { claimWithInvite, claimWithMail, sendVerifyMail, authErrorMessage } from "../lib/account.js";
import { useApp } from "../App.jsx";
import { Panel } from "../ui.jsx";

// "연결 전" 화면: 가입(로그인)은 했지만 아직 명단에도 운영자 목록에도 없는 계정이 보는 화면.
//  - 참여자: 회사 메일로 온 인증 메일의 링크를 누르면 명단의 내 이름과 연결된다(명단에 적힌 아이디와 같은 메일일 때).
//    메일이 오지 않으면 운영진에게 초대 코드를 받아 연결한다(예비).
//  - 운영자·공동 운영자가 될 계정: 초대 코드를 입력하지 않고, 아래 계정 번호를 운영자에게 알려 준다.
//    (운영자는 참여하지 않는 계정이라 명단에 연결할 수 없다. 보안 규칙이 막는다)
export default function Claim() {
  const { user, recheck } = useApp();
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [mailBusy, setMailBusy] = useState(false);
  const [mailMsg, setMailMsg] = useState({ type: "", text: "" });

  // 메일의 링크를 누르고 돌아오면(창을 다시 보면) 스스로 확인해 연결한다. 아직이면 조용히 둔다.
  useEffect(() => {
    let alive = true;
    const check = () => { if (document.visibilityState === "visible") claimWithMail({ quiet: true }).catch(() => {}); };
    check();
    const on = () => alive && check();
    document.addEventListener("visibilitychange", on);
    window.addEventListener("focus", on);
    return () => { alive = false; document.removeEventListener("visibilitychange", on); window.removeEventListener("focus", on); };
  }, []);

  async function confirmMail() {
    setMailBusy(true);
    setMailMsg({ type: "", text: "" });
    try {
      await claimWithMail();
    } catch (err) {
      setMailMsg({ type: "error", text: authErrorMessage(err) });
    } finally {
      setMailBusy(false);
    }
  }
  async function resend() {
    setMailBusy(true);
    setMailMsg({ type: "", text: "" });
    try {
      await sendVerifyMail();
      setMailMsg({ type: "ok", text: `${user.email}로 인증 메일을 다시 보냈어요. 메일함(스팸함 포함)을 확인해 주세요.` });
    } catch (err) {
      setMailMsg({ type: "error", text: err?.code?.includes("too-many-requests") ? "조금 전에 보냈어요. 잠시 뒤 다시 눌러 주세요." : authErrorMessage(err) });
    } finally {
      setMailBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await claimWithInvite(invite);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(user.uid);
      setCopied("복사했어요.");
    } catch {
      setCopied("복사하지 못했어요. 위 글자를 길게 눌러 직접 복사해 주세요.");
    }
  }

  return (
    <>
      <Panel title="회사 메일 인증" className="narrow">
        <p>
          <b>{user.email}</b>로 인증 메일을 보냈어요. 메일에 있는 링크를 누른 뒤 아래 버튼을 눌러 주세요.
          명단의 내 이름과 이 계정이 자동으로 연결돼요.
        </p>
        <div className="stack">
          {mailMsg.text && <p className={mailMsg.type === "error" ? "error" : "note"} role={mailMsg.type === "error" ? "alert" : "status"}>{mailMsg.text}</p>}
          <button type="button" className="pk-btn main" disabled={mailBusy} onClick={confirmMail}>인증했어요 · 연결하기</button>
          <button type="button" className="pk-btn sm" disabled={mailBusy} onClick={resend}>인증 메일 다시 보내기</button>
        </div>
        <p className="small muted">
          메일이 안 보이면 스팸함도 확인해 주세요(보낸 사람 주소에 firebaseapp.com이 들어 있어요).
          아이디를 잘못 적었다면 로그아웃하고 맞는 아이디로 다시 가입해 주세요.
        </p>
      </Panel>

      <Panel title="메일이 오지 않으면: 초대 코드로 연결" className="narrow">
        <p className="small">인증 메일이 오지 않거나 링크가 열리지 않으면 운영진에게 초대 코드를 받아 입력해 주세요. 명단의 내 이름과 이 계정이 연결돼요.</p>
        <form onSubmit={submit} className="stack">
          <input className="pk-input" value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" placeholder="초대 코드 6자리" aria-label="초대 코드" />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="pk-btn main" disabled={busy}>연결하기</button>
        </form>
      </Panel>

      <Panel title="공동 운영자로 지정받을 계정이라면" className="narrow">
        <p className="small">
          운영자와 공동 운영자는 마니또에 참여하지 않는 계정이라 초대 코드를 입력하지 않아요.
          아래 <b>계정 번호</b>를 운영자에게 직접 보여 주세요. 운영자가 지정한 뒤 "지정됐는지 다시 확인"을 누르면 운영 화면으로 바뀌어요.
        </p>
        <div className="account-no" aria-label="계정 번호">
          <span>계정 번호</span>
          <strong className="mono">{user.uid}</strong>
        </div>
        <div className="inline">
          <button type="button" className="pk-btn sm" onClick={copy}>계정 번호 복사</button>
          {recheck && <button type="button" className="pk-btn sm" onClick={recheck}>지정됐는지 다시 확인</button>}
          {copied && <span className="note small" role="status">{copied}</span>}
        </div>
        <p className="small muted">로그인한 메일: {user.email}</p>
      </Panel>
    </>
  );
}
