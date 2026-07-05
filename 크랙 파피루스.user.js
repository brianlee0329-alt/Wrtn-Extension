// ==UserScript==
// @name         크랙 파피루스
// @version      1.0.4
// @description  유저노트 저장/불러오기 + 페르소나 순서 드래그 변경 + 페르소나 선택을 버튼 행 위로 이식 (통합 빌드 / GC 억제 적용)
// @author       milkyway0308
// @match        https://crack.wrtn.ai/*
// @require      https://cdn.jsdelivr.net/npm/dexie@4.2.1/dist/dexie.min.js#sha256-STeEejq7AcFOvsszbzgCDL82AjypbLLjD5O6tUByfuA=
// @require      https://cdn.jsdelivr.net/gh/milkyway0308/crystallized-chasm@crack-toastify-injection@v1.0.0/crack/libraries/toastify-injection.js
// @require      https://cdn.jsdelivr.net/gh/milkyway0308/crystallized-chasm@crack-shared-core@v1.2.1/crack/libraries/crack-shared-core.js
// @require      https://cdn.jsdelivr.net/gh/milkyway0308/crystallized-chasm@chasm-shared-core@v1.0.0/libraries/chasm-shared-core.js
// @require      https://cdn.jsdelivr.net/gh/milkyway0308/crystallized-chasm@decentralized-pre-1.0.15/decentralized-modal.js
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

// @ts-check
/// <reference path="../decentralized-modal.js" />
/// <reference path="../libraries/chasm-shared-core.js" />
/// <reference path="./libraries/crack-shared-core.js" />

// @ts-ignore
GM_addStyle(`
    /* ── DreamDiary 드롭다운 ── */
    .decentral-select {
        overflow: visible !important;
        display: flow-root !important;
    }
    .decentral-select[list-enabled="true"] .decentral-list {
        position: absolute !important;
        top: 100% !important;
        left: 0 !important;
        width: 100% !important;
        min-width: 200px !important;
        z-index: 99999 !important;
    }
    .chasm-ddia-zero-paddings {
        padding: 0px;
    }
    .chasm-ddia-custom-paddings {
        padding: 0px;
        padding-bottom: 8px;
    }
`);

// ════════════════════════════════════════════════════════════════════
//  공통 유틸: throttle
//  GenericUtil.attachObserver가 document(body subtree) 감시일 경우,
//  React 스트리밍 중 콜백이 초당 수십~수백 회 발화한다.
//  두 스크립트의 Observer 콜백을 모두 이 함수로 감싸서
//  실제 DOM 탐색/주입 호출 빈도를 제한한다.
//
//  [원칙 D] MutationObserver 콜백 내 연산을 throttle로 보호
//  - leading=true: 첫 발화는 즉시 실행 (반응성 유지)
//  - 이후 연속 발화는 wait ms 이내에 1회만 실행
// ════════════════════════════════════════════════════════════════════
function _makeThrottle(fn, wait) {
  let lastTime = 0;
  let rafId = null;
  return function throttled() {
    const now = Date.now();
    const remaining = wait - (now - lastTime);
    if (remaining <= 0) {
      // 즉시 실행 (leading)
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      lastTime = now;
      fn();
    } else if (rafId === null) {
      // trailing: 마지막 호출을 남은 시간 후 rAF로 실행
      // setTimeout 대신 rAF 사용 → 탭 비활성 시 자동 억제
      rafId = requestAnimationFrame(() => {
        lastTime = Date.now();
        rafId = null;
        fn();
      });
    }
    // remaining > 0 이고 rafId가 이미 있으면 → 이미 trailing 예약됨, 무시
  };
}

// ════════════════════════════════════════════════════════════════════
//  §1.  DreamDiary (유저노트 저장/불러오기)
// ════════════════════════════════════════════════════════════════════
!(async function () {
  const STANDARD_NOTIFICATION_TIME = 3000;
  // @ts-ignore
  const db = new Dexie("chasm-dream-diary");
  const logger = new LogUtil("Chasm Crystallized Dreamdiary", false);
  await db.version(1).stores({
    noteStore: `keyName, noteName, boundCharacter, noteContent, savedAt`,
    lastSelected: `boundCharacter, selected`,
  });

  class CustomUserNote {
    /**
     * @param {string} keyName
     * @param {string} noteContent
     * @param {string} name
     * @param {string} bound
     * @param {number} savedAt
     */
    constructor(keyName, name, bound, noteContent, savedAt) {
      this.keyId = keyName;
      this.name = name;
      this.bound = bound;
      this.noteContent = noteContent;
      this.savedAt = savedAt;
    }
  }

  // ─── 설정 ──────────────────────────────────────────────────────
  const settings = new LocaleStorageConfig("chasm-crck-ddia-settings", {
    /** @type {string | undefined} */
    lastPromptName: undefined,
    /** @type {string | undefined} */
    boundCharacter: undefined,
    /** @type {string | undefined} */
    lastPromptDisplay: undefined,
    /** @type {boolean} */
    isCustom: false,
  });

  // ─── DB 헬퍼 ───────────────────────────────────────────────────
  /**
   * @param {string} character
   * @returns {Promise<CustomUserNote[]>}
   */
  async function findAllNoteOf(character) {
    const result = await db.noteStore
      .where("boundCharacter")
      .anyOf("#global", character)
      .sortBy("savedAt");
    return result
      .reverse()
      .map(
        (/** @type {any}*/ data) =>
          new CustomUserNote(
            data.keyName,
            data.noteName,
            data.boundCharacter,
            data.noteContent,
            data.savedAt,
          ),
      );
  }

  /**
   * @param {string} character
   * @returns {Promise<any>}
   */
  async function getSelected(character) {
    const result = await db.lastSelected
      .where("boundCharacter")
      .anyOf(character)
      .toArray();
    if (result.length > 0) {
      return result[0].selected;
    }
    return undefined;
  }

  /**
   * @param {string} character
   * @param {string} key
   */
  async function setLastSelected(character, key) {
    await db.lastSelected.put({
      boundCharacter: character,
      selected: key,
    });
  }

  /**
   * @param {string} character
   */
  async function removeLastSelected(character) {
    await db.lastSelected.remove(character);
  }

  /**
   * @param {string} keyId
   * @returns {Promise<CustomUserNote | undefined>}
   */
  async function getNoteOf(keyId) {
    const data = await db.noteStore.where("keyName").anyOf(keyId).toArray();
    if (data.length <= 0) {
      return undefined;
    }
    return new CustomUserNote(
      data[0].keyName,
      data[0].noteName,
      data[0].boundCharacter,
      data[0].noteContent,
      data[0].savedAt,
    );
  }

  /**
   * @param {string} character
   * @param {string} noteName
   */
  async function deleteNoteOf(character, noteName) {
    try {
      await db.noteStore.delete(`${character}!+${noteName}`);
    } catch (err) {
      console.error(err);
    }
  }

  /**
   * @param {string} character
   * @param {string} noteName
   * @param {string} contents
   */
  async function saveNoteOf(character, noteName, contents) {
    try {
      await db.noteStore.put({
        keyName: `${character}!+${noteName}`,
        noteName: noteName,
        boundCharacter: character,
        noteContent: contents,
        savedAt: new Date().getTime(),
      });
    } catch (err) {
      console.error(err);
    }
  }

  // ─── 모달 탐색 ─────────────────────────────────────────────────
  /**
   * @returns {?Element}
   */
  function findModal() {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const dialog of dialogs) {
      for (const h of dialog.querySelectorAll("h2")) {
        if (h.textContent && h.textContent.trim() === "유저노트") {
          return dialog;
        }
      }
    }
    // 구버전 폴백
    const pool = [
      "css-4wk9gd",
      "css-1y4t25r",
      "css-aeatjm",
      "css-1o991gc",
    ];
    for (const key of pool) {
      const found = document.getElementsByClassName(key);
      if (found.length > 0) {
        return found[0];
      }
    }
    return null;
  }

  function injectModal() {
    // 이미 주입됐으면 즉시 종료 — DOM 탐색 자체를 최소화
    if (document.getElementById("chasm-ddia-note-listing")) {
      return;
    }
    const modal = findModal();
    if (!modal) return;
    const textArea = modal.getElementsByTagName("textarea");
    if (textArea.length <= 0) return;
    const listing = document.createElement("div");
    listing.classList.add("decentral-color-container");
    if (document.body.getAttribute("data-theme") === "dark") {
      listing.setAttribute("theme", "dark");
    }
    textArea[0].before(listing);
    const appender = new ComponentAppender(listing);
    const box = appender.constructSelectBox(
      "유저노트 프리셋 [3.0초 길게 눌러 노트 삭제]",
      settings.config.lastPromptName ?? "--이름을 지정하세요--",
      "chasm-ddia-settings#nonreachable",
      true,
    );
    /** @type {HTMLElement} */
    // @ts-ignore
    const textNode = box.node.parentElement.getElementsByTagName("p")[0];
    textNode.style.cssText = "user-select: none !important;";
    textNode.onmousedown = (event) => {
      let pressTime = 30;
      const timer = setInterval(() => {
        if (pressTime-- <= 0) {
          clearInterval(timer);
          textNode.textContent = "유저노트 프리셋 [3.0초 길게 눌러 노트 삭제]";
          if (settings.config.isCustom) {
            ToastifyInjector.findInjector().doToastifyAlert(
              "프롬프트 프리셋을 선택하지 않은 상태에서는 삭제할 수 없어요.",
              STANDARD_NOTIFICATION_TIME,
            );
          } else if (!settings.config.lastPromptName) {
            ToastifyInjector.findInjector().doToastifyAlert(
              "프롬프트 프리셋을 선택하지 않은 상태에서는 삭제할 수 없어요.",
              STANDARD_NOTIFICATION_TIME,
            );
          } else {
            deleteNoteOf(
              settings.config.boundCharacter ?? "",
              settings.config.lastPromptName,
            )
              .then(() => {
                refreshSelectBoxElement(
                  modal,
                  box,
                  textArea[0],
                  characterId,
                ).finally(() => {
                  box.setSelected("#custom");
                  box.runSelected();
                  ToastifyInjector.findInjector().doToastifyAlert(
                    "선택한 유저노트를 삭제했어요.\n예기치 못한 오류를 방지하기 위해 현재 선택한 유저노트는 커스텀으로 변경됐어요.",
                    STANDARD_NOTIFICATION_TIME,
                  );
                });
              })
              .catch((err) => {
                console.error(err);
                ToastifyInjector.findInjector().doToastifyAlert(
                  "유저노트를 삭제하는 도중 오류가 발생했어요.\n콘솔에 발생한 오류를 제보해주시면 캐즘 프로젝트의 개선에 도움을 줄 수 있어요.",
                  STANDARD_NOTIFICATION_TIME,
                );
              });
          }
        } else {
          textNode.textContent = `유저노트 프리셋 [${GenericUtil.formatNumber(
            0.1 * pressTime,
            1,
            1,
          )}초 길게 눌러 노트 삭제]`;
        }
      }, 100);

      textNode.onmouseup = () => {
        clearInterval(timer);
        textNode.textContent = "유저노트 프리셋 [3.0초 길게 눌러 노트 삭제]";
      };
    };

    textNode.ontouchstart = (event) => {
      event.preventDefault();
      event.stopPropagation();
      let pressTime = 30;
      const timer = setInterval(() => {
        if (pressTime-- <= 0) {
          clearInterval(timer);
          textNode.textContent = "유저노트 프리셋 [3.0초 길게 눌러 노트 삭제]";
          if (settings.config.isCustom) {
            ToastifyInjector.findInjector().doToastifyAlert(
              "프롬프트 프리셋을 선택하지 않은 상태에서는 삭제할 수 없어요.",
              STANDARD_NOTIFICATION_TIME,
            );
          } else if (!settings.config.lastPromptName) {
            ToastifyInjector.findInjector().doToastifyAlert(
              "프롬프트 프리셋을 선택하지 않은 상태에서는 삭제할 수 없어요.",
              STANDARD_NOTIFICATION_TIME,
            );
          } else {
            if (
              !confirm(
                "정말로 현재 노트를 삭제할까요?\n모바일 환경은 실수를 방지하기 위해 확인 절차가 존재해요.",
              )
            ) {
              return;
            }
            deleteNoteOf(
              settings.config.boundCharacter ?? "",
              settings.config.lastPromptName,
            )
              .then(() => {
                refreshSelectBoxElement(
                  modal,
                  box,
                  textArea[0],
                  characterId,
                ).finally(() => {
                  box.setSelected("#custom");
                  box.runSelected();
                  ToastifyInjector.findInjector().doToastifyAlert(
                    "선택한 유저노트를 삭제했어요.\n예기치 못한 오류를 방지하기 위해 현재 선택한 유저노트는 커스텀으로 변경됐어요.",
                    STANDARD_NOTIFICATION_TIME,
                  );
                });
              })
              .catch((err) => {
                console.error(err);
                ToastifyInjector.findInjector().doToastifyAlert(
                  "유저노트를 삭제하는 도중 오류가 발생했어요.\n콘솔에 발생한 오류를 제보해주시면 캐즘 프로젝트의 개선에 도움을 줄 수 있어요.",
                  STANDARD_NOTIFICATION_TIME,
                );
              });
          }
        } else {
          textNode.textContent = `유저노트 프리셋 [${GenericUtil.formatNumber(
            0.1 * pressTime,
            1,
            1,
          )}초 길게 눌러 노트 삭제]`;
        }
      }, 100);

      textNode.ontouchend = () => {
        clearInterval(timer);
        textNode.textContent = "유저노트 프리셋 [3.0초 길게 눌러 노트 삭제]";
      };

      textNode.ontouchcancel = () => {
        clearInterval(timer);
        textNode.textContent = "유저노트 프리셋 [3.0초 길게 눌러 노트 삭제]";
      };
    };
    GenericUtil.refine(box.node.parentElement).style = "padding: 0px;";
    GenericUtil.refine(box.node.previousSibling).style =
      "padding: 0px; padding-bottom: 8px;";

    GenericUtil.refine(box.node.parentElement).classList.add(
      "chasm-ddia-zero-paddings",
    );
    GenericUtil.refine(box.node.previousElementSibling).classList.add(
      "chasm-ddia-custom-paddings",
    );

    const split = window.location.pathname.substring(1).split("/");
    const characterId = split[1];
    refreshSelectBoxElement(modal, box, textArea[0], characterId).then(() => {
      getSelected(characterId).then((result) => {
        if (result) {
          box.setSelected(result);
          box.runSelected();
        }
      });
    });
    box.node.id = "chasm-ddia-note-listing";

    const node = appender.constructInputGrid(
      "chasm-ddia-user-note-name",
      "프롬프트 이름 지정",
      true,
    );
    GenericUtil.refine(node.parentElement).style.cssText = "display: none;";

    GenericUtil.refine(node.parentElement).classList.add(
      "chasm-ddia-zero-paddings",
    );
    GenericUtil.refine(node.previousElementSibling).classList.add(
      "chasm-ddia-custom-paddings",
    );
    GenericUtil.refine(node.parentElement).classList.add(
      "decentral-color-container",
    );
    const button = modal.getElementsByTagName("button");
    if (button.length > 0) {
      const buttonBefore = button[button.length - 1];
      const newButton = GenericUtil.clone(buttonBefore);
      newButton.id = "chasm-ddia-save";
      newButton.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();

        const split = window.location.pathname.substring(1).split("/");
        const characterId = split[1];
        const textContent = textArea[0].value;
        if (settings.config.isCustom) {
          const noteId = GenericUtil.refine(
            document.getElementById("chasm-ddia-user-note-name"),
          ).value;
          if (noteId.length <= 1) {
            ToastifyInjector.findInjector().doToastifyAlert(
              "커스텀 유저노트는 최소 1자 이상의 이름을 가져야 합니다.",
              STANDARD_NOTIFICATION_TIME,
            );
            return;
          }
          const isGlobal = confirm("전역 유저노트로 저장할까요?");
          const message = isGlobal
            ? `현재 캐릭터와 연결된 유저 노트 \n"${noteId}"\n를 저장했어요.`
            : `전역 유저 노트 \n"${noteId}"\n를 저장했어요.`;
          saveNoteOf(isGlobal ? "#global" : characterId, noteId, textContent)
            .then(() => {
              refreshSelectBoxElement(
                modal,
                box,
                textArea[0],
                characterId,
              ).then(() => {
                ToastifyInjector.findInjector().doToastifyAlert(
                  message,
                  STANDARD_NOTIFICATION_TIME,
                );
              });
            })
            .catch((err) => {
              ToastifyInjector.findInjector().doToastifyAlert(
                "유저노트를 저장하는 도중 오류가 발생했어요.\n콘솔에 발생한 오류를 제보해주시면 캐즘 프로젝트의 개선에 도움을 줄 수 있어요.",
                STANDARD_NOTIFICATION_TIME,
              );
              console.error(err);
            });
        } else {
          const message =
            settings.config.boundCharacter !== "#global"
              ? `현재 캐릭터와 연결된 유저 노트 \n"${settings.config.lastPromptName}"\n를 저장했어요.`
              : `전역 유저 노트 \n"${settings.config.lastPromptName}"\n를 저장했어요.`;
          if (
            !settings.config.boundCharacter ||
            !settings.config.lastPromptName
          ) {
            alert(
              "컨테이너 오류가 발생했어요.\n지원 채널에 이 오류를 제보해주시면 캐즘 프로젝트의 개선에 도움을 줄 수 있어요.",
            );
            return;
          }
          saveNoteOf(
            settings.config.boundCharacter,
            settings.config.lastPromptName,
            textContent,
          )
            .then(() => {
              refreshSelectBoxElement(
                modal,
                box,
                textArea[0],
                characterId,
              ).then(() => {
                ToastifyInjector.findInjector().doToastifyAlert(
                  message,
                  STANDARD_NOTIFICATION_TIME,
                );
              });
            })
            .catch((err) => {
              console.error(err);
              ToastifyInjector.findInjector().doToastifyAlert(
                "유저노트를 저장하는 도중 오류가 발생했어요.\n콘솔에 발생한 오류를 제보해주시면 캐즘 프로젝트의 개선에 도움을 줄 수 있어요.",
                STANDARD_NOTIFICATION_TIME,
              );
            });
        }
      };
      newButton.childNodes[newButton.childNodes.length - 1].textContent =
        "저장";
      newButton.style.cssText =
        "cursor: pointer; background-color: var(--outline_action_blue);";
      buttonBefore.before(newButton);
    }
  }

  function setup() {
    injectModal();
  }

  /**
   * @param {Element} modal
   * @param {any} box
   * @param {HTMLTextAreaElement} textArea
   * @param {string} characterId
   */
  async function refreshSelectBoxElement(modal, box, textArea, characterId) {
    const array = await findAllNoteOf(characterId);
    box.clear();
    box.addGroup("커스텀");
    box.addOption("커스텀", "#custom", () => {
      GenericUtil.refine(
        document.getElementById("chasm-ddia-user-note-name"),
      ).parentElement.style.cssText = "display: block;";
      GenericUtil.refine(
        document.getElementById("chasm-ddia-save"),
      ).removeAttribute("disabled");
      settings.config.isCustom = true;
      settings.config.boundCharacter = undefined;
      settings.config.lastPromptName = undefined;
      setLastSelected(characterId, "#custom");
      return true;
    });
    addElements(modal, box, textArea, characterId, array);
  }

  /**
   * @param {Element} modal
   * @param {any} box
   * @param {HTMLTextAreaElement} textArea
   * @param {string} characterId
   * @param {CustomUserNote[]} array
   */
  function addElements(modal, box, textArea, characterId, array) {
    const global = [];
    const bound = [];
    for (let item of array) {
      if (item.bound === "#global") {
        global.push(item);
      } else {
        bound.push(item);
      }
    }
    if (global.length > 0) {
      box.addGroup("전역 유저노트");
      for (let item of global) {
        box.addOption(item.name, item.keyId, () => {
          GenericUtil.refine(
            document.getElementById("chasm-ddia-user-note-name"),
          ).parentElement.style.cssText = "display: none;";
          GenericUtil.refine(
            document.getElementById("chasm-ddia-save"),
          ).removeAttribute("disabled");
          settings.config.isCustom = false;
          settings.config.lastPromptName = item.name;
          settings.config.boundCharacter = item.bound;
          setLastSelected(characterId, item.keyId);
          getNoteOf(item.keyId)
            .then((note) => {
              if (note) {
                processNoteApply(note, modal, textArea);
              } else {
                if (textArea.value.length > 0) {
                  textArea.value = "";
                }
                ToastifyInjector.findInjector().doToastifyAlert(
                  "이미 삭제한 유저노트가 불러와졌어요.\n오류를 방지하기 위해 필드는 빈 값으로 유지돼요.",
                  STANDARD_NOTIFICATION_TIME,
                );
              }
            })
            .catch((err) => {
              console.error(err);
              ToastifyInjector.findInjector().doToastifyAlert(
                "로컬 저장고에서 유저노트를 가져오는 중 오류가 발생했어요.\n콘솔에 발생한 오류를 제보해주시면 캐즘 프로젝트의 개선에 도움을 줄 수 있어요.",
                STANDARD_NOTIFICATION_TIME,
              );
            });
          return true;
        });
      }
    }
    if (bound.length > 0) {
      box.addGroup("캐릭터 유저노트");
      for (let item of bound) {
        box.addOption(item.name, item.keyId, () => {
          GenericUtil.refine(document.getElementById(
            "chasm-ddia-user-note-name",
          )).parentElement.style.cssText = "display: none;";
          setLastSelected(characterId, item.keyId);
          GenericUtil.refine(document
            .getElementById("chasm-ddia-save"))
            .removeAttribute("disabled");
          settings.config.isCustom = false;
          settings.config.lastPromptName = item.name;
          settings.config.boundCharacter = item.bound;
          setLastSelected(characterId, item.keyId);
          getNoteOf(item.keyId)
            .then((note) => {
              if (note) {
                processNoteApply(note, modal, textArea);
              } else {
                if (textArea.validationMessage.length > 0) {
                  performTextAreaModification(textArea, "");
                }
                ToastifyInjector.findInjector().doToastifyAlert(
                  "이미 삭제한 유저노트가 불러와졌어요.\n오류를 방지하기 위해 필드는 빈 값으로 유지돼요.",
                  STANDARD_NOTIFICATION_TIME,
                );
              }
            })
            .catch((err) => {
              console.error(err);
              ToastifyInjector.findInjector().doToastifyAlert(
                "로컬 저장고에서 유저노트를 가져오는 중 오류가 발생했어요.\n콘솔에 발생한 오류를 제보해주시면 캐즘 프로젝트의 개선에 도움을 줄 수 있어요.",
                STANDARD_NOTIFICATION_TIME,
              );
            });
          return true;
        });
      }
    }
  }

  /**
   * @param {CustomUserNote} arr
   * @param {any} modal
   * @param {HTMLTextAreaElement} textArea
   */
  async function processNoteApply(arr, modal, textArea) {
    if (arr.noteContent.length > 500) {
      if (textArea.maxLength <= 500) {
        let changed = false;
        const candidates1 = [
          ...Array.from(modal.getElementsByTagName("p")),
          ...Array.from(modal.getElementsByTagName("span")),
        ];
        for (const textElement of candidates1) {
          if (textElement.textContent === "유저노트 2000자 확장") {
            changed = true;
            textElement.nextElementSibling.click();
            try {
              const result = await autoClickConfirm();
              if (result) {
                ToastifyInjector.findInjector().doToastifyAlert(
                  "불러올 유저노트가 500자를 초과해요.\n걱정하지 마세요, 모듈에서 자동으로 유저노트 확장을 적용했답니다!",
                  STANDARD_NOTIFICATION_TIME,
                );
              } else {
                ToastifyInjector.findInjector().doToastifyAlert(
                  "불러올 유저노트가 500자를 초과해요.\n모듈에서 자동 처리를 시도했지만, 팝업 UI가 변경되어 완전 자동 처리는 실패했어요.\n이 오류는 결정화 캐즘 팀에 제보하면 빠르게 고칠 수 있어요.",
                  STANDARD_NOTIFICATION_TIME,
                );
              }
            } catch (err) {
              console.error(err);
              ToastifyInjector.findInjector().doToastifyAlert(
                "불러올 유저노트가 500자를 초과해요.\n모듈에서 자동 처리를 시도했지만, 알 수 없는 오류가 발생하여 완전 자동 처리는 실패했어요.\n이 오류는 결정화 캐즘 팀에 제보하면 빠르게 고칠 수 있어요.",
                STANDARD_NOTIFICATION_TIME,
              );
            }
          }
        }
        if (!changed) {
          ToastifyInjector.findInjector().doToastifyAlert(
            "업데이트로 인해 유저노트 확장 버튼이 바뀌어 자동으로 확장을 적용할 수 없는 상태예요.\n수동으로 버튼을 눌러 2천자로 변경하고, 다시 노트를 불러와주세요.\n이 오류는 결정화 캐즘 팀에 제보하면 빠르게 고칠 수 있어요.",
            STANDARD_NOTIFICATION_TIME,
          );
        }
      }
      performTextAreaModification(textArea, arr.noteContent);
    } else {
      performTextAreaModification(textArea, arr.noteContent);
      if (textArea.maxLength > 500) {
        let changed = false;
        const candidates2 = [
          ...Array.from(modal.getElementsByTagName("p")),
          ...Array.from(modal.getElementsByTagName("span")),
        ];
        for (const textElement of candidates2) {
          if (textElement.textContent === "유저노트 2000자 확장") {
            changed = true;
            textElement.nextElementSibling.click();
            const result = await autoClickConfirm();
            try {
              if (result) {
                ToastifyInjector.findInjector().doToastifyAlert(
                  "불러올 유저노트가 500자 이하예요.\n모듈에서 비용 감소를 위해 자동으로 확장을 비활성화했으니 안심하세요!",
                  STANDARD_NOTIFICATION_TIME,
                );
              } else {
                ToastifyInjector.findInjector().doToastifyAlert(
                  "불러올 유저노트가 500자 이하예요.\n모듈에서 자동 처리를 시도했지만, 팝업 UI가 변경되어 완전 자동 처리는 실패했어요.\n이 오류는 결정화 캐즘 팀에 제보하면 빠르게 고칠 수 있어요.",
                  STANDARD_NOTIFICATION_TIME,
                );
              }
            } catch (err) {
              console.error(err);
              ToastifyInjector.findInjector().doToastifyAlert(
                "불러올 유저노트가 500자 이하예요.\n모듈에서 자동 처리를 시도했지만, 알 수 없는 오류가 발생하여 완전 자동 처리는 실패했어요.\n이 오류는 결정화 캐즘 팀에 제보하면 빠르게 고칠 수 있어요.",
                STANDARD_NOTIFICATION_TIME,
              );
            }
          }
        }
        if (!changed) {
          ToastifyInjector.findInjector().doToastifyAlert(
            "업데이트로 인해 유저노트 확장 버튼이 바뀌어 자동으로 확장 토글을 적용할 수 없는 상태예요.\n수동으로 버튼을 눌러 500자로 변경하고, 다시 노트를 불러와주세요.\n이 오류는 결정화 캐즘 팀에 제보하면 빠르게 고칠 수 있어요.",
            STANDARD_NOTIFICATION_TIME,
          );
        }
      }
      performTextAreaModification(textArea, arr.noteContent);
    }
  }

  function findConfirmModal() {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    for (const dialog of dialogs) {
      for (const button of dialog.querySelectorAll("button")) {
        if (button.textContent && button.textContent.trim() === "확인") {
          return dialog;
        }
      }
    }
    let modal = document.getElementsByClassName("css-1jho4hy");
    if (modal.length > 0) {
      return modal[0];
    }
    modal = document.getElementsByClassName("css-fthmbk");
    if (modal.length > 0) {
      return modal[0];
    }
    return undefined;
  }

  async function autoClickConfirm() {
    let retryCount = 0;
    while (retryCount++ < 40) {
      const confirmModal = findConfirmModal();
      if (confirmModal) {
        for (const button of confirmModal.getElementsByTagName("button")) {
          if (button.textContent === "확인") {
            button.click();
            return true;
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
  }

  /**
   * @param {HTMLTextAreaElement} area
   * @param {string} text
   */
  function performTextAreaModification(area, text) {
    area.value = text;
    area.textContent = text;
    for (const key of Object.keys(area)) {
      if (key.startsWith("__reactProps")) {
        // @ts-ignore
        area[key].onChange({
          target: {
            value: text,
          },
        });
        break;
      }
    }
  }

  // ─── 초기화 ────────────────────────────────────────────────────
  // [원칙 D 적용]
  // GenericUtil.attachObserver(document, cb) 는 내부적으로
  // document(= body) subtree 전체를 감시하는 MutationObserver를 등록할 가능성이 높다.
  // React 스트리밍 중 콜백이 초당 수십~수백 회 발화하므로,
  // setup()과 __updateModalMenu() 를 직접 넘기지 않고
  // throttle로 감싼 버전을 넘긴다.
  //
  // throttle 300ms:
  // - 유저노트 모달은 사용자가 버튼을 눌렀을 때 열리므로 300ms 지연은 체감 불가
  // - React 스트리밍 중 콜백 폭발(초당 수백 회)을 초당 최대 3회로 억제
  // - leading=true 이므로 모달이 열리는 첫 발화는 즉시 처리됨
  const _throttledSetup = _makeThrottle(() => setup(), 300);
  const _throttledMenuUpdate = _makeThrottle(() => __updateModalMenu(), 300);

  function prepare() {
    setup(); // 최초 1회는 즉시 실행
    GenericUtil.attachObserver(document, _throttledSetup);
  }

  function addMenu() {
    const manager = ModalManager.getOrCreateManager("c2");
    manager.addLicenseDisplay((panel) => {
      panel.addTitleText("결정화 캐즘 꿈일기");
      panel.addText(
        "- decentralized-modal.js 프레임워크 사용 (https://github.com/milkyway0308/crystalized-chasm/decentralized.js)",
      );
    });
  }

  settings.load();
  addMenu();
  ("loading" === document.readyState
    ? document.addEventListener("DOMContentLoaded", prepare)
    : prepare(),
    window.addEventListener("load", prepare));

  // ─── 결정화 캐즘 메뉴 버튼 주입 ───────────────────────────────
  function __updateModalMenu() {
    const modal = document.getElementById("web-modal");
    if (modal && !document.getElementById("chasm-decentral-menu")) {
      const itemFound = modal.getElementsByTagName("a");
      for (let item of itemFound) {
        if (item.getAttribute("href") === "/setting") {
          const clonedElement = GenericUtil.clone(item);
          clonedElement.id = "chasm-decentral-menu";
          const textElement = clonedElement.getElementsByTagName("span")[0];
          textElement.innerText = "결정화 캐즘";
          clonedElement.setAttribute("href", "javascript: void(0)");
          clonedElement.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            ModalManager.getOrCreateManager("c2")
              .withLicenseCredential()
              .display(document.body.getAttribute("data-theme") !== "light");
          };
          item.parentElement?.append(clonedElement);
          break;
        }
      }
    } else if (
      !document.getElementById("chasm-decentral-menu") &&
      !window.matchMedia("(min-width: 768px)").matches
    ) {
      const selected = document.getElementsByTagName("a");
      for (const element of selected) {
        if (element.getAttribute("href") === "/my-page") {
          const clonedElement = GenericUtil.clone(element);
          clonedElement.id = "chasm-decentral-menu";
          const textElement = clonedElement.getElementsByTagName("span")[0];
          textElement.innerText = "결정화 캐즘";
          clonedElement.setAttribute("href", "javascript: void(0)");
          clonedElement.onclick = (event) => {
            event.preventDefault();
            event.stopPropagation();
            ModalManager.getOrCreateManager("c2")
              .withLicenseCredential()
              .display(document.body.getAttribute("data-theme") !== "light");
          };
          element.parentElement?.append(clonedElement);
        }
      }
    }
  }

  function __doModalMenuInit() {
    const refined = GenericUtil.refine(document);
    if (refined.c2ModalInit) return;
    refined.c2ModalInit = true;
    // [원칙 D 적용] throttle 적용된 버전 전달
    GenericUtil.attachObserver(document, _throttledMenuUpdate);
  }
  __doModalMenuInit();
})();


// ════════════════════════════════════════════════════════════════════
//  §2.  페르소나 순서 변경
//
//  [GC 억제 적용 내역]
//  원칙 B: setInterval(500ms) → rAF throttle(600ms) + 탭 비활성 자동 억제
//  원칙 D: body MutationObserver subtree:true → childList:false 로 축소
//          watchForRewire는 scrollBody 범위 한정 유지
//  추가:   inject() 재진입 뮤텍스
//          transplant 자기발화 방지: disconnect → 작업 → Promise.resolve reconnect
//          WeakMap으로 root별 observer 참조 관리
//          배열 재정렬: in-place appendChild (spread 중간 배열 제거)
//          isVisible: offsetParent 기반 (getBoundingClientRect reflow 제거)
//
//  [원칙 B 오프셋]
//  DreamDiary의 throttle 기준점(0ms)과 겹치지 않도록
//  페르소나 rAF 루프 시작을 1500ms 지연 후 시작.
//  두 스크립트의 DOM 탐색 피크가 동시에 발생하는 것을 방지.
// ════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // v1.0.1까지는 'crack_persona_order'(이름 배열)였으나, 동일 이름 식별이
  // 불가능한 포맷이라 v1.0.2에서 키 자체를 분리(기존 저장값은 자동 폐기됨).
  const STORAGE_KEY = 'crack_persona_order_v2';
  const MOVED_ATTR  = 'data-crk-persona-moved';

  // ── Storage ───────────────────────────────────────────────────
  function getOrder() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
    catch { return []; }
  }
  function saveOrder(keys) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  }

  // 이름이 같은 페르소나를 구분하기 위한 "이름#출현순번" 합성 키 생성기.
  // 이름 문자열만으로는 동일 이름 항목들을 서로 구분할 수 없어
  // Map/object 키가 충돌하는 문제(동일 이름 순서 변경 시 즉시 원복)가 있었음.
  // 호출할 때마다 새 Map을 만들어 써야 함(누적 카운트가 호출 단위로 끊겨야 함).
  function makeOccurrenceKeyer() {
    const seen = new Map();
    return name => {
      const n = seen.get(name) ?? 0;
      seen.set(name, n + 1);
      return `${name}#${n}`;
    };
  }

  // ── 공통 유틸 ─────────────────────────────────────────────────
  // offsetParent 기반 visibility: getBoundingClientRect reflow 없음
  function isVisible(el) {
    if (!el) return false;
    return el.offsetParent !== null || el.offsetWidth > 0 || el.offsetHeight > 0;
  }

  function getPersonaName(itemEl) {
    // 플랫폼이 이름 요소를 <p> → <span>으로 교체할 수 있으므로 양쪽 모두 탐색
    return itemEl.querySelector(':is(p, span).typo-text-base_leading-none_semibold')
      ?.textContent?.trim() ?? '';
  }

  function getPersonaItems(wrapperEl) {
    // 구버전: cursor="pointer" HTML 속성 (Emotion CSS 시절)
    const byAttr = Array.from(wrapperEl.querySelectorAll(':scope > div[cursor="pointer"]'));
    if (byAttr.length) return byAttr;
    // 신버전: cursor-pointer Tailwind 클래스 (Radix/Tailwind 리팩터 이후)
    const byClass = Array.from(wrapperEl.querySelectorAll(':scope > div.cursor-pointer'));
    if (byClass.length) return byClass;
    // 최후 폴백: 이름 요소(<p> 또는 <span>)가 존재하는 div
    return Array.from(wrapperEl.querySelectorAll(':scope > div')).filter(
      d => d.querySelector(':is(p, span).typo-text-base_leading-none_semibold')
    );
  }

  function findItemWrapper(root) {
    // 구버전: cursor="pointer" HTML 속성
    const byAttr = root.querySelector('div[cursor="pointer"]');
    if (byAttr) return byAttr.parentElement ?? null;
    // 신버전: cursor-pointer + bg-surface_tertiary Tailwind 클래스 (카드 컨테이너)
    const byClass = root.querySelector('div.cursor-pointer.bg-surface_tertiary');
    return byClass?.parentElement ?? null;
  }

  // ── A. 채팅 모달 탐색 ─────────────────────────────────────────
  function findChatModal() {
    // 신버전: Radix Dialog 기반 — <h2> 헤더 + div[role="dialog"] 컨테이너
    for (const h of document.querySelectorAll('h2')) {
      if (h.textContent.trim() !== '대화 프로필') continue;
      const modal = h.closest('div[role="dialog"]');
      if (modal && isVisible(modal)) return modal;
    }
    // 구버전 폴백: Emotion CSS — <p> 헤더 + div[width="444px"] 컨테이너
    for (const p of document.querySelectorAll('p.typo-text-xl_leading-none_semibold')) {
      if (p.textContent.trim() !== '대화 프로필') continue;
      const modal = p.closest('div[width="444px"]');
      if (modal && isVisible(modal)) return modal;
    }
    return null;
  }

  // ── B. setting/chat 목록 페이지 탐색 ─────────────────────────
  function findSettingPage() {
    const page = document.getElementById('setting-page');
    if (!page || !isVisible(page)) return null;
    return findItemWrapper(page);
  }

  // ── 순서 복원 ─────────────────────────────────────────────────
  let innerObs = null;

  function applySavedOrder(wrapperEl) {
    const saved = getOrder();
    if (!saved.length) return;
    const items = getPersonaItems(wrapperEl);
    if (!items.length) return;

    // DOM 노드는 이동하지 않고 CSS order만 부여한다 (React reconciliation 충돌 회피).
    // "이름#출현순번" 합성 키로 매칭하므로 동일 이름이 있어도 서로 다른
    // 항목으로 구분되어 order 값이 충돌하지 않는다.
    const keyer    = makeOccurrenceKeyer();
    const keys     = items.map(el => keyer(getPersonaName(el)));
    const savedIdx = new Map(saved.map((k, i) => [k, i]));
    let fallback   = saved.length;
    items.forEach((el, i) => {
      const idx = savedIdx.has(keys[i]) ? savedIdx.get(keys[i]) : fallback++;
      el.style.order = String(idx);
    });
  }

  function reconnectInnerObs(wrapperEl) {
    innerObs?.disconnect();
    innerObs = new MutationObserver(() => {
      const newItems = getPersonaItems(wrapperEl).filter(
        el => !el.querySelector('.crack-drag-handle')
      );
      if (!newItems.length) return;
      applySavedOrder(wrapperEl);
      getPersonaItems(wrapperEl).forEach(i => injectDragHandle(i, wrapperEl));
    });
    innerObs.observe(wrapperEl, { childList: true });
  }

  // ── 드래그 핸들 ───────────────────────────────────────────────
  let dragSrc = null;

  function injectDragHandle(item, wrapperEl) {
    if (item.querySelector('.crack-drag-handle')) return;
    const handle = Object.assign(document.createElement('span'), {
      className: 'crack-drag-handle',
      textContent: '⠿',
      title: '드래그하여 순서 변경',
    });
    Object.assign(handle.style, {
      // 채팅 세션 관리 스크립트가 .crack-drag-handle에 전역으로
      // position:absolute를 주입함. 인라인 스타일로 static 강제
      // → left/top/bottom/width도 static 맥락에서 무효화됨.
      position: 'static',
      cursor: 'grab', fontSize: '17px',
      color: 'var(--icon_primary, #888)', opacity: '0.4',
      padding: '0 8px 0 2px', flexShrink: '0',
      userSelect: 'none', transition: 'opacity .15s', alignSelf: 'center',
    });
    handle.addEventListener('mouseenter', () => { handle.style.opacity = '1'; });
    handle.addEventListener('mouseleave', () => { handle.style.opacity = '0.4'; });
    handle.addEventListener('mousedown', e => { e.stopPropagation(); item.draggable = true; });
    document.addEventListener('mouseup', () => { item.draggable = false; }, { capture: true });

    item.addEventListener('dragstart', e => {
      if (!item.draggable) { e.preventDefault(); return; }
      dragSrc = item;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', '');
      requestAnimationFrame(() => { item.style.opacity = '0.35'; });
    });
    item.addEventListener('dragend', () => {
      item.style.opacity = '';
      item.style.outline = '';
      item.draggable = false;
      dragSrc = null;

      const items   = getPersonaItems(wrapperEl);   // 고정 DOM(소스) 순서
      const keyer   = makeOccurrenceKeyer();
      const keyByEl = new Map(items.map(el => [el, keyer(getPersonaName(el))]));

      const ordered = items
        .slice()
        .sort((a, b) => (parseInt(a.style.order || '0', 10) - parseInt(b.style.order || '0', 10)));
      saveOrder(ordered.map(el => keyByEl.get(el)));
    });
    item.addEventListener('dragover', e => { e.preventDefault(); });
    item.addEventListener('dragenter', e => {
      e.preventDefault();
      if (dragSrc && dragSrc !== item) item.style.outline = '2px solid #9c27b0';
    });
    item.addEventListener('dragleave', e => {
      // 자식 요소로 이동 시 outline 깜빡임 방지: 실제로 item 영역을 벗어날 때만 제거
      if (!item.contains(e.relatedTarget)) item.style.outline = '';
    });
    item.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation();
      item.style.outline = '';
      if (!dragSrc || dragSrc === item) return;
      const items  = getPersonaItems(wrapperEl);
      const srcIdx = items.indexOf(dragSrc);
      const tgtIdx = items.indexOf(item);
      if (srcIdx === -1 || tgtIdx === -1) return;

      // DOM은 그대로 두고 시각적 순서 배열만 재계산 후 order 일괄 재부여
      const reordered = items.filter(el => el !== dragSrc);
      const newTgtIdx = reordered.indexOf(item);
      const insertPos = srcIdx < tgtIdx ? newTgtIdx + 1 : newTgtIdx;
      reordered.splice(insertPos, 0, dragSrc);
      reordered.forEach((el, i) => { el.style.order = String(i); });
    });

    // 이름 요소(span 또는 p)를 직접 찾아 그 부모를 삽입 대상으로 사용.
    // DOM 깊이(firstElementChild 체인)에 의존하지 않으므로 플랫폼 구조 변경에 강함.
    // 구버전(div[display="flex"] 속성) / 신버전(Tailwind flex 클래스) 모두 커버.
    const nameEl  = item.querySelector(':is(p, span).typo-text-base_leading-none_semibold');
    const nameRow = nameEl?.parentElement
      ?? item.querySelector('div[display="flex"]')
      ?? item.firstElementChild;
    if (nameRow) nameRow.insertBefore(handle, nameRow.firstChild);
  }

  // ── C. Combobox 드롭다운 순서 반영 ───────────────────────────
  function reorderListbox(listboxEl) {
    const saved = getOrder();
    if (!saved.length) return;
    const options = Array.from(listboxEl.querySelectorAll('[role="option"]'));
    if (!options.length) return;
    const getName = el => {
      const spans = el.querySelectorAll('span');
      for (const s of spans) { const t = s.textContent.trim(); if (t) return t; }
      return el.textContent.trim().split('\n')[0].trim();
    };
    // 카드 리스트와 동일한 "이름#출현순번" 합성 키로 매칭 (이름 중복 시 충돌 방지)
    const keyer  = makeOccurrenceKeyer();
    const keyed  = options.map(el => [keyer(getName(el)), el]);
    const map    = new Map(keyed);
    const sorted = [
      ...saved.filter(k => map.has(k)).map(k => map.get(k)),
      ...keyed.filter(([k]) => !saved.includes(k)).map(([, el]) => el),
    ];
    const parent = options[0].parentElement;
    if (!parent) return;
    for (const el of sorted) parent.appendChild(el);
  }

  function watchRadixPortals() {
    new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          const listboxes = node.matches('[role="listbox"]')
            ? [node]
            : Array.from(node.querySelectorAll('[role="listbox"]'));
          for (const lb of listboxes) {
            const lbId = lb.id;
            const combobox = lbId ? document.querySelector(`[aria-controls="${lbId}"]`) : null;
            const isPersona = combobox
              ? isPersonaComboboxEl(combobox)
              : (() => {
                  const saved = getOrder();
                  if (!saved.length) return false;
                  const opts = Array.from(lb.querySelectorAll('[role="option"]'));
                  const names = opts.map(o => o.textContent.trim().split('\n')[0].trim());
                  // saved는 "이름#출현순번" 합성 키이므로 이름 부분만 떼어 비교
                  const savedNames = saved.map(k => k.replace(/#\d+$/, ''));
                  return savedNames.some(n => names.includes(n));
                })();
            if (isPersona) {
              setTimeout(() => reorderListbox(lb), 30);
            }
          }
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  function isPersonaComboboxEl(btn) {
    const row = btn.parentElement;
    if (!row) return false;
    // 플랫폼이 레이블 태그를 <p> → <span>으로 교체할 수 있으므로 양쪽 모두 탐색
    for (const el of row.querySelectorAll(':is(p, span)')) {
      if (el.textContent.trim() === '대화 프로필') return true;
    }
    return false;
  }

  // ── D. 페르소나 행 이식 ───────────────────────────────────────
  const ACTION_KEYWORDS = ['이어하기', '새로하기', '플레이'];

  function findPersonaRow(root) {
    // 플랫폼이 레이블 태그를 <p> → <span>으로 교체할 수 있으므로 양쪽 모두 탐색
    const all = root.querySelectorAll(':is(p, span)');
    for (const el of all) {
      if (el.textContent.trim() !== '대화 프로필') continue;
      const row = el.parentElement;
      if (!row) continue;
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

  // transplant 중 자신이 발화한 MutationObserver 재진입 방지
  // WeakMap으로 root별 {obs, scrollBody} 참조 관리
  const rewireObservers = new WeakMap();

  function transplantPersonaRow(root) {
    const buttonRow = findActionButtonRow(root);
    if (!buttonRow) return;

    const prev = buttonRow.previousElementSibling;
    if (prev && prev.getAttribute(MOVED_ATTR) === '1') {
      if (prev.querySelector('button[role="combobox"]')) return;
      prev.remove();
    }

    const personaRow = findPersonaRow(root);
    if (!personaRow) return;

    // 이식 전: rewire observer 일시 정지
    const entry = rewireObservers.get(root);
    entry?.obs?.disconnect();

    personaRow.style.setProperty('padding', '10px 20px 8px', 'important');
    personaRow.style.setProperty('border-top', '1px solid var(--border-divider_primary, var(--outline_secondary, #2a2a2a))', 'important');
    personaRow.setAttribute(MOVED_ATTR, '1');
    buttonRow.parentElement?.insertBefore(personaRow, buttonRow);

    // 이식 완료 후 microtask에서 재연결
    Promise.resolve().then(() => {
      if (entry) {
        entry.obs.observe(entry.scrollBody, { childList: true, subtree: true });
      }
    });
  }

  const watchedRoots = new WeakSet();

  function watchForRewire(root) {
    if (watchedRoots.has(root)) return;
    watchedRoots.add(root);

    const scrollBody = root.querySelector('[overflow="auto"]')
      ?? root.querySelector('.character-info-modal-content-body')
      ?? root;

    const obs = new MutationObserver(() => {
      if (findPersonaRow(scrollBody)) {
        transplantPersonaRow(root);
      }
    });
    obs.observe(scrollBody, { childList: true, subtree: true });
    rewireObservers.set(root, { obs, scrollBody });
  }

  function transplantInContext(root) {
    transplantPersonaRow(root);
    watchForRewire(root);
  }

  // ── 주입 (A+B+D 컨텍스트) ─────────────────────────────────────
  const injectedWrappers = new WeakSet();

  function processWrapper(wrapperEl) {
    if (!wrapperEl) return;
    applySavedOrder(wrapperEl);
    getPersonaItems(wrapperEl).forEach(i => injectDragHandle(i, wrapperEl));
    if (!injectedWrappers.has(wrapperEl)) {
      injectedWrappers.add(wrapperEl);
      reconnectInnerObs(wrapperEl);
    }
  }

  // inject() 재진입 방지 뮤텍스
  let _injectRunning = false;

  function inject() {
    if (_injectRunning) return;
    _injectRunning = true;
    try {
      const chatModal = findChatModal();
      if (chatModal) processWrapper(findItemWrapper(chatModal));

      const settingWrapper = findSettingPage();
      if (settingWrapper) processWrapper(settingWrapper);

      const webModal = document.getElementById('web-modal');
      if (webModal && isVisible(webModal)) {
        transplantInContext(webModal);
      } else {
        transplantInContext(document.body);
      }
    } finally {
      _injectRunning = false;
    }
  }

  // ── Observer 설정 ─────────────────────────────────────────────
  // [원칙 D] body 전체 subtree 감시 → childList only (SPA 라우팅/모달 열림 감지 전용)
  const webModal = document.getElementById('web-modal');
  if (webModal) {
    new MutationObserver(() => inject())
      .observe(webModal, { childList: true, subtree: true, attributes: true });
  }
  new MutationObserver(() => inject())
    .observe(document.body, { childList: true, subtree: false });

  // C. Radix 포털 감시 (listbox 등장 감지 목적, subtree:true 불가피)
  watchRadixPortals();

  // [원칙 B 오프셋]
  // DreamDiary throttle(0ms 기준)과 피크가 겹치지 않도록
  // 페르소나 rAF 루프를 1500ms 지연 후 시작
  let _lastInjectTime = 0;
  const INJECT_THROTTLE_MS = 600;

  function rafLoop(ts) {
    if (ts - _lastInjectTime >= INJECT_THROTTLE_MS) {
      _lastInjectTime = ts;
      inject();
    }
    requestAnimationFrame(rafLoop);
  }
  setTimeout(() => requestAnimationFrame(rafLoop), 1500);

})();
