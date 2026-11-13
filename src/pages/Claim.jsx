import { useState } from "react";
import { claimWithInvite, authErrorMessage } from "../lib/account.js";
import { useApp } from "../App.jsx";
import { Panel } from "../ui.jsx";

// "연결 전" 화면: 가입(로그인)은 했지만 아직 명단에도 운영자 목록에도 없는 계정이 보는 화면.
//  - 참여자: 초대 코드를 입력해 명단의 내 이름과 연결한다.
//  - 운영자·공동 운영자가 될 계정: 초대 코드를 입력하지 않고, 아래 계정 번호를 운영자에게 알려 준다.
//    (운영자는 참여하지 않는 계정이라 명단에 연결할 수 없다. 보안 규칙이 막는다)
export default function Claim() {
  const { user } = useApp();
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");

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
      <Panel title="내 이름 연결" className="narrow">
        <p>운영진에게 받은 초대 코드를 입력하면 명단의 내 이름과 이 계정이 연결돼요.</p>
        <form onSubmit={submit} className="stack">
          <input className="pk-input" value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" placeholder="초대 코드 6자리" aria-label="초대 코드" />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="pk-btn main" disabled={busy}>연결하기</button>
        </form>
      </Panel>

      <Panel title="공동 운영자로 지정받을 계정이라면" className="narrow">
        <p className="small">
          운영자와 공동 운영자는 마니또에 참여하지 않는 계정이라 초대 코드를 입력하지 않아요.
          아래 <b>계정 번호</b>를 운영자에게 알려 주세요. 운영자가 지정하면 이 화면이 운영 화면으로 바뀌어요.
        </p>
        <div className="account-no" aria-label="계정 번호">
          <span>계정 번호</span>
          <strong className="mono">{user.uid}</strong>
        </div>
        <div className="inline">
          <button type="button" className="pk-btn sm" onClick={copy}>계정 번호 복사</button>
          {copied && <span className="note small" role="status">{copied}</span>}
        </div>
        <p className="small muted">로그인한 메일: {user.email}</p>
      </Panel>
    </>
  );
}
