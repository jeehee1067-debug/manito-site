import { useEffect, useState } from "react";
import { collection, doc, getDoc, increment, onSnapshot, query, serverTimestamp, setDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp, Loading } from "../App.jsx";
import { EXTRA_NOTES_MAX, LEVEL_LABEL, MISSION_CARDS, PHASE, PRAISE_SLOT, SCHEDULE, SPEND_GUIDE_WON, scheduleLabel, todayYmd } from "../lib/constants.js";
import { seededRandom, shuffle } from "../lib/random.js";
import { syncClues } from "../lib/sync.js";
import { Avatar, Dialogue, Panel } from "../ui.jsx";
import { TICKET_RULES } from "../config/prizes.js";
import { bump } from "../lib/writes.js";

// 대상 이름은 처음에 가려 둔다(사무실에서 화면을 열면 옆 사람이 볼 수 있어서). "이름 보기"를 누르면 이만큼 보인다.
const SHOW_MS = 60 * 1000;

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
  const { myPid, nameOf, config, byPid, inbox, fromReceiver, angelInbox } = useApp();
  const [assignment, setAssignment] = useState(undefined);
  const [codes, setCodes] = useState(null);
  const [missions, setMissions] = useState({});
  const [progress, setProgress] = useState({});
  const [nudge, setNudge] = useState(false);
  const inboxSlots = inbox.filter((d) => d.kind !== "note").map((d) => d.slot); // 내 마니또가 완료를 알린 주차(App이 구독)
  const [mine, setMine] = useState(null); // 내가 받는 사람으로서 입력한 인증(null = 불러오는 중)
  const [extra, setExtra] = useState({}); // 이번 주 할 일에 쓰는 것: 내 취향 칸, 이번 주 추측
  const [angelTodo, setAngelTodo] = useState(0); // 내가 수호천사로 연결된 사람 수(아래 AngelCard와 같은 질의라 한 번만 읽는다)
  useEffect(() => onSnapshot(query(collection(db, "angels"), where("angelPid", "==", myPid)), (s) => setAngelTodo(s.size), () => setAngelTodo(0)), [myPid]);
  const [shown, setShown] = useState(false); // 대상 이름을 보이는지(기본은 가림)
  useEffect(() => {
    if (!shown) return undefined;
    const t = setTimeout(() => setShown(false), SHOW_MS);
    return () => clearTimeout(t);
  }, [shown]);

  // 받는 사람으로서: 마니또가 보냈는데 아직 인증하지 않은 미션이 있으면 알려 준다(인증해야 둘 다 응모권을 받는다).
  useEffect(() => onSnapshot(query(collection(db, "redemptions"), where("receiverPid", "==", myPid)), (s) => setMine(s.docs.map((d) => d.data())), () => setMine([])), [myPid]);
  useEffect(() => {
    const get = (path, key, pick) => getDoc(doc(db, ...path)).then((s) => setExtra((x) => ({ ...x, [key]: pick(s) }))).catch(() => setExtra((x) => ({ ...x, [key]: null })));
    get(["prefs", myPid], "prefs", (s) => s.exists());
    if (config.phase === PHASE.RUNNING) get(["midGuesses", myPid], "mid", (s) => (s.exists() ? s.data().guesses || {} : {}));
  }, [myPid, config.phase, config.week]);

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
        <p>운영진이 마니또를 배정하면 여기에 내 대상이 나타나요. 그동안 <a href="#profile">내 프로필</a>에서 캐릭터를 고르고, 6문항에 답하고, "내 마니또에게 알려 줄 것"(알레르기·좋아하는 간식)을 적어 주세요.</p>
      </Panel>
    );
  }

  const receiverPid = assignment.receiverPid;
  const running = config.phase === PHASE.RUNNING;
  const myLoc = byPid[myPid]?.loc;
  const theirLoc = byPid[receiverPid]?.loc;
  const remote = Boolean(myLoc && theirLoc && myLoc !== theirLoc);
  // 인증 목록이 오기 전에는 "인증 안 한 미션"으로 세지 않는다(잠깐 잘못 보이지 않게)
  const pending = mine ? [...new Set(inboxSlots)].filter((slot) => !mine.some((r) => r.slot === slot)) : [];
  // 인증 입력: 내가 인증한 미션 + 확인한 수호천사 미션(scoring.js와 같은 기준, 최대 3)
  const myEntries = Math.min(TICKET_RULES.maxReceiverEntries, (mine || []).filter((r) => !r.voided).length + angelInbox.filter((g) => g.confirmed).length);

  // 가려 둔 동안에는 화면 어디에도 대상 이름을 쓰지 않는다
  // 존칭까지 붙인 이름("홍길동님"). 가려 둔 동안에는 "내 대상".
  const targetName = shown ? `${nameOf(receiverPid)}님` : "내 대상";

  const week = config.week || 1;
  const nextEvent = SCHEDULE.find((e) => e.date >= todayYmd());
  // 이번 주 할 일: 지금 단계에서 아직 안 한 것만
  const todo = [];
  if (!progress.unknown && !progress.profileDone) todo.push({ text: "내 프로필 6문항 채우기 (단서가 돼요. 안 채우면 은신 응모권 없음)", href: "#profile" });
  if (extra.prefs === false) todo.push({ text: "내 마니또에게 알려 줄 것(좋아하는 간식, 못 먹는 음식) 적기", href: "#profile" });
  if (running) {
    if (!missions.done?.[week]) todo.push({ text: week === PRAISE_SLOT ? `${week}주차 칭찬 카드 보내기` : missions.choices?.[week] ? `${week}주차 미션 하고 "완료 알리기"` : `${week}주차 미션 카드 고르기`, href: null });
    if (pending.length > 0) todo.push({ text: `받은 미션 ${pending.length}건 인증하기`, href: "#detective" });
    if (extra.mid && !extra.mid[week]) todo.push({ text: `${week}주차 추측 남기기 (용의자 보드)`, href: "#detective" });
  }
  if (config.phase === PHASE.GUESSING && !progress.unknown && !progress.guessed) todo.push({ text: "최종 지목하기 (마지막 단서: 마니또의 파트 공개)", href: "#detective" });
  if (running && angelInbox.some((g) => !g.confirmed)) todo.push({ text: "수호천사가 보낸 것 확인하기", href: "#detective" });
  if (running && angelTodo > 0) todo.push({ text: "수호천사 미션 하기 (이 화면 아래 '수호천사 미션')", href: null });

  return (
    <>
      {config.phase < PHASE.SCORING && (
        <Panel title="이번 주 할 일">
          {todo.length === 0
            ? <p className="small">지금 할 일은 다 했어요! 마니또의 다음 미션을 기다려 보세요.</p>
            : <ul className="todo-list">{todo.map((t) => <li key={t.text}>{t.href ? <a href={t.href}>{t.text}</a> : t.text}</li>)}</ul>}
          {nextEvent && <p className="small muted">다음 일정: {scheduleLabel(nextEvent)}</p>}
        </Panel>
      )}
      <section className="panel target">
        {shown ? <Avatar pid={receiverPid} size={140} /> : <div className="avatar-mask" aria-hidden="true">?</div>}
        <div>
          <span className="dialogue-speaker static">내가 몰래 챙길 사람</span>
          <p className={shown ? "target-name" : "target-name masked"}>{shown ? nameOf(receiverPid) : "● ● ●"}</p>
          {shown && theirLoc && <span className="loc-tag">{theirLoc}</span>}
          <p>
            <button type="button" className="pk-btn sm target-toggle" aria-pressed={shown} onClick={() => setShown(!shown)}>
              {shown ? "가리기" : "이름 보기"}
            </button>
          </p>
          {!shown && <p className="small muted">옆 사람이 볼 수 있어서 처음에는 가려 둬요. 누르면 1분 동안 보여요.</p>}
          {remote && <p className="small">다른 근무지라서 직접 가지 않아도 되는 미션 카드가 나와요.</p>}
        </div>
      </section>

      {pending.length > 0 && running && (
        <Dialogue speaker="알림" tone="gold">
          내 마니또가 보낸 미션 {pending.length}건을 아직 인증하지 않았어요. <a href="#detective">추리 보드</a>에서 코드와 후기를 입력하면 나와 마니또 모두 응모권을 받아요.
          찾아봐도 받은 게 없으면 추리 보드에서 "받은 게 없어요"로 알려 주세요.
        </Dialogue>
      )}
      <TargetPrefs receiverPid={receiverPid} targetName={targetName} />
      {fromReceiver.length > 0 && (
        <Panel title={`${targetName}이 보낸 한마디`}>
          {fromReceiver.map((m) => (
            <Dialogue key={m.id} speaker={`내 대상 · ${m.slot}주차`} tone="gold"><p>{m.message}</p></Dialogue>
          ))}
          <p className="small muted">답하고 싶으면 완료한 주차의 "쪽지 더 보내기"를 써 보세요. 정체가 들키지 않게 조심!</p>
        </Panel>
      )}

      {nudge && running && (
        <Dialogue speaker="운영진" tone="warn">{targetName}이 아직 받은 미션이 없어요. 이번 주 미션을 먼저 해 주세요!</Dialogue>
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
          receiverName={targetName}
          code={codes?.[slot]}
          choice={missions.choices?.[slot]}
          done={Boolean(missions.done?.[slot])}
          notes={missions.notes?.[slot] || 0}
          allDone={missions.done || {}}
          open={running && slot <= config.week}
          phase={config.phase}
          remote={remote}
        />
      ))}

      <TicketSummary codes={codes} missions={missions} entries={myEntries} />
      <AngelCard />
    </>
  );
}

function Slot({ slot, myPid, receiverPid, receiverName, code, choice, done, notes, allDone, open, phase, remote }) {
  const [message, setMessage] = useState("");
  const [includeCode, setIncludeCode] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [redeemed, setRedeemed] = useState(null);
  const [thanks, setThanks] = useState(null);
  const [reported, setReported] = useState(false); // 대상이 "받은 게 없어요"로 알렸는지
  const [verdict, setVerdict] = useState(null); // 운영진 확인 결과: received / missing
  const [offset, setOffset] = useState({ easy: 0, normal: 0, hard: 0 }); // 난이도별로 몇 번째 카드를 보고 있는지
  const isPraise = slot === PRAISE_SLOT;

  // 내 코드의 인증 문서(받는 사람과 나, 운영자만 읽는다)
  useEffect(() => {
    if (!code) return;
    return onSnapshot(doc(db, "redemptions", code), (s) => setRedeemed(s.exists() ? s.data() : null), () => {});
  }, [code]);

  // 감사 답장은 그 인증에 딸린 익명 피드 글에 있다
  const feedId = redeemed?.feedId || null;
  useEffect(() => {
    if (!feedId) return setThanks(null);
    return onSnapshot(doc(db, "feed", feedId), (s) => setThanks(s.exists() ? s.data().thanks || null : null), () => {});
  }, [feedId]);

  // 완료를 알렸는데 인증이 없는 동안: 대상의 "받은 게 없어요" 신고와 운영진 확인 결과
  const waiting = done && !redeemed;
  useEffect(() => {
    if (!waiting) return;
    const rid = `${receiverPid}_${slot}`;
    const offs = [
      onSnapshot(doc(db, "reports", rid), (s) => setReported(s.exists()), () => {}),
      onSnapshot(doc(db, "verdicts", rid), (s) => setVerdict(s.exists() ? s.data().verdict : null), () => {}),
    ];
    return () => offs.forEach((o) => o());
  }, [waiting, receiverPid, slot]);

  // 인증 코드는 기본으로 쪽지에 같이 보낸다(실물 메모를 다른 사람이 치우거나 잃어버려도 대상이 인증할 수 있게).
  useEffect(() => {
    if (choice || isPraise) setIncludeCode(true);
  }, [choice, isPraise]);

  async function choose(card) {
    setError("");
    await setDoc(doc(db, "giverMissions", myPid), { choices: { [slot]: { cardId: card.id, level: card.level, text: card.text } }, ...bump() }, { merge: true })
      .catch(() => setError(redeemed ? "이미 인증된 미션이라 카드를 새로 고를 수 없어요." : "카드를 고르지 못했어요. 다시 시도해 주세요."));
  }

  async function complete(e) {
    e.preventDefault();
    setError("");
    if (isPraise && message.trim().length < 10) return setError("칭찬 카드는 10자 이상 써 주세요.");
    setBusy(true);
    try {
      // 완료 알림(문서 ID = 받는사람_주차, 주차마다 한 번)과 완료 표시를 한 묶음으로 쓴다. 보안 규칙이 둘이 같이 있을 때만 받는다.
      const next = { ...allDone, [slot]: true };
      const update = { done: { [slot]: true }, ...bump() };
      if (isPraise) update.choices = { [slot]: { cardId: "praise", level: "praise", text: "올해의 칭찬 한 줄" } };
      const batch = writeBatch(db);
      // 1·2주차 알림에는 고른 카드(난이도·내용)를 같이 보낸다. 대상이 받은 것과 맞는지 확인하고, 다르면 카드 추가분이 빠진다.
      batch.set(doc(db, "deliveries", `${receiverPid}_${slot}`), {
        receiverPid,
        slot,
        kind: isPraise ? "praise" : "mission",
        message: message.trim(),
        code: includeCode || isPraise ? code : null,
        ...(isPraise ? {} : { card: { level: choice.level, text: choice.text } }),
        createdAt: serverTimestamp(),
      });
      batch.set(doc(db, "giverMissions", myPid), update, { merge: true });
      await batch.commit();
      await setDoc(doc(db, "progress", myPid), { doneCount: Object.values(next).filter(Boolean).length, ...bump() }, { merge: true });
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
            세 장 중 하나를 골라 주세요. 대상이 인증하면 보통은 응모권 {TICKET_RULES.cardBonus.normal}장, 도전은 {TICKET_RULES.cardBonus.hard}장을 더 받아요.
            마음에 안 들면 "다른 카드 보기"로 같은 난이도의 다른 카드를 볼 수 있어요.
          </p>
          <p className="small">
            <span className="cost-tag">소액 비용</span> 표시는 간식·음료처럼 내 돈이 드는 카드예요. 건당 {SPEND_GUIDE_WON.toLocaleString()}원 이하를 권장하고,
            같은 난이도라면 돈이 안 드는 카드를 골라도 응모권은 똑같아요.
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
                  onClick={() => setDoc(doc(db, "giverMissions", myPid), { choices: { [slot]: null }, ...bump() }, { merge: true }).catch(() => {})}>
                  다른 카드 고르기
                </button>
              )}
            </div>
          )}
          {!isPraise && redeemed && <p className="small">{receiverName}이 이미 인증해서 카드를 바꿀 수 없어요. 완료 알리기만 눌러 주세요.</p>}
          <div className="code-tag" aria-label="인증 코드">
            <span>인증 코드</span>
            <strong>{code || "----"}</strong>
          </div>
          <p className="small">
            {isPraise
              ? "칭찬 카드는 사이트 쪽지로 전달되고, 인증 코드도 함께 보내져요."
              : "실물 미션이면 이 코드를 메모에 적어 함께 두면 좋아요. 아래에서 코드를 쪽지로도 함께 보내면 메모를 잃어버려도 인증할 수 있어요."}
            {!isPraise && " 고른 카드 내용은 대상에게 같이 보여요(받은 것이 카드와 다르면 카드 추가분이 빠져요)."}
          </p>
          <label>
            <span className="panel-label">{isPraise ? `${receiverName}에게 보내는 칭찬 (익명)` : "쪽지 (선택, 익명으로 전달)"}</span>
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
              ? redeemed.voided ? "운영진이 이 인증을 무효 처리했어요." : `${receiverName}이 인증했어요.`
              : verdict === "received" ? "운영진이 전달된 것으로 확인했어요. 미션으로 인정돼요(카드 추가분은 직접 인증된 경우에만 있어요)."
                : verdict === "missing" ? "운영진이 전달되지 않은 것으로 확인했어요. 이 주차는 미션으로 인정되지 않아요."
                  : `${receiverName}의 인증을 기다리는 중이에요.`}
          </p>
          {!redeemed && !verdict && reported && (
            <Dialogue speaker="알림" tone="warn">
              {receiverName}이 {slot}주차에 받은 게 없다고 운영진에게 알렸어요. 전달이 잘 됐는지 확인해 주세요.
              다시 전달하고 {open ? "아래 \"쪽지 더 보내기\"로 위치나 코드를 알려 주면" : "운영진에게 알려 주면"} 돼요. 운영진이 두 사람에게 확인한 뒤 처리해요.
            </Dialogue>
          )}
          {thanks && <Dialogue speaker={receiverName}>{thanks}</Dialogue>}
          {open && <MoreNotes slot={slot} myPid={myPid} receiverPid={receiverPid} receiverName={receiverName} code={code} sent={notes} showCode={!redeemed} />}
        </div>
      )}
    </Panel>
  );
}

// 쪽지 더 보내기: 완료를 알린 주차에 쪽지를 더 보낸다. "3일 연속 매일 다른 응원 쪽지" 카드처럼 여러 날에 걸친 미션을 할 수 있게 둔 것.
// 완료 표시와 응모권에는 영향이 없다(받는 사람 화면의 "마니또에게서 온 것"에 쪽지로 쌓인다).
function MoreNotes({ slot, myPid, receiverPid, receiverName, code, sent, showCode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [withCode, setWithCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ type: "", text: "" });
  const left = EXTRA_NOTES_MAX - sent;

  async function send(e) {
    e.preventDefault();
    if (!text.trim()) return setMsg({ type: "error", text: "쪽지 내용을 적어 주세요." });
    setBusy(true);
    setMsg({ type: "", text: "" });
    try {
      // 쪽지와 쪽지 수(notes)를 한 묶음으로 쓴다. 보안 규칙이 쪽지 수를 1 올릴 때만, 주차마다 5건까지 받는다.
      const batch = writeBatch(db);
      // 문서 ID = 받는사람_주차_n순번(순번 = 보낸 뒤의 쪽지 수). 보안 규칙이 순번과 쪽지 수가 맞을 때만 받는다.
      batch.set(doc(db, "deliveries", `${receiverPid}_${slot}_n${sent + 1}`), {
        receiverPid, slot, kind: "note", message: text.trim(), code: showCode && withCode ? code : null, createdAt: serverTimestamp(),
      });
      batch.set(doc(db, "giverMissions", myPid), { notes: { [slot]: increment(1) }, ...bump() }, { merge: true });
      await batch.commit();
      setText("");
      setWithCode(false);
      setOpen(false);
      setMsg({ type: "ok", text: `${receiverName}에게 쪽지를 보냈어요.` });
    } catch (err) {
      setMsg({ type: "error", text: err.code === "permission-denied" ? "지금은 쪽지를 보낼 수 없어요(미션 진행 기간의 열린 주차에만 보낼 수 있어요)." : "보내지 못했어요. 다시 시도해 주세요." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="more-notes">
      {sent > 0 && <p className="small muted">이 주차에 더 보낸 쪽지 {sent}건</p>}
      {!open && left > 0 && (
        <button type="button" className="pk-btn sm" onClick={() => { setOpen(true); setMsg({ type: "", text: "" }); }}>쪽지 더 보내기</button>
      )}
      {!open && left <= 0 && <p className="small muted">이 주차에 더 보낼 수 있는 쪽지({EXTRA_NOTES_MAX}건)를 모두 보냈어요.</p>}
      {open && (
        <form className="stack" onSubmit={send}>
          <label>
            <span className="panel-label">{receiverName}에게 더 보내는 쪽지 (익명, 남은 횟수 {left})</span>
            <textarea className="pk-input" rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="예: 둘째 날 응원이에요. 오늘도 힘내세요!" />
          </label>
          {showCode && (
            <label className="check">
              <input type="checkbox" checked={withCode} onChange={(e) => setWithCode(e.target.checked)} />
              인증 코드도 함께 보내기 (아직 코드를 전하지 못했을 때)
            </label>
          )}
          <div className="inline">
            <button className="pk-btn main sm" disabled={busy}>쪽지 보내기</button>
            <button type="button" className="text-btn" onClick={() => setOpen(false)}>닫기</button>
          </div>
        </form>
      )}
      {msg.text && <p className={msg.type === "error" ? "error small" : "note small"} role="status">{msg.text}</p>}
    </div>
  );
}

// 수호천사: 응모권을 더 받고 싶은 사람이 지원하면, 운영진이 마니또에게 아무것도 받지 못한 사람에게 몰래 연결한다.
// 연결되면 그 사람에게 미션을 2번까지 하고 "완료 알리기". 그 사람이 확인하면 1건당 응모권 +1(최대 2).
function AngelCard() {
  const { myPid, config } = useApp();
  const [vol, setVol] = useState(undefined); // 지원 중인지
  const [targets, setTargets] = useState([]); // 내가 수호천사로 연결된 받는 사람
  const [msg, setMsg] = useState("");
  useEffect(() => onSnapshot(doc(db, "angelVolunteers", myPid), (s) => setVol(s.exists() && s.data().active), () => setVol(false)), [myPid]);
  useEffect(() => onSnapshot(query(collection(db, "angels"), where("angelPid", "==", myPid)), (s) => setTargets(s.docs.map((d) => d.id)), () => setTargets([])), [myPid]);
  if (vol === undefined) return null;
  const canApply = config.phase <= PHASE.RUNNING;
  if (!canApply && targets.length === 0) return null;
  async function toggle() {
    setMsg("");
    try {
      await setDoc(doc(db, "angelVolunteers", myPid), { active: !vol, at: serverTimestamp(), ...bump() }, { merge: true });
      setMsg(vol ? "지원을 취소했어요. 다시 지원하면 순서는 맨 뒤가 돼요." : "지원했어요. 도움이 필요한 사람이 생기면 먼저 지원한 순서대로 자동 연결돼요(연결되면 여기에 수호천사 미션이 생겨요).");
    } catch {
      setMsg("지금은 바꿀 수 없어요.");
    }
  }
  const R = TICKET_RULES;
  return (
    <>
      {targets.map((r) => <AngelMission key={r} receiverPid={r} />)}
      {canApply && targets.length === 0 && (
        <Panel title="수호천사 지원 (응모권을 더 받고 싶다면)">
          <p className="small">
            마니또가 미션을 안 해서 아무것도 받지 못한 사람이 있으면, 지원자 중 한 명이 그 사람의 <b>수호천사</b>로 몰래 연결돼요.
            연결되면 그 사람에게 미션을 {R.maxAngel}번까지 해 주고, 그 사람이 확인할 때마다 응모권 +{R.angelPerMission}장(최대 {R.maxAngel}장)을 받아요.
          </p>
          <p className="small">
            <b>먼저 지원한 순서대로 자동 연결돼요</b>(운영진이 고르지 않아요). 2주차·3주차가 열릴 때, 그때까지 아무것도 받지 못한 사람이 있으면 연결돼요.
            지난 주차의 내 마니또 미션을 모두 완료한 지원자만 연결되니 내 미션은 그대로 해 주세요. 도움이 필요한 사람이 없으면 연결되지 않을 수도 있어요.
          </p>
          <button className={vol ? "pk-btn sm" : "pk-btn gold sm"} onClick={toggle}>{vol ? "지원 취소" : "수호천사 지원하기"}</button>
          {vol && <p className="small note">지원 중이에요. 연결되면 여기에 "수호천사 미션"이 생겨요.</p>}
          {msg && <p className="small" role="status">{msg}</p>}
        </Panel>
      )}
    </>
  );
}

function AngelMission({ receiverPid }) {
  const { nameOf, config } = useApp();
  const [shown, setShown] = useState(false);
  const [gifts, setGifts] = useState({}); // { 1: 문서 | null, 2: 문서 | null }
  const [text, setText] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!shown) return undefined;
    const t = setTimeout(() => setShown(false), SHOW_MS);
    return () => clearTimeout(t);
  }, [shown]);
  useEffect(() => {
    const offs = [1, 2].map((k) => onSnapshot(doc(db, "angelGifts", `${receiverPid}_${k}`), (s) => setGifts((g) => ({ ...g, [k]: s.exists() ? s.data() : null })), () => {}));
    return () => offs.forEach((o) => o());
  }, [receiverPid]);
  const name = shown ? `${nameOf(receiverPid)}님` : "도와줄 사람";
  const next = [1, 2].find((k) => gifts[k] === null);
  const running = config.phase === PHASE.RUNNING;
  async function send(e) {
    e.preventDefault();
    if (text.trim().length < 2) return setError("무엇을 했는지 2자 이상 적어 주세요.");
    setBusy(true);
    setError("");
    try {
      await setDoc(doc(db, "angelGifts", `${receiverPid}_${next}`), { receiverPid, k: next, text: text.trim(), message: message.trim(), createdAt: serverTimestamp() });
      setText(""); setMessage("");
    } catch {
      setError("보내지 못했어요. 미션 진행 기간인지 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Panel title="수호천사 미션">
        <p className="small">
          마니또에게 아무것도 받지 못한 사람이에요. 몰래 챙겨 주고 아래에 "완료 알리기"를 눌러 주세요. 그 사람에게는 "수호천사가 보낸 것"으로 가고(누구인지는 몰라요),
          확인되면 응모권 +{TICKET_RULES.angelPerMission}장이에요. 송년회에서 수호천사로 소개돼요.
        </p>
        <p>
          <span className={shown ? "target-name sm" : "target-name sm masked"}>{shown ? nameOf(receiverPid) : "● ● ●"}</span>{" "}
          <button type="button" className="pk-btn sm" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? "가리기" : "이름 보기"}</button>
        </p>
        {[1, 2].map((k) => gifts[k] && (
          <p key={k} className="small">{k}번: {gifts[k].text} — {gifts[k].confirmed ? `확인됨 ("${gifts[k].review}")` : "확인 기다리는 중"}</p>
        ))}
        {running && next && (
          <form className="stack" onSubmit={send}>
            <label>
              <span className="panel-label">{next}번째로 한 것</span>
              <input className="pk-input" maxLength={100} value={text} onChange={(e) => setText(e.target.value)} placeholder="예: 책상에 귤 두 개 두기" />
            </label>
            <label>
              <span className="panel-label">쪽지 (선택, 익명으로 전달)</span>
              <textarea className="pk-input" rows={2} maxLength={500} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="예: 오늘 하루도 힘내세요!" />
            </label>
            <button className="pk-btn main sm" disabled={busy}>수호천사 미션 완료 알리기</button>
          </form>
        )}
        {!next && <p className="small muted">수호천사 미션 2번을 모두 했어요. 고마워요!</p>}
        {error && <p className="error small" role="alert">{error}</p>}
      </Panel>
      <TargetPrefs receiverPid={receiverPid} targetName={name} />
    </>
  );
}

// 내 대상이 알려 준 것(좋아하는 간식, 못 먹는 음식·알레르기, 받기 곤란한 것). 대상 본인과 나(마니또), 운영진만 읽는다.
function TargetPrefs({ receiverPid, targetName }) {
  const [p, setP] = useState(undefined);
  useEffect(() => {
    getDoc(doc(db, "prefs", receiverPid)).then((s) => setP(s.exists() ? s.data() : null)).catch(() => setP(null));
  }, [receiverPid]);
  if (p === undefined) return null;
  const any = p && (p.likes || p.avoid || p.nope);
  return (
    <Panel title={`${targetName}이 알려 준 것`}>
      {!any && <p className="small muted">아직 적지 않았어요. 간식을 줄 때는 못 먹는 게 있는지 조심해 주세요.</p>}
      {p?.avoid && <p className="warn-line"><b>못 먹는 음식·알레르기</b> {p.avoid}</p>}
      {p?.likes && <p className="small"><b>좋아하는 간식·음료</b> {p.likes}</p>}
      {p?.nope && <p className="small"><b>받기 곤란한 것</b> {p.nope}</p>}
    </Panel>
  );
}

function TicketSummary({ codes, missions, entries }) {
  const { myPart, config } = useApp();
  const [redeemedSlots, setRedeemedSlots] = useState({});
  useEffect(() => {
    if (!codes) return;
    const offs = Object.entries(codes).map(([slot, code]) =>
      // 인증 안 됨: null, 인증됨: "match"(받은 것이 카드와 같음) 또는 "diff"(대상이 "카드와 달라요"로 인증 → 카드 추가분 없음)
      onSnapshot(doc(db, "redemptions", code), (s) => setRedeemedSlots((prev) => ({
        ...prev, [slot]: s.exists() && !s.data().voided ? (s.data().cardMatch === false ? "diff" : "match") : null,
      })), () => {})
    );
    return () => offs.forEach((o) => o());
  }, [codes]);

  const R = TICKET_RULES;
  const mission = Object.values(redeemedSlots).filter(Boolean).length;
  // 카드 추가분: 보통 +1, 도전 +2 (scoring.js computeTickets와 같은 기준)
  const card = Math.min(R.maxCardBonus, Object.entries(redeemedSlots)
    .filter(([, st]) => st === "match")
    .reduce((sum, [slot]) => sum + (R.cardBonus[missions.choices?.[slot]?.level] || 0), 0));
  // 끝까지 해야 받는 응모권(은신): 주차별로 인증됨 / 인증 대기(완료는 알렸는데 대상이 아직 인증 안 함) / 아직 안 함
  const slots = Object.keys(codes || {});
  const waiting = slots.filter((sl) => !redeemedSlots[sl] && missions.done?.[sl]).length;
  const notDone = slots.filter((sl) => !redeemedSlots[sl] && !missions.done?.[sl]).length;
  const allMissions = R.hiddenMinMissions >= R.maxMissions;
  const hiddenNeed = allMissions ? `미션 ${R.maxMissions}건이 모두 인증돼야` : `미션이 ${R.hiddenMinMissions}건 이상 인증돼야`;

  return (
    <Panel title="내 응모권 (지금까지)">
      <p className="ticket-count"><strong>{mission + card + entries}</strong>장</p>
      <ul className="plain tickets">
        <li>마니또로서: 인증된 미션 {mission} / {R.maxMissions} + 카드 추가분 {card} / {R.maxCardBonus}(보통 +{R.cardBonus.normal}, 도전 +{R.cardBonus.hard})</li>
        <li>받는 사람으로서: 인증 입력 {entries} / {R.maxReceiverEntries}</li>
        <li className="muted">
          마지막에 더해지는 것: 끝까지 안 들키면 +{R.hidden}
          {mission >= R.hiddenMinMissions ? "" : ` (${hiddenNeed} 받을 수 있어요)`}
          {R.hiddenNeedsClues ? "(프로필을 다 채워 단서 6개가 대상에게 가야 해요)" : ""}, 내 마니또를 맞히면 +{R.correctGuess}
          {myPart ? `, 우리 파트가 완수율 1위면 +${R.partBonus}` : ""}
        </li>
      </ul>
      {config.phase === PHASE.RUNNING && slots.length > 0 && (mission >= R.hiddenMinMissions ? (
        <p className="note" role="status">미션 {mission}건이 모두 인증됐어요. 끝까지 안 들키면 은신 +{R.hidden}장이에요.</p>
      ) : (
        <p className="warn-line" role="status">
          <b>끝까지 해야 받는 응모권</b> 은신 +{R.hidden}장은 {hiddenNeed} 받아요
          (지금 인증 {mission}건{waiting > 0 ? `, 인증 대기 ${waiting}건` : ""}{notDone > 0 ? `, 아직 안 한 미션 ${notDone}건` : ""}).
          {notDone > 0
            ? ` 여기서 멈추면 남은 미션 ${notDone}장과 은신 ${R.hidden}장, 합쳐서 ${notDone + R.hidden}장을 놓쳐요.`
            : waiting > 0 ? " 대상이 인증하면 채워져요(대상이 끝까지 인증하지 않으면 운영진이 확인해 인정할 수 있어요)." : ""}
        </p>
      ))}
      <p className="small">
        내 마니또가 미션을 안 보낸 주차(운영진이 "못 받음"으로 확인한 주차 포함)는 마지막에 인증 입력 대신 1장씩 채워져요(내 미션이 {R.compMinMissions}건 이상 인증된 경우).
        카드 추가분은 대상이 직접 인증한 미션에만 붙어요. <a href="#rules">규칙 전체 보기</a>
      </p>
    </Panel>
  );
}
