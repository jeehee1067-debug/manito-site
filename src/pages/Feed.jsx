import { useEffect, useState } from "react";
import { collection, doc, getDocs, increment, limit, onSnapshot, orderBy, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import { PHASE } from "../lib/constants.js";
import { Dialogue, Panel } from "../ui.jsx";

// 익명 피드. 인증 문서(redemptions)가 아니라 따로 만든 feed 문서를 읽는다.
// feed 문서에는 받는 사람 정보도 인증 코드도 없다({ slot, review, voided, createdAt, thanks?, hidden?, likes? }, 문서 ID는 무작위).
// 인증 문서는 인증한 사람·그 코드의 마니또·운영자만 읽을 수 있다(보안 규칙).
// 읽기 줄이기: 최근 PAGE건씩. 감사 답장은 같은 문서에 들어 있어서 따로 읽지 않는다.
const PAGE = 30;

export default function Feed() {
  const { myPid, config } = useApp();
  const [count, setCount] = useState(PAGE);
  // 내가 공감한 글(본인만 읽는다). 글마다 한 번만, 취소는 없다(쓰기 반복 방지).
  const [liked, setLiked] = useState(new Set());
  const canLike = Boolean(myPid) && config.phase >= PHASE.RUNNING && config.phase <= PHASE.SCORING;
  useEffect(() => {
    if (!myPid) return;
    getDocs(query(collection(db, "feedLikes"), where("pid", "==", myPid)))
      .then((s) => setLiked(new Set(s.docs.map((d) => d.data().feedId)))).catch(() => {});
  }, [myPid]);
  async function like(id) {
    if (liked.has(id)) return;
    setLiked((x) => new Set(x).add(id));
    const b = writeBatch(db);
    b.update(doc(db, "feed", id), { likes: increment(1) });
    b.set(doc(db, "feedLikes", `${id}_${myPid}`), { pid: myPid, feedId: id, at: serverTimestamp() });
    await b.commit().catch(() => setLiked((x) => { const y = new Set(x); y.delete(id); return y; }));
  }
  const [docs, setDocs] = useState([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "feed"), orderBy("createdAt", "desc"), limit(count));
    return onSnapshot(q, (s) => {
      setDocs(s.docs.map((d) => ({ id: d.id, ...d.data() })));
      setLoaded(true);
    }, () => setLoaded(true));
  }, [count]);

  const items = docs.filter((r) => !r.voided && !r.hidden); // 무효 처리했거나 운영진이 가린 글은 빼고
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
            <p className="like-row">
              {canLike
                ? <button type="button" className={liked.has(r.id) ? "like-btn is-on" : "like-btn"} aria-pressed={liked.has(r.id)} disabled={liked.has(r.id)} onClick={() => like(r.id)}>♥ 공감 {r.likes || 0}</button>
                : <span className="like-btn static">♥ {r.likes || 0}</span>}
            </p>
          </Dialogue>
        ))}
      </div>
      {hasMore && <button className="pk-btn" onClick={() => setCount((c) => c + PAGE)}>더 보기</button>}
    </Panel>
  );
}
