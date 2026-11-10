import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";

// 로그인은 실제 메일 주소로 한다. 비밀번호를 잊으면 이 주소로 Firebase가 재설정 메일을 보낸다.
// 메일 주소는 Firebase Authentication에만 있고 Firestore에는 저장하지 않는다(다른 참여자는 볼 수 없음).
export function normalizeEmail(input) {
  return (input || "").trim().toLowerCase();
}

export function validateEmail(input) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(input))) {
    return "메일 주소를 정확히 적어 주세요. 비밀번호를 잊었을 때 이 주소로 재설정 메일이 가요.";
  }
  return null;
}

// keep=false면 이 탭을 닫을 때 로그아웃된다(여러 사람이 같이 쓰는 기기용).
async function remember(keep) {
  await setPersistence(auth, keep ? browserLocalPersistence : browserSessionPersistence);
}

export async function login(email, password, keep = true) {
  await remember(keep);
  return signInWithEmailAndPassword(auth, normalizeEmail(email), password);
}

export async function signup(email, password, keep = true) {
  await remember(keep);
  return createUserWithEmailAndPassword(auth, normalizeEmail(email), password);
}

export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, normalizeEmail(email));
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
    return "메일 주소 또는 비밀번호가 맞지 않아요. 비밀번호가 기억나지 않으면 아래 '비밀번호를 잊었어요'를 눌러 주세요.";
  if (code.includes("email-already-in-use"))
    return "이미 가입된 메일이에요. 로그인 탭에서 로그인해 주세요. 비밀번호가 기억나지 않으면 '비밀번호를 잊었어요'로 다시 정할 수 있어요.";
  if (code.includes("invalid-email") || code.includes("missing-email")) return "메일 주소 형식이 맞지 않아요.";
  if (code.includes("weak-password")) return "비밀번호는 6자 이상으로 정해 주세요.";
  if (code.includes("user-disabled")) return "사용이 중지된 계정이에요. 운영진에게 알려 주세요.";
  if (code.includes("too-many-requests")) return "시도가 너무 많아요. 잠시 후 다시 해 주세요.";
  if (code.includes("permission-denied")) return "권한이 없어요. 운영진에게 알려 주세요.";
  if (code.includes("network-request-failed") || code.includes("unavailable"))
    return "로그인 서버에 연결하지 못했어요. 사내망에서 막혀 있을 수 있으니 운영진에게 알려 주세요.";
  return err?.message || "문제가 생겼어요. 다시 시도해 주세요.";
}
