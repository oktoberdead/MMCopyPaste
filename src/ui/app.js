/**
 * MicroMacro — общий интерфейс попапа и страницы настроек.
 *
 * Два режима: «Пасты» (крупные куски, поиск, вставка через буфер, без профилей и
 * триггеров) и «Макросы» (кодовые слова, профили, плейсхолдеры, автоотправка).
 *
 * Попап: тумблер режимов под шапкой, по умолчанию «Пасты»; показывает только
 * активный режим. Настройки: обе секции за дропдаунами + глобальные настройки.
 */
(function (root) {
  'use strict';

  const doc = root.document;
  const storage = root.MMC.storage;
  const domains = root.MMC.domains;
  const expand = root.MMC.expand;
  const search = root.MMC.search;
  const parser = root.MMC.parser;

  function el(tag, attrs, children) {
    const node = doc.createElement(tag);
    const list = [].concat(children == null ? [] : children);
    for (const [name, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (name === 'class') node.className = value;
      else if (name === 'text') node.textContent = value;
      else if (name === 'disabled') node.disabled = !!value;
      else if (name === 'hidden') node.hidden = !!value;
      else if (name.startsWith('on') && typeof value === 'function') {
        node.addEventListener(name.slice(2).toLowerCase(), value);
      } else node.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of list) {
      if (child == null || child === false) continue;
      node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child);
    }
    return node;
  }

  function replaceChildren(node, children) {
    node.textContent = '';
    for (const child of [].concat(children || [])) if (child) node.appendChild(child);
  }

  function preview(text, limit) {
    const flat = String(text || '').replace(/\s+/g, ' ').trim();
    return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat;
  }

  function mount(rootEl, options) {
    const opts = options || {};
    const page = opts.mode === 'options' ? 'options' : 'popup';
    const isOptions = page === 'options';
    const hostname = domains.normalizeDomain(opts.hostname || '');

    doc.body.classList.add('mode-' + page);

    const ui = {
      state: storage.createDefaultState(),
      mode: isOptions ? 'macros' : 'pastes',
      profileId: domains.GLOBAL_PROFILE_ID,
      editing: null,
      adding: false,
      confirmDelete: null,
      hint: '',
      pasteQuery: '',
      pasteEditing: null,
      pasteAdding: false,
      pasteConfirmDelete: null,
      pasteHint: ''
    };

    /* ------------------------------- Шапка ------------------------------- */

    const toggleInput = el('input', { type: 'checkbox', onchange: onToggleEnabled });
    const toggleLabel = el('span', { class: 'label-on', text: 'Вкл' });
    const toggle = el('label', { class: 'switch', title: 'Включить или выключить подстановку макросов' }, [
      toggleInput,
      el('span', { class: 'track' }),
      toggleLabel
    ]);

    const header = el('header', { class: 'app-header' }, [
      el('span', { class: 'logo', text: 'MM' }),
      el('div', { class: 'app-title' }, [
        el('h1', { text: 'MicroMacro' }),
        el('p', { text: 'Пасты и макросы для чата' })
      ]),
      toggle
    ]);

    /* --------------------------- Переключатель --------------------------- */

    const modePastesBtn = el('button', { class: 'seg', type: 'button', onclick: () => setMode('pastes') }, ['Пасты']);
    const modeMacrosBtn = el('button', { class: 'seg', type: 'button', onclick: () => setMode('macros') }, ['Макросы']);
    const modeToggle = el('div', { class: 'mode-toggle' }, [modePastesBtn, modeMacrosBtn]);

    function setMode(mode) {
      ui.mode = mode;
      applyMode();
      render();
    }

    function applyMode() {
      modePastesBtn.classList.toggle('is-active', ui.mode === 'pastes');
      modeMacrosBtn.classList.toggle('is-active', ui.mode === 'macros');
      if (macrosWrap) macrosWrap.hidden = ui.mode !== 'macros';
      if (pastesWrap) pastesWrap.hidden = ui.mode !== 'pastes';
    }

    /* ============================= МАКРОСЫ =============================== */

    const profilesEl = el('nav', { class: 'profiles' });

    const addBtn = el('button', { class: 'btn btn-primary', type: 'button', onclick: startAdding }, ['+ Макрос']);
    const profileToggleBtn = el('button', {
      class: 'btn',
      type: 'button',
      title: 'Вкл/выкл текущий профиль (или ПКМ по пилюле)',
      onclick: () => toggleProfile(currentProfile())
    });
    const countEl = el('span', { class: 'count' });
    const toolbar = el('div', { class: 'toolbar' }, [addBtn, profileToggleBtn, el('span', { class: 'spacer' }), countEl]);

    const listEl = el('section', { class: 'list' });

    const keyInput = el('input', {
      type: 'text', placeholder: 'прив', autocomplete: 'off', spellcheck: 'false',
      maxlength: String(storage.MAX_KEY_LENGTH)
    });
    const keyPrefixEl = el('span', { class: 'key-prefix', text: '--' });
    const textArea = el('textarea', { placeholder: 'Текст подстановки. Плейсхолдеры: {имя}, {дата}…', onkeydown: onEditorKeydown });
    const sendSelect = el('select', { class: 'plain', title: 'Автоотправка после подстановки' });
    for (const value of storage.SEND_MODES) sendSelect.appendChild(el('option', { value, text: storage.SEND_LABELS[value] }));
    const hintEl = el('div', { class: 'hint' });
    const phHint = el('div', { class: 'ph-hint' });
    const saveBtn = el('button', { class: 'btn btn-primary', type: 'button', onclick: submitEditor }, ['Сохранить']);
    const cancelBtn = el('button', { class: 'btn', type: 'button', onclick: closeEditor }, ['Отмена']);

    keyInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); textArea.focus(); }
    });

    const editorEl = el('form', { class: 'editor', onsubmit: onSubmit, hidden: true }, [
      el('div', { class: 'field' }, [el('label', { text: 'Кодовое слово' }), el('div', { class: 'key-wrap' }, [keyPrefixEl, keyInput])]),
      el('div', { class: 'field' }, [el('label', { text: 'Текст подстановки' }), textArea, phHint]),
      el('div', { class: 'field' }, [el('label', { text: 'После подстановки' }), sendSelect]),
      el('div', { class: 'editor-actions' }, [hintEl, cancelBtn, saveBtn])
    ]);
    textArea.addEventListener('input', updatePhHint);

    const varsEl = isOptions ? el('section', { class: 'vars' }) : null;
    const varKeyInput = el('input', { class: 'plain', type: 'text', placeholder: 'имя' });
    const varValueInput = el('input', { class: 'plain', type: 'text', placeholder: 'Иван' });
    const addVarBtn = el('button', { class: 'btn', type: 'button', onclick: addVar }, ['Добавить']);

    /* ============================== ПАСТЫ ================================ */

    const searchInput = el('input', {
      class: 'plain search', type: 'search', placeholder: 'Поиск по пастам…', autocomplete: 'off'
    });
    searchInput.addEventListener('input', () => {
      ui.pasteQuery = searchInput.value;
      renderPasteList();
    });
    const searchRow = el('div', { class: 'search-row' }, [searchInput]);

    const addPasteBtn = el('button', { class: 'btn btn-primary', type: 'button', onclick: startAddingPaste }, ['+ Паста']);
    const pasteCountEl = el('span', { class: 'count' });
    const pasteToolbar = el('div', { class: 'toolbar' }, [addPasteBtn, el('span', { class: 'spacer' }), pasteCountEl]);

    const pasteListEl = el('section', { class: 'list' });

    const pasteTitleInput = el('input', { class: 'plain', type: 'text', placeholder: 'адрес', maxlength: String(storage.MAX_KEY_LENGTH) });
    const pasteTextArea = el('textarea', { class: 'paste-text', placeholder: 'Большой текст ответа… Плейсхолдеры: {имя}, {g}, {дата}…' });
    const pastePhHint = el('div', { class: 'ph-hint' });
    const pasteHintEl = el('div', { class: 'hint' });
    const pasteSaveBtn = el('button', { class: 'btn btn-primary', type: 'button', onclick: submitPaste }, ['Сохранить']);
    const pasteCancelBtn = el('button', { class: 'btn', type: 'button', onclick: closePasteEditor }, ['Отмена']);
    const pasteEditorEl = el('form', { class: 'editor', onsubmit: onPasteSubmit, hidden: true }, [
      el('div', { class: 'field' }, [el('label', { text: 'Заголовок' }), pasteTitleInput]),
      el('div', { class: 'field' }, [el('label', { text: 'Текст' }), pasteTextArea, pastePhHint]),
      el('div', { class: 'editor-actions' }, [pasteHintEl, pasteCancelBtn, pasteSaveBtn])
    ]);
    pasteTextArea.addEventListener('input', updatePastePhHint);

    const importPastesFile = el('input', { type: 'file', accept: '.md,.txt,text/markdown,text/plain', onchange: onImportPastesFile });
    const clearPastesBtn = el('button', { class: 'btn is-danger', type: 'button', onclick: clearAllPastes }, ['Удалить все пасты']);
    const pasteImportRow = isOptions
      ? el('div', { class: 'settings-row' }, [
          el('button', { class: 'btn', type: 'button', onclick: () => importPastesFile.click() }, ['Импортировать .md/.txt (##)']),
          importPastesFile,
          clearPastesBtn
        ])
      : null;

    /* ============================= Настройки ============================= */

    const prefixInput = el('input', { class: 'plain', type: 'text', maxlength: '4', onchange: onPrefixChange });
    const domainInput = el('input', { class: 'plain', type: 'text', placeholder: 'ai.sknt.ru',
      onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addDomain(); } } });
    const importInput = el('input', { type: 'file', accept: '.json,application/json', onchange: onImportFile });
    const deleteProfileBtn = el('button', { class: 'btn', type: 'button', onclick: removeCurrentProfile }, ['Удалить профиль']);

    const importMacrosFile = el('input', { type: 'file', accept: '.md,.txt,text/markdown,text/plain', onchange: onImportMacrosFile });
    const importTargetSel = el('select', { class: 'plain', title: 'Куда поместить загруженные макросы' });
    const importDomainInput = el('input', { class: 'plain', type: 'text', placeholder: 'домен нового профиля' });

    const settingsEl = isOptions
      ? el('section', { class: 'settings' }, [
          el('h2', { text: 'Настройки макросов' }),
          el('div', { class: 'settings-row' }, [
            el('div', { class: 'field small' }, [el('label', { text: 'Префикс триггера' }), prefixInput]),
            el('div', { class: 'field grow' }, [el('label', { text: 'Новый профиль для домена' }), domainInput]),
            el('button', { class: 'btn', type: 'button', onclick: addDomain }, ['Добавить'])
          ]),
          el('h2', { text: 'Импорт макросов (--ключ: текст)' }),
          el('div', { class: 'settings-row' }, [
            el('div', { class: 'field grow' }, [el('label', { text: 'Куда импортировать' }), importTargetSel]),
            el('div', { class: 'field grow' }, [el('label', { text: 'Домен нового профиля' }), importDomainInput]),
            el('button', { class: 'btn', type: 'button', onclick: () => importMacrosFile.click() }, ['Загрузить .md/.txt']),
            importMacrosFile
          ]),
          el('h2', { text: 'Резервная копия' }),
          el('div', { class: 'settings-row' }, [
            el('button', { class: 'btn', type: 'button', onclick: onExport }, ['Скачать JSON']),
            el('button', { class: 'btn', type: 'button', onclick: () => importInput.click() }, ['Загрузить JSON']),
            importInput,
            deleteProfileBtn
          ])
        ])
      : null;

    const settingsLink = el('button', { class: 'link', type: 'button', onclick: openOptions }, ['Настройки →']);
    const footer = !isOptions ? el('footer', { class: 'app-footer' }, [el('span', { class: 'spacer' }), settingsLink]) : null;

    /* ------------------------------ Сборка ------------------------------- */

    function makeCollapse(titleText, inner, defaultOpen) {
      const body = el('div', { class: 'collapse-body' }, inner);
      const caret = el('span', { class: 'caret', text: defaultOpen ? '˄' : '˅' });
      const head = el('button', {
        class: 'collapse-head' + (defaultOpen ? ' is-open' : ''),
        type: 'button',
        onclick: () => {
          body.hidden = !body.hidden;
          head.classList.toggle('is-open', !body.hidden);
          caret.textContent = body.hidden ? '˅' : '˄';
        }
      }, [el('span', { text: titleText }), caret]);
      body.hidden = !defaultOpen;
      return el('section', { class: 'collapse' }, [head, body]);
    }

    let macrosWrap = null;
    let pastesWrap = null;

    // Вкладки показывают только свой контент. На странице настроек сам список
    // макросов/паст прячем в дропдаун, а профили, плейсхолдеры и настройки —
    // наружу, чтобы они были доступнее длинного списка.
    function macrosTab() {
      return isOptions
        ? [
            profilesEl,
            toolbar,
            makeCollapse('Список макросов', [listEl], false),
            editorEl,
            varsEl,
            settingsEl
          ]
        : [profilesEl, toolbar, listEl, editorEl];
    }
    function pastesTab() {
      return isOptions
        ? [
            searchRow,
            pasteToolbar,
            makeCollapse('Пасты', [pasteListEl], false),
            pasteEditorEl,
            pasteImportRow
          ]
        : [searchRow, pasteToolbar, pasteListEl, pasteEditorEl];
    }

    macrosWrap = el('div', { class: 'group' }, macrosTab());
    pastesWrap = el('div', { class: 'group' }, pastesTab());

    replaceChildren(rootEl, [
      el('div', { class: 'app' }, [header, modeToggle, macrosWrap, pastesWrap, footer])
    ]);
    applyMode();

    /* ============================ Действия (макросы) ===================== */

    function currentProfile() {
      return storage.findProfile(ui.state, ui.profileId) || ui.state.profiles[0];
    }
    function persist() {
      return storage.save(ui.state).then((saved) => { ui.state = saved; render(); });
    }
    function onToggleEnabled() { ui.state.enabled = toggleInput.checked; persist(); }
    function toggleProfile(profile) { if (!profile) return; profile.enabled = profile.enabled === false; persist(); }
    function selectProfile(profileId) { ui.profileId = profileId; closeEditor(); render(); }

    function startAdding() {
      ui.mode = 'macros'; applyMode();
      ui.editing = null; ui.adding = true; ui.hint = '';
      keyInput.value = ''; textArea.value = ''; sendSelect.value = 'none';
      editorEl.hidden = false; render(); keyInput.focus();
    }
    function startEditing(macro) {
      ui.editing = macro; ui.adding = true; ui.hint = '';
      keyInput.value = macro.key; textArea.value = macro.text; sendSelect.value = storage.normalizeSend(macro.send);
      editorEl.hidden = false; render(); keyInput.focus(); keyInput.select();
    }
    function closeEditor() { ui.editing = null; ui.adding = false; ui.hint = ''; editorEl.hidden = true; hintEl.textContent = ''; }
    function onEditorKeydown(event) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submitEditor(); }
      if (event.key === 'Escape') { event.preventDefault(); closeEditor(); render(); }
    }
    function onSubmit(event) { event.preventDefault(); submitEditor(); }
    function stripPrefix(value) {
      const prefix = ui.state.prefix; let result = String(value || '');
      while (prefix && result.startsWith(prefix)) result = result.slice(prefix.length);
      return result;
    }
    function submitEditor() {
      const profile = currentProfile();
      try {
        storage.upsertMacro(ui.state, profile.id, {
          id: ui.editing ? ui.editing.id : null,
          key: stripPrefix(keyInput.value),
          text: textArea.value,
          enabled: ui.editing ? ui.editing.enabled : true,
          send: sendSelect.value
        });
      } catch (err) { ui.hint = err.message || 'Не удалось сохранить'; hintEl.textContent = ui.hint; return; }
      closeEditor(); persist();
    }
    function toggleMacro(macro) { macro.enabled = macro.enabled === false; persist(); }
    function askDelete(macro) { ui.confirmDelete = ui.confirmDelete === macro.id ? null : macro.id; render(); }
    function deleteMacro(macro) {
      storage.removeMacro(ui.state, currentProfile().id, macro.id);
      ui.confirmDelete = null;
      if (ui.editing && ui.editing.id === macro.id) closeEditor();
      persist();
    }
    function addDomain() {
      const domain = domains.normalizeDomain(domainInput.value);
      if (!domain) { domainInput.value = ''; return; }
      const profile = storage.addProfile(ui.state, domain);
      domainInput.value = ''; ui.profileId = profile.id; persist();
    }
    function addProfileForCurrentSite() {
      if (!hostname) return;
      const profile = storage.addProfile(ui.state, hostname);
      ui.profileId = profile.id; persist().then(startAdding);
    }
    function removeCurrentProfile() {
      const profile = currentProfile();
      if (!profile.domain) return;
      if (!root.confirm('Удалить профиль «' + profile.name + '» вместе с макросами?')) return;
      storage.removeProfile(ui.state, profile.id);
      ui.profileId = domains.GLOBAL_PROFILE_ID; closeEditor(); persist();
    }
    function onPrefixChange() {
      const value = storage.normalize({ prefix: prefixInput.value }).prefix;
      ui.state.prefix = value; prefixInput.value = value; persist();
    }
    function addVar() {
      if (!varKeyInput.value.trim()) return;
      storage.setVar(ui.state, currentProfile().id, varKeyInput.value, varValueInput.value);
      varKeyInput.value = ''; varValueInput.value = ''; persist();
    }
    function removeVar(key) { storage.setVar(ui.state, currentProfile().id, key, null); persist(); }

    function onExport() {
      const blob = new root.Blob([storage.exportState(ui.state)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = el('a', { href: url, download: 'micromacro-' + new Date().toISOString().slice(0, 10) + '.json' });
      doc.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function onImportFile(event) {
      const file = event.target.files && event.target.files[0]; event.target.value = '';
      if (!file) return;
      const reader = new root.FileReader();
      reader.onload = () => {
        try { ui.state = storage.importState(String(reader.result)); }
        catch (err) { root.alert('Не удалось импортировать: ' + err.message); return; }
        ui.profileId = domains.GLOBAL_PROFILE_ID; persist();
      };
      reader.readAsText(file);
    }
    function renderImportTarget() {
      if (!importTargetSel) return;
      const current = importTargetSel.value;
      importTargetSel.textContent = '';
      for (const profile of ui.state.profiles) importTargetSel.appendChild(el('option', { value: profile.id, text: profile.name || profile.domain }));
      importTargetSel.appendChild(el('option', { value: '__new__', text: '— создать новый профиль —' }));
      if (current === '__new__' || (current && storage.findProfile(ui.state, current))) importTargetSel.value = current;
    }
    function onImportMacrosFile(event) {
      const file = event.target.files && event.target.files[0]; event.target.value = '';
      if (!file) return;
      const reader = new root.FileReader();
      reader.onload = () => {
        const parsed = parser.parseMacros(String(reader.result));
        if (!parsed.length) { root.alert('В файле не найдено записей вида --ключ: текст'); return; }
        let profile;
        if (importTargetSel.value === '__new__') {
          const domain = domains.normalizeDomain(importDomainInput.value);
          if (!domain) { root.alert('Укажите домен нового профиля или выберите существующий.'); return; }
          profile = storage.addProfile(ui.state, domain);
        } else profile = storage.findProfile(ui.state, importTargetSel.value) || ui.state.profiles[0];
        let added = 0, overwritten = 0;
        for (const item of parsed) {
          const existing = (profile.macros || []).find((m) => m.key.toLowerCase() === item.key.toLowerCase());
          if (existing) overwritten++;
          storage.upsertMacro(ui.state, profile.id, { id: existing ? existing.id : null, key: item.key, text: item.text });
          added++;
        }
        ui.profileId = profile.id; importDomainInput.value = '';
        persist().then(() => root.alert('Импортировано в «' + profile.name + '»: ' + added + (overwritten ? ' (перезаписано: ' + overwritten + ')' : '')));
      };
      reader.readAsText(file);
    }

    function openOptions() {
      const api = root.chrome || root.browser;
      if (api && api.runtime && typeof api.runtime.openOptionsPage === 'function') api.runtime.openOptionsPage();
      else if (api && api.runtime && typeof api.runtime.getURL === 'function') root.open(api.runtime.getURL('src/ui/options.html'), '_blank');
    }

    /* ============================ Действия (пасты) ======================= */

    function startAddingPaste() {
      ui.pasteEditing = null; ui.pasteAdding = true; ui.pasteHint = '';
      pasteTitleInput.value = ''; pasteTextArea.value = '';
      pasteEditorEl.hidden = false; render(); pasteTitleInput.focus();
    }
    function startEditingPaste(paste) {
      ui.pasteEditing = paste; ui.pasteAdding = true; ui.pasteHint = '';
      pasteTitleInput.value = paste.title; pasteTextArea.value = paste.text;
      pasteEditorEl.hidden = false; render(); pasteTitleInput.focus();
    }
    function closePasteEditor() { ui.pasteEditing = null; ui.pasteAdding = false; ui.pasteHint = ''; pasteEditorEl.hidden = true; pasteHintEl.textContent = ''; }
    function onPasteSubmit(event) { event.preventDefault(); submitPaste(); }
    function submitPaste() {
      try {
        storage.upsertPaste(ui.state, { id: ui.pasteEditing ? ui.pasteEditing.id : null, title: pasteTitleInput.value, text: pasteTextArea.value });
      } catch (err) { ui.pasteHint = err.message || 'Не удалось сохранить'; pasteHintEl.textContent = ui.pasteHint; return; }
      closePasteEditor(); persist();
    }
    function askDeletePaste(paste) { ui.pasteConfirmDelete = ui.pasteConfirmDelete === paste.id ? null : paste.id; renderPasteList(); }
    function deletePaste(paste) {
      storage.removePaste(ui.state, paste.id);
      ui.pasteConfirmDelete = null;
      if (ui.pasteEditing && ui.pasteEditing.id === paste.id) closePasteEditor();
      persist();
    }
    function clearAllPastes() {
      const count = (ui.state.pastes || []).length;
      if (!count) return;
      if (!root.confirm('Удалить все пасты (' + count + ')? Действие необратимо.')) return;
      storage.clearPastes(ui.state);
      closePasteEditor();
      persist();
    }

    function pasteVars() { return storage.effectiveVars(ui.state, ''); }
    function copyPaste(paste) {
      const text = expand.fillTemplate(paste.text, pasteVars());
      copyText(text);
    }

    function copyText(text) {
      const done = () => showToast('Скопировано');
      if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
        root.navigator.clipboard.writeText(text).then(done).catch(() => legacyCopy(text, done));
      } else legacyCopy(text, done);
    }
    function legacyCopy(text, done) {
      const ta = doc.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      doc.body.appendChild(ta); ta.select();
      try { doc.execCommand('copy'); } catch (err) {}
      ta.remove(); done();
    }
    function showToast(message) {
      const toast = el('div', { class: 'toast', text: message });
      doc.body.appendChild(toast);
      setTimeout(() => toast.remove(), 1500);
    }

    function onImportPastesFile(event) {
      const file = event.target.files && event.target.files[0]; event.target.value = '';
      if (!file) return;
      const reader = new root.FileReader();
      reader.onload = () => {
        const sections = parser.parseSections(String(reader.result));
        if (!sections.length) { root.alert('В файле не найдено секций вида ## Заголовок'); return; }
        let added = 0;
        for (const section of sections) { storage.upsertPaste(ui.state, { title: section.title, text: section.text }); added++; }
        persist().then(() => root.alert('Импортировано паст: ' + added));
      };
      reader.readAsText(file);
    }

    /* ------------------------------- Рендер ------------------------------ */

    function renderProfiles() {
      const chips = ui.state.profiles.map((profile) => {
        const enabled = profile.enabled !== false;
        return el('button', {
          class: 'chip ' + (enabled ? 'is-enabled' : 'is-disabled') + (profile.id === ui.profileId ? ' is-active' : ''),
          type: 'button',
          title: (profile.domain ? 'Домен: ' + profile.domain : 'Все сайты') + '. ПКМ — вкл/выкл',
          onclick: () => selectProfile(profile.id),
          oncontextmenu: (event) => { event.preventDefault(); toggleProfile(profile); }
        }, [profile.name || profile.domain]);
      });
      if (!isOptions && hostname && !domains.findProfileByDomain(ui.state, hostname)) {
        chips.push(el('button', { class: 'chip chip-add', type: 'button', onclick: addProfileForCurrentSite }, ['+ ' + hostname]));
      }
      replaceChildren(profilesEl, chips);
    }

    function renderToolbar() {
      const profile = currentProfile();
      const enabled = profile.enabled !== false;
      profileToggleBtn.textContent = enabled ? 'Профиль: вкл' : 'Профиль: выкл';
      profileToggleBtn.classList.toggle('is-off', !enabled);
      const macros = profile.macros || [];
      const enabledCount = macros.filter((m) => m.enabled !== false).length;
      countEl.textContent = macros.length ? enabledCount + ' из ' + macros.length + ' вкл' : 'нет макросов';
    }

    function renderMacroRow(macro) {
      if (ui.confirmDelete === macro.id) {
        return el('div', { class: 'row' }, [
          el('div', { class: 'row-body' }, [
            el('span', { class: 'row-key', text: ui.state.prefix + macro.key }),
            el('span', { class: 'row-text', text: 'Удалить макрос?' })
          ]),
          el('div', { class: 'row-actions' }, [
            el('button', { class: 'icon-btn is-danger', type: 'button', title: 'Удалить', onclick: () => deleteMacro(macro) }, ['✓']),
            el('button', { class: 'icon-btn', type: 'button', title: 'Отменить', onclick: () => askDelete(macro) }, ['✕'])
          ])
        ]);
      }
      const disabled = macro.enabled === false;
      const sendLabel = macro.send && macro.send !== 'none' ? storage.SEND_LABELS[macro.send] : null;
      return el('div', { class: 'row' + (disabled ? ' is-disabled' : '') }, [
        el('div', { class: 'row-body' }, [
          el('span', { class: 'row-key', text: ui.state.prefix + macro.key }),
          sendLabel ? el('span', { class: 'row-send', text: '↵ ' + sendLabel.replace('Отправить: ', '') }) : null,
          el('span', { class: 'row-text', text: preview(macro.text, isOptions ? 240 : 90) })
        ]),
        el('div', { class: 'row-actions' }, [
          el('button', { class: 'icon-btn' + (disabled ? '' : ' is-on'), type: 'button', title: disabled ? 'Включить' : 'Выключить', onclick: () => toggleMacro(macro) }, [disabled ? '○' : '●']),
          el('button', { class: 'icon-btn', type: 'button', title: 'Изменить', onclick: () => startEditing(macro) }, ['✎']),
          el('button', { class: 'icon-btn is-danger', type: 'button', title: 'Удалить', onclick: () => askDelete(macro) }, ['🗑'])
        ])
      ]);
    }

    function renderMacroList() {
      const profile = currentProfile();
      const macros = profile.macros || [];
      if (!macros.length) {
        replaceChildren(listEl, [el('div', { class: 'empty' }, [
          'В профиле «' + profile.name + '» пока нет макросов.', el('br'),
          el('span', { text: 'Нажмите «+ Макрос» и задайте кодовое слово, например ' }),
          el('code', { text: ui.state.prefix + 'прив' })
        ])]);
      } else replaceChildren(listEl, macros.map(renderMacroRow));
    }

    function renderVars() {
      if (!varsEl) return;
      const profile = currentProfile();
      const vars = profile.vars || {};
      const rows = Object.entries(vars).map(([key, value]) =>
        el('div', { class: 'var-row' }, [
          el('span', { class: 'var-key', text: '{' + key + '}' }),
          el('span', { class: 'var-value', text: value }),
          el('button', { class: 'icon-btn is-danger', type: 'button', title: 'Удалить', onclick: () => removeVar(key) }, ['🗑'])
        ])
      );
      replaceChildren(varsEl, [
        el('h2', { text: 'Плейсхолдеры профиля «' + profile.name + '»' }),
        rows.length ? el('div', { class: 'var-list' }, rows) : el('div', { class: 'empty' }, ['Плейсхолдеров нет.']),
        el('div', { class: 'settings-row' }, [
          el('div', { class: 'field small' }, [varKeyInput]),
          el('div', { class: 'field grow' }, [varValueInput]),
          addVarBtn
        ])
      ]);
    }

    function usedPlaceholders(text) {
      const used = []; const re = /\{([^{}]+)\}/g; let match;
      while ((match = re.exec(text))) used.push(match[1].trim());
      return used;
    }
    function isKnownPlaceholder(key, lowerVars) {
      return lowerVars.has(key.toLowerCase()) || expand.builtinValue(key) !== undefined;
    }
    function fillPhHint(target, text, vars, note) {
      const lowerVars = new Set(Object.keys(vars).map((k) => k.toLowerCase()));
      const used = usedPlaceholders(text);
      const missing = used.filter((k) => !isKnownPlaceholder(k, lowerVars));
      if (missing.length) {
        target.textContent = 'Нет значения: ' + missing.map((k) => '{' + k + '}').join(', ') + ' — ' + note;
        target.classList.add('is-warn');
      } else if (used.length) {
        target.textContent = 'Плейсхолдеры будут подставлены при вставке.';
        target.classList.remove('is-warn');
      } else {
        const avail = Object.keys(vars).map((k) => '{' + k + '}').concat(['{дата}', '{время}']);
        target.textContent = 'Плейсхолдеры: ' + avail.join(' ');
        target.classList.remove('is-warn');
      }
    }
    function updatePhHint() {
      fillPhHint(phHint, textArea.value, currentProfile().vars || {}, 'добавьте в плейсхолдеры профиля.');
    }
    function updatePastePhHint() {
      fillPhHint(pastePhHint, pasteTextArea.value, storage.varsForHost(ui.state, ''), 'добавьте в плейсхолдеры профиля «Все сайты».');
    }

    /* --------------------------- Рендер паст ----------------------------- */

    function renderPasteRow(item) {
      const paste = item.paste;
      if (ui.pasteConfirmDelete === paste.id) {
        return el('div', { class: 'row' }, [
          el('div', { class: 'row-body' }, [
            el('span', { class: 'row-key paste-title', text: paste.title }),
            el('span', { class: 'row-text', text: 'Удалить пасту?' })
          ]),
          el('div', { class: 'row-actions' }, [
            el('button', { class: 'icon-btn is-danger', type: 'button', title: 'Удалить', onclick: () => deletePaste(paste) }, ['✓']),
            el('button', { class: 'icon-btn', type: 'button', title: 'Отменить', onclick: () => askDeletePaste(paste) }, ['✕'])
          ])
        ]);
      }
      const body = el('div', { class: 'row-body', title: 'Клик — скопировать в буфер', onclick: () => copyPaste(paste) }, [
        el('span', { class: 'row-key paste-title', text: paste.title }),
        el('span', { class: 'row-text', text: search.snippet(paste.text, ui.pasteQuery, isOptions ? 240 : 110) })
      ]);
      return el('div', { class: 'row paste-row' }, [
        body,
        el('div', { class: 'row-actions' }, [
          el('button', { class: 'icon-btn', type: 'button', title: 'Скопировать', onclick: () => copyPaste(paste) }, ['⧉']),
          el('button', { class: 'icon-btn', type: 'button', title: 'Изменить', onclick: () => startEditingPaste(paste) }, ['✎']),
          el('button', { class: 'icon-btn is-danger', type: 'button', title: 'Удалить', onclick: () => askDeletePaste(paste) }, ['🗑'])
        ])
      ]);
    }

    function renderPasteList() {
      const results = search.searchPastes(ui.state.pastes, ui.pasteQuery);
      const total = (ui.state.pastes || []).length;
      pasteCountEl.textContent = ui.pasteQuery
        ? results.length + ' из ' + total
        : total + ' паст';
      if (!results.length) {
        replaceChildren(pasteListEl, [el('div', { class: 'empty' }, [
          ui.pasteQuery ? 'Ничего не найдено по «' + ui.pasteQuery + '».' : 'Паст пока нет — добавьте или импортируйте.'
        ])]);
      } else replaceChildren(pasteListEl, results.map(renderPasteRow));
    }

    function render() {
      toggleInput.checked = ui.state.enabled !== false;
      toggle.classList.toggle('is-on', toggleInput.checked);
      toggleLabel.textContent = toggleInput.checked ? 'Вкл' : 'Выкл';
      keyPrefixEl.textContent = ui.state.prefix;
      if (settingsEl) {
        prefixInput.value = ui.state.prefix;
        deleteProfileBtn.disabled = !currentProfile().domain;
        renderImportTarget();
      }
      renderProfiles();
      renderToolbar();
      renderMacroList();
      renderVars();
      updatePhHint();
      updatePastePhHint();
      renderPasteList();
    }

    function createHandle() {
      return {
        get state() { return ui.state; },
        render, setMode, startAdding, startEditing, selectProfile, submitEditor, closeEditor,
        startAddingPaste, submitPaste, copyPaste,
        ui
      };
    }

    storage.onChange((nextState) => {
      const keepProfile = storage.findProfile(nextState, ui.profileId);
      ui.state = nextState;
      if (!keepProfile) ui.profileId = domains.GLOBAL_PROFILE_ID;
      render();
    });

    return storage
      .load()
      .then((loaded) => {
        ui.state = loaded;
        if (!isOptions && hostname) {
          const siteProfile = domains.findProfileByDomain(ui.state, hostname);
          if (siteProfile) ui.profileId = siteProfile.id;
        }
        render();
        return createHandle();
      })
      .catch((err) => {
        replaceChildren(listEl, [el('div', { class: 'empty' }, ['Не удалось прочитать настройки: ' + err.message])]);
        return createHandle();
      });
  }

  root.MMC = root.MMC || {};
  root.MMC.ui = { mount, el, preview };
})(typeof globalThis !== 'undefined' ? globalThis : this);
