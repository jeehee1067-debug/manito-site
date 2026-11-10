// Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹)의 값을 그대로 붙여넣는다.
// 방탈출(net.js)처럼 이 값은 공개돼도 괜찮다. 데이터 보호는 firestore.rules가 맡는다.
// 방탈출과 데이터가 섞이지 않게 별도 Firebase 프로젝트를 쓰는 것을 권장한다.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  appId: "",
};
