import { useEffect, useState } from "react";
import { collection, doc, getDocs, increment, limit, orderBy, query, serverTimestamp, where, writeBatch } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import { PHASE } from "../lib/constants.js";
import { Dialogue, Panel } from "../ui.jsx";
import { pickTop } from "../lib/feedTop.js";

// 익명 피드. 인증 문서(redemptions)가 아니라 따로 만든 feed 문서를 읽는다.
// feed 문서에는 받는 사람 정보도 인증 코드도 없다({ slot, review, voided, createdAt, thanks?, hidden?, likes? }, 문서 ID는 무작위).
// 인증 문서는 인증한 사람·그 코드의 마니또·운영자만 읽을 수 있다(보안 규칙).
// 읽기 줄이기: 최근 PAGE건씩. 감사 답장은 같은 문서에 들어 있어서 따로 읽지 않는다.
const PAGE = 30;

// 공감 많은 후기(사용자가 정함: "좋은 후기가 익명으로 모여 보이는 곳이 있으면 좋겠다"): 피드 맨 위에 공감 수가 많은 글 몇 건(lib/feedTop.js).
// 공감 수로 정렬해 조금 넉넉히 읽고(무효·가린 글을 빼야 해서) 화면에서 고른다. 공감이 하나도 없는 글은 likes 칸이 없어 나오지 않는다.
// 피드 탭은 들어올 때마다 새로 만들어지므로, 읽기를 줄이려고 TOP_TTL 동안은 읽어 둔 것을 쓴다("새 글 확인"을 누르면 다시 읽는다).
const TOP_FETCH = 6;
const TOP_TTL = 5 * 60 * 1000;
let topCache = { at: 0, docs: [] };

// 내가 공감한 글 목록은 사이트를 열고 처음 피드에 들어올 때 한 번만 읽는다(탭을 오갈 때마다 다시 읽지 않게).
const likedCache = new Map(); // pid → Set(글ID)

// 피드는 실시간으로 구독하지 않는다: 열 때·"새 글 확인"·"더 보기"를 누를 때만 읽는다.
// 공감 수가 글 문서에 들어 있어서, 구독하면 누가 공감을 누를 때마다 피드를 열어 둔 모든 사람에게 1건씩 읽기가 생긴다
// (공감이 상에 반영되면서 많이 눌릴 수 있고, 무료 한도는 하루 읽기 5만 건이다).
export default function Feed() {
  const { myPid, config, isAdmin } = useApp();
  const viewOnly = isAdmin && !myPid; // 운영자 계정: 보기만(공감은 참여자만 — 보안 규칙도 같다)
  const [count, setCount] = useState(PAGE);
  const [tick, setTick] = useState(0); // "새 글 확인"
  const [busy, setBusy] = useState(false);
  // 내가 공감한 글(본인만 읽는다). 글마다 한 번만, 취소는 없다(쓰기 반복 방지).
  const [liked, setLiked] = useState(() => likedCache.get(myPid) || new Set());
  const canLike = Boolean(myPid) && config.phase >= PHASE.RUNNING && config.phase <= PHASE.SCORING;
  const [docs, setDocs] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [topDocs, setTopDocs] = useState(topCache.docs);
  useEffect(() => {
    if (!myPid || likedCache.has(myPid)) return;
    getDocs(query(collection(db, "feedLikes"), where("pid", "==", myPid)))
      .then((s) => {
        const set = new Set(s.docs.map((d) => d.data().feedId));
        likedCache.set(myPid, set);
        setLiked(set);
      }).catch(() => {});
  }, [myPid]);
  const remember = (set) => { likedCache.set(myPid, set); setLiked(set); };
  const bumpIn = (id, by) => (list) => list.map((d) => (d.id === id ? { ...d, likes: Math.max(0, (d.likes || 0) + by) } : d));
  const bumpLikes = (id, by) => {
    setDocs(bumpIn(id, by));
    setTopDocs((list) => { const next = bumpIn(id, by)(list); topCache = { ...topCache, docs: next }; return next; });
  };
  async function like(id) {
    if (liked.has(id)) return;
    remember(new Set(liked).add(id));
    bumpLikes(id, 1); // 구독하지 않으므로 화면의 숫자는 직접 올린다
    const b = writeBatch(db);
    b.update(doc(db, "feed", id), { likes: increment(1) });
    b.set(doc(db, "feedLikes", `${id}_${myPid}`), { pid: myPid, feedId: id, at: serverTimestamp() });
    await b.commit().catch(() => {
      const back = new Set(likedCache.get(myPid) || []);
      back.delete(id);
      remember(back);
      bumpLikes(id, -1);
    });
  }

  useEffect(() => {
    let live = true;
    setBusy(true);
    getDocs(query(collection(db, "feed"), orderBy("createdAt", "desc"), limit(count)))
      .then((s) => { if (live) setDocs(s.docs.map((d) => ({ id: d.id, ...d.data() }))); })
      .catch(() => {})
      .finally(() => { if (live) { setLoaded(true); setBusy(false); } });
    return () => { live = false; };
  }, [count, tick]);

  // 공감 많은 후기: 읽어 둔 지 오래됐거나 "새 글 확인"을 눌렀을 때만 다시 읽는다
  useEffect(() => {
    if (tick === 0 && Date.now() - topCache.at < TOP_TTL) return undefined;
    let live = true;
    getDocs(query(collection(db, "feed"), orderBy("likes", "desc"), limit(TOP_FETCH)))
      .then((s) => {
        const list = s.docs.map((d) => ({ id: d.id, ...d.data() }));
        topCache = { at: Date.now(), docs: list };
        if (live) setTopDocs(list);
      })
      .catch(() => {});
    return () => { live = false; };
  }, [tick]);
  const top = pickTop(topDocs);

  const items = docs.filter((r) => !r.voided && !r.hidden); // 무효 처리했거나 운영진이 가린 글은 빼고
  const hasMore = docs.length >= count;

  const post = (r, key, extra) => (
    <Dialogue key={key} speaker={r.slot === 3 ? "칭찬 카드 받은 사람" : `${r.slot}주차 미션 받은 사람`} tone={extra ? "gold" : ""}>
      {extra}
      <p>{r.review}</p>
      {r.thanks && <p className="small reply">마니또에게 보낸 답장: {r.thanks}</p>}
      <p className="like-row">
        {canLike
          ? <button type="button" className={liked.has(r.id) ? "like-btn is-on" : "like-btn"} aria-pressed={liked.has(r.id)} disabled={liked.has(r.id)} onClick={() => like(r.id)}>♥ 공감 {r.likes || 0}</button>
          : <span className="like-btn static">♥ {r.likes || 0}</span>}
      </p>
    </Dialogue>
  );

  return (
    <>
    {top.length > 0 && (
      <Panel title="공감 많은 후기">
        <p className="small">지금까지 공감(♥)을 많이 받은 후기 {top.length}건이에요. 누가 썼는지는 여기서도 비밀이에요.{viewOnly ? "" : " 아래 피드에서 마음에 드는 후기에 공감을 눌러 주세요."}</p>
        <div className="stack top-reviews">
          {top.map((r, i) => post(r, `top-${r.id}`, <p className="small top-rank">공감 {i + 1}위</p>))}
        </div>
      </Panel>
    )}
    <Panel title="익명 피드">
      {viewOnly && <p className="small view-only">운영자 계정은 참여자가 보는 피드를 그대로 보기만 해요(공감은 누를 수 없어요). 무효 처리·가리기는 운영 탭 "인증 검토"에서 해요.</p>}
      <p className="small">누가 누구에게 했는지는 송년회까지 비밀이에요. 최근 것부터 {PAGE}건씩 보여요. 새 글과 공감 수는 "새 글 확인"을 누르면 다시 불러와요.</p>
      <button type="button" className="pk-btn sm" disabled={busy} onClick={() => setTick((t) => t + 1)}>새 글 확인</button>
      {loaded && items.length === 0 && <p className="muted">첫 인증이 올라오면 여기에 보여요.</p>}
      <div className="stack">
        {items.map((r) => post(r, r.id))}
      </div>
      {hasMore && <button className="pk-btn" onClick={() => setCount((c) => c + PAGE)}>더 보기</button>}
    </Panel>
    </>
  );
}
