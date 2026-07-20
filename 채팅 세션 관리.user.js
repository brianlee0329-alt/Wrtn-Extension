// ==UserScript==
// @name         채팅 세션 관리
// @namespace    https://github.com/workforomg/Utill
// @version      3.1.3
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
    const ANAME_KEY      = 'crack_archive_names_v1';   // 보관함 이름 캐시 (string[])
    const CATEGORY_KEY   = 'crack_archive_category_v1'; // {보관함이름: 카테고리명}
    const COLLAPSE_KEY   = 'crack_archive_collapse_v1'; // {카테고리명: boolean(접힘여부)}
    const COLOR_KEY       = 'crack_archive_cat_color_v1'; // {카테고리명: 팔레트색상키}
    const ORDER_KEY        = 'crack_archive_cat_order_v1'; // [카테고리명, ...] 표시 순서(영속)
    const ITEM_ORDER_KEY   = 'crack_archive_item_order_v1'; // {카테고리명: [보관함이름, ...]} 카테고리 내부 순서(영속)
    const UNCATEGORIZED  = '미분류';

    // 카테고리 색상 팔레트 (8색 고정 테마)
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
    // [v3.1.2] data-testid="virtuoso-item-list" / "virtuoso-scroller"는 플랫폼
    // 전역에서 재사용되는 값이라(예: 보관함 이동 모달의 내부 라디오 리스트도 동일
    // testid를 가짐), 이 값을 그대로 전역 CSS 셀렉터로 쓰면 사이드바 밖의 다른
    // Virtuoso 인스턴스에도 그대로 적용돼버린다. 스크립트가 실제로 관리하는
    // 사이드바 리스트 패널에만 마커 클래스를 부여하고, 레이아웃에 영향을 주는
    // CSS는 전부 이 클래스로 스코프한다.
    const VROOT_CLASS  = 'crack-vlist-root';

    /* ================================================================
       0. 데이터 레이어
       GC 최적화 (v3.1.0):
         localStorage를 직접 읽는 JSON.parse()는 호출마다 신규 객체를 생성해
         V8 Young Gen을 소진시키는 주요 원인이었음.
         → 인메모리 캐시(_mem*)를 두고 write 시에만 갱신하는 write-through
           방식으로 전환. tick() 루프 내 JSON.parse 호출 횟수를 대폭 감소.
    ================================================================ */

    // ── 인메모리 캐시 ────────────────────────────────────────────────
    // null = 아직 로드되지 않음 (lazy init). write 시 갱신, 외부에서 직접 접근 금지.
    let _memCache  = null;   // crack_session_cache_v1
    let _memMemo   = null;   // crack_session_memos_v1
    let _memCategory = null; // crack_archive_category_v1
    let _memCollapse = null; // crack_archive_collapse_v1
    let _memColor    = null; // crack_archive_cat_color_v1
    let _memOrder    = null; // crack_archive_cat_order_v1
    let _memItemOrder = null; // crack_archive_item_order_v1

    function _loadCache()    { try { return JSON.parse(localStorage.getItem(CACHE_KEY))    || {}; } catch { return {}; } }
    function _loadMemo()     { try { return JSON.parse(localStorage.getItem(MEMO_KEY))     || {}; } catch { return {}; } }
    function _loadCategory() { try { return JSON.parse(localStorage.getItem(CATEGORY_KEY)) || {}; } catch { return {}; } }
    function _loadCollapse() { try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || {}; } catch { return {}; } }
    function _loadColor()    { try { return JSON.parse(localStorage.getItem(COLOR_KEY))    || {}; } catch { return {}; } }
    function _loadOrder()    { try { return JSON.parse(localStorage.getItem(ORDER_KEY))    || []; } catch { return []; } }
    function _loadItemOrder() { try { return JSON.parse(localStorage.getItem(ITEM_ORDER_KEY)) || {}; } catch { return {}; } }

    // ── 세션 캐시 ───────────────────────────────────────────────────
    function getCache() { if (!_memCache) _memCache = _loadCache(); return _memCache; }
    function cacheSession(href, title) {
        if (!href || !title) return;
        const c = getCache();
        // [v3.1.3] 버그 A 수정: "이름 없는 세션"으로 유효한 기존 제목을 덮어쓰지 않음.
        // Virtuoso 초기 렌더 시 span.typo-text-sm_leading-none_medium 이 DOM에
        // 존재하지만 React 수화(hydration) 전이라 textContent가 비어있는 타이밍에
        // injectMemoUI가 실행되면 extractTitle이 "이름 없는 세션"을 반환한다.
        // 이 값이 유효한 기존 캐시 제목을 덮어쓰는 것을 원천 차단.
        if (title === '이름 없는 세션' && c[href]?.title && c[href].title !== '이름 없는 세션') return;
        if (!c[href] || c[href].title !== title) {
            c[href] = { title, ts: Date.now() };
            localStorage.setItem(CACHE_KEY, JSON.stringify(c));
            // _memCache는 이미 c와 동일 참조이므로 별도 갱신 불필요
        }
    }

    // ── 메모 ────────────────────────────────────────────────────────
    function getMemo(href)  { if (!_memMemo) _memMemo = _loadMemo(); return _memMemo[href] || ''; }
    function saveMemo(href, txt) {
        try {
            if (!_memMemo) _memMemo = _loadMemo();
            if (txt.trim()) _memMemo[href] = txt.trim(); else delete _memMemo[href];
            localStorage.setItem(MEMO_KEY, JSON.stringify(_memMemo));
        } catch {}
    }

    // ── 보관함 카테고리 ─────────────────────────────────────────────
    function getCategoryMap()  { if (!_memCategory) _memCategory = _loadCategory(); return _memCategory; }
    function saveCategoryMap(m) { _memCategory = m; localStorage.setItem(CATEGORY_KEY, JSON.stringify(m)); }
    function getCategoryOf(archiveName) { return getCategoryMap()[archiveName] || UNCATEGORIZED; }
    // ── 카테고리 표시 순서 ───────────────────────────────────────────
    // [v3.1.0] 그룹 헤더의 시각적 순서를 "현재 DOM에 마운트된 항목의 등장
    // 순서"에서 뽑아내던 기존 방식은, Virtuoso가 접기/펼치기로 바뀐 높이에
    // 따라 매번 다른 부분집합을 마운트하면서 등장 순서 자체가 흔들려 카테고리
    // 위치가 펼침/접음마다 달라지는 원인이었음. 이제는 순서를 별도로 영속
    // 저장해 DOM 마운트 상태와 무관하게 고정시킨다.
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
    // 카테고리 목록을 위/아래로 한 칸 이동 (카테고리 관리 모달의 ▲▼용)
    function moveCategoryOrder(category, direction) {
        const order = getCategoryOrder();
        const idx = order.indexOf(category);
        if (idx === -1) return;
        const next = idx + direction;
        if (next < 0 || next >= order.length) return;
        [order[idx], order[next]] = [order[next], order[idx]];
        saveCategoryOrder(order);
    }
    // 살아있는(보관함이 1개 이상 배정된) 카테고리를, 영속 표시 순서(getCategoryOrder)
    // 기준으로 정렬해 반환. 순서 목록에 아직 없는 카테고리는 끝에 등록.
    // 카테고리 관리 모달의 목록 표기가 사이드바 실제 표시 순서와 어긋나지
    // 않도록 getAllCategories() 대신 이걸 쓴다.
    function getOrderedCategories() {
        const live = new Set(getAllCategories());
        const order = getCategoryOrder();
        let changed = false;
        live.forEach(cat => { if (!order.includes(cat)) { order.push(cat); changed = true; } });
        if (changed) saveCategoryOrder(order);
        return order.filter(cat => live.has(cat));
    }

    // ── 카테고리 내부 보관함 표시 순서 ───────────────────────────────
    // 플랫폼이 보관함을 "최근 진입 순"으로 재배열하는 탓에, 카테고리 내부
    // 항목 순서를 DOM 등장 순서에서 그대로 뽑으면 보관함을 열고 나올 때마다
    // 흔들린다. 카테고리 표시 순서(ORDER_KEY)와 동일한 원리로, 항목 순서도
    // 이름 기준으로 별도 영속시켜 DOM/플랫폼 순서와 무관하게 고정한다.
    function getItemOrderMap() { if (!_memItemOrder) _memItemOrder = _loadItemOrder(); return _memItemOrder; }
    function saveItemOrderMap(m) { _memItemOrder = m; localStorage.setItem(ITEM_ORDER_KEY, JSON.stringify(m)); }
    function getItemOrder(category) { return getItemOrderMap()[category] || []; }
    // 현재 마운트된 항목 중 순서 목록에 없는 이름을 끝에 추가.
    // [중요] Virtuoso는 항상 일부만 마운트하므로, "지금 안 보인다"는 이유로
    // 순서 목록에서 빼면 안 됨(화면 밖에 있을 뿐인 항목이 잘려나가는 버그).
    // 그래서 정리(prune)는 DOM 마운트 여부가 아니라 영속 데이터인
    // getCategoryMap()의 실제 배정 현황을 기준으로만 한다 — 다른 카테고리로
    // 재배정되거나 카테고리가 삭제된 경우에만 안전하게 제거됨.
    // 미분류는 "배정 안 됨"이 곧 멤버십이라 별도 영속 전체 목록이 없으므로,
    // 오삭제 방지를 위해 추가만 하고 정리는 하지 않는다.
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
    // 드래그 드롭 결과 반영: draggedName을 같은 카테고리 내 targetName 앞으로 이동
    // 드래그 드롭 결과 반영: draggedName을 같은 카테고리 내 targetName 앞/뒤로 이동
    // (placeAfter=false → before, true → after. 커서가 targetName 카드의
    // 위쪽/아래쪽 절반 중 어디 있었는지로 결정됨 — injectMoveButtons 참고)
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
    // 여러 보관함을 한꺼번에 새/기존 카테고리로 배정 (카테고리 생성 모달용)
    function assignArchivesToCategory(archiveNames, category) {
        const m = getCategoryMap();
        archiveNames.forEach(name => { m[name] = category; });
        saveCategoryMap(m);
        ensureCategoryInOrder(category);
    }
    // 현재 데이터에 등장하는 모든 카테고리명 (미분류 제외, 등록 순서 유지)
    function getAllCategories() {
        const m = getCategoryMap();
        return [...new Set(Object.values(m))];
    }
    // 카테고리별 배정된 보관함 수 (localStorage 누적 데이터 기준 — 현재 화면에
    // 렌더링됐는지와 무관하게 정확한 총 개수를 보여주기 위해 DOM 대신 이 값을 사용)
    function getCategoryCounts() {
        const counts = {};
        Object.values(getCategoryMap()).forEach(cat => { counts[cat] = (counts[cat] || 0) + 1; });
        return counts;
    }
    // 카테고리를 통째로 삭제하고 소속 보관함을 미분류로 환원 + 색상/접힘/순서 메타 정리
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
    // 카테고리 이름 변경: 소속 보관함 매핑 + 색상 + 접힘 상태 + 표시 순서를 모두 새 이름으로 이전
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
    // 보관함이 0개로 줄어든 카테고리의 색상/접힘/순서 메타데이터를 정리 (고아 데이터 방지)
    function pruneOrphanCategoryMeta() {
        const live = new Set(getAllCategories());
        const colorMap = getColorMap();
        let colorChanged = false;
        Object.keys(colorMap).forEach(cat => {
            if (!live.has(cat)) { delete colorMap[cat]; colorChanged = true; }
        });
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

    // ── 카테고리 색상 ───────────────────────────────────────────────
    function getColorMap()  { if (!_memColor) _memColor = _loadColor(); return _memColor; }
    function getCategoryColor(category) { return getColorMap()[category] || CAT_DEFAULT_COLOR; }
    function setCategoryColor(category, colorKey) {
        const m = getColorMap();
        if (!colorKey) delete m[category]; else m[category] = colorKey;
        _memColor = m;
        localStorage.setItem(COLOR_KEY, JSON.stringify(m));
    }

    // ── 카테고리 접기/펼치기 상태 ───────────────────────────────────
    function getCollapseMap()   { if (!_memCollapse) _memCollapse = _loadCollapse(); return _memCollapse; }
    function isCategoryCollapsed(category) { return !!getCollapseMap()[category]; }
    function setCategoryCollapsed(category, collapsed) {
        const m = getCollapseMap();
        if (collapsed) m[category] = true; else delete m[category];
        _memCollapse = m;
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(m));
    }

    // 보관함 이름 캐시 — archive-list/edit 뷰의 보관함 버튼에서만 수집
    // 보관함 이름 캐시(ANAME_KEY)는 향후 디버깅/마이그레이션 대비용으로 계속 기록만 함
    function cacheArchiveNames() {
        // 보관함 버튼(button.flex.items-center.gap-2)의 이름만 수집 (채팅 세션 a 태그 제외)
        const fresh = [...document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index] button.flex.items-center ${SEL_NAME}`)]
            .map(s => s.textContent.trim()).filter(Boolean);
        if (!fresh.length) return;
        // 카테고리가 이미 지정된 보관함 이름도 포함하여 유지 (검색 등에서 누락 방지)
        const fromCategory = Object.keys(getCategoryMap());
        const merged = [...new Set([...fresh, ...fromCategory])];
        localStorage.setItem(ANAME_KEY, JSON.stringify(merged));
    }

    /* ================================================================
       1. 뷰 감지 (5종)
    ================================================================ */
    function detectView() {
        // 편집 종료 버튼이 있으면 편집 모드 (가장 먼저 체크)
        if (document.querySelector('button[aria-label="편집 종료"]')) return 'archive-edit';
        // 보관함 전체보기 버튼이 있으면 메인 뷰
        if (document.querySelector('button[aria-label="보관함 전체보기"]')) return 'main';
        // 뒤로가기가 없으면 메인 (fallback)
        const backBtn = document.querySelector('button[aria-label="뒤로가기"]');
        if (!backBtn) return 'main';
        // 헤더 타이틀로 전체 보관함 / 개별 보관함 구분
        const titleSpan = document.querySelector('div.shrink-0.flex.items-center.gap-2.h-12 span.flex-1');
        return (titleSpan?.textContent?.trim() === '보관함') ? 'archive-list' : 'archive-inner';
    }

    /* ================================================================
       2. 유틸
    ================================================================ */
    // 전체 보관함(archive-list) 화면 상단 헤더에서 뒤로가기 버튼+타이틀만 숨김.
    // [v3.2.1] 헤더 바 전체를 display:none 처리하면 '보관함 메뉴'(⋮ → 새 보관함
    // 만들기/편집) 버튼까지 같이 사라지는 버그가 있었음. 대신 헤더 내부의
    // 뒤로가기 버튼과 '보관함' 타이틀 텍스트 노드만 숨기고, 우측 메뉴 버튼은
    // 우리 탭 바(#crack-view-tabs) 오른쪽으로 재배치해서 계속 접근 가능하게 한다.
    function setArchiveListHeaderHidden(hidden) {
        const titleSpan = document.querySelector('div.shrink-0.flex.items-center.gap-2.h-12.px-2 span.flex-1');
        if (!titleSpan || titleSpan.textContent.trim() !== '보관함') return;
        const headerBar = titleSpan.closest('div.shrink-0.flex.items-center.gap-2.h-12.px-2');
        if (!headerBar) return;
        if (hidden) {
            // 뒤로가기 + 타이틀 스팬만 숨김
            const backBtn = headerBar.querySelector('button[aria-label="뒤로가기"]');
            if (backBtn && backBtn.style.display !== 'none') backBtn.style.display = 'none';
            if (titleSpan.style.display !== 'none') titleSpan.style.display = 'none';
            // 헤더 바 자체의 높이를 0으로 눌러 공간 낭비 없앰
            if (headerBar.style.minHeight !== '0') {
                headerBar.style.minHeight = '0';
                headerBar.style.height = '0';
                headerBar.style.overflow = 'hidden';
                headerBar.style.padding = '0';
            }
            // 보관함 메뉴 버튼을 탭 바로 이식 — 이미 이식된 경우 skip
            const tabs = document.getElementById('crack-view-tabs');
            if (tabs && !tabs.querySelector('.crack-arch-menu-btn-wrapper')) {
                const archMenuBtn = headerBar.querySelector('button[aria-label="보관함 메뉴"]');
                if (archMenuBtn) {
                    const wrapper = document.createElement('span');
                    wrapper.className = 'crack-arch-menu-btn-wrapper';
                    wrapper.title = '보관함 메뉴 (새 보관함 만들기 / 편집)';
                    // cloneNode 없이 원본을 직접 이식 — Radix 이벤트 리스너가 그대로 살아있어야 드롭다운이 작동함
                    wrapper.appendChild(archMenuBtn);
                    tabs.appendChild(wrapper);
                }
            }
        } else {
            // 복구: 뒤로가기/타이틀 다시 표시, 헤더 바 높이 원복
            const backBtn = headerBar.querySelector('button[aria-label="뒤로가기"]');
            if (backBtn) backBtn.style.display = '';
            titleSpan.style.display = '';
            headerBar.style.minHeight = '';
            headerBar.style.height = '';
            headerBar.style.overflow = '';
            headerBar.style.padding = '';
            // 탭 바에 이식된 wrapper가 있으면 메뉴 버튼을 헤더 바로 되돌림
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
            검색창·자식 패널이 scroller 앞에 삽입되면
            Virtuoso의 inline "height:100%" 와 합산되어 넘침.
            CSS !important 로 calc(100% - Npx) 를 강제 적용.
            (CSS specificity: 동적 stylesheet !important > 인라인 style)
            GC 최적화 (v3.1.0):
              매 tick마다 getBoundingClientRect()를 호출하면 레이아웃 강제
              계산(forced reflow)이 발생. 이전 offset 값을 캐싱해 변화가
              없을 때 스타일 쓰기를 완전히 생략.
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

    let _lastScrollOffset = -1; // 이전 offset 캐시 (-1 = 초기화되지 않음)
    let _dragState = null; // 카테고리 내부 순서 드래그 중인 보관함 정보 {name, cat, sourceWrapper}
    let _dragOverEl = null; // 현재 강조 표시 중인 타겟 wrapper (전체 쿼리 없이 O(1) 정리용)
    let _dragRafId = null; // mousemove 히트테스트 rAF 쓰로틀 id
    let _dragLastX = 0, _dragLastY = 0; // rAF 콜백에서 사용할 최신 커서 좌표

    /* ================================================================
       2-c. 사이드바 패널 스코프 마커
            [v3.1.2] injectViewTabs()가 사이드바 본문을 찾을 때 쓰는 것과
            동일한 셀렉터로 "스크립트가 실제로 관리하는 영역"을 식별해
            VROOT_CLASS를 부여. 이미 들어있으면 classList.add는 사실상
            no-op이므로 매 tick 호출해도 추가 비용은 미미함.
    ================================================================ */
    function markSidebarPanelRoot() {
        const root = document.querySelector('div.flex-1.min-w-0.min-h-0.overflow-hidden.pl-2')
                  || document.querySelector('div.flex-1.min-h-0.overflow-hidden.pl-2');
        if (root && !root.classList.contains(VROOT_CLASS)) root.classList.add(VROOT_CLASS);
    }

    function adjustScrollerHeight() {
        const scroller = document.querySelector(`.${VROOT_CLASS} ${SEL_VSCROLL}`);
        if (!scroller) {
            if (_lastScrollOffset !== 0) { _getDynStyle().textContent = ''; _lastScrollOffset = 0; }
            return;
        }

        let offset = 0;
        const search = document.getElementById('crack-search-container');
        if (search) offset += search.getBoundingClientRect().height;

        const ceiled = Math.ceil(offset);
        if (ceiled === _lastScrollOffset) return; // 변화 없으면 DOM 쓰기 생략
        _lastScrollOffset = ceiled;

        _getDynStyle().textContent = ceiled > 0
            ? `.${VROOT_CLASS} [data-testid="virtuoso-scroller"]{height:calc(100% - ${ceiled}px)!important;}`
            : '';
    }

    /* ================================================================
       3. 메인 뷰: 보관함 섹션 숨김
          data-attribute 방식: CSS가 선택자로 직접 제어하므로
          React 재조정(reconciliation)으로 inline style이 초기화돼도 유지됨
          [v3.2.1] 기존 구현이 'relative' 첫 매칭으로 조상을 올라가다
          `relative flex-1 min-h-0 flex flex-col` — 즉 우리 탭+리스트 전체
          패널을 잡아 data-crack-arch-section을 붙여버려, `display:none`으로
          보관함 목록이 통째로 사라지는 버그가 있었음.
          수정: trigger 버튼의 직계 부모(보관함 미리보기 헤더 행)를 거쳐
          그 부모 컨테이너(미리보기 섹션 전체)까지만 올라가도록 두 단계로
          제한. 구조적으로 'flex flex-col' + 'max-h-[284px]'를 가진 div가
          메인 뷰의 보관함 축소 섹션이므로 이를 명시적 클래스 조합으로 검증.
    ================================================================ */
    function hideNativeArchiveSection() {
        const trigger = document.querySelector('button[aria-label="보관함 전체보기"]');
        if (!trigger) return;

        // trigger → 헤더 행(h-7 flex items-center) → 보관함 미리보기 섹션
        // 캡처 확인: trigger.parentElement = div.flex.items-center.gap-2.h-7.pl-2
        //            .parentElement = div.flex.flex-col.pt-0.pb-2.max-h-[284px].overflow-hidden
        const headerRow = trigger.parentElement;
        const section = headerRow?.parentElement;
        if (!section) return;

        // 안전 검증: 미리보기 섹션은 max-h-[284px]를 갖는 flex-col div임을 확인
        // 그 이상(relative flex-1 min-h-0 등)을 잡으면 탭·리스트 전체가 숨겨지므로 중단
        if (!section.classList.contains('flex-col') || !section.classList.contains('overflow-hidden')) return;

        section.setAttribute('data-crack-arch-section', '1');
        const divider = section.nextElementSibling;
        if (divider) divider.setAttribute('data-crack-arch-divider', '1');
        const chatHdr = divider?.nextElementSibling;
        if (chatHdr) chatHdr.setAttribute('data-crack-chat-hdr', '1');
    }

    /* ================================================================
       4. 보관함 / 채팅 목록 탭 (main + archive-list 양 뷰에서 유지)
    ================================================================ */
    function injectViewTabs() {
        const view = detectView();
        // archive-inner / archive-edit 에서는 탭 불필요
        if (view !== 'main' && view !== 'archive-list') return;

        const isArchive = (view === 'archive-list');
        let tabs = document.getElementById('crack-view-tabs');

        if (tabs) {
            // 이미 존재: active 상태 + 카테고리 관리 버튼 표시 여부만 갱신
            const archiveBtn  = tabs.querySelector('[data-tab="archive"]');
            const chatlistBtn = tabs.querySelector('[data-tab="chatlist"]');
            archiveBtn.classList.toggle('crack-tab-active', isArchive);
            chatlistBtn.classList.toggle('crack-tab-active', !isArchive);
            const catBtn = tabs.querySelector('#crack-cat-manage-btn');
            if (catBtn) catBtn.style.display = isArchive ? '' : 'none';
            return;
        }

        // 삽입 위치: virtuoso 컨테이너(pl-2 div) 바로 앞
        // 메인 뷰:          div.flex-1.min-h-0.overflow-hidden.pl-2          (min-w-0 없음)
        // archive-list 뷰:  div.flex-1.min-w-0.min-h-0.overflow-hidden.pl-2  (min-w-0 있음)
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

        // 보관함 탭 클릭
        tabs.querySelector('[data-tab="archive"]').addEventListener('click', () => {
            const v = detectView();
            if (v === 'main') {
                // 메인 → 보관함 전체 뷰
                document.querySelector('button[aria-label="보관함 전체보기"]')?.click();
            }
            // archive-list에서는 이미 보관함 뷰이므로 아무것도 하지 않음
        });

        // 채팅 목록 탭 클릭
        tabs.querySelector('[data-tab="chatlist"]').addEventListener('click', () => {
            const v = detectView();
            if (v === 'archive-list') {
                // 보관함 전체 → 메인 뷰 (뒤로가기)
                document.querySelector('button[aria-label="뒤로가기"]')?.click();
            }
            // main에서는 이미 채팅 목록 뷰이므로 아무것도 하지 않음
        });

        // 카테고리 관리(생성/이름변경/색상변경/삭제) 버튼
        tabs.querySelector('#crack-cat-manage-btn').addEventListener('click', e => {
            e.stopPropagation();
            openCategoryManageModal();
        });

        inner.parentElement.insertBefore(tabs, inner);
    }

    /* ================================================================
       5. 검색창 (main 제외, 공통)
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
        // 삽입 후 레이아웃이 확정되면 높이 보정
        requestAnimationFrame(adjustScrollerHeight);
    }

    function filterSessions(raw) {
        const kw   = raw.toLowerCase().replace(/\s+/g, '');
        const view = detectView();

        document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index]`).forEach(wrapper => {
            // 카테고리가 접힌 상태로 숨겨진 보관함은 검색 결과와 무관하게 숨김 유지
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

        // archive-list에서 검색 중엔, 보이는 항목이 하나도 없는 카테고리의 헤더를 숨김
        // v3.1.0: nextElementSibling 체인으로 "DOM상 헤더 바로 뒤에 그 카테고리 항목이
        // 연속 배치돼 있다"고 가정하던 기존 방식은 잘못된 전제였음(실제로는 보관함이
        // 플랫폼 고유 순서대로 DOM에 남아있고 헤더만 첫 항목 앞에 꽂히는 구조라, 같은
        // 카테고리의 나머지 항목이 멀리 떨어진 채 다른 헤더 밑에 끼어 보이는 "엉뚱한
        // 카테고리" 버그의 원인이기도 했음). 이제는 실제 카테고리 소속(getCategoryOf)을
        // 전체 wrapper 기준으로 다시 계산해 판정한다.
        if (view === 'archive-list') {
            const visibleByCat = new Map(); // category -> 보이는 항목 존재 여부
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
       6. 보관함 카테고리: 그룹 헤더 삽입 + 접기/펼치기 적용
          - archive-list 뷰에서만 동작 (archive-edit는 네이티브 편집 UI 보존을 위해 제외)
          - 헤더는 절대 remove하지 않고 속성 갱신만 함 (remove → MutationObserver
            발화 → 재호출 무한루프로 인한 깜빡거림 방지)

          [v3.1.0] 그룹핑 방식 변경 — "엉뚱한 카테고리에 들어앉는" 버그 수정:
          기존에는 헤더만 해당 카테고리의 '첫 항목' 바로 앞으로 insertBefore하고,
          같은 카테고리의 나머지 항목은 전혀 옮기지 않았음. 그 결과 보관함은
          DOM/플랫폼 고유 순서 그대로 남아있고, 그중 우연히 먼저 나오는 1개만
          헤더 옆에 보이고 나머지는 멀리 떨어진 채 다른 헤더의 시각적 그룹 안에
          끼어 보였음(실제 데이터는 정상이었고 "표시"만 잘못됐던 것).
          → 실제 DOM 노드를 옮기는 대신, virtuoso-item-list를 flex column으로
            강제하고 각 헤더/항목에 style.order를 부여해 "시각적으로만" 카테고리별
            연속 배치를 만든다. Virtuoso(React)가 관리하는 자식 노드의 실제 위치는
            건드리지 않으므로 React 재조정과 충돌할 위험이 없다(React는 자신이
            설정한 style 속성만 갱신하고 order처럼 직접 추가한 속성은 보존함 —
            이미 [data-crack-arch-section] 등에서 같은 원리로 !important CSS를
            써온 것과 동일한 전제).
    ================================================================ */
    function applyArchiveCategories() {
        if (detectView() !== 'archive-list') {
            // archive-list가 아니면 헤더 숨김 + 항목 표시/순서 복구 후 종료
            document.querySelectorAll('.crack-cat-header').forEach(el => {
                if (el.style.display !== 'none') el.style.display = 'none';
            });
            document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index]`).forEach(w => {
                if (w.dataset.crackCatHide === '1') {
                    w.style.removeProperty('display');
                    delete w.dataset.crackCatHide;
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

        // 카테고리별로 그룹화 (1차 분류 — 그룹 내부 순서는 다음 단계에서 재정렬)
        const groups = new Map(); // category -> wrapper[]
        wrappers.forEach(wrapper => {
            const name = wrapper.querySelector(SEL_NAME)?.textContent.trim();
            if (!name) return;
            const cat = getCategoryOf(name);
            if (!groups.has(cat)) groups.set(cat, []);
            groups.get(cat).push(wrapper);
        });

        // [v3.1.2] 카테고리 "내부" 보관함 순서를 영속 데이터 기준으로 고정.
        // 플랫폼이 보관함을 최근 진입 순으로 재배열하는 탓에, 그룹 내부 순서를
        // 매번 "이번 tick의 DOM 등장 순서"에서 뽑으면 보관함을 열고 나올 때마다
        // 흔들린다(카테고리 자체 순서를 영속화한 것과 동일한 이유).
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

        // [v3.1.0] 표시 순서는 더 이상 "이번 tick에 마운트된 DOM 등장 순서"에서
        // 뽑지 않고, 영속 저장된 순서 목록을 기준으로 한다(미분류는 항상 마지막).
        // 순서 목록에 아직 없는 카테고리(레거시 데이터 등)는 만나는 즉시 끝에
        // 등록해 다음 tick부터는 안정적으로 같은 자리를 유지하게 한다.
        const persistedOrder = getCategoryOrder();
        groups.forEach((_, cat) => {
            if (cat !== UNCATEGORIZED && !persistedOrder.includes(cat)) {
                persistedOrder.push(cat);
                saveCategoryOrder(persistedOrder);
            }
        });
        const sortedCats = [...groups.keys()].sort((a, b) => {
            if (a === UNCATEGORIZED) return 1;
            if (b === UNCATEGORIZED) return -1;
            return persistedOrder.indexOf(a) - persistedOrder.indexOf(b);
        });

        // 기존 헤더 맵 수집 (재사용을 위해 category -> element)
        const existingHeaders = new Map();
        document.querySelectorAll('.crack-cat-header').forEach(el => {
            existingHeaders.set(el.dataset.category, el);
        });

        // 사용된 카테고리 추적 (미사용 헤더 숨김용)
        const usedCats = new Set(sortedCats);
        existingHeaders.forEach((el, cat) => {
            if (!usedCats.has(cat) && el.style.display !== 'none') el.style.display = 'none';
        });

        const parent = wrappers[0].parentElement;
        let orderSeq = 0; // 그룹 단위로 연속 증가 → 헤더+항목이 시각적으로 한 블록이 됨
        // [v3.1.0] 개수도 "현재 마운트된 항목 수"(items.length) 대신 영속 데이터
        // 기준 총합을 쓴다. 접었다 펼 때마다 Virtuoso가 다른 부분집합을 마운트
        // 하면서 개수 표시가 흔들리던 문제(예: 4개 ↔ 2개)의 원인이 바로 이것.
        // 미분류는 전체 보관함 수를 별도로 들고 있지 않아 마운트 수를 그대로 쓴다.
        const persistedCounts = getCategoryCounts();

        sortedCats.forEach(cat => {
            const items = groups.get(cat);
            const collapsed = isCategoryCollapsed(cat);

            // 헤더: 기존 것 재사용, 없으면 신규 생성. 위치는 더 이상 옮기지 않고
            // (childList mutation 자체를 발생시키지 않기 위해) 최초 생성 시 1회만
            // appendChild — 실제 그룹 순서는 style.order로 결정한다.
            let header = existingHeaders.get(cat);
            if (!header) {
                header = document.createElement('div');
                header.className = 'crack-cat-header';
                header.dataset.category = cat;
                header.addEventListener('click', () => {
                    setCategoryCollapsed(cat, !isCategoryCollapsed(cat));
                    applyArchiveCategories();
                });
                parent.appendChild(header);
            } else if (header.style.display !== '') {
                header.style.display = '';
            }
            const headerOrder = String(orderSeq++);
            if (header.style.order !== headerOrder) header.style.order = headerOrder;

            // 헤더 내용 갱신 (변경이 있을 때만 실제 DOM 쓰기)
            const arrow = collapsed ? '▶' : '▼';
            const count = String(cat === UNCATEGORIZED ? items.length : (persistedCounts[cat] ?? items.length));
            const colorHex = cat === UNCATEGORIZED ? null : CAT_PALETTE[getCategoryColor(cat)];
            const arrowEl = header.querySelector('.cch-arrow');
            const countEl = header.querySelector('.cch-count');
            if (!arrowEl) {
                // 최초 생성 시 innerHTML 구성
                // [v3.1.0] 색상은 더 이상 작은 점(dot)이 아니라 이름 자체를 감싸는
                // 색상 태그(pill)로 표시 — 카테고리 관리 모달의 .ccp-tag와 같은
                // 시각 언어를 재사용해 "카테고리=색상"이 한눈에 보이도록 함.
                // 개별 수정(✎) 버튼은 제거 — 상단 '카테고리 관리' 모달 하나로 통합.
                header.innerHTML = `
                    <span class="cch-arrow">${arrow}</span>
                    <span class="ccp-tag cch-tag ${cat === UNCATEGORIZED ? 'cch-tag-neutral' : ''}" style="${colorHex ? `--cat-color:${colorHex}` : ''}">${cat}</span>
                    <span class="cch-count">${count}</span>`;
            } else {
                // 재사용 시 텍스트/색상만 조건부 갱신 (DOM 쓰기 최소화)
                if (arrowEl.textContent !== arrow) arrowEl.textContent = arrow;
                const tagEl = header.querySelector('.cch-tag');
                if (tagEl) {
                    if (tagEl.textContent !== cat) tagEl.textContent = cat;
                    const isNeutral = cat === UNCATEGORIZED;
                    if (tagEl.classList.contains('cch-tag-neutral') !== isNeutral) {
                        tagEl.classList.toggle('cch-tag-neutral', isNeutral);
                    }
                    const nextVar = colorHex ? `--cat-color:${colorHex}` : '';
                    if (tagEl.getAttribute('style') !== nextVar) tagEl.setAttribute('style', nextVar);
                }
                if (countEl.textContent !== count) countEl.textContent = count;
            }

            // 항목 표시/숨김 + 시각적 순서(order) 부여 — 실제 위치 이동 없음
            items.forEach(wrapper => {
                const itemOrder = String(orderSeq++);
                if (wrapper.style.order !== itemOrder) wrapper.style.order = itemOrder;
                if (collapsed) {
                    wrapper.style.setProperty('display', 'none', 'important');
                    wrapper.dataset.crackCatHide = '1';
                } else {
                    wrapper.style.removeProperty('display');
                    delete wrapper.dataset.crackCatHide;
                }
                // [v3.1.0] 헤더 색상만으로는 "이 보관함이 어느 카테고리인지"가 한눈에
                // 안 들어온다는 요청 반영 — 헤더뿐 아니라 소속 보관함 행 자체에도
                // 같은 색을 옅게(8%) 깔아서 카테고리 영역 전체가 시각적으로 묶여
                // 보이게 한다. 미분류는 틴트 없음.
                if (colorHex) {
                    if (!wrapper.classList.contains('crack-cat-tinted')) wrapper.classList.add('crack-cat-tinted');
                    if (wrapper.style.getPropertyValue('--cat-color') !== colorHex) {
                        wrapper.style.setProperty('--cat-color', colorHex);
                    }
                } else if (wrapper.classList.contains('crack-cat-tinted')) {
                    wrapper.classList.remove('crack-cat-tinted');
                    wrapper.style.removeProperty('--cat-color');
                }
            });
        });
    }

    /* ================================================================
       7-a. 커스텀 드래그 (mousedown/mousemove/mouseup 기반)
            [v3.2.3] 기존엔 HTML5 네이티브 Drag and Drop API(draggable=true
            + dragover/drop)를 썼으나, React가 관리하는 Virtuoso 가상 리스트
            내부에서 네이티브 drag 이벤트가 간헐적으로 전달되지 않는 현상이
            있었음(CSS 자체는 tinycss2로 직접 검증해 문법·셀렉터 모두 정상—
            이벤트 전달 쪽 문제로 결론). 더 예측 가능한 mousedown/mousemove/
            mouseup + elementFromPoint 기반 수동 드래그로 교체해, 강조 표시가
            브라우저의 네이티브 drag 세션 처리에 의존하지 않고 100% 우리
            통제 하에 매 프레임 직접 렌더링되게 한다.
    ================================================================ */
    // 화면 좌표(x,y) 아래의 보관함 카드(wrapper)를 찾는다. VROOT_CLASS 스코프
    // 밖(예: 보관함 이동 모달의 동일 testid 리스트)은 명시적으로 제외한다.
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
    // 히트테스트 결과로 강조 클래스를 갱신. 자기 자신/다른 카테고리 카드 위에
    // 있으면 기존 강조만 정리(드래그 자체는 그대로 진행 중인 상태 유지).
    function updateDragHighlight(x, y) {
        if (!_dragState) return;
        const wrapper = findDropWrapper(x, y);
        const targetName = wrapper?.querySelector(SEL_NAME)?.textContent.trim();
        if (!wrapper || !targetName || targetName === _dragState.name || getCategoryOf(targetName) !== _dragState.cat) {
            clearDragHighlight();
            return;
        }
        if (_dragOverEl && _dragOverEl !== wrapper) {
            _dragOverEl.classList.remove('crack-drop-before', 'crack-drop-after');
        }
        _dragOverEl = wrapper;
        const rect = wrapper.getBoundingClientRect();
        const after = (y - rect.top) > rect.height / 2;
        wrapper.classList.toggle('crack-drop-before', !after);
        wrapper.classList.toggle('crack-drop-after',   after);
        wrapper.dataset.crackDropAfter = after ? '1' : '0';
    }
    function onDragMouseMove(e) {
        _dragLastX = e.clientX;
        _dragLastY = e.clientY;
        if (_dragRafId) return; // 이미 다음 프레임에 처리 예약됨 — 쓰로틀
        _dragRafId = requestAnimationFrame(() => {
            _dragRafId = null;
            updateDragHighlight(_dragLastX, _dragLastY);
        });
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
        if (getCategoryOf(targetName) !== dragged.cat) return; // 카테고리 간 이동은 🏷 버튼으로만
        reorderItem(dragged.cat, dragged.name, targetName, wrapper.dataset.crackDropAfter === '1');
        applyArchiveCategories();
    }
    function startDrag(wrapper, e) {
        e.preventDefault(); // 텍스트 선택 등 네이티브 동작 방지
        const liveName = wrapper.querySelector(SEL_NAME)?.textContent.trim();
        if (!liveName) return;
        _dragState = { name: liveName, cat: getCategoryOf(liveName), sourceWrapper: wrapper };
        wrapper.classList.add('crack-dragging');
        document.body.classList.add('crack-dragging-active');
        document.addEventListener('mousemove', onDragMouseMove);
        // capture 단계에서 등록 — 중간 요소가 mouseup에서 stopPropagation해도 누락되지 않게
        document.addEventListener('mouseup', onDragMouseUp, true);
    }

    /* ================================================================
       7-b. 보관함 목록/편집 뷰 공통: 카테고리 지정 버튼 + 순서 드래그 핸들 주입
          - 카테고리 지정(🏷) 버튼은 우상단 '보관함 메뉴'(⋮) 옆 클러스터에
          - 드래그 핸들(⠿)은 카드 좌측 전체 높이 스트립 — 작은 아이콘보다
            위/아래 절반 판정 히트존이 훨씬 넓어져서 잡기 쉬움.
          드롭 위치 표시는 커서가 타겟 카드의 위쪽/아래쪽 절반 중 어디 있는지에
          따라 카드 테두리 강조 + 그 경계에 삽입선을 그려 "여기 앞/뒤에 꽂힌다"가
          명확히 보이게 한다(updateDragHighlight 참고).
    ================================================================ */
    function injectMoveButtons() {
        document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index]`).forEach(wrapper => {
            const relDiv = wrapper.querySelector('.relative');
            const absDiv = wrapper.querySelector('.absolute.top-3.right-3');
            // 보관함 메뉴 버튼/카드 구조가 아직 렌더링되지 않은 경우 다음 tick에 재시도
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
                    e.preventDefault();
                    e.stopPropagation();
                    // Virtuoso가 노드를 재사용해도 클릭 시점에 실제 이름을 다시 읽어
                    // stale closure로 인한 잘못된 보관함 지정을 방지
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
                // 핸들이 .relative의 형제가 아니라 첫 자식으로 들어가지만, 카드
                // 본문(button/a)과는 별개 요소라 클릭이 버블링돼도 네비게이션
                // 핸들러에 닿지 않음. 그래도 방어적으로 한 번 더 차단.
                handle.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); });
                handle.addEventListener('mousedown', e => {
                    e.stopPropagation();
                    startDrag(wrapper, e);
                });
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
        modal.querySelectorAll('.cmove-item').forEach(item => {
            item.addEventListener('click', () => assign(item.dataset.cat));
        });
        modal.querySelector('#cmove-cancel').onclick = () => modal.remove();
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    /* ================================================================
       8-b. 상단 탭 옆 '카테고리 관리' 버튼: 생성 / 이름변경 / 색상변경 / 삭제 통합
       [v3.1.0] 기존에는 이 모달(생성+삭제 전용)과 헤더의 개별 ✎ 버튼(이름+색상
       변경 전용)이 따로 있어 "전체 편집"과 "개별 카테고리 편집"이 중복으로
       보였음. 카테고리 행마다 색상 스와치 · 이름 입력(인라인 수정) · 개수 ·
       삭제 버튼을 한 줄에 두어 단일 진입점으로 통합하고, 헤더 쪽 개별 수정
       버튼은 완전히 제거했다.
    ================================================================ */
    function openCategoryManageModal() {
        document.getElementById('crack-catmgr-modal')?.remove();
        const existingCats = getOrderedCategories(); // 사이드바와 동일한 표시 순서로 노출
        const counts = getCategoryCounts();
        // 신규 생성 시 배정 후보는 현재 DOM에 보이는 보관함만 가능 (Virtuoso 가상
        // 스크롤 한계: 화면에 렌더링된 카드만 후보가 됨. 필요한 보관함이 안 보이면
        // 스크롤 후 다시 열어주세요)
        const visibleArchives = [...document.querySelectorAll(`.${VROOT_CLASS} ${SEL_VLIST} div[data-index]`)]
            .map(w => w.querySelector(SEL_NAME)?.textContent.trim())
            .filter(Boolean);

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
                                    <button type="button" class="ccm-color-dot" data-cat="${c}"
                                            style="--cat-color:${CAT_PALETTE[getCategoryColor(c)]}" title="색상 변경"></button>
                                    <input type="text" class="ccm-cat-name-input" value="${c}" data-orig="${c}">
                                    <span class="ccm-cat-count">${counts[c] || 0}개</span>
                                    <button type="button" class="csub-btn ccm-order-btn ccm-order-up" data-cat="${c}"
                                            title="위로" ${i === 0 ? 'disabled' : ''}>▲</button>
                                    <button type="button" class="csub-btn ccm-order-btn ccm-order-down" data-cat="${c}"
                                            title="아래로" ${i === existingCats.length - 1 ? 'disabled' : ''}>▼</button>
                                    <button type="button" class="csub-btn ccm-del-btn" data-cat="${c}">삭제</button>
                                </div>
                                <div class="cce-palette ccm-palette-row" data-cat="${c}" style="display:none">
                                    ${Object.entries(CAT_PALETTE).map(([key, hex]) => `
                                        <button type="button" class="cce-swatch ${key === getCategoryColor(c) ? 'cce-swatch-active' : ''}"
                                                data-color="${key}" style="--swatch-color:${hex}" title="${key}"></button>`).join('')}
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

                </div>
                <div class="cmove-footer">
                    <button id="ccm-cancel" class="cmove-btn">닫기</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        // 모달을 닫는 경로(취소/배경클릭/Esc/생성·삭제 후 재구성)가 여러 곳이라
        // document에 매번 새로 붙는 keydown 리스너가 닫을 때마다 정리되도록 일원화.
        // (생성/삭제 시 모달을 재구성하는 구조라 정리를 안 하면 호출할수록 누적됨)
        const onKey = e => { if (e.key === 'Escape') close(); };
        function close() {
            document.removeEventListener('keydown', onKey);
            modal.remove();
        }
        document.addEventListener('keydown', onKey);

        // ── 이름 변경: blur 시 검증 후 즉시 저장 (같은 행의 점/삭제버튼·팔레트도 새 이름으로 동기화)
        modal.querySelectorAll('.ccm-cat-name-input').forEach(input => {
            input.addEventListener('blur', () => {
                const row = input.closest('.ccm-cat-row');
                const oldName = input.dataset.orig;
                const newName = input.value.trim();
                if (newName === oldName) return;
                if (!newName) { input.value = oldName; return; }
                if (newName === UNCATEGORIZED) {
                    alert(`"${UNCATEGORIZED}"는 예약된 이름이라 사용할 수 없습니다.`);
                    input.value = oldName; return;
                }
                if (getAllCategories().includes(newName)) {
                    alert('이미 존재하는 카테고리 이름입니다.');
                    input.value = oldName; return;
                }
                renameCategory(oldName, newName);
                input.dataset.orig = newName;
                row.dataset.cat = newName;
                row.querySelector('.ccm-color-dot').dataset.cat = newName;
                row.querySelector('.ccm-del-btn').dataset.cat = newName;
                if (row.nextElementSibling?.classList.contains('ccm-palette-row')) {
                    row.nextElementSibling.dataset.cat = newName;
                }
                applyArchiveCategories();
            });
            input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
        });

        // ── 색상 점 클릭 → 바로 아래 팔레트 토글 (다른 행의 팔레트는 닫음)
        modal.querySelectorAll('.ccm-color-dot').forEach(dot => {
            dot.addEventListener('click', () => {
                const palette = dot.closest('.ccm-cat-row').nextElementSibling;
                const willOpen = palette.style.display === 'none';
                modal.querySelectorAll('.ccm-palette-row').forEach(p => { p.style.display = 'none'; });
                if (willOpen) palette.style.display = '';
            });
        });

        // ── 팔레트 스와치 클릭 → 즉시 저장 + 점 색상 갱신 + 팔레트 닫기
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

        // ── 삭제: 목록이 바뀌므로 모달을 재구성해 갱신된 상태를 바로 반영
        modal.querySelectorAll('.ccm-del-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const cat = btn.dataset.cat;
                if (!confirm(`"${cat}" 카테고리를 삭제하고 소속 보관함을 ${UNCATEGORIZED}로 되돌릴까요?`)) return;
                deleteCategory(cat);
                applyArchiveCategories();
                close();
                openCategoryManageModal();
            });
        });

        // ── 순서 변경: ▲▼ 버튼으로 카테고리 표시 순서 자체를 조정 (모달 재구성)
        modal.querySelectorAll('.ccm-order-up').forEach(btn => {
            btn.addEventListener('click', () => {
                moveCategoryOrder(btn.dataset.cat, -1);
                applyArchiveCategories();
                close();
                openCategoryManageModal();
            });
        });
        modal.querySelectorAll('.ccm-order-down').forEach(btn => {
            btn.addEventListener('click', () => {
                moveCategoryOrder(btn.dataset.cat, 1);
                applyArchiveCategories();
                close();
                openCategoryManageModal();
            });
        });

        // ── 생성: 마찬가지로 모달을 재구성
        modal.querySelector('#ccm-create-btn').onclick = () => {
            const name = modal.querySelector('#ccm-new-name').value.trim();
            if (!name) { modal.querySelector('#ccm-new-name').focus(); return; }
            if (name === UNCATEGORIZED) { alert(`"${UNCATEGORIZED}"는 예약된 이름이라 사용할 수 없습니다.`); return; }
            if (getAllCategories().includes(name)) { alert('이미 존재하는 카테고리 이름입니다. 기존 카테고리에 추가하려면 보관함 카드의 "카테고리 지정" 버튼을 이용해주세요.'); return; }
            const checked = [...modal.querySelectorAll('.ccm-archive-item input:checked')].map(i => i.value);
            if (!checked.length) { alert('카테고리에 배정할 보관함을 1개 이상 선택해주세요.'); return; }
            assignArchivesToCategory(checked, name);
            applyArchiveCategories();
            close();
            openCategoryManageModal();
        };

        modal.querySelector('#ccm-cancel').onclick = close;
        modal.onclick = e => { if (e.target === modal) close(); };
    }

    /* ================================================================
       10. 메모 UI (모든 뷰 공통)
    ================================================================ */
    function injectMemoUI() {
        let hadNew = false;
        document.querySelectorAll(`${SEL_LINK}:not([data-crack-memo])`).forEach(link => {
            const href = link.getAttribute('href');
            if (!href) return;

            // [v3.1.3] 버그 B 수정: 제목을 먼저 추출한 뒤, 유효할 때만 data-crack-memo 확정.
            // "이름 없는 세션"이면 다음 tick에서 React 수화 완료 후 올바른 제목을
            // 재추출할 기회를 준다. 무한 재시도 방지를 위해 data-crack-memo-retry
            // 카운터가 5를 초과하면 포기하고 강제 확정한다.
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
                memoBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24" width="14" height="14">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
                memoBtn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openMemoModal(href); });
                titleRow.insertBefore(memoBtn, moreBtn);
            }

            const contentArea = link.querySelector('div[class*="flex-col"][class*="flex-1"]');
            if (contentArea && !contentArea.querySelector('.crack-memo-preview')) {
                const preview = document.createElement('div');
                preview.className        = 'crack-memo-preview';
                preview.dataset.memoHref = href;
                preview.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openMemoModal(href); });
                contentArea.appendChild(preview);
            }

            if (title !== '이름 없는 세션') {
                // 유효한 제목을 얻었을 때만 처리 완료로 확정
                link.setAttribute('data-crack-memo', '1');
                hadNew = true;
            } else {
                // 제목 미확보: 재시도 카운터 증가. 5회 초과 시 포기하고 강제 확정
                // (무한 재처리 방지 — moreBtn은 존재하므로 UI 주입은 이미 완료됨)
                const retries = parseInt(link.getAttribute('data-crack-memo-retry') || '0', 10);
                if (retries >= 5) {
                    link.setAttribute('data-crack-memo', '1');
                } else {
                    link.setAttribute('data-crack-memo-retry', String(retries + 1));
                }
            }
        });

        // 새로 삽입된 링크가 있을 때만 전체 preview 갱신.
        // Virtuoso 가상 스크롤로 DOM 노드가 재사용될 때도 hadNew가 true가 되므로
        // 재사용 케이스도 올바르게 커버됨.
        if (hadNew) refreshPreviews();
        injectNameAnimation();
    }

    function refreshPreviews() {
        // getMemo()는 이미 인메모리 캐시에서 읽으므로 반복 호출 비용 없음.
        // 단, DOM 쓰기(textContent / style.display)는 변화가 있을 때만 수행.
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

        // [v3.1.3] 버그 C 수정: DOM 우선 수집.
        // 기존 캐시-우선 방식은 seen.add()가 캐시 순회 단계에서 먼저 등록되어,
        // 해당 href가 현재 DOM에 있더라도 DOM 제목 추출이 완전히 스킵됐음.
        // → DOM에서 먼저 제목을 수집하고, 캐시는 DOM에 없는 세션(가상 스크롤
        //   밖에 있는 오래된 세션)에 대해서만 폴백으로 사용한다.
        const domTitles = new Map();
        document.querySelectorAll(`a[href*="${pattern}"]`).forEach(a => {
            const h = a.getAttribute('href');
            if (!h) return;
            domTitles.set(h, extractTitle(a));
        });

        // 스토리 상세 페이지에서 스토리 제목 추출.
        // Virtuoso 가상 스크롤 밖에 있어 DOM에도 없는 오래된 세션(캐시에
        // "이름 없는 세션"으로 오염된 항목)의 보정용 폴백으로 사용한다.
        // "/detail/{storyId}" 링크는 스토리 상세 페이지에서만 존재하므로,
        // 다른 페이지에서는 null이 되어 폴백 없이 기존 캐시 값이 그대로 사용됨.
        const pageStoryTitle =
            document.querySelector(`a[href="/detail/${storyId}"] p`)?.textContent?.trim() || null;

        // 캐시 전체 순회 (가상 스크롤 밖 세션 포함)
        Object.entries(getCache()).forEach(([href, info]) => {
            if (!href.includes(pattern) || seen.has(href)) return;
            seen.add(href);
            const domTitle = domTitles.get(href);
            let name = info.title || href.split('/').pop();
            if (domTitle && domTitle !== '이름 없는 세션') {
                // DOM에 유효한 제목이 있으면 무조건 사용 + 오염된 캐시 수정
                if (name !== domTitle) cacheSession(href, domTitle);
                name = domTitle;
            } else if (name === '이름 없는 세션' && pageStoryTitle) {
                // DOM에도 없고 캐시도 "이름 없는 세션"이면 스토리 제목으로 보정 + 캐시 수정
                cacheSession(href, pageStoryTitle);
                name = pageStoryTitle;
            }
            results.push({ href, name });
        });

        // 캐시에 없는 DOM 세션 추가 (신규 세션 또는 캐시 미등록 세션)
        domTitles.forEach((name, href) => {
            if (!seen.has(href)) {
                seen.add(href);
                results.push({ href, name });
            }
        });

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
                if (!storyId) { m = window.location.pathname.match(/\/stories\/([^/?#]+)/);   if (m) storyId = m[1]; }
                if (!storyId) { m = window.location.pathname.match(/\/detail\/([^/?#]+)/);    if (m) storyId = m[1]; }
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
        modal.querySelector('#cmemo-del').onclick    = () => {
            if (confirm('메모를 삭제하시겠습니까?')) { saveMemo(href, ''); refreshPreviews(); modal.remove(); }
        };
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
                                    <span class="csp-name">${s.name}</span>
                                    ${memo ? `<span class="csp-memo">📝 ${memo.length > 30 ? memo.slice(0,30)+'…' : memo}</span>` : ''}
                                </a>`;
                    }).join('')}
                </div>
                <div class="csp-footer"><button class="csp-btn" id="csp-cancel">취소</button></div>
            </div>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('.csp-item').forEach(a => {
            a.addEventListener('click', e => { e.preventDefault(); modal.remove(); window.location.href = a.getAttribute('href'); });
        });
        modal.querySelector('#csp-cancel').onclick = () => modal.remove();
        modal.onclick = e => { if (e.target === modal) modal.remove(); };
        const onKey = e => { if (e.key === 'Escape') { modal.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
    }

    /* ================================================================
       15. 메인 루프
       GC 최적화 (v3.1.0):
         ① 뷰 변경 캐싱: tick() 주기마다 detectView()를 호출하지만
           결과가 이전 tick과 동일하면 뷰별 inject 함수들을 건너뜀.
           뷰 전환이 없는 안정 상태(대부분의 tick)에서 querySelector
           다수 + DOM 조작 비용을 제거.
         ② main 뷰 _getDynStyle 초기화: 변경 없으면 쓰기 생략.
         ③ setInterval 3000ms → 5000ms:
           - Ignitor(1000ms)와 3의 배수 관계 해소 (LCM: 3000→5000)
           - 모닝콜 Seismometer(6000ms)와도 30s에 한 번으로 겹침 분산
           - 500ms 오프셋: 스크립트 시작 직후 다른 스크립트들과의
             초기 GC 피크 충돌 회피
         ④ MutationObserver debounce는 기존 250ms 유지 (DOM 반응성 보존)
    ================================================================ */
    let _lastView = null; // 이전 tick의 뷰 상태 캐시

    function tick() {
        const view = detectView();
        const viewChanged = (view !== _lastView);
        _lastView = view;

        // [v3.1.2] 아래 분기들의 SEL_VLIST/SEL_VSCROLL 쿼리가 전부 VROOT_CLASS
        // 스코프로 바뀌었으므로, 마커가 먼저 붙어 있어야 같은 tick에서 바로
        // 동작한다(맨 아래 공통 섹션에 있던 걸 최상단으로 이동).
        markSidebarPanelRoot();

        // ── 뷰별 UI: 뷰가 바뀌었을 때만 inject/remove 수행 ────────
        // 뷰가 동일한 tick에서는 이미 주입된 요소들이 살아있으므로
        // inject 함수들의 early-return(getElementById 체크 등)이 동작하지만,
        // querySelector 비용 자체는 발생한다. viewChanged 가드로 완전 생략.
        if (viewChanged) {
            if (view === 'main') {
                hideNativeArchiveSection();
                injectViewTabs();
                injectSearchBar();
                setArchiveListHeaderHidden(false);
                // _lastScrollOffset 리셋: 뷰 전환 시 offset이 달라지므로 강제 재계산
                _lastScrollOffset = -1;
                _getDynStyle().textContent = '';

            } else if (view === 'archive-list') {
                cacheArchiveNames();
                injectViewTabs();
                injectSearchBar();
                injectMoveButtons();
                applyArchiveCategories();
                setArchiveListHeaderHidden(true);
                _lastScrollOffset = -1;

            } else if (view === 'archive-edit') {
                cacheArchiveNames();
                document.getElementById('crack-view-tabs')?.remove();
                document.getElementById('crack-search-container')?.remove();
                injectMoveButtons();
                setArchiveListHeaderHidden(false);
                _lastScrollOffset = -1;
                _getDynStyle().textContent = '';

            } else if (view === 'archive-inner') {
                document.getElementById('crack-view-tabs')?.remove();
                injectSearchBar();
                setArchiveListHeaderHidden(false);
                _lastScrollOffset = -1;
            }
        } else {
            // 뷰가 동일해도 Virtuoso가 항목을 재사용(recycle)할 수 있으므로
            // 카테고리 버튼/그룹 헤더는 재적용 필요. injectMoveButtons는
            // 클릭 시점에 보관함 이름을 다시 읽으므로(stale closure 방지)
            // wrapper 단위 마킹 없이 매번 전체 순회하지만, 버튼이 이미
            // 있으면 absDiv 내부 체크로 바로 스킵되어 실제 DOM 쓰기는
            // 새로 렌더링된 카드에서만 발생.
            if (view === 'archive-edit' || view === 'archive-list') injectMoveButtons();
            if (view === 'archive-list') { applyArchiveCategories(); setArchiveListHeaderHidden(true); }
        }

        // ── 공통: 뷰 변경과 무관하게 매 tick 실행 ───────────────────
        injectMemoUI();
        interceptContinueButtons();
        adjustScrollerHeight();
    }

    // 500ms 오프셋 후 5000ms 간격으로 실행
    // (스크립트 로드 직후의 다른 스크립트 초기화 피크와 분리)
    setTimeout(() => setInterval(tick, 5000), 500);

    let _debounce = null;
    new MutationObserver(mutations => {
        const allInternal = mutations.every(m =>
            m.target.closest?.('#crack-memo-modal')    ||
            m.target.closest?.('#crack-picker-modal')  ||
            m.target.closest?.('#crack-move-modal')    ||
            m.target.closest?.('#crack-catmgr-modal')  ||
            m.target.closest?.('#crack-search-container') ||
            m.target.classList?.contains('crack-cat-header')
        );
        if (allInternal) return;
        // MutationObserver 콜백에서 tick을 호출할 때는 _lastView를 리셋해
        // 뷰별 inject가 정상 실행되도록 보장
        clearTimeout(_debounce);
        _debounce = setTimeout(() => { _lastView = null; tick(); }, 250);
    }).observe(document.body, { childList: true, subtree: true });

    tick();

    /* ================================================================
       16. 스타일
    ================================================================ */
    GM_addStyle(`
        /* ── 보관함 섹션 강제 숨김 (data-attribute CSS 방식) ── */
        /* inline style 대신 CSS를 사용해 React 재조정에 의한 초기화 방지 */
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
            display: flex; flex-direction: column; gap: 3px;
            padding: 11px 18px; text-decoration: none; color: inherit; cursor: pointer;
            transition: background .12s; border-bottom: 1px solid rgba(255,255,255,.04);
        }
        .csp-item:last-child { border-bottom: none; }
        .csp-item:hover  { background: rgba(150,150,150,.07); }
        .csp-name { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .csp-memo { font-size: 11px; color: var(--muted-foreground, #888); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
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

        /* [v3.2.3] 드래그 핸들: 카드 좌측 전체 높이 스트립 (마우스 이벤트 기반) */
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
        /* 드래그 중: 텍스트 선택 방지 + 커서 전역 grabbing 표시 */
        body.crack-dragging-active { cursor: grabbing !important; user-select: none !important; }
        /* 드래그 중: 출발 카드 희미하게 */
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index].crack-dragging .relative { opacity: .35; }
        /* 드롭 위치 강조: 대상 카드 테두리 + 삽입 위치 선 */
        /* 공통: 대상 카드에 컬러 테두리 */
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index].crack-drop-before .relative,
        .${VROOT_CLASS} ${SEL_VLIST} div[data-index].crack-drop-after  .relative {
            outline: 2px solid var(--primary, #3D8BFF);
            outline-offset: -1px;
            border-radius: 8px;
        }
        /* 삽입 위치 선: 카드 위쪽(before) 또는 아래쪽(after) 경계 */
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
        /* 보관함 메뉴(⋮) 버튼 탭 바 내 배치 */
        .crack-arch-menu-btn-wrapper {
            margin-left: auto;
            display: flex; align-items: center;
        }
        .crack-arch-menu-btn-wrapper button { opacity: .7; }
        .crack-arch-menu-btn-wrapper button:hover { opacity: 1; }

        /* ── 상단 탭 옆 카테고리 관리(생성/이름변경/색상변경/삭제) 버튼 ── */
        #crack-cat-manage-btn {
            display: inline-flex; align-items: center; justify-content: center;
            width: 22px; height: 22px; margin-left: 2px;
            background: none; border: none; cursor: pointer;
            color: var(--line_gray_2, #888); border-radius: 5px;
            opacity: .65; transition: opacity .15s, background .15s;
        }
        #crack-cat-manage-btn:hover { opacity: 1; background: var(--accent, rgba(128,128,128,0.15)); }

        /* ── 카테고리 관리 모달 (#crack-catmgr-modal) ── */
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

        /* ── 카테고리 목록 행: 색상 점 + 이름(인라인 수정) + 개수 + 삭제 ── */
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

        /* ── 카테고리 색상 태그 (헤더·모달 공용) ── */
        .ccp-tag {
            display: inline-flex; align-items: center; gap: 6px;
            padding: 4px 10px; border-radius: 14px;
            background: rgba(255,68,50,.16); /* color-mix 미지원 브라우저 폴백 */
            background: color-mix(in srgb, var(--cat-color, #FF4432) 16%, transparent);
            color: var(--cat-color, #FF4432);
            font-size: 12px; font-weight: 500;
        }

        /* ── 보관함 카테고리 그룹 헤더 (archive-list 목록 내) ──
           [v3.1.0] virtuoso-item-list를 flex column으로 강제해 헤더/항목의
           style.order로 시각적 그룹핑을 만든다(실제 DOM 위치는 건드리지 않음).
           [v3.1.2] data-testid="virtuoso-item-list"는 플랫폼 전역에서 재사용되는
           값이라(보관함 이동 모달의 내부 리스트도 동일 testid), 과거엔 이 규칙이
           그 모달에도 그대로 적용돼 스크롤이 끝까지 닿지 않는 부작용이 있었음.
           VROOT_CLASS로 사이드바 패널 내부로만 한정한다. */
        .${VROOT_CLASS} ${SEL_VLIST} { display: flex !important; flex-direction: column !important; }
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
        /* .cch-tag는 위 .ccp-tag 스타일(색상 배경+텍스트)을 그대로 재사용하면서
           헤더 레이아웃에 필요한 속성만 덧붙인다(점 하나만 보이던 기존 표시 방식
           대신 카테고리명 전체를 색상 태그로 표시) */
        .cch-tag { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cch-tag-neutral {
            background: rgba(128,128,128,.14) !important;
            color: var(--muted-foreground, #999) !important;
        }
        .cch-count {
            font-size: 11px; opacity: .6; font-weight: normal;
            background: rgba(128,128,128,.15); border-radius: 10px; padding: 1px 7px;
        }
        /* 카테고리 소속 보관함 행 배경 틴트 — 헤더 색상만으로는 어느 보관함이
           어느 카테고리에 속하는지 한눈에 안 들어온다는 요청 반영. 헤더보다도
           연하게(6%) 깔아 카드 내용을 가리지 않게 한다. */
        .crack-cat-tinted {
            background: rgba(255,68,50,.06); /* color-mix 미지원 브라우저 폴백 */
            background: color-mix(in srgb, var(--cat-color, transparent) 6%, transparent);
        }

        /* ── 색상 팔레트 (카테고리 관리 모달 공용) ── */
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
