import { increment } from "firebase/firestore";

// 참여자가 반복해서 고칠 수 있는 문서(진행·프로필·연결·캐릭터·미션·단서·신고·지목)에는
// 쓴 횟수(n)를 1 올려서 같이 써야 한다(보안 규칙의 bumped). 무료 한도(하루 쓰기 2만 건)를 일부러 소진하면
// 운영 화면 "쓰기 횟수"에서 누구 문서인지 보인다. 이 값을 빼고 쓰면 보안 규칙이 거부한다.
export const bump = () => ({ n: increment(1) });
