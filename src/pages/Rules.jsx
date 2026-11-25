import { useApp } from "../App.jsx";
import { Giver, Panel, Target } from "../ui.jsx";
import { GOLD_DRAW, PRIZES, PRIZES_ANNOUNCED, TICKET_RULES as R } from "../config/prizes.js";
import { DEAL_COUNT } from "../lib/cards.js";
import { CARD_HOW, DROP_TIP, EXTRA_NOTES_MAX, MISSION_CARDS, PROFILE_QUESTIONS, REVIEW_EDITS_MAX, REVIEW_MIN, SCHEDULE, SPEND_GUIDE_WON, clueScheduleText, daysBetween, shortDate, todayYmd, weekDeadline } from "../lib/constants.js";

// 낱말 정의(규칙 탭 맨 위. 사용자가 정함: "내가 누군가의 마니또이고 대상도 마니또라는 개념이 헷갈리는 분이 있다").
// 마니또 = 챙겨 주는 쪽, 대상 = 받는 쪽. 한 사람이 두 역할을 다 한다는 것과 어느 탭이 어느 역할인지를 적는다.
function Roles() {
  return (
    <Panel title="마니또와 대상">
      <div className="role-defs">
        <div className="role-def role-def-giver">
          <p className="role-def-word"><Giver /></p>
          <p className="role-def-mean">몰래 챙겨 주는 사람</p>
          <p className="small">미션을 <b>하는</b> 쪽</p>
        </div>
        <div className="role-def role-def-target">
          <p className="role-def-word"><Target /></p>
          <p className="role-def-mean">마니또가 챙겨 주는 사람</p>
          <p className="small">미션을 <b>받는</b> 쪽</p>
        </div>
      </div>
      <p className="role-flow chain" aria-label="내 마니또가 나에게 미션을 하고, 나는 내 대상에게 미션을 해요">
        <Giver>내 마니또 ?</Giver><span className="role-arrow">미션 ▶</span><span className="role-me">나</span><span className="role-arrow">미션 ▶</span><Target>내 대상</Target>
      </p>
      <ul className="rules-list">
        <li>나는 <b>두 역할을 모두</b> 해요. 내 마니또와 내 대상은 서로 다른 사람이에요.</li>
        <li><b>마니또로서</b>: <Target>내 대상</Target>에게 매주 몰래 미션을 해요 → <b>내 미션</b> 탭</li>
        <li><b>대상으로서</b>: <Giver>내 마니또</Giver>가 보낸 미션을 인증하고, 단서로 누구인지 추리해요 → <b>추리 보드</b> 탭</li>
        <li><b>인증 코드도 두 가지</b>예요. 내 미션 탭의 코드는 내가 내 대상에게 주는 코드, 추리 보드에 넣는 코드는 내 마니또가 쪽지로 보낸 코드예요.</li>
      </ul>
    </Panel>
  );
}

// 일정 타임라인(규칙 탭에서 낱말 정의 다음). 지난 일정은 흐리게 ✔, 오늘 일정은 "오늘", 가장 가까운 다음 일정은 "다음 D-n".
// 날짜는 이 기기의 오늘 기준이다(운영 단계와 무관 — 운영진이 그날 버튼을 누르는 시각은 공지로 알린다).
const KIND_LABEL = { join: "가입", week: "미션", clue: "단서", close: "마감", party: "송년회" };
function Timeline() {
  const today = todayYmd();
  const next = SCHEDULE.find((e) => e.date > today);
  const todays = SCHEDULE.filter((e) => e.date === today);
  const over = today > SCHEDULE[SCHEDULE.length - 1].date;
  return (
    <Panel title="일정 한눈에">
      <p className="small tl-now">
        오늘은 <b>{shortDate(today)}</b>
        {todays.length > 0 && <> · 오늘 일정: <b>{todays.map((e) => e.text).join(", ")}</b></>}
        {next && <> · 다음 일정: <b>{shortDate(next.date)}{next.time ? ` ${next.time}` : ""} {next.text}</b> ({daysBetween(today, next.date)}일 뒤)</>}
        {over && <> · 모든 일정이 끝났어요.</>}
      </p>
      <ol className="timeline">
        {SCHEDULE.map((e) => {
          const state = e.date < today ? "past" : e.date === today ? "today" : e === next ? "next" : "later";
          return (
            <li key={e.date} className={`tl-${state} tl-kind-${e.kind}`}>
              <span className="tl-date">{shortDate(e.date)}{e.time && <small className="tl-time"> {e.time}</small>}</span>
              <span className="tl-dot" aria-hidden="true">{state === "past" ? "✔" : ""}</span>
              <span className="tl-body">
                <span className="tl-tag">{KIND_LABEL[e.kind]}</span>
                {state === "today" && <span className="tl-badge today">오늘</span>}
                {state === "next" && <span className="tl-badge next">다음 · D-{daysBetween(today, e.date)}</span>}
                {state === "past" && <span className="sr-only">(지남) </span>}
                <span className="tl-text">{e.text}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="small">주차가 바뀌거나 단서가 열리는 시각은 운영진이 그날 공지로 알려 드려요.</p>
    </Panel>
  );
}

// 참여자에게 보여 주는 규칙(사용자가 정함, 11/23: "가장 쉽고 명확하게 정리"). 숫자는 prizes.js·constants.js에서 가져오므로 그쪽을 바꾸면 여기도 같이 바뀐다.
// 문장으로 적은 규칙(보상·불참 처리·동점 기준)은 src/lib/scoring.js의 계산과 같아야 한다. 패널 순서: 낱말 → 일정 → 매주 할 일 → 카드 → 새 카드·황금 카드
// → 응모권 → 상품 → 단서 → 파트 → 재미 → 지켜 주세요 → 누가 무엇을 보나.
// 2~6등의 금액·인원은 적지 않는다(PRIZES_ANNOUNCED. 사용자가 정함). E2E(flow.cjs "규칙 탭")가 패널 제목과 몇몇 문장을 확인한다.
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
    paper: "송년회 현장 종이 추첨",
    rank: "응모권이 가장 많은 사람",
    review: "공감(♥)을 가장 많이 받은 후기",
    online: "현장에서 사이트가 추첨",
  };
  const paperRanks = PRIZES.tiers.filter((t) => t.how === "paper").map(rank);
  const onlineRank = PRIZES.tiers.filter((t) => t.how === "online").map(rank).join("·");
  const newCards = Object.values(MISSION_CARDS).flat().filter((c) => (c.from || 1) >= 2 && !c.gold);
  const goldNames = MISSION_CARDS.hard.filter((c) => c.gold && !c.remoteOnly).map((c) => c.name);
  const ticket = (lv) => R.perRedeemedMission + (R.cardBonus[lv] || 0);

  return (
    <>
      <Roles />

      <Timeline />

      <Panel title="매주 이렇게 해요">
        <ol className="rules-list">
          <li><b>내 미션</b> 탭에서 난이도를 고르면 카드 {DEAL_COUNT}장이 나와요. 하나를 골라 미션을 하고 <b>"미션 완료 알리기"</b>를 눌러요.</li>
          <li>내 마니또에게 미션을 받으면 <b>추리 보드</b>의 "인증하기"에 쪽지의 <b>인증 코드</b>와 <b>후기({REVIEW_MIN}자 이상)</b>를 넣어요.</li>
          <li>매주 금요일에 내 마니또의 단서가 2개씩 열려요. 마지막에 내 마니또가 누구인지 지목해요.</li>
          <li>12월 9일 송년회에서 정체를 공개하고, 응모권으로 시상·추첨해요.</li>
        </ol>
      </Panel>

      <Panel title="미션 카드">
        <table className="rules-table">
          <thead><tr><th>난이도</th><th>어떤 미션</th><th>응모권</th></tr></thead>
          <tbody>
            <tr><th>쉬움</th><td>사이트 쪽지 한 통</td><td className="num">{ticket("easy")}장</td></tr>
            <tr><th>보통</th><td>공들여 쓴 쪽지(시·삼행시·퀴즈 등), 간식·음료·포스트잇</td><td className="num">{ticket("normal")}장</td></tr>
            <tr><th>도전</th><td>직접 만든 것·선물을 몰래 전달, 3일 연속 쪽지, 알아내 맞혀 보기</td><td className="num">{ticket("hard")}장</td></tr>
          </tbody>
        </table>
        <ul className="rules-list">
          <li>응모권은 <b>대상이 인증했을 때</b> 받아요. 보통·도전의 추가분(+{R.cardBonus.normal}·+{R.cardBonus.hard})은 대상이 인증하면서 <b>"카드와 같아요"</b>를 확인해야 붙어요.</li>
          <li>
            <span className="how-tag how-site">{CARD_HOW.site.label}</span> 카드는 사이트 쪽지 칸에 써서 보내면 끝이에요(종이 쪽지는 필요 없어요).{" "}
            <span className="how-tag how-real">{CARD_HOW.real.label}</span> 카드는 실물을 직접 두거나 건네요. 들키지 않고 전달하는 것까지가 미션이에요.
          </li>
          <li>
            <span className="cost-tag">소액 비용</span> 카드는 내 돈이 들어요({SPEND_GUIDE_WON.toLocaleString()}원 이하 권장). 보통·도전 {DEAL_COUNT}장 중 한 장은 돈이 안 드는 카드예요.
            비용 카드 미션이 인증되면 +{R.costBonus}장인데, <b>3주 동안 한 번만</b>이에요.
          </li>
          <li><b>마감</b>: 카드 고르기와 완료 알리기는 그 주에만 돼요(1주차 {weekDeadline(1)?.label}, 2주차 {weekDeadline(2)?.label}, 3주차 {weekDeadline(3)?.label}). 지난 주를 몰아서 할 수 없어요. 받은 미션 인증은 지난 주차도 최종 지목 마감까지 돼요.</li>
          <li>미션을 하면 바로 "미션 완료 알리기"를 눌러 주세요. 대상이 알림보다 먼저 인증하면 카드를 한 번 더 확인해야 추가분이 붙어요.</li>
          <li><b>3주차</b>에는 모두 "올해의 칭찬 한 줄"을 보내요(송년회 칭찬 벽에 나와요). 원하면 카드도 하나 더 골라요.</li>
          <li><b>알아내 맞혀 보기</b>는 방법이 자유예요(대신 들킬 수 있어요). 맞혀야 추가분이 붙어요.</li>
          <li>완료한 주에는 "쪽지 더 보내기"로 쪽지를 더 보낼 수 있어요(주마다 {EXTRA_NOTES_MAX}건). "3일 연속" 카드는 이걸로 이어 보내요.</li>
          <li>메뉴판·예고처럼 미션 전에 알릴 게 있으면 <b>"완료 전에 쪽지 먼저 보내기"</b>로 보내고, "미션 완료 알리기"는 미션을 다 한 뒤에 눌러요(같은 {EXTRA_NOTES_MAX}건 안에서, 인증 코드는 완료 알리기 때 가요).</li>
          <li>간식을 주기 전에 "내 대상이 알려 준 것"에서 알레르기를 꼭 확인해 주세요. <b>꿀팁</b>: {DROP_TIP}</li>
        </ul>
      </Panel>

      <Panel title="2주차부터: 새 카드와 ✨ 황금 카드">
        <ul className="rules-list">
          <li><b>새 카드</b>: 쉬움·보통에 새 카드가 들어와요({newCards.map((c) => c.name).join(", ")}). 카드 {DEAL_COUNT}장 중 한 장이 <span className="new-tag">NEW</span> 새 카드예요.</li>
          <li><b>✨ 황금 카드</b>: 난이도 칸 옆의 "✨ 황금 카드"를 누르면 황금 카드 {DEAL_COUNT}장({goldNames.join(", ")})이 나와요. 특별한 도전 미션이고 <b>응모권은 도전과 같아요</b>({ticket("hard")}장).</li>
          <li><b>커피 쿠폰 추첨</b>: 그 주가 끝나면, 황금 카드를 하고 대상이 "카드와 같아요"로 인증한 마니또 중 <b>매주 {GOLD_DRAW.perWeek}명</b>을 뽑아 <b>{GOLD_DRAW.prize}</b>을 드려요({GOLD_DRAW.weeks.join("·")}주차, 송년회에서 발표하며 전달).</li>
          <li>황금 카드 {DEAL_COUNT}장 중 한 장은 돈이 안 드는 카드라, 돈을 쓰지 않아도 추첨 기회는 같아요. 비용 카드 +{R.costBonus}장은 그대로 3주 동안 한 번만이에요.</li>
          <li>뽑혔는지는 추첨 뒤 <b>내 미션 화면에서 나만</b> 볼 수 있어요. 송년회 전까지는 비밀로 해 주세요(황금 카드를 받은 대상이 마니또를 좁힐 수 있어요).</li>
          <li>{GOLD_DRAW.weeks[0]}주차에 뽑힌 사람은 {GOLD_DRAW.weeks[1]}주차 추첨에서 빠져요. 추첨 대상이 {GOLD_DRAW.perWeek}명보다 적으면 모두 당첨되고, 남은 쿠폰은 다음 주로 넘어가요.</li>
        </ul>
      </Panel>

      <Panel title={`응모권 받는 법 (최대 ${max}장, 수호천사는 +${angelMax}장)`}>
        <table className="rules-table">
          <tbody>
            <tr><th rowSpan={4}>마니또</th><td>내 미션이 인증될 때마다</td><td className="num">{R.perRedeemedMission}장 (최대 {R.maxMissions})</td></tr>
            <tr><td>보통·도전 카드를 대상이 "카드와 같아요"로 인증하면</td><td className="num">+{R.cardBonus.normal}·+{R.cardBonus.hard}장</td></tr>
            <tr><td>비용 카드 미션이 그렇게 인증되면(3주 동안 한 번)</td><td className="num">+{R.costBonus}장</td></tr>
            <tr><td>끝까지 안 들키면. 내 미션 {R.maxMissions}건이 모두 인증되고{R.hiddenNeedsClues ? " 프로필 단서 6개를 다 낸 경우만" : " 경우만"}</td><td className="num">{R.hidden}장</td></tr>
            <tr><th rowSpan={2}>대상</th><td>받은 미션을 인증할 때마다</td><td className="num">{R.perReceiverEntry}장 (최대 {R.maxReceiverEntries})</td></tr>
            <tr><td>내 마니또를 맞히면</td><td className="num">{R.correctGuess}장</td></tr>
            <tr><th>수호천사</th><td>지원해서 연결되면, 확인된 미션마다</td><td className="num">{R.angelPerMission}장 (최대 {R.maxAngel})</td></tr>
            {partsInUse && <tr><th>우리 파트</th><td>마지막 집계에서 미션 완수율 1위(동률이면 모두)</td><td className="num">{R.partBonus}장</td></tr>}
          </tbody>
        </table>
        <p><b>상대방 때문에 손해 보지 않아요</b></p>
        <ul className="rules-list">
          <li>내 마니또가 미션을 안 보낸 주는 {R.compPerMissedWeek}장을 받아요(인증과 합쳐 최대 {R.maxReceiverEntries}장, 내 미션이 {R.compMinMissions}건 이상 인증된 사람만).</li>
          <li>마니또가 완료를 알렸는데 받은 게 없으면 추리 보드에서 <b>"받은 게 없어요"</b>를 눌러 주세요. 운영진이 두 사람에게 확인해서 "못 받음"이면 {R.compPerMissedWeek}장 보상, "받았음"이면 마니또의 미션으로 인정해요.</li>
          <li>대상이 며칠째 인증하지 않으면 운영진에게 알려 주세요. 확인되면 미션 {R.perRedeemedMission}장은 인정돼요(카드 추가분은 대상이 직접 인증한 미션에만 붙어요). 대상이 불참(가입 안 함·중도 이탈)이면 완료를 알린 미션은 인정돼요.</li>
          <li>3주차 칭찬 한 줄은 사이트로 전달되니, 대상이 인증하지 않아도 미션으로 인정돼요.</li>
        </ul>
        <p className="small">가입하지 않은 사람, 중도 이탈, 수상 제외는 응모권 0장이에요.</p>
      </Panel>

      <Panel title="상품과 추첨">
        <table className="rules-table">
          <tbody>
            {[PRIZES.grand, PRIZES.bestManito, PRIZES.bestReview, ...PRIZES.tiers].map((p) => (
              <tr key={p.key}><th>{p.label}</th><td>{prizeText(p)}</td><td>{HOW[p.how]}</td></tr>
            ))}
          </tbody>
        </table>
        <ul className="rules-list">
          <li><b>한 사람은 하나만 받아요.</b> 겹치면 큰 상을 받고, 빈 자리는 다시 채워요.</li>
          <li><b>종이 추첨</b>({[...paperRanks, rank(PRIZES.grand)].join("·")}): 송년회에서 각자 응모권 수만큼 자기 이름 종이를 통에 넣고 직접 뽑아요. {paperRanks.join("·")}을 먼저 뽑고, {rank(PRIZES.grand)}은 마지막에 뽑아요({rank(PRIZES.grand)}은 이미 상을 받은 사람이 뽑혀도 {rank(PRIZES.grand)}이고, 그 사람의 원래 자리는 다시 채워요).</li>
          <li><b>{PRIZES.bestManito.label}</b>: 응모권이 가장 많은 순서예요. 동점이면 내 미션에 달린 후기가 받은 공감, 그래도 같으면 현장에서 정한 숫자로 가려요.</li>
          <li><b>{PRIZES.bestReview.label}</b>: 익명 피드에서 공감을 가장 많이 받은 후기예요. 그 미션의 두 사람(후기를 쓴 사람과 마니또)이 누른 공감은 빼고, 동점이면 먼저 쓴 후기예요.</li>
          <li><b>{onlineRank}</b>: 인원이 많아 사이트가 뽑아요. 결과 탭의 "추첨 검증"으로 누구나 다시 계산해 볼 수 있어요.</li>
          <li>"추후 공지"인 상의 금액과 인원은 정해지는 대로 알려 드려요.</li>
        </ul>
      </Panel>

      <Panel title="단서와 최종 지목">
        <ul className="rules-list">
          <li>내 프로필 {PROFILE_QUESTIONS.length}문항의 답이 내 대상에게 단서로 가요. 매주 금요일 2개씩, 모두 같은 시각에 열려요({clueScheduleText()}).</li>
          <li>공개된 답은 바꿀 수 없어요. 사실대로 답해 주세요. 프로필을 다 채우지 않으면 은신 응모권이 없어요.</li>
          {partsInUse && <li>최종 지목이 열리면 마지막 단서로 <b>마니또의 파트</b>가 공개돼요.</li>}
          <li>지목은 마감 전까지 바꿀 수 있어요. 지목하지 않으면 정답 응모권이 없어요.</li>
        </ul>
      </Panel>

      {partsInUse && (
        <Panel title="파트 대항전">
          <ul className="rules-list">
            <li>같은 파트끼리는 마니또가 되지 않아요.</li>
            <li>"파트 순위" 탭에 매주 금요일 중간 순위가 나와요. 미션 완수율(파트의 미션 수 ÷ 가입한 파트 인원 × 주차 수)로 비교해요.</li>
            <li>마지막 순위는 대상이 인증한 미션으로 매기고, 1위 파트의 파트원은 +{R.partBonus}장이에요(내 미션이 {R.partBonusMinMissions}건 이상 인증된 사람만).</li>
          </ul>
        </Panel>
      )}

      <Panel title="소소한 재미">
        <ul className="rules-list">
          <li><b>마니또에게 한마디</b>: 추리 보드에서 주마다 한 번, 내 마니또에게 익명으로 말을 걸 수 있어요.</li>
          <li><b>주차별 추측</b>: 매주 의심되는 사람을 남기면, 송년회에서 "가장 먼저 알아챈 사람"이 발표돼요(응모권과는 상관없어요).</li>
          <li><b>공감</b>: 피드의 후기마다 한 번 누를 수 있어요(취소는 안 돼요).</li>
          <li><b>후기·답장 고치기</b>: 추리 보드 "내가 인증한 것"에서 집계 전까지 합쳐서 {REVIEW_EDITS_MAX}번 고칠 수 있어요. 운영진이 가리거나 지우면 그 이유가 나에게만 보이고, 다시 쓸 수 있어요. <b>후기·답장에 사람 이름은 쓰지 말아 주세요.</b></li>
          <li><b>내 마니또에게 알려 줄 것</b>: 내 프로필에 못 먹는 음식·알레르기·좋아하는 간식을 적으면 내 마니또만 봐요.</li>
          <li><b>수호천사</b>: 내 미션 화면에서 지원해요. 마니또가 미션을 안 해서 아무것도 못 받은 사람이 생기면, <b>먼저 지원한 순서대로</b> 자동 연결돼요(2·3주차가 열릴 때, 지난 주 내 미션을 다 한 지원자만). 확인된 미션마다 +{R.angelPerMission}장(최대 {R.maxAngel}장)이고, 송년회에서 공개돼요.</li>
        </ul>
      </Panel>

      <Panel title="지켜 주세요">
        <p className="small">확인되면 응모권·수상에서 제외될 수 있어요.</p>
        <ul className="rules-list">
          <li>송년회 전에 정체를 알려 주거나 캐묻기</li>
          <li>내가 누구를 맡았는지 알려 주거나 서로 맞춰 보기(<b>"공범" 카드로 전달을 부탁하는 한 사람만 예외</b>, 공범도 비밀 유지)</li>
          <li>하지 않은 미션을 완료로 알리기, 받지 않은 미션을 인증하기, 받고도 "받은 게 없어요" 누르기</li>
          <li>단서를 거짓으로 답하기</li>
          <li>공감을 눌러 달라고 부탁하거나 서로 눌러 주기로 짜기</li>
          <li>사이트를 일부러 반복 요청해 멈추게 하기</li>
        </ul>
        <p className="small">내용 없는 후기는 운영진이 무효 처리할 수 있어요(그 인증의 응모권이 빠져요).</p>
      </Panel>

      <Panel title="누가 무엇을 볼 수 있나요">
        <ul className="rules-list">
          <li><b>다른 참여자</b>: 이름{partsInUse ? "·파트" : ""}, 익명 피드{partsInUse ? ", 파트별 합계" : ""}만 봐요. 피드 글에는 쓴 사람이 저장되지 않아요. 내 짝, 코드, 쪽지, 메일, 누가 공감했는지는 못 봐요.</li>
          <li><b>내 마니또</b>: 내가 넣은 인증(코드·후기), 내가 알려 준 것, 마니또에게 한마디를 봐요(알려 준 것은 연결된 수호천사도).</li>
          <li><b>운영진</b>: 참여하지 않는 계정이라 누가 누구의 마니또인지, 진행 상황, 쪽지·후기·단서 등을 확인할 수 있어요(문제 확인용). 기분 나쁜 쪽지는 추리 보드에서 "이 쪽지 신고"로 알려 주세요.</li>
        </ul>
      </Panel>
    </>
  );
}
