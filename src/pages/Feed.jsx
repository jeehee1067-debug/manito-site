import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "../firebase.js";
import { Dialogue, Panel } from "../ui.jsx";

export default function Feed() {
  const [items, setItems] = useState([]);
  const [thanks, setThanks] = useState({});

  useEffect(() => {
    const offs = [
      onSnapshot(collection(db, "redemptions"), (s) =>
        setItems(
          s.docs
            .map((d) => ({ id: d.id, ...d.data() }))
            .filter((r) => !r.voided)
            .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        )
      ),
      onSnapshot(collection(db, "thanks"), (s) => setThanks(Object.fromEntries(s.docs.map((d) => [d.id, d.data().text])))),
    ];
    return () => offs.forEach((o) => o());
  }, []);

  return (
    <Panel title={`익명 피드 (${items.length}건)`}>
      <p className="small">누가 누구에게 했는지는 송년회까지 비밀이에요.</p>
      {items.length === 0 && <p className="muted">첫 인증이 올라오면 여기에 보여요.</p>}
      <div className="stack">
        {items.map((r) => (
          <Dialogue key={r.id} speaker={r.slot === 3 ? "칭찬 카드 받은 사람" : `${r.slot}주차 미션 받은 사람`}>
            <p>{r.review}</p>
            {thanks[r.id] && <p className="small reply">마니또에게 보낸 답장: {thanks[r.id]}</p>}
          </Dialogue>
        ))}
      </div>
    </Panel>
  );
}
