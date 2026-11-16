import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
} from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "../firebase.js";
import { bump } from "./writes.js";
import { MAIL_DOMAIN, MAIL_LINK } from "./constants.js";

// 로그인은 실제 메일 주소로 한다. 비밀번호를 잊으면 이 주소로 Firebase가 재설정 메일을 보낸다.
// 메일 주소는 Firebase Authentication과 내 연결 문서(users/{uid}.email, 본인과 운영자만 읽음)에만 있다.
export function normalizeEmail(input) {
  return (input || "").trim().toLowerCase();
}

// 로그인·가입 화면의 입력 → 메일 주소. 아이디만 적으면 회사 메일 도메인을 붙이고, @가 있으면 그대로 쓴다(운영자 계정 등).
export function toEmail(input) {
  const v = normalizeEmail(input);
  return !v || v.includes("@") ? v : `${v}@${MAIL_DOMAIN}`;
}

// 새 비밀번호 규칙: 8자 이상, 글자와 숫자를 섞어서. (Firebase는 6자만 요구한다. 계정이 털리면 그 사람의 대상이 보이므로 더 세게)
export function validatePassword(pw) {
  if ((pw || "").length < 8) return "비밀번호는 8자 이상으로 정해 주세요.";
  if (!/[A-Za-z가-힣]/.test(pw) || !/[0-9]/.test(pw)) return "비밀번호에 글자와 숫자를 섞어 주세요.";
  return null;
}

export function validateEmail(input) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail(input))) {
    return "Knox ID를 정확히 적어 주세요(@ 앞부분만). 이 메일로 인증 메일과 비밀번호 재설정 메일이 가요.";
  }
  return null;
}

// keep=false면 이 탭을 닫을 때 로그아웃된다(여러 사람이 같이 쓰는 기기용).
async function remember(keep) {
  await setPersistence(auth, keep ? browserLocalPersistence : browserSessionPersistence);
}

export async function login(email, password, keep = true) {
  await remember(keep);
  return signInWithEmailAndPassword(auth, toEmail(email), password);
}

export async function signup(email, password, keep = true) {
  await remember(keep);
  return createUserWithEmailAndPassword(auth, toEmail(email), password);
}

export async function resetPassword(email) {
  return sendPasswordResetEmail(auth, toEmail(email));
}

// 인증 메일 보내기(가입 직후, 그리고 "다시 보내기"). 이미 인증한 계정이면 아무것도 하지 않는다.
export async function sendVerifyMail() {
  const u = auth.currentUser;
  if (!u || u.emailVerified) return;
  try {
    // 인증을 마친 화면에 "계속" 버튼이 나와 이 사이트로 돌아올 수 있게 주소를 같이 보낸다
    await sendEmailVerification(u, { url: window.location.origin + window.location.pathname });
  } catch (err) {
    // 사이트 주소가 Firebase의 승인된 도메인에 없으면 거부된다: 돌아오는 주소 없이 보낸다
    if (!String(err?.code || "").includes("continue-uri")) throw err;
    await sendEmailVerification(u);
  }
}

// 메일 인증으로 명단의 내 이름과 계정을 연결한다(초대 코드 없이).
// 보안 규칙: 인증된 메일(토큰의 email_verified)이 명단의 그 사람 메일과 같을 때만 연결된다.
// quiet = true면(화면이 스스로 확인할 때) 아직 인증 전이거나 명단에 없는 메일일 때 조용히 null을 돌려준다.
export async function claimWithMail({ quiet = false } = {}) {
  const u = auth.currentUser;
  await u.reload(); // 다른 창(메일)에서 링크를 눌렀는지 서버에서 다시 읽는다
  if (!u.emailVerified) {
    if (quiet) return null;
    throw new Error("아직 메일 인증 전이에요. 회사 메일로 온 인증 메일의 링크를 누른 뒤 다시 눌러 주세요.");
  }
  await u.getIdToken(true); // 인증 여부가 들어간 새 토큰으로 바꾼다(보안 규칙이 토큰의 값을 본다)
  const snap = await getDoc(doc(db, "mailIndex", u.email)).catch(() => null);
  if (!snap || !snap.exists()) {
    if (quiet) return null;
    throw new Error(`명단에 없는 메일이에요(${u.email}). 아이디를 잘못 적어 가입했다면 로그아웃하고 맞는 아이디로 다시 가입해 주세요. 맞게 적었다면 운영진에게 알려 주세요.`);
  }
  const personId = snap.data().personId;
  const link = async () => {
    try {
      await updateDoc(doc(db, "roster", personId), { uid: u.uid, inviteUsed: MAIL_LINK });
    } catch (err) {
      if (err?.code !== "permission-denied") throw err; // 이미 내 계정에 연결돼 있으면 거부된다(아래 users 생성은 통과)
    }
    await setDoc(doc(db, "users", u.uid), { personId, eliminated: [], email: u.email, ...bump() }, { merge: true });
  };
  try {
    await link();
  } catch (err) {
    if (err?.code !== "permission-denied") throw err;
    // 새 토큰이 Firestore 연결에 반영되기 전이면 한 번 거부될 수 있다. 잠깐 뒤 한 번 더 해 본다.
    await new Promise((r) => setTimeout(r, 1500));
    try {
      await link();
    } catch (err2) {
      if (err2?.code === "permission-denied") throw new Error("연결하지 못했어요. 이 이름이 이미 다른 계정에 연결돼 있을 수 있어요. 운영진에게 알려 주세요.");
      throw err2;
    }
  }
  return personId;
}

// 초대 코드로 명단의 내 이름과 계정을 연결한다.
export async function claimWithInvite(inviteInput) {
  const code = inviteInput.trim().toUpperCase();
  const uid = auth.currentUser.uid;
  const inviteSnap = await getDoc(doc(db, "invites", code)).catch(() => null);
  if (!inviteSnap || !inviteSnap.exists()) throw new Error("초대 코드가 맞지 않아요. 운영진에게 받은 6자리를 다시 확인해 주세요.");
  const personId = inviteSnap.data().personId;
  // 연결 전 계정은 명단을 읽을 수 없다(외부인 차단). 그래서 확인하지 않고 바로 연결을 시도한다.
  // 이미 내 계정에 연결돼 있으면 명단 수정은 거부되지만 아래 users 생성은 통과하고, 다른 계정이면 둘 다 거부된다.
  try {
    await updateDoc(doc(db, "roster", personId), { uid, inviteUsed: code });
  } catch (err) {
    if (err?.code !== "permission-denied") throw err;
  }
  try {
    // email: 운영 화면 "연결된 메일"용(본인과 운영자만 읽음). 규칙이 로그인한 계정의 메일과 같은지 확인한다.
    await setDoc(doc(db, "users", uid), { personId, eliminated: [], email: auth.currentUser.email, ...bump() }, { merge: true });
  } catch (err) {
    if (err?.code === "permission-denied") throw new Error("이미 다른 계정에 연결된 초대 코드예요. 운영진에게 알려 주세요.");
    throw err;
  }
  return personId;
}

export function authErrorMessage(err) {
  const code = err?.code || "";
  if (code.includes("invalid-credential") || code.includes("wrong-password") || code.includes("user-not-found"))
    return "아이디 또는 비밀번호가 맞지 않아요. 처음이라면 '처음 가입' 탭에서 가입해 주세요. 비밀번호가 기억나지 않으면 아래 '비밀번호를 잊었어요'를 눌러 주세요.";
  if (code.includes("email-already-in-use"))
    return "이미 가입된 아이디예요. 로그인 탭에서 로그인해 주세요. 비밀번호가 기억나지 않으면 '비밀번호를 잊었어요'로 다시 정할 수 있어요.";
  if (code.includes("invalid-email") || code.includes("missing-email")) return "아이디(메일 주소) 형식이 맞지 않아요.";
  if (code.includes("weak-password")) return "비밀번호는 6자 이상으로 정해 주세요.";
  if (code.includes("user-disabled")) return "사용이 중지된 계정이에요. 운영진에게 알려 주세요.";
  if (code.includes("too-many-requests")) return "시도가 너무 많아요. 잠시 후 다시 해 주세요.";
  if (code.includes("permission-denied")) return "권한이 없어요. 운영진에게 알려 주세요.";
  if (code.includes("network-request-failed") || code.includes("unavailable"))
    return "로그인 서버에 연결하지 못했어요. 사내망에서 막혀 있을 수 있으니 운영진에게 알려 주세요.";
  return err?.message || "문제가 생겼어요. 다시 시도해 주세요.";
}
