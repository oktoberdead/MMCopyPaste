import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { REPO_ROOT, CORE_FILES } from './helpers.mjs';

function baseState(macros, overrides = {}) {
  return {
    version: 1,
    enabled: true,
    prefix: '--',
    profiles: [
      { id: 'all', domain: '', name: 'Все сайты', enabled: true, macros }
    ],
    ...overrides
  };
}

const priv = { id: '1', key: 'прив', text: 'Здравствуйте!', enabled: true };

function setup(url, state) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  const stored = state;
  window.chrome = {
    storage: {
      local: {
        get: () => Promise.resolve(stored ? { mmcState: stored } : {}),
        set: () => Promise.resolve()
      },
      onChanged: { addListener: () => {} }
    }
  };

  for (const file of [...CORE_FILES, 'src/content/content.js']) {
    window.eval(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  }

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { window, doc: window.document, flush };
}

function typePlain(window, element, value, caret) {
  element.focus();
  element.value = value;
  const pos = caret ?? value.length;
  element.selectionStart = element.selectionEnd = pos;
  element.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('textarea: "--прив" заменяется текстом макроса', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat', baseState([priv]));
  await flush();

  const ta = doc.createElement('textarea');
  doc.body.appendChild(ta);
  typePlain(window, ta, '--прив');
  assert.equal(ta.value, 'Здравствуйте!');
});

test('textarea: текст после каретки сохраняется', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat', baseState([priv]));
  await flush();

  const ta = doc.createElement('textarea');
  doc.body.appendChild(ta);
  typePlain(window, ta, '--прив !', 6);
  assert.equal(ta.value, 'Здравствуйте! !');
});

test('textarea: длинное тире вместо "--" (как в Telegram)', async () => {
  const { window, doc, flush } = setup('https://web.telegram.org/a/', baseState([priv]));
  await flush();

  const ta = doc.createElement('textarea');
  doc.body.appendChild(ta);
  typePlain(window, ta, '—прив');
  assert.equal(ta.value, 'Здравствуйте!');
});

test('input[type=text] тоже работает', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat', baseState([priv]));
  await flush();

  const input = doc.createElement('input');
  input.type = 'text';
  doc.body.appendChild(input);
  typePlain(window, input, '--прив');
  assert.equal(input.value, 'Здравствуйте!');
});

test('выключенное расширение не трогает поле', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat', baseState([priv], { enabled: false }));
  await flush();

  const ta = doc.createElement('textarea');
  doc.body.appendChild(ta);
  typePlain(window, ta, '--прив');
  assert.equal(ta.value, '--прив');
});

test('contenteditable: вставка через диапазон', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat', baseState([priv]));
  await flush();

  const div = doc.createElement('div');
  Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });
  div.textContent = '--прив';
  doc.body.appendChild(div);

  const range = doc.createRange();
  range.selectNodeContents(div);
  range.collapse(false); // каретка в конец
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  div.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(div.textContent, 'Здравствуйте!');
});

test('contenteditable: триггер, разбитый на два текстовых узла', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat', baseState([priv]));
  await flush();

  const div = doc.createElement('div');
  Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });
  div.appendChild(doc.createTextNode('--пр'));
  div.appendChild(doc.createTextNode('ив'));
  doc.body.appendChild(div);

  // каретка в конец второго текстового узла
  const second = div.childNodes[1];
  const range = doc.createRange();
  range.setStart(second, second.data.length);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  div.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(div.textContent, 'Здравствуйте!');
});

test('textarea: плейсхолдеры подставляются из vars профиля', async () => {
  const state = baseState([{ id: '1', key: 'прив', text: 'Я {имя}, здравствуйте!', enabled: true, send: 'none' }]);
  state.profiles[0].vars = { имя: 'Иван' };
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat', state);
  await flush();

  const ta = doc.createElement('textarea');
  doc.body.appendChild(ta);
  typePlain(window, ta, '--прив');
  assert.equal(ta.value, 'Я Иван, здравствуйте!');
});

test('textarea: автоотправка шлёт keydown Enter', async () => {
  const sendMacro = { id: '1', key: 'прив', text: 'Здравствуйте!', enabled: true, send: 'enter' };
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat', baseState([sendMacro]));
  await flush();

  const ta = doc.createElement('textarea');
  doc.body.appendChild(ta);
  const seen = [];
  ta.addEventListener('keydown', (e) => seen.push(e.key));
  typePlain(window, ta, '--прив');
  assert.equal(ta.value, 'Здравствуйте!');
  assert.ok(seen.includes('Enter'), 'отправка эмулирована: ' + seen.join(','));
});

test('contenteditable: структура ProseMirror div>p>text', async () => {
  const { window, doc, flush } = setup('https://web.telegram.org/a/', baseState([priv]));
  await flush();

  const div = doc.createElement('div');
  Object.defineProperty(div, 'isContentEditable', { value: true, configurable: true });
  const p = doc.createElement('p');
  p.textContent = '--прив';
  div.appendChild(p);
  doc.body.appendChild(div);

  const tn = p.firstChild;
  const range = doc.createRange();
  range.setStart(tn, tn.data.length);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  div.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal(p.textContent, 'Здравствуйте!');
});

test('ручной триггер Ctrl+Shift+M раскрывает в textarea', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat', baseState([priv]));
  await flush();

  const ta = doc.createElement('textarea');
  doc.body.appendChild(ta);
  ta.focus();
  ta.value = '--прив';
  ta.selectionStart = ta.selectionEnd = 6;

  const ev = new window.KeyboardEvent('keydown', {
    key: 'M',
    code: 'KeyM',
    ctrlKey: true,
    shiftKey: true,
    bubbles: true,
    cancelable: true
  });
  ta.dispatchEvent(ev);
  assert.equal(ta.value, 'Здравствуйте!');
});

test('textarea: без автоотправки keydown не шлётся', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat', baseState([priv]));
  await flush();

  const ta = doc.createElement('textarea');
  doc.body.appendChild(ta);
  const seen = [];
  ta.addEventListener('keydown', (e) => seen.push(e.key));
  typePlain(window, ta, '--прив');
  assert.equal(seen.length, 0, 'Enter не эмулируется по умолчанию');
});
