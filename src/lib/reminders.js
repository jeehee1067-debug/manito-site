// 재촉(사용자가 정함: "미션을 했는데 대상이 인증을 안 눌러준 경우나 아직 미션을 안 한 경우 재촉하는 알림, 인증 안 한 경우는 메일도").
// 사이트에는 서버가 없어 휴대폰 알림(푸시)은 보낼 수 없다. 대신
//  - 참여자 화면: 사이트를 열면 어느 탭에서나 맨 위에 "할 일" 줄이 뜬다(App.jsx ReminderBar ← myReminders)
//  - 운영 화면: 운영자의 회사 메일로 보내는 "재촉 메일"(InviteMail.jsx ReminderMail ← reminderTargets·reminderMessage)
// 여기에는 Firestore를 부르는 코드가 없다(tests/logic.test.js).
import { MISSION_SLOTS, PHASE } from "./constants.js";

/**
 * 참여자 본인의 할 일.
 * inbox: 내 앞으로 온 deliveries, mine: 내 인증(redemptions where receiverPid == 나, 아직 못 읽었으면 null),
 * missions: giverMissions/{나}(아직 못 읽었으면 null), week: 열린 주차, phase: 단계
 * 반환 { toVerify: [주차] — 내 마니또가 완료를 알렸는데 내가 아직 인증하지 않은 주차(인증은 단계 1~2),
 *        toDo: [주차] — 지금 열린 주차를 내가 마니또로서 아직 완료하지 않았으면 그 주차(미션은 단계 1, 지난 주차는 마감이라 넣지 않는다) }
 */
export function myReminders({ inbox = [], mine = null, missions = null, week = 1, phase }) {
  const canVerify = phase === PHASE.RUNNING || phase === PHASE.GUESSING;
  const sentSlots = [...new Set(inbox.filter((d) => (d.kind === "mission" || d.kind === "praise") && !d.hidden && d.slot <= week).map((d) => d.slot))];
  const toVerify = canVerify && mine ? sentSlots.filter((s) => !mine.some((r) => r.slot === s)).sort((a, b) => a - b) : [];
  const toDo = phase === PHASE.RUNNING && missions ? MISSION_SLOTS.filter((s) => s === week && missions.done?.[s] !== true) : [];
  return { toVerify, toDo };
}

/**
 * 운영 화면 재촉 메일의 받는 사람.
 * rows: pairs.js pairRows 결과, roster: 명단 원본(운영자만 읽음: pid, name, email, uid, dropout)
 * kind "verify": 마니또가 완료를 알렸는데 대상이 아직 인증하지 않은 주차가 있는 대상
 *   (상태 sent, 그리고 사이트가 전달한 칭찬 카드 auto — 마니또 쪽은 인정되지만 대상 본인의 인증 응모권은 인증해야 생긴다.
 *    "받은 게 없어요"로 신고했거나 운영자가 확인한 주차는 넣지 않는다)
 * kind "mission": 지금 열린 주차를 아직 완료하지 않은 마니또(지난 주차는 마감이라 넣지 않는다)
 * 가입 안 한 사람과 중도 이탈로 표시한 사람은 뺀다.
 * 반환 [{ pid, name, email, slots: [주차] }] (이름순)
 */
export function reminderTargets(rows = [], roster = [], { kind, week = 1 }) {
  const byPid = Object.fromEntries(roster.map((r) => [r.pid, r]));
  const slotsOf = new Map();
  const add = (pid, slot) => slotsOf.set(pid, [...(slotsOf.get(pid) || []), slot]);
  for (const row of rows) {
    for (const [k, s] of Object.entries(row.slots || {})) {
      const slot = Number(k);
      if (slot > week) continue;
      if (kind === "verify" && (s.status === "sent" || s.status === "auto")) add(row.receiverPid, slot);
      if (kind === "mission" && !s.done && slot === week) add(row.giverPid, slot);
    }
  }
  return [...slotsOf]
    .map(([pid, slots]) => ({ pid, name: byPid[pid]?.name || pid, email: byPid[pid]?.email || "", slots: [...new Set(slots)].sort((a, b) => a - b), r: byPid[pid] }))
    .filter((x) => x.r && x.r.uid && !x.r.dropout)
    .map(({ r, ...x }) => x)
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

/**
 * 재촉 메일 제목·본문(받는 사람 모두에게 같은 글 — 숨은 참조로 한 번에 보내므로 누구의 마니또인지·몇 주차인지 적지 않는다).
 * url: 사이트 주소, deadline: 지금 열린 주차의 미션 마감("11/24(화) 11:00", constants.js weekDeadline)
 */
export function reminderMessage({ kind, url, deadline }) {
  if (kind === "verify") {
    return {
      subject: "[S1FA 마니또] 받은 미션 인증을 기다리고 있어요",
      body: [
        "안녕하세요! 마니또가 보낸 미션이 아직 인증되지 않아 안내드려요.",
        "",
        "▶ 사이트 → \"추리 보드\" → \"인증하기\"에 쪽지에 적힌 4자리 코드와 후기(20자 이상)를 넣어 주세요.",
        "   받은 쪽지 옆 \"이 코드로 인증하기\"를 누르면 코드가 바로 들어가요.",
        `▶ 사이트: ${url}`,
        "",
        "[왜 필요한가요]",
        "- 인증해야 나의 응모권과 내 마니또의 응모권이 함께 쌓여요.",
        "- 지난 주차 미션도 최종 지목이 마감될 때까지 인증할 수 있어요.",
        "",
        "받은 것이 없거나 코드를 못 찾겠으면 추리 보드의 \"받은 게 없어요\"로 알려 주시거나 운영진에게 말씀해 주세요.",
        "(아직 인증하지 않은 분들께 함께 보내는 안내예요. 누가 마니또인지는 운영진만 알아요.)",
      ].join("\n"),
    };
  }
  return {
    subject: "[S1FA 마니또] 아직 완료를 알리지 않은 미션이 있어요",
    body: [
      "안녕하세요! 이번 주차 마니또 미션을 아직 \"완료 알리기\" 하지 않으셔서 안내드려요.",
      "",
      "▶ 사이트 → \"내 미션\"에서 카드를 고르고, 미션을 한 뒤 \"미션 완료 알리기\"를 눌러 주세요.",
      "   \"사이트 쪽지\" 카드는 쪽지 칸에 써서 보내면 끝이에요.",
      `▶ 사이트: ${url}`,
      "",
      `- 이번 주차 미션은 ${deadline || "다음 주차가 열릴 때"} 마감돼요. 마감된 주차는 나중에 몰아서 할 수 없어요.`,
      "- 미션을 하고 대상이 인증하면 내 응모권이 쌓여요.",
      "- 사정이 있어 참여가 어려우면 운영진에게 말씀해 주세요.",
      "(아직 완료하지 않은 분들께 함께 보내는 안내예요.)",
    ].join("\n"),
  };
}
