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
화면 흐름 검증은 `npm run dev:emu`를 띄운 채 `npm run test:e2e`(`e2e/`, Playwright, CI에서는 안 돌림). **화면 문구·버튼·쓰는 값을 바꾸면 이 스크립트도 같이 고치고 돌린다.**

## 가장 중요한 것: 보안 규칙과 코드가 어긋나지 않게

비밀 유지(누가 누구의 마니또인지)는 서버 코드 없이 `firestore.rules`만으로 지킨다.
Firestore에 쓰는 값의 모양(필드 이름, 타입, 길이)을 바꾸면 **반드시 `firestore.rules`의 같은 경로도 같이 고치고**, 규칙을 Firebase 콘솔에 다시 게시해야 한다.
어긋나면 기록이 통째로 거부된다(방탈출에서 실제로 난 사고와 같은 종류).
화면이 쓰는 경로·값의 모양을 바꿨으면 **규칙의 `rulesVersion`과 `src/lib/constants.js`의 `RULES_VERSION`을 같이 올린다.** 운영 화면이 이 값으로 "콘솔의 규칙이 예전 것"인지 확인해 맨 위에 경고를 띄운다(규칙 게시를 잊는 실수 방지). 규칙을 바꾼 PR에서는 사용자에게 다시 게시하라고 꼭 알린다.

규칙 테스트는 `tests/rules.test.js`(`@firebase/rules-unit-testing`)에 있다.

- 1~5번 묶음: 막아야 하는 것 — 남의 `assignments`·`giverCodes`·`codes`·`clues`·`deliveries`·`progress`·`redemptions`·`roster` 읽기, 남의 코드로 `redemptions` 생성, 인증 없는 `feed` 글, 안 열린 주차의 인증·완료 알림·카드 고르기, `config.phase` 건너뛰기·역행, 집계 없는 공개, 운영자 계정의 명단 연결, 추첨 결과 덮어쓰기, 완료했거나 코드가 인증된 슬롯의 `choices` 난이도 변경
- "보안 점검에서 막은 것" 묶음: 난이도와 안 맞는 카드 번호(쉬운 카드를 도전이라고 적기), `done`에 `true`가 아닌 값, 최종 지목이 마감된 뒤의 단서 쓰기, 공동 운영자의 초대 코드 목록 읽기, 단계 6 이상, 공동 운영자의 "못 받음", 준비 단계의 수호천사 지원, 큰 값 넣기, 추첨 칸 일부만·모르는 칸·칸마다 다른 숫자
- "앱 흐름" 묶음: 각 화면이 실제로 보내는 값의 모양을 옮겨 적은 것. **화면 코드에서 Firestore에 쓰는 값을 바꾸면 규칙과 이 테스트를 같이 고친다.**
- 읽기는 `member()`(초대 코드로 연결된 참여자 또는 운영자)만. 연결 전 계정이 읽을 수 있는 건 초대 코드 한 건과 "`config/app`이 아직 없다"는 사실뿐이다(운영자 목록이 들어 있어서 `config/app`도 `member()`만 읽는다). 그래서 초대 코드 연결(`claimWithInvite`)은 명단을 읽지 않고 바로 쓰고, `App`은 `config/app` 읽기가 거부되면 `LOCKED`(연결 전 화면 + 계정 번호 + "지정됐는지 다시 확인")로 보여 준다.
- **운영자·공동 운영자는 참여하지 않는 계정이다.** 운영자 계정은 `users` 문서를 만들 수 없고(명단 연결 불가), `users` 문서가 있는 계정은 `config.admins`에 넣을 수 없다(한 번에 한 계정씩만 추가, 0명 불가). 그래서 운영자는 `assignments`·`giverCodes`·`codes`·`giverMissions`·`guesses`·`redemptions`·`reports`·`verdicts`·`progress`·`roster`·`deliveries`(쪽지 내용)·`clues`·`profiles`를 **언제든** 읽는다(쪽지 신고 처리·거짓 단서 확인). `votes`는 phase 4부터.
- **처음 운영자(`isOwner()` = `config.admins[0]`)만**: 운영자 목록·`adminNotes` 변경, `invites` 쓰기와 **목록 읽기**(공동 운영자가 가입 안 한 사람의 초대 코드를 읽어 그 이름에 다른 계정을 연결하지 못하게), `verdicts`의 "못 받음"(쓰기·바꾸기·취소), `roster` 추가·삭제와 연결 계정(`uid`) 비우기, `users` 삭제(연결 해제). 공동 운영자는 `roster.uid`를 바꿀 수 없다(남의 계정을 이름에 끼워 사칭하는 것 방지). 화면도 같은 버튼을 처음 운영자에게만 보인다(`useIsOwner`).
- **쓰기 횟수 `n`**: 참여자가 고치는 문서(`users`·`avatars`·`profiles`·`prefs`·`clues`·`giverMissions`·`progress`·`reports`·`guesses`·`midGuesses`·`votes`·`angelVolunteers`)는 쓸 때마다 `n`을 정확히 1 올려야 한다(규칙 `bumped()`, 화면은 `src/lib/writes.js`의 `bump()` = `increment(1)`). 운영 화면 "쓰기 횟수"가 이 값으로 한도 소진을 일으킨 사람을 찾는다. **이 문서들에 쓰는 화면 코드를 새로 만들면 `...bump()`를 꼭 넣는다**(빠지면 거부됨). 한 번만 만들 수 있는 문서(`deliveries`·`redemptions`·`feed`·`noteFlags`·`toManito`·`feedLikes`·`angelGifts`)에는 없다.
- 시각 필드(`createdAt`, `lastSeen`, `noteFlags.at`)는 `request.time`(= `serverTimestamp()`)만 받는다.
- 명단 원본(`roster`)은 운영자만 읽는다(연결된 계정 uid, 수상 제외·중도 이탈 표시가 들어 있다). 참여자는 `public/roster` 요약만.
- 인증 문서(`redemptions/{코드}`: `receiverPid, slot, review, voided, feedId, cardMatch, createdAt`)는 인증한 받는 사람(get·자기 것 목록), 그 코드를 가진 마니또(get), 운영자만 읽는다. 익명 피드는 **별도 문서 `feed/{무작위ID}`**(`slot, review, voided, createdAt, thanks?, hidden?` — 받는 사람·코드 없음)이고, 인증과 한 묶음(batch)으로만 만들 수 있다: 규칙이 `receiverCodes/{받는사람}`(giverCodes를 받는 사람 기준으로 뒤집은 것, 참여자는 못 읽음)로 그 사람의 코드를 찾아 `getAfter(redemptions/코드).feedId == 이 글`인지, 그 글이 이번 묶음에서 새로 생기는지 확인한다(이미 있는 남의 글을 가리키기 방지). 감사 답장은 글쓴이가 자기 `feed` 글의 `thanks`를 한 번만 쓴다(후기도 인증 문서와 같아야 함). 운영자의 무효 처리는 두 문서의 `voided`를 같이 바꾸고, 운영자는 피드 가리기·`thanks` 지우기·인증 `cardMatch` 고치기를 할 수 있다.
- 피드 가리기: 피드 글은 참여자 누구나 읽으므로 `hidden: true`와 함께 `review`를 `''`로 비우고 원문은 `hiddenFeed/{id}`(`review`, 운영자만)로 옮긴다(한 묶음, 규칙이 `getAfter`로 원문이 같은지 확인). 다시 보이기는 `hiddenFeed`의 원문으로만, 그리고 `hiddenFeed`를 지운다. 가린 글은 후기가 인증 문서와 달라져서 감사 답장도 막힌다.
- `cardMatch`: 받는 사람이 마니또가 고른 카드(완료 알림의 `card`)를 **보고** 받은 것이 그 카드와 같았는지 남긴 값. **`true`일 때만** 그 주차 카드 추가분(보통 +1·도전 +2)이 붙는다(`scoring.js`. 없거나 `false`면 없음 — 예전에는 없으면 맞는 것으로 봤는데, 마니또가 도전 카드를 골라 놓고 완료 알림 전에 코드만 건네면 받는 사람이 카드를 못 본 채 추가분이 붙었다).
  - 인증할 때: 완료 알림(`deliveries/{받는사람}_{주차}`)이 있어야 `cardMatch`를 같이 쓸 수 있다(규칙). 화면(`Detective.jsx` `CodeEntry`)은 카드가 보일 때만 넣는다.
  - 나중 카드 확인: 알림보다 먼저 인증했으면 `cardMatch` 없이 저장되고, 알림이 온 뒤 받는 사람이 `cardMatch`만 **한 번** 남긴다(phase 1~2, `Detective.jsx` `CardCheck`. 보통·도전 카드만 묻는다). 내 미션 화면 "이번 주 할 일"과 마니또의 "카드 확인 대기" 줄(`TicketSummary`)이 알려 준다. 운영자는 "인증 검토"에서 "카드 확인 전"·"카드와 다름"을 같음으로 고칠 수 있다.
  - 카드 난이도는 `scoring.js` `cardLevel`이 `MISSION_CARDS`의 (번호·난이도·글)과 맞는지 확인한 것만 쓴다. 규칙(`cardIdOk`)도 번호 머리글자(e·n·h·praise)가 난이도와 맞는지 본다 — **카드 번호 규칙(`e1`, `n1`, `h1`…)을 바꾸면 규칙도 같이 고친다**(`npm test`가 확인).
- `receiverCodes`는 배정할 때 같이 쓴다. 없으면 인증(피드 글 확인)이 거부되므로, 예전 방식으로 배정된 자료는 미션 시작 뒤 운영 화면(`Pairs`)이 채워 넣는다.
- 인증(`redemptions`), 완료 알림·쪽지(`deliveries`), 카드 고르기·완료 표시(`giverMissions`)는 **열린 주차(`config.week`)까지만** 되고, `giverMissions`는 phase 1에만 쓴다(`choices`·`notes`·`done`의 칸 이름은 `1`·`2`·`3`만, `done` 값은 `true`만. 집계·짝 현황·진행 수도 `=== true`만 완료로 센다). 인증(과 피드 글, 수호천사 미션 확인)은 phase 1~2(미션 마감 뒤 최종 지목이 마감될 때까지: 마감 직전에 온 미션을 인증할 시간). 닫힌 주차의 값은 "그대로 두는 것"만 허용해서, 운영자가 주차를 내려도 다른 주차 쓰기가 막히지 않는다. `progress.doneCount`도 열린 주차 수를 넘겨 올릴 수 없다.
- `deliveries`(`receiverPid, slot, kind, message, code, card, createdAt`, 보낸 사람 정보 없음) 문서 ID는 정해져 있다.
  - `mission`(1·2주차 완료 알림, `card` = 고른 카드의 `level`·`text`와 같아야 함)·`praise`(3주차 칭찬 카드, 10자 이상, `card` 없음): ID `{받는사람}_{주차}`. `giverMissions.done[주차]`를 켜는 것과 한 묶음으로만(규칙이 `getAfter`/`existsAfter`로 서로 확인). 그래서 주차마다 한 번이고, 완료 표시와 알림이 항상 같이 있다.
  - `note`(완료한 주차에 더 보내는 쪽지, 빈 쪽지 안 됨): ID `{받는사람}_{주차}_n{번째}`, `giverMissions.notes[주차]`를 1 올리는 것과 한 묶음으로만, 주차마다 `EXTRA_NOTES_MAX`(5)건까지.
  - 운영자는 `hidden`만 바꾸고(받는 사람 화면에서 가림), 지울 수 있다. 받는 사람은 `noteFlags/{쪽지ID}`(`at`)로 한 번 신고한다(운영 화면 "쪽지 검토").
- "받은 게 없어요": `reports/{받는사람_주차}`(`receiverPid, slot, active, createdAt, n`)는 받는 사람이 만들고, 취소는 `active = false`로 바꾼다(지울 수 없음, phase 1~3, 열린 주차). `verdicts/{받는사람_주차}`(`receiverPid, slot, verdict, at`, `received`/`missing`)는 운영자가 쓴다(phase 1~4). **`missing`은 처음 운영자만** 쓰고 바꾸고 지운다(공동 운영자는 `received`만 남기고 취소). 둘 다 받는 사람·그 사람의 마니또·운영자만 읽는다. 예전 신고에는 `active`가 없고 없으면 유효한 신고로 본다(`pairs.js`).
- `nudges/{받는사람}`(운영자가 켜는 알림. 그 사람의 마니또 화면에 "대상이 기다리고 있어요")은 그 받는 사람의 마니또만 get한다.
- 참여 재미 기능(응모권과 무관):
  - `prefs/{pid}`(`likes, avoid, nope, n`, 각 100자): 본인이 쓰고, 본인·나를 맡은 마니또(`myReceiver() == pid`)·운영자만 읽는다.
  - `toManito/{받는사람}_{주차}`(`receiverPid, slot, message, createdAt`): 받는 사람이 phase 1~2, 열린 주차까지, 주차마다 한 번 만든다(고칠 수 없음, 1~200자). 받는 사람·그 마니또(list `where receiverPid ==`)·운영자만 읽고, 운영자만 지운다.
  - `midGuesses/{pid}`(`guesses: { "주차": pid }, n`): phase 1에 열린 주차 칸만 쓰고 바꾼다(명단에 있는 다른 사람). 본인·운영자만 읽는다. 집계 때 `noticedWeeks`로 "몇 주차부터 계속 맞혔나"를 결과에 넣는다.
  - 피드 공감: `feed.likes`를 1 올리는 것과 `feedLikes/{글ID}_{pid}`(`pid, feedId, at`) 만들기를 한 묶음으로(규칙이 `exists`/`existsAfter`·`getAfter`로 서로 확인). 글마다 한 번, 취소 없음, phase 1~4, 가린 글·무효 글 불가. 공감 표시는 본인·운영자만 읽는다.
- 수호천사(응모권과 연결됨):
  - `angelVolunteers/{pid}`(`active, at, n`): 본인이 **phase 1에만** 지원·취소한다(규칙과 화면 모두) — 가입 기간에 먼저 가입한 사람이 순서에서 앞서지 않게. 본인·운영자만 읽는다.
  - `angels/{받는사람}`(`angelPid, at`): 운영자 계정이 phase 1에 쓴다. 규칙은 지원 중(`active`)인 사람만, 받는 사람 본인·그 사람의 마니또(`assignments/{angelPid}.receiverPid != 받는사람`)는 안 된다는 것까지 확인한다. `angelGifts`가 생기면 바꾸거나 지울 수 없다. 수호천사는 list `where angelPid ==`로 자기 것만 읽고, 받는 사람은 못 읽는다.
  - **연결할 사람은 운영자가 고르지 않는다**(`src/lib/angels.js` `matchAngels`, `Admin.jsx` `linkAngelsNow`): 2·3주차를 열 때(`setWeek`) 자동으로, 그때까지 마니또의 완료 알림이 0건이고 참여 중인 사람에게(명단 순서), 지원 시각(`angelVolunteers.at`)이 이른 순서로. 본인·그 사람의 마니또·이미 연결된 지원자·닫힌 주차의 자기 미션을 다 하지 않은 지원자·불참·수상 제외는 건너뛴다. 순서는 규칙이 아니라 화면이 지킨다(규칙으로는 목록을 훑을 수 없다). 운영자가 넘긴 짝은 `meta/angelSkips`(`pairs: { 받는사람: [지원자] }`, 운영자만 읽고 씀)에 적어 다시 붙지 않게 한다.
  - `angelGifts/{받는사람}_{1|2}`(`receiverPid, k, text, message, createdAt`, 보낸 사람 정보 없음): 연결된 수호천사가 phase 1에 만든다. 받는 사람이 한 번 `confirmed: true, review(10~500자), confirmedAt`을 더한다. 받는 사람은 list, 수호천사는 문서 ID로 get(아직 없는 문서도), 운영자는 전부 읽고 지운다.
  - `prefs`는 연결된 수호천사도 읽는다. 응모권은 `scoring.js`(`angels`·`angelGifts`), 발표 화면 "숨은 수호천사"(`results.angels`, `order` = 몇 번째로 지원했는지).
- `results/public.step`: 발표 화면이 넘긴 장면 번호(공개 단계에 운영자가 `draws`와 함께 바꿀 수 있는 유일한 값). 참여자 결과 화면은 `src/lib/reveal.js`의 `buildSlides`로 같은 장면 순서를 계산해 그 장면까지만 보인다(화면에서만 가리는 것 — 직접 읽으면 보인다). 집계 때 `step: 0`과 발표용 값(`guesses`·`noticed`·`story`·`stats`·`likesTop`)을 같이 저장한다.
- `config/app` 수정 규칙: 단계는 그대로이거나 한 칸 앞으로만(5가 마지막), 공개(5)로 넘어가려면 `results/public`이 있어야 한다. 주차는 1~3이고 한 번에 한 칸까지만 올린다. 단서는 줄일 수 없고 한 번에 2개까지, **공개 개수 ≤ 2 × 주차**. `assignVer`·`partExcluded`·`siteMatched`는 phase 0에서만 바꾼다.
- `results/public`: phase 4에는 통째로 다시 쓸 수 있지만 `draws`는 비어 있어야 하고, phase 5에는 비어 있던 `draws`를 **다섯 칸 전부, 같은 숫자로, 한 번만** 쓸 수 있다(규칙 `drawsShapeOk`: 한 칸만 먼저·모르는 칸·칸마다 다른 숫자·변경·삭제·재집계 불가. 칸 이름은 `prizes.js`의 `key`와 같아야 하고 `npm test`가 확인). 화면(`Reveal.jsx` `runDrawAll`)은 트랜잭션으로 "아직 안 뽑았을 때"만, 현장 숫자 하나로 정한 다섯 칸(`grand`·`best`·`t4`·`t5`·`t6`, 각 `{ seed, winners }`, `scoring.js` `drawAll`)을 한 번에 쓴다. 결과 화면 "추첨 검증"이 `verifyDraws`로 다시 계산한다(칸이 빠졌거나 숫자가 칸마다 다르면 통과하지 못한다).
- 투표는 없앴다(화면·집계 코드 삭제). 규칙의 `votes`·`voteCards`·`voteViews`·`cardOwners`·`adminEval` 경로와 그 테스트는 **규칙을 다시 게시하지 않아도 되게 그대로 두었다**(쓰는 화면이 없음). 다음에 규칙을 고칠 일이 있으면 같이 지운다. 단계 3은 `PHASE.CLOSED`("마감")로 이름만 바꿨다(단계는 한 칸씩만 넘어가므로 번호는 그대로).
- 단서는 배정 회차(`config.assignVer`, 배정할 때마다 +1)가 같은 것만 읽고 쓴다. 다시 배정해도 예전 마니또의 답이 남지 않게(실제로 재현된 버그).
- 단서 답 형식: 고르기 문항(0~2번)은 `firestore.rules`의 `clueAnswerOk`에 적힌 보기 중 하나, 직접 쓰기(3~5번: 책상 물건·TMI·요즘 빠진 것)는 공백 빼고 2자 이상, 모두 60자까지. **`PROFILE_QUESTIONS`의 보기를 바꾸면 규칙의 보기 목록도 같이 고친다**(`npm test`가 같은지 확인).
- 이미 공개된 단서 칸(`idx < cluesReleased`)은 같은 답으로만 다시 쓸 수 있다(프로필 화면도 그 칸을 잠금). 비어 있던 칸 새로 쓰기와 지난 회차 덮어쓰기는 된다.
- 파트 단서는 단서 문서 7번째 칸(`idx 6`). 배정할 때 운영자 브라우저가 쓰고 참여자는 쓸 수 없다. 받는 사람은 phase 2부터 읽는다.
- 단서 6칸은 일괄 저장이 아니라 한 칸씩 쓴다(공개된 칸이 규칙에 막혀도 나머지가 저장되게). 단서는 phase 2까지만 쓴다(지목이 마감된 뒤 프로필을 채워 은신 조건 "단서 6칸"만 맞추지 못하게).
- 진행 상황(`progress/{pid}`: 완료 알린 수, 최근 접속, 지목 여부)은 본인과 운영자만 읽는다. 참여자에게는 파트 합계(`public/board`)만 보인다.
- 파트 순위(`public/board`)는 운영자가 누를 때만 쓴다(단서 공개 버튼, "파트 순위만 다시 발표"). **실시간으로 올리지 말 것**: 미션을 받은 직후 어느 파트 숫자가 올랐는지로 마니또의 파트가 드러난다.

## 로그인

- "운영자·공동 운영자 계정 만들기" 버튼은 주소에 `?setup`이 있을 때만 보인다. 운영자가 없으면 첫 운영자가 되고, 이미 있으면 계정만 만들어져 "연결 전" 화면(`Claim.jsx`)으로 간다. 그 화면에 나오는 **계정 번호(uid)** 를 운영자가 운영 탭 "공동 운영자"에 넣어 지정한다(`config.admins`, 메모는 `config.adminNotes`).
- 실제 메일 주소 + 비밀번호(Firebase Authentication). 비밀번호 찾기는 `sendPasswordResetEmail`.
- 메일 주소는 `users/{uid}.email`에만(본인·운영자만 읽음, 규칙이 `request.auth.token.email`과 같은지 확인). 운영 화면 "연결된 메일"과 "연결 해제"(명단 연결 풀기 + `users` 문서 삭제 + 초대 코드 새로 발급)에 쓴다.
- `App`은 로그인 상태만 보고, 로그인한 사람의 구독·화면은 `Session`(key = uid)에 있다. 사람이 바뀌면 통째로 새로 만들어진다.
- 가입·운영자 계정 비밀번호는 8자 이상, 글자+숫자(`validatePassword`, 화면에서만). "로그인 유지"는 기본 꺼짐(기기마다 `localStorage` `manito:keep`에 기억).
- 화면 가리기: 내 미션의 대상 이름·캐릭터는 기본으로 가리고 60초 보기, 운영 화면 짝 현황은 접힘, 초대 코드·메일은 "보기"를 눌러야 보임.
- App Check는 `src/firebase.config.js`의 `appCheckSiteKey`가 있을 때만 켜진다(에뮬레이터 제외). 제공자는 `appCheckProvider`(기본 `"enterprise"` = reCAPTCHA Enterprise, `"v3"`도 가능). 사내망에서 reCAPTCHA가 열리는지 확인하기 전에는 콘솔에서 적용(enforce)을 켜지 말 것(README "App Check").
- 내 `users` 문서는 서버 저장이 확인된 스냅샷만 반영한다(`hasPendingWrites` 무시). 가입 직후 로컬 스냅샷으로 화면을 열면 규칙이 아직 "연결 전"으로 보고 내 배정 읽기를 거부한다(실제로 재현된 버그).

## 읽기 수 (무료 한도 하루 5만 건)

참여자 화면에서 컬렉션 전체를 구독하지 말 것. 내 앞으로 온 완료 알림·쪽지(`deliveries`)와 내 대상의 한마디(`toManito`)는 `App`의 `Session`이 한 번 구독해 `useApp()`의 `inbox`·`fromReceiver`로 나눠 쓴다(화면마다 따로 구독하지 말 것). 명단은 `public/roster` 요약, 캐릭터는 화면에 나온 사람만(10분 캐시), 피드는 `feed` 30건씩(감사 답장은 같은 문서. **실시간 구독하지 않는다**: 공감 수가 같은 문서에 있어서 구독하면 공감 한 번마다 열어 둔 사람 수만큼 읽기가 생긴다), 파트 순위는 `public/board` 1건.
운영 화면은 짝 현황 때문에 배정·코드·미션·인증·완료 알림·신고·지목 컬렉션을 통째로 구독한다(운영자 계정만 쓰므로 허용).
읽기 반복으로 한도를 소진하는 것은 서버 코드 없이 막거나 기록할 수 없다(README "비밀 유지 범위와 한계"). 쓰기는 `n`으로 사람별로 센다.
기기 저장소 캐시(persistentLocalCache)는 같은 기기 여러 사람 사용 때문에 쓰지 않는다. 자세한 내용은 README "무료 한도와 읽기 수".

## 정해진 규칙 (바꾸려면 사용자에게 먼저 확인)

- 참여 54명(부서 56명 중 운영자와 PL님 제외). **운영자와 공동 운영자는 참여하지 않는 계정**이고 명단에 넣지 않는다(짝·진행·지목을 언제든 본다). 미션 인증은 **받는 사람**이 코드 + 후기(20자 이상)로 한다. 회사 안 사진 촬영 불가라 사진 인증 없음.
- 가입과 배정은 서로 기다리지 않는다(사용자가 정함): 배정은 명단 전원으로 하고(가입 여부와 무관), 가입은 미션 시작 뒤에도 초대 코드로 할 수 있다. 가입할 시간을 하루쯤 준 뒤 미션을 시작하고, 그때까지 가입하지 않은 사람도 배정된 채로 둔다(가입 전까지 불참 처리, 가입하면 그때부터 참여).
- 배정: 원형, 자기 자신·같은 파트·맞마니또 없음. 기본은 근무지(SR3/S1L) 상관없이, 옵션으로 같은 근무지끼리만. 대상이 다른 근무지면 `remote: true` 카드만 제시.
  - 무작위 팀(8개 조)은 없앴다. 실제 소속 **파트**가 그 역할을 한다(같은 파트끼리 짝 없음, 추리 보드에서 내 파트 제외). 앱에 "팀"이라는 개념은 없다.
  - 한 파트가 (근무지 모드에서는 근무지마다) 인원의 절반을 넘으면 같은 파트 짝을 완전히 피할 수 없다. 그때는 되도록 적게 만들고 경고하며 `config.partExcluded = false`가 돼 추리 보드가 내 파트를 빼지 않는다.
- 일정(`SCHEDULE`): 11/17(화) 1주차, 11/24 2주차, 12/1 3주차(칭찬 카드), 단서는 금요일 11/20·11/27·12/4, 12/8(화) 미션 마감·최종 지목, 12/9(수) 송년회에서 집계 후 발표 화면으로 공개·시상·추첨.
- 단서: 프로필 6문항(고르기 3 + 직접 쓰기 3, `PROFILE_QUESTIONS`. 5번째가 "나만 아는 의외의 TMI"), 매주 금요일 운영자가 전원 동일하게 2개씩 공개(인증 수와 무관하게 — 은신 응모권 공정성 때문). 주차마다 2개까지만(공개 개수 ≤ 2 × 주차). 최종 지목 단계부터 마지막 단서로 마니또의 **파트**가 공개된다(부서 전원이 한 팀이고 파트만 다르다).
- 응모권: 미션 인증 1(최대 3), 카드 추가분 보통 +1·도전 +2(`cardBonus`, 합계 최대 4), 받는 사람 입력 1(최대 3), 은신 2, 정답 지목 1, 우승 파트 1, 수호천사 1(지원자만, `angelPerMission`, 최대 2). 최대 16장. 정체를 알려주면 둘의 합계가 −1이 되도록 설계됨.
  - 수호천사: 마니또가 미션을 안 해서 받은 게 없는 사람에게 지원자를 연결한다(1.5주씩 마니또를 바꾸는 방식은 사용자와 검토 후 하지 않기로 함). **연결은 먼저 지원한 순서대로 자동으로**(사용자가 정함: 운영자 판단이 최대한 적게 들어가도록. 2·3주차를 열 때, 기준은 `src/lib/angels.js`). 운영자 판단이 남는 곳은 "연결 풀고 다음 순번으로"를 누를지뿐이다. 확인된 수호천사 미션은 받는 사람의 인증 입력(보상과 합쳐 최대 3)으로 치고, "내 미션 수" 조건에는 넣지 않는다.
  - 은신은 **내 미션 3건이 모두 인증·인정되고**(`hiddenMinMissions: 3`. 1주만 하고 쉬는 것을 막으려고 1건에서 올림) **단서 6칸을 모두 낸**(`hiddenNeedsClues`, `cluesDoneSet`) 마니또만. 대상 불참·운영자 "받았음"으로 인정된 미션도 3건에 센다. 가입 안 한 사람·중도 이탈·수상 제외는 0장. 3건을 못 채운 마니또는 잃을 은신이 없어 "정체를 알려주면 합계 −1"이 성립하지 않는다(사용자가 알고 정함). 내 미션 화면 "끝까지 해야 받는 응모권" 줄(`TicketSummary`)이 남은 건수를 보여 준다.
  - 카드 추가분은 받는 사람이 **직접 인증했고, 마니또가 고른 카드를 보고 같다고 확인한(`cardMatch: true`) 미션에만** 준다. 완료 알림보다 먼저 인증한 미션은 받는 사람이 나중에 카드를 확인해야 붙는다(보안 점검에서 바꿈: 확인 없이 붙던 것을 막음). 대상 불참이나 운영자 확인으로 인정된 미션에는 주지 않는다.
  - "완료를 알린 주차"는 완료 알림(`deliveries`)이 있거나 완료 표시(`giverMissions.done`)가 있는 주차다(둘은 한 묶음으로 저장되지만 예전 자료를 위해 합쳐서 본다).
  - 상대방 때문에 손해 보지 않게: 마니또가 안 보낸 주차는 받는 사람에게 1장씩 보상(입력과 합쳐 최대 3, 본인 미션 1건 이상). 완료를 알렸는데 인증이 없는 주차는 운영자가 주차별로 확인한다 — **받았음**이면 마니또의 미션으로 인정, **못 받음**이면 인정하지 않고 받는 사람에게 안 보낸 주차와 같은 보상. 대상이 불참이면 확인 없이도 인정(단, "못 받음" 확인이 먼저). 확인이 없으면 어느 쪽에도 없다.
  - **3주차 칭찬 카드는 사이트가 전달하므로 받는 사람이 인증하지 않아도 마니또의 미션으로 인정한다**(사용자가 정함. `deliveries.kind == "praise"`이고 운영자가 가리지 않은 것. "못 받음" 확인이 먼저). 받는 사람은 인증해야 자기 인증 응모권을 받는다. 화면 표시(`pairs.js` 상태 `auto`, `MyMission.jsx` `TicketSummary`)도 같은 기준이다.
  - **무효 처리된 인증도 운영자가 "받았음"으로 확인하면 마니또의 미션은 인정한다**(사용자가 정함: 후기가 성의 없어 무효가 됐지만 미션은 실제로 받은 경우. 받는 사람 쪽은 달라지지 않는다). 확인이 없으면 예전처럼 인정하지 않는다. "집계 전 확인" 표에 무효 처리된 주차도 나온다.
  - **"못 받음"은 처음 운영자만 확정한다**(사용자가 정함: "내가 오케이 해야 반영". 신고만으로는 아무것도 바뀌지 않는다). 공동 운영자 화면에서는 버튼이 꺼져 있고, 누르면 결과를 알리는 확인창이 나온다. 보안 규칙(`verdicts`)도 `missing`은 처음 운영자만 받는다.
  - 받는 사람은 받은 것이 없으면 "받은 게 없어요"로 주차별 신고를 한다(1·2주차, 집계 전까지). 운영자는 신고가 없어도 집계 단계의 "집계 전 확인"에서 같은 확인을 할 수 있다.
  - 파트 대항전: 주간 순위는 완료 알린 수 ÷ (가입 인원 × 열린 주차)로 매주 금요일 단서 공개 때 발표(`weeklyPartBoard`). 마지막 집계에서 인증된 미션 기준 완수율 1위 파트(동률이면 모두)의 파트원에게 1장(`partStandings`). 내 미션이 1건 이상 인증된 사람만, 불참·수상 제외는 없음.
  - 이 계산은 `src/lib/scoring.js`, 참여자 안내문은 `src/pages/Rules.jsx`(파트 순위 탭 설명은 `src/pages/PartBoard.jsx`). 어긋나지 않게 같이 고친다.
- 상품과 추첨(`src/config/prizes.js`, 사용자가 정함): 1등 대추첨 50만원 1명, 2등 베스트 마니또 10만원 3명, 3등 베스트 후기상 5만원 1명(공감을 가장 많이 받은 후기), 4등 5만원 4명, 5등 1만원 7명, 6등 커피 쿠폰 5천원 20명.
  - **2등 베스트 마니또 = 응모권이 가장 많은 3명**(투표·운영진 평가 없음). 1등 당첨자는 빼고 정한다. 동점이면 **내 미션에 달린 후기가 남에게 받은 공감 수**(`missionLikes`, 집계할 때 `results/public.tieBreak`에 저장)가 많은 사람, 그래도 같을 때만 추첨 숫자로 가른다(`seededTop`). 모두가 열심히 하면 수십 명이 동점이 되기 때문이다(사용자가 최악의 상황 개선을 맡김).
  - 추첨은 현장 숫자 하나로 **큰 상부터 한 번에**(1등 → 2등 → 4등 → 5등 → 6등, `drawAll`), **한 사람은 그중 하나만**. 작은 상부터 뽑으면 응모권이 많은 사람이 작은 상에 먼저 뽑혀 큰 상을 놓치기 때문이다. 3등(후기상)은 추첨과 따로다(겹칠 수 있음).
  - **3등 베스트 후기상 = 익명 피드에서 공감을 가장 많이 받은 후기**(사용자가 정함: 운영진이 고르지 않는다). 집계할 때 `scoring.js` `reviewLikes` → `pickBestReview`로 정한다: 공감 수(`feed.likes`)에서 그 미션의 당사자 두 사람(후기를 쓴 받는 사람, 그 미션을 한 마니또)이 누른 것은 빼고(피드 글에 글쓴이가 없어 규칙으로는 못 막는다. `feedLikes`는 통째로 읽지 않고 당사자 문서 `{글ID}_{pid}`만 골라 읽는다), 무효·가린 후기와 수상 대상이 아닌 사람의 후기는 빼고, 동점이면 먼저 쓴 후기, 공감이 하나도 없으면 수상자 없음. 결과는 `results/public.bestReview`(`code, review, receiverPid, likes`).
  - 발표는 거꾸로 6등 → 5등 → 4등 → 3등 → 2등(한 명씩) → 1등(`reveal.js`). 추첨하는 순간 모든 당첨자가 저장되므로 참여자 화면은 넘긴 장면까지만 보인다(직접 읽으면 보인다 — `results/public.step`과 같은 한계).
  - 장면 수는 추첨 전후가 같아야 한다(`step`이 장면 번호): 2등 장면은 항상 `PRIZES.bestManito.count`개.
- 미션 비용: 돈이 드는 카드는 `cost: true`로 표시, 건당 5천원 이하 권장(`SPEND_GUIDE_WON`). 난이도마다 무비용 카드가 원격용 포함 2장 이상 있어야 한다(테스트가 확인).
- 미션 카드: "대상 이름 삼행시 쪽지 보내기"는 보통 카드. 완료한 주차에는 "쪽지 더 보내기"(주차마다 `EXTRA_NOTES_MAX`건. 보안 규칙에도 같은 숫자가 있어 바꾸면 같이 고친다 — `npm test`가 확인)가 있어 "3일 연속 응원 쪽지" 도전 카드를 할 수 있다. 추가 쪽지는 완료 표시·응모권에 영향이 없다.
- 운영 실수 방지: 집계 없이 공개 단계로 못 넘어감, 추첨 결과 덮어쓰기 불가, 단서 주차당 2개, 주차를 내릴 때 확인창, 규칙 버전 경고, 집계 "검산", 현장 숫자 하나로 한 번에 하는 검증 가능한 추첨(다시 뽑기 불가).
- 상품: `src/config/prizes.js` 한 곳에서 관리. 원천세 때문에 인원을 한두 명 줄일 수 있다고 사용자가 말함(아직 미정 — 줄일 때는 `count`만 고친다).
- 선물 예산 한도는 112만원(세금포함): 1~5등 합계 50 + 30 + 5 + 20 + 7 = 112만원. 6등 커피 쿠폰(10만원)은 회의비로 따로(원천세 없음).

## 코드 구조

| 파일 | 맡은 것 |
|---|---|
| `src/config/prizes.js` | 상품(1~6등)·응모권 규칙 |
| `src/lib/constants.js` | 단계, 근무지, 프로필 질문, 미션 카드, 캐릭터 목록 |
| `src/lib/assign.js` | 배정(같은 파트 제외. 조건에 맞는 원을 만든 뒤 자리 맞바꾸기로 섞음), 코드 생성 |
| `src/lib/scoring.js` | 응모권 계산(운영자 확인 `verdicts`·`cardMatch`·단서 6칸 반영), 파트 대항전 순위(주간·최종), 가중 추첨, 현장 숫자 하나로 큰 상부터 한 번에 정하는 추첨(`drawAll`: `seededDraw`·`seededTop`, 정하는 순서 `DRAW_ORDER`)과 검증(`verifyDraws`) |
| `src/lib/pairs.js` | 운영 화면 짝 현황(마니또별 주차 상태·지목), 운영자가 확인할 주차, 받는 사람 기준 코드(`receiverCodes`), 마니또가 낸 단서(`clueAnswers`·`cluesDoneSet`) |
| `src/lib/angels.js` | 수호천사 자동 연결 기준: 지원 순서(`angelQueue`), 도움이 필요한 사람(`needyReceivers`), 짝짓기(`matchAngels`), 운영 화면 표시(`angelQueueStatus`) |
| `src/lib/writes.js` | 쓰기 횟수 `bump()` = `{ n: increment(1) }` |
| `src/lib/reveal.js` | 송년회 발표 장면 순서(`buildSlides`: 원을 따라 잇는 짝 공개 `pairChain`, 추첨 장면 `drawGo` 뒤 6등 → 1등 발표), 참여자에게 열린 장면(`revealedUpTo`) |
| `src/pages/Reveal.jsx` | 결과 탭(참여자는 넘긴 장면까지만), 발표 화면(`Presenter`), 한 번에 추첨(`runDrawAll` 트랜잭션), 1~6등 목록(발표된 것만). 사람이 많은 장면은 한 장에 들어가게 줄인다(명탐정 `crowdSize`: 33명부터 이름만, 수호천사 9쌍부터 한 줄씩, 칭찬 벽 `PraiseWall`은 실제 높이를 재서 마지막 카드까지 흘러감) |
| `src/lib/roster.js` | 참여자 화면용 명단 요약(`public/roster`, 이름·근무지·파트). 운영 화면(`Admin.jsx`)이 명단과 다르면 다시 씀. 명단 입력 한 줄 읽기 |
| `src/pages/Rules.jsx` | 참여자용 규칙 안내(숫자는 `prizes.js`·`constants.js`에서) |
| `src/pages/PartBoard.jsx` | 파트 순위 탭(운영자가 발표한 `public/board`만 읽음) |
| `src/pages/Claim.jsx` | "연결 전" 화면: 초대 코드 연결, 공동 운영자로 지정받을 계정의 계정 번호 |
| `src/pages/Feed.jsx` | 익명 피드(`feed` 문서만 읽음) |
| `src/pages/Admin.jsx` | 운영 화면: 단계, 명단·배정, 주차·단서, 짝 현황(`Pairs`), 받은 게 없어요·집계 전 확인(`Unresolved`), 수호천사 연결(`Angels`), 인증 검토(`Moderation`), 쪽지 검토(`NotesReview`), 쓰기 횟수(`WriteCounts`), 집계·검산, 공동 운영자, 규칙 버전 경고(`RulesCheck`) |
| `src/ui.jsx` | 패널·대사창·캐릭터 공통 컴포넌트 |
| `src/firebase.js` | Firebase 연결. `npm run dev:emu`(`.env.emulator`)일 때만 에뮬레이터 연결. `appCheckSiteKey`가 있으면 App Check. `?longpoll`로 연 기기는 Firestore 긴 폴링(사내 프록시 대비) |
| `src/xmas.jsx`, `src/xmas.css`, `src/assets/xmas/` | 연말·크리스마스 장식(시즌 한정). 빼는 방법은 README "연말 장식" |
| `tools/xmas/` | 크리스마스 꾸밈 캐릭터(`leader1~4.png`)와 사람별 PNG(투명·4배·카드)를 만드는 Python 스크립트 |
| `tests/rules.test.js` | 보안 규칙 테스트 |
| `e2e/` | 화면 흐름 검증(`npm run test:e2e`, `run-all.cjs`가 9개를 차례로). 로컬 에뮬레이터 데이터를 지우고 시작한다 |
| `src/pages/*` | 화면 |
| `src/styles.css` | 방탈출 `assets/css/style.css`의 색·테두리·버튼·대사창 값을 따름. 시즌 장식은 여기 넣지 말고 `xmas.css`에 |
| `public/char/p1~p4.png` | 방탈출 참가자 캐릭터 |
| `public/char/boss1~4.png` | 방탈출 파트장님·PL님(로그인 화면 주인공 원본). 연말에는 `src/assets/xmas/leader1~4.png`(`tools/xmas/deco.py`로 꾸민 그림)를 쓴다 |

## 아직 안 된 것

- 사내망에서 Firebase 로그인(`identitytoolkit.googleapis.com`)과 Firestore(`firestore.googleapis.com`) 접속 확인, 비밀번호 재설정 메일 수신(회사 메일 차단 여부)과 링크(`프로젝트ID.firebaseapp.com`) 열림 확인
- 실제 Firebase 프로젝트에 연결한 상태의 화면 점검. 에뮬레이터로는 6명·3개 파트 기준 전체 흐름(운영자 설정 → 명단 → 배정 → 가입 → 미션 → 인증·피드·감사 답장 → 쪽지 더 보내기·쪽지 신고·가리기 → 카드와 다름 인증 → 공동 운영자 지정 → 받은 게 없어요 신고·확인 → 단서·파트 순위 발표 → 지목 → 마감 → 집계 전 확인 → 집계·검산 → 발표 화면(넘긴 장면까지만 참여자에게 공개)·숫자 하나로 한 번에 추첨·6등부터 발표·추첨 검증)과 4명 기준 참여 재미 기능(이번 주 할 일, 알레르기 칸, 안 읽은 표시, 마니또에게 한마디, 주차별 추측, 공감, 수호천사 자동 연결, 발표 화면의 명탐정·3등(공감 1위)), 그리고 가입 유예(가입 전 배정, 미션 시작 뒤 가입)를 화면으로 진행해 확인했다(콘솔 오류 0건, `npm run test:e2e` 9개). 실제 프로젝트·사내망은 아직.
- App Check: 코드만 있고 키가 비어 있어 꺼져 있다(reCAPTCHA Enterprise 기본). 실제 프로젝트에서 켰을 때의 동작, 사내망에서 reCAPTCHA가 열리는지 확인 안 됨.
- 읽기 반복으로 무료 한도를 소진하는 것은 막지 못한다(서버 코드 필요).
