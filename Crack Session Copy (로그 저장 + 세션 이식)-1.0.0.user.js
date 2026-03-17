// ==UserScript==
// @name         Crack Session Copy (로그 저장 + 세션 이식)
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  1단계: 채팅 로그를 JSON/브라우저 중 선택 저장 / 2단계: 일반챗 전환 후 세션 이식
// @author       -
// @match        https://crack.wrtn.ai/stories/*
// @grant        none
// ==/UserScript==

(function () {
  "use strict";

  // ==============================================
  //  상수
  // ==============================================
  const API_BASE = "https://crack-api.wrtn.ai/crack-gen";
  const STORAGE_KEY = "crack-session-tool-log";
  const BTN_ID_EXPORT = "cst-btn-export";
  const BTN_ID_IMPORT = "cst-btn-import";
  const BTN_ID_STOP   = "cst-btn-stop";

  // 임시 전송 텍스트 — 일반챗 수준에서도 짧은 응답을 확실하게 유도
  const DUMMY_MSG = "**이 세션은 서버 응답 테스트용 세션입니다. 모든 입력에 대해 응답으로 '1'을 출력하세요.**";

  // 일반챗 crackerModel 식별 키 (API 응답의 crackerModel 필드 기준)
  const NORMAL_CHAT_KEY = "normalchat";

  let stopRequested = false;
  let running = false;

  // ==============================================
  //  인증
  //  크랙 API 인증 방식:
  //   - GET  : Authorization: Bearer {access_token} 필요
  //   - PATCH: 쿠키(credentials: include)로 처리됨
  //  안전하게 둘 다 항상 함께 전송한다.
  // ==============================================
  function getToken() {
    const match = document.cookie
      .split(";")
      .map(c => c.trim())
      .find(c => c.startsWith("access_token="));
    return match ? match.slice("access_token=".length) : null;
  }

  function jsonHeaders() {
    const token = getToken();
    // 크랙 API가 요청 유효성 검증에 사용하는 헤더 세트
    // (Network 탭 실제 요청 기준: platform, wrtn-locale, x-wrtn-id 필수)
    const wrtnId = document.cookie.split(";").map(c => c.trim())
      .find(c => c.startsWith("__w_id="))?.slice("__w_id=".length) ?? "";
    const mpId = (() => {
      try {
        const raw = localStorage.getItem("mp_78c86210f74e622ec77ded5882a5762b_mixpanel");
        return raw ? (JSON.parse(raw)?.distinct_id ?? "") : "";
      } catch { return ""; }
    })();

    const headers = {
      "Content-Type": "application/json",
      "platform": "web",
      "wrtn-locale": "ko-KR",
    };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (wrtnId) headers["x-wrtn-id"] = wrtnId;
    if (mpId)   headers["mixpanel-distinct-id"] = mpId;
    return headers;
  }

  // 하위 호환성
  function authHeaders() { return jsonHeaders(); }

  // ==============================================
  //  URL에서 storyId / chatId 파싱
  //  /stories/{storyId}/episodes/{chatId}
  // ==============================================
  function parsePath() {
    const m = location.pathname.match(/\/stories\/([^/]+)\/episodes\/([^/]+)/);
    if (!m) return null;
    return { storyId: m[1], chatId: m[2] };
  }

  function isChattingPage() {
    return !!parsePath();
  }

  // ==============================================
  //  API 헬퍼
  // ==============================================
  async function apiGet(url) {
    const res = await fetch(url, {
      headers: jsonHeaders(),
      credentials: "include",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API 오류 ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async function apiPatch(url, body) {
    const res = await fetch(url, {
      method: "PATCH",
      headers: jsonHeaders(),
      credentials: "include",
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`PATCH 오류 ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async function fetchAllMessages(chatId) {
    const messages = [];
    let cursor = null;
    let page = 0;

    while (true) {
      if (stopRequested) break;
      page++;
      setStatus(`메시지 로딩 중... (${page}페이지 / 현재 ${messages.length}개)`);

      const url = cursor
        ? `${API_BASE}/v3/chats/${chatId}/messages?limit=50&cursor=${encodeURIComponent(cursor)}`
        : `${API_BASE}/v3/chats/${chatId}/messages?limit=50`;

      const json = await apiGet(url);
      const data = json.data ?? json;
      const batch = data.messages ?? [];

      if (!batch.length) break;
      messages.push(...batch);

      if (!data.hasNext || !data.nextCursor) break;
      cursor = data.nextCursor;
      await sleep(300);
    }

    // API는 최신순 반환 → 역순(오래된 것 먼저)
    messages.reverse();
    return messages;
  }

  /**
   * 전송 전 메시지 수를 기록해두고, 전송 후 새로 생긴 메시지만 반환.
   * limit을 충분히 크게 잡아 경고 메시지가 끼어도 새 메시지를 정확히 식별.
   */
  async function fetchNewMessages(chatId, prevCount) {
    // 넉넉하게 최근 10개를 가져와서 이전에 없던 것만 추린다
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}/messages?limit=10`);
    const data = json.data ?? json;
    const all = data.messages ?? [];
    // API는 최신순 반환 → 앞쪽이 새것
    // prevCount 이후에 생긴 것 = 전체 메시지 수 - prevCount 개
    return all; // 호출 측에서 role 기준으로 최신 user/bot 1개씩 추림
  }

  async function fetchTotalMessageCount(chatId) {
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}/messages?limit=1`);
    const data = json.data ?? json;
    // hasNext + nextCursor로 총 개수 파악이 어려우니, 가장 최신 메시지 ID를 앵커로 쓴다
    const msgs = data.messages ?? [];
    return msgs.length > 0 ? (msgs[0]._id ?? msgs[0].id) : null;
  }

  /** 메시지 내용 수정 — 크랙 API는 필드명 'message' 사용 */
  async function editMessage(chatId, messageId, content) {
    return apiPatch(
      `${API_BASE}/v3/chats/${chatId}/messages/${messageId}`,
      { message: content }
    );
  }

  // ==============================================
  //  채팅 모델 관련
  // ==============================================
  /**
   * 채팅방의 현재 모델 정보를 가져옴.
   */
  async function fetchChatInfo(chatId) {
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}`);
    return json.data ?? json;
  }

  /**
   * 일반챗(normalchat) chatModelId를 다단계로 탐색.
   *
   * 전략 A — __NEXT_DATA__에서 추출:
   *   크랙 SPA는 페이지 로드 시 전체 채팅방·모델 정보를
   *   <script id="__NEXT_DATA__"> 안에 인라인으로 내려준다.
   *   crackerModels 또는 chatModels 배열에서 crackerModel === "normalchat"인
   *   항목의 chatModelId(_id)를 찾는다.
   *
   * 전략 B — 현재 세션 메시지 이력에서 역추출:
   *   페이지에 이미 로드된 메시지들 중 crackerModel이 "normalchat"인
   *   메시지의 chatModelId를 꺼낸다.
   *
   * 전략 C — API 엔드포인트 순차 시도:
   *   /v2/crackers/models, /v3/chat-models, /v2/chat-models
   */
  async function findNormalChatModelId(chatId) {
    // ── 전략 A: __NEXT_DATA__ ──
    try {
      const raw = document.getElementById("__NEXT_DATA__")?.textContent;
      if (raw) {
        const nd = JSON.parse(raw);

        // 방법 A-1: fallback."/v3/chats/{chatId}" 안의 maxOutputSettings에서
        // chatModelId 목록을 꺼낸 뒤, 같은 fallback 안의 메시지들로 역추적
        const chatKey = Object.keys(nd.props?.pageProps?.fallback ?? {})
          .find(k => k.includes("/v3/chats/") && !k.includes("/messages"));
        const chatData = chatKey ? nd.props.pageProps.fallback[chatKey]?.data : null;

        // 방법 A-2: 메시지 목록에서 normalchat 항목의 chatModelId 역추출
        const msgKeys = Object.keys(nd.props?.pageProps?.fallback ?? {})
          .filter(k => k.includes("/messages"));
        for (const mk of msgKeys) {
          const msgs = nd.props.pageProps.fallback[mk]?.data?.messages ?? [];
          const hit = msgs.find(m =>
            (m.crackerModel ?? "").toLowerCase() === NORMAL_CHAT_KEY
          );
          if (hit?.chatModelId) {
            console.log("[Crack Session Tool] normalchat ID found via __NEXT_DATA__ messages:", hit.chatModelId);
            return hit.chatModelId;
          }
        }

        // 방법 A-3: crackerModels / chatModels 배열 직접 탐색
        function searchModels(obj) {
          if (!obj || typeof obj !== "object") return null;
          if (Array.isArray(obj)) {
            for (const item of obj) {
              if (typeof item === "object" && item !== null) {
                const key = (item.crackerModel ?? item.key ?? item.type ?? item.name ?? "").toLowerCase();
                if (key === NORMAL_CHAT_KEY) return item.chatModelId ?? item._id ?? item.id ?? null;
                const deep = searchModels(item);
                if (deep) return deep;
              }
            }
            return null;
          }
          for (const v of Object.values(obj)) {
            const r = searchModels(v);
            if (r) return r;
          }
          return null;
        }
        const fromTree = searchModels(nd.props?.pageProps);
        if (fromTree) {
          console.log("[Crack Session Tool] normalchat ID found via __NEXT_DATA__ tree:", fromTree);
          return fromTree;
        }
      }
    } catch (e) {
      console.warn("[Crack Session Tool] __NEXT_DATA__ 파싱 실패:", e.message);
    }

    // ── 전략 B: DOM 메시지에서 역추출 ──
    try {
      // 이미 렌더링된 메시지 그룹에서 data-cracker-model 속성 탐색
      const groups = document.querySelectorAll("[data-message-group-id]");
      // React fiber로 props 접근 시도
      for (const el of groups) {
        const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
        if (!fiberKey) continue;
        let fiber = el[fiberKey];
        let depth = 0;
        while (fiber && depth++ < 30) {
          const p = fiber.memoizedProps ?? fiber.pendingProps;
          if (p?.crackerModel?.toLowerCase() === NORMAL_CHAT_KEY && p?.chatModelId) {
            console.log("[Crack Session Tool] normalchat ID found via React fiber:", p.chatModelId);
            return p.chatModelId;
          }
          fiber = fiber.return;
        }
      }
    } catch (e) {
      console.warn("[Crack Session Tool] React fiber 탐색 실패:", e.message);
    }

    // ── 전략 C: API 순차 시도 ──
    const endpoints = [
      `${API_BASE}/v2/crackers/models`,
      `${API_BASE}/v3/chat-models`,
      `${API_BASE}/v2/chat-models`,
      `${API_BASE}/v1/crackers/models`,
    ];
    for (const url of endpoints) {
      try {
        const json = await apiGet(url);
        const list = json.data ?? json;
        const arr = Array.isArray(list) ? list : (list.models ?? list.crackerModels ?? list.chatModels ?? []);
        const hit = arr.find(m =>
          (m.crackerModel ?? m.key ?? m.type ?? m.name ?? "").toLowerCase() === NORMAL_CHAT_KEY
        );
        if (hit) {
          const id = hit.chatModelId ?? hit._id ?? hit.id;
          if (id) {
            console.log(`[Crack Session Tool] normalchat ID found via API (${url}):`, id);
            return id;
          }
        }
      } catch { /* 다음 시도 */ }
    }

    console.warn("[Crack Session Tool] 모든 전략으로 normalchat ID를 찾지 못했습니다.");
    return null;
  }

  /**
   * 채팅방의 모델을 일반챗으로 전환.
   * PATCH 엔드포인트 두 곳을 순서대로 시도.
   */
  async function switchToNormalChat(chatId) {
    // 이미 일반챗인지 확인
    try {
      const info = await fetchChatInfo(chatId);
      const cur = (info.crackerModel ?? "").toLowerCase();
      if (cur === NORMAL_CHAT_KEY) {
        console.log("[Crack Session Tool] 이미 일반챗입니다.");
        return true;
      }
    } catch { /* 확인 실패 시 변경 시도 계속 */ }

    const normalId = await findNormalChatModelId(chatId);
    if (!normalId) return false;

    const patchTargets = [
      { url: `${API_BASE}/v3/chats/${chatId}/model`, body: { chatModelId: normalId } },
      { url: `${API_BASE}/v3/chats/${chatId}`,       body: { chatModelId: normalId } },
    ];
    for (const pt of patchTargets) {
      try {
        await apiPatch(pt.url, pt.body);
        console.log(`[Crack Session Tool] 일반챗 전환 완료 (${pt.url})`);
        return true;
      } catch (e) {
        console.warn(`[Crack Session Tool] 전환 실패 (${pt.url}):`, e.message);
      }
    }
    return false;
  }

  // ==============================================
  //  DOM: textarea + 전송 버튼 탐색
  //  HTML 분석 결과:
  //    textarea.class.__chat_input_textarea
  //    전송 버튼: style="background-color: rgb(255, 99, 1);" 을 포함하는 버튼
  //              + SVG path d="M18.77 11.13..."
  // ==============================================
  function findTextarea() {
    return (
      document.querySelector("textarea.__chat_input_textarea") ||
      document.querySelector("textarea[placeholder*='메시지']") ||
      document.querySelector("textarea.rc-textarea")
    );
  }

  function findSendButton() {
    // 1순위: 텍스트 입력 후 나타나는 활성 전송 버튼
    // 클래스: bg-primary text-primary-foreground ... rounded-full
    // (인라인 style이 없고, class 기반으로 렌더링됨)
    const byClass = document.querySelector(
      "button.bg-primary.text-primary-foreground.rounded-full:not([disabled])"
    );
    if (byClass) return byClass;

    // 2순위: 빈 입력창 상태의 전송 버튼 (인라인 style로 배경색 지정)
    const byColor = document.querySelector(
      "button[style*='background-color: rgb(255, 99, 1)']:not([disabled])"
    );
    if (byColor) return byColor;

    // 3순위: textarea 컨테이너 내 rounded-full 버튼 중 마지막 것
    const ta = findTextarea();
    if (ta) {
      let container = ta.parentElement;
      for (let i = 0; i < 6 && container; i++) {
        const btns = Array.from(
          container.querySelectorAll("button.rounded-full:not([disabled])")
        );
        // 전송 버튼은 보통 입력 영역 내 마지막 rounded-full 버튼
        if (btns.length) return btns[btns.length - 1];
        container = container.parentElement;
      }
    }
    return null;
  }

  /** React controlled input에 값 주입 */
  function setReactValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ==============================================
  //  생성 완료 감지
  //  크랙 HTML 분석:
  //   - 생성 중: 전송 버튼이 비활성화되거나 숨겨짐
  //   - 생성 완료: 전송 버튼 rgb(255,99,1)이 다시 활성화
  //   - 추가 신호: [data-generating], stop 버튼 존재 여부
  // ==============================================
  async function waitForGenerationEnd(timeout = 150_000) {
    const start = Date.now();

    // 전송 직후 대기 — 중단 버튼으로 교체되는 시간을 충분히 넘김
    await sleep(2500);

    while (Date.now() - start < timeout) {
      if (stopRequested) return;

      // 중단 버튼(생성 진행 중 표시)이 있으면 아직 생성 중
      // 크랙의 중단 버튼은 stop_dialog 트리거 버튼으로 존재
      const stopGenBtn = document.querySelector(
        "button[aria-label*='중단'], button[aria-label*='stop'], " +
        "button[data-state][class*='stop']"
      );

      // 전송 버튼 탐색 — 단, 중단 버튼이 없을 때만 완료로 판정
      const sendBtn = findSendButton();
      const isSendReady = sendBtn && !sendBtn.disabled &&
        window.getComputedStyle(sendBtn).display !== "none" &&
        window.getComputedStyle(sendBtn).visibility !== "hidden";

      if (!stopGenBtn && isSendReady) {
        // 추가 안정화 대기 — 짧은 응답 후 UI가 완전히 정착하는 시간
        await sleep(1000);
        break;
      }

      await sleep(1000);
    }

    // 생성 완료 후 → 편집 전 최종 안정화
    await sleep(2000);
  }

  // ==============================================
  //  DOM으로 메시지 전송
  // ==============================================
  async function sendMessageViaDOM(text) {
    const textarea = findTextarea();
    if (!textarea) throw new Error("채팅 입력창을 찾을 수 없습니다.");

    setReactValue(textarea, text);
    await sleep(1000);

    const sendBtn = findSendButton();
    if (!sendBtn) throw new Error("전송 버튼을 찾을 수 없습니다.");

    sendBtn.click();

    await waitForGenerationEnd();
  }

  // ==============================================
  //  1단계: 로그 저장
  // ==============================================
  async function exportLog() {
    const ids = parsePath();
    if (!ids) { alert("채팅방 페이지에서만 사용 가능합니다."); return; }

    setStatus("메시지 수집 시작...");
    const messages = await fetchAllMessages(ids.chatId);

    if (!messages.length) { alert("메시지가 없습니다."); return; }

    const log = {
      exportedAt: new Date().toISOString(),
      sourceUrl: location.href,
      storyId: ids.storyId,
      chatId: ids.chatId,
      messageCount: messages.length,
      messages: messages
        .filter(m => !m.isPrologue)
        .map(m => ({
          id: m._id ?? m.id,
          role: m.role,
          content: m.content,
          crackerModel: m.crackerModel,
          chatModelId: m.chatModelId,
        })),
    };

    // 저장 방식 선택
    const saveMode = await chooseSaveMode(log.messages.length);
    if (!saveMode) return; // 취소

    if (saveMode === "browser" || saveMode === "both") {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    }
    if (saveMode === "file" || saveMode === "both") {
      const ts = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
      downloadJson(log, `crack_log_${ts}.json`);
    }

    const modeLabel = { browser: "브라우저에 임시 보관", file: "JSON 파일로 다운로드", both: "브라우저 보관 + JSON 파일 다운로드" }[saveMode];
    setStatus(`완료! ${log.messages.length}개 메시지 저장됨`);
    alert(
      `${log.messages.length}개 메시지를 저장했습니다.\n저장 방식: ${modeLabel}\n\n` +
      `이제 새 세션을 만들고 그 채팅방으로 이동한 뒤 [2단계: 세션 이식]을 눌러주세요.`
    );
  }

  // 저장 방식 선택 다이얼로그
  function chooseSaveMode(count) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:200000;
        background:rgba(0,0,0,0.6);
        display:flex;align-items:center;justify-content:center;
      `;
      const box = document.createElement("div");
      box.style.cssText = `
        width:320px;background:#1a1a1a;color:#fff;
        border-radius:14px;padding:20px;
        font-family:system-ui,sans-serif;
        box-shadow:0 10px 40px rgba(0,0,0,0.5);
      `;
      box.innerHTML = `
        <div style="font-size:16px;font-weight:700;margin-bottom:6px;">💾 저장 방식 선택</div>
        <div style="font-size:13px;opacity:0.75;margin-bottom:16px;">수집된 메시지: ${count}개</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button id="cst-save-browser" style="${btnStyleStr('#5E35B1')}">🗃️ 브라우저에 임시 보관<br><small style="opacity:.7;font-weight:400">같은 브라우저에서 바로 이식 가능</small></button>
          <button id="cst-save-file" style="${btnStyleStr('#1565C0')}">📂 JSON 파일로 다운로드<br><small style="opacity:.7;font-weight:400">다른 기기 이식 · 영구 보관 가능</small></button>
          <button id="cst-save-both" style="${btnStyleStr('#2E7D32')}">✅ 둘 다</button>
          <button id="cst-save-cancel" style="${btnStyleStr('#333', true)}">취소</button>
        </div>
      `;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      function close(val) { overlay.remove(); resolve(val); }
      box.querySelector("#cst-save-browser").onclick = () => close("browser");
      box.querySelector("#cst-save-file").onclick    = () => close("file");
      box.querySelector("#cst-save-both").onclick    = () => close("both");
      box.querySelector("#cst-save-cancel").onclick  = () => close(null);
      overlay.onclick = (e) => { if (e.target === overlay) close(null); };
    });
  }

  // ==============================================
  //  2단계: 세션 이식 (핵심 로직 재설계)
  // ==============================================
  async function importLog() {
    const ids = parsePath();
    if (!ids) { alert("채팅방 페이지에서만 사용 가능합니다."); return; }

    const source = await chooseImportSource();
    if (!source) return;

    let log;
    try {
      log = typeof source === "string" ? JSON.parse(source) : source;
    } catch (e) {
      alert("JSON 파싱 오류: " + e.message);
      return;
    }

    if (!log.messages?.length) {
      alert("이식할 메시지가 없습니다.");
      return;
    }

    // 사전 DOM 검증
    if (!findTextarea()) {
      alert("채팅 입력창을 찾을 수 없습니다.\n페이지가 완전히 로드됐는지 확인해주세요.");
      return;
    }

    if (!confirm(
      `${log.messages.length}개 메시지를 현재 채팅방(${ids.chatId})에 이식합니다.\n\n` +
      `원본: ${log.sourceUrl}\n\n` +
      `⚠️ 이식 전 채팅 모델을 일반챗으로 자동 전환합니다.\n` +
      `⚠️ 이식 중에는 채팅창에서 다른 작업을 하지 마세요.\n` +
      `⚠️ 이식이 끝나기 전에 페이지를 이동하지 마세요.\n\n` +
      `계속하시겠습니까?`
    )) return;

    // 일반챗으로 전환 (비용 절감 + 짧은 응답 유도)
    setStatus("일반챗으로 전환 중...");
    const switched = await switchToNormalChat(ids.chatId);
    if (!switched) {
      if (!confirm("일반챗 전환에 실패했습니다.\n현재 모델 그대로 이식을 계속할까요?\n(유료 크래커가 소모될 수 있습니다)")) return;
    }

    showStopButton();
    stopRequested = false;

    const messages = log.messages;
    let i = 0;
    let successCount = 0;

    // 최신 N개 메시지를 가져오되, anchorId 이후에 생긴 것만 필터
    async function getNewMessages(anchorId) {
      const json = await apiGet(`${API_BASE}/v3/chats/${ids.chatId}/messages?limit=10`);
      const data = json.data ?? json;
      const all = data.messages ?? []; // 최신순
      console.log("[CST] getNewMessages raw (최신순):", JSON.stringify(
        all.map(m => ({ id: m._id ?? m.id, role: m.role, content: (m.content ?? "").slice(0, 20) }))
      ));
      console.log("[CST] anchorId:", anchorId);
      if (!anchorId) return all;
      const cutIdx = all.findIndex(m => (m._id ?? m.id) === anchorId);
      console.log("[CST] cutIdx:", cutIdx, "→ newMsgs count:", cutIdx === -1 ? all.length : cutIdx);
      return cutIdx === -1 ? all : all.slice(0, cutIdx);
    }

    // 현재 최신 메시지 ID를 앵커로 기록
    async function getLatestId() {
      const json = await apiGet(`${API_BASE}/v3/chats/${ids.chatId}/messages?limit=1`);
      const data = json.data ?? json;
      const msgs = data.messages ?? [];
      const id = msgs.length > 0 ? (msgs[0]._id ?? msgs[0].id) : null;
      console.log("[CST] getLatestId →", id, msgs.length > 0 ? `role:${msgs[0].role}` : "(없음)");
      return id;
    }

    try {
      while (i < messages.length) {
        if (stopRequested) { setStatus("중단됨"); break; }

        const cur = messages[i];

        if (cur.role === "user") {
          const next = messages[i + 1];
          const hasBotNext = next && next.role === "assistant";

          // 전송 전 앵커 ID 기록
          const anchorId = await getLatestId();

          // ── 유저 + 봇 쌍 ──
          if (hasBotNext) {
            setStatus(`전송 중... (${i + 1}–${i + 2} / ${messages.length})`);
            await sendMessageViaDOM(DUMMY_MSG);
            if (stopRequested) break;

            // 앵커 이후 새 메시지만 추출
            await sleep(1500);
            const newMsgs = await getNewMessages(anchorId);

            // role 기준으로 최신 유저/봇 메시지 1개씩 찾기
            const botMsg  = newMsgs.find(m => m.role === "assistant");
            const userMsg = newMsgs.find(m => m.role === "user");
            console.log("[CST] newMsgs count:", newMsgs.length, "userMsg:", userMsg ? (userMsg._id ?? userMsg.id) : "없음", "botMsg:", botMsg ? (botMsg._id ?? botMsg.id) : "없음");

            if (userMsg) {
              setStatus(`편집 중... 유저 (${i + 1} / ${messages.length})`);
              console.log("[CST] editMessage user →", userMsg._id ?? userMsg.id);
              const r1 = await editMessage(ids.chatId, userMsg._id ?? userMsg.id, cur.content);
              console.log("[CST] editMessage user 응답:", JSON.stringify(r1)?.slice(0, 100));
              await sleep(1000);
              successCount++;
            } else {
              console.warn("[CST] userMsg 없음 — 편집 건너뜀");
            }
            if (botMsg) {
              setStatus(`편집 중... 봇 (${i + 2} / ${messages.length})`);
              console.log("[CST] editMessage bot →", botMsg._id ?? botMsg.id);
              const r2 = await editMessage(ids.chatId, botMsg._id ?? botMsg.id, next.content);
              console.log("[CST] editMessage bot 응답:", JSON.stringify(r2)?.slice(0, 100));
              await sleep(1000);
              successCount++;
            } else {
              console.warn("[CST] botMsg 없음 — 편집 건너뜀");
            }

            i += 2;

          } else {
            // ── 유저 단독 ──
            setStatus(`전송 중... (${i + 1} / ${messages.length})`);
            await sendMessageViaDOM(DUMMY_MSG);
            if (stopRequested) break;

            await sleep(1000);
            const newMsgs = await getNewMessages(anchorId);
            const userMsg = newMsgs.find(m => m.role === "user");
            if (userMsg) {
              setStatus(`편집 중... (${i + 1} / ${messages.length})`);
              await editMessage(ids.chatId, userMsg._id ?? userMsg.id, cur.content);
              await sleep(1000);
              successCount++;
            }
            i++;
          }

        } else if (cur.role === "assistant") {
          // ── 봇 단독 ──
          const anchorId = await getLatestId();
          setStatus(`봇 메시지 삽입 중... (${i + 1} / ${messages.length})`);
          await sendMessageViaDOM(DUMMY_MSG);
          if (stopRequested) break;

          await sleep(1000);
          const newMsgs = await getNewMessages(anchorId);
          const botMsg = newMsgs.find(m => m.role === "assistant");
          if (botMsg) {
            await editMessage(ids.chatId, botMsg._id ?? botMsg.id, cur.content);
            await sleep(1000);
            successCount++;
          }
          i++;

        } else {
          console.warn(`[Crack Session Tool] 알 수 없는 role: ${cur.role}, 건너뜀`);
          i++;
        }

        // 루프 간 쿨다운 — 일반챗 반복 경고 방지
        await sleep(3000);
      }

      if (!stopRequested) {
        setStatus("이식 완료!");
        alert(`세션 이식이 완료됐습니다!\n총 ${successCount}개 메시지 이식됨.\n\n페이지를 새로고침해서 확인해보세요.`);
      } else {
        alert(`이식이 중단됐습니다.\n현재까지 ${successCount}개 메시지 이식됨.`);
      }

    } catch (err) {
      alert("오류 발생: " + err.message);
      console.error("[Crack Session Tool]", err);
      setStatus("오류 발생: " + err.message);
    } finally {
      hideStopButton();
    }
  }

  // ==============================================
  //  가져오기 소스 선택 다이얼로그
  // ==============================================
  function chooseImportSource() {
    return new Promise((resolve) => {
      const saved = localStorage.getItem(STORAGE_KEY);

      const overlay = document.createElement("div");
      overlay.style.cssText = `
        position:fixed;inset:0;z-index:200000;
        background:rgba(0,0,0,0.6);
        display:flex;align-items:center;justify-content:center;
      `;

      const box = document.createElement("div");
      box.style.cssText = `
        width:340px;background:#1a1a1a;color:#fff;
        border-radius:14px;padding:20px;
        font-family:system-ui,sans-serif;
        box-shadow:0 10px 40px rgba(0,0,0,0.5);
      `;

      const savedInfo = saved ? (() => {
        try {
          const p = JSON.parse(saved);
          return `${p.messages?.length ?? "?"}개 메시지 / ${new Date(p.exportedAt).toLocaleDateString("ko-KR")}`;
        } catch { return "저장된 로그"; }
      })() : null;

      box.innerHTML = `
        <div style="font-size:16px;font-weight:700;margin-bottom:8px;">📥 로그 불러오기</div>
        <div style="font-size:13px;opacity:0.8;margin-bottom:16px;line-height:1.5;">어디서 로그를 불러올까요?</div>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button id="cst-src-storage" style="${btnStyleStr('#5E35B1')}" ${!saved ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>
            💾 ${savedInfo ? `브라우저 저장 로그 사용 (${savedInfo})` : '저장된 로그 없음'}
          </button>
          <button id="cst-src-file" style="${btnStyleStr('#1565C0')}">
            📂 JSON 파일에서 불러오기
          </button>
          <button id="cst-src-cancel" style="${btnStyleStr('#333', true)}">
            취소
          </button>
        </div>
      `;

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      function close(val) { overlay.remove(); resolve(val); }

      box.querySelector("#cst-src-storage").onclick = () => { if (saved) close(saved); };
      box.querySelector("#cst-src-file").onclick = () => {
        overlay.remove();
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = (e) => {
          const file = e.target.files[0];
          if (!file) { resolve(null); return; }
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.readAsText(file);
        };
        input.click();
      };
      box.querySelector("#cst-src-cancel").onclick = () => close(null);
      overlay.onclick = (e) => { if (e.target === overlay) close(null); };
    });
  }

  function btnStyleStr(bg, border = false) {
    return `
      padding:10px 14px;border-radius:10px;
      border:${border ? '1px solid rgba(255,255,255,0.2)' : 'none'};
      background:${bg};color:white;font-weight:600;
      cursor:pointer;font-size:13px;width:100%;text-align:left;
    `;
  }

  // ==============================================
  //  UI: 플로팅 버튼
  // ==============================================
  function mountButtons() {
    if (!isChattingPage()) {
      removeButtons();
      return;
    }
    if (document.getElementById(BTN_ID_EXPORT)) return;

    const btnExport = document.createElement("button");
    btnExport.id = BTN_ID_EXPORT;
    btnExport.textContent = "1단계: 로그 저장";
    btnExport.style.cssText = floatBtnStyle("#5E35B1", "80px");
    btnExport.onclick = async () => {
      if (running) return;
      running = true;
      stopRequested = false;
      btnExport.disabled = true;
      try {
        await exportLog();
      } catch (e) {
        alert("오류: " + e.message);
        console.error("[Crack Session Tool]", e);
        setStatus("오류: " + e.message);
      } finally {
        running = false;
        btnExport.disabled = false;
        btnExport.textContent = "1단계: 로그 저장";
      }
    };

    const btnImport = document.createElement("button");
    btnImport.id = BTN_ID_IMPORT;
    btnImport.textContent = "2단계: 세션 이식";
    btnImport.style.cssText = floatBtnStyle("#1B5E20", "130px");
    btnImport.onclick = async () => {
      if (running) return;
      running = true;
      stopRequested = false;
      btnImport.disabled = true;
      try {
        await importLog();
      } catch (e) {
        alert("오류: " + e.message);
        console.error("[Crack Session Tool]", e);
        setStatus("오류: " + e.message);
      } finally {
        running = false;
        btnImport.disabled = false;
        btnImport.textContent = "2단계: 세션 이식";
        hideStopButton();
      }
    };

    document.body.appendChild(btnExport);
    document.body.appendChild(btnImport);
  }

  function removeButtons() {
    document.getElementById(BTN_ID_EXPORT)?.remove();
    document.getElementById(BTN_ID_IMPORT)?.remove();
    document.getElementById(BTN_ID_STOP)?.remove();
  }

  function floatBtnStyle(bg, bottom) {
    return `
      position:fixed;bottom:${bottom};right:20px;z-index:99999;
      padding:9px 14px;font-size:13px;font-weight:700;color:white;
      background:${bg};border:none;border-radius:22px;
      cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,0.35);
      transition:opacity 0.2s;
    `;
  }

  function showStopButton() {
    if (document.getElementById(BTN_ID_STOP)) return;
    const btn = document.createElement("button");
    btn.id = BTN_ID_STOP;
    btn.textContent = "⏹ 중단";
    btn.style.cssText = floatBtnStyle("#B71C1C", "180px");
    btn.onclick = () => {
      stopRequested = true;
      btn.textContent = "중단 요청됨...";
      btn.disabled = true;
    };
    document.body.appendChild(btn);
  }

  function hideStopButton() {
    document.getElementById(BTN_ID_STOP)?.remove();
  }

  function setStatus(msg) {
    console.log("[Crack Session Tool]", msg);
    const truncated = msg.length > 22 ? msg.slice(0, 22) + "…" : msg;
    const btnE = document.getElementById(BTN_ID_EXPORT);
    const btnI = document.getElementById(BTN_ID_IMPORT);
    if (btnE?.disabled) btnE.textContent = truncated;
    if (btnI?.disabled) btnI.textContent = truncated;
  }

  // ==============================================
  //  유틸
  // ==============================================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==============================================
  //  마운트 / SPA 대응
  // ==============================================
  window.addEventListener("load", mountButtons);

  let _lastUrl = location.href;
  new MutationObserver(() => {
    const url = location.href;
    if (url !== _lastUrl) {
      _lastUrl = url;
      setTimeout(mountButtons, 800);
      setTimeout(mountButtons, 1500);
    }
  }).observe(document, { subtree: true, childList: true });

  setInterval(() => {
    if (isChattingPage()) mountButtons();
    else removeButtons();
  }, 2000);

})();