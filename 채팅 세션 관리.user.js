// ==UserScript==
// @name         채팅 세션 관리
// @namespace    https://github.com/workforomg/Utill
// @version      3.1.12
// @description  보관함/채팅 목록 탭 분리 + 검색/메모/이어하기/이름 애니메이션 + 보관함 카테고리 통합
// @match        https://crack.wrtn.ai/*
// @grant        GM_addStyle
// @run-at       document-end
// ==/UserScript==

(function () {
    'use strict';

    /* ================================================================
       상수 / 셀렉터
    ================================================================ */
    const MEMO_KEY      = 'crack_session_memos_v1';
    const CACHE_KEY     = 'crack_session_cache_v1';
    const ANAME_KEY      = 'crack_archive_names_v1';
    const CATEGORY_KEY   = 'crack_archive_category_v1';
    const COLLAPSE_KEY   = 'crack_archive_collapse_v1';
    const COLOR_KEY       = 'crack_archive_cat_color_v1';
    const ORDER_KEY        = 'crack_archive_cat_order_v1';
    const ITEM_ORDER_KEY   = 'crack_archive_item_order_v1';
    const STALE_ENABLED_KEY = 'crack_stale_enabled_v1';
    const UNCATEGORIZED  = '미분류';

    const CAT_PALETTE = {
        red:    '#FF4432', orange: '#FF9F40', yellow: '#F5C518', green:  '#3FB66E',
        teal:   '#2BB8B0', blue:   '#3D8BFF', purple: '#9B6BFF', pink:   '#FF6FA5',
    };
    const CAT_DEFAULT_COLOR = 'red';

    const SEL_LINK     = 'a[href*="/stories/"][href*="/episodes/"]';
    const SEL_NAME     = 'span.typo-text-sm_leading-none_medium';
    const SEL_MORE_BTN = 'button[aria-label="채팅방 메뉴"]';
    const SEL_VSCROLL  = '[data-testid="virtuoso-scroller"]';
    const SEL_VLIST    = '[data-testid="virtuoso-item-list"]';
    const VROOT_CLASS  = 'crack-vlist-root';

    /* ================================================================
       0. 데이터 레이어
    ================================================================ */
    let _memCache  = null;
    let _memMemo   = null;
    let _memCategory = null;
    let _memCollapse = null;
    let _memColor    = null;
    let _memOrder    = null;
    let _memItemOrder = null;

    function _loadCache()    { try { return JSON.parse(localStorage.getItem(CACHE_KEY))    || {}; } catch { return {}; } }
    function _loadMemo()     { try { return JSON.parse(localStorage.getItem(MEMO_KEY))     || {}; } catch { return {}; } }
    function _loadCategory() { try { return JSON.parse(localStorage.getItem(CATEGORY_KEY)) || {}; } catch { return {}; } }
    function _loadCollapse() { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {}; } catch { return {}; } }
    function _loadColor()    { try { return JSON.parse(localStorage.getItem(COLOR_KEY))    || {}; } catch { return {}; } }
    function _loadOrder()    { try { return JSON.parse(localStorage.getItem(ORDER_KEY))    || []; } catch { return []; } }
    function _loadItemOrder() { try { return JSON.parse(localStorage.getItem(ITEM_ORDER_KEY)) || {}; } catch { return {}; } }

    function getCache() { if (!_memCache) _memCache = _loadCache(); return _memCache; }
    const SESSION_STALE_MS = 45 * 24 * 60 * 60 * 1000;
    const TS_UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
    function isStaleEnabled() { return localStorage.getItem(STALE_ENABLED_KEY) !== 'false'; }

    function cacheSession(href, title) {
        if (!href || !title) return;
        const c = getCache();
        if (title === '이름 없는 세션' && c[href]?.title && c[href].title !== '이름 없는 세션') return;
        const now = Date.now();
        const existing = c[href];
        const titleChanged = !existing || existing.title !== title;
        const tsOutdated = !existing?.ts || (now - existing.ts) > TS_UPDATE_INTERVAL;
        if (titleChanged || tsOutdated) {
            c[href] = { title: titleChanged ? title : existing.title, ts: now };
            localStorage.setItem(CACHE_KEY, JSON.stringify(c));
        }
    }

    function pruneNextDataDeadSession() {
        try {
            const fallback = window.__NEXT_DATA__?.props?.pageProps?.fallback;
            if (!fallback) return;
            const c = getCache();
            let changed = false;
            Object.entries(fallback).forEach(([key, val]) => {
                const m = key.match(/^\/v3\/chats\/([a-f0-9]{24})$/);
                if (!m || val?.statusCode !== 404) return;
                const chatId = m[1];
                Object.keys(c).forEach(href => {
                    if (href.endsWith(`/episodes/${chatId}`)) { delete c[href]; changed = true; }
                });
            });
            if (changed) { _memCache = c; localStorage.setItem(CACHE_KEY, JSON.stringify(c)); }
        } catch {}
    }

    function installDeleteInterceptor() {
        const _orig = window.fetch;
        window.fetch = async function(input, init) {
            const res = await _orig.apply(this, arguments);
            try {
                const url = typeof input === 'string' ? input : (input?.url || '');
                if ((init?.method || '').toUpperCase() === 'POST' && url.includes('/v3/chats/delete')) {
                    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
                    const chatIds = Array.isArray(body?.chatIds) ? body.chatIds : [];
                    if (chatIds.length) {
                        const data = await res.clone().json().catch(() => null);
                        if (data?.result === 'SUCCESS') {
                            const c = getCache();
                            let changed = false;
                            chatIds.forEach(id => {
                                Object.keys(c).forEach(href => {
                                    if (href.endsWith(`/episodes/${id}`)) { delete c[href]; changed = true; }
                                });
                            });
                            if (changed) localStorage.setItem(CACHE_KEY, JSON.stringify(c));
                        }
                    }
                }
            } catch {}
            return res;
        };
    }

    function getMemo(href)  { if (!_memMemo) _memMemo = _loadMemo(); return _memMemo[href] || ''; }
    function saveMemo(href, txt) {
        try {
            if (!_memMemo) _memMemo = _loadMemo();
            if (txt.trim()) _memMemo[href] = txt.trim(); else delete _memMemo[href];
            localStorage.setItem(MEMO_KEY, JSON.stringify(_memMemo));
        } catch {}
    }

    function getCategoryMap()  { if (!_memCategory) _memCategory = _loadCategory(); return _memCategory; }
    function saveCategoryMap(m) { _memCategory = m; localStorage.setItem(CATEGORY_KEY, JSON.stringify(m)); }
    function getCategoryOf(archiveName) { return getCategoryMap()[archiveName] || UNCATEGORIZED; }

    function getCategoryOrder() { if (!_memOrder) _memOrder = _loadOrder(); return _memOrder; }
    function saveCategoryOrder(arr) { _memOrder = arr; localStorage.setItem(ORDER_KEY, JSON.stringify(arr)); }
    function ensureCategoryInOrder(category) {
        const order = getCategoryOrder();
        if (!order.includes(category)) { order.push(category); saveCategoryOrder(order); }
    }
    function removeFromOrder(category) {
        const order = getCategoryOrder();
        const idx = order.indexOf(category);
        if (idx !== -1) { order.splice(idx, 1); saveCategoryOrder(order); }
    }
    function renameInOrder(oldName, newName) {
        const order = getCategoryOrder();
        const idx = order.indexOf(oldName);
        if (idx !== -1) order[idx] = newName; else order.push(newName);
        saveCategoryOrder(order);
    }
    function moveCategoryOrder(category, direction) {
        const order = getCategoryOrder();
        const idx = order.indexOf(category);
        if (idx === -1) return;
        const next = idx + direction;
        if (next < 0 || next >= order.length) return;
        [order[idx], order[next]] = [order[next], order[idx]];
        saveCategoryOrder(order);
    }
    function getOrderedCategories() {
        const live = new Set(getAllCategories());
        const order = getCategoryOrder();
        let changed = false;
        live.forEach(cat => { if (!order.includes(cat)) { order.push(cat); changed = true; } });
        if (changed) saveCategoryOrder(order);
        return order.filter(cat => live.has(cat));
    }

    function getItemOrderMap() { if (!_memItemOrder) _memItemOrder = _loadItemOrder(); return _memItemOrder; }
    function saveItemOrderMap(m) { _memItemOrder = m; localStorage.setItem(ITEM_ORDER_KEY, JSON.stringify(m)); }
    function getItemOrder(category) { return getItemOrderMap()[category] || []; }
    function ensureItemsInOrder(category, mountedNames) {
        const m = getItemOrderMap();
        let list = m[category] || [];
        let changed = false;
        mountedNames.forEach(n => { if (!list.includes(n)) { list.push(n); changed = true; } });
        if (category !== UNCATEGORIZED) {
            const catMap = getCategoryMap();
            const filtered = list.filter(n => catMap[n] === category);
            if (filtered.length !== list.length) changed = true;
            list = filtered;
        }
        if (changed) { m[category] = list; saveItemOrderMap(m); }
    }
    function reorderItem(category, draggedName, targetName, placeAfter) {
        const m = getItemOrderMap();
        const list = (m[category] || []).filter(n => n !== draggedName);
        let idx = list.indexOf(targetName);
        if (idx === -1) idx = list.length;
        else if (placeAfter) idx += 1;
        list.splice(idx, 0, draggedName);
        m[category] = list;
        saveItemOrderMap(m);
    }

    function setCategoryOf(archiveName, category) {
        const m = getCategoryMap();
        const trimmed = (category || '').trim();
        if (!trimmed || trimmed === UNCATEGORIZED) delete m[archiveName];
        else { m[archiveName] = trimmed; ensureCategoryInOrder(trimmed); }
        saveCategoryMap(m);
        pruneOrphanCategoryMeta();
    }
    function assignArchivesToCategory(archiveNames, category) {
        const m = getCategoryMap();
        archiveNames.forEach(name => { m[name] = category; });
        saveCategoryMap(m);
        ensureCategoryInOrder(category);
    }
    function getAllCategories() {
        const m = getCategoryMap();
        return [...new Set(Object.values(m))];
    }
    function getCategoryCounts() {
        const counts = {};
        Object.values(getCategoryMap()).forEach(cat => { counts[cat] = (counts[cat] || 0) + 1; });
        return counts;
    }
    function deleteCategory(category) {
        const m = getCategoryMap();
        Object.keys(m).forEach(name => { if (m[name] === category) delete m[name]; });
        saveCategoryMap(m);
        setCategoryColor(category, null);
        setCategoryCollapsed(category, false);
        removeFromOrder(category);
        const itemOrderMap = getItemOrderMap();
        if (itemOrderMap[category]) { delete itemOrderMap[category]; saveItemOrderMap(itemOrderMap); }
    }
    function renameCategory(oldName, newName) {
        if (!newName || newName === oldName) return;
        const m = getCategoryMap();
        Object.keys(m).forEach(name => { if (m[name] === oldName) m[name] = newName; });
        saveCategoryMap(m);
        const color = getCategoryColor(oldName);
        setCategoryColor(oldName, null);
        setCategoryColor(newName, color);
        if (isCategoryCollapsed(oldName)) { setCategoryCollapsed(oldName, false); setCategoryCollapsed(newName, true); }
        renameInOrder(oldName, newName);
        const itemOrderMap = getItemOrderMap();
        if (itemOrderMap[oldName]) {
            itemOrderMap[newName] = itemOrderMap[oldName];
            delete itemOrderMap[oldName];
            saveItemOrderMap(itemOrderMap);
        }
    }
    function pruneOrphanCategoryMeta() {
        const live = new Set(getAllCategories());
        const colorMap = getColorMap();
        let colorChanged = false;
        Object.keys(colorMap).forEach(cat => { if (!live.has(cat)) { delete colorMap[cat]; colorChanged = true; } });
        if (colorChanged) { _memColor = colorMap; localStorage.setItem(COLOR_KEY, JSON.stringify(colorMap)); }
        const collapseMap = getCollapseMap();
        let collapseChanged = false;
        Object.keys(collapseMap).forEach(cat => {
            if (cat !== UNCATEGORIZED && !live.has(cat)) { delete collapseMap[cat]; collapseChanged = true; }
        });
        if (collapseChanged) { _memCollapse = collapseMap; localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapseMap)); }
        const order = getCategoryOrder();
        const cleanedOrder = order.filter(cat => live.has(cat));
        if (cleanedOrder.length !== order.length) saveCategoryOrder(cleanedOrder);
        const itemOrderMap = getItemOrderMap();
        let itemOrderChanged = false;
        Object.keys(itemOrderMap).forEach(cat => {
            if (cat !== UNCATEGORIZED && !live.has(cat)) { delete itemOrderMap[cat]; itemOrderChanged = true; }
        });
        if (itemOrderChanged) saveItemOrderMap(itemOrderMap);
    }

    function getColorMap()  { if (!_memColor) _memColor = _loadColor(); return _memColor; }
    function getCategoryColor(category) { return getColorMap()[category] || CAT_DEFAULT_COLOR; }
    function setCategoryColor(category, colorKey) {
        const m = getColorMap();
        if (!colorKey) delete m[category]; else m[category] = colorKey;
        _memColor = m;
        localStorage.setItem(COLOR_KEY, JSON.stringify(m));
    }

    function getCollapseMap()   { if (!_memCollapse) _memCollapse = _loadCollapse(); return _memCollapse; }
    function isCategoryCollapsed(category) { return !!getCollapseMap()[category]; }
    function setCategoryCollapsed(category, collapsed) {
        const m = getCollapseMap();
        if (collapsed) m[category] = true; else delete m[category];
        _memCollapse = m;
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(m));
    }

    function cacheArchiveNames() {
        const fresh = [...document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index] button.flex.items-center ${SEL_NAME}`)].map(s => s.textContent.trim()).filter(Boolean);
        if (!fresh.length) return;
        const fromCategory = Object.keys(getCategoryMap());
        const merged = [...new Set([...fresh, ...fromCategory])];
        localStorage.setItem(ANAME_KEY, JSON.stringify(merged));
    }

    /* ================================================================
       1. 뷰 감지
    ================================================================ */
    function detectView() {
        if (document.querySelector('button[aria-label="편집 종료"]')) return 'archive-edit';
        if (document.querySelector('button[aria-label="보관함 전체보기"]')) return 'main';
        const backBtn = document.querySelector('button[aria-label="뒤로가기"]');
        if (!backBtn) return 'main';
        const titleSpan = document.querySelector('div.shrink-0.flex.items-center.gap-2.h-12 span.flex-1');
        return (titleSpan?.textContent?.trim() === '보관함') ? 'archive-list' : 'archive-inner';
    }

    /* ================================================================
       2. 유틸
    ================================================================ */
    function setArchiveListHeaderHidden(hidden) {
        const titleSpan = document.querySelector('div.shrink-0.flex.items-center.gap-2.h-12.px-2 span.flex-1');
        if (!titleSpan || titleSpan.textContent.trim() !== '보관함') return;
        const headerBar = titleSpan.closest('div.shrink-0.flex.items-center.gap-2.h-12.px-2');
        if (!headerBar) return;
        if (hidden) {
            const backBtn = headerBar.querySelector('button[aria-label="뒤로가기"]');
            if (backBtn && backBtn.style.display !== 'none') backBtn.style.display = 'none';
            if (titleSpan.style.display !== 'none') titleSpan.style.display = 'none';
            if (headerBar.style.minHeight !== '0') {
                headerBar.style.minHeight = '0';
                headerBar.style.height = '0';
                headerBar.style.overflow = 'hidden';
                headerBar.style.padding = '0';
            }
            const tabs = document.getElementById('crack-view-tabs');
            if (tabs && !tabs.querySelector('.crack-arch-menu-btn-wrapper')) {
                const archMenuBtn = headerBar.querySelector('button[aria-label="보관함 메뉴"]');
                if (archMenuBtn) {
                    const wrapper = document.createElement('span');
                    wrapper.className = 'crack-arch-menu-btn-wrapper';
                    wrapper.title = '보관함 메뉴 (새 보관함 만들기 / 편집)';
                    wrapper.appendChild(archMenuBtn);
                    tabs.appendChild(wrapper);
                }
            }
        } else {
            const backBtn = headerBar.querySelector('button[aria-label="뒤로가기"]');
            if (backBtn) backBtn.style.display = '';
            titleSpan.style.display = '';
            headerBar.style.minHeight = '';
            headerBar.style.height = '';
            headerBar.style.overflow = '';
            headerBar.style.padding = '';
            const tabs = document.getElementById('crack-view-tabs');
            const wrapper = tabs?.querySelector('.crack-arch-menu-btn-wrapper');
            if (wrapper) {
                const archMenuBtn = wrapper.querySelector('button[aria-label="보관함 메뉴"]');
                if (archMenuBtn) headerBar.appendChild(archMenuBtn);
                wrapper.remove();
            }
        }
    }

    function extractTitle(a) {
        const n = a.querySelector(SEL_NAME);
        if (n?.textContent.trim()) return n.textContent.trim();
        const img = a.querySelector('img[alt]');
        if (img?.alt.trim()) return img.alt.trim();
        return '이름 없는 세션';
    }

    const delay = ms => new Promise(r => setTimeout(r, ms));

    async function waitForEl(sel, timeout = 2000) {
        const end = Date.now() + timeout;
        while (Date.now() < end) {
            const el = document.querySelector(sel);
            if (el) return el;
            await delay(80);
        }
        return null;
    }

    /* ================================================================
       2-b. Virtuoso 스크롤러 높이 보정
            [v3.1.11] flex 레이아웃 방식으로 전환.
            GM_addStyle의 정적 CSS가 처리하므로 이 함수는 no-op.
            이전 버전에서 주입된 동적 스타일이 있다면 초기화만 수행.
    ================================================================ */
    function _getDynStyle() {
        let s = document.getElementById('crack-dyn-style');
        if (!s) {
            s = document.createElement('style');
            s.id = 'crack-dyn-style';
            document.head.appendChild(s);
        }
        return s;
    }

    let _lastScrollOffset = -1;
    let _dragState = null;
    let _dragOverEl = null;
    let _dragRafId = null;
    let _dragLastX = 0, _dragLastY = 0;

    function adjustScrollerHeight() {
        // [v3.1.11] flex 레이아웃 방식으로 대체. 동적 calc 스타일 주입 불필요.
        // 이전 버전에서 주입된 스타일이 남아있을 경우를 위해 초기화만 수행.
        if (_lastScrollOffset !== 0) {
            _getDynStyle().textContent = '';
            _lastScrollOffset = 0;
        }
    }

    /* ================================================================
       2-c. 사이드바 패널 스코프 마커
    ================================================================ */
    function markSidebarPanelRoot() {
        const root = document.querySelector('div.flex-1.min-w-0.min-h-0.overflow-hidden.pl-2')
                  || document.querySelector('div.flex-1.min-h-0.overflow-hidden.pl-2');
        if (root && !root.classList.contains(VROOT_CLASS)) root.classList.add(VROOT_CLASS);
    }

    /* ================================================================
       3. 메인 뷰: 보관함 섹션 숨김
    ================================================================ */
    function hideNativeArchiveSection() {
        const trigger = document.querySelector('button[aria-label="보관함 전체보기"]');
        if (!trigger) return;
        const headerRow = trigger.parentElement;
        const section = headerRow?.parentElement;
        if (!section) return;
        if (!section.classList.contains('flex-col') || !section.classList.contains('overflow-hidden')) return;
        section.setAttribute('data-crack-arch-section', '1');
        const divider = section.nextElementSibling;
        if (divider) divider.setAttribute('data-crack-arch-divider', '1');
        const chatHdr = divider?.nextElementSibling;
        if (chatHdr) chatHdr.setAttribute('data-crack-chat-hdr', '1');
    }

    /* ================================================================
       4. 보관함 / 채팅 목록 탭
    ================================================================ */
    function injectViewTabs() {
        const view = detectView();
        if (view !== 'main' && view !== 'archive-list') return;
        const isArchive = (view === 'archive-list');
        let tabs = document.getElementById('crack-view-tabs');
        if (tabs) {
            const archiveBtn  = tabs.querySelector('[data-tab="archive"]');
            const chatlistBtn = tabs.querySelector('[data-tab="chatlist"]');
            archiveBtn.classList.toggle('crack-tab-active', isArchive);
            chatlistBtn.classList.toggle('crack-tab-active', !isArchive);
            const catBtn = tabs.querySelector('#crack-cat-manage-btn');
            if (catBtn) catBtn.style.display = isArchive ? '' : 'none';
            return;
        }
        const inner = document.querySelector('div.flex-1.min-w-0.min-h-0.overflow-hidden.pl-2')
                   || document.querySelector('div.flex-1.min-h-0.overflow-hidden.pl-2');
        if (!inner || !inner.parentElement) return;
        tabs = document.createElement('div');
        tabs.id = 'crack-view-tabs';
        tabs.innerHTML = `
            <button class="crack-tab-btn ${isArchive ? 'crack-tab-active' : ''}" data-tab="archive">보관함</button>
            <button class="crack-tab-btn ${!isArchive ? 'crack-tab-active' : ''}" data-tab="chatlist">채팅 목록</button>
            <button type="button" id="crack-cat-manage-btn" title="카테고리 관리" style="${isArchive ? '' : 'display:none'}">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            </button>`;
        tabs.querySelector('[data-tab="archive"]').addEventListener('click', () => {
            const v = detectView();
            if (v === 'main') document.querySelector('button[aria-label="보관함 전체보기"]')?.click();
        });
        tabs.querySelector('[data-tab="chatlist"]').addEventListener('click', () => {
            const v = detectView();
            if (v === 'archive-list') document.querySelector('button[aria-label="뒤로가기"]')?.click();
        });
        tabs.querySelector('#crack-cat-manage-btn').addEventListener('click', e => {
            e.stopPropagation();
            openCategoryManageModal();
        });
        inner.parentElement.insertBefore(tabs, inner);
    }

    /* ================================================================
       5. 검색창
    ================================================================ */
    function injectSearchBar() {
        if (document.getElementById('crack-search-container')) return;
        const scroller = document.querySelector(`.${VROOT_CLASS} ${SEL_VSCROLL}`);
        if (!scroller?.parentElement) return;
        const wrap = document.createElement('div');
        wrap.id = 'crack-search-container';
        wrap.innerHTML = `
            <div id="crack-search-inner">
                <span class="crack-search-icon">🔍</span>
                <input type="text" id="crack-search-input" placeholder="검색...">
            </div>`;
        scroller.parentElement.insertBefore(wrap, scroller);
        document.getElementById('crack-search-input').addEventListener('input', e => filterSessions(e.target.value));
    }

    function filterSessions(raw) {
        const kw   = raw.toLowerCase().replace(/\s+/g, '');
        const view = detectView();
        document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index]`).forEach(wrapper => {
            if (wrapper.dataset.crackCatHide === '1') return;
            let text = '';
            if (view === 'archive-list' || view === 'archive-edit') {
                text = (wrapper.querySelector(SEL_NAME)?.textContent || '').trim().toLowerCase().replace(/\s+/g, '');
                wrapper.style.display = (!kw || text.includes(kw)) ? '' : 'none';
            } else {
                const a = wrapper.querySelector(SEL_LINK);
                if (!a) return;
                text = extractTitle(a).toLowerCase().replace(/\s+/g, '');
                const memo = getMemo(a.getAttribute('href') || '').toLowerCase().replace(/\s+/g, '');
                wrapper.style.display = (!kw || text.includes(kw) || memo.includes(kw)) ? '' : 'none';
            }
        });
        if (view === 'archive-list') {
            const visibleByCat = new Map();
            document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index]`).forEach(wrapper => {
                const name = wrapper.querySelector(SEL_NAME)?.textContent.trim();
                if (!name) return;
                const cat = getCategoryOf(name);
                if (wrapper.style.display !== 'none' && !visibleByCat.get(cat)) visibleByCat.set(cat, true);
                else if (!visibleByCat.has(cat)) visibleByCat.set(cat, false);
            });
            document.querySelectorAll('.crack-cat-header').forEach(header => {
                const hasVisible = !!visibleByCat.get(header.dataset.category);
                header.style.display = (!kw || hasVisible) ? '' : 'none';
            });
        }
    }

    /* ================================================================
       6. 보관함 카테고리: 그룹 헤더 삽입 + 접기/펼치기

       [v3.1.11] 두 가지 수정:
       A) sortedCats를 groups.keys() 대신 getOrderedCategories()로 교체.
          Virtuoso 뷰포트 밖의 카테고리(보관함 전부 언마운트 상태)도
          헤더를 올바르게 표시하기 위함.

       B) collapsed 처리를 외부 div[data-index]의 display:none에서
          내부 .relative의 display:none으로 변경.
          CSS [data-crack-cat-hide="1"] 규칙이 height:1px+overflow:hidden을 적용.
          → Virtuoso가 display:none 아이템을 0px로 측정해 data-known-size=0
            으로 저장하는 현상(이후 DOM에서 완전히 사라지는 버그)을 방지.
    ================================================================ */
    function applyArchiveCategories() {
        if (detectView() !== 'archive-list') {
            document.querySelectorAll('.crack-cat-header').forEach(el => {
                if (el.style.display !== 'none') el.style.display = 'none';
            });
            document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index]`).forEach(w => {
                if (w.dataset.crackCatHide === '1') {
                    // [v3.1.12] data attribute 삭제 → CSS 1px 규칙 자동 해제
                    // 구버전(v3.1.10/11) 인라인 스타일도 함께 정리
                    delete w.dataset.crackCatHide;
                    w.style.removeProperty('display');
                    w.querySelector('.relative')?.style.removeProperty('display');
                }
                if (w.style.order) w.style.removeProperty('order');
                if (w.classList.contains('crack-cat-tinted')) {
                    w.classList.remove('crack-cat-tinted');
                    w.style.removeProperty('--cat-color');
                }
            });
            return;
        }

        const wrappers = [...document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index]`)];
        if (!wrappers.length) return;

        const groups = new Map();
        wrappers.forEach(wrapper => {
            const name = wrapper.querySelector(SEL_NAME)?.textContent.trim();
            if (!name) return;
            const cat = getCategoryOf(name);
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push(wrapper);
        });

        groups.forEach((arr, cat) => {
            const names = arr.map(w => w.querySelector(SEL_NAME)?.textContent.trim()).filter(Boolean);
            ensureItemsInOrder(cat, names);
            const order = getItemOrder(cat);
            arr.sort((wa, wb) => {
                const na = wa.querySelector(SEL_NAME)?.textContent.trim() || '';
                const nb = wb.querySelector(SEL_NAME)?.textContent.trim() || '';
                let ia = order.indexOf(na); if (ia === -1) ia = order.length;
                let ib = order.indexOf(nb); if (ib === -1) ib = order.length;
                return ia - ib;
            });
        });

        // [v3.1.11] sortedCats: groups.keys() → getOrderedCategories()
        // Virtuoso 뷰포트 밖 카테고리도 헤더 표시를 위해 전체 라이브 카테고리 기준 사용.
        // 미분류는 현재 마운트된 항목이 있을 때만 맨 끝에 추가.
        const sortedCats = [
            ...getOrderedCategories(),
            ...(groups.has(UNCATEGORIZED) ? [UNCATEGORIZED] : []),
        ];

        const existingHeaders = new Map();
        document.querySelectorAll('.crack-cat-header').forEach(el => {
            existingHeaders.set(el.dataset.category, el);
        });

        const liveCatSet = new Set(sortedCats);
        existingHeaders.forEach((el, cat) => {
            if (!liveCatSet.has(cat) && el.style.display !== 'none') el.style.display = 'none';
        });

        const parent = wrappers[0].parentElement;
        let orderSeq = 0;
        const persistedCounts = getCategoryCounts();

        sortedCats.forEach(cat => {
            // [v3.1.11] groups.get(cat)이 undefined일 수 있음 (뷰포트 밖 카테고리)
            const items = groups.get(cat) || [];
            const collapsed = isCategoryCollapsed(cat);

            let header = existingHeaders.get(cat);
            if (!header) {
                header = document.createElement('div');
                header.className = 'crack-cat-header';
                header.dataset.category = cat;
                header.addEventListener('click', (e) => {
                    // [v3.1.12] 클릭이 Virtuoso 스크롤러까지 버블링되면
                    // 플랫폼 핸들러가 리스트를 재렌더해 깜빡임 유발 → 차단
                    e.stopPropagation();
                    setCategoryCollapsed(cat, !isCategoryCollapsed(cat));
                    applyArchiveCategories();
                    setTimeout(() => applyArchiveCategories(), 300);
                });
                parent.appendChild(header);
            } else if (header.style.display !== '') {
                header.style.display = '';
            }
            const headerOrder = String(orderSeq++);
            if (header.style.order !== headerOrder) header.style.order = headerOrder;

            const arrow = collapsed ? '▶' : '▼';
            const count = String(cat === UNCATEGORIZED ? items.length : (persistedCounts[cat] ?? items.length));
            const colorHex = cat === UNCATEGORIZED ? null : CAT_PALETTE[getCategoryColor(cat)];
            const arrowEl = header.querySelector('.cch-arrow');
            const countEl = header.querySelector('.cch-count');
            if (!arrowEl) {
                header.innerHTML = `
                    <span class="cch-arrow">${arrow}</span>
                    <span class="ccp-tag cch-tag ${cat === UNCATEGORIZED ? 'cch-tag-neutral' : ''}" style="${colorHex ? `--cat-color:${colorHex}` : ''}">${cat}</span>
                    <span class="cch-count">${count}</span>`;
            } else {
                if (arrowEl.textContent !== arrow) arrowEl.textContent = arrow;
                const tagEl = header.querySelector('.cch-tag');
                if (tagEl) {
                    if (tagEl.textContent !== cat) tagEl.textContent = cat;
                    const isNeutral = cat === UNCATEGORIZED;
                    if (tagEl.classList.contains('cch-tag-neutral') !== isNeutral) tagEl.classList.toggle('cch-tag-neutral', isNeutral);
                    const nextVar = colorHex ? `--cat-color:${colorHex}` : '';
                    if (tagEl.getAttribute('style') !== nextVar) tagEl.setAttribute('style', nextVar);
                }
                if (countEl.textContent !== count) countEl.textContent = count;
            }

            items.forEach(wrapper => {
                const itemOrder = String(orderSeq++);
                if (wrapper.style.order !== itemOrder) wrapper.style.order = itemOrder;

                if (collapsed) {
                    // [v3.1.12] data attribute만 설정 → CSS가 height:1px+overflow:hidden 자동 적용
                    // display:none(v3.1.10), inner display:none(v3.1.11)은 Virtuoso가
                    // data-known-size=0으로 기록해 DOM에서 영구 제외되는 문제를 유발.
                    wrapper.dataset.crackCatHide = '1';
                } else {
                    // [v3.1.12] data attribute 삭제 → CSS 규칙 자동 해제 → 64px 복원
                    // 구버전(v3.1.10/11) 인라인 스타일 잔재도 함께 정리
                    delete wrapper.dataset.crackCatHide;
                    wrapper.style.removeProperty('display');
                    wrapper.querySelector('.relative')?.style.removeProperty('display');
                }

                if (colorHex) {
                    if (!wrapper.classList.contains('crack-cat-tinted')) wrapper.classList.add('crack-cat-tinted');
                    if (wrapper.style.getPropertyValue('--cat-color') !== colorHex) wrapper.style.setProperty('--cat-color', colorHex);
                } else if (wrapper.classList.contains('crack-cat-tinted')) {
                    wrapper.classList.remove('crack-cat-tinted');
                    wrapper.style.removeProperty('--cat-color');
                }
            });
        });
    }

    /* ================================================================
       7-a. 커스텀 드래그
    ================================================================ */
    function findDropWrapper(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        const wrapper = el.closest('div[data-index]');
        if (!wrapper || !wrapper.closest(`.${VROOT_CLASS}`)) return null;
        return wrapper;
    }
    function clearDragHighlight() {
        if (_dragOverEl) {
            _dragOverEl.classList.remove('crack-drop-before', 'crack-drop-after');
            _dragOverEl = null;
        }
    }
    function updateDragHighlight(x, y) {
        if (!_dragState) return;
        const wrapper = findDropWrapper(x, y);
        const targetName = wrapper?.querySelector(SEL_NAME)?.textContent.trim();
        if (!wrapper || !targetName || targetName === _dragState.name || getCategoryOf(targetName) !== _dragState.cat) {
            clearDragHighlight();
            return;
        }
        if (_dragOverEl && _dragOverEl !== wrapper) _dragOverEl.classList.remove('crack-drop-before', 'crack-drop-after');
        _dragOverEl = wrapper;
        const rect = wrapper.getBoundingClientRect();
        const after = (y - rect.top) > rect.height / 2;
        wrapper.classList.toggle('crack-drop-before', !after);
        wrapper.classList.toggle('crack-drop-after', after);
        wrapper.dataset.crackDropAfter = after ? '1' : '0';
    }
    function onDragMouseMove(e) {
        _dragLastX = e.clientX;
        _dragLastY = e.clientY;
        if (_dragRafId) return;
        _dragRafId = requestAnimationFrame(() => { _dragRafId = null; updateDragHighlight(_dragLastX, _dragLastY); });
    }
    function onDragMouseUp(e) {
        document.removeEventListener('mousemove', onDragMouseMove);
        document.removeEventListener('mouseup', onDragMouseUp, true);
        if (_dragRafId) { cancelAnimationFrame(_dragRafId); _dragRafId = null; }
        document.body.classList.remove('crack-dragging-active');
        const dragged = _dragState;
        _dragState = null;
        dragged?.sourceWrapper?.classList.remove('crack-dragging');
        const wrapper = findDropWrapper(e.clientX, e.clientY);
        clearDragHighlight();
        if (!dragged || !wrapper) return;
        const targetName = wrapper.querySelector(SEL_NAME)?.textContent.trim();
        if (!targetName || targetName === dragged.name) return;
        if (getCategoryOf(targetName) !== dragged.cat) return;
        reorderItem(dragged.cat, dragged.name, targetName, wrapper.dataset.crackDropAfter === '1');
        applyArchiveCategories();
    }
    function startDrag(wrapper, e) {
        e.preventDefault();
        const liveName = wrapper.querySelector(SEL_NAME)?.textContent.trim();
        if (!liveName) return;
        _dragState = { name: liveName, cat: getCategoryOf(liveName), sourceWrapper: wrapper };
        wrapper.classList.add('crack-dragging');
        document.body.classList.add('crack-dragging-active');
        document.addEventListener('mousemove', onDragMouseMove);
        document.addEventListener('mouseup', onDragMouseUp, true);
    }

    /* ================================================================
       7-b. 보관함 목록/편집 뷰: 카테고리 지정 버튼 + 드래그 핸들
    ================================================================ */
    function injectMoveButtons() {
        document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index]`).forEach(wrapper => {
            const relDiv = wrapper.querySelector('.relative');
            const absDiv = wrapper.querySelector('.absolute.top-3.right-3');
            if (!relDiv || !absDiv) return;
            if (absDiv.style.display !== 'flex') {
                absDiv.style.display = 'flex';
                absDiv.style.alignItems = 'center';
                absDiv.style.gap = '2px';
            }
            if (!absDiv.querySelector('.crack-move-btn')) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'crack-move-btn';
                btn.title = '카테고리 지정';
                btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="14" height="14"><path d="M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>`;
                btn.addEventListener('click', e => {
                    e.preventDefault(); e.stopPropagation();
                    const liveName = wrapper.querySelector(SEL_NAME)?.textContent.trim();
                    if (!liveName) return;
                    openCategoryAssignModal(liveName);
                });
                absDiv.insertBefore(btn, absDiv.firstChild);
            }
            if (!relDiv.querySelector('.crack-drag-handle')) {
                const handle = document.createElement('span');
                handle.className = 'crack-drag-handle';
                handle.title = '드래그해서 같은 카테고리 내 순서 변경';
                handle.textContent = '⠿';
                handle.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
                handle.addEventListener('mousedown', e => { e.stopPropagation(); startDrag(wrapper, e); });
                relDiv.insertBefore(handle, relDiv.firstChild);
            }
        });
    }

    function openCategoryAssignModal(archiveName) {
        document.getElementById('crack-move-modal')?.remove();
        const curCat = getCategoryOf(archiveName);
        const existingCats = getOrderedCategories();
        const modal = document.createElement('div');
        modal.id = 'crack-move-modal';
        modal.innerHTML = `
            <div class="cmove-box">
                <div class="cmove-header">
                    <span>🏷 카테고리 지정</span>
                    <span class="cmove-target">"${archiveName}"</span>
                </div>
                <div class="cmove-list">
                    <div class="cmove-item ${curCat === UNCATEGORIZED ? 'cmove-active' : ''}" data-cat="">
                        ⬜ ${UNCATEGORIZED}
                    </div>
                    ${existingCats.map(c => `
                        <div class="cmove-item ${curCat === c ? 'cmove-active' : ''}" data-cat="${c}">
                            🏷 ${c}
                        </div>`).join('')}
                    ${!existingCats.length ? `<div class="cmove-empty-hint">아직 카테고리가 없습니다. 상단의 "카테고리 관리"에서 먼저 만들어주세요.</div>` : ''}
                </div>
                <div class="cmove-footer">
                    <button id="cmove-cancel" class="cmove-btn">취소</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const assign = cat => { setCategoryOf(archiveName, cat); modal.remove(); applyArchiveCategories(); };
        modal.querySelectorAll('.cmove-item').forEach(item => item.addEventListener('click', () => assign(item.dataset.cat)));
        modal.querySelector('#cmove-cancel').onclick = () => modal.remove();
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    /* ================================================================
       8-b. 카테고리 관리 모달
    ================================================================ */
    function openCategoryManageModal() {
        document.getElementById('crack-catmgr-modal')?.remove();
        const existingCats = getOrderedCategories();
        const counts = getCategoryCounts();
        const visibleArchives = [...document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index]`)].map(w => w.querySelector(SEL_NAME)?.textContent.trim()).filter(Boolean);
        const staleOn = isStaleEnabled();
        const modal = document.createElement('div');
        modal.id = 'crack-catmgr-modal';
        modal.innerHTML = `
            <div class="cmove-box">
                <div class="cmove-header"><span>🏷 카테고리 관리</span></div>
                <div class="cmove-scroll-body">
                    ${existingCats.length ? `
                    <div class="ccm-section">
                        <div class="ccm-section-title">카테고리 목록</div>
                        <div class="ccm-cat-list">
                            ${existingCats.map((c, i) => `
                                <div class="ccm-cat-row" data-cat="${c}">
                                    <button type="button" class="ccm-color-dot" data-cat="${c}" style="--cat-color:${CAT_PALETTE[getCategoryColor(c)]}" title="색상 변경"></button>
                                    <input type="text" class="ccm-cat-name-input" value="${c}" data-orig="${c}">
                                    <span class="ccm-cat-count">${counts[c] || 0}개</span>
                                    <button type="button" class="csub-btn ccm-order-btn ccm-order-up" data-cat="${c}" title="위로" ${i === 0 ? 'disabled' : ''}>▲</button>
                                    <button type="button" class="csub-btn ccm-order-btn ccm-order-down" data-cat="${c}" title="아래로" ${i === existingCats.length - 1 ? 'disabled' : ''}>▼</button>
                                    <button type="button" class="csub-btn ccm-del-btn" data-cat="${c}">삭제</button>
                                </div>
                                <div class="cce-palette ccm-palette-row" data-cat="${c}" style="display:none">
                                    ${Object.entries(CAT_PALETTE).map(([key, hex]) => `
                                        <button type="button" class="cce-swatch ${key === getCategoryColor(c) ? 'cce-swatch-active' : ''}" data-color="${key}" style="--swatch-color:${hex}" title="${key}"></button>`).join('')}
                                </div>`).join('')}
                        </div>
                    </div>` : ''}
                    <div class="ccm-section">
                        <div class="ccm-section-title">새 카테고리 만들기</div>
                        <input type="text" class="csub-input" id="ccm-new-name" placeholder="카테고리 이름...">
                        <div class="ccm-archive-list" id="ccm-archive-list">
                            ${visibleArchives.length ? visibleArchives.map(name => `
                                <label class="ccm-archive-item">
                                    <input type="checkbox" value="${name}">
                                    <span>${name}</span>
                                </label>`).join('') : `<div class="ccm-empty">현재 화면에 보이는 보관함이 없습니다. 스크롤 후 다시 열어주세요.</div>`}
                        </div>
                        <button class="csub-btn csub-btn-primary" id="ccm-create-btn" style="width:100%">카테고리 생성</button>
                    </div>
                    <div class="ccm-section">
                        <div class="ccm-section-title">이어하기 목록 설정</div>
                        <div class="csm-setting-row">
                            <span class="csm-setting-label">오래된 세션 자동 제외 (45일 미접근)</span>
                            <button type="button" class="csm-toggle" id="csm-stale-toggle" data-on="${staleOn}">${staleOn ? 'ON' : 'OFF'}</button>
                        </div>
                        <div class="csm-setting-desc">비활성화 시 45일 이상 사이드바에서 확인되지 않은 세션도 이어하기 목록에 유지됩니다. 잘못 남은 항목은 픽커의 ✕ 버튼으로 수동 제거할 수 있습니다.</div>
                    </div>
                </div>
                <div class="cmove-footer">
                    <button id="ccm-cancel" class="cmove-btn">닫기</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const onKey = e => { if (e.key === 'Escape') close(); };
        function close() { document.removeEventListener('keydown', onKey); modal.remove(); }
        document.addEventListener('keydown', onKey);
        modal.querySelectorAll('.ccm-cat-name-input').forEach(input => {
            input.addEventListener('blur', () => {
                const row = input.closest('.ccm-cat-row');
                const oldName = input.dataset.orig;
                const newName = input.value.trim();
                if (newName === oldName) return;
                if (!newName) { input.value = oldName; return; }
                if (newName === UNCATEGORIZED) { alert(`"${UNCATEGORIZED}"는 예약된 이름이라 사용할 수 없습니다.`); input.value = oldName; return; }
                if (getAllCategories().includes(newName)) { alert('이미 존재하는 카테고리 이름입니다.'); input.value = oldName; return; }
                renameCategory(oldName, newName);
                input.dataset.orig = newName;
                row.dataset.cat = newName;
                row.querySelector('.ccm-color-dot').dataset.cat = newName;
                row.querySelector('.ccm-del-btn').dataset.cat = newName;
                if (row.nextElementSibling?.classList.contains('ccm-palette-row')) row.nextElementSibling.dataset.cat = newName;
                applyArchiveCategories();
            });
            input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
        });
        modal.querySelectorAll('.ccm-color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                const palette = dot.closest('.ccm-cat-row').nextElementSibling;
                const willOpen = palette.style.display === 'none';
                modal.querySelectorAll('.ccm-palette-row').forEach(p => { p.style.display = 'none'; });
                if (willOpen) palette.style.display = '';
            });
        });
        modal.querySelectorAll('.ccm-palette-row').forEach(palette => {
            const row = palette.previousElementSibling;
            palette.querySelectorAll('.cce-swatch').forEach(swatch => {
                swatch.addEventListener('click', () => {
                    const colorKey = swatch.dataset.color;
                    setCategoryColor(palette.dataset.cat, colorKey);
                    const dot = row?.querySelector('.ccm-color-dot');
                    if (dot) dot.style.setProperty('--cat-color', CAT_PALETTE[colorKey]);
                    palette.querySelectorAll('.cce-swatch').forEach(b => b.classList.toggle('cce-swatch-active', b === swatch));
                    palette.style.display = 'none';
                    applyArchiveCategories();
                });
            });
        });
        modal.querySelectorAll('.ccm-del-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cat = btn.dataset.cat;
                if (!confirm(`"${cat}" 카테고리를 삭제하고 소속 보관함을 ${UNCATEGORIZED}로 되돌릴까요?`)) return;
                deleteCategory(cat); applyArchiveCategories(); close(); openCategoryManageModal();
            });
        });
        modal.querySelectorAll('.ccm-order-up').forEach(btn => {
            btn.addEventListener('click', () => { moveCategoryOrder(btn.dataset.cat, -1); applyArchiveCategories(); close(); openCategoryManageModal(); });
        });
        modal.querySelectorAll('.ccm-order-down').forEach(btn => {
            btn.addEventListener('click', () => { moveCategoryOrder(btn.dataset.cat, 1); applyArchiveCategories(); close(); openCategoryManageModal(); });
        });
        modal.querySelector('#ccm-create-btn').onclick = () => {
            const name = modal.querySelector('#ccm-new-name').value.trim();
            if (!name) { modal.querySelector('#ccm-new-name').focus(); return; }
            if (name === UNCATEGORIZED) { alert(`"${UNCATEGORIZED}"는 예약된 이름이라 사용할 수 없습니다.`); return; }
            if (getAllCategories().includes(name)) { alert('이미 존재하는 카테고리 이름입니다. 기존 카테고리에 추가하려면 보관함 카드의 "카테고리 지정" 버튼을 이용해주세요.'); return; }
            const checked = [...modal.querySelectorAll('.ccm-archive-item input:checked')].map(i => i.value);
            if (!checked.length) { alert('카테고리에 배정할 보관함을 1개 이상 선택해주세요.'); return; }
            assignArchivesToCategory(checked, name); applyArchiveCategories(); close(); openCategoryManageModal();
        };
        modal.querySelector('#csm-stale-toggle')?.addEventListener('click', function() {
            const next = this.dataset.on !== 'true';
            localStorage.setItem(STALE_ENABLED_KEY, String(next));
            this.dataset.on = String(next);
            this.textContent = next ? 'ON' : 'OFF';
        });
        modal.querySelector('#ccm-cancel').onclick = close;
        modal.onclick = e => { if (e.target === modal) close(); };
    }

    /* ================================================================
       10. 메모 UI
    ================================================================ */
    function injectMemoUI() {
        document.querySelectorAll(SEL_LINK).forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;
            const t = extractTitle(link);
            if (t && t !== '이름 없는 세션') cacheSession(href, t);
        });
        let hadNew = false;
        document.querySelectorAll(`${SEL_LINK}:not([data-crack-memo])`).forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;
            const title = extractTitle(link);
            cacheSession(href, title);
            const moreBtn = link.querySelector(SEL_MORE_BTN);
            if (!moreBtn) return;
            const titleRow = moreBtn.parentElement;
            if (!titleRow.querySelector('.crack-memo-btn')) {
                const memoBtn = document.createElement('button');
                memoBtn.className = 'crack-memo-btn';
                memoBtn.setAttribute('type', 'button');
                memoBtn.title = '메모';
                memoBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="14" height="14"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
                memoBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openMemoModal(href); });
                titleRow.insertBefore(memoBtn, moreBtn);
            }
            const contentArea = link.querySelector('div[class*="flex-col"][class*="flex-1"]');
            if (contentArea && !contentArea.querySelector('.crack-memo-preview')) {
                const preview = document.createElement('div');
                preview.className = 'crack-memo-preview';
                preview.dataset.memoHref = href;
                preview.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openMemoModal(href); });
                contentArea.appendChild(preview);
            }
            if (title !== '이름 없는 세션') {
                link.setAttribute('data-crack-memo', '1');
                hadNew = true;
            } else {
                const retries = parseInt(link.getAttribute('data-crack-memo-retry') || '0', 10);
                if (retries >= 5) link.setAttribute('data-crack-memo', '1');
                else link.setAttribute('data-crack-memo-retry', String(retries + 1));
            }
        });
        if (hadNew) refreshPreviews();
        injectNameAnimation();
    }

    function refreshPreviews() {
        document.querySelectorAll('.crack-memo-preview').forEach(el => {
            const text = getMemo(el.dataset.memoHref);
            const next = text ? '📝 ' + text : '';
            if (el.textContent !== next) el.textContent = next;
            const disp = text ? 'block' : 'none';
            if (el.style.display !== disp) el.style.display = disp;
        });
    }

    /* ================================================================
       11. 이름 팝업 & 애니메이션
    ================================================================ */
    function injectNameAnimation() {
        document.querySelectorAll(`${SEL_LINK} ${SEL_NAME}:not([data-crack-anim])`).forEach(span => {
            span.setAttribute('data-crack-anim', '1');
            requestAnimationFrame(() => {
                const sw = span.scrollWidth, cw = span.clientWidth;
                if (sw > cw) {
                    span.classList.add('crack-can-animate');
                    span.style.setProperty('--crack-move-dist', `${(sw - cw + 7) * -1}px`);
                    if (!span.hasAttribute('title')) span.setAttribute('title', span.textContent.trim());
                } else {
                    span.classList.remove('crack-can-animate');
                    span.style.removeProperty('--crack-move-dist');
                }
            });
        });
    }

    /* ================================================================
       12. 이어하기 인터셉트
    ================================================================ */
    function getSessionsForStory(storyId) {
        const pattern = `/stories/${storyId}/episodes/`;
        const seen = new Set(), results = [];
        const domTitles = new Map();
        document.querySelectorAll(`a[href*="${pattern}"]`).forEach(a => {
            const h = a.getAttribute('href');
            if (!h) return;
            domTitles.set(h, extractTitle(a));
        });
        const pageStoryTitle = document.querySelector(`a[href="/detail/${storyId}"] p`)?.textContent?.trim() || null;
        Object.entries(getCache()).forEach(([href, info]) => {
            if (!href.includes(pattern) || seen.has(href)) return;
            const isStale = isStaleEnabled() && info.ts && !domTitles.has(href) && (Date.now() - info.ts) > SESSION_STALE_MS;
            if (isStale) return;
            seen.add(href);
            const domTitle = domTitles.get(href);
            let name = info.title || href.split('/').pop();
            if (domTitle && domTitle !== '이름 없는 세션') { if (name !== domTitle) cacheSession(href, domTitle); name = domTitle; }
            else if (name === '이름 없는 세션' && pageStoryTitle) { cacheSession(href, pageStoryTitle); name = pageStoryTitle; }
            results.push({ href, name });
        });
        domTitles.forEach((name, href) => { if (!seen.has(href)) { seen.add(href); results.push({ href, name }); } });
        return results;
    }

    function interceptContinueButtons() {
        document.querySelectorAll('a:not([data-csp-done]), button:not([data-csp-done])').forEach(el => {
            if ((el.innerText || el.textContent || '').trim() !== '이어하기') return;
            el.setAttribute('data-csp-done', '1');
            el.addEventListener('click', e => {
                let storyId = null, m;
                m = (el.getAttribute('href') || '').match(/\/stories\/([^/?#]+)/);
                if (m) storyId = m[1];
                if (!storyId) {
                    let node = el.parentElement;
                    while (node && node !== document.body) {
                        m = (node.getAttribute?.('href') || '').match(/\/stories\/([^/?#]+)/);
                        if (m) { storyId = m[1]; break; }
                        const ds = node.dataset?.storyId || node.dataset?.story;
                        if (ds) { storyId = ds; break; }
                        node = node.parentElement;
                    }
                }
                if (!storyId) { m = window.location.pathname.match(/\/stories\/([^/?#]+)/); if (m) storyId = m[1]; }
                if (!storyId) { m = window.location.pathname.match(/\/detail\/([^/?#]+)/);  if (m) storyId = m[1]; }
                if (!storyId) return;
                const sessions = getSessionsForStory(storyId);
                if (sessions.length <= 1) return;
                e.preventDefault(); e.stopPropagation();
                openSessionPickerModal(sessions);
            }, true);
        });
    }

    /* ================================================================
       13. 메모 모달
    ================================================================ */
    function openMemoModal(href) {
        document.getElementById('crack-memo-modal')?.remove();
        const current = getMemo(href);
        const title   = getCache()[href]?.title || href;
        const modal   = document.createElement('div');
        modal.id      = 'crack-memo-modal';
        modal.innerHTML = `
            <div class="cmemo-box">
                <div class="cmemo-header">
                    <span class="cmemo-icon">📝</span>
                    <span class="cmemo-title" title="${title}">${title}</span>
                </div>
                <textarea id="cmemo-ta" placeholder="이 세션에 대한 메모를 입력하세요...">${current}</textarea>
                <div class="cmemo-footer">
                    <button id="cmemo-del" class="cmemo-btn cmemo-btn-danger" ${current ? '' : 'style="display:none"'}>삭제</button>
                    <div style="flex:1"></div>
                    <button id="cmemo-cancel" class="cmemo-btn">취소</button>
                    <button id="cmemo-save" class="cmemo-btn cmemo-btn-primary">저장</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        const ta = modal.querySelector('#cmemo-ta');
        ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
        modal.querySelector('#cmemo-save').onclick   = () => { saveMemo(href, ta.value); refreshPreviews(); modal.remove(); };
        modal.querySelector('#cmemo-cancel').onclick = () => modal.remove();
        modal.querySelector('#cmemo-del').onclick    = () => { if (confirm('메모를 삭제하시겠습니까?')) { saveMemo(href, ''); refreshPreviews(); modal.remove(); } };
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    /* ================================================================
       14. 이어하기 세션 선택 모달
    ================================================================ */
    function openSessionPickerModal(sessions) {
        document.getElementById('crack-picker-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'crack-picker-modal';
        modal.innerHTML = `
            <div class="csp-box">
                <div class="csp-header">
                    <span class="csp-icon">▶</span>
                    <span class="csp-title">이어할 세션을 선택하세요</span>
                    <span class="csp-count">${sessions.length}개</span>
                </div>
                <div class="csp-list">
                    ${sessions.map(s => {
                        const memo = getMemo(s.href);
                        return `<a class="csp-item" href="${s.href}">
                                    <div class="csp-item-body">
                                        <span class="csp-name">${s.name}</span>
                                        ${memo ? `<span class="csp-memo">📝 ${memo.length > 30 ? memo.slice(0,30)+'…' : memo}</span>` : ''}
                                    </div>
                                    <span class="csp-del" title="목록에서 제거">✕</span>
                                </a>`;
                    }).join('')}
                </div>
                <div class="csp-footer"><button class="csp-btn" id="csp-cancel">취소</button></div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('.csp-item').forEach(a => {
            a.addEventListener('click', e => {
                if (e.target.closest('.csp-del')) {
                    e.preventDefault(); e.stopPropagation();
                    const c = getCache();
                    delete c[a.getAttribute('href')];
                    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
                    a.remove();
                    const countEl = modal.querySelector('.csp-count');
                    if (countEl) countEl.textContent = `${modal.querySelectorAll('.csp-item').length}개`;
                    return;
                }
                e.preventDefault(); modal.remove(); window.location.href = a.getAttribute('href');
            });
        });
        modal.querySelector('#csp-cancel').onclick = () => modal.remove();
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    /* ================================================================
       15. 메인 루프
    ================================================================ */
    let _lastView = null;

    function tick() {
        const view = detectView();
        const viewChanged = (view !== _lastView);
        _lastView = view;

        markSidebarPanelRoot();

        if (viewChanged) {
            if (view === 'main') {
                hideNativeArchiveSection();
                injectViewTabs();
                injectSearchBar();
                setArchiveListHeaderHidden(false);
                _lastScrollOffset = -1;
                _getDynStyle().textContent = '';
                document.querySelector(`.${VROOT_CLASS}`)?.classList.remove('crack-arch-view');

            } else if (view === 'archive-list') {
                cacheArchiveNames();
                injectViewTabs();
                injectSearchBar();
                injectMoveButtons();
                applyArchiveCategories();
                setArchiveListHeaderHidden(true);
                _lastScrollOffset = -1;
                document.querySelector(`.${VROOT_CLASS}`)?.classList.add('crack-arch-view');

            } else if (view === 'archive-edit') {
                cacheArchiveNames();
                document.getElementById('crack-view-tabs')?.remove();
                document.getElementById('crack-search-container')?.remove();
                injectMoveButtons();
                setArchiveListHeaderHidden(false);
                _lastScrollOffset = -1;
                _getDynStyle().textContent = '';
                document.querySelector(`.${VROOT_CLASS}`)?.classList.remove('crack-arch-view');

            } else if (view === 'archive-inner') {
                document.getElementById('crack-view-tabs')?.remove();
                injectSearchBar();
                setArchiveListHeaderHidden(false);
                _lastScrollOffset = -1;
                document.querySelector(`.${VROOT_CLASS}`)?.classList.remove('crack-arch-view');
            }
        } else {
            if (view === 'archive-edit' || view === 'archive-list') injectMoveButtons();
            if (view === 'archive-list') { applyArchiveCategories(); setArchiveListHeaderHidden(true); }
        }

        injectMemoUI();
        interceptContinueButtons();
        adjustScrollerHeight();
    }

    setTimeout(() => setInterval(tick, 5000), 500);

    let _debounce = null;
    new MutationObserver(mutations => {
        // ── 빠른 경로 (v3.1.12): 새로 마운트된 Virtuoso 아이템에 즉시 접기 적용 ──
        // 250ms 디바운스를 기다리지 않고, 같은 프레임 안에서 data attribute를 설정.
        // CSS가 height:1px을 즉시 적용해 짧은 "보관함이 나왔다가 사라지는" 깜빡임 방지.
        if (detectView() === 'archive-list') {
            mutations.forEach(m => {
                m.addedNodes.forEach(node => {
                    if (node.nodeType !== 1 || !node.hasAttribute?.('data-index')) return;
                    if (node.dataset.crackCatHide === '1') return; // 이미 처리됨
                    const name = node.querySelector?.(SEL_NAME)?.textContent.trim();
                    if (!name) return;
                    const cat = getCategoryOf(name);
                    if (cat !== UNCATEGORIZED && isCategoryCollapsed(cat)) {
                        node.dataset.crackCatHide = '1'; // CSS가 즉시 1px 적용
                    }
                });
            });
        }

        // ── 일반 디바운스 경로 ──
        const allInternal = mutations.every(m =>
            m.target.closest?.('#crack-memo-modal')    ||
            m.target.closest?.('#crack-picker-modal')  ||
            m.target.closest?.('#crack-move-modal')    ||
            m.target.closest?.('#crack-catmgr-modal')  ||
            m.target.closest?.('#crack-search-container') ||
            m.target.classList?.contains('crack-cat-header')
        );
        if (allInternal) return;
        clearTimeout(_debounce);
        _debounce = setTimeout(() => { _lastView = null; tick(); }, 250);
    }).observe(document.body, { childList: true, subtree: true });

    installDeleteInterceptor();
    pruneNextDataDeadSession();
    tick();

    /* ================================================================
       16. 스타일
    ================================================================ */
    GM_addStyle(`
        /* ── 보관함 섹션 강제 숨김 ── */
        [data-crack-arch-section]  { display: none !important; }
        [data-crack-arch-divider]  { display: none !important; }
        [data-crack-chat-hdr]      { display: none !important; }

        /* ── 이름 애니메이션 ── */
        ${SEL_NAME} {
            display: inline-block !important;
            max-width: 100%;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            transition: transform 0.3s;
        }
        ${SEL_NAME}.crack-can-animate:hover {
            text-overflow: clip !important;
            overflow: visible !important;
            animation: crack-name-scroll 5s linear infinite;
            padding-right: 50px;
            position: relative; z-index: 1;
        }
        @keyframes crack-name-scroll {
            0%   { transform: translateX(0); }
            45%  { transform: translateX(var(--crack-move-dist)); }
            55%  { transform: translateX(var(--crack-move-dist)); }
            100% { transform: translateX(0); }
        }

        /* ── 뷰 탭 ── */
        #crack-view-tabs {
            display: flex;
            flex-shrink: 0;
            border-bottom: 1px solid var(--border, rgba(128,128,128,0.2));
        }
        .crack-tab-btn {
            flex: 1; padding: 8px 4px;
            border: none; background: transparent;
            color: var(--muted-foreground, #888);
            font-size: 13px; font-weight: 600; cursor: pointer;
            border-bottom: 2px solid transparent;
            margin-bottom: -1px;
            transition: color .15s, border-color .15s;
        }
        .crack-tab-btn:hover { color: var(--foreground, #eee); }
        .crack-tab-active { color: var(--primary, #FF4432) !important; border-bottom-color: var(--primary, #FF4432) !important; }

        /* ── 검색창 ── */
        #crack-search-container {
            display: flex; flex-shrink: 0;
            padding: 6px 8px;
            border-bottom: 1px solid var(--border, rgba(128,128,128,0.15));
        }
        #crack-search-inner {
            display: flex; align-items: center; width: 100%;
            background: rgba(128,128,128,0.1);
            border-radius: 6px; padding: 4px 8px;
            border: 1px solid transparent; transition: border-color .2s;
        }
        #crack-search-inner:focus-within { border-color: var(--primary, #FF4432); }
        #crack-search-input {
            border: none; background: none; outline: none;
            color: inherit; font-size: 13px; width: 100%; margin-left: 4px;
        }
        .crack-search-icon { font-size: 12px; opacity: .55; flex-shrink: 0; }

        /* ── Virtuoso 스크롤러 높이 보정 v2: flex 방식 (v3.1.11) ── */
        /* crack-vlist-root를 flex 컬럼으로 전환해 스크롤러가              */
        /* 검색창 아래 나머지 공간을 flex:1로 차지하게 함.                 */
        /* calc+!important 방식의 타이밍 레이스 및 스크롤 bounce 제거.     */
        .${VROOT_CLASS} {
            display: flex !important;
            flex-direction: column !important;
        }
        .${VROOT_CLASS} > #crack-search-container {
            flex-shrink: 0 !important;
        }
        .${VROOT_CLASS} > [data-testid="virtuoso-scroller"] {
            flex: 1 1 0 !important;
            height: auto !important;   /* Virtuoso 인라인 height:100% 재정의 */
            min-height: 0 !important;
        }

        /* ── 보관함 collapsed 아이템: 1px 슬림 처리 (v3.1.12) ── */
        /* display:none 대신 height:1px+overflow:hidden 사용.              */
        /* → Virtuoso가 data-known-size를 1px로 기록 (0px 아님)            */
        /* → DOM에서 제외되지 않아 expand 시 즉시 복원 가능                */
        /* → 시각적으로는 1px 미만의 공백이어서 사실상 보이지 않음          */
        .${VROOT_CLASS}.crack-arch-view ${SEL_VLIST} > div[data-crack-cat-hide="1"] {
            height: 1px !important;
            min-height: 0 !important;
            overflow: hidden !important;
        }

        /* ── 메모 버튼 ── */
        .crack-memo-btn {
            display: inline-flex !important;
            align-items: center; justify-content: center;
            width: 1rem; height: 1rem; flex-shrink: 0;
            background: none; border: none; cursor: pointer;
            color: var(--icon_tertiary, currentColor);
            opacity: 0; transition: opacity .15s; padding: 0;
        }
        a:hover .crack-memo-btn, .crack-memo-btn:hover { opacity: 1 !important; }

        /* ── 메모 미리보기 ── */
        .crack-memo-preview {
            display: none; font-size: 11px; line-height: 1.4;
            color: var(--muted-foreground, #999);
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            width: 100%; cursor: pointer;
        }

        /* ── 편집 뷰 카테고리 지정 버튼 ── */
        .crack-move-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 16px; height: 16px;
            background: none; border: none; cursor: pointer;
            color: var(--line_gray_2, #888);
            border-radius: 3px; opacity: .5;
            transition: opacity .15s, background .15s;
        }
        .crack-move-btn:hover { opacity: 1; background: var(--accent, rgba(128,128,128,0.15)); }

        /* ── 카테고리 지정 모달 ── */
        #crack-move-modal, #crack-catmgr-modal {
            position: fixed; inset: 0;
            background: rgba(0,0,0,.55);
            display: flex; align-items: center; justify-content: center;
            z-index: 99999;
        }
        .cmove-box {
            background: var(--surface_secondary, #FFFFFF);
            color: var(--text_primary, #eee);
            border-radius: 12px; width: 360px; max-width: 93vw; max-height: 70vh;
            display: flex; flex-direction: column;
            box-shadow: 0 12px 32px rgba(0,0,0,.7);
            border: 1px solid rgba(255,255,255,.08); overflow: hidden;
        }
        .cmove-header {
            display: flex; align-items: center; gap: 8px;
            padding: 14px 16px; font-size: 14px; font-weight: 700;
            border-bottom: 1px solid rgba(255,255,255,.08); flex-shrink: 0;
        }
        .cmove-target { opacity: .7; font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cmove-list   { flex: 1; overflow-y: auto; padding: 6px 0; }
        .cmove-item   {
            padding: 10px 16px; cursor: pointer; font-size: 13px;
            transition: background .12s;
            border-bottom: 1px solid rgba(255,255,255,.04);
        }
        .cmove-item:last-child { border-bottom: none; }
        .cmove-item:hover  { background: rgba(255,255,255,.07); }
        .cmove-active      { color: var(--primary, #FF4432); font-weight: 600; }
        .cmove-footer { padding: 10px 16px; border-top: 1px solid rgba(255,255,255,.08); flex-shrink: 0; display: flex; justify-content: flex-end; }
        .cmove-btn {
            padding: 6px 16px; border-radius: 6px;
            border: 1px solid rgba(255,255,255,.15);
            background: rgba(255,255,255,.06); color: inherit;
            font-size: 13px; cursor: pointer;
        }
        .cmove-btn:hover { background: rgba(255,255,255,.12); }

        /* ── 메모 모달 ── */
        #crack-memo-modal {
            position: fixed; inset: 0; background: rgba(0,0,0,.55);
            display: flex; align-items: center; justify-content: center;
            z-index: 99999;
        }
        .cmemo-box {
            background: #e8e8e8; color: #2a2a2a;
            border-radius: 12px; padding: 20px;
            width: 420px; max-width: 92vw;
            display: flex; flex-direction: column; gap: 14px;
            box-shadow: 0 12px 32px rgba(0,0,0,.6);
        }
        .cmemo-header { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
        .cmemo-icon   { font-size: 18px; flex-shrink: 0; }
        .cmemo-title  { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .75; }
        #cmemo-ta {
            width: 100%; min-height: 120px; max-height: 300px; resize: vertical;
            padding: 10px 12px; border: 1px solid rgba(0,0,0,.5); border-radius: 8px;
            background: #e8e8e8; color: #1e1e1e; font-size: 13px; line-height: 1.6;
            box-sizing: border-box; outline: none; font-family: inherit;
        }
        #cmemo-ta:focus { border-color: #FF4432; }
        #cmemo-ta::placeholder { color: rgba(0,0,0,.4); }
        .cmemo-footer { display: flex; gap: 8px; align-items: center; }
        .cmemo-btn { padding: 7px 14px; border-radius: 6px; border: 1px solid rgba(0,0,0,.4); background: transparent; color: #1e1e1e; font-size: 13px; cursor: pointer; }
        .cmemo-btn:hover         { background: rgba(0,0,0,.07); }
        .cmemo-btn-primary       { background: #FF4432; color: #fff; border-color: #FF4432; }
        .cmemo-btn-primary:hover { background: #e03a29; }
        .cmemo-btn-danger        { color: #ff6b6b; border-color: rgba(255,59,48,.4); }
        .cmemo-btn-danger:hover  { background: rgba(255,59,48,.1); }

        /* ── 이어하기 모달 ── */
        #crack-picker-modal {
            position: fixed; inset: 0; background: rgba(0,0,0,.6);
            display: flex; align-items: center; justify-content: center;
            z-index: 99999;
        }
        .csp-box {
            background: var(--surface_secondary, #1e1e1e); color: var(--text_primary, #eee);
            border-radius: 14px; width: 440px; max-width: 93vw; max-height: 72vh;
            display: flex; flex-direction: column;
            box-shadow: 0 16px 48px rgba(0,0,0,.7);
            border: 1px solid rgba(255,255,255,.08); overflow: hidden;
        }
        .csp-header {
            display: flex; align-items: center; gap: 8px;
            padding: 16px 18px 14px;
            border-bottom: 1px solid rgba(255,255,255,.08);
            font-size: 14px; font-weight: 700; flex-shrink: 0;
        }
        .csp-icon { color: #FF4432; flex-shrink: 0; }
        .csp-title { flex: 1; }
        .csp-count { font-size: 11px; font-weight: normal; opacity: .5; }
        .csp-list  { flex: 1; overflow-y: auto; padding: 6px 0; }
        .csp-item  {
            display: flex; flex-direction: row; align-items: center;
            padding: 11px 18px; text-decoration: none; color: inherit; cursor: pointer;
            transition: background .12s; border-bottom: 1px solid rgba(255,255,255,.04);
        }
        .csp-item:last-child { border-bottom: none; }
        .csp-item:hover { background: rgba(150,150,150,.07); }
        .csp-item-body { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
        .csp-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .csp-memo { font-size: 11px; color: var(--muted-foreground, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .csp-del {
            flex-shrink: 0; margin-left: 8px;
            padding: 4px 7px; font-size: 13px; line-height: 1;
            color: var(--muted-foreground, #888); border-radius: 5px; cursor: pointer;
            opacity: 0; transition: opacity .15s, background .15s, color .15s;
        }
        .csp-item:hover .csp-del { opacity: .55; }
        .csp-del:hover { opacity: 1 !important; background: rgba(255,68,50,.1); color: #FF4432; }
        .csp-footer { display: flex; justify-content: flex-end; padding: 12px 18px; border-top: 1px solid rgba(255,255,255,.08); flex-shrink: 0; }
        .csp-btn { padding: 7px 18px; border-radius: 7px; border: 1px solid rgba(255,255,255,.15); background: rgba(255,255,255,.06); color: inherit; font-size: 13px; cursor: pointer; }
        .csp-btn:hover { background: rgba(255,255,255,.12); }

        /* ── 카테고리 지정 모달: 카테고리가 하나도 없을 때 안내문 ── */
        .cmove-empty-hint {
            padding: 14px 16px; font-size: 12px; line-height: 1.5;
            color: var(--muted-foreground, #888); text-align: center;
        }
        .csub-input {
            flex: 1; padding: 6px 8px; border-radius: 6px;
            border: 1px solid rgba(0,0,0,.18);
            background: rgba(0,0,0,.04); color: inherit;
            font-size: 13px; outline: none;
        }
        .csub-input:focus { border-color: var(--primary, #FF4432); }
        .csub-input::placeholder { color: rgba(0,0,0,.35); }
        .csub-btn {
            padding: 6px 12px; border-radius: 6px;
            border: 1px solid rgba(0,0,0,.18);
            background: rgba(0,0,0,.04); color: inherit;
            font-size: 13px; cursor: pointer; white-space: nowrap;
            transition: background .12s;
        }
        .csub-btn:hover { background: rgba(0,0,0,.08); }
        .csub-btn-primary { background: var(--primary, #FF4432) !important; border-color: var(--primary, #FF4432) !important; color: #000 !important; }
        .csub-btn-primary:hover { background: #ffaea6 !important; }
        .ccm-order-btn { padding: 4px 7px; font-size: 11px; line-height: 1; }
        .ccm-order-btn:disabled { opacity: .3; cursor: default; }
        .ccm-order-btn:disabled:hover { background: rgba(0,0,0,.04); }

        /* ── 카테고리 관리 모달: 이어하기 설정 ── */
        .csm-setting-row {
            display: flex; align-items: center; justify-content: space-between;
            padding: 8px 0; gap: 12px;
        }
        .csm-setting-label { font-size: 13px; flex: 1; line-height: 1.4; }
        .csm-setting-desc {
            font-size: 11px; line-height: 1.5;
            color: var(--muted-foreground, #888);
            margin-top: 2px;
        }
        .csm-toggle {
            flex-shrink: 0; padding: 4px 12px; border-radius: 12px;
            border: 1px solid rgba(128,128,128,.3);
            background: rgba(128,128,128,.08); color: var(--muted-foreground, #888);
            font-size: 12px; font-weight: 600; cursor: pointer;
            transition: background .15s, color .15s, border-color .15s;
            min-width: 44px; text-align: center;
        }
        .csm-toggle[data-on="true"] {
            background: rgba(255,68,50,.12);
            border-color: var(--primary, #FF4432);
            color: var(--primary, #FF4432);
        }

        /* ── 드래그 핸들 ── */
        .crack-drag-handle {
            position: absolute;
            left: 0; top: 0; bottom: 0;
            width: 14px;
            display: flex; align-items: center; justify-content: center;
            cursor: grab;
            opacity: 0;
            font-size: 11px; line-height: 1;
            color: var(--text_primary, #222);
            user-select: none; flex-shrink: 0;
            border-radius: 4px 0 0 4px;
            transition: opacity .12s, background .12s;
            z-index: 1;
        }
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index] .relative:hover .crack-drag-handle { opacity: .55; }
        .crack-drag-handle:hover { opacity: 1 !important; background: rgba(0,0,0,.06); }
        .crack-drag-handle:active { cursor: grabbing; }
        body.crack-dragging-active { cursor: grabbing !important; user-select: none !important; }
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index].crack-dragging .relative { opacity: .35; }
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index].crack-drop-before .relative,
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index].crack-drop-after  .relative {
            outline: 2px solid var(--primary, #3D8BFF);
            outline-offset: -1px;
            border-radius: 8px;
        }
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index].crack-drop-before .relative::before,
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index].crack-drop-after  .relative::after {
            content: '';
            position: absolute; left: 4px; right: 4px; height: 3px;
            background: var(--primary, #3D8BFF);
            border-radius: 2px;
            pointer-events: none;
            z-index: 10;
        }
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index].crack-drop-before .relative::before { top: -2px; }
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index].crack-drop-after  .relative::after  { bottom: -2px; }
        .crack-arch-menu-btn-wrapper {
            margin-left: auto;
            display: flex; align-items: center;
        }
        .crack-arch-menu-btn-wrapper button { opacity: .7; }
        .crack-arch-menu-btn-wrapper button:hover { opacity: 1; }

        /* ── 상단 탭 옆 카테고리 관리 버튼 ── */
        #crack-cat-manage-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 22px; height: 22px; margin-left: 2px;
            background: none; border: none; cursor: pointer;
            color: var(--line_gray_2, #888); border-radius: 5px;
            opacity: .65; transition: opacity .15s, background .15s;
        }
        #crack-cat-manage-btn:hover { opacity: 1; background: var(--accent, rgba(128,128,128,0.15)); }

        /* ── 카테고리 관리 모달 ── */
        .cmove-scroll-body { flex: 1; overflow-y: auto; padding-top: 4px; }
        .ccm-section { padding: 4px 16px 12px; }
        .ccm-section-title {
            font-size: 11px; font-weight: 600; letter-spacing: .04em;
            color: var(--muted-foreground, #888); text-transform: uppercase;
            margin-bottom: 6px;
        }
        .ccm-archive-list {
            max-height: 160px; overflow-y: auto; margin-top: 8px;
            border: 1px solid rgba(255,255,255,.1); border-radius: 8px;
        }
        .ccm-archive-item {
            display: flex; align-items: center; gap: 8px;
            padding: 7px 10px; font-size: 13px; cursor: pointer;
            border-bottom: 1px solid rgba(255,255,255,.06);
        }
        .ccm-archive-item:last-child { border-bottom: none; }
        .ccm-archive-item:hover { background: rgba(255,255,255,.05); }
        .ccm-archive-item input { flex-shrink: 0; }
        .ccm-archive-item span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .ccm-empty { padding: 14px 10px; font-size: 12px; color: var(--muted-foreground, #888); text-align: center; }

        /* ── 카테고리 목록 행 ── */
        .ccm-cat-list { display: flex; flex-direction: column; gap: 2px; }
        .ccm-cat-row  { display: flex; align-items: center; gap: 8px; padding: 3px 0; }
        .ccm-color-dot {
            width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0;
            border: none; padding: 0; cursor: pointer;
            background: var(--cat-color, #999);
            box-shadow: 0 0 0 2px rgba(255,255,255,.12);
        }
        .ccm-cat-name-input {
            flex: 1; min-width: 0; padding: 5px 8px; border-radius: 6px;
            border: 1px solid transparent; background: transparent; color: inherit;
            font-size: 13px; font-family: inherit; outline: none;
            transition: background .12s, border-color .12s;
        }
        .ccm-cat-name-input:hover, .ccm-cat-name-input:focus {
            background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.15);
        }
        .ccm-cat-count { font-size: 11px; opacity: .55; white-space: nowrap; flex-shrink: 0; }
        .ccm-palette-row { padding: 0 0 8px 24px; }

        /* ── 카테고리 색상 태그 ── */
        .ccp-tag {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 10px; border-radius: 14px;
            background: rgba(255,68,50,.16);
            background: color-mix(in srgb, var(--cat-color, #FF4432) 16%, transparent);
            color: var(--cat-color, #FF4432);
            font-size: 12px; font-weight: 500;
        }

        /* ── 보관함 카테고리 그룹 헤더 ── */
        .${VROOT_CLASS}.crack-arch-view ${SEL_VLIST} { display: flex !important; flex-direction: column !important; }
        .crack-cat-header {
            display: flex; align-items: center; gap: 8px;
            padding: 8px 12px; cursor: pointer; user-select: none;
            font-size: 12px; font-weight: 600;
            color: var(--muted-foreground, #999);
            border-bottom: 1px solid rgba(128,128,128,.1);
            transition: background .12s;
        }
        .crack-cat-header:hover { background: rgba(128,128,128,.08); }
        .cch-arrow { font-size: 10px; width: 12px; text-align: center; flex-shrink: 0; }
        .cch-tag { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cch-tag-neutral {
            background: rgba(128,128,128,.14) !important;
            color: var(--muted-foreground, #999) !important;
        }
        .cch-count {
            font-size: 11px; opacity: .6; font-weight: normal;
            background: rgba(128,128,128,.15); border-radius: 10px; padding: 1px 7px;
        }
        .crack-cat-tinted {
            background: rgba(255,68,50,.06);
            background: color-mix(in srgb, var(--cat-color, transparent) 6%, transparent);
        }

        /* ── 색상 팔레트 ── */
        .cce-palette { display: flex; gap: 8px; flex-wrap: wrap; }
        .cce-swatch {
            width: 26px; height: 26px; border-radius: 50%;
            border: 2px solid transparent; cursor: pointer;
            background: var(--swatch-color); padding: 0;
            transition: border-color .12s, transform .12s;
        }
        .cce-swatch:hover { transform: scale(1.08); }
        .cce-swatch-active { border-color: #fff; box-shadow: 0 0 0 2px rgba(255,255,255,.3); }
        .cmove-btn-primary { background: var(--primary, #FF4432) !important; border-color: var(--primary, #FF4432) !important; color: #fff !important; }
        .cmove-btn-primary:hover { background: #e03a29 !important; }
    `);

})();
