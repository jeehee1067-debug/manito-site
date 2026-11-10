import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";
import { LOGIN_DOMAIN } from "./constants.js";

export function toEmail(loginId) {
  return `${loginId.trim().toLowerCase()}@${LOGIN_DOMAIN}`;
}

export function validateLoginId(loginId) {
  if (!/^[a-z0-9._-]{3,20}$/i.test(loginId.trim())) {
    return "아이디는 영문·숫자 3~20자로 정해 주세요.";
  }
  return null;
}

export async function login(loginId, password) {
  return signInWithEmailAndPassword(auth, toEmail(loginId), password);
}

export async function signup(loginId, password) {
  return createUserWithEmailAndPassword(auth, toEmail(loginId), password);
}

// 초대 코드로 명단의 내 이름과 계정을 연결한다.
export async function claimWithInvite(inviteInput) {
  const code = inviteInput.trim().toUpperCase();
  const uid = auth.currentUser.uid;
  const inviteSnap = await getDoc(doc(db, "invites", code)).catch(() => null);
  if (!inviteSnap || !inviteSnap.exists()) throw new Error("초대 코드가 맞지 않아요. 운영진에게 받은 6자리를 다시 확인해 주세요.");
  const personId = inviteSnap.data().personId;
  const rosterSnap = await getDoc(doc(db, "roster", personId));
  const roster = rosterSnap.data();
  if (roster.uid && roster.uid !== uid) throw new Error("이미 다른 계정에 연결된 초대 코드예요. 운영진에게 알려 주세요.");
  if (!roster.uid) await updateDoc(doc(db, "roster", personId), { uid, inviteUsed: code });
  await setDoc(doc(db, "users", uid), { personId, eliminated: [] });
  return personId;
}

export function authErrorMessage(err) {
  const code = err?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "아이디 또는 비밀번호가 맞지 않아요.";
  if (code.includes("email-already-in-use")) return "이미 있는 아이디예요. 다른 아이디를 쓰거나 로그인해 주세요.";
  if (code.includes("weak-password")) return "비밀번호는 6자 이상으로 정해 주세요.";
  if (code.includes("too-many-requests")) return "시도가 너무 많아요. 잠시 후 다시 해 주세요.";
  if (code.includes("permission-denied")) return "권한이 없어요. 운영진에게 알려 주세요.";
  if (code.includes("network-request-failed") || code.includes("unavailable"))
    return "로그인 서버에 연결하지 못했어요. 사내망에서 막혀 있을 수 있으니 운영진에게 알려 주세요.";
  return err?.message || "문제가 생겼어요. 다시 시도해 주세요.";
}
