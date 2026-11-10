import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { firebaseConfig } from "./firebase.config.js";

// 로컬 점검용: `npm run dev:emu`로 띄우면(.env.emulator의 VITE_EMULATOR=1) 실제 프로젝트 대신
// 내 PC의 Firebase 에뮬레이터(로그인 9099, Firestore 8080)에 붙는다. 배포 빌드(npm run build)에는 영향 없음.
const emulator = import.meta.env.VITE_EMULATOR === "1";
const config = emulator
  ? { apiKey: "demo-key", authDomain: "localhost", projectId: "demo-manito", appId: "demo-app" }
  : firebaseConfig;

export const configured = Boolean(config.apiKey && config.projectId);
export const app = configured ? initializeApp(config) : null;
export const auth = configured ? getAuth(app) : null;
export const db = configured ? getFirestore(app) : null;
// 비밀번호 재설정 메일을 한국어 템플릿으로 보낸다.
if (auth) auth.languageCode = "ko";

if (emulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
