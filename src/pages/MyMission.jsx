import { useEffect, useState } from "react";
import { addDoc, collection, doc, getDoc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp, Loading } from "../App.jsx";
import { LEVEL_LABEL, MISSION_CARDS, PHASE, PRAISE_SLOT, SPEND_GUIDE_WON } from "../lib/constants.js";
import { seededRandom, shuffle } from "../lib/random.js";
import { syncClues } from "../lib/sync.js";
import { Avatar, Dialogue, Panel } from "../ui.jsx";
import { TICKET_RULES } from "../config/prizes.js";

const LEVELS = ["easy", "normal", "hard"];
const ALL_CARDS = Object.values(MISSION_CARDS).flat();
const isCostCard = (cardId) => Boolean(ALL_CARDS.find((c) => c.id === cardId)?.cost);

// 난이도별 카드 순서(사람·주차마다 고정). 맨 앞 장이 먼저 보이고 "다른 카드 보기"를 누르면 다음 장으로 넘어간다.
// 대상이 다른 근무지면 원격으로 할 수 있는 카드만. 돈이 드는 카드가 나와도 넘기면 무비용 카드가 나온다.
function cardDeck(pid, slot, level, remoteOnly) {
  const list = MISSION_CARDS[level].filter((c) => !remoteOnly || c.remote);
  return shuffle(list, seededRandom(`${pid}:${slot}:${level}:${remoteOnly ? "r" : "a"}`)).map((c) => ({ ...c, level }));
}

export default function MyMission() {
  const { myPid, nameOf, config, byPid } = useApp();
  const [assignment, setAssignment] = useState(undefined);
  const [codes, setCodes] = useState(null);
  const [missions, setMissions] = useState({});
  const [progress, setProgress] = useState({});
  const [nudge, setNudge] = useState(false);
  const [inboxSlots, setInboxSlots] = useState([]); // 내 마니또가 완료를 알린 주차
  const [mine, setMine] = useState([]); // 내가 받는 사람으로서 입력한 인증

  // 받는 사람으로서: 마니또가 보냈는데 아직 인증하지 않은 미션이 있으면 알려 준다(인증해야 둘 다 응모권을 받는다).
  useEffect(() => {
    const offs = [
      onSnapshot(query(collection(db, "deliveries"), where("receiverPid", "==", myPid)), (s) => setInboxSlots(s.docs.map((d) => d.data().slot)), () => {}),
      onSnapshot(query(collection(db, "redemptions"), where("receiverPid", "==", myPid)), (s) => setMine(s.docs.map((d) => d.data())), () => {}),
    ];
    return () => offs.forEach((o) => o());
  }, [myPid]);

  useEffect(() => {
    getDoc(doc(db, "assignments", myPid))
      .then((s) => setAssignment(s.exists() ? s.data() : null))
      .catch(() => setAssignment(null));
    getDoc(doc(db, "giverCodes", myPid))
      .then((s) => setCodes(s.exists() ? s.data().codes : null))
      .catch(() => setCodes(null));
    const offs = [
      onSnapshot(doc(db, "giverMissions", myPid), (s) => setMissions(s.exists() ? s.data() : {})),
      // 내 진행 문서를 못 읽는 경우(콘솔에 게시된 보안 규칙이 예전 것일 때 생긴다)에도 화면과 단서 보내기가 멈추지 않게 "모름"으로 둔다.
      onSnapshot(doc(db, "progress", myPid), (s) => setProgress(s.exists() ? s.data() : {}), () => setProgress({ unknown: true })),
    ];
    return () => offs.forEach((o) => o());
  }, [myPid]);

  useEffect(() => {
    if (!assignment) return;
    return onSnapshot(doc(db, "nudges", assignment.receiverPid), (s) => setNudge(s.exists()));
  }, [assignment]);

  useEffect(() => {
    // 처음 배정됐거나 운영자가 다시 배정했으면(회차가 바뀜) 내 답을 지금 대상에게 단서로 다시 보낸다.
    const ver = config.assignVer ?? 0;
    // 진행 문서를 못 읽었으면 보냈는지 알 수 없으니 한 번 보낸다(같은 답을 다시 쓰는 것이라 해가 없다. 프로필이 없으면 아무것도 안 한다).
    if (assignment && (progress.unknown || (progress.profileDone && progress.cluesVer !== ver))) syncClues(myPid, ver).catch(() => {});
  }, [assignment, progress.unknown, progress.profileDone, progress.cluesVer, config.assignVer, myPid]);

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
  const pending = [...new Set(inboxSlots)].filter((slot) => !mine.some((r) => r.slot === slot));
  const myEntries = Math.min(TICKET_RULES.maxReceiverEntries, mine.filter((r) => !r.voided).length);

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

      {pending.length > 0 && running && (
        <Dialogue speaker="알림" tone="gold">
          내 마니또가 보낸 미션 {pending.length}건을 아직 인증하지 않았어요. <a href="#detective">추리 보드</a>에서 코드와 후기를 입력하면 나와 마니또 모두 응모권을 받아요.
        </Dialogue>
      )}
      {nudge && running && (
        <Dialogue speaker="운영진" tone="warn">{nameOf(receiverPid)}님이 아직 받은 미션이 없어요. 이번 주 미션을 먼저 해 주세요!</Dialogue>
      )}
      {!progress.unknown && !progress.profileDone && (
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

      <TicketSummary codes={codes} missions={missions} entries={myEntries} />
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
  const [offset, setOffset] = useState({ easy: 0, normal: 0, hard: 0 }); // 난이도별로 몇 번째 카드를 보고 있는지
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
          <p className="small">
            세 장 중 하나를 골라 주세요. 도전 미션은 인증되면 응모권을 1장 더 받아요.
            마음에 안 들면 "다른 카드 보기"로 같은 난이도의 다른 카드를 볼 수 있어요.
          </p>
          <p className="small">
            <span className="cost-tag">소액 비용</span> 표시는 간식·음료처럼 내 돈이 드는 카드예요. 건당 {SPEND_GUIDE_WON.toLocaleString()}원 이하를 권장하고,
            돈이 안 드는 카드를 골라도 응모권은 똑같아요.
          </p>
          <div className="cards">
            {LEVELS.map((level) => {
              const deck = cardDeck(myPid, slot, level, remote);
              const c = deck[offset[level] % deck.length];
              return (
                <div key={level} className="card-wrap">
                  <button className={`card level-${c.level}`} onClick={() => choose(c)}>
                    <span className="card-head">
                      <span className="card-level">{LEVEL_LABEL[c.level]}</span>
                      {c.cost && <span className="cost-tag">소액 비용</span>}
                    </span>
                    <span className="card-text">{c.text}</span>
                  </button>
                  {deck.length > 1 && (
                    <button type="button" className="text-btn" onClick={() => setOffset((o) => ({ ...o, [level]: o[level] + 1 }))}>
                      다른 {LEVEL_LABEL[level]} 카드 보기
                    </button>
                  )}
                </div>
              );
            })}
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
              {isCostCard(choice.cardId) && <span className="cost-tag">소액 비용 · {SPEND_GUIDE_WON.toLocaleString()}원 이하 권장</span>}
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

function TicketSummary({ codes, missions, entries }) {
  const { myPart } = useApp();
  const [redeemedSlots, setRedeemedSlots] = useState({});
  useEffect(() => {
    if (!codes) return;
    const offs = Object.entries(codes).map(([slot, code]) =>
      onSnapshot(doc(db, "redemptions", code), (s) => setRedeemedSlots((prev) => ({ ...prev, [slot]: s.exists() && !s.data().voided })))
    );
    return () => offs.forEach((o) => o());
  }, [codes]);

  const R = TICKET_RULES;
  const mission = Object.values(redeemedSlots).filter(Boolean).length;
  const hard = Math.min(R.maxHard, Object.entries(redeemedSlots).filter(([slot, ok]) => ok && missions.choices?.[slot]?.level === "hard").length);

  return (
    <Panel title="내 응모권 (지금까지)">
      <p className="ticket-count"><strong>{mission + hard + entries}</strong>장</p>
      <ul className="plain tickets">
        <li>마니또로서: 인증된 미션 {mission} / {R.maxMissions} + 도전 {hard} / {R.maxHard}</li>
        <li>받는 사람으로서: 인증 입력 {entries} / {R.maxReceiverEntries}</li>
        <li className="muted">
          마지막에 더해지는 것: 끝까지 안 들키면 +{R.hidden}
          {mission >= R.hiddenMinMissions ? "" : ` (내 미션이 ${R.hiddenMinMissions}건 이상 인증돼야 받을 수 있어요)`}, 내 마니또를 맞히면 +{R.correctGuess}
          {myPart ? `, 우리 파트가 완수율 1위면 +${R.partBonus}` : ""}
        </li>
      </ul>
      <p className="small">내 마니또가 미션을 안 보낸 주차는 마지막에 인증 입력 대신 1장씩 채워져요(내 미션이 {R.compMinMissions}건 이상 인증된 경우). <a href="#rules">규칙 전체 보기</a></p>
    </Panel>
  );
}
