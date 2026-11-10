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
npm test        # 배정·코드·응모권·추첨 로직
npm run build
```

## 가장 중요한 것: 보안 규칙과 코드가 어긋나지 않게

비밀 유지(누가 누구의 마니또인지)는 서버 코드 없이 `firestore.rules`만으로 지킨다.
Firestore에 쓰는 값의 모양(필드 이름, 타입, 길이)을 바꾸면 **반드시 `firestore.rules`의 같은 경로도 같이 고치고**, 규칙을 Firebase 콘솔에 다시 게시해야 한다.
어긋나면 기록이 통째로 거부된다(방탈출에서 실제로 난 사고와 같은 종류).

규칙은 아직 Firestore 에뮬레이터로 자동 테스트하지 못했다. **첫 작업으로 `@firebase/rules-unit-testing`으로 규칙 테스트를 만드는 것을 권장**한다. 최소 확인 항목:

1. 참여자는 남의 `assignments`, `giverCodes`, `codes`, `clues`, `deliveries`를 읽을 수 없다
2. 다른 사람에게 발급된 코드로 `redemptions`를 만들 수 없다
3. 단계(`config.phase`)는 줄일 수 없다
4. 운영자도 phase 3 전에는 `assignments`·`giverCodes`를 읽을 수 없다
5. 완료한 미션 슬롯의 `choices` 난이도를 바꿀 수 없다

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
| `src/ui.jsx` | 패널·대사창·캐릭터 공통 컴포넌트 |
| `src/pages/*` | 화면 |
| `src/styles.css` | 방탈출 `assets/css/style.css`의 색·테두리·버튼·대사창 값을 따름 |
| `public/char/p1~p4.png` | 방탈출 참가자 캐릭터 |

## 아직 안 된 것

- Firestore 규칙 자동 테스트
- 사내망에서 Firebase 로그인(`identitytoolkit.googleapis.com`)과 Firestore(`firestore.googleapis.com`) 접속 확인
- 실제 Firebase 프로젝트에 연결한 상태의 화면 점검(지금까지는 로그인 화면과 스타일 미리보기만 확인)
