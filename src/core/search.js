/**
 * MMCopyPaste — поиск по пастам.
 *
 * Согласованная схема: нормализация (нижний регистр, ё→е, пробелы) + подстрока.
 * Запрос из нескольких слов считается найденным, если все слова встречаются
 * (в заголовке или тексте). Заголовок весит больше тела. Без зависимостей.
 */
(function (root) {
  'use strict';

  function normalize(text) {
    return String(text == null ? '' : text)
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function tokens(query) {
    return normalize(query).split(' ').filter(Boolean);
  }

  /**
   * Возвращает [{ paste, score }] по убыванию релевантности.
   * Пустой запрос — весь список в исходном порядке.
   */
  function searchPastes(pastes, query) {
    const list = Array.isArray(pastes) ? pastes : [];
    const words = tokens(query);
    if (!words.length) return list.map((paste) => ({ paste, score: 0 }));

    const results = [];
    for (const paste of list) {
      const title = normalize(paste.title);
      const body = normalize(paste.text);
      let score = 0;
      let matched = true;
      for (const word of words) {
        const ti = title.indexOf(word);
        const bi = body.indexOf(word);
        if (ti < 0 && bi < 0) {
          matched = false;
          break;
        }
        if (ti === 0) score += 3;
        else if (ti > 0) score += 2;
        if (bi >= 0) score += 1;
      }
      if (matched) results.push({ paste, score });
    }

    results.sort(
      (a, b) => b.score - a.score || a.paste.text.length - b.paste.text.length
    );
    return results;
  }

  /** Сниппет текста вокруг первого совпадения (для показа в списке). */
  function snippet(text, query, limit) {
    const source = String(text == null ? '' : text);
    const flat = source.replace(/\s+/g, ' ');
    const max = limit || 120;
    const words = tokens(query);
    const needle = words.length ? normalize(words[0]) : '';
    let index = needle ? normalize(flat).indexOf(needle) : 0;
    if (index < 0) index = 0;
    const start = Math.max(0, index - Math.floor(max / 3));
    let out = flat.slice(start, start + max);
    if (start > 0) out = '…' + out;
    if (start + max < flat.length) out += '…';
    return out;
  }

  root.MMC = root.MMC || {};
  root.MMC.search = { normalize, tokens, searchPastes, snippet };
})(typeof globalThis !== 'undefined' ? globalThis : this);
