import { useEffect, useMemo, useState } from "react";
import { collection, documentId, limit, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { Dialogue, Panel } from "../ui.jsx";

// 읽기 줄이기: 전체 후기 대신 최근 PAGE건씩, 답장은 화면에 나온 후기 것만 읽는다.
const PAGE = 30;
const IN_LIMIT = 30; // Firestore "in" 조건에 넣을 수 있는 최대 개수

export default function Feed() {
  const [count, setCount] = useState(PAGE);
  const [docs, setDocs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [thanks, setThanks] = useState({});

  useEffect(() => {
    const q = query(collection(db, "redemptions"), orderBy("createdAt", "desc"), limit(count));
    return onSnapshot(q, (s) => {
      setDocs(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoaded(true);
    });
  }, [count]);

  const items = docs.filter((r) => !r.voided);
  const hasMore = docs.length >= count;
  const idKey = items.map((r) => r.id).join(",");

  const chunks = useMemo(() => {
    const ids = idKey ? idKey.split(",") : [];
    const out = [];
    for (let i = 0; i < ids.length; i += IN_LIMIT) out.push(ids.slice(i, i + IN_LIMIT));
    return out;
  }, [idKey]);

  useEffect(() => {
    const offs = chunks.map((ids) =>
      onSnapshot(query(collection(db, "thanks"), where(documentId(), "in", ids)), (s) =>
        setThanks((prev) => ({ ...prev, ...Object.fromEntries(s.docs.map((d) => [d.id, d.data().text])) }))
      )
    );
    return () => offs.forEach((o) => o());
  }, [chunks]);

  return (
    <Panel title="익명 피드">
      <p className="small">누가 누구에게 했는지는 송년회까지 비밀이에요. 최근 것부터 {PAGE}건씩 보여요.</p>
      {loaded && items.length === 0 && <p className="muted">첫 인증이 올라오면 여기에 보여요.</p>}
      <div className="stack">
        {items.map((r) => (
          <Dialogue key={r.id} speaker={r.slot === 3 ? "칭찬 카드 받은 사람" : `${r.slot}주차 미션 받은 사람`}>
            <p>{r.review}</p>
            {thanks[r.id] && <p className="small reply">마니또에게 보낸 답장: {thanks[r.id]}</p>}
          </Dialogue>
        ))}
      </div>
      {hasMore && <button className="pk-btn" onClick={() => setCount((c) => c + PAGE)}>더 보기</button>}
    </Panel>
  );
}
