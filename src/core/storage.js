/**
 * MMCopyPaste — модель данных и работа с хранилищем.
 *
 * Всё состояние лежит одним объектом под ключом mmcState в chrome.storage.local:
 * так его проще атомарно обновлять и слушать изменения из content script.
 */
(function (root) {
  'use strict';

  const KEY = 'mmcState';
  const VERSION = 3;
  const MAX_KEY_LENGTH = 64;
  const MAX_TEXT_LENGTH = 20000;
  const MAX_PASTE_LENGTH = 20000;

  /** Режимы автоотправки макроса: без отправки или эмуляция клавиш. */
  const SEND_MODES = ['none', 'enter', 'shift', 'ctrl'];
  const SEND_LABELS = {
    none: 'Не отправлять',
    enter: 'Отправить: Enter',
    shift: 'Отправить: Shift+Enter',
    ctrl: 'Отправить: Ctrl+Enter'
  };
  function normalizeSend(value) {
    return SEND_MODES.indexOf(value) >= 0 ? value : 'none';
  }

  const expand = root.MMC && root.MMC.expand;
  const domains = root.MMC && root.MMC.domains;
  const DEFAULT_PREFIX = (expand && expand.DEFAULT_PREFIX) || '--';
  const GLOBAL_PROFILE_ID = (domains && domains.GLOBAL_PROFILE_ID) || 'all';
  const GLOBAL_PROFILE_NAME = (domains && domains.GLOBAL_PROFILE_NAME) || 'Все сайты';

  function uid(prefix) {
    const rnd = Math.random().toString(36).slice(2, 10);
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + rnd;
  }

  function toBool(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  /** Ключ макроса: одна строка, без пробелов по краям, не длиннее MAX_KEY_LENGTH. */
  function cleanKey(value) {
    const raw = typeof value === 'string' ? value : String(value == null ? '' : value);
    return raw.replace(/\s+/g, ' ').trim().slice(0, MAX_KEY_LENGTH);
  }

  function cleanText(value) {
    const raw = typeof value === 'string' ? value : String(value == null ? '' : value);
    return raw.slice(0, MAX_TEXT_LENGTH);
  }

  function createMacro(key, text, send) {
    return {
      id: uid('m'),
      key: cleanKey(key),
      text: cleanText(text),
      enabled: true,
      send: normalizeSend(send)
    };
  }

  function cleanVars(value) {
    const result = {};
    if (!value || typeof value !== 'object') return result;
    for (const [rawKey, rawValue] of Object.entries(value)) {
      const key = cleanKey(rawKey);
      if (!key) continue;
      result[key] = cleanText(rawValue);
    }
    return result;
  }

  function createProfile(domain) {
    const normalized = domains ? domains.normalizeDomain(domain) : String(domain || '');
    const isGlobal = !normalized;
    return {
      id: isGlobal ? GLOBAL_PROFILE_ID : uid('p'),
      domain: normalized,
      name: isGlobal ? GLOBAL_PROFILE_NAME : normalized,
      enabled: true,
      macros: [],
      vars: {}
    };
  }

  function createPaste(title, text) {
    return { id: uid('s'), title: cleanKey(title), text: cleanText(text) };
  }

  function createDefaultState() {
    const global = createProfile('');
    global.vars = { имя: 'оператор' };
    global.macros = [
      createMacro('прив', 'Здравствуйте! Меня зовут {имя}, техническая поддержка. Чем могу помочь?'),
      createMacro('спс', 'Спасибо за обращение! Если появятся вопросы — пишем, будем рады помочь.')
    ];
    const pastes = [
      createPaste(
        'приветствие',
        'Здравствуйте!\nМеня зовут {имя}, и я ваш специалист. Чем могу помочь?'
      ),
      createPaste(
        'адрес',
        'Пожалуйста, напишите номер вашего договора (ID) и имя владельца договора. Если возникнут затруднения — полный адрес с указанием номера квартиры.\nСпасибо!'
      )
    ];
    return { version: VERSION, enabled: true, prefix: DEFAULT_PREFIX, profiles: [global], pastes, gender: 'm' };
  }

  /**
   * Приводим любые входящие данные (из хранилища или из импорта) к рабочей схеме.
   * Мусор отбрасываем, дубликаты ключей внутри профиля не допускаем.
   * Примеры-заготовки добавляются только при первом запуске (пустое хранилище).
   */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return createDefaultState();

    const state = {
      version: VERSION,
      enabled: toBool(raw.enabled, true),
      gender: raw && raw.gender === 'f' ? 'f' : 'm',
      prefix:
        typeof raw.prefix === 'string' && raw.prefix.trim()
          ? expand
            ? expand.normalizePrefix(raw.prefix)
            : raw.prefix.trim().slice(0, 4)
          : DEFAULT_PREFIX,
      profiles: []
    };

    const incoming = Array.isArray(raw.profiles) ? raw.profiles : [];
    const usedIds = new Set();
    const usedDomains = new Set();

    for (const item of incoming) {
      if (!item || typeof item !== 'object') continue;
      const profile = createProfile(item.domain);
      if (item.name && typeof item.name === 'string' && item.name.trim()) {
        profile.name = item.name.trim().slice(0, 80);
      }
      profile.enabled = toBool(item.enabled, true);

      const domainKey = profile.domain;
      if (usedDomains.has(domainKey)) continue;
      usedDomains.add(domainKey);

      if (typeof item.id === 'string' && item.id && !usedIds.has(item.id)) {
        profile.id = item.id;
      }
      usedIds.add(profile.id);

      profile.vars = cleanVars(item.vars);
      profile.enabled = toBool(item.enabled, true);

      const usedKeys = new Set();
      const macros = Array.isArray(item.macros) ? item.macros : [];
      for (const macro of macros) {
        if (!macro || typeof macro !== 'object') continue;
        const key = cleanKey(macro.key);
        if (!key) continue;
        const keyKey = key.toLowerCase();
        if (usedKeys.has(keyKey)) continue;
        usedKeys.add(keyKey);
        const text = cleanText(macro.text);
        if (!text) continue;
        profile.macros.push({
          id: typeof macro.id === 'string' && macro.id ? macro.id : uid('m'),
          key,
          text,
          enabled: toBool(macro.enabled, true),
          send: normalizeSend(macro.send)
        });
      }
      state.profiles.push(profile);
    }

    // «Все сайты» обязан существовать и стоять первым.
    const global = state.profiles.find((profile) => !profile.domain);
    if (global) {
      state.profiles = [global].concat(state.profiles.filter((profile) => profile !== global));
    } else {
      state.profiles.unshift(createProfile(''));
    }

    // Пасты: плоский список, без профилей.
    const pastesIn = Array.isArray(raw.pastes) ? raw.pastes : [];
    const pasteIds = new Set();
    state.pastes = [];
    for (const item of pastesIn) {
      if (!item || typeof item !== 'object') continue;
      const title = cleanKey(item.title);
      const text = cleanText(item.text).replace(/\s+$/, '');
      if (!title || !text) continue;
      const id =
        typeof item.id === 'string' && item.id && !pasteIds.has(item.id) ? item.id : uid('s');
      pasteIds.add(id);
      state.pastes.push({ id, title, text });
    }

    state.version = VERSION;
    return state;
  }

  /* ------------------------------------------------------------------ *
   * Хранилище: chrome.storage.local, в Firefox — browser.storage.local,
   * вне расширения (тесты/отладка) — localStorage.
   * ------------------------------------------------------------------ */

  function memoryBackend() {
    const store = new Map();
    const listeners = [];
    return {
      storage: {
        local: {
          get(keys) {
            const result = {};
            for (const key of [].concat(keys)) {
              if (store.has(key)) result[key] = store.get(key);
            }
            return Promise.resolve(result);
          },
          set(items) {
            const changes = {};
            for (const [key, value] of Object.entries(items || {})) {
              changes[key] = { oldValue: store.get(key), newValue: value };
              store.set(key, value);
            }
            for (const listener of listeners) listener(changes, 'local');
            return Promise.resolve();
          }
        },
        onChanged: {
          addListener(listener) {
            listeners.push(listener);
          }
        }
      }
    };
  }

  let fallbackBackend = null;

  function getApi() {
    if (typeof chrome !== 'undefined' && chrome && chrome.storage && chrome.storage.local) return chrome;
    if (typeof browser !== 'undefined' && browser && browser.storage && browser.storage.local) return browser;
    if (typeof localStorage !== 'undefined') {
      if (!fallbackBackend) {
        fallbackBackend = {
          storage: {
            local: {
              get(keys) {
                const result = {};
                for (const key of [].concat(keys)) {
                  const raw = localStorage.getItem(key);
                  if (raw != null) {
                    try {
                      result[key] = JSON.parse(raw);
                    } catch (err) {
                      result[key] = null;
                    }
                  }
                }
                return Promise.resolve(result);
              },
              set(items) {
                for (const [key, value] of Object.entries(items || {})) {
                  localStorage.setItem(key, JSON.stringify(value));
                }
                return Promise.resolve();
              }
            },
            onChanged: { addListener() {} }
          }
        };
      }
      return fallbackBackend;
    }
    if (!fallbackBackend) fallbackBackend = memoryBackend();
    return fallbackBackend;
  }

  function load() {
    const api = getApi();
    return api.storage.local
      .get([KEY])
      .then((stored) => normalize(stored && stored[KEY]));
  }

  function save(state) {
    const api = getApi();
    const normalized = normalize(state);
    return api.storage.local.set({ [KEY]: normalized }).then(() => normalized);
  }

  function onChange(listener) {
    const api = getApi();
    if (api.storage.onChanged && typeof api.storage.onChanged.addListener === 'function') {
      api.storage.onChanged.addListener((changes, area) => {
        if (area && area !== 'local') return;
        if (!changes || !changes[KEY]) return;
        listener(normalize(changes[KEY].newValue));
      });
    }
  }

  /* ------------------------------------------------------------------ *
   * Изменения состояния (мутация копии, которую затем сохраняем)
   * ------------------------------------------------------------------ */

  function findProfile(state, profileId) {
    return (state.profiles || []).find((profile) => profile.id === profileId) || null;
  }

  function ensureProfile(state, domain) {
    const normalized = domains ? domains.normalizeDomain(domain) : String(domain || '');
    let profile = normalized
      ? (state.profiles || []).find((item) => domains.normalizeDomain(item.domain) === normalized)
      : (state.profiles || []).find((item) => !item.domain);
    if (!profile) {
      profile = createProfile(normalized);
      state.profiles.push(profile);
    }
    return profile;
  }

  function upsertMacro(state, profileId, macro) {
    const profile = findProfile(state, profileId);
    if (!profile) throw new Error('Профиль не найден');

    const key = cleanKey(macro && macro.key);
    const text = cleanText(macro && macro.text);
    if (!key) throw new Error('Укажите кодовое слово');
    if (!text) throw new Error('Укажите текст подстановки');

    const current =
      macro && macro.id ? (profile.macros || []).find((item) => item.id === macro.id) : null;
    const clash = (profile.macros || []).find(
      (item) => item !== current && item.key.toLowerCase() === key.toLowerCase()
    );
    if (clash) throw new Error('Кодовое слово «' + clash.key + '» уже занято');

    if (current) {
      current.key = key;
      current.text = text;
      if (macro && typeof macro.enabled === 'boolean') current.enabled = macro.enabled;
      if (macro && macro.send !== undefined) current.send = normalizeSend(macro.send);
      return current;
    }

    const created = {
      id: (macro && macro.id) || uid('m'),
      key,
      text,
      enabled: macro && typeof macro.enabled === 'boolean' ? macro.enabled : true,
      send: normalizeSend(macro && macro.send)
    };
    profile.macros.push(created);
    return created;
  }

  /**
   * Слитые плейсхолдеры для страницы: «Все сайты» как база, сверху более
   * специфичные доменные профили (их значения перекрывают глобальные).
   */
  function varsForHost(state, hostname) {
    const merged = {};
    if (!state) return merged;
    const profiles = state.profiles || [];
    const globals = profiles.filter((profile) => profile && !profile.domain);
    const matching = profiles
      .filter(
        (profile) =>
          profile && profile.domain && domains.hostnameMatches(hostname, profile.domain)
      )
      .sort(
        (a, b) => domains.normalizeDomain(a.domain).length - domains.normalizeDomain(b.domain).length
      );
    for (const profile of globals.concat(matching)) {
      if (profile.enabled === false) continue;
      Object.assign(merged, profile.vars || {});
    }
    return merged;
  }

  /**
   * Готовый набор плейсхолдеров для подстановки (vars профилей).
   * Род {g} временно отключён — поле gender хранится, но не подставляется.
   */
  function effectiveVars(state, hostname) {
    return varsForHost(state, hostname);
  }

  function upsertPaste(state, paste) {
    const title = cleanKey(paste && paste.title);
    const text = cleanText(paste && paste.text);
    if (!title) throw new Error('Укажите заголовок пасты');
    if (!text) throw new Error('Укажите текст пасты');
    state.pastes = state.pastes || [];
    const current = paste && paste.id ? state.pastes.find((item) => item.id === paste.id) : null;
    if (current) {
      current.title = title;
      current.text = text;
      return current;
    }
    const created = { id: (paste && paste.id) || uid('s'), title, text };
    state.pastes.push(created);
    return created;
  }

  function removePaste(state, id) {
    const before = (state.pastes || []).length;
    state.pastes = (state.pastes || []).filter((item) => item.id !== id);
    return state.pastes.length !== before;
  }

  /** Массовая очистка паст; возвращает количество удалённых. */
  function clearPastes(state) {
    const count = (state.pastes || []).length;
    state.pastes = [];
    return count;
  }

  function setVar(state, profileId, key, value) {
    const profile = findProfile(state, profileId);
    if (!profile) return;
    profile.vars = profile.vars || {};
    const clean = cleanKey(key);
    if (!clean) return;
    if (value === null || value === undefined || value === '') delete profile.vars[clean];
    else profile.vars[clean] = cleanText(value);
  }

  function removeMacro(state, profileId, macroId) {
    const profile = findProfile(state, profileId);
    if (!profile) return false;
    const before = profile.macros.length;
    profile.macros = profile.macros.filter((macro) => macro.id !== macroId);
    return profile.macros.length !== before;
  }

  function addProfile(state, domain) {
    const profile = ensureProfile(state, domain);
    // Доменные профили держим после «Все сайты».
    state.profiles = [state.profiles[0]].concat(
      state.profiles.slice(1).sort((a, b) => a.domain.localeCompare(b.domain))
    );
    return profile;
  }

  function removeProfile(state, profileId) {
    const profile = findProfile(state, profileId);
    if (!profile || !profile.domain) return false; // «Все сайты» неудаляем
    state.profiles = state.profiles.filter((item) => item.id !== profileId);
    return true;
  }

  function exportState(state) {
    return JSON.stringify(normalize(state), null, 2);
  }

  function importState(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('Это не похоже на JSON: ' + err.message);
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.profiles)) {
      throw new Error('В файле нет списка профилей (profiles)');
    }
    return normalize(parsed);
  }

  root.MMC = root.MMC || {};
  root.MMC.storage = {
    KEY,
    VERSION,
    MAX_KEY_LENGTH,
    MAX_TEXT_LENGTH,
    MAX_PASTE_LENGTH,
    SEND_MODES,
    SEND_LABELS,
    uid,
    cleanKey,
    cleanText,
    cleanVars,
    normalizeSend,
    createMacro,
    createProfile,
    createPaste,
    createDefaultState,
    normalize,
    getApi,
    load,
    save,
    onChange,
    findProfile,
    ensureProfile,
    upsertMacro,
    removeMacro,
    addProfile,
    removeProfile,
    varsForHost,
    effectiveVars,
    setVar,
    upsertPaste,
    removePaste,
    clearPastes,
    exportState,
    importState
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
