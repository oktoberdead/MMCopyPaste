/**
 * MMCopyPaste — парсер базы макросов из .md / .txt.
 *
 * Формат записей (синтаксис один для обоих расширений):
 *   --macro: текст подстановки
 *   --macro2: ещё текст,
 *     который может продолжаться на следующих строках
 *
 * Новая запись начинается со строки "--ключ: ...". Все строки до следующей
 * записи добавляются к тексту текущей (переносы сохраняются).
 */
(function (root) {
  'use strict';

  // Запись обязана начинаться с дефисов/тире: "--ключ: текст". Обычные строки
  // вида "Ключ: значение" из markdown не считаем макросами.
  const RECORD_RE = /^\s*(?:--|—|–)\s*([^\s:][^:]*?)\s*:\s?(.*)$/;

  function parseMacros(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const macros = [];
    let current = null;

    for (const line of lines) {
      const match = RECORD_RE.exec(line);
      const looksLikeRecord = match && match[1] && !/^[-—–]+$/.test(match[1]);
      if (looksLikeRecord) {
        if (current) macros.push(current);
        current = { key: match[1].trim(), text: match[2] || '' };
      } else if (current) {
        current.text = current.text ? current.text + '\n' + line : line;
      }
      // строки до первой записи игнорируем (заголовки, комментарии)
    }
    if (current) macros.push(current);

    const seen = new Set();
    const result = [];
    for (const macro of macros) {
      const key = macro.key.trim();
      const value = macro.text.replace(/\s+$/, '');
      if (!key || !value.trim()) continue;
      const lower = key.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      result.push({ key, text: value });
    }
    return result;
  }

  /**
   * Разбор markdown-секций вида "## Заголовок" + тело до следующего "##".
   * Возвращает [{ title, text }] — для импорта паст. Заголовок "# " (один #)
   * считаем общим заголовком файла и пропускаем.
   */
  function parseSections(text) {
    const lines = String(text == null ? '' : text).split(/\r?\n/);
    const sections = [];
    let current = null;

    for (const line of lines) {
      const head = /^\s*##\s+(.+?)\s*$/.exec(line); // ровно два #
      if (head) {
        if (current) sections.push(current);
        current = { title: head[1], text: '' };
        continue;
      }
      if (/^\s*#\s+/.test(line)) continue; // общий заголовок "# ..."
      if (current) current.text += (current.text ? '\n' : '') + line;
    }
    if (current) sections.push(current);

    return sections
      .map((section) => ({ title: section.title.trim(), text: section.text.replace(/\s+$/, '') }))
      .filter((section) => section.title && section.text);
  }

  root.MMC = root.MMC || {};
  root.MMC.parser = { parseMacros, parseSections };
})(typeof globalThis !== 'undefined' ? globalThis : this);
