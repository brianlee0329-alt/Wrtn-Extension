// ==UserScript==
// @name         Crack 레이아웃 조절기
// @namespace    https://github.com/local/crack-layout
// @version      1.6.2
// @description  채팅창 너비 조절 + 컴팩트 모드
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

    // 모델 선택창의 동적 생성 변화를 감지하고 레이아웃을 재배치하는 함수
    // (v1.6.4: cmdk 콤보박스에서 다시 개편 — cmdk-* 속성과 role="option"이 모두
    //  사라지고, 그냥 <div class="flex flex-col"> 안에 <button> 12개가 나란히
    //  들어있는 형태로 단순화됨(role="dialog"만 남음). cmdk-list-sizer selector가
    //  0건 매칭되어 전체 기능이 다시 무효화된 상태였음.
    //  새 구조: role="dialog"(바깥 박스, 폭/높이 대상) 직계 자식 div.flex.flex-col
    //         (옵션 직계 부모, 구 viewport/sizer 역할) 안에 <button> 12개
    //  ⚠ role="dialog"는 플랫폼에 흔해서, 모델 카드 특유의
    //    img[src*="model-icon/"] 아이콘이 전부 있는 컨테이너인지 확인해서만
    //    동작하도록 판별 조건을 추가함 (다른 팝오버 오작동 방지)
    //  ※ 신규 모델 추가(하이퍼챗 4.0)로 총 11→12개로 늘었으나 키워드 분류
    //    로직('하이퍼' 포함 매칭)은 그대로 커버됨 — 변경 불필요)
    const adjustModelModalLayout = () => {
        const dialogs = document.querySelectorAll('div[role="dialog"]');

        dialogs.forEach(content => {
            const container = content.querySelector(':scope > div.flex.flex-col');
            if (!container) return;

            // 무한 루프를 방지하기 위해 이미 처리된 요소는 건너뜁니다.
            if (container.dataset.customLayoutApplied) return;

            const options = Array.from(container.querySelectorAll(':scope > button'));
            if (options.length === 0) return;

            // 모델 선택 모달인지 판별: 모든 버튼이 모델 아이콘을 갖고 있어야 함
            const isModelModal = options.every(btn => btn.querySelector('img[src*="model-icon/"]'));
            if (!isModelModal) return;

            // 1. 위치 버그 해결: 최상위 래퍼가 아닌 '내부 컨텐츠'의 너비를 늘립니다.
            content.style.position = 'relative'; // 확장 버튼 절대배치 기준점 확보
            content.style.width = '850px'; // 3열을 수용할 충분한 너비
            content.style.maxWidth = '90vw'; // 화면을 벗어나지 않도록 제한

            // 2. CSS Grid 활성화
            container.style.display = 'grid';
            container.style.gridTemplateColumns = 'repeat(3, 1fr)';
            container.style.gap = '8px';
            container.style.padding = '10px';
            container.style.alignItems = 'start';

            // 3. 열 제목(헤더) 추가 함수
            const addHeader = (text, col) => {
                const header = document.createElement('div');
                header.textContent = text;
                header.style.gridColumn = col;
                header.style.gridRow = '1'; // 항상 첫 번째 줄에 고정
                header.style.fontWeight = 'bold';
                header.style.borderBottom = '1px solid rgba(128, 128, 128, 0.3)';
                header.style.paddingBottom = '5px';
                header.style.marginBottom = '5px';
                header.className = 'custom-grid-header';
                container.appendChild(header);
            };

            // 헤더가 중복 생성되지 않도록 검사 후 삽입
            if (!container.querySelector('.custom-grid-header')) {
                addHeader('하이엔드', '1');
                addHeader('스탠다드', '2');
                addHeader('엔트리', '3');
            }

            // 4. 모델 텍스트 기반 카테고리 분류 및 배치
            // 각 열(Column)별로 항목이 들어갈 행(Row) 번호를 추적합니다. (1행은 헤더)
            let highEndRow = 2, standardRow = 2, entryRow = 2, unclassifiedRow = 2;

            options.forEach(opt => {
                const text = opt.textContent;

                // 옵션 카드 시각적 개선
                opt.style.border = '1px solid rgba(128, 128, 128, 0.2)';
                opt.style.borderRadius = '6px';
                opt.style.padding = '8px';
                opt.style.height = 'auto';

                // 키워드에 따라 위치할 열(Column)과 행(Row)을 강제 지정합니다.
                if (text.includes('페이블') || text.includes('하이퍼')) {
                    opt.style.gridColumn = '1';
                    opt.style.gridRow = highEndRow++;
                } else if (text.includes('슈퍼') || text.includes('프로')) {
                    opt.style.gridColumn = '2';
                    opt.style.gridRow = standardRow++;
                } else if (text.includes('파워')) {
                    opt.style.gridColumn = '3';
                    opt.style.gridRow = entryRow++;
                } else {
                    // 향후 새로운 모델이 추가될 경우 하단 전체를 차지하도록 예외 처리 (오류 방지)
                    opt.style.gridColumn = '1 / span 3';
                    opt.style.gridRow = Math.max(highEndRow, standardRow, entryRow) + unclassifiedRow++;
                }
            });

            // 5. 상하 길이 확장 토글 버튼 삽입 (content당 1회만)
            if (!content.querySelector('.ck-model-expand-btn')) {
                const expandBtn = document.createElement('button');
                expandBtn.type = 'button';
                expandBtn.className = 'ck-model-expand-btn';
                expandBtn.setAttribute('aria-label', '모델 목록 펼치기/접기');
                expandBtn.style.cssText = [
                    'position:absolute', 'top:6px', 'right:8px', 'z-index:20',
                    'display:flex', 'align-items:center', 'justify-content:center',
                    'width:22px', 'height:22px', 'padding:0', 'border:none',
                    'background:rgba(128,128,128,0.15)', 'border-radius:4px',
                    'cursor:pointer', 'transition:transform .2s',
                ].join(';');
                expandBtn.innerHTML = '<svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width:16px;height:16px;pointer-events:none;"><path clip-rule="evenodd" fill-rule="evenodd" d="m5.645 9.566 1.13-1.132L12 13.66l5.224-5.225 1.132 1.132L12 15.92z"></path></svg>';

                const applyExpandState = () => {
                    if (CFG.modelModalExpanded) {
                        content.style.height = 'var(--radix-popper-available-height, 90vh)';
                        expandBtn.style.transform = 'rotate(180deg)';
                    } else {
                        content.style.height = ''; // 비워서 플랫폼 기본 h-[min(569px,...)] 클래스로 복귀
                        expandBtn.style.transform = 'rotate(0deg)';
                    }
                };
                applyExpandState();

                expandBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    CFG.modelModalExpanded = !CFG.modelModalExpanded;
                    save();
                    applyExpandState();
                });

                content.appendChild(expandBtn);
            }

            // 처리가 완료되었음을 표시
            container.dataset.customLayoutApplied = 'true';
        });
    };

    // DOM의 변화를 감시하다가 모달이 팝업되면 즉시 재배치 함수를 실행합니다.
    // (스크립트 로드 시 단 1회만 생성/구독됨)
    const modelModalObserver = new MutationObserver(adjustModelModalLayout);
    modelModalObserver.observe(document.body, { childList: true, subtree: true });

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
    //  변경(v1.6.0):
    //    · 대화 프로필 모달 플랫폼 구조 변경 대응
    //      - 기존: #web-modal 내부, 커스텀 width="444px" HTML 속성 보유
    //      - 변경: 표준 Radix Dialog(role="dialog")로 교체, width 속성 소멸,
    //        대신 max-w-[444px] Tailwind 클래스로 폭 지정 (출력량 조절 모달과 동일 패턴)
    //      - #web-modal 래퍼 존재 여부가 불확실해짐 → id 의존 제거, role="dialog" 속성 기반으로 전환
    //      - 출력량 조절 모달과 max-w-[444px] 클래스를 공유하므로 max-h-[85dvh] 부재로 구분
    //    · 카드 블럭 grid selector: cursor="pointer" 속성 → cursor-pointer 클래스로 변경 대응
    //  변경(v1.6.1):
    //    · 컴팩트 모드 그룹핑 버그 수정: 인용문(BLOCKQUOTE)이 이미지-텍스트 그룹 내
    //      원래 위치를 잃고 그룹 맨 끝(텍스트 전부 뒤)으로 밀려나던 문제
    //      - 원인: HR만 발견 즉시 그룹을 끊었고, 인용문/표/코드블럭은 breakerEls에만
    //        쌓아두고 계속 다음 요소를 흡수 → 렌더 시 breakerEls가 textEls 전부 뒤에
    //        일괄 배치되어 원래 문서상 위치(중간)를 잃음
    //      - 수정: isBreaker()에 HR 통합, 모든 breaker(HR/인용문/표/코드블럭)가
    //        발견 즉시 그룹을 종료하도록 통일 → 원본 문서 순서 그대로 보존되며
    //        그 자리에서 독립된 한 줄(row)을 차지
    // =========================================================================

    // ── 설정 ─────────────────────────────────────────────────────────────────
    const CFG = {
        chatWidth:     GM_getValue('ck_chatWidth',     768),
        compactMode:   GM_getValue('ck_compactMode',   false),
        profileWidth:  GM_getValue('ck_profileWidth',  444),
        userNoteWidth: GM_getValue('ck_userNoteWidth', 512),
        outputWidth:   GM_getValue('ck_outputWidth',   444),
        modelModalExpanded: GM_getValue('ck_modelModalExpanded', false),
    };

    function save() {
        GM_setValue('ck_chatWidth',     CFG.chatWidth);
        GM_setValue('ck_compactMode',   CFG.compactMode);
        GM_setValue('ck_profileWidth',  CFG.profileWidth);
        GM_setValue('ck_userNoteWidth', CFG.userNoteWidth);
        GM_setValue('ck_outputWidth',   CFG.outputWidth);
        GM_setValue('ck_modelModalExpanded', CFG.modelModalExpanded);
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

            /* ── 대화 프로필 모달 너비 ──
               v1.6.0: width="444px" 속성 → max-w-[444px] 클래스로 대체됨.
               출력량 조절 모달과 max-w-[444px]를 공유하므로 max-h-[85dvh] 부재로 구분.
               (class*="..." 는 속성 문자열 내부 매칭이라 대괄호 이스케이프 불필요) */
            div[role="dialog"][class*="max-w-[444px]"]:not([class*="max-h-[85dvh]"]) {
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

            /* ── 대화 프로필 모달: 카드 블럭 자동 2열 grid (좁으면 1열 유지) ──
               v1.6.0: cursor="pointer" 속성 → cursor-pointer 클래스로 변경됨에 따라 수정 */
            div[role="dialog"][class*="max-w-[444px]"]:not([class*="max-h-[85dvh]"]) div:has(> div.cursor-pointer) {
                display: grid !important;
                grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)) !important;
                gap: 10px 14px !important;
            }

            /* ── 최대 출력량 조절 모달: 모델별 아코디언 자동 2열 grid ──
               플랫폼이 항상-펼침 카드 목록 → Radix Accordion(한 번에 하나만 펼침)으로 개편.
               구 selector(.flex.flex-col.gap-4.py-6)의 대상이 사라져 완전히 무효화됨.
               - 리스트 컨테이너: data-orientation="vertical" + .flex.flex-col 인데
                 항목(border-outline_tertiary)은 아니므로 :not()으로 구분
               - 각 항목 자체가 data-state="open/closed" 속성을 직접 가짐(:has() 불필요)
               - 열린 항목은 grid-column: 1/-1로 자기 행 전체를 단독 차지 →
                 접힌 옆 칸 높이에 영향 주지 않음 */
            div[role="dialog"][class*="max-w-[444px]"][class*="max-h-[85dvh]"]
                div[data-orientation="vertical"].flex.flex-col:not([class*="border-outline_tertiary"]) {
                display: grid !important;
                grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)) !important;
                gap: 0 20px !important;
                align-items: start !important;
            }
            div[role="dialog"][class*="max-w-[444px]"][class*="max-h-[85dvh]"]
                div[class*="border-outline_tertiary"][data-state="open"] {
                grid-column: 1 / -1 !important;
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
        return el.tagName === 'HR' ||
               el.tagName === 'BLOCKQUOTE' ||
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
                    if (isBreaker(expandedChildren[i])) {
                        breakerEls.push(expandedChildren[i]);
                        i++;
                        break;
                    }
                    textEls.push(expandedChildren[i]);
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
