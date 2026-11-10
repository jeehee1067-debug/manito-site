# S1FA 마니또 — 작업 규칙

부서 송년회용 마니또 미션 사이트. React 18 + Vite 5, Firebase(Authentication + Firestore, 무료 요금제), GitHub Pages 배포.
같은 부서 행사인 방탈출(https://github.com/jeehee1067-debug/office-escape)과 디자인·캐릭터를 맞춘 시리즈다.

## 작업 전에

```bash
git fetch origin main
git merge origin/main
```

## 배포 전에 돌릴 것

```bash
npm test            # 배정·코드·응모권·추첨 로직
npm run test:rules  # firestore.rules (Firestore 에뮬레이터, Java 21 이상 필요)
npm run build
```

GitHub Actions도 같은 순서로 돌린다(main: 통과해야 배포, 다른 브랜치: 테스트만).
화면 점검은 `npm run dev:emu` — 실제 프로젝트 대신 로컬 에뮬레이터(로그인 9099, Firestore 8080)에 붙는다.

## 가장 중요한 것: 보안 규칙과 코드가 어긋나지 않게

비밀 유지(누가 누구의 마니또인지)는 서버 코드 없이 `firestore.rules`만으로 지킨다.
Firestore에 쓰는 값의 모양(필드 이름, 타입, 길이)을 바꾸면 **반드시 `firestore.rules`의 같은 경로도 같이 고치고**, 규칙을 Firebase 콘솔에 다시 게시해야 한다.
어긋나면 기록이 통째로 거부된다(방탈출에서 실제로 난 사고와 같은 종류).

규칙 테스트는 `tests/rules.test.js`(`@firebase/rules-unit-testing`)에 있다.

- 1~5번 묶음: 막아야 하는 것 — 남의 `assignments`·`giverCodes`·`codes`·`clues`·`deliveries` 읽기, 남의 코드로 `redemptions` 생성, `config.phase` 역행, 운영자의 phase 3 전 짝 정보 열람, 완료했거나 코드가 인증된 슬롯의 `choices` 난이도 변경
- "앱 흐름" 묶음: 각 화면이 실제로 보내는 값의 모양을 옮겨 적은 것. **화면 코드에서 Firestore에 쓰는 값을 바꾸면 규칙과 이 테스트를 같이 고친다.**

## 로그인

- 첫 운영자 설정 버튼은 주소에 `?setup`이 있을 때만 보인다(운영자 설정 완료 후 숨김).
- 실제 메일 주소 + 비밀번호(Firebase Authentication). 비밀번호 찾기는 `sendPasswordResetEmail`. 메일 주소는 Firestore에 저장하지 않는다.
- `App`은 로그인 상태만 보고, 로그인한 사람의 구독·화면은 `Session`(key = uid)에 있다. 사람이 바뀌면 통째로 새로 만들어진다.
- 내 `users` 문서는 서버 저장이 확인된 스냅샷만 반영한다(`hasPendingWrites` 무시). 가입 직후 로컬 스냅샷으로 화면을 열면 규칙이 아직 "연결 전"으로 보고 내 배정 읽기를 거부한다(실제로 재현된 버그).

## 읽기 수 (무료 한도 하루 5만 건)

참여자 화면에서 컬렉션 전체를 구독하지 말 것. 명단은 `public/roster` 요약, 캐릭터는 화면에 나온 사람만(10분 캐시), 피드는 30건씩.
기기 저장소 캐시(persistentLocalCache)는 같은 기기 여러 사람 사용 때문에 쓰지 않는다. 자세한 내용은 README "무료 한도와 읽기 수".

## 정해진 규칙 (바꾸려면 사용자에게 먼저 확인)

- 참여 56명. 미션 인증은 **받는 사람**이 코드 + 후기(20자 이상)로 한다. 회사 안 사진 촬영 불가라 사진 인증 없음.
- 배정: 원형, 자기 자신·같은 팀·맞마니또 없음. 기본은 근무지(SR3/S1L) 상관없이, 옵션으로 같은 근무지끼리만. 대상이 다른 근무지면 `remote: true` 카드만 제시.
- 단서: 프로필 6문항, 매주 금요일 운영자가 전원 동일하게 2개씩 공개(인증 수와 무관하게 — 은신 응모권 공정성 때문).
- 응모권: 미션 인증 1(최대 3), 도전 +1(최대 2), 받는 사람 입력 1(최대 3), 은신 2, 정답 지목 1. 정체를 알려주면 둘의 합계가 −1이 되도록 설계됨.
- 상품: `src/config/prizes.js` 한 곳에서 관리. 사용자가 상품 구성을 아직 손볼 예정.
- 선물 예산 한도는 인당 2만원 × 56명 = 112만원(세금포함).

## 코드 구조

| 파일 | 맡은 것 |
|---|---|
| `src/config/prizes.js` | 상품·응모권 규칙·베스트 마니또 가중치 |
| `src/lib/constants.js` | 단계, 근무지, 프로필 질문, 미션 카드, 캐릭터 목록 |
| `src/lib/assign.js` | 팀 편성, 배정, 코드 생성 |
| `src/lib/scoring.js` | 응모권 계산, 베스트 마니또 순위, 가중 추첨 |
| `src/lib/roster.js` | 참여자 화면용 명단 요약(`public/roster`). 운영 화면(`Admin.jsx`)이 명단과 다르면 다시 씀 |
| `src/ui.jsx` | 패널·대사창·캐릭터 공통 컴포넌트 |
| `src/firebase.js` | Firebase 연결. `npm run dev:emu`(`.env.emulator`)일 때만 에뮬레이터 연결 |
| `src/xmas.jsx`, `src/xmas.css`, `src/assets/xmas/` | 연말·크리스마스 장식(시즌 한정). 빼는 방법은 README "연말 장식" |
| `tests/rules.test.js` | 보안 규칙 테스트 |
| `src/pages/*` | 화면 |
| `src/styles.css` | 방탈출 `assets/css/style.css`의 색·테두리·버튼·대사창 값을 따름. 시즌 장식은 여기 넣지 말고 `xmas.css`에 |
| `public/char/p1~p4.png` | 방탈출 참가자 캐릭터 |
| `public/char/boss1~4.png` | 방탈출 파트장님·PL님(로그인 화면 주인공 원본). 연말에는 `src/assets/xmas/leader1~4.png`(소품 얹은 그림)를 쓴다 |

## 아직 안 된 것

- 사내망에서 Firebase 로그인(`identitytoolkit.googleapis.com`)과 Firestore(`firestore.googleapis.com`) 접속 확인, 비밀번호 재설정 메일 수신(회사 메일 차단 여부)과 링크(`프로젝트ID.firebaseapp.com`) 열림 확인
- 실제 Firebase 프로젝트에 연결한 상태의 화면 점검. 에뮬레이터로는 4명 기준 전체 흐름(운영자 설정 → 명단 → 배정 → 가입 → 미션 → 인증 → 단서 → 지목 → 투표 → 집계 → 추첨)을 화면으로 진행해 확인했다(콘솔 오류 0건). 실제 프로젝트·사내망은 아직.
