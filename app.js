// 질문수업 진행판
// 교과서 [제목]과 [이름]으로 칠판 판서와 40분 진행 순서를 만들고,
// 수업을 마칠수록 한 단계씩 깊어지는 교사용 패드 웹앱.
// 파이어베이스(구글 로그인 + Firestore)가 설정되면 진행 기록을 계정에 저장하고
// 패드에서 교실 TV 화면을 조종해요. 설정이 없으면 이 기기에만 저장해요.

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
function dateK(){ const d = new Date(); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일'; }
function fmt(sec){ const s = Math.abs(Math.round(sec)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function str(x, n){ return typeof x === 'string' ? x.slice(0, n) : ''; }

/* 받침에 맞춰 조사 고르기 (은/는, 이/가, 을/를, 이라면/라면) */
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
  {n:1, name:'교과서 함께 읽기', need:6, opens:['40분을 6단계로 짧게', '루틴 3개: 궁금해요 · 무엇을 보고 · 헤드라인', '노트 3칸']},
  {n:2, name:'질문판 열기', need:8, opens:['궁금한 것을 포스트잇으로 질문판에', '질문 주인 이름 부르기', '하루 2명 당번 노트 보기']},
  {n:3, name:'근거로 말하기', need:10, opens:['7단계 40분', '주장·근거·질문 · 줄다리기', '노트 4칸 · C → B → A 릴레이']},
  {n:4, name:'루틴 바꿔 끼우기', need:12, opens:['수업마다 루틴 하나를 바꿔 보기', '단원 첫·마지막 차시 루틴', '노트 루틴 칸을 아이가 고르기']},
  {n:5, name:'아이들이 이끄는 질문', need:null, opens:['아이들이 고른 질문 2개로 ④', 'A그룹 다음 날 복습 퀴즈 출제', '노트 자유 정리']}
];
const lv = n => LEVELS[n - 1];

/* ---------- 저장 (이 기기) ---------- */
const KEY = 'qclass-runner-v1', DKEY = 'qclass-draft-v1', TVKEY = 'qclass-tv';
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
const EXAMPLE = {subj:'사회', page:'82~83', title:'지구촌 갈등의 원인', name:'카슈미르 지역', nameKind:'case', lessonKind:'normal', sideA:'', sideB:'', link:'', over:{}, example:true};
let draft = Object.assign({}, EXAMPLE, readLocal(DKEY) || {});
draft.over = Object.assign({}, draft.over || {});
let draftTimer = null;
function saveDraft(){ clearTimeout(draftTimer); draftTimer = setTimeout(() => writeLocal(DKEY, draft), 300); }

/* ---------- 화면 상태 ---------- */
const ui = {mode:'prep', step:0, viewLevel:state.level, previewing:false, checks:{}, fb:null, lowerAsk:0, resetAsk:false,
  timer:{running:false, startedAt:0, before:0}, lastSteps:null, lastQ:null};

/* ---------- 파이어베이스 (구글 로그인 + 저장 + TV) ---------- */
let fb = null, me = null, storage = 'loading', fbError = '';
let progRef = null, tvRef = null, seenRef = null, unsubTv = null, unsubSeen = null, writeChain = Promise.resolve();
function configured(){
  const c = FIREBASE_CONFIG;
  return !!(c && typeof c.apiKey === 'string' && c.apiKey.trim() && c.projectId);
}
async function initFirebase(){
  if (!configured()){ storage = 'device'; renderStatus(); renderTvBox(); renderTvView(); return; }
  try {
    const [appM, authM, fsM] = await Promise.all([
      import(FB_URL + 'firebase-app.js'),
      import(FB_URL + 'firebase-auth.js'),
      import(FB_URL + 'firebase-firestore.js')
    ]);
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
    fbError = code === 'auth/unauthorized-domain'
      ? '이 주소가 파이어베이스 승인된 도메인에 없어요. Authentication → 설정 → 승인된 도메인에 추가해 주세요.'
      : code === 'auth/popup-blocked' ? '로그인 창이 막혔어요. 이 사이트의 팝업을 허용해 주세요.' : '로그인하지 못했어요. 잠시 뒤 다시 눌러 주세요.';
    renderStatus(); renderTvView();
  }
}
async function signOutNow(){ if (fb) try { await fb.A.signOut(fb.auth); } catch (e){} }

async function onUser(u){
  me = u || null;
  stopTvListen();
  if (unsubSeen){ unsubSeen(); unsubSeen = null; }
  if (!u){
    progRef = tvRef = seenRef = null; storage = 'device'; tvSeenAt = 0;
    renderAll(); renderTvView(); return;
  }
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
    fbError = e && e.code === 'permission-denied'
      ? '계정에 저장할 권한이 없어요. 파이어베이스 보안 규칙을 게시했는지 확인해 주세요.'
      : '계정 기록을 불러오지 못했어요. 지금은 이 기기에 저장해요.';
  }
  if (!ui.previewing) ui.viewLevel = state.level;
  unsubSeen = F.onSnapshot(seenRef, s => { tvSeenAt = s.exists() ? (Number(s.data().at) || 0) : 0; renderTvBox(); }, () => {});
  renderAll();
  if (isTv){ startTvListen(); renderTvView(); }
  else sendTvSoon();
}
function persist(){
  writeLocal(KEY, state);
  if (!fb || !progRef || storage !== 'account') return;
  const ref = progRef, body = plain(state);
  writeChain = writeChain.then(() => fb.F.setDoc(ref, body)).catch(() => {
    fbError = '계정에 저장하지 못했어요. 이 기기에는 저장돼 있어요.'; renderStatus();
  });
}

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
const HINTS = {
  why:'제목에 ‘원인·까닭’이 있어서 ‘왜’ 질문으로 골랐어요.',
  what:'제목에 ‘모습·특징·변화’가 있어서 ‘무엇이 달라졌을까’ 질문으로 골랐어요.',
  how:'제목에 ‘노력·방법·해결’이 있어서 ‘어떻게 풀까’ 질문으로 골랐어요.',
  basic:'제목에 정해진 끝말이 없어서 기본 질문을 골랐어요. 고쳐 써도 좋아요.'
};
const SIDES = {
  person:['잘한 선택이다', '다른 선택이 나았다'],
  case:['다른 나라가 함께 나서야 한다', '당사자끼리 풀어야 한다'],
  thing:['꼭 있어야 한다', '없어도 된다']
};
function generate(d, L){
  const N = (d.name || '').trim() || '○○';
  const T = (d.title || '').trim();
  const tk = titleKind(T), nk = d.nameKind || 'case', topic = topicOf(T);
  const g = {tk};
  if (tk === 'why') g.core = nk === 'person' ? J(N, '은/는') + ' 왜 그렇게 했을까?' : nk === 'case' ? N + '에서는 왜 ' + J(topic || '그런 일', '이/가') + ' 일어났을까?' : J(N, '은/는') + ' 왜 생겼을까?';
  else if (tk === 'what') g.core = nk === 'person' ? J(N, '은/는') + ' 무엇을 바꾸었을까?' : nk === 'case' ? J(N, '은/는') + ' 무엇이 달라졌을까?' : J(N, '은/는') + ' 무엇이 특별할까?';
  else if (tk === 'how') g.core = nk === 'person' ? J(N, '은/는') + ' 문제를 어떻게 풀었을까?' : nk === 'case' ? N + '의 문제는 어떻게 풀 수 있을까?' : J(N, '을/를') + ' 어떻게 쓸 수 있을까?';
  else g.core = nk === 'person' ? J(N, '은/는') + ' 어떤 사람일까?' : nk === 'case' ? N + '에서는 무슨 일이 있었을까?' : J(N, '은/는') + ' 무엇이고, 왜 필요할까?';

  g.q1 = L <= 2 ? '교과서에서 ' + J(N, '을/를') + ' 설명하는 중요한 낱말 3개는? 몇째 줄?' : N + '에 대해 교과서가 알려 주는 사실 하나는? 쪽·줄과 함께';
  if (tk === 'why') g.q2 = nk === 'person' ? J(N, '은/는') + ' 왜 그런 선택을 했을까? 교과서 근거 2개' : J(N, '은/는') + ' 왜 그렇게 되었을까? 교과서 근거 2개';
  else if (tk === 'what') g.q2 = nk === 'person' ? J(N, '은/는') + ' 무엇을 바꾸었고, 왜 그랬을까? 교과서 근거 2개' : N + '의 예전과 지금은 무엇이 다를까? 교과서 근거 2개';
  else if (tk === 'how') g.q2 = N + '에서 어떤 노력이 있었고, 왜 그렇게 했을까? 교과서 근거 2개';
  else g.q2 = J(N, '은/는') + ' 왜 중요할까? 교과서 근거 2개';
  g.q3 = nk === 'person' ? '내가 ' + J(N, '이라면/라면') + ' 어떻게 했을까?' : nk === 'case' ? '내가 ' + N + '에 사는 사람이라면 무엇부터 할까?' : J(N, '이/가') + ' 없다면 어떻게 될까?';
  return g;
}
function questions(L){
  const g = generate(draft, L);
  const q = {};
  ['core', 'q1', 'q2', 'q3'].forEach(k => { q[k] = (draft.over[k] != null && draft.over[k].trim()) ? draft.over[k].trim() : g[k]; });
  q.q2short = q.q2.replace(/\s*(교과서\s*)?근거\s*2개\s*$/, '');
  const sd = SIDES[draft.nameKind] || SIDES.case;
  q.sideA = (draft.sideA || '').trim() || sd[0];
  q.sideB = (draft.sideB || '').trim() || sd[1];
  q.exit = '오늘 핵심질문에 한 문장으로 답하면? 교과서 낱말 하나를 넣어서';
  q.tk = g.tk;
  return q;
}

/* ---------- 40분 단계 ---------- */
const SWAPS = ['spw', 'zoom', 'circle', 'chalk'];
function buildSteps(L, d, q){
  const pg = (d.page || '').trim() || '○○';
  const open = {no:'①', name:'열기', min:3, zone:'core', say:['핵심질문을 같이 소리 내어 읽어요.', '“' + q.core + '”'], board:'왼쪽에 미리 써 둔 핵심질문을 가리키며 읽어요.', note:'날짜 · 교과서 쪽 · 핵심질문 옮겨 쓰기', tip:'손으로 옮겨 쓰는 동안 교실이 조용해져요.'};
  const wonder = L === 1
    ? {no:'②', name:'궁금해요', min:5, zone:'task', routine:'보고·생각하고·궁금해하기', say:['교과서 ' + pg + '쪽 사진만 보세요. 본문은 아직이에요.', '궁금한 것 하나만 노트에 써요.', '2~3명만 말로 들어요.'], board:'아래 칸 ‘지금 할 일’을 가리켜요. 새로 쓸 것은 없어요.', note:'궁금해요 1줄'}
    : {no:'②', name:'보고 · 궁금해요', min:5, zone:'qboard', routine:'보고·생각하고·궁금해하기', say:['교과서 ' + pg + '쪽 사진만 보세요.', '보여요 · 생각나요 · 궁금해요를 한 줄씩 써요.', '궁금한 것 하나는 포스트잇에도 써요.', '“질문판 관리자, 모아서 붙여 줄래요?”'], board:'오른쪽 질문판에 포스트잇 5~6장. 이름이 보이게 붙여요.', note:'보여요 / 생각나요 / 궁금해요 3줄', tip:'B그룹에게 질문판 관리자를 맡겨요. 고른 질문은 이름과 함께 소개해요.'};

  if (L <= 2){
    const read = {no:'③', name:'함께 읽기', min:15, zone:'words', routine:'무엇을 보고 그렇게 말해?', say:['같이 읽어요. 중요한 낱말이 나오면 손가락으로 짚어요.', '“' + q.q1 + '”', '대답마다 “무엇을 보고 그렇게 말해요? 몇째 줄?”'], board:'왼쪽 점선 칸에 아이들이 찾은 낱말 3개와 쪽을 써요.', note:'교과서 낱말 3개 + 쪽·줄', tip:'C그룹부터 짚게 해요. “달을 쎄뇨?” 같은 추측은 “좋은 예측! 교과서는 뭐라고 해?”로 받아요.'};
    const ask = L === 1
      ? {no:'④', name:'선생님 질문', min:8, zone:'mid', say:['“' + q.q2short + '”', '“그렇게 말한 근거는 교과서 몇 쪽 몇째 줄일까?”', '엄지 위·옆·아래로 먼저 답하고, 2~3명만 이유를 들어요.'], board:'가운데에 미리 써 둔 질문 2개를 가리켜요.', note:'답 1줄 (쪽 함께)'}
      : {no:'④', name:'질문 이어 가기', min:8, zone:'mid', say:['“' + q.q2short + '”', '질문판에서 하나를 골라 이름과 함께 읽어요. “오늘은 ○○ 질문으로 이어 가요.”', '엄지 위·옆·아래 → 2~3명 이유'], board:'고른 포스트잇을 가운데 점선 칸으로 옮겨요.', note:'답 1줄 (쪽 함께)', tip:'이름을 불러 주는 순간이 이 수업에서 가장 즐거운 장면이에요.'};
    const head = {no:'⑥', name:'노트정리', min:7, zone:'head', routine:'헤드라인', say:['오늘 내용을 기사 제목 한 줄로 써 봐요.', '핵심 1줄은 교과서 낱말로 써요.', '다 쓴 사람 2~3명이 칠판에 써요.'], board:'왼쪽 아래 점선 칸에 헤드라인 2~3개.', note:'헤드라인 1줄 + 핵심 1줄', tip:'시간이 밀려도 이 단계는 자르지 않아요.'};
    const exit = {no:'⑦', name:'출구', min:2, zone:'task', say:['“' + q.exit + '”', L >= 2 ? '오늘 당번 2명은 노트를 교탁에 두고 가요.' : '노트를 펴서 보여 주고 나가요.'], board: L >= 2 ? '못 다룬 질문은 질문판 주차장으로 옮겨요.' : '새로 쓸 것은 없어요.', note:'노트 보여 주기'};
    return [open, wonder, read, ask, head, exit];
  }

  const check = {no:'③', name:'확인', min:8, zone:'words', routine:'무엇을 보고 그렇게 말해?', say:['“' + q.q1 + '”', '대답마다 “무엇을 보고 그렇게 말해요?”', '사진만 보고 한 예측과 교과서가 같았나요?'], board:'왼쪽 점선 칸에 교과서 낱말 3개와 쪽.', note:'답 + 쪽·줄, 교과서 낱말 3개', tip:'C그룹이 먼저 발표해요.'};
  const und = L >= 5
    ? {no:'④', name:'이해', min:10, zone:'mid', routine:'주장·근거·질문', say:['질문판에서 아이들이 질문 2개를 골라요.', '고른 질문이 오늘의 이끎질문 2번이 돼요.', '3분 쓰기 → “○○ 말에 덧붙이면…” 릴레이'], board:'아이들이 고른 질문 2개를 가운데 2번 칸에 옮겨 써요.', note:'주장 1 / 근거 2(쪽·줄) / 질문 1', tip:'발표 순서 C → B → A'}
    : {no:'④', name:'이해', min:10, zone:'mid', routine:'주장·근거·질문', say:['“' + q.q2 + '”', '3분 동안 주장 1 · 근거 2 · 질문 1을 써요.', '“○○ 말에 덧붙이면…”으로 릴레이 발표'], board:'질문판의 학생 질문 1개를 가운데 2번에 화살표로 이어요.', note:'주장 1 / 근거 2(쪽·줄) / 질문 1', tip:'발표 순서 C → B → A'};
  const think = {no:'⑤', name:'생각', min:5, zone:'tug', routine:'줄다리기', say:['“' + q.q3 + '”', '줄 양 끝: “' + q.sideA + '” ↔ “' + q.sideB + '”', '내 위치와 이유를 포스트잇에 써서 줄 위에 붙여요.'], board:'가운데 아래 점선 칸에 줄을 긋고 양 끝에 두 입장.', note:'내 위치 + 이유 1줄', tip:'A그룹이 마지막에 반대쪽 이유로 마무리해요. 시간이 밀리면 손신호 1분으로.'};
  const head = {no:'⑥', name:'노트정리', min:7, zone:'head', routine:'헤드라인 · 전에는·지금은', say:['헤드라인 1줄, 핵심 3줄은 교과서 낱말로.', '“전에는 ~라고 생각했는데, 지금은 ~”', '결론 문장에 교과서 속 이름과 쪽수가 있나요?'], board:'왼쪽 아래 점선 칸에 헤드라인 2~3개.', note: L >= 5 ? '자유 정리 (핵심질문 · 쪽수 · 헤드라인 · 남은 질문은 꼭)' : L >= 4 ? '루틴 칸은 오늘 루틴으로, 나머지 칸은 그대로' : '헤드라인 + 핵심 3줄 + 전에는·지금은', tip:'시간이 밀려도 이 단계는 자르지 않아요.'};
  const exit = {no:'⑦', name:'출구', min:2, zone:'task', say:['“' + q.exit + '”', '오늘 당번 2명은 노트를 교탁에 두고 가요.'], board:'못 다룬 질문은 질문판 주차장으로 옮겨요.', note:'노트 보여 주기'};
  if (L >= 5) exit.say.push('A그룹: 내일 아침 복습 퀴즈 3문항 (문항마다 쪽수)');
  const list = [open, wonder, check, und, think, head, exit];

  if (L >= 4){
    if (d.lessonKind === 'first'){
      list[1] = Object.assign({}, wonder, {name:'단원 열기', routine:'생각·퍼즐·탐구', say:['단원 도입 쪽을 펴요.', '아는 것 / 헷갈리는 것 / 알아볼 곳(교과서 쪽 먼저)을 써요.', '헷갈리는 것은 포스트잇으로 질문판에.'], note:'아는 것 / 헷갈리는 것 / 알아볼 곳', tip:'모인 질문을 차시별로 나눠 두면 “내 질문은 3차시에 나와요”가 생겨요.', swapped:true});
    } else if (d.lessonKind === 'last'){
      list[5] = Object.assign({}, head, {name:'단원 정리', routine:'생성·분류·연결·정교화', say:['단원에서 배운 교과서 낱말을 모두 꺼내요.', '비슷한 것끼리 묶고 선으로 이어요. 선마다 쪽수를 적어요.'], note:'단원 개념 지도 1쪽', swapped:true});
      list[6] = Object.assign({}, exit, {board:'질문판을 걷고, 아직 답 못 한 질문만 남겨요.'});
    } else {
      const sw = SWAPS[state.total % SWAPS.length];
      if (sw === 'spw') list[2] = Object.assign({}, check, {routine:'문장·구절·낱말', say:['중요한 문장 1 · 구절 1 · 낱말 1을 찾아요. 쪽·줄과 함께.', '낱말만 칠판에 모아 겹치는 것을 봐요.', '이어서 “' + q.q1 + '”'], note:'문장 1 · 구절 1 · 낱말 1 + 쪽·줄', swapped:true});
      if (sw === 'zoom') list[1] = Object.assign({}, wonder, {routine:'확대하기', say:['교과서 사진을 종이로 가려요.', '신호에 맞춰 조금씩 열면서, 열 때마다 예측을 고쳐 써요.', '마지막 궁금한 것은 포스트잇으로 질문판에.'], note:'가린 상태의 예측 → 연 뒤의 생각', swapped:true});
      if (sw === 'circle') list[4] = Object.assign({}, think, {routine:'관점의 원', say:['“' + q.q3 + '”', '번호순으로 관점을 나눠 맡아요.', '“나는 ○○의 입장에서 ~라고 생각한다.”'], board:'가운데 아래 칸에 관점 이름을 둥글게 적어요.', note:'내가 맡은 관점 1줄', swapped:true});
      if (sw === 'chalk') list[3] = Object.assign({}, und, {routine:'분필 대화', say:['말하지 않고 칠판에 쓰고, 친구 글에 화살표로 답해요.', '주제: “' + q.q2short + '”', '끝나면 칠판 내용을 노트에 3줄로 옮겨요.'], board:'가운데 칸을 비워 분필 대화 자리로 써요.', note:'칠판 대화에서 옮긴 3줄', tip:'말 많은 B그룹도 차분히 참여해요.', swapped:true});
    }
  }
  return list;
}
function swappedRoutine(steps){ const s = steps.find(x => x.swapped); return s ? s.no + ' ' + s.routine : ''; }

/* ---------- 렌더: 상단 ---------- */
function renderStatus(){
  const el = $('#status');
  const mode = fbError ? 'device' : storage;
  el.className = 'status ' + mode;
  el.lastElementChild.textContent = fbError || (storage === 'account' ? '구글 계정에 저장돼요' : storage === 'device' ? '이 기기에만 저장돼요' : '불러오는 중');
  const btn = $('#authBtn'), acct = $('#acct');
  btn.hidden = !fb;
  btn.textContent = me ? '로그아웃' : '구글로 로그인';
  btn.className = me ? 'btn quiet' : 'btn primary';
  acct.hidden = !me;
  acct.textContent = me ? (me.email || me.displayName || '') : '';
}
function dutyToday(){
  const today = isoDate();
  const days = new Set(state.history.map(x => x.d).filter(d => d && d < today)).size;
  const N = state.students;
  return [(2 * days) % N + 1, (2 * days + 1) % N + 1];
}
function isReady(){ const need = lv(state.level).need; return !!need && state.points >= need && state.total > state.snoozeAt; }
function renderLevelbar(){
  const box = $('#levelbar'); box.textContent = '';
  const L = state.level, info = lv(L);
  const ticks = h('div', {class:'ticks', 'aria-hidden':'true'});
  if (info.need) for (let i = 0; i < info.need; i++) ticks.append(h('span', {class: i < state.points ? 'on' : ''}));
  const meta = info.need
    ? h('div', {class:'lvmeta'}, '다음 단계까지 ', h('b', {text: Math.max(0, info.need - state.points) + '번'}), ' · 마친 수업 ', h('b', {text: state.total + '번'}))
    : h('div', {class:'lvmeta'}, '마지막 단계예요 · 마친 수업 ', h('b', {text: state.total + '번'}));
  box.append(h('div', {class:'lvcard'},
    h('div', {class:'lvhead'}, h('span', {class:'lvnum', text: L + '단계'}), h('span', {class:'lvname', text: info.name})),
    info.need ? ticks : null, meta));

  const side = h('div', {class:'side'});
  if (ui.previewing && ui.viewLevel !== L){
    side.append(h('div', {class:'notice preview'},
      h('p', null, h('b', {text: ui.viewLevel + '단계'}), '를 미리 보는 중이에요. 칠판과 진행 순서가 이 단계로 바뀌었어요.'),
      h('div', {class:'row'}, h('button', {class:'btn', type:'button', text: L + '단계로 돌아가기', onclick: () => { ui.previewing = false; ui.viewLevel = state.level; resetRun(); renderAll(); }}))));
  }
  if (isReady()){
    const nx = lv(L + 1);
    side.append(h('div', {class:'notice ready'},
      h('p', null, h('b', {text: (L + 1) + '단계 ‘' + nx.name + '’'}), '를 열 준비가 됐어요. ' + nx.opens[0] + '부터 시작해요.'),
      h('div', {class:'row'},
        h('button', {class:'btn primary', type:'button', text:'다음 수업부터 열기', onclick: () => { state.level = L + 1; state.points = 0; state.snoozeAt = -1; ui.previewing = false; ui.viewLevel = state.level; persist(); resetRun(); renderAll(); }}),
        h('button', {class:'btn', type:'button', text:'이 단계 조금 더', onclick: () => { state.snoozeAt = state.total; persist(); renderAll(); }}))));
  }
  if (state.level >= 2 || ui.viewLevel >= 2){
    const [a, b] = dutyToday();
    side.append(h('div', {class:'notice'}, h('div', {class:'duty'}, h('span', {text:'오늘 노트 당번'}), h('span', {class:'nums', text: a + '번 · ' + b + '번'}))));
  }
  if (!side.childNodes.length){
    side.append(h('div', {class:'notice'}, h('p', null, '처음 몇 번은 교과서를 아이들과 함께 읽는 데 시간을 넉넉히 써요. 질문판, 줄다리기는 단계가 오르면 열려요.')));
  }
  box.append(side);
}

/* ---------- 렌더: 칠판 ---------- */
function zone(key, hot, dashed, extra){
  return h('div', {class:'zone' + (dashed ? ' d' : '') + (hot === key ? ' hot' : '') + (extra ? ' ' + extra : ''), 'data-zone': key});
}
function renderBoard(L, q, steps, hot){
  const b = $('#board'); b.textContent = '';
  const pg = (draft.page || '').trim() || '○○';

  const left = h('div', {class:'col left'});
  const core = zone('core', hot);
  core.append(h('div', {class:'ztitle', text:'왼쪽 · 오늘'}),
    h('div', {class:'cmeta', text: dateK() + ' · ' + draft.subj + ' · 교과서 ' + pg + '쪽'}),
    h('div', {class:'clabel', text:'핵심질문'}),
    h('div', {class:'ccore', text: q.core}));
  const words = zone('words', hot, true);
  words.append(h('div', {class:'ztag', text:'③ 중 · 교과서 낱말 3개'}), h('div', {class:'cdim', text:'△△ · □□ · ◇◇ (○쪽)'}));
  const head = zone('head', hot, true);
  head.append(h('div', {class:'ztag', text:'⑥ 중 · 헤드라인'}), h('div', {class:'cdim', text:'아이들 2~3명이 직접 써요'}));
  left.append(core, words, head);

  const mid = h('div', {class:'col mid'});
  const mz = zone('mid', hot);
  const sw = swappedRoutine(steps);
  mz.append(h('div', {class:'ztitle', text: L <= 2 ? '가운데 · 선생님 질문' : '가운데 · 이끎질문'}));
  if (sw) mz.append(h('div', {class:'swapchip', text:'오늘 바꿔 끼우기: ' + sw}));
  if (L === 1){
    mz.append(h('div', {class:'cq', text: q.q2short}), h('div', {class:'cq', text:'근거는 교과서 몇 쪽 몇째 줄일까?'}));
  } else if (L === 2){
    mz.append(h('div', {class:'cq', text: q.q2short}),
      h('div', {class:'zone d'}, h('div', {class:'ztag', text:'④ 중 · 질문판에서 고른 질문'}), h('div', {class:'cdim', text:'○○의 질문'})));
  } else {
    mz.append(h('div', {class:'cq'}, h('b', {text:'1 확인'}), q.q1));
    if (L >= 5) mz.append(h('div', {class:'zone d'}, h('div', {class:'ztag', text:'2 이해 · ④ 중 · 아이들이 고른 질문 2개'}), h('div', {class:'cdim', text:'○○의 질문 · ○○의 질문'})));
    else mz.append(h('div', {class:'cq'}, h('b', {text:'2 이해'}), q.q2));
    mz.append(h('div', {class:'cq'}, h('b', {text:'3 생각'}), q.q3));
  }
  mid.append(mz);
  if (L >= 3){
    const circle = steps[4] && steps[4].routine === '관점의 원';
    const tz = zone('tug', hot, true);
    tz.append(h('div', {class:'ztag', text: circle ? '⑤ 중 · 관점의 원' : '⑤ 중 · 줄다리기'}));
    if (circle) tz.append(h('div', {class:'cdim', text:'관점 이름을 둥글게 적어요'}));
    else tz.append(h('div', {class:'tug'}, h('span', {text: q.sideA}), h('div', {class:'line'}), h('span', {text: q.sideB})));
    mid.append(tz);
  }

  const right = h('div', {class:'col right'});
  if (L === 1){
    const rz = zone('qboard', hot, true, 'locked');
    rz.append(h('div', {class:'ztitle', text:'오른쪽 · 질문판'}), h('div', {class:'cdim', text:'2단계에서 열려요. 지금은 궁금한 것을 말로 들어요.'}));
    right.append(rz);
  } else {
    const rz = zone('qboard', hot, true);
    rz.append(h('div', {class:'ztitle', text:'오른쪽 · 질문판'}),
      h('div', {class:'ztag', text:'② 중 · 포스트잇 + 이름'}),
      h('div', {class:'postits'}, h('div', {class:'postit ghost', text:'○○ 질문'}), h('div', {class:'postit ghost', text:'○○ 질문'})),
      h('div', {class:'cline'}),
      h('div', {class:'cq', text:'주차장: 못 다룬 질문'}));
    right.append(rz);
  }

  const bottom = h('div', {class:'col bottom'});
  const tz = zone('task', hot);
  const third = L >= 2 ? '3. 보여요·생각나요·궁금해요' : '3. 궁금해요 1줄 쓰기';
  tz.append(h('div', {class:'btmgrid'},
    h('div', {class:'ztitle', text:'아래 · 지금 할 일 (번호 3줄) · 교실 3규칙'}),
    h('div', null, '1. 교과서 ' + pg + '쪽 펴기', h('br'), '2. 사진만 보기', h('br'), third),
    h('div', null, '말하기 전에 쪽·줄', h('br'), '친구 질문에 이름', h('br'), '쓰고 나서 말하기')));
  bottom.append(tz);

  b.append(left, mid, right, bottom);
}

function renderChecklist(L){
  const box = $('#checklist');
  box.hidden = ui.mode !== 'prep';
  if (box.hidden) return;
  box.textContent = '';
  const pg = (draft.page || '').trim() || '○○';
  const items = ['날짜 · ' + draft.subj + ' · 교과서 ' + pg + '쪽 (왼쪽 위)', '핵심질문 (왼쪽)'];
  if (L === 1) items.push('선생님 질문 2개 (가운데)');
  else if (L === 2) items.push('선생님 질문 1개 + 빈 점선 칸 (가운데)', '질문판 자리 비워 두기 (오른쪽)');
  else if (L >= 5) items.push('이끎질문 1번 · 3번, 2번은 비워 두기 (가운데)', '줄다리기 줄과 양 끝 (가운데 아래)', '질문판 자리 비워 두기 (오른쪽)');
  else items.push('이끎질문 3개 (가운데)', '줄다리기 줄과 양 끝 (가운데 아래)', '질문판 자리 비워 두기 (오른쪽)');
  items.push('지금 할 일 3줄 (아래)');
  const done = items.filter(t => ui.checks[t]).length;
  box.append(h('h3', {text:'쉬는 시간에 칠판에 쓸 것 · ' + done + '/' + items.length}));
  const ul = h('ul');
  items.forEach((t, i) => {
    const id = 'ck' + i;
    const cb = h('input', {type:'checkbox', id: id});
    cb.checked = !!ui.checks[t];
    cb.addEventListener('change', () => { ui.checks[t] = cb.checked; renderChecklist(ui.viewLevel); });
    ul.append(h('li', {class: ui.checks[t] ? 'done' : ''}, h('label', {for: id}, cb, h('span', {text: t}))));
  });
  box.append(ul);
}

/* ---------- 렌더: 준비 ---------- */
function syncPrep(L, q){
  $('#egNote').hidden = !draft.example;
  $('#titleHint').textContent = (draft.title || '').trim() ? HINTS[q.tk] : '';
  $('#rowKind').hidden = L < 4;
  $('#rowSideA').hidden = L < 3;
  $('#rowSideB').hidden = L < 3;
  $('#row-q3').hidden = L < 3;
  $('#lab-q1').textContent = L <= 2 ? '③ 함께 읽기 질문' : '③ 이끎질문 1 · 확인';
  $('#lab-q2').textContent = L === 1 ? '④ 선생님 질문 (가운데)' : L === 2 ? '④ 선생님 질문 (가운데 위)' : '④ 이끎질문 2 · 이해';
  const sd = SIDES[draft.nameKind] || SIDES.case;
  $('#f-sideA').placeholder = sd[0];
  $('#f-sideB').placeholder = sd[1];
  ['core', 'q1', 'q2', 'q3'].forEach(k => {
    const ta = $('#q-' + k);
    const over = draft.over[k] != null && draft.over[k].trim();
    if (document.activeElement !== ta) ta.value = q[k];
    const act = ta.parentElement.querySelector('.qact');
    act.textContent = '';
    if (over) act.append(h('button', {type:'button', text:'자동 문장으로', onclick: () => { delete draft.over[k]; saveDraft(); refresh(); }}));
    else act.append(h('span', {class:'tag', text:'자동'}));
  });
}

/* ---------- 렌더: 진행 ---------- */
let tickHandle = null;
function elapsed(){ const t = ui.timer; return t.before + (t.running ? (Date.now() - t.startedAt) : 0); }
function updateClock(){
  const el = $('#clock'); if (!el) return;
  const st = ui.lastSteps && ui.lastSteps[ui.step]; if (!st) return;
  const left = st.min * 60 - elapsed() / 1000;
  el.textContent = (left < 0 ? '+' : '') + fmt(left);
  el.classList.toggle('over', left < 0);
  const note = $('#clocknote');
  if (note) note.textContent = left < 0 ? '시간이 지났어요' : ui.timer.running ? '진행 중' : (ui.timer.before > 0 ? '잠깐 멈춤' : st.min + '분');
}
function startTick(){ if (!tickHandle) tickHandle = setInterval(updateClock, 250); }
function stopTick(){ clearInterval(tickHandle); tickHandle = null; }
function resetTimer(run){ ui.timer = {running: !!run, startedAt: Date.now(), before: 0}; if (run) startTick(); }
function toggleTimer(){
  const t = ui.timer;
  if (t.running){ t.before += Date.now() - t.startedAt; t.running = false; }
  else { t.startedAt = Date.now(); t.running = true; startTick(); keepAwake(); }
  renderRun();
  sendTvSoon();
}
function goStep(i, keepRunning){
  const n = ui.lastSteps.length;
  ui.step = Math.max(0, Math.min(n - 1, i));
  resetTimer(keepRunning && ui.timer.running);
  refresh();
}
function resetRun(){ ui.mode = 'prep'; ui.step = 0; ui.fb = null; resetTimer(false); stopTick(); letSleep(); }

function renderRun(){
  const box = $('#run'); box.textContent = '';
  const steps = ui.lastSteps;
  if (ui.mode === 'feedback') return renderFeedback(box);
  if (ui.mode === 'summary') return renderSummary(box);
  const st = steps[ui.step];
  const pills = h('div', {class:'pills', role:'tablist', 'aria-label':'단계'});
  steps.forEach((s, i) => pills.append(h('button', {type:'button', class: i === ui.step ? 'now' : i < ui.step ? 'past' : '', 'aria-label': s.no + ' ' + s.name + ' ' + s.min + '분', text: s.no, onclick: () => goStep(i, true)})));
  const total = steps.reduce((a, s) => a + s.min, 0);
  const before = steps.slice(0, ui.step).reduce((a, s) => a + s.min, 0);

  const card = h('div', {class:'stepcard'},
    h('div', {class:'stephead'},
      h('div', null,
        h('h2', {text: st.no + ' ' + st.name}),
        h('div', {class:'min', text: st.min + '분 · ' + before + '~' + (before + st.min) + '분 / ' + total + '분'}),
        st.routine ? h('span', {class:'routine' + (st.swapped ? ' sw' : ''), text: (st.swapped ? '바꿔 끼운 루틴 · ' : '루틴 · ') + st.routine}) : null),
      h('div', {class:'timer'}, h('div', {class:'clock', id:'clock', role:'timer', 'aria-live':'off', text: fmt(st.min * 60)}), h('div', {class:'clocknote', id:'clocknote'}))),
    h('div', {class:'say'}, h('h4', {text:'이렇게 말해요'}), st.say.map(s => h('p', {text: s}))),
    h('div', {class:'kv'},
      h('div', null, h('h4', {text:'칠판'}), h('p', {text: st.board})),
      h('div', null, h('h4', {text:'아이들 노트'}), h('p', {text: st.note}))),
    st.tip ? h('p', {class:'tip', text: st.tip}) : null);

  const last = ui.step === steps.length - 1;
  const btns = h('div', {class:'runbtns'},
    h('button', {class:'btn', type:'button', text: ui.timer.running ? '잠깐 멈춤' : (ui.timer.before > 0 ? '다시 시작' : '시간 재기'), onclick: toggleTimer}),
    ui.step > 0 ? h('button', {class:'btn', type:'button', text:'← 이전', onclick: () => goStep(ui.step - 1, true)}) : null,
    last
      ? h('button', {class:'btn primary grow', type:'button', text:'수업 마침', onclick: () => { ui.mode = 'feedback'; stopTick(); ui.timer.running = false; letSleep(); refresh(); }})
      : h('button', {class:'btn primary grow', type:'button', text:'다음: ' + steps[ui.step + 1].no + ' ' + steps[ui.step + 1].name + ' →', onclick: () => goStep(ui.step + 1, true)}));
  box.append(pills, card, btns);
  updateClock();
}
function renderFeedback(box){
  const mk = (cls, key, label, sub) => h('button', {class: cls, type:'button', onclick: () => record(key)}, h('span', {text: label}), h('small', {text: sub}));
  box.append(h('div', {class:'fb'},
    h('h2', {text:'오늘 아이들은 어땠나요?'}),
    h('p', {class:'empty', text:'한 번만 누르면 기록돼요. 벅찼던 날은 진행 칸을 세지 않아요.'}),
    h('div', {class:'fbbtns'},
      mk('g', 'easy', '쉬웠어요', '한 칸 채워요'),
      mk('m', 'ok', '딱 좋았어요', '한 칸 채워요'),
      mk('x', 'hard', '벅찼어요', '이 단계를 한 번 더')),
    h('div', {class:'runbtns'},
      h('button', {class:'btn quiet', type:'button', text:'← 마지막 단계로 돌아가기', onclick: () => { ui.mode = 'run'; refresh(); }}))));
}
function record(fbKey){
  const L = ui.viewLevel;
  const counts = fbKey !== 'hard' && L >= state.level;
  state.total += 1;
  if (counts) state.points += 1;
  state.history.push({d: isoDate(), s: draft.subj, t: (draft.title || '').trim() || '(제목 없이)', n: (draft.name || '').trim(), L: L, fb: fbKey});
  state.history = state.history.slice(-60);
  persist();
  ui.fb = fbKey; ui.mode = 'summary';
  renderAll();
}
function renderSummary(box){
  const info = lv(state.level);
  const msg = ui.fb === 'hard'
    ? '벅찼던 날은 칸을 세지 않아요. 다음 수업도 같은 단계로 해요. 시간이 모자랐다면 ⑤를 손신호 1분으로, ②를 궁금해요 1줄로 줄여 보세요.'
    : info.need ? (isReady() ? '칸이 다 찼어요. 위에서 다음 단계를 열지 정해 주세요.' : '다음 단계까지 ' + Math.max(0, info.need - state.points) + '번 남았어요.') : '마지막 단계예요. 아이들이 질문을 고르는 수업을 이어 가요.';
  box.append(h('div', {class:'summary'},
    h('h2', {class:'lvname', text: state.total + '번째 수업을 기록했어요'}),
    h('p', {text: msg}),
    h('div', {class:'runbtns'},
      h('button', {class:'btn primary big grow', type:'button', text:'다음 수업 준비하기', onclick: newLesson}))));
}
function newLesson(){
  draft.page = ''; draft.title = ''; draft.name = ''; draft.sideA = ''; draft.sideB = ''; draft.link = ''; draft.over = {}; draft.example = false; draft.lessonKind = 'normal';
  tv.link = null;
  ui.checks = {};
  saveDraft(); fillInputs();
  ui.previewing = false; ui.viewLevel = state.level;
  resetRun();
  renderAll();
  $('#f-page').focus();
}

/* ---------- 렌더: 단계 지도 ---------- */
function renderLevels(){
  const box = $('#levels'); box.textContent = '';
  LEVELS.forEach(info => {
    const n = info.n, cur = n === state.level;
    const status = cur ? h('span', {class:'badge cur', text:'지금 단계'}) : n < state.level ? h('span', {class:'badge ok', text:'지나온 단계'}) : h('span', {class:'badge', text:'아직 잠김'});
    const act = h('div', {class:'act'});
    if (!cur) act.append(h('button', {class:'btn', type:'button', text: ui.previewing && ui.viewLevel === n ? '미리 보는 중' : '미리 보기', disabled: ui.previewing && ui.viewLevel === n,
      onclick: () => { ui.previewing = true; ui.viewLevel = n; resetRun(); renderAll(); window.scrollTo({top:0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'}); }}));
    if (n < state.level){
      if (ui.lowerAsk === n){
        act.append(h('button', {class:'btn danger', type:'button', text:'낮추기', onclick: () => { state.level = n; state.points = 0; state.snoozeAt = -1; ui.lowerAsk = 0; ui.previewing = false; ui.viewLevel = n; persist(); resetRun(); renderAll(); }}),
          h('button', {class:'btn quiet', type:'button', text:'취소', onclick: () => { ui.lowerAsk = 0; renderLevels(); }}));
      } else act.append(h('button', {class:'btn quiet', type:'button', text:'이 단계로 낮추기', onclick: () => { ui.lowerAsk = n; renderLevels(); }}));
    }
    box.append(h('article', {class:'lv' + (cur ? ' cur' : '') + (n > state.level ? ' lock' : '')},
      h('div', {class:'n', text: n + '단계' + (info.need ? ' · 수업 ' + info.need + '번' : '')}),
      h('h3', {text: info.name}),
      status,
      h('ul', null, info.opens.map(t => h('li', {text: t}))),
      act));
  });
}
const FBLABEL = {easy:'쉬웠어요', ok:'딱 좋았어요', hard:'벅찼어요'};
function renderHistory(){
  const ul = $('#hist'); ul.textContent = '';
  const items = state.history.slice(-6).reverse();
  if (!items.length){
    const li = h('li', null, h('p', {class:'empty', text:'아직 기록이 없어요. 수업을 마치면 여기에 쌓여요.'}));
    li.style.gridTemplateColumns = '1fr';
    ul.append(li); return;
  }
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

/* ---------- 교실 TV: 패드가 Firestore에 쓰고, 교실 컴퓨터가 읽어요 ---------- */
let isTv = false, tvSendTimer = null, tvErr = '', lastSentKey = '', tvSeenAt = 0, heartbeat = null;
const tv = {blank:false, link:null};
function safeUrl(u){ u = String(u || '').trim(); return (/^https?:\/\/\S+$/i.test(u) && u.length <= 1500) ? u : null; }
function tvConnected(){ return !!tvSeenAt && Date.now() - tvSeenAt < 150000; }
function tvPayload(){
  const steps = ui.lastSteps || [], st = ui.mode === 'run' ? steps[ui.step] : null;
  const running = !!(st && ui.timer.running);
  return {v:1, subj: draft.subj, page: (draft.page || '').trim(), core: ui.lastQ ? ui.lastQ.core : '',
    step: st ? {no: st.no, name: st.name, min: st.min} : null,
    endsAt: running ? Math.round(ui.timer.startedAt + st.min * 60000 - ui.timer.before) : null,
    rem: st && !running ? Math.round(st.min * 60 - ui.timer.before / 1000) : null,
    paused: !!(st && !running && ui.timer.before > 0),
    blank: tv.blank, link: tv.link};
}
function sendTv(){
  clearTimeout(tvSendTimer); tvSendTimer = null;
  if (!fb || !tvRef || isTv) return;
  const p = tvPayload();
  const key = JSON.stringify(p);
  if (key === lastSentKey) return;
  lastSentKey = key;
  p.at = Date.now();
  fb.F.setDoc(tvRef, p).catch(() => { lastSentKey = ''; });
}
function sendTvSoon(){ if (!tvRef || isTv) return; clearTimeout(tvSendTimer); tvSendTimer = setTimeout(sendTv, 400); }
function renderTvBox(){
  const conn = $('#tvconn');
  const on = !!me && tvConnected();
  conn.className = 'conn' + (on ? ' on' : '');
  conn.textContent = !configured() ? '설정 전' : !me ? '로그인 필요' : on ? 'TV 연결됨' : '연결 안 됨';
  const ok = !!me && !!tvRef;
  $('#sendLink').disabled = !ok;
  $('#tvBlank').disabled = !ok;
  $('#tvBlank').textContent = tv.blank ? 'TV 화면 켜기' : 'TV 화면 끄기';
  $('#tvShow').disabled = !ok || (!tv.blank && !tv.link);
  const now = $('#tvnow'); now.textContent = '';
  now.hidden = !tv.link;
  if (tv.link) now.append(h('span', null, (ytInfo(tv.link.url) ? 'TV에서 재생 중 ' : 'TV에 띄운 링크 '), h('b', {text: tv.link.url})), h('button', {class:'btn', type:'button', text:'TV에서 내리기', onclick: () => { tv.link = null; sendTv(); renderTvBox(); }}));
  $('#tvhelp').textContent = tvErr ? tvErr
    : !configured() ? '교실 TV 연결은 파이어베이스 설정(config.js)을 마친 뒤에 쓸 수 있어요.'
    : !me ? '구글로 로그인하면 교실 컴퓨터와 이어져요.'
    : on ? '유튜브 링크는 TV에서 바로 재생돼요. 다른 링크는 TV에 노란 ‘열기’ 버튼으로 떠서, TV 도우미가 한 번 눌러 주면 돼요.'
    : '교실 컴퓨터에서 이 주소를 열고 같은 구글 계정으로 로그인한 뒤 ‘이 기기를 TV 화면으로’를 누르세요. 아침에 TV 화면의 ‘전체 화면’을 한 번 눌러 두면 영상이 소리와 함께 바로 재생돼요.';
}

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

let tvData = null, tvAt = 0, tvTick = null, curVideo = '';
function renderTvView(){
  if (!isTv) return;
  $('#tv-signin').hidden = !(fb && !me);
  $('#tv-conn').textContent = !configured() ? '파이어베이스 설정 전' : !me ? '로그인이 필요해요' : (fbError || (tvData ? '패드와 연결됨' : '패드를 기다리는 중'));
  const d = tvData;
  const vbox = $('#tv-video'), vsub = $('#tv-videosub'), a = $('#tv-link');
  if (!d){ vbox.hidden = true; vsub.hidden = true; a.hidden = true; return; }
  $('#tvblack').hidden = !d.blank;
  const page = str(d.page, 40);
  $('#tv-meta').textContent = str(d.subj, 20) + (page ? ' · 교과서 ' + page + '쪽' : '');
  const url = d.link && typeof d.link === 'object' ? safeUrl(d.link.url) : null;
  const yt = url && !d.blank ? ytInfo(url) : null;
  const core = $('#tv-core'); core.textContent = '';
  core.className = 'tvcore' + (url ? ' small' : '');
  core.append(h('span', {class:'tvlabel', text:'핵심질문'}), str(d.core, 400));
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
    vsub.append('재생되지 않으면 ', h('a', {href: url, target:'_blank', rel:'noopener noreferrer', text:'유튜브에서 열기'}), '를 눌러 주세요. 퍼가기를 막아 둔 영상도 이렇게 열어요.');
    vsub.hidden = false;
    a.hidden = true; a.removeAttribute('href');
  } else {
    if (curVideo){ vbox.textContent = ''; curVideo = ''; }
    vbox.hidden = true; vsub.hidden = true;
    if (url && !d.blank){ a.href = url; $('#tv-link-url').textContent = url; a.hidden = false; }
    else { a.hidden = true; a.removeAttribute('href'); }
  }
  const step = d.step && typeof d.step === 'object' ? d.step : null;
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
  if (!fb || !tvRef || unsubTv) return;
  unsubTv = fb.F.onSnapshot(tvRef, s => { tvData = s.exists() ? s.data() : null; tvAt = Date.now(); renderTvView(); }, () => {});
  const beat = () => { if (isTv && seenRef) fb.F.setDoc(seenRef, {at: Date.now()}).catch(() => {}); };
  beat();
  heartbeat = setInterval(beat, 60000);
}
function stopTvListen(){
  if (unsubTv){ unsubTv(); unsubTv = null; }
  clearInterval(heartbeat); heartbeat = null;
}
function enterTv(){
  isTv = true; writeLocal(TVKEY, 1);
  $('.wrap').hidden = true; $('#tvview').hidden = false;
  stopTick(); letSleep();
  if (!tvTick) tvTick = setInterval(renderTvClock, 500);
  startTvListen();
  renderTvView();
}
function exitTv(){
  isTv = false; writeLocal(TVKEY, 0);
  stopTvListen();
  $('.wrap').hidden = false; $('#tvview').hidden = true; $('#tvblack').hidden = true;
  $('#tv-video').textContent = ''; curVideo = '';
  clearInterval(tvTick); tvTick = null; letSleep();
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch (e){}
  renderAll();
}

/* ---------- 묶어서 그리기 ---------- */
function refresh(){
  const L = ui.viewLevel;
  const q = questions(L);
  const steps = buildSteps(L, draft, q);
  ui.lastSteps = steps; ui.lastQ = q;
  if (ui.step >= steps.length) ui.step = steps.length - 1;
  const hot = ui.mode === 'run' ? steps[ui.step].zone : null;
  renderBoard(L, q, steps, hot);
  renderChecklist(L);
  syncPrep(L, q);
  const prep = ui.mode === 'prep';
  $('#prep').hidden = !prep;
  $('#run').hidden = prep;
  $('#tabPrep').setAttribute('aria-selected', String(prep));
  $('#tabRun').setAttribute('aria-selected', String(!prep));
  $('#startBtn').textContent = '수업 시작 · ' + steps.reduce((a, s) => a + s.min, 0) + '분';
  if (!prep) renderRun();
  sendTvSoon();
}
function renderAll(){ renderStatus(); renderLevelbar(); refresh(); renderLevels(); renderHistory(); renderSettings(); renderTvBox(); }

/* ---------- 입력 ---------- */
function fillInputs(){
  $('#f-subj').value = draft.subj;
  $('#f-page').value = draft.page || '';
  $('#f-title').value = draft.title || '';
  $('#f-name').value = draft.name || '';
  $('#f-sideA').value = draft.sideA || '';
  $('#f-sideB').value = draft.sideB || '';
  $('#f-link').value = draft.link || '';
  document.querySelectorAll('input[name=nk]').forEach(r => { r.checked = r.value === draft.nameKind; });
  document.querySelectorAll('input[name=lk]').forEach(r => { r.checked = r.value === draft.lessonKind; });
}
function bindField(id, key){
  $(id).addEventListener('input', e => { draft[key] = e.target.value; draft.example = false; saveDraft(); refresh(); });
}
bindField('#f-page', 'page'); bindField('#f-title', 'title'); bindField('#f-name', 'name');
bindField('#f-sideA', 'sideA'); bindField('#f-sideB', 'sideB');
$('#f-subj').addEventListener('change', e => { draft.subj = e.target.value; draft.example = false; saveDraft(); refresh(); });
document.querySelectorAll('input[name=nk]').forEach(r => r.addEventListener('change', () => { if (r.checked){ draft.nameKind = r.value; draft.example = false; saveDraft(); refresh(); } }));
document.querySelectorAll('input[name=lk]').forEach(r => r.addEventListener('change', () => { if (r.checked){ draft.lessonKind = r.value; saveDraft(); refresh(); } }));
['core', 'q1', 'q2', 'q3'].forEach(k => {
  const ta = $('#q-' + k);
  ta.addEventListener('input', () => {
    const g = generate(draft, ui.viewLevel)[k];
    if (ta.value.trim() && ta.value.trim() !== g) draft.over[k] = ta.value; else delete draft.over[k];
    draft.example = false; saveDraft(); refresh();
  });
  ta.addEventListener('blur', () => refresh());
});
$('#clearEg').addEventListener('click', () => newLesson());
$('#f-students').addEventListener('change', e => {
  state.students = Math.min(40, Math.max(2, parseInt(e.target.value, 10) || 22));
  persist(); renderLevelbar(); renderSettings();
});
$('#startBtn').addEventListener('click', () => { ui.mode = 'run'; ui.step = 0; resetTimer(true); keepAwake(); refresh(); $('#run').scrollIntoView({block:'nearest'}); });
$('#tabPrep').addEventListener('click', () => { if (ui.mode !== 'prep'){ ui.mode = 'prep'; stopTick(); ui.timer.running = false; letSleep(); refresh(); } });
$('#tabRun').addEventListener('click', () => { if (ui.mode === 'prep'){ ui.mode = 'run'; resetTimer(false); refresh(); } });
document.addEventListener('keydown', e => {
  if (ui.mode !== 'run' || isTv) return;
  const tag = (e.target && e.target.tagName) || '';
  if (/INPUT|TEXTAREA|SELECT/.test(tag)) return;
  if (e.key === 'ArrowRight' && ui.step < ui.lastSteps.length - 1){ goStep(ui.step + 1, true); e.preventDefault(); }
  if (e.key === 'ArrowLeft' && ui.step > 0){ goStep(ui.step - 1, true); e.preventDefault(); }
});

$('#authBtn').addEventListener('click', () => { if (me) signOutNow(); else signIn(); });
$('#tv-signin').addEventListener('click', signIn);
$('#f-link').addEventListener('input', e => { draft.link = e.target.value; saveDraft(); if (tvErr){ tvErr = ''; renderTvBox(); } });
$('#sendLink').addEventListener('click', () => {
  const u = safeUrl($('#f-link').value);
  if (!u){ tvErr = 'https:// 로 시작하는 주소를 붙여 넣어 주세요.'; renderTvBox(); return; }
  tvErr = ''; tv.link = {url: u}; tv.blank = false; sendTv(); renderTvBox();
});
$('#tvShow').addEventListener('click', () => { tv.link = null; tv.blank = false; sendTv(); renderTvBox(); });
$('#tvBlank').addEventListener('click', () => { tv.blank = !tv.blank; sendTv(); renderTvBox(); });
$('#toTv').addEventListener('click', enterTv);
$('#tv-exit').addEventListener('click', exitTv);
$('#tv-full').addEventListener('click', () => {
  try { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e){}
  keepAwake();
});
$('#tvblack').addEventListener('click', () => { $('#tvblack').hidden = true; });
window.addEventListener('hashchange', () => { if (location.hash === '#tv' && !isTv) enterTv(); });
setInterval(() => { if (!isTv && me) renderTvBox(); }, 30000);

/* 수업 중·TV 화면에서는 화면이 꺼지지 않게 (안 되면 그냥 넘어가요) */
let wake = null;
async function keepAwake(){ try { if ('wakeLock' in navigator && !wake){ wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e){ wake = null; } }
function letSleep(){ try { if (wake) wake.release(); } catch (e){} wake = null; }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && (isTv || (ui.mode === 'run' && ui.timer.running))) keepAwake(); });

/* ---------- 시작 ---------- */
fillInputs();
renderAll();
if (location.hash === '#tv' || new URLSearchParams(location.search).has('tv') || readLocal(TVKEY) === 1) enterTv();
initFirebase();
