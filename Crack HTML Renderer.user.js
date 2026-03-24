// ==UserScript==
// @name         Crack HTML Renderer
// @namespace    http://tampermonkey.net/
// @version      1.6.1
// @description  Crack(crack.wrtn.ai) 채팅 메시지 내 HTML 코드를 감지, 직접 DOM에 렌더링합니다.
// @author       -
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ============================================================
  //  전역 스타일
  // ============================================================
  GM_addStyle(`

    /* ── 공통 컨테이너 ───────────────────────────────────────── */
    .crk-html-root {
      margin: 5px 0 3px;
      font-family: inherit;
      font-size: 14px;
      line-height: 1.65;
      word-break: break-word;
      overflow-wrap: anywhere;
    }

    /* ── 조건부 색상 상속 ────────────────────────────── */
    .crk-html-root p:not([style*="color"]),
    .crk-html-root strong:not([style*="color"]),
    .crk-html-root b:not([style*="color"]),
    .crk-html-root em:not([style*="color"]),
    .crk-html-root i:not([style*="color"]),
    .crk-html-root span:not([style*="color"]):not(.s) {
      color: inherit !important;
      background: transparent !important;
    }

    /* ── 조건부 div 배경 투명화 ───────────────────────── */
    .crk-html-root div:not([style*="background"]) {
      background: transparent !important;
    }

    /* ── 기본 HTML 태그 본연의 기능 강제 복구 (CSS Reset 무력화) ── */

    .crk-html-root p {
      display: block !important;
      margin: 0.75em 0 !important;
    }
    .crk-html-root p:first-child { margin-top: 0 !important; }
    .crk-html-root p:last-child { margin-bottom: 0 !important; }

    .crk-html-root strong, .crk-html-root b { font-weight: bold !important; }
    .crk-html-root em, .crk-html-root i { font-style: italic !important; }

    /* ── [수정됨] 목록 태그(ul, ol) 강제 보호 ─────────────────
       목록 기호가 잘리지 않도록 왼쪽 여백을 충분히(1.5em) 강제 확보하고
       목록 기호가 정상적으로 보이도록 스타일을 강제합니다. */
    .crk-html-root ul {
      list-style-type: disc !important;
      padding-left: 1.8em !important;
      margin: 4px 0 8px !important;
    }
    .crk-html-root ol {
      list-style-type: decimal !important;
      padding-left: 1.8em !important;
      margin: 4px 0 8px !important;
    }
    .crk-html-root li {
      display: list-item !important;
      margin-bottom: 4px !important;
    }


    /* ── <details> 최소 스타일 (원형 복귀) ──────────────── */
    .crk-html-root details {
      margin: 3px 0;
      border-radius: 4px;
      overflow: hidden; /* 이 속성 때문에 여백이 없으면 점이 잘립니다 */
      border: 1px solid rgba(0, 0, 0, 0.08);
      background: transparent !important;
    }

    .crk-html-root summary {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 11px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      background: rgba(0, 0, 0, 0.02);
      list-style: none;
      user-select: none;
      transition: background 0.15s;
    }
    .crk-html-root summary::-webkit-details-marker { display: none; }
    .crk-html-root summary::before {
      content: '▶';
      font-size: 9px;
      flex-shrink: 0;
      opacity: .6;
      transition: transform .15s, opacity .15s;
    }
    .crk-html-root summary:hover { background: rgba(0, 0, 0, 0.04); }
    .crk-html-root summary:hover::before { opacity: 1; }

    .crk-html-root details[open] > summary {
      border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    }
    .crk-html-root details[open] > summary::before {
      transform: rotate(90deg);
    }
    .crk-html-root details > .crk-details-body {
      padding: 8px 12px 8px 20px !important;
      font-size: 13px;
      line-height: 1.65;
    }

    /* ── <aside> 박스 스타일 (시각적 강조용) ─────────────── */
    .crk-html-root aside {
      margin: 6px 0;
      padding: 12px;
      border-radius: 8px;
      border: 1px solid #c9dff7;
      background: #f5f9ff;
    }

    .crk-html-root aside:not([style*="color"]) {
      color: #2c2b28;
    }

    /* ── 다크 테마 ───────────────────────────────────────────── */
    body[data-theme="dark"] .crk-html-root details {
      border-color: rgba(255, 255, 255, 0.08);
      background: transparent !important;
    }
    body[data-theme="dark"] .crk-html-root summary {
      background: rgba(255, 255, 255, 0.02);
    }
    body[data-theme="dark"] .crk-html-root summary:hover {
      background: rgba(255, 255, 255, 0.04);
    }
    body[data-theme="dark"] .crk-html-root details[open] > summary {
      border-bottom-color: rgba(255, 255, 255, 0.08);
    }

    body[data-theme="dark"] .crk-html-root aside {
      border-color: #2a3f5c;
      background: #1a2535;
    }

    body[data-theme="dark"] .crk-html-root aside:not([style*="color"]) {
      color: #d4d3cd;
    }

    /* ── <article> 독립 컨테이너 스타일 ─────────────────────── */
    .crk-html-root article {
      margin: 8px 0;
      padding: 14px 16px;
      border-radius: 8px;
      border: 1px solid var(--divider_secondary, #dbdad5);
      background: transparent;
    }

    body[data-theme="dark"] .crk-html-root article {
      border-color: rgba(255, 255, 255, 0.10);
    }

    /* ── 부가 기본 요소 ───────────────────────────────────────────── */
    .crk-html-root a  { color: var(--text_action_blue_secondary, #1a88ff); }
    .crk-html-root img { max-width: 100%; border-radius: 8px; display: block; }
    .crk-html-root hr {
      border: none;
      border-top: 1px solid var(--divider_secondary, #dbdad5);
      margin: 10px 0;
    }
    .crk-html-root h1, .crk-html-root h2,
    .crk-html-root h3, .crk-html-root h4,
    .crk-html-root h5, .crk-html-root h6 {
      margin: .7em 0 .35em; font-weight: 700; line-height: 1.3;
    }
    .crk-html-root h1 { font-size: 1.5em; }
    .crk-html-root h2 { font-size: 1.3em; }
    .crk-html-root h3 { font-size: 1.15em; }
    .crk-html-root h4 { font-size: 1.05em; }
    .crk-html-root h5 { font-size: 0.95em; }
    .crk-html-root h6 { font-size: 0.85em; opacity: 0.75; }

    /* ── <blockquote> ────────────────────────────────────────── */
    .crk-html-root blockquote {
      margin: 8px 0;
      padding: 8px 14px;
      border-left: 3px solid var(--divider_secondary, #dbdad5);
      opacity: 0.8;
    }

    /* ── <figure> / <figcaption> ─────────────────────────────── */
    .crk-html-root figure {
      display: block;
      margin: 8px 0;
    }
    .crk-html-root figcaption {
      font-size: 12px;
      opacity: 0.6;
      margin-top: 4px;
      text-align: center;
    }

    /* ── 커스텀 오디오 플레이어 ──────────────────────────────── */
    /* 원본 <audio> 태그는 숨기고 커스텀 UI로 대체 */
    .crk-html-root audio { display: none !important; }

    .crk-ap {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px;
      border-radius: 10px;
      border: 1px solid var(--divider_secondary, #dbdad5);
      background: var(--surface_secondary, #f0efeb);
      margin: 6px 0;
      pointer-events: auto !important;
      user-select: none;
      font-size: 13px;
    }
    .crk-ap * { pointer-events: auto !important; }

    .crk-ap-btn {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: none;
      background: var(--text_action_blue_secondary, #1a88ff);
      color: #fff;
      font-size: 13px;
      cursor: pointer !important;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.15s;
    }
    .crk-ap-btn:hover { opacity: 0.85; }

    .crk-ap-track {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 5px;
      min-width: 0;
    }
    .crk-ap-title {
      font-size: 12px;
      opacity: 0.55;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .crk-ap-progress-wrap {
      position: relative;
      width: 100%;
      height: 4px;
      background: rgba(0,0,0,0.12);
      border-radius: 2px;
      cursor: pointer !important;
    }
    .crk-ap-progress-fill {
      height: 100%;
      width: 0%;
      border-radius: 2px;
      background: var(--text_action_blue_secondary, #1a88ff);
      pointer-events: none;
      transition: width 0.1s linear;
    }
    .crk-ap-time {
      font-size: 11px;
      opacity: 0.5;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── 우측 고정 컨트롤 영역 (복사 버튼 + 볼륨) ───────────── */
    .crk-ap-controls {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .crk-ap-copy-btn {
      background: none;
      border: none;
      padding: 0;
      font-size: 14px;
      cursor: pointer !important;
      opacity: 0.5;
      line-height: 1;
      transition: opacity 0.15s;
    }
    .crk-ap-copy-btn:hover { opacity: 1; }
    .crk-ap-copy-btn.copied { opacity: 1; color: #22c55e; }

    .crk-ap-vol-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .crk-ap-vol-btn {
      background: none;
      border: none;
      padding: 0;
      font-size: 14px;
      cursor: pointer !important;
      opacity: 0.6;
      line-height: 1;
    }
    .crk-ap-vol-btn:hover { opacity: 1; }
    .crk-ap-vol-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 60px;
      height: 4px;
      border-radius: 2px;
      background: rgba(0,0,0,0.15);
      outline: none;
      cursor: pointer !important;
    }
    .crk-ap-vol-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--text_action_blue_secondary, #1a88ff);
      cursor: pointer;
    }
    body[data-theme="dark"] .crk-ap-vol-slider {
      background: rgba(255,255,255,0.20);
    }

    /* ── YouTube 임베드 플레이어 ─────────────────────────────── */
    .crk-yt-wrap {
      margin: 6px 0;
      border-radius: 10px;
      overflow: hidden;
      border: 1px solid var(--divider_secondary, #dbdad5);
      pointer-events: auto !important;
    }
    .crk-yt-wrap * { pointer-events: auto !important; }

    .crk-yt-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: var(--surface_secondary, #f0efeb);
      font-size: 12px;
      cursor: pointer !important;
      user-select: none;
    }
    .crk-yt-header:hover { opacity: 0.85; }
    .crk-yt-label {
      display: flex;
      align-items: center;
      gap: 6px;
      opacity: 0.7;
    }
    .crk-yt-toggle { font-size: 11px; opacity: 0.5; }

    .crk-yt-frame-wrap {
      overflow: hidden;
      transition: height 0.2s ease;
    }
    .crk-yt-frame-wrap iframe {
      display: block;
      width: 100%;
      border: none;
    }

    body[data-theme="dark"] .crk-yt-wrap {
      border-color: rgba(255,255,255,0.10);
    }
    body[data-theme="dark"] .crk-yt-header {
      background: rgba(255,255,255,0.05);
    }

    .crk-html-root table {
      border-collapse: collapse; width: 100%; font-size: 13px; margin: 6px 0;
    }
    .crk-html-root th, .crk-html-root td {
      border: 1px solid var(--divider_secondary, #dbdad5); padding: 5px 8px;
    }
    .crk-html-root th { background: var(--surface_secondary, #f0efeb); font-weight: 600; }
    .crk-html-root code {
      background: var(--surface_secondary, #f0efeb);
      padding: 1px 5px; border-radius: 4px;
      font-family: 'Consolas', 'Courier New', monospace; font-size: .88em;
    }
    .crk-html-root pre {
      background: var(--surface_secondary, #f0efeb);
      padding: 10px 12px; border-radius: 6px; overflow-x: auto;
      white-space: pre-wrap; margin: 6px 0;
    }
    .crk-html-root pre code { background: none; padding: 0; }

    /* ── <span class="s"> 스포일러 (마우스 오버 시 공개) ──────── */
    .crk-html-root span.s,
    .wrtn-markdown span.s {
      display: inline-block;
      background: currentColor;
      border-radius: 3px;
      padding: 0 2px;
      cursor: pointer;
      filter: blur(4px);
      color: transparent !important;
      user-select: none;
      transition: filter 0.25s ease, color 0.25s ease, background 0.25s ease;
    }
    .crk-html-root span.s:hover,
    .wrtn-markdown span.s:hover {
      filter: blur(0);
      color: inherit !important;
      background: transparent;
    }

    body[data-theme="dark"] .crk-html-root span.s,
    body[data-theme="dark"] .wrtn-markdown span.s {
      background: rgba(255,255,255,0.85);
    }

    /* ── <sub> / <sup> 강제 복구 ─────────────────────────────── */
    .crk-html-root sub,
    .wrtn-markdown sub {
      vertical-align: sub !important;
      font-size: 0.75em !important;
      line-height: 0 !important;
    }
    .crk-html-root sup,
    .wrtn-markdown sup {
      vertical-align: super !important;
      font-size: 0.75em !important;
      line-height: 0 !important;
    }

    /* ── <ruby> / <rt> / <rp> 강제 복구 ─────────────────────── */
    .crk-html-root ruby,
    .wrtn-markdown ruby {
      display: ruby !important;
      ruby-align: center;
    }
    .crk-html-root rt,
    .wrtn-markdown rt {
      display: ruby-text !important;
      font-size: 0.55em !important;
      line-height: 1.2 !important;
      opacity: 0.75;
    }
    .crk-html-root rp,
    .wrtn-markdown rp {
      display: none !important;
    }
  `);

  // ============================================================
  //  상수 / 상태
  // ============================================================

  const RENDER_ATTR  = 'data-crk-rendered';
  const processedSet = new WeakSet();
  const timers       = new WeakMap();
  const MIN_LEN      = 30;   // 일반 텍스트 노드 최소 길이
  const MIN_LEN_TAG  = 4;    // HTML 태그 포함 노드 최소 길이 (<ruby> = 6자, <span> = 6자)
  const BLOCK_TAGS = [
    // ── 컨테이너
    'details', 'div', 'section', 'article', 'aside',
    // ── 표
    'table',
    // ── 목록
    'ul', 'ol',
    // ── 텍스트 블록
    'p', 'blockquote', 'pre',
    // ── 헤딩
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    // ── 미디어
    'figure', 'audio', 'video',
    // ── 루비
    'ruby',
    // ── 인라인 독립 래핑 (투명 블록으로 주입)
    'span', 'sub', 'sup',
  ];

  // 닫는 태그가 없는 void 태그 — 단독 트리거 전용
  const VOID_TAGS = ['img', 'hr'];

  // 인라인 요소 — 래퍼를 div 대신 span(inline)으로 생성
  const INLINE_TAGS = ['ruby', 'span', 'sub', 'sup'];

  // ============================================================
  //  처리 큐 (debounce 600ms)
  // ============================================================

  function queueProcessing(mdEl) {
    if (processedSet.has(mdEl)) return;
    if (timers.has(mdEl)) clearTimeout(timers.get(mdEl));
    timers.set(mdEl, setTimeout(() => {
      timers.delete(mdEl);
      processMarkdownEl(mdEl);
    }, 400));
  }

  // ============================================================
  //  핵심 처리
  // ============================================================

  function processMarkdownEl(mdEl) {
    if (processedSet.has(mdEl)) return;
    processedSet.add(mdEl);

    const blocks = collectBlocks(mdEl);
    for (const block of blocks) {
      if (block.fragmented) {
        injectFragmented(block);
      } else {
        injectDirectly(block.node, block.html, block.tag);
      }
    }
  }

  function collectBlocks(root) {
    const complete    = [];
    const fragmented  = [];
    const usedNodes   = new WeakSet();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement?.closest(`[${RENDER_ATTR}]`)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let node;
    while ((node = walker.nextNode())) {
      if (usedNodes.has(node)) continue;
      const text = node.textContent.trim();
      if (!text) continue;

      // 태그를 포함하는 노드는 낮은 임계값 적용, 아니면 일반 임계값
      const hasTag = /<[a-z][\s\S]*?>/i.test(text);
      if (text.length < (hasTag ? MIN_LEN_TAG : MIN_LEN)) continue;

      // void 태그 (닫는 태그 없음) — 텍스트 전체를 바로 완성 블록으로 처리
      const voidTag = getVoidTag(text);
      if (voidTag) {
        complete.push({ node, html: text, tag: voidTag, fragmented: false });
        continue;
      }

      const completedTag = getCompleteBlockTag(text);
      if (completedTag) {
        complete.push({ node, html: text, tag: completedTag, fragmented: false });
        continue;
      }

      const openingTag = getOpeningOnlyTag(text);
      if (openingTag) {
        const assembled = assembleFragmented(node, text, openingTag, usedNodes);
        if (assembled) fragmented.push(assembled);
      }
    }

    const all = [...complete, ...fragmented];

    return all.filter(({ html: a }) =>
      !all.some(({ html: b }) => b !== a && b.includes(a))
    );
  }

  function getVoidTag(text) {
    for (const tag of VOID_TAGS) {
      if (new RegExp(`^\\s*<${tag}[\\s>/]`, 'i').test(text)) return tag;
    }
    return null;
  }

  function getCompleteBlockTag(text) {
    for (const tag of BLOCK_TAGS) {
      if (new RegExp(`^\\s*<${tag}[\\s>/]`, 'i').test(text) &&
          new RegExp(`</${tag}>`, 'i').test(text)) return tag;
    }
    return null;
  }

  function getOpeningOnlyTag(text) {
    for (const tag of BLOCK_TAGS) {
      if (new RegExp(`^\\s*<${tag}[\\s>/]`, 'i').test(text) &&
          !new RegExp(`</${tag}>`, 'i').test(text)) return tag;
    }
    return null;
  }

  function assembleFragmented(openingNode, openingText, tag, usedNodes) {
    const closeRe = new RegExp(`</\\s*${tag}\\s*>`, 'i');

    let bodyHTML   = openingText;
    const extraNodes = [];
    let closingNode  = null;
    let depth        = 1;

    let sibling = openingNode.nextSibling;
    let guard   = 0;

    while (sibling && guard++ < 50) {
      if (sibling.nodeType === Node.TEXT_NODE) {
        const t = sibling.textContent;
        const opens  = (t.match(new RegExp(`<${tag}[\\s>/]`, 'gi')) || []).length;
        const closes = (t.match(closeRe) || []).length;

        depth += opens - closes;
        bodyHTML += t;

        if (depth <= 0) {
          closingNode = sibling;
          break;
        }
        extraNodes.push(sibling);
      } else if (sibling.nodeType === Node.ELEMENT_NODE) {
        bodyHTML += sibling.outerHTML;
        extraNodes.push(sibling);
      }
      sibling = sibling.nextSibling;
    }

    if (!closingNode) return null;

    usedNodes.add(openingNode);
    extraNodes.forEach(n => usedNodes.add(n));
    usedNodes.add(closingNode);

    return {
      node:       openingNode,
      html:       bodyHTML,
      tag,
      fragmented: true,
      extraNodes,
      closingNode,
    };
  }

  function injectDirectly(textNode, html, tag) {
    const anchor = wrapHidden(textNode);
    const wrapper = createWrapper(html, tag);
    if (wrapper) anchor.insertAdjacentElement('afterend', wrapper);
  }

  function injectFragmented(block) {
    const { node, html, tag, extraNodes, closingNode } = block;
    const anchor = wrapHidden(node);
    const wrapper = createWrapper(html, tag);
    if (wrapper) anchor.insertAdjacentElement('afterend', wrapper);

    extraNodes.forEach(n => n.remove());

    if (closingNode) {
      const remaining = closingNode.textContent.replace(/<\/\w+>/gi, '').trim();
      if (remaining) {
        closingNode.textContent = remaining;
      } else {
        closingNode.remove();
      }
    }
  }

  function wrapHidden(textNode) {
    const anchor = document.createElement('span');
    anchor.style.display = 'none';
    textNode.parentNode.insertBefore(anchor, textNode);
    anchor.appendChild(textNode);
    return anchor;
  }

  function createWrapper(html, tag) {
    const frag = parseHTML(html);
    if (!frag) return null;

    // 인라인 태그는 span(inline), 나머지는 div(block) 래퍼 사용
    const isInline = tag && INLINE_TAGS.includes(tag);
    const wrapper = document.createElement(isInline ? 'span' : 'div');
    wrapper.setAttribute(RENDER_ATTR, '1');
    wrapper.className = 'crk-html-root';
    if (isInline) wrapper.style.display = 'inline';
    wrapper.appendChild(frag);

    // <details> 내부 비-summary 자식을 래퍼 div로 감싸 패딩 보장
    wrapper.querySelectorAll('details').forEach(detailsEl => {
      const nonSummary = [...detailsEl.childNodes].filter(n =>
        !(n.nodeType === Node.ELEMENT_NODE && n.tagName.toLowerCase() === 'summary')
      );
      if (!nonSummary.length) return;
      const body = document.createElement('div');
      body.className = 'crk-details-body';
      // summary 다음 위치에 삽입
      const summary = detailsEl.querySelector('summary');
      const insertAfter = summary ? summary.nextSibling : detailsEl.firstChild;
      detailsEl.insertBefore(body, insertAfter || null);
      nonSummary.forEach(n => body.appendChild(n));
    });

    // <audio> 태그를 커스텀 플레이어로 교체
    wrapper.querySelectorAll('audio').forEach(audioEl => {
      // src 후보 수집
      const sources = [];
      if (audioEl.src) sources.push(audioEl.src);
      audioEl.querySelectorAll('source[src]').forEach(s => sources.push(s.src));

      // YouTube URL 여부 판별 → 분기
      const ytId = sources.map(parseYouTubeId).find(Boolean);
      const player = ytId ? buildYouTubePlayer(ytId) : buildAudioPlayer(audioEl);
      audioEl.insertAdjacentElement('afterend', player);
    });

    return wrapper;
  }

  // ============================================================
  //  유틸: YouTube URL 파싱
  // ============================================================

  function parseYouTubeId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('?')[0];
      if (u.hostname.includes('youtube.com')) {
        return u.searchParams.get('v') ||
               (u.pathname.startsWith('/embed/') ? u.pathname.split('/')[2] : null);
      }
    } catch (_) {}
    return null;
  }

  // ============================================================
  //  커스텀 오디오 플레이어 (직접 파일 URL용)
  // ============================================================

  function fmt(sec) {
    if (!isFinite(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function buildAudioPlayer(audioEl) {
    const sources = [];
    if (audioEl.src) sources.push(audioEl.src);
    audioEl.querySelectorAll('source[src]').forEach(s => sources.push(s.src));

    const audio = new Audio();
    sources.forEach(src => {
      const s = document.createElement('source');
      s.src = src;
      audio.appendChild(s);
    });
    audio.preload = 'metadata';

    // ── UI 구성
    const wrap = document.createElement('div');
    wrap.className = 'crk-ap';

    const btn = document.createElement('button');
    btn.className = 'crk-ap-btn';
    btn.textContent = '▶';
    btn.title = '재생';

    const track = document.createElement('div');
    track.className = 'crk-ap-track';

    const title = document.createElement('div');
    title.className = 'crk-ap-title';
    const lastName = (sources[0] || '').split('/').pop().split('?')[0] || 'audio';
    title.textContent = decodeURIComponent(lastName);

    const progressWrap = document.createElement('div');
    progressWrap.className = 'crk-ap-progress-wrap';
    const progressFill = document.createElement('div');
    progressFill.className = 'crk-ap-progress-fill';
    progressWrap.appendChild(progressFill);

    const time = document.createElement('div');
    time.className = 'crk-ap-time';
    time.textContent = '0:00 / 0:00';

    // ── 볼륨 컨트롤
    const volWrap = document.createElement('div');
    volWrap.className = 'crk-ap-vol-wrap';

    const volBtn = document.createElement('button');
    volBtn.className = 'crk-ap-vol-btn';
    volBtn.textContent = '🔊';
    volBtn.title = '음소거';

    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.className = 'crk-ap-vol-slider';
    volSlider.min = 0;
    volSlider.max = 1;
    volSlider.step = 0.05;
    volSlider.value = 1;

    volWrap.append(volBtn, volSlider);

    // ── 링크 복사 버튼
    const copyBtn = document.createElement('button');
    copyBtn.className = 'crk-ap-copy-btn';
    copyBtn.textContent = '🔗';
    copyBtn.title = '링크 복사';

    // ── 우측 고정 컨트롤 영역
    const controls = document.createElement('div');
    controls.className = 'crk-ap-controls';
    controls.append(copyBtn, volWrap);

    track.append(title, progressWrap);
    wrap.append(btn, track, time, controls);

    // ── 이벤트: 재생/일시정지
    btn.addEventListener('click', () => {
      if (audio.paused) {
        audio.play().catch(() => {});
        btn.textContent = '⏸';
        btn.title = '일시정지';
      } else {
        audio.pause();
        btn.textContent = '▶';
        btn.title = '재생';
      }
    });

    // ── 이벤트: 진행 표시
    audio.addEventListener('timeupdate', () => {
      const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
      progressFill.style.width = pct + '%';
      time.textContent = `${fmt(audio.currentTime)} / ${fmt(audio.duration)}`;
    });

    // ── 이벤트: 재생 완료
    audio.addEventListener('ended', () => {
      btn.textContent = '▶';
      btn.title = '재생';
      progressFill.style.width = '0%';
      audio.currentTime = 0;
    });

    // ── 이벤트: 진행 바 클릭으로 탐색
    progressWrap.addEventListener('click', e => {
      if (!audio.duration) return;
      const rect = progressWrap.getBoundingClientRect();
      audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
    });

    // ── 이벤트: 볼륨 슬라이더
    volSlider.addEventListener('input', () => {
      audio.volume = parseFloat(volSlider.value);
      volBtn.textContent = audio.volume === 0 ? '🔇' : audio.volume < 0.5 ? '🔉' : '🔊';
    });

    // ── 이벤트: 음소거 토글
    volBtn.addEventListener('click', () => {
      audio.muted = !audio.muted;
      volBtn.textContent = audio.muted ? '🔇' : audio.volume < 0.5 ? '🔉' : '🔊';
      volSlider.value = audio.muted ? 0 : audio.volume;
    });

    // ── 이벤트: 링크 복사
    copyBtn.addEventListener('click', () => {
      const url = sources[0] || '';
      if (!url) return;
      navigator.clipboard.writeText(url).then(() => {
        copyBtn.classList.add('copied');
        copyBtn.textContent = '✅';
        setTimeout(() => {
          copyBtn.classList.remove('copied');
          copyBtn.textContent = '🔗';
        }, 1500);
      }).catch(() => {});
    });

    return wrap;
  }

  // ============================================================
  //  YouTube 임베드 플레이어
  // ============================================================

  function buildYouTubePlayer(videoId) {
    const wrap = document.createElement('div');
    wrap.className = 'crk-yt-wrap';

    // 헤더 (접기/펼치기)
    const header = document.createElement('div');
    header.className = 'crk-yt-header';

    const label = document.createElement('div');
    label.className = 'crk-yt-label';
    const labelIcon = document.createElement('span');
    labelIcon.textContent = '▶';
    const labelText = document.createElement('span');
    labelText.textContent = `YouTube — ${videoId}`;   // textContent → XSS 불가
    label.append(labelIcon, labelText);

    const toggle = document.createElement('div');
    toggle.className = 'crk-yt-toggle';
    toggle.textContent = '영상 접기 ▲';

    header.append(label, toggle);

    // iframe 래퍼
    const frameWrap = document.createElement('div');
    frameWrap.className = 'crk-yt-frame-wrap';

    const iframe = document.createElement('iframe');
    // privacy-enhanced 도메인 사용, autoplay=0
    iframe.src = `https://www.youtube-nocookie.com/embed/${videoId}?rel=0`;
    iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    iframe.allowFullscreen = true;
    iframe.style.height = '200px';   // 기본: 오디오처럼 쓸 수 있는 최소 높이

    frameWrap.appendChild(iframe);
    wrap.append(header, frameWrap);

    // 접기/펼치기 토글
    let collapsed = false;
    const FULL_H = '200px';
    header.addEventListener('click', () => {
      collapsed = !collapsed;
      frameWrap.style.height = collapsed ? '0px' : FULL_H;
      iframe.style.height    = collapsed ? '0px' : FULL_H;
      toggle.textContent     = collapsed ? '영상 펼치기 ▼' : '영상 접기 ▲';
    });

    return wrap;
  }

  function parseHTML(html) {
    const cleaned = html
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g,  '<')
      .replace(/&gt;/g,  '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");

    const template = document.createElement('template');
    template.innerHTML = cleaned;
    const frag = template.content;

    frag.querySelectorAll('[node]').forEach(el => el.removeAttribute('node'));
    frag.querySelectorAll(
      'script, style, link, iframe, frame, frameset, object, embed, base, meta, form'
    ).forEach(el => el.remove());

    // ① on* 이벤트 핸들러 속성 전체 제거 + javascript: URL 차단
    const DANGEROUS_ATTRS = ['href', 'src', 'action', 'formaction', 'data', 'xlink:href'];
    frag.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        if (/^on/i.test(attr.name)) {
          el.removeAttribute(attr.name);
        }
      });
      DANGEROUS_ATTRS.forEach(a => {
        const val = el.getAttribute(a);
        if (val && /^\s*javascript:/i.test(val)) el.removeAttribute(a);
      });
    });

    // 인라인 style 속성에 !important 강제 부여
    // — 플랫폼 CSS의 !important 초기화 규칙을 인라인 style이 이기려면 필요
    frag.querySelectorAll('[style]').forEach(el => {
      const raw = el.getAttribute('style') || '';
      const enforced = raw
        .split(';')
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => (/!important\s*$/.test(s) ? s : s + ' !important'))
        .join('; ');
      el.setAttribute('style', enforced);
    });

    return frag;
  }

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue;
        if (added.classList?.contains('wrtn-markdown')) { queueProcessing(added); continue; }
        added.querySelectorAll?.('div.wrtn-markdown').forEach(queueProcessing);
        const parentMd = added.closest?.('div.wrtn-markdown');
        if (parentMd) queueProcessing(parentMd);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  function processExisting() {
    document.querySelectorAll('div.wrtn-markdown').forEach(el => {
      if (el.closest('[data-message-group-id]')) queueProcessing(el);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', processExisting);
  } else {
    setTimeout(processExisting, 400);
  }

  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) {
      lastPath = location.pathname;
      setTimeout(processExisting, 1000);
    }
  }, 500);

})();
