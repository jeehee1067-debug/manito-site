import { useMemo, useRef, useState } from "react";
import { useApp } from "../App.jsx";
import { Panel } from "../ui.jsx";
import { firebaseConfig } from "../firebase.config.js";
import { MAILTO_SAFE_LEN, inviteMessage, inviteRecipients, joinUrl, mailtoHref, profileMessage, profileRecipients } from "../lib/inviteMail.js";
import { FIRST_CLUE_DATE, PHASE, PROFILE_DUE, SCHEDULE, shortDate } from "../lib/constants.js";
import { reminderMessage, reminderTargets } from "../lib/reminders.js";

// 운영자의 회사 메일에서 보내는 안내 메일 작성기. 사이트에는 서버가 없어 직접 보내지 못한다:
// 받는 사람(숨은 참조)·제목·본문을 채운 채 메일 앱을 열거나, 칸마다 복사해 새 메일에 붙여 넣는다.
// title·children(받는 사람 설명과 고르기)은 쓰는 쪽이 정한다. initial = { subject, body }
function MailComposer({ title, emails, initial, children }) {
  const { user } = useApp();
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [copied, setCopied] = useState("");
  const refs = { to: useRef(null), subject: useRef(null), body: useRef(null) };
  const toText = emails.join("; ");
  // 본문까지 넣으면 주소가 길어(한글은 한 글자가 9자로 바뀐다) 메일 앱이 안 열리거나 잘릴 수 있다.
  // 길면 받는 사람·제목만 넣어 열고, 본문은 복사해 붙여 넣게 한다.
  const full = mailtoHref({ to: user.email || "", bcc: emails, subject, body });
  const withBody = full.length <= MAILTO_SAFE_LEN;
  const href = withBody ? full : mailtoHref({ to: user.email || "", bcc: emails, subject });

  async function copy(key, text, label) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`${label} 복사했어요.`);
    } catch {
      // 클립보드를 못 쓰는 브라우저: 칸을 선택해 둔다(Ctrl+C로 복사)
      refs[key].current?.select();
      setCopied(`${label}을(를) 선택해 뒀어요. Ctrl+C로 복사해 주세요.`);
    }
  }

  return (
    <Panel title={`${title} (받는 사람 ${emails.length}명)`}>
      {children}
      <div className="stack">
        <a className={`pk-btn main${emails.length ? "" : " disabled"}`} href={emails.length ? href : undefined} aria-disabled={!emails.length}>
          {withBody ? "메일 앱으로 열기" : "메일 앱으로 열기 (받는 사람·제목)"}
        </a>
        <p className="small muted">
          {!withBody && <><b>본문은 길어서 넣지 않고 열어요.</b> 새 메일이 열리면 아래 "본문 복사"를 눌러 본문 칸에 붙여 넣어 주세요. </>}
          메일 앱에서 받는 사람(숨은 참조)이 {emails.length}명인지 확인하고 보내 주세요.
          {href.length > MAILTO_SAFE_LEN && " 받는 사람이 많아 일부 메일 앱에서는 안 열리거나 잘릴 수 있어요. 그러면 아래 주소를 복사해 붙여 넣어 주세요."}
        </p>

        <label>
          <span className="panel-label">숨은 참조(BCC)에 붙여 넣을 주소 {emails.length}개</span>
          <textarea ref={refs.to} className="pk-input mono" rows={3} readOnly value={toText} aria-label="받는 사람 주소" />
        </label>
        <button type="button" className="pk-btn sm" disabled={!emails.length} onClick={() => copy("to", toText, `주소 ${emails.length}개를`)}>주소 복사</button>

        <label>
          <span className="panel-label">제목</span>
          <input ref={refs.subject} className="pk-input" value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} aria-label="메일 제목" />
        </label>
        <button type="button" className="pk-btn sm" onClick={() => copy("subject", subject, "제목을")}>제목 복사</button>

        <label>
          <span className="panel-label">본문 (고쳐서 보내도 돼요. 이 화면을 나가면 처음 문구로 돌아가요)</span>
          <textarea ref={refs.body} className="pk-input" rows={14} value={body} onChange={(e) => setBody(e.target.value)} aria-label="메일 본문" />
        </label>
        <div className="inline">
          <button type="button" className="pk-btn sm" onClick={() => copy("body", body, "본문을")}>본문 복사</button>
          {body !== initial.body && <button type="button" className="text-btn" onClick={() => setBody(initial.body)}>처음 문구로 되돌리기</button>}
        </div>
        {copied && <p className="note small" role="status">{copied}</p>}
      </div>
    </Panel>
  );
}

// 운영 화면 "가입 안내 메일": 명단의 아이디(회사 메일)로 가입 링크를 보낸다.
// roster: 명단 원본(운영자만 읽음)
export default function InviteMail({ roster }) {
  const [onlyNotJoined, setOnlyNotJoined] = useState(true);
  const url = joinUrl(window.location.origin, window.location.pathname);
  const initial = useMemo(() => inviteMessage({ url, senderHost: firebaseConfig.authDomain }), [url]);
  const { emails, noEmail } = inviteRecipients(roster, { onlyNotJoined });
  const joinedCount = roster.filter((r) => r.uid).length;
  return (
    <MailComposer title="가입 안내 메일" emails={emails} initial={initial}>
      <p className="small">
        명단의 아이디(회사 메일)로 가입 링크를 보내요. 사이트가 직접 보내지는 못해서 <b>내 회사 메일에서 보내요</b>.
        "메일 앱으로 열기"를 누르면 받는 사람·제목·본문이 채워진 새 메일이 열려요. 열리지 않으면 아래 칸을 하나씩 복사해 새 메일에 붙여 넣어 주세요.
        참여자는 <b>숨은 참조(BCC)</b>에 넣어 주세요(서로의 주소가 안 보이고, 전체 답장이 가지 않아요). 초대 코드는 넣지 않아도 돼요(링크로 가입하고 인증 메일로 연결돼요).
      </p>
      <div className="chip-row">
        <button className={onlyNotJoined ? "chip is-on" : "chip"} onClick={() => setOnlyNotJoined(true)}>아직 가입 안 한 사람</button>
        <button className={!onlyNotJoined ? "chip is-on" : "chip"} onClick={() => setOnlyNotJoined(false)}>명단 전원</button>
      </div>
      <p className="small">
        {onlyNotJoined ? `명단 ${roster.length}명 중 이미 가입한 ${joinedCount}명을 빼고 ${emails.length}명에게 보내요.` : `명단 ${roster.length}명 중 아이디가 있는 ${emails.length}명에게 보내요.`}
        {noEmail.length > 0 && ` 아이디가 없어 메일을 못 받는 사람: ${noEmail.join(", ")}(초대 코드로 따로 알려 주세요).`}
      </p>
      <p className="small">가입 링크: <a href={url} target="_blank" rel="noreferrer">{url}</a> (이 링크로 열면 "처음 가입" 화면이 바로 나와요)</p>
    </MailComposer>
  );
}

// 운영 화면 "프로필 작성 안내 메일": 가입은 했는데 프로필 6문항을 저장하지 않은 사람에게(사용자가 정함: "이번 주 목요일까지 작성해 달라").
// 사이트 안에서는 그 사람의 내 미션 화면에 같은 기한이 경고로 보인다(MyMission.jsx). 메일은 사이트를 안 여는 사람에게 닿으려는 것.
// progress: { pid: { profileDone } }(운영 화면이 이미 구독하고 있는 값)
export function ProfileMail({ roster, progress }) {
  const [includeUnjoined, setIncludeUnjoined] = useState(false);
  const url = window.location.origin + window.location.pathname;
  const initial = useMemo(() => profileMessage({ url, due: PROFILE_DUE ? shortDate(PROFILE_DUE) : "이번 주", clueDay: FIRST_CLUE_DATE ? shortDate(FIRST_CLUE_DATE) : "금요일" }), [url]);
  const { emails, noEmail, names } = profileRecipients(roster, progress, { includeUnjoined });
  const joined = roster.filter((r) => r.uid);
  const notDone = joined.filter((r) => !progress[r.pid]?.profileDone);
  const unjoined = roster.length - joined.length;
  return (
    <MailComposer title="프로필 작성 안내 메일" emails={emails} initial={initial}>
      <p className="small">
        프로필 6문항을 아직 저장하지 않은 사람에게 보내는 안내예요{PROFILE_DUE ? <> (기한 <b>{shortDate(PROFILE_DUE)}</b>, 첫 단서 공개 전날)</> : ""}.
        사이트가 직접 보내지는 못해서 <b>내 회사 메일에서 보내요</b>. 받는 사람은 <b>숨은 참조(BCC)</b>에 넣어 주세요.
        이 사람들의 내 미션 화면에는 같은 기한이 경고로 떠 있어요.
      </p>
      <div className="chip-row">
        <button className={!includeUnjoined ? "chip is-on" : "chip"} onClick={() => setIncludeUnjoined(false)}>가입했는데 안 채운 사람</button>
        <button className={includeUnjoined ? "chip is-on" : "chip"} onClick={() => setIncludeUnjoined(true)}>가입 안 한 사람도</button>
      </div>
      <p className="small">
        가입 {joined.length}명 중 프로필을 저장한 사람 {joined.length - notDone.length}명, <b>안 채운 사람 {notDone.length}명</b>{unjoined > 0 ? `, 가입 안 한 사람 ${unjoined}명` : ""}.
        {names.length > 0 && names.length <= 30 && ` 받는 사람: ${names.join(", ")}.`}
        {noEmail.length > 0 && ` 아이디가 없어 메일을 못 받는 사람: ${noEmail.join(", ")}.`}
        {emails.length === 0 && " 지금은 보낼 사람이 없어요."}
      </p>
    </MailComposer>
  );
}

// 운영 화면 "재촉 메일"(사용자가 정함: "아직 인증 안 해 준 경우는 필요하면 메일 보낼 수 있도록"). 미션 진행·최종 지목 단계.
//  인증 안 한 대상: 마니또가 완료를 알렸는데 아직 인증하지 않은 주차가 있는 사람(칭찬 카드 포함, 신고했거나 운영자가 확인한 주차 제외)
//  미션 안 한 마니또(미션 진행 단계만): 열린 주차 중 완료를 아직 알리지 않은 사람
// 받는 사람 모두에게 같은 글이 숨은 참조로 간다(누가 누구의 마니또인지·몇 주차인지는 본문에 없다). 계산은 lib/reminders.js.
// rows: 짝 현황(pairs.js pairRows), roster: 명단 원본
export function ReminderMail({ roster, rows, week, phase }) {
  const canMission = phase === PHASE.RUNNING;
  const [kind, setKind] = useState("verify");
  const k = canMission ? kind : "verify";
  const url = window.location.origin + window.location.pathname;
  const close = SCHEDULE.find((e) => e.kind === "close")?.date;
  const initial = useMemo(() => reminderMessage({ kind: k, url, closeDay: close ? shortDate(close) : "" }), [k, url, close]);
  const verify = reminderTargets(rows, roster, { kind: "verify", week });
  const mission = canMission ? reminderTargets(rows, roster, { kind: "mission", week }) : [];
  const targets = k === "verify" ? verify : mission;
  const emails = [...new Set(targets.map((t) => t.email).filter(Boolean))].sort();
  const noEmail = targets.filter((t) => !t.email).map((t) => t.name);
  return (
    <MailComposer key={k} title="재촉 메일" emails={emails} initial={initial}>
      <p className="small">
        사이트를 열면 그 사람 화면 맨 위에 "할 일"이 이미 떠요. 사이트를 안 여는 사람에게는 <b>내 회사 메일에서</b> 이 안내를 보내 주세요(사이트가 직접 보내지는 못해요).
        받는 사람은 <b>숨은 참조(BCC)</b>로 들어가고, 본문에는 누가 누구의 마니또인지·몇 주차인지 적지 않았어요.
      </p>
      {canMission && (
        <div className="chip-row">
          <button className={k === "verify" ? "chip is-on" : "chip"} onClick={() => setKind("verify")}>인증 안 한 대상 {verify.length}명</button>
          <button className={k === "mission" ? "chip is-on" : "chip"} onClick={() => setKind("mission")}>미션 안 한 마니또 {mission.length}명</button>
        </div>
      )}
      <p className="small">
        {k === "verify"
          ? "마니또가 완료를 알렸는데 아직 인증하지 않은 주차가 있는 사람이에요(3주차 칭찬 카드 포함, \"받은 게 없어요\"로 신고했거나 운영진이 확인한 주차는 빼요)."
          : "열린 주차 중 아직 완료를 알리지 않은 주차가 있는 사람이에요(지난 주차도 미션 마감 전까지 할 수 있어요)."}
        {" "}가입 안 한 사람과 중도 이탈로 표시한 사람은 빼요.
      </p>
      <p className="small reminder-who">
        {targets.length ? <>받는 사람: {targets.map((t) => `${t.name}(${t.slots.map((x) => `${x}주차`).join("·")})`).join(", ")}</> : "지금은 보낼 사람이 없어요."}
        {noEmail.length > 0 && ` 아이디가 없어 메일을 못 받는 사람: ${noEmail.join(", ")}.`}
      </p>
    </MailComposer>
  );
}
