#!/usr/bin/env node
// 부서 공지용 "N주차 결산" 그림(PNG)과 메일 글 만들기(사용자가 정함, 11/25). 숫자 계산은 compute.js.
//   node tools/report/report.mjs <백업.json> --week 1 --out <폴더> [--font-dir <Galmuri 글꼴 폴더>] [--width 1400]
//   node tools/report/report.mjs --sample --out <폴더>        예시 숫자로 모양만 보기(그림에 "예시" 띠가 붙는다)
// 결과: report.json(숫자), report.html, report.png(가로 --width(기본 1400, 메일 본문에서 보기 좋은 조금 넓은 비율) 기준 2배), mail.txt(제목·본문, 사진 4장 들어갈 자리 표시)
// 후기는 줄여 쓰지 않고 전부 싣는다(사용자가 정함, 11/26).
// 백업 JSON에는 이름·메일·누가 누구의 마니또인지가 들어 있다. 이 스크립트의 결과에는 넣지 않지만, 백업 파일 자체는 운영진만 다룬다.
// 그림은 Playwright(Chromium)로 찍는다. 글꼴 Galmuri는 --font-dir가 없으면 jsDelivr에서 불러온다(사이트와 같은 글꼴).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { SCHEDULE, CLUE_DATES, LEVEL_LABEL, shortDate, weekDeadline } from "../../src/lib/constants.js";
import { GOLD_DRAW, PRIZES } from "../../src/config/prizes.js";
import { computeReport, goldCardNames, newCardNames } from "./compute.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ICONS = path.resolve(HERE, "../../src/assets/icons");

const SAMPLE = {
  week: 1, sample: true, completion: 78, nextCompletion: 31, verifiedPct: 85, notes: 142, likes: 318,
  levelMix: { easy: 34, normal: 41, hard: 25, praise: 0 }, howMix: { real: 38, site: 62 },
  popular: [{ title: "(예시) 응원 쪽지 보내기", level: "easy" }, { title: "(예시) 간식 몰래 두기", level: "normal" }, { title: "(예시) 상장 만들어 전달하기", level: "hard" }],
  guessPct: 72, guessCorrect: 6,
  topReviews: [
    { text: "(예시) 출근했더니 책상 위에 귤 두 개와 쪽지가! 하루가 상큼했어요. 누군지 너무 궁금해요", likes: 14 },
    { text: "(예시) 신발장에서 핫팩을 발견했어요. 손도 마음도 따뜻해졌습니다 :)", likes: 11 },
    { text: "(예시) 삼행시 쪽지에 빵 터졌어요. 제 이름으로 이런 게 나올 줄이야", likes: 9 },
  ],
};

function args(argv) {
  const out = { week: 1, width: 1400 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sample") out.sample = true;
    else if (a === "--week") out.week = Number(argv[++i]);
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--font-dir") out.fontDir = argv[++i];
    else if (a === "--width") out.width = Math.max(900, Math.min(2000, Number(argv[++i]) || 1400));
    else if (!a.startsWith("--")) out.backup = a;
  }
  return out;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const icon = (name) => `<img class="ico" src="${pathToFileURL(path.join(ICONS, `${name}.svg`)).href}" alt="">`;

// 다음 주차 일정(마감·단서 공개)
function nextInfo(week) {
  const weeks = SCHEDULE.filter((e) => e.kind === "week");
  const start = weeks[week - 1]?.date;
  const end = weekDeadline(week)?.date;
  return {
    period: start && end ? `${shortDate(start)} ~ ${shortDate(end)}` : "",
    nextDue: weekDeadline(week + 1)?.label || "",
    nextClue: CLUE_DATES[week] || "",
  };
}

function fontCss(fontDir) {
  if (!fontDir) return `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/galmuri@2.40.3/dist/galmuri.css">`;
  const f = (file) => pathToFileURL(path.join(fontDir, file)).href;
  return `<style>
  @font-face { font-family: "Galmuri11"; src: url("${f("Galmuri11.woff2")}") format("woff2"); font-weight: 400; }
  @font-face { font-family: "Galmuri11"; src: url("${f("Galmuri11-Bold.woff2")}") format("woff2"); font-weight: 700; }
  @font-face { font-family: "Galmuri9"; src: url("${f("Galmuri9.woff2")}") format("woff2"); }
  </style>`;
}

export function renderHtml(d, { fontDir, width = 1400 } = {}) {
  const info = nextInfo(d.week);
  const next = d.week + 1;
  const levelBar = ["easy", "normal", "hard", "praise"].filter((l) => d.levelMix[l] > 0)
    .map((l) => `<i class="lv-${l}" style="width:${d.levelMix[l]}%"><span>${esc(LEVEL_LABEL[l] || "칭찬")} ${d.levelMix[l]}%</span></i>`).join("");
  const popular = d.popular.map((p, i) => `<li><b>${i + 1}</b><span class="lv-tag lv-${p.level}">${esc(LEVEL_LABEL[p.level] || "")}</span>${esc(p.title)}</li>`).join("");
  const reviews = d.topReviews.map((r, i) => `<div class="quote"><span class="rank">${i + 1}</span><p>“${esc(r.text)}”</p><span class="heart">♥ ${r.likes}</span></div>`).join("")
    || `<p class="muted">아직 공감을 받은 후기가 없어요.</p>`;
  const lights = Array.from({ length: Math.round(width / 50) }, (_, i) => `<i class="l${i % 4}"></i>`).join("");
  // 배경 눈(사용자가 정함, 11/26): 늘 같은 자리에 오게 정해진 수열로 흩뿌린다. 작은 점 + 가끔 눈 결정, 맨 아래는 쌓인 눈
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const flakes = Array.from({ length: Math.round(width / 6) }, () => {
    const size = 3 + Math.floor(rnd() * 5);
    return `<i class="flake" style="left:${(rnd() * 100).toFixed(2)}%;top:${(rnd() * 100).toFixed(2)}%;width:${size}px;height:${size}px;opacity:${(0.35 + rnd() * 0.55).toFixed(2)}"></i>`;
  }).join("") + Array.from({ length: 18 }, () =>
    `<i class="crystal" style="left:${(rnd() * 97).toFixed(2)}%;top:${(rnd() * 97).toFixed(2)}%;font-size:${18 + Math.floor(rnd() * 16)}px;opacity:${(0.35 + rnd() * 0.35).toFixed(2)}">❄</i>`).join("");
  const news = d.week === 1 ? `
      <li><span class="tag new">NEW</span><div><b>새 카드 ${newCardNames().length}장</b><small>${esc(newCardNames().join(" · "))}</small><small>쉬움·보통 카드 두 장 중 한 장은 새 카드예요</small></div></li>
      <li><span class="tag gold">✨ 황금</span><div><b>황금 카드 등장!</b><small>${esc(goldCardNames().slice(0, 2).join(" · "))} 등 · 응모권은 도전과 같아요</small><small>대상이 인증하면 매주 ${GOLD_DRAW.perWeek}명을 뽑아 ☕ ${esc(GOLD_DRAW.prize)}</small></div></li>
      <li><span class="tag">다시</span><div><b>1주차를 놓쳤어도 괜찮아요</b><small>2주차부터 다시 참여할 수 있어요</small></div></li>
      <li><span class="tag">단서</span><div><b>${esc(info.nextClue)} 단서 2개 공개</b><small>단서를 보고 ${next}주차 추측도 남겨 보세요</small></div></li>` : `
      <li><span class="tag">단서</span><div><b>${esc(info.nextClue)} 단서 2개 공개</b><small>단서를 보고 ${next}주차 추측도 남겨 보세요</small></div></li>`;
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">${fontCss(fontDir)}
<style>
  :root { --ink:#1d2029; --paper:#fbfbf7; --paper2:#eceadf; --blue:#3d6ea8; --blued:#274a75; --bluel:#8fc0e8; --red:#c0392b; --green:#2e8b4f; --gold:#e8b83b; --night:#16213a; }
  * { box-sizing: border-box; }
  body { word-break: keep-all; overflow-wrap: anywhere; margin:0; width:${width}px; background: var(--night); font-family: "Galmuri11","Galmuri9","Malgun Gothic",sans-serif; color: var(--ink); }
  .flake { position:absolute; z-index:0; background:#fff; border-radius:50%; box-shadow:0 0 6px rgba(255,255,255,.6); pointer-events:none; }
  .crystal { position:absolute; z-index:0; color:#e6f0ff; font-style:normal; line-height:1; text-shadow:0 0 8px rgba(200,225,255,.7); pointer-events:none; }
  .lights, header, .card, .two, footer, .sample { position:relative; z-index:1; }
  .snowbank { position:absolute; left:0; right:0; bottom:0; height:46px; z-index:0; background:#f4f8ff;
    border-radius:60% 40% 0 0 / 38px 30px 0 0; box-shadow:0 -4px 0 #d9e6f7 inset; }
  .snowbank::before { content:""; position:absolute; left:18%; bottom:22px; width:30%; height:40px; background:#f4f8ff; border-radius:50% 50% 0 0; }
  .snowbank::after { content:""; position:absolute; right:10%; bottom:18px; width:26%; height:36px; background:#f4f8ff; border-radius:50% 50% 0 0; }
  .poster { position:relative; padding:36px 40px 84px; background: radial-gradient(circle at 20% 10%, #22305299 0 2px, transparent 3px) 0 0/46px 46px, var(--night); overflow:hidden; }
  .lights { display:flex; justify-content:space-between; padding:0 6px 18px; border-top:3px solid #0d1426; }
  .lights i { width:16px; height:22px; border-radius:50% 50% 45% 45%; margin-top:-2px; box-shadow:0 0 14px 2px currentColor; }
  .l0 { background:#ff6b6b; color:#ff6b6b; } .l1 { background:#ffd25a; color:#ffd25a; } .l2 { background:#5fd38d; color:#5fd38d; } .l3 { background:#7fb6ff; color:#7fb6ff; }
  header { text-align:center; color:#fff; padding:6px 0 26px; }
  header .kicker { margin:0; color: var(--gold); font-size:24px; letter-spacing:1px; }
  header h1 { margin:10px 0 8px; font-size:66px; line-height:1.15; text-shadow:0 5px 0 #0b1122; }
  header h1 em { font-style:normal; color: var(--gold); }
  header .sub { margin:0; font-size:22px; color:#c9d6f0; }
  .card { background: var(--paper); border:4px solid var(--ink); border-radius:16px; box-shadow:0 7px 0 rgba(0,0,0,.45); padding:22px 26px; margin-top:22px; }
  .card h2 { margin:0 0 14px; font-size:28px; display:flex; align-items:center; gap:10px; color: var(--blued); }
  .ico { width:34px; height:34px; image-rendering:pixelated; }
  .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-top:4px; }
  /* 네 칸 모두 같은 세 줄(숫자 / 막대 또는 아이콘 / 설명)이라 숫자·설명 높이가 맞는다(사용자가 정함, 11/26) */
  .stat { background:#fff; border:3px solid var(--ink); border-radius:12px; padding:16px 10px 12px; text-align:center;
    display:grid; grid-template-rows: 62px 30px 52px; align-items:center; justify-items:center; }
  .stat b { display:block; font-size:52px; line-height:1; color: var(--red); }
  .stat b small { font-size:24px; color: var(--ink); margin-left:2px; }
  .stat span { display:flex; align-items:center; justify-content:center; height:100%; font-size:18px; color:#4a4f5c; line-height:1.35; }
  .stat .icons { display:flex; gap:8px; } .stat .icons img { width:24px; height:24px; image-rendering:pixelated; }
  .bar { width:86%; height:14px; border:2px solid var(--ink); border-radius:6px; background: var(--paper2); overflow:hidden; }
  .bar i { display:block; height:100%; background: var(--green); }
  .two { display:grid; grid-template-columns: 1.25fr 1fr; gap:22px; }
  .two .card { margin-top:22px; }
  .mix { display:flex; height:46px; border:3px solid var(--ink); border-radius:10px; overflow:hidden; font-size:17px; }
  .mix i { display:flex; align-items:center; justify-content:center; color:#fff; font-style:normal; white-space:nowrap; overflow:hidden; }
  .mix .lv-easy { background:#5fb37c; } .mix .lv-normal { background: var(--blue); } .mix .lv-hard { background: var(--red); } .mix .lv-praise { background: var(--gold); color: var(--ink); }
  .how { margin:12px 0 0; font-size:20px; } .how b { color: var(--red); }
  .pop { list-style:none; margin:16px 0 0; padding:0; display:grid; gap:9px; font-size:20px; }
  .pop li { display:flex; align-items:center; gap:10px; }
  .pop li > b { width:32px; height:32px; border-radius:50%; background: var(--gold); border:2px solid var(--ink); display:flex; align-items:center; justify-content:center; font-size:18px; flex:none; }
  .lv-tag { font-size:15px; padding:2px 8px; border-radius:6px; border:2px solid var(--ink); flex:none; }
  .lv-tag.lv-easy { background:#d9f0e1; } .lv-tag.lv-normal { background:#dbe7f6; } .lv-tag.lv-hard { background:#f7d9d5; }
  .detective { text-align:center; }
  .detective .big { font-size:74px; color: var(--blued); line-height:1; margin:4px 0 2px; }
  .detective p { margin:6px 0; font-size:20px; line-height:1.45; }
  .detective .hit { display:inline-block; margin-top:10px; background: var(--gold); border:3px solid var(--ink); border-radius:12px; padding:8px 14px; font-size:22px; }
  .muted { color:#6b6f7a; font-size:17px; }
  .quotes { display:grid; gap:14px; }
  .quote { position:relative; background:#fff; border:3px solid var(--ink); border-radius:14px; padding:16px 92px 16px 64px; }
  .quote p { margin:0; font-size:22px; line-height:1.55; white-space: pre-line; }
  .quote .rank { position:absolute; left:16px; top:50%; transform:translateY(-50%); width:36px; height:36px; border-radius:50%; background: var(--blue); color:#fff; display:flex; align-items:center; justify-content:center; font-size:20px; border:2px solid var(--ink); }
  .quote .heart { position:absolute; right:16px; top:50%; transform:translateY(-50%); color: var(--red); font-size:24px; font-weight:700; }
  .week2 { background: linear-gradient(180deg,#fffaf0,#fff3d6); }
  .news { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .news li { display:flex; gap:12px; align-items:flex-start; background:#fff; border:3px solid var(--ink); border-radius:12px; padding:14px; }
  .news b { display:block; font-size:22px; } .news small { display:block; font-size:16.5px; color:#4a4f5c; margin-top:5px; line-height:1.4; }
  .tag { flex:none; font-size:16px; padding:5px 9px; border-radius:8px; border:2px solid var(--ink); background: var(--paper2); }
  .tag.new { background:#ff6b6b; color:#fff; } .tag.gold { background: linear-gradient(135deg,#ffe58a,#e0a400); }
  .now { margin:0 0 14px; text-align:center; font-size:24px; background: var(--ink); color:#fff; border-radius:10px; padding:10px; } .now b { color: var(--gold); font-size:30px; }
  .due { margin:16px 0 0; text-align:center; font-size:24px; } .due b { color: var(--red); }
  footer { margin-top:24px; text-align:center; color:#fff; }
  footer .prize { display:inline-block; background: var(--gold); color: var(--ink); border:4px solid var(--ink); border-radius:14px; padding:12px 22px; font-size:26px; box-shadow:0 6px 0 rgba(0,0,0,.45); }
  footer p { margin:16px 0 0; font-size:20px; color:#c9d6f0; }
  .sample { position:absolute; top:58px; right:-92px; transform:rotate(35deg); background: var(--red); color:#fff; font-size:26px; padding:10px 120px; border:3px solid #fff; z-index:5; }
</style></head><body><div class="poster">
  ${flakes}<div class="snowbank"></div>
  ${d.sample ? `<div class="sample">예시 숫자 · 실제 아님</div>` : ""}
  <div class="lights">${lights}</div>
  <header>
    <p class="kicker">🎄 S1FA 마니또 소식</p>
    <h1>${d.week}주차 결산 <em>&</em> ${next}주차 시작!</h1>
    <p class="sub">${d.week}주차 ${esc(info.period)} · ${next}주차 미션은 <b>${esc(info.nextDue)}</b>까지</p>
  </header>
  <section class="card">
    <h2>${icon("star")}${d.week}주차 한눈에</h2>
    <div class="stats">
      <div class="stat"><b>${d.completion}<small>%</small></b><div class="bar"><i style="width:${d.completion}%"></i></div><span>미션 완료율</span></div>
      <div class="stat"><b>${d.verifiedPct}<small>%</small></b><div class="bar"><i style="width:${d.verifiedPct}%"></i></div><span>완료된 미션 중<br>대상이 인증</span></div>
      <div class="stat"><b>${d.notes}<small>통</small></b><div class="icons">${icon("mail").repeat(3)}</div><span>오간 쪽지</span></div>
      <div class="stat"><b>${d.likes}<small>번</small></b><div class="icons">${icon("heart").repeat(3)}</div><span>피드 공감</span></div>
    </div>
  </section>
  <div class="two">
    <section class="card">
      <h2>${icon("gift")}어떤 미션을 했을까?</h2>
      <div class="mix">${levelBar}</div>
      <p class="how">실물 전달 <b>${d.howMix.real}%</b> · 사이트 쪽지 <b>${d.howMix.site}%</b></p>
      <ol class="pop">${popular}</ol>
    </section>
    <section class="card detective">
      <h2>${icon("search")}명탐정 레이스</h2>
      <p>${d.week}주차 추측에 참여한 비율</p>
      <p class="big">${d.guessPct}%</p>
      ${d.guessCorrect > 0 ? `<p class="hit">벌써 <b>${d.guessCorrect}명</b>이 자기 마니또를 맞혔어요!</p>` : `<p class="hit">누가 먼저 알아챘을까요?</p>`}
      <p class="muted">송년회에서 "가장 먼저 알아챈 사람"이 발표돼요</p>
    </section>
  </div>
  <section class="card">
    <h2>${icon("heart")}공감 많은 후기 TOP ${d.topReviews.length || 3}</h2>
    <div class="quotes">${reviews}</div>
  </section>
  <section class="card week2">
    <h2>${icon("calendar")}${next}주차 새 소식</h2>
    ${d.nextCompletion != null ? `<p class="now">${d.nextCompletion > 0 ? `지금 ${next}주차는 벌써 참여자의 <b>${d.nextCompletion}%</b>가 완료했어요!` : `아직 ${next}주차를 완료한 사람이 없어요. 첫 번째로 완료해 보세요!`}</p>` : ""}
    <ul class="news">${news}</ul>
    <p class="due">${next}주차 미션 마감 <b>${esc(info.nextDue)}</b> · 받은 미션은 <b>추리 보드 → 인증하기</b>로!</p>
  </section>
  <footer>
    <span class="prize">🎁 ${esc(PRIZES.grand.label)} ${esc(PRIZES.grand.prize)} · 응모권을 모아 도전하세요</span>
    <p>사이트 → 내 미션 탭에서 ${next}주차 카드를 골라 보세요</p>
  </footer>
</div></body></html>`;
}

export function mailText(d) {
  const info = nextInfo(d.week);
  const next = d.week + 1;
  const lines = [
    `제목: [S1FA 마니또] ${d.week}주차 결산 & ${next}주차 시작!${d.week === 1 ? " ✨황금 카드 등장" : ""}`,
    "",
    "안녕하세요, S1FA 마니또 운영진입니다 🎄",
    `지난 ${d.week}주차, 몰래 챙기고 챙김받느라 모두 수고 많으셨어요! 한 주 동안의 모습을 정리해 봤어요.`,
    "",
    `■ ${d.week}주차 한눈에`,
    `- 미션 완료율 ${d.completion}%`,
    `- 완료된 미션 중 대상이 인증한 비율 ${d.verifiedPct}%`,
    `- 오간 쪽지 ${d.notes}통 · 피드 공감 ${d.likes}번`,
    `- ${d.week}주차 추측 참여 ${d.guessPct}%${d.guessCorrect > 0 ? ` — 벌써 ${d.guessCorrect}명이 자기 마니또를 맞혔어요!` : ""} (송년회에서 "가장 먼저 알아챈 사람"이 발표돼요)`,
    "",
    "■ 공감을 가장 많이 받은 후기 (익명 피드에서)",
    // 후기는 줄바꿈까지 그대로(둘째 줄부터는 번호 아래로 들여 쓴다)
    ...(d.topReviews.length ? d.topReviews.flatMap((r, i) => [`${i + 1}. "${r.text.split("\n").join("\n   ")}" ♥${r.likes}`, ""]).slice(0, -1) : ["(아직 공감을 받은 후기가 없어요)"]),
    "",
    "■ 📸 이번 주 분석실 신발장 풍경",
    "[사진 4장]",
    "실제로 신발장에 놓였던 마니또 선물들이에요. 서로 먼 사무실이라면 신발장에 두고 쪽지로 위치를 알려 주세요!",
    "",
    `■ ${next}주차가 시작됐어요 (${info.nextDue} 마감)`,
  ];
  if (d.nextCompletion != null) {
    lines.push(d.nextCompletion > 0 ? `- 지금 ${next}주차는 벌써 참여자의 ${d.nextCompletion}%가 완료했어요!` : `- 아직 ${next}주차를 완료한 사람이 없어요. 첫 번째로 완료해 보세요!`);
  }
  if (d.week === 1) {
    lines.push(
      "- 1주차를 놓쳤어도 괜찮아요. 2주차부터 다시 참여할 수 있어요.",
      `- NEW 카드: ${newCardNames().join(", ")} — 쉬움·보통 카드 두 장 중 한 장은 새 카드예요.`,
      `- ✨ 황금 카드: 응모권은 도전과 같고, 대상이 "카드와 같아요"로 인증하면 매주 ${GOLD_DRAW.perWeek}명을 뽑아 ${GOLD_DRAW.prize}을 드려요(송년회에서 발표).`,
    );
  }
  lines.push(
    `- ${info.nextClue} 단서 2개 공개 → 단서를 보고 ${next}주차 추측도 남겨 보세요.`,
    `- 응모권을 모아 ${PRIZES.grand.label} ${PRIZES.grand.prize}에 도전하세요!`,
    "",
    "▶ 사이트: [사이트 주소]",
    "마니또에게 받은 미션은 꼭 \"추리 보드 → 인증하기\"로 인증해 주세요. 인증해야 나와 내 마니또 모두 응모권이 쌓여요.",
    "",
    "이번 주도 즐거운 마니또 되세요! 🎁",
  );
  return lines.join("\n");
}

async function main() {
  const o = args(process.argv.slice(2));
  if (!o.out || (!o.sample && !o.backup)) {
    console.error("쓰는 법: node tools/report/report.mjs <백업.json> --week 1 --out <폴더> [--font-dir <글꼴 폴더>]  또는  --sample --out <폴더>");
    process.exit(2);
  }
  const data = o.sample ? SAMPLE : computeReport(JSON.parse(fs.readFileSync(o.backup, "utf8")), { week: o.week });
  fs.mkdirSync(o.out, { recursive: true });
  fs.writeFileSync(path.join(o.out, "report.json"), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(o.out, "mail.txt"), mailText(data));
  const htmlPath = path.join(o.out, "report.html");
  fs.writeFileSync(htmlPath, renderHtml(data, { fontDir: o.fontDir, width: o.width }));
  const { chromium } = createRequire(import.meta.url)("playwright"); // 전역에 설치된 Playwright도 찾게(require는 NODE_PATH를 본다)
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: o.width, height: 1200 }, deviceScaleFactor: 2 })).newPage();
  await page.goto(pathToFileURL(htmlPath).href);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(o.out, "report.png"), fullPage: true });
  await browser.close();
  console.log(`만든 파일: ${["report.png", "report.html", "report.json", "mail.txt"].map((f) => path.join(o.out, f)).join(", ")}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(1); });
