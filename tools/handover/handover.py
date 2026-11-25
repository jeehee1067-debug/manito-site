#!/usr/bin/env python3
"""중도 이탈한 참여자를 짝에서 빼고 이어 붙인다(사용자가 정함, 11/26: "그 사람만 쏙 빠지게").

원래 원: X(이탈자의 마니또) → Y(이탈자) → Z(이탈자의 대상). Y가 빠지면 X가 --from-slot 주차부터 Z를 맡는다.
  - 짝: assignments/X = Z, assignments/Y는 지운다(바꾸기 전 값은 meta/handover에 저장).
  - 코드: Y가 갖고 있던 남은 주차 코드(Z 앞으로 발급된 것)를 X에게 옮긴다. 그래서 Z 쪽 코드(receiverCodes/Z)는 그대로다.
  - 단서: Z가 보는 단서 6칸(clues/Z_0~5)을 X의 답(X가 Y에게 낸 clues/Y_0~5)으로 바꾸고, 파트 단서(clues/Z_6)를 X의 파트로 바꾼다.
    X가 아직 안 채운 칸은 비운다(Z에게 Y의 답이 남지 않게). 이미 공개된 칸도 바꾼다(보안 규칙은 참여자가 공개된 칸을 못 바꾸게 할 뿐).
  - 명단: Y에 dropout(중도 이탈)·leftGame(짝에서 빠짐) 표시. 참여자 추리 보드 후보에서 Y가 빠진다(public/roster의 out).
  - --redo: X가 Y에게 이미 "완료"를 누른 --from-slot 이후 주차를 되돌린다(완료 표시·완료 알림·추가 쪽지 삭제, 기록은 저장).
    X는 그 주차를 Z에게 새로 한다(예: 메뉴판만 보내고 완료를 누른 마니또 카페 카드).
  - 안내: X와 Z에게 notices/{pid} = { id, kind: giver|receiver, fromSlot, redo, at }를 쓴다. 사이트가 두 사람에게만 팝업을 띄운다
    (src/pages/HandoverPopup.jsx — 이름·파트는 쓰지 않는다. Z에게 "같은 파트일 수 있다"를 알리면 마니또의 파트가 드러난다).
  - 기록: meta/handover.items에 { left, giver, receiver, fromSlot, at, saved }를 더한다. 사이트(운영 화면·집계)는 이 기록으로
    지난 주차의 짝을 계산한다(src/lib/handover.js). saved에는 바꾸기 전 값을 모두 넣는다(되돌리기 --undo와 송년회 때 Y의 응모권 계산).
    같은 내용을 실행한 폴더에도 파일로 남긴다(handover-<Y>-<시각>.json).

사이트 안 버튼이 아닌 이유: 미션이 시작된 뒤에는 보안 규칙상 운영자 계정도 짝·코드·단서를 바꿀 수 없다.
그래서 운영자 PC에서 서비스 계정 키로(보안 규칙을 거치지 않고) 쓴다(tools/restore와 같은 방식).

안전 장치
- --apply 없이 실행하면 계획만 보여 주고 쓰지 않는다. --apply 때도 프로젝트 ID를 직접 입력해야 진행한다(--yes로 생략).
- 미션 진행 단계(phase 1)에서만, 지금 열린 주차나 그 뒤 주차부터만 이어 붙인다(닫힌 주차는 바꾸지 않는다).
- Y가 이미 Z에게 한 주차가 --from-slot 이후에 있거나, --from-slot 이후 주차에 X·Y의 코드로 인증한 기록이 있으면 멈춘다.
- 모든 쓰기는 한 묶음(batch)이라 중간에 끊겨도 반쯤 바뀐 상태가 남지 않는다.
- --undo: 가장 최근 기록을 되돌린다(이어 받은 뒤 X가 Z에게 미션을 보냈거나 Z가 그 코드로 인증했으면 멈춘다).

사용법(먼저 `pip install -r tools/restore/requirements.txt` — google-cloud-firestore)
  python3 tools/handover/handover.py --key 키.json --leaver 홍길동                 계획만 보기
  python3 tools/handover/handover.py --key 키.json --leaver 홍길동 --redo --apply   적용(지금 주차의 완료를 되돌리고 이어 받음)
  python3 tools/handover/handover.py --key 키.json --leaver 홍길동 --from-slot 3 --apply   다음 주차부터 이어 받음
  python3 tools/handover/handover.py --key 키.json --undo [--apply]               가장 최근 이어 붙이기 되돌리기
  --leaver 는 명단 이름 또는 번호(p012 같은 것). --emulator 127.0.0.1:8080 --project demo-manito 로 로컬 에뮬레이터(검증용).
키.json: Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → "새 비공개 키 생성". 저장소에 올리거나 남에게 보내지 말 것.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone

SLOTS = (1, 2, 3)
CLUE_COUNT = 6
PART_HINT_IDX = 6
MAX_NOTES = 5  # constants.js EXTRA_NOTES_MAX


def connect(args):
    from google.cloud import firestore
    if args.emulator:
        os.environ["FIRESTORE_EMULATOR_HOST"] = args.emulator
        project = args.project or "demo-manito"
        return firestore.Client(project=project), project
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_file(args.key)
    project = args.project or creds.project_id
    return firestore.Client(project=project, credentials=creds), project


def plain(v):
    """Firestore 값 → JSON에 넣을 값(시각은 ISO 글자). 백업 파일과 같은 모양."""
    if isinstance(v, datetime):
        dt = v.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"
    if isinstance(v, list):
        return [plain(x) for x in v]
    if isinstance(v, dict):
        return {k: plain(x) for k, x in v.items()}
    return v


def unplain(v):
    """plain의 반대(되돌리기용): ISO 시각 글자를 datetime으로."""
    if isinstance(v, str) and len(v) == 24 and v.endswith("Z") and v[10] == "T":
        try:
            return datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            return v
    if isinstance(v, list):
        return [unplain(x) for x in v]
    if isinstance(v, dict):
        return {k: unplain(x) for k, x in v.items()}
    return v


def get(db, col, doc_id):
    s = db.collection(col).document(doc_id).get()
    return s.to_dict() if s.exists else None


def codes_of(doc):
    return {str(k): v for k, v in ((doc or {}).get("codes") or {}).items() if v}


def done_slots(m):
    return sorted(int(k) for k, v in ((m or {}).get("done") or {}).items() if v is True)


def confirm(args, project, n):
    if not args.apply:
        print(f"\n계획만 보여 드렸어요(쓰지 않음). 실제로 쓰려면 --apply 를 붙여 다시 실행해 주세요. (쓸 문서 {n}건)")
        return False
    if not args.yes:
        typed = input(f"\n{project} 에 문서 {n}건을 바꿉니다. 진행하려면 프로젝트 ID를 그대로 입력하세요: ").strip()
        if typed != project:
            sys.exit("입력이 달라서 멈췄어요. 아무것도 바꾸지 않았어요.")
    return True


def find_person(roster, key):
    if key in roster:
        return key
    hits = [pid for pid, r in roster.items() if (r.get("name") or "").strip() == key.strip()]
    if not hits:
        sys.exit(f"명단에서 '{key}'를 찾지 못했어요(이름 또는 p012 같은 번호).")
    if len(hits) > 1:
        sys.exit(f"'{key}'가 여러 명이에요: {', '.join(hits)}. 번호로 적어 주세요.")
    return hits[0]


def handover(db, project, args):
    from google.cloud import firestore
    cfg = get(db, "config", "app") or {}
    phase, week, ver = int(cfg.get("phase", 0)), int(cfg.get("week", 1)), cfg.get("assignVer", 0)
    released = int(cfg.get("cluesReleased", 0))
    if phase != 1:
        sys.exit(f"미션 진행 단계(1)에서만 쓸 수 있어요. 지금 단계: {phase}. (준비 단계라면 명단에서 빼고 다시 배정하면 돼요)")
    roster = {s.id: s.to_dict() for s in db.collection("roster").stream()}
    name = lambda pid: f"{(roster.get(pid) or {}).get('name', '?')}({pid})"
    part = lambda pid: ((roster.get(pid) or {}).get("part") or "").strip()
    Y = find_person(roster, args.leaver)
    assignments = {s.id: (s.to_dict() or {}).get("receiverPid") for s in db.collection("assignments").stream()}
    if Y not in assignments:
        sys.exit(f"{name(Y)}의 짝(assignments)이 없어요. 이미 빠졌을 수 있어요(meta/handover를 확인하세요).")
    Z = assignments[Y]
    givers = [g for g, r in assignments.items() if r == Y]
    if len(givers) != 1:
        sys.exit(f"{name(Y)}의 마니또를 하나로 찾지 못했어요: {givers}")
    X = givers[0]
    if X == Z:
        sys.exit("이탈자의 마니또와 대상이 같은 사람이에요(두 사람만 남는 경우). 이어 붙일 수 없어요.")
    if assignments.get(Z) == X:
        sys.exit(f"이어 붙이면 {name(X)} ↔ {name(Z)}가 서로의 마니또(맞마니또)가 돼요. 다른 방법이 필요해요(이 스크립트는 멈춰요).")
    F = int(args.from_slot or week)
    if F < week or F not in SLOTS:
        sys.exit(f"--from-slot은 지금 열린 주차({week}) 이상 3 이하여야 해요(닫힌 주차의 짝은 바꾸지 않아요).")

    gm_x, gm_y = get(db, "giverMissions", X), get(db, "giverMissions", Y)
    gc_x, gc_y = codes_of(get(db, "giverCodes", X)), codes_of(get(db, "giverCodes", Y))
    rc_y_doc, rc_z_doc = get(db, "receiverCodes", Y), get(db, "receiverCodes", Z)
    y_done_late = [s for s in done_slots(gm_y) if s >= F]
    if y_done_late:
        sys.exit(f"{name(Y)}이(가) {y_done_late}주차를 이미 {name(Z)}에게 완료했어요. 그 다음 주차부터 이어 받아야 해요(--from-slot {max(y_done_late) + 1}).")
    x_done_late = [s for s in done_slots(gm_x) if s >= F]
    if x_done_late and not args.redo:
        sys.exit(f"{name(X)}이(가) {x_done_late}주차를 이미 {name(Y)}에게 '완료'했어요.\n"
                 f"  · 그 완료를 되돌리고 {name(Z)}에게 새로 하게 하려면 --redo\n"
                 f"  · 그대로 두고 그다음 주차부터 이어 받게 하려면 --from-slot {max(x_done_late) + 1}")
    late_codes = [gc_x.get(str(s)) for s in SLOTS if s >= F] + [gc_y.get(str(s)) for s in SLOTS if s >= F]
    used = [c for c in late_codes if c and db.collection("redemptions").document(c).get().exists]
    if used:
        sys.exit(f"{F}주차 이후 코드로 이미 인증한 기록이 있어요({', '.join(used)}). 이 상태에서는 이어 붙이지 않아요.")
    missing_y = [s for s in SLOTS if s >= F and not gc_y.get(str(s))]
    if missing_y:
        sys.exit(f"{name(Y)}의 {missing_y}주차 코드가 없어요(giverCodes). 먼저 운영 화면 '인증 코드 점검하기'로 확인해 주세요.")

    # 새 코드: X는 F 전 주차 자기 코드 + F부터 Y의 코드(Z 앞으로 발급된 것), Y는 F 전 주차만
    new_gc_x = {**{str(s): gc_x[str(s)] for s in SLOTS if s < F and gc_x.get(str(s))}, **{str(s): gc_y[str(s)] for s in SLOTS if s >= F}}
    new_gc_y = {str(s): gc_y[str(s)] for s in SLOTS if s < F and gc_y.get(str(s))}
    new_rc_y = {str(s): gc_x[str(s)] for s in SLOTS if s < F and gc_x.get(str(s))}
    new_rc_z = {**codes_of(rc_z_doc), **{str(s): gc_y[str(s)] for s in SLOTS}}  # Y의 코드(F 전은 Y가, F부터는 X가 가진다)

    # 단서: X가 Y에게 낸 답(지금 회차) → Z가 볼 칸
    clues_y = {i: get(db, "clues", f"{Y}_{i}") for i in range(CLUE_COUNT)}
    clues_z = {i: get(db, "clues", f"{Z}_{i}") for i in range(CLUE_COUNT + 1)}
    clue_ops = []
    for i in range(CLUE_COUNT):
        src = clues_y[i]
        if src and src.get("ver", -1) == ver and str(src.get("answer") or "").strip():
            n = (clues_z[i] or {}).get("n", src.get("n", 0))
            clue_ops.append(("set", f"{Z}_{i}", {"receiverPid": Z, "idx": i, "answer": src["answer"], "ver": ver, "n": n}))
        elif clues_z[i]:
            clue_ops.append(("delete", f"{Z}_{i}", None))
    clue_ops.append(("set", f"{Z}_{PART_HINT_IDX}", {"receiverPid": Z, "idx": PART_HINT_IDX, "answer": part(X) or None, "ver": ver}))

    # --redo: X가 Y에게 한 F 이후 주차의 완료 알림·추가 쪽지
    removed = {}
    if args.redo:
        for s in x_done_late:
            ids = [f"{Y}_{s}"] + [f"{Y}_{s}_n{k}" for k in range(1, MAX_NOTES + 1)]
            for doc_id in ids:
                d = get(db, "deliveries", doc_id)
                if d:
                    removed[doc_id] = plain(d)
    progress_x = get(db, "progress", X)
    keep_done = [s for s in done_slots(gm_x) if s < F or not args.redo]

    angel_of_y = get(db, "angels", Y)
    from google.cloud.firestore_v1.base_query import FieldFilter
    angel_by_y = [s.id for s in db.collection("angels").where(filter=FieldFilter("angelPid", "==", Y)).stream()]
    nudge_y = get(db, "nudges", Y)
    notices_before = {pid: plain(get(db, "notices", pid)) for pid in (X, Z)}

    saved = {
        "assignmentY": {"receiverPid": Z},
        "giverCodesX": gc_x, "giverCodesY": gc_y,
        "receiverCodesY": codes_of(rc_y_doc), "receiverCodesZ": codes_of(rc_z_doc),
        "cluesZ": {f"{Z}_{i}": plain(v) for i, v in clues_z.items() if v},
        "giverMissionsX": plain(gm_x or {}), "progressX": plain(progress_x or {}),
        "rosterY": {k: plain(v) for k, v in (roster.get(Y) or {}).items() if k in ("dropout", "leftGame")},
        "deliveriesRemoved": removed,
        "notices": {pid: v for pid, v in notices_before.items() if v},
    }
    at = int(time.time() * 1000)
    item = {"left": Y, "giver": X, "receiver": Z, "fromSlot": F, "at": at, "saved": saved}
    notice_id = f"handover-{at}"  # 빠진 사람의 번호는 넣지 않는다(대상이 명단 요약과 맞춰 보면 이전 마니또를 알 수 있다)

    print(f"\n대상 프로젝트: {project}" + (f" (에뮬레이터 {args.emulator})" if args.emulator else ""))
    print(f"지금: 미션 진행, {week}주차 열림, 단서 {released}개 공개, 배정 회차 {ver}")
    print(f"\n원래 원:  {name(X)} [{part(X)}] → {name(Y)} [{part(Y)}] → {name(Z)} [{part(Z)}]")
    print(f"바뀐 뒤:  {name(X)} → {name(Z)}  ({F}주차부터. 그 전 주차는 원래 짝 그대로 셉니다)")
    if part(X) and part(X) == part(Z):
        print(f"  ⚠ 같은 파트({part(X)}) 짝이 돼요. {name(Z)}의 추리 보드는 최종 지목 단계의 파트 단서가 같은 파트로 나오면 같은 파트도 후보에 보여요.")
    print("\n바꿀 것")
    print(f"  · assignments/{X} = {Z},  assignments/{Y} 삭제")
    print(f"  · giverCodes/{X}: {gc_x} → {new_gc_x}")
    print(f"  · giverCodes/{Y}: {gc_y} → {new_gc_y}")
    print(f"  · receiverCodes/{Y} → {new_rc_y},  receiverCodes/{Z} → {new_rc_z}")
    for op, doc_id, data in clue_ops:
        before = (clues_z.get(int(doc_id.split("_")[-1])) or {}).get("answer")
        after = data["answer"] if data else "(비움)"
        shown = "공개됨" if int(doc_id.split("_")[-1]) < released else ("최종 지목 때 공개" if doc_id.endswith(f"_{PART_HINT_IDX}") else "아직 비공개")
        print(f"  · clues/{doc_id} [{shown}]: {before!r} → {after!r}")
    print(f"  · roster/{Y}: dropout = true, leftGame = true  /  public/roster: {Y} 추리 보드 후보에서 빼기")
    if args.redo:
        print(f"  · --redo: giverMissions/{X}의 {x_done_late}주차 완료 표시·추가 쪽지 수 지우기, progress/{X}.doneCount = {len(keep_done)}")
        for doc_id, d in removed.items():
            print(f"      deliveries/{doc_id} 삭제 (내용은 기록에 저장): {str(d.get('message', ''))[:60]!r}")
    print(f"  · notices/{X}(대상이 바뀐 안내), notices/{Z}(마니또가 바뀐 안내): 두 사람이 사이트를 열면 팝업으로 뜬다(이름·파트는 쓰지 않음)")
    print(f"  · meta/handover에 기록 추가(바꾸기 전 값 저장)")
    if angel_of_y:
        print(f"  ⚠ {name(Y)}에게 수호천사가 연결돼 있어요(angels/{Y}). 운영 화면 수호천사에서 확인해 주세요(그대로 둡니다).")
    if angel_by_y:
        print(f"  ⚠ {name(Y)}이(가) 수호천사로 연결된 사람이 있어요: {angel_by_y}. 운영 화면에서 연결을 풀어 주세요(그대로 둡니다).")
    if nudge_y:
        print(f"  · nudges/{Y}(대상이 기다리고 있어요 알림)는 그대로 둡니다(이제 읽을 사람이 없어요).")

    n_writes = 2 + 2 + 2 + len(clue_ops) + 2 + 2 + 1 + (2 + len(removed) if args.redo else 0)
    if not confirm(args, project, n_writes):
        return
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    local = f"handover-{Y}-{stamp}.json"
    with open(local, "w", encoding="utf-8") as f:
        json.dump(item, f, ensure_ascii=False, indent=2)
    b = db.batch()
    col = db.collection
    b.set(col("assignments").document(X), {"receiverPid": Z})
    b.delete(col("assignments").document(Y))
    b.set(col("giverCodes").document(X), {"codes": new_gc_x})
    b.set(col("giverCodes").document(Y), {"codes": new_gc_y})
    b.set(col("receiverCodes").document(Y), {"codes": new_rc_y})
    b.set(col("receiverCodes").document(Z), {"codes": new_rc_z})
    for op, doc_id, data in clue_ops:
        ref = col("clues").document(doc_id)
        b.set(ref, data) if op == "set" else b.delete(ref)
    b.update(col("roster").document(Y), {"dropout": True, "leftGame": True})
    b.set(col("public").document("roster"), {"people": {Y: {"out": True}}}, merge=True)
    if args.redo and x_done_late:
        upd = {}
        for s in x_done_late:
            upd[f"done.`{s}`"] = firestore.DELETE_FIELD
            upd[f"notes.`{s}`"] = firestore.DELETE_FIELD
        b.update(col("giverMissions").document(X), upd)
        if progress_x is not None:
            b.update(col("progress").document(X), {"doneCount": len(keep_done)})
        for doc_id in removed:
            b.delete(col("deliveries").document(doc_id))
    b.set(col("notices").document(X), {"id": notice_id, "kind": "giver", "fromSlot": F, "redo": bool(args.redo and x_done_late), "at": at})
    b.set(col("notices").document(Z), {"id": notice_id, "kind": "receiver", "fromSlot": F, "redo": False, "at": at})
    b.set(col("meta").document("handover"), {"items": firestore.ArrayUnion([item])}, merge=True)
    b.commit()
    print(f"\n끝났어요. 바꾸기 전 값은 meta/handover와 이 폴더의 {local} 에 저장했어요.")
    print("사이트에서 확인: 운영 화면 '운영 자료 불러오기' → 짝 현황(이탈자 줄은 '중도 이탈', 이어 받은 주차 표시).")


def undo(db, project, args):
    from google.cloud import firestore
    doc = get(db, "meta", "handover") or {}
    items = doc.get("items") or []
    if not items:
        sys.exit("되돌릴 기록이 없어요(meta/handover).")
    it = items[-1]
    X, Y, Z, F, sv = it["giver"], it["left"], it["receiver"], int(it["fromSlot"]), it.get("saved") or {}
    late_x = [s for s in done_slots(get(db, "giverMissions", X)) if s >= F]
    if late_x:
        sys.exit(f"이어 받은 뒤 {X}가 {Z}에게 {late_x}주차를 완료했어요. 되돌리면 그 기록이 어긋나서 멈춰요(콘솔에서 직접 판단해 주세요).")
    used = [c for s, c in (sv.get("giverCodesY") or {}).items() if int(s) >= F and db.collection("redemptions").document(c).get().exists]
    if used:
        sys.exit(f"이어 받은 뒤 {Z}가 코드로 인증했어요({used}). 되돌리지 않아요.")
    print(f"\n대상 프로젝트: {project}" + (f" (에뮬레이터 {args.emulator})" if args.emulator else ""))
    print(f"되돌릴 기록: {Y}가 빠지고 {X}가 {F}주차부터 {Z}를 맡은 것 → 원래 원 {X} → {Y} → {Z}로")
    print(f"  · 짝·코드·단서({len(sv.get('cluesZ') or {})}칸)·명단 표시를 바꾸기 전 값으로, 지운 완료 알림 {len(sv.get('deliveriesRemoved') or {})}건 되살리기")
    if not confirm(args, project, 12):
        return
    b = db.batch()
    col = db.collection
    b.set(col("assignments").document(X), {"receiverPid": Y})
    b.set(col("assignments").document(Y), sv.get("assignmentY") or {"receiverPid": Z})
    b.set(col("giverCodes").document(X), {"codes": sv.get("giverCodesX") or {}})
    b.set(col("giverCodes").document(Y), {"codes": sv.get("giverCodesY") or {}})
    b.set(col("receiverCodes").document(Y), {"codes": sv.get("receiverCodesY") or {}})
    b.set(col("receiverCodes").document(Z), {"codes": sv.get("receiverCodesZ") or {}})
    saved_clues = sv.get("cluesZ") or {}
    for i in range(CLUE_COUNT + 1):
        doc_id = f"{Z}_{i}"
        ref = col("clues").document(doc_id)
        b.set(ref, unplain(saved_clues[doc_id])) if doc_id in saved_clues else b.delete(ref)
    ry = sv.get("rosterY") or {}
    b.update(col("roster").document(Y), {"dropout": ry.get("dropout", firestore.DELETE_FIELD), "leftGame": ry.get("leftGame", firestore.DELETE_FIELD)})
    b.update(col("public").document("roster"), {f"people.`{Y}`.out": firestore.DELETE_FIELD})
    if sv.get("giverMissionsX"):
        b.set(col("giverMissions").document(X), unplain(sv["giverMissionsX"]))
    if sv.get("progressX"):
        b.set(col("progress").document(X), unplain(sv["progressX"]))
    for doc_id, d in (sv.get("deliveriesRemoved") or {}).items():
        b.set(col("deliveries").document(doc_id), unplain(d))
    saved_notices = sv.get("notices") or {}
    for pid in (X, Z):
        ref = col("notices").document(pid)
        b.set(ref, unplain(saved_notices[pid])) if pid in saved_notices else b.delete(ref)
    b.set(col("meta").document("handover"), {"items": items[:-1]})
    b.commit()
    print("\n되돌렸어요. 사이트를 새로 고쳐 확인해 주세요.")


def main():
    ap = argparse.ArgumentParser(description="중도 이탈한 참여자를 짝에서 빼고 이어 붙이기(meta/handover 기록)")
    ap.add_argument("--key", help="서비스 계정 키 JSON 경로")
    ap.add_argument("--project", help="프로젝트 ID(기본: 키에 적힌 것)")
    ap.add_argument("--emulator", help="로컬 에뮬레이터 주소(검증용), 예: 127.0.0.1:8080")
    ap.add_argument("--leaver", help="빠지는 사람(명단 이름 또는 번호)")
    ap.add_argument("--from-slot", type=int, help="이어 받는 첫 주차(기본: 지금 열린 주차)")
    ap.add_argument("--redo", action="store_true", help="이탈자의 마니또가 이미 '완료'한 그 주차 이후를 되돌리고 새 대상에게 다시 하게 한다")
    ap.add_argument("--undo", action="store_true", help="가장 최근 이어 붙이기를 되돌린다")
    ap.add_argument("--apply", action="store_true", help="실제로 쓴다(없으면 계획만)")
    ap.add_argument("--yes", action="store_true", help="프로젝트 ID 확인 입력을 생략(검증 스크립트용)")
    args = ap.parse_args()
    if not args.key and not args.emulator:
        sys.exit("--key 서비스계정키.json (또는 검증용 --emulator 주소)가 필요해요.")
    if not args.undo and not args.leaver:
        sys.exit("--leaver 빠지는 사람(이름 또는 번호)을 적어 주세요.")
    db, project = connect(args)
    undo(db, project, args) if args.undo else handover(db, project, args)


if __name__ == "__main__":
    main()
