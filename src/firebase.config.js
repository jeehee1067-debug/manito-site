// Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹)의 값을 그대로 붙여넣는다.
// 방탈출(net.js)처럼 이 값은 공개돼도 괜찮다. 데이터 보호는 firestore.rules가 맡는다.
// 방탈출과 데이터가 섞이지 않게 별도 Firebase 프로젝트(s1fa-manito)를 쓴다.
export const firebaseConfig = {
  apiKey: "AIzaSyAYWSjF6vQYB3jE_jRHj71vV0_2cNyOJVQ",
  authDomain: "s1fa-manito.firebaseapp.com",
  projectId: "s1fa-manito",
  storageBucket: "s1fa-manito.firebasestorage.app",
  messagingSenderId: "1021011653804",
  appId: "1:1021011653804:web:f03fa83aac1fac688edb09",
};

// App Check(선택): 사이트 밖에서 만든 스크립트가 Firestore에 요청하는 것을 막는다(무료 한도를 일부러 소진하는 공격 대비).
// reCAPTCHA v3 사이트 키를 넣으면 켜진다. 비워 두면 꺼진 채로 동작한다. 설정 방법은 README "App Check".
// 키를 넣고 배포한 뒤, Firebase 콘솔에서 사내망 요청이 "확인됨"으로 잡히는지 본 다음에 "적용(enforce)"을 켤 것.
// (사내망에서 www.google.com/recaptcha 가 막혀 있으면 적용을 켜는 순간 사내에서 사이트가 멈춘다)
export const appCheckSiteKey = "";
