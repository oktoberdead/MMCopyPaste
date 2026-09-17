import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO_ROOT } from './helpers.mjs';

const context = {};
vm.createContext(context, { name: 'mmc-search' });
vm.runInContext(readFileSync(path.join(REPO_ROOT, 'src/core/search.js'), 'utf8'), context);
const { normalize, searchPastes, snippet } = context.MMC.search;

const pastes = [
  { id: '1', title: 'адрес', text: 'Напишите номер договора и имя владельца.' },
  { id: '2', title: 'порты', text: 'Мы не блокируем протоколы, кроме портов 53, 445.' },
  { id: '3', title: 'приветствие', text: 'Здравствуйте! Меня зовут Екатерина, адрес не нужен.' }
];

test('normalize: регистр и ё', () => {
  assert.equal(normalize('АдРЕС ёлка'), 'адрес елка');
});

test('пустой запрос возвращает всё', () => {
  assert.equal(searchPastes(pastes, '').length, 3);
});

test('поиск по заголовку ранжируется выше тела', () => {
  const res = searchPastes(pastes, 'адрес');
  assert.equal(res[0].paste.id, '1', 'заголовок "адрес" выше');
  assert.equal(res.length, 2, 'нашли адрес в заголовке и в тексте приветствия');
});

test('несколько слов — все должны встречаться', () => {
  const res = searchPastes(pastes, 'имя владельца');
  assert.equal(res.length, 1);
  assert.equal(res[0].paste.id, '1');
});

test('поиск не чувствителен к ё/е и регистру', () => {
  const res = searchPastes(pastes, 'ПОРТЫ');
  assert.equal(res[0].paste.id, '2');
});

test('ничего не найдено', () => {
  assert.equal(searchPastes(pastes, 'блобка').length, 0);
});

test('snippet вокруг совпадения', () => {
  const s = snippet('ООО очень длинный текст про порты и блокировки сети', 'порты', 20);
  assert.ok(s.includes('порты'), s);
});
