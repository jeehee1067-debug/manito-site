import { useApp } from "../App.jsx";
import { Panel } from "../ui.jsx";
import { PRIZES, PRIZES_ANNOUNCED, TICKET_RULES as R } from "../config/prizes.js";
import { DEAL_COUNT } from "../lib/cards.js";
import { DROP_TIP, EXTRA_NOTES_MAX, PROFILE_QUESTIONS, REVIEW_MIN, SCHEDULE, SPEND_GUIDE_WON, clueScheduleText, scheduleLabel, todayYmd } from "../lib/constants.js";

// 참여자에게 보여 주는 규칙. 숫자는 prizes.js·constants.js에서 가져오므로 그쪽을 바꾸면 여기도 같이 바뀐다.
// 문장으로 적은 규칙(보상·불참 처리·동점 기준)은 src/lib/scoring.js의 계산과 같아야 한다.
export default function Rules() {
  const { roster } = useApp();
  const partsInUse = roster.some((r) => r.part);
  const max = R.maxMissions * R.perRedeemedMission + R.maxCardBonus + R.costBonus + R.hidden + R.maxReceiverEntries * R.perReceiverEntry + R.correctGuess
    + (partsInUse ? R.partBonus : 0);
  // 수호천사 응모권은 연결된 지원자만 받는다. "최대 N장"에 넣으면 모두가 받을 수 있는 것처럼 보여서 따로 적는다.
  const angelMax = R.maxAngel * R.angelPerMission;
  const rank = (p) => p.label.split(" ")[0]; // "6등 응모권 추첨" → "6등"
  // 금액·인원은 알린 상만 보인다(prizes.js PRIZES_ANNOUNCED). 나머지는 이름과 정하는 방법만.
  const announced = (p) => PRIZES_ANNOUNCED.includes(p.key);
  const prizeText = (p) => (announced(p) ? `${p.count}명, ${p.prize}` : "추후 공지");
  const HOW = {
    paper: "송년회 현장에서 종이로 추첨(응모권 1장 = 이름 종이 1장)",
    rank: "응모권이 가장 많은 사람",
    review: "익명 피드에서 공감(♥)을 가장 많이 받은 후기",
    online: "현장에서 사이트가 추첨(각자 휴대폰으로 확인)",
  };
  const paperRanks = PRIZES.tiers.filter((t) => t.how === "paper").map(rank);
  const onlineRank = PRIZES.tiers.filter((t) => t.how === "online").map(rank).join("·");
  const allMissions = R.hiddenMinMissions >= R.maxMissions;

  return (
    <>
      <Panel title="한눈에 보기">
        <ol className="rules-list">
          <li>나는 한 사람의 <b>마니또</b>이고, 동시에 다른 누군가가 내 마니또예요.</li>
          <li><b>마니또로서</b> 매주 미션을 하나씩 해요(1·2주차는 카드 고르기, 3주차는 칭찬 한 줄 + 원하면 카드 하나 더). 대상이 인증 코드와 후기로 인증해 주면 응모권이 쌓여요.</li>
          <li><b>받는 사람으로서</b> 받은 미션을 인증하고, 매주 공개되는 단서로 내 마니또를 추리해 마지막에 지목해요.</li>
          <li>12월 9일 송년회에서 정체를 공개하고, 응모권으로 시상·추첨해요. 응모권이 많을수록 상에 가까워져요.</li>
        </ol>
      </Panel>

      <Panel title="일정">
        <ul className="rules-list schedule">
          {SCHEDULE.map((e) => (
            <li key={e.date} className={e.date < todayYmd() ? "muted" : ""}>{scheduleLabel(e)}</li>
          ))}
        </ul>
        <p className="small">주차가 바뀌거나 단서가 열리는 시각은 운영진이 그날 공지로 알려 드려요.</p>
      </Panel>

      <Panel title="소소한 재미">
        <ul className="rules-list">
          <li><b>마니또에게 한마디</b>: 추리 보드에서 내 마니또에게 주차마다 한 번 익명으로 말을 걸 수 있어요. 마니또는 쪽지로 답할 수 있어요.</li>
          <li><b>주차별 추측</b>: 용의자 보드에서 매주 "지금 가장 의심되는 사람"을 남겨요. 맞았는지는 알려 주지 않고, 송년회에서 "가장 먼저 알아챈 사람"으로 발표돼요(응모권과는 상관없어요).</li>
          <li><b>공감</b>: 익명 피드의 후기에 글마다 한 번 공감할 수 있어요(취소는 안 돼요). 공감을 가장 많이 받은 후기가 {PRIZES.bestReview.label}을 받아요.</li>
          <li><b>내 마니또에게 알려 줄 것</b>: 내 프로필에 못 먹는 음식·알레르기, 좋아하는 간식을 적어 두면 내 마니또(와 수호천사)만 볼 수 있어요.</li>
          <li><b>수호천사</b>: 응모권을 더 받고 싶으면 내 미션 화면에서 "수호천사 지원하기"를 눌러 주세요(미션이 시작된 뒤부터 지원할 수 있어요). 마니또가 미션을 안 해서 아무것도 받지 못한 사람이 생기면 지원자 중 한 명이 몰래 연결돼요. <b>먼저 지원한 순서대로 자동으로</b> 연결되고 운영진이 고르지 않아요(2주차·3주차가 열릴 때, 그때까지 아무것도 받지 못한 사람에게. 지난 주차의 내 미션을 모두 완료한 지원자만, 한 사람에게 한 명씩). 연결되면 그 사람에게 미션을 {R.maxAngel}번까지 해 주고, 확인될 때마다 응모권 +{R.angelPerMission}장이에요. 도움받는 사람은 누가 수호천사인지 모르고, 송년회에서 공개돼요. 필요한 사람이 없으면 연결되지 않을 수 있어요.</li>
          <li>새 쪽지나 한마디가 오면 메뉴에 숫자가 떠요.</li>
        </ul>
      </Panel>

      <Panel title={`응모권 받는 법 (최대 ${max}장, 수호천사는 +${angelMax}장)`}>
        <table className="rules-table">
          <tbody>
            <tr><th rowSpan={4}>마니또로서</th><td>내 미션이 인증될 때마다</td><td className="num">{R.perRedeemedMission}장 (최대 {R.maxMissions})</td></tr>
            <tr><td>고른 카드가 보통이나 도전이고, 대상이 인증하면서 받은 것이 그 카드와 같다고 확인하면 추가로(대상이 "카드와 달라요"라고 하면 없음)</td><td className="num">보통 +{R.cardBonus.normal}장, 도전 +{R.cardBonus.hard}장 (합계 최대 {R.maxCardBonus})</td></tr>
            <tr><td>돈이 드는 카드("소액 비용" 표시) 미션을 대상이 인증하면서 카드와 같다고 확인하면 추가로. <b>3주 동안 한 번만</b>(여러 번 해도 {R.costBonus}장)</td><td className="num">+{R.costBonus}장</td></tr>
            <tr><td>끝까지 안 들키면(대상이 나를 지목하지 못함). {allMissions ? `내 미션 ${R.maxMissions}건이 모두 인증되고` : `내 미션이 ${R.hiddenMinMissions}건 이상 인증되고`}{R.hiddenNeedsClues ? ", 프로필을 다 채워 단서 6개가 대상에게 간 경우만" : " 경우만"}</td><td className="num">{R.hidden}장</td></tr>
            <tr><th rowSpan={2}>받는 사람으로서</th><td>받은 미션을 인증할 때마다(코드 + 후기 {REVIEW_MIN}자 이상). 수호천사가 보낸 것을 "받았어요"로 확인한 것도 쳐요</td><td className="num">{R.perReceiverEntry}장 (최대 {R.maxReceiverEntries})</td></tr>
            <tr><td>내 마니또를 맞히면</td><td className="num">{R.correctGuess}장</td></tr>
            <tr><th>수호천사 (지원자)</th><td>지원해서 연결되면, 도와준 사람이 확인한 수호천사 미션마다</td><td className="num">{R.angelPerMission}장 (최대 {R.maxAngel})</td></tr>
            {partsInUse && (
              <tr><th>우리 파트가</th><td>마지막 집계에서 미션 완수율 1위(동률이면 모두). 내 미션이 {R.partBonusMinMissions}건 이상 인증된 파트원만</td><td className="num">{R.partBonus}장</td></tr>
            )}
          </tbody>
        </table>
        <p><b>끝까지 해야 받는 것이 있어요.</b></p>
        <ul className="rules-list">
          <li>은신 {R.hidden}장은 {allMissions ? `3주 미션 ${R.maxMissions}건을 모두 한` : `미션을 ${R.hiddenMinMissions}건 이상 한`} 마니또만 받아요. 한두 번만 하고 쉬면 은신 {R.hidden}장은 받지 못해요.</li>
          <li>{PRIZES.bestManito.label}는 응모권이 가장 많은 사람이 받고, 추첨도 응모권이 많을수록 뽑힐 가능성이 커요(아래 "상품과 추첨").</li>
        </ul>
        <p><b>상대방 때문에 손해 보지 않아요.</b></p>
        <ul className="rules-list">
          <li>내 마니또가 미션을 안 보낸 주차는 인증 입력 대신 {R.compPerMissedWeek}장을 받아요(인증 입력과 합쳐 최대 {R.maxReceiverEntries}장, 내 미션이 {R.compMinMissions}건 이상 인증된 사람만).</li>
          <li>
            <b>마니또가 완료를 알렸는데 받은 게 없다면</b> 추리 보드에서 그 주차에 "받은 게 없어요"를 눌러 주세요. 운영진이 두 사람에게 확인하고 주차별로 정해요.
            <b> 못 받음</b>으로 확인되면 마니또가 안 보낸 주차와 똑같이 {R.compPerMissedWeek}장을 보상받고, <b>받았음</b>으로 확인되면 마니또의 미션으로 인정돼요.
            신고만으로는 아무것도 바뀌지 않아요. "못 받음"은 운영자가 두 사람에게 확인한 뒤에만 확정해요.
          </li>
          <li>3주차 칭찬 카드는 사이트로 전달되니, 보내면 대상이 인증하지 않아도 내 미션으로 인정돼요. 칭찬과 함께 고른 카드의 추가분은 대상이 인증하면서 카드와 같다고 확인해야 붙어요. 대상은 인증해야 자기 인증 응모권을 받아요.</li>
          <li>내 대상이 불참(가입 안 함, 중도 이탈)이면 내가 완료를 알린 미션은 인증된 것으로 쳐요. 대상이 받고도 끝까지 인증하지 않은 경우는 운영진이 확인한 뒤 주차별로 인정할 수 있어요. <b>대상이 며칠째 인증하지 않아 속상하면 운영진에게 알려 주세요</b>(운영진은 누가 누구의 마니또인지 알고 있어서 비밀은 지켜져요).</li>
          <li>이렇게 대상 불참이나 운영진 확인으로 인정된 미션은 미션 응모권 {R.perRedeemedMission}장만 받아요. <b>보통·도전 카드 추가분은 대상이 직접 인증하면서 카드를 확인한 미션에만</b> 붙어요.</li>
          <li>미션을 하면 바로 "미션 완료 알리기"를 눌러 주세요. 대상이 알림보다 먼저 코드로 인증하면 고른 카드를 못 보고 인증한 것이라, 알림이 간 뒤 대상이 추리 보드 "내가 인증한 것"에서 카드를 한 번 확인해야 카드 추가분이 붙어요.</li>
          <li>받았는데 인증하지 않은 미션은 내 응모권으로 채워지지 않아요. 받으면 꼭 인증해 주세요. 마니또도 그래야 응모권을 제대로 받아요.</li>
        </ul>
        <p className="small">응모권이 0장이면 추첨 대상이 아니에요. 가입하지 않은 사람, 중도 이탈, 수상 제외도 0장이에요.</p>
      </Panel>

      {partsInUse && (
        <Panel title="파트 대항전">
          <ul className="rules-list">
            <li>같은 파트끼리는 마니또가 되지 않아요. 내 마니또는 다른 파트 사람이에요.</li>
            <li>파트별 <b>미션 완수율</b>(파트의 미션 수 ÷ (가입한 파트 인원 × 주차 수))로 순위를 매겨요. 인원이 달라도 비율로 비교해요.</li>
            <li>"파트 순위" 탭에 매주 금요일 단서 공개 때 중간 순위가 발표돼요(완료를 알린 미션 기준, 실시간이 아니에요). 파트 합계만 보이고 누가 몇 개 했는지는 본인과 운영자만 봐요.</li>
            <li>마지막 순위는 <b>받는 사람이 인증한 미션</b>으로 매겨요. 1위 파트는 파트원 모두 응모권 +{R.partBonus}장(내 미션이 {R.partBonusMinMissions}건 이상 인증된 사람만). 수상 제외·중도 이탈은 받지 못해요.</li>
          </ul>
        </Panel>
      )}

      <Panel title="상품과 추첨">
        <table className="rules-table">
          <tbody>
            {[PRIZES.grand, PRIZES.bestManito, PRIZES.bestReview, ...PRIZES.tiers].map((p) => (
              <tr key={p.key}><th>{p.label}</th><td>{prizeText(p)}</td><td>{HOW[p.how]}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="small">"추후 공지"인 상의 금액과 인원은 정해지는 대로 알려 드려요.</p>
        <ul className="rules-list">
          <li><b>한 사람은 하나만 받아요.</b> 겹치면 큰 상을 받고, 빈 자리는 다른 사람으로 다시 채워요. 최대한 많은 사람이 받게 하려는 거예요.</li>
          <li>
            <b>종이 추첨</b>({[...paperRanks, rank(PRIZES.grand)].join("·")}): 송년회에서 모두가 보는 앞에서, 각자 응모권 수만큼 자기 이름 종이를 통에 넣고 직접 뽑아요.
            응모권이 많을수록 내 종이가 많아 뽑힐 가능성이 커요. {paperRanks.join("·")}을 먼저 뽑고(이미 상을 받은 사람이 나오면 다시 뽑아요), {rank(PRIZES.grand)}은 마지막에 뽑아요.
          </li>
          <li>{rank(PRIZES.grand)}은 이미 다른 상을 받은 사람이 뽑혀도 그대로 {rank(PRIZES.grand)}이에요. 그 사람은 {rank(PRIZES.grand)}만 받고, 받았던 자리는 다시 채워요({rank(PRIZES.bestManito)}은 다음 순위, {rank(PRIZES.bestReview)}은 다음으로 공감이 많은 후기, {paperRanks.join("·")}은 종이를 더 뽑아요).</li>
          <li>{PRIZES.bestManito.label}는 추첨이 아니에요. 응모권이 가장 많은 순서예요. 동점이면 <b>내 미션에 달린 후기가 받은 공감(♥)</b>이 많은 사람이 앞서고, 그래도 같을 때만 현장에서 정한 숫자로 가려요. 모두가 열심히 하면 동점이 많이 나오니, 받는 사람이 좋은 후기를 남길 만한 미션이 유리해요.</li>
          <li>{PRIZES.bestReview.label}은 집계할 때 공감 수로 정해요(동점이면 먼저 쓴 후기). 1위가 {rank(PRIZES.bestManito)}을 받는 사람이면 다음 순위 후기가 받아요.</li>
          <li>공감 수를 셀 때는 그 미션의 당사자 두 사람(후기를 쓴 사람과 그 미션을 한 마니또)이 누른 공감을 빼요.</li>
          <li>{onlineRank}은 인원이 많아 사이트가 뽑아요. 참석자가 부른 숫자 하나와 응모권 표만으로 정해지고(앞에서 상을 받은 사람은 빼고), 결과 탭의 "추첨 검증"으로 누구나 같은 숫자로 다시 계산해 확인할 수 있어요.</li>
        </ul>
      </Panel>

      <Panel title="단서와 최종 지목">
        <ul className="rules-list">
          <li>내 프로필 {PROFILE_QUESTIONS.length}문항의 답이 내 대상에게 단서로 가요. 매주 금요일 2개씩({clueScheduleText()}), 모두에게 같은 시각에 공개돼요.</li>
          <li>이미 공개된 답은 바꿀 수 없어요. 사실대로 답해 주세요. 운영진은 단서가 사실인지 확인할 수 있어요.</li>
          <li>프로필을 채우지 않아 단서가 안 나간 마니또는 끝까지 안 들켜도 은신 응모권이 없어요.</li>
          {partsInUse && <li>최종 지목이 열리면 마지막 단서로 <b>마니또의 파트</b>가 공개돼요. 이 단서는 명단에서 자동으로 만들어져요.</li>}
          <li>최종 지목은 마감 전까지 바꿀 수 있어요. 지목하지 않으면 정답 응모권이 없고, 내 마니또는 안 들킨 것으로 쳐요.</li>
        </ul>
      </Panel>

      <Panel title="미션 카드 난이도">
        <ul className="rules-list">
          <li><b>쉬움</b>(추가 응모권 없음): 사이트 쪽지 한 통.</li>
          <li><b>보통</b>(+{R.cardBonus.normal}장): 공들여 지어 쓰는 쪽지(시, 삼행시, O/X 퀴즈, 별명, 장점 찾기) 또는 간단한 실물(포스트잇, 간식, 음료, 핫팩).</li>
          <li><b>도전</b>(+{R.cardBonus.hard}장): 직접 만든 것을 몰래 전달하기(상장, 그림, 종이접기, 포스트잇 아트), 선물, 3일 연속 쪽지, 대상에 대해 알아내 맞혀 보기.</li>
          <li>쪽지는 사이트로 보내는 글이에요. 긴 편지는 쓰지 않아도 돼요.</li>
          <li>직접 전달하는 미션은 들킬 위험이 있는 만큼 응모권이 더 많아요. 들키지 않고 전달하는 것까지가 미션이에요.</li>
          <li><b>꿀팁</b>: {DROP_TIP}</li>
          <li><b>알아내 맞혀 보기</b> 카드는 방법이 자유예요(주변에 묻기, 관찰하기, 본인에게 슬쩍 묻기도 돼요. 대신 들킬 수 있어요). <b>맞혀야</b> 카드 추가분이 붙어요. 맞았는지는 대상이 인증할 때 "카드와 같아요"로 확인해요.</li>
          <li><b>3주차</b>에는 모두 "올해의 칭찬 한 줄"을 보내요(송년회 칭찬 벽에 나와요). 원하면 보통·도전 카드를 하나 더 골라 함께 하면 카드 추가분을 받아요.</li>
        </ul>
      </Panel>

      <Panel title="미션 비용">
        <ul className="rules-list">
          <li>"소액 비용" 표시가 있는 카드는 간식·음료처럼 내 돈이 들어요. 건당 {SPEND_GUIDE_WON.toLocaleString()}원 이하를 권장해요.</li>
          <li>돈을 쓰는 것도 정성이라, 비용 카드 미션이 인증되면 응모권 {R.costBonus}장을 더 받아요. <b>3주 동안 한 번만</b>이에요. 여러 번 하거나 비싼 것을 해도 {R.costBonus}장이니 부담 갖지 마세요.</li>
          <li>보통·도전을 고르면 두 장 중 한 장은 돈이 드는 카드, 한 장은 돈이 안 드는 카드예요. 돈을 쓰기 싫으면 안 드는 카드를 고르면 돼요. 그 밖의 응모권(미션·카드 추가분)은 돈이 들든 안 들든 똑같아요.</li>
          <li>간식을 주기 전에 내 미션 화면의 "내 대상이 알려 준 것"에서 못 먹는 음식·알레르기를 꼭 확인해 주세요.</li>
          <li>난이도를 고르면 그 난이도의 카드 {DEAL_COUNT}장이 나오고, 그중 하나를 골라요. 카드는 사람·주차마다 다르게 나오고 다시 뽑을 수는 없어요. 난이도는 완료를 알리기 전까지 다시 고를 수 있어요.</li>
          <li>카드 고르기·완료 알리기·인증은 그 주차가 열린 뒤에만 할 수 있어요. 지난 주차는 미션 진행 기간 안이면 늦게라도 할 수 있어요.</li>
          <li>미션(완료 알리기)은 12월 8일 미션 마감 때 닫혀요. 받은 미션 인증은 그 뒤에도 최종 지목이 마감되기 전까지 할 수 있어요(마감 직전에 받은 미션을 인증할 시간).</li>
          <li>완료를 알린 주차에는 "쪽지 더 보내기"로 쪽지를 더 보낼 수 있어요(주차마다 {EXTRA_NOTES_MAX}건까지). "3일 연속 응원 쪽지" 카드는 첫날 완료를 알린 뒤 이것으로 이어서 보내면 돼요.</li>
        </ul>
      </Panel>

      <Panel title="지켜 주세요">
        <p className="small">아래가 확인되면 응모권·수상에서 제외될 수 있어요.</p>
        <ul className="rules-list">
          <li>송년회 공개 전에 정체를 알려주거나 캐묻기("마니또에게 한마디"로 슬쩍 찔러보는 것은 괜찮아요)</li>
          <li>하지 않은 미션을 완료로 알리거나, 받지 않은 미션을 인증하기, 받고도 "받은 게 없어요"로 알리기</li>
          <li>내가 누구를 맡았는지 다른 사람에게 알려주거나 서로 맞춰 보기(정체를 알려주는 것과 같아요). <b>"공범" 카드로 전달을 부탁하는 한 사람만 예외</b>예요. 공범도 비밀을 지켜 주세요</li>
          <li>단서를 거짓으로 답하기</li>
          <li>내 후기에 공감을 눌러 달라고 부탁하거나 서로 눌러 주기로 짜기</li>
          <li>사이트를 일부러 반복 요청해 멈추게 하기(반복해서 저장한 기록은 누가 했는지 운영진에게 남아요)</li>
        </ul>
        <p className="small">내용이 없는 후기는 운영진이 무효 처리할 수 있어요. 무효가 되면 그 후기의 인증 응모권이 빠지고, 마니또의 미션은 운영진이 실제로 전달됐는지 확인해서 인정해요.</p>
      </Panel>

      <Panel title="누가 무엇을 볼 수 있나요">
        <ul className="rules-list">
          <li><b>다른 참여자</b>: 이름{partsInUse ? "·파트" : ""}, 익명 피드의 후기{partsInUse ? ", 파트별 미션 합계" : ""}만 봐요. 익명 피드의 글에는 누가 썼는지(받는 사람)가 저장돼 있지 않아요. 내가 미션을 몇 개 했는지도 다른 참여자는 볼 수 없어요. 내 짝, 인증 코드, 쪽지, 메일 주소, 누가 어떤 후기에 공감했는지는 볼 수 없어요. 내 프로필 답은 내 대상에게만 매주 단서로 공개돼요.</li>
          <li><b>내 마니또</b>: 내가 입력한 인증(코드·후기)은 나와 그 미션을 보낸 마니또만 다시 볼 수 있어요. "내 마니또에게 알려 줄 것"과 "마니또에게 한마디"도 내 마니또만 봐요("내 마니또에게 알려 줄 것"은 나에게 연결된 수호천사도 봐요).</li>
          <li><b>운영자·공동 운영자</b>: 마니또에 참여하지 않는 계정이에요. 그래서 누가 누구의 마니또인지, 주차별 진행 상황, 최종 지목과 주차별 추측, 수호천사 지원·연결과 수호천사 미션, 후기, 쪽지(괴롭힘 확인용)와 마니또에게 한마디, 단서(거짓 단서 확인용), 내 마니또에게 알려 줄 것, 공감 표시, 가입한 메일을 처음부터 볼 수 있어요. 프로필 답도 볼 수 있어요. 기분 나쁜 쪽지는 추리 보드에서 "이 쪽지 신고"로 알려 주세요.</li>
        </ul>
      </Panel>
    </>
  );
}
