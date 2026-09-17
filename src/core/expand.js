/**
 * MMCopyPaste — чистая логика поиска и подстановки макросов.
 *
 * Файл намеренно написан как обычный скрипт (IIFE + неймспейс MMC), а не как
 * ES-модуль: content script в MV3 грузится классическим скриптом во всех
 * браузерах (Chrome, Edge, Opera, Яндекс, Firefox) без сборки и бандлеров.
 * В тестах файл читается как текст и исполняется в vm-контексте — то есть
 * проверяется ровно тот код, который уезжает в браузер.
 */
(function (root) {
  'use strict';

  const DEFAULT_PREFIX = '--';

  /** Префикс триггера: 1..4 символа, пустой откатывается к "--". */
  function normalizePrefix(prefix) {
    const value = typeof prefix === 'string' ? prefix.trim() : '';
    return value.slice(0, 4) || DEFAULT_PREFIX;
  }

  /**
   * Варианты префикса. Некоторые сайты (Telegram) автозаменяют "--" на длинное
   * тире, поэтому для дефисного префикса дополнительно принимаем "—" и "–".
   */
  function prefixVariants(prefix) {
    const value = normalizePrefix(prefix);
    const list = [value];
    if (/^-+$/.test(value)) list.push('—', '–');
    return Array.from(new Set(list));
  }

  function clampCaret(caret, length) {
    const n = Number(caret);
    if (!Number.isFinite(n)) return length;
    return Math.min(Math.max(Math.trunc(n), 0), length);
  }

  function isWordChar(ch) {
    return !!ch && /[\p{L}\p{N}_]/u.test(ch);
  }

  function isUsable(macro) {
    return !!macro && macro.enabled !== false && !!macro.key;
  }

  /**
   * Ищем макрос по набранному после префикса тексту.
   * Точное совпадение важнее регистронезависимого.
   */
  function pickMacro(typed, macros) {
    for (const macro of macros) {
      if (isUsable(macro) && macro.key === typed) return macro;
    }
    const lower = typed.toLowerCase();
    for (const macro of macros) {
      if (isUsable(macro) && String(macro.key).toLowerCase() === lower) return macro;
    }
    return null;
  }

  /**
   * Есть ли другой ключ, который только начинается с набранного текста?
   * Нужна, чтобы "прив" не раскрывался на полпути к "привет".
   */
  function hasLongerKey(typed, macros) {
    const lower = typed.toLowerCase();
    return macros.some((macro) => {
      if (!isUsable(macro)) return false;
      const key = String(macro.key).toLowerCase();
      return key.length > lower.length && key.startsWith(lower);
    });
  }

  /**
   * Главная функция: смотрим на текст ПЕРЕД кареткой и ищем "<prefix><ключ>".
   *
   * @returns {{start:number,end:number,macro:object,typed:string}|null}
   *   start/end — границы заменяемого фрагмента (префикс + кодовое слово).
   *
   * Правила:
   *  - префикс не должен стоять вплотную к букве/цифре ("abc--прив" не трогаем);
   *  - срабатываем, как только ключ набран целиком, либо когда после него
   *    нажали пробел (хвостовой пробел остаётся в тексте);
   *  - если набранное — лишь начало более длинного ключа, ждём следующего
   *    символа: при ключах "прив" и "привет" оба остаются рабочими.
   */
  function findTrigger(options) {
    const opts = options || {};
    const text = typeof opts.text === 'string' ? opts.text : '';
    const macros = Array.isArray(opts.macros) ? opts.macros : [];
    if (!text || !macros.length) return null;

    const caret = clampCaret(opts.caret, text.length);
    const before = text.slice(0, caret);

    const prefixes =
      Array.isArray(opts.prefixes) && opts.prefixes.length
        ? opts.prefixes
        : [normalizePrefix(opts.prefix)];

    let best = null;
    for (const rawPrefix of prefixes) {
      const prefix = String(rawPrefix);
      if (!prefix) continue;

      const idx = before.lastIndexOf(prefix);
      if (idx < 0) continue;

      const prevChar = idx > 0 ? before[idx - 1] : '';
      if (isWordChar(prevChar)) continue;

      const typed = before.slice(idx + prefix.length);
      const trailing = typed.length - typed.replace(/\s+$/, '').length;
      const core = typed.slice(0, typed.length - trailing);
      // Пробел внутри триггера не допускается: "--при вет" не срабатывает.
      if (!core || /\s/.test(core)) continue;

      // "--прив" при существующем "привет" — ещё не финал, подождём символ.
      if (trailing === 0 && hasLongerKey(core, macros)) continue;

      const macro = pickMacro(core, macros);
      if (!macro) continue;

      const candidate = {
        start: idx,
        end: idx + prefix.length + core.length,
        macro,
        typed: core
      };
      // Из вариантов побеждает тот, что ближе к каретке.
      if (!best || candidate.start > best.start) best = candidate;
    }
    return best;
  }

  /** Чистая замена диапазона: возвращаем новый текст и новую позицию каретки. */
  function replaceRange(text, start, end, replacement) {
    const value = typeof text === 'string' ? text : '';
    const insert = typeof replacement === 'string' ? replacement : '';
    const nextText = value.slice(0, start) + insert + value.slice(Math.max(start, end));
    return { text: nextText, caret: start + insert.length };
  }

  /**
   * Встроенные динамические плейсхолдеры: работают без настройки.
   * Ключи приводятся к нижнему регистру.
   */
  function builtinValue(key, now) {
    const date = now || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const d = pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + '.' + date.getFullYear();
    const t = pad(date.getHours()) + ':' + pad(date.getMinutes());
    const map = {
      дата: d,
      date: d,
      время: t,
      time: t,
      datetime: d + ' ' + t,
      датавремя: d + ' ' + t
    };
    return map[String(key).toLowerCase()];
  }

  /**
   * Подстановка плейсхолдеров вида {имя}.
   * Порядок: значения профиля (vars) -> встроенные ({дата}, {время}) -> литерал.
   * Регистр имени не важен: {Имя} и {имя} — одно и то же.
   */
  function fillTemplate(text, vars, now) {
    if (typeof text !== 'string') return '';
    const source = vars && typeof vars === 'object' ? vars : {};
    const lowerSource = {};
    for (const [name, value] of Object.entries(source)) lowerSource[name.toLowerCase()] = value;

    return text.replace(/\{([^{}]+)\}/g, (all, rawKey) => {
      const key = rawKey.trim();
      const built = builtinValue(key, now);
      if (Object.prototype.hasOwnProperty.call(lowerSource, key.toLowerCase())) {
        return String(source[findOriginalKey(source, key)]);
      }
      if (built !== undefined) return built;
      return all;
    });
  }

  function findOriginalKey(source, key) {
    if (Object.prototype.hasOwnProperty.call(source, key)) return key;
    const lower = key.toLowerCase();
    for (const name of Object.keys(source)) {
      if (name.toLowerCase() === lower) return name;
    }
    return key;
  }

  /** Список всех известных плейсхолдеров (для подсказки в редакторе). */
  function knownPlaceholders(vars) {
    const names = Object.keys(vars || {});
    return names.concat(['дата', 'время', 'datetime']);
  }

  root.MMC = root.MMC || {};
  root.MMC.expand = {
    DEFAULT_PREFIX,
    normalizePrefix,
    prefixVariants,
    isUsable,
    findTrigger,
    hasLongerKey,
    pickMacro,
    replaceRange,
    fillTemplate,
    builtinValue,
    knownPlaceholders
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
