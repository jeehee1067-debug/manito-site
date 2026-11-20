#!/usr/bin/env python3
"""운영 화면 "백업 내려받기"로 받은 전체 백업(manito-backup-날짜-시각.json)으로 Firestore 자료를 되살린다.

사이트 안 버튼으로 만들지 않은 이유: 보안 규칙상 운영자 계정도 인증·피드 글·완료 표시처럼 대부분의 기록을
대신 쓸 수 없다. 그래서 운영자 PC에서 서비스 계정 키로(보안 규칙을 거치지 않고) 쓴다.

안전 장치
- 아무것도 지우지 않는다. 기본은 "지금 DB에 없는 문서만" 백업 값으로 다시 만든다.
- --apply 없이 실행하면 계획만 보여 주고 쓰지 않는다. --apply로 쓸 때도 프로젝트 ID를 직접 입력해야 진행한다(--yes로 생략).
- --overwrite: 백업과 내용이 다른 문서도 백업 값으로 덮어쓴다(백업 뒤의 변경 — 공감 수·진행 상황 등 — 이 사라진다).
  이때도 설정(config/app: 단계·주차·단서 공개 수)은 --include-config를 붙여야 덮어쓴다(예전 단계로 되돌아가지 않게).
- 백업을 만든 사람이 읽지 못한 컬렉션(failed, 공동 운영자의 초대 코드·메일 색인)은 건너뛴다.

시각 값: 백업 파일에는 시각이 ISO 글자("2026-11-20T01:23:45.678Z", 밀리초까지)로 들어 있다. 정확히 이 모양인 글자를
Firestore 시각으로 되돌린다(원래 시각의 밀리초 아래 자리는 백업에 없어서 0이 된다).

읽기·쓰기 수: DB와 비교할 때 되살릴 컬렉션의 문서를 모두 한 번 읽는다(전체 문서 수만큼). 쓰기는 되살리는 문서 수만큼.
무료 한도(하루 읽기 5만·쓰기 2만) 안이지만, 한도가 이미 찬 날에는 오후 5시(한국 시간) 이후에 실행할 것.

사용법(먼저 `pip install google-cloud-firestore`)
  python3 restore_backup.py 백업.json                              파일만 확인(DB에 접속하지 않음)
  python3 restore_backup.py 백업.json --key 키.json                 지금 DB와 비교해 계획만 보기
  python3 restore_backup.py 백업.json --key 키.json --apply         없어진 문서만 되살리기
  python3 restore_backup.py 백업.json --key 키.json --apply --overwrite   다른 문서도 백업 값으로(설정 제외)
  --only roster,feed     일부 컬렉션만(설정 문서는 config/app으로 적는다)
  --emulator 127.0.0.1:8080 --project demo-manito    로컬 에뮬레이터(검증용)
키.json: Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성". 저장소에 올리거나 남에게 보내지 말 것.
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone

ISO_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
BATCH = 400  # Firestore 한 묶음은 500건까지


def to_firestore(v):
    """백업 값 → Firestore에 쓸 값(ISO 시각 글자는 datetime으로)."""
    if isinstance(v, str) and ISO_RE.match(v):
        return datetime.fromisoformat(v.replace("Z", "+00:00"))
    if isinstance(v, list):
        return [to_firestore(x) for x in v]
    if isinstance(v, dict):
        return {k: to_firestore(x) for k, x in v.items()}
    return v


def iso_ms(dt):
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def to_plain(v):
    """Firestore에서 읽은 값 → 백업 파일과 같은 모양(비교용). 시각은 밀리초까지의 ISO 글자."""
    if isinstance(v, datetime):
        return iso_ms(v)
    if isinstance(v, list):
        return [to_plain(x) for x in v]
    if isinstance(v, dict):
        return {k: to_plain(x) for k, x in v.items()}
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    return str(v)  # 이 사이트는 참조·좌표·바이트 값을 쓰지 않는다


def load_backup(path):
    with open(path, encoding="utf-8") as f:
        b = json.load(f)
    if b.get("kind") != "full-backup" or not isinstance(b.get("collections"), dict):
        sys.exit(f"전체 백업 파일이 아니에요: {path} (운영 화면 '전체 백업 파일 받기 (JSON)'로 받은 파일이어야 해요. CSV는 되살리기에 못 써요)")
    return b


def targets(b, only):
    """되살릴 대상: [(경로 이름, 컬렉션, {문서ID: 값})]. 설정 문서는 ("config/app", "config", {"app": 값})."""
    out, skipped = [], []
    for name, docs in sorted(b["collections"].items()):
        if only and name not in only:
            continue
        if docs is None:
            skipped.append(name)
            continue
        out.append((name, name, docs))
    for path, data in sorted((b.get("docs") or {}).items()):
        if only and path not in only:
            continue
        col, _, doc_id = path.partition("/")
        if data is None:
            skipped.append(path)
            continue
        out.append((path, col, {doc_id: data}))
    return out, skipped


def connect(args):
    from google.cloud import firestore
    if args.emulator:
        # 에뮬레이터: 자격 증명을 넘기지 않으면 클라이언트가 관리자 토큰(owner)으로 접속한다(보안 규칙을 거치지 않음)
        os.environ["FIRESTORE_EMULATOR_HOST"] = args.emulator
        project = args.project or "demo-manito"
        return firestore.Client(project=project), project
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_file(args.key)
    project = args.project or creds.project_id
    return firestore.Client(project=project, credentials=creds), project


def main():
    ap = argparse.ArgumentParser(description="manito 백업 JSON으로 Firestore 자료 되살리기(지우지 않음)")
    ap.add_argument("backup")
    ap.add_argument("--key", help="서비스 계정 키 JSON 경로")
    ap.add_argument("--project", help="프로젝트 ID(기본: 키에 적힌 것)")
    ap.add_argument("--emulator", help="로컬 에뮬레이터 주소(검증용), 예: 127.0.0.1:8080")
    ap.add_argument("--only", help="쉼표로 구분한 컬렉션 이름(설정은 config/app)")
    ap.add_argument("--apply", action="store_true", help="실제로 쓴다(없으면 계획만)")
    ap.add_argument("--overwrite", action="store_true", help="백업과 다른 문서도 백업 값으로 덮어쓴다")
    ap.add_argument("--include-config", action="store_true", help="--overwrite 때 config/app(단계·주차·단서 공개 수)도 덮어쓴다")
    ap.add_argument("--yes", action="store_true", help="프로젝트 ID 확인 입력을 생략(검증 스크립트용)")
    args = ap.parse_args()

    b = load_backup(args.backup)
    only = set(x.strip() for x in args.only.split(",")) if args.only else None
    plan_targets, skipped = targets(b, only)
    total = sum(len(d) for _, _, d in plan_targets)
    print(f"백업 파일: {args.backup}")
    print(f"  만든 시각(UTC): {b.get('exportedAt')}   문서 {total:,}건, 컬렉션 {len(plan_targets)}개")
    if skipped:
        print(f"  ⚠ 백업에 없는 것(만든 사람이 읽지 못함) — 건너뜀: {', '.join(skipped)}")

    if not args.key and not args.emulator:
        for name, _, docs in plan_targets:
            print(f"  {name:<18} {len(docs):>5}건")
        print("\nDB에 접속하지 않았어요(파일만 확인). 지금 DB와 비교하려면 --key 서비스계정키.json 을 붙여 주세요.")
        return

    db, project = connect(args)
    print(f"\n대상 프로젝트: {project}" + (f" (에뮬레이터 {args.emulator})" if args.emulator else ""))
    rows, writes = [], []
    for name, col, docs in plan_targets:
        current = {s.id: to_plain(s.to_dict()) for s in db.collection(col).stream()} if name == col else {}
        if name != col:  # 문서 하나(config/app)
            doc_id = next(iter(docs))
            s = db.collection(col).document(doc_id).get()
            if s.exists:
                current[doc_id] = to_plain(s.to_dict())
        missing = [i for i in docs if i not in current]
        differ = [i for i in docs if i in current and current[i] != docs[i]]
        newer = [i for i in current if i not in docs]
        can_overwrite = args.overwrite and (name != "config/app" or args.include_config)
        todo = missing + (differ if can_overwrite else [])
        rows.append((name, len(docs), len(missing), len(differ), len(newer), len(todo)))
        writes += [(col, i, docs[i]) for i in todo]

    print(f"\n{'컬렉션':<18}{'백업':>6}{'없어짐':>7}{'다름':>6}{'백업 뒤 생김':>12}{'쓸 것':>7}")
    for name, n, miss, diff, new, todo in rows:
        print(f"{name:<18}{n:>6}{miss:>7}{diff:>6}{new:>12}{todo:>7}")
    diff_total = sum(r[3] for r in rows)
    print("\n· '없어짐'은 백업에는 있는데 지금 DB에 없는 문서, '다름'은 내용이 바뀐 문서(백업 뒤 정상적으로 바뀐 것일 수 있어요),")
    print("  '백업 뒤 생김'은 백업 뒤에 새로 생긴 문서예요(그대로 둬요). 이 스크립트는 아무것도 지우지 않아요.")
    if diff_total and not args.overwrite:
        print("· '다름'은 기본으로 그대로 둬요. 백업 시점으로 되돌리려면 --overwrite(설정까지는 --include-config).")
    if not writes:
        print("\n쓸 것이 없어요.")
        return
    if not args.apply:
        print(f"\n계획만 보여 드렸어요(쓰지 않음). 실제로 {len(writes):,}건을 쓰려면 --apply 를 붙여 다시 실행해 주세요.")
        return
    if not args.yes:
        typed = input(f"\n{project} 에 {len(writes):,}건을 씁니다. 진행하려면 프로젝트 ID를 그대로 입력하세요: ").strip()
        if typed != project:
            sys.exit("입력이 달라서 멈췄어요. 아무것도 쓰지 않았어요.")
    done = 0
    for k in range(0, len(writes), BATCH):
        batch = db.batch()
        for col, doc_id, data in writes[k:k + BATCH]:
            batch.set(db.collection(col).document(doc_id), to_firestore(data))
        batch.commit()
        done += len(writes[k:k + BATCH])
        print(f"  {done:,} / {len(writes):,}건 썼어요")
    print("\n끝났어요. 사이트를 새로 고쳐 확인해 주세요(운영 화면 '운영 자료 불러오기' → 짝 현황).")


if __name__ == "__main__":
    main()
