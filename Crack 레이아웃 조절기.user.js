// ==UserScript==
// @name         Crack 레이아웃 조절기
// @namespace    https://github.com/local/crack-layout
// @version      1.5.9
// @description  채팅창 너비 조절 + 컴팩트 모드
// @author       Tyme
// @match        https://crack.wrtn.ai/stories/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================================
    //  ① 스크롤 차단 — 조기 실행 구역 (document-start 시점)
    //
    //  원본: 채팅 강제 스크롤 차단 v1.0.0
    //  변경:
    //    · setInterval(syncScroll, 6) → requestAnimationFrame 루프로 교체
    //      이전 구조의 문제: 6ms 인터벌은 프레임 주기(~16ms)보다 짧아 메인 스레드에
    //      매 프레임 2~3회 불필요한 콜백을 쌓았음.
    //      rAF는 브라우저 렌더 파이프라인에 동기화되어 프레임당 정확히 1회만 실행되고,
    //      탭 비활성 시 자동으로 throttle되어 GC 압력도 함께 해소됨.
    //    · 락 활성 구간에서만 루프 실행 → 유휴 상태에서 rAF 프레임 소비 없음
    //    · isStoryPage() → URL 패턴 캐싱으로 반복 호출 최적화
    // =========================================================================

    let lastUserPos   = 0;
    let isLocked      = false;
    let clearTimer    = null;
    let startY        = 0;
    let rafHandle     = null;  // rAF 루프 핸들

    const isStoryPage = () => window.location.pathname.startsWith('/stories/');

    // '진짜 채팅창'만 정밀 타겟팅
    const getChatScroller = () => {
        if (!isStoryPage()) return null;
        const msgNode = document.querySelector('[data-message-group-id]');
        if (msgNode) return msgNode.closest('.overflow-y-auto');
        const flexScroller = document.querySelector('.overflow-y-auto.flex-col-reverse');
        if (flexScroller) return flexScroller;
        return null;
    };

    // ── rAF 기반 스크롤 동기화 루프 ──────────────────────────────────────────
    // 락이 활성화된 동안만 루프가 살아 있음.
    // 락 해제(isLocked = false) 시 cancelAnimationFrame으로 즉시 종료.
    function syncScrollFrame() {
        if (!isLocked) {
            rafHandle = null;
            return; // 락 해제 → 루프 종료
        }
        const el = getChatScroller();
        if (el && el.scrollTop !== lastUserPos) {
            el.scrollTop = lastUserPos;
        }
        rafHandle = requestAnimationFrame(syncScrollFrame);
    }

    function startDefense() {
        // 이미 rAF 루프가 살아 있으면 중복 시작 방지
        if (!rafHandle) {
            rafHandle = requestAnimationFrame(syncScrollFrame);
        }

        // 기존 clearTimer 갱신: 마지막 사용자 동작으로부터 3초 후 락 해제
        if (clearTimer) clearTimeout(clearTimer);
        clearTimer = setTimeout(() => {
            isLocked  = false;
            clearTimer = null;
            // rAF 루프는 syncScrollFrame 내부에서 isLocked 체크 후 자체 종료
        }, 3000);
    }

    const handleUserAction = (e, delta) => {
        if (!isStoryPage()) return;
        const el = getChatScroller();
        if (!el) return;
        if (!el.contains(e.target) && el !== e.target) return;

        if (delta < 0 || Math.abs(el.scrollTop) > 20) {
            isLocked    = true;
            lastUserPos = el.scrollTop;
            startDefense();
        } else {
            isLocked = false;
        }
    };

    window.addEventListener('wheel', (e) => handleUserAction(e, e.deltaY),   { passive: true, capture: true });
    window.addEventListener('touchstart', (e) => { startY = e.touches[0].pageY; }, { passive: true });
    window.addEventListener('touchmove',  (e) => {
        handleUserAction(e, startY - e.touches[0].pageY);
    }, { passive: true, capture: true });

    // 포커스 이동 시 강제 스크롤 차단 (채팅 영역 내에서만)
    const originalFocus = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (arg) {
        const chatEl = getChatScroller();
        if (isStoryPage() && isLocked && chatEl && chatEl.contains(this)) {
            const options = (typeof arg === 'object') ? arg : {};
            options.preventScroll = true;
            originalFocus.call(this, options);
        } else {
            originalFocus.apply(this, arguments);
        }
    };

    // 브라우저 자체 스크롤 자동 보정 비활성화
    const injectAntiScrollStyle = () => {
        if (document.getElementById('anti-scroll-style-stealth')) return;
        const style = document.createElement('style');
        style.id = 'anti-scroll-style-stealth';
        style.innerHTML = `.flex-col-reverse * { overflow-anchor: none !important; scroll-behavior: auto !important; }`;
        (document.head || document.documentElement).appendChild(style);
    };
    injectAntiScrollStyle();
    window.addEventListener('DOMContentLoaded', injectAntiScrollStyle);

    // 채팅방을 벗어나면 방어막 즉시 해제
    // ※ 원본의 500ms setInterval은 유지 (단순 플래그 토글, GC 부하 미미)
    setInterval(() => {
        if (!isStoryPage()) isLocked = false;
    }, 500);


    // =========================================================================
    //  ② 레이아웃 조절기 — 지연 실행 구역 (DOM 준비 후)
    //
    //  원본: Crack 레이아웃 조절기 v1.5.6
    //  변경(v1.5.8):
    //    · isBreaker()에 .wrtn-markdown-table(표 블럭) 추가
    //      → 컴팩트 모드에서 표가 이미지 옆 textEls로 끼어들지 않고
    //        인용문/코드블럭과 동일하게 .ck-group 바깥으로 분리되어 독립 행을 차지
    //    · 표 자체는 margin:0 auto로 중앙 정렬 (콘텐츠 폭보다 좁을 때 좌측 쏠림 방지)
    //    · 웹 모달 3종(대화 프로필 / 유저노트 / 최대 출력량 조절) 너비 슬라이더 추가
    //      → 대화 프로필: HTML width="444px" 속성 selector (해시 클래스 비의존)
    //      → 유저노트: .max-w-lg + :has(textarea)로 동일 프리셋 다이얼로그와 구분
    //      → 최대 출력량 조절: .max-w-\[444px\].max-h-\[85dvh\] 조합 매칭
    //  변경(v1.5.9):
    //    · 프로필/출력량 조절 모달 슬라이더 범위 확장 (360~680 → 360~900, 기본 444 동일)
    //    · 두 모달 내부 블록을 :has()+grid-template-columns: auto-fit/minmax로
    //      "충분한 너비가 되면 자동 2열(1,2 / 3,4) reflow" 처리
    //      (모달 폭이 좁으면 1열 유지, 슬라이더로 넓히면 자연스럽게 2열로 전환 — 별도 breakpoint 불필요)
    // =========================================================================

    // ── 설정 ─────────────────────────────────────────────────────────────────
    const CFG = {
        chatWidth:     GM_getValue('ck_chatWidth',     768),
        compactMode:   GM_getValue('ck_compactMode',   false),
        profileWidth:  GM_getValue('ck_profileWidth',  444),
        userNoteWidth: GM_getValue('ck_userNoteWidth', 512),
        outputWidth:   GM_getValue('ck_outputWidth',   444),
    };

    function save() {
        GM_setValue('ck_chatWidth',     CFG.chatWidth);
        GM_setValue('ck_compactMode',   CFG.compactMode);
        GM_setValue('ck_profileWidth',  CFG.profileWidth);
        GM_setValue('ck_userNoteWidth', CFG.userNoteWidth);
        GM_setValue('ck_outputWidth',   CFG.outputWidth);
    }

    // ── CSS 주입 ──────────────────────────────────────────────────────────────
    function injectCSS() {
        const ID = 'ck-layout-style';
        const el = document.getElementById(ID) || (() => {
            const s = document.createElement('style');
            s.id = ID;
            document.head.appendChild(s);
            return s;
        })();

        el.textContent = `
            /* ── 채팅 컬럼 너비 ── */
            div.max-w-\\[768px\\] {
                max-width: ${CFG.chatWidth}px !important;
            }
            /* ── 입력창 (채팅 컬럼 너비 추종) ── */
            div.max-w-\\[808px\\],
            div.max-w-\\[816px\\] {
                max-width: ${CFG.chatWidth}px !important;
            }
            /* ── 콘텐츠 이미지 높이 제한 ── */
            div.max-w-\\[768px\\] img {
                max-height: 440px !important;
                width: auto !important;
                height: auto !important;
            }
            /* ── Next.js fill 썸네일 보호 ── */
            div.max-w-\\[768px\\] img[data-nimg="fill"] {
                max-width: none !important;
                width: 100% !important;
                height: 100% !important;
            }
            /* ── 채팅 대표 이미지 보호 ── */
            div.max-w-\\[768px\\] img[width="100%"],
            div.max-w-\\[768px\\] img[height="100%"] {
                max-width: none !important;
                width: 100% !important;
                height: 100% !important;
                object-fit: cover !important;
            }
            /* ── 소형 아이콘 보호 ── */
            div.max-w-\\[768px\\] img[width="20px"],
            div.max-w-\\[768px\\] img[height="20px"],
            div.max-w-\\[768px\\] img[width="25px"],
            div.max-w-\\[768px\\] img[height="25px"] {
                max-width: 25px !important;
                width: revert !important;
                height: revert !important;
            }
            /* ── 원형 아바타 보호 ── */
            div.max-w-\\[768px\\] img.rounded-full {
                max-height: none !important;
                max-width: none !important;
                width: 1.5rem !important;
                height: 1.5rem !important;
            }

            /* ── 컴팩트 모드: 그룹 BFC float ── */
            .ck-group {
                overflow: hidden;
                margin-bottom: 8px;
            }
            .ck-group-img {
                float: left !important;
                width: 45% !important;
                margin: 0 16px 8px 0 !important;
                padding: 0 !important;
            }
            .ck-group-img img.rounded-lg {
                width: 100% !important;
                max-width: 100% !important;
                height: auto !important;
                max-height: none !important;
                display: block !important;
            }

            /* ── 컴팩트 모드: 이미지-텍스트 상단 정렬 보정 ── */
            .ck-group-img .pt-5 {
                padding-top: 0 !important;
            }
            .ck-group-img + p,
            .ck-group-img + h1,
            .ck-group-img + h2,
            .ck-group-img + h3,
            .ck-group-img + h4,
            .ck-group-img + h5,
            .ck-group-img + h6 {
                margin-top: 0 !important;
            }

            /* ── 표 블럭: breaker 분리 후 폭이 좁을 때 중앙 정렬 ── */
            .wrtn-markdown-table {
                margin: 8px 0 !important;
            }
            .wrtn-markdown-table table {
                margin: 0 auto !important;
            }

            /* ── 대화 프로필 모달 너비 (HTML width 속성 selector, 해시 클래스 비의존) ── */
            #web-modal div[width="444px"] {
                width: ${CFG.profileWidth}px !important;
                max-width: ${CFG.profileWidth}px !important;
            }
            /* ── 유저노트 모달 너비 (.max-w-lg 프리셋 중 textarea 포함된 것만 한정) ── */
            div[role="dialog"].max-w-lg:has(textarea) {
                max-width: ${CFG.userNoteWidth}px !important;
            }
            /* ── 최대 출력량 조절 모달 너비 ── */
            div[role="dialog"][class*="max-w-[444px]"][class*="max-h-[85dvh]"] {
                max-width: ${CFG.outputWidth}px !important;
            }

            /* ── 대화 프로필 모달: 카드 블럭 자동 2열 grid (좁으면 1열 유지) ── */
            #web-modal div:has(> div[cursor="pointer"]) {
                display: grid !important;
                grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)) !important;
                gap: 10px 14px !important;
            }

            /* ── 최대 출력량 조절 모달: 모델별 블럭 자동 2열 grid ── */
            div[role="dialog"][class*="max-w-[444px]"][class*="max-h-[85dvh]"]
                div.flex.flex-col:has(> div.flex.flex-col.gap-4.py-6) {
                display: grid !important;
                grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)) !important;
                gap: 0 20px !important;
            }

            /* ── 패널 슬라이더 공통 ── */
            #ck-panel input[type=range] {
                -webkit-appearance: none;
                appearance: none;
                width: 100%;
                height: 3px;
                border-radius: 2px;
                background: #3a3835;
                outline: none;
                cursor: pointer;
                margin-top: 4px;
            }
            #ck-panel input[type=range]::-webkit-slider-thumb {
                -webkit-appearance: none;
                width: 16px; height: 16px; border-radius: 50%;
                background: #FFB938;
                box-shadow: 0 0 0 3px rgba(255,185,56,0.3);
                cursor: pointer;
            }
            #ck-panel input[type=range]::-moz-range-thumb {
                width: 16px; height: 16px; border: none; border-radius: 50%;
                background: #FFB938;
                box-shadow: 0 0 0 3px rgba(255,185,56,0.3);
                cursor: pointer;
            }
        `;
    }

    // ── 컴팩트 모드: DOM 그룹화 / 복구 ──────────────────────────────────────

    function isImgParagraph(el) {
        if (el.tagName !== 'P') return false;
        if (!el.querySelector('img.rounded-lg')) return false;
        const clone = el.cloneNode(true);
        let container = clone.querySelector('img.rounded-lg');
        while (container.parentElement && container.parentElement !== clone) {
            container = container.parentElement;
        }
        container.remove();
        return clone.textContent.trim().length === 0;
    }

    function isMixedImgParagraph(el) {
        if (el.tagName !== 'P') return false;
        if (!el.querySelector('img.rounded-lg')) return false;
        const clone = el.cloneNode(true);
        let container = clone.querySelector('img.rounded-lg');
        while (container.parentElement && container.parentElement !== clone) {
            container = container.parentElement;
        }
        container.remove();
        return clone.textContent.trim().length > 0;
    }

    function splitMixedParagraph(p) {
        const img = p.querySelector('img.rounded-lg');
        if (!img) return [p];

        let imgContainer = img;
        while (imgContainer.parentElement && imgContainer.parentElement !== p) {
            imgContainer = imgContainer.parentElement;
        }

        const beforeNodes = [];
        const afterNodes  = [];
        let found = false;

        for (const child of Array.from(p.childNodes)) {
            if (child === imgContainer) { found = true; continue; }
            if (!found) {
                if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() === '') continue;
                beforeNodes.push(child.cloneNode(true));
            } else {
                if (!afterNodes.length && child.nodeType === Node.TEXT_NODE && child.textContent.trim() === '') continue;
                afterNodes.push(child.cloneNode(true));
            }
        }

        const result = [];

        if (beforeNodes.length) {
            const bp = document.createElement('p');
            beforeNodes.forEach(n => bp.appendChild(n));
            result.push(bp);
        }

        const imgP = document.createElement('p');
        const imgClone = imgContainer.cloneNode(true);
        imgClone.classList.remove('pt-5');
        imgP.appendChild(imgClone);
        result.push(imgP);

        if (afterNodes.length) {
            const ap = document.createElement('p');
            afterNodes.forEach((n, i) => {
                if (i === 0 && n.nodeType === Node.TEXT_NODE) {
                    const cleaned = n.textContent.replace(/^\n+/, '');
                    if (cleaned.length === 0) return;
                    ap.appendChild(document.createTextNode(cleaned));
                } else {
                    ap.appendChild(n);
                }
            });
            if (ap.childNodes.length) result.push(ap);
        }

        return result;
    }

    function isBreaker(el) {
        return el.tagName === 'BLOCKQUOTE' ||
               el.tagName === 'TABLE' ||
               (el.tagName === 'DIV' && (
                   el.classList.contains('wrtn-codeblock') ||
                   el.classList.contains('wrtn-markdown-table')
               ));
    }

    function applyCompact(md) {
        if (md.dataset.ckCompact === '1') return;
        md.dataset.ckOrig    = md.innerHTML;
        md.dataset.ckCompact = '1';

        const children = Array.from(md.children);
        const expandedChildren = [];
        for (const child of children) {
            if (isMixedImgParagraph(child)) {
                expandedChildren.push(...splitMixedParagraph(child));
            } else {
                expandedChildren.push(child);
            }
        }

        const output = [];
        let i = 0;

        while (i < expandedChildren.length && !isImgParagraph(expandedChildren[i])) {
            output.push({ type: 'standalone', el: expandedChildren[i] });
            i++;
        }

        while (i < expandedChildren.length) {
            if (isImgParagraph(expandedChildren[i])) {
                const imgEl      = expandedChildren[i];
                const textEls    = [];
                const breakerEls = [];
                i++;

                while (i < expandedChildren.length && !isImgParagraph(expandedChildren[i])) {
                    if (expandedChildren[i].tagName === 'HR') {
                        breakerEls.push(expandedChildren[i]);
                        i++;
                        break;
                    } else if (isBreaker(expandedChildren[i])) {
                        breakerEls.push(expandedChildren[i]);
                    } else {
                        textEls.push(expandedChildren[i]);
                    }
                    i++;
                }

                output.push({ type: 'group', imgEl, textEls, breakerEls });
            } else {
                output.push({ type: 'standalone', el: expandedChildren[i] });
                i++;
            }
        }

        if (!output.some(o => o.type === 'group')) return;

        md.innerHTML = '';
        output.forEach(item => {
            if (item.type === 'group') {
                const wrapper = document.createElement('div');
                wrapper.className = 'ck-group';
                item.imgEl.classList.add('ck-group-img');
                const pt5 = item.imgEl.querySelector('.pt-5');
                if (pt5) pt5.classList.remove('pt-5');
                wrapper.appendChild(item.imgEl);
                item.textEls.forEach(el => wrapper.appendChild(el));
                md.appendChild(wrapper);
                item.breakerEls.forEach(el => md.appendChild(el));
            } else {
                md.appendChild(item.el);
            }
        });
    }

    function restoreCompact(md) {
        if (md.dataset.ckCompact !== '1') return;
        if (md.dataset.ckOrig) md.innerHTML = md.dataset.ckOrig;
        delete md.dataset.ckCompact;
        delete md.dataset.ckOrig;
    }

    function applyCompactAll()  { document.querySelectorAll('.wrtn-markdown').forEach(applyCompact); }
    function removeCompactAll() { document.querySelectorAll('.wrtn-markdown[data-ck-compact]').forEach(restoreCompact); }

    // ── 플로팅 UI ─────────────────────────────────────────────────────────────
    function buildUI() {
        if (document.getElementById('ck-fab')) return;

        const fab = document.createElement('button');
        fab.id = 'ck-fab';
        fab.title = '레이아웃 조절';
        fab.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 3H3"/><path d="M21 21H3"/><path d="M6 12H18"/><path d="M15 8l3 4-3 4"/><path d="M9 8L6 12l3 4"/></svg>`;
        Object.assign(fab.style, {
            position:'fixed', bottom:'80px', right:'80px', zIndex:'999',
            width:'40px', height:'40px', display:'flex',
            alignItems:'center', justifyContent:'center',
            borderRadius:'50%', background:'#242321',
            border:'1px solid #3a3835', color:'#FFB938',
            cursor:'pointer', boxShadow:'0 2px 8px rgba(0,0,0,0.5)',
            transition:'background .15s, transform .15s',
        });
        fab.addEventListener('mouseenter', () => { fab.style.background = '#2E2D2B'; fab.style.transform = 'scale(1.08)'; });
        fab.addEventListener('mouseleave', () => { fab.style.background = '#242321'; fab.style.transform  = 'scale(1)'; });

        const panel = document.createElement('div');
        panel.id = 'ck-panel';
        Object.assign(panel.style, {
            position:'fixed', bottom:'130px', right:'68px', zIndex:'999',
            width:'220px', background:'#1E1D1C',
            border:'1px solid #3a3835', borderRadius:'12px',
            padding:'16px', boxShadow:'0 8px 24px rgba(0,0,0,0.6)',
            display:'none', flexDirection:'column', fontFamily:'inherit',
        });

        function makeRow(labelText, valueText) {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex; justify-content:space-between; margin-bottom:6px;';
            const lbl = document.createElement('span');
            lbl.style.cssText = 'font-size:0.75rem; color:#85837D;';
            lbl.textContent = labelText;
            const val = document.createElement('span');
            val.style.cssText = 'font-size:0.75rem; font-weight:600; color:#F0EFEB;';
            val.textContent = valueText;
            row.appendChild(lbl); row.appendChild(val);
            return { row, val };
        }
        function makeSlider(min, max, step, value) {
            const s = document.createElement('input');
            s.type = 'range'; s.min = min; s.max = max; s.step = step; s.value = value;
            return s;
        }
        function makeHr() {
            const d = document.createElement('div');
            d.style.cssText = 'height:1px; background:#3a3835; margin:14px 0 12px;';
            return d;
        }

        // 타이틀
        const titleEl = document.createElement('div');
        Object.assign(titleEl.style, { fontSize:'0.8125rem', fontWeight:'600', color:'#F0EFEB', marginBottom:'14px', display:'flex', alignItems:'center', gap:'6px' });
        titleEl.innerHTML = `<span style="color:#FFB938">◀▶</span> 레이아웃 조절`;
        panel.appendChild(titleEl);

        // 채팅 컬럼 너비
        const { row: wRow, val: wVal } = makeRow('채팅 컬럼 너비', CFG.chatWidth + 'px');
        const wSlider = makeSlider(600, 1320, 40, CFG.chatWidth);
        wSlider.addEventListener('input', () => {
            CFG.chatWidth = parseInt(wSlider.value, 10);
            wVal.textContent = CFG.chatWidth + 'px';
            save(); injectCSS();
        });
        panel.appendChild(wRow); panel.appendChild(wSlider);
        panel.appendChild(makeHr());

        // 대화 프로필 모달 너비
        const { row: pRow, val: pVal } = makeRow('프로필 모달 너비', CFG.profileWidth + 'px');
        const pSlider = makeSlider(360, 840, 20, CFG.profileWidth);
        pSlider.addEventListener('input', () => {
            CFG.profileWidth = parseInt(pSlider.value, 10);
            pVal.textContent = CFG.profileWidth + 'px';
            save(); injectCSS();
        });
        panel.appendChild(pRow); panel.appendChild(pSlider);

        // 유저노트 모달 너비
        const { row: nRow, val: nVal } = makeRow('유저노트 모달 너비', CFG.userNoteWidth + 'px');
        const nSlider = makeSlider(400, 840, 20, CFG.userNoteWidth);
        nSlider.addEventListener('input', () => {
            CFG.userNoteWidth = parseInt(nSlider.value, 10);
            nVal.textContent = CFG.userNoteWidth + 'px';
            save(); injectCSS();
        });
        panel.appendChild(nRow); panel.appendChild(nSlider);

        // 최대 출력량 조절 모달 너비
        const { row: oRow, val: oVal } = makeRow('출력량 모달 너비', CFG.outputWidth + 'px');
        const oSlider = makeSlider(360, 840, 20, CFG.outputWidth);
        oSlider.addEventListener('input', () => {
            CFG.outputWidth = parseInt(oSlider.value, 10);
            oVal.textContent = CFG.outputWidth + 'px';
            save(); injectCSS();
        });
        panel.appendChild(oRow); panel.appendChild(oSlider);

        panel.appendChild(makeHr());

        // 컴팩트 모드 토글
        const compactRow = document.createElement('div');
        compactRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;';
        const compactLbl = document.createElement('span');
        compactLbl.style.cssText = 'font-size:0.75rem; color:#85837D;';
        compactLbl.textContent = '컴팩트 모드';

        const toggleWrap = document.createElement('label');
        toggleWrap.style.cssText = 'position:relative; display:inline-block; width:32px; height:18px; cursor:pointer;';
        const toggleInput = document.createElement('input');
        toggleInput.type = 'checkbox'; toggleInput.checked = CFG.compactMode;
        toggleInput.style.cssText = 'opacity:0; width:0; height:0; position:absolute;';
        const tTrack = document.createElement('span');
        tTrack.style.cssText = `position:absolute; inset:0; border-radius:18px; transition:background .2s; background:${CFG.compactMode ? '#FFB938' : '#3a3835'};`;
        const tKnob = document.createElement('span');
        tKnob.style.cssText = `position:absolute; width:12px; height:12px; background:#F0EFEB; border-radius:50%; top:3px; transition:left .2s; left:${CFG.compactMode ? '17px' : '3px'};`;
        tTrack.appendChild(tKnob);
        toggleWrap.appendChild(toggleInput); toggleWrap.appendChild(tTrack);
        compactRow.appendChild(compactLbl); compactRow.appendChild(toggleWrap);
        panel.appendChild(compactRow);

        toggleInput.addEventListener('change', () => {
            CFG.compactMode = toggleInput.checked;
            tTrack.style.background = CFG.compactMode ? '#FFB938' : '#3a3835';
            tKnob.style.left        = CFG.compactMode ? '17px' : '3px';
            save();
            CFG.compactMode ? applyCompactAll() : removeCompactAll();
        });

        panel.appendChild(makeHr());

        // 초기화 버튼
        const resetBtn = document.createElement('button');
        resetBtn.textContent = '기본값으로 초기화';
        resetBtn.style.cssText = `width:100%; padding:6px 0; background:rgba(255,185,56,0.08); border:1px solid rgba(255,185,56,0.25); border-radius:7px; color:#FFB938; font-size:0.6875rem; cursor:pointer; transition:background .15s;`;
        resetBtn.addEventListener('mouseenter', () => { resetBtn.style.background = 'rgba(255,185,56,0.18)'; });
        resetBtn.addEventListener('mouseleave', () => { resetBtn.style.background = 'rgba(255,185,56,0.08)'; });
        resetBtn.addEventListener('click', () => {
            CFG.chatWidth = 768; wSlider.value = 768; wVal.textContent = '768px';
            CFG.profileWidth = 444; pSlider.value = 444; pVal.textContent = '444px';
            CFG.userNoteWidth = 512; nSlider.value = 512; nVal.textContent = '512px';
            CFG.outputWidth = 444; oSlider.value = 444; oVal.textContent = '444px';
            if (CFG.compactMode) {
                removeCompactAll();
                CFG.compactMode = false; toggleInput.checked = false;
                tTrack.style.background = '#3a3835'; tKnob.style.left = '3px';
            }
            save(); injectCSS();
        });
        panel.appendChild(resetBtn);

        const note = document.createElement('div');
        note.style.cssText = 'margin-top:8px; font-size:0.625rem; color:#61605A; text-align:center;';
        note.textContent = '설정은 자동 저장됩니다';
        panel.appendChild(note);

        let open = false;
        fab.addEventListener('click', () => {
            open = !open;
            panel.style.display   = open ? 'flex' : 'none';
            fab.style.background  = open ? '#2E2D2B' : '#242321';
            fab.style.borderColor = open ? '#FFB938' : '#3a3835';
        });
        document.addEventListener('click', e => {
            if (open && !panel.contains(e.target) && e.target !== fab) {
                open = false;
                panel.style.display   = 'none';
                fab.style.background  = '#242321';
                fab.style.borderColor = '#3a3835';
            }
        }, true);

        document.body.appendChild(fab);
        document.body.appendChild(panel);
    }

    // ── 초기화 ───────────────────────────────────────────────────────────────
    function init() {
        injectCSS();
        buildUI();
        if (CFG.compactMode) setTimeout(applyCompactAll, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // =========================================================================
    //  ③ 통합 MutationObserver
    //
    //  원본 레이아웃 조절기의 MutationObserver와 스크롤 차단의 별도 감시를 하나로 통합.
    //  · SPA 라우팅 감지 → injectCSS 재실행
    //  · 컴팩트 모드 활성 시 새 .wrtn-markdown 감지 → applyCompactAll
    //  스크롤 차단은 이벤트 리스너 기반이므로 Observer 추가 항목 없음.
    // =========================================================================
    let lastHref = location.href;
    let mdTimer  = null;

    new MutationObserver(mutations => {
        if (location.href !== lastHref) {
            lastHref = location.href;
            setTimeout(injectCSS, 600);
        }
        if (CFG.compactMode) {
            const hasNew = mutations.some(m =>
                Array.from(m.addedNodes).some(n =>
                    n.nodeType === 1 && (
                        n.classList?.contains('wrtn-markdown') ||
                        n.querySelector?.('.wrtn-markdown')
                    )
                )
            );
            if (hasNew) { clearTimeout(mdTimer); mdTimer = setTimeout(applyCompactAll, 600); }
        }
    }).observe(document.body, { childList: true, subtree: true });

})();
