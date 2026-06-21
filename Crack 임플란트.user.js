// ==UserScript==
// @name         Crack 임플란트
// @namespace    https://crack.wrtn.ai
// @version      2.1.0
// @description  카드 이미지에 0.8초 호버 → 말풍선 / 메인 페이지 모달 억제 / 나만의 태그 (말풍선·모달·작품페이지) / 좋아요 페이지 나만의 태그 탭
// @match        https://crack.wrtn.ai/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════
     § 0. 설정
     ══════════════════════════════════════════════════════════════ */
  const HOVER_DELAY  = 800;
  const BUBBLE_GAP   = 12;
  const BUBBLE_W     = 340;
  const BUBBLE_MAX_H = 650;
  const API_BASE     = 'https://crack-api.wrtn.ai/crack-api';

  /* ══════════════════════════════════════════════════════════════
     § 1. 캐시 + fetch/XHR 인터셉트
     ══════════════════════════════════════════════════════════════ */
  const cache = new Map();

  /* ── fetch 인터셉터 ─────────────────────────────────────────────
     GC 최적화 (v1.3.0):
       기존 res.clone().json()은 Response 전체를 복사(ArrayBuffer + 헤더)
       한 뒤 JSON 파싱 트리까지 생성 → Young Gen에 대형 객체 3종 세트.
       AI 답변 스트리밍 중 crack-api 요청이 연속 발생하면 이 사이클이
       연속으로 반복되며 Minor GC를 조기에 유발했음.

       ReadableStream.tee()로 대체:
         body 스트림을 두 갈래(branch1, branch2)로 분기한다.
         branch1은 새 Response에 실어 호출자에게 그대로 반환하고,
         branch2는 우리 측에서 text()로 읽어 JSON.parse.
         복사되는 것은 스트림 참조(포인터)뿐 — ArrayBuffer 실체는
         딱 한 번만 메모리에 올라가고, 두 소비자가 각자 읽어간다.
         Response 복사 객체가 생성되지 않으므로 GC 압력이 절반 이하로 감소.

       주의: tee()는 body가 이미 소비됐거나 null인 경우(204, HEAD 응답 등)
       TypeError를 던질 수 있음 → try-catch로 보호하고, 실패 시
       원본 res를 그대로 반환해 호출자가 영향받지 않도록 처리.
  ─────────────────────────────────────────────────────────────── */
  const _origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await _origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url ?? '');
      if (_isTargetUrl(url) && res.body) {
        // body가 존재할 때만 tee() 시도
        const [branch1, branch2] = res.body.tee();
        // branch2를 비동기로 소비 (호출자 흐름과 완전히 분리)
        new Response(branch2).text().then(txt => {
          try { _digestJson(url, JSON.parse(txt)); } catch (_) {}
        }).catch(() => {});
        // 호출자에게는 branch1을 body로 갖는 새 Response를 반환
        // headers, status, statusText는 원본에서 그대로 복사
        return new Response(branch1, {
          status:     res.status,
          statusText: res.statusText,
          headers:    res.headers,
        });
      }
    } catch (_) {}
    return res;
  };

  const _origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, url, ...r) {
    this._crkUrl = url; return _origOpen.call(this, m, url, ...r);
  };
  const _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...a) {
    this.addEventListener('load', () => {
      try {
        const url = this._crkUrl ?? '';
        if (_isTargetUrl(url)) _digestJson(url, JSON.parse(this.responseText));
      } catch (_) {}
    });
    return _origSend.apply(this, a);
  };

  function _isTargetUrl(url) {
    return url.includes('crack-api.wrtn.ai') ||
           url.includes('/api/stories') || url.includes('/api/characters');
  }

  function _digestJson(url, json) {
    /* GC 최적화 (v1.3.0):
       WeakSet을 traverse 클로저 내부에서 선언하면 _digestJson 호출마다
       신규 WeakSet이 생성됐음. traverse는 재귀 호출이므로 WeakSet 자체는
       1개지만, 선언 위치가 클로저 안에 있어도 호출 스택마다 새 환경 레코드에
       바인딩되는 것처럼 보임. 실제로는 클로저가 한 번만 생성되지만,
       _digestJson 호출마다 WeakSet이 재초기화됨 → 여기서 꺼내 1회만 생성.
    */
    const visited = new WeakSet();

    function traverse(obj) {
      if (!obj || typeof obj !== 'object') return;
      if (visited.has(obj)) return;
      visited.add(obj);

      const id = obj._id ?? obj.id;
      if (id && /^[a-f0-9]{24}$/.test(String(id))) {
        if (obj.name || obj.title || obj.simpleDescription || obj.description) {
          if (!cache.has(id) || cache.get(id)._partial) {
            const info = _buildInfo(obj);
            if (info.title) cache.set(id, info);
          }
        }
      }

      if (Array.isArray(obj)) {
        for (let i = 0; i < obj.length; i++) traverse(obj[i]);
      } else {
        for (const key in obj) {
          if (Object.prototype.hasOwnProperty.call(obj, key)) traverse(obj[key]);
        }
      }
    }

    try { traverse(json); } catch(_) {}
  }

  /* ══════════════════════════════════════════════════════════════
     § 2. API 데이터 → CardInfo 변환
     ══════════════════════════════════════════════════════════════ */
  function _buildInfo(d) {
    const rawTags = d.hashtags ?? d.tags ?? [];
    const tags = rawTags.map(t => {
      const s = typeof t === 'string' ? t : (t?.name ?? t?.tag ?? t?.value ?? '');
      return s ? (s.startsWith('#') ? s : '#' + s) : null;
    }).filter(Boolean);

    const options = [];

    if (d.hasImage && d.imageCount > 0)
      options.push(`이미지 ${d.imageCount}장`);

    const tplName = typeof d.promptTemplate === 'string'
      ? d.promptTemplate
      : (d.promptTemplate?.name ?? d.promptTemplate?.type ?? null);
    if (tplName) options.push(String(tplName));

    const targetName = typeof d.target === 'string'
      ? d.target
      : (d.target?.name ?? null);
    if (targetName) options.push(String(targetName));

    const chatTypeName = typeof d.chatType === 'string'
      ? d.chatType
      : (d.chatType?.name ?? null);
    if (chatTypeName) options.push(String(chatTypeName));

    if (d.originContentTitle)
      options.push('2차 창작 : ' + String(d.originContentTitle));

    const intro =
      _str(d.simpleDescription) ??
      _str(d.intro) ??
      _str(d.tagline) ??
      _str(d.oneliner) ??
      null;

    const description = _str(d.detailDescription) ?? _str(d.description) ?? null;

    const isRich = !!(
      d.description || d.simpleDescription || d.detailDescription ||
      d.promptTemplate || d.target || d.chatType ||
      (d.imageCount > 0) || d.originContentTitle ||
      (d.tags?.length > 0) || (d.hashtags?.length > 0)
    );

    return {
      _id:          _str(d._id ?? d.id),
      title:        _str(d.name ?? d.title),
      creator:      _str(d.creator?.nickname ?? d.author?.nickname ?? d.creator?.name),
      options,
      intro,
      description,
      tags,
      chatCount:    _fmt(d.chatCount ?? d.totalMessageCount ?? d.playCount),
      likeCount:    _fmt(d.likeCount),
      commentCount: _fmt(d.commentCount),
      _partial:     !isRich,
    };
  }

  function _str(v) {
    if (v == null) return null;
    if (typeof v === 'string') return v.trim() || null;
    if (typeof v === 'object') {
      const t = v.content ?? v.text ?? v.value ?? v.body ?? v.description
              ?? v.intro ?? v.summary ?? v.name;
      return typeof t === 'string' ? t.trim() || null : null;
    }
    const s = String(v).trim();
    return s === '[object Object]' ? null : s || null;
  }

  /* ══════════════════════════════════════════════════════════════
     § 3. __NEXT_DATA__ 초기 캐싱
     ══════════════════════════════════════════════════════════════ */
  function _tryNextData() {
    try {
      const pp = window.__NEXT_DATA__?.props?.pageProps;
      if (pp) _digestJson('__NEXT_DATA__', pp);
    } catch (_) {}
  }
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', _tryNextData);
  else setTimeout(_tryNextData, 0);

  /* ══════════════════════════════════════════════════════════════
     § 4. 모달 DOM 파싱
     ══════════════════════════════════════════════════════════════ */
  function _parseModal(root) {
    const titleEl =
      root.querySelector('[color="text_primary"][class*="typo-text-lg"]') ??
      root.querySelector('p.typo-text-lg_leading-paragraph_semibold');
    if (!titleEl?.textContent?.trim()) return null;
    const title = titleEl.textContent.trim();

    const creatorEl = root.querySelector('.text-line-gray-1, [class*="text-line-gray-1"]');
    const creator = creatorEl?.textContent?.trim() || null;

    const options = Array.from(root.querySelectorAll('[data-clipping="true"]'))
      .map(el => el.textContent.trim()).filter(Boolean);

    let intro = null;
    const ydEl = root.querySelector('.css-yd8sa2, [class*="css-yd8sa2"]');
    if (ydEl) {
      const firstP = ydEl.querySelector('p[color="text_primary"], p.css-ws11u4');
      intro = firstP?.textContent?.trim() || null;
    }
    if (!intro) {
      intro = root.querySelector('p.css-ws11u4')?.textContent?.trim() || null;
    }

    const mdEl = root.querySelector('.wrtn-markdown');
    const description = mdEl?.textContent?.trim() || null;

    const tags = Array.from(root.querySelectorAll('[color="text_secondary"]'))
      .map(el => el.textContent.trim()).filter(t => t.startsWith('#'));

    const statGroups = root.querySelectorAll('[class*="css-lcrd7a"]');
    let chatCount = null, likeCount = null, commentCount = null;
    statGroups.forEach((el, i) => {
      const txt = el.querySelector('p')?.textContent?.trim() ?? null;
      if (i === 0) chatCount    = txt;
      if (i === 1) likeCount    = txt;
      if (i === 2) commentCount = txt;
    });

    return { title, creator, options, intro, description,
             tags, chatCount, likeCount, commentCount, _fromDom: true };
  }

  /* ══════════════════════════════════════════════════════════════
     § 5. 카드 DOM 부분 파싱 (즉시 표시용)
     ══════════════════════════════════════════════════════════════ */
  function _parseCard(card) {
    const titleEl = card.querySelector(
      'p.typo-text-base_leading-paragraph_semibold, p[class*="typo-text-base"][class*="semibold"]'
    );
    const title = titleEl?.textContent?.trim() || null;
    if (!title) return null;

    const statEl = card.querySelector('p.text-line-gray-2, p[class*="text-line-gray-2"]');
    const chatCount = statEl?.textContent?.trim() || null;

    const creatorEl = card.querySelector('button[type="button"] p[class*="truncate"]');
    const creator = creatorEl?.textContent?.trim() || null;

    return {
      title, creator, options: [], intro: null, description: null,
      tags: [], chatCount, likeCount: null, commentCount: null, _partial: true,
    };
  }

  /* ══════════════════════════════════════════════════════════════
   § 6. 모달 자동 캐싱 + 메인 페이지 팝오버 억제
   ══════════════════════════════════════════════════════════════ */
  /* GC 최적화 (v1.3.0):
     §6 / §6.7 / §10의 MutationObserver 3개를 하나로 통합하고
     관찰 범위를 document.documentElement → document.body로 축소.
     <head> 변경(폰트, 메타 태그 등)은 모달/카드/mytags 주입과 무관하므로
     제외해도 기능에 영향 없음. SPA 전환 중 <head> 업데이트가 빈번한
     Next.js 환경에서 콜백 호출 횟수가 눈에 띄게 줄어든다.
     통합된 단일 Observer는 스크립트 말미(_initUnifiedObserver)에서 등록.
  */
  function _handleModalNode(node) {
    // ── 플랫폼 상세 모달 캐싱 ──
    const modal =
      (node.id === 'web-modal' ? node : null) ??
      node.querySelector?.('#web-modal') ??
      (node.className?.includes?.('css-jmmlw3') ? node : null) ??
      node.querySelector?.('[class*="css-jmmlw3"]');
    if (modal) {
      const tryExtract = () => {
        const link = modal.querySelector('a[href*="/detail/"]');
        if (!link) return;
        const m = link.getAttribute('href').match(/\/detail\/([a-f0-9]{24})/);
        if (!m) return;
        if (!cache.has(m[1]) || cache.get(m[1])._partial) {
          const info = _parseModal(modal);
          if (info) cache.set(m[1], info);
        }
        _injectMyTagsInModal(modal, m[1]);
      };
      setTimeout(tryExtract,  80);
      setTimeout(tryExtract, 350);
      setTimeout(tryExtract, 800);
      setTimeout(tryExtract, 1500);
    }

    // ── Floating UI 캐릭터 팝오버 억제 ──
    const portals = node.hasAttribute?.('data-floating-ui-portal')
      ? [node]
      : Array.from(node.querySelectorAll?.('[data-floating-ui-portal]') ?? []);

    portals.forEach(portal => {
      const popover = portal.querySelector('.z-popover') ?? portal;
      const trySuppress = () => {
        if (popover.querySelector('img[alt="character_thumbnail"]') && _isMainPage())
          _suppressModal(popover);
      };
      setTimeout(trySuppress,   0);
      setTimeout(trySuppress, 150);
      setTimeout(trySuppress, 400);
    });
  }

  /* ══════════════════════════════════════════════════════════════
     § 6.5 메인 페이지 플랫폼 모달 억제
     - 메인 페이지('/')에서만 작동 / 좋아요·프로필 페이지는 그대로
     - 데이터 캐싱(§6)은 억제 전 setTimeout으로 이미 예약되므로 손실 없음
     ══════════════════════════════════════════════════════════════ */
  function _isMainPage() {
    const p = location.pathname;
    return p === '/' || p === '';
  }

  let _suppressedModal = null;
  let _suppressObs     = null;

  function _suppressModal(modal) {
    if (_suppressObs) { _suppressObs.disconnect(); _suppressObs = null; }
    _suppressedModal = modal;

    const hide = () => {
      modal.style.setProperty('display',        'none',   'important');
      modal.style.setProperty('visibility',     'hidden', 'important');
      modal.style.setProperty('pointer-events', 'none',   'important');
    };

    // 즉시 숨김 + 플랫폼이 style을 되돌리려 해도 재억제
    hide();
    _suppressObs = new MutationObserver(hide);
    _suppressObs.observe(modal, {
      attributes:      true,
      attributeFilter: ['style', 'class'],
    });
  }

  function _releaseSuppression() {
    if (_suppressObs) { _suppressObs.disconnect(); _suppressObs = null; }
    if (_suppressedModal) {
      _suppressedModal.style.removeProperty('display');
      _suppressedModal.style.removeProperty('visibility');
      _suppressedModal.style.removeProperty('pointer-events');
      _suppressedModal = null;
    }
  }

  /* ══════════════════════════════════════════════════════════════
     § 6.6 SPA 라우팅 감지 — 페이지 전환 시 억제 해제/재적용
     Next.js는 history.pushState를 내부적으로 래핑하므로 직접 훅 필요
     ══════════════════════════════════════════════════════════════ */
  (function _hookRouter() {
    const _origPush    = history.pushState;
    const _origReplace = history.replaceState;

    const onRoute = () => {
      if (!_isMainPage()) {
        _releaseSuppression();
      } else if (_suppressedModal) {
        _suppressModal(_suppressedModal);
      }
      if (_isDetailPage()) {
        setTimeout(_injectMyTagsInDetailPage, 400);
        setTimeout(_injectMyTagsInDetailPage, 900);
      }
      // 좋아요 페이지 진입: 탭 초기화
      if (_isLikedPage()) {
        setTimeout(_initLikedTabs, 500);
        setTimeout(_initLikedTabs, 1200);
      } else {
        // 좋아요 페이지에서 이탈 시: 탭 상태 리셋
        // (DOM은 SPA가 교체하므로 플래그와 activeTab만 리셋)
        _likedTabsInited = false;
        _likedActiveTab  = 'story';
      }
    };

    history.pushState = function (...a) {
      _origPush.apply(this, a); onRoute();
    };
    history.replaceState = function (...a) {
      _origReplace.apply(this, a); onRoute();
    };
    window.addEventListener('popstate', onRoute);
  })();

  /* ══════════════════════════════════════════════════════════════
     § 6.7 작품 상세 페이지 (/detail/{id}) 나만의 태그 주입
     - URL에서 직접 id 추출 → .css-cmlkbw 다음에 주입
     - SPA 라우팅 전환 시 재적용
     ══════════════════════════════════════════════════════════════ */
  function _getDetailPageId() {
    const m = location.pathname.match(/\/detail\/([a-f0-9]{24})/);
    return m ? m[1] : null;
  }

  function _isDetailPage() {
    return /^\/detail\/[a-f0-9]{24}/.test(location.pathname);
  }

  /* css-cmlkbw가 없는 작품(해시태그 미등록)의 fallback.
     정상 작품에서는 [해시태그] → crk-mytags → [통계버튼] → 구분선 → 상세설명 순인데,
     해시태그가 없으면 구분선 앞에 바로 꽂혀 [통계버튼] → 구분선 → crk-mytags → 상세설명이
     되어 통계버튼 아래로 위치가 크게 밀린다. 통계버튼 그룹(css-1ktfy0c) 앞에 삽입하면
     해시태그 유무와 무관하게 항상 통계버튼 위쪽이라는 동일한 상대 위치를 유지할 수 있다. */
  function _findStatButtonAnchor(root) {
    const statGroup = root.querySelector('[class*="css-1ktfy0c"]');
    return statGroup ?? null;
  }

  function _findDetailSectionAnchor(root) {
    const ps = root.querySelectorAll('p');
    for (const p of ps) {
      if (p.textContent?.trim() === '상세 설명') {
        const section = p.parentElement; // 1단계만 — 제목+본문 wrapper
        const prevSibling = section?.previousElementSibling;
        if (prevSibling?.getAttribute('role') === 'none') return prevSibling;
        return section ?? p.closest('div');
      }
    }
    return null;
  }

  /* 앵커 우선순위:
     1) css-cmlkbw — 해시태그 칩 wrapper (다수 작품에서 정상 위치)
     2) css-1ktfy0c 통계버튼 그룹 앞 — 해시태그가 없을 때 위치 일관성 유지
     3) "상세 설명" 앞 구분선 — 위 둘 다 없는 경우의 최종 fallback */
  function _findMyTagAnchor(root) {
    const cmlkbw = root.querySelector('[class*="css-cmlkbw"]');
    if (cmlkbw) return cmlkbw;
    const statGroup = _findStatButtonAnchor(root);
    if (statGroup) {
      let prev = statGroup.previousElementSibling;
      // 이전 호출에서 이미 statGroup 바로 앞에 우리 crk-mytags를 삽입해둔 경우,
      // previousElementSibling이 우리 자신이 되어 "현재 위치가 곧 정답"이라는
      // 자기참조 루프에 빠진다. 그 경우는 우리 섹션의 이전 형제를 anchor로 써서
      // 동일한 (이미 맞는) 위치를 그대로 가리키게 한다.
      if (prev?.classList?.contains('crk-mytags')) prev = prev.previousElementSibling;
      if (prev) return prev;
    }
    return _findDetailSectionAnchor(root);
  }

  function _injectMyTagsInDetailPage() {
    if (!_isDetailPage()) return;
    const id = _getDetailPageId();
    if (!id) return;

    // 작품 상세 페이지 진입 시점에 스냅샷 보강
    // 좋아요 페이지 외부(검색·작가·상세 등)에서 태그 입력 시 카드 DOM이 없으므로
    // og:image 메타태그와 페이지 h1에서 제목·썸네일을 수집해 크랙 스냅샷에 추가
    const existing = _loadCardSnapshot(id);
    if (!existing?.thumbUrl) {
      // og:image → CloudFront webp URL
      const ogImg  = document.querySelector('meta[property="og:image"]')?.content ?? null;
      // og:title 또는 h1에서 제목 추출
      const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim() ?? null;
      const h1Title = document.querySelector('h1')?.textContent?.trim() ?? null;
      const title   = ogTitle || h1Title || existing?.title || null;
      if (ogImg || title) {
        _saveCardSnapshot(id, {
          title:     title,
          creator:   existing?.creator   ?? null,
          chatCount: existing?.chatCount ?? null,
          thumbUrl:  ogImg ?? existing?.thumbUrl ?? null,
        });
      }
    }

    // 이미 주입됐으면 갱신만 (단, 더 정확한 앵커가 늦게 나타나 fallback 위치에
    // 고정된 경우 올바른 위치로 재배치)
    const existingEl = document.querySelector('.crk-mytags[data-crk-ctx="detail"]');
    const preferredAnchor = _findMyTagAnchor(document);
    if (existingEl) {
      const alreadyCorrect = preferredAnchor && preferredAnchor.nextElementSibling === existingEl;
      if (preferredAnchor && !alreadyCorrect) {
        preferredAnchor.parentNode.insertBefore(existingEl, preferredAnchor.nextSibling);
      }
      _refreshMyTagsSection(id, 'detail');
      return;
    }

    // 삽입 앵커: css-cmlkbw → 통계버튼 그룹 앞 → "상세 설명" 텍스트 순으로 시도
    const platformTags = preferredAnchor;
    if (!platformTags) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = _buildMyTagsHTML(id, 'detail');
    const section = wrapper.firstElementChild;
    platformTags.parentNode.insertBefore(section, platformTags.nextSibling);
    _bindMyTagEvents(section);
  }

  // 초기 주입 (DOMContentLoaded 또는 즉시)
  const _tryDetailInject = () => {
    if (!_isDetailPage()) return;
    if (_findMyTagAnchor(document)) {
      _injectMyTagsInDetailPage();
    }
  };

  // 페이지 로드 시 시도 (React hydration 대기)
  setTimeout(_tryDetailInject,  300);
  setTimeout(_tryDetailInject,  800);
  setTimeout(_tryDetailInject, 1500);

  // MutationObserver로 앵커 등장 감지 (상세 페이지 내)
  // → 통합 Observer(_initUnifiedObserver)에서 처리됨
  function _handleDetailNode(node) {
    if (_isDetailPage() && !document.querySelector('.crk-mytags[data-crk-ctx="detail"]')) {
      // 빠른 경로: 삽입된 노드 자체가 앵커를 포함하는지 먼저 확인
      if (node.querySelector?.('[class*="css-cmlkbw"]') ||
          node.className?.includes?.('css-cmlkbw') ||
          node.querySelector?.('button[aria-label="좋아요"]') ||
          node.textContent?.includes?.('상세 설명')) {
        _injectMyTagsInDetailPage();
      }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     § 6.8  좋아요 페이지 나만의 태그 탭
     ─ /liked 페이지 전용
     ─ 플랫폼의 [스토리 | 캐릭터] 탭바를 가로챠 [스토리 | 캐릭터 | 나만의 태그]로 확장
     ─ 스토리/캐릭터: 플랫폼 원본 탭 대리클릭으로 React 상태 유지
     ─ 나만의 태그: crk-card::* 스냅샷 기반 자체 카드 그리드 렌더
     ─ 카드 스냅샷 저장소: localStorage crk-card::{id} → {title,creator,chatCount,thumbUrl}
     ══════════════════════════════════════════════════════════════ */
  function _isLikedPage() {
    return /^\/liked/.test(location.pathname);
  }

  const CARD_LS_PREFIX = 'crk-card::';

  /* 카드 스냅샷 저장
     null thumbUrl 허용 — 나중에 보강 가능(_tryHarvestSnapshot 참고)
     GC: JSON.stringify는 소형 객체(4필드)이므로 비용 미미 */
  function _saveCardSnapshot(id, snap) {
    try {
      localStorage.setItem(CARD_LS_PREFIX + id, JSON.stringify(snap));
    } catch(_) {}
  }

  function _loadCardSnapshot(id) {
    try {
      const raw = localStorage.getItem(CARD_LS_PREFIX + id);
      return raw ? JSON.parse(raw) : null;
    } catch(_) { return null; }
  }

  /* 좋아요 페이지 카드 DOM에서 스냅샷 추출 시도
     - 이미 완전한 스냅샷(thumbUrl 있음)이면 스킵
     - 통합 Observer 콜백에서 카드 삽입 시마다 호출됨 (지연 수집) */
  function _tryHarvestSnapshot(cardEl) {
    const id = _getIdFromFiber(cardEl);
    if (!id) return;
    const existing = _loadCardSnapshot(id);
    if (existing?.thumbUrl) return; // 이미 완전함 → 스킵

    const titleEl   = cardEl.querySelector(
      'p.typo-text-base_leading-paragraph_semibold, p[class*="typo-text-base"][class*="semibold"]'
    );
    const title = titleEl?.textContent?.trim() || null;
    // 제목조차 없으면 카드 렌더 미완성 → 스킵 (단, 이미 기존 스냅샷에 제목이 있으면 thumbUrl 보강 시도)
    if (!title && !existing?.title) return;

    const statEl    = cardEl.querySelector('p[class*="text-line-gray-2"]');
    const creatorEl = cardEl.querySelector('button[type="button"] p[class*="truncate"]');
    const imgEl     = cardEl.querySelector('img[alt="character_thumbnail"]');

    _saveCardSnapshot(id, {
      title:     title     || existing?.title     || null,
      creator:   creatorEl?.textContent?.trim()   || existing?.creator   || null,
      chatCount: statEl?.textContent?.trim()      || existing?.chatCount || null,
      thumbUrl:  imgEl?.src                       || existing?.thumbUrl  || null,
    });
  }

  /* localStorage에서 태그 데이터 전체 수집
     반환: { tagName → [{ id, title }] }
     GC 최적화: _tagsCache 히트 시 JSON.parse 생략 */
  function _collectAllTags() {
    const map = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith(TAG_LS_PREFIX)) continue;
      const id = key.slice(TAG_LS_PREFIX.length);
      if (!/^[a-f0-9]{24}$/.test(id)) continue;
      const tags = _loadTags(id);
      if (!Array.isArray(tags) || tags.length === 0) continue;
      const title = cache.get(id)?.title ?? _loadCardSnapshot(id)?.title ?? null;
      tags.forEach(tag => {
        if (!map[tag]) map[tag] = [];
        map[tag].push({ id, title });
      });
    }
    return map;
  }

  /* ── 탭 상태 관리 ──────────────────────────────────────────── */
  // 현재 활성 탭: 'story' | 'character' | 'mytag'
  let _likedActiveTab = 'story';

  /* 태그(카테고리)별 펼침 상태 저장 키 */
  const MYTAG_EXPAND_LS_KEY = 'crk-mytag-expanded';

  function _loadExpandedTags() {
    try {
      const raw = localStorage.getItem(MYTAG_EXPAND_LS_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch(_) { return new Set(); }
  }
  function _saveExpandedTags(set) {
    try { localStorage.setItem(MYTAG_EXPAND_LS_KEY, JSON.stringify([...set])); } catch(_) {}
  }

  /* 카드 한 장의 HTML — 좋아요_목록_관리와 무관하게 항상
     이미지 164.8×247.19px / 정보 영역 164.8×88.22px 고정 치수로 렌더 */
  function _buildMyTagCardHTML(id, snap) {
    if (snap?.thumbUrl) {
      let h = `<div class="crk-lt-card" data-crk-id="${_esc(id)}" role="button" tabindex="0">`;
      h += `  <div class="crk-lt-thumb"><img src="${_esc(snap.thumbUrl)}" alt="${_esc(snap.title ?? '')}" loading="lazy"></div>`;
      h += `  <div class="crk-lt-info">`;
      h += `    <p class="crk-lt-title">${_esc(snap.title ?? `작품 ${id.slice(-6)}`)}</p>`;
      if (snap.creator)   h += `<p class="crk-lt-creator">${_esc(snap.creator)}</p>`;
      if (snap.chatCount) h += `<p class="crk-lt-chat">💬 ${_esc(snap.chatCount)}</p>`;
      h += `  </div>`;
      h += `</div>`;
      return h;
    }
    const label = snap?.title ?? `작품 ${id.slice(-6)}`;
    let h = `<div class="crk-lt-card crk-lt-card-noimg" data-crk-id="${_esc(id)}" data-crk-href="/detail/${_esc(id)}" role="button" tabindex="0">`;
    h += `  <div class="crk-lt-info">`;
    h += `    <p class="crk-lt-title">${_esc(label)}</p>`;
    if (snap?.creator) h += `<p class="crk-lt-creator">${_esc(snap.creator)}</p>`;
    h += `    <p class="crk-lt-noimg-hint">썸네일 미수집 — 클릭하면 새탭에서 작품 열기</p>`;
    h += `  </div>`;
    h += `</div>`;
    return h;
  }

  /* 나만의 태그 탭 패널 렌더링 — 태그별 접기/펼치기 카테고리 섹션 */
  function _renderMyTagPanel(panel) {
    const allTags  = _collectAllTags();
    const tagNames = Object.keys(allTags).sort();

    if (tagNames.length === 0) {
      panel.innerHTML = `<p class="crk-lt-empty">태그를 붙인 작품이 없어요.<br>작품 카드에 호버해서 태그를 추가해보세요!</p>`;
      return;
    }

    const expanded = _loadExpandedTags();
    // 첫 진입 시(저장된 펼침 상태가 전혀 없을 때) 첫 번째 카테고리만 기본 펼침
    if (expanded.size === 0) expanded.add(tagNames[0]);

    let h = `<div class="crk-lt-categories" id="crk-lt-categories">`;
    tagNames.forEach(tag => {
      const works  = allTags[tag];
      const isOpen = expanded.has(tag);
      h += `<div class="crk-lt-cat" data-tag="${_esc(tag)}">`;
      h += `  <button class="crk-lt-cat-header" data-tag="${_esc(tag)}" aria-expanded="${isOpen}">`;
      h += `    <svg class="crk-lt-cat-chevron${isOpen ? ' crk-lt-cat-chevron-open' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59 13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>`;
      h += `    <span class="crk-lt-cat-name">${_esc(tag)}</span>`;
      h += `    <span class="crk-lt-cat-count">${works.length}</span>`;
      h += `  </button>`;
      h += `  <div class="crk-lt-cat-body" style="display:${isOpen ? '' : 'none'}">`;
      h += `    <div class="crk-lt-grid" data-tag-grid="${_esc(tag)}">`;
      works.forEach(({ id }) => {
        h += _buildMyTagCardHTML(id, _loadCardSnapshot(id));
      });
      h += `    </div>`;
      h += `  </div>`;
      h += `</div>`;
    });
    h += `</div>`; // .crk-lt-categories
    panel.innerHTML = h;

    // 카테고리 헤더 클릭 → 접기/펼치기
    panel.querySelector('#crk-lt-categories').addEventListener('click', e => {
      const header = e.target.closest('.crk-lt-cat-header');
      if (header) {
        const tag  = header.dataset.tag;
        const body = header.nextElementSibling;
        const cur  = _loadExpandedTags();
        const willOpen = !cur.has(tag);
        if (willOpen) cur.add(tag); else cur.delete(tag);
        _saveExpandedTags(cur);
        header.setAttribute('aria-expanded', String(willOpen));
        header.querySelector('.crk-lt-cat-chevron')
          ?.classList.toggle('crk-lt-cat-chevron-open', willOpen);
        body.style.display = willOpen ? '' : 'none';
        return;
      }

      // 카드 클릭 처리
      const card = e.target.closest('.crk-lt-card');
      if (!card) return;
      const id = card.dataset.crkId;
      if (!id) return;

      if (card.classList.contains('crk-lt-card-noimg')) {
        // 썸네일 미수집 카드: history.pushState는 Next.js 라우터를 깨우지 못함 →
        // window.open으로 새탭에서 열어 좋아요 페이지를 유지하면서 작품 확인 가능
        window.open(`/detail/${id}`, '_blank', 'noopener');
        return;
      }

      // 썸네일 있는 카드: 플랫폼 원본 카드 찾아 대리클릭
      const platformCards = document.querySelectorAll('[data-crk-peek="1"]');
      for (const pc of platformCards) {
        const pcId = _getIdFromFiber(pc);
        if (pcId === id) { pc.click(); return; }
      }
      // 플랫폼 카드 없으면(무한스크롤 미로드) 새탭 fallback
      window.open(`/detail/${id}`, '_blank', 'noopener');
    });

    // 카드 키보드 접근성
    panel.querySelector('#crk-lt-categories').addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        const card = e.target.closest('.crk-lt-card');
        if (card) { e.preventDefault(); card.click(); }
      }
    });
  }

  /* ── 좋아요_목록_관리 renderAll 트리거 ──────────────────────
     좋아요_목록_관리는 MutationObserver(150ms debounce)로 자동 실행되나
     명시적으로 강제 트리거가 필요한 경우(나만의 태그→스토리 복원 등)에
     lf-folder-card를 일시 제거해 foldersVanished 조건을 만족시킨다.
  ──────────────────────────────────────────────────────────── */
  function _triggerCompanionRender() {
    const grid = document.querySelector('#liked-scroll div[class*="grid-cols-3"]');
    if (!grid) return;
    // foldersVanished 조건(savedFolderCount > 0 && renderedFolderCount === 0) 유발
    const folders = [...grid.querySelectorAll('.lf-folder-card')];
    folders.forEach(f => f.remove());
    // MutationObserver가 변화를 감지해 renderAll() 재실행
  }

  /* 탭 전환 핵심 로직 */
  function _switchLikedTab(tabName) {
    _likedActiveTab = tabName;

    // 우리 탭바 버튼 상태 갱신
    document.querySelectorAll('#crk-liked-tabs .crk-lt-tab').forEach(btn => {
      const active = btn.dataset.tab === tabName;
      btn.classList.toggle('crk-lt-tab-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    const panel = document.getElementById('crk-lt-mytag-panel');

    if (tabName === 'mytag') {
      // 플랫폼 카드 래퍼 숨김
      // 좋아요_목록_관리가 삽입한 flex.flex-col.gap-10 래퍼를 숨긴다
      const lfWrap = document.querySelector(
        '#liked-scroll .flex.flex-col.gap-10, #liked-scroll [class*="css-1f2qzn3"]'
      );
      if (lfWrap) {
        lfWrap.dataset.crkHidden = '1';
        lfWrap.style.setProperty('display', 'none', 'important');
      }
      if (panel) {
        panel.style.display = '';
        _renderMyTagPanel(panel);
      }

    } else {
      // 나만의 태그 패널 숨김
      if (panel) panel.style.display = 'none';

      // 이전에 숨겼던 래퍼 복원
      document.querySelectorAll('[data-crk-hidden="1"]').forEach(el => {
        el.style.removeProperty('display');
        delete el.dataset.crkHidden;
      });

      // 플랫폼 React 탭 전환 (캐릭터 카드는 React가 마운트해야 DOM에 생김)
      const platformTablist = document.querySelector(
        '[role="tablist"][aria-hidden="true"], [role="tablist"][style*="display: none"]'
      );
      const platformTabs = platformTablist
        ? platformTablist.querySelectorAll('[role="tab"]')
        : document.querySelectorAll('[role="tablist"]:not(#crk-liked-tabs) [role="tab"]');

      const targetIdx  = tabName === 'story' ? 0 : 1;
      const targetTab  = platformTabs[targetIdx];
      const needsClick = targetTab && targetTab.getAttribute('data-state') !== 'active';

      if (needsClick) {
        // display:none 상태이므로 잠깐 visibility 복원 (레이아웃 측정 가능하게)
        const tl = targetTab.closest('[role="tablist"]');
        if (tl) {
          tl.style.removeProperty('display');
          tl.style.removeProperty('visibility');
        }

        // ★ 핵심: Radix UI Tabs는 onClick이 아닌 onMouseDown(실제로는
        // onPointerDown)으로 탭을 활성화한다 (radix-ui/primitives#1879).
        // .click()이나 dispatchEvent(MouseEvent('click'))은 Radix가
        // 전혀 리스닝하지 않는 이벤트라 React state가 절대 바뀌지 않는다.
        // pointerdown → mousedown → mouseup → click 순서로 실제 브라우저가
        // 발생시키는 이벤트 체인을 그대로 재현해야 한다.
        const rect = targetTab.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const evtOpts = {
          bubbles: true, cancelable: true, composed: true,
          clientX: cx, clientY: cy, button: 0,
        };
        targetTab.dispatchEvent(new PointerEvent('pointerdown', { ...evtOpts, pointerId: 1, pointerType: 'mouse' }));
        targetTab.dispatchEvent(new MouseEvent('mousedown', evtOpts));
        targetTab.dispatchEvent(new PointerEvent('pointerup',   { ...evtOpts, pointerId: 1, pointerType: 'mouse' }));
        targetTab.dispatchEvent(new MouseEvent('mouseup',   evtOpts));
        targetTab.dispatchEvent(new MouseEvent('click',     evtOpts));

        // 클릭 후 React 렌더 대기(캐릭터 카드 마운트) → 다시 숨김
        // rAF 한 번은 페인트 직전 시점이라 React commit이 끝나지 않을 수 있어
        // 두 번 중첩해 다음 페인트 이후까지 확실히 대기
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (tl) tl.style.setProperty('display', 'none', 'important');
          });
        });
      }

      if (!needsClick) {
        // 이미 해당 탭이 active 상태 (예: 나만의 태그에서 복귀했는데 플랫폼 탭은 안 변함)
        // 좋아요_목록_관리 폴더 UI가 사라졌을 수 있으므로 재빌드 트리거
        _triggerCompanionRender();
      }
    }
  }

  /* 좋아요 페이지 탭바 초기화 */
  let _likedTabsInited = false;

  function _initLikedTabs() {
    if (!_isLikedPage()) return;

    // 탭바 앵커: [role="tablist"]
    // #liked-scroll 범위로 한정 — 새로고침 직후 하이드레이션 초기 시점에
    // 페이지 다른 영역(헤더 네비게이션 등)의 무관한 tablist를 잘못 잡아
    // 엉뚱한 위치에 탭바가 삽입되는 경우를 방지
    const platformTablist = document.querySelector('#liked-scroll [role="tablist"]');
    if (!platformTablist) return;

    // 이미 주입됐으면 갱신 스킵 (DOM 확인)
    if (document.getElementById('crk-liked-tabs')) {
      _likedTabsInited = true;
      return;
    }

    // 플랫폼 원본 탭바: 이제 대리클릭 불필요 (카드 타입 필터링 방식으로 전환)
    // 시각적으로만 숨김 (스크린리더 제외)
    platformTablist.style.setProperty('display', 'none', 'important');
    platformTablist.setAttribute('aria-hidden', 'true');

    // 우리 탭바 생성
    const tabbar = document.createElement('div');
    tabbar.id = 'crk-liked-tabs';
    tabbar.setAttribute('role', 'tablist');
    tabbar.innerHTML = `
      <button class="crk-lt-tab crk-lt-tab-active" data-tab="story"     role="tab" aria-selected="true"  tabindex="0">스토리</button>
      <button class="crk-lt-tab"                    data-tab="character" role="tab" aria-selected="false" tabindex="-1">캐릭터</button>
      <button class="crk-lt-tab"                    data-tab="mytag"     role="tab" aria-selected="false" tabindex="-1">나만의 태그</button>
    `;

    // 탭 클릭 이벤트
    tabbar.addEventListener('click', e => {
      const btn = e.target.closest('.crk-lt-tab');
      if (!btn) return;
      _switchLikedTab(btn.dataset.tab);
    });

    // 나만의 태그 패널 생성 (초기 숨김)
    const panel = document.createElement('div');
    panel.id = 'crk-lt-mytag-panel';
    panel.style.display = 'none';

    // 삽입 위치: 플랫폼 탭바 바로 앞
    platformTablist.parentNode.insertBefore(tabbar,  platformTablist);
    platformTablist.parentNode.insertBefore(panel, platformTablist.nextSibling);

    // 현재 활성 탭 상태 반영
    _switchLikedTab(_likedActiveTab);
    _likedTabsInited = true;
  }

  // 좋아요 페이지 초기 진입
  // 새로고침 직후 React 하이드레이션이 느린 경우를 대비해 호출 시점을 추가
  if (_isLikedPage()) {
    setTimeout(_initLikedTabs,  600);
    setTimeout(_initLikedTabs, 1400);
    setTimeout(_initLikedTabs, 2500);
  }

  /* ══════════════════════════════════════════════════════════════
     § 7. 직접 API 호출
     ══════════════════════════════════════════════════════════════ */
  function _fetchById(id) {
    return new Promise(resolve => {
      if (cache.has(id) && !cache.get(id)._partial) { resolve(cache.get(id)); return; }

      const fetchAs = (type) => _origFetch(`${API_BASE}/${type}/${id}`, { credentials: 'include' })
        .then(r => r.ok ? r.json() : Promise.reject());

      fetchAs('stories')
        .catch(() => fetchAs('characters'))
        .then(json => {
          _digestJson('direct_fetch', json);
          resolve(cache.get(id) ?? null);
        })
        .catch(() => resolve(null));
    });
  }

  /* ══════════════════════════════════════════════════════════════
     § 8. React Fiber에서 스토리 ID 추출
     ══════════════════════════════════════════════════════════════ */
  function _getIdFromFiber(el) {
    try {
      const fKey = Object.keys(el).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (!fKey) return null;
      let node = el[fKey];
      for (let i = 0; i < 80 && node; i++) {
        const props = node.memoizedProps ?? node.pendingProps ?? {};
        for (const k of ['characterId', 'storyId', 'sourceId', 'contentId', 'id', '_id', 'postId', 'itemId']) {
          if (props[k] && /^[a-f0-9]{24}$/.test(String(props[k]))) return String(props[k]);
        }
        for (const k of ['character', 'story', 'content', 'item', 'data', 'post',
                          'storyData', 'contentData', 'characterData', 'contentInfo']) {
          const obj = props[k];
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            const id = obj.sourceId
                    ?? obj._id
                    ?? obj.id
                    ?? obj.storyId
                    ?? obj.characterId
                    ?? obj.contentId;
            if (id && /^[a-f0-9]{24}$/.test(String(id))) return String(id);
          }
        }
        node = node.return;
      }
    } catch (_) {}
    return null;
  }

  /* ══════════════════════════════════════════════════════════════
     § 9. 팝업 UI
     ══════════════════════════════════════════════════════════════ */
  let activePopup = null;
  let hideTimer   = null;

  function _showPopup(info, anchor) {
    _destroyPopup();
    clearTimeout(hideTimer);
    const pop = document.createElement('div');
    pop.id = 'crk-peek';
    pop.setAttribute('role', 'tooltip');
    pop.innerHTML = _buildHTML(info);
    pop.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    pop.addEventListener('mouseleave', (e) => {
      if (e.relatedTarget?.closest?.('[data-floating-ui-portal]')) return;
      _scheduleHide();
    });
    pop.addEventListener('click', e => {
      const btn = e.target.closest('.crk-expand-btn');
      if (!btn) return;
      const body = pop.querySelector('.crk-desc-body');
      if (!body) return;
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'block';
      btn.textContent   = open ? '상세 설명 더보기 ▾' : '접기 ▴';
    });
    // 나만의 태그 이벤트 위임
    _bindMyTagEvents(pop);
    document.body.appendChild(pop);
    activePopup = pop;
    _position(pop, anchor);
  }

  function _buildHTML(info) {
    let h = '';

    h += `<div class="crk-title">${_esc(info.title)}`;
    if (info._partial) h += ` <span class="crk-partial">···</span>`;
    h += `</div>`;

    if (info.creator)
      h += `<div class="crk-creator">by ${_esc(info.creator)}</div>`;

    const hasBody = info.options?.length || info.intro || info.description || info.tags?.length;
    if (hasBody) h += `<hr class="crk-hr">`;

    if (info.options?.length) {
      h += `<div class="crk-options">`;
      info.options.forEach(o => { h += `<span class="crk-badge">${_esc(o)}</span>`; });
      h += `</div>`;
    }

    if (info.intro) {
      h += `<div class="crk-intro">${_md2html(info.intro)}</div>`;
    }

    if (info.description && info.description !== info.intro) {
      h += `<button class="crk-expand-btn">상세 설명 더보기 ▾</button>`;
      h += `<div class="crk-desc-body" style="display:none">${_md2html(info.description)}</div>`;
    }

    if (info.tags?.length) {
      h += `<div class="crk-tags">`;
      info.tags.slice(0, 10).forEach(t => { h += `<span class="crk-tag">${_esc(t)}</span>`; });
      h += `</div>`;
    }

    const hasStats = info.chatCount != null || info.likeCount != null || info.commentCount != null;
    if (hasStats) {
      h += `<div class="crk-stats">`;
      if (info.chatCount    != null) h += _chip('💬', info.chatCount);
      if (info.likeCount    != null) h += _chip('👍', info.likeCount);
      if (info.commentCount != null) h += _chip('💭', info.commentCount);
      h += `</div>`;
    }

    // 나만의 태그 섹션 (id가 있을 때만)
    if (info._id) {
      h += _buildMyTagsHTML(info._id, 'popup');
    }

    return h;
  }

  function _chip(icon, val) {
    return `<span class="crk-stat"><span class="crk-si">${icon}</span>${_esc(String(val))}</span>`;
  }

  function _md2html(text) {
    if (!text) return '';
    // 이미지는 이스케이프 전에 먼저 추출·치환
    const IMG_PLACEHOLDER = '\x00IMG\x00';
    const imgs = [];
    const pre = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt, url) => {
      imgs.push(`<img src="${url}" alt="${_esc(alt)}" class="crk-md-img">`);
      return IMG_PLACEHOLDER;
    });

  // 나머지는 기존대로 이스케이프 후 마크다운 치환
  let html = _esc(pre)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,     '<em>$1</em>')
    .replace(/\n/g,            '<br>');

  // 플레이스홀더를 실제 img 태그로 복원
  imgs.forEach(tag => { html = html.replace(_esc(IMG_PLACEHOLDER), tag); });
  return html;
}

  function _position(pop, anchor) {
    const ar = anchor.getBoundingClientRect();
    const vw = window.innerWidth;
    const sx = window.scrollX, sy = window.scrollY;

    let left, side;
    if (ar.right + BUBBLE_GAP + BUBBLE_W < vw - 8) {
      left = ar.right + sx + BUBBLE_GAP; side = 'left';
    } else {
      left = ar.left + sx - BUBBLE_W - BUBBLE_GAP; side = 'right';
    }
    left = Math.max(sx + 8, left);
    let top = ar.top + sy;

    pop.classList.remove('crk-arrow-left', 'crk-arrow-right');
    pop.classList.add(`crk-arrow-${side}`);
    pop.style.left = left + 'px';
    pop.style.top  = top  + 'px';

    requestAnimationFrame(() => {
      if (!pop.isConnected) return;
      const ph = pop.offsetHeight, vh = window.innerHeight;
      if (top + ph > sy + vh - 8)
        top = Math.max(sy + 8, sy + vh - ph - 8);
      pop.style.top = top + 'px';
      const arY = Math.max(16, Math.min(ph - 24, ar.top + ar.height / 2 + sy - top));
      pop.style.setProperty('--crk-arrow-y', arY + 'px');
    });
  }

  function _scheduleHide() { hideTimer = setTimeout(_destroyPopup, 200); }
  function _destroyPopup() { activePopup?.remove(); activePopup = null; }

  /* ══════════════════════════════════════════════════════════════
     § 9.5  나만의 태그 (My Tags)
     ─ localStorage 키: crk-tags::{24자리id}
     ─ 값: JSON 배열  ["#태그1", "#태그2", ...]
     ─ id 없으면 저장 비활성화 (제목 fallback 금지)
     ══════════════════════════════════════════════════════════════ */

  const TAG_LS_PREFIX = 'crk-tags::';

  /* GC 최적화 (v1.3.0):
     _loadTags는 _buildMyTagsHTML, _commitTagInput, _refreshMyTagsSection에서
     호출되며, 팝업 열릴 때마다 동일 id에 대해 localStorage.getItem + JSON.parse를
     반복했음. Map 기반 write-through 캐시로 교체.
     - 첫 접근 시 1회만 파싱, 이후 메모리에서 직접 반환
     - _saveTags에서 캐시 갱신 후 localStorage에 write
     - 탭 간 공유가 필요 없는 데이터(개인 태그)이므로 인메모리 캐시 충분
  */
  const _tagsCache = new Map(); // id → string[]

  function _loadTags(id) {
    if (_tagsCache.has(id)) return _tagsCache.get(id);
    try {
      const arr = JSON.parse(localStorage.getItem(TAG_LS_PREFIX + id) ?? '[]');
      const result = Array.isArray(arr) ? arr : [];
      _tagsCache.set(id, result);
      return result;
    } catch(_) {
      _tagsCache.set(id, []);
      return [];
    }
  }

  function _saveTags(id, arr) {
    _tagsCache.set(id, arr);
    localStorage.setItem(TAG_LS_PREFIX + id, JSON.stringify(arr));
    // 좋아요 페이지의 나만의 태그 탭이 열려있으면 패널 갱신
    if (_isLikedPage() && _likedActiveTab === 'mytag') {
      const panel = document.getElementById('crk-lt-mytag-panel');
      if (panel) _renderMyTagPanel(panel);
    }
  }

  function _normalizeTag(raw) {
    const s = raw.trim();
    if (!s) return null;
    return s.startsWith('#') ? s : '#' + s;
  }

  /* 나만의 태그 HTML 빌더
     context: 'popup' | 'modal' */
  function _buildMyTagsHTML(id, context) {
    const tags = _loadTags(id);
    const prefix = `crk-mt-${context}`;

    let h = `<div class="crk-mytags" data-crk-id="${_esc(id)}" data-crk-ctx="${context}">`;
    h += `<div class="crk-mytags-header">`;
    h += `<span class="crk-mytags-label">나만의 태그</span>`;
    h += `</div>`;

    // 태그 목록
    h += `<div class="crk-mytags-list">`;
    if (tags.length) {
      tags.forEach((t, i) => {
        h += `<span class="crk-mytag-chip">`;
        h += `${_esc(t)}`;
        h += `<button class="crk-mytag-del" data-idx="${i}" title="삭제">×</button>`;
        h += `</span>`;
      });
    } else {
      h += `<span class="crk-mytags-empty">태그 없음</span>`;
    }
    h += `</div>`;

    // 입력 폼
    h += `<div class="crk-mytags-input-row">`;
    h += `<input class="crk-mytags-input" type="text" placeholder="#태그 입력 후 Enter" maxlength="30">`;
    h += `<button class="crk-mytags-add-btn" title="추가">+</button>`;
    h += `</div>`;

    h += `</div>`; // .crk-mytags
    return h;
  }

  /* 나만의 태그 이벤트 바인딩 (이벤트 위임) */
  function _bindMyTagEvents(root) {
    root.addEventListener('click', e => {
      // 삭제 버튼
      const delBtn = e.target.closest('.crk-mytag-del');
      if (delBtn) {
        e.stopPropagation();
        const container = delBtn.closest('.crk-mytags');
        if (!container) return;
        const id  = container.dataset.crkId;
        const ctx = container.dataset.crkCtx;
        const idx = parseInt(delBtn.dataset.idx, 10);
        if (!id || isNaN(idx)) return;
        const tags = _loadTags(id);
        tags.splice(idx, 1);
        _saveTags(id, tags);
        _refreshMyTagsSection(id, ctx);
        return;
      }
      // 추가 버튼
      const addBtn = e.target.closest('.crk-mytags-add-btn');
      if (addBtn) {
        e.stopPropagation();
        const container = addBtn.closest('.crk-mytags');
        if (!container) return;
        _commitTagInput(container);
      }
    });

    root.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const input = e.target.closest('.crk-mytags-input');
      if (!input) return;
      e.preventDefault();
      e.stopPropagation();
      const container = input.closest('.crk-mytags');
      if (!container) return;
      _commitTagInput(container);
    });
  }

  function _commitTagInput(container) {
    const input = container.querySelector('.crk-mytags-input');
    if (!input) return;
    const id  = container.dataset.crkId;
    const ctx = container.dataset.crkCtx;
    if (!id) return;
    const tag = _normalizeTag(input.value);
    if (!tag) return;
    const tags = _loadTags(id);
    if (!tags.includes(tag)) {
      tags.push(tag);
      _saveTags(id, tags);
    }
    input.value = '';
    _refreshMyTagsSection(id, ctx);
  }

  /* 태그 목록만 부분 리렌더 (팝업 expand 상태 보존) */
  function _refreshMyTagsSection(id, ctx) {
    // 같은 id + ctx를 가진 모든 .crk-mytags를 갱신
    document.querySelectorAll(`.crk-mytags[data-crk-id="${id}"][data-crk-ctx="${ctx}"]`)
      .forEach(container => {
        const tags = _loadTags(id);
        const list = container.querySelector('.crk-mytags-list');
        if (!list) return;

        if (tags.length) {
          list.innerHTML = tags.map((t, i) =>
            `<span class="crk-mytag-chip">${_esc(t)}<button class="crk-mytag-del" data-idx="${i}" title="삭제">×</button></span>`
          ).join('');
        } else {
          list.innerHTML = `<span class="crk-mytags-empty">태그 없음</span>`;
        }
        // input 초기화 (방어)
        const inp = container.querySelector('.crk-mytags-input');
        if (inp) inp.value = '';
      });
  }

  /* 플랫폼 상세 모달에 나만의 태그 섹션 주입 */
  function _injectMyTagsInModal(modalRoot, id) {
    if (!id) return;
    const existing = modalRoot.querySelector('.crk-mytags[data-crk-ctx="modal"]');

    // 우선 앵커(css-cmlkbw)가 비동기 렌더링 중이라 첫 삽입 시점에 없어서
    // fallback에 자리잡은 경우, 더 정확한 앵커가 나중에 나타나면 재배치한다.
    // (existing이어도 무조건 갱신만 하고 끝내면 잘못된 위치에 영구히
    // 고정되는 문제가 있었다)
    const preferredAnchor = _findMyTagAnchor(modalRoot);
    if (existing) {
      const alreadyCorrect = preferredAnchor && preferredAnchor.nextElementSibling === existing;
      if (preferredAnchor && !alreadyCorrect) {
        preferredAnchor.parentNode.insertBefore(existing, preferredAnchor.nextSibling);
      }
      _refreshMyTagsSection(id, 'modal');
      return;
    }

    // 삽입 앵커: css-cmlkbw → 통계버튼 그룹 앞 → "상세 설명" 텍스트 순으로 시도
    const platformTags = preferredAnchor;
    if (!platformTags) return;

    const wrapper = document.createElement('div');
    wrapper.innerHTML = _buildMyTagsHTML(id, 'modal');
    const section = wrapper.firstElementChild;
    platformTags.parentNode.insertBefore(section, platformTags.nextSibling);
    _bindMyTagEvents(section);
  }

  /* ══════════════════════════════════════════════════════════════
     § 10. 카드 후킹
     ══════════════════════════════════════════════════════════════ */
  let hoverTimer  = null;
  let hoveredCard = null;

  function _isCard(el) {
    return el.getAttribute?.('role') === 'button' &&
           el.getAttribute?.('tabindex') === '0' &&
           !!el.querySelector('img[alt="character_thumbnail"]');
  }

  async function _onEnter(e) {
    const card = e.currentTarget;
    hoveredCard = card;
    clearTimeout(hoverTimer);

    hoverTimer = setTimeout(async () => {
      if (hoveredCard !== card) return;

      let id = _getIdFromFiber(card);
      let domInfo = _parseCard(card);
      let info = null;

      if (!id && domInfo?.title) {
        for (const [cachedId, cachedInfo] of cache.entries()) {
          if (cachedInfo.title === domInfo.title && !cachedInfo._partial) {
            id = cachedId;
            break;
          }
        }
      }

      if (id && cache.has(id) && !cache.get(id)._partial) info = cache.get(id);
      if (!info && id) info = await _fetchById(id);
      if (!info) info = domInfo;

      if (!info || hoveredCard !== card) return;
      // id가 있으면 info에 보강 (태그 저장 키용)
      if (id && !info._id) info = Object.assign({}, info, { _id: id });
      _showPopup(info, card);

      if (info._partial && id) {
        _fetchById(id).then(full => {
          if (full && !full._partial && activePopup?.isConnected && hoveredCard === card) {
            activePopup.innerHTML = _buildHTML(full);
            _bindMyTagEvents(activePopup);
          }
        });
      }
    }, HOVER_DELAY);
  }

  function _onLeave(e) {
    if (e?.relatedTarget?.closest?.('[data-floating-ui-portal]')) return;
    hoveredCard = null;
    clearTimeout(hoverTimer);
    _scheduleHide();
  }

  const _hookedCards = new WeakSet();

  function _hookCard(el) {
    if (!_isCard(el) || _hookedCards.has(el)) return;
    _hookedCards.add(el);
    el.dataset.crkPeek = '1';
    el.addEventListener('mouseenter', _onEnter);
    el.addEventListener('mouseleave',  _onLeave);
    // 모든 페이지에서 카드 훅킹 시 스냅샷 수집 시도
    // (메인/검색/작가/좋아요 페이지 모두 동일한 카드 구조 사용)
    // img 로드 완료 대기: 100ms 지연
    setTimeout(() => _tryHarvestSnapshot(el), 100);
  }

  function _hookAll(root) {
    if (_isCard(root)) _hookCard(root);
    const q = root?.querySelectorAll ? root : document;
    q.querySelectorAll('[role="button"][tabindex="0"]').forEach(_hookCard);
  }

  _hookAll(document);

  /* ══════════════════════════════════════════════════════════════
     § 10.5  통합 MutationObserver
     GC 최적화 (v1.3.0):
       §6, §6.7, §10의 Observer 3개(모두 document.documentElement subtree)를
       단일 Observer로 통합. 관찰 범위도 document.body로 축소.
       - 콜백 호출 횟수 1/3 감소 (React 스트리밍 중 효과 집중)
       - <head> 변경 트리거 제거
       - 각 핸들러는 함수로 분리(_handleModalNode, _handleDetailNode)해
         로직 독립성 유지
     ══════════════════════════════════════════════════════════════ */
  function _initUnifiedObserver() {
    new MutationObserver(muts => {
      for (const mut of muts) {
        for (let i = 0; i < mut.addedNodes.length; i++) {
          const node = mut.addedNodes[i];
          if (node.nodeType !== 1) continue;
          _handleModalNode(node);   // §6: 모달 캐싱 + 팝오버 억제
          _handleDetailNode(node);  // §6.7: detail 페이지 mytags 주입
          _hookAll(node);           // §10: 카드 훅
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }
  _initUnifiedObserver();

  /* ══════════════════════════════════════════════════════════════
     § 11. 스타일 (말풍선)
     ══════════════════════════════════════════════════════════════ */
  const _CSS = `
:root {
  --crk-bg:     #13131f;
  --crk-border: rgba(255,255,255,.12);
  --crk-text1:  #A9A9A9;
  --crk-text2:  #b0b4cc;
  --crk-text3:  #6a6a90;
  --crk-accent: #7c74ff;
  --crk-gold:   #f5c518;
  --crk-arrow-y: 20px;
}
#crk-peek {
  position: absolute;
  z-index: 1000000;
  width: ${BUBBLE_W}px;
  max-width: calc(100vw - 24px);
  max-height: ${BUBBLE_MAX_H}px;
  overflow-y: auto;
  background: var(--crk-bg);
  border: 1px solid var(--crk-border);
  border-radius: 14px;
  padding: 14px 16px 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,.5), 0 16px 48px rgba(0,0,0,.55);
  color: var(--crk-text1);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.5;
  pointer-events: auto;
  animation: crkIn .14s cubic-bezier(.22,1,.36,1) both;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.15) transparent;
}
#crk-peek::-webkit-scrollbar { width: 4px; }
#crk-peek::-webkit-scrollbar-thumb { background: rgba(255,255,255,.15); border-radius: 2px; }
@keyframes crkIn {
  from { opacity:0; transform:scale(.96) translateY(4px); }
  to   { opacity:1; transform:scale(1)   translateY(0); }
}
#crk-peek::before {
  content:''; position:absolute;
  top:var(--crk-arrow-y,20px); margin-top:-8px;
  width:0; height:0; pointer-events:none;
}
#crk-peek.crk-arrow-left::before {
  left:-9px;
  border-top:8px solid transparent; border-bottom:8px solid transparent;
  border-right:9px solid var(--crk-bg);
  filter:drop-shadow(-1px 0 1px rgba(0,0,0,.35));
}
#crk-peek.crk-arrow-right::before {
  right:-9px;
  border-top:8px solid transparent; border-bottom:8px solid transparent;
  border-left:9px solid var(--crk-bg);
  filter:drop-shadow(1px 0 1px rgba(0,0,0,.35));
}
#crk-peek .crk-title { font-size:14px; font-weight:700; color:var(--crk-text1); margin:0 0 3px; line-height:1.35; }
#crk-peek .crk-partial { font-size:11px; font-weight:400; color:var(--crk-text3); margin-left:2px; }
#crk-peek .crk-creator { font-size:11px; color:var(--crk-text3); }
#crk-peek .crk-hr { border:none; border-top:1px solid var(--crk-border); margin:10px 0; }
#crk-peek .crk-options { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:9px; }
#crk-peek .crk-badge {
  display:inline-flex; align-items:center; font-size:10.5px;
  padding:2px 7px; border-radius:5px; border:1px solid var(--crk-border);
  color:var(--crk-text3); white-space:nowrap;
  max-width:230px; overflow:hidden; text-overflow:ellipsis;
}
#crk-peek .crk-intro {
  font-size:13px; font-weight:500; color:var(--crk-text1);
  margin-bottom:9px; line-height:1.55;
}
#crk-peek .crk-intro strong { font-weight:700; }
#crk-peek .crk-intro em { font-style:italic; }
#crk-peek .crk-expand-btn {
  display:block; width:100%; text-align:left;
  font-size:11px; color:var(--crk-accent);
  background:none; border:none; padding:0 0 8px;
  cursor:pointer; opacity:.85;
}
#crk-peek .crk-expand-btn:hover { opacity:1; }
#crk-peek .crk-desc-body {
  font-size:12px; line-height:1.65; color:var(--crk-text2);
  margin-bottom:9px; border-top:1px solid var(--crk-border); padding-top:8px;
}
#crk-peek .crk-desc-body strong { font-weight:700; color:var(--crk-text1); }
#crk-peek .crk-desc-body em { font-style:italic; }
#crk-peek .crk-tags { display:flex; flex-wrap:wrap; gap:3px 6px; margin-bottom:9px; }
#crk-peek .crk-tag { font-size:11px; color:var(--crk-accent); opacity:.9; }
#crk-peek .crk-stats { display:flex; gap:14px; border-top:1px solid var(--crk-border); padding-top:9px; }
#crk-peek .crk-stat { display:flex; align-items:center; gap:4px; font-size:11px; color:var(--crk-text3); }
#crk-peek .crk-si { font-size:12px; line-height:1; }
#crk-peek .crk-md-img {
  max-width: 100%; border-radius: 6px; margin: 6px 0;
  display: block;
}

/* ── 나만의 태그 (말풍선 + 플랫폼 모달 공용) ── */
.crk-mytags {
  margin-top: 10px;
  border-top: 1px solid var(--crk-border);
  padding-top: 9px;
}
.crk-mytags-header {
  display: flex;
  align-items: center;
  margin-bottom: 7px;
}
.crk-mytags-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--crk-gold);
  letter-spacing: .03em;
  text-transform: uppercase;
}
.crk-mytags-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  margin-bottom: 8px;
  min-height: 20px;
}
.crk-mytags-empty {
  font-size: 11px;
  color: var(--crk-text3);
  font-style: italic;
}
.crk-mytag-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  color: var(--crk-gold);
  background: rgba(245,197,24,.10);
  border: 1px solid rgba(245,197,24,.25);
  border-radius: 5px;
  padding: 2px 5px 2px 7px;
  line-height: 1.3;
}
.crk-mytag-del {
  background: none;
  border: none;
  color: rgba(245,197,24,.5);
  font-size: 13px;
  line-height: 1;
  padding: 0 1px;
  cursor: pointer;
  transition: color .12s;
}
.crk-mytag-del:hover { color: var(--crk-gold); }
.crk-mytags-input-row {
  display: flex;
  gap: 5px;
}
.crk-mytags-input {
  flex: 1;
  background: rgba(255,255,255,.05);
  border: 1px solid var(--crk-border);
  border-radius: 6px;
  padding: 4px 9px;
  font-size: 12px;
  color: var(--crk-text1);
  outline: none;
  transition: border-color .15s;
  font-family: inherit;
}
.crk-mytags-input::placeholder { color: var(--crk-text3); }
.crk-mytags-input:focus {
  border-color: rgba(245,197,24,.45);
  background: rgba(245,197,24,.04);
}
.crk-mytags-add-btn {
  background: rgba(245,197,24,.15);
  border: 1px solid rgba(245,197,24,.30);
  border-radius: 6px;
  color: var(--crk-gold);
  font-size: 16px;
  line-height: 1;
  padding: 0 10px;
  cursor: pointer;
  transition: background .15s;
}
.crk-mytags-add-btn:hover { background: rgba(245,197,24,.28); }

/* 플랫폼 모달 내 나만의 태그 (별도 배경 패널) */
#web-modal .crk-mytags,
[class*="css-jmmlw3"] .crk-mytags,
.crk-mytags[data-crk-ctx="detail"] {
  margin: 8px 0 0;
  border: 1px solid rgba(245,197,24,.20);
  border-radius: 10px;
  padding: 10px 12px 10px;
  background: rgba(245,197,24,.03);
}

/* ══════════════════════════════════════════════════════════════
   §6.8  좋아요 페이지 나만의 태그 탭
   ══════════════════════════════════════════════════════════════ */

/* 우리 탭바 — 플랫폼 탭바와 동일한 레이아웃 */
#crk-liked-tabs {
  display: inline-flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0;
  border-bottom: 1px solid var(--outline_tertiary, rgba(0,0,0,.12));
  background: var(--bg_screen, #fff);
  padding-bottom: 1px;
  width: 100%;
  box-sizing: border-box;
  position: relative;
  z-index: 11;
  /* 부모 width 계산이 일시적으로 0/auto가 되는 레이스 컨디션에서도
     탭바가 가느다란 선으로 짜부러지지 않도록 최소 높이를 강제 고정.
     (버튼 padding 16px*2 + line-height 1 기준 텍스트 높이 ≈ 48px) */
  min-height: 48px;
}

/* 탭 버튼 — 플랫폼 [role="tab"] 스타일 모사 */
.crk-lt-tab {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  padding: 16px 8px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1;
  color: var(--text_tertiary, #999);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  /* flex:1 단축은 flex-basis:0%를 포함 — 부모 width 계산이 흔들리면
     버튼이 텍스트 내용보다 작게(0까지) 짜부러질 수 있다.
     flex-basis를 auto로 둬 텍스트 실제 크기를 최소 보장한다. */
  flex: 1 1 auto;
  transition: color .12s, border-color .12s, background .12s;
  font-family: inherit;
  border-radius: 0;
}
.crk-lt-tab:hover {
  color: var(--text_primary, #111);
  background: var(--hover, rgba(0,0,0,.04));
}
.crk-lt-tab-active {
  color: var(--primary, #7c74ff) !important;
  border-bottom-color: var(--primary, #7c74ff) !important;
}

/* 나만의 태그 패널 */
#crk-lt-mytag-panel {
  width: 100%;
  padding-top: 16px;
}

/* 카테고리(태그) 목록 */
.crk-lt-categories {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 카테고리 한 칸 — 좋아요 페이지 폴더 카드와 유사한 톤 */
.crk-lt-cat {
  border-radius: 10px;
  overflow: hidden;
}

/* 카테고리 헤더 — 클릭으로 접기/펼치기 */
.crk-lt-cat-header {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 14px;
  background: var(--bg_secondary, rgba(0,0,0,.03));
  border: none;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition: background .12s;
}
.crk-lt-cat-header:hover {
  background: rgba(245,166,35,.10);
}
.crk-lt-cat-chevron {
  flex-shrink: 0;
  color: var(--text_tertiary, #999);
  transition: transform .18s ease;
  transform: rotate(0deg);
}
.crk-lt-cat-chevron-open {
  transform: rotate(90deg);
}
.crk-lt-cat-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--crk-gold, #f5a623);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.crk-lt-cat-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--text_tertiary, #aaa);
  background: rgba(0,0,0,.06);
  border-radius: 10px;
  padding: 2px 8px;
  flex-shrink: 0;
}

/* 카테고리 본문 (카드 그리드 영역) */
.crk-lt-cat-body {
  padding: 14px 4px 18px;
}

/* 카드 그리드 — 카드 폭(164.8px) 기준 자동 줄바꿈.
   3~5열 고정 대신 auto-fill로 패널 폭에 맞게 자연스럽게 배치 */
.crk-lt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, 164.8px);
  column-gap: 12px;
  row-gap: 24px;
  justify-content: start;
}
@media (max-width: 480px) {
  .crk-lt-grid { grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); }
}

/* 카드 공통 — 요청 치수: 썸네일 164.8×247.19px, 정보영역 164.8×88.22px */
.crk-lt-card {
  display: flex;
  flex-direction: column;
  width: 164.8px;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: transform .15s, box-shadow .15s;
}
.crk-lt-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(0,0,0,.10);
}
.crk-lt-card:focus-visible {
  outline: 2px solid var(--crk-gold);
  outline-offset: 2px;
}

.crk-lt-thumb {
  width: 164.8px;
  height: 247.19px;
  overflow: hidden;
  background: rgba(0,0,0,.05);
  flex-shrink: 0;
  border-radius: 8px;
}
.crk-lt-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

/* 카드 정보 영역 — 164.8×88.22px 고정 (50.59px에서 상하 여유 37.63px 확장,
   제목 2줄 + 작가명 + 대화수가 잘리지 않고 들어갈 수 있도록) */
.crk-lt-info {
  width: 164.8px;
  height: 88.22px;
  padding: 6px 2px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  box-sizing: border-box;
  overflow: hidden;
}
.crk-lt-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text_primary, #111);
  margin: 0;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.35;
  word-break: break-all;
}
.crk-lt-creator {
  font-size: 12px;
  color: var(--text_tertiary, #aaa);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.crk-lt-chat {
  font-size: 12px;
  color: var(--text_tertiary, #aaa);
  margin: 0;
}

/* 썸네일 없는 카드 — 정보영역 고정 높이를 넘어가도 되도록 별도 처리
   (제목 + 안내문구로 88.22px를 초과할 수 있어 auto 높이 허용) */
.crk-lt-card-noimg .crk-lt-info {
  height: auto;
  min-height: 80px;
  justify-content: center;
}
.crk-lt-noimg-hint {
  font-size: 10.5px;
  color: var(--text_tertiary, #bbb);
  font-style: italic;
  margin: 4px 0 0;
}

/* 빈 상태 메시지 */
.crk-lt-empty {
  font-size: 13px;
  color: var(--text_tertiary, #aaa);
  text-align: center;
  padding: 48px 20px;
  line-height: 1.8;
  margin: 0;
}

/* 다크 모드 */
@media (prefers-color-scheme: dark) {
  #crk-liked-tabs { background: var(--bg_screen, #0e0e14); }
  .crk-lt-tab:hover { background: rgba(255,255,255,.05); color: var(--text_primary, #eee); }
  .crk-lt-cat-header { background: rgba(255,255,255,.05); }
  .crk-lt-cat-header:hover { background: rgba(245,166,35,.12); }
  .crk-lt-cat-count { background: rgba(255,255,255,.10); }
  .crk-lt-card {
    background: var(--bg_elevated_primary, #1a1a28);
  }
  .crk-lt-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,.35); }
  .crk-lt-title { color: var(--text_primary, #eee); }
  .crk-lt-thumb { background: rgba(255,255,255,.05); }
}
`;

  function _injectCSS() {
    if (document.getElementById('crk-peek-css')) return;
    const s = document.createElement('style');
    s.id = 'crk-peek-css'; s.textContent = _CSS;
    (document.head ?? document.documentElement).appendChild(s);
  }
  if (document.head) _injectCSS();
  else document.addEventListener('DOMContentLoaded', _injectCSS);

  /* ══════════════════════════════════════════════════════════════
     § 12. 유틸
     ══════════════════════════════════════════════════════════════ */
  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
  function _fmt(n) {
    if (n == null) return null;
    const v = Number(n);
    if (isNaN(v)) return String(n);
    if (v >= 1_000_000) return (v/1e6).toFixed(1).replace(/\.0$/,'')+'M';
    if (v >= 1_000)     return (v/1e3).toFixed(1).replace(/\.0$/,'')+'K';
    return String(v);
  }

})();
