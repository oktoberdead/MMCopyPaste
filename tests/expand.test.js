import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers.mjs';

const MMC = loadCore();
const { findTrigger, replaceRange, pickMacro, hasLongerKey } = MMC.expand;

const priv = { id: '1', key: 'прив', text: 'Здравствуйте!', enabled: true };
const hello = { id: '2', key: 'привет', text: 'Приветствую!', enabled: true };
const off = { id: '3', key: 'off', text: 'Выключен', enabled: false };

const short = [priv, off]; // без более длинного префикса
const both = [priv, hello, off]; // прив + привет

function find(text, list = short, opts = {}) {
  return findTrigger({
    text,
    caret: opts.caret ?? text.length,
    prefix: opts.prefix,
    macros: list
  });
}

test('точное совпадение в конце текста', () => {
  const t = find('--прив');
  assert.equal(t.macro.key, 'прив');
  assert.equal(t.start, 0);
  assert.equal(t.end, 6); // '--прив'.length
});

test('регистронезависимое совпадение', () => {
  assert.equal(find('--ПРИВ').macro.key, 'прив');
});

test('триггер в середине текста, каретка после ключа', () => {
  const t = find('--прив !', short, { caret: 6 });
  assert.ok(t);
  assert.equal(t.end, 6);
});

test('префикс внутри слова не срабатывает', () => {
  assert.equal(find('abc--прив'), null);
});

test('после пунктуации и пробела срабатывает', () => {
  assert.ok(find('hi --прив'));
  // каретка стоит сразу после ключа, до закрывающей скобки
  assert.ok(find('(см. --прив)', short, { caret: 11 }));
});

test('неполный более длинный ключ ждёт следующий символ', () => {
  assert.equal(find('--прив', both), null);
});

test('длинный ключ дописан — раскрывается длинный', () => {
  assert.equal(find('--привет', both).macro.key, 'привет');
});

test('пробел после ключа форсирует раскрытие короткого', () => {
  const t = find('--прив ', both);
  assert.equal(t.macro.key, 'прив');
  assert.equal(t.end, 6, 'хвостовой пробел остаётся в тексте');
});

test('неизвестное кодовое слово не раскрывается', () => {
  assert.equal(find('--нет'), null);
});

test('выключенный макрос игнорируется', () => {
  assert.equal(find('--off'), null);
});

test('пользовательский префикс', () => {
  assert.ok(find('!прив', short, { prefix: '!' }));
  assert.equal(find('--прив', short, { prefix: '!' }), null);
});

test('алиасы дефисного префикса: длинное тире (Telegram)', () => {
  const variants = MMC.expand.prefixVariants('--');
  assert.ok(variants.includes('—'), 'в вариантах есть длинное тире');
  const t = findTrigger({ text: '—прив', caret: 5, prefixes: variants, macros: short });
  assert.ok(t, '"—прив" раскрывается');
  assert.equal(t.macro.key, 'прив');
});

test('алиасы не ломают обычный префикс', () => {
  const variants = MMC.expand.prefixVariants('--');
  const t = findTrigger({ text: '--прив', caret: 6, prefixes: variants, macros: short });
  assert.ok(t);
});

test('пробел внутри триггера не допускается', () => {
  assert.equal(find('--при вет'), null);
});

test('пустой список макросов', () => {
  assert.equal(findTrigger({ text: '--прив', caret: 6, macros: [] }), null);
});

test('hasLongerKey различает префиксы', () => {
  assert.equal(hasLongerKey('при', both), true);
  assert.equal(hasLongerKey('привет', both), false);
});

test('replaceRange корректно собирает текст и каретку', () => {
  const { text, caret } = replaceRange('до --прив после', 3, 9, 'ТЕКСТ');
  assert.equal(text, 'до ТЕКСТ после');
  assert.equal(caret, 3 + 'ТЕКСТ'.length);
});

test('pickMacro предпочитает точное совпадение', () => {
  assert.equal(pickMacro('привет', both).id, '2');
});

test('fillTemplate подставляет плейсхолдеры', () => {
  const out = MMC.expand.fillTemplate('Меня зовут {имя}, отдел {отдел}.', {
    имя: 'Иван',
    отдел: 'ТП'
  });
  assert.equal(out, 'Меня зовут Иван, отдел ТП.');
});

test('fillTemplate: регистр не важен, неизвестные остаются', () => {
  const out = MMC.expand.fillTemplate('{Имя} и {нет}', { имя: 'Аня' });
  assert.equal(out, 'Аня и {нет}');
});

test('fillTemplate: без vars текст не меняется', () => {
  assert.equal(MMC.expand.fillTemplate('текст {имя}', null), 'текст {имя}');
});

test('fillTemplate: встроенные {дата}/{время} работают без настройки', () => {
  const now = new Date(2026, 7, 26, 9, 5);
  const out = MMC.expand.fillTemplate('{дата} {время}', {}, now);
  assert.equal(out, '26.08.2026 09:05');
});

test('fillTemplate: vars профиля перекрывают встроенные', () => {
  const now = new Date(2026, 7, 26, 9, 5);
  const out = MMC.expand.fillTemplate('{дата}', { дата: 'сегодня' }, now);
  assert.equal(out, 'сегодня');
});
