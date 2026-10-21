// 질문수업 진행판
// 매일 같은 루틴: ① 교과서 바라보기 ② 질문 만들기 ③ 짝과 나누기 ④ 낭독·핵심 개념 ⑤ 활동 ⑥ 나만의 노트정리.
// 수업을 마칠수록 각 칸이 한 단계씩 깊어져요.
// 저장과 TV 연결은 세 가지 중 하나로 동작해요.
//   claude   : claude.ai 아티팩트 안 (db · room · user 기능)
//   firebase : 깃허브 페이지 등 일반 웹 (config.js에 파이어베이스 설정이 있을 때)
//   local    : 위 둘이 없을 때. 이 기기에만 저장하고 TV 연결은 꺼져요.

import { FIREBASE_CONFIG } from './config.js';

const FB_URL = 'https://www.gstatic.com/firebasejs/10.14.1/';

/* ---------- 작은 도구 ---------- */
const $ = s => document.querySelector(s);
function h(tag, props, ...kids){
  const el = document.createElement(tag);
  if (props) for (const k in props){
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()){
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}
const plain = o => JSON.parse(JSON.stringify(o));
function isoDate(dt){ const d = dt || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmt(sec){ const s = Math.abs(Math.round(sec)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function str(x, n){ return typeof x === 'string' ? x.slice(0, n) : ''; }

/* 받침에 맞춰 조사 고르기 */
function lastChar(w){ return String(w).replace(/[\s.,!?)\]"'’”]+$/, '').slice(-1); }
function hasBatchim(w){
  const c = lastChar(w); if (!c) return null;
  const code = c.charCodeAt(0);
  if (code >= 0xAC00 && code <= 0xD7A3) return (code - 0xAC00) % 28 !== 0;
  if (/[0-9]/.test(c)) return '013678'.indexOf(c) >= 0;
  if (/[a-z]/i.test(c)) return /[lmnr]/i.test(c);
  return null;
}
function J(w, pair){
  const p = pair.split('/'); const t = hasBatchim(w);
  return w + (t === null ? p[0] + '(' + p[1] + ')' : (t ? p[0] : p[1]));
}

/* ---------- 단계 ---------- */
const LEVELS = [
  {n:1, name:'루틴 익히기', need:6, opens:['질문 1개 (질문 시작어로)', '짝에게 내 질문 읽어 주기', '선생님 따라 낭독 · 핵심 낱말 3개', '노트 3칸']},
  {n:2, name:'질문 키우기', need:8, opens:['질문 2개 (답이 있는 질문 + 왜 질문)', '짝과 골라 질문판에 (이름과 함께)', '돌아가며 낭독 · 답 찾으면 ✓', '하루 2명 당번 노트']},
  {n:3, name:'근거로 말하기', need:10, opens:['질문 3개 · 가장 궁금한 것에 ★', '짝에게 “교과서 몇 쪽?” 되묻기', '문장·구절·낱말 · 주장·근거·질문', '노트 4칸 · 전에는·지금은']},
  {n:4, name:'루틴 바꿔 끼우기', need:12, opens:['질문을 사실·생각·상상으로', '짝과 질문 다듬기', '핵심 개념을 내 말로 정의', '활동 루틴 바꿔 끼우기']},
  {n:5, name:'아이들이 여는 수업', need:null, opens:['아이들 질문에서 핵심질문 고르기', '짝이 서로의 질문에 답하기', '아이들이 고른 질문으로 활동', '자유 노트정리 · 복습 퀴즈 출제']}
];
const lv = n => LEVELS[n - 1];

/* ---------- 저장 (이 기기) ---------- */
const KEY = 'qclass-runner-v1', DKEY = 'qclass-draft-v2', TVKEY = 'qclass-tv';
const DEFAULT = {v:1, level:1, points:0, total:0, students:22, history:[], snoozeAt:-1};
function normalize(s){
  const o = Object.assign({}, DEFAULT, s || {});
  o.level = Math.min(5, Math.max(1, o.level | 0 || 1));
  o.points = Math.max(0, o.points | 0);
  o.total = Math.max(0, o.total | 0);
  o.students = Math.min(40, Math.max(2, o.students | 0 || 22));
  o.history = Array.isArray(o.history) ? o.history.filter(x => x && typeof x === 'object').slice(-60) : [];
  if (typeof o.snoozeAt !== 'number') o.snoozeAt = -1;
  o.v = 1;
  return o;
}
function readLocal(k){ try { const s = localStorage.getItem(k); return s ? JSON.parse(s) : null; } catch (e){ return null; } }
function writeLocal(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch (e){} }

let state = normalize(readLocal(KEY));
const EXAMPLE = {subj:'사회', page:'82~83', title:'지구촌 갈등의 원인', name:'카슈미르 지역', nameKind:'case', lessonKind:'normal', link:'', over:{}, example:true};
let draft = Object.assign({}, EXAMPLE, readLocal(DKEY) || {});
draft.over = Object.assign({}, draft.over || {});
let draftTimer = null;
function saveDraft(){ clearTimeout(draftTimer); draftTimer = setTimeout(() => writeLocal(DKEY, draft), 300); }

/* ---------- 화면 상태 ---------- */
const ui = {step:0, started:false, viewLevel:state.level, previewing:false, lowerAsk:0, resetAsk:false,
  timer:{running:false, startedAt:0, before:0}, steps:[], q:null, lastFb:null};

/* ---------- 질문 만들기 ---------- */
function titleKind(t){
  t = t || '';
  if (/(원인|까닭|이유|배경|왜)/.test(t)) return 'why';
  if (/(노력|방법|해결|대책|과정|역할|어떻게)/.test(t)) return 'how';
  if (/(모습|특징|변화|생활|발전|종류|차이|달라)/.test(t)) return 'what';
  return 'basic';
}
function topicOf(t){
  let s = (t || '').trim();
  s = s.replace(/\s*(을|를)?\s*(알아보기|알아봅시다|알아보자|탐구하기|살펴보기|살펴봅시다|조사하기)\s*$/, '');
  s = s.replace(/\s*(의|과|와)?\s*(원인|까닭|이유|배경)\s*$/, '');
  return s.trim();
}
/* 핵심질문은 칠판 한 줄(20자 안팎), 이끎질문은 ⑤ 활동에서 던지는 한 줄 */
function generate(d){
  const N = (d.name || '').trim() || '○○';
  const tk = titleKind(d.title), nk = d.nameKind || 'case', topic = topicOf(d.title);
  let core, guide;
  if (tk === 'why'){
    core = topic && topic.length <= 10 ? '왜 ' + J(topic, '이/가') + ' 생길까?' : nk === 'person' ? J(N, '은/는') + ' 왜 그랬을까?' : J(N, '은/는') + ' 왜 그렇게 됐을까?';
    guide = nk === 'person' ? J(N, '은/는') + ' 왜 그런 선택을 했을까?' : N + '에서는 무엇이 원인이 되었을까?';
  } else if (tk === 'what'){
    core = nk === 'person' ? J(N, '은/는') + ' 무엇을 바꿨을까?' : nk === 'case' ? J(N, '은/는') + ' 무엇이 달라졌을까?' : J(N, '은/는') + ' 무엇이 특별할까?';
    guide = nk === 'person' ? J(N, '이/가') + ' 바꾼 것 중 가장 큰 것은?' : N + '의 예전과 지금은 무엇이 다를까?';
  } else if (tk === 'how'){
    core = nk === 'person' ? J(N, '은/는') + ' 어떻게 풀었을까?' : nk === 'case' ? N + ' 문제, 어떻게 풀까?' : J(N, '을/를') + ' 어떻게 쓸까?';
    guide = nk === 'thing' ? J(N, '이/가') + ' 없다면 어떻게 될까?' : '여러 노력 중 가장 효과 있는 것은?';
  } else {
    core = nk === 'person' ? J(N, '은/는') + ' 어떤 사람일까?' : nk === 'case' ? N + '에서 무슨 일이?' : J(N, '은/는') + ' 왜 필요할까?';
    guide = nk === 'person' ? '내가 ' + J(N, '이라면/라면') + ' 어떻게 했을까?' : nk === 'case' ? '내가 ' + N + '에 산다면 무엇을 할까?' : J(N, '이/가') + ' 없다면 어떻게 될까?';
  }
  return {core, guide, tk};
}
function questions(){
  const g = generate(draft);
  const pick = k => (draft.over[k] != null && String(draft.over[k]).trim()) ? String(draft.over[k]).trim() : g[k];
  return {core: pick('core'), guide: pick('guide'), tk: g.tk};
}

/* ---------- 하루 루틴 40분 ---------- */
const SWAPS = ['tug', 'circle', 'chalk'];
function buildSteps(L, d, q){
  const pg = (d.page || '').trim() || '○○';
  const s1 = {no:'①', name:'교과서 바라보기', min:3, zone:'core', routine:'보고·생각하고·궁금해하기',
    kids:'교과서 ' + pg + '쪽을 펴고 제목과 사진을 조용히 봐요',
    say:['“' + pg + '쪽, 제목과 사진만 조용히 봐요.”', '그동안 칠판에 핵심질문을 한 줄로 써요.'],
    board:'핵심질문 “' + q.core + '”', tip:'매일 첫 3분은 똑같이. 아이들이 앉자마자 교과서를 펴는 습관이 생겨요.'};
  if (L >= 5) s1.say[1] = '핵심질문은 어제 아이들 질문에서 골라 한 줄로 써도 좋아요.';

  const s2 = {no:'②', name:'질문 만들기', min:6, zone:null, routine:'질문 시작어',
    kids:'궁금한 것 1개를 질문으로 써요', cue:['누가', '무엇을', '왜', '어떻게'],
    say:['“누가·무엇을·왜·어떻게 중 하나로 시작해요.”', '“다 쓰면 연필을 내려놓아요.”'],
    board:'새로 쓸 것 없음 · TV에 질문 시작어', tip:'틀린 질문은 없어요. 엉뚱한 질문도 받아 주세요.'};
  if (L === 2){ s2.kids = '질문 2개: 교과서에 답이 있는 질문 1개 + ‘왜’ 질문 1개'; s2.cue = ['답이 있는 질문', '왜 질문']; }
  if (L === 3){ s2.kids = '질문 3개를 쓰고, 가장 궁금한 것에 ★'; s2.cue = ['누가', '왜', '어떻게', '만약']; s2.routine = '질문 ★ 고르기'; }
  if (L === 4){ s2.kids = '질문 3개를 종류별로: 사실 · 생각 · 상상(만약에)'; s2.cue = ['사실', '생각', '상상']; s2.routine = '질문 종류'; }
  if (L >= 5){ s2.kids = '질문 3개 → 반 전체 핵심질문 후보 1개 고르기'; s2.cue = ['사실', '생각', '상상']; s2.routine = '질문 종류'; }
  if (L >= 4 && d.lessonKind === 'first'){ Object.assign(s2, {routine:'생각·퍼즐·탐구', kids:'단원 첫 쪽: 아는 것 / 헷갈리는 것 / 알아볼 곳', cue:['아는 것', '헷갈리는 것', '알아볼 곳'], swapped:true}); }

  const s3 = {no:'③', name:'짝과 나누기', min:4, zone:null, routine:'같이 또 따로',
    kids:'옆 친구에게 내 질문을 읽어 주고, 친구 질문을 들어요',
    say:['“책상은 그대로, 몸만 옆 친구 쪽으로.”', '“1분씩 번갈아 말해요. 노트는 각자 내 것에.”'],
    board:'새로 쓸 것 없음', tip:'말은 같이, 쓰기는 따로. 한 명만 말하는 짝은 손을 들어 바꿔 줘요.'};
  if (L === 2){ Object.assign(s3, {kids:'짝과 질문을 읽어 주고, 더 궁금한 1개를 포스트잇에 (이름 쓰기)', zone:'qboard', board:'질문판에 포스트잇 5~6장', tip:'질문판 관리자(B그룹)가 모아 붙여요. 고른 질문은 이름과 함께 소개해요.'}); }
  if (L === 3){ Object.assign(s3, {kids:'짝 질문에 “교과서 몇 쪽에 나와?”로 되물어요 · ★ 질문은 포스트잇에', zone:'qboard', board:'질문판에 ★ 질문 포스트잇', routine:'무엇을 보고 그렇게 말해?'}); }
  if (L === 4){ Object.assign(s3, {kids:'짝과 질문 하나를 ‘더 좋은 질문’으로 고쳐 써요 → 포스트잇', zone:'qboard', board:'질문판에 고친 질문 포스트잇', routine:'질문 다듬기'}); }
  if (L >= 5){ Object.assign(s3, {kids:'짝이 서로의 질문에 답해 봐요 (교과서 쪽으로)', zone:'qboard', board:'질문판에 답 못 한 질문 포스트잇', routine:'질문 주고받기'}); }

  const s4 = {no:'④', name:'낭독 · 핵심 개념', min:10, zone:'concept', routine:'무엇을 보고 그렇게 말해?',
    kids:'선생님을 따라 손가락으로 짚으며 읽고, 핵심 낱말 3개에 동그라미',
    say:['“제가 읽을게요. 손가락으로 따라와요.”', '“중요한 낱말 3개는? 몇째 줄?” → “무엇을 보고 그렇게 말해요?”'],
    board:'핵심 개념: 아이들이 찾은 낱말 3개 + 쪽', joy:'내 질문의 답이 보이면 ✓ “찾았다!”',
    tip:'“달을 쎄뇨?” 같은 추측은 “좋은 예측! 교과서는 뭐라고 해?”로 받아요.'};
  if (L === 2){ Object.assign(s4, {kids:'한 문단씩 돌아가며 낭독 · 핵심 낱말 3개 · 내 질문 답 찾으면 ✓', say:['“한 문단씩 돌아가며 읽어요. 듣는 사람은 손가락으로.”', '“중요한 낱말 3개는? 몇째 줄?”']}); }
  if (L === 3){ Object.assign(s4, {kids:'낭독하며 중요한 문장 1 · 구절 1 · 낱말 1 찾기 (쪽·줄)', routine:'문장·구절·낱말', say:['“한 문단씩 돌아가며 읽어요.”', '“가장 중요한 문장, 구절, 낱말 하나씩.”'], board:'핵심 개념: 아이들이 고른 낱말 모으기 (겹치는 것 동그라미)'}); }
  if (L === 4){ Object.assign(s4, {kids:'낭독 후 핵심 개념을 내 말로 한 문장 정의 (쪽 함께)', routine:'내 말로 정의', say:['“한 문단씩 돌아가며 읽어요.”', '“○○란 무엇인가? 교과서 낱말을 넣어 내 말로.”'], board:'핵심 개념 + 아이들 정의 1~2개'}); }
  if (L >= 5){ Object.assign(s4, {kids:'낭독하며 질문판 질문의 답을 찾으면 ✓ 붙이기', routine:'질문판 답 찾기', say:['“한 문단씩 돌아가며 읽어요.”', '“질문판 질문의 답이 나오면 손을 들어요.”'], board:'핵심 개념 + 질문판에 ✓'}); }

  const s5 = {no:'⑤', name:'활동', min:10, zone:'act', routine:'',
    kids:'교과서 ' + pg + '쪽 활동을 해요',
    say:['“교과서 활동 그대로 해요.”', '이끎질문 “' + q.guide + '” → 엄지 위·옆·아래 → 2~3명 이유'],
    board:'이끎질문 한 줄', tip:'C그룹부터 짧게 발표하고, A그룹은 마지막에 덧붙여요.'};
  if (L === 2) s5.say.push('질문판에서 1개를 골라 이름과 함께 읽고 함께 답해 봐요.');
  if (L === 3){ Object.assign(s5, {routine:'주장·근거·질문', kids:'교과서 활동 + 주장 1 · 근거 2(쪽) · 질문 1', say:['이끎질문 “' + q.guide + '”', '“3분 쓰기 → ○○ 말에 덧붙이면…” 릴레이 (C → B → A)']}); }
  if (L === 4 && d.lessonKind === 'normal'){
    const sw = SWAPS[state.total % SWAPS.length];
    if (sw === 'tug') Object.assign(s5, {routine:'줄다리기', swapped:true, kids:'교과서 활동 + 두 입장 사이 내 위치와 이유', say:['이끎질문 “' + q.guide + '”', '칠판에 줄을 긋고 양 끝에 두 입장 → 이유 포스트잇'], board:'이끎질문 + 줄다리기 줄'});
    if (sw === 'circle') Object.assign(s5, {routine:'관점의 원', swapped:true, kids:'교과서 속 사람 하나의 입장이 되어 한 줄', say:['이끎질문 “' + q.guide + '”', '번호순으로 관점을 나눠 맡아 “나는 ○○의 입장에서…”'], board:'이끎질문 + 관점 이름'});
    if (sw === 'chalk') Object.assign(s5, {routine:'분필 대화', swapped:true, kids:'말없이 칠판에 쓰고 친구 글에 화살표로 답해요', say:['주제: “' + q.guide + '”', '끝나면 칠판 내용을 노트에 3줄로 옮겨요.'], board:'가운데를 비워 분필 대화'});
  } else if (L === 4){ Object.assign(s5, {routine:'주장·근거·질문', say:['이끎질문 “' + q.guide + '”', '“3분 쓰기 → ○○ 말에 덧붙이면…” 릴레이']}); }
  if (L >= 5){ Object.assign(s5, {routine:'주장·근거·질문', kids:'아이들이 고른 질문으로 교과서 활동 + 주장·근거', say:['질문판에서 아이들이 고른 질문 1개로 시작해요.', '“3분 쓰기 → ○○ 말에 덧붙이면…” 릴레이']}); }

  const s6 = {no:'⑥', name:'나만의 노트정리', min:7, zone:'head', routine:'헤드라인',
    kids:'노트 3칸: 내 질문 · 핵심 낱말 · 헤드라인 1줄',
    say:['“오늘 내용을 기사 제목 한 줄로.”', '다 쓴 2~3명이 칠판에 헤드라인을 써요.'],
    board:'헤드라인 2~3개 (아이들이 직접)', tip:'시간이 밀려도 이 단계는 자르지 않아요.'};
  if (L === 2){ s6.kids = '노트 3칸 + 답을 찾은 내 질문에 ✓'; s6.say.push('당번 2명은 노트를 교탁에 두고 가요.'); }
  if (L === 3){ Object.assign(s6, {routine:'헤드라인 · 전에는·지금은', kids:'노트 4칸 + “전에는 ~, 지금은 ~”', joy:'생각이 바뀐 친구 1명 소개'}); s6.say.push('당번 2명은 노트를 교탁에.'); }
  if (L === 4){ Object.assign(s6, {routine:'헤드라인 · 루틴 칸 고르기', kids:'노트: 헤드라인 + 오늘 루틴 칸은 내가 골라서', joy:'생각이 바뀐 친구 1명 소개'}); s6.say.push('당번 2명은 노트를 교탁에.'); }
  if (L >= 4 && d.lessonKind === 'last'){ Object.assign(s6, {routine:'생성·분류·연결·정교화', swapped:true, kids:'단원 낱말을 모두 꺼내 묶고 잇기 (선마다 쪽수)', board:'단원 개념 지도 (대표 연결선만)'}); }
  if (L >= 5){ Object.assign(s6, {kids:'자유 노트정리 (핵심질문 · 쪽수 · 헤드라인 · 남은 질문은 꼭)', routine:'자유 정리', joy:'생각이 바뀐 친구 1명 소개'}); s6.say = ['“오늘 배운 것을 나만의 방식으로.”', 'A그룹: 내일 아침 복습 퀴즈 3문항 (쪽수 필수)']; }

  return [s1, s2, s3, s4, s5, s6];
}

/* ---------- 렌더: 맨 위 ---------- */
function dutyToday(){
  const today = isoDate();
  const days = new Set(state.history.map(x => x.d).filter(d => d && d < today)).size;
  const N = state.students;
  return [(2 * days) % N + 1, (2 * days + 1) % N + 1];
}
function isReady(){ const need = lv(state.level).need; return !!need && state.points >= need && state.total > state.snoozeAt; }
function renderTop(){
  const L = state.level, info = lv(L);
  const chip = $('#lvchip'); chip.textContent = '';
  chip.append(h('span', {class:'n', text: L + '단계'}), h('span', {class:'nm', text: info.name}));
  if (info.need){
    const t = h('span', {class:'ticks', 'aria-hidden':'true'});
    for (let i = 0; i < info.need; i++) t.append(h('i', {class: i < state.points ? 'on' : ''}));
    chip.append(t, h('span', {class:'left', text:'다음까지 ' + Math.max(0, info.need - state.points) + '번'}));
  }
  chip.setAttribute('aria-label', L + '단계 ' + info.name + '. 단계 지도와 기록 열기');
  const duty = $('#duty');
  duty.hidden = !(state.level >= 2 || ui.viewLevel >= 2);
  if (!duty.hidden){ const [a, b] = dutyToday(); duty.textContent = ''; duty.append('노트 당번 ', h('b', {text: a + '번 · ' + b + '번'})); }

  const ban = $('#banner'); ban.textContent = ''; ban.className = 'banner'; ban.hidden = true;
  if (ui.previewing && ui.viewLevel !== L){
    ban.hidden = false; ban.classList.add('preview');
    ban.append(h('p', null, h('b', {text: ui.viewLevel + '단계 ‘' + lv(ui.viewLevel).name + '’'}), '를 미리 보는 중이에요.'),
      h('button', {class:'btn', type:'button', text: L + '단계로 돌아가기', onclick: () => { ui.previewing = false; ui.viewLevel = state.level; resetRun(); renderAll(); }}));
  } else if (isReady()){
    const nx = lv(L + 1);
    ban.hidden = false; ban.classList.add('ready');
    ban.append(h('p', null, h('b', {text: (L + 1) + '단계 ‘' + nx.name + '’'}), '를 열 준비가 됐어요. ' + nx.opens[0] + '부터 시작해요.'),
      h('button', {class:'btn primary', type:'button', text:'다음 수업부터 열기', onclick: () => { state.level = L + 1; state.points = 0; state.snoozeAt = -1; ui.previewing = false; ui.viewLevel = state.level; persist(); resetRun(); renderAll(); }}),
      h('button', {class:'btn', type:'button', text:'이 단계 조금 더', onclick: () => { state.snoozeAt = state.total; persist(); renderAll(); }}));
  }
  renderStatus();
}

/* ---------- 렌더: 오늘 수업 ---------- */
function syncToday(L, q){
  $('#egNote').hidden = !draft.example;
  $('#rowKind').hidden = L < 4;
  [['core', '#q-core', '#r-core'], ['guide', '#q-guide', '#r-guide']].forEach(([k, inp, rb]) => {
    const el = $(inp);
    if (document.activeElement !== el) el.value = q[k];
    $(rb).hidden = !(draft.over[k] != null && String(draft.over[k]).trim());
  });
  const n = [...q.core.replace(/\s/g, '')].length;
  const cc = $('#coreCount');
  cc.textContent = n + '자' + (n > 20 ? ' · 길어요' : '');
  cc.className = n > 20 ? 'long' : '';
}

/* ---------- 렌더: 루틴 6칸 ---------- */
function renderSteps(steps){
  const box = $('#steps'); box.textContent = '';
  steps.forEach((s, i) => {
    const cls = 'step' + (ui.started && i === ui.step ? ' now' : '') + (ui.started && i < ui.step ? ' past' : '');
    const card = h('article', {class: cls, tabindex:'0', role:'button', 'aria-label': s.no + ' ' + s.name + ' ' + s.min + '분. 이 단계로 가기',
      onclick: () => goStep(i), onkeydown: e => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); goStep(i); } }},
      h('div', {class:'sh'}, h('span', {class:'no', text: s.no}), h('h3', {text: s.name}), h('span', {class:'min', text: s.min + '분'})),
      h('p', {class:'kids', text: s.kids}),
      h('div', {class:'say'}, s.say.map(t => h('span', {text: t}))),
      s.board ? h('p', {class:'bd'}, h('b', {text:'칠판'}), s.board) : null,
      s.joy ? h('p', {class:'joy', text:'즐거움 · ' + s.joy}) : null,
      (s.routine ? h('div', {class:'tags'}, h('span', {class:'rt' + (s.swapped ? ' sw' : ''), text: (s.swapped ? '바꿔 끼움 · ' : '') + s.routine})) : null),
      ui.started && i === ui.step && s.tip ? h('p', {class:'tip', text: s.tip}) : null);
    box.append(card);
  });
}

/* ---------- 렌더: 오늘 칠판 ---------- */
function renderBoard(L, q, steps){
  const b = $('#board'); b.textContent = '';
  const hot = ui.started ? steps[ui.step].zone : null;
  const z = (key, solid, extra) => h('div', {class:'mz' + (solid ? ' solid' : '') + (hot === key ? ' hot' : '') + (extra ? ' ' + extra : '')});
  b.append(h('div', {class:'mtitle'}, h('span', {text:'오늘 칠판'}), h('span', {text:'쓰는 순서대로'})));
  const core = z('core', true);
  core.append(h('span', {class:'tag', text:'① 선생님 · 핵심질문 한 줄'}), h('span', {class:'big', text: q.core}));
  const qb = z('qboard', false, L === 1 ? 'locked' : '');
  qb.append(h('span', {class:'tag', text: L === 1 ? '③ 질문판 · 2단계에서 열려요' : '③ 짝과 나누기 · 질문판'}));
  if (L > 1) qb.append(h('div', {class:'postits'}, h('span', {class:'postit', text:'○○ 질문'}), h('span', {class:'postit', text:'○○ 질문'})));
  const con = z('concept');
  con.append(h('span', {class:'tag', text:'④ 낭독 · 핵심 개념'}), h('span', {class:'dim', text: steps[3].board.replace(/^핵심 개념:?\s*/, '')}));
  const act = z('act');
  act.append(h('span', {class:'tag', text:'⑤ 활동 · ' + (steps[4].routine || '이끎질문')}), h('span', {class:'dim', text: q.guide}));
  const head = z('head');
  head.append(h('span', {class:'tag', text:'⑥ 노트정리 · 헤드라인'}), h('span', {class:'dim', text:'아이들 2~3명이 직접 써요'}));
  b.append(core, qb, con, act, head);
  $('#sidenote').textContent = ui.started ? '노랗게 빛나는 칸이 지금 쓸 자리예요.' : '수업을 시작하면 지금 쓸 자리가 노랗게 빛나요. 미리 써 둘 것은 없어요.';
}

/* ---------- 진행 막대 ---------- */
let tickHandle = null;
function elapsed(){ const t = ui.timer; return t.before + (t.running ? (Date.now() - t.startedAt) : 0); }
function updateClock(){
  const st = ui.steps[ui.step]; if (!st) return;
  const left = ui.started ? st.min * 60 - elapsed() / 1000 : ui.steps.reduce((a, s) => a + s.min, 0) * 60;
  const el = $('#clock');
  el.textContent = (left < 0 ? '+' : '') + fmt(left);
  el.classList.toggle('over', left < 0);
}
function startTick(){ if (!tickHandle) tickHandle = setInterval(updateClock, 250); }
function stopTick(){ clearInterval(tickHandle); tickHandle = null; }
function resetTimer(run){ ui.timer = {running: !!run, startedAt: Date.now(), before: 0}; if (run) startTick(); }
function renderBar(){
  const st = ui.steps[ui.step], last = ui.step === ui.steps.length - 1;
  $('#nowname').textContent = ui.started ? st.no + ' ' + st.name : '오늘 루틴 ' + ui.steps.reduce((a, s) => a + s.min, 0) + '분';
  $('#b-time').textContent = !ui.started ? '수업 시작' : ui.timer.running ? '잠깐 멈춤' : '다시 시작';
  $('#b-time').className = 'btn' + (!ui.started ? ' primary' : '');
  $('#b-prev').disabled = !ui.started || ui.step === 0;
  $('#b-next').disabled = !ui.started || last;
  $('#b-next').textContent = ui.started && !last ? '다음: ' + ui.steps[ui.step + 1].no + ' ' + ui.steps[ui.step + 1].name + ' ▶' : '다음 ▶';
  $('#b-next').hidden = !ui.started;
  $('#b-prev').hidden = !ui.started;
  $('#b-finish').className = 'btn finish' + (ui.started && last ? ' primary' : '');
  updateClock();
}
function startLesson(){ ui.started = true; ui.step = 0; resetTimer(true); keepAwake(); refresh(); }
function toggleTimer(){
  if (!ui.started) return startLesson();
  const t = ui.timer;
  if (t.running){ t.before += Date.now() - t.startedAt; t.running = false; }
  else { t.startedAt = Date.now(); t.running = true; startTick(); keepAwake(); }
  renderBar(); sendTvSoon();
}
function goStep(i){
  if (!ui.started){ ui.started = true; resetTimer(true); keepAwake(); }
  const wasRunning = ui.timer.running;
  ui.step = Math.max(0, Math.min(ui.steps.length - 1, i));
  resetTimer(wasRunning);
  refresh();
}
function resetRun(){ ui.started = false; ui.step = 0; resetTimer(false); stopTick(); letSleep(); }

/* ---------- 수업 마침 ---------- */
function openDone(){
  const d = $('#sheetDone'); d.textContent = '';
  stopTick(); if (ui.timer.running){ ui.timer.before += Date.now() - ui.timer.startedAt; ui.timer.running = false; }
  const mk = (cls, key, label, sub) => h('button', {class: cls, type:'button', onclick: () => record(key)}, h('span', {text: label}), h('small', {text: sub}));
  d.append(h('div', {class:'done'},
    h('h2', {text:'오늘 아이들은 어땠나요?'}),
    h('p', {class:'muted', text:'한 번 누르면 기록돼요. 벅찼던 날은 진행 칸을 세지 않고 같은 단계를 한 번 더 해요.'}),
    h('div', {class:'fbbtns'}, mk('g', 'easy', '즐거웠어요', '한 칸 채워요'), mk('m', 'ok', '딱 좋았어요', '한 칸 채워요'), mk('x', 'hard', '벅찼어요', '이 단계를 한 번 더')),
    h('div', {class:'row'}, h('button', {class:'btn quiet', type:'button', text:'아직 안 끝났어요', onclick: () => { d.close(); if (ui.started) toggleTimer(); }}))));
  openSheet(d);
}
function record(fbKey){
  const L = ui.viewLevel;
  const counts = fbKey !== 'hard' && L >= state.level;
  state.total += 1;
  if (counts) state.points += 1;
  state.history.push({d: isoDate(), s: draft.subj, t: (draft.title || '').trim() || '(제목 없이)', n: (draft.name || '').trim(), L: L, fb: fbKey});
  state.history = state.history.slice(-60);
  persist();
  ui.lastFb = fbKey;
  const info = lv(state.level);
  const msg = fbKey === 'hard'
    ? '벅찼던 날은 칸을 세지 않아요. 다음 수업도 같은 단계로 해요. 시간이 모자랐다면 ②를 질문 1개로, ⑤를 손신호 1분으로 줄여 보세요.'
    : info.need ? (isReady() ? '칸이 다 찼어요. 맨 위에서 다음 단계를 열지 정해 주세요.' : '다음 단계까지 ' + Math.max(0, info.need - state.points) + '번 남았어요.') : '마지막 단계예요. 아이들이 여는 수업을 이어 가요.';
  const d = $('#sheetDone'); d.textContent = '';
  d.append(h('div', {class:'done'},
    h('h2', {text: state.total + '번째 수업을 기록했어요'}),
    h('p', {text: msg}),
    h('div', {class:'row'}, h('button', {class:'btn primary', type:'button', text:'다음 수업 준비하기', onclick: () => { d.close(); newLesson(); }}),
      h('button', {class:'btn quiet', type:'button', text:'닫기', onclick: () => { d.close(); resetRun(); renderAll(); }}))));
}
function newLesson(){
  draft.page = ''; draft.title = ''; draft.name = ''; draft.link = ''; draft.over = {}; draft.example = false; draft.lessonKind = 'normal';
  tv.link = null; tv.blank = false;
  saveDraft(); fillInputs();
  ui.previewing = false; ui.viewLevel = state.level;
  resetRun(); renderAll();
  $('#f-page').focus();
}

/* ---------- 시트: 단계 지도 ---------- */
function openSheet(d){ try { if (!d.open) d.showModal(); } catch (e){ d.setAttribute('open', ''); } }
function renderLevels(){
  const box = $('#levels'); box.textContent = '';
  LEVELS.forEach(info => {
    const n = info.n, cur = n === state.level;
    const status = cur ? h('span', {class:'badge cur', text:'지금 단계'}) : n < state.level ? h('span', {class:'badge ok', text:'지나온 단계'}) : h('span', {class:'badge', text:'아직 잠김'});
    const act = h('div', {class:'act'});
    if (!cur) act.append(h('button', {class:'btn', type:'button', text:'미리 보기', onclick: () => { ui.previewing = true; ui.viewLevel = n; resetRun(); $('#sheetLevels').close(); renderAll(); }}));
    if (n < state.level){
      if (ui.lowerAsk === n){
        act.append(h('button', {class:'btn danger', type:'button', text:'낮추기', onclick: () => { state.level = n; state.points = 0; state.snoozeAt = -1; ui.lowerAsk = 0; ui.previewing = false; ui.viewLevel = n; persist(); resetRun(); renderAll(); }}),
          h('button', {class:'btn quiet', type:'button', text:'취소', onclick: () => { ui.lowerAsk = 0; renderLevels(); }}));
      } else act.append(h('button', {class:'btn quiet', type:'button', text:'이 단계로 낮추기', onclick: () => { ui.lowerAsk = n; renderLevels(); }}));
    }
    box.append(h('article', {class:'lv' + (cur ? ' cur' : '') + (n > state.level ? ' lock' : '')},
      h('div', {class:'n', text: n + '단계' + (info.need ? ' · 수업 ' + info.need + '번' : '')}),
      h('h3', {text: info.name}), status,
      h('ul', null, info.opens.map(t => h('li', {text: t}))), act));
  });
}
const FBLABEL = {easy:'즐거웠어요', ok:'딱 좋았어요', hard:'벅찼어요'};
function renderHistory(){
  const ul = $('#hist'); ul.textContent = '';
  const items = state.history.slice(-8).reverse();
  if (!items.length){ const li = h('li', null, h('p', {class:'muted', text:'아직 기록이 없어요. 수업을 마치면 여기에 쌓여요.'})); li.style.gridTemplateColumns = '1fr'; ul.append(li); return; }
  items.forEach(x => {
    const d = (x.d || '').slice(5).replace('-', '/');
    ul.append(h('li', null, h('span', {class:'d', text: d}), h('span', {class:'t', text: (x.s || '') + ' · ' + (x.t || '') + (x.L ? ' · ' + x.L + '단계' : '')}), h('span', {class:'fbchip ' + (x.fb || 'ok'), text: FBLABEL[x.fb] || ''})));
  });
}
function renderSettings(){
  const st = $('#f-students'); if (document.activeElement !== st) st.value = state.students;
  const row = $('#resetRow'); row.textContent = '';
  if (ui.resetAsk){
    row.append(h('span', {text:'단계와 기록이 모두 지워져요.'}),
      h('button', {class:'btn danger', type:'button', text:'모두 지우기', onclick: () => { const s = state.students; state = normalize({students: s}); ui.resetAsk = false; ui.previewing = false; ui.viewLevel = 1; persist(); resetRun(); renderAll(); }}),
      h('button', {class:'btn quiet', type:'button', text:'취소', onclick: () => { ui.resetAsk = false; renderSettings(); }}));
  } else row.append(h('button', {class:'btn quiet danger', type:'button', text:'처음 단계부터 다시 하기', onclick: () => { ui.resetAsk = true; renderSettings(); }}));
}

/* ---------- 묶어서 그리기 ---------- */
function refresh(){
  const L = ui.viewLevel;
  const q = questions();
  const steps = buildSteps(L, draft, q);
  ui.steps = steps; ui.q = q;
  if (ui.step >= steps.length) ui.step = steps.length - 1;
  syncToday(L, q);
  renderSteps(steps);
  renderBoard(L, q, steps);
  renderBar();
  sendTvSoon();
}
function renderAll(){ renderTop(); refresh(); renderLevels(); renderHistory(); renderSettings(); renderTvBox(); }

/* =====================================================================
   저장과 TV 연결 (claude / firebase / local)
   ===================================================================== */
let kind = 'local', storage = 'loading', fbError = '';
function configured(){ const c = FIREBASE_CONFIG; return !!(c && typeof c.apiKey === 'string' && c.apiKey.trim() && c.projectId); }

/* -- claude.ai 아티팩트 -- */
let cProg = null, cRoom = null, cCanSend = false, cTvPeers = 0, cPadPeers = 0;
async function initClaude(){
  kind = 'claude';
  try {
    const c = window.claude;
    const [user, db, room] = await Promise.all([c.use('user'), c.use('db'), c.use('room')]);
    if (user && db){
      const uid = await user.id();
      if (uid){
        const ref = db.doc('data/users/' + uid + '/progress');
        const snap = await ref.get();
        const remote = snap.exists ? normalize(snap.data()) : null;
        if (remote && remote.total >= state.total){ state = remote; writeLocal(KEY, state); }
        else if (state.total > 0){ await ref.set(plain(state)); }
        cProg = ref; storage = 'account';
      } else storage = 'device';
    } else storage = 'device';
    if (room){
      cRoom = room;
      cCanSend = user ? !!(await user.canEdit()) : false;
      room.on('tv', msg => {
        if (!isTv || (msg.isMe && msg.sameTab) || !msg.data || typeof msg.data !== 'object') return;
        tvData = msg.data; tvAt = Date.now(); renderTvView();
      }, () => {});
      room.on('tv-hello', msg => { if (!isTv && !(msg.isMe && msg.sameTab)){ lastSentKey = ''; sendTvSoon(); } }, () => {});
      room.onPeers(ch => {
        const others = ch.peers.filter(p => !p.sameTab);
        cTvPeers = others.filter(p => p.presence && p.presence.role === 'tv').length;
        cPadPeers = others.filter(p => p.presence && p.presence.role === 'pad').length;
        if (!isTv && (ch.joined.some(p => !p.sameTab) || ch.updated.some(p => !p.sameTab && p.presence && p.presence.role === 'tv'))){ lastSentKey = ''; sendTvSoon(); }
        renderTvBox(); renderTvView();
      }, () => { renderTvBox(); });
      room.presence({role: isTv ? 'tv' : 'pad'}).catch(() => {});
      if (isTv) room.emit('tv-hello', {}).catch(() => {});
      setInterval(() => { if (!isTv && cTvPeers){ lastSentKey = ''; sendTv(); } }, 20000);
    }
  } catch (e){ storage = 'device'; }
  if (!ui.previewing) ui.viewLevel = state.level;
  renderAll(); renderTvView();
}

/* -- 파이어베이스 -- */
let fb = null, me = null, progRef = null, tvRef = null, seenRef = null, unsubTv = null, unsubSeen = null, tvSeenAt = 0, heartbeat = null;
async function initFirebase(){
  kind = 'firebase';
  try {
    const [appM, authM, fsM] = await Promise.all([import(FB_URL + 'firebase-app.js'), import(FB_URL + 'firebase-auth.js'), import(FB_URL + 'firebase-firestore.js')]);
    const app = appM.initializeApp(FIREBASE_CONFIG);
    fb = {A:authM, F:fsM, auth:authM.getAuth(app), db:fsM.getFirestore(app)};
    authM.onAuthStateChanged(fb.auth, onUser);
  } catch (e){
    fb = null; storage = 'device';
    fbError = '파이어베이스를 불러오지 못했어요. 인터넷 연결이나 config.js 값을 확인해 주세요.';
    renderStatus(); renderTvBox(); renderTvView();
  }
}
async function signIn(){
  if (!fb) return;
  fbError = '';
  try { await fb.A.signInWithPopup(fb.auth, new fb.A.GoogleAuthProvider()); }
  catch (e){
    const code = e && e.code;
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
    fbError = code === 'auth/unauthorized-domain' ? '이 주소가 파이어베이스 승인된 도메인에 없어요.' : code === 'auth/popup-blocked' ? '로그인 창이 막혔어요. 팝업을 허용해 주세요.' : '로그인하지 못했어요. 다시 눌러 주세요.';
    renderStatus(); renderTvView();
  }
}
async function signOutNow(){ if (fb) try { await fb.A.signOut(fb.auth); } catch (e){} }
async function onUser(u){
  me = u || null;
  stopTvListen();
  if (unsubSeen){ unsubSeen(); unsubSeen = null; }
  if (!u){ progRef = tvRef = seenRef = null; storage = 'device'; tvSeenAt = 0; renderAll(); renderTvView(); return; }
  const F = fb.F;
  progRef = F.doc(fb.db, 'users', u.uid);
  tvRef = F.doc(fb.db, 'users', u.uid, 'live', 'tv');
  seenRef = F.doc(fb.db, 'users', u.uid, 'live', 'tvseen');
  storage = 'loading'; renderStatus();
  try {
    const snap = await F.getDoc(progRef);
    const remote = snap.exists() ? normalize(snap.data()) : null;
    if (remote && remote.total >= state.total){ state = remote; writeLocal(KEY, state); }
    else if (state.total > 0){ await F.setDoc(progRef, plain(state)); }
    storage = 'account'; fbError = '';
  } catch (e){
    storage = 'device';
    fbError = e && e.code === 'permission-denied' ? '저장 권한이 없어요. 보안 규칙을 게시했는지 확인해 주세요.' : '계정 기록을 불러오지 못했어요. 지금은 이 기기에 저장해요.';
  }
  if (!ui.previewing) ui.viewLevel = state.level;
  unsubSeen = F.onSnapshot(seenRef, s => { tvSeenAt = s.exists() ? (Number(s.data().at) || 0) : 0; renderTvBox(); }, () => {});
  renderAll();
  if (isTv){ startTvListen(); renderTvView(); } else { lastSentKey = ''; sendTvSoon(); }
}

/* -- 공통: 진행 기록 저장 -- */
let writeChain = Promise.resolve();
function persist(){
  writeLocal(KEY, state);
  if (storage !== 'account') return;
  const body = plain(state);
  let job = null;
  if (kind === 'claude' && cProg) job = () => cProg.set(body);
  if (kind === 'firebase' && fb && progRef) job = () => fb.F.setDoc(progRef, body);
  if (!job) return;
  writeChain = writeChain.then(job).catch(() => { fbError = '계정에 저장하지 못했어요. 이 기기에는 저장돼 있어요.'; renderStatus(); });
}
function renderStatus(){
  const el = $('#status');
  el.className = 'status ' + (fbError ? 'device' : storage);
  el.lastElementChild.textContent = fbError || (storage === 'account' ? (kind === 'firebase' ? '구글 계정에 저장' : '내 계정에 저장') : storage === 'device' ? '이 기기에만 저장' : '불러오는 중');
  const btn = $('#authBtn'), acct = $('#acct');
  btn.hidden = kind !== 'firebase' || !fb;
  btn.textContent = me ? '로그아웃' : '구글로 로그인';
  btn.className = me ? 'btn quiet' : 'btn primary';
  acct.hidden = !me;
  acct.textContent = me ? (me.email || me.displayName || '') : '';
}

/* -- 공통: TV -- */
let isTv = false, tvSendTimer = null, lastSentKey = '';
const tv = {blank:false, link:null};
let tvData = null, tvAt = 0, tvTick = null, curVideo = '';
function canTv(){ return kind === 'claude' ? !!cRoom && cCanSend : kind === 'firebase' ? !!me && !!tvRef : false; }
function tvConnected(){ return kind === 'claude' ? cTvPeers > 0 : kind === 'firebase' ? (!!tvSeenAt && Date.now() - tvSeenAt < 150000) : false; }
function padConnected(){ return kind === 'claude' ? cPadPeers > 0 : !!tvData; }
function safeUrl(u){ u = String(u || '').trim(); return (/^https?:\/\/\S+$/i.test(u) && u.length <= 1500) ? u : null; }
function tvPayload(){
  const st = ui.started ? ui.steps[ui.step] : null;
  const running = !!(st && ui.timer.running);
  return {v:2, subj: draft.subj, page: (draft.page || '').trim(), core: ui.q ? ui.q.core : '',
    step: st ? {no: st.no, name: st.name, min: st.min, kids: st.kids, cue: st.cue || null} : null,
    endsAt: running ? Math.round(ui.timer.startedAt + st.min * 60000 - ui.timer.before) : null,
    rem: st && !running ? Math.round(st.min * 60 - ui.timer.before / 1000) : null,
    paused: !!(st && !running && ui.timer.before > 0),
    blank: tv.blank, link: tv.link};
}
function sendTv(){
  clearTimeout(tvSendTimer); tvSendTimer = null;
  if (isTv || !canTv()) return;
  const p = tvPayload(), key = JSON.stringify(p);
  if (key === lastSentKey) return;
  lastSentKey = key;
  p.at = Date.now();
  const fail = () => { lastSentKey = ''; };
  if (kind === 'claude') cRoom.emit('tv', p).catch(fail);
  else if (kind === 'firebase') fb.F.setDoc(tvRef, p).catch(fail);
}
function sendTvSoon(){ if (isTv || !canTv()) return; clearTimeout(tvSendTimer); tvSendTimer = setTimeout(sendTv, 350); }
function renderTvBox(){
  const conn = $('#tvconn'), on = tvConnected();
  conn.className = 'conn' + (on ? ' on' : '');
  conn.textContent = kind === 'local' ? 'TV 연결 꺼짐' : !canTv() ? (kind === 'firebase' && !me ? 'TV: 로그인 필요' : 'TV 연결 안 됨') : on ? 'TV 연결됨' : 'TV 연결 안 됨';
  const ok = canTv();
  $('#b-send').disabled = !ok; $('#b-blank').disabled = !ok; $('#f-link').disabled = !ok;
  $('#b-blank').textContent = tv.blank ? 'TV 켜기' : 'TV 끄기';
  $('#b-send').textContent = tv.link ? 'TV에서 내리기' : 'TV로';
}
function barMsg(t){ $('#barmsg').textContent = t || ''; }

/* 유튜브 주소에서 영상 번호와 시작 시각 꺼내기 */
function toSeconds(t){
  if (!t) return 0;
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  const m = String(t).match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  return m ? (+(m[1] || 0)) * 3600 + (+(m[2] || 0)) * 60 + (+(m[3] || 0)) : 0;
}
function ytInfo(u){
  try {
    const x = new URL(u);
    const host = x.hostname.replace(/^(www|m|music)\./, '');
    let id = null;
    if (host === 'youtu.be') id = x.pathname.slice(1).split('/')[0];
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com'){
      if (x.pathname === '/watch') id = x.searchParams.get('v');
      else { const m = x.pathname.match(/^\/(shorts|embed|live)\/([\w-]+)/); if (m) id = m[2]; }
    }
    if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
    return {id, start: toSeconds(x.searchParams.get('t') || x.searchParams.get('start'))};
  } catch (e){ return null; }
}
/* 아티팩트 안에서는 다른 사이트를 품을 수 없어서 유튜브도 '열기' 버튼으로 띄워요 */
function canEmbed(){ return kind !== 'claude'; }

function renderTvView(){
  if (!isTv) return;
  $('#tv-signin').hidden = !(kind === 'firebase' && fb && !me);
  $('#tv-conn').textContent = kind === 'local' ? 'TV 연결 꺼짐 (설정 전)' : (kind === 'firebase' && !me) ? '로그인이 필요해요' : (fbError || (padConnected() ? '패드와 연결됨' : '패드를 기다리는 중'));
  const d = tvData;
  const vbox = $('#tv-video'), vsub = $('#tv-videosub'), a = $('#tv-link'), kids = $('#tv-kids');
  if (!d){ vbox.hidden = true; vsub.hidden = true; a.hidden = true; kids.hidden = true; return; }
  $('#tvblack').hidden = !d.blank;
  const page = str(d.page, 40);
  $('#tv-meta').textContent = str(d.subj, 20) + (page ? ' · 교과서 ' + page + '쪽' : '');
  const url = d.link && typeof d.link === 'object' ? safeUrl(d.link.url) : null;
  const yt = url && !d.blank && canEmbed() ? ytInfo(url) : null;
  const core = $('#tv-core'); core.textContent = '';
  core.className = 'tvcore' + (url ? ' small' : '');
  core.append(h('span', {class:'tvlabel', text:'핵심질문'}), str(d.core, 200));
  if (yt){
    const src = 'https://www.youtube-nocookie.com/embed/' + yt.id + '?autoplay=1&rel=0&playsinline=1' + (yt.start ? '&start=' + yt.start : '');
    if (curVideo !== src){
      vbox.textContent = '';
      const f = document.createElement('iframe');
      f.src = src; f.title = '교실 영상';
      f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      f.setAttribute('allowfullscreen', '');
      f.referrerPolicy = 'strict-origin-when-cross-origin';
      vbox.append(f); curVideo = src;
    }
    vbox.hidden = false;
    vsub.textContent = '';
    vsub.append('재생되지 않으면 ', h('a', {href: url, target:'_blank', rel:'noopener noreferrer', text:'유튜브에서 열기'}), '를 눌러 주세요.');
    vsub.hidden = false; a.hidden = true; a.removeAttribute('href');
  } else {
    if (curVideo){ vbox.textContent = ''; curVideo = ''; }
    vbox.hidden = true; vsub.hidden = true;
    if (url && !d.blank){ a.href = url; $('#tv-link-url').textContent = url; a.hidden = false; }
    else { a.hidden = true; a.removeAttribute('href'); }
  }
  const step = d.step && typeof d.step === 'object' ? d.step : null;
  kids.hidden = !step || !!url; kids.textContent = '';
  if (step && !url){
    kids.append(h('div', {text: str(step.kids, 120)}));
    if (Array.isArray(step.cue) && step.cue.length) kids.append(h('div', {class:'cue'}, step.cue.slice(0, 6).map(c => h('span', {text: str(c, 20)}))));
  }
  $('#tv-stepbar').hidden = !step;
  if (step) $('#tv-step').textContent = str(step.no, 4) + ' ' + str(step.name, 30);
  renderTvClock();
}
function renderTvClock(){
  const d = tvData, el = $('#tv-clock');
  const has = d && d.step && (typeof d.endsAt === 'number' || typeof d.rem === 'number');
  if (!has){ el.textContent = ''; return; }
  const rem = typeof d.endsAt === 'number' ? (d.endsAt - Date.now()) / 1000 : d.rem;
  el.textContent = (rem < 0 ? '+' : '') + fmt(rem) + (d.paused ? ' · 멈춤' : '');
  el.classList.toggle('over', rem < 0);
}
function startTvListen(){
  if (kind === 'claude' && cRoom){ cRoom.presence({role:'tv'}).catch(() => {}); cRoom.emit('tv-hello', {}).catch(() => {}); return; }
  if (kind !== 'firebase' || !fb || !tvRef || unsubTv) return;
  unsubTv = fb.F.onSnapshot(tvRef, s => { tvData = s.exists() ? s.data() : null; tvAt = Date.now(); renderTvView(); }, () => {});
  const beat = () => { if (isTv && seenRef) fb.F.setDoc(seenRef, {at: Date.now()}).catch(() => {}); };
  beat(); heartbeat = setInterval(beat, 60000);
}
function stopTvListen(){
  if (unsubTv){ unsubTv(); unsubTv = null; }
  clearInterval(heartbeat); heartbeat = null;
}
function enterTv(){
  isTv = true; writeLocal(TVKEY, 1);
  $('#app').hidden = true; $('#tvview').hidden = false;
  stopTick(); letSleep();
  if (!tvTick) tvTick = setInterval(renderTvClock, 500);
  startTvListen(); renderTvView();
}
function exitTv(){
  isTv = false; writeLocal(TVKEY, 0);
  stopTvListen();
  if (kind === 'claude' && cRoom) cRoom.presence({role:'pad'}).catch(() => {});
  $('#app').hidden = false; $('#tvview').hidden = true; $('#tvblack').hidden = true;
  $('#tv-video').textContent = ''; curVideo = '';
  clearInterval(tvTick); tvTick = null; letSleep();
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e){}
  renderAll();
}

/* ---------- 입력 ---------- */
function fillInputs(){
  $('#f-subj').value = draft.subj;
  $('#f-page').value = draft.page || '';
  $('#f-title').value = draft.title || '';
  $('#f-name').value = draft.name || '';
  $('#f-link').value = draft.link || '';
  $('#f-lk').value = draft.lessonKind || 'normal';
  document.querySelectorAll('input[name=nk]').forEach(r => { r.checked = r.value === draft.nameKind; });
}
function bindField(id, key){ $(id).addEventListener('input', e => { draft[key] = e.target.value; draft.example = false; saveDraft(); refresh(); }); }
bindField('#f-page', 'page'); bindField('#f-title', 'title'); bindField('#f-name', 'name');
$('#f-subj').addEventListener('change', e => { draft.subj = e.target.value; draft.example = false; saveDraft(); refresh(); });
$('#f-lk').addEventListener('change', e => { draft.lessonKind = e.target.value; saveDraft(); refresh(); });
document.querySelectorAll('input[name=nk]').forEach(r => r.addEventListener('change', () => { if (r.checked){ draft.nameKind = r.value; draft.example = false; saveDraft(); refresh(); } }));
[['core', '#q-core', '#r-core'], ['guide', '#q-guide', '#r-guide']].forEach(([k, inp, rb]) => {
  const el = $(inp);
  el.addEventListener('input', () => {
    const g = generate(draft)[k];
    if (el.value.trim() && el.value.trim() !== g) draft.over[k] = el.value; else delete draft.over[k];
    draft.example = false; saveDraft(); refresh();
  });
  el.addEventListener('blur', () => refresh());
  $(rb).addEventListener('click', () => { delete draft.over[k]; saveDraft(); el.value = generate(draft)[k]; refresh(); });
});
$('#clearEg').addEventListener('click', () => newLesson());
$('#f-students').addEventListener('change', e => { state.students = Math.min(40, Math.max(2, parseInt(e.target.value, 10) || 22)); persist(); renderTop(); renderSettings(); });

$('#b-time').addEventListener('click', toggleTimer);
$('#b-prev').addEventListener('click', () => goStep(ui.step - 1));
$('#b-next').addEventListener('click', () => goStep(ui.step + 1));
$('#b-finish').addEventListener('click', openDone);
$('#lvchip').addEventListener('click', () => { renderLevels(); renderHistory(); renderSettings(); openSheet($('#sheetLevels')); });
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

$('#authBtn').addEventListener('click', () => { if (me) signOutNow(); else signIn(); });
$('#tv-signin').addEventListener('click', signIn);
$('#f-link').addEventListener('input', e => { draft.link = e.target.value; saveDraft(); barMsg(''); });
$('#b-send').addEventListener('click', () => {
  if (tv.link){ tv.link = null; sendTv(); renderTvBox(); barMsg('TV에서 링크를 내렸어요.'); return; }
  const u = safeUrl($('#f-link').value);
  if (!u){ barMsg('https:// 로 시작하는 주소를 붙여 넣어 주세요.'); return; }
  tv.link = {url: u}; tv.blank = false; sendTv(); renderTvBox();
  barMsg(ytInfo(u) && kind !== 'claude' ? 'TV에서 영상을 바로 재생해요.' : 'TV에 노란 ‘열기’ 버튼으로 떴어요. TV 도우미가 한 번 눌러 주면 돼요.');
});
$('#b-blank').addEventListener('click', () => { tv.blank = !tv.blank; sendTv(); renderTvBox(); barMsg(tv.blank ? 'TV를 검은 화면으로 바꿨어요. 아이들 눈이 칠판으로 와요.' : ''); });
$('#toTv').addEventListener('click', enterTv);
$('#tv-exit').addEventListener('click', exitTv);
$('#tv-full').addEventListener('click', () => {
  try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e){}
  keepAwake();
});
$('#tvblack').addEventListener('click', () => { $('#tvblack').hidden = true; });
window.addEventListener('hashchange', () => { if (location.hash === '#tv' && !isTv) enterTv(); });
document.addEventListener('keydown', e => {
  if (isTv || !ui.started) return;
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag) || document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowRight'){ goStep(ui.step + 1); e.preventDefault(); }
  if (e.key === 'ArrowLeft'){ goStep(ui.step - 1); e.preventDefault(); }
});
setInterval(() => { if (!isTv && kind === 'firebase' && me) renderTvBox(); }, 30000);

/* 수업 중·TV 화면에서는 화면이 꺼지지 않게 (안 되면 그냥 넘어가요) */
let wake = null;
async function keepAwake(){ try { if ('wakeLock' in navigator && !wake){ wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e){ wake = null; } }
function letSleep(){ try { if (wake) wake.release(); } catch (e){} wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (isTv || (ui.started && ui.timer.running))) keepAwake(); });

/* ---------- 시작 ---------- */
fillInputs();
renderAll();
if (location.hash === '#tv' || new URLSearchParams(location.search).has('tv') || readLocal(TVKEY) === 1) enterTv();
if (window.claude && typeof window.claude.use === 'function') initClaude();
else if (configured()) initFirebase();
else { kind = 'local'; storage = 'device'; renderStatus(); renderTvBox(); renderTvView(); }
