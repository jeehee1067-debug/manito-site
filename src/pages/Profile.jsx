import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import { AVATARS, PROFILE_QUESTIONS } from "../lib/constants.js";
import { syncClues } from "../lib/sync.js";
import { Panel, avatarSrc } from "../ui.jsx";

export default function Profile() {
  const { myPid, nameOf, avatarOf, user, loadAvatar, setAvatarLocal } = useApp();
  const [answers, setAnswers] = useState(PROFILE_QUESTIONS.map(() => ""));
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getDoc(doc(db, "profiles", myPid)).then((s) => {
      if (s.exists()) setAnswers(PROFILE_QUESTIONS.map((_, i) => s.data().answers?.[i] || ""));
      setLoaded(true);
    });
  }, [myPid]);

  useEffect(() => loadAvatar(myPid), [myPid, loadAvatar]);
  const pickAvatar = (i) => setDoc(doc(db, "avatars", myPid), { avatar: i }).then(() => setAvatarLocal(myPid, i));

  async function save(e) {
    e.preventDefault();
    if (answers.some((a) => !a.trim())) {
      setStatus("6개 모두 답해 주세요. 짧아도 괜찮아요.");
      return;
    }
    setStatus("저장하는 중");
    await setDoc(doc(db, "profiles", myPid), { answers: answers.map((a) => a.trim()), updatedAt: serverTimestamp() });
    await setDoc(doc(db, "progress", myPid), { profileDone: true, cluesSynced: false }, { merge: true });
    const synced = await syncClues(myPid);
    setStatus(synced ? "저장했어요. 내 대상에게 갈 단서도 준비됐어요." : "저장했어요. 마니또 배정이 끝나면 단서가 자동으로 준비돼요.");
  }

  if (!loaded) return null;

  return (
    <>
      <Panel title="내 계정">
        <p>로그인한 메일: <strong>{user.email}</strong></p>
        <p className="small">비밀번호를 잊으면 로그인 화면의 '비밀번호를 잊었어요'로 이 주소에서 다시 정할 수 있어요. 주소가 틀렸다면 운영진에게 알려 주세요.</p>
      </Panel>

      <Panel title="내 캐릭터">
        <p className="small">결과 발표와 용의자 보드에 이 캐릭터로 나와요.</p>
        <div className="avatar-picker">
          {AVATARS.map((_, i) => (
            <button key={i} className={avatarOf(myPid) === i ? "avatar-cell is-on" : "avatar-cell"} aria-pressed={avatarOf(myPid) === i} onClick={() => pickAvatar(i)}>
              <img src={avatarSrc(i)} alt={`캐릭터 ${i + 1}`} />
            </button>
          ))}
        </div>
      </Panel>

      <Panel title={`${nameOf(myPid)}님의 프로필`}>
        <p className="small">
          여기 답한 내용은 내가 마니또로 맡은 사람에게 매주 금요일 2개씩 단서로 공개돼요. 그 사람이 나를 추리할 때 쓰는 단서예요.
          이름, 파트, 직급처럼 바로 알 수 있는 답은 피해 주세요.
        </p>
        <form onSubmit={save} className="stack">
          {PROFILE_QUESTIONS.map((q, i) => (
            <label key={i}>
              <span className="panel-label">{i + 1}. {q}</span>
              <input className="pk-input" value={answers[i]} maxLength={60}
                onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} />
            </label>
          ))}
          {status && <p className="note" role="status">{status}</p>}
          <button className="pk-btn main">저장</button>
        </form>
      </Panel>
    </>
  );
}
