// 중도 이탈 안내 팝업의 글(src/pages/HandoverPopup.jsx). notices/{pid} = { id, kind: "giver" | "receiver", fromSlot, redo, at }.
// 이름·파트는 쓰지 않는다(사용자가 정함, 11/26: 대상에게 "같은 파트일 수 있다"를 알리면 마니또의 파트가 드러난다).
// 여기에는 Firestore를 부르는 코드가 없다(tests/logic.test.js).
// n: 이어 받은 첫 주차
export function noticeText(notice) {
  const n = Number(notice?.fromSlot) || 1;
  if (notice?.kind === "giver") {
    return {
      kicker: "운영진 안내",
      emoji: "🔄",
      title: "내 대상이 바뀌었어요",
      lead: `사정이 생겨 원래 대상이 마니또에서 빠지게 됐어요. ${n}주차부터는 새 대상을 몰래 챙겨 주세요.`,
      items: [
        "새 대상은 내 미션 탭의 \"이름 보기\"로 확인해 주세요.",
        ...(notice.redo ? [`${n}주차 미션은 새 대상에게 다시 해 주세요. 골라 둔 카드는 그대로예요.`] : []),
        "메뉴판·예고처럼 미리 알릴 게 있으면 \"완료 전에 쪽지 먼저 보내기\"로 보내고, \"미션 완료 알리기\"는 미션을 다 한 뒤에 눌러 주세요.",
        "지난 주차에 한 미션과 응모권은 그대로 인정돼요. 내 프로필 답이 새 대상에게 단서로 가요.",
      ],
      go: "mission",
      goLabel: "내 미션 보러 가기",
    };
  }
  return {
    kicker: "운영진 안내",
    emoji: "🔄",
    title: "내 마니또가 바뀌었어요",
    lead: `사정이 생겨 ${n}주차부터는 새 마니또가 나를 챙겨 줘요.`,
    items: [
      "추리 보드의 단서도 새 마니또의 답으로 바뀌었어요. 처음부터 새로 추리해 보세요.",
      "지난 주차에 받은 미션과 인증은 그대로 인정돼요.",
      `${n}주차 미션은 새 마니또가 보낼 거예요.`,
    ],
    go: "detective",
    goLabel: "추리 보드 보러 가기",
  };
}

