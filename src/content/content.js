/**
 * MMCopyPaste — content script.
 *
 * Слушает события ввода на странице и, как только пользователь допечатал
 * кодовое слово ("--прив"), заменяет его текстом макроса (с подстановкой
 * плейсхолдеров профиля). Опционально эмулирует отправку (Enter/Shift/Ctrl).
 *
 * Поддерживаются <textarea>, <input type=text|search|url|tel|email> и
 * contenteditable-поля (Telegram, Google, Arena и т.п.).
 */
(function (root) {
  'use strict';

  if (root.__mmcContentInstalled) return;
  root.__mmcContentInstalled = true;

  const doc = root.document;
  const expand = root.MMC.expand;
  const domains = root.MMC.domains;
  const storage = root.MMC.storage;

  let state = storage.createDefaultState();
  let hostname = domains.getHostname(root.location && root.location.href);

  function macrosForHost() {
    return domains.activeMacros(state, hostname);
  }

  function varsForHost() {
    return storage.effectiveVars(state, hostname);
  }

  /** 'plain' — textarea/input, 'editable' — contenteditable, null — не поле ввода. */
  function fieldKind(el) {
    if (!el || el.nodeType !== 1) return null;
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return 'plain';
    if (tag === 'INPUT') {
      const type = String(el.type || 'text').toLowerCase();
      return ['text', 'search', 'url', 'tel', 'email', ''].indexOf(type) >= 0 ? 'plain' : null;
    }
    if (el.isContentEditable) return 'editable';
    return null;
  }

  /* ------------------------------------------------------------------ *
   * Отправка (эмуляция клавиш)
   * ------------------------------------------------------------------ */

  function makeKeyEvent(type, mode) {
    const init = {
      key: 'Enter',
      code: 'Enter',
      bubbles: true,
      cancelable: true
    };
    if (mode === 'shift') init.shiftKey = true;
    if (mode === 'ctrl') init.ctrlKey = true;
    let event;
    try {
      event = new root.KeyboardEvent(type, init);
    } catch (err) {
      event = new root.Event(type, { bubbles: true, cancelable: true });
    }
    // Некоторые чаты читают keyCode/which — добавим их.
    try {
      Object.defineProperty(event, 'keyCode', { get: () => 13 });
      Object.defineProperty(event, 'which', { get: () => 13 });
    } catch (err) {
      /* read-only в некоторых средах — не критично */
    }
    return event;
  }

  function sendAfter(el, mode) {
    if (!mode || mode === 'none' || !el) return;
    el.dispatchEvent(makeKeyEvent('keydown', mode));
    el.dispatchEvent(makeKeyEvent('keypress', mode));
  }

  /* ------------------------------------------------------------------ *
   * textarea / input
   * ------------------------------------------------------------------ */

  function setPlainValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA' ? root.HTMLTextAreaElement.prototype : root.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new root.Event('input', { bubbles: true }));
  }

  function expandPlain(el) {
    const value = typeof el.value === 'string' ? el.value : '';
    if (!value) return false;

    const caret = typeof el.selectionStart === 'number' ? el.selectionStart : value.length;
    const trigger = expand.findTrigger({
      text: value,
      caret,
      prefixes: expand.prefixVariants(state.prefix),
      macros: macrosForHost()
    });
    if (!trigger) return false;

    const finalText = expand.fillTemplate(trigger.macro.text, varsForHost());
    const next = expand.replaceRange(value, trigger.start, trigger.end, finalText);

    let inserted = false;
    try {
      el.focus();
      if (typeof el.setSelectionRange === 'function') el.setSelectionRange(trigger.start, trigger.end);
      inserted = !!(doc.execCommand && doc.execCommand('insertText', false, finalText));
    } catch (err) {
      inserted = false;
    }
    if (!inserted || el.value !== next.text) setPlainValue(el, next.text);

    try {
      if (typeof el.setSelectionRange === 'function') el.setSelectionRange(next.caret, next.caret);
    } catch (err) {
      /* поле могло потерять фокус */
    }
    sendAfter(el, trigger.macro.send);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * contenteditable: полный обход текстовых узлов
   * ------------------------------------------------------------------ */

  function getSelection() {
    if (typeof root.getSelection === 'function') return root.getSelection();
    if (doc && typeof doc.getSelection === 'function') return doc.getSelection();
    return null;
  }

  function dispatchInput(el, text) {
    let event = null;
    try {
      event = new root.InputEvent('input', { bubbles: true, inputType: 'insertText', data: text });
    } catch (err) {
      event = new root.Event('input', { bubbles: true });
    }
    el.dispatchEvent(event);
  }

  /** Каретка в элемент (offset = номер дочернего узла) -> текстовый узел и смещение. */
  function resolveCaretToText(node, offset) {
    if (node && node.nodeType === 3) return { node, offset };
    if (node && node.nodeType === 1) {
      const kids = node.childNodes;
      if (offset > 0) {
        const prev = kids[offset - 1];
        if (prev && prev.nodeType === 3) return { node: prev, offset: prev.data.length };
      }
      const next = kids[offset];
      if (next && next.nodeType === 3) return { node: next, offset: 0 };
    }
    return null;
  }

  /** Собираем весь текст editable-корня и смещения текстовых узлов. */
  function editableInfo(el, selection) {
    const walker = doc.createTreeWalker(el, root.NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let text = '';
    let node;
    while ((node = walker.nextNode())) {
      nodes.push({ node, start: text.length });
      text += node.data;
    }

    let caret = null;
    if (selection && selection.rangeCount) {
      const range = selection.getRangeAt(0);
      if (range && range.collapsed) {
        let textNode = null;
        let local = 0;
        const container = range.startContainer;
        if (container.nodeType === 3) {
          textNode = container;
          local = range.startOffset;
        } else {
          const resolved = resolveCaretToText(container, range.startOffset);
          if (resolved) {
            textNode = resolved.node;
            local = resolved.offset;
          }
        }
        if (textNode) {
          const found = nodes.find((item) => item.node === textNode);
          if (found) caret = found.start + local;
        }
      }
    }
    return { text, nodes, caret };
  }

  /** Строим DOM-диапазон по глобальным смещениям [start, end). */
  function rangeForOffsets(nodes, start, end) {
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;
    for (const item of nodes) {
      const s = item.start;
      const e = item.start + item.node.data.length;
      if (startNode === null && start >= s && start <= e) {
        startNode = item.node;
        startOffset = start - s;
      }
      if (end >= s && end <= e) {
        endNode = item.node;
        endOffset = end - s;
      }
    }
    if (!startNode || !endNode) return null;
    const range = doc.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  }

  /** Вставка текста вручную, с переносами строк через <br>. */
  function insertIntoRange(range, text) {
    const fragment = doc.createDocumentFragment();
    const lines = String(text).split('\n');
    lines.forEach((line, index) => {
      if (index > 0) fragment.appendChild(doc.createElement('br'));
      if (line) fragment.appendChild(doc.createTextNode(line));
    });
    const lastNode = fragment.lastChild;
    range.deleteContents();
    range.insertNode(fragment);

    const selection = getSelection();
    if (selection) {
      const caretRange = doc.createRange();
      if (lastNode) caretRange.setStartAfter(lastNode);
      else caretRange.setStart(range.startContainer, range.startOffset);
      caretRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caretRange);
    }
  }

  function expandEditable(el) {
    const selection = getSelection();
    if (!selection || !selection.rangeCount) return false;

    const info = editableInfo(el, selection);
    if (info.caret == null) return false;

    const trigger = expand.findTrigger({
      text: info.text,
      caret: info.caret,
      prefixes: expand.prefixVariants(state.prefix),
      macros: macrosForHost()
    });
    if (!trigger) return false;

    const range = rangeForOffsets(info.nodes, trigger.start, trigger.end);
    if (!range) return false;

    const finalText = expand.fillTemplate(trigger.macro.text, varsForHost());

    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;
    try {
      inserted = !!(doc.execCommand && doc.execCommand('insertText', false, finalText));
    } catch (err) {
      inserted = false;
    }
    if (!inserted) insertIntoRange(range, finalText);

    dispatchInput(el, finalText);
    sendAfter(el, trigger.macro.send);
    return true;
  }

  /* ------------------------------------------------------------------ *
   * События
   * ------------------------------------------------------------------ */

  function runOn(target) {
    const kind = fieldKind(target);
    if (!kind) return false;
    if (!macrosForHost().length) return false;
    if (kind === 'plain') return expandPlain(target);
    return expandEditable(target);
  }

  function onInput(event) {
    if (!event || event.isComposing) return; // не мешаем IME
    if (!state || state.enabled === false) return;
    runOn(event.target);
  }

  /**
   * Ручной триггер Ctrl+Shift+M: раскрывает макрос в текущем поле независимо от
   * того, как сайт обрабатывает input (ProseMirror/Telegram, Google и т.п.).
   * Набираете "--прив", жмёте Ctrl+Shift+M — текст подставляется.
   */
  function onKeydown(event) {
    if (!event || event.isComposing) return;
    if (!state || state.enabled === false) return;
    if (!(event.ctrlKey && event.shiftKey && event.code === 'KeyM')) return;
    if (runOn(event.target)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  function setState(nextState) {
    state = storage.normalize(nextState);
  }

  function install() {
    storage.load().then(setState).catch(() => {});
    storage.onChange(setState);
    doc.addEventListener('input', onInput, true);
    doc.addEventListener('keydown', onKeydown, true);
  }

  install();

  root.MMC.content = {
    get state() {
      return state;
    },
    get hostname() {
      return hostname;
    },
    setHostname(value) {
      hostname = domains.normalizeDomain(value);
    },
    setState,
    fieldKind,
    expandPlain,
    expandEditable,
    onInput,
    onKeydown
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
