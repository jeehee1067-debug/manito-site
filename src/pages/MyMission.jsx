import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp, Loading } from "../App.jsx";
import { LEVEL_LABEL, MISSION_CARDS, PHASE, PRAISE_SLOT } from "../lib/constants.js";
import { seededRandom } from "../lib/random.js";
import { syncClues } from "../lib/sync.js";
import { Avatar, Dialogue, Panel } from "../ui.jsx";

// 같은 사람에게는 항상 같은 3장이 나온다. 대상이 다른 근무지면 원격으로 할 수 있는 카드만.
function cardOptions(pid, slot, remoteOnly) {
  const rand = seededRandom(`${pid}:${slot}:${remoteOnly ? "r" : "a"}`);
  return ["easy", "normal", "hard"].map((level) => {
    const list = MISSION_CARDS[level].filter((c) => !remoteOnly || c.remote);
    return { ...list[Math.floor(rand() * list.length)], level };
  });
}

export default function MyMission() {
  const { myPid, nameOf, config, byPid } = useApp();
  const [assignment, setAssignment] = useState(undefined);
  const [codes, setCodes] = useState(null);
  const [missions, setMissions] = useState({});
  const [progress, setProgress] = useState({});
  const [nudge, setNudge] = useState(false);

  useEffect(() => {
    getDoc(doc(db, "assignments", myPid))
      .then((s) => setAssignment(s.exists() ? s.data() : null))
      .catch(() => setAssignment(null));
    getDoc(doc(db, "giverCodes", myPid))
      .then((s) => setCodes(s.exists() ? s.data().codes : null))
      .catch(() => setCodes(null));
    const offs = [
      onSnapshot(doc(db, "giverMissions", myPid), (s) => setMissions(s.exists() ? s.data() : {})),
      onSnapshot(doc(db, "progress", myPid), (s) => setProgress(s.exists() ? s.data() : {})),
    ];
    return () => offs.forEach((o) => o());
  }, [myPid]);

  useEffect(() => {
    if (!assignment) return;
    return onSnapshot(doc(db, "nudges", assignment.receiverPid), (s) => setNudge(s.exists()));
  }, [assignment]);

  useEffect(() => {
    if (assignment && progress.profileDone && !progress.cluesSynced) syncClues(myPid).catch(() => {});
  }, [assignment, progress.profileDone, progress.cluesSynced, myPid]);

  if (assignment === undefined) return <Loading />;
  if (!assignment) {
    return (
      <Panel title="아직 배정 전이에요">
        <p>운영진이 마니또를 배정하면 여기에 내 대상이 나타나요. 그동안 <a href="#profile">내 프로필</a>에서 캐릭터를 고르고 질문에 답해 주세요.</p>
      </Panel>
    );
  }

  const receiverPid = assignment.receiverPid;
  const running = config.phase === PHASE.RUNNING;
  const myLoc = byPid[myPid]?.loc;
  const theirLoc = byPid[receiverPid]?.loc;
  const remote = Boolean(myLoc && theirLoc && myLoc !== theirLoc);

  return (
    <>
      <section className="panel target">
        <Avatar pid={receiverPid} size={140} />
        <div>
          <span className="dialogue-speaker static">내가 몰래 챙길 사람</span>
          <p className="target-name">{nameOf(receiverPid)}</p>
          {theirLoc && <span className="loc-tag">{theirLoc}</span>}
          {remote && <p className="small">다른 근무지라서 직접 가지 않아도 되는 미션 카드가 나와요.</p>}
        </div>
      </section>

      {nudge && running && (
        <Dialogue speaker="운영진" tone="warn">{nameOf(receiverPid)}님이 아직 받은 미션이 없어요. 이번 주 미션을 먼저 해 주세요!</Dialogue>
      )}
      {!progress.profileDone && (
        <Dialogue speaker="운영진" tone="warn">내 프로필이 비어 있어요. 대상에게 갈 단서가 프로필에서 나오니 <a href="#profile">지금 채워 주세요</a>.</Dialogue>
      )}

      {[1, 2, 3].map((slot) => (
        <Slot
          key={slot}
          slot={slot}
          myPid={myPid}
          receiverPid={receiverPid}
          receiverName={nameOf(receiverPid)}
          code={codes?.[slot]}
          choice={missions.choices?.[slot]}
          done={Boolean(missions.done?.[slot])}
          allDone={missions.done || {}}
          open={running && slot <= config.week}
          phase={config.phase}
          remote={remote}
        />
      ))}

      <TicketSummary codes={codes} missions={missions} />
    </>
  );
}

function Slot({ slot, myPid, receiverPid, receiverName, code, choice, done, allDone, open, phase, remote }) {
  const [message, setMessage] = useState("");
  const [includeCode, setIncludeCode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [redeemed, setRedeemed] = useState(null);
  const [thanks, setThanks] = useState(null);
  const isPraise = slot === PRAISE_SLOT;

  useEffect(() => {
    if (!code) return;
    const offs = [
      onSnapshot(doc(db, "redemptions", code), (s) => setRedeemed(s.exists() ? s.data() : null)),
      onSnapshot(doc(db, "thanks", code), (s) => setThanks(s.exists() ? s.data() : null)),
    ];
    return () => offs.forEach((o) => o());
  }, [code]);

  useEffect(() => {
    if (choice) setIncludeCode(choice.level === "easy" || isPraise || remote);
  }, [choice, isPraise, remote]);

  async function choose(card) {
    setError("");
    await setDoc(doc(db, "giverMissions", myPid), { choices: { [slot]: { cardId: card.id, level: card.level, text: card.text } } }, { merge: true })
      .catch(() => setError(redeemed ? "이미 인증된 미션이라 카드를 새로 고를 수 없어요." : "카드를 고르지 못했어요. 다시 시도해 주세요."));
  }

  async function complete(e) {
    e.preventDefault();
    setError("");
    if (isPraise && message.trim().length < 10) return setError("칭찬 카드는 10자 이상 써 주세요.");
    setBusy(true);
    try {
      await addDoc(collection(db, "deliveries"), {
        receiverPid,
        slot,
        kind: isPraise ? "praise" : "mission",
        message: message.trim(),
        code: includeCode || isPraise ? code : null,
        createdAt: serverTimestamp(),
      });
      const next = { ...allDone, [slot]: true };
      const update = { done: { [slot]: true } };
      if (isPraise) update.choices = { [slot]: { cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" } };
      await setDoc(doc(db, "giverMissions", myPid), update, { merge: true });
      await setDoc(doc(db, "progress", myPid), { doneCount: Object.values(next).filter(Boolean).length }, { merge: true });
      setMessage("");
    } catch (err) {
      setError(err.code === "permission-denied" ? "지금은 미션을 보낼 수 없는 단계예요." : "보내지 못했어요. 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const title = isPraise ? "3주차 공통 미션: 올해의 칭찬 한 줄" : `${slot}주차 미션`;

  return (
    <Panel title={title + (done ? " ✔" : "")} className={open || done ? "" : "locked"}>
      {!open && !done && <p className="muted">{phase < PHASE.RUNNING ? "미션 진행이 시작되면 열려요." : `${slot}주차에 열려요.`}</p>}

      {open && !done && !isPraise && !choice && (
        <>
          <p className="small">세 장 중 하나를 골라 주세요. 도전 미션은 인증되면 응모권을 1장 더 받아요.</p>
          <div className="cards">
            {cardOptions(myPid, slot, remote).map((c) => (
              <button key={c.id} className={`card level-${c.level}`} onClick={() => choose(c)}>
                <span className="card-level">{LEVEL_LABEL[c.level]}</span>
                <span className="card-text">{c.text}</span>
              </button>
            ))}
          </div>
          {error && <p className="error" role="alert">{error}</p>}
        </>
      )}

      {(choice || isPraise) && open && !done && (
        <form className="stack" onSubmit={complete}>
          {!isPraise && (
            <div className="chosen">
              <span className={`badge level-${choice.level}`}>{LEVEL_LABEL[choice.level]}</span>
              <span>{choice.text}</span>
              {/* 코드가 이미 인증된 슬롯은 보안 규칙이 카드 변경을 막는다 */}
              {!redeemed && (
                <button type="button" className="text-btn"
                  onClick={() => setDoc(doc(db, "giverMissions", myPid), { choices: { [slot]: null } }, { merge: true }).catch(() => {})}>
                  다른 카드 고르기
                </button>
              )}
            </div>
          )}
          {!isPraise && redeemed && <p className="small">{receiverName}님이 이미 인증해서 카드를 바꿀 수 없어요. 완료 알리기만 눌러 주세요.</p>}
          <div className="code-tag" aria-label="인증 코드">
            <span>인증 코드</span>
            <strong>{code || "----"}</strong>
          </div>
          <p className="small">
            {isPraise
              ? "칭찬 카드는 사이트 쪽지로 전달되고, 인증 코드도 함께 보내져요."
              : "실물 미션이면 이 코드를 메모에 적어 함께 두세요. 쪽지 미션이면 아래에서 코드를 함께 보내면 돼요."}
          </p>
          <label>
            <span className="panel-label">{isPraise ? `${receiverName}님에게 보내는 칭찬 (익명)` : "쪽지 (선택, 익명으로 전달)"}</span>
            <textarea className="pk-input" rows={3} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder={isPraise ? "올해 고마웠던 점, 멋있었던 순간" : "예: 오늘 책상 서랍을 확인해 보세요"} />
          </label>
          {!isPraise && (
            <label className="check">
              <input type="checkbox" checked={includeCode} onChange={(e) => setIncludeCode(e.target.checked)} />
              쪽지에 인증 코드 함께 보내기
            </label>
          )}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="pk-btn main" disabled={busy}>{isPraise ? "칭찬 카드 보내기" : "미션 완료 알리기"}</button>
        </form>
      )}

      {done && (
        <div className="stack tight">
          {choice?.text && (
            <div className="chosen">
              {choice.level !== "praise" && <span className={`badge level-${choice.level}`}>{LEVEL_LABEL[choice.level]}</span>}
              <span>{choice.text}</span>
            </div>
          )}
          <p className={redeemed && !redeemed.voided ? "note" : "small"}>
            {redeemed
              ? redeemed.voided ? "운영진이 이 인증을 무효 처리했어요." : `${receiverName}님이 인증했어요.`
              : `${receiverName}님의 인증을 기다리는 중이에요.`}
          </p>
          {thanks && <Dialogue speaker={receiverName}>{thanks.text}</Dialogue>}
        </div>
      )}
    </Panel>
  );
}

function TicketSummary({ codes, missions }) {
  const [redeemedSlots, setRedeemedSlots] = useState({});
  useEffect(() => {
    if (!codes) return;
    const offs = Object.entries(codes).map(([slot, code]) =>
      onSnapshot(doc(db, "redemptions", code), (s) => setRedeemedSlots((prev) => ({ ...prev, [slot]: s.exists() && !s.data().voided })))
    );
    return () => offs.forEach((o) => o());
  }, [codes]);

  const mission = Object.values(redeemedSlots).filter(Boolean).length;
  const hard = Math.min(2, Object.entries(redeemedSlots).filter(([slot, ok]) => ok && missions.choices?.[slot]?.level === "hard").length);

  return (
    <Panel title="내 응모권 (확정분)">
      <p className="ticket-count"><strong>{mission + hard}</strong>장</p>
      <p className="small">미션 {mission} + 도전 {hard}. 받는 사람으로서 입력한 인증, 끝까지 안 들킨 보너스, 정답 지목은 마지막에 더해져요.</p>
    </Panel>
  );
}
