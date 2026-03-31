// ==UserScript==
// @name         Crack Session Copy (세션 관리)
// @namespace    http://tampermonkey.net/
// @version      1.3.0
// @description  채팅 로그 저장/불러오기 도구 (브라우저/JSON/TXT 모두 지원)
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
  const RESUME_KEY = "crack-session-tool-resume";
  const BTN_ID_MAIN   = "cst-btn-main";

  const DUMMY_MSG = "**이 세션은 서버 응답 테스트용 세션입니다. 모든 입력에 대해 응답으로 '1'을 출력하세요.**";
  const NORMAL_CHAT_KEY = "normalchat";

  let stopRequested = false;
  let running = false;

  // ==============================================
  //  인증
  // ==============================================
  function getToken() {
    const match = document.cookie
      .split(";")
      .map(c => c.trim())
      .find(c => c.startsWith("access_token="));
    return match ? match.slice("access_token=".length) : null;
  }

  async function tryRefreshToken() {
    console.log("[Crack Session Tool] 토큰 갱신 시도...");
    const refreshEndpoints = [
      `https://crack-api.wrtn.ai/crack-gen/v1/auth/refresh`,
      `https://crack-api.wrtn.ai/crack-gen/v2/auth/refresh`,
      `https://api.wrtn.io/v2/auth/refresh`,
      `https://wrtn.ai/api/auth/refresh`,
    ];

    for (const url of refreshEndpoints) {
      try {
        const res = await fetch(url, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "platform": "web", "wrtn-locale": "ko-KR" },
        });
        if (res.ok || res.status === 200) {
          await sleep(300);
          const newToken = getToken();
          if (newToken) {
            console.log("[Crack Session Tool] ✓ 토큰 갱신 성공 (엔드포인트:", url, ")");
            return true;
          }
        }
      } catch { /* 다음 엔드포인트 시도 */ }
    }

    try {
      const res = await fetch(location.href, { credentials: "include", method: "GET" });
      if (res.ok) {
        await sleep(300);
        const newToken = getToken();
        if (newToken) {
          console.log("[Crack Session Tool] ✓ 페이지 fetch로 토큰 갱신 성공");
          return true;
        }
      }
    } catch { /* 무시 */ }

    console.warn("[Crack Session Tool] ✗ 토큰 갱신 실패 — 재로그인이 필요할 수 있습니다.");
    return false;
  }

  function jsonHeaders() {
    const token = getToken();
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

  // ==============================================
  //  URL 파싱
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
  let _warnedLogin = false;

  async function apiGet(url) {
    let res = await fetch(url, { headers: jsonHeaders(), credentials: "include" });
    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        res = await fetch(url, { headers: jsonHeaders(), credentials: "include" });
      } else {
        if (!_warnedLogin) {
          _warnedLogin = true;
          alert("인증 토큰이 만료되었고 자동 갱신에 실패했습니다.\n\n페이지를 새로고침하거나 재로그인 후 다시 시도해 주세요.");
        }
        const text = await res.text().catch(() => "");
        throw new Error(`API 오류 ${res.status}: ${text.slice(0, 200)}`);
      }
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API 오류 ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async function apiPatch(url, body) {
    let res = await fetch(url, {
      method: "PATCH", headers: jsonHeaders(), credentials: "include", body: JSON.stringify(body),
    });
    if (res.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        res = await fetch(url, { method: "PATCH", headers: jsonHeaders(), credentials: "include", body: JSON.stringify(body) });
      } else {
        const text = await res.text().catch(() => "");
        throw new Error(`PATCH 오류 ${res.status}: ${text.slice(0, 200)}`);
      }
    }
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
    messages.reverse();
    return messages;
  }

  async function editMessage(chatId, messageId, content) {
    return apiPatch(`${API_BASE}/v3/chats/${chatId}/messages/${messageId}`, { message: content });
  }

  // ==============================================
  //  채팅 모델 관련
  // ==============================================
  async function fetchChatInfo(chatId) {
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}`);
    return json.data ?? json;
  }

  async function findNormalChatModelId(chatId) {
    try {
      const raw = document.getElementById("__NEXT_DATA__")?.textContent;
      if (raw) {
        const nd = JSON.parse(raw);
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
        if (fromTree) return fromTree;
      }
    } catch (e) { }

    const endpoints = [
      `${API_BASE}/v2/crackers/models`, `${API_BASE}/v3/chat-models`,
      `${API_BASE}/v2/chat-models`, `${API_BASE}/v1/crackers/models`,
    ];
    for (const url of endpoints) {
      try {
        const json = await apiGet(url);
        const list = json.data ?? json;
        const arr = Array.isArray(list) ? list : (list.models ?? list.crackerModels ?? list.chatModels ?? []);
        const hit = arr.find(m => (m.crackerModel ?? m.key ?? m.type ?? m.name ?? "").toLowerCase() === NORMAL_CHAT_KEY);
        if (hit) return hit.chatModelId ?? hit._id ?? hit.id;
      } catch { }
    }
    return null;
  }

  async function switchToNormalChat(chatId) {
    try {
      const info = await fetchChatInfo(chatId);
      const cur = (info.crackerModel ?? "").toLowerCase();
      if (cur === NORMAL_CHAT_KEY) return true;
    } catch { }

    const normalId = await findNormalChatModelId(chatId);
    if (!normalId) return false;

    const patchTargets = [
      { url: `${API_BASE}/v3/chats/${chatId}/model`, body: { chatModelId: normalId } },
      { url: `${API_BASE}/v3/chats/${chatId}`,       body: { chatModelId: normalId } },
    ];
    for (const pt of patchTargets) {
      try {
        await apiPatch(pt.url, pt.body);
        return true;
      } catch (e) { }
    }
    return false;
  }

  // ==============================================
  //  DOM 탐색 및 에러 감지
  // ==============================================
  function findTextarea() {
    return (
      document.querySelector("textarea.__chat_input_textarea") ||
      document.querySelector("textarea[placeholder*='메시지']") ||
      document.querySelector("textarea.rc-textarea")
    );
  }

  function findSendButton() {
    const byClass = document.querySelector("button.bg-primary.text-primary-foreground.rounded-full:not([disabled])");
    if (byClass) return byClass;
    const byColor = document.querySelector("button[style*='background-color: rgb(255, 99, 1)']:not([disabled])");
    if (byColor) return byColor;
    const ta = findTextarea();
    if (ta) {
      let container = ta.parentElement;
      for (let i = 0; i < 6 && container; i++) {
        const btns = Array.from(container.querySelectorAll("button.rounded-full:not([disabled])"));
        if (btns.length) return btns[btns.length - 1];
        container = container.parentElement;
      }
    }
    return null;
  }

  function findStopButton() {
    const allPaths = document.querySelectorAll('button svg path');
    for (const path of allPaths) {
      const d = path.getAttribute('d');
      if (d && (d.includes('M6 6h12v12H6') || d.includes('M6 6h12v12H6Z'))) {
        return path.closest('button');
      }
    }
    return null;
  }

  function detectError() {
    const toasts = document.querySelectorAll('[role="alert"], [role="status"], .toast, [class*="toast"]');
    for (const toast of toasts) {
      const text = toast.textContent.toLowerCase();
      if (text.includes('오류') || text.includes('error') || text.includes('실패') ||
          text.includes('fail') || text.includes('문제') || text.includes('problem')) {
        return { found: true, type: 'toast', element: toast, message: toast.textContent };
      }
    }
    return { found: false };
  }

  function dismissError(errorInfo) {
    if (!errorInfo || !errorInfo.found) return;
    try {
      const closeBtn = errorInfo.element.querySelector('button[aria-label*="닫기"], button[aria-label*="close"], button.close, [role="button"][aria-label*="dismiss"]');
      if (closeBtn) { closeBtn.click(); return; }
    } catch (err) { }
  }

  async function sendMessageWithRetry(text, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const preError = detectError();
        if (preError.found) { dismissError(preError); await sleep(1000); }

        await sendMessageViaDOM(text);
        await sleep(800);

        const postError = detectError();
        if (postError.found) {
          dismissError(postError);
          if (attempt < maxRetries) { await sleep(2000); continue; }
          else return false;
        }
        return true;
      } catch (err) {
        if (attempt < maxRetries) await sleep(2000);
        else return false;
      }
    }
    return false;
  }

  function isErrorMessage(message) {
    if (!message) return false;
    const role = (message.role ?? "").toLowerCase();
    if (role === "system" || role === "error") return true;
    const messageType = (message.messageType ?? message.type ?? "").toLowerCase();
    if (messageType === "error" || messageType === "warning") return true;
    if (message.isError === true) return true;
    return false;
  }

  async function getNewMessages(chatId, anchorId) {
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}/messages?limit=10`);
    const data = json.data ?? json;
    const all = data.messages ?? [];

    let afterAnchor = all;
    if (anchorId) {
      const cutIdx = all.findIndex(m => (m._id ?? m.id) === anchorId);
      afterAnchor = cutIdx === -1 ? all : all.slice(0, cutIdx);
    }

    const withoutErrors = afterAnchor.filter(m => !isErrorMessage(m));
    return { all: afterAnchor, filtered: withoutErrors, errorCount: afterAnchor.length - withoutErrors.length };
  }

  async function getLatestId(chatId) {
    const json = await apiGet(`${API_BASE}/v3/chats/${chatId}/messages?limit=1`);
    const data = json.data ?? json;
    const msgs = data.messages ?? [];
    return msgs.length > 0 ? (msgs[0]._id ?? msgs[0].id) : null;
  }

  async function verifyAndGetMessages(chatId, anchorId, expectedRoles = ['user', 'assistant']) {
    await sleep(600);
    const result = await getNewMessages(chatId, anchorId);
    const allMsgs = result.all;
    const newMsgs = result.filtered;
    const hasErrorOnly = allMsgs.length > 0 && newMsgs.length === 0;

    const verification = { success: false, userMsg: null, botMsg: null, newMsgs, hasErrorOnly, needsResend: false };

    if (expectedRoles.includes('user')) verification.userMsg = newMsgs.find(m => m.role === 'user');
    if (expectedRoles.includes('assistant')) verification.botMsg = newMsgs.find(m => m.role === 'assistant');

    verification.success = (expectedRoles.includes('user') && verification.userMsg) ||
                           (expectedRoles.includes('assistant') && verification.botMsg) ||
                           (!expectedRoles.includes('user') && !expectedRoles.includes('assistant'));

    if (hasErrorOnly && !verification.success) verification.needsResend = true;
    return verification;
  }

  function setReactValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async function waitForGenerationEnd(timeout = 150_000) {
    const start = Date.now();
    let stopBtn = null;
    const waitForStopStart = Date.now();
    while (Date.now() - waitForStopStart < 6000) {
      if (stopRequested) return;
      stopBtn = findStopButton();
      if (stopBtn) break;
      await sleep(100);
    }
    if (!stopBtn) { await sleep(800); return; }

    while (Date.now() - start < timeout) {
      if (stopRequested) return;
      stopBtn = findStopButton();
      if (!stopBtn) break;
      await sleep(500);
    }

    let sendBtn = null;
    const waitForSendStart = Date.now();
    while (Date.now() - waitForSendStart < 4000) {
      if (stopRequested) return;
      sendBtn = findSendButton();
      if (sendBtn && !sendBtn.disabled) break;
      await sleep(100);
    }
    await sleep(300);
  }

  async function sendMessageViaDOM(text) {
    const textarea = findTextarea();
    if (!textarea) throw new Error("채팅 입력창을 찾을 수 없습니다.");
    setReactValue(textarea, text);

    let sendBtn = null;
    const waitStart = Date.now();
    while (Date.now() - waitStart < 2000) {
      sendBtn = findSendButton();
      if (sendBtn && !sendBtn.disabled) break;
      await sleep(50);
    }
    if (!sendBtn) sendBtn = findSendButton();
    if (!sendBtn) throw new Error("전송 버튼을 찾을 수 없습니다.");
    sendBtn.click();
    await waitForGenerationEnd();
  }

  // ==============================================
  //  저장 / 불러오기 (이어하기 포함)
  // ==============================================
  function saveResumeData(log, index, successCount) {
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify({ log, currentIndex: index, successCount }));
    } catch(e) { console.warn("진척도 저장 실패:", e); }
  }

  async function exportLog(format) {
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
      messages: messages.filter(m => !m.isPrologue).map(m => ({
        id: m._id ?? m.id, role: m.role, content: m.content,
        crackerModel: m.crackerModel, chatModelId: m.chatModelId,
      })),
    };

    const ts = new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");

    if (format === "browser") localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    else if (format === "json") downloadJson(log, `crack_log_${ts}.json`);
    else if (format === "txt") downloadText(messagesToText(log.messages), `crack_log_${ts}.txt`);

    setStatus(`완료! ${log.messages.length}개 메시지 저장됨`);
    alert(`${log.messages.length}개 메시지를 저장했습니다.\n이제 새 세션을 만들고 그 채팅방으로 이동한 뒤 다시 불러오기를 진행해주세요.`);
  }

  async function importLog(logData, startIndex = 0, initialSuccessCount = 0) {
    const ids = parsePath();
    if (!ids) { alert("채팅방 페이지에서만 사용 가능합니다."); return; }

    let log;
    try { log = typeof logData === "string" ? JSON.parse(logData) : logData; }
    catch (e) { alert("JSON 파싱 오류: " + e.message); return; }

    if (!log.messages?.length) { alert("이식할 메시지가 없습니다."); return; }
    if (!findTextarea()) { alert("채팅 입력창을 찾을 수 없습니다.\n페이지가 완전히 로드됐는지 확인해주세요."); return; }

    const isResume = startIndex > 0;
    const msgCount = log.messages.length - startIndex;
    const confirmMsg = isResume
      ? `중단되었던 ${startIndex + 1}번째 메시지부터 이식을 이어갑니다.\n(남은 메시지: ${msgCount}개)\n\n계속하시겠습니까?`
      : `${log.messages.length}개 메시지를 현재 채팅방(${ids.chatId})에 이식합니다.\n\n⚠️ 이식 전 채팅 모델을 일반챗으로 자동 전환합니다.\n⚠️ 이식 중에는 다른 작업을 하지 마세요.\n\n계속하시겠습니까?`;

    if (!confirm(confirmMsg)) return;

    setStatus("일반챗으로 전환 중...");
    const switched = await switchToNormalChat(ids.chatId);
    if (!switched) {
      if (!confirm("일반챗 전환에 실패했습니다.\n현재 모델 그대로 이식을 계속할까요?")) return;
    }

    stopRequested = false;
    const messages = log.messages;
    let i = startIndex;
    let successCount = initialSuccessCount;

    try {
      while (i < messages.length) {
        if (stopRequested) {
          setStatus("중단됨");
          break;
        }

        const cur = messages[i];

        if (cur.role === "user") {
          const next = messages[i + 1];
          const hasBotNext = next && next.role === "assistant";
          const anchorId = await getLatestId(ids.chatId);

          if (hasBotNext) {
            setStatus(`전송 중... (${i + 1}–${i + 2} / ${messages.length})`);
            const sent = await sendMessageWithRetry(DUMMY_MSG, 3);
            if (!sent) {
              const userChoice = confirm(`메시지 ${i + 1}-${i + 2} 전송 실패.\n\n[확인] = 건너뛰고 계속\n[취소] = 이식 중단(저장)`);
              if (!userChoice) { stopRequested = true; break; }
              i += 2; continue;
            }

            let verified = await verifyAndGetMessages(ids.chatId, anchorId, ['user', 'assistant']);
            for (let retryCount = 1; !verified.success && retryCount <= 2; retryCount++) {
              if (verified.needsResend) {
                const resentAnchor = await getLatestId(ids.chatId);
                await sendMessageWithRetry(DUMMY_MSG, 2); await sleep(1500);
                verified = await verifyAndGetMessages(ids.chatId, resentAnchor, ['user', 'assistant']);
              } else {
                await sleep(1500);
                verified = await verifyAndGetMessages(ids.chatId, anchorId, ['user', 'assistant']);
              }
            }

            // 빈 메시지 방어 로직 (1글자 이상 보장)
            const safeUserContent = (cur.content && cur.content.trim().length > 0) ? cur.content : "(내용 없음)";
            const safeBotContent = (next.content && next.content.trim().length > 0) ? next.content : "(내용 없음)";

            if (verified.userMsg) {
              setStatus(`편집 중... 유저 (${i + 1} / ${messages.length})`);
              await editMessage(ids.chatId, verified.userMsg._id ?? verified.userMsg.id, safeUserContent);
              await sleep(500); successCount++;
            }
            if (verified.botMsg) {
              setStatus(`편집 중... 봇 (${i + 2} / ${messages.length})`);
              await editMessage(ids.chatId, verified.botMsg._id ?? verified.botMsg.id, safeBotContent);
              await sleep(500); successCount++;
            }
            i += 2;

          } else {
            setStatus(`전송 중... (${i + 1} / ${messages.length})`);
            const sent = await sendMessageWithRetry(DUMMY_MSG, 3);
            if (!sent) {
              const userChoice = confirm(`메시지 ${i + 1} 전송 실패.\n\n[확인] = 건너뛰기\n[취소] = 이식 중단(저장)`);
              if (!userChoice) { stopRequested = true; break; }
              i++; continue;
            }

            let verified = await verifyAndGetMessages(ids.chatId, anchorId, ['user']);
            for (let retryCount = 1; !verified.success && retryCount <= 2; retryCount++) {
              if (verified.needsResend) {
                const resentAnchor = await getLatestId(ids.chatId);
                await sendMessageWithRetry(DUMMY_MSG, 2); await sleep(1500);
                verified = await verifyAndGetMessages(ids.chatId, resentAnchor, ['user']);
              } else {
                await sleep(1500);
                verified = await verifyAndGetMessages(ids.chatId, anchorId, ['user']);
              }
            }

            // 빈 메시지 방어 로직
            const safeUserContent = (cur.content && cur.content.trim().length > 0) ? cur.content : "(내용 없음)";

            if (verified.userMsg) {
              setStatus(`편집 중... (${i + 1} / ${messages.length})`);
              await editMessage(ids.chatId, verified.userMsg._id ?? verified.userMsg.id, safeUserContent);
              await sleep(500); successCount++;
            }
            i++;
          }

        } else if (cur.role === "assistant") {
          const anchorId = await getLatestId(ids.chatId);
          setStatus(`봇 메시지 삽입 중... (${i + 1} / ${messages.length})`);
          const sent = await sendMessageWithRetry(DUMMY_MSG, 3);
          if (!sent) {
            const userChoice = confirm(`메시지 ${i + 1} 전송 실패.\n\n[확인] = 건너뛰기\n[취소] = 이식 중단(저장)`);
            if (!userChoice) { stopRequested = true; break; }
            i++; continue;
          }

          let verified = await verifyAndGetMessages(ids.chatId, anchorId, ['assistant']);
          for (let retryCount = 1; !verified.success && retryCount <= 2; retryCount++) {
            if (verified.needsResend) {
              const resentAnchor = await getLatestId(ids.chatId);
              await sendMessageWithRetry(DUMMY_MSG, 2); await sleep(1500);
              verified = await verifyAndGetMessages(ids.chatId, resentAnchor, ['assistant']);
            } else {
              await sleep(1500);
              verified = await verifyAndGetMessages(ids.chatId, anchorId, ['assistant']);
            }
          }

          // 빈 메시지 방어 로직
          const safeBotContent = (cur.content && cur.content.trim().length > 0) ? cur.content : "(내용 없음)";

          if (verified.botMsg) {
            await editMessage(ids.chatId, verified.botMsg._id ?? verified.botMsg.id, safeBotContent);
            await sleep(500); successCount++;
          }
          i++;
        } else {
          i++;
        }
        await sleep(2000);
      }

      if (!stopRequested && i >= messages.length) {
        setStatus("이식 완료!");
        localStorage.removeItem(RESUME_KEY);
        alert(`세션 이식이 완벽하게 끝났습니다!\n총 ${successCount}개 메시지 이식됨.\n\n페이지를 새로고침해서 확인해보세요.`);
      } else {
        saveResumeData(log, i, successCount);
        alert(`이식이 중단되었습니다.\n현재까지 ${successCount}개 메시지 이식됨.\n\n나중에 '불러오기' 메뉴의 '이어하기'를 통해 계속할 수 있습니다.`);
      }

    } catch (err) {
      saveResumeData(log, i, successCount);
      alert(`오류 발생: ${err.message}\n\n현재 진행 상황(${i + 1}번째)이 자동으로 임시 저장되었습니다.\n나중에 '불러오기' 메뉴에서 '이어하기'를 선택해 중단된 곳부터 시작해 주세요.`);
      console.error("[Crack Session Tool]", err);
      setStatus("오류 발생 (상태 저장됨)");
    }
  }

  // ==============================================
  //  UI 통합 메뉴
  // ==============================================
  function showMainMenu() {
    return new Promise((resolve) => {
      const saved = localStorage.getItem(STORAGE_KEY);
      const resumeRaw = localStorage.getItem(RESUME_KEY);
      const resumeData = resumeRaw ? JSON.parse(resumeRaw) : null;
      let currentMode = "export";

      const overlay = document.createElement("div");
      overlay.style.cssText = `position:fixed;inset:0;z-index:200000;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;`;
      const box = document.createElement("div");
      box.style.cssText = `width:380px;background:#1a1a1a;color:#fff;border-radius:14px;padding:24px;font-family:system-ui,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,0.5);`;

      box.innerHTML = `
        <div style="font-size:17px;font-weight:700;margin-bottom:18px;">🔧 세션 관리</div>
        <div style="display:flex;gap:8px;margin-bottom:20px;">
          <button id="mode-export" style="${modeButtonStyle(true)}">💾 저장하기</button>
          <button id="mode-import" style="${modeButtonStyle(false)}">📥 불러오기</button>
        </div>
        <div style="border-top:1px solid rgba(255,255,255,0.1);margin-bottom:16px;"></div>

        <div style="display:flex;flex-direction:column;gap:10px;">
          <button id="opt-resume" style="${btnStyleStr('#00838F')}; display:none; margin-bottom: 8px;">
            🔄 이어하기<br><small style="opacity:.8;font-weight:400" id="desc-resume">중단된 지점부터 계속</small>
          </button>

          <button id="opt-browser" style="${btnStyleStr('#5E35B1')}">
            🗃️ 브라우저<br><small style="opacity:.7;font-weight:400" id="desc-browser">임시 보관 · 같은 브라우저에서 바로 이식</small>
          </button>
          <button id="opt-json" style="${btnStyleStr('#1565C0')}">
            📂 JSON<br><small style="opacity:.7;font-weight:400" id="desc-json">파일 다운로드 · 다른 기기 이식 가능</small>
          </button>
          <button id="opt-txt" style="${btnStyleStr('#F57C00')}">
            📄 TXT<br><small style="opacity:.7;font-weight:400" id="desc-txt">텍스트 형식 · 에디터로 수정 가능</small>
          </button>
        </div>
      `;

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      const btnModeExport = box.querySelector("#mode-export");
      const btnModeImport = box.querySelector("#mode-import");
      const btnOptResume = box.querySelector("#opt-resume");
      const btnOptBrowser = box.querySelector("#opt-browser");
      const btnOptJson = box.querySelector("#opt-json");
      const btnOptTxt = box.querySelector("#opt-txt");

      const descResume = box.querySelector("#desc-resume");
      const descBrowser = box.querySelector("#desc-browser");
      const descJson = box.querySelector("#desc-json");
      const descTxt = box.querySelector("#desc-txt");

      function updateMode(mode) {
        currentMode = mode;
        const isExport = mode === "export";
        btnModeExport.style.cssText = modeButtonStyle(isExport);
        btnModeImport.style.cssText = modeButtonStyle(!isExport);

        if (isExport) {
          btnOptResume.style.display = "none";
          descBrowser.textContent = "임시 보관 · 같은 브라우저에서 바로 이식";
          descJson.textContent = "파일 다운로드 · 다른 기기 이식 가능";
          descTxt.textContent = "텍스트 형식 · 에디터로 수정 가능";
          [btnOptBrowser, btnOptJson, btnOptTxt].forEach(b => { b.disabled = false; b.style.opacity = "1"; });
        } else {
          if (resumeData && resumeData.currentIndex < resumeData.log.messages.length) {
            btnOptResume.style.display = "block";
            const remain = resumeData.log.messages.length - resumeData.currentIndex;
            descResume.textContent = `중단된 ${resumeData.currentIndex + 1}번째부터 계속 (${remain}개 남음)`;
          } else {
            btnOptResume.style.display = "none";
          }

          const hasSaved = !!saved;
          descBrowser.textContent = hasSaved ? "저장된 로그 이식하기" : "저장된 로그 없음";
          descJson.textContent = "JSON 파일 선택 다이얼로그 열기";
          descTxt.textContent = "TXT 파일 선택 · 에디터로 수정 가능";

          btnOptBrowser.disabled = !hasSaved;
          btnOptBrowser.style.opacity = hasSaved ? "1" : "0.4";
          btnOptBrowser.style.cursor = hasSaved ? "pointer" : "not-allowed";
        }
      }

      function close(val) { overlay.remove(); resolve(val); }

      btnModeExport.onclick = () => updateMode("export");
      btnModeImport.onclick = () => updateMode("import");

      btnOptResume.onclick = () => {
        if (currentMode === "import" && resumeData) {
          close({ mode: "resume", data: resumeData.log, startIndex: resumeData.currentIndex, successCount: resumeData.successCount });
        }
      };

      btnOptBrowser.onclick = () => {
        if (currentMode === "export") close({ mode: "export", format: "browser" });
        else if (saved) close({ mode: "import", source: "browser", data: saved });
      };

      btnOptJson.onclick = () => {
        if (currentMode === "export") close({ mode: "export", format: "json" });
        else {
          overlay.remove();
          const input = document.createElement("input");
          input.type = "file"; input.accept = ".json";
          input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = (ev) => resolve({ mode: "import", source: "json", data: ev.target.result });
            reader.readAsText(file);
          };
          input.click();
        }
      };

      btnOptTxt.onclick = () => {
        if (currentMode === "export") close({ mode: "export", format: "txt" });
        else {
          overlay.remove();
          const input = document.createElement("input");
          input.type = "file"; input.accept = ".txt";
          input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return resolve(null);
            const reader = new FileReader();
            reader.onload = (ev) => {
              const messages = parseTextToMessages(ev.target.result);
              if (!messages.length) { alert("파싱 실패!"); resolve(null); return; }
              const log = { exportedAt: new Date().toISOString(), sourceUrl: "imported_from_txt", messageCount: messages.length, messages };
              resolve({ mode: "import", source: "txt", data: JSON.stringify(log) });
            };
            reader.readAsText(file);
          };
          input.click();
        }
      };

      overlay.onclick = (e) => { if (e.target === overlay) close(null); };
      updateMode("export");
    });
  }

  function modeButtonStyle(active) {
    return `flex:1;padding:10px 12px;border-radius:10px;border:${active ? 'none' : '1px solid rgba(255,255,255,0.2)'};background:${active ? '#5E35B1' : 'transparent'};color:white;font-weight:${active ? '700' : '600'};cursor:pointer;font-size:13px;transition:all 0.2s;`;
  }
  function btnStyleStr(bg, border = false) {
    return `padding:10px 14px;border-radius:10px;border:${border ? '1px solid rgba(255,255,255,0.2)' : 'none'};background:${bg};color:white;font-weight:600;cursor:pointer;font-size:13px;width:100%;text-align:left;`;
  }

  // ==============================================
  //  UI 마운트 및 실행
  // ==============================================
  function mountButtons() {
    if (!isChattingPage()) { removeButtons(); return; }
    if (document.getElementById(BTN_ID_MAIN)) return;

    const btnMain = document.createElement("button");
    btnMain.id = BTN_ID_MAIN;
    btnMain.textContent = "세션 관리";
    btnMain.style.cssText = floatBtnStyle("#5E35B1", "20px");

    btnMain.onclick = async () => {
      if (running) {
        stopRequested = true;
        btnMain.textContent = "중단 요청됨...";
        btnMain.disabled = true;
        return;
      }

      try {
        const result = await showMainMenu();
        if (!result) return;

        running = true; stopRequested = false;
        btnMain.style.cssText = floatBtnStyle("#B71C1C", "20px");
        btnMain.textContent = "⏹ 중단";
        btnMain.disabled = false;

        if (result.mode === "export") await exportLog(result.format);
        else if (result.mode === "import") await importLog(result.data, 0, 0);
        else if (result.mode === "resume") await importLog(result.data, result.startIndex, result.successCount);

      } catch (e) {
        alert("오류: " + e.message); console.error(e); setStatus("오류 발생");
      } finally {
        running = false; stopRequested = false;
        btnMain.disabled = false;
        btnMain.style.cssText = floatBtnStyle("#5E35B1", "20px");
        btnMain.textContent = "세션 관리";
      }
    };
    document.body.appendChild(btnMain);
  }

  function removeButtons() { document.getElementById(BTN_ID_MAIN)?.remove(); }
  function floatBtnStyle(bg, bottom) {
    return `position:fixed;bottom:${bottom};right:20px;z-index:99999;padding:10px 16px;font-size:13px;font-weight:700;color:white;background:${bg};border:none;border-radius:22px;cursor:pointer;box-shadow:0 4px 10px rgba(0,0,0,0.35);transition:opacity 0.2s;`;
  }
  function setStatus(msg) {
    const truncated = msg.length > 18 ? msg.slice(0, 18) + "…" : msg;
    const btn = document.getElementById(BTN_ID_MAIN);
    if (btn?.disabled) btn.textContent = truncated;
  }

  // ==============================================
  //  유틸리티
  // ==============================================
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  function downloadJson(obj, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" }));
    a.download = filename; a.click();
  }
  function downloadText(content, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
    a.download = filename; a.click();
  }
  function messagesToText(messages) {
    return messages.map(m => `[${m.role === 'user' ? '사용자' : 'AI'}]\n${m.content || ''}`).join('\n\n' + '-'.repeat(50) + '\n\n');
  }
  function parseTextToMessages(txtContent) {
    return txtContent.split('\n\n' + '-'.repeat(50) + '\n\n').map(section => {
      const lines = section.trim().split('\n');
      const match = lines[0]?.match(/^\[(사용자|AI)\]$/);
      if (!match) return null;
      return { role: match[1] === '사용자' ? 'user' : 'assistant', content: lines.slice(1).join('\n').trim() };
    }).filter(m => m !== null);
  }

  window.addEventListener("load", mountButtons);
  let _lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== _lastUrl) { _lastUrl = location.href; setTimeout(mountButtons, 800); setTimeout(mountButtons, 1500); }
  }).observe(document, { subtree: true, childList: true });
  setInterval(() => { isChattingPage() ? mountButtons() : removeButtons(); }, 2000);

})();
