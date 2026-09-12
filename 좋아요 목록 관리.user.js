// ==UserScript==
// @name         좋아요 목록 관리
// @namespace    https://github.com/workforomg/Util
// @version      3.0.0
// @description  컬렉션 전체 표시 / 좋아요 목록 접기 / 작품 검색 / 컬렉션 태그
// @match        https://crack.wrtn.ai/liked*
// @match        https://crack.wrtn.ai/collections/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────────
    // §0. 마이그레이션 / 상수 / 선택자
    // ─────────────────────────────────────────────────────────────────

    // v2.0.x 구형식 폴더 데이터 자동 삭제 (일회성)
    localStorage.removeItem('liked_folders_v1');

    const PAGE_TITLE_SEL = '#liked-scroll p[class*="typo-text-2xl"]';
    const GRID_SEL       = '#liked-scroll div.grid[class*="gap-y-10"]';
    const CARD_SEL       = ':scope > div[role="button"]';
    const TITLE_SEL      = 'p.line-clamp-2';
    const CAROUSEL_SEL   = '#liked-scroll [aria-roledescription="carousel"]';
    const SLIDE_SEL      = '[aria-roledescription="slide"]';

    const LAYOUT_KEY       = 'crk-liked-col-layout';     // 컬렉션 행 순서 + 색상
    const COLLAPSE_KEY     = 'crk-liked-grid-collapsed'; // 작품 그리드 접기 상태
    const COL_COLLAPSE_KEY = 'crk-liked-col-collapsed';  // 컬렉션 섹션 접기 상태
    const COL_CACHE_PREFIX = 'crk-col-cache::';           // 컬렉션 카드 캐시

    // ─────────────────────────────────────────────────────────────────
    // §1. CSS
    // ─────────────────────────────────────────────────────────────────
    GM_addStyle(`
        /* ── 검색 버튼 + 검색바 ── */
        #lf-search-btn {
            font-size: 14px; padding: 1px 8px; border-radius: 6px;
            border: none; background: rgba(125,125,125,.12);
            color: inherit; cursor: pointer; flex-shrink: 0;
        }
        #lf-search-btn:hover { background: rgba(125,125,125,.22); }
        /* 탭 아래 고정 검색창 */
        #lf-search-bar {
            position: sticky;
            z-index: 9;
            background: var(--bg_screen, #fff);
            padding: 6px 0 8px;
            box-shadow: 0 -50px 0 50px var(--bg_screen, #fff);
        }
        .lf-search-input {
            display: block; width: 100%; padding: 10px 15px; border-radius: 10px;
            border: 1px solid var(--outline_tertiary, #e0e0e0);
            background: var(--bg_secondary, transparent);
            color: var(--text_primary, #000); font-size: 14px;
            outline: none; box-sizing: border-box;
        }

        /* ── 컬렉션 섹션 ── */
        #lf-col-section { margin-bottom: 16px; }
        .lf-col-hdr {
            display: flex; align-items: center; justify-content: space-between;
            height: 24px; margin-bottom: 12px;
        }
        .lf-col-hdr-title {
            font-size: 15px; font-weight: 600;
            color: var(--foreground, #000);
            flex: 1; /* justify-between 3분할 방지 → 버튼들을 오른쪽으로 */
        }
        .lf-col-edit-btn {
            font-size: 12px; padding: 3px 10px; border-radius: 6px;
            border: none; background: rgba(125,125,125,.12);
            color: inherit; cursor: pointer; font-weight: 500;
        }
        .lf-col-edit-btn:hover { background: rgba(125,125,125,.22); }

        .lf-col-rows { display: flex; flex-direction: column; gap: 20px; }
        .lf-col-row-label {
            font-size: 12px; font-weight: 600;
            color: var(--muted-foreground, #888);
            margin-bottom: 6px; letter-spacing: .04em;
        }
        .lf-col-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
        }
        @media (min-width: 640px)  { .lf-col-grid { grid-template-columns: repeat(4, 1fr); } }
        @media (min-width: 768px)  { .lf-col-grid { grid-template-columns: repeat(5, 1fr); } }

        a.lf-col-card {
            display: flex; flex-direction: column; gap: 8px;
            text-decoration: none; color: inherit; cursor: pointer;
        }
        .lf-col-thumbs {
            display: grid; grid-template-columns: 1fr 1fr;
            grid-template-rows: 1fr 1fr; aspect-ratio: 1;
            border-radius: 10px; overflow: hidden;
            background: var(--bg_secondary, #f0f0f0);
        }
        .lf-col-thumbs img {
            width: 100%; height: 100%; object-fit: cover; display: block;
        }
        .lf-col-thumb-ph {
            background: rgba(125,125,125,.1); width: 100%; height: 100%;
        }
        .lf-col-name {
            font-size: 13px; font-weight: 600; color: var(--primary, #000);
            white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .lf-col-count { font-size: 12px; color: var(--muted-foreground, #888); }

        /* ── 접기/펼치기 버튼 (공통) ── */
        #lf-toggle-btn, #lf-col-toggle-btn {
            font-size: 12px; padding: 2px 10px; border-radius: 6px;
            border: none; background: rgba(125,125,125,.12);
            color: inherit; cursor: pointer; font-weight: 500; flex-shrink: 0;
        }
        #lf-toggle-btn:hover, #lf-col-toggle-btn:hover { background: rgba(125,125,125,.22); }
        /* 그리드 헤더 버튼들 사이 간격 */
        #lf-search-btn, #lf-toggle-btn { margin-right: 6px; }

        /* ── 편집 모달 ── */
        #lf-col-modal-overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,.45);
            display: flex; justify-content: center; align-items: center; z-index: 9999;
        }
        #lf-col-modal {
            background: #fff; border-radius: 14px; padding: 22px;
            width: 720px; max-width: 95vw; max-height: 88vh;
            display: flex; flex-direction: column; gap: 14px;
            color: #222; box-sizing: border-box;
        }
        #lf-col-modal h3 { margin: 0; font-size: 17px; }

        .lf-modal-body {
            display: flex; gap: 14px; flex: 1; min-height: 0; overflow: hidden;
        }

        /* 왼쪽: 행 목록 */
        .lf-rows-pane {
            width: 210px; flex-shrink: 0; display: flex; flex-direction: column;
            border: 1px solid #ddd; border-radius: 10px; overflow: hidden;
            background: #fafafa;
        }
        .lf-rows-pane-hdr {
            padding: 8px 10px; background: #eee; font-weight: 700;
            font-size: 13px; border-bottom: 1px solid #ddd;
            display: flex; align-items: center; justify-content: space-between;
        }
        .lf-rows-pane-hdr button {
            font-size: 12px; padding: 2px 7px; border-radius: 4px;
            border: 1px solid #ccc; background: #fff; cursor: pointer;
        }
        .lf-row-list {
            flex: 1; overflow-y: auto; padding: 4px;
            display: flex; flex-direction: column; gap: 2px;
        }
        .lf-row-item {
            display: flex; align-items: center; gap: 4px;
            padding: 6px 8px; border-radius: 6px; cursor: pointer;
            font-size: 13px; border: 1px solid transparent;
        }
        .lf-row-item:hover { background: #eef; }
        .lf-row-item.selected { background: #e6f0ff; border-color: #aac4f0; font-weight: 600; }
        .lf-row-item-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lf-row-btns { display: flex; gap: 2px; }
        .lf-row-btns button {
            font-size: 10px; padding: 1px 4px; border-radius: 3px;
            border: 1px solid #ccc; background: #fff; cursor: pointer; color: #555;
        }
        .lf-row-btns button:hover { background: #eee; }
        .lf-rb-del { color: #c33 !important; }
        /* 행 이름 편집 아이콘 */
        .lf-rb-rename {
            font-size: 12px; padding: 1px 4px; border-radius: 3px;
            border: none; background: transparent; cursor: pointer;
            color: #888; flex-shrink: 0; line-height: 1;
        }
        .lf-rb-rename:hover { background: #dde8ff; }
        /* 인라인 편집 input */
        .lf-row-name-inline-inp {
            flex: 1; min-width: 0; padding: 1px 6px; border-radius: 4px;
            border: 1px solid #aac4f0; font-size: 13px; outline: none;
            background: #fff; font-weight: inherit;
        }

        /* 오른쪽: 듀얼 패널 */
        .lf-dual { flex: 1; display: flex; gap: 10px; min-height: 0; }
        .lf-pane {
            flex: 1; display: flex; flex-direction: column;
            border: 1px solid #ddd; border-radius: 10px;
            overflow: hidden; background: #fafafa;
        }
        .lf-pane-title {
            padding: 7px 10px; background: #eee; font-weight: 700;
            font-size: 13px; border-bottom: 1px solid #ddd;
            display: flex; align-items: center; gap: 8px;
        }
        .lf-items-list {
            flex: 1; overflow-y: auto; padding: 4px;
            display: flex; flex-direction: column; gap: 2px;
        }
        .lf-col-item {
            display: flex; align-items: center; gap: 6px;
            padding: 6px 8px; font-size: 13px;
            border-radius: 5px; border: 1px solid transparent;
        }
        .lf-col-item:hover { background: #eef; }
        .lf-col-item-name {
            flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .lf-col-ord, .lf-col-action {
            font-size: 11px; padding: 2px 6px; border-radius: 3px;
            border: 1px solid #ccc; background: #fff; cursor: pointer;
            color: #555; flex-shrink: 0;
        }
        .lf-col-ord:disabled { opacity: .35; cursor: default; }
        .lf-col-ord:not(:disabled):hover, .lf-col-action:hover { background: #eee; }
        .lf-col-action.add { color: #007aff; border-color: #007aff; }
        .lf-col-action.remove { color: #c33; border-color: #c33; }

        /* ── 색상 스와치 (모달 내) ── */
        .lf-col-swatch {
            width: 16px; height: 16px; border-radius: 50%;
            border: 2px solid #bbb; cursor: pointer; flex-shrink: 0;
            padding: 0; background: #e0e0e0;
        }
        .lf-col-swatch:hover { transform: scale(1.15); }

        /* ── 컬렉션 이름 옆 색상 점 ── */
        .lf-col-name-row {
            display: flex; align-items: center; gap: 5px;
        }
        .lf-col-dot {
            width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
        }

        /* ── 태그 배지 (카드 내) ── */
        .lf-tag-wrap {
            display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px;
        }
        .lf-tag-badge {
            display: inline-flex; align-items: center;
            font-size: 10px; padding: 1px 6px; border-radius: 9px;
            white-space: nowrap; line-height: 1.6;
        }

        .lf-empty-hint {
            color: #aaa; font-size: 12px; padding: 10px; text-align: center;
        }

        .lf-modal-footer {
            display: flex; justify-content: flex-end;
            padding-top: 10px; border-top: 1px solid #eee;
        }
        .lf-modal-footer button {
            padding: 8px 22px; border-radius: 8px; background: #007aff;
            color: #fff; cursor: pointer; font-size: 13px;
            border: none; font-weight: 600;
        }
    `);

    // ─────────────────────────────────────────────────────────────────
    // §2. 컬렉션 레이아웃 저장소
    // 형식: { rows: [{ label: string, ids: string[] }, ...] }
    // ─────────────────────────────────────────────────────────────────
    function getLayout() {
        try {
            const d = JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}');
            if (!Array.isArray(d.rows)) d.rows = [];
            if (!d.colColors || typeof d.colColors !== 'object') d.colColors = {};
            return d;
        } catch { return { rows: [], colColors: {} }; }
    }

    function getColColor(colId) { return getLayout().colColors[colId] || null; }
    function setColColor(colId, color) {
        const layout = getLayout();
        layout.colColors[colId] = color;
        saveLayout(layout);
    }
    function saveLayout(layout) {
        localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
    }

    // ─────────────────────────────────────────────────────────────────
    // §3. 컬렉션 데이터 추출 (캐러셀 DOM → 데이터 배열)
    // ─────────────────────────────────────────────────────────────────
    function extractCollections() {
        const carousel = document.querySelector(CAROUSEL_SEL);
        if (!carousel) return [];
        return Array.from(carousel.querySelectorAll(SLIDE_SEL)).flatMap(slide => {
            const a = slide.querySelector('a[href^="/collections/"]');
            if (!a) return [];
            const m = a.href.match(/\/collections\/([a-f0-9]{24})/i);
            if (!m) return [];
            const id = m[1];
            // Emotion 해시 없는 순수 Tailwind: class*= 방식으로 안전하게 탐색
            const name  = slide.querySelector('p[class*="typo-text-base"]')?.textContent?.trim() || '';
            const count = slide.querySelector('p[class*="typo-text-sm"]')?.textContent?.trim()  || '';
            const thumbs = Array.from(slide.querySelectorAll('img')).map(i => i.src).slice(0, 4);
            return [{ id, name, count, thumbs }];
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // §4. 컬렉션 그리드 렌더링
    // ─────────────────────────────────────────────────────────────────
    let _cachedCollections = [];

    function renderCollectionSection() {
        document.getElementById('lf-col-section')?.remove();

        const collections = extractCollections();
        if (!collections.length) return;
        _cachedCollections = collections;

        // 원본 캐러셀 섹션 숨기기 (React 노드 이동 없이 display:none만)
        const carouselSection = document.querySelector(CAROUSEL_SEL)?.closest('section');
        if (carouselSection) carouselSection.style.display = 'none';

        // 레이아웃 초기화/동기화
        let layout = getLayout();
        const knownIds = new Set(layout.rows.flatMap(r => r.ids));

        if (!layout.rows.length) {
            // 최초 실행: 전체를 단일 행으로
            layout.rows = [{ label: '', ids: collections.map(c => c.id) }];
            saveLayout(layout);
        } else {
            // 신규 컬렉션(아직 레이아웃에 없는 것) → 첫 번째 행 앞에 추가
            const newIds = collections.map(c => c.id).filter(id => !knownIds.has(id));
            if (newIds.length) {
                layout.rows[0].ids = [...newIds, ...layout.rows[0].ids];
                saveLayout(layout);
            }
        }

        // 섹션 DOM 구성
        const section = document.createElement('div');
        section.id = 'lf-col-section';

        const hdr = document.createElement('div');
        hdr.className = 'lf-col-hdr';
        hdr.innerHTML = `<span class="lf-col-hdr-title">내 컬렉션</span>`;

        const colToggleBtn = document.createElement('button');
        colToggleBtn.id = 'lf-col-toggle-btn';
        const initColCollapsed = getColCollapsed();
        colToggleBtn.textContent = initColCollapsed ? '펼치기 ▼' : '접기 ▲';
        colToggleBtn.onclick = () => {
            const next = !getColCollapsed();
            setColCollapsed(next);
            rowsWrap.style.display = next ? 'none' : '';
            colToggleBtn.textContent = next ? '펼치기 ▼' : '접기 ▲';
        };
        hdr.appendChild(colToggleBtn);

        const editBtn = document.createElement('button');
        editBtn.className = 'lf-col-edit-btn';
        editBtn.textContent = '⚙️ 순서 편집';
        editBtn.onclick = () => openCollectionEditModal(_cachedCollections);
        hdr.appendChild(editBtn);
        section.appendChild(hdr);

        const rowsWrap = document.createElement('div');
        rowsWrap.className = 'lf-col-rows';
        const colMap = new Map(collections.map(c => [c.id, c]));

        layout.rows.forEach(row => {
            const validIds = row.ids.filter(id => colMap.has(id));
            if (!validIds.length) return;

            const rowWrap = document.createElement('div');
            if (row.label) {
                const labelEl = document.createElement('div');
                labelEl.className = 'lf-col-row-label';
                labelEl.textContent = row.label;
                rowWrap.appendChild(labelEl);
            }
            const grid = document.createElement('div');
            grid.className = 'lf-col-grid';
            validIds.forEach(id => grid.appendChild(buildCollectionCard(colMap.get(id))));
            rowWrap.appendChild(grid);
            rowsWrap.appendChild(rowWrap);
        });
        section.appendChild(rowsWrap);

        // 초기 collapsed 상태 적용
        if (initColCollapsed) rowsWrap.style.display = 'none';

        // 캐러셀 섹션 바로 앞에 삽입
        if (carouselSection) {
            carouselSection.insertAdjacentElement('beforebegin', section);
        } else {
            // 캐러셀 미탐지 시 liked-scroll 내부 첫 flex 컨테이너에 삽입
            const inner = document.querySelector('#liked-scroll .flex.flex-1.flex-col');
            if (inner) inner.insertBefore(section, inner.firstChild);
        }
    }

    function buildCollectionCard(col) {
        const color = getColColor(col.id);

        const a = document.createElement('a');
        a.className = 'lf-col-card';
        a.href = `/collections/${col.id}`;
        // SPA 라우터 우회: 원본 캐러셀의 React Router Link를 빌려서 클릭
        a.onclick = e => {
            e.preventDefault();
            const origLink = document.querySelector(
                `${CAROUSEL_SEL} a[href*="/collections/${col.id}"]`
            );
            if (origLink) {
                origLink.dispatchEvent(
                    new MouseEvent('click', { bubbles: true, cancelable: true })
                );
            } else {
                // fallback: history API (라우터가 popstate를 감지하는 경우)
                window.history.pushState({}, '', `/collections/${col.id}`);
                window.dispatchEvent(new PopStateEvent('popstate'));
            }
        };

        // 썸네일
        const thumbs = document.createElement('div');
        thumbs.className = 'lf-col-thumbs';
        for (let i = 0; i < 4; i++) {
            if (col.thumbs[i]) {
                const img = document.createElement('img');
                img.src = col.thumbs[i];
                img.alt = '';
                img.loading = 'lazy';
                thumbs.appendChild(img);
            } else {
                const ph = document.createElement('div');
                ph.className = 'lf-col-thumb-ph';
                thumbs.appendChild(ph);
            }
        }
        a.appendChild(thumbs);

        // 이름 행 (색상 점 포함)
        const nameRow = document.createElement('div');
        nameRow.className = 'lf-col-name-row';
        if (color) {
            const dot = document.createElement('span');
            dot.className = 'lf-col-dot';
            dot.style.background = color;
            nameRow.appendChild(dot);
        }
        const name = document.createElement('p');
        name.className = 'lf-col-name';
        name.textContent = col.name;
        nameRow.appendChild(name);
        a.appendChild(nameRow);

        const count = document.createElement('p');
        count.className = 'lf-col-count';
        count.textContent = col.count;
        a.appendChild(count);

        return a;
    }

    // ─────────────────────────────────────────────────────────────────
    // §5. 컬렉션 편집 모달
    // ─────────────────────────────────────────────────────────────────
    function openCollectionEditModal(collections) {
        document.getElementById('lf-col-modal-overlay')?.remove();

        const colMap = new Map(collections.map(c => [c.id, c]));
        let layout = getLayout();
        let selIdx = layout.rows.length > 0 ? 0 : -1;

        const overlay = document.createElement('div');
        overlay.id = 'lf-col-modal-overlay';
        overlay.innerHTML = `
            <div id="lf-col-modal" onclick="event.stopPropagation()">
                <h3>컬렉션 순서 편집</h3>
                <div class="lf-modal-body">
                    <div class="lf-rows-pane">
                        <div class="lf-rows-pane-hdr">
                            <span>행 목록</span>
                            <button id="lf-add-row-btn">+ 행 추가</button>
                        </div>
                        <div class="lf-row-list" id="lf-row-list"></div>
                    </div>
                    <div class="lf-dual" id="lf-dual"></div>
                </div>
                <div class="lf-modal-footer">
                    <button id="lf-col-modal-close">완료</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        function save() { saveLayout(layout); }

        function close() {
            overlay.remove();
            renderCollectionSection();
        }

        overlay.onclick = close;
        document.getElementById('lf-col-modal-close').onclick = close;
        document.getElementById('lf-add-row-btn').onclick = () => {
            layout.rows.push({ label: '', ids: [] });
            selIdx = layout.rows.length - 1;
            save();
            renderRowList();
        };

        // ── 행 목록 ──
        function renderRowList() {
            const list = document.getElementById('lf-row-list');
            if (!list) return;
            list.innerHTML = '';

            if (!layout.rows.length) {
                list.innerHTML = '<div class="lf-empty-hint">행이 없습니다</div>';
                renderDual();
                return;
            }

            layout.rows.forEach((row, idx) => {
                const item = document.createElement('div');
                item.className = 'lf-row-item' + (idx === selIdx ? ' selected' : '');
                item.innerHTML = `
                    <button class="lf-rb-rename" title="행 이름 편집">✏️</button>
                    <span class="lf-row-item-name">${_esc(row.label || '(이름 없음)')}
                        <span style="color:#aaa;font-size:11px;font-weight:400;">${row.ids.length}개</span>
                    </span>
                    <div class="lf-row-btns">
                        <button class="rb-up" title="위로">▲</button>
                        <button class="rb-dn" title="아래로">▼</button>
                        <button class="rb-del lf-rb-del" title="삭제">✕</button>
                    </div>
                `;
                // ✏️ 클릭 → 이름 span을 input으로 교체 (인라인 편집)
                item.querySelector('.lf-rb-rename').onclick = e => {
                    e.stopPropagation();
                    if (item.querySelector('.lf-row-name-inline-inp')) return;
                    const nameSpan = item.querySelector('.lf-row-item-name');
                    const inp = document.createElement('input');
                    inp.className = 'lf-row-name-inline-inp';
                    inp.value = row.label;
                    inp.placeholder = '행 이름 (선택)';
                    const finish = () => {
                        row.label = inp.value.trim();
                        save();
                        renderRowList();
                    };
                    inp.onblur = finish;
                    inp.onkeydown = e2 => {
                        e2.stopPropagation();
                        if (e2.key === 'Enter') inp.blur();
                        if (e2.key === 'Escape') { inp.value = row.label; inp.blur(); }
                    };
                    nameSpan.replaceWith(inp);
                    inp.focus(); inp.select();
                };
                item.querySelector('.rb-up').onclick = e => { e.stopPropagation(); moveRow(idx, -1); };
                item.querySelector('.rb-dn').onclick = e => { e.stopPropagation(); moveRow(idx, 1); };
                item.querySelector('.rb-del').onclick = e => {
                    e.stopPropagation();
                    const orphaned = layout.rows[idx].ids;
                    layout.rows.splice(idx, 1);
                    if (orphaned.length) {
                        if (layout.rows.length) {
                            layout.rows[0].ids = [...orphaned, ...layout.rows[0].ids];
                        } else {
                            layout.rows = [{ label: '', ids: orphaned }];
                        }
                    }
                    selIdx = Math.min(selIdx, layout.rows.length - 1);
                    save();
                    renderRowList();
                };
                item.onclick = () => { selIdx = idx; renderRowList(); };
                list.appendChild(item);
            });

            renderDual();
        }

        function moveRow(idx, dir) {
            const to = idx + dir;
            if (to < 0 || to >= layout.rows.length) return;
            [layout.rows[idx], layout.rows[to]] = [layout.rows[to], layout.rows[idx]];
            selIdx = to;
            save();
            renderRowList();
        }

        // ── 듀얼 패널 (미배치 ↔ 이 행) ──
        function renderDual() {
            const dual = document.getElementById('lf-dual');
            if (!dual) return;
            dual.innerHTML = '';

            if (selIdx < 0 || !layout.rows[selIdx]) {
                dual.innerHTML = '<div class="lf-empty-hint" style="align-self:center;flex:1;font-size:13px;">행을 선택하거나 추가하세요</div>';
                return;
            }

            const row = layout.rows[selIdx];
            const assignedAll = new Set(layout.rows.flatMap(r => r.ids));
            const unassigned = collections.filter(c => !assignedAll.has(c.id));

            dual.innerHTML = `
                <div class="lf-pane">
                    <div class="lf-pane-title">미배치 컬렉션</div>
                    <div class="lf-items-list" id="lf-unassigned"></div>
                </div>
                <div class="lf-pane" style="flex:1.4;">
                    <div class="lf-pane-title">이 행의 컬렉션</div>
                    <div class="lf-items-list" id="lf-assigned"></div>
                </div>
            `;

            // 미배치 목록
            const unassignedEl = document.getElementById('lf-unassigned');
            unassigned.forEach(col => {
                const item = document.createElement('div');
                item.className = 'lf-col-item';
                item.innerHTML = `<span class="lf-col-item-name">${_esc(col.name)}</span>
                    <button class="lf-col-action add">추가 →</button>`;
                item.querySelector('button').onclick = () => {
                    row.ids.push(col.id);
                    save();
                    renderDual();
                };
                unassignedEl.appendChild(item);
            });
            if (!unassigned.length) {
                unassignedEl.innerHTML = '<div class="lf-empty-hint">모두 배치됨</div>';
            }

            // 배치된 목록
            const assignedEl = document.getElementById('lf-assigned');
            row.ids.forEach((id, idx) => {
                const col = colMap.get(id);
                if (!col) return;
                const item = document.createElement('div');
                item.className = 'lf-col-item';

                // 색상 스와치
                const swatch = document.createElement('button');
                swatch.className = 'lf-col-swatch';
                const curColor = layout.colColors?.[id] || '';
                swatch.style.background = curColor || '#e0e0e0';
                swatch.style.borderColor = curColor || '#bbb';
                swatch.title = '색상 지정 (클릭)';
                swatch.onclick = e => {
                    e.stopPropagation();
                    const picker = document.createElement('input');
                    picker.type = 'color';
                    picker.value = curColor || '#888888';
                    picker.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none;';
                    document.body.appendChild(picker);
                    picker.oninput = ev => {
                        if (!layout.colColors) layout.colColors = {};
                        layout.colColors[id] = ev.target.value;
                        swatch.style.background = ev.target.value;
                        swatch.style.borderColor = ev.target.value;
                        save();
                    };
                    picker.onchange = () => {
                        picker.remove();
                        renderCollectionSection(); // 그리드 색상 점 즉시 반영
                    };
                    picker.click();
                };
                item.appendChild(swatch);

                const nameSpan = document.createElement('span');
                nameSpan.className = 'lf-col-item-name';
                nameSpan.textContent = col.name;
                item.appendChild(nameSpan);

                const up  = document.createElement('button');
                up.className  = 'lf-col-ord';
                up.textContent = '▲';
                up.disabled = idx === 0;
                up.title = '위로';

                const dn  = document.createElement('button');
                dn.className  = 'lf-col-ord';
                dn.textContent = '▼';
                dn.disabled = idx === row.ids.length - 1;
                dn.title = '아래로';

                const rm  = document.createElement('button');
                rm.className  = 'lf-col-action remove';
                rm.textContent = '✕';
                rm.title = '제거';

                up.onclick = () => { [row.ids[idx-1], row.ids[idx]] = [row.ids[idx], row.ids[idx-1]]; save(); renderDual(); };
                dn.onclick = () => { [row.ids[idx], row.ids[idx+1]] = [row.ids[idx+1], row.ids[idx]]; save(); renderDual(); };
                rm.onclick = () => { row.ids.splice(idx, 1); save(); renderDual(); };

                [up, dn, rm].forEach(b => item.appendChild(b));
                assignedEl.appendChild(item);
            });
            if (!row.ids.length) {
                assignedEl.innerHTML = '<div class="lf-empty-hint">비어있음</div>';
            }
        }

        renderRowList();
    }

    function _esc(s) {
        return (s || '').replace(/[&<>"']/g, c => (
            { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
        ));
    }

    // ─────────────────────────────────────────────────────────────────
    // §6. 접기/펼치기 상태 관리
    // ─────────────────────────────────────────────────────────────────

    // 작품 그리드
    function getGridCollapsed() {
        return localStorage.getItem(COLLAPSE_KEY) === 'true';
    }
    function setGridCollapsed(v) {
        localStorage.setItem(COLLAPSE_KEY, v ? 'true' : 'false');
    }

    // 컬렉션 섹션
    function getColCollapsed() {
        return localStorage.getItem(COL_COLLAPSE_KEY) === 'true';
    }
    function setColCollapsed(v) {
        localStorage.setItem(COL_COLLAPSE_KEY, v ? 'true' : 'false');
    }

    // 그리드 헤더: [좋아요한 스토리(flex:1)] [접기▲] [컬렉션 담기]
    // 검색창은 initSearchBar에서 탭 아래에 별도 삽입
    function initGridArea() {
        // ID 기반 가드 — previousElementSibling 변동으로 인한 무한 재실행 방지
        if (document.getElementById('lf-toggle-btn')) return;

        const grid = document.querySelector(GRID_SEL);
        if (!grid) return;

        // grid 이전 형제 중 h2를 포함한 헤더를 명시적으로 탐색
        // (#lf-search-bar가 중간에 삽입된 경우에도 올바른 헤더를 찾음)
        let header = grid.previousElementSibling;
        while (header && !header.querySelector('h2')) {
            header = header.previousElementSibling;
        }
        if (!header) return;

        const h2 = header.querySelector('h2');
        if (h2) h2.style.flex = '1';

        const addLink = header.querySelector('a[href*="/collections/add"]');

        // 접기 버튼
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'lf-toggle-btn';
        const collapsed = getGridCollapsed();
        toggleBtn.textContent = collapsed ? '펼치기 ▼' : '접기 ▲';
        if (collapsed) grid.style.display = 'none';
        toggleBtn.onclick = () => {
            const next = !getGridCollapsed();
            setGridCollapsed(next);
            grid.style.display = next ? 'none' : '';
            toggleBtn.textContent = next ? '펼치기 ▼' : '접기 ▲';
        };

        if (addLink) {
            addLink.insertAdjacentElement('beforebegin', toggleBtn);
        } else if (h2) {
            h2.insertAdjacentElement('afterend', toggleBtn);
        } else {
            header.appendChild(toggleBtn);
        }
    }

    // 탭 아래 고정 검색창 (항상 표시, #crk-liked-tabs 기준 sticky)
    function initSearchBar() {
        if (document.getElementById('lf-search-bar')) return;

        const crkTab = document.getElementById('crk-liked-tabs');
        if (!crkTab) return;
        const tabContainer = crkTab.closest('[dir="ltr"]') ?? crkTab.parentElement;
        if (!tabContainer) return;

        const bar = document.createElement('div');
        bar.id = 'lf-search-bar';
        bar.innerHTML = `<input type="text" id="lf-search-input" class="lf-search-input"
            placeholder="작품 제목으로 검색...">`;

        // 탭 컨테이너 바로 다음 형제로 삽입
        tabContainer.insertAdjacentElement('afterend', bar);

        // sticky top = #crk-liked-tabs의 computed top + 높이
        function updateTop() {
            const st = getComputedStyle(crkTab);
            const tabTop = parseFloat(st.top) || 0;
            bar.style.top = (tabTop + crkTab.offsetHeight) + 'px';
        }
        updateTop();
        new ResizeObserver(updateTop).observe(crkTab);

        bar.querySelector('#lf-search-input').oninput = e =>
            applySearch(e.target.value.toLowerCase().trim());
    }

    // ─────────────────────────────────────────────────────────────────
    // §9. 검색
    // ─────────────────────────────────────────────────────────────────
    function applySearch(query) {
        const grid = document.querySelector(GRID_SEL);
        if (!grid) return;

        // 검색어가 있으면 접힌 그리드 자동 펼침
        if (query && getGridCollapsed()) {
            setGridCollapsed(false);
            grid.style.display = '';
            const btn = document.getElementById('lf-toggle-btn');
            if (btn) btn.textContent = '접기 ▲';
        }

        grid.querySelectorAll(CARD_SEL).forEach(card => {
            if (!query) { card.style.display = ''; return; }
            const t = card.querySelector(TITLE_SEL)?.textContent.toLowerCase() || '';
            card.style.display = t.includes(query) ? '' : 'none';
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // §10. React Fiber → storyId 추출
    // ─────────────────────────────────────────────────────────────────
    function getIdFromFiber(el) {
        const fk = el && Object.keys(el).find(k =>
            k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
        );
        if (!fk) return null;
        let fiber = el[fk];
        let depth = 0;
        while (fiber && depth++ < 50) {
            const p = fiber.memoizedProps;
            if (p && typeof p === 'object') {
                for (const k of ['storyId', 'characterId', '_id', 'sourceId', 'id', 'contentId']) {
                    const v = p[k];
                    if (typeof v === 'string' && /^[a-f0-9]{24}$/.test(v)) return v;
                }
            }
            fiber = fiber.return;
        }
        return null;
    }

    // ─────────────────────────────────────────────────────────────────
    // §11. 컬렉션 캐시 관리
    // ─────────────────────────────────────────────────────────────────
    function addToColCache(colId, colName, storyId) {
        const key = COL_CACHE_PREFIX + colId;
        try {
            const raw = localStorage.getItem(key);
            const cache = raw ? JSON.parse(raw) : { name: colName, ids: [] };
            if (!cache.ids.includes(storyId)) {
                cache.ids.push(storyId);
                cache.name = colName;
                localStorage.setItem(key, JSON.stringify(cache));
            }
        } catch {}
    }

    // storyId → [{ colId, name, color }] 역방향 맵 생성
    function buildStoryToColMap() {
        const map = new Map();
        const layout = getLayout();
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key?.startsWith(COL_CACHE_PREFIX)) continue;
            const colId = key.slice(COL_CACHE_PREFIX.length);
            try {
                const cache = JSON.parse(localStorage.getItem(key));
                const color = layout.colColors?.[colId] || null;
                cache.ids?.forEach(sid => {
                    if (!map.has(sid)) map.set(sid, []);
                    map.get(sid).push({ colId, name: cache.name || '', color });
                });
            } catch {}
        }
        return map;
    }

    // ─────────────────────────────────────────────────────────────────
    // §12. 태그 배지 주입
    // ─────────────────────────────────────────────────────────────────
    const TAG_ATTR = 'data-lf-tag-col';

    function injectTagBadge(card, colId, colName, color) {
        if (card.querySelector(`.lf-tag-badge[${TAG_ATTR}="${colId}"]`)) return;
        const titleEl = card.querySelector(TITLE_SEL);
        if (!titleEl) return;

        let tagWrap = titleEl.nextElementSibling;
        if (!tagWrap || !tagWrap.classList.contains('lf-tag-wrap')) {
            tagWrap = document.createElement('div');
            tagWrap.className = 'lf-tag-wrap';
            titleEl.insertAdjacentElement('afterend', tagWrap);
        }
        const badge = document.createElement('span');
        badge.className = 'lf-tag-badge';
        badge.setAttribute(TAG_ATTR, colId);
        badge.textContent = colName;
        const c = color || '#888';
        badge.style.cssText = `background:${c}18;color:${c};border:1px solid ${c}40;`;
        tagWrap.appendChild(badge);
    }

    // 좋아요 페이지: 캐시 기반으로 카드에 태그 주입
    function applyTagsToLikedCards() {
        const grid = document.querySelector(GRID_SEL);
        if (!grid) return;
        const storyMap = buildStoryToColMap();
        if (!storyMap.size) return;

        grid.querySelectorAll(CARD_SEL).forEach(card => {
            if (card.dataset.lfTagged === '1') return;
            const storyId = getIdFromFiber(card);
            if (!storyId) return;
            const cols = storyMap.get(storyId);
            if (cols?.length) {
                cols.forEach(({ colId, name, color }) => injectTagBadge(card, colId, name, color));
            }
            card.dataset.lfTagged = '1';
        });
    }

    // ─────────────────────────────────────────────────────────────────
    // §13. 컬렉션 페이지 캐싱
    // ─────────────────────────────────────────────────────────────────
    const COL_CARD_SEL = 'div.grid[class*="gap-y-10"] > div[role="button"]';
    let _colPageInited = false;
    let _colPageObserver = null;

    function initCollectionPageCaching() {
        if (_colPageInited) return;

        const mp = window.location.pathname.match(/^\/collections\/([a-f0-9]{24})$/i);
        if (!mp) return;
        const colId = mp[1];

        const scrollEl = document.getElementById(`collection-${colId}-scroll`);
        const nameEl   = scrollEl?.querySelector('h1') ?? document.querySelector('h1');
        if (!nameEl) return; // DOM 미준비

        const colName = nameEl.textContent.trim();

        // ── Fetch 인터셉터: 컬렉션 아이템 API 자동 감지 (Fiber 실패 대비) ──
        if (!window._lfFetchPatched) {
            window._lfFetchPatched = true;
            const _origFetch = window.fetch;
            window.fetch = async function (...args) {
                const res = await _origFetch.apply(this, args);
                const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';
                // content-collections/{id}/anything 패턴 감지
                const fm = url.match(/content-collections\/([a-f0-9]{24})\/(\w+)/i);
                if (fm) {
                    try {
                        const clone = res.clone();
                        const json  = await clone.json();
                        const fColId = fm[1];
                        const fColNameEl = document.querySelector('h1');
                        const fColName = fColNameEl?.textContent?.trim() || '';
                        // 다양한 응답 구조 대응
                        const arr = Array.isArray(json?.data?.items) ? json.data.items
                            : Array.isArray(json?.data?.list)  ? json.data.list
                            : Array.isArray(json?.data)        ? json.data
                            : Array.isArray(json?.items)       ? json.items : [];
                        arr.forEach(item => {
                            const id = item._id || item.storyId || item.id || item.contentId;
                            if (typeof id === 'string' && /^[a-f0-9]{24}$/.test(id)) {
                                addToColCache(fColId, fColName, id);
                            }
                        });
                    } catch {}
                }
                return res;
            };
        }

        // ── Fiber 기반 카드 처리 ──
        function processCard(card) {
            if (card.dataset.lfColCached) return;
            const storyId = getIdFromFiber(card);
            if (!storyId) return;
            card.dataset.lfColCached = '1';
            addToColCache(colId, colName, storyId);
            const color = getColColor(colId);
            injectTagBadge(card, colId, colName, color);
        }

        document.querySelectorAll(COL_CARD_SEL).forEach(processCard);

        _colPageObserver?.disconnect();
        _colPageObserver = new MutationObserver(muts => {
            muts.forEach(m => m.addedNodes.forEach(n => {
                if (n.nodeType !== 1) return;
                if (n.matches?.(COL_CARD_SEL)) processCard(n);
                else n.querySelectorAll?.(COL_CARD_SEL).forEach(processCard);
            }));
        });
        const container = scrollEl ?? document.body;
        _colPageObserver.observe(container, { childList: true, subtree: true });
        _colPageInited = true;
    }

    // ─────────────────────────────────────────────────────────────────
    // §8. UI 초기화 / 정리
    // ─────────────────────────────────────────────────────────────────
    function cleanupUI() {
        document.getElementById('lf-col-section')?.remove();
        document.getElementById('lf-toggle-btn')?.remove();
        document.getElementById('lf-col-toggle-btn')?.remove();
        document.getElementById('lf-col-modal-overlay')?.remove();
        document.getElementById('lf-search-btn')?.remove();
        document.getElementById('lf-search-bar')?.remove();

        // 그리드 헤더 초기화 (h2 flex 복원)
        const grid = document.querySelector(GRID_SEL);
        if (grid) {
            let header = grid.previousElementSibling;
            while (header && !header.querySelector('h2')) {
                header = header.previousElementSibling;
            }
            if (header) {
                const h2 = header.querySelector('h2');
                if (h2) h2.style.flex = '';
            }
        }

        // 원본 캐러셀 섹션 복원
        const carouselSection = document.querySelector(CAROUSEL_SEL)?.closest('section');
        if (carouselSection) carouselSection.style.display = '';

        if (grid) {
            grid.style.display = '';
            grid.querySelectorAll(CARD_SEL).forEach(c => c.style.display = '');
        }

        lastCardCount = 0;
        colSectionBuilt = false;
        _cachedCollections = [];
    }

    // ─────────────────────────────────────────────────────────────────
    // §9. checkAndRender + MutationObserver + setInterval
    // ─────────────────────────────────────────────────────────────────
    let lastCardCount = 0;
    let colSectionBuilt = false;
    let debounceTimer = null;

    function checkAndRender() {
        if (!window.location.pathname.startsWith('/liked')) {
            cleanupUI();
            return;
        }

        // B: 컬렉션 그리드
        const carousel = document.querySelector(CAROUSEL_SEL);
        if (carousel) {
            const cols = extractCollections();
            if (!colSectionBuilt || cols.length !== _cachedCollections.length) {
                renderCollectionSection();
                colSectionBuilt = true;
            }
        }

        // C+검색: 그리드 헤더 접기 버튼 + 탭 아래 고정 검색창
        initGridArea();
        initSearchBar();

        // D: 캐시 기반 태그 주입
        applyTagsToLikedCards();

        // 카드 수 변화 감지 → 검색어 재적용
        const grid = document.querySelector(GRID_SEL);
        if (!grid) return;

        const cardCount = grid.querySelectorAll(CARD_SEL).length;
        if (cardCount !== lastCardCount) {
            lastCardCount = cardCount;
            const searchInput = document.getElementById('lf-search-input');
            if (searchInput?.value) applySearch(searchInput.value.toLowerCase().trim());
        }

        // 접기 상태 재적용 (reconciliation 리셋 방어)
        if (getGridCollapsed() && grid.style.display !== 'none') {
            grid.style.display = 'none';
        }
        const colSection = document.getElementById('lf-col-section');
        if (colSection && getColCollapsed()) {
            const rowsWrap = colSection.querySelector('.lf-col-rows');
            if (rowsWrap && rowsWrap.style.display !== 'none') {
                rowsWrap.style.display = 'none';
            }
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // 메인 루프 — SPA URL 변경을 매 tick에서 감지하여 분기
    // ─────────────────────────────────────────────────────────────────
    const COL_PAGE_RE = /^\/collections\/([a-f0-9]{24})$/i;

    function mainLoop() {
        const path = window.location.pathname;

        if (COL_PAGE_RE.test(path)) {
            // 컬렉션 내부 페이지 (직접 접근 또는 SPA 네비게이션 모두 처리)
            initCollectionPageCaching();
        } else {
            // 컬렉션 페이지에서 벗어난 경우 → 상태 리셋 (재진입 대비)
            if (_colPageInited) {
                _colPageObserver?.disconnect();
                _colPageObserver = null;
                _colPageInited = false;
                window._lfFetchPatched = false;
            }
            if (path.startsWith('/liked')) {
                checkAndRender();
            } else {
                cleanupUI();
            }
        }
    }

    const _mainObserver = new MutationObserver(() => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(mainLoop, 150);
    });
    _mainObserver.observe(document.body, { childList: true, subtree: true });
    setInterval(mainLoop, 1500);

})();
