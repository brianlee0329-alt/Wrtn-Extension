// ==UserScript==
// @name         좋아요 목록 관리
// @namespace    https://github.com/workforomg/Util
// @version      2.0.6
// @description  좋아요 목록 검색/폴더 기능 지원
// @match        https://crack.wrtn.ai/liked*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ─────────────────────────────────────────────
    // 0. 상수 및 설정
    // ─────────────────────────────────────────────
    const STORAGE_KEY = 'liked_folders_v1';

    // v1.1.0: Emotion 해시 클래스 → Tailwind 클래스 기반 전환
    // v1.2.0: #liked-scroll 사라짐 → class 기반 매칭
    // v1.3.0: #liked-scroll 재출현. 단 'div.grid[class*="grid-cols-3"]'가
    //   모바일 네비게이션 헤더 격자(top-[64px], gap-5, items-center)를 DOM 순서상
    //   먼저 매칭하는 문제 발생 -> gap-y-10 구별자 + #liked-scroll 스코프로 작품 격자만 매칭.
    //   PAGE_TITLE_SEL 신설: .css-342uqh를 공유하는 배너('앱에서 더 편하게')가 DOM 순서상
    //   앞이라 querySelector('.css-342uqh')가 배너를 반환 -> typo-text-2xl로 제목만 매칭.
    const PAGE_TITLE_SEL = '#liked-scroll p[class*="typo-text-2xl"]'; // 페이지 제목
    const GRID_SEL   = '#liked-scroll div.grid[class*="gap-y-10"]'; // 작품 그리드
    const CARD_SEL   = ':scope > div[role="button"]';                // 개별 카드 (직접 자식만)
    const TITLE_SEL  = 'p.line-clamp-2';                             // 작품 제목 텍스트

    const PATH_UNSAFE = "m20.7 4.47-8.3-2.68c-.26-.08-.54-.08-.8 0L3.3 4.47c-.54.18-.9.68-.9 1.24v4.12c0 5.74 3.69 10.81 9.18 12.61.13.05.28.07.42.07s.28-.02.42-.07c5.49-1.8 9.18-6.87 9.18-12.61V5.71c0-.56-.36-1.06-.9-1.24M12 6.28c1.83 0 3.31 1.48 3.31 3.31S13.83 12.9 12 12.9s-3.31-1.49-3.31-3.31S10.17 6.28 12 6.28m4.35 12a9 9 0 0 1-.58.51c-.03.03-.07.06-.11.08-.06.06-.13.12-.2.16-.06.06-.13.11-.2.15 0 .01-.01.01-.02.02l-.1.07c-.94.69-2 1.23-3.14 1.62-1.66-.55-3.12-1.45-4.34-2.61a9.3 9.3 0 0 1-1.09-1.17c1.42-1.34 3.67-1.83 5.41-1.83s4.02.49 5.44 1.83c-.32.41-.68.81-1.07 1.17";

    // ─────────────────────────────────────────────
    // 1. 데이터 관리
    // ─────────────────────────────────────────────
    function getFolders() {
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
            return data.map(f => ({ ...f, parentId: f.parentId || null }));
        } catch { return []; }
    }
    function saveFolders(folders) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(folders));
    }
    function getCardKey(card) {
        return card.querySelector(TITLE_SEL)?.textContent?.trim() || '';
    }

    // ─────────────────────────────────────────────
    // 2. CSS 스타일
    // ─────────────────────────────────────────────
    GM_addStyle(`
        #lf-sticky-header {
            position: sticky; top: 56px; z-index: 10;
            background-color: var(--bg_screen, #ffffff);
            padding: 16px 0 0 0; margin-top: -16px;
        }
        /* v1.3.1: ::before 제거했었으나, 원본 <p>가 display:none 처리됐으므로 복원해도 무관.
           복원하지 않으면 sticky 고정 시 상단 여백 너머로 컨텐츠가 비쳐보임. */
        #lf-sticky-header::before {
            content: ""; position: absolute; bottom: 100%; left: 0; right: 0;
            height: 200px; background-color: var(--bg_screen, #ffffff); pointer-events: none;
        }
        /* v1.3.2: 탭바 컨테이너(sticky-header 직후 형제)가 DOM 순서상 나중에 오므로
           기본 stacking order에 의해 z-index:10인 sticky-header를 덮어버림.
           형제에 position:relative + z-index:1을 주어 명시적 stacking context를 생성,
           sticky-header(z-index:10)가 항상 위에 오도록 역전. */
        #lf-sticky-header + * { position: relative; z-index: 1; }
        .lf-header-container { display: flex; justify-content: space-between; align-items: center; width: 100%; padding-top: 6px; }
        .lf-header-title-text { font-size: 20px; font-weight: 700; color: var(--text_primary, #000); line-height: 1; }
        .lf-manage-btn {
            padding: 6px 14px; background: rgba(125,125,125,.15); border: none; border-radius: 8px;
            font-size: 13px; font-weight: bold; cursor: pointer; color: inherit;
        }
        .lf-search-wrap { padding: 10px 0 16px 0; width: 100%; position: relative; z-index: 11; }
        .lf-search-input {
            width: 100%; padding: 12px 15px; border-radius: 10px;
            border: 1px solid var(--outline_tertiary, #e0e0e0); background: var(--bg_secondary, transparent);
            color: var(--text_primary, #000); font-size: 14px; outline: none;
        }

        #lf-scroll-spacer {
            grid-column: 1 / -1;
            pointer-events: none;
            flex-shrink: 0;
        }

        .lf-folder-card {
            background: var(--bg_secondary, rgba(125,125,125,0.05));
            border: 1px solid var(--outline_tertiary, rgba(125,125,125,0.2));
            border-radius: 16px; cursor: pointer; transition: all 0.2s ease;
            display: flex; flex-direction: column; overflow: hidden; height: auto; min-height: 120px; align-self: start; /* 같은 행의 작품 카드 높이에 맞춰 늘어나지 않도록 */
        }
        .lf-folder-card.expanded { grid-column: 1 / -1; height: auto; border-color: #fb475d; }
        .lf-folder-summary {
            padding: 20px; display: flex; flex-direction: column; justify-content: center; align-items: center;
            height: 100%; gap: 8px; text-align: center;
        }
        .lf-folder-card.expanded > .lf-folder-summary {
            flex-direction: row; justify-content: flex-start; padding: 14px 20px;
            border-bottom: 1px solid rgba(125,125,125,0.2); background: rgba(125,125,125,0.1);
        }
        .lf-folder-summary .icon { font-size: 30px; }
        .lf-folder-card.expanded > .lf-folder-summary .icon { font-size: 18px; }
        .lf-folder-summary .title { font-weight: bold; font-size: 15px; color: var(--text_primary, #000); }
        .lf-folder-detail { display: none; padding: 20px; background: rgba(0,0,0,0.02); }
        .lf-folder-card.expanded > .lf-folder-detail { display: block; }
        .lf-folder-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 16px; }

        /* 미분류 신규 카드가 폴더 카드보다 앞(위)에 나타나는 문제 수정.
           DOM 순서: [신규카드(index 0)][기존카드(hidden)...][폴더카드...]
           CSS order로 시각적 순서를 역전: 폴더(order:0) → 작품 카드(order:1).
           React 관리 노드를 물리적으로 이동하지 않으므로 reconciliation 충돌 없음.
           > (직접 자식 한정) 사용 → 폴더 내부 그리드(.lf-folder-grid) 안의
           role=button 카드에는 적용되지 않음. */
        #liked-scroll div.grid[class*="gap-y-10"] > div[role="button"] { order: 1; }

        #lf-modal-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,.5);
            display: flex; justify-content: center; align-items: center; z-index: 9999;
        }
        #lf-modal {
            background: #fff; border-radius: 12px; padding: 20px;
            width: 800px; max-width: 95vw; height: 550px; max-height: 90vh;
            display: flex; flex-direction: column; gap: 14px; color: #333;
        }

        #lf-rename-block {
            display: none; background: rgba(125,125,125,0.08); padding: 14px; border-radius: 8px;
            flex-direction: column; gap: 10px; border: 1px solid rgba(125,125,125,0.2);
        }
        .lf-rename-row { display: flex; align-items: center; gap: 10px; }
        .lf-rename-row label { font-size: 12px; font-weight: bold; width: 80px; }
        .lf-rename-row input, .lf-rename-row select { flex: 1; padding: 6px; border-radius: 4px; border: 1px solid #ccc; font-size: 13px; }

        .lf-modal-top-controls { display: flex; gap: 6px; align-items: center; }
        .lf-modal-top-controls select { padding: 6px; border-radius: 6px; border: 1px solid #ccc; flex: 1; font-size: 14px; }
        .lf-modal-top-controls button { padding: 6px 10px; border-radius: 6px; border: 1px solid #ccc; background: #fff; cursor: pointer; font-size: 13px; }

        .lf-dual-list { display: flex; flex: 1; gap: 12px; overflow: hidden; min-height: 0; }
        .lf-pane { flex: 1; display: flex; flex-direction: column; border: 1px solid #ddd; border-radius: 8px; background: #fafafa; overflow: hidden; }
        .lf-pane-title { padding: 8px; background: #eee; font-weight: bold; font-size: 13px; text-align: center; border-bottom: 1px solid #ddd; }
        .lf-list-items { flex: 1; overflow-y: auto; padding: 5px; display: flex; flex-direction: column; gap: 2px; }

        .lf-list-item {
            flex-shrink: 0; display: flex; align-items: center; justify-content: space-between;
            line-height: 1.4; padding: 6px 10px; font-size: 13px; border-radius: 4px; border: 1px solid transparent;
        }
        .lf-list-item:hover { background: #eef; }
        .lf-work-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; }

        .lf-item-nav { display: flex; gap: 2px; }
        .lf-item-nav button {
            padding: 2px 5px; font-size: 10px; background: #fff; border: 1px solid #ccc;
            border-radius: 3px; cursor: pointer; color: #666;
        }
        .lf-item-nav button:hover { background: #eee; }

        .lf-modal-footer { display: flex; justify-content: flex-end; padding-top: 10px; border-top: 1px solid #eee; }
        .lf-modal-footer button { padding: 8px 20px; border-radius: 6px; background: #007aff; color: #fff; cursor: pointer; font-size: 13px; border: none; }

        @media (prefers-color-scheme: dark) {
            #lf-modal { background: #2c2c2c; color: #eee; }
            .lf-modal-top-controls select, .lf-modal-top-controls button, .lf-rename-row input, .lf-rename-row select { background: #3a3a3a; color: #fff; border-color: #555; }
            .lf-pane { background: #333; border-color: #444; }
            .lf-pane-title { background: #222; border-color: #444; }
            .lf-list-item:hover { background: #444; }
            .lf-item-nav button { background: #444; color: #ccc; border-color: #666; }
        }
    `);

    // ─────────────────────────────────────────────
    // 3. 통합 폴더 관리 모달
    // ─────────────────────────────────────────────
    function openManageModal() {
        const oldOverlay = document.getElementById('lf-modal-overlay');
        if (oldOverlay) oldOverlay.remove();

        let folders = getFolders();
        let currentFolderId = folders.length > 0 ? folders[0].id : null;

        const grid = document.querySelector(GRID_SEL);
        const allCards = Array.from(grid?.querySelectorAll(CARD_SEL) || []).filter(c => !c.closest('.lf-folder-card'));
        const allKeys = allCards.map(c => getCardKey(c)).filter(k => k);

        const overlay = document.createElement('div');
        overlay.id = 'lf-modal-overlay';
        overlay.innerHTML = `
            <div id="lf-modal" onclick="event.stopPropagation()">
                <h3>
                    <span>⚙️ 통합 폴더 관리 v2.0.6</span>
                    <span style="font-size:11px; font-weight:normal; opacity:0.6;">(클릭 시 즉시 이동)</span>
                </h3>

                <div id="lf-rename-block">
                    <div class="lf-rename-row">
                        <label>이름 수정</label>
                        <input type="text" id="lf-rename-input">
                    </div>
                    <div class="lf-rename-row">
                        <label>이 폴더의 상위 폴더</label>
                        <select id="lf-parent-select"></select>
                    </div>
                    <div style="display:flex; justify-content:flex-end; gap:6px; margin-top:4px;">
                        <button id="lf-btn-rename-confirm" style="background:#007aff; color:#fff; border:none; padding:5px 12px; border-radius:4px; cursor:pointer;">적용</button>
                        <button id="lf-btn-rename-cancel" style="border:1px solid #ccc; padding:5px 12px; border-radius:4px; cursor:pointer;">닫기</button>
                    </div>
                </div>

                <div class="lf-modal-top-controls">
                    <select id="lf-folder-select"></select>
                    <button id="lf-btn-up-folder" title="폴더 순서 위로">▲</button>
                    <button id="lf-btn-down-folder" title="폴더 순서 아래로">▼</button>
                    <button id="lf-btn-rename-folder">이름/상위 설정</button>
                    <button id="lf-btn-new-folder">+ 새 폴더</button>
                    <button id="lf-btn-del-folder" style="color:#ff3b30;">삭제</button>
                </div>

                <div class="lf-dual-list">
                    <div class="lf-pane">
                        <div class="lf-pane-title">미분류 작품</div>
                        <div class="lf-list-items" id="lf-unassigned-list"></div>
                    </div>
                    <div class="lf-pane">
                        <div class="lf-pane-title">폴더 내 작품 (순서 변경 가능)</div>
                        <div class="lf-list-items" id="lf-folder-list"></div>
                    </div>
                </div>
                <div class="lf-modal-footer">
                    <button id="lf-btn-close">닫기</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const selectEl = document.getElementById('lf-folder-select');
        const unassignedEl = document.getElementById('lf-unassigned-list');
        const folderListEl = document.getElementById('lf-folder-list');
        const renameBlock = document.getElementById('lf-rename-block');
        const parentSelect = document.getElementById('lf-parent-select');

        function renderModalUI() {
            folders = getFolders();
            selectEl.innerHTML = '';
            if (folders.length === 0) {
                selectEl.innerHTML = '<option value="">폴더를 먼저 생성해주세요</option>';
                currentFolderId = null;
            } else {
                // 루트 폴더별로 <optgroup>으로 묶어 구분선 삽입
                // - optgroup label = 루트 폴더명 (비선택 헤더 역할)
                // - 루트 폴더 자체 + 직계 자식을 같은 그룹 안에 배치
                const roots = folders.filter(f => !f.parentId);
                const childMap = {};
                folders.filter(f => f.parentId).forEach(f => {
                    (childMap[f.parentId] ??= []).push(f);
                });
                roots.forEach(root => {
                    const grp = document.createElement('optgroup');
                    grp.label = `📁 ${root.name}`;

                    const rootOpt = document.createElement('option');
                    rootOpt.value = root.id;
                    rootOpt.textContent = `${root.name} (${root.items.length})`;
                    if (root.id === currentFolderId) rootOpt.selected = true;
                    grp.appendChild(rootOpt);

                    (childMap[root.id] || []).forEach(child => {
                        const childOpt = document.createElement('option');
                        childOpt.value = child.id;
                        childOpt.textContent = `  ㄴ ${child.name} (${child.items.length})`;
                        if (child.id === currentFolderId) childOpt.selected = true;
                        grp.appendChild(childOpt);
                    });

                    selectEl.appendChild(grp);
                });

                if (!currentFolderId) currentFolderId = folders[0].id;
            }

            const assignedKeys = new Set(folders.flatMap(f => f.items));

            unassignedEl.innerHTML = '';
            allKeys.filter(k => !assignedKeys.has(k)).forEach(k => {
                const div = document.createElement('div');
                div.className = 'lf-list-item';
                div.innerHTML = `<span class="lf-work-name">${k}</span>`;
                div.querySelector('.lf-work-name').onclick = () => {
                    if (!currentFolderId) return;
                    const folder = folders.find(f => f.id === currentFolderId);
                    folder.items.push(k);
                    saveFolders(folders);
                    renderAll();
                    renderModalUI();
                };
                unassignedEl.appendChild(div);
            });

            folderListEl.innerHTML = '';
            if (currentFolderId) {
                const currentFolder = folders.find(f => f.id === currentFolderId);
                if (currentFolder) {
                    currentFolder.items.forEach((k, idx) => {
                        const div = document.createElement('div');
                        div.className = 'lf-list-item';
                        div.innerHTML = `
                            <span class="lf-work-name">${k}</span>
                            <div class="lf-item-nav">
                                <button class="lf-item-up">▲</button>
                                <button class="lf-item-down">▼</button>
                            </div>
                        `;
                        div.querySelector('.lf-work-name').onclick = () => {
                            currentFolder.items.splice(idx, 1);
                            saveFolders(folders);
                            renderAll();
                            renderModalUI();
                        };
                        div.querySelector('.lf-item-up').onclick = (e) => {
                            e.stopPropagation();
                            if (idx > 0) {
                                [currentFolder.items[idx], currentFolder.items[idx-1]] = [currentFolder.items[idx-1], currentFolder.items[idx]];
                                saveFolders(folders);
                                renderAll();
                                renderModalUI();
                            }
                        };
                        div.querySelector('.lf-item-down').onclick = (e) => {
                            e.stopPropagation();
                            if (idx < currentFolder.items.length - 1) {
                                [currentFolder.items[idx], currentFolder.items[idx+1]] = [currentFolder.items[idx+1], currentFolder.items[idx]];
                                saveFolders(folders);
                                renderAll();
                                renderModalUI();
                            }
                        };
                        folderListEl.appendChild(div);
                    });
                }
            }
        }

        selectEl.onchange = (e) => {
            currentFolderId = e.target.value;
            renameBlock.style.display = 'none';
            renderModalUI();
        };

        document.getElementById('lf-btn-rename-folder').onclick = () => {
            if (!currentFolderId) return;
            const folder = folders.find(f => f.id === currentFolderId);
            document.getElementById('lf-rename-input').value = folder.name;

            parentSelect.innerHTML = '<option value="">없음 (최상위)</option>';
            folders.forEach(f => {
                if (f.id !== currentFolderId && f.parentId !== currentFolderId) {
                    const opt = document.createElement('option');
                    opt.value = f.id;
                    opt.textContent = f.name;
                    if (f.id === folder.parentId) opt.selected = true;
                    parentSelect.appendChild(opt);
                }
            });

            renameBlock.style.display = 'flex';
        };

        document.getElementById('lf-btn-rename-confirm').onclick = () => {
            const folderIndex = folders.findIndex(f => f.id === currentFolderId);
            if (folderIndex === -1) return;

            const folder = folders[folderIndex];
            const newParentId = parentSelect.value || null;

            folder.name = document.getElementById('lf-rename-input').value.trim() || folder.name;

            if (folder.parentId !== newParentId) {
                folder.parentId = newParentId;

                if (newParentId) {
                    const [movedFolder] = folders.splice(folderIndex, 1);
                    const parentIndex = folders.findIndex(f => f.id === newParentId);

                    if (parentIndex !== -1) {
                        // parentIndex+1에 바로 삽입하면 기존 직계 자식들보다 앞에 끼어들어
                        // 모달 목록 상 순서가 맨 위로 올라가는 것처럼 보임.
                        // 기존 직계 자식을 모두 건너뛴 뒤 맨 마지막 자리에 삽입.
                        let insertAt = parentIndex + 1;
                        while (insertAt < folders.length && folders[insertAt].parentId === newParentId) {
                            insertAt++;
                        }
                        folders.splice(insertAt, 0, movedFolder);
                    } else {
                        folders.push(movedFolder);
                    }
                }
            }

            saveFolders(folders);
            renderAll();
            renameBlock.style.display = 'none';
            renderModalUI();
        };

        document.getElementById('lf-btn-rename-cancel').onclick = () => renameBlock.style.display = 'none';

        // 폴더 블록의 끝 인덱스(exclusive) 반환.
        // 해당 폴더 + 모든 하위 폴더(재귀)를 하나의 블록으로 처리.
        // 단순 인접 요소 교환은 하위 폴더가 있는 루트 폴더에서 루트-자식 간
        // 교환만 일어나 시각 순서가 전혀 바뀌지 않는 문제 해결을 위해 도입.
        function getBlockEnd(arr, startIdx) {
            const owned = new Set([arr[startIdx].id]);
            let i = startIdx + 1;
            while (i < arr.length) {
                if (arr[i].parentId && owned.has(arr[i].parentId)) {
                    owned.add(arr[i].id);
                    i++;
                } else break;
            }
            return i;
        }

        document.getElementById('lf-btn-up-folder').onclick = () => {
            const idx = folders.findIndex(f => f.id === currentFolderId);
            if (idx <= 0) return;

            const parentId = folders[idx].parentId;
            // 같은 부모를 가진 이전 형제 찾기 (단순 idx-1이 아닌 동일 parentId 기준)
            let prevSibIdx = -1;
            for (let i = idx - 1; i >= 0; i--) {
                if (folders[i].parentId === parentId) { prevSibIdx = i; break; }
            }
            if (prevSibIdx === -1) return;

            // 현재 블록을 먼저 제거(뒤쪽이므로 이전 블록 인덱스에 영향 없음)
            const currBlock = folders.splice(idx, getBlockEnd(folders, idx) - idx);
            // 이전 형제 블록 제거 (원래 idx 위치까지 = spliced 후에도 동일)
            const prevBlock = folders.splice(prevSibIdx, idx - prevSibIdx);
            // 이전 형제 위치에 현재 블록 → 이전 블록 순으로 삽입
            folders.splice(prevSibIdx, 0, ...currBlock, ...prevBlock);

            saveFolders(folders);
            renderAll();
            renderModalUI();
        };

        document.getElementById('lf-btn-down-folder').onclick = () => {
            const idx = folders.findIndex(f => f.id === currentFolderId);
            if (idx < 0) return;

            const parentId = folders[idx].parentId;
            const currEnd = getBlockEnd(folders, idx);

            // 현재 블록 이후에서 같은 부모를 가진 다음 형제 찾기
            let nextSibIdx = -1;
            for (let i = currEnd; i < folders.length; i++) {
                if (folders[i].parentId === parentId) { nextSibIdx = i; break; }
            }
            if (nextSibIdx === -1) return;

            // 다음 형제 블록을 제거한 뒤 현재 블록 앞에 삽입
            const nextBlock = folders.splice(nextSibIdx, getBlockEnd(folders, nextSibIdx) - nextSibIdx);
            folders.splice(idx, 0, ...nextBlock);

            saveFolders(folders);
            renderAll();
            renderModalUI();
        };

        document.getElementById('lf-btn-new-folder').onclick = () => {
            const newId = 'lf_' + Date.now();
            folders.push({ id: newId, name: '새 폴더', items: [], parentId: null });
            currentFolderId = newId;
            saveFolders(folders);
            renderAll();
            renderModalUI();
        };

        document.getElementById('lf-btn-del-folder').onclick = () => {
            if (!currentFolderId) return;
            if (confirm("이 폴더를 삭제할까요? 하위 폴더가 있다면 상위로 이동됩니다.")) {
                folders.forEach(f => { if(f.parentId === currentFolderId) f.parentId = null; });
                folders = folders.filter(f => f.id !== currentFolderId);
                currentFolderId = folders.length > 0 ? folders[0].id : null;
                saveFolders(folders);
                renderAll();
                renderModalUI();
            }
        };

        document.getElementById('lf-btn-close').onclick = () => overlay.remove();
        overlay.onclick = () => overlay.remove();

        renderModalUI();
    }

// ─────────────────────────────────────────────
    // 4. 메인 화면 렌더링
    // ─────────────────────────────────────────────

    function kickstartInfiniteScroll() {
        if (window.scrollY + window.innerHeight >= document.body.scrollHeight - 300) {
            const tempBlock = document.createElement('div');
            tempBlock.style.height = '2000px';
            document.body.appendChild(tempBlock);
            setTimeout(() => tempBlock.remove(), 50);
        }
    }

    function renderAll() {
        const grid = document.querySelector(GRID_SEL);
        if (!grid) return;

        const folders = getFolders();
        const assignedKeys = new Set(folders.flatMap(f => f.items));

        grid.querySelectorAll('.lf-folder-card').forEach(el => el.remove());
        grid.querySelectorAll('#lf-scroll-spacer').forEach(el => el.remove());
        grid.style.paddingBottom = '0px';

        const allCards = Array.from(grid.querySelectorAll(CARD_SEL)).filter(c => !c.closest('.lf-folder-card'));

        allCards.forEach(card => {
            if (assignedKeys.has(getCardKey(card))) {
                card.style.display = 'none';
            } else {
                card.style.display = '';
            }
        });

        function createFolderElement(folderData, parentGrid) {
            const folderCards = allCards.filter(card => folderData.items.includes(getCardKey(card)));
            const subFolders = folders.filter(f => f.parentId === folderData.id);

            const folderBlock = document.createElement('div');
            folderBlock.className = 'lf-folder-card';
            folderBlock.innerHTML = `
                <div class="lf-folder-summary">
                    <span class="icon">📁</span>
                    <span class="title">${folderData.name}</span>
                    <span class="count">${folderCards.length}개 작품<br>${subFolders.length}개 폴더</span>
                </div>
                <div class="lf-folder-detail">
                    <div class="lf-folder-grid"></div>
                </div>
            `;

            const innerGrid = folderBlock.querySelector('.lf-folder-grid');

            subFolders.forEach(sub => createFolderElement(sub, innerGrid));

            folderData.items.forEach(key => {
                const origin = allCards.find(c => getCardKey(c) === key);
                if (origin) {
                    const clone = origin.cloneNode(true);
                    clone.style.cssText = 'width: 100%;';
                    clone.onclick = () => origin.click();
                    innerGrid.appendChild(clone);
                }
            });

            folderBlock.querySelector('.lf-folder-summary').onclick = (e) => {
                e.stopPropagation();
                folderBlock.classList.toggle('expanded');
            };

            parentGrid.appendChild(folderBlock); // insertBefore 패턴을 버리고 appendChild로 교체 → 배열 순서 = 렌더 순서
        }

        folders.filter(f => !f.parentId).forEach(rootFolder => { // .reverse() 제거: appendChild로 변경했으므로 역순 보정 불필요
            createFolderElement(rootFolder, grid);
        });

        const searchInput = document.getElementById('lf-search-input');
        if (searchInput?.value) applySearch(searchInput.value.toLowerCase().trim());

        kickstartInfiniteScroll();
    }

    function applySearch(query) {
        const grid = document.querySelector(GRID_SEL);
        if (!grid) return;
        const assignedKeys = new Set(getFolders().flatMap(f => f.items));

        // 미분류 카드 처리 (폴더 밖 카드)
        grid.querySelectorAll(CARD_SEL).forEach(card => {
            if (card.closest('.lf-folder-card')) return;
            const key = getCardKey(card);
            if (assignedKeys.has(key)) return;
            if (!query) { card.style.display = ''; return; }
            const titleText = card.querySelector(TITLE_SEL)?.textContent.toLowerCase() || '';
            card.style.display = titleText.includes(query) ? '' : 'none';
        });

        // 폴더 카드 재귀 처리: 매칭 여부(boolean)를 반환
        function processFolderBlock(folderBlock) {
            const innerGrid = folderBlock.querySelector('.lf-folder-grid');

            if (!query) {
                // 검색어 없음: 모든 폴더 초기 상태로 복원
                folderBlock.style.display = '';
                folderBlock.classList.remove('expanded');
                if (innerGrid) {
                    innerGrid.querySelectorAll(':scope > [role="button"]').forEach(c => c.style.display = '');
                    innerGrid.querySelectorAll(':scope > .lf-folder-card').forEach(sub => processFolderBlock(sub));
                }
                return true;
            }

            if (!innerGrid) {
                folderBlock.style.display = 'none';
                return false;
            }

            let hasMatch = false;

            // 직속 아이템 카드 필터링
            innerGrid.querySelectorAll(':scope > [role="button"]').forEach(card => {
                const titleText = card.querySelector(TITLE_SEL)?.textContent.toLowerCase() || '';
                const matched = titleText.includes(query);
                card.style.display = matched ? '' : 'none';
                if (matched) hasMatch = true;
            });

            // 하위 폴더 재귀 처리
            innerGrid.querySelectorAll(':scope > .lf-folder-card').forEach(sub => {
                if (processFolderBlock(sub)) hasMatch = true;
            });

            // 매칭 항목이 있으면 펼침, 없으면 숨김
            if (hasMatch) {
                folderBlock.style.display = '';
                folderBlock.classList.add('expanded');
            } else {
                folderBlock.style.display = 'none';
                folderBlock.classList.remove('expanded');
            }

            return hasMatch;
        }

        // 최상위 폴더만 순회 (하위 폴더는 재귀 내부에서 처리)
        grid.querySelectorAll(':scope > .lf-folder-card').forEach(folderBlock => {
            processFolderBlock(folderBlock);
        });
    }

    function initUI() {
        const titleElement = document.querySelector(PAGE_TITLE_SEL);
        if (!titleElement || document.getElementById('lf-sticky-header')) return;

        // ⚠️ v1.1.0 이하 구조: titleElement(React 관리 노드)를 wrapper div 안으로 이동시킴.
        //   → 신규 탭(스토리/캐릭터/나만의 태그) UI 추가로 이 영역의 리렌더링 빈도가 늘면서,
        //     React reconciliation이 기대 위치(title 직속)에 다른 태그(div)가 있는 것을 감지 →
        //     서브트리를 통째로 버리고 title을 새로 생성 → 주입했던 UI 전체가 함께 삭제되는 것으로 추정.
        //     (정적 캡처상 css-342uqh title이 스크립트 흔적 전혀 없는 순수 상태로 존재 — 정황 증거)
        // ✅ v1.2.0: titleElement는 절대 이동·래핑하지 않고 형제 노드로만 삽입 → 재조정 충돌 원천 차단.
        const stickyWrap = document.createElement('div');
        stickyWrap.id = 'lf-sticky-header';
        stickyWrap.innerHTML = `
            <div class="lf-header-container">
                <span class="lf-header-title-text">${titleElement.textContent.trim()}</span>
                <button class="lf-manage-btn">⚙️ 폴더 관리</button>
            </div>
            <div class="lf-search-wrap">
                <input type="text" id="lf-search-input" class="lf-search-input" placeholder="작품 제목으로 검색...">
            </div>
        `;
        titleElement.insertAdjacentElement('afterend', stickyWrap);
        // 원본 <p>는 DOM에 그대로 두되 숨김(display:none은 React가 되돌리지 않음).
        // sticky header 안의 복사본이 제목 역할을 대신하므로 중복 표시 방지.
        titleElement.style.display = 'none';

        stickyWrap.querySelector('.lf-manage-btn').onclick = openManageModal;
        stickyWrap.querySelector('#lf-search-input').oninput = e => applySearch(e.target.value.toLowerCase().trim());
    }

    // ─────────────────────────────────────────────
    // 5. UI 정리 (페이지 이동 시)
    // ─────────────────────────────────────────────
    function cleanupUI() {
        // v1.2.0: titleElement를 더 이상 이동/래핑하지 않으므로 복원 로직 불필요.
        //         형제 노드로 삽입했던 헤더만 제거하면 원본 DOM은 항상 그대로 보존됨.
        // v1.3.1: display:none 처리한 원본 <p>를 복원.
        document.getElementById('lf-sticky-header')?.remove();
        const pageTitle = document.querySelector(PAGE_TITLE_SEL);
        if (pageTitle) pageTitle.style.display = '';

        const grid = document.querySelector(GRID_SEL);
        if (grid) {
            grid.querySelectorAll('.lf-folder-card').forEach(el => el.remove());
            grid.querySelector('#lf-scroll-spacer')?.remove();
            grid.querySelectorAll(CARD_SEL).forEach(card => card.style.display = '');
        }

        lastCardCount = 0;
    }

    // ─────────────────────────────────────────────
    // 6. 감시자 (옵저버) + setInterval 안전망
    // ─────────────────────────────────────────────
    let lastCardCount = 0;
    let debounceTimer = null;

    function checkAndRender() {
        if (!window.location.pathname.includes('/liked')) {
            cleanupUI();
            return;
        }

        initUI();

        const grid = document.querySelector(GRID_SEL);
        if (!grid) return;

        const cards = Array.from(grid.querySelectorAll(CARD_SEL))
            .filter(c => !c.closest('.lf-folder-card'));

        const savedFolderCount = getFolders().length;
        const renderedFolderCount = grid.querySelectorAll('.lf-folder-card').length;

        const cardCountChanged = cards.length !== lastCardCount;
        const foldersVanished = savedFolderCount > 0 && renderedFolderCount === 0;

        if (cardCountChanged || foldersVanished) {
            lastCardCount = cards.length;
            renderAll();
        }
    }

    const observer = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(checkAndRender, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setInterval(checkAndRender, 1500);

})();
