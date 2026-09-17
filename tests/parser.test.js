import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO_ROOT } from './helpers.mjs';

const context = {};
vm.createContext(context, { name: 'mmc-parser' });
vm.runInContext(readFileSync(path.join(REPO_ROOT, 'src/core/parser.js'), 'utf8'), context);
const { parseMacros, parseSections } = context.MMC.parser;

test('базовый разбор двух записей', () => {
  const out = parseMacros('--macro: texttexttext\n\n--macro2: text2text2text2\n');
  assert.equal(out.length, 2);
  assert.equal(out[0].key, 'macro');
  assert.equal(out[0].text, 'texttexttext');
  assert.equal(out[1].key, 'macro2');
});

test('многострочный текст сохраняется', () => {
  const out = parseMacros('--прив: Здравствуйте!\nВторая строка.\n\n--спс: Спасибо');
  assert.equal(out[0].text, 'Здравствуйте!\nВторая строка.');
  assert.equal(out[1].key, 'спс');
});

test('строки до первой записи игнорируются', () => {
  const out = parseMacros('# База макросов\nколлегин формат\n--a: один');
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'a');
});

test('markdown "Ключ: значение" без дефисов не считается макросом', () => {
  const out = parseMacros('Title: заголовок\nNote: заметка\n--a: один');
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'a');
});

test('дубликаты ключей убираются', () => {
  const out = parseMacros('--a: один\n--A: два');
  assert.equal(out.length, 1);
  assert.equal(out[0].text, 'один');
});

test('длинное тире тоже считается префиксом', () => {
  const out = parseMacros('—прив: здравствуйте');
  assert.equal(out[0].key, 'прив');
});

test('пустой и без записей', () => {
  assert.equal(parseMacros('').length, 0);
  assert.equal(parseMacros('просто текст без записей').length, 0);
});

test('записи без текста отбрасываются', () => {
  const out = parseMacros('--пусто:\n--норм: ок');
  assert.equal(out.length, 1);
  assert.equal(out[0].key, 'норм');
});

test('parseSections: ##-секции из боевого файла', () => {
  const md = [
    '# Шаблоны ответов',
    '',
    '## Приветствие, Салам, hi',
    'Здравствуйте!',
    'Меня зовут Екатерина.',
    '',
    '## адрес',
    'Напишите номер договора.',
    'Спасибо!',
    '',
    '## адрес',
    'Второй вариант про адрес.'
  ].join('\n');
  const out = parseSections(md);
  assert.equal(out.length, 3, 'дубли заголовков — разные пасты');
  assert.equal(out[0].title, 'Приветствие, Салам, hi');
  assert.equal(out[0].text, 'Здравствуйте!\nМеня зовут Екатерина.');
  assert.equal(out[2].text, 'Второй вариант про адрес.');
});

test('parseSections: одиночный # пропускается', () => {
  const out = parseSections('# Заголовок\n## a\nтекст');
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'a');
});
