// ==UserScript==
// @name         크랙 엠버
// @namespace    http://tampermonkey.net/
// @version      0.4.8
// @description  크랙 기억력 보완 - 요약 자동 주입 확장 (Gemini 연동)
// @match        https://crack.wrtn.ai/stories/*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const LOG_PREFIX = '[Crack Ember]';
  const MAX_CHARS   = 2000;
  const TAB_BAR_H   = 40;    // 탭바 고정 높이 (px)
  const CONTENT_H   = 420;   // 패널 컨텐츠 높이 (px)
  const BUTTON_ROW_H = 48;   // 하단 버튼 행 고정 높이 (슬래시 + 전송)
  const TA_TOP_GAP   = 22;   // 카운터 공간 (fakeTA 상단 여백)
  const MAX_TA_H     = 210;  // fakeTA 스크롤 발생 임계 (px)
  const MIN_TA_H     = 44;   // fakeTA 최소 높이 (1행)

  // ProseMirror(TipTap) contenteditable div → 구버전 textarea 순으로 탐색
  const TEXTAREA_SELECTORS = [
    'div.__chat_input_textarea[contenteditable="true"]',
    'div.ProseMirror[contenteditable="true"]',
    'div[contenteditable="true"][data-placeholder*="메시지"]',
    'textarea.__chat_input_textarea',
    'textarea[placeholder*="메시지"]',
    'textarea.rc-textarea',
  ];

  // 전송 버튼: 실제 textarea 조상 안에서 탐색
  const SEND_BTN_SELECTOR = 'button[class*="bg-primary"]';

  // =============================================
  //  2-4-a: 요약 상태 관리
  //  activeSlots: 전송 시 실제로 첨부할 요약 배열
  //  각 항목: { id, turn, text, type }
  //    type: 'shortTerm' | 'longTerm' | 'userNote'
  // =============================================
  let activeSlots = [];   // 현재 첨부 대기 중인 요약들
  let _slotStorageKey = '';   // 채팅 ID별 슬롯 키

  // ── 슬롯 저장/로드 ──
  function _slotKey() {
    const ids = parsePath();
    return ids ? `crack-Ember-slots-${ids.chatId}` : 'crack-Ember-slots-unknown';
  }

  function _saveSlots() {
    try { localStorage.setItem(_slotStorageKey || _slotKey(), JSON.stringify(activeSlots)); }
    catch (e) { warn('슬롯 저장 실패:', e); }
  }

  function _loadSlots() {
    try {
      const key = _slotStorageKey || _slotKey();
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }

  function addSlot(slot) {
    activeSlots.push(slot);
    _syncReserved();
    _saveSlots();
    log(`슬롯 추가 — id:${slot.id} type:${slot.type}`);
  }

  function removeSlot(id) {
    activeSlots = activeSlots.filter(s => s.id !== id);
    _syncReserved();
    _saveSlots();
  }

  function updateSlot(id, newText) {
    const slot = activeSlots.find(s => s.id === id);
    if (!slot) return;
    slot.text = newText;
    _syncReserved();
    _saveSlots();
  }

  function setSlots(slots) {
    activeSlots = [...slots];
    _syncReserved();
    _saveSlots();
  }

  /**
   * 2-4-c: 예약 글자 수 자동 동기화
   * — 슬롯이 바뀔 때마다 XML 전체 길이를 미리 계산해 카운터 갱신
   */
  function _syncReserved() {
    const xml = buildXML();
    const msgSlots = activeSlots.filter(s => s.type === 'message' && s.active !== false);
    const msgLen   = msgSlots.reduce((sum, s) => sum + (s.text?.length ?? 0) + 2, 0); // +2 개행
    reservedChars = xml.length + msgLen;
    renderCounter();
  }

  // =============================================
  //  2-4-a: XML 조립
  //  형식 (크랙 메모리 태그 규격):
  //  <history_summary>
  //    <shortTerm turn="3">…</shortTerm>
  //    <longTerm turn="1">…</longTerm>
  //  </history_summary>
  //  <user_notes>…</user_notes>  ← userNote 타입
  // =============================================
  function buildXML() {
    const s_cfg = loadSettings();
    const autoN  = s_cfg.autoAttachSlots ?? 0;

    // autoAttachSlots > 0: 저장된 단기 기억 중 최신 N개를 자동으로 포함
    let slotsBase = activeSlots;
    if (autoN > 0) {
      const allStored = _loadSlots();  // 전체 저장 슬롯
      const storedShort = allStored
        .filter(sl => sl.type === 'shortTerm')
        .slice(-autoN);                // 최신 N개
      const existingIds = new Set(activeSlots.map(sl => sl.id));
      const toAdd = storedShort.filter(sl => !existingIds.has(sl.id));
      slotsBase = [...toAdd, ...activeSlots];
    }

    if (slotsBase.length === 0) return '';

    const shortSlots = slotsBase.filter(s => s.type === 'shortTerm' && s.active !== false);
    const longSlots  = slotsBase.filter(s => s.type === 'longTerm'  && s.active !== false);
    const noteSlots  = slotsBase.filter(s => s.type === 'userNote'  && s.active !== false);

    // <user_note> 블록 — 유저노트 (플랫폼 네이티브 태그 일치)
    let noteSection = '';
    if (noteSlots.length > 0) {
      const noteText = noteSlots.map(s => s.text.trim()).join('\n\n');
      noteSection = `<user_note>\n${noteText}\n</user_note>`;
    }

    // <latest_history> 블록 — 단기/장기 기억 (플랫폼 네이티브 태그 + markdown 헤더)
    let memSection = '';
    const allMemSlots = [...shortSlots, ...longSlots];
    if (allMemSlots.length > 0) {
      const memLines = allMemSlots.map(s => {
        const header = s.type === 'shortTerm'
          ? `### T#${s.startTurn ?? '?'} ~ T#${s.endTurn ?? '?'} 요약`
          : `### ${s.label || '장기 기억'}`;
        return `${header}\n${s.text.trim()}`;
      }).join('\n\n');
      memSection = `<latest_history>\n${memLines}\n</latest_history>`;
    }

    return [noteSection, memSection].filter(Boolean).join('\n\n');
  }

  // reservedChars는 _syncReserved()가 관리 — 직접 쓰는 외부 인터페이스는 유지
  let reservedChars = 0;
  function updateReservedChars(n) {
    reservedChars = Math.max(0, n);
    renderCounter();
  }

  // =============================================
  //  유틸
  // =============================================
  function log(...args)  { console.log(LOG_PREFIX, ...args); }
  function warn(...args) { console.warn(LOG_PREFIX, ...args); }


  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // =============================================
  //  3-1: 설정 (localStorage)
  // =============================================
  const SETTINGS_KEY = 'crack-Ember-settings';

  const DEFAULT_SETTINGS = {
    geminiKey:       '',
    geminiModel:     'gemini-2.5-flash',
    autoSummary:     true,
    excludeLastN:    1,
    autoAttachSlots: 3,   // 자동 첨부 단기 기억 개수 (0~5)
    summaryInterval: 3,   // 요약 주기: 매 N턴 (2~6)
    maxSlots:        5,   // 보관 슬롯 수 (3~10)
    summaryPrompt: `[MISSION: RP Memory Core Synthesizer]
# [정체성]
당신은 롤플레잉 Chat Log를 분석하여 플랫폼 내부 요약메모리 시스템에 등록할 사건별 독립 슬롯을 생성하는 AI입니다.
각 슬롯은 시맨틱 검색 최적화 제목과 200자 이내 내용으로 구성되며, 맥락 독립성(어떤 슬롯을 단독으로 읽어도 사건을 완전히 파악 가능)을 최우선으로 해야 합니다.

---

# [절대 원칙]
- 출력: 슬롯별로 분리 출력. 코드블럭 없이 평문으로.
- 분량: 슬롯당 공백 포함 200자 이내.
- 객관성: Chat Log에 명시된 사실만 기록. 추측·소설적 서술 금지.
- 대명사 금지: '그', '그녀' 대신 반드시 정확한 이름 사용.
- 순서 고정: 반드시 Chat Log의 시간 흐름을 엄격히 준수.
- 소급 금지: 이후 발생한 사실을 앞선 슬롯에 포함 금지.
- 언어: 한국어.
- 전개 금지: 반드시 요약을 해야 합니다. 전개는 허용되어 있지 않습니다.

---

# [사건 분리 기준]
아래 중 하나라도 해당 시 반드시 새 슬롯으로 분리:

1. 장소 이동
2. 시간대 변화 (새벽/오전/오후/저녁/밤)
3. 주요 인물 구성 변화

병합 금지: 주제가 이어지더라도 장소가 바뀌면 합치지 않음.

# [출력 형식]
[시맨틱 제목]
- 내용

# [제목 규칙] ← 최고 중요도
- 공백 포함 20자 이내 최대 활용.
- 조사(~의, ~와, ~에서) 및 특수기호(# 등) 사용 금지.
- 유저명 제외. NPC명(필수) + 세력명·소재·핵심행동 등 검색에 유의미한 고유명사를 띄어쓰기로 나열.
- 날짜·시간·주관적 감정 기재 금지.
 - 예: 아리아 연회 독살시도 찻잔 (O) / 유저명 아리아 말다툼 사과 (X) / #아리아 말다툼 (X)

---

# [내용 규칙]
- `- `(하이픈+공백) 단일 항목으로 시작.
- 첫머리에 [MM/DD 시간대] 명시.
- 필수 기록 요소:
 - 인과 사슬(Flow): [행동/발화] → [리액션] → [재반응/변화] 구조. 대사는 " " 인용.
 - 맥락 정보(Context): 공식 발표·소문·동기 등 떡밥이 되는 배경. ("소문을 들음" ❌ → "A가 B 때문이라는 소문을 들음" ✅)
 - 구체적 양상(How): '화냄' 대신 "미간을 찌푸림" 등 로그에 명시된 행동·표정.
 - 질감(Mood): 사소한 장난·긴장감·말투 변화 등 관계의 온도.
 - 전환점: 관계 변화·결정적 약속·은폐 사실.
 - 구체적 명사: 상징적 선물·물건·공간을 정확한 명칭으로.

---

# [금지]
- 서로 다른 장소의 사건이 하나로 통합
- 제목 형식 미준수 또는 공백 포함 20자 초과
- 내용이 공백 포함 200자를 초과하거나 로그 순서가 혼합
- 인물 간 인과 사슬이 누락
- 한국어 외 언어로 출력
- 요약이 아닌 사건 전개를 시도`,
  };

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
    } catch { return { ...DEFAULT_SETTINGS }; }
  }

  function saveSettings(partial) {
    const current = loadSettings();
    const next = { ...current, ...partial };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
    return next;
  }

  // =============================================
  //  3-2: 크랙 API — 토큰 & 헤더
  // =============================================
  const CRACK_API = 'https://crack-api.wrtn.ai/crack-gen';

  function getToken() {
    // 방법 1: 쿠키
    const match = document.cookie.split(';')
      .map(c => c.trim())
      .find(c => c.startsWith('access_token='));
    if (match) return match.slice('access_token='.length);

    // 방법 2: localStorage (크랙이 인증 방식을 바꿨을 경우 대비)
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.includes('token') || key.includes('auth')) {
          const val = localStorage.getItem(key);
          if (val && val.length > 20 && !val.startsWith('{')) {
            log(`토큰 폴백 — localStorage[${key}] 사용`);
            return val;
          }
        }
      }
    } catch (_) {}

    warn('인증 토큰 없음 — 쿠키/localStorage 모두 실패');
    log('현재 쿠키 키 목록:', document.cookie.split(';').map(c => c.trim().split('=')[0]));
    return null;
  }

  function crackHeaders() {
    const token = getToken();
    const wrtnId = document.cookie.split(';').map(c => c.trim())
      .find(c => c.startsWith('__w_id='))?.slice('__w_id='.length) ?? '';
    const mpId = (() => {
      try {
        const raw = localStorage.getItem('mp_78c86210f74e622ec77ded5882a5762b_mixpanel');
        return raw ? (JSON.parse(raw)?.distinct_id ?? '') : '';
      } catch { return ''; }
    })();
    const h = { 'Content-Type': 'application/json', 'platform': 'web', 'wrtn-locale': 'ko-KR' };
    if (token)  h['Authorization'] = `Bearer ${token}`;
    if (wrtnId) h['x-wrtn-id'] = wrtnId;
    if (mpId)   h['mixpanel-distinct-id'] = mpId;
    return h;
  }

  // =============================================
  //  3-2: 최근 메시지 수집
  // =============================================
  async function fetchRecentMessages(count = 6) {
    const ids = parsePath();
    if (!ids) return [];
    try {
      // count보다 넉넉히 더 받아온다 — 정확한 절단은 호출 측에서
      // 턴 번호 기준으로 수행하므로(filterByTurnRange), 여기서는
      // 위치 기반 slice로 미리 잘라내지 않는다 (잘못 잘리면 영구 손실).
      const url = `${CRACK_API}/v3/chats/${ids.chatId}/messages?limit=${Math.max(count + 10, 20)}`;
      const res = await fetch(url, { headers: crackHeaders(), credentials: 'include' });
      if (!res.ok) { warn('메시지 로드 실패:', res.status); return []; }
      const json = await res.json();
      const raw  = (json.data?.messages ?? json.messages ?? []);
      const mapped = raw.map(m => ({
        role:    m.role === 'user' ? 'user' : 'assistant',
        content: m.message ?? m.content ?? '',
      }));
      // API가 실제로 과거→최신/최신→과거 중 어느 순서로 주는지 보장이 없으므로
      // [T #N] 태그 진행 방향을 보고 과거→최신 오름차순으로 통일한다.
      return normalizeChronological(mapped);
    } catch (e) { warn('메시지 로드 오류:', e); return []; }
  }

  // [T #N] 태그가 박힌 메시지들의 턴 번호 진행 방향을 검사해
  // 배열이 내림차순(최신이 앞)으로 보이면 뒤집어 오름차순으로 통일한다.
  // 태그가 1개 이하면 방향 판별이 불가하므로 원본 순서를 그대로 둔다.
  function normalizeChronological(messages) {
    const pat = buildTurnRegex();
    const tags = [];
    messages.forEach(m => {
      const match = m.content.match(pat);
      if (match && match[1]) tags.push(parseInt(match[1], 10));
    });
    if (tags.length < 2) return messages;
    return tags[0] > tags[tags.length - 1] ? [...messages].reverse() : messages;
  }

  // 메시지 배열에서 startTurn~endTurn 구간에 해당하는 메시지만 추출한다.
  // 유저 메시지는 자신의 [T #N] 태그로 턴을 판정하고, 태그가 없는 AI
  // 응답은 인접한(앞 또는 뒤) 유저 메시지의 턴 번호를 그대로 물려받는다.
  // 반환 배열은 항상 (턴 오름차순 → 같은 턴이면 유저 먼저) 순으로 재정렬되므로
  // 입력 배열의 원래 순서와 무관하게 항상 올바른 시간순 대화를 구성한다.
  function filterByTurnRange(messages, startTurn, endTurn) {
    const pat = buildTurnRegex();
    const turns = messages.map(m => {
      const match = m.content.match(pat);
      return match && match[1] ? parseInt(match[1], 10) : null;
    });
    for (let i = 1; i < turns.length; i++) {
      if (turns[i] == null) turns[i] = turns[i - 1];
    }
    for (let i = turns.length - 2; i >= 0; i--) {
      if (turns[i] == null) turns[i] = turns[i + 1];
    }
    return messages
      .map((m, i) => ({ ...m, _turn: turns[i] }))
      .filter(m => m._turn != null && m._turn >= startTurn && m._turn <= endTurn)
      .sort((a, b) => (a._turn - b._turn) || (a.role === 'user' ? -1 : 1));
  }

  // =============================================
  //  3-1: Gemini API 호출
  // =============================================
  async function callGemini(prompt) {
    const s = loadSettings();
    if (!s.geminiKey) { warn('Gemini API 키 없음'); return null; }

    // system_instruction 분리: Gemini가 user turn이 아닌 시스템 지시로 인식
    const [sysPrompt, userPrompt] = prompt.split('\n\n===대화===\n');
    const body = {
      system_instruction: sysPrompt
        ? { parts: [{ text: sysPrompt.trim() }] }
        : undefined,
      safetySettings: [
        { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
        { category: 'HARM_CATEGORY_CIVIC_INTEGRITY',   threshold: 'BLOCK_NONE' },
      ],
      contents: [{ role: 'user', parts: [{ text: (userPrompt ?? prompt).trim() }] }],
    };
    if (!body.system_instruction) delete body.system_instruction;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${s.geminiModel}:generateContent?key=${s.geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) { warn('Gemini 오류:', res.status, await res.text()); return null; }
      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) { warn('Gemini 빈 응답'); return null; }
      return text.trim();
    } catch (e) { warn('Gemini 호출 예외:', e); return null; }
  }

  // =============================================
  //  3-3: 턴 번호 추출 ([T #N] 파싱)
  //  — turnNotation 설정값을 정규식으로 사용 (미설정 시 기본 패턴 적용)
  //  — 캡처 그룹 1이 숫자여야 함: 예) \[T #(\d+)\]
  // =============================================
  function buildTurnRegex(flags) {
    const s = loadSettings();
    let src = (s.turnNotation && s.turnNotation.trim())
      ? s.turnNotation.trim()
      : '\\[T\\s*#(\\d+)\\]';
    // literal 'd+' / 'd*' (백슬래시 없이 입력된 경우) → '(\d+)' / '(\d*)' 로 보정
    src = src.replace(/(?<!\\)\bd\+/g, '(\\d+)').replace(/(?<!\\)\bd\*/g, '(\\d*)');
    // 캡처 그룹 없으면 \d+ / \d* 을 자동으로 그룹화
    if (!/\(/.test(src)) {
      src = src.replace(/\\d[+*]/, '($&)');
    }
    try {
      return new RegExp(src, flags || '');
    } catch (e) {
      warn('턴 표기 정규식 오류, 기본값으로 복귀:', e.message);
      return new RegExp('\\[T\\s*#(\\d+)\\]', flags || '');
    }
  }

  // 사용자 패턴 실패 시 사용할 내장 폴백 패턴 목록
  const TURN_FALLBACK_PATTERNS = [
    /\[T\s*#(\d+)\]/g,          // 기본 [T #N]
    /턴수\s*[:\s]\s*(\d+)/g,    // 대화 턴수 : N
    /턴\s*[:\s]\s*(\d+)/g,      // 턴 : N
  ];

  function extractTurnNumber(messages) {
    const pat  = buildTurnRegex();
    const patG = buildTurnRegex('g');
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i].content.match(pat);
      if (m) return parseInt(m[1] ?? m[0].match(/\d+/)?.[0] ?? '0', 10);
    }
    const bodyText = document.body.innerText;

    // 1순위: 사용자 설정 패턴
    const domMatch = bodyText.match(patG);
    if (domMatch) {
      const nums = domMatch.map(raw => {
        const cap = raw.match(pat);
        return cap ? parseInt(cap[1] ?? raw.match(/\d+/)?.[0] ?? '0', 10) : 0;
      }).filter(n => n > 0);
      if (nums.length > 0) return Math.max(...nums);
    }

    // 2순위: 내장 폴백 패턴 (사용자 패턴이 숫자를 찾지 못한 경우)
    for (const fp of TURN_FALLBACK_PATTERNS) {
      const matches = bodyText.match(fp);
      if (!matches) continue;
      const nums = matches.map(raw => {
        const m = raw.match(new RegExp(fp.source));
        return m && m[1] ? parseInt(m[1], 10) : 0;
      }).filter(n => n > 0);
      if (nums.length > 0) return Math.max(...nums);
    }

    return 0;
  }

  // =============================================
  //  3-3: 요약 생성 파이프라인
  // =============================================
  let isSummarizing            = false;
  let pendingSummaryAfterTurn  = 0;  // 3n 감지 후 다음 사이클에서 요약 실행 플래그

  // 기존 단기 기억 슬롯 중 가장 큰 endTurn (없으면 0)
  // — 다음 자동 요약이 "어디서부터" 이어서 시작해야 하는지의 기준점
  function lastSummarizedEndTurn() {
    const all = _loadSlots().filter(sl => sl.type === 'shortTerm');
    return all.reduce((max, sl) => Math.max(max, sl.endTurn ?? sl.startTurn ?? 0), 0);
  }

  async function generateSummary(forced = false) {
    const s = loadSettings();
    if (!s.autoSummary || !s.geminiKey) return;
    if (isSummarizing) { log('요약 중 — 스킵'); return; }

    const domTurn = extractTurnNumber([]);
    if (domTurn === 0) {
      log('요약 스킵 — 턴 표기를 찾을 수 없음 (설정의 턴 표기 패턴 확인)');
      return;
    }

    // forced=false 이면 기존 방식대로 트리거 턴(4,7,10...)인지 먼저 확인
    if (!forced) {
      const si = s.summaryInterval ?? 3;
      if (domTurn < si + 1 || (domTurn - 1) % si !== 0) {
        const rem = si - ((domTurn - 1) % si);
        const next = domTurn + rem;
        log(`요약 스킵 — 현재 T#${domTurn} (다음 요약: T#${next})`);
        return;
      }
    }

    // ── 요약 대상 구간 계산 ──
    // 고정 크기 메시지 윈도우 대신, "마지막 요약이 끝난 지점 +1" ~ "현재턴-1(+추가제외)"
    // 구간을 직접 계산한다. 3n 트리거 타이밍이 약간 어긋나도 항상 이전 요약의
    // 바로 다음 턴부터 이어지므로 중복(겹침)이나 공백이 발생하지 않는다.
    const targetStart = lastSummarizedEndTurn() + 1;
    const targetEnd    = domTurn - 1 - (s.excludeLastN ?? 0); // 가장 최근 턴(+추가제외분)은 항상 보존

    if (targetEnd < targetStart) {
      log(`요약 스킵 — 신규 구간 없음 (기존 요약 끝 T#${targetStart - 1}, 현재 T#${domTurn})`);
      return;
    }

    isSummarizing = true;
    try {
      log(`요약 시작 — T#${targetStart}~${targetEnd} (현재 T#${domTurn}${forced ? ', forced' : ''})`);

      const turnsNeeded = targetEnd - targetStart + 1;
      const fetched  = await fetchRecentMessages(turnsNeeded * 2 + 8);
      const messages = filterByTurnRange(fetched, targetStart, targetEnd);

      if (messages.length === 0) {
        warn(`요약 스킵 — T#${targetStart}~${targetEnd} 구간 메시지를 가져오지 못함`);
        return;
      }
      const foundTurns = messages.map(m => m._turn);
      if (Math.min(...foundTurns) > targetStart || Math.max(...foundTurns) < targetEnd) {
        warn(`T#${targetStart}~${targetEnd} 중 일부만 수집됨 (실제 T#${Math.min(...foundTurns)}~${Math.max(...foundTurns)}) — fetch 범위 부족 가능성`);
      }

      const dialogue = messages.map(m =>
        `[${m.role === 'user' ? '유저' : 'AI'}] ${m.content}`
      ).join('\n\n');
      const prompt   = `${s.summaryPrompt}\n\n===대화===\n${dialogue}`;
      const summary  = await callGemini(prompt);
      if (!summary) { warn('요약 생성 실패'); return; }

      // maxSlots 초과 시 가장 오래된 슬롯 제거
      const existing = activeSlots.filter(sl => sl.type === 'shortTerm');
      if (existing.length >= s.maxSlots) {
        existing.sort((a, b) => (a.endTurn ?? 0) - (b.endTurn ?? 0));
        removeSlot(existing[0].id);
      }

      addSlot({ id: `st-${Date.now()}`, startTurn: targetStart, endTurn: targetEnd, text: summary, type: 'shortTerm' });
      refreshSlotList();
      log(`요약 완료 — T#${targetStart}~${targetEnd} / ${summary.length}자`);
    } finally {
      isSummarizing = false;
    }
  }

  // 수동 요약: 턴 조건/중복 체크 없이 "현재 턴 기준 최신 summaryInterval 턴"을
  // 그대로 요약한다. 자동 요약의 최신 턴 제외(excludeLastN/EXCLUDE_CURRENT) 로직은
  // 의도적으로 빌려쓰지 않는다 — 수동 트리거는 사용자가 시점을 직접 통제하므로
  // "방금 턴은 아직 미숙성일 수 있어 제외"라는 자동 요약의 전제가 적용되지 않는다.
  async function generateSummaryManual() {
    const s = loadSettings();
    if (!s.geminiKey) { showToast('Gemini API 키가 설정되지 않았습니다'); return; }
    if (isSummarizing) { showToast('요약이 이미 진행 중입니다'); return; }

    isSummarizing = true;
    showToast('수동 요약 시작...');
    log('수동 요약 시작');
    try {
      const si = s.summaryInterval ?? 3;

      const domTurn = extractTurnNumber([]);
      if (domTurn === 0) {
        showToast('현재 턴을 인식할 수 없습니다');
        warn('수동 요약 — 턴 표기를 찾을 수 없음');
        return;
      }

      // 현재 턴을 포함한 가장 최근 si턴 (예: si=3, domTurn=3 → T#1~T#3)
      const targetEnd   = domTurn;
      const targetStart = Math.max(1, domTurn - si + 1);

      const turnsNeeded = targetEnd - targetStart + 1;
      const fetched  = await fetchRecentMessages(turnsNeeded * 2 + 8);
      const messages = filterByTurnRange(fetched, targetStart, targetEnd);

      if (messages.length === 0) { showToast('요약할 메시지 없음'); return; }

      const foundTurns = messages.map(m => m._turn);
      if (Math.min(...foundTurns) > targetStart || Math.max(...foundTurns) < targetEnd) {
        warn(`T#${targetStart}~${targetEnd} 중 일부만 수집됨 (실제 T#${Math.min(...foundTurns)}~${Math.max(...foundTurns)}) — fetch 범위 부족 가능성`);
      }

      const dialogue = messages.map(m =>
        `[${m.role === 'user' ? '유저' : 'AI'}] ${m.content}`
      ).join('\n\n');
      const prompt   = `${s.summaryPrompt}\n\n===대화===\n${dialogue}`;
      const summary  = await callGemini(prompt);
      if (!summary) { showToast('Gemini 응답 없음'); warn('수동 요약 생성 실패'); return; }

      const existing = activeSlots.filter(sl => sl.type === 'shortTerm');
      if (existing.length >= s.maxSlots) {
        existing.sort((a, b) => (a.endTurn ?? 0) - (b.endTurn ?? 0));
        removeSlot(existing[0].id);
      }
      addSlot({ id: `st-manual-${Date.now()}`, startTurn: targetStart, endTurn: targetEnd, text: summary, type: 'shortTerm' });
      refreshSlotList();
      showToast('수동 요약 완료');
      log(`수동 요약 완료 — T#${targetStart}~${targetEnd} / ${summary.length}자`);
    } catch (e) {
      showToast('수동 요약 실패: ' + e.message);
      warn('수동 요약 오류:', e.message);
    } finally {
      isSummarizing = false;
    }
  }

  // =============================================
  //  3-3: AI 응답 완료 감지 (폴링 기반 안정화)
  //  — send 버튼 disabled→enabled : '탐색 개시' 신호 (TipTap에서 스트리밍 중간에도 발생 가능)
  //  ✅ 신 방식: DOM의 턴 번호 증가를 1초 간격으로 직접 감시
  //     → 버튼 disabled 어트리뷰트 미변경(CSS 클래스/React 상태 관리) 환경에서도 동작
  // =============================================
  let sendBtnObserver = null;  // teardown 하위 호환용 stub
  let pollTimer       = null;  // 안정화 폴링 타이머
  let watchTimer      = null;  // 항시 턴 감시 타이머
  let lastKnownTurn   = 0;     // 기준선 턴 번호

  // ── 안정화 폴링: 새 턴 감지 후 스트리밍 완료 확인 ──
  function startStableTurnPoll(detectedTurn) {
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }

    let lastTurn  = detectedTurn;
    let stableCnt = 0;

    function poll() {
      const turn = extractTurnNumber([]);

      if (turn < lastTurn) {
        // 렌더 아직 미완성 — 대기
        pollTimer = setTimeout(poll, 400);
        return;
      }
      if (turn > lastTurn) {
        lastTurn  = turn;
        stableCnt = 0;
        log(`안정화 폴링 중 더 높은 턴 감지: T#${turn}`);
      } else {
        stableCnt++;
        log(`턴 안정화 대기 T#${turn} (${stableCnt}/2)`);
      }

      if (stableCnt >= 2) {
        lastKnownTurn = turn;

        // ── 3n 플래그 방식 ──
        // Case A: 이전 3n 턴 이후 첫 신규 완료 사이클 → 요약 실행
        if (pendingSummaryAfterTurn > 0 && turn > pendingSummaryAfterTurn) {
          log(`T#${turn} 완료 감지 (T#${pendingSummaryAfterTurn} 이후 첫 신규) → 요약 강제 실행`);
          pendingSummaryAfterTurn = 0;
          generateSummary(true);
          return;
        }

        // Case B: 현재 턴이 3의 배수 → 다음 사이클 완료 시 요약 예약
        const _si = loadSettings().summaryInterval ?? 3;
        if (turn > 0 && turn % _si === 0) {
          pendingSummaryAfterTurn = turn;
          log(`T#${turn} (3n) 감지 → 다음 사이클 완료 시 요약 예정`);
          return;
        }

        // Case C: 3n도 아니고 플래그도 없음 → 기존 방식으로 조건 확인 (폴백)
        log(`T#${turn} 안정화 — 요약 조건 확인`);
        generateSummary(false);
        return;
      }

      pollTimer = setTimeout(poll, 500);
    }

    pollTimer = setTimeout(poll, 600);
    log(`T#${detectedTurn} 안정화 대기 시작`);
  }

  // ── 항시 턴 감시 루프 (1초 간격) ──
  function startTurnWatch() {
    if (watchTimer) return;
    lastKnownTurn = extractTurnNumber([]);
    log(`항시 턴 감시 시작 — 현재 T#${lastKnownTurn}`);

    // 초기화 시점에 이미 요약 대상 턴이거나 3n 턴인 경우 즉시 처리
    if (lastKnownTurn > 0) {
      const _initSI = loadSettings().summaryInterval ?? 3;
      if (lastKnownTurn >= _initSI + 1 && (lastKnownTurn - 1) % _initSI === 0) {
        // T#4, T#7, T#10... — 페이지 재로드로 요약 사이클을 놓친 경우
        log(`초기화 — T#${lastKnownTurn} 요약 대상 턴 감지 → 2초 후 요약 시도`);
        setTimeout(() => generateSummary(false), 2000);
      } else if (lastKnownTurn % _initSI === 0) {
        // T#3, T#6, T#9... — 다음 사이클에서 요약 예약
        log(`초기화 — T#${lastKnownTurn} (3n 턴) → 다음 사이클 완료 시 요약 예정`);
        pendingSummaryAfterTurn = lastKnownTurn;
      }
    }

    function watch() {
      const turn = extractTurnNumber([]);
      if (turn > lastKnownTurn) {
        log(`새 턴 감지: T#${lastKnownTurn} → T#${turn}`);
        startStableTurnPoll(turn);
        lastKnownTurn = turn;
      }
      watchTimer = setTimeout(watch, 1000);
    }

    watchTimer = setTimeout(watch, 1000);
  }

  function attachResponseDetector() {
    startTurnWatch();
    // 버튼 감시 stub — teardown 호환
    sendBtnObserver = { disconnect: () => {
      if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
    }};
    log('응답 완료 감지 시작 (항시 턴 감시 모드)');
  }

  function parsePath() {
    const m = location.pathname.match(/\/stories\/([^/]+)\/episodes\/([^/]+)/);
    if (!m) return null;
    return { storyId: m[1], chatId: m[2] };
  }
  function isChattingPage() { return !!parsePath(); }

  function waitForElement(selectors, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const find = () => {
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el) return el;
        }
        return null;
      };
      const found = find();
      if (found) return resolve(found);
      const observer = new MutationObserver(() => {
        const el = find();
        if (el) { observer.disconnect(); clearTimeout(timer); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`timeout: ${selectors.join(', ')}`));
      }, timeout);
    });
  }

  // ─────────────────────────────────────────────
  //  ProseMirror EditorView 직접 접근 (pmViewDesc 경로)
  //  참조 스크립트의 HTMLTextAreaElement.prototype.value.set 와 동등한 레벨:
  //  TipTap 레이어를 우회, ProseMirror 내부 상태에 직접 트랜잭션 디스패치
  // ─────────────────────────────────────────────
  function getProseMirrorView(el) {
    // ProseMirror는 루트 DOM 노드에 pmViewDesc 를 설정하고
    // pmViewDesc.view 로 EditorView 에 역참조 가능
    try {
      if (el.pmViewDesc && el.pmViewDesc.view) {
        const v = el.pmViewDesc.view;
        if (typeof v.dispatch === 'function' && v.state) return v;
      }
    } catch (e) {}
    // 폴백: 엘리먼트 프로퍼티 스캔
    for (const key of Object.keys(el)) {
      try {
        const val = el[key];
        if (val && typeof val.dispatch === 'function' && val.state && val.state.doc) return val;
      } catch (e) {}
    }
    return null;
  }

  // ─────────────────────────────────────────────
  //  TipTap 에디터 인스턴스 탐색 (React fiber 경로)
  //  execCommand는 DOM만 변경하고 React/TipTap 내부 state를 건드리지 못해
  //  메시지가 채팅창에 표시되지 않는 문제가 발생함 → editor.commands API 직접 사용
  // ─────────────────────────────────────────────
  function findTipTapEditor(el) {
    const fiberKey = Object.keys(el).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    if (!fiberKey) return null;
    let fiber = el[fiberKey];
    let depth = 0;
    while (fiber && depth < 40) {
      const props = fiber.memoizedProps || fiber.pendingProps;
      if (props && props.editor &&
          typeof props.editor.commands === 'object' &&
          typeof props.editor.commands.insertContent === 'function') {
        return props.editor;
      }
      fiber = fiber.return;
      depth++;
    }
    return null;
  }

  function setReactValue(el, value) {
    // detached 엘리먼트 조기 감지
    if (!el || !document.contains(el)) {
      warn('setReactValue: 대상 엘리먼트가 DOM에 없음 — 스킵');
      return;
    }
    // ── TipTap / ProseMirror contenteditable div 처리 ──
    if (el.contentEditable === 'true') {
      // 1순위: TipTap editor.commands API (React state까지 올바르게 갱신)
      const editor = findTipTapEditor(el);
      if (editor) {
        try {
          if (!value) {
            editor.commands.clearContent(true);
          } else {
            // insertContent는 첫 \n에서 단락이 잘리므로 setContent로 전체 교체
            const lines = value.split('\n');
            const paragraphs = lines.map(line =>
              line.length > 0
                ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
                : { type: 'paragraph' }
            );
            editor.commands.setContent({ type: 'doc', content: paragraphs }, true);
          }
          editor.commands.focus('end');
          return;
        } catch (e) {
          warn('TipTap editor.commands 실패, execCommand 폴백:', e.message);
        }
      }
      // 2순위: ProseMirror EditorView 직접 트랜잭션 디스패치
      //  — 참조 스크립트의 HTMLTextAreaElement nativeSetter 와 동등한 레벨
      const pmView = getProseMirrorView(el);
      if (pmView) {
        try {
          const { state: { schema, tr }, dispatch } = pmView;
          const currSize = pmView.state.doc.content.size;
          if (!value) {
            dispatch(tr.replaceWith(0, currSize, schema.nodes.paragraph.create()));
          } else {
            const nodes = value.split('\n').map(line =>
              line.length > 0
                ? schema.nodes.paragraph.create(null, [schema.text(line)])
                : schema.nodes.paragraph.create()
            );
            // 배열 직접 전달 시 구버전 ProseMirror 에서 실패 → Fragment(.content) 로 감싸기
            const fragment = schema.nodes.doc.create(null, nodes).content;
            dispatch(tr.replaceWith(0, currSize, fragment));
          }
          return;
        } catch (e) {
          warn('ProseMirror dispatch 실패, paste 폴백:', e.message);
        }
      }

      // 3순위: ClipboardEvent(paste) 폴백
      // opacity:0 숨김 요소에서 execCommand('selectAll')이 실패해
      // paste가 대체 아닌 삽입으로 작동하는 문제 방지:
      // → paste 전 ProseMirror 뷰가 있으면 직접 초기화 후 paste
      const pmFb = getProseMirrorView(el);
      if (pmFb) {
        try {
          const { state: { schema: schFb, tr: trFb }, dispatch: dispFb } = pmFb;
          dispFb(trFb.replaceWith(0, pmFb.state.doc.content.size, schFb.nodes.paragraph.create()));
        } catch (_) {}
      }
      el.focus();
      document.execCommand('selectAll', false, null);
      if (!value) {
        document.execCommand('delete', false, null);
      } else {
        try {
          const dt = new DataTransfer();
          dt.setData('text/plain', value);
          el.dispatchEvent(new ClipboardEvent('paste', {
            bubbles: true, cancelable: true, clipboardData: dt,
          }));
        } catch (e2) {
          document.execCommand('insertText', false, value);
        }
      }
      return;
    }
    // ── 구버전 <textarea> 폴백 ──
    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype, 'value'
    ).set;
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // =============================================
  //  실제 전송 버튼 탐색
  //  — textarea 조상을 최대 6단계 올라가며 탐색
  // =============================================
  function findSendButton(realTA) {
    let node = realTA.parentElement;
    for (let i = 0; i < 6; i++) {
      if (!node) break;
      const btn = node.querySelector(SEND_BTN_SELECTOR);
      if (btn) return btn;
      node = node.parentElement;
    }
    return null;
  }

  // Radix UI 등 일부 컴포넌트는 pointerdown/mousedown 시점에 반응하고
  // 단순 .click() 호출에는 응답하지 않는 경우가 있다(Radix Tabs와 동일 패턴).
  // 실제 마우스 클릭과 동일한 이벤트 시퀀스를 순서대로 발생시켜 안전하게 트리거한다.
  function dispatchFullClick(el) {
    const opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  // =============================================
  //  핵심 상태
  // =============================================
  let currentTextarea = null;
  let realSendBtn     = null;
  let fakeTextarea    = null;
  let fakeSendBtn     = null;
  let counterEl       = null;
  let overlayBox      = null;   // 전체 오버레이 컨테이너
  let btnBlocker      = null;   // 하단 버튼 행 클릭 차단막
  let rafId           = null;
  let fakeTAHeight    = MIN_TA_H; // 현재 fakeTA 콘텐츠 높이 (auto-resize)
  let reInitCooldown  = false;
  let realTASyncObserver  = null; // 실제 TA(단축어 삽입 등) 변경 감지용
  let realTASyncDebounce  = null;
  let taSyncSuppressed    = false; // true인 동안은 우리 자신이 쓴 변경이므로 동기화 무시
  const injectedNodes = [];

  // =============================================
  //  카운터 렌더 (박스 내부 우상단)
  // =============================================
  function renderCounter() {
    if (!counterEl || !fakeTextarea) return;
    const userLen   = fakeTextarea.value.length;
    const avail     = MAX_CHARS - reservedChars;
    const remaining = avail - userLen;

    let state;
    if (remaining < 0)        state = 'over';
    else if (remaining < 100) state = 'danger';
    else if (remaining < 300) state = 'warn';
    else                      state = 'ok';

    const color = {
      ok:     'rgba(238,240,255,0.35)',
      warn:   '#f5a623',
      danger: '#e8523a',
      over:   '#e8523a',
    }[state];

    let label = reservedChars > 0
      ? `${userLen}<span class="cs-reserved"> + ${reservedChars}(요약)</span> / ${MAX_CHARS}`
      : `${userLen} / ${MAX_CHARS}`;

    if (state === 'over') label = `⚠ ${Math.abs(remaining)}자 초과 — ` + label;

    counterEl.innerHTML   = label;
    counterEl.style.color = color;
  }

  // =============================================
  //  CSS 주입
  // =============================================
  function injectStyle() {
    if (document.getElementById('cs-style')) return;
    const style = document.createElement('style');
    style.id = 'cs-style';
    style.textContent = `
      /* 전체 오버레이 박스 */
      #cs-overlay-box {
        position: fixed !important;
        z-index: 900 !important;
        background: #13131f !important;
        border: 1px solid rgba(255,255,255,.12) !important;
        border-radius: 12px !important;
        box-sizing: border-box !important;
        overflow: hidden !important;
        pointer-events: none !important;
        display: flex !important;
        flex-direction: column !important;
      }

      /* 탭바 */
      #cs-tab-bar {
        flex-shrink: 0 !important;
        pointer-events: auto !important;
      }
      .cs-tab-btn:focus { outline: none !important; }
      #cs-collapse-btn:focus { outline: none !important; }

      /* 패널 컨텐츠 */
      #cs-panel-content {
        flex-shrink: 0 !important;
      }

      /* 가짜 textarea */
      #cs-fake-textarea {
        position: absolute !important;
        background: transparent !important;
        color: #eef0ff !important;
        caret-color: #7c74ff !important;
        border: none !important;
        outline: none !important;
        resize: none !important;
        overflow-y: hidden !important;   /* autoResizeFakeTA가 동적 전환 */
        box-sizing: border-box !important;
        pointer-events: auto !important;
        z-index: 1 !important;
      }
      #cs-fake-textarea::placeholder { color: rgba(238,240,255,0.35) !important; }

      /* 카운터 — 탭바 바로 아래 우상단 (top은 syncPosition이 동적 설정) */
      #cs-counter {
        position: fixed !important;
        font-size: 10px !important;
        color: rgba(238,240,255,0.35) !important;
        transition: color 0.2s !important;
        user-select: none !important;
        pointer-events: none !important;
        letter-spacing: 0.3px !important;
        z-index: 901 !important;
        line-height: 1 !important;
      }
      #cs-counter .cs-reserved { opacity: 0.7; font-style: italic; }

      /* 패널 내부 인터랙티브 요소 — overlay의 pointer-events:none 상속 차단 */
      #cs-panel-content,
      #cs-panel-content * {
        pointer-events: auto !important;
      }
      #cs-tab-bar {
        pointer-events: auto !important;
      }
      #cs-tab-bar * {
        pointer-events: auto !important;
      }

      /* 하단 버튼 행 차단막
         — overlayBox(900)보다 낮은 899로 설정. 902였을 때는 overlayBox
           내부의 cs-send-btn/cs-fake-textarea/cs-slash-btn(전부 overlayBox의
           900 스택 안에 갇혀 있어 902를 넘어설 수 없음)이 클릭을 빼앗겨
           버튼이 눌리지 않는 문제가 있었음. 차단 대상인 플랫폼 네이티브
           요소는 z-index가 없거나 매우 낮으므로 899로도 충분히 위에 위치함. */
      #cs-btn-blocker {
        position: fixed !important;
        z-index: 899 !important;
        background: transparent !important;
        pointer-events: auto !important;
        cursor: default !important;
      }

      /* 전송 버튼 */
      #cs-send-btn {
        position: absolute !important;
        bottom: 10px !important;
        right: 10px !important;
        width: 36px !important;
        height: 36px !important;
        border-radius: 50% !important;
        background: #7c74ff !important;
        border: none !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        pointer-events: auto !important;
        z-index: 2 !important;
        transition: background 0.15s !important;
        padding: 0 !important;
      }
      #cs-send-btn:hover  { background: #9490ff !important; }
      #cs-send-btn:active { background: #5c55d4 !important; }
      #cs-send-btn svg { pointer-events: none !important; }

      /* 단축어(슬래시) 버튼 */
      #cs-slash-btn {
        position: absolute !important;
        bottom: 10px !important;
        left: 10px !important;
        width: 28px !important;
        height: 28px !important;
        border-radius: 50% !important;
        background: transparent !important;
        border: 1px solid rgba(238,240,255,0.18) !important;
        color: rgba(238,240,255,0.55) !important;
        cursor: pointer !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        pointer-events: auto !important;
        z-index: 2 !important;
        font-size: 14px !important;
        font-weight: 700 !important;
        line-height: 1 !important;
        transition: background 0.15s, color 0.15s, border-color 0.15s !important;
        padding: 0 !important;
      }
      #cs-slash-btn:hover {
        background: rgba(124,116,255,0.18) !important;
        border-color: #7c74ff !important;
        color: #eef0ff !important;
      }

      /* 단축어 팝업이 오버레이 아래 묻히지 않도록 z-index 강제 상승 */
      [data-slash-command-suggestion-popup] {
        z-index: 905 !important;
      }

      /* 플랫폼 네이티브 "가장 오래된/최신 메시지로 이동" 버튼이
         우리 오버레이(z-index 900~906)에 가려 보이지 않는 문제 — z-index 강제 상승.
         클래스명에 Tailwind 임의값 브래킷(z-[3])이 포함돼 있어 일반 클래스
         셀렉터 대신 부분일치 속성 셀렉터로 안전하게 타겟팅한다. */
      div[class*="z-[3]"][class*="pointer-events-none"][class*="flex-col"] {
        z-index: 950 !important;
      }
    `;
    document.head.appendChild(style);
    injectedNodes.push(style);
  }


  // =============================================
  //  4: 메뉴 UI
  //  구조:
  //   [cs-menu-btn]  — fixed 우하단 토글 버튼
  //   [cs-panel]     — fixed 패널 (탭: 요약목록 | API/프롬프트 | 설정)
  //     [cs-tab-bar]
  //     [cs-tab-content]
  // =============================================

  let panelEl    = null;   // 컨텐츠 영역 (cs-panel-content)
  let menuBtnEl  = null;   // 접기/펼치기 버튼 (cs-collapse-btn)
  let panelOpen  = false;

  // ── 탭 전환 ──
  function switchTab(tabId) {
    panelEl.querySelectorAll('.cs-tab-btn').forEach(b => {
      b.style.color      = b.dataset.tab === tabId ? '#eef0ff' : 'rgba(238,240,255,0.45)';
      b.style.borderBottom = b.dataset.tab === tabId
        ? '2px solid #7c74ff' : '2px solid transparent';
    });
    panelEl.querySelectorAll('.cs-tab-pane').forEach(p => {
      p.style.display = p.dataset.tab === tabId ? 'block' : 'none';
    });
    // 4. 요약 목록 탭 전환 시 항상 최신 목록 렌더
    if (tabId === 'summary') refreshSlotList();
  }

  // ── API/프롬프트 탭 저장 ──
  function saveApiTab() {
    const keyEl    = document.getElementById('cs-input-key');
    const modelEl  = document.getElementById('cs-input-model');
    const turnEl   = document.getElementById('cs-input-turn');
    const promptEl = document.getElementById('cs-input-prompt');
    log(`saveApiTab 호출 — 엘리먼트 감지: key=${!!keyEl} model=${!!modelEl} turn=${!!turnEl} prompt=${!!promptEl}`);
    const key    = keyEl?.value.trim()    ?? '';
    const model  = modelEl?.value.trim()  ?? '';
    const turn   = turnEl?.value.trim()   ?? '';
    const prompt = promptEl?.value.trim() ?? '';
    log(`저장값: model=${model}`);
    saveSettings({ geminiKey: key, geminiModel: model, turnNotation: turn, ...(prompt ? { summaryPrompt: prompt } : {}) });
    showToast('저장되었습니다');
  }

  // ── 간단 토스트 ──
  function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;

    // overlayBox가 화면에 있으면 그 위에 붙임, 없으면 기존 고정 위치 폴백
    let bottomPx = 90, rightPx = 24;
    if (overlayBox && document.contains(overlayBox)) {
      const r = overlayBox.getBoundingClientRect();
      if (r.width > 0) {
        bottomPx = window.innerHeight - r.top + 8;
        rightPx  = window.innerWidth  - r.right;
      }
    }

    t.style.cssText = `
      position:fixed; bottom:${bottomPx}px; right:${rightPx}px; z-index:906;
      background:#7c74ff; color:#fff; font-size:12px;
      padding:7px 14px; border-radius:8px;
      opacity:1; transition:opacity 0.4s; pointer-events:none;
      max-width: 320px;
    `;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 450); }, 1600);
  }

  // ── 슬롯 카드 렌더 (document.getElementById 기반 — DOM 이동 문제 없음) ──
  // currentTab: 요약목록 탭의 현재 선택 타입 ('shortTerm' | 'userNote')
  let slotListTab = 'shortTerm';

  function refreshSlotList() {
    const listEl = document.getElementById('cs-slot-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const filtered = activeSlots.filter(s => s.type === slotListTab);

    if (filtered.length === 0) {
      const msg = slotListTab === 'shortTerm' ? '등록된 단기 기억 없음' : slotListTab === 'message' ? '등록된 고정 메시지 없음' : '등록된 유저노트 없음';
      listEl.innerHTML = `<p style="color:rgba(238,240,255,0.35);font-size:11px;text-align:center;margin:16px 0;">${msg}</p>`;
      return;
    }

    filtered.forEach((slot, idx) => {
      // 구분선 (첫 항목 제외)
      if (idx > 0) {
        const hr = document.createElement('div');
        hr.style.cssText = 'border-top:1px solid rgba(255,255,255,.08); margin:0;';
        listEl.appendChild(hr);
      }

      const card = document.createElement('div');
      card.style.cssText = 'padding:8px 12px;';

      const typeLabel  = { shortTerm:'단기', longTerm:'장기', userNote:'노트', message:'메시지' }[slot.type] ?? slot.type;
      const typeColor  = slot.type === 'userNote' ? '#f5a623' : slot.type === 'message' ? '#4caf93' : '#7c74ff';
      // 6. userNote는 턴 표기 없음 / 5. 시작 턴·마지막 턴 표기
      const turnRange = (slot.type === 'userNote' || slot.type === 'message')
        ? ''
        : (slot.endTurn != null && slot.endTurn !== slot.startTurn)
          ? `시작 턴 ${slot.startTurn} ~ 마지막 턴 ${slot.endTurn}`
          : `T#${slot.startTurn}`;

      // 3. 체크박스(적용 여부) — slot.active가 false면 XML에서 제외
      const isActive = slot.active !== false;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <input type="checkbox" data-id="${slot.id}" ${isActive ? 'checked' : ''}
              style="width:13px; height:13px; cursor:pointer; accent-color:#7c74ff; pointer-events:auto;"/>
            <span style="color:${typeColor}; font-size:10px; font-weight:700; letter-spacing:.3px;">
              [${typeLabel}]${turnRange ? ' ' + turnRange : ''}
            </span>
          </div>
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:rgba(238,240,255,0.3); font-size:10px;">${slot.text.length}자</span>
            <button class="cs-edit-btn" data-id="${slot.id}"
              style="background:none; border:none; color:rgba(238,240,255,0.3);
                     cursor:pointer; font-size:11px; padding:0 1px; line-height:1;
                     transition:color .15s; pointer-events:auto;">✎</button>
            <button class="cs-del-btn" data-id="${slot.id}"
              style="background:none; border:none; color:rgba(238,240,255,0.3);
                     cursor:pointer; font-size:12px; padding:0; line-height:1;
                     transition:color .15s; pointer-events:auto;">✕</button>
          </div>
        </div>
        <div class="cs-preview" style="color:rgba(238,240,255,0.72); font-size:11px; line-height:1.5;
                    word-break:break-all;">
          ${slot.text.slice(0, 100)}${slot.text.length > 100 ? '…' : ''}
        </div>
        <div class="cs-edit-area" style="display:none; margin-top:6px;">
          <textarea class="cs-edit-ta"
            style="width:100%; box-sizing:border-box; background:#1a1a2e;
                   border:1px solid #7c74ff; border-radius:6px;
                   padding:6px 8px; color:#eef0ff; font-size:11px;
                   resize:none; outline:none; font-family:inherit;
                   pointer-events:auto;"
            rows="5">${slot.text}</textarea>
          <div style="display:flex; gap:6px; margin-top:5px; justify-content:flex-end;">
            <button class="cs-edit-cancel"
              style="padding:4px 10px; background:transparent; border:1px solid rgba(255,255,255,.2);
                     border-radius:6px; color:rgba(238,240,255,0.6); font-size:11px;
                     cursor:pointer; pointer-events:auto;">취소</button>
            <button class="cs-edit-save" data-id="${slot.id}"
              style="padding:4px 10px; background:#7c74ff; border:none;
                     border-radius:6px; color:#fff; font-size:11px;
                     cursor:pointer; pointer-events:auto;">저장</button>
          </div>
        </div>
      `;

      // 3. 체크박스 이벤트
      card.querySelector('input[type="checkbox"]').addEventListener('change', function() {
        const slot = activeSlots.find(s => s.id === this.dataset.id);
        if (slot) { slot.active = this.checked; _saveSlots(); _syncReserved(); }
      });

      // 삭제 버튼
      card.querySelector('.cs-del-btn').addEventListener('click', function() {
        removeSlot(this.dataset.id);
        refreshSlotList();
      });
      card.querySelector('.cs-del-btn').addEventListener('mouseenter', function() { this.style.color = '#e8523a'; });
      card.querySelector('.cs-del-btn').addEventListener('mouseleave', function() { this.style.color = 'rgba(238,240,255,0.3)'; });

      // 편집 버튼 — 미리보기 숨기고 편집 영역 표시
      card.querySelector('.cs-edit-btn').addEventListener('click', function() {
        const preview  = card.querySelector('.cs-preview');
        const editArea = card.querySelector('.cs-edit-area');
        const isEditing = editArea.style.display !== 'none';
        preview.style.display  = isEditing ? 'block' : 'none';
        editArea.style.display = isEditing ? 'none'  : 'block';
        this.style.color = isEditing ? 'rgba(238,240,255,0.3)' : '#7c74ff';
        if (!isEditing) card.querySelector('.cs-edit-ta').focus();
      });
      card.querySelector('.cs-edit-btn').addEventListener('mouseenter', function() { this.style.color = '#7c74ff'; });
      card.querySelector('.cs-edit-btn').addEventListener('mouseleave', function() {
        const isEditing = card.querySelector('.cs-edit-area').style.display !== 'none';
        if (!isEditing) this.style.color = 'rgba(238,240,255,0.3)';
      });

      // 편집 취소
      card.querySelector('.cs-edit-cancel').addEventListener('click', () => {
        card.querySelector('.cs-preview').style.display  = 'block';
        card.querySelector('.cs-edit-area').style.display = 'none';
        card.querySelector('.cs-edit-btn').style.color   = 'rgba(238,240,255,0.3)';
        card.querySelector('.cs-edit-ta').value = slot.text; // 원복
      });

      // 편집 저장
      card.querySelector('.cs-edit-save').addEventListener('click', function() {
        const newText = card.querySelector('.cs-edit-ta').value.trim();
        if (!newText) { showToast('내용을 입력하세요'); return; }
        updateSlot(this.dataset.id, newText);
        refreshSlotList();
      });

      listEl.appendChild(card);
    });
  }

  // ── 탭바 + 컨텐츠를 overlayBox 상단에 마운트 ──
  // ── 탭바 + 컨텐츠를 overlayBox 상단에 마운트 ──
  function mountMenuUI() {
    // 탭바 행
    const tabBar = document.createElement('div');
    tabBar.id = 'cs-tab-bar';
    tabBar.style.cssText = `
      display: flex; align-items: center;
      height: ${TAB_BAR_H}px; flex-shrink: 0;
      border-bottom: 1px solid rgba(255,255,255,.1);
      box-sizing: border-box;
      pointer-events: auto;
    `;

    // 탭 버튼 3개
    const TABS = [
      { id: 'summary', label: '요약 목록' },
      { id: 'api',     label: 'API / 프롬프트' },
      { id: 'config',  label: '설정' },
    ];
    TABS.forEach(({ id, label }) => {
      const btn = document.createElement('button');
      btn.className    = 'cs-tab-btn';
      btn.dataset.tab  = id;
      btn.textContent  = label;
      btn.style.cssText = `
        flex: 1; height: 100%; background: none; border: none;
        border-bottom: 2px solid transparent;
        color: rgba(238,240,255,0.45); font-size: 11px;
        cursor: pointer; transition: all .15s; padding: 0;
      `;
      btn.addEventListener('click', () => {
        // 닫혀 있으면 열기, 같은 탭 재클릭이면 닫기
        const isSameTab = panelOpen
          && panelEl && panelEl.querySelector('.cs-tab-pane[data-tab="' + id + '"]')?.style.display !== 'none';
        if (isSameTab) {
          collapsePanel();
        } else {
          expandPanel();
          switchTab(id);
        }
      });
      btn.addEventListener('mouseenter', () => {
        if (btn.style.borderBottomColor !== 'rgb(124, 116, 255)')
          btn.style.color = 'rgba(238,240,255,0.75)';
      });
      btn.addEventListener('mouseleave', () => {
        if (btn.style.borderBottomColor !== 'rgb(124, 116, 255)')
          btn.style.color = 'rgba(238,240,255,0.45)';
      });
      tabBar.appendChild(btn);
    });

    // 접기/펼치기 버튼 (우측)
    menuBtnEl = document.createElement('button');
    menuBtnEl.id = 'cs-collapse-btn';
    menuBtnEl.title = '패널 접기/펼치기';
    menuBtnEl.innerHTML = COLLAPSE_ICON_UP;
    menuBtnEl.style.cssText = `
      width: 32px; height: 100%; background: none; border: none;
      color: rgba(238,240,255,0.5); cursor: pointer; font-size: 13px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; padding: 0;
      transition: color .15s; pointer-events: auto;
    `;
    menuBtnEl.addEventListener('click', togglePanel);
    menuBtnEl.addEventListener('mouseenter', () => {
      menuBtnEl.style.color = '#eef0ff';
    });
    menuBtnEl.addEventListener('mouseleave', () => {
      menuBtnEl.style.color = 'rgba(238,240,255,0.5)';
    });
    tabBar.appendChild(menuBtnEl);

    // ── 컨텐츠 영역: pane 3개를 여기서 직접 조립 ──
    const contentWrap = document.createElement('div');
    contentWrap.id = 'cs-panel-content';
    contentWrap.style.cssText = `
      height: ${CONTENT_H}px; overflow-y: auto; display: none;
      box-sizing: border-box; padding: 0;
      pointer-events: auto !important;
    `;

    // ── 요약 목록 pane ──
    const paneSum = document.createElement('div');
    paneSum.className = 'cs-tab-pane';
    paneSum.dataset.tab = 'summary';
    paneSum.style.display = 'none';
    paneSum.style.cssText += 'padding: 12px; pointer-events: auto !important;';
    paneSum.innerHTML = `
      <div style="display:flex; flex-direction:column; gap:7px; margin-bottom:10px;">

        <!-- 타입 선택 -->
        <div id="cs-type-toggle" style="display:flex; gap:6px;">
          <button data-type="shortTerm"
            style="flex:1; padding:6px 0; font-size:11px; border-radius:6px; cursor:pointer;
                   border:1px solid #7c74ff; background:#7c74ff; color:#fff; transition:all .15s;
                   pointer-events:auto;">단기 기억</button>
          <button data-type="userNote"
            style="flex:1; padding:6px 0; font-size:11px; border-radius:6px; cursor:pointer;
                   border:1px solid rgba(255,255,255,.15); background:transparent;
                   color:rgba(238,240,255,0.55); transition:all .15s; pointer-events:auto;">유저 노트</button>
          <button data-type="message"
            style="flex:1; padding:6px 0; font-size:11px; border-radius:6px; cursor:pointer;
                   border:1px solid rgba(255,255,255,.15); background:transparent;
                   color:rgba(238,240,255,0.55); transition:all .15s; pointer-events:auto;">메시지</button>
        </div>

        <!-- 수동 요약 버튼 (shortTerm 탭일 때만 표시) -->
        <button id="cs-btn-manual-summary"
          style="display:flex; align-items:center; justify-content:center; gap:5px;
                 width:100%; padding:6px 0; font-size:11px; border-radius:6px; cursor:pointer;
                 border:1px solid rgba(124,116,255,.5); background:rgba(124,116,255,.08);
                 color:rgba(124,116,255,.9); transition:all .15s; pointer-events:auto;">
          ✦ 지금 요약 (최신 N턴)
        </button>

        <!-- 턴 범위 (shortTerm일 때만 표시) -->
        <div id="cs-turn-row" style="display:flex; gap:6px; align-items:center;">
          <input id="cs-slot-start" type="number" min="0" placeholder="시작 턴"
            style="flex:1; background:#1e1e30; border:1px solid rgba(255,255,255,.15);
                   border-radius:7px; padding:6px 8px; color:#eef0ff; font-size:11px;
                   outline:none; box-sizing:border-box; pointer-events:auto;"/>
          <span style="color:rgba(238,240,255,0.4); font-size:11px;">~</span>
          <input id="cs-slot-end" type="number" min="0" placeholder="마지막 턴"
            style="flex:1; background:#1e1e30; border:1px solid rgba(255,255,255,.15);
                   border-radius:7px; padding:6px 8px; color:#eef0ff; font-size:11px;
                   outline:none; box-sizing:border-box; pointer-events:auto;"/>
          <span style="color:rgba(238,240,255,0.35); font-size:10px; white-space:nowrap;">턴 범위</span>
        </div>

        <!-- 내용 + 추가 버튼 -->
        <div style="display:flex; gap:6px; align-items:flex-end;">
          <textarea id="cs-slot-text" rows="2" placeholder="요약 내용 입력…"
            style="flex:1; background:#1e1e30; border:1px solid rgba(255,255,255,.15);
                   border-radius:7px; padding:6px 8px; color:#eef0ff; font-size:11px;
                   outline:none; resize:vertical; box-sizing:border-box;
                   font-family:inherit; pointer-events:auto;"></textarea>
          <button id="cs-slot-add"
            style="flex-shrink:0; padding:7px 11px; background:#7c74ff; border:none;
                   border-radius:7px; color:#fff; font-size:11px; cursor:pointer;
                   transition:background .15s; pointer-events:auto; align-self:flex-end;">추가</button>
        </div>
      </div>

      <!-- 고정 메시지 ⓘ 안내 (message 탭 선택 시만 표시) -->
      <div id="cs-message-hint" style="display:none; align-items:flex-start; gap:5px;
           padding:6px 8px; margin-bottom:4px;
           background:rgba(76,175,147,.08); border:1px solid rgba(76,175,147,.22);
           border-radius:6px;">
        <span style="color:#4caf93; font-size:13px; flex-shrink:0; line-height:1.4;">ⓘ</span>
        <span style="color:rgba(238,240,255,0.6); font-size:10.5px; line-height:1.5;">
          내용에 <code style="background:rgba(255,255,255,.1); border-radius:3px;
          padding:1px 4px; font-size:10px; color:#b0fcd9;">{T}</code> 를 입력하면
          전송 시 해당 메시지의 턴 번호로 자동 치환됩니다.
        </span>
      </div>

      <!-- 구분선 -->
      <div style="border-top:1px solid rgba(255,255,255,.08); margin: 0 -12px;"></div>

      <!-- 슬롯 목록 -->
      <div id="cs-slot-list"
        style="margin:0 -12px;
               scrollbar-width:thin; scrollbar-color:rgba(124,116,255,.4) transparent;">
      </div>
    `;

    // ── 타입 토글 이벤트 ──
    let selectedType = 'shortTerm';
    paneSum.querySelectorAll('#cs-type-toggle button').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedType = btn.dataset.type;
        slotListTab  = btn.dataset.type;   // 목록 필터 동기화
        const manualBtn = paneSum.querySelector('#cs-btn-manual-summary');
        if (manualBtn) manualBtn.style.display = slotListTab === 'shortTerm' ? 'flex' : 'none';
        paneSum.querySelectorAll('#cs-type-toggle button').forEach(b => {
          const isActive = b.dataset.type === selectedType;
          const activeColor = b.dataset.type === 'message' ? '#4caf93'
                            : b.dataset.type === 'userNote' ? '#f5a623' : '#7c74ff';
          b.style.background = isActive ? activeColor : 'transparent';
          b.style.border      = isActive ? `1px solid ${activeColor}` : '1px solid rgba(255,255,255,.15)';
          b.style.color       = isActive ? '#fff' : 'rgba(238,240,255,0.55)';
        });
        const turnRow = paneSum.querySelector('#cs-turn-row');
        if (turnRow) turnRow.style.display = selectedType === 'shortTerm' ? 'flex' : 'none';
        const msgHint = paneSum.querySelector('#cs-message-hint');
        if (msgHint) msgHint.style.display = selectedType === 'message' ? 'flex' : 'none';
        refreshSlotList();   // 필터 변경 즉시 목록 재렌더
      });
    });

    // ── 추가 버튼 이벤트 ──
    // 수동 요약 버튼 이벤트
    const manualSumBtn = paneSum.querySelector('#cs-btn-manual-summary');
    if (manualSumBtn) {
      manualSumBtn.addEventListener('click', () => generateSummaryManual());
      manualSumBtn.addEventListener('mouseenter', function() {
        this.style.background = 'rgba(124,116,255,.18)';
        this.style.borderColor = '#7c74ff';
      });
      manualSumBtn.addEventListener('mouseleave', function() {
        this.style.background = 'rgba(124,116,255,.08)';
        this.style.borderColor = 'rgba(124,116,255,.5)';
      });
    }

    const addBtn = paneSum.querySelector('#cs-slot-add');
    addBtn.addEventListener('click', () => {
      const text = paneSum.querySelector('#cs-slot-text').value.trim();
      if (!text) { showToast('내용을 입력하세요'); return; }
      const startTurn = parseInt(paneSum.querySelector('#cs-slot-start')?.value, 10) || 0;
      const endTurn   = parseInt(paneSum.querySelector('#cs-slot-end')?.value,   10) || startTurn;
      addSlot({ id: `manual-${Date.now()}`, startTurn, endTurn, text, type: selectedType });
      paneSum.querySelector('#cs-slot-text').value = '';
      paneSum.querySelector('#cs-slot-start').value = '';
      paneSum.querySelector('#cs-slot-end').value   = '';
      refreshSlotList();
    });
    addBtn.addEventListener('mouseenter', function() { this.style.background = '#9490ff'; });
    addBtn.addEventListener('mouseleave', function() { this.style.background = '#7c74ff'; });

    refreshSlotList();
    contentWrap.appendChild(paneSum);

    // ── API / 프롬프트 pane ──
    const s = loadSettings();
    const paneApi = document.createElement('div');
    paneApi.className = 'cs-tab-pane';
    paneApi.dataset.tab = 'api';
    paneApi.style.cssText = 'display:none; padding:14px 12px; pointer-events: auto !important;';
    paneApi.innerHTML = `
      <label style="display:block; margin-bottom:12px;">
        <span style="font-size:11px; color:rgba(238,240,255,0.55); display:block; margin-bottom:5px;">Gemini API 키</span>
        <input id="cs-input-key" type="password" placeholder="AIza…" value="${s.geminiKey}"
          style="width:100%; box-sizing:border-box; background:#1e1e30;
                 border:1px solid rgba(255,255,255,.15); border-radius:8px;
                 padding:8px 10px; color:#eef0ff; font-size:12px; outline:none;
                 font-family:monospace; pointer-events:auto;"/>
      </label>
      <label style="display:block; margin-bottom:12px;">
        <span style="font-size:11px; color:rgba(238,240,255,0.55); display:block; margin-bottom:5px;">모델</span>
        <select id="cs-input-model"
          style="width:100%; box-sizing:border-box; background:#1e1e30;
                 border:1px solid rgba(255,255,255,.15); border-radius:8px;
                 padding:8px 10px; color:#eef0ff; font-size:12px; outline:none;
                 pointer-events:auto; cursor:pointer; appearance:none;
                 background-image:url('data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22 viewBox=%220 0 10 6%22><path fill=%22rgba(238,240,255,0.5)%22 d=%22M0 0l5 6 5-6z%22/></svg>');
                 background-repeat:no-repeat; background-position:right 10px center;">
          <option value="gemini-2.5-flash" ${s.geminiModel==='gemini-2.5-flash'?'selected':''}>Gemini 2.5 Flash</option>
          <option value="gemini-2.5-pro"   ${s.geminiModel==='gemini-2.5-pro'  ?'selected':''}>Gemini 2.5 Pro</option>
          <option value="gemini-3-flash-preview" ${s.geminiModel==='gemini-3-flash-preview'?'selected':''}>Gemini 3 Flash (Preview)</option>
          <option value="gemini-3.1-flash-lite-preview" ${s.geminiModel==='gemini-3.1-flash-lite-preview'?'selected':''}>Gemini 3.1 Flash Lite</option>
          <option value="gemini-3.1-pro-preview"        ${s.geminiModel==='gemini-3.1-pro-preview'       ?'selected':''}>Gemini 3.1 Pro</option>
          <option value="gemini-3.5-flash" ${s.geminiModel==='gemini-3.5-flash'?'selected':''}>Gemini 3.5 flash</option>
        </select>
      </label>
      <label style="display:block; margin-bottom:16px;">
        <span style="font-size:11px; color:rgba(238,240,255,0.55); display:block; margin-bottom:5px;">
          턴 표기 식별 패턴 <span style="opacity:.6;">(기본: \[T #(\d+)\])</span>
        </span>
        <input id="cs-input-turn" type="text" placeholder="\[T #(\d+)\]" value="${s.turnNotation ?? ''}"
          style="width:100%; box-sizing:border-box; background:#1e1e30;
                 border:1px solid rgba(255,255,255,.15); border-radius:8px;
                 padding:8px 10px; color:#eef0ff; font-size:12px; outline:none;
                 font-family:monospace; pointer-events:auto;"/>
      </label>
      <label style="display:block; margin-bottom:16px;">
        <span style="font-size:11px; color:rgba(238,240,255,0.55); display:block; margin-bottom:5px;">
          요약 프롬프트
        </span>
        <textarea id="cs-input-prompt" rows="5"
          style="width:100%; box-sizing:border-box; background:#1e1e30;
                 border:1px solid rgba(255,255,255,.15); border-radius:8px;
                 padding:8px 10px; color:#eef0ff; font-size:11px; outline:none;
                 resize:vertical; font-family:inherit; line-height:1.5;
                 pointer-events:auto;"
        >${s.summaryPrompt ?? ''}</textarea>
      </label>
      <button id="cs-btn-save-api"
        style="width:100%; padding:9px; background:#7c74ff; border:none;
               border-radius:8px; color:#fff; font-size:12px; cursor:pointer;
               transition:background .15s; pointer-events:auto;">저장</button>
    `;

    paneApi.querySelector('#cs-btn-save-api').addEventListener('click', saveApiTab);
    paneApi.querySelector('#cs-btn-save-api').addEventListener('mouseenter', function() { this.style.background = '#9490ff'; });
    paneApi.querySelector('#cs-btn-save-api').addEventListener('mouseleave', function() { this.style.background = '#7c74ff'; });
    contentWrap.appendChild(paneApi);

    // ── 설정 pane ──
    const paneCfg = document.createElement('div');
    paneCfg.className = 'cs-tab-pane';
    paneCfg.dataset.tab = 'config';
    paneCfg.style.cssText = 'display:none; padding:14px 12px; pointer-events:auto !important; box-sizing:border-box;';

    // 헬퍼: 섹션 레이블
    function cfgLabel(text) {
      const el = document.createElement('p');
      el.textContent = text;
      el.style.cssText = 'font-size:10px; color:rgba(238,240,255,0.35); margin:0 0 8px; letter-spacing:.05em; text-transform:uppercase;';
      return el;
    }
    // 헬퍼: 구분선
    function cfgDivider() {
      const el = document.createElement('div');
      el.style.cssText = 'border-top:1px solid rgba(255,255,255,.08); margin:14px 0;';
      return el;
    }
    // 헬퍼: 토글 스위치
    function cfgToggle(key, label) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'font-size:12px; color:rgba(238,240,255,0.8);';
      const track = document.createElement('button');
      let val = loadSettings()[key] !== false;
      const thumb = document.createElement('div');
      thumb.style.cssText = 'position:absolute; top:3px; left:3px; width:12px; height:12px; border-radius:50%; background:#eef0ff; transition:transform .2s; pointer-events:none;';
      const applyToggle = () => {
        track.style.background = val ? '#7c74ff' : 'rgba(255,255,255,.12)';
        thumb.style.transform  = val ? 'translateX(14px)' : 'translateX(0)';
      };
      track.style.cssText = 'position:relative; width:32px; height:18px; border-radius:9px; border:none; cursor:pointer; transition:background .2s; flex-shrink:0; padding:0;';
      track.appendChild(thumb);
      applyToggle();
      track.addEventListener('click', () => { val = !val; applyToggle(); saveSettings({ [key]: val }); });
      row.appendChild(lbl); row.appendChild(track);
      return row;
    }
    // 헬퍼: 필 선택기 (정수 범위)
    function cfgPills(key, label, min, max, suffix) {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:10px;';
      const hdr = document.createElement('div');
      hdr.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;';
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'font-size:12px; color:rgba(238,240,255,0.8);';
      const valDisp = document.createElement('span');
      valDisp.style.cssText = 'font-size:11px; color:#7c74ff; font-weight:600;';
      hdr.appendChild(lbl); hdr.appendChild(valDisp);
      const pills = document.createElement('div');
      pills.style.cssText = 'display:flex; gap:4px;';
      let cur = loadSettings()[key] ?? min;
      const BASE = 'flex:1; padding:4px 2px; border-radius:6px; border:1px solid; font-size:11px; cursor:pointer; transition:all .15s; text-align:center;';
      const applyPill = (btn, v) => {
        btn.style.cssText = v === cur
          ? BASE + 'background:rgba(124,116,255,.18); border-color:#7c74ff; color:#eef0ff;'
          : BASE + 'background:transparent; border-color:rgba(255,255,255,.15); color:rgba(238,240,255,0.4);';
      };
      const updateDisp = () => { valDisp.textContent = suffix ? cur + suffix : String(cur); };
      updateDisp();
      const btnMap = [];
      for (let v = min; v <= max; v++) {
        const btn = document.createElement('button');
        btn.textContent = String(v);
        applyPill(btn, v);
        ((v_) => btn.addEventListener('click', () => {
          cur = v_; updateDisp();
          btnMap.forEach(([b, vv]) => applyPill(b, vv));
          saveSettings({ [key]: cur });
        }))(v);
        btnMap.push([btn, v]);
        pills.appendChild(btn);
      }
      wrap.appendChild(hdr); wrap.appendChild(pills);
      return wrap;
    }

    // 섹션 1: 자동 요약
    paneCfg.appendChild(cfgLabel('요약'));
    paneCfg.appendChild(cfgToggle('autoSummary', '자동 요약'));
    paneCfg.appendChild(cfgDivider());

    // 섹션 2: 요약 세부 설정
    paneCfg.appendChild(cfgLabel('요약 옵션'));
    paneCfg.appendChild(cfgPills('summaryInterval', '요약 주기 (매 N 턴)', 2, 6, '턴'));
    paneCfg.appendChild(cfgPills('excludeLastN',    '최신 메시지 제외',    1, 6, '개'));
    paneCfg.appendChild(cfgPills('maxSlots',         '보관 슬롯 수',        3, 10, '개'));
    paneCfg.appendChild(cfgDivider());

    // 섹션 3: 첨부 설정
    paneCfg.appendChild(cfgLabel('첨부'));
    paneCfg.appendChild(cfgPills('autoAttachSlots', '자동 첨부 단기 기억', 0, 5, '개'));
    paneCfg.appendChild(cfgDivider());

    // 섹션 4: 초기화
    paneCfg.appendChild(cfgLabel('초기화'));
    const resetBtn = document.createElement('button');
    resetBtn.id = 'cs-btn-reset';
    resetBtn.textContent = '설정 초기화 (localStorage 삭제)';
    resetBtn.style.cssText = 'width:100%; padding:8px; background:transparent; border:1px solid #e8523a; border-radius:8px; color:#e8523a; font-size:11px; cursor:pointer; transition:all .15s; pointer-events:auto !important;';
    resetBtn.addEventListener('click', () => { localStorage.removeItem(SETTINGS_KEY); showToast('초기화 완료 — 새로고침 해주세요'); log('설정 초기화 완료'); });
    resetBtn.addEventListener('mouseenter', function() { this.style.background = 'rgba(232,82,58,0.15)'; });
    resetBtn.addEventListener('mouseleave', function() { this.style.background = 'transparent'; });
    paneCfg.appendChild(resetBtn);

    contentWrap.appendChild(paneCfg);

    // panelWrapper: 탭바+pane을 감싸는 항상-표시 컨테이너
    // tabBar는 여기 안에 — querySelectorAll('.cs-tab-btn') 정상 작동
    const panelWrapper = document.createElement('div');
    panelWrapper.id = 'cs-panel-wrapper';
    panelWrapper.style.cssText = `
      position: fixed; z-index: 904;
      background: #13131f;
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 12px;
      box-sizing: border-box;
      overflow: hidden;
      pointer-events: auto !important;
      display: block;
    `;
    panelWrapper.appendChild(tabBar);
    panelWrapper.appendChild(contentWrap);

    panelEl = panelWrapper;   // querySelectorAll 기준점

    document.body.appendChild(panelWrapper);
    injectedNodes.push(panelWrapper);

    // 기본: 닫힌 상태 (contentWrap만 숨김, wrapper는 항상 표시)
    panelOpen = false;

    log('탭바 UI 마운트 완료');
    setTimeout(() => { refreshSlotList(); _syncReserved(); }, 0);
  }

  // 접기/펼치기 아이콘
  const COLLAPSE_ICON_UP   = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg>';
  const COLLAPSE_ICON_DOWN = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z"/></svg>';

  function expandPanel() {
    if (!panelEl || !menuBtnEl) return;
    const cw = panelEl.querySelector('#cs-panel-content');
    if (cw) cw.style.display = 'block';
    menuBtnEl.innerHTML = COLLAPSE_ICON_DOWN;
    panelOpen = true;
  }

  function collapsePanel() {
    if (!panelEl || !menuBtnEl) return;
    const cw = panelEl.querySelector('#cs-panel-content');
    if (cw) cw.style.display = 'none';
    menuBtnEl.innerHTML = COLLAPSE_ICON_UP;
    panelOpen = false;
  }

  function togglePanel() {
    panelOpen ? collapsePanel() : expandPanel();
  }

  // =============================================
  //  위치 동기화
  //  — 오버레이 박스: 하단은 sendBtn bottom에 고정, 상단은 콘텐츠만큼 위로 확장
  //  — 가짜 textarea: 헤더 아래 ~ 버튼 행 위, 콘텐츠만큼 자동 확장
  //  — 전송/슬래시 버튼: 박스 하단 고정 (CSS로 처리)
  // =============================================

  // fakeTA 높이 자동 조정 — 210px 초과 시 스크롤
  function autoResizeFakeTA() {
    if (!fakeTextarea) return;
    fakeTextarea.style.height = '1px';          // scrollHeight 재계산 트리거
    const sh = fakeTextarea.scrollHeight;
    if (sh <= MAX_TA_H) {
      fakeTAHeight = Math.max(sh, MIN_TA_H);
      fakeTextarea.style.height    = fakeTAHeight + 'px';
      fakeTextarea.style.overflowY = 'hidden';
    } else {
      fakeTAHeight = MAX_TA_H;
      fakeTextarea.style.height    = MAX_TA_H + 'px';
      fakeTextarea.style.overflowY = 'auto';
    }
  }

  function syncPosition() {
    if (!currentTextarea || !overlayBox) return;

    if (!document.contains(currentTextarea)) return; // 분리된 노드

    const tRect = currentTextarea.getBoundingClientRect();
    const visible = tRect.width > 0 && tRect.height > 0;
    overlayBox.style.display = visible ? 'block' : 'none';
    if (!visible) return;

    // 전송 버튼 위치도 함께 참조해 박스 하단 경계 결정
    let boxBottom = tRect.bottom + 52; // 버튼 행 여유 (기본값)
    if (realSendBtn && document.contains(realSendBtn)) {
      const sRect = realSendBtn.getBoundingClientRect();
      if (sRect.bottom > tRect.bottom) {
        boxBottom = sRect.bottom + 10;
      }
    }

    // 헤더(탭바+패널) 높이
    const headerH  = TAB_BAR_H + (panelOpen ? CONTENT_H : 0);

    // ── 박스 크기: 하단은 sendBtn bottom에 고정, 상단은 fakeTAHeight에 따라 위로 확장
    const boxLeft   = tRect.left - 12;
    const boxWidth  = tRect.width + 24;
    const boxHeight = headerH + TA_TOP_GAP + fakeTAHeight + BUTTON_ROW_H;
    const boxTop    = boxBottom - boxHeight;  // 하단 고정 → 위로 확장

    overlayBox.style.top    = boxTop    + 'px';
    overlayBox.style.left   = boxLeft   + 'px';
    overlayBox.style.width  = boxWidth  + 'px';
    overlayBox.style.height = boxHeight + 'px';

    // 차단막: 실제 입력 div 아래 ~ 실제 버튼 행 하단 (항상 고정)
    if (btnBlocker) {
      btnBlocker.style.top    = tRect.bottom + 'px';
      btnBlocker.style.left   = boxLeft      + 'px';
      btnBlocker.style.width  = boxWidth     + 'px';
      btnBlocker.style.height = (boxBottom - tRect.bottom) + 'px';
    }

    // 가짜 textarea: 헤더 아래 고정 배치 (높이는 autoResizeFakeTA 관할)
    const cs     = window.getComputedStyle(currentTextarea);
    const taLeft = 12;
    const taRight = 12;

    if (fakeTextarea) {
      fakeTextarea.style.top   = (headerH + TA_TOP_GAP) + 'px';
      fakeTextarea.style.left  = taLeft + 'px';
      fakeTextarea.style.width = (boxWidth - taLeft - taRight) + 'px';
      // height는 autoResizeFakeTA 가 관리 — 여기서는 건드리지 않음
      fakeTextarea.style.font          = cs.font;
      fakeTextarea.style.lineHeight    = cs.lineHeight;
      fakeTextarea.style.letterSpacing = cs.letterSpacing;
      fakeTextarea.style.padding       = cs.padding;
    }

    // 카운터: overlayBox 내 fakeTA 상단 우측에 fixed 고정
    if (counterEl) {
      counterEl.style.top   = (boxTop + headerH + 6) + 'px';
      counterEl.style.right = (window.innerWidth - (boxLeft + boxWidth) + 10) + 'px';
    }

    // contentWrap(탭바+패널): overlayBox 바로 위 고정
    if (panelEl) {
      panelEl.style.top   = boxTop + 'px';
      panelEl.style.left  = boxLeft + 'px';
      panelEl.style.width = boxWidth + 'px';
    }

    // 단축어 팝업 위치/크기 동기화 — 오버레이 박스 위에 맞춤
    const slashPopup = document.querySelector('[data-slash-command-suggestion-popup]');
    if (slashPopup) {
      slashPopup.style.left  = boxLeft + 'px';
      slashPopup.style.width = boxWidth + 'px';
      // 팝업이 오버레이 박스 상단에 붙도록 top 재조정
      const popupH = slashPopup.offsetHeight || 320;
      slashPopup.style.top = Math.max(8, tRect.top - popupH - 8) + 'px';
    }
  }

  // =============================================
  //  RAF 루프
  // =============================================
  function startPositionLoop() {
    function loop() {
      if (currentTextarea && !document.contains(currentTextarea)) {
        log('실제 textarea 참조 끊김 — 재초기화');
        if (!reInitCooldown) {
          reInitCooldown = true;
          init().finally(() => { reInitCooldown = false; });
        }
        return;
      }
      syncPosition();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
  }

  function stopPositionLoop() {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  // =============================================
  //  가짜 UI 마운트
  // =============================================
  function mountFakeUI(realTA) {
    injectStyle();

    // 실제 요소 숨김 (contenteditable의 커서도 투명 처리)
    realTA.style.opacity       = '0';
    realTA.style.pointerEvents = 'none';
    realTA.style.caretColor    = 'transparent';

    // 실제 전송 버튼 찾기
    realSendBtn = findSendButton(realTA);
    if (realSendBtn) {
      realSendBtn.style.opacity       = '0';
      realSendBtn.style.pointerEvents = 'none';
      log('실제 전송 버튼 감지 완료');
    } else {
      warn('실제 전송 버튼 감지 실패 — 전용 버튼으로만 대체');
    }

    // 오버레이 박스 생성
    overlayBox = document.createElement('div');
    overlayBox.id = 'cs-overlay-box';
    // aria-hidden="false" 명시 — 브라우저가 포커스 요소를 포함한 조상에 자동으로
    // aria-hidden을 설정하려 할 때 경고가 발생하는 것을 방지
    overlayBox.setAttribute('aria-hidden', 'false');

    // 카운터 (박스 내부 우상단)
    counterEl = document.createElement('span');
    counterEl.id = 'cs-counter';
    document.body.appendChild(counterEl);
    injectedNodes.push(counterEl);

    // 가짜 textarea
    fakeTextarea = document.createElement('textarea');
    fakeTextarea.id          = 'cs-fake-textarea';
    fakeTextarea.placeholder = realTA.getAttribute('data-placeholder') || realTA.placeholder || '메시지를 입력하세요...';
    overlayBox.appendChild(fakeTextarea);

    // 전송 버튼 (박스 내부 우하단)
    fakeSendBtn = document.createElement('button');
    fakeSendBtn.id   = 'cs-send-btn';
    fakeSendBtn.type = 'button';
    fakeSendBtn.title = '전송';
    fakeSendBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="white">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
      </svg>`;
    overlayBox.appendChild(fakeSendBtn);

    // 단축어 버튼 (박스 내부 좌하단) — 실제 "/" 버튼 클릭을 중계
    const slashBtn = document.createElement('button');
    slashBtn.id    = 'cs-slash-btn';
    slashBtn.type  = 'button';
    slashBtn.title = '단축어 패널 열기';
    slashBtn.textContent = '/';
    slashBtn.addEventListener('click', async () => {
      // 실제 "/" 버튼 탐색 (aria-label 기준) — 있으면 그대로 클릭 중계
      const realSlashBtn = document.querySelector('button[aria-label="단축어 패널 열기"]');
      if (realSlashBtn) {
        dispatchFullClick(realSlashBtn);
        return;
      }
      // 폴백: 실제 에디터에 "/"를 새로 삽입
      // — 이미 "/"가 들어있는 상태(연속 클릭 등)에서 같은 값을 그대로 다시
      //   넣으면 콘텐츠 변화가 없어 플랫폼 단축어 팝업이 다시 열리지 않는
      //   문제가 있었음 → 항상 빈 상태를 거쳐 새로 삽입해 매번 확실한
      //   변화(트랜잭션)를 만든다. (keydown/keypress 합성 이벤트는 ProseMirror
      //   contenteditable에 실제 입력을 일으키지 않아 효과가 없으므로 제거)
      taSyncSuppressed = true;
      try {
        setReactValue(currentTextarea, '');
        await new Promise(r => setTimeout(r, 30));
        setReactValue(currentTextarea, '/');
        log('단축어 버튼: 실제 버튼 미탐지, 강제 재삽입 폴백 실행');
      } finally {
        setTimeout(() => { taSyncSuppressed = false; }, 150);
      }
    });
    overlayBox.appendChild(slashBtn);

    document.body.appendChild(overlayBox);
    injectedNodes.push(overlayBox);

    // 하단 버튼 행 차단막
    // — 단축어 팝업이 열려있는 동안은 클릭 이벤트를 통과시킴
    btnBlocker = document.createElement('div');
    btnBlocker.id = 'cs-btn-blocker';
    btnBlocker.addEventListener('click', (e) => {
      // 단축어 팝업이 열려있으면 차단 해제 (팝업 밖 클릭으로 닫히도록)
      const popup = document.querySelector('[data-slash-command-suggestion-popup]');
      if (popup) {
        e.stopPropagation();
        // 팝업 아래 실제 요소에 클릭 전달
        btnBlocker.style.pointerEvents = 'none';
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target) target.click();
        requestAnimationFrame(() => { if (btnBlocker) btnBlocker.style.pointerEvents = 'auto'; });
      }
    });
    document.body.appendChild(btnBlocker);
    injectedNodes.push(btnBlocker);

    // ── 입력 미러링 ──
    // ProseMirror는 execCommand가 비싸므로 empty↔non-empty 전환 시에만 동기화
    // (send 버튼 활성화 목적) — 실제 텍스트 주입은 triggerSend 직전에 수행
    let _prevEmpty = true;
    function _syncSendBtnState() {
      autoResizeFakeTA();
      renderCounter();
      const isEmpty = fakeTextarea.value.length === 0;
      if (isEmpty !== _prevEmpty) {
        _prevEmpty = isEmpty;
        setReactValue(realTA, isEmpty ? '' : '\u200b');
      }
    }

    fakeTextarea.addEventListener('input', _syncSendBtnState);

    fakeTextarea.addEventListener('paste', () => {
      setTimeout(_syncSendBtnState, 0);
    });

    // ── 단축어 선택 결과 동기화 ──
    // 단축어 팝업에서 항목을 클릭하면 그 결과가 "실제" 에디터(realTA, 화면엔
    // 안 보임)에 삽입된다. 사용자는 우리 fakeTextarea만 보고 있으므로 그
    // 삽입 내용이 안 보이는 문제 — realTA 변경을 감시해, 우리가 직접 관리하는
    // 값(''/\u200b/단독 '/')이 아닌 실제 삽입이 감지되면 fakeTextarea로
    // 옮기고 realTA는 다시 비운다.
    function _isManagedRealTAValue(text) {
      return text === '' || text === '\u200b' || text === '/';
    }
    function _checkRealTAInsertion() {
      if (taSyncSuppressed || !currentTextarea || !fakeTextarea) return;
      if (!document.contains(currentTextarea)) return;
      if (document.querySelector('[data-slash-command-suggestion-popup]')) return;

      // 단축어 칩은 atomic 노드라 우리 전송 경로에서 재구성이 불가 — 안내 후 제거
      const chip = currentTextarea.querySelector('[data-type="mention"]');
      if (chip) {
        const label = chip.dataset.label || chip.textContent.trim().replace(/^\//, '');
        taSyncSuppressed = true;
        setReactValue(currentTextarea, '');
        setTimeout(() => { taSyncSuppressed = false; }, 100);
        showToast(`단축어 /${label}는 현재 지원되지 않습니다 — 우리 입력창에서 직접 내용을 입력해주세요`);
        log(`단축어 칩 감지 — 지원 불가로 제거 (/${label})`);
        return;
      }

      // 일반 텍스트 동기화
      const text = (currentTextarea.textContent ?? currentTextarea.value ?? '').trim();
      if (!text || _isManagedRealTAValue(text)) return;
      if (text.startsWith('/')) return;

      taSyncSuppressed = true;
      try {
        const sep = fakeTextarea.value && !fakeTextarea.value.endsWith('\n') ? '\n\n' : '';
        fakeTextarea.value = fakeTextarea.value + sep + text;
        setReactValue(currentTextarea, '');
        _syncSendBtnState();
        fakeTextarea.focus();
        fakeTextarea.selectionStart = fakeTextarea.selectionEnd = fakeTextarea.value.length;
        log(`텍스트 삽입 감지 → 입력창으로 이동 (${text.length}자)`);
      } finally {
        setTimeout(() => { taSyncSuppressed = false; }, 50);
      }
    }
    realTASyncObserver = new MutationObserver(() => {
      clearTimeout(realTASyncDebounce);
      realTASyncDebounce = setTimeout(_checkRealTAInsertion, 200);
    });
    realTASyncObserver.observe(currentTextarea, { childList: true, subtree: true, characterData: true });

    // 엔터 키 처리 (Shift+Enter는 줄바꿈)
    // isComposing 체크: 한국어 IME 조합 중 Enter를 누르면 음절 미완성 상태로
    // triggerSend()가 호출되는 문제 방지 (예: 'ㅁ'만 전송되는 증상)
    fakeTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        triggerSend();
      }
    });

    // ── 전송 버튼 클릭 ──
    fakeSendBtn.addEventListener('click', triggerSend);

    // 초기 fakeTAHeight 설정 (realTA 단일행 높이 기준)
    fakeTAHeight = Math.max(
      currentTextarea.getBoundingClientRect().height || MIN_TA_H,
      MIN_TA_H
    );
    autoResizeFakeTA();  // 초기 높이 적용

    // 초기 동기화 및 루프 시작
    syncPosition();
    renderCounter();
    startPositionLoop();
    attachResponseDetector();
    mountMenuUI();

    log('오버레이 마운트 완료 (임플란트 테마 / 전용 전송 버튼 / Gemini 연동)');
  }

  // =============================================
  //  전송 트리거 (2-4-b 개조)
  // =============================================
  async function triggerSend() {
    if (!fakeTextarea) return;
    const userText = fakeTextarea.value;
    if (!userText.trim()) return;

    // currentTextarea stale 체크 — React 재렌더로 DOM이 교체된 경우 재탐색
    if (!currentTextarea || !document.contains(currentTextarea)) {
      const fresh = document.querySelector('div.__chat_input_textarea[contenteditable="true"]')
                 || document.querySelector('textarea.__chat_input_textarea');
      if (!fresh) {
        warn('입력창 참조가 무효화됨 — 재탐색 실패, 전송 중단');
        showToast('입력창을 찾을 수 없습니다. 페이지를 새로고침 해주세요.');
        return;
      }
      warn('입력창 참조 갱신 (stale → fresh)');
      currentTextarea = fresh;
    }

    // 턴 카운터 증가 ({T} 플레이스홀더 치환용)
    const turnKey = _slotStorageKey ? _slotStorageKey.replace('slots', 'turn') : 'crack-Ember-turn';
    let turnN = parseInt(localStorage.getItem(turnKey) || '0', 10) + 1;
    localStorage.setItem(turnKey, String(turnN));
    const replaceTurn = t => t.replace(/\{T\}/g, String(turnN));

    // XML 조립 + message 슬롯 처리
    const xml      = buildXML();
    const msgSlots = activeSlots.filter(s => s.type === 'message' && s.active !== false);
    const msgAppend = msgSlots.length > 0
      ? '\n\n' + msgSlots.map(s => replaceTurn(s.text || '')).join('\n')
      : '';
    const userPart  = replaceTurn(userText) + msgAppend;
    const fullText  = xml ? `${userPart}\n\n---\n\n${xml}` : userPart;

    // 2000자 초과 검사
    if (fullText.length > MAX_CHARS) {
      const over = fullText.length - MAX_CHARS;
      warn(`전송 차단 — ${over}자 초과 (전체 ${fullText.length}자)`);
      showToast(`전송 차단: ${over}자 초과 (총 ${fullText.length}자 / 한도 ${MAX_CHARS}자)`);
      if (overlayBox) {
        overlayBox.style.border = '1px solid #e8523a';
        setTimeout(() => {
          if (overlayBox) overlayBox.style.border = '1px solid rgba(255,255,255,.12)';
        }, 1200);
      }
      return;
    }

    log(`전송 — 유저:${userText.length}자 / XML:${xml.length}자 / 합계:${fullText.length}자`);

    taSyncSuppressed = true;
    try {
      setReactValue(currentTextarea, fullText);

      // TipTap 트랜잭션은 동기지만 React 리렌더는 비동기 배치 처리
      await new Promise(r => setTimeout(r, 60));

      if (realSendBtn && document.contains(realSendBtn)) {
        realSendBtn.click();
      } else {
        const btn = findSendButton(currentTextarea);
        if (btn) btn.click();
      }
    } catch (e) {
      warn('전송 중 오류:', e.message);
    } finally {
      fakeTextarea.value = '';
      setReactValue(currentTextarea, '');
      fakeTAHeight = MIN_TA_H;
      autoResizeFakeTA();
      renderCounter();
      fakeTextarea.focus();
      setTimeout(() => { taSyncSuppressed = false; }, 150);
    }
  }

  // =============================================
  //  정리
  // =============================================
  function cleanup() {
    stopPositionLoop();
    if (sendBtnObserver) { sendBtnObserver.disconnect(); sendBtnObserver = null; }
    if (realTASyncObserver) { realTASyncObserver.disconnect(); realTASyncObserver = null; }
    clearTimeout(realTASyncDebounce);
    taSyncSuppressed = false;
    injectedNodes.forEach(n => { try { n.remove(); } catch (_) {} });
    injectedNodes.length = 0;

    if (currentTextarea) {
      currentTextarea.style.opacity       = '';
      currentTextarea.style.pointerEvents = '';
      currentTextarea.style.caretColor   = '';  // 잔류 커서 제거
    }
    if (realSendBtn) {
      realSendBtn.style.opacity       = '';
      realSendBtn.style.pointerEvents = '';
    }

    fakeTextarea    = null;
    fakeTAHeight    = MIN_TA_H;
    pendingSummaryAfterTurn = 0;
    fakeSendBtn     = null;
    counterEl       = null;
    overlayBox      = null;
    btnBlocker      = null;
    currentTextarea = null;
    realSendBtn     = null;
    panelEl         = null;
    menuBtnEl       = null;
    panelOpen       = false;
    reservedChars   = 0;
    log('정리 완료');
  }

  // =============================================
  //  메인 초기화
  // =============================================
  async function init() {
    if (!isChattingPage()) { log('채팅 페이지 아님, 스킵'); return; }
    const ids = parsePath();
    log(`채팅 페이지 감지 — storyId: ${ids.storyId} / chatId: ${ids.chatId}`);

    // 채팅 ID별 슬롯 로드 (새로고침/채팅 이동 복원)
    _slotStorageKey = `crack-Ember-slots-${ids.chatId}`;
    activeSlots = _loadSlots();
    _syncReserved();
    log(`슬롯 복원 — ${activeSlots.length}개`);

    cleanup();

    try {
      currentTextarea = await waitForElement(TEXTAREA_SELECTORS);
      log('실제 textarea 마운트 확인');
      mountFakeUI(currentTextarea);
    } catch (e) {
      warn('textarea 감지 실패:', e.message);
    }
  }

  // =============================================
  //  SPA 전환 감지
  // =============================================
  let lastPath = location.pathname;
  function handleNavigation() {
    const newPath = location.pathname;
    if (newPath === lastPath) return;
    lastPath = newPath;
    log(`경로 전환: ${newPath}`);
    init();
  }

  const _origPushState    = history.pushState.bind(history);
  const _origReplaceState = history.replaceState.bind(history);
  history.pushState    = (...args) => { _origPushState(...args);    handleNavigation(); };
  history.replaceState = (...args) => { _origReplaceState(...args); handleNavigation(); };
  window.addEventListener('popstate', handleNavigation);

  init();

})();
