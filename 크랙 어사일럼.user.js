// ==UserScript==
// @name         크랙 어사일럼
// @namespace    http://tampermonkey.net/
// @version      1.2.9
// @description  세션 이주 자동화 – 채팅 로그 수집 → Gemini 요약 생성 → 신규 세션 이주
// @match        https://crack.wrtn.ai/stories/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      generativelanguage.googleapis.com
// ==/UserScript==

(function () {
  'use strict';

  // ════════════════════════════════════════════════════════════
  //  상수
  // ════════════════════════════════════════════════════════════
  const API_BASE   = 'https://crack-api.wrtn.ai/crack-gen';
  const BTN_ID     = 'crk-ch-btn';
  const LS_SUMMARY    = 'crk-ch-summary';   // localStorage 키 (SPA 전환 후에도 유지)
  const MEMORY_STORAGE = 'crack-memory-transfer-data'; // Memory Transfer 호환 키
  const MB_REGEN = 'crk-mb-regen';
  const MB_SAVE  = 'crk-mb-save';
  const MB_LOAD  = 'crk-mb-load';
  const MB_ATTR        = 'data-crk-mb-injected';
  const CHAR_LIMIT     = 300;
  const TITLE_LIMIT    = 20;          // 플랫폼 메모리 제목 최대 글자 수
  const REGEN_TAB_ATTR = 'data-crk-regen-tab';
  const REGEN_TAB_VER  = 'v3'; // 버전 변경 시 구 주입 요소 자동 제거
  const REGEN_PANEL_ID = 'crk-regen-panel';
  const REGEN_ACTIVE   = 'data-crk-regen-active';

  const DEFAULT_PROMPT =
`[MISSION: RP Memory Core Synthesizer]
# 주의: 메시지별 넘버링이 표기되어 있을 시 이를 기준으로 순서와 전체 대화의 맥락을 파악

[1. 너의 정체성]
# 역할 부여: 너는 롤플레잉 Chat Log를 분석하여 캐릭터의 핵심 기억 데이터를 생성하는 전문 AI, '메모리 코어 신디사이저(Memory Core Synthesizer)'이다. 너의 출력물은 다른 AI가 롤플레잉을 이어가기 위한 유일한 기억 소스가 되므로, 절대적인 정확성과 일관성을 유지해야 한다.

[2. 절대 원칙]
# 통합 출력: 입력된 Chat Log 전체를 기반으로 단 하나의 통합된 요약본을 생성한다. [Chat Log]에 이전 요약본이 포함되어 있더라도, 반드시 그 내용을 포함하여 **전체** 결과물을 출력해야 한다.
# 분량 준수: 최종 결과물은 반드시 하나의 마크다운 코드블럭(\` \`\`\`markdown \`)으로 출력하며, 롤플레잉 로그 내역에 비례한 최대 6000자 분량으로 작성한다.
# 압축 규칙: 사건의 분량에 비례하여 압축 서술하되, 최근 사건과 핵심적인 사건, [📚 서사 흐름]의 상세함은 반드시 유지한다. 이전 요약본에 등장한 NPC를 목록에서 임의로 생략하는 것은 절대 금지한다.
# 정보 참조 원칙 (중복 제거): \`세계관\`이나 \`약속/계약\` 등 다른 항목에 이미 상세히 정의된 내용은 반복 서술하지 않는다. 대신 해당 키워드나 개념을 직접 언급하여 정보를 연결한다.
> 예: '저주에 걸려 있음'으로 요약하고, 상세 내용은 '세계관' 항목을 참조하도록 유도
# 객관적 서술: Chat Log에 명시된 사실과 행동만 기록한다. 아래 항목은 절대 금지한다.
- 감정, 의도, 내면 심리에 대한 추측성 서술
> 예: ~해서 기뻤을 것이다
- 대사의 직접/간접 인용
> 예: \"~라고 말했다\"
- 'PC의 시점에서', 'NPC는 ~라고 생각했다' 등 관점 서술
# 문체 통일: 모든 서술은 '~함', '~했음', '~됨' 형태의 간결한 단문으로 종결한다.
# 검열 금지: 성적인/비윤리적인 내용도 검열 없이 사실에 기반하여 요약한다. 단, 성적인 접촉은 관계 변화의 맥락에서만 간략히 언급한다.
# 언어: 모든 내용은 한국어로 작성한다.
# 캐릭터 구분: PC는 이용자가 롤플레잉을 담당하는 캐릭터로, 별도로 명시(예: PC = ○○)되지 않는 한 이전 요약본에서 절대 변경이 없어야 한다. 출력될 요약본은 AI가 NPC를 담당하여 롤플레잉을 하기 위한 가이드임을 명심하고, 필요한 정보들을 기입해야 한다.

[3. 출력 지시]
- 아래 구조와 규칙을 완벽하게 준수하여, 반드시 하나의 마크다운 코드블럭으로 최종 결과물을 생성하라.
- [PC]는 실제 PC 이름으로 자동 치환하여 출력한다.

\`\`\`markdown
# 🧩 주요 사건
- [날짜]:
  - [주어]가 [대상]에게 [행동]함. [결과]가 발생함.
  - (하루에 작성 가능한 항목은 최소 3개 이상)
- (압축 시) [날짜]~[날짜]:
  - [기간 동안의 핵심 사건 최소 3개 이상의 항목 이내로 요약]
  - (중요한 요소로 작용한 사건은 필수 유지)

# 🔗 NPC-[PC] 관계
- [NPC 이름]
  - 관계: [관계명] (상태: ↑, ↓, →)
  - 호칭: [NPC가 PC에게 실제 사용한 호칭 1], [호칭 2]
  - 역할: [PC와의 관계 또는 PC 기준의 전체적인 서사에서 맡은 역할]
  - 감정 상태: [드러난 감정]
  - 행동 양상: [관찰된 반복적 행동/말투 패턴]
  - 특이사항: [기억할 정보, 숨은 의도, 복선 등 Chat Log에 명시된 사실]
  - 향후 계획: [Chat Log에 명시된 향후 행동 계획]
  - (변경 사항이 없는 경우, 이전 상태를 그대로 유지해 출력)
  - (Chat Log에 명시되지 않은 내용은 항목 자체를 생략)

# ⛓️ NPC-NPC 관계
- [NPC 1 이름]
  → [NPC 2 이름]
    * 관계 인식: [NPC 1 기준 관계명]
    * 호칭: [NPC 1이 NPC 2에게 실제 사용한 호칭]
    * 특이사항: [관계의 핵심 특징이나 주요 사건 요약]
  → [NPC 3 이름]
    * …

# 🧬 디테일 데이터
- 약속/계약/과제:
  - [인물 A] ↔ [인물 B] (또는 →)
    * 내용: [약속/계약/과제의 구체적 내용]
    * 조건: [명시된 조건]
    * 보상: [명시된 보상]
- 세계관:
  - [키워드]: [설명]
\`\`\`

[3.1. 섹션별 세부 규칙]

# 🧩 주요 사건
- Chat Log의 전반적인 내용을 사건 위주로 유기적으로 요약한다.
- 만남, 죽음, 고백, 계약, 배신, 전투 등 현재 나타나는 인물 간 관계 또는 상황에 결정적 영향을 미친 사건은 필수적으로 기록하며 이후 요약본에서도 생략 없이 유지할 것. (압축은 가능)
- \`[날짜]\`의 경우, Chat Log에 나타난 형식(DAY n, yyyy.mm.dd, yyyy-mm-dd 등)에 따라 유동적으로 표기한다.

# 🔗 NPC-[PC] 관계
- 항상 NPC의 시점에서 PC를 어떻게 대하는지 또는 생각하는지에 대해 기록한다.
- 모든 서술은 Chat Log에 명시된 증거 기반으로만 작성한다.
- 상태 기호: ↑(관계 개선), ↓(관계 악화), →(관계 유지) 중 하나로 Chat Log의 결과를 나타내는 객관적 사실을 기록한다.
- 관계, 호칭, 역할 항목은 명사형으로 간결하게 각 최대 3개까지 기록한다. 그 외 항목은 각각 최대 2개의 단문으로 핵심만 압축하여 요약한다.
- 감정 상태, 행동 양상: Chat Log에 명시적으로 드러난 표현·묘사(표정, 말투, 행동 등)를 객관적으로 기록한다.
- 호칭: NPC가 해당 PC에게 실제로 사용한 호칭을 최대 3개 기록한다.
- 일회성으로 등장한 엑스트라 NPC는 목록에서 제외하되, 이전 요약본에 포함된 NPC는 비중이 적더라도 생략하지 않는다.
## 향후 계획:
- NPC가 스스로 밝힌 행동 계획 또는 PC의 제안으로 인해 고려하게 된 행동을 기록한다.
- \`약속/계약/과제\`에 명시된 조건을 단순히 반복 기록하지 않는다. 대신, 그 조건을 이행시키기 위해 앞으로 무엇을 할 것인지에 대한 능동적 계획을 서술한다.

# ⛓️ NPC-NPC 관계
- 항상 화살표의 시작 지점인 NPC 1의 시점에서 작성한다. (\`[NPC 1] → [NPC 2]\`는 NPC 1이 NPC 2를 대하는 방식임)
- 관계 인식: NPC 1 기준으로 인식하는 관계명을 명사형으로 기록한다. 비슷한 유형의 관계명은 압축/생략하여 최대 3개까지 기록한다.
- 호칭: 이름, '형', '꼬맹이', '선생님' 등 실제 입 밖에 낸 단어만 최대 3개까지 나열한다.
- 특이사항: 두 인물 간의 관계를 정의하는 핵심적인 사건이나 특징을 최대 2개의 단문으로 간결하게 서술한다.
- 일회성으로 등장한 엑스트라 NPC는 목록에서 제외하되, 이전 요약본에 포함된 NPC는 비중이 적더라도 생략하지 않는다.

# 🧬 디테일 데이터
- 현재 시점에서 유효한 정보만 기록한다. 변경/만료/무효화된 항목은 즉시 목록에서 제거하거나 수정한다.
- Chat Log에 변경 사항이 언급되지 않았을 경우, 현재 시점에도 유효한 것으로 간주한다.
## 약속/계약/과제:
- 명확히 체결 또는 지시된 것만 기록한다. 희망 사항이나 내면의 다짐은 제외한다.
- 조건, 보상: Chat Log에 명시된 경우에만 작성한다. 명시되지 않았을 경우에는 생략한다.
## 세계관:
- 시스템·제도·계층 구조·이공간 등 반복되는 사회 외형 구조나 인물 관계 조건에 영향을 미치는 등의 특이적 요소에 대해 작성한다.
- 전체적인 서사 흐름에 중요하게 작용하는 요소는 필수 포함하고, 단순 장소나 사건 배경은 제외한다.`;

  // ════════════════════════════════════════════════════════════
  const DEFAULT_MEMORY_PROMPT =
`[MISSION: RP Memory Core Synthesizer]
# [정체성]
롤플레잉 Chat Log를 분석하여 플랫폼 내부 요약메모리 시스템에 등록할 사건별 독립 슬롯을 생성하는 AI.
각 슬롯은 시맨틱 검색 최적화 제목과 450자 이내 내용으로 구성되며, 맥락 독립성(어떤 슬롯을 단독으로 읽어도 사건을 완전히 파악 가능)을 최우선으로 한다.

---

# [절대 원칙]
- 출력: 슬롯별로 분리 출력. 코드블럭 없이 평문으로.
- 분량: 슬롯당 공백 포함 450자 이내.
- 객관성: Chat Log에 명시된 사실만 기록. 추측·소설적 서술 금지.
- 대명사 금지: '그', '그녀' 대신 반드시 정확한 이름 사용.
- 순서 고정: 반드시 Chat Log의 시간 흐름을 엄격히 준수.
- 소급 금지: 이후 발생한 사실을 앞선 슬롯에 포함 금지.
- 언어: 한국어.

---

# [사건 분리 기준]
아래 중 하나라도 해당 시 반드시 새 슬롯으로 분리:

1. 장소 이동
2. (새벽/오전/오후/저녁/밤 수준의) 시간대 변화
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
- \`- \`(하이픈+공백) 단일 항목으로 시작.
- 첫머리에 [연도/월/일 시간대(24시 체계)] 명시.
- 필수 기록 요소:
 - 인과 사슬(Flow): [행동/발화] → [리액션] → [재반응/변화] 구조. 대사는 " " 인용.
 - 맥락 정보(Context): 공식 발표·소문·동기 등 떡밥이 되는 배경. ("소문을 들음" ❌ → "A가 B 때문이라는 소문을 들음" ✅)
 - 구체적 양상(How): '화냄' 대신 "미간을 찌푸림" 등 로그에 명시된 행동·표정.
 - 질감(Mood): 사소한 장난·긴장감·말투 변화 등 관계의 온도.
 - 전환점: 관계 변화·결정적 약속·은폐 사실.
 - 구체적 명사: 상징적 선물·물건·공간을 정확한 명칭으로.

---

# [오류 조건]
- 서로 다른 장소의 사건이 하나로 합쳐질 경우 출력 오류.
- 제목 형식 미준수 또는 공백 포함 20자 초과 시 출력 오류.
- 내용에 연도/날짜/시간(24시 체계) 표기가 누락되거나 낮/밤 등 두루뭉술하게 표기되면 출력 오류.
- 내용이 공백 포함 450자를 초과하거나 로그 순서가 뒤섞일 경우 출력 오류.
- 인물 간 인과 사슬이 누락되면 출력 오류.
- 한국어 외 언어로 출력 시 출력 오류.`;

  //  설정 (GM Storage)
  // ════════════════════════════════════════════════════════════
  const cfg = {
    apiKey : () => GM_getValue('crk-ch-key', ''),
    model  : () => GM_getValue('crk-ch-mdl', 'gemini-2.5-flash'),
    prompt : () => GM_getValue('crk-ch-pmt', DEFAULT_PROMPT),
    maxMsg       : () => GM_getValue('crk-ch-max', 0),
    memoryPrompt : () => GM_getValue('crk-ch-mpmt', DEFAULT_MEMORY_PROMPT),
  };

  // ════════════════════════════════════════════════════════════
  //  요약본 저장소 (localStorage)
  // ════════════════════════════════════════════════════════════
  const store = {
    load : ()  => { try { return localStorage.getItem(LS_SUMMARY) || ''; } catch { return ''; } },
    save : (t) => { try { localStorage.setItem(LS_SUMMARY, t); } catch {} },
    clear: ()  => { try { localStorage.removeItem(LS_SUMMARY); } catch {} },
  };

  // ════════════════════════════════════════════════════════════
  //  인증 & API 헬퍼  (Session Copy 코드 재사용)
  // ════════════════════════════════════════════════════════════
  function getToken() {
    return document.cookie.split(';').map(c => c.trim())
      .find(c => c.startsWith('access_token='))?.slice('access_token='.length) ?? null;
  }

  function jsonHeaders() {
    const token  = getToken();
    const wrtnId = document.cookie.split(';').map(c => c.trim())
      .find(c => c.startsWith('__w_id='))?.slice('__w_id='.length) ?? '';
    const h = { 'Content-Type': 'application/json', platform: 'web', 'wrtn-locale': 'ko-KR' };
    if (token)  h.Authorization = `Bearer ${token}`;
    if (wrtnId) h['x-wrtn-id']  = wrtnId;
    return h;
  }

  // ════════════════════════════════════════════════════════════
  //  URL 파싱
  // ════════════════════════════════════════════════════════════
  function parsePath() {
    const m = location.pathname.match(/\/stories\/([^/]+)\/episodes\/([^/]+)/);
    return m ? { storyId: m[1], chatId: m[2] } : null;
  }

  // ════════════════════════════════════════════════════════════
  //  메시지 전체 수집  (Session Copy fetchAllMessages 기반)
  // ════════════════════════════════════════════════════════════
  async function apiGet(url) {
    const res = await fetch(url, { headers: jsonHeaders(), credentials: 'include' });
    if (!res.ok) throw new Error(`API ${res.status}`);
    return res.json();
  }

  async function fetchAllMessages(chatId, onProgress) {
    const all = []; let cursor = null, page = 0;
    while (true) {
      page++;
      onProgress?.(`메시지 수집 중… (${page}페이지 / ${all.length}개)`);
      const url = cursor
        ? `${API_BASE}/v3/chats/${chatId}/messages?limit=50&cursor=${encodeURIComponent(cursor)}`
        : `${API_BASE}/v3/chats/${chatId}/messages?limit=50`;
      const json  = await apiGet(url);
      const data  = json.data ?? json;
      const batch = data.messages ?? [];
      if (!batch.length) break;
      all.push(...batch);
      if (!data.hasNext || !data.nextCursor) break;
      cursor = data.nextCursor;
      await sleep(200);
    }
    all.reverse();
    return all;
  }

  // ════════════════════════════════════════════════════════════
  //  로그 → 텍스트 변환
  // ════════════════════════════════════════════════════════════
  function toLogText(messages, maxCount = 0) {
    let msgs = messages.filter(m => !m.isPrologue && (m.role === 'user' || m.role === 'assistant'));
    if (maxCount > 0) msgs = msgs.slice(-maxCount);
    let turn = 0;
    return msgs.map(m => {
      if (m.role === 'user') turn++;
      const label = m.role === 'user' ? `[사용자 #${turn}]` : `[AI #${turn}]`;
      return `${label}\n${m.content || '(내용 없음)'}`;
    }).join('\n\n' + '─'.repeat(40) + '\n\n');
  }

  // ════════════════════════════════════════════════════════════
  //  Gemini API 호출  (초월 번역기 callGemini 기반)
  // ════════════════════════════════════════════════════════════
  function callGemini(systemText, userText) {
    return new Promise((resolve, reject) => {
      const key = cfg.apiKey().trim();
      if (!key) { reject(new Error('Gemini API 키 미설정 (⚙️ 설정 탭 참조)')); return; }
      GM_xmlhttpRequest({
        method  : 'POST',
        url     : `https://generativelanguage.googleapis.com/v1beta/models/${cfg.model()}:generateContent?key=${key}`,
        headers : { 'Content-Type': 'application/json' },
        data    : JSON.stringify({
          system_instruction: { parts: [{ text: systemText }] },
          contents          : [{ parts: [{ text: userText  }] }],
          generationConfig  : { temperature: 0.4 },
        }),
        onload(r) {
          try {
            const d = JSON.parse(r.responseText);
            if (d.error) { reject(new Error(d.error.message)); return; }
            resolve((d.candidates?.[0]?.content?.parts?.[0]?.text ?? '').trim());
          } catch (e) { reject(e); }
        },
        onerror() { reject(new Error('Gemini 네트워크 오류')); },
      });
    });
  }

  // ════════════════════════════════════════════════════════════
  function parseMemorySlots(text) {
    const slots = [];
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.trim().split('\n');
      if (lines.length < 2) continue;
      let title = lines[0].trim();
      if (title.startsWith('[') && title.endsWith(']')) title = title.slice(1, -1).trim();
      const content = lines.slice(1).join('\n').trim();
      if (title && content) slots.push({ title, content });
    }
    return slots;
  }


  // 로그 파일 역파싱 – ③ 로그 저장 탭 출력 형식과 쌍을 이룸
  function parseLogTxt(text) {
    return text.split(/\n\n-{50}\n\n/)
      .map(s => {
        const m = s.trim().match(/^\[(사용자|AI)\]\n([\s\S]*)$/);
        if (!m) return null;
        return { role: m[1] === '사용자' ? 'user' : 'assistant', content: m[2].trim() };
      }).filter(Boolean);
  }

  function parseLogJson(text) {
    const data = JSON.parse(text);
    const arr  = Array.isArray(data) ? data : (data.messages ?? []);
    return arr.filter(m => m.role && (m.content ?? '') !== '');
  }

  //  DOM 헬퍼  (Session Copy 재사용)
  // ════════════════════════════════════════════════════════════
  function findTextarea() {
    return (
      document.querySelector('textarea.__chat_input_textarea') ||
      document.querySelector('textarea[placeholder*="메시지"]') ||
      document.querySelector('textarea.rc-textarea')
    );
  }

  function setReactValue(el, val) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, val);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ════════════════════════════════════════════════════════════
  //  유틸
  // ════════════════════════════════════════════════════════════
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function waitUntil(cond, timeoutMs) {
    return new Promise(resolve => {
      const start = Date.now();
      const tick = () => {
        if (cond()) { resolve(true); return; }
        if (Date.now() - start >= timeoutMs) { resolve(false); return; }
        setTimeout(tick, 60);
      };
      tick();
    });
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); }
    catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
    }
  }

  function dlText(text, name) {
    const a = Object.assign(document.createElement('a'), {
      href    : URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' })),
      download: name,
    });
    a.click();
  }

  function flashBtn(btn, temp, orig, ms = 1500) {
    btn.textContent = temp;
    setTimeout(() => { btn.textContent = orig; }, ms);
  }

  function toast(msg, type = 'info') {
    const colors = { success: '#16a34a', warn: '#d97706', error: '#dc2626', info: '#2563eb' };
    const d = Object.assign(document.createElement('div'), { textContent: msg });
    d.style.cssText = [
      'position:fixed;bottom:24px;left:50%;transform:translateX(-50%)',
      'z-index:999999;background:#1a1a1a;color:#fff',
      'padding:10px 18px;border-radius:8px',
      'font-size:13px;font-family:system-ui,sans-serif',
      `border-left:4px solid ${colors[type] ?? colors.info}`,
      'box-shadow:0 4px 16px rgba(0,0,0,.4)',
      'pointer-events:none;transition:opacity .4s',
    ].join(';');
    document.body.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 400); }, 2800);
  }

  // ════════════════════════════════════════════════════════════
  //  스타일  (라이트 모드 기반, crack 플랫폼 기준)
  // ════════════════════════════════════════════════════════════
  GM_addStyle(`
    #${BTN_ID} {
      position:fixed;bottom:20px;right:20px;z-index:99998;
      padding:9px 16px;font-size:13px;font-weight:700;color:#fff;
      background:#2E7D32;border:none;border-radius:22px;cursor:pointer;
      box-shadow:0 3px 10px rgba(0,0,0,.25);transition:background .2s;
    }
    #${BTN_ID}:hover    { background:#1B5E20; }
    #${BTN_ID}.crk-has  { background:#1565C0; }
    #${BTN_ID}.crk-has:hover { background:#0D47A1; }

    .crk-ch-ov {
      position:fixed;inset:0;z-index:200002;
      background:rgba(0,0,0,.45);
      display:flex;align-items:center;justify-content:center;
    }
    .crk-ch-box {
      width:540px;max-width:95vw;max-height:90vh;
      background:#fff;border-radius:14px;padding:24px;
      font-family:system-ui,sans-serif;font-size:13px;color:#1a1a1a;
      box-shadow:0 12px 48px rgba(0,0,0,.2);overflow-y:auto;
    }
    .crk-ch-title {
      font-size:16px;font-weight:700;margin:0 0 14px;
      display:flex;align-items:center;gap:8px;flex-wrap:wrap;
    }
    .crk-ch-badge {
      font-size:11px;background:#1565C0;color:#fff;
      padding:2px 8px;border-radius:10px;
    }
    .crk-ch-tabs { display:flex;gap:6px;margin-bottom:16px; }
    .crk-ch-tab {
      flex:1;padding:8px 6px;border-radius:8px;
      border:1px solid #ddd;background:#f5f5f5;
      cursor:pointer;font-size:12px;font-weight:600;
    }
    .crk-ch-tab.on { background:#2E7D32;color:#fff;border-color:#2E7D32; }

    .crk-ch-panel { display:flex;flex-direction:column;gap:10px; }

    .crk-ch-field { display:flex;flex-direction:column;gap:3px; }
    .crk-ch-lbl { font-size:11px;font-weight:700;color:#555; }
    .crk-ch-ta {
      width:100%;box-sizing:border-box;
      border:1px solid #ddd;border-radius:8px;
      padding:9px;font-size:12px;font-family:monospace;
      resize:vertical;background:#fafafa;min-height:80px;
    }
    .crk-ch-input, .crk-ch-sel {
      width:100%;box-sizing:border-box;
      padding:8px 10px;border:1px solid #ddd;
      border-radius:8px;font-size:13px;background:#fafafa;
    }
    .crk-ch-br { display:flex;gap:6px;flex-wrap:wrap; }
    .crk-ch-btn {
      padding:8px 13px;border-radius:8px;border:none;
      font-size:12px;font-weight:600;cursor:pointer;color:#fff;
    }
    .crk-ch-btn:disabled { opacity:.4;cursor:not-allowed; }
    .crk-ch-st {
      font-size:12px;padding:8px 12px;border-radius:6px;display:none;
    }
    .crk-ch-st.show { display:block; }
    .crk-ch-st.info { background:#E3F2FD;color:#0D47A1; }
    .crk-ch-st.ok   { background:#E8F5E9;color:#1B5E20; }
    .crk-ch-st.err  { background:#FFEBEE;color:#B71C1C; }
    .crk-ch-hr { border:none;border-top:1px solid #eee;margin:2px 0; }
    .crk-ch-empty { color:#888;line-height:1.8; }
  `);

  // ════════════════════════════════════════════════════════════
  //  UI 빌더 헬퍼
  // ════════════════════════════════════════════════════════════
  function el(tag, props = {}, children = []) {
    const e = Object.assign(document.createElement(tag), props);
    children.forEach(c => e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
    return e;
  }

  const BTN_COLORS = { g:'#2E7D32', b:'#1565C0', o:'#E65100', gr:'#616161', r:'#B71C1C' };
  function mkBtn(text, colorKey, disabled = false) {
    const btn = el('button', { className: 'crk-ch-btn', textContent: text, disabled });
    btn.style.background = BTN_COLORS[colorKey] ?? colorKey;
    return btn;
  }

  function mkField(parent, labelText) {
    const div = el('div', { className: 'crk-ch-field' });
    if (labelText) div.appendChild(el('div', { className: 'crk-ch-lbl', textContent: labelText }));
    parent.appendChild(div);
    return div;
  }

  function mkStatus(parent) {
    const d = el('div', { className: 'crk-ch-st' });
    parent.appendChild(d);
    return {
      show(msg, type = 'info') { d.textContent = msg; d.className = `crk-ch-st show ${type}`; },
      hide()                   { d.className = 'crk-ch-st'; d.textContent = ''; },
    };
  }

  // ════════════════════════════════════════════════════════════
  //  모달
  // ════════════════════════════════════════════════════════════
  function showModal() {
    const ov = el('div', { className: 'crk-ch-ov' });
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });

    const box = el('div', { className: 'crk-ch-box' });
    ov.appendChild(box);
    document.body.appendChild(ov);

    // ── 제목 ──────────────────────────────────────────
    const title = el('div', { className: 'crk-ch-title' });
    title.appendChild(el('span', { textContent: '🧠 크랙 어사일럼' }));
    if (store.load()) title.appendChild(el('span', { className: 'crk-ch-badge', textContent: '이주 가능' }));
    box.appendChild(title);

    // ── 탭 바 ──────────────────────────────────────────
    const tabBar = el('div', { className: 'crk-ch-tabs' });
    box.appendChild(tabBar);

    const TABS = [
      { id: 'gen',   label: '① 요약 생성' },
      { id: 'paste', label: '② 세션 이식' },
      { id: 'log',   label: '③ 로그 저장' },
      { id: 'cfg',   label: '⚙️ 설정'    },
    ];
    const tabBtnMap = {}, panelMap = {};

    TABS.forEach(({ id, label }) => {
      const btn = el('button', { className: 'crk-ch-tab', textContent: label });
      btn.dataset.tab = id;
      tabBar.appendChild(btn);
      tabBtnMap[id] = btn;

      const panel = el('div', { className: 'crk-ch-panel' });
      panel.style.display = 'none';
      box.appendChild(panel);
      panelMap[id] = panel;
    });

    function switchTab(id) {
      Object.entries(tabBtnMap).forEach(([k, b]) => b.classList.toggle('on', k === id));
      Object.entries(panelMap).forEach(([k, p]) => { p.style.display = k === id ? '' : 'none'; });
      if (id === 'paste') buildPastePanel(panelMap['paste'], ov, title);
    }
    tabBar.addEventListener('click', e => {
      const id = e.target.dataset.tab;
      if (id) switchTab(id);
    });

    // ── 패널 빌드 ──────────────────────────────────────
    buildGenPanel(panelMap['gen'], ov, title);
    buildLogPanel(panelMap['log']);
    buildCfgPanel(panelMap['cfg']);

    switchTab('gen');
  }

  // ════════════════════════════════════════════════════════════
  //  패널 1 – 요약 생성
  // ════════════════════════════════════════════════════════════
  function buildGenPanel(p, ov, title) {
    // 이전 요약본 필드
    const prevField = mkField(p, '이전 요약본 (있으면 붙여넣기 / 없으면 빈칸)');
    const prevTa = el('textarea', {
      className: 'crk-ch-ta', rows: 5,
      placeholder: '이전 챕터 요약본을 여기에 붙여넣으세요…',
      value: store.load(),
    });
    prevField.appendChild(prevTa);

    // 최대 메시지 수
    const maxField = mkField(p, `최대 메시지 수 (0 = 전체, 설정 기본값: ${cfg.maxMsg()})`);
    const maxInput = el('input', {
      type: 'number', className: 'crk-ch-input',
      min: 0, value: cfg.maxMsg(), placeholder: '0 = 전체',
    });
    maxField.appendChild(maxInput);

    // ── 로그 소스 선택 ─────────────────────────────
    const srcField = mkField(p, '로그 소스');
    const srcRow   = el('div', { style: 'display:flex;gap:16px;align-items:center;' });
    const mkSrcRadio = (value, label, checked) => {
      const lbl = el('label', { style: 'display:flex;align-items:center;gap:5px;font-size:12px;cursor:pointer;' });
      const r   = el('input', { type: 'radio', name: 'crk-src', value, checked });
      lbl.append(r, document.createTextNode(label));
      return { lbl, r };
    };
    const { lbl: r1lbl, r: rSession } = mkSrcRadio('session', '현재 세션 로그', true);
    const { lbl: r2lbl, r: rFile    } = mkSrcRadio('file', '파일에서 불러오기', false);
    srcRow.append(r1lbl, r2lbl);
    srcField.appendChild(srcRow);

    // 파일 선택 영역 (rFile 선택 시만 표시)
    const fileField = mkField(p, null);
    fileField.style.display = 'none';
    const fileRow     = el('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;' });
    const fileInput   = el('input', { type: 'file', accept: '.txt,.json', multiple: true, style: 'display:none;' });
    const filePickBtn = mkBtn('📂 파일 선택', 'gr');
    const fileNameLbl = el('span', { style: 'font-size:12px;color:#6b7280;', textContent: '선택된 파일 없음' });
    fileRow.append(filePickBtn, fileNameLbl, fileInput);
    fileField.appendChild(fileRow);

    [rSession, rFile].forEach(r => r.addEventListener('change', () => {
      fileField.style.display = rFile.checked ? '' : 'none';
    }));
    filePickBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const n = fileInput.files?.length ?? 0;
      fileNameLbl.textContent = n === 0 ? '선택된 파일 없음'
        : n === 1 ? fileInput.files[0].name
        : `${n}개 파일 선택됨`;
    });

    // 실행 버튼
    const br1 = el('div', { className: 'crk-ch-br' });
    const runBtn = mkBtn('✨ 요약 생성', 'g');
    br1.appendChild(runBtn);
    p.appendChild(br1);

    // 상태 표시
    const status = mkStatus(p);

    // 결과 영역 (초기 숨김)
    const resWrap = el('div');
    resWrap.style.display = 'none';
    resWrap.appendChild(el('hr', { className: 'crk-ch-hr' }));
    const resField = mkField(resWrap, '생성된 요약본 (편집 후 이식하세요)');
    const resultTa = el('textarea', { className: 'crk-ch-ta', rows: 11 });
    resField.appendChild(resultTa);
    const br2 = el('div', { className: 'crk-ch-br' });
    const copyBtn = mkBtn('📋 복사', 'b');
    const saveBtn = mkBtn('💾 저장 (이주용)', 'o');
    const dlBtn   = mkBtn('⬇ 파일', 'gr');
    [copyBtn, saveBtn, dlBtn].forEach(b => br2.appendChild(b));
    resWrap.appendChild(br2);
    p.appendChild(resWrap);

    // ── 이벤트 ────────────────────────────────────────
    runBtn.addEventListener('click', async () => {
      const ids = parsePath();
      if (!ids) { status.show('채팅방 페이지에서만 사용 가능합니다.', 'err'); return; }
      if (!cfg.apiKey().trim()) { status.show('⚙️ 설정 탭에서 Gemini API 키를 먼저 입력하세요.', 'err'); return; }

      runBtn.disabled = true;
      resWrap.style.display = 'none';

      try {
        let msgs;
        const maxMsgs = Number(maxInput.value) || 0;

        if (rFile.checked) {
          // ── 파일 소스 ──
          if (!fileInput.files?.length) throw new Error('파일을 먼저 선택해주세요.');
          status.show('파일 파싱 중…', 'info');
          const allMsgs = [];
          for (const f of Array.from(fileInput.files)) {
            const rawText = await f.text();
            const parsed  = f.name.toLowerCase().endsWith('.json')
              ? parseLogJson(rawText) : parseLogTxt(rawText);
            allMsgs.push(...parsed);
          }
          msgs = allMsgs;
          if (!msgs.length)
            throw new Error('파일에서 메시지를 찾을 수 없습니다. TXT / JSON 형식을 확인해주세요.');
          const fc = fileInput.files.length;
          status.show(`📄 ${fc > 1 ? `${fc}개 파일에서 ` : '파일에서 '}${msgs.length}개 메시지 로드됨`, 'info');
        } else {
          // ── 현재 세션 소스 ──
          msgs = await fetchAllMessages(ids.chatId, s => status.show(s, 'info'));
        }

        const logText     = toLogText(msgs, maxMsgs);
        const prevTxt     = prevTa.value.trim();
        const srcLabel    = rFile.checked ? '파일 채팅 로그' : '현재 채팅 로그';
        const userContent = prevTxt
          ? `[이전 요약본]\n${prevTxt}\n\n${'═'.repeat(50)}\n\n[${srcLabel} (${msgs.length}개 메시지)]\n${logText}`
          : `[${srcLabel} (${msgs.length}개 메시지)]\n${logText}`;

        status.show('✦ Gemini 요약 생성 중… (잠시 기다려 주세요)', 'info');
        const result = await callGemini(cfg.prompt(), userContent);

        resultTa.value = result;
        resWrap.style.display = '';
        status.show(`✅ 완료! ${msgs.length}개 메시지 → ${result.length}자 요약`, 'ok');
      } catch (err) {
        status.show(`❌ ${err.message}`, 'err');
        console.error('[크랙 어사일럼]', err);
      } finally {
        runBtn.disabled = false;
      }
    });

    copyBtn.addEventListener('click', async () => {
      await copyText(resultTa.value);
      flashBtn(copyBtn, '✅ 복사됨', '📋 복사');
    });

    saveBtn.addEventListener('click', () => {
      store.save(resultTa.value);
      prevTa.value = resultTa.value;
      // 버튼 & 뱃지 갱신
      updateBtnState();
      if (!title.querySelector('.crk-ch-badge')) {
        title.appendChild(el('span', { className: 'crk-ch-badge', textContent: '이주 가능' }));
      }
      flashBtn(saveBtn, '✅ 저장됨', '💾 저장 (이주용)');
    });

    dlBtn.addEventListener('click', () => {
      const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
      dlText(resultTa.value, `crack_summary_${ts}.txt`);
    });
  }

  // ════════════════════════════════════════════════════════════
  //  패널 2 – 세션 이식 (탭 전환 시 동적 렌더)
  // ════════════════════════════════════════════════════════════
  function buildPastePanel(p, ov, title) {
    p.innerHTML = '';
    const saved = store.load();

    if (!saved) {
      p.appendChild(el('div', {
        className: 'crk-ch-empty',
        innerHTML: '저장된 요약본이 없습니다.<br><b>① 요약 생성</b> 탭에서 요약을 생성하고 <b>저장 (이주용)</b>을 눌러주세요.',
      }));
      return;
    }

    // OOC 머릿말 옵션
    const optField = mkField(p, '이식 옵션');
    const oocLabel = el('label', { style: 'display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;' });
    const oocChk   = el('input', { type: 'checkbox', checked: true });
    oocLabel.appendChild(oocChk);
    oocLabel.appendChild(document.createTextNode('OOC 머릿말 자동 삽입'));
    optField.appendChild(oocLabel);

    // 저장된 요약본 텍스트
    const pasteField = mkField(p, '저장된 요약본 (편집 가능)');
    const ta = el('textarea', { className: 'crk-ch-ta', rows: 12, value: saved });
    pasteField.appendChild(ta);

    const br = el('div', { className: 'crk-ch-br' });
    const insertBtn = mkBtn('📥 AI 메시지에 삽입', 'g');
    const pcopyBtn  = mkBtn('📋 복사', 'b');
    const clearBtn  = mkBtn('🗑 삭제', 'r');
    [insertBtn, pcopyBtn, clearBtn].forEach(b => br.appendChild(b));
    p.appendChild(br);

    const pSt = mkStatus(p);

    // 최신 AI 메시지 하단에 PATCH 방식으로 삽입 (8000자 제한 / 입력창 2000자보다 여유)
    insertBtn.addEventListener('click', async () => {
      const ids = parsePath();
      if (!ids) { pSt.show('채팅방 페이지에서만 사용 가능합니다.', 'err'); return; }
      insertBtn.disabled = true;
      pSt.show('최신 AI 메시지 조회 중…', 'info');
      try {
        const json = await apiGet(`${API_BASE}/v3/chats/${ids.chatId}/messages?limit=1`);
        const msgs = (json.data ?? json).messages ?? [];
        const latest = msgs[0];
        if (!latest)
          throw new Error('메시지 목록을 가져올 수 없습니다.');
        if (latest.role !== 'assistant')
          throw new Error('최신 메시지가 AI 응답이 아닙니다.\n마지막 메시지가 AI 메시지인지 확인해주세요.');
        const msgId      = latest._id ?? latest.id;
        const origContent = latest.content ?? '';
        const oocHeader  = '**[OOC: 이전 챕터 요약 – 이 내용을 참조하여 이후 대화를 이어가세요]**\n\n';
        const summary    = oocChk.checked ? oocHeader + ta.value : ta.value;
        const newContent = origContent + '\n\n---\n\n' + summary;
        pSt.show('AI 메시지에 요약본 삽입 중…', 'info');
        const res = await fetch(`${API_BASE}/v3/chats/${ids.chatId}/messages/${msgId}`, {
          method: 'PATCH', headers: jsonHeaders(), credentials: 'include',
          body: JSON.stringify({ message: newContent }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => '');
          throw new Error(`PATCH 오류 ${res.status}: ${t.slice(0, 80)}`);
        }
        pSt.show('✅ 최신 AI 메시지 하단에 삽입 완료. 페이지를 새로고침하면 확인됩니다.', 'ok');
        setTimeout(() => ov.remove(), 2500);
      } catch (err) {
        pSt.show(`❌ ${err.message}`, 'err');
        console.error('[크랙 어사일럼]', err);
      } finally {
        insertBtn.disabled = false;
      }
    });

    pcopyBtn.addEventListener('click', async () => {
      await copyText(ta.value);
      flashBtn(pcopyBtn, '✅ 복사됨', '📋 복사');
    });

    clearBtn.addEventListener('click', () => {
      if (!confirm('저장된 요약본을 삭제할까요?')) return;
      store.clear();
      updateBtnState();
      title.querySelector('.crk-ch-badge')?.remove();
      buildPastePanel(p, ov, title);
    });
  }


  // ════════════════════════════════════════════════════════════
  //  패널 3 – 로그 저장  (원본 Session Copy 기능 복원)
  // ════════════════════════════════════════════════════════════
  function buildLogPanel(p) {
    const info = el('div', {
      className: 'crk-ch-empty',
      innerHTML: '현재 채팅방의 전체 메시지 로그를 파일로 저장합니다.<br>' +
                 '<b>TXT</b>: 에디터로 열람·편집 가능 &nbsp;|&nbsp; <b>JSON</b>: 전체 메타데이터 보존',
    });
    p.appendChild(info);

    const br = el('div', { className: 'crk-ch-br' });
    const txtBtn  = mkBtn('📄 TXT 저장', 'gr');
    const jsonBtn = mkBtn('📦 JSON 저장', 'b');
    [txtBtn, jsonBtn].forEach(b => br.appendChild(b));
    p.appendChild(br);

    const lSt = mkStatus(p);

    async function doExport(format) {
      const ids = parsePath();
      if (!ids) { lSt.show('채팅방 페이지에서만 사용 가능합니다.', 'err'); return; }
      txtBtn.disabled = jsonBtn.disabled = true;
      try {
        const msgs = await fetchAllMessages(ids.chatId, s => lSt.show(s, 'info'));
        if (!msgs.length) { lSt.show('수집된 메시지가 없습니다.', 'warn'); return; }

        const filtered = msgs.filter(m => !m.isPrologue);
        const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');

        if (format === 'txt') {
          // 원본 Session Copy와 동일한 TXT 포맷 (재이식 호환)
          const txtContent = filtered.map(m =>
            `[${m.role === 'user' ? '사용자' : 'AI'}]\n${m.content || ''}`
          ).join('\n\n' + '-'.repeat(50) + '\n\n');
          dlText(txtContent, `crack_log_${ts}.txt`);
        } else {
          const log = {
            exportedAt   : new Date().toISOString(),
            sourceUrl    : location.href,
            storyId      : ids.storyId,
            chatId       : ids.chatId,
            messageCount : filtered.length,
            messages     : filtered.map(m => ({
              id: m._id ?? m.id, role: m.role, content: m.content,
              crackerModel: m.crackerModel, chatModelId: m.chatModelId,
            })),
          };
          dlText(JSON.stringify(log, null, 2), `crack_log_${ts}.json`);
        }
        lSt.show(`✅ ${filtered.length}개 메시지 다운로드 완료.`, 'ok');
      } catch (err) {
        lSt.show(`❌ ${err.message}`, 'err');
        console.error('[크랙 어사일럼] 로그 저장', err);
      } finally {
        txtBtn.disabled = jsonBtn.disabled = false;
      }
    }

    txtBtn.addEventListener('click',  () => doExport('txt'));
    jsonBtn.addEventListener('click', () => doExport('json'));
  }

  // ════════════════════════════════════════════════════════════
  //  패널 4 – 설정
  // ════════════════════════════════════════════════════════════
  function buildCfgPanel(p) {
    // API 키
    const keyField = mkField(p, 'Gemini API 키');
    const keyInput = el('input', { type: 'password', className: 'crk-ch-input',
      value: cfg.apiKey(), placeholder: 'AIza...' });
    keyField.appendChild(keyInput);

    // 모델
    const mdlField = mkField(p, 'Gemini 모델');
    const mdlSel   = el('select', { className: 'crk-ch-sel' });
    ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.5-pro',
     'gemini-3-flash-preview', 'gemini-3.1-pro-preview', 'gemini-3.5-flash',
     'gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.8-flash']
      .forEach(m => {
        const opt = new Option(m, m);
        if (m === cfg.model()) opt.selected = true;
        mdlSel.appendChild(opt);
      });
    mdlField.appendChild(mdlSel);

    // 기본 최대 메시지 수
    const maxField = mkField(p, '기본 최대 메시지 수 (0 = 전체)');
    const maxInput = el('input', { type: 'number', className: 'crk-ch-input',
      min: 0, value: cfg.maxMsg(), placeholder: '0 = 전체' });
    maxField.appendChild(maxInput);

    // 요약 지침
    const prmField = mkField(p, '요약 지침 (커스터마이즈 가능)');
    const prmTa    = el('textarea', { className: 'crk-ch-ta', rows: 14, value: cfg.prompt() });
    prmField.appendChild(prmTa);

    const prmMemField = mkField(p, '요약 메모리 슬롯 지침');
    const prmMemTa    = el('textarea', { className: 'crk-ch-ta', rows: 8, value: cfg.memoryPrompt() });
    prmMemField.appendChild(prmMemTa);

    // 저장 / 초기화 버튼
    const br = el('div', { className: 'crk-ch-br' });
    const saveBtn     = mkBtn('저장', 'g');
    const resetBtn    = mkBtn('지침 초기화', 'gr');
    const resetMemBtn = mkBtn('메모리 지침 초기화', 'gr');
    [saveBtn, resetBtn, resetMemBtn].forEach(b => br.appendChild(b));
    p.appendChild(br);

    const cfgSt = mkStatus(p);

    saveBtn.addEventListener('click', () => {
      GM_setValue('crk-ch-key', keyInput.value.trim());
      GM_setValue('crk-ch-mdl', mdlSel.value);
      GM_setValue('crk-ch-max', Number(maxInput.value) || 0);
      GM_setValue('crk-ch-pmt',  prmTa.value);
      GM_setValue('crk-ch-mpmt', prmMemTa.value);
      cfgSt.show('✅ 설정이 저장되었습니다.', 'ok');
      setTimeout(() => cfgSt.hide(), 2000);
    });

    resetBtn.addEventListener('click', () => {
      if (confirm('요약 지침을 기본값으로 초기화할까요?'))
        prmTa.value = DEFAULT_PROMPT;
    });
    resetMemBtn.addEventListener('click', () => {
      if (confirm('요약 메모리 슬롯 지침을 기본값으로 초기화할까요?'))
        prmMemTa.value = DEFAULT_MEMORY_PROMPT;
    });
  }

  // ════════════════════════════════════════════════════════════

  // ════════════════════════════════════════════════════════════
  //  요약 메모리 모달 헬퍼  (Memory Transfer 통합)
  // ════════════════════════════════════════════════════════════
  function getMemoryDialog() {
    for (const d of document.querySelectorAll('[role="dialog"][data-state="open"]')) {
      const h2 = d.querySelector('h2');
      if (h2 && h2.textContent.trim() === '요약 메모리') return d;
    }
    return null;
  }

  function getFooterRow(dialog) {
    for (const btn of dialog.querySelectorAll("button[type='button']")) {
      if (btn.textContent.trim() === '편집') return btn.parentElement;
    }
    return null;
  }

  function getTabBtn(dialog, label) {
    const tabRow = dialog.querySelector('div.flex.space-x-2.px-6.pb-5');
    if (!tabRow) return null;
    return Array.from(tabRow.querySelectorAll('button')).find(b => b.textContent.trim() === label) || null;
  }

  async function clickTabAndWait(dialog, label) {
    const btn = getTabBtn(dialog, label);
    if (!btn) return false;
    if (btn.classList.contains('bg-primary')) return true;
    btn.click();
    await waitUntil(() => btn.classList.contains('bg-primary'), 2000);
    await sleep(200);
    return true;
  }

  function getTotalCount(dialog) {
    const span = dialog.querySelector('span.text-gray-2');
    if (!span) return null;
    const m = span.textContent.match(/(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }

  function getScrollContainer(dialog) {
    return dialog.querySelector('div.overflow-y-auto');
  }

  function getAccordionItems(dialog) {
    const seen = new Set(), items = [];
    for (const btn of dialog.querySelectorAll('h3 > button[data-radix-collection-item]')) {
      let e = btn.parentElement;
      while (e && !(e.dataset.orientation === 'vertical' && e.tagName !== 'H3')) e = e.parentElement;
      if (e && !seen.has(e)) { seen.add(e); items.push({ root: e, titleBtn: btn }); }
    }
    return items;
  }

  async function ensureAllLoaded(dialog, setLabel) {
    const total = getTotalCount(dialog);
    if (total === null) return;
    const container = getScrollContainer(dialog);
    if (!container) return;
    let prev = -1, stuck = 0;
    while (stuck < 5) {
      const cur = getAccordionItems(dialog).length;
      if (cur >= total) break;
      if (setLabel) setLabel(`로딩 중… (${cur}/${total})`);
      container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
      await sleep(500);
      const after = getAccordionItems(dialog).length;
      stuck = after === prev ? stuck + 1 : 0;
      prev = after;
    }
    container.scrollTo({ top: 0, behavior: 'smooth' });
    await sleep(200);
  }

  async function readAccordionContent(titleBtn) {
    const wasOpen = titleBtn.getAttribute('aria-expanded') === 'true';
    if (!wasOpen) {
      titleBtn.click();
      await waitUntil(() => {
        const rid = titleBtn.getAttribute('aria-controls');
        if (!rid) return false;
        const r = document.getElementById(rid);
        return r && !r.hidden;
      }, 1000);
    }
    const rid = titleBtn.getAttribute('aria-controls');
    let content = '';
    if (rid) {
      const region = document.getElementById(rid);
      if (region) {
        const inner = region.querySelector('div');
        content = (inner ? inner.textContent : region.textContent).trim();
      }
    }
    if (!wasOpen) { titleBtn.click(); await sleep(80); }
    return content;
  }

  async function collectLongTerm(dialog, setLabel) {
    await clickTabAndWait(dialog, '장기 기억');
    await ensureAllLoaded(dialog, setLabel);
    const items = [];
    const acc = getAccordionItems(dialog);
    for (let i = 0; i < acc.length; i++) {
      const { titleBtn } = acc[i];
      const sp = titleBtn.querySelector('span.truncate') || titleBtn.querySelector('.text-left');
      const title = sp ? sp.textContent.trim() : titleBtn.textContent.trim();
      if (!title) continue;
      if (setLabel) setLabel(`장기 기억 읽는 중… (${i + 1}/${acc.length})`);
      items.push({ title, content: await readAccordionContent(titleBtn) });
    }
    items.reverse();
    return items;
  }

  async function collectShortTerm(dialog, setLabel) {
    if (!await clickTabAndWait(dialog, '단기 기억')) return [];
    await sleep(300);
    const items = [];
    let acc = getAccordionItems(dialog);
    if (acc.length) {
      await ensureAllLoaded(dialog, setLabel);
      acc = getAccordionItems(dialog);
      for (let i = 0; i < acc.length; i++) {
        const { titleBtn } = acc[i];
        const sp = titleBtn.querySelector('span.truncate') || titleBtn.querySelector('.text-left');
        const title = sp ? sp.textContent.trim() : titleBtn.textContent.trim();
        if (!title) continue;
        if (setLabel) setLabel(`단기 기억 읽는 중… (${i + 1}/${acc.length})`);
        items.push({ title, content: await readAccordionContent(titleBtn) });
      }
      items.reverse();
      return items;
    }
    const container = getScrollContainer(dialog);
    if (container) {
      const cards = container.querySelectorAll("div.border-b, div[class*='border-b']");
      for (let i = 0; i < cards.length; i++) {
        const lines = (cards[i].innerText || cards[i].textContent || '')
          .split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length >= 2) items.push({ title: lines[0], content: lines.slice(1).join('\n').trim() });
        else if (lines.length === 1) items.push({ title: lines[0], content: '' });
        if (setLabel) setLabel(`단기 기억 읽는 중… (${i + 1}/${cards.length})`);
      }
      if (!items.length && container.textContent.trim())
        items.push({ title: '단기 기억', content: container.textContent.trim() });
      items.reverse();
    }
    return items;
  }

  async function saveMemories(dialog) {
    const btn = document.getElementById(MB_SAVE);
    const set = t => { if (btn) btn.textContent = t; };
    if (btn) btn.disabled = true;
    set('읽는 중…');
    const longTerm  = await collectLongTerm(dialog, set);
    const shortTerm = await collectShortTerm(dialog, set);
    await clickTabAndWait(dialog, '장기 기억');
    if (!longTerm.length && !shortTerm.length) {
      toast('저장할 메모리 항목이 없습니다.', 'warn');
      if (btn) { btn.disabled = false; btn.textContent = '저장'; }
      return;
    }
    localStorage.setItem(MEMORY_STORAGE, JSON.stringify({
      savedAt: new Date().toISOString(), sourceUrl: location.href, longTerm, shortTerm,
    }));
    if (btn) { btn.disabled = false; btn.textContent = '저장'; }
    const parts = [];
    if (longTerm.length)  parts.push(`장기 ${longTerm.length}개`);
    if (shortTerm.length) parts.push(`단기 ${shortTerm.length}개`);
    toast(`${parts.join(' + ')} 저장 완료!`, 'success');
    regenSyncTabLabel(regenGetTabBtn(getMemoryDialog()));
  }

  async function loadMemories(dialog) {
    const raw = localStorage.getItem(MEMORY_STORAGE);
    if (!raw) { toast('저장된 메모리가 없습니다.', 'warn'); return; }
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { toast('저장 데이터 파싱 오류: ' + e.message, 'error'); return; }
    const longTerm  = data.longTerm  || data.items || [];
    const shortTerm = data.shortTerm || [];
    const allItems  = [...longTerm, ...shortTerm];
    if (!allItems.length) { toast('이식할 항목이 없습니다.', 'warn'); return; }
    const parts = [];
    if (longTerm.length)  parts.push(`장기 ${longTerm.length}개`);
    if (shortTerm.length) parts.push(`단기 ${shortTerm.length}개`);
    if (!confirm(
      `저장된 메모리 (${parts.join(' + ')})를 불러옵니다.\n\n` +
      `저장 시각: ${new Date(data.savedAt).toLocaleString('ko-KR')}\n` +
      `저장 출처: ${data.sourceUrl}\n\n` +
      `장기 기억 탭에 순서대로 추가됩니다.\n` +
      `⚠️ 진행 중에는 창을 닫거나 다른 조작을 하지 마세요.\n\n계속하시겠습니까?`
    )) return;
    await clickTabAndWait(dialog, '장기 기억');
    const footerRow = getFooterRow(dialog);
    if (!footerRow) { toast('[추가] 버튼 행을 찾을 수 없습니다.', 'error'); return; }
    const getAddBtn = () =>
      Array.from(footerRow.querySelectorAll('button')).find(b => b.textContent.trim() === '추가' && !b.disabled);
    if (!getAddBtn()) { toast('[추가] 버튼을 찾을 수 없습니다.', 'error'); return; }
    const loadBtnEl = document.getElementById(MB_LOAD);
    const set = t => { if (loadBtnEl) loadBtnEl.textContent = t; };
    if (loadBtnEl) loadBtnEl.disabled = true;
    let ok = 0;
    for (let i = 0; i < allItems.length; i++) {
      const { title, content } = allItems[i];
      const addBtn = getAddBtn();
      if (!addBtn) { toast(`항목 ${i + 1} 실패: [추가] 버튼 없음`, 'error'); break; }
      addBtn.click();
      await sleep(500);
      const nd = await waitForMemDialog(
        t => ['신규 메모리', '메모리 추가', '새 메모리'].some(s => t.includes(s)), 3000
      );
      if (!nd) { toast(`항목 ${i + 1} 실패: 입력 폼 열리지 않음`, 'error'); break; }
      const ti = nd.querySelector("input[name='title'], input[type='text']");
      const ca = nd.querySelector('textarea');
      if (!ti || !ca) {
        toast(`항목 ${i + 1} 실패: 입력 필드 없음`, 'error');
        nd.querySelector('button')?.click(); break;
      }
      setReactValue(ti, title);   await sleep(150);
      setReactValue(ca, content); await sleep(200);
      const sub = nd.querySelector("button[type='submit']")
        || Array.from(nd.querySelectorAll('button')).find(b => b.textContent.trim() === '추가' && !b.disabled);
      if (!sub) {
        toast(`항목 ${i + 1} 실패: 제출 버튼 없음`, 'error');
        nd.querySelector('button')?.click(); break;
      }
      await waitUntil(() => !sub.disabled, 1500);
      sub.click();
      await sleep(700);
      ok++;
      set(`이식 중… ${i >= longTerm.length ? '[단기→장기] ' : ''}(${ok}/${allItems.length})`);
      await sleep(200);
    }
    if (loadBtnEl) { loadBtnEl.disabled = false; loadBtnEl.textContent = '불러오기'; }
    if (ok > 0) toast(`${ok}/${allItems.length}개 이식 완료!`, 'success');
  }


  // ════════════════════════════════════════════════════════════
  //  재생성 소스 선택 팝업 (다수 파일 + 현재 세션 조합 가능)
  // ════════════════════════════════════════════════════════════
  function showRegenSourcePicker(onConfirm) {
    document.getElementById('crk-regen-picker')?.remove();

    const ov = document.createElement('div');
    ov.id = 'crk-regen-picker';
    ov.style.cssText =
      'position:fixed;inset:0;z-index:300000;background:rgba(0,0,0,.45);' +
      'display:flex;align-items:center;justify-content:center;' +
      'pointer-events:auto;'; // [Fix v1.2.6] Radix DismissableLayer가 body.style.pointerEvents='none'을
                              // 주입하므로, 다이얼로그 위에 띄우는 모든 커스텀 레이어는 이 선언 필수

    const box = document.createElement('div');
    box.style.cssText =
      'background:#fff;border-radius:12px;padding:22px 24px;width:370px;max-width:95vw;' +
      'font-family:system-ui,sans-serif;font-size:13px;box-shadow:0 8px 32px rgba(0,0,0,.2);';

    const ttl = document.createElement('div');
    ttl.style.cssText = 'font-size:14px;font-weight:700;margin-bottom:14px;';
    ttl.textContent = '📚 재생성 로그 소스';

    // 현재 세션 체크박스
    const sesLbl = document.createElement('label');
    sesLbl.style.cssText = 'display:flex;align-items:center;gap:8px;cursor:pointer;margin-bottom:12px;';
    const sesChk = document.createElement('input');
    sesChk.type = 'checkbox'; sesChk.checked = true;
    sesLbl.append(sesChk, document.createTextNode('현재 세션 로그'));

    // 파일 목록
    const fileList = document.createElement('div');
    fileList.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-bottom:10px;';
    const files = [];

    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = '.txt,.json';
    fileInput.multiple = true; fileInput.style.display = 'none';

    fileInput.addEventListener('change', () => {
      for (const f of Array.from(fileInput.files)) {
        const row = document.createElement('div');
        row.style.cssText =
          'display:flex;align-items:center;gap:6px;background:#f3f4f6;' +
          'padding:5px 8px;border-radius:6px;';
        const nm = document.createElement('span');
        nm.style.cssText = 'flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#374151;';
        nm.textContent = f.name;
        const rm = document.createElement('button');
        rm.type = 'button'; rm.textContent = '×';
        rm.style.cssText = 'border:none;background:none;cursor:pointer;color:#9ca3af;font-size:15px;line-height:1;padding:0 2px;flex-shrink:0;';
        rm.addEventListener('click', () => {
          files.splice(files.findIndex(e => e === f), 1);
          row.remove();
        });
        row.append(nm, rm);
        fileList.appendChild(row);
        files.push(f);
      }
      fileInput.value = '';
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ 파일 추가 (.txt / .json)';
    addBtn.style.cssText =
      'width:100%;padding:7px 10px;border:1px dashed #9ca3af;border-radius:6px;' +
      'background:#f9fafb;color:#6b7280;font-size:12px;cursor:pointer;text-align:left;';
    addBtn.addEventListener('click', () => fileInput.click());

    // 버튼 행
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;margin-top:18px;justify-content:flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button'; cancelBtn.textContent = '취소';
    cancelBtn.style.cssText =
      'padding:8px 16px;border:1px solid #d1d5db;border-radius:8px;background:#fff;' +
      'cursor:pointer;font-size:12px;';
    cancelBtn.addEventListener('click', () => _closeOv());

    const startBtn = document.createElement('button');
    startBtn.type = 'button'; startBtn.textContent = '▶ 재생성 시작';
    startBtn.style.cssText =
      'padding:8px 18px;border:none;border-radius:8px;background:#059669;color:#fff;' +
      'cursor:pointer;font-size:12px;font-weight:700;';
    startBtn.addEventListener('click', () => {
      if (!sesChk.checked && !files.length) {
        alert('소스를 하나 이상 선택해주세요.');
        return;
      }
      _closeOv();
      onConfirm({ useSession: sesChk.checked, files: [...files] });
    });

    btnRow.append(cancelBtn, startBtn);
    box.append(ttl, sesLbl, fileList, addBtn, fileInput, btnRow);
    ov.appendChild(box);

    // [Fix v1.2.7] Radix DismissableLayer는 document 레벨 capture로 pointerdown/focusin을 감지해
    // 다이얼로그 바깥 클릭을 판별한다. window capture는 document capture보다 먼저 실행되므로
    // picker 내부 이벤트에 한해 stopImmediatePropagation → 메모리 모달이 닫히지 않는다.
    // (fileInput.click()로 파일 탐색창이 열릴 때 focusin이 발생할 수 있어 함께 차단)
    const _stopOutside = e => { if (ov.contains(e.target)) e.stopImmediatePropagation(); };
    window.addEventListener('pointerdown', _stopOutside, true);
    window.addEventListener('focusin',     _stopOutside, true);
    const _closeOv = () => {
      window.removeEventListener('pointerdown', _stopOutside, true);
      window.removeEventListener('focusin',     _stopOutside, true);
      ov.remove();
    };

    ov.addEventListener('click', e => { if (e.target === ov) _closeOv(); });
    document.body.appendChild(ov);
  }

  async function regenMemories(dialog) {
    showRegenSourcePicker(async ({ useSession, files }) => {
      const btn = document.getElementById(MB_REGEN);
      const set = t => { if (btn) btn.textContent = t; };
      if (btn) btn.disabled = true;
      try {
        const ids = parsePath();
        if (!ids) { toast('채팅방 페이지에서만 사용 가능합니다.', 'warn'); return; }
        if (!cfg.apiKey().trim()) { toast('Gemini API 키 미설정 (🧠 세션 이주 > ⚙️ 설정)', 'warn'); return; }

        let allMsgs = [];

        // ── 파일 소스 (다수 가능, 파일 순서대로 합산) ──
        for (const file of files) {
          set(`파일 파싱… (${file.name.slice(0, 8)})`);
          const text   = await file.text();
          const parsed = file.name.toLowerCase().endsWith('.json')
            ? parseLogJson(text) : parseLogTxt(text);
          allMsgs = allMsgs.concat(parsed);
        }

        // ── 현재 세션 소스 ──
        if (useSession) {
          set('수집 중…');
          const msgs = await fetchAllMessages(ids.chatId, s => set(s.slice(0, 7) + '…'));
          allMsgs = allMsgs.concat(msgs);
        }

        if (!allMsgs.length) { toast('수집된 메시지가 없습니다.', 'warn'); return; }

        set('생성 중…');
        const result = await callGemini(cfg.memoryPrompt(), toLogText(allMsgs, cfg.maxMsg()));
        const slots  = parseMemorySlots(result);
        if (!slots.length) { toast('파싱 가능한 슬롯이 없습니다. 출력 형식 확인 필요.', 'warn'); return; }
        localStorage.setItem(MEMORY_STORAGE, JSON.stringify({
          savedAt: new Date().toISOString(), sourceUrl: location.href,
          longTerm: slots, shortTerm: [],
        }));
        toast(`✅ ${slots.length}개 슬롯 재생성 완료 → [불러오기]로 이식`, 'success');
      } catch (e) {
        toast(`❌ ${e.message}`, 'error');
        console.error('[크랙 어사일럼] 메모리 재생성', e);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = '재생성'; }
        regenSyncTabLabel(regenGetTabBtn(getMemoryDialog()));
      }
    });
  }

  async function waitForMemDialog(titleTest, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      for (const d of document.querySelectorAll('[role="dialog"][data-state="open"]')) {
        const h2 = d.querySelector('h2');
        if (h2 && titleTest(h2.textContent)) return d;
      }
      await sleep(100);
    }
    return null;
  }

  function createMemBtn(id, label, color) {
    const btn = document.createElement('button');
    btn.id = id; btn.type = 'button'; btn.textContent = label;
    btn.className = [
      'relative inline-flex items-center justify-center gap-1',
      'overflow-hidden whitespace-nowrap text-sm font-medium transition-colors duration-200',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
      'disabled:pointer-events-none disabled:opacity-50',
      '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:fill-current',
      'h-9 rounded-md px-4 py-2 [&_svg]:size-4',
      'border border-solid border-border bg-background text-foreground',
      'hover:bg-accent active:bg-accent/80',
    ].join(' ');
    btn.style.borderColor = color;
    btn.style.color       = color;
    return btn;
  }


  // ════════════════════════════════════════════════════════════
  //  재생성 메모리 편집 탭
  // ════════════════════════════════════════════════════════════
  function getRegenSlots() {
    try {
      const raw = localStorage.getItem(MEMORY_STORAGE);
      if (!raw) return [];
      const d = JSON.parse(raw);
      return [...(d.longTerm || []), ...(d.shortTerm || [])];
    } catch { return []; }
  }

  function injectRegenTab(dialog) {
    // v2: h2 인라인 배치 방식 (구버전 별도 행 방식 자동 제거)
    if (dialog.getAttribute(REGEN_TAB_ATTR) === REGEN_TAB_VER) return;

    // 구버전 별도 탭 행 제거 (h2를 포함하지 않는, 다이얼로그 직접 자식 중 탭 버튼이 있는 div)
    Array.from(dialog.children).forEach(c => {
      if (!c.hasAttribute('data-alignment') &&
          Array.from(c.querySelectorAll('button')).some(b => b.textContent.trim() === '요약 메모리')) {
        c.remove();
      }
    });

    dialog.setAttribute(REGEN_TAB_ATTR, REGEN_TAB_VER);

    const h2 = dialog.querySelector('h2');
    if (!h2) return;
    const h2Wrap = h2.parentElement; // 신 구조: div.flex.min-w-0.flex-1.flex-col.gap-1.5

    // [Fix v1.2.8] 플랫폼이 h2Wrap을 flex-col로 변경 → row 강제로 h2·|·버튼 가로 배치
    h2Wrap.style.flexDirection  = 'row';
    h2Wrap.style.justifyContent = 'flex-start';
    h2Wrap.style.alignItems     = 'center';
    // 닫기 버튼(X)이 있으면 margin-left:auto 로 오른쪽 끝으로 밀기
    const closeBtn = Array.from(h2Wrap.children).find(
      c => c.tagName === 'BUTTON' && c !== h2
    );
    if (closeBtn) closeBtn.style.marginLeft = 'auto';

    // 구분자 |
    const sep = document.createElement('span');
    sep.style.cssText =
      'color:#d1d5db;margin:0 10px;user-select:none;font-weight:300;flex-shrink:0;line-height:1;';
    sep.textContent = '|';

    // 재생성 메모리 탭 버튼 (h2와 동일 폰트 크기/굵기)
    const regenTabBtn = document.createElement('button');
    regenTabBtn.type = 'button';
    regenTabBtn.setAttribute('data-crk-regen-inline', '1');
    regenTabBtn.style.cssText =
      'background:none;border:none;cursor:pointer;padding:0;flex-shrink:0;white-space:nowrap;' +
      'color:#9ca3af;font-size:1.125rem;font-weight:600;line-height:1;';
    regenSyncTabLabel(regenTabBtn);

    // h2 클릭 → 요약 메모리로 복귀
    h2.style.cursor = 'pointer';

    // h2 바로 다음에 | 와 버튼 삽입
    h2.insertAdjacentElement('afterend', regenTabBtn);
    h2.insertAdjacentElement('afterend', sep);

    h2.addEventListener('click', () => {
      h2.style.color         = '';        // text-card-foreground 복원
      regenTabBtn.style.color = '#9ca3af';
      regenHidePanel(dialog);
    });
    regenTabBtn.addEventListener('click', () => {
      h2.style.color          = '#9ca3af';
      regenTabBtn.style.color = '';       // 동일 계열 색 복원
      regenShowPanel(dialog);
    });
  }

  // 탭 레이블의 뱃지(슬롯 수 / 경고 수) 갱신
  function regenSyncTabLabel(btn) {
    if (!btn) return;
    const slots = getRegenSlots();
    const over  = slots.filter(s => s.content.length > CHAR_LIMIT).length;
    btn.textContent = !slots.length
      ? '재생성 메모리'
      : `재생성 메모리${over ? ' ⚠️' + over + '초과' : ' (' + slots.length + ')'}`;
  }

  function regenGetTabBtn(dialog) {
    if (!dialog) return null;
    return Array.from(dialog.querySelectorAll('button[type="button"]'))
      .find(b => b.textContent.startsWith('재생성 메모리'));
  }

  // 요약 메모리 기본 뷰로 복귀
  function regenHidePanel(dialog) {
    dialog.removeAttribute(REGEN_ACTIVE);
    const pills = dialog.querySelector('div.flex.space-x-2.px-6.pb-5');
    const sc    = getScrollContainer(dialog);
    const main  = sc ? sc.parentElement : null;
    const rp    = document.getElementById(REGEN_PANEL_ID);
    if (pills) pills.style.visibility = '';
    if (main)  main.style.visibility  = '';
    if (rp)    rp.style.display       = 'none';
  }

  // 재생성 메모리 편집 뷰로 전환
  function regenShowPanel(dialog) {
    dialog.setAttribute(REGEN_ACTIVE, '1');

    const pills    = dialog.querySelector('div.flex.space-x-2.px-6.pb-5');
    const sc       = getScrollContainer(dialog);
    const main     = sc ? sc.parentElement : null;
    const footerEl = getFooterRow(dialog);

    // ① display:none 하기 전에 위치 계산 (숨기면 getBoundingClientRect가 0 반환)
    const dlgRect  = dialog.getBoundingClientRect();
    const topEl    = pills || main;
    const topRect  = topEl    ? topEl.getBoundingClientRect()    : null;
    const botRect  = footerEl ? footerEl.getBoundingClientRect() : null;

    const panelTop = topRect ? topRect.top - dlgRect.top : 0;
    const panelH   = (topRect && botRect)
      ? Math.max(botRect.top - topRect.top, 280)
      : 280;

    // ② visibility:hidden 으로 숨기기 (display:none 과 달리 레이아웃 유지)
    //    → dialog 의 flex 재계산이 일어나지 않으므로 footer 위치가 고정됨
    if (pills) pills.style.visibility = 'hidden';
    if (main)  main.style.visibility  = 'hidden';

    let rp = document.getElementById(REGEN_PANEL_ID);
    if (!rp) rp = regenBuildPanel(dialog);

    // ③ 절대 위치 오버레이 (dialog 가 position:fixed+transform 이므로 containing block)
    rp.style.cssText = [
      'display:flex;flex-direction:column;overflow:hidden;padding:8px 24px 0;',
      'background:var(--background,#fff);',
      `position:absolute;left:0;right:0;z-index:10;visibility:visible;`,
      `top:${panelTop}px;height:${panelH}px;`,
    ].join('');

    regenRenderSlots(rp);
  }

  // 재생성 메모리 편집 패널 초기 생성 (1회)
  function regenBuildPanel(dialog) {
    const rp = document.createElement('div');
    rp.id = REGEN_PANEL_ID;
    rp.style.cssText = 'display:none;flex-direction:column;overflow:hidden;padding:8px 24px 0;background:var(--background,#fff);';

    // 슬롯 목록 (스크롤 영역)
    const list = document.createElement('div');
    list.id = 'crk-regen-list';
    list.style.cssText = 'flex:1;overflow-y:auto;';

    // 하단 액션 바
    const bar = document.createElement('div');
    bar.style.cssText =
      'display:flex;gap:6px;flex-wrap:wrap;padding:8px 0;border-top:1px solid #e5e7eb;flex-shrink:0;margin-top:4px;';

    const saveEditBtn = createMemBtn('crk-regen-esave',  '편집 저장', '#7c3aed');
    const injectBtn   = createMemBtn('crk-regen-inject', '이식',      '#0369a1');
    injectBtn.title = `${CHAR_LIMIT}자 초과 슬롯 제외 이식`;
    [saveEditBtn, injectBtn].forEach(b => bar.appendChild(b));

    // 검색창 (슬롯 목록 상단 고정)
    rp.append(list, bar);

    // 편집 저장
    saveEditBtn.addEventListener('click', () => {
      regenSaveEdits();
      toast('편집 내용이 저장되었습니다.', 'success');
      regenSyncTabLabel(regenGetTabBtn(getMemoryDialog()));
    });

    // 이식 (초과 슬롯 제외)
    injectBtn.addEventListener('click', async () => {
      regenSaveEdits();
      const slots = getRegenSlots();
      if (!slots.length) { toast('이식할 슬롯이 없습니다.', 'warn'); return; }
      const valid = slots.filter(s => s.content.length <= CHAR_LIMIT && s.title.length <= TITLE_LIMIT);
      const over  = slots.length - valid.length;
      const raw   = localStorage.getItem(MEMORY_STORAGE);
      const data  = raw ? JSON.parse(raw) : {};
      localStorage.setItem(MEMORY_STORAGE, JSON.stringify({
        ...data, savedAt: new Date().toISOString(), longTerm: valid, shortTerm: [],
      }));
      if (over > 0) toast(`⚠️ ${over}개 초과 슬롯 제외, ${valid.length}개 이식 진행`, 'warn');
      const d = getMemoryDialog();
      if (d) { regenHidePanel(d); await sleep(200); await loadMemories(d); }
    });

    // dialog 직계 자식으로 삽입 (Fix: main 안에 삽입되면 main.visibility:hidden 상속)
    // main.insertAdjacentElement('afterend', rp) → rp는 main 밖, dialog 직계 자식
    const sc2 = getScrollContainer(dialog);
    const mainEl = sc2 ? sc2.parentElement : null;
    if (mainEl && mainEl.parentElement === dialog) {
      mainEl.insertAdjacentElement('afterend', rp);
    } else {
      dialog.appendChild(rp);
    }
    return rp;
  }

  // 슬롯 목록 렌더링 (탭 전환 시마다 호출)
  function regenRenderSlots(rp) {
    const list = document.getElementById('crk-regen-list');
    if (!list) return;
    list.innerHTML = '';
    const slots = getRegenSlots();

    if (!slots.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#9ca3af;font-size:12px;padding:16px 0;text-align:center;';
      empty.textContent = '저장된 재생성 메모리가 없습니다. 하단 [재생성] 버튼을 먼저 눌러주세요.';
      list.appendChild(empty);
      return;
    }

    const over = slots.filter(s => s.content.length > CHAR_LIMIT || s.title.length > TITLE_LIMIT).length;
    const sum  = document.createElement('div');
    sum.style.cssText = `font-size:11px;margin-bottom:8px;color:${over ? '#d97706' : '#6b7280'};`;
    sum.textContent   = over
      ? `전체 ${slots.length}개 | ⚠️ ${over}개 제한 초과 (내용 ${CHAR_LIMIT}자 / 제목 ${TITLE_LIMIT}자)`
      : `전체 ${slots.length}개 (내용·제목 모두 이내 ✅)`;
    list.appendChild(sum);

    slots.forEach((slot, idx) => {
      const isOver = slot.content.length > CHAR_LIMIT || slot.title.length > TITLE_LIMIT;
      const item   = document.createElement('div');
      item.dataset.index = String(idx);
      item.style.cssText =
        `margin-bottom:8px;border:1px solid ${isOver ? '#f59e0b' : '#e5e7eb'};border-radius:6px;overflow:hidden;`;

      // ── 헤더 행: [제목 input] [글자수 뱃지] [🗑 삭제] ──
      const hdr = document.createElement('div');
      hdr.style.cssText =
        'display:flex;align-items:center;gap:4px;padding:4px 8px;background:#f9fafb;border-bottom:1px solid #e5e7eb;';

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.value = slot.title;
      titleInput.dataset.field = 'title';
      titleInput.style.cssText =
        'flex:1;border:none;background:transparent;font-size:12px;font-weight:600;' +
        'outline:none;min-width:0;border-radius:3px;padding:1px 3px;';
      titleInput.addEventListener('focus', () => { titleInput.style.outline = '1px solid #d1d5db'; });
      titleInput.addEventListener('blur',  () => { titleInput.style.outline = 'none'; });

      let _contentLen = slot.content.length; // setBadge ↔ updateTitleCount 공유

      // 제목 글자수 카운터 (TITLE_LIMIT 초과 시 적색)
      const titleCount = document.createElement('span');
      titleCount.style.cssText = 'font-size:10px;flex-shrink:0;';
      const updateTitleCount = () => {
        const len = titleInput.value.length;
        const ov  = len > TITLE_LIMIT;
        titleCount.textContent = `${len}/${TITLE_LIMIT}`;
        titleCount.style.color = ov ? '#ef4444' : '#9ca3af';
        item.style.borderColor = (ov || _contentLen > CHAR_LIMIT) ? '#f59e0b' : '#e5e7eb';
      };
      updateTitleCount();
      titleInput.addEventListener('input', updateTitleCount);

      const badge = document.createElement('span');
      badge.style.cssText =
        'font-size:10px;font-weight:700;padding:1px 5px;border-radius:8px;white-space:nowrap;flex-shrink:0;';
      const setBadge = (len) => {
        _contentLen = len;
        const contentOv = len > CHAR_LIMIT;
        const titleOv   = titleInput.value.length > TITLE_LIMIT;
        badge.textContent      = `${contentOv ? '⚠️ ' : ''}${len}자`;
        badge.style.background = contentOv ? '#fef3c7' : '#f0fdf4';
        badge.style.color      = contentOv ? '#b45309' : '#16a34a';
        item.style.borderColor = (contentOv || titleOv) ? '#f59e0b' : '#e5e7eb';
      };
      setBadge(slot.content.length);

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.textContent = '🗑';
      delBtn.title = '이 슬롯 삭제';
      delBtn.style.cssText =
        'border:none;background:none;cursor:pointer;font-size:12px;padding:0 2px;color:#9ca3af;flex-shrink:0;';
      delBtn.addEventListener('click', () => {
        regenSaveEdits();                      // 현재 편집 내용 먼저 저장
        const cur = getRegenSlots();
        cur.splice(idx, 1);
        const raw = localStorage.getItem(MEMORY_STORAGE);
        if (raw) {
          const d = JSON.parse(raw);
          localStorage.setItem(MEMORY_STORAGE,
            JSON.stringify({ ...d, longTerm: cur, shortTerm: [] }));
        }
        regenRenderSlots(rp);
        regenSyncTabLabel(regenGetTabBtn(getMemoryDialog()));
      });

      hdr.append(titleInput, titleCount, badge, delBtn);

      // ── 내용 텍스트에어리어 ──
      const ta = document.createElement('textarea');
      ta.value = slot.content;
      ta.dataset.field = 'content';
      ta.rows = 3;
      ta.style.cssText =
        'width:100%;box-sizing:border-box;border:none;padding:6px 8px;' +
        'font-size:12px;font-family:inherit;resize:vertical;outline:none;background:#fff;';
      ta.addEventListener('input', () => setBadge(ta.value.length));

      item.append(hdr, ta);
      list.appendChild(item);
    });
  }

  // 현재 편집 내용을 localStorage에 반영
  function regenSaveEdits() {
    const list = document.getElementById('crk-regen-list');
    if (!list) return;
    const updated = [];
    for (const item of list.querySelectorAll('div[data-index]')) {
      const ti = item.querySelector('input[data-field="title"]');
      const ta = item.querySelector('textarea[data-field="content"]');
      if (ti && ta) updated.push({ title: ti.value.trim(), content: ta.value });
    }
    const raw  = localStorage.getItem(MEMORY_STORAGE);
    const data = raw ? JSON.parse(raw) : {};
    localStorage.setItem(MEMORY_STORAGE, JSON.stringify({
      ...data, savedAt: new Date().toISOString(), longTerm: updated, shortTerm: [],
    }));
  }


  // ════════════════════════════════════════════════════════════
  //  요약 메모리 모달 내 검색
  // ════════════════════════════════════════════════════════════
  function applyMemorySearch(dialog, kw) {
    const sc = getScrollContainer(dialog);
    if (!sc) return;
    for (const item of sc.children) {
      if (!(item instanceof Element)) continue;
      if (!kw) { item.style.display = ''; continue; }
      // textContent: closed accordion hidden 영역도 포함 (Radix UI hidden → DOM 남아있음)
      item.style.display = item.textContent.toLowerCase().includes(kw) ? '' : 'none';
    }
  }

  function injectMemorySearch(dialog) {
    const SEARCH_ID = 'crk-mem-search';
    if (dialog.querySelector(`#${SEARCH_ID}`)) return;   // 이미 주입됨

    const sc = getScrollContainer(dialog);
    if (!sc) return;

    const wrap = document.createElement('div');
    wrap.id = SEARCH_ID;
    wrap.style.cssText = 'padding:0 24px 6px;flex-shrink:0;';

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.placeholder = '제목 또는 내용으로 검색…';
    inp.style.cssText =
      'width:100%;box-sizing:border-box;padding:7px 12px;' +
      'border:1px solid #e5e7eb;border-radius:8px;' +
      'font-size:13px;outline:none;background:#f9fafb;';
    inp.addEventListener('focus', () => { inp.style.borderColor = '#3b82f6'; inp.style.background = '#fff'; });
    inp.addEventListener('blur',  () => { inp.style.borderColor = '#e5e7eb'; inp.style.background = '#f9fafb'; });

    let timer = null;
    inp.addEventListener('input', () => {
      clearTimeout(timer);
      const kw = inp.value.trim().toLowerCase();
      if (!kw) { applyMemorySearch(dialog, ''); return; }
      // 미로드 항목 가상스크롤 대비 – 400ms 후 ensureAllLoaded 실행
      inp.style.borderColor = '#f59e0b';
      timer = setTimeout(async () => {
        await ensureAllLoaded(dialog, null);
        applyMemorySearch(dialog, kw);
        inp.style.borderColor = (inp === document.activeElement) ? '#3b82f6' : '#e5e7eb';
      }, 400);
    });

    wrap.appendChild(inp);
    sc.insertAdjacentElement('beforebegin', wrap);

    // 탭 전환 시 재검색 적용 (pills 버튼 클릭 → 600ms 후 DOM 안정화 → 재필터)
    const tabRow = dialog.querySelector('div.flex.space-x-2.px-6.pb-5');
    if (tabRow) {
      tabRow.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          setTimeout(async () => {
            const kw = inp.value.trim().toLowerCase();
            if (!kw) return;
            await ensureAllLoaded(dialog, null);
            applyMemorySearch(dialog, kw);
          }, 600);
        });
      });
    }
  }

  function injectMemoryButtons(dialog) {
    const row = getFooterRow(dialog);
    if (!row || row.hasAttribute(MB_ATTR)) return;
    row.setAttribute(MB_ATTR, '1');
    const regenBtn = createMemBtn(MB_REGEN, '재생성', '#059669');
    regenBtn.title = 'Gemini로 메모리 슬롯 재생성 후 저장 (세션 이주 모달에서 API 키 설정 필요)';
    regenBtn.addEventListener('click', e => {
      e.stopPropagation();
      const d = getMemoryDialog();
      d ? regenMemories(d) : toast('요약 메모리 창을 찾을 수 없습니다.', 'error');
    });
    const saveBtn = createMemBtn(MB_SAVE, '저장', '#7c3aed');
    saveBtn.title = '장기·단기 기억 전체를 브라우저에 저장';
    saveBtn.addEventListener('click', e => {
      e.stopPropagation();
      const d = getMemoryDialog();
      d ? saveMemories(d) : toast('요약 메모리 창을 찾을 수 없습니다.', 'error');
    });
    const loadBtn = createMemBtn(MB_LOAD, '불러오기', '#0369a1');
    loadBtn.title = '저장된 메모리를 현재 세션 장기 기억에 이식';
    loadBtn.addEventListener('click', e => {
      e.stopPropagation();
      const d = getMemoryDialog();
      d ? loadMemories(d) : toast('요약 메모리 창을 찾을 수 없습니다.', 'error');
    });
    // 순서: 재생성 | 저장 | 불러오기 | [편집] | [추가]
    const editBtn = Array.from(row.querySelectorAll('button')).find(b => b.textContent.trim() === '편집');
    row.insertBefore(loadBtn,  editBtn);
    row.insertBefore(saveBtn,  loadBtn);
    row.insertBefore(regenBtn, saveBtn);
    injectRegenTab(dialog);
    injectMemorySearch(dialog);
  }

  //  플로팅 버튼 상태 동기화
  // ════════════════════════════════════════════════════════════
  function updateBtnState() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.classList.toggle('crk-has', !!store.load());
  }

  // ════════════════════════════════════════════════════════════
  //  플로팅 버튼 마운트
  // ════════════════════════════════════════════════════════════
  function mountBtn() {
    if (!parsePath()) { document.getElementById(BTN_ID)?.remove(); return; }
    if (document.getElementById(BTN_ID)) return;
    const btn = el('button', { id: BTN_ID, textContent: '🧠 세션 이주' });
    if (store.load()) btn.classList.add('crk-has');
    btn.addEventListener('click', showModal);
    document.body.appendChild(btn);
  }

  // ════════════════════════════════════════════════════════════
  //  초기화 & SPA 감지
  // ════════════════════════════════════════════════════════════
  window.addEventListener('load', mountBtn);
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href === _lastUrl) return;
    _lastUrl = location.href;
    setTimeout(mountBtn, 800);
    setTimeout(mountBtn, 1500);
  }).observe(document, { subtree: true, childList: true });
  setInterval(() => parsePath() ? mountBtn() : document.getElementById(BTN_ID)?.remove(), 2000);

  // ════════════════════════════════════════════════════════════
  //  요약 메모리 버튼 감지 & 주입
  // ════════════════════════════════════════════════════════════
  new MutationObserver(() => {
    const d = getMemoryDialog();
    if (d) injectMemoryButtons(d);
  }).observe(document.body, {
    subtree: true, childList: true,
    attributes: true, attributeFilter: ['data-state'],
  });
  const _initMemDlg = getMemoryDialog();
  if (_initMemDlg) injectMemoryButtons(_initMemDlg);

})();
