import { useEffect, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp, Loading } from "../App.jsx";
import { Panel } from "../ui.jsx";
import { PHASE } from "../lib/constants.js";
import { TICKET_RULES as R } from "../config/prizes.js";

// 파트 대항전 주간 순위. 운영자가 발표한 문서(public/board) 한 건만 읽는다.
// 실시간 숫자가 아니다: 실시간이면 미션을 받은 직후 어느 파트 숫자가 올랐는지로 마니또의 파트가 드러난다.
// 개인별 숫자는 여기 없다(다른 사람의 진행 상황은 보안 규칙이 읽지 못하게 한다). 내 것만 따로 읽어서 보여 준다.
export default function PartBoard() {
  const { myPid, myPart, config } = useApp();
  const [board, setBoard] = useState(undefined);
  const [myDone, setMyDone] = useState(null);

  useEffect(() => onSnapshot(doc(db, "public", "board"), (s) => setBoard(s.exists() ? s.data() : null), () => setBoard(null)), []);
  useEffect(() => {
    getDoc(doc(db, "progress", myPid)).then((s) => setMyDone(s.exists() ? s.data().doneCount || 0 : 0)).catch(() => {});
  }, [myPid]);

  if (board === undefined) return <Loading />;
  const parts = board?.parts || [];
  // 같은 완수율은 같은 순위(나눗셈 없이 비교)
  const rankOf = (x) => 1 + parts.filter((y) => y.done * x.max > x.done * y.max).length;
  const pct = (x) => (x.max ? Math.round((x.done / x.max) * 100) : 0);

  return (
    <>
      <Panel title={parts.length ? `파트 순위 (${board.week}주차 기준)` : "파트 순위"}>
        <p className="small">
          파트별 마니또 미션 완수율이에요. 매주 금요일 단서가 공개될 때 같이 새로 발표돼요(실시간이 아니에요).
          파트 합계만 보이고 누가 몇 개 했는지는 보이지 않아요.
        </p>
        {parts.length === 0 ? (
          <p className="muted">아직 발표된 순위가 없어요. 첫 금요일 단서 공개 때 처음 발표돼요.</p>
        ) : (
          <ol className="board">
            {parts.map((x) => (
              <li key={x.part} className={x.part === myPart ? "me" : ""}>
                <span className="board-rank">{rankOf(x)}위</span>
                <span className="board-main">
                  <span className="board-name">{x.part}{x.part === myPart && <span className="loc-tag sm">우리 파트</span>}</span>
                  <span className="board-bar" role="img" aria-label={`완수율 ${pct(x)}%`}><i style={{ width: `${pct(x)}%` }} /></span>
                </span>
                <span className="board-num"><strong>{pct(x)}%</strong><span className="small">{x.done} / {x.max} · {x.members}명</span></span>
              </li>
            ))}
          </ol>
        )}
        {board?.at?.toDate && <p className="small muted">{board.at.toDate().toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} 발표</p>}
        {myPart
          ? myDone !== null && <p className="small">나는 지금까지 미션 {myDone}건을 완료했다고 알렸어요(이 숫자는 나와 운영자만 봐요).</p>
          : <p className="small muted">내 파트가 명단에 없어서 파트 순위에는 들어가지 않아요. 운영자에게 알려 주세요.</p>}
      </Panel>

      <Panel title="우승 파트 응모권">
        <ul className="rules-list">
          <li>마지막 집계에서 <b>완수율 1위 파트</b>는 파트원 모두 응모권 +{R.partBonus}장을 받아요(동률이면 모두). 내 미션이 {R.partBonusMinMissions}건 이상 인증된 사람만 받아요.</li>
          <li>위 표는 "완료 알리기"를 누른 수로 매긴 중간 순위예요. 마지막 순위는 <b>받는 사람이 인증한 미션</b> 수로 매겨요. 받은 미션을 인증해 줘야 마니또의 파트 점수가 올라가요.</li>
          <li>완수율 = 파트의 미션 수 ÷ (가입한 파트 인원 × 주차 수). 인원이 달라도 비율로 비교해요. 가입하지 않았거나 중도 이탈한 사람은 인원에서 빠져요.</li>
        </ul>
        {config.phase >= PHASE.REVEAL && <p className="small">마지막 순위는 <a href="#reveal">결과 탭</a>에서 볼 수 있어요.</p>}
      </Panel>
    </>
  );
}
