// ==UserScript==
// @name         크랙 파피루스
// @version      2.0.0
// @description  유저노트 프리셋 저장/불러오기 + 대화 프로필 폴더/접힘 관리 + 페르소나 이식
// @match        https://crack.wrtn.ai/*
// @require      https://cdn.jsdelivr.net/npm/dexie@4.2.1/dist/dexie.min.js#sha256-STeEejq7AcFOvsszbzgCDL82AjypbLLjD5O6tUByfuA=
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

// @ts-check

// @ts-ignore
GM_addStyle(`
  /* ════════════════════════════════════════════════
     §1  DreamDiary 스타일
     ════════════════════════════════════════════════ */

  [data-crk-pap="expanded"] {
    flex-direction: row !important;
    padding: 0 !important;
    gap: 0 !important;
    align-items: stretch !important;
    overflow: hidden !important;
  }
  #crk-pap-inner {
    flex: 1; display: flex; flex-direction: column;
    gap: 20px; padding: 0 20px 20px; min-width: 0; overflow-y: auto;
  }
  #crk-pap-sidebar {
    width: 160px; flex-shrink: 0; display: flex; flex-direction: column;
    border-right: 1px solid var(--outline_secondary, #e5e3dc);
    background: var(--surface_secondary, #f4f2ec); overflow: hidden;
  }
  .crk-pap-input-block {
    display: flex; flex-direction: column; gap: 6px;
    padding: 12px 10px 10px;
    border-bottom: 1px solid var(--outline_secondary, #e5e3dc); flex-shrink: 0;
  }
  .crk-pap-name-input {
    width: 100%; padding: 6px 8px;
    border: 1px solid var(--outline_secondary, #d0cdc5); border-radius: 6px;
    background: var(--bg-background, #fff); font-size: 12px;
    color: var(--text_primary, #1a1a1a); outline: none;
    box-sizing: border-box; font-family: inherit;
  }
  .crk-pap-name-input:focus {
    border-color: var(--primary, #5b5bd6);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--primary, #5b5bd6) 20%, transparent);
  }
  .crk-pap-name-input::placeholder { color: var(--text_disabled, #bbb); }
  .crk-pap-save-btn {
    width: 100%; padding: 7px 0; background: var(--primary, #5b5bd6);
    color: #111; border: none; border-radius: 6px; font-size: 12px;
    font-weight: 600; cursor: pointer; font-family: inherit; transition: filter 0.15s;
  }
  .crk-pap-save-btn:hover  { filter: brightness(1.1); }
  .crk-pap-save-btn:active { filter: brightness(0.93); }
  .crk-pap-list { flex: 1; overflow-y: auto; padding: 4px 0; }
  .crk-pap-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 7px 8px 7px 10px; cursor: pointer; gap: 4px; transition: background 0.1s;
  }
  .crk-pap-item:hover { background: rgba(0,0,0,0.05); }
  .crk-pap-item--selected {
    background: color-mix(in srgb, var(--primary, #5b5bd6) 12%, transparent);
  }
  .crk-pap-item--selected:hover {
    background: color-mix(in srgb, var(--primary, #5b5bd6) 18%, transparent);
  }
  .crk-pap-item-name {
    font-size: 12px; color: var(--text_primary, #1a1a1a); flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .crk-pap-del-btn {
    flex-shrink: 0; width: 18px; height: 18px; padding: 0; border: none;
    border-radius: 3px; background: transparent; color: var(--text_tertiary, #999);
    font-size: 14px; line-height: 1; cursor: pointer; display: flex;
    align-items: center; justify-content: center; opacity: 0;
    transition: opacity 0.15s, background 0.15s, color 0.15s;
  }
  .crk-pap-item:hover .crk-pap-del-btn { opacity: 1; }
  .crk-pap-del-btn--warn { opacity: 1 !important; background: #ef4444 !important; color: #fff !important; }
  .crk-pap-empty {
    font-size: 12px; color: var(--text_tertiary, #aaa);
    text-align: center; padding: 20px 10px;
  }
  .crk-pap-toast {
    position: fixed; bottom: 24px; left: 50%;
    transform: translateX(-50%) translateY(8px);
    background: rgba(28,28,28,0.92); color: #fff; padding: 10px 16px;
    border-radius: 8px; font-size: 13px; line-height: 1.5; z-index: 999999;
    opacity: 0; transition: opacity 0.2s ease, transform 0.2s ease;
    white-space: pre-line; pointer-events: none; max-width: 320px;
    text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,0.18);
  }

  /* ════════════════════════════════════════════════
     §2  PersonaManager 스타일
     ════════════════════════════════════════════════ */

  /* 폴더 바 */
  #crk-prof-folder-bar {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 20px; border-bottom: 1px solid var(--outline_secondary, #e5e3dc);
    background: var(--bg-background, #fff); flex-shrink: 0;
  }
  #crk-prof-folder-select {
    flex: 1; padding: 5px 8px;
    border: 1px solid var(--outline_secondary, #d0cdc5); border-radius: 6px;
    background: var(--surface_secondary, #f4f2ec); font-size: 13px;
    color: var(--text_primary, #1a1a1a); outline: none; cursor: pointer;
    font-family: inherit;
  }
  #crk-prof-folder-select:focus { border-color: var(--primary, #5b5bd6); }
  #crk-prof-manage-btn {
    padding: 5px 12px; background: transparent;
    border: 1px solid var(--outline_secondary, #d0cdc5); border-radius: 6px;
    font-size: 12px; color: var(--text_tertiary, #888); cursor: pointer;
    font-family: inherit; white-space: nowrap; transition: background 0.15s;
  }
  #crk-prof-manage-btn:hover { background: var(--accent, rgba(0,0,0,0.05)); }

  /* 카드 접힘/펼침 버튼 */
  .crk-prof-collapse-btn {
    flex-shrink: 0; width: 28px; height: 28px; padding: 0; border: none;
    border-radius: 4px; background: transparent; margin-left: auto;
    color: var(--text_tertiary, #999); font-size: 11px; line-height: 1;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: background 0.1s, color 0.1s; font-family: inherit;
  }
  .crk-prof-collapse-btn:hover {
    background: var(--accent, rgba(0,0,0,0.07));
    color: var(--text_primary, #1a1a1a);
  }

  /* 수동 라벨 배지 (접힌 상태에서만 표시) */
  .crk-prof-labels {
    display: flex; gap: 4px; align-items: center; flex-wrap: wrap;
  }
  [data-crk-collapsed="0"] .crk-prof-labels { display: none; }
  .crk-prof-label {
    display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 4px;
    background: color-mix(in srgb, var(--primary, #5b5bd6) 12%, transparent);
    color: var(--primary, #5b5bd6); font-size: 11px; font-weight: 500; line-height: 1.6;
    white-space: nowrap; max-width: 80px; overflow: hidden; text-overflow: ellipsis;
  }

  /* 관리 모달: 프로필 라벨 편집 행 */
  .crk-mgr-label-row {
    display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
    padding: 2px 0 2px 24px;
  }
  .crk-mgr-label-chip {
    display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--primary, #5b5bd6) 10%, transparent);
    color: var(--primary, #5b5bd6); font-size: 11px; font-weight: 500;
  }
  .crk-mgr-label-chip-del {
    border: none; background: transparent; cursor: pointer; padding: 0;
    color: inherit; font-size: 12px; line-height: 1; opacity: 0.6;
    display: flex; align-items: center;
  }
  .crk-mgr-label-chip-del:hover { opacity: 1; }
  .crk-mgr-label-add-input {
    padding: 2px 6px; border: 1px dashed var(--outline_secondary, #d0cdc5);
    border-radius: 4px; font-size: 11px; font-family: inherit;
    background: transparent; color: var(--text_primary, #1a1a1a);
    outline: none; width: 72px; min-width: 0;
  }
  .crk-mgr-label-add-input:focus { border-color: var(--primary, #5b5bd6); }
  .crk-mgr-label-add-input::placeholder { color: var(--text_disabled, #bbb); }

  /* 접힌 카드: 내용 <p> 숨김 */
  [data-crk-collapsed="1"] > p.typo-text-md_leading-none_medium { display: none !important; }
  /* 접힌 카드: 패딩 축소 */
  [data-crk-collapsed="1"] { padding-top: 10px !important; padding-bottom: 10px !important; }

  /* ──────────────────────────────────────────────
     관리 모달
     ────────────────────────────────────────────── */
  #crk-mgr-overlay {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.4); z-index: 99998;
    display: flex; align-items: center; justify-content: center;
    pointer-events: auto; /* [Fix] Radix DismissableLayer가 body.style.pointerEvents='none'을
                             주입하므로, 커스텀 레이어는 이 선언 필수 */
  }
  #crk-mgr-modal {
    background: var(--bg-background, #fff);
    border-radius: 16px; border: 1px solid var(--outline_secondary, #e5e3dc);
    box-shadow: 0 8px 32px rgba(0,0,0,0.18);
    width: 480px; max-width: calc(100vw - 32px);
    max-height: 80vh; display: flex; flex-direction: column; overflow: hidden;
  }
  .crk-mgr-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid var(--outline_secondary, #e5e3dc);
    flex-shrink: 0;
  }
  .crk-mgr-header h3 {
    margin: 0; font-size: 16px; font-weight: 600;
    color: var(--text_primary, #1a1a1a);
  }
  .crk-mgr-close-btn {
    width: 28px; height: 28px; border: none; border-radius: 50%;
    background: transparent; font-size: 18px; cursor: pointer;
    color: var(--text_tertiary, #888); display: flex;
    align-items: center; justify-content: center; transition: background 0.1s;
  }
  .crk-mgr-close-btn:hover { background: var(--accent, rgba(0,0,0,0.07)); }

  .crk-mgr-tabs {
    display: flex; border-bottom: 1px solid var(--outline_secondary, #e5e3dc);
    flex-shrink: 0;
  }
  .crk-mgr-tab {
    flex: 1; padding: 10px 0; border: none; background: transparent;
    font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit;
    color: var(--text_tertiary, #888); border-bottom: 2px solid transparent;
    margin-bottom: -1px; transition: color 0.15s, border-color 0.15s;
  }
  .crk-mgr-tab:hover { color: var(--text_primary, #1a1a1a); }
  .crk-mgr-tab.active {
    color: var(--primary, #5b5bd6); border-bottom-color: var(--primary, #5b5bd6);
  }

  .crk-mgr-panel {
    flex: 1; overflow-y: auto; padding: 16px 20px;
    display: flex; flex-direction: column; gap: 8px;
  }

  .crk-mgr-section-title {
    font-size: 11px; font-weight: 600; color: var(--text_tertiary, #999);
    text-transform: uppercase; letter-spacing: 0.05em; margin: 4px 0 2px;
  }

  /* 폴더 행 */
  .crk-mgr-folder-row {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-radius: 8px; background: var(--surface_secondary, #f4f2ec);
    cursor: default;
  }
  .crk-mgr-drag-handle {
    cursor: grab; color: var(--text_tertiary, #ccc); font-size: 16px;
    flex-shrink: 0; user-select: none;
  }
  .crk-mgr-drag-handle:active { cursor: grabbing; }
  .crk-mgr-folder-name {
    flex: 1; font-size: 13px; color: var(--text_primary, #1a1a1a);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .crk-mgr-folder-name-input {
    flex: 1; padding: 3px 6px; border: 1px solid var(--primary, #5b5bd6);
    border-radius: 4px; font-size: 13px; font-family: inherit;
    color: var(--text_primary, #1a1a1a); background: #fff; outline: none;
  }
  .crk-mgr-icon-btn {
    width: 24px; height: 24px; border: none; border-radius: 4px;
    background: transparent; cursor: pointer; font-size: 13px;
    display: flex; align-items: center; justify-content: center;
    color: var(--text_tertiary, #999); transition: background 0.1s, color 0.1s;
    flex-shrink: 0;
  }
  .crk-mgr-icon-btn:hover { background: rgba(0,0,0,0.07); color: var(--text_primary, #1a1a1a); }
  .crk-mgr-icon-btn.danger:hover { background: rgba(239,68,68,0.1); color: #ef4444; }

  /* 폴더 추가 행 */
  .crk-mgr-add-folder-row {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 10px; border-radius: 8px;
    border: 1px dashed var(--outline_secondary, #d0cdc5);
  }

  /* 프로필 행 */
  .crk-mgr-profile-row {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px; border-radius: 8px; background: var(--surface_secondary, #f4f2ec);
  }
  .crk-mgr-profile-row[data-dragging="1"] { opacity: 0.4; }
  .crk-mgr-profile-row[data-dragover="1"] {
    outline: 2px solid var(--primary, #5b5bd6);
  }
  .crk-mgr-profile-name {
    flex: 1; font-size: 13px; color: var(--text_primary, #1a1a1a);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .crk-mgr-tag-badge {
    font-size: 11px; color: var(--text_tertiary, #999);
    font-variant-numeric: tabular-nums; flex-shrink: 0;
  }
  .crk-mgr-folder-select-sm {
    padding: 3px 6px; border: 1px solid var(--outline_secondary, #d0cdc5);
    border-radius: 5px; font-size: 12px; font-family: inherit;
    background: #fff; color: var(--text_primary, #1a1a1a);
    outline: none; cursor: pointer; max-width: 120px; flex-shrink: 0;
  }
  .crk-mgr-folder-select-sm:focus { border-color: var(--primary, #5b5bd6); }

  .crk-mgr-filter-row {
    display: flex; align-items: center; gap: 8px; flex-shrink: 0;
  }
  .crk-mgr-filter-label { font-size: 12px; color: var(--text_tertiary, #888); white-space: nowrap; }
  .crk-mgr-filter-select {
    flex: 1; padding: 5px 8px; border: 1px solid var(--outline_secondary, #d0cdc5);
    border-radius: 6px; font-size: 12px; font-family: inherit;
    background: var(--surface_secondary, #f4f2ec); outline: none; cursor: pointer;
  }

  .crk-mgr-empty {
    font-size: 13px; color: var(--text_tertiary, #aaa);
    text-align: center; padding: 24px 0;
  }

  .crk-mgr-add-btn {
    padding: 7px 14px; background: var(--primary, #5b5bd6); color: #111;
    border: none; border-radius: 8px; font-size: 13px; font-weight: 600;
    cursor: pointer; font-family: inherit; transition: filter 0.15s; align-self: flex-start;
  }
  .crk-mgr-add-btn:hover  { filter: brightness(1.1); }
  .crk-mgr-add-btn:active { filter: brightness(0.93); }

  .crk-mgr-warning {
    font-size: 11px; color: var(--text_tertiary, #aaa);
    padding: 6px 10px; border-radius: 6px;
    background: rgba(0,0,0,0.03); line-height: 1.5;
  }
`);

// ════════════════════════════════════════════════════════════════════
//  공통 유틸: throttle
// ════════════════════════════════════════════════════════════════════
function _makeThrottle(fn, wait) {
  let lastTime = 0, rafId = null;
  return function throttled() {
    const now = Date.now(), remaining = wait - (now - lastTime);
    if (remaining <= 0) {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      lastTime = now; fn();
    } else if (rafId === null) {
      rafId = requestAnimationFrame(() => { lastTime = Date.now(); rafId = null; fn(); });
    }
  };
}

// ════════════════════════════════════════════════════════════════════
//  §1.  DreamDiary — 유저노트 프리셋 저장/불러오기
// ════════════════════════════════════════════════════════════════════
!(async function () {
  'use strict';

  // @ts-ignore
  const db = new Dexie('chasm-dream-diary');
  await db.version(1).stores({
    noteStore:    'keyName, noteName, boundCharacter, noteContent, savedAt',
    lastSelected: 'boundCharacter, selected',
  });

  const GLOBAL = '#global';

  async function getAllNotes() {
    const rows = await db.noteStore.where('boundCharacter').equals(GLOBAL).sortBy('savedAt');
    return rows.reverse();
  }
  async function getNote(keyId) {
    const rows = await db.noteStore.where('keyName').anyOf(keyId).toArray();
    return rows[0] ?? null;
  }
  async function saveNote(name, content) {
    await db.noteStore.put({
      keyName: `${GLOBAL}!+${name}`, noteName: name,
      boundCharacter: GLOBAL, noteContent: content, savedAt: Date.now(),
    });
  }
  async function deleteNote(name) { await db.noteStore.delete(`${GLOBAL}!+${name}`); }
  async function getLastSelected() {
    const rows = await db.lastSelected.where('boundCharacter').equals(GLOBAL).toArray();
    return rows[0]?.selected ?? null;
  }
  async function setLastSelected(keyId) {
    if (keyId == null) { await db.lastSelected.delete(GLOBAL); }
    else { await db.lastSelected.put({ boundCharacter: GLOBAL, selected: keyId }); }
  }

  /** @type {string | null} */
  let currentKey = null;

  function toast(msg, duration = 3000) {
    const el = document.createElement('div');
    el.className = 'crk-pap-toast'; el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      el.style.opacity = '1'; el.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transform = 'translateX(-50%) translateY(8px)';
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  function performTextAreaModification(area, text) {
    area.value = text; area.textContent = text;
    for (const key of Object.keys(area)) {
      if (key.startsWith('__reactProps')) { // @ts-ignore
        area[key].onChange({ target: { value: text } }); break;
      }
    }
  }

  function findModal() {
    for (const d of document.querySelectorAll('[role="dialog"]'))
      for (const h of d.querySelectorAll('h2'))
        if (h.textContent?.trim() === '유저노트') return d;
    return null;
  }

  async function handle2000Toggle(modal, textarea, content) {
    const needs = content.length > 500, is2000 = textarea.maxLength > 500;
    if (needs === is2000) return;
    const label = [...Array.from(modal.querySelectorAll('p')), ...Array.from(modal.querySelectorAll('span'))]
      .find(el => el.textContent?.trim() === '유저노트 2000자 확장');
    if (!label) { toast(needs ? '불러올 노트가 500자를 초과해요.\n수동으로 2000자 확장 토글을 켜주세요.' : '불러올 노트가 500자 이하예요.\n수동으로 2000자 확장 토글을 꺼주세요.'); return; }
    label.nextElementSibling?.click(); await autoClickConfirm();
    toast(needs ? '자동으로 2000자 확장을 적용했어요.' : '자동으로 확장을 비활성화했어요.');
  }

  async function autoClickConfirm() {
    for (let i = 0; i < 40; i++) {
      for (const d of document.querySelectorAll('[role="dialog"]'))
        for (const b of d.querySelectorAll('button'))
          if (b.textContent?.trim() === '확인') { b.click(); return true; }
      await new Promise(r => setTimeout(r, 10));
    }
    return false;
  }

  async function renderList(sidebar, modal, textarea) {
    const list = sidebar.querySelector('#crk-pap-list');
    if (!list) return;
    list.innerHTML = '';
    const notes = await getAllNotes();
    if (!notes.length) {
      const empty = document.createElement('p'); empty.className = 'crk-pap-empty';
      empty.textContent = '저장된 노트 없음'; list.appendChild(empty); return;
    }
    for (const note of notes) {
      const item = document.createElement('div');
      item.className = 'crk-pap-item' + (note.keyName === currentKey ? ' crk-pap-item--selected' : '');
      item.title = note.noteName;
      const nameSpan = document.createElement('span'); nameSpan.className = 'crk-pap-item-name'; nameSpan.textContent = note.noteName;
      const delBtn = document.createElement('button'); delBtn.className = 'crk-pap-del-btn'; delBtn.textContent = '×'; delBtn.title = '삭제';
      /** @type {ReturnType<typeof setTimeout>|null} */ let confirmTimer = null;
      delBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (item.dataset.delConfirm === '1') {
          clearTimeout(confirmTimer);
          await deleteNote(note.noteName);
          if (currentKey === note.keyName) { currentKey = null; await setLastSelected(null); }
          await renderList(sidebar, modal, textarea); toast(`"${note.noteName}" 삭제했어요`);
        } else {
          item.dataset.delConfirm = '1'; delBtn.textContent = '!'; delBtn.classList.add('crk-pap-del-btn--warn');
          confirmTimer = setTimeout(() => { delete item.dataset.delConfirm; delBtn.textContent = '×'; delBtn.classList.remove('crk-pap-del-btn--warn'); }, 3000);
        }
      });
      item.addEventListener('click', async () => {
        const loaded = await getNote(note.keyName);
        if (!loaded) { toast('노트를 불러올 수 없어요'); return; }
        currentKey = note.keyName; await setLastSelected(note.keyName);
        await handle2000Toggle(modal, textarea, loaded.noteContent);
        performTextAreaModification(textarea, loaded.noteContent);
        await renderList(sidebar, modal, textarea);
      });
      item.appendChild(nameSpan); item.appendChild(delBtn); list.appendChild(item);
    }
  }

  async function initLoad(sidebar, modal, textarea) {
    if (currentKey) { await renderList(sidebar, modal, textarea); return; }
    const lastKey = await getLastSelected();
    if (lastKey) {
      const note = await getNote(lastKey);
      if (note) {
        // 목록 하이라이트용으로 키만 기억. textarea 자동 로드는 하지 않는다.
        currentKey = lastKey;
      } else {
        await setLastSelected(null);
      }
    }
    await renderList(sidebar, modal, textarea);
  }

  function buildSidebar(modal, textarea) {
    const sidebar = document.createElement('div'); sidebar.id = 'crk-pap-sidebar';
    const inputBlock = document.createElement('div'); inputBlock.className = 'crk-pap-input-block';
    const nameInput = document.createElement('input'); nameInput.type = 'text';
    nameInput.placeholder = '노트 이름'; nameInput.className = 'crk-pap-name-input'; nameInput.maxLength = 50;
    const saveBtn = document.createElement('button'); saveBtn.className = 'crk-pap-save-btn'; saveBtn.textContent = '저장';
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim(); if (!name) { toast('이름을 입력하세요'); return; }
      await saveNote(name, textarea.value);
      currentKey = `${GLOBAL}!+${name}`; await setLastSelected(currentKey);
      await renderList(sidebar, modal, textarea); toast(`"${name}" 저장했어요`); nameInput.value = '';
    });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
    inputBlock.appendChild(nameInput); inputBlock.appendChild(saveBtn); sidebar.appendChild(inputBlock);
    const list = document.createElement('div'); list.id = 'crk-pap-list'; list.className = 'crk-pap-list';
    sidebar.appendChild(list);
    return sidebar;
  }

  function watchForReinjection(modal) {
    const obs = new MutationObserver(() => {
      if (!document.getElementById('crk-pap-sidebar')) { obs.disconnect(); setTimeout(() => injectModal(), 50); }
    });
    obs.observe(modal, { childList: true, subtree: true });
  }

  function injectModal() {
    if (document.getElementById('crk-pap-sidebar')) return;
    const modal = findModal(); if (!modal) return;
    /** @type {HTMLTextAreaElement|null} */ const textarea = modal.querySelector('textarea');
    if (!textarea) return;
    /** @type {HTMLElement|null} */ const contentRoot = /** @type {HTMLElement|null} */ (
      Array.from(modal.children).find(el => el instanceof HTMLDivElement && el.contains(textarea)) ?? null
    );
    if (!contentRoot) return;
    // @ts-ignore
    modal.style.maxWidth = '680px';
    const innerWrap = document.createElement('div'); innerWrap.id = 'crk-pap-inner';
    while (contentRoot.firstChild) innerWrap.appendChild(contentRoot.firstChild);
    const sidebar = buildSidebar(modal, textarea);
    contentRoot.appendChild(sidebar); contentRoot.appendChild(innerWrap);
    contentRoot.setAttribute('data-crk-pap', 'expanded');
    initLoad(sidebar, modal, textarea);
    watchForReinjection(modal);
  }

  const _throttledInject = _makeThrottle(() => injectModal(), 300);
  new MutationObserver(_throttledInject).observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => injectModal());
  else injectModal();
  window.addEventListener('load', () => injectModal());
})();


// ════════════════════════════════════════════════════════════════════
//  §2.  PersonaManager — 대화 프로필 폴더/접힘 관리 + 페르소나 이식
//
//  v3.0.0 변경사항:
//  - 대화 프로필 폴더 분류 + 접힘/펼침 UI 신규 추가
//  - 프로필 고유 태그 자동 부여 (A1~Z10 → AA1~ZZ10)
//  - 관리 모달 신규 추가 (폴더 관리 + 프로필 폴더 소속/순서)
//  - setting 페이지 지원 제거 (findSettingPage, watchRadixPortals 등)
//  - 기존 카드 드래그 핸들 → 관리 모달 내부로 이전
//  - transplantPersonaRow 유지
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── 데이터 레이어 ──────────────────────────────────────────────────
  const META_KEY = 'crack_profile_meta_v1';
  const LETTERS  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /** @param {number} idx */
  function generateTag(idx) {
    const letterIdx = Math.floor(idx / 10);
    const num       = (idx % 10) + 1;
    if (letterIdx < 26) return `${LETTERS[letterIdx]}${num}`;
    const l2 = Math.floor((letterIdx - 26) / 26);
    const l1 = (letterIdx - 26) % 26;
    return `${LETTERS[l2]}${LETTERS[l1]}${num}`;
  }

  function defaultMeta() {
    return {
      profiles:    [],
      usedTags:    [],
      nextTagIdx:  0,
      folders:     [{ id: 'uncategorized', name: '미분류', order: 0 }],
    };
  }

  function loadMeta() {
    try { return Object.assign(defaultMeta(), JSON.parse(localStorage.getItem(META_KEY) || '{}')); }
    catch { return defaultMeta(); }
  }

  /** @param {ReturnType<typeof defaultMeta>} meta */
  function saveMeta(meta) {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  // ── 현재 선택 폴더 (IIFE 스코프) ──────────────────────────────────
  let activeFolderId = 'uncategorized';

  // ── DOM 유틸 ──────────────────────────────────────────────────────

  /** 대화 프로필 모달 탐색 */
  function findChatModal() {
    for (const h of document.querySelectorAll('h2')) {
      if (h.textContent.trim() !== '대화 프로필') continue;
      const modal = h.closest('div[role="dialog"]');
      if (modal && isVisible(modal)) return modal;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    return el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0;
  }

  // [정적 캡처 기반 미검증]
  // 스크롤 컨테이너: overflow-y-scroll 클래스를 포함하는 요소
  function getScrollContainer(modal) {
    return modal.querySelector('[class*="overflow-y-scroll"]') ?? null;
  }

  // [정적 캡처 기반 미검증]
  // 카드 목록 컨테이너: 첫 번째 bg-surface_tertiary cursor-pointer 카드의 부모
  function getCardListContainer(modal) {
    const first = modal.querySelector('div.bg-surface_tertiary.cursor-pointer');
    return first?.parentElement ?? null;
  }

  // [정적 캡처 기반 미검증]
  // 카드: bg-surface_tertiary cursor-pointer + 이름 span 포함
  function getPersonaCards(modal) {
    return Array.from(
      modal.querySelectorAll('div.bg-surface_tertiary.cursor-pointer')
    ).filter(el => el.querySelector('span.typo-text-base_leading-none_semibold'));
  }

  // [정적 캡처 기반 미검증]
  function getCardName(card) {
    return card.querySelector('span.typo-text-base_leading-none_semibold')?.textContent?.trim() ?? '';
  }

  // [정적 캡처 기반 미검증]
  function getCardContentPrefix(card) {
    const p = card.querySelector('p.typo-text-md_leading-none_medium');
    return (p?.textContent ?? '').trim().slice(0, 40);
  }

  // ── 태그 매핑 ─────────────────────────────────────────────────────

  /**
   * DOM 카드를 스캔하여 프로필 태그를 부여/조회한다.
   * 이름 + 내용 앞 40자로 기존 매핑을 탐색하고,
   * 없으면 신규 태그를 발급하여 미분류 폴더에 배정한다.
   * @param {Element} modal
   * @returns {ReturnType<typeof defaultMeta>}
   */
  function ensureProfileTags(modal) {
    const meta    = loadMeta();
    const cards   = getPersonaCards(modal);
    let   changed = false;

    for (const card of cards) {
      const name   = getCardName(card);
      const prefix = getCardContentPrefix(card);

      const existing = meta.profiles.find(p => p.name === name && p.contentPrefix === prefix);
      if (existing) {
        // @ts-ignore
        card.dataset.crkTag = existing.tag;
      } else {
        const tag = generateTag(meta.nextTagIdx);
        meta.usedTags.push(tag);
        meta.nextTagIdx++;
        const folderOrder = meta.profiles.filter(p => p.folderId === 'uncategorized').length;
        meta.profiles.push({ tag, name, contentPrefix: prefix, folderId: 'uncategorized', folderOrder });
        // @ts-ignore
        card.dataset.crkTag = tag;
        changed = true;
      }
    }

    if (changed) saveMeta(meta);
    return meta;
  }

  // ── 카드 변환 (접힘/펼침 버튼 주입) ─────────────────────────────────

  /**
   * 접힘/펼침 버튼을 카드 헤더 행의 메뉴 버튼 앞에 삽입한다.
   * 클릭 이벤트가 카드의 플랫폼 클릭(선택)으로 전파되지 않도록 stopPropagation.
   * [정적 캡처 기반 미검증]
   * @param {Element} card
   */
  function injectCollapseBtn(card) {
    if (card.querySelector('.crk-prof-collapse-btn')) return;

    // 헤더 행: flex flex-row gap-2 justify-between
    const headerRow = card.querySelector('div.flex.flex-row.gap-2.justify-between');
    if (!headerRow) return;

    // 우측 버튼 그룹 (메뉴 버튼 ⋯ 포함)
    // 메뉴 버튼 앞에 접힘 버튼 삽입
    const menuBtn = headerRow.querySelector('button[aria-haspopup="menu"]');
    if (!menuBtn) return;

    const btn = document.createElement('button');
    btn.className = 'crk-prof-collapse-btn';
    btn.textContent = '∧';
    btn.title = '접기/펼치기';
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleCollapse(card);
    });
    headerRow.insertBefore(btn, menuBtn);
  }

  /** @param {Element} card */
  function toggleCollapse(card) {
    const isCollapsed = card.dataset.crkCollapsed === '1';
    const btn = card.querySelector('.crk-prof-collapse-btn');
    if (isCollapsed) {
      card.dataset.crkCollapsed = '0';
      if (btn) btn.textContent = '∧';
    } else {
      card.dataset.crkCollapsed = '1';
      if (btn) btn.textContent = '∨';
    }
  }

  /**
   * 폴더 필터와 order 적용.
   * React DOM 비침습: display:none + CSS order 만 사용.
   * @param {Element} modal
   * @param {ReturnType<typeof defaultMeta>} meta
   */
  function applyFolderView(modal, meta) {
    const cards = getPersonaCards(modal);

    for (const card of cards) {
      // @ts-ignore
      const tag     = card.dataset.crkTag;
      const profile = meta.profiles.find(p => p.tag === tag);
      const fid     = profile?.folderId ?? 'uncategorized';

      // 필터링: display
      if (activeFolderId === '__all__') {
        // @ts-ignore
        card.style.display = '';
      } else {
        // @ts-ignore
        card.style.display = fid === activeFolderId ? '' : 'none';
      }

      // 순서: CSS order
      const folder      = meta.folders.find(f => f.id === fid);
      const folderOrder = folder?.order ?? 999;
      const itemOrder   = profile?.folderOrder ?? 0;
      // @ts-ignore
      card.style.order = String(folderOrder * 1000 + itemOrder);
    }

    // 카드 목록 컨테이너에 flex-col + order 적용
    const container = getCardListContainer(modal);
    if (container) {
      // @ts-ignore
      container.style.display = 'flex';
      // @ts-ignore
      container.style.flexDirection = 'column';
    }
  }

  /**
   * 카드 목록의 신규/미변환 카드에 접힘 버튼을 주입하고
   * 기본값으로 접힌 상태로 설정한다.
   * @param {Element} modal
   */
  function transformCards(modal) {
    const meta = loadMeta();
    for (const card of getPersonaCards(modal)) {
      if (card.dataset.crkTransformed === '1') {
        // 이미 변환된 카드도 라벨 배지는 갱신 (관리 모달에서 라벨 변경 후 재호출 시)
        updateLabelBadges(card, meta);
        continue;
      }
      injectCollapseBtn(card);
      card.dataset.crkCollapsed  = '1';
      card.dataset.crkTransformed = '1';
      updateLabelBadges(card, meta);
    }
  }

  /**
   * 카드에 수동 라벨 배지를 주입/갱신한다.
   * 이름 span의 부모 행 끝에 삽입. 접힌 상태에서만 CSS로 표시.
   * [정적 캡처 기반 미검증]
   * @param {Element} card
   * @param {ReturnType<typeof defaultMeta>} meta
   */
  function updateLabelBadges(card, meta) {
    const tag     = card.dataset.crkTag;
    const profile = meta.profiles.find(p => p.tag === tag);
    const labels  = profile?.labels ?? [];

    card.querySelector('.crk-prof-labels')?.remove();
    if (!labels.length) return;

    // 이름 span의 부모(flex row) 끝에 배지 컨테이너 삽입
    const nameSpan = card.querySelector('span.typo-text-base_leading-none_semibold');
    const nameRow  = nameSpan?.parentElement;
    if (!nameRow) return;

    const wrap = document.createElement('div');
    wrap.className = 'crk-prof-labels';
    for (const label of labels) {
      const badge = document.createElement('span');
      badge.className   = 'crk-prof-label';
      badge.textContent = label;
      badge.title       = label;
      wrap.appendChild(badge);
    }
    nameRow.appendChild(wrap);
  }

  // ── 폴더 드롭다운 바 ──────────────────────────────────────────────

  /**
   * @param {Element} modal
   * @param {ReturnType<typeof defaultMeta>} meta
   */
  function buildFolderBar(modal, meta) {
    const bar = document.createElement('div');
    bar.id = 'crk-prof-folder-bar';

    const select = document.createElement('select');
    select.id = 'crk-prof-folder-select';

    // 전체 보기 옵션
    const allOpt = document.createElement('option');
    allOpt.value = '__all__'; allOpt.textContent = '전체 보기';
    select.appendChild(allOpt);

    // 폴더 목록 (order 순)
    for (const folder of [...meta.folders].sort((a, b) => a.order - b.order)) {
      const opt = document.createElement('option');
      opt.value = folder.id; opt.textContent = folder.name;
      if (folder.id === activeFolderId) opt.selected = true;
      select.appendChild(opt);
    }

    select.addEventListener('change', () => {
      activeFolderId = select.value;
      applyFolderView(modal, loadMeta());
    });

    const manageBtn = document.createElement('button');
    manageBtn.id = 'crk-prof-manage-btn';
    manageBtn.textContent = '관리';
    manageBtn.addEventListener('pointerdown', e => { e.stopPropagation(); });
    manageBtn.addEventListener('click', e => {
      e.stopPropagation();
      openManagerModal(loadMeta(), modal);
    });

    bar.appendChild(select);
    bar.appendChild(manageBtn);
    return bar;
  }

  /**
   * 폴더 바를 헤더와 스크롤 컨테이너 사이에 삽입하고,
   * 스크롤 컨테이너 높이를 폴더 바 높이만큼 줄인다.
   * @param {Element} modal
   * @param {ReturnType<typeof defaultMeta>} meta
   */
  function injectFolderBar(modal, meta) {
    if (document.getElementById('crk-prof-folder-bar')) return;

    const scrollContainer = getScrollContainer(modal);
    if (!scrollContainer) return;

    const bar = buildFolderBar(modal, meta);
    modal.insertBefore(bar, scrollContainer);

    // 스크롤 컨테이너 높이 조정 (폴더 바 높이 44px 예약)
    const barH = bar.offsetHeight || 44;
    // @ts-ignore
    scrollContainer.style.height    = `calc(454px - ${barH}px)`;
    // @ts-ignore
    scrollContainer.style.maxHeight = `calc(454px - ${barH}px)`;
  }

  /**
   * 폴더 드롭다운 select 옵션을 meta 기준으로 재구성한다.
   * (관리 모달에서 폴더를 추가/삭제/수정했을 때 호출)
   * @param {Element} modal
   * @param {ReturnType<typeof defaultMeta>} meta
   */
  function refreshFolderDropdown(modal, meta) {
    const select = document.getElementById('crk-prof-folder-select');
    if (!select) return;
    // @ts-ignore
    select.innerHTML = '';

    const allOpt = document.createElement('option');
    allOpt.value = '__all__'; allOpt.textContent = '전체 보기';
    select.appendChild(allOpt);

    for (const folder of [...meta.folders].sort((a, b) => a.order - b.order)) {
      const opt = document.createElement('option');
      opt.value = folder.id; opt.textContent = folder.name;
      if (folder.id === activeFolderId) opt.selected = true;
      select.appendChild(opt);
    }

    // activeFolderId가 삭제된 폴더일 경우 미분류로 복귀
    if (!meta.folders.find(f => f.id === activeFolderId)) {
      activeFolderId = 'uncategorized';
      // @ts-ignore
      select.value = 'uncategorized';
    }
  }

  // ── 관리 모달 ─────────────────────────────────────────────────────

  /**
   * 관리 모달은 Radix Dialog와 완전히 독립된 DOM.
   * DismissableLayer 간섭을 막기 위해 pointerdown/mousedown/focusin을
   * stopPropagation으로 처리한다.
   * @param {ReturnType<typeof defaultMeta>} meta
   * @param {Element} chatModal
   */
  function openManagerModal(meta, chatModal) {
    if (document.getElementById('crk-mgr-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'crk-mgr-overlay';

    const modal = document.createElement('div');
    modal.id = 'crk-mgr-modal';

    // 헤더
    const header = document.createElement('div');
    header.className = 'crk-mgr-header';
    const title = document.createElement('h3'); title.textContent = '대화 프로필 관리';
    const closeBtn = document.createElement('button'); closeBtn.className = 'crk-mgr-close-btn'; closeBtn.textContent = '×';

    // [Fix] Radix DismissableLayer는 document 레벨 capture로 pointerdown/focusin을 감지해
    // 다이얼로그 바깥 클릭을 판별한다. window capture는 document capture보다 먼저 실행되므로
    // 오버레이 내부 이벤트에 한해 stopImmediatePropagation → 대화 프로필 모달이 닫히지 않는다.
    // (관리 버튼 클릭 시 focusin이 발생하는 경우도 함께 차단)
    // mousedown: Radix FocusTrap이 mousedown을 document capture에서 처리해
    //   포커스를 Dialog 안으로 돌려보내는 것을 막음 (라벨 input 3단계 클릭 문제 해결)
    // wheel: react-remove-scroll이 wheel을 document capture에서 잠금
    //   (관리 모달 스크롤 불가 문제 해결)
    const _stopOutside = e => { if (overlay.contains(e.target)) e.stopImmediatePropagation(); };
    window.addEventListener('pointerdown', _stopOutside, true);
    window.addEventListener('mousedown',   _stopOutside, true);
    window.addEventListener('focusin',     _stopOutside, true);
    window.addEventListener('wheel',       _stopOutside, { capture: true, passive: true });

    const _closeOverlay = () => {
      window.removeEventListener('pointerdown', _stopOutside, true);
      window.removeEventListener('mousedown',   _stopOutside, true);
      window.removeEventListener('focusin',     _stopOutside, true);
      window.removeEventListener('wheel',       _stopOutside, { capture: true });
      overlay.remove();
    };

    closeBtn.addEventListener('click', () => _closeOverlay());
    header.appendChild(title); header.appendChild(closeBtn);

    // 탭
    const tabs = document.createElement('div'); tabs.className = 'crk-mgr-tabs';
    const folderTab  = document.createElement('button'); folderTab.className  = 'crk-mgr-tab active'; folderTab.textContent = '폴더 관리';
    const profileTab = document.createElement('button'); profileTab.className = 'crk-mgr-tab';        profileTab.textContent = '프로필 관리';
    tabs.appendChild(folderTab); tabs.appendChild(profileTab);

    // 패널
    const folderPanel  = buildFolderPanel(meta, chatModal, overlay);
    const profilePanel = buildProfilePanel(meta, chatModal);
    profilePanel.style.display = 'none';

    folderTab.addEventListener('click', () => {
      folderTab.classList.add('active'); profileTab.classList.remove('active');
      folderPanel.style.display = ''; profilePanel.style.display = 'none';
      rebuildFolderPanel(folderPanel, loadMeta(), chatModal, overlay);
    });
    profileTab.addEventListener('click', () => {
      profileTab.classList.add('active'); folderTab.classList.remove('active');
      folderPanel.style.display = 'none'; profilePanel.style.display = '';
      rebuildProfilePanel(profilePanel, loadMeta(), chatModal);
    });

    modal.appendChild(header); modal.appendChild(tabs);
    modal.appendChild(folderPanel); modal.appendChild(profilePanel);
    overlay.appendChild(modal);

    overlay.addEventListener('click', e => { if (e.target === overlay) _closeOverlay(); });

    document.body.appendChild(overlay);
  }

  // ── 관리 모달: 폴더 관리 패널 ────────────────────────────────────

  /**
   * @param {ReturnType<typeof defaultMeta>} meta
   * @param {Element} chatModal
   * @param {Element} overlay
   */
  function buildFolderPanel(meta, chatModal, overlay) {
    const panel = document.createElement('div'); panel.className = 'crk-mgr-panel';
    panel.id = 'crk-mgr-folder-panel';
    fillFolderPanel(panel, meta, chatModal, overlay);
    return panel;
  }

  function rebuildFolderPanel(panel, meta, chatModal, overlay) {
    panel.innerHTML = '';
    fillFolderPanel(panel, meta, chatModal, overlay);
  }

  function fillFolderPanel(panel, meta, chatModal, overlay) {
    // 새 폴더 추가 버튼
    const addBtn = document.createElement('button'); addBtn.className = 'crk-mgr-add-btn'; addBtn.textContent = '+ 새 폴더';
    addBtn.addEventListener('click', () => {
      const existing = panel.querySelector('.crk-mgr-add-folder-row');
      if (existing) { existing.querySelector('input')?.focus(); return; }
      const row = document.createElement('div'); row.className = 'crk-mgr-add-folder-row';
      const input = document.createElement('input'); input.type = 'text'; input.placeholder = '폴더 이름';
      input.className = 'crk-mgr-folder-name-input'; input.style.flex = '1';
      const ok  = document.createElement('button'); ok.className  = 'crk-mgr-icon-btn'; ok.textContent = '✓'; ok.title = '추가';
      const cxl = document.createElement('button'); cxl.className = 'crk-mgr-icon-btn'; cxl.textContent = '×'; cxl.title = '취소';
      ok.addEventListener('click', () => {
        const name = input.value.trim(); if (!name) return;
        const newMeta = loadMeta();
        const id = 'f-' + Date.now().toString(36);
        newMeta.folders.push({ id, name, order: newMeta.folders.length });
        saveMeta(newMeta);
        row.remove();
        fillFolderList(panel.querySelector('.crk-mgr-folder-list'), newMeta, chatModal, overlay);
        refreshFolderDropdown(chatModal, newMeta);
      });
      cxl.addEventListener('click', () => row.remove());
      input.addEventListener('keydown', e => { if (e.key === 'Enter') ok.click(); if (e.key === 'Escape') cxl.click(); });
      row.appendChild(input); row.appendChild(ok); row.appendChild(cxl);
      panel.insertBefore(row, panel.querySelector('.crk-mgr-folder-list'));
      input.focus();
    });
    panel.appendChild(addBtn);

    const folderList = document.createElement('div'); folderList.className = 'crk-mgr-folder-list';
    fillFolderList(folderList, meta, chatModal, overlay);
    panel.appendChild(folderList);

    panel.appendChild(Object.assign(document.createElement('p'), {
      className: 'crk-mgr-warning',
      textContent: '⚠ 프로필 이름이나 내용 앞부분을 플랫폼에서 수정하면 태그 매핑이 끊깁니다. 이 경우 프로필 관리 탭에서 폴더를 재지정해 주세요.',
    }));
  }

  function fillFolderList(container, meta, chatModal, overlay) {
    container.innerHTML = '';
    const sorted = [...meta.folders].sort((a, b) => a.order - b.order);

    // 드래그 상태
    let dragSrcId = null;

    for (const folder of sorted) {
      const row = document.createElement('div'); row.className = 'crk-mgr-folder-row'; row.dataset.folderId = folder.id;

      const isDeletable = folder.id !== 'uncategorized';

      // 드래그 핸들 (미분류 폴더는 순서 변경 불가)
      const handle = document.createElement('span'); handle.className = 'crk-mgr-drag-handle'; handle.textContent = '⠿';
      if (!isDeletable) handle.style.opacity = '0.2';

      if (isDeletable) {
        row.draggable = true;
        row.addEventListener('dragstart', e => { dragSrcId = folder.id; e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => { row.style.opacity = '0.4'; }); });
        row.addEventListener('dragend',   () => { row.style.opacity = ''; dragSrcId = null; });
        row.addEventListener('dragover',  e => { e.preventDefault(); });
        row.addEventListener('dragenter', e => { e.preventDefault(); if (dragSrcId && dragSrcId !== folder.id) row.dataset.dragover = '1'; });
        row.addEventListener('dragleave', e => { if (!row.contains(e.relatedTarget)) delete row.dataset.dragover; });
        row.addEventListener('drop', e => {
          e.preventDefault(); delete row.dataset.dragover;
          if (!dragSrcId || dragSrcId === folder.id) return;
          const newMeta = loadMeta();
          const all  = newMeta.folders.filter(f => f.id !== 'uncategorized');
          const pinned = newMeta.folders.find(f => f.id === 'uncategorized');
          const from = all.findIndex(f => f.id === dragSrcId);
          const to   = all.findIndex(f => f.id === folder.id);
          if (from === -1 || to === -1) return;
          const [moved] = all.splice(from, 1);
          all.splice(to, 0, moved);
          newMeta.folders = [pinned, ...all];
          newMeta.folders.forEach((f, i) => { f.order = i; });
          saveMeta(newMeta);
          fillFolderList(container, newMeta, chatModal, overlay);
          refreshFolderDropdown(chatModal, newMeta);
          applyFolderView(chatModal, newMeta);
        });
      }

      const nameEl = document.createElement('span'); nameEl.className = 'crk-mgr-folder-name'; nameEl.textContent = folder.name;

      row.appendChild(handle); row.appendChild(nameEl);

      // 이름 수정 버튼 (미분류 폴더는 수정 불가)
      if (isDeletable) {
        const editBtn = document.createElement('button'); editBtn.className = 'crk-mgr-icon-btn'; editBtn.textContent = '✎'; editBtn.title = '이름 수정';
        editBtn.addEventListener('click', () => {
          nameEl.style.display = 'none';
          const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'crk-mgr-folder-name-input';
          inp.value = folder.name;
          const save = document.createElement('button'); save.className = 'crk-mgr-icon-btn'; save.textContent = '✓';
          const cxl  = document.createElement('button'); cxl.className  = 'crk-mgr-icon-btn'; cxl.textContent = '×';
          save.addEventListener('click', () => {
            const name = inp.value.trim(); if (!name) return;
            const newMeta = loadMeta();
            const f = newMeta.folders.find(f => f.id === folder.id); if (f) f.name = name;
            saveMeta(newMeta);
            nameEl.textContent = name; nameEl.style.display = '';
            inp.remove(); save.remove(); cxl.remove();
            refreshFolderDropdown(chatModal, newMeta);
          });
          cxl.addEventListener('click', () => { nameEl.style.display = ''; inp.remove(); save.remove(); cxl.remove(); });
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') save.click(); if (e.key === 'Escape') cxl.click(); });
          row.appendChild(inp); row.appendChild(save); row.appendChild(cxl); inp.focus();
        });

        const delBtn = document.createElement('button'); delBtn.className = 'crk-mgr-icon-btn danger'; delBtn.textContent = '🗑'; delBtn.title = '폴더 삭제 (프로필은 미분류로 이동)';
        delBtn.addEventListener('click', () => {
          if (delBtn.dataset.confirm === '1') {
            const newMeta = loadMeta();
            newMeta.profiles.forEach(p => { if (p.folderId === folder.id) { p.folderId = 'uncategorized'; p.folderOrder = 999; } });
            newMeta.folders = newMeta.folders.filter(f => f.id !== folder.id);
            newMeta.folders.forEach((f, i) => { f.order = i; });
            saveMeta(newMeta);
            if (activeFolderId === folder.id) activeFolderId = 'uncategorized';
            fillFolderList(container, newMeta, chatModal, overlay);
            refreshFolderDropdown(chatModal, newMeta);
            applyFolderView(chatModal, newMeta);
          } else {
            delBtn.dataset.confirm = '1'; delBtn.textContent = '!'; delBtn.style.color = '#ef4444';
            setTimeout(() => { delete delBtn.dataset.confirm; delBtn.textContent = '🗑'; delBtn.style.color = ''; }, 3000);
          }
        });
        row.appendChild(editBtn); row.appendChild(delBtn);
      } else {
        // 미분류: 삭제/수정 불가 레이블
        const badge = document.createElement('span');
        badge.style.cssText = 'font-size:11px;color:var(--text_tertiary,#aaa);';
        badge.textContent = '기본';
        row.appendChild(badge);
      }
      container.appendChild(row);
    }
  }

  // ── 관리 모달: 프로필 관리 패널 ──────────────────────────────────

  function buildProfilePanel(meta, chatModal) {
    const panel = document.createElement('div'); panel.className = 'crk-mgr-panel';
    panel.id = 'crk-mgr-profile-panel';
    fillProfilePanel(panel, meta, chatModal);
    return panel;
  }

  function rebuildProfilePanel(panel, meta, chatModal) {
    panel.innerHTML = '';
    fillProfilePanel(panel, meta, chatModal);
  }

  function fillProfilePanel(panel, meta, chatModal) {
    // 폴더 필터
    const filterRow = document.createElement('div'); filterRow.className = 'crk-mgr-filter-row';
    const label = document.createElement('span'); label.className = 'crk-mgr-filter-label'; label.textContent = '폴더:';
    const filterSelect = document.createElement('select'); filterSelect.className = 'crk-mgr-filter-select';
    const allOpt = document.createElement('option'); allOpt.value = '__all__'; allOpt.textContent = '전체';
    filterSelect.appendChild(allOpt);
    for (const folder of [...meta.folders].sort((a, b) => a.order - b.order)) {
      const opt = document.createElement('option'); opt.value = folder.id; opt.textContent = folder.name;
      filterSelect.appendChild(opt);
    }
    filterRow.appendChild(label); filterRow.appendChild(filterSelect);
    panel.appendChild(filterRow);

    const profileList = document.createElement('div'); profileList.className = 'crk-mgr-folder-list'; profileList.style.display = 'flex'; profileList.style.flexDirection = 'column'; profileList.style.gap = '6px';
    fillProfileList(profileList, meta, '__all__', chatModal);
    panel.appendChild(profileList);

    filterSelect.addEventListener('change', () => {
      fillProfileList(profileList, loadMeta(), filterSelect.value, chatModal);
    });
  }

  function fillProfileList(container, meta, filterFolderId, chatModal) {
    container.innerHTML = '';
    let profiles = filterFolderId === '__all__'
      ? [...meta.profiles]
      : meta.profiles.filter(p => p.folderId === filterFolderId);

    profiles.sort((a, b) => {
      const fa = meta.folders.find(f => f.id === a.folderId);
      const fb = meta.folders.find(f => f.id === b.folderId);
      const oa = (fa?.order ?? 999) * 1000 + (a.folderOrder ?? 0);
      const ob = (fb?.order ?? 999) * 1000 + (b.folderOrder ?? 0);
      return oa - ob;
    });

    if (!profiles.length) {
      const empty = document.createElement('p'); empty.className = 'crk-mgr-empty';
      empty.textContent = '프로필 없음'; container.appendChild(empty); return;
    }

    let dragSrcTag = null;

    for (const profile of profiles) {
      // ── 외부 래퍼 (2행 구조) ──
      const wrapper = document.createElement('div');
      wrapper.className = 'crk-mgr-profile-row';
      wrapper.style.cssText = 'flex-direction:column;align-items:stretch;gap:4px;';
      wrapper.dataset.tag = profile.tag;

      // ── 상단 행: 핸들 / 이름 / 고유태그 / 폴더선택 ──
      const mainRow = document.createElement('div');
      mainRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
      mainRow.draggable = true;

      const handle  = document.createElement('span');
      handle.className = 'crk-mgr-drag-handle'; handle.textContent = '⠿';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'crk-mgr-profile-name'; nameSpan.textContent = profile.name;

      const tagBadge = document.createElement('span');
      tagBadge.className = 'crk-mgr-tag-badge'; tagBadge.textContent = `[${profile.tag}]`;

      const folderSel = document.createElement('select');
      folderSel.className = 'crk-mgr-folder-select-sm';
      for (const folder of [...meta.folders].sort((a, b) => a.order - b.order)) {
        const opt = document.createElement('option'); opt.value = folder.id; opt.textContent = folder.name;
        opt.selected = profile.folderId === folder.id; folderSel.appendChild(opt);
      }
      folderSel.addEventListener('change', () => {
        const newMeta = loadMeta();
        const p = newMeta.profiles.find(p => p.tag === profile.tag); if (!p) return;
        p.folderId    = folderSel.value;
        p.folderOrder = newMeta.profiles.filter(pp => pp.folderId === folderSel.value).length;
        saveMeta(newMeta);
        applyFolderView(chatModal, newMeta);
        fillProfileList(container, newMeta, filterFolderId, chatModal);
      });
      folderSel.addEventListener('pointerdown', e => { e.stopPropagation(); });

      // 드래그: mainRow 기준
      mainRow.addEventListener('dragstart', e => {
        dragSrcTag = profile.tag; e.dataTransfer.effectAllowed = 'move';
        requestAnimationFrame(() => { wrapper.dataset.dragging = '1'; });
      });
      mainRow.addEventListener('dragend', () => { delete wrapper.dataset.dragging; dragSrcTag = null; });
      wrapper.addEventListener('dragover',  e => { e.preventDefault(); });
      wrapper.addEventListener('dragenter', e => {
        e.preventDefault();
        if (dragSrcTag && dragSrcTag !== profile.tag) wrapper.dataset.dragover = '1';
      });
      wrapper.addEventListener('dragleave', e => {
        if (!wrapper.contains(e.relatedTarget)) delete wrapper.dataset.dragover;
      });
      wrapper.addEventListener('drop', e => {
        e.preventDefault(); delete wrapper.dataset.dragover;
        if (!dragSrcTag || dragSrcTag === profile.tag) return;
        const newMeta = loadMeta();
        const srcP = newMeta.profiles.find(p => p.tag === dragSrcTag);
        const tgtP = newMeta.profiles.find(p => p.tag === profile.tag);
        if (!srcP || !tgtP || srcP.folderId !== tgtP.folderId) return;
        const folderProfiles = newMeta.profiles
          .filter(p => p.folderId === tgtP.folderId)
          .sort((a, b) => (a.folderOrder ?? 0) - (b.folderOrder ?? 0));
        const srcIdx = folderProfiles.findIndex(p => p.tag === dragSrcTag);
        const tgtIdx = folderProfiles.findIndex(p => p.tag === profile.tag);
        const [moved] = folderProfiles.splice(srcIdx, 1);
        folderProfiles.splice(tgtIdx, 0, moved);
        folderProfiles.forEach((p, i) => { p.folderOrder = i; });
        saveMeta(newMeta);
        applyFolderView(chatModal, newMeta);
        fillProfileList(container, newMeta, filterFolderId, chatModal);
      });

      mainRow.appendChild(handle);
      mainRow.appendChild(nameSpan);
      mainRow.appendChild(tagBadge);
      mainRow.appendChild(folderSel);
      wrapper.appendChild(mainRow);

      // ── 하단 행: 수동 라벨 편집 ──
      const labelRow = document.createElement('div');
      labelRow.className = 'crk-mgr-label-row';

      const renderLabelRow = () => {
        labelRow.innerHTML = '';
        const cur = (loadMeta().profiles.find(p => p.tag === profile.tag)?.labels ?? []);

        // 기존 라벨 칩
        for (const lbl of cur) {
          const chip = document.createElement('span'); chip.className = 'crk-mgr-label-chip';
          const txt  = document.createElement('span'); txt.textContent = lbl; txt.title = lbl;
          const del  = document.createElement('button'); del.className = 'crk-mgr-label-chip-del'; del.textContent = '×'; del.title = '라벨 삭제';
          del.addEventListener('click', () => {
            const nm = loadMeta();
            const pp = nm.profiles.find(p => p.tag === profile.tag); if (!pp) return;
            pp.labels = (pp.labels ?? []).filter(l => l !== lbl);
            saveMeta(nm);
            // 카드 배지 갱신
            const card = chatModal.querySelector(`[data-crk-tag="${profile.tag}"]`);
            if (card) updateLabelBadges(card, nm);
            renderLabelRow();
          });
          chip.appendChild(txt); chip.appendChild(del);
          labelRow.appendChild(chip);
        }

        // 라벨 추가 입력 필드
        const addInput = document.createElement('input');
        addInput.type = 'text'; addInput.className = 'crk-mgr-label-add-input';
        addInput.placeholder = '+ 라벨'; addInput.maxLength = 20;
        addInput.addEventListener('keydown', e => {
          if (e.key !== 'Enter') return;
          const val = addInput.value.trim(); if (!val) return;
          const nm = loadMeta();
          const pp = nm.profiles.find(p => p.tag === profile.tag); if (!pp) return;
          if (!(pp.labels ?? []).includes(val)) {
            pp.labels = [...(pp.labels ?? []), val];
            saveMeta(nm);
            // 카드 배지 갱신
            const card = chatModal.querySelector(`[data-crk-tag="${profile.tag}"]`);
            if (card) updateLabelBadges(card, nm);
          }
          renderLabelRow();
        });
        // 포커스 아웃 시에도 확정
        addInput.addEventListener('blur', () => {
          const val = addInput.value.trim(); if (!val) return;
          const nm = loadMeta();
          const pp = nm.profiles.find(p => p.tag === profile.tag); if (!pp) return;
          if (!(pp.labels ?? []).includes(val)) {
            pp.labels = [...(pp.labels ?? []), val];
            saveMeta(nm);
            const card = chatModal.querySelector(`[data-crk-tag="${profile.tag}"]`);
            if (card) updateLabelBadges(card, nm);
            renderLabelRow();
          }
        });
        labelRow.appendChild(addInput);
      };

      renderLabelRow();
      wrapper.appendChild(labelRow);
      container.appendChild(wrapper);
    }
  }

  // ── 프로필 UI 주입 메인 ───────────────────────────────────────────

  /**
   * 대화 프로필 모달이 열려있을 때:
   * 1. 태그 매핑 확인/부여
   * 2. 카드 접힘 버튼 주입
   * 3. 폴더 바 삽입
   * 4. 폴더/순서 뷰 적용
   * 5. 카드 목록 변화 감시
   */
  function injectProfileUI() {
    const modal = findChatModal(); if (!modal) return;
    if (modal.dataset.crkProfInjected === '1') return;
    modal.dataset.crkProfInjected = '1';

    const meta = ensureProfileTags(modal);
    transformCards(modal);
    injectFolderBar(modal, meta);
    applyFolderView(modal, meta);
    watchCardList(modal);
  }

  /**
   * 카드 목록 컨테이너를 MutationObserver로 감시.
   * 새 카드 추가(프로필 추가) 또는 카드 변환 속성 소실 시 재처리.
   * @param {Element} modal
   */
  function watchCardList(modal) {
    const container = getCardListContainer(modal); if (!container) return;
    const obs = new MutationObserver(() => {
      const cards = getPersonaCards(modal);
      const needsTag       = cards.some(c => !c.dataset.crkTag);
      const needsTransform = cards.some(c => c.dataset.crkTransformed !== '1');
      if (needsTag || needsTransform) {
        const newMeta = ensureProfileTags(modal);
        transformCards(modal);
        applyFolderView(modal, newMeta);
      }
    });
    obs.observe(container, { childList: true, subtree: false, attributes: true, attributeFilter: ['class', 'data-crk-transformed'] });
  }

  // ── transplant 관련 (기존 유지) ───────────────────────────────────
  const MOVED_ATTR     = 'data-crk-persona-moved';
  const ACTION_KEYWORDS = ['이어하기', '새로하기', '플레이'];

  function findPersonaRow(root) {
    for (const el of root.querySelectorAll(':is(p, span)')) {
      if (el.textContent.trim() !== '대화 프로필') continue;
      const row = el.parentElement; if (!row) continue;
      if (row.getAttribute(MOVED_ATTR) === '1') continue;
      if (row.querySelector('button[role="combobox"]')) return row;
    }
    return null;
  }

  function findActionButtonRow(root) {
    for (const btn of root.querySelectorAll('button')) {
      if (!isVisible(btn)) continue;
      if (!ACTION_KEYWORDS.includes(btn.textContent.trim())) continue;
      let el = btn.parentElement;
      while (el && el !== document.body) {
        if (el.classList.contains('flex-row')) return el;
        el = el.parentElement;
      }
    }
    return null;
  }

  const rewireObservers = new WeakMap();
  const watchedRoots    = new WeakSet();

  function transplantPersonaRow(root) {
    const buttonRow = findActionButtonRow(root); if (!buttonRow) return;
    const prev = buttonRow.previousElementSibling;
    if (prev && prev.getAttribute(MOVED_ATTR) === '1') {
      if (prev.querySelector('button[role="combobox"]')) return;
      prev.remove();
    }
    const personaRow = findPersonaRow(root); if (!personaRow) return;
    const entry = rewireObservers.get(root); entry?.obs?.disconnect();
    personaRow.style.setProperty('padding', '10px 20px 8px', 'important');
    personaRow.style.setProperty('border-top', '1px solid var(--border-divider_primary, var(--outline_secondary, #2a2a2a))', 'important');
    personaRow.setAttribute(MOVED_ATTR, '1');
    buttonRow.parentElement?.insertBefore(personaRow, buttonRow);
    Promise.resolve().then(() => { if (entry) entry.obs.observe(entry.scrollBody, { childList: true, subtree: true }); });
  }

  function watchForRewire(root) {
    if (watchedRoots.has(root)) return;
    watchedRoots.add(root);
    const scrollBody = root.querySelector('[overflow="auto"]')
      ?? root.querySelector('.character-info-modal-content-body') ?? root;
    const obs = new MutationObserver(() => { if (findPersonaRow(scrollBody)) transplantPersonaRow(root); });
    obs.observe(scrollBody, { childList: true, subtree: true });
    rewireObservers.set(root, { obs, scrollBody });
  }

  function transplantInContext(root) { transplantPersonaRow(root); watchForRewire(root); }

  // ── inject + Observer ──────────────────────────────────────────────
  let _injectRunning = false;

  function inject() {
    if (_injectRunning) return; _injectRunning = true;
    try {
      // 대화 프로필 모달 UI 주입
      injectProfileUI();

      // 프로필 모달이 닫히면 재주입 플래그 초기화
      const chatModal = findChatModal();
      if (!chatModal && document.querySelector('[data-crk-prof-injected="1"]')) {
        const old = document.querySelector('[data-crk-prof-injected="1"]');
        if (old && !isVisible(old)) delete /** @type {HTMLElement} */ (old).dataset.crkProfInjected;
      }

      // transplant (채팅 방 내 Combobox 이식)
      const webModal = document.getElementById('web-modal');
      if (webModal && isVisible(webModal)) transplantInContext(webModal);
      else transplantInContext(document.body);
    } finally { _injectRunning = false; }
  }

  // body 직접 자식 감시 (모달 열림 감지)
  const webModal = document.getElementById('web-modal');
  if (webModal) new MutationObserver(() => inject()).observe(webModal, { childList: true, subtree: true, attributes: true });
  new MutationObserver(() => inject()).observe(document.body, { childList: true, subtree: false });

  // rAF 루프 (§1과 오프셋: 1500ms 지연)
  let _lastInjectTime = 0;
  function rafLoop(ts) {
    if (ts - _lastInjectTime >= 600) { _lastInjectTime = ts; inject(); }
    requestAnimationFrame(rafLoop);
  }
  setTimeout(() => requestAnimationFrame(rafLoop), 1500);

})();
