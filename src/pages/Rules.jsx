import { useApp } from "../App.jsx";
import { Panel } from "../ui.jsx";
import { PRIZES, TICKET_RULES as R, SCORE_WEIGHTS as W } from "../config/prizes.js";
import { PROFILE_QUESTIONS, REVIEW_MIN, SPEND_GUIDE_WON } from "../lib/constants.js";

// 참여자에게 보여 주는 규칙. 숫자는 prizes.js·constants.js에서 가져오므로 그쪽을 바꾸면 여기도 같이 바뀐다.
// 문장으로 적은 규칙(보상·불참 처리·동점 기준)은 src/lib/scoring.js의 계산과 같아야 한다.
export default function Rules() {
  const { roster } = useApp();
  const partsInUse = roster.some((r) => r.part);
  const max = R.maxMissions * R.perRedeemedMission + R.maxHard * R.perHardMission + R.hidden + R.maxReceiverEntries * R.perReceiverEntry + R.correctGuess
    + (partsInUse ? R.partBonus : 0);
  const pct = (x) => `${Math.round(x * 100)}%`;

  return (
    <>
      <Panel title="한눈에 보기">
        <ol className="rules-list">
          <li>나는 한 사람의 <b>마니또</b>이고, 동시에 다른 누군가가 내 마니또예요.</li>
          <li><b>마니또로서</b> 매주 미션을 하나씩 해요(1·2주차는 카드 고르기, 3주차는 칭찬 카드). 대상이 인증 코드와 후기로 인증해 주면 응모권이 쌓여요.</li>
          <li><b>받는 사람으로서</b> 받은 미션을 인증하고, 매주 공개되는 단서로 내 마니또를 추리해 마지막에 지목해요.</li>
          <li>송년회에서 정체를 공개하고, 응모권으로 추첨해요.</li>
        </ol>
      </Panel>

      <Panel title={`응모권 받는 법 (최대 ${max}장)`}>
        <table className="rules-table">
          <tbody>
            <tr><th rowSpan={3}>마니또로서</th><td>내 미션이 인증될 때마다</td><td className="num">{R.perRedeemedMission}장 (최대 {R.maxMissions})</td></tr>
            <tr><td>도전 카드로 인증되면 추가로</td><td className="num">+{R.perHardMission}장 (최대 {R.maxHard})</td></tr>
            <tr><td>끝까지 안 들키면(대상이 나를 지목하지 못함). 내 미션이 {R.hiddenMinMissions}건 이상 인증된 경우만</td><td className="num">{R.hidden}장</td></tr>
            <tr><th rowSpan={2}>받는 사람으로서</th><td>받은 미션을 인증할 때마다(코드 + 후기 {REVIEW_MIN}자 이상)</td><td className="num">{R.perReceiverEntry}장 (최대 {R.maxReceiverEntries})</td></tr>
            <tr><td>내 마니또를 맞히면</td><td className="num">{R.correctGuess}장</td></tr>
            {partsInUse && (
              <tr><th>우리 파트가</th><td>마지막 집계에서 미션 완수율 1위(동률이면 모두). 내 미션이 {R.partBonusMinMissions}건 이상 인증된 파트원만</td><td className="num">{R.partBonus}장</td></tr>
            )}
          </tbody>
        </table>
        <p><b>상대방 때문에 손해 보지 않아요.</b></p>
        <ul className="rules-list">
          <li>내 마니또가 미션을 안 보낸 주차는 인증 입력 대신 {R.compPerMissedWeek}장을 받아요(인증 입력과 합쳐 최대 {R.maxReceiverEntries}장, 내 미션이 {R.compMinMissions}건 이상 인증된 사람만).</li>
          <li>내 대상이 불참(가입 안 함, 중도 이탈)이면 내가 완료를 알린 미션은 인증된 것으로 쳐요. 대상이 받고도 끝까지 인증하지 않은 경우는 운영진이 본인에게 확인한 뒤 인정할 수 있어요.</li>
          <li>받았는데 인증하지 않은 미션은 내 응모권으로 채워지지 않아요. 받으면 꼭 인증해 주세요. 마니또도 그래야 응모권을 받아요.</li>
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
            {PRIZES.tiers.map((t) => <tr key={t.key}><th>{t.label}</th><td>{t.count}명, {t.prize}</td></tr>)}
            <tr><th>{PRIZES.grand.label}</th><td>{PRIZES.grand.count}명, {PRIZES.grand.prize}</td></tr>
            <tr><th>{PRIZES.bestManito.label}</th><td>{PRIZES.bestManito.count}명, {PRIZES.bestManito.prize}</td></tr>
            <tr><th>{PRIZES.bestReview.label}</th><td>{PRIZES.bestReview.count}명, {PRIZES.bestReview.prize} (운영진이 후기 중에서 선정)</td></tr>
            <tr><th>{PRIZES.mostTickets.label}</th><td>{PRIZES.mostTickets.count}명, {PRIZES.mostTickets.prize} (동점이면 무작위)</td></tr>
          </tbody>
        </table>
        <ul className="rules-list">
          <li>추첨은 송년회 현장에서, 응모권 수에 비례해 뽑아요. 순서는 {PRIZES.tiers.map((t) => t.label.replace("응모권 추첨 ", "")).join(" → ")} → {PRIZES.grand.label}.</li>
          <li>{PRIZES.tiers.map((t) => t.label.replace("응모권 추첨 ", "")).join("·")}끼리는 중복 당첨이 없고, {PRIZES.grand.label}은 앞에서 당첨된 사람도 대상이에요.</li>
          <li>
            {PRIZES.bestManito.label}: 미션 완수율 {pct(W.completion)} + 전체 투표 {pct(W.vote)} + 운영진 평가 {pct(W.admin)}.
            투표는 받은 사람들이 남긴 후기를 익명 카드로 보고 해요{partsInUse ? "(자기 파트 카드는 안 보여요)" : ""}.
            {partsInUse && " 파트 인원이 다르면 카드마다 볼 수 있는 사람 수가 달라서, 득표는 표 수 그대로가 아니라 \"볼 수 있었던 사람들이 고르게 찍었을 때 받을 표 수\"와 비교한 비율로 계산해요."}
            {" "}동점이면 인증된 미션이 많은 쪽, 투표 점수가 높은 쪽, 운영진 평가가 높은 쪽 순이고 그래도 같으면 무작위예요.
          </li>
        </ul>
      </Panel>

      <Panel title="단서와 최종 지목">
        <ul className="rules-list">
          <li>내 프로필 {PROFILE_QUESTIONS.length}문항의 답이 내 대상에게 단서로 가요. 매주 금요일 2개씩, 모두에게 같은 시각에 공개돼요.</li>
          <li>이미 공개된 답은 바꿀 수 없어요. 사실대로 답해 주세요.</li>
          {partsInUse && <li>최종 지목이 열리면 마지막 단서로 <b>마니또의 파트</b>가 공개돼요. 이 단서는 명단에서 자동으로 만들어져요.</li>}
          <li>최종 지목은 마감 전까지 바꿀 수 있어요. 지목하지 않으면 정답 응모권이 없고, 내 마니또는 안 들킨 것으로 쳐요.</li>
        </ul>
      </Panel>

      <Panel title="미션 비용">
        <ul className="rules-list">
          <li>돈이 안 드는 카드만 골라도 응모권은 똑같아요. 도전 카드도 돈이 안 드는 것이 있어요.</li>
          <li>"소액 비용" 표시가 있는 카드는 간식·음료처럼 내 돈이 들어요. 건당 {SPEND_GUIDE_WON.toLocaleString()}원 이하를 권장해요.</li>
          <li>카드가 마음에 안 들면 "다른 카드 보기"로 같은 난이도의 다른 카드를 고를 수 있어요.</li>
        </ul>
      </Panel>

      <Panel title="지켜 주세요">
        <p className="small">아래가 확인되면 응모권·수상에서 제외될 수 있어요.</p>
        <ul className="rules-list">
          <li>송년회 공개 전에 정체를 알려주거나 캐묻기(투표 기간 포함)</li>
          <li>하지 않은 미션을 완료로 알리거나, 받지 않은 미션을 인증하기</li>
          <li>단서를 거짓으로 답하기</li>
          <li>투표 기간에 자기 카드에 표를 부탁하기</li>
        </ul>
        <p className="small">내용이 없는 후기는 운영진이 무효 처리할 수 있어요(무효가 되면 그 미션의 응모권도 빠져요).</p>
      </Panel>

      <Panel title="누가 무엇을 볼 수 있나요">
        <ul className="rules-list">
          <li><b>다른 참여자</b>: 이름·근무지{partsInUse ? "·파트" : ""}, 익명 피드의 후기{partsInUse ? ", 파트별 미션 합계" : ""}만 봐요. 내가 미션을 몇 개 했는지도 다른 참여자는 볼 수 없어요. 내 짝, 인증 코드, 단서, 쪽지, 프로필 답, 메일 주소는 볼 수 없어요.</li>
          <li><b>운영자</b>: 진행 현황(누가 미션을 몇 개 했는지, 최근 접속), 후기, 가입한 메일을 봐요. 누가 누구의 마니또인지는 투표 단계부터, 쪽지 내용은 집계 단계부터 볼 수 있어요. 프로필 답과 단서는 볼 수 없어요.</li>
          <li><b>사이트 관리 계정</b>(Firebase 콘솔): 저장된 데이터를 기술적으로 직접 열어 볼 수 있어요(서버 없이 운영하는 방식의 한계예요).</li>
        </ul>
      </Panel>
    </>
  );
}
