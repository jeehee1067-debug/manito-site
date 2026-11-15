import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import { AVATARS, PROFILE_QUESTIONS, clueScheduleText, profileAnswerError } from "../lib/constants.js";
import { syncClues } from "../lib/sync.js";
import { bump } from "../lib/writes.js";
import { Panel, avatarSrc } from "../ui.jsx";

export default function Profile() {
  const { myPid, nameOf, avatarOf, user, loadAvatar, setAvatarLocal, config } = useApp();
  const [answers, setAnswers] = useState(PROFILE_QUESTIONS.map(() => ""));
  const [saved, setSaved] = useState(PROFILE_QUESTIONS.map(() => "")); // 저장돼 있는 답(잠금 판단용)
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getDoc(doc(db, "profiles", myPid)).then((s) => {
      if (s.exists()) {
        const a = PROFILE_QUESTIONS.map((_, i) => s.data().answers?.[i] || "");
        setAnswers(a);
        setSaved(a);
      }
      setLoaded(true);
    });
  }, [myPid]);

  useEffect(() => loadAvatar(myPid), [myPid, loadAvatar]);
  const pickAvatar = (i) => setDoc(doc(db, "avatars", myPid), { avatar: i, ...bump() }, { merge: true }).then(() => setAvatarLocal(myPid, i));

  // 이미 공개된 단서 칸은 바꿀 수 없다(대상이 본 단서가 나중에 바뀌지 않게). 비어 있던 칸은 늦게라도 쓸 수 있다.
  // 보안 규칙도 같은 기준으로 막는다(공개된 칸은 같은 답으로만 다시 쓸 수 있음).
  const released = config.cluesReleased || 0;
  const locked = (i) => i < released && saved[i].trim() !== "";

  async function save(e) {
    e.preventDefault();
    const next = answers.map((a, i) => (locked(i) ? saved[i] : a).trim());
    const bad = next.map((a, i) => (locked(i) ? null : profileAnswerError(i, a))).find(Boolean);
    if (bad) {
      setStatus(`6개 모두 답해 주세요. ${bad}`);
      return;
    }
    setStatus("저장하는 중");
    try {
      await setDoc(doc(db, "profiles", myPid), { answers: next, updatedAt: serverTimestamp(), ...bump() }, { merge: true });
      setSaved(next);
      await setDoc(doc(db, "progress", myPid), { profileDone: true, ...bump() }, { merge: true });
      const synced = await syncClues(myPid, config.assignVer ?? 0);
      setStatus(synced ? "저장했어요. 내 대상에게 갈 단서도 준비됐어요." : "저장했어요. 마니또 배정이 끝나면 단서가 자동으로 준비돼요.");
    } catch {
      setStatus("저장하지 못했어요. 잠시 후 다시 눌러 주세요.");
    }
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
          여기 답한 내용은 내가 마니또로 맡은 사람에게 매주 금요일 2개씩({clueScheduleText()}) 단서로 공개돼요. 그 사람이 나를 추리할 때 쓰는 단서예요.
          사실대로 답해 주세요. 직접 쓰는 칸에는 이름·직급처럼 바로 알 수 있는 말은 피해 주세요.
          프로필을 다 채워야(단서 6개가 대상에게 가야) 끝까지 안 들켰을 때 은신 응모권을 받아요. 운영진은 단서가 사실인지 확인할 수 있어요.
          {released > 0 && " 이미 공개된 단서는 바꿀 수 없어요."}
        </p>
        <form onSubmit={save} className="stack">
          {PROFILE_QUESTIONS.map(({ q, options, min, hint }, i) => (
            <div key={i} className="profile-q">
              <span className="panel-label" id={`pq-${i}`}>{i + 1}. {q}{locked(i) && <span className="lock-tag">공개됨 · 수정 불가</span>}</span>
              {options ? (
                <div className="choice-row" role="radiogroup" aria-labelledby={`pq-${i}`}>
                  {options.map((o) => (
                    <button key={o} type="button" role="radio" aria-checked={answers[i] === o} disabled={locked(i)}
                      className={answers[i] === o ? "chip is-on" : "chip"}
                      onClick={() => setAnswers(answers.map((a, j) => (j === i ? o : a)))}>
                      {o}
                    </button>
                  ))}
                </div>
              ) : (
                <input className="pk-input" value={answers[i]} maxLength={60} disabled={locked(i)} aria-labelledby={`pq-${i}`}
                  placeholder={hint ? `${hint} · ${min || 1}자 이상` : `${min || 1}자 이상`}
                  onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} />
              )}
            </div>
          ))}
          {status && <p className="note" role="status">{status}</p>}
          <button className="pk-btn main">저장</button>
        </form>
      </Panel>
      <PrefsForm myPid={myPid} />
    </>
  );
}

// 내 마니또에게 알려 줄 것. 나를 맡은 마니또(누군지는 모름)와 운영진만 볼 수 있다(보안 규칙). 단서로는 공개되지 않는다.
const PREF_FIELDS = [
  ["avoid", "못 먹는 음식·알레르기", "예: 땅콩 알레르기, 매운 것 못 먹음"],
  ["likes", "좋아하는 간식·음료", "예: 초코 과자, 따뜻한 차"],
  ["nope", "받기 곤란한 것", "예: 향이 강한 것, 부피 큰 것"],
];
function PrefsForm({ myPid }) {
  const [v, setV] = useState({ avoid: "", likes: "", nope: "" });
  const [status, setStatus] = useState("");
  useEffect(() => {
    getDoc(doc(db, "prefs", myPid)).then((s) => s.exists() && setV((x) => ({ ...x, ...s.data() }))).catch(() => {});
  }, [myPid]);
  async function save(e) {
    e.preventDefault();
    setStatus("저장하는 중");
    try {
      await setDoc(doc(db, "prefs", myPid), { avoid: v.avoid.trim(), likes: v.likes.trim(), nope: v.nope.trim(), ...bump() }, { merge: true });
      setStatus("저장했어요. 내 마니또가 미션을 고를 때 볼 수 있어요.");
    } catch {
      setStatus("저장하지 못했어요. 잠시 후 다시 눌러 주세요.");
    }
  }
  return (
    <Panel title="내 마니또에게 알려 줄 것">
      <p className="small">나를 맡은 마니또만 볼 수 있어요(단서로 공개되지 않아요). 간식 미션에서 알레르기 사고를 막고, 선물 고르는 데 도움이 돼요. 비워 둬도 돼요.</p>
      <form className="stack" onSubmit={save}>
        {PREF_FIELDS.map(([key, label, hint]) => (
          <label key={key}>
            <span className="panel-label">{label}</span>
            <input className="pk-input" maxLength={100} value={v[key] || ""} placeholder={hint} onChange={(e) => setV({ ...v, [key]: e.target.value })} />
          </label>
        ))}
        {status && <p className="note small" role="status">{status}</p>}
        <button className="pk-btn sm">알려 주기 저장</button>
      </form>
    </Panel>
  );
}
