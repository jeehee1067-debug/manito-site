import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from "firebase/app-check";
import { connectAuthEmulator, getAuth } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore, initializeFirestore } from "firebase/firestore";
import { appCheckProvider, appCheckSiteKey, firebaseConfig } from "./firebase.config.js";

// 로컬 점검용: `npm run dev:emu`로 띄우면(.env.emulator의 VITE_EMULATOR=1) 실제 프로젝트 대신
// 내 PC의 Firebase 에뮬레이터(로그인 9099, Firestore 8080)에 붙는다. 배포 빌드(npm run build)에는 영향 없음.
const emulator = import.meta.env.VITE_EMULATOR === "1";
const config = emulator
  ? { apiKey: "demo-key", authDomain: "localhost", projectId: "demo-manito", appId: "demo-app" }
  : firebaseConfig;

export const configured = Boolean(config.apiKey && config.projectId);
export const app = configured ? initializeApp(config) : null;
// App Check: 키가 있을 때만(에뮬레이터에서는 끈다). Firestore를 쓰기 전에 켜야 첫 요청부터 확인 토큰이 붙는다.
export const appCheckOn = Boolean(app && !emulator && appCheckSiteKey);
if (appCheckOn) {
  const provider = appCheckProvider === "v3" ? new ReCaptchaV3Provider(appCheckSiteKey) : new ReCaptchaEnterpriseProvider(appCheckSiteKey);
  initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
}
export const auth = configured ? getAuth(app) : null;

// 사내 프록시가 Firestore의 실시간 연결(스트리밍)을 끊거나 묶어 두면 "불러오는 중"에서 멈출 수 있다.
// SDK가 기본으로 자동 감지해 긴 폴링으로 바꾸지만, 그래도 멈추는 기기는 주소 끝에 ?longpoll 을 붙여 한 번 열면
// 그 기기에서는 계속 긴 폴링(느리지만 프록시를 잘 통과함)으로 연결한다. ?longpoll=0 으로 열면 되돌린다.
function longPollingWanted() {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has("longpoll")) {
      if (q.get("longpoll") === "0") localStorage.removeItem("manito:longpoll");
      else localStorage.setItem("manito:longpoll", "1");
    }
    return localStorage.getItem("manito:longpoll") === "1";
  } catch {
    return false;
  }
}
export const longPolling = configured && !emulator && longPollingWanted();
export const db = configured ? (longPolling ? initializeFirestore(app, { experimentalForceLongPolling: true }) : getFirestore(app)) : null;
// 비밀번호 재설정 메일을 한국어 템플릿으로 보낸다.
if (auth) auth.languageCode = "ko";

if (emulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}
