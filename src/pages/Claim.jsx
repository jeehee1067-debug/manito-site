import { useState } from "react";
import { claimWithInvite, authErrorMessage } from "../lib/account.js";
import { Panel } from "../ui.jsx";

export default function Claim() {
  const [invite, setInvite] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  return (
    <Panel title="내 이름 연결" className="narrow">
      <p>운영진에게 받은 초대 코드를 입력하면 명단의 내 이름과 이 계정이 연결돼요.</p>
      <form onSubmit={submit} className="stack">
        <input className="pk-input" value={invite} onChange={(e) => setInvite(e.target.value)} autoComplete="off" placeholder="초대 코드 6자리" aria-label="초대 코드" />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="pk-btn main" disabled={busy}>연결하기</button>
      </form>
    </Panel>
  );
}
