import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "../firebase.js";
import { Dialogue, Panel } from "../ui.jsx";

// 익명 피드. 인증 문서(redemptions)가 아니라 따로 만든 feed 문서를 읽는다.
// feed 문서에는 받는 사람 정보도 인증 코드도 없다({ slot, review, voided, createdAt, thanks? }, 문서 ID는 무작위).
// 인증 문서는 인증한 사람·그 코드의 마니또·운영자만 읽을 수 있다(보안 규칙).
// 읽기 줄이기: 최근 PAGE건씩. 감사 답장은 같은 문서에 들어 있어서 따로 읽지 않는다.
const PAGE = 30;

export default function Feed() {
  const [count, setCount] = useState(PAGE);
  const [docs, setDocs] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "feed"), orderBy("createdAt", "desc"), limit(count));
    return onSnapshot(q, (s) => {
      setDocs(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoaded(true);
    }, () => setLoaded(true));
  }, [count]);

  const items = docs.filter((r) => !r.voided);
  const hasMore = docs.length >= count;

  return (
    <Panel title="익명 피드">
      <p className="small">누가 누구에게 했는지는 송년회까지 비밀이에요. 최근 것부터 {PAGE}건씩 보여요.</p>
      {loaded && items.length === 0 && <p className="muted">첫 인증이 올라오면 여기에 보여요.</p>}
      <div className="stack">
        {items.map((r) => (
          <Dialogue key={r.id} speaker={r.slot === 3 ? "칭찬 카드 받은 사람" : `${r.slot}주차 미션 받은 사람`}>
            <p>{r.review}</p>
            {r.thanks && <p className="small reply">마니또에게 보낸 답장: {r.thanks}</p>}
          </Dialogue>
        ))}
      </div>
      {hasMore && <button className="pk-btn" onClick={() => setCount((c) => c + PAGE)}>더 보기</button>}
    </Panel>
  );
}
