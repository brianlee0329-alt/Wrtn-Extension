// ==UserScript==
// @name         크랙 모닝콜
// @namespace    https://crack.wrtn.ai/
// @version      2.0.10
// @description  Radiosonde IGX 서버 점수 뷰어 + 알림 감지 + 요약 메모리 감지 (알림 패널 통합 빌드)
// @match        https://crack.wrtn.ai/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==

'use strict';

// ════════════════════════════════════════════════════════════
//  ① 상수 · RS 모델 목록
// ════════════════════════════════════════════════════════════
const RS_URL = 'https://rs.igx.kr/';
const RS_POLL_MS = 5 * 60 * 1000;
const RS_GOOD_TPS = 20;
const RS_WARN_TPS = 10;

const RS_MODELS = [
  // Anthropic
  { slug: 'claude-fable-5.1', label: 'Claude Fable 5.1', short: 'F5.1'},
  { slug: 'claude-opus-5.5', label: 'Claude Opus 5.5', short: 'O5.5'},
  { slug: 'claude-opus-5', label: 'Claude Opus 5', short: 'O5'},
  { slug: 'claude-opus-4.8', label: 'Claude Opus 4.8', short: 'O4.8'},
  { slug: 'claude-opus-4.7', label: 'Claude Opus 4.7', short: 'O4.7'},
  { slug: 'claude-opus-4.6', label: 'Claude Opus 4.6', short: 'O4.6'},
  { slug: 'claude-sonnet-5', label: 'Claude Sonnet 5', short: 'S5'},
  // Google
  { slug: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', short: 'G3.1'},
  { slug: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', short: 'G2.5'},
  { slug: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', short: 'G3.8F' },
  { slug: 'gemini-3.7-flash', label: 'Gemini 3.7 Flash', short: 'G3.7F' },
  { slug: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', short: 'G3.6F' },
  { slug: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', short: 'G3.5F' },
  { slug: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash Lite', short: 'G3.5L' },
  // OpenAI
  { slug: 'gpt-6-sol', label: 'GPT 6 Sol', short: 'GPT-6S' },
  { slug: 'gpt-6-luna', label: 'GPT 6 Luna', short: 'GPT-6L' },
  { slug: 'gpt-5.6-sol', label: 'GPT 5.6 Sol', short: 'GPT-5S' },
  { slug: 'gpt-5.6-terra', label: 'GPT 5.6 Terra', short: 'GPT-5T' },
  { slug: 'gpt-5.6-luna', label: 'GPT 5.6 Luna', short: 'GPT-5L' },
];

// ════════════════════════════════════════════════════════════
//  ② 설정 (GM 영속)
// ════════════════════════════════════════════════════════════
const CFG = {
  THRESH    : 'mcal:thresh',
  WATCHED   : 'mcal:watched',
  GRAPH     : 'mcal:graph',
  MIN_SCORE : 'mcal:minscore',
  BEEP      : 'mcal:beep',
  VOL       : 'mcal:vol',       // 비프음 볼륨 0.05–1.0
};

let cfgThresh    = GM_getValue(CFG.THRESH,     0.20);
let cfgGraph     = GM_getValue(CFG.GRAPH,      true);
let cfgMinScore  = GM_getValue(CFG.MIN_SCORE,  0);
let cfgBeep      = GM_getValue(CFG.BEEP,       true);
let cfgVol       = GM_getValue(CFG.VOL,        0.15);
let cfgWatched   = new Set(
  JSON.parse(GM_getValue(CFG.WATCHED, 'null')) ?? RS_MODELS.map(m => m.slug)
);

function cfgSave() {
  GM_setValue(CFG.THRESH,     cfgThresh);
  GM_setValue(CFG.GRAPH,      cfgGraph);
  GM_setValue(CFG.MIN_SCORE,  cfgMinScore);
  GM_setValue(CFG.BEEP,       cfgBeep);
  GM_setValue(CFG.VOL,        cfgVol);
  GM_setValue(CFG.WATCHED,    JSON.stringify([...cfgWatched]));
}

// ════════════════════════════════════════════════════════════
//  ③ 런타임 상태
// ════════════════════════════════════════════════════════════
const rsCache = {};   // { [slug]: { tps, latency, spark[], updatedAt } }
const rsLog   = [];   // 최대 50건
let _badgeOn        = false;
let _panelInjected  = false;
let _curApiTab      = 'models';
let lsemHlActive    = false;

// ════════════════════════════════════════════════════════════
//  ④ 전역 스타일
// ════════════════════════════════════════════════════════════
GM_addStyle(`
/* ──────────── 헤더 토글 ──────────── */
/*
 * 헤더 div(css-16ui5yc)의 Emotion 스타일이 flex 간격을 강제할 수 있으므로
 * justify-content를 inline style로 덮어쓰고(rsInjectNotiPanel 참조),
 * #crs-hdr-ext 는 gap만 제어.
 */
#crs-hdr-ext {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  /* margin-left:auto 금지 — 양 끝으로 밀리는 원인 */
}
.crs-sep {
  opacity: 0.30;
  user-select: none;
  /* font-size/color는 부모 상속 */
}
#crs-tab-api {
  background: none;
  border: none;
  cursor: pointer;
  font-size: inherit;     /* 헤더 "알림" 텍스트와 동일 크기 상속 */
  font-weight: 700;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 4px;
  color: #999;
}
#crs-tab-api:hover  { color: #333; background: rgba(0,0,0,0.06); }
#crs-tab-api.crs-active { color: #111; background: rgba(0,0,0,0.09); }

/* ──────────── API 패널 ──────────────
 *
 * [수정 핵심] display 는 JS의 style.display 로만 제어한다.
 * CSS에 display:flex 를 쓰면 [hidden] 속성을 ID 셀렉터 우선순위로
 * 덮어써서 항상 보이게 되는 버그가 있었음 → 기본값은 display:none.
 *
 * rsPane 은 notiWrap 의 형제(panel 의 직접 자식)로 삽입하고,
 * API 열릴 때: rsPane.style.display='flex', notiWrap.style.display='none'
 * API 닫힐 때: rsPane.style.display='none', notiWrap.style.display=''
 *
 * panel이 flex-column 이므로 flex:1 이 나머지 공간을 채움.
 */
#crs-api-pane {
  display: none;          /* 기본 숨김 — JS로만 바꿀 것 */
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

/* ──────────── 서브 탭 ──────────── */
#crs-api-tabs {
  display: flex;
  gap: 2px;
  padding: 8px 14px 6px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0,0,0,0.10);
}
#crs-api-tabs button {
  background: none; border: none; cursor: pointer;
  font-size: 12px; padding: 4px 10px; border-radius: 4px;
  color: #888; font-weight: 500;
}
#crs-api-tabs button.crs-at-on { background: rgba(0,0,0,0.08); color: #111; }

/* ──────────── API 본문 ──────────── */
#crs-api-body {
  flex: 1;
  overflow-y: auto;
  padding: 10px 14px;
  font-size: 12px;
  line-height: 1.7;
}

/* ──────────── 모델 행 ──────────── */
.crs-mr {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 0; border-bottom: 1px solid rgba(0,0,0,0.05);
}
.crs-mr-label { flex: 1; font-size: 11.5px; color: #444; }
.crs-mr-stat {
  white-space: nowrap; font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.crs-mr-stat.g { color: #0a9f6e; }
.crs-mr-stat.w { color: #e07030; }
.crs-mr-stat.b { color: #d03030; }
.crs-mr-stat.e { color: #bbb;    }
.crs-mr canvas { display: block; align-self: center; flex-shrink: 0; }

/* ──────────── 로그 ──────────── */
.crs-le { padding: 3px 0; border-bottom: 1px solid rgba(0,0,0,0.04); font-size: 11.5px; }
.crs-lt { color: #aaa; font-size: 10.5px; margin-right: 4px; }
.crs-lu { color: #0a9f6e; font-weight: 500; }
.crs-ld { color: #d03030; font-weight: 500; }

/* ──────────── 설정 ──────────── */
.crs-cs          { margin-bottom: 14px; }
.crs-cs-label    { font-size: 10.5px; font-weight: 700; color: #999;
                   text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
.crs-cs-row      { display: flex; align-items: center; gap: 8px; margin-bottom: 3px; }
.crs-cs input[type=range] { flex: 1; }
.crs-cs-val      { color: #333; font-size: 12px; min-width: 34px;
                   text-align: right; font-weight: 700; }
.crs-cs-check    { display: flex; align-items: center; gap: 6px;
                   padding: 2px 0; font-size: 11.5px; color: #444;
                   cursor: pointer; line-height: 1.4; }
.crs-cs-check input { cursor: pointer; margin: 0; }
#crs-cfg-models  { display: grid; grid-template-columns: 1fr 1fr;
                   gap: 1px 6px; max-height: 200px; overflow-y: auto; padding: 2px 0; }
.crs-cs-note     { color: #bbb; font-size: 10.5px; line-height: 1.5; margin-top: 3px; }

/* ──────────── 배지 ──────────── */
#crs-badge {
  position: absolute; top: 2px; right: 2px;
  width: 14px; height: 14px; border-radius: 50%;
  background: #e03030; color: #fff;
  font-size: 9px; font-weight: 700; line-height: 1;
  display: flex; align-items: center; justify-content: center;
  pointer-events: none;
  animation: crs-blink 2.4s step-end infinite;
}
#crs-badge::after { content: '!'; }
@keyframes crs-blink { 0%,100%{opacity:1} 50%{opacity:.25} }

/* ──────────── LSEM 하이라이트 ──────────── */
.crs-lsem-hl {
  background: rgba(90,140,220,0.35) !important;
  border-radius: 6px;
  transition: background 0.4s;
}
`);

// ════════════════════════════════════════════════════════════
//  ⑤ RS: fetch + 파싱
// ════════════════════════════════════════════════════════════
function rsExtractProviderObj(html) {
  const mi = html.indexOf('data:{providers:');
  if (mi === -1) return null;
  const s = mi + 5;
  let depth = 0, inStr = false, i = s;
  while (i < html.length) {
    const ch = html[i];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '"')  inStr = false;
    } else {
      if (ch === '"')  inStr = true;
      else if (ch === '{') depth++;
      else if (ch === '}') { if (--depth === 0) { i++; break; } }
    }
    i++;
  }
  return html.slice(s, i);
}

function rsEvalObj(js) {
  try { return new Function('return (' + js + ')')(); } catch { return null; }
}

function rsFetchPage() {
  return new Promise((res, rej) => {
    GM_xmlhttpRequest({
      method: 'GET', url: RS_URL, timeout: 20_000,
      onload: r => res(r.responseText),
      onerror: rej, ontimeout: rej,
    });
  });
}

/** 최근 5건(정상) 평균 TPS·latency + 스파크라인용 최근 30건 TPS
 *  score 는 rsExtractScores() 가 HTML 카드에서 직접 읽어 별도 주입.
 */
function rsCompute(stats) {
  const ok = stats.filter(s => s.failure === 0 && typeof s.tps === 'number' && !isNaN(s.tps));
  const r5  = ok.slice(-5);
  if (!r5.length) return null;
  const avgTps = r5.reduce((a, s) => a + s.tps, 0) / r5.length;
  return {
    tps    : +avgTps.toFixed(1),
    latency: Math.round(r5.reduce((a, s) => a + s.latency, 0) / r5.length),
    spark  : ok.slice(-30).map(s => s.tps),
  };
}

/**
 * 렌더링된 HTML 카드에서 모델별 실제 점수 추출.
 *   <span class="card-score-data svelte-...">81</span>  → 0–100 정수
 * 데이터 블롭의 model: 순서와 카드 렌더 순서가 일치함을 이용해 zip.
 */
function rsExtractScores(html) {
  const slugs  = [...html.matchAll(/model:"([^"]+)"/g)].map(m => m[1]);
  const scores = [...html.matchAll(/card-score-data[^>]*?>(\d+)<\/span>/g)].map(m => +m[1]);
  const map = {};
  slugs.forEach((s, i) => { if (scores[i] !== undefined) map[s] = scores[i]; });
  return map;                // { slug: score(0-100), ... }
}

function rsTpsClass(tps) {
  return tps >= RS_GOOD_TPS ? 'g' : tps >= RS_WARN_TPS ? 'w' : 'b';
}

// ════════════════════════════════════════════════════════════
//  ⑥ 배지
// ════════════════════════════════════════════════════════════
function rsBellBtn() {
  return document.querySelector('button.size-10.rounded.relative')
      || document.querySelector('[class*="notification-btn"],[aria-label*="알림"]')
      || null;
}
function rsAddBadge() {
  if (_badgeOn) return;
  const btn = rsBellBtn();
  if (!btn || btn.querySelector('#crs-badge')) return;
  btn.appendChild(Object.assign(document.createElement('span'), { id: 'crs-badge' }));
  _badgeOn = true;
}
function rsClearBadge() {
  document.getElementById('crs-badge')?.remove();
  _badgeOn = false;
}

// ════════════════════════════════════════════════════════════
//  ⑦ RS: 알림 + 폴링
// ════════════════════════════════════════════════════════════
function rsFireAlert(info, oldTps, newTps, score, prevScore) {
  rsLog.unshift({
    time : new Date().toLocaleTimeString('ko-KR', { hour:'2-digit', minute:'2-digit' }),
    slug : info.slug, label: info.label,
    old  : oldTps, cur: newTps, drop: score < prevScore,
    score, prevScore,
  });
  if (rsLog.length > 50) rsLog.length = 50;
  wdogTrigger();   // 로그 변동 = 배지 + 비프음
  const pane = document.getElementById('crs-api-pane');
  if (pane && pane.style.display === 'flex' && _curApiTab === 'log') rsRenderLog();
}

async function rsPoll() {
  let html;
  try { html = await rsFetchPage(); }
  catch (e) { console.warn('[MCAL] RS fetch 실패:', e); return; }

  const jsStr = rsExtractProviderObj(html);
  if (!jsStr) { console.warn('[MCAL] RS 블롭 추출 실패'); return; }
  const data = rsEvalObj(jsStr);
  if (!data?.statistics) { console.warn('[MCAL] RS 파싱 실패'); return; }

  const scoreMap = rsExtractScores(html);

  for (const grp of data.statistics) {
    for (const m of (grp.models ?? [])) {
      const info = RS_MODELS.find(r => r.slug === m.model);
      if (!info) continue;
      const stat = rsCompute(m.statistics ?? []);
      if (!stat) continue;

      const score = scoreMap[info.slug] ?? null;
      const prev  = rsCache[info.slug];
      rsCache[info.slug] = { ...stat, score, updatedAt: Date.now() };

      const prevScore = prev?.score ?? null;

      if (prev && cfgWatched.has(info.slug)) {
        if (score !== null && prevScore !== null) {
          // [핵심 수정] 분모를 prevScore 가 아닌 100 으로 고정.
          // (prevScore||1) 사용 시 저점수 모델(0–10점)에서 분모가 극소화돼
          // 사소한 변화도 수백%로 부풀려 항상 발화하는 버그.
          // 100 으로 나누면 cfgThresh=0.10 이 "10포인트 이상 변화" 의미.
          const scoreAbsDelta = Math.abs(score - prevScore);
          const deltaAlert = scoreAbsDelta / 100 >= cfgThresh;
          const dropAlert  = cfgMinScore > 0
            && score    <  cfgMinScore
            && prevScore >= cfgMinScore;
          if (deltaAlert || dropAlert) {
            rsFireAlert(info, prev.tps, stat.tps, score, prevScore);
          }
        }
      }
    }
  }

  const pane = document.getElementById('crs-api-pane');
  if (pane && pane.style.display === 'flex' && _curApiTab === 'models') rsRenderModels();
}

// ════════════════════════════════════════════════════════════
//  ⑧ 알림 패널 주입
// ════════════════════════════════════════════════════════════
function rsNotiPanelEl() {
  return document.querySelector('div[width="375px"][height="700px"]') ?? null;
}

function rsInjectNotiPanel() {
  if (_panelInjected) return;
  const panel = rsNotiPanelEl();
  if (!panel) return;
  if (panel.querySelector('#crs-tab-api')) { _panelInjected = true; return; }

  /**
   * DOM 구조:
   *   panel  div[width="375px"][height="700px"]   ← flex-column
   *     [0]  header  div.css-16ui5yc              ← <p>알림</p> 포함
   *     [1]  notiWrap div.css-jypyk8              ← tablist + 알림 목록
   *
   * rsPane을 panel의 직접 자식(notiWrap의 형제)으로 추가.
   * 전환은 display style로만 — hidden 속성은 CSS 우선순위 충돌로 사용 불가.
   */
  const header   = panel.children[0];
  const notiWrap = panel.children[1];
  if (!header || !notiWrap) return;
  _panelInjected = true;

  // 헤더 레이아웃: 기존 Emotion 스타일 위에 flex + 근접 배치 강제
  header.style.cssText += [
    'display:flex',
    'align-items:center',
    'justify-content:flex-start',   // ← 양 끝 분리 방지
    'gap:6px',
  ].join(';') + ';';

  const ext = document.createElement('div');
  ext.id = 'crs-hdr-ext';
  ext.innerHTML = '<span class="crs-sep">|</span><button id="crs-tab-api">API</button>';
  header.appendChild(ext);

  // RS 패널 — panel 직속 자식, notiWrap 형제
  const rsPane = document.createElement('div');
  rsPane.id = 'crs-api-pane';
  // display:none 은 CSS 기본값. JS에서만 바꿈.
  rsPane.innerHTML = `
    <div id="crs-api-tabs">
      <button class="crs-at-on" data-t="models">모델</button>
      <button data-t="log">로그</button>
      <button data-t="settings">설정</button>
    </div>
    <div id="crs-api-body"></div>
  `;
  panel.appendChild(rsPane);

  const apiBtn = document.getElementById('crs-tab-api');

  function openApi() {
    rsPane.style.display   = 'flex';
    notiWrap.style.display = 'none';
    apiBtn.classList.add('crs-active');
    rsClearBadge();
    rsRenderTab(_curApiTab);
  }
  function closeApi() {
    rsPane.style.display   = 'none';
    notiWrap.style.display = '';
    apiBtn.classList.remove('crs-active');
  }

  apiBtn.addEventListener('click', e => {
    e.stopPropagation();
    rsPane.style.display === 'flex' ? closeApi() : openApi();
  });

  document.getElementById('crs-api-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-t]');
    if (!btn) return;
    _curApiTab = btn.dataset.t;
    document.querySelectorAll('#crs-api-tabs [data-t]')
      .forEach(b => b.classList.toggle('crs-at-on', b.dataset.t === _curApiTab));
    rsRenderTab(_curApiTab);
  });

  new MutationObserver(() => {
    if (!document.contains(panel)) _panelInjected = false;
  }).observe(document.body, { childList: true, subtree: true });
}

// ════════════════════════════════════════════════════════════
//  ⑨ 탭 렌더링
// ════════════════════════════════════════════════════════════
function rsRenderTab(tab) {
  if (tab === 'models')   rsRenderModels();
  if (tab === 'log')      rsRenderLog();
  if (tab === 'settings') rsRenderSettings();
}

// ─── 모델 탭 ───────────────────────────────────────────────
function rsDrawSparkline(canvas, spark) {
  if (!spark?.length) return;
  const W = canvas.width, H = canvas.height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const min = Math.min(...spark), max = Math.max(...spark);
  const rng = max - min || 0.1;
  ctx.strokeStyle = '#0a9f6e';
  ctx.lineWidth   = 1.2;
  ctx.beginPath();
  spark.forEach((v, i) => {
    const x = (i / Math.max(spark.length - 1, 1)) * W;
    const y = H - ((v - min) / rng) * (H - 2) - 1;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function rsRenderModels() {
  const body = document.getElementById('crs-api-body');
  if (!body) return;

  const frag = document.createDocumentFragment();
  for (const m of RS_MODELS) {
    const c   = rsCache[m.slug];
    const row = document.createElement('div');
    row.className = 'crs-mr';
    if (!cfgWatched.has(m.slug)) row.style.opacity = '0.40';

    const lbl = document.createElement('span');
    lbl.className   = 'crs-mr-label';
    lbl.textContent = m.label;
    row.appendChild(lbl);

    if (c) {
      if (cfgGraph && c.spark?.length > 1) {
        const cv = document.createElement('canvas');
        cv.width = 50; cv.height = 18;
        row.appendChild(cv);
        requestAnimationFrame(() => rsDrawSparkline(cv, c.spark));
      }
      const st = document.createElement('span');
      st.className = 'crs-mr-stat ' + rsTpsClass(c.tps);
      st.innerHTML  = `<b>${c.score}</b>&thinsp;<span style="opacity:.55;font-size:10.5px">${c.tps}&nbsp;tok/s&nbsp;·&nbsp;${(c.latency/1000).toFixed(1)}s</span>`;
      row.appendChild(st);
    } else {
      const st = document.createElement('span');
      st.className   = 'crs-mr-stat e';
      st.textContent = '—';
      row.appendChild(st);
    }
    frag.appendChild(row);
  }

  const vals = Object.values(rsCache);
  const ts   = vals.length
    ? new Date(Math.max(...vals.map(c => c.updatedAt)))
        .toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const foot = document.createElement('div');
  foot.style.cssText = 'margin-top:8px;color:#bbb;font-size:10.5px;';
  foot.textContent   = `마지막 갱신 ${ts} · 5분 간격`;
  frag.appendChild(foot);

  body.replaceChildren(frag);
}

// ─── 로그 탭 ───────────────────────────────────────────────
function rsRenderLog() {
  const body = document.getElementById('crs-api-body');
  if (!body) return;
  if (!rsLog.length) {
    body.innerHTML = '<div style="color:#bbb;padding:8px 0">아직 변화 없음</div>';
    return;
  }
  body.innerHTML = rsLog.map(e => {
    const sc = (e.prevScore != null && e.score != null)
      ? `&thinsp;<span style="opacity:.55">(${e.prevScore}→${e.score}점)</span>` : '';
    return `<div class="crs-le">
      <span class="crs-lt">${e.time}</span>
      <span class="${e.drop ? 'crs-ld' : 'crs-lu'}">
        ${e.drop ? '▼' : '▲'}&nbsp;${e.label}:
        ${e.old}→${e.cur}&nbsp;tok/s${sc}
      </span>
    </div>`;
  }).join('');
}

// ─── 설정 탭 ───────────────────────────────────────────────
function rsRenderSettings() {
  const body = document.getElementById('crs-api-body');
  if (!body) return;

  const threshPct = Math.round(cfgThresh * 100);

  body.innerHTML = `
    <!-- 변화율 임계값 -->
    <div class="crs-cs">
      <div class="crs-cs-label">변화율 알림 임계값</div>
      <div class="crs-cs-row">
        <input type="range" id="crs-sl-thresh" min="5" max="50" step="5" value="${threshPct}">
        <span class="crs-cs-val" id="crs-sl-thresh-val">${threshPct}%</span>
      </div>
      <div class="crs-cs-note">점수(0–100)가 이 값 이상 절대 변화(포인트)할 때 배지를 표시합니다.<br>예: 20% → 20포인트 이상 변화 시 발화.</div>
    </div>

    <!-- 절대 최저 점수 -->
    <div class="crs-cs">
      <div class="crs-cs-label">최저 점수 임계값</div>
      <div class="crs-cs-row">
        <input type="range" id="crs-sl-minscore" min="0" max="100" step="5" value="${cfgMinScore}">
        <span class="crs-cs-val" id="crs-sl-minscore-val">${cfgMinScore || '꺼짐'}</span>
      </div>
      <div class="crs-cs-note">Radiosonde 실제 점수(0–100)가 이 값 아래로 내려가면 배지를 표시합니다. 0 = 비활성.</div>
    </div>

    <!-- 스파크라인 -->
    <div class="crs-cs">
      <div class="crs-cs-label">그래프 표시</div>
      <label class="crs-cs-check">
        <input type="checkbox" id="crs-cb-graph" ${cfgGraph ? 'checked' : ''}>
        모델 탭에 최근 30건 스파크라인 병기
      </label>
    </div>

    <!-- 감시 대상 -->
    <div class="crs-cs">
      <div class="crs-cs-label">감시 대상</div>
      <div id="crs-cfg-models">
        ${RS_MODELS.map(m => `
          <label class="crs-cs-check">
            <input type="checkbox" data-slug="${m.slug}"
              ${cfgWatched.has(m.slug) ? 'checked' : ''}>
            ${m.short}
          </label>`
        ).join('')}
      </div>
      <div class="crs-cs-note" style="margin-top:5px">
        체크 해제된 모델은 변화율 감지에서 제외됩니다 (모델 탭에는 계속 표시).
      </div>
    </div>

    <!-- 알림 설정 -->
    <div class="crs-cs">
      <div class="crs-cs-label">알림 설정</div>
      <label class="crs-cs-check">
        <input type="checkbox" id="crs-cb-beep" ${cfgBeep ? 'checked' : ''}>
        점수 변화·신규 알림 발생 시 비프음
      </label>
      <div class="crs-cs-row" style="margin-top:6px;align-items:center">
        <span style="font-size:11px;color:#888;white-space:nowrap">볼륨</span>
        <input type="range" id="crs-sl-vol" min="5" max="100" step="5"
          value="${Math.round(cfgVol * 100)}" style="flex:1">
        <span class="crs-cs-val" id="crs-sl-vol-val">${Math.round(cfgVol * 100)}%</span>
        <button id="crs-btn-beep-test" style="
          background:rgba(0,0,0,0.07);border:none;cursor:pointer;
          font-size:11px;padding:3px 8px;border-radius:4px;white-space:nowrap;
          color:#333;flex-shrink:0">▶ 미리 듣기</button>
      </div>
      <div class="crs-cs-note" style="margin-top:4px">
        비프음은 페이지 최초 클릭 이후 활성화됩니다. '▶ 미리 듣기'로 직접 잠금 해제 가능.
      </div>
    </div>
  `;

  document.getElementById('crs-sl-thresh').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    document.getElementById('crs-sl-thresh-val').textContent = v + '%';
    cfgThresh = v / 100;
    cfgSave();
  });

  document.getElementById('crs-sl-minscore').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    document.getElementById('crs-sl-minscore-val').textContent = v || '꺼짐';
    cfgMinScore = v;
    cfgSave();
  });

  document.getElementById('crs-cb-graph').addEventListener('change', e => {
    cfgGraph = e.target.checked;
    cfgSave();
  });

  document.getElementById('crs-cfg-models').addEventListener('change', e => {
    const cb = e.target;
    if (!cb.dataset?.slug) return;
    cb.checked ? cfgWatched.add(cb.dataset.slug) : cfgWatched.delete(cb.dataset.slug);
    cfgSave();
  });

  document.getElementById('crs-cb-beep').addEventListener('change', e => {
    cfgBeep = e.target.checked;
    cfgSave();
  });

  document.getElementById('crs-sl-vol').addEventListener('input', e => {
    const v = parseInt(e.target.value);
    document.getElementById('crs-sl-vol-val').textContent = v + '%';
    cfgVol = v / 100;
    cfgSave();
  });

  document.getElementById('crs-btn-beep-test').addEventListener('click', () => {
    wdogBeepPreview();   // 클릭 = 제스처 → AC 잠금 해제 + 즉시 재생
  });
}

// ════════════════════════════════════════════════════════════
//  ⑩ WDOG: 직접 API 폴링 + DOM dot 감시 (이중 방어)
// ════════════════════════════════════════════════════════════
/*
 * 이전 fetch 인터셉트 방식 폐기 이유:
 *   @run-at document-idle 시점엔 플랫폼이 이미 최초 alarm check 를 완료해
 *   타이밍 문제로 첫 응답을 잡을 수 없음.
 *
 * 새 이중 감지 전략:
 *   A) 직접 폴링 — GET crack-api.wrtn.ai/crack-api/alarm?limit=1 (30초마다)
 *      원본 CRCK-WDOG(milkyway0308) 코드에서 확인된 알람 API 구조:
 *        response.data.alarms[0]._id  ← 최신 알람 ID
 *      localStorage 'mcal:wdog:lastId' 와 비교해 신규 감지.
 *      unsafeWindow.fetch + credentials:'include' 로 쿠키 인증 자동 처리.
 *
 *   B) DOM dot 감시 — 플랫폼이 알림 버튼에 추가하는 빨간 점 즉시 감지
 *      <div class="size-2 absolute top-1 right-1 bg-icon_brand rounded-full">
 *      이 요소가 새로 추가되면 즉시 트리거.
 */

const WDOG_ALARM_URL = 'https://crack-api.wrtn.ai/crack-api/alarm?limit=1';
const WDOG_LS_KEY    = 'mcal:wdog:lastId';
const WDOG_MS        = 30_000;

/** Web Audio 비프음
 *
 *  [수정 핵심] 브라우저는 AudioContext 를 사용자 제스처 없이 생성하면
 *  state:'suspended' 으로 잠근다. 비프 호출 시점(폴링 타이머)은 제스처
 *  컨텍스트가 아니므로 그때마다 new AC() 를 만들면 항상 잠겨 무음.
 *
 *  해결: AC 를 스크립트 로드 시점에 1개 생성하고, 최초 사용자
 *  인터랙션(click/keydown/touchstart) 시 resume() 를 한 번 호출해
 *  '잠금 해제' 상태로 전환. 이후 타이머에서 부르는 wdogBeep() 는
 *  state:'running' 인 동일 컨텍스트를 재사용해 정상 재생.
 *
 *  원본 CRCK-WDOG 가 new Audio(url) 를 미리 생성해 두는 것과 같은 원리.
 */
const _wdogAC = (() => {
  try {
    const AC  = unsafeWindow.AudioContext || unsafeWindow.webkitAudioContext;
    const ctx = new AC();
    if (ctx.state === 'suspended') {
      const unlock = () => ctx.resume();
      document.addEventListener('click',      unlock, { once: true, capture: true });
      document.addEventListener('keydown',    unlock, { once: true, capture: true });
      document.addEventListener('touchstart', unlock, { once: true, capture: true });
    }
    return ctx;
  } catch(e) { return null; }
})();

function wdogBeep() {
  if (!cfgBeep) return;
  if (!_wdogAC || _wdogAC.state !== 'running') return;
  try {
    const osc = _wdogAC.createOscillator();
    const g   = _wdogAC.createGain();
    osc.connect(g); g.connect(_wdogAC.destination);
    osc.type = 'sine'; osc.frequency.value = 880;
    g.gain.setValueAtTime(cfgVol, _wdogAC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _wdogAC.currentTime + 0.28);
    osc.start(); osc.stop(_wdogAC.currentTime + 0.28);
  } catch(e) {}
}

/** 미리 듣기 — 클릭 자체가 제스처이므로 AC 잠금도 해제 */
function wdogBeepPreview() {
  if (!_wdogAC) return;
  _wdogAC.resume().then(() => {
    const osc = _wdogAC.createOscillator();
    const g   = _wdogAC.createGain();
    osc.connect(g); g.connect(_wdogAC.destination);
    osc.type = 'sine'; osc.frequency.value = 880;
    g.gain.setValueAtTime(cfgVol, _wdogAC.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, _wdogAC.currentTime + 0.28);
    osc.start(); osc.stop(_wdogAC.currentTime + 0.28);
  }).catch(() => {});
}

function wdogTrigger() { rsAddBadge(); wdogBeep(); }

/** 쿠키에서 access_token 추출 */
function wdogGetToken() {
  const m = document.cookie.match(/(?:^|;\s*)access_token=([^;]+)/);
  return m ? m[1] : null;
}

// A) 직접 API 폴링 — GM_xmlhttpRequest 로 CORS 완전 우회
/*
 * [수정] unsafeWindow.fetch 는 브라우저 CORS 정책을 그대로 받아
 * 실패 시 무음 처리 → 플랫폼 자체 알림 폴링(~30분)에 끌려가던 원인.
 * GM_xmlhttpRequest 는 익스텐션 컨텍스트에서 실행되므로 CORS 없음.
 */
function wdogPollAlarm() {
  const token = wdogGetToken();
  if (!token) return;
  GM_xmlhttpRequest({
    method         : 'GET',
    url            : WDOG_ALARM_URL,
    withCredentials: true,
    headers        : {
      'Authorization': 'Bearer ' + token,
      'Accept'       : 'application/json',
    },
    onload: res => {
      try {
        if (res.status !== 200) return;
        const data     = JSON.parse(res.responseText);
        const alarms   = data?.data?.alarms ?? [];
        if (!alarms.length) return;
        const latestId = alarms[0]._id;
        const lastId   = localStorage.getItem(WDOG_LS_KEY);
        if (lastId !== null && latestId !== lastId) wdogTrigger();
        localStorage.setItem(WDOG_LS_KEY, latestId);
      } catch(e) {}
    },
    onerror  : () => {},
    ontimeout: () => {},
  });
}

// B) 플랫폼 알림 dot + 알림 패널 내 미읽은 항목 MutationObserver
/*
 * 읽음/읽지않음 DOM 구분 (알림 모달 내부):
 *   미읽음(신규): <div display="flex" opacity="1"  class="css-rg6zqp ...">
 *   읽음(기존)  : <div display="flex" opacity="0.6" class="css-rfbzwe ...">
 *   → opacity 커스텀 속성이 기준 (Emotion 클래스 css-* 는 불안정)
 *
 * 감지 대상 2가지:
 *   ① 벨 버튼 내 알림 dot (.bg-icon_brand.size-2) 출현
 *   ② 알림 패널 내 [opacity="1"] 항목이 새로 추가될 때
 */
let _wdogDotWas = false;
new MutationObserver(() => {
  // ① 벨 dot
  const btn    = rsBellBtn();
  const hasNow = !!(btn?.querySelector('.bg-icon_brand.size-2'));
  if (hasNow && !_wdogDotWas) wdogTrigger();
  _wdogDotWas = hasNow;
}).observe(document.body, { childList: true, subtree: true });

// ② 알림 패널 내 신규 미읽은 항목 (패널이 열려있을 때만 유효)
new MutationObserver(mutations => {
  for (const mut of mutations) {
    for (const node of mut.addedNodes) {
      if (node.nodeType !== Node.ELEMENT_NODE) continue;
      // <div opacity="1" ...> 직접 추가되거나 그 안에 포함된 경우
      if (node.getAttribute?.('opacity') === '1' ||
          node.querySelector?.('[opacity="1"]')) {
        wdogTrigger();
        return;
      }
    }
  }
}).observe(document.body, { childList: true, subtree: true });

// ════════════════════════════════════════════════════════════
//  ⑪ LSEM — 채팅 스트림 내 업데이트 메시지 감지
// ════════════════════════════════════════════════════════════
/*
 * 플랫폼은 요약 메모리 생성 시 채팅 본문에 아래 구조를 삽입한다:
 *
 *   <div class="my-4 flex items-center gap-2">
 *     <svg ...>...</svg>
 *     <span class="typo-text-xs_leading-none_medium text-text_tertiary">
 *       요약 메모리 업데이트 완료
 *     </span>
 *   </div>
 *
 * MutationObserver로 이 노드 삽입을 즉시 감지한다.
 * localStorage 폴링 방식보다 신뢰성이 높고 오탐이 없다.
 */
const LSEM_MSG = '요약 메모리 업데이트 완료';

/** 추가된 노드가 요약 업데이트 알림인지 판별 */
function lsemIsUpdateNode(node) {
  if (node.nodeType !== Node.ELEMENT_NODE) return false;
  // 직접 span 인지
  if (node.tagName === 'SPAN' && node.textContent.trim() === LSEM_MSG) return true;
  // 자식에 span이 있는지
  return !!node.querySelector?.(`span.typo-text-xs_leading-none_medium`)
    ?.textContent?.includes(LSEM_MSG);
}

function lsemFindBlock() {
  return [...document.querySelectorAll('[role="button"]')]
    .find(el => el.textContent.includes('요약 메모리'));
}

function lsemHighlight() {
  if (lsemHlActive) return;
  const block = lsemFindBlock();
  if (!block) return;
  lsemHlActive = true;
  const wr = block.closest('[class*="px-"]') ?? block.parentElement;
  wr.classList.add('crs-lsem-hl');
  const clear = () => {
    wr.classList.remove('crs-lsem-hl');
    lsemHlActive = false;
    block.removeEventListener('click', clear, { capture: true });
  };
  block.addEventListener('click', clear, { once: true, capture: true });
}

// ════════════════════════════════════════════════════════════
//  ⑫ MutationObserver + 부트스트랩
// ════════════════════════════════════════════════════════════

// ── 패널 주입 감시
let _obsDebounce = null;
new MutationObserver(() => {
  clearTimeout(_obsDebounce);
  _obsDebounce = setTimeout(rsInjectNotiPanel, 200);
}).observe(document.body, { childList: true, subtree: true });

// ── LSEM: 채팅 스트림에 업데이트 메시지가 삽입되면 즉시 하이라이트
new MutationObserver(mutations => {
  for (const mut of mutations) {
    for (const node of mut.addedNodes) {
      if (lsemIsUpdateNode(node)) {
        lsemHighlight();
        return;   // 한 번만 처리
      }
    }
  }
}).observe(document.body, { childList: true, subtree: true });

rsPoll();
setInterval(rsPoll,         RS_POLL_MS);
wdogPollAlarm();                          // 즉시 1회 (초기 lastId 설정)
setInterval(wdogPollAlarm,  WDOG_MS);
