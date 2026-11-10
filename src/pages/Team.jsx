import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { useApp } from "../App.jsx";
import { Avatar, Panel } from "../ui.jsx";

export default function Team() {
  const { roster, myTeam, myPid } = useApp();
  const members = roster.filter((r) => r.team === myTeam).sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const [progress, setProgress] = useState({});

  useEffect(() => {
    members.forEach((m) =>
      getDoc(doc(db, "progress", m.pid))
        .then((s) => setProgress((p) => ({ ...p, [m.pid]: s.exists() ? s.data() : {} })))
        .catch(() => {})
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.map((m) => m.pid).join(",")]);

  if (!myTeam) return <Panel title="우리 팀"><p className="muted">아직 팀이 정해지지 않았어요.</p></Panel>;

  const total = members.reduce((s, m) => s + (progress[m.pid]?.doneCount || 0), 0);

  return (
    <Panel title={`${myTeam}팀 현황 (${total} / ${members.length * 3})`}>
      <p className="small">팀원별로 마니또 미션을 몇 개 했는지만 보여요. 누구를 맡았는지는 보이지 않아요.</p>
      <ul className="team">
        {members.map((m) => {
          const p = progress[m.pid] || {};
          return (
            <li key={m.pid} className={m.pid === myPid ? "me" : ""}>
              <Avatar pid={m.pid} size={44} />
              <span className="team-name">{m.name}{m.loc ? <span className="loc-tag sm">{m.loc}</span> : null}</span>
              <span className="dots" aria-label={`미션 ${p.doneCount || 0}개 완료`}>
                {[0, 1, 2].map((i) => <i key={i} className={i < (p.doneCount || 0) ? "dot on" : "dot"} />)}
              </span>
              {!p.profileDone && <span className="small muted">프로필 미작성</span>}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
