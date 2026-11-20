// 피드 요약 문서 public/feed (읽기 줄이기, 11/20).
// 참여자마다 최근 글 30건 + 공감 많은 글 6건을 각자 읽던 것을, 운영자 화면이 한 문서에 모아 두고(최근 PAGE건·공감 많은 TOP_FETCH건)
// 참여자는 그 1건과 그 뒤로 새로 올라온 글만 읽는다. feed 문서와 같은 내용만 담는다(받는 사람·코드 없음). public/* 쓰기는 원래 운영자만(보안 규칙 변경 없음).
// - 쓰는 쪽: FeedDigestWriter(App.jsx가 운영자·공동 운영자 계정에 띄움). 바뀐 뒤 DIGEST_DELAY가 지나면 다시 쓴다.
//   운영자 화면이 열려 있지 않으면 요약이 오래될 수 있다: 새 글은 "그 뒤 새 글" 조회로 보이고, 공감 수·감사 답장은 "새 글 확인"을 눌러야 최신이 된다.
// - 운영자의 무효·가리기·답장 지우기는 patchFeedDigest로 요약 문서에도 바로 반영한다(가린 후기가 요약에 남아 보이지 않게).
// - 새 글 확인·더 보기·내가 쓴 뒤(forgetFeed)에는 지금처럼 feed를 직접 읽는다.
import { useEffect, useRef, useState } from "react";
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, where } from "firebase/firestore";
import { db } from "../firebase.js";
import { digestKey, feedCache, mergeDigest, patchPosts } from "./feedCache.js";

export const PAGE = 30;
export const TOP_FETCH = 6;
const DIGEST_DELAY = 10 * 1000;
const digestRef = () => doc(db, "public", "feed");
const toPost = (d) => ({ id: d.id, ...d.data() });
const recentQuery = (n) => query(collection(db, "feed"), orderBy("createdAt", "desc"), limit(n));
const topQuery = () => query(collection(db, "feed"), orderBy("likes", "desc"), limit(TOP_FETCH));

/**
 * 피드 읽기. refresh: "새 글 확인", count > PAGE: "더 보기".
 * 반환 { list, top }. top이 null이면 공감 많은 글은 그대로 둔다("더 보기").
 */
export async function loadFeed({ count = PAGE, refresh = false } = {}) {
  const now = Date.now();
  if (!refresh && count === PAGE && !feedCache.forceFull) {
    const d = await getDoc(digestRef()).catch(() => null);
    const dg = d?.exists() ? d.data() : null;
    const newest = dg && Array.isArray(dg.recent) ? dg.recent[0]?.createdAt : null;
    if (newest) {
      const s = await getDocs(query(collection(db, "feed"), where("createdAt", ">", newest), orderBy("createdAt", "desc"), limit(count)));
      const list = mergeDigest(dg.recent, s.docs.map(toPost), count);
      const top = Array.isArray(dg.top) ? dg.top : [];
      feedCache.list = { at: now, count, docs: list };
      feedCache.top = { at: now, docs: top };
      return { list, top };
    }
  }
  const withTop = count === PAGE || refresh;
  const [ls, ts] = await Promise.all([getDocs(recentQuery(count)), withTop ? getDocs(topQuery()) : null]);
  const list = ls.docs.map(toPost);
  feedCache.list = { at: now, count, docs: list };
  feedCache.forceFull = false;
  if (!ts) return { list, top: null };
  const top = ts.docs.map(toPost);
  feedCache.top = { at: now, docs: top };
  return { list, top };
}

// 운영자의 무효·가리기·답장 지우기를 요약 문서에도 바로 반영한다(요약이 없으면 아무것도 안 함).
export async function patchFeedDigest(feedId, patch) {
  await runTransaction(db, async (tx) => {
    const s = await tx.get(digestRef());
    if (!s.exists()) return;
    const dg = s.data();
    tx.update(digestRef(), { recent: patchPosts(dg.recent || [], feedId, patch), top: patchPosts(dg.top || [], feedId, patch) });
  });
}

// 운영자·공동 운영자 화면에서만(App.jsx). 최근 글과 공감 많은 글을 구독해 요약 문서를 최신으로 둔다.
// 읽기: 열 때 PAGE + TOP_FETCH + 1건, 그 뒤 바뀐 글마다 1건. 쓰기: 내용이 바뀌었을 때만(여러 운영자 화면이 열려 있어도 같은 내용이면 안 씀).
export function FeedDigestWriter() {
  const recent = useRef(null);
  const top = useRef(null);
  const written = useRef(null); // 지금 요약 문서의 내용(digestKey)
  const [tick, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);
  useEffect(() => onSnapshot(recentQuery(PAGE), (s) => { recent.current = s.docs.map(toPost); bump(); }, () => {}), []);
  useEffect(() => onSnapshot(topQuery(), (s) => { top.current = s.docs.map(toPost); bump(); }, () => {}), []);
  useEffect(() => onSnapshot(digestRef(), (s) => {
    written.current = s.exists() ? digestKey(s.data().recent || [], s.data().top || []) : "";
    bump();
  }, () => {}), []);
  // 바뀌면 DIGEST_DELAY 뒤에 그때의 최신 내용으로 한 번 쓴다. 그사이 또 바뀌어도 타이머를 다시 걸지 않는다
  // (다시 걸면 공감이 계속 눌리는 동안 쓰기가 끝없이 미뤄진다 — 11/20 측정에서 실제로 빈 요약이 남았다).
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!recent.current || !top.current || written.current === null || timer.current) return;
    if (digestKey(recent.current, top.current) === written.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      if (digestKey(recent.current, top.current) === written.current) return;
      setDoc(digestRef(), { v: 1, at: serverTimestamp(), recent: recent.current, top: top.current }).catch(() => {});
    }, DIGEST_DELAY);
  }, [tick]);
  return null;
}
