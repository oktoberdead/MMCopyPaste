import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { REPO_ROOT, CORE_FILES } from './helpers.mjs';

function setup(url) {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const { window } = dom;

  const stored = null;
  window.chrome = {
    storage: {
      local: {
        get: () => Promise.resolve(stored ? { mmcState: stored } : {}),
        set: () => Promise.resolve()
      },
      onChanged: { addListener: () => {} }
    },
    tabs: { query: () => Promise.resolve([{ url }]) },
    runtime: { openOptionsPage: () => {}, getURL: () => 'options.html' }
  };
  window.confirm = () => true;
  window.alert = () => {};

  for (const file of [...CORE_FILES, 'src/core/search.js', 'src/core/parser.js', 'src/ui/app.js']) {
    window.eval(readFileSync(path.join(REPO_ROOT, file), 'utf8'));
  }
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return { window, doc: window.document, flush };
}

test('попап рендерит список и добавляет макрос через форму', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat');

  const handle = await window.MMC.ui.mount(doc.getElementById('app'), {
    mode: 'popup',
    hostname: 'ai.sknt.ru'
  });
  await flush();

  const app = doc.getElementById('app');
  assert.ok(app.querySelector('.app-header'), 'есть шапка');
  const chips = [...app.querySelectorAll('.chip')].map((c) => c.textContent);
  assert.ok(chips.includes('Все сайты'), 'есть чип "Все сайты"');

  // Добавляем свой макрос через настоящую форму.
  handle.startAdding();
  await flush();
  const keyInput = app.querySelector('.key-wrap input');
  const textArea = app.querySelector('textarea');
  assert.ok(keyInput && textArea, 'форма открыта');
  keyInput.value = 'тест';
  textArea.value = 'Это тестовая вставка';
  handle.submitEditor();
  await flush();

  const rows = [...app.querySelectorAll('.row-key')].map((r) => r.textContent);
  assert.ok(rows.includes('--тест'), 'макрос появился в списке: ' + rows.join(','));

  const state = handle.state;
  const macro = state.profiles[0].macros.find((m) => m.key === 'тест');
  assert.ok(macro, 'макрос в состоянии');
});

test('дубликат кодового слова не сохраняется', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat');
  const handle = await window.MMC.ui.mount(doc.getElementById('app'), {
    mode: 'popup',
    hostname: 'ai.sknt.ru'
  });
  await flush();
  const app = doc.getElementById('app');

  handle.startAdding();
  const keyInput = app.querySelector('.key-wrap input');
  const textArea = app.querySelector('textarea');
  keyInput.value = 'прив'; // уже есть в примерах
  textArea.value = 'Дубль';
  handle.submitEditor();
  await flush();

  const count = handle.state.profiles[0].macros.filter((m) => m.key.toLowerCase() === 'прив').length;
  assert.equal(count, 1, 'дубль не добавился');
});

test('закреплённая кнопка добавления и ПКМ по пилюле выключают профиль', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat');
  const handle = await window.MMC.ui.mount(doc.getElementById('app'), {
    mode: 'popup',
    hostname: 'ai.sknt.ru'
  });
  await flush();
  const app = doc.getElementById('app');

  assert.ok(app.querySelector('.toolbar .btn-primary'), 'кнопка "+ Макрос" в закреплённой панели');

  const chip = [...app.querySelectorAll('.chip')].find((c) => c.textContent === 'Все сайты');
  assert.ok(chip, 'пилюля профиля найдена');
  assert.ok(chip.classList.contains('is-enabled'), 'профиль включён — пилюля зелёная');

  chip.dispatchEvent(new window.Event('contextmenu', { bubbles: true, cancelable: true }));
  await flush();
  assert.equal(handle.state.profiles[0].enabled, false, 'ПКМ выключил профиль');
  const chipAfter = [...app.querySelectorAll('.chip')].find((c) => c.textContent === 'Все сайты');
  assert.ok(chipAfter.classList.contains('is-disabled'), 'пилюля стала красной');
});

test('настройки: есть плейсхолдеры и select режима отправки', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat');
  const handle = await window.MMC.ui.mount(doc.getElementById('app'), {
    mode: 'options',
    hostname: 'ai.sknt.ru'
  });
  await flush();
  const app = doc.getElementById('app');

  assert.ok(app.querySelector('.vars'), 'секция плейсхолдеров есть в настройках');

  handle.startAdding();
  await flush();
  const sendSelect = app.querySelector('.editor select');
  assert.ok(sendSelect, 'в редакторе есть select режима отправки');
  assert.equal(sendSelect.options.length, 4, 'Enter/Shift/Ctrl/none');

  const importBtn = [...app.querySelectorAll('button')].find((b) =>
    b.textContent.includes('.md/.txt')
  );
  assert.ok(importBtn, 'есть кнопка загрузки .md/.txt');
  assert.ok(app.querySelector('.settings select'), 'есть выбор профиля для импорта');
});

test('попап: режим паст по умолчанию, поиск и копирование', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat');
  const handle = await window.MMC.ui.mount(doc.getElementById('app'), {
    mode: 'popup',
    hostname: 'ai.sknt.ru'
  });
  await flush();
  const app = doc.getElementById('app');

  const segs = [...app.querySelectorAll('.mode-toggle .seg')];
  assert.equal(segs.length, 2, 'тумблер Пасты/Макросы');
  const active = segs.find((s) => s.classList.contains('is-active'));
  assert.equal(active.textContent, 'Пасты', 'по умолчанию открыты пасты');

  const searchInput = app.querySelector('.search');
  searchInput.value = 'адрес';
  searchInput.dispatchEvent(new window.Event('input', { bubbles: true }));
  await flush();
  const titles = [...app.querySelectorAll('.paste-title')].map((t) => t.textContent);
  assert.ok(titles.includes('адрес'), 'поиск нашёл пасту: ' + titles.join(','));

  handle.copyPaste(handle.state.pastes.find((p) => p.title === 'адрес'));
  await flush();
  assert.ok(doc.querySelector('.toast'), 'тост «Скопировано» показан');
});

test('вкладки разделяют контент и переключаются (попап)', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat');
  const handle = await window.MMC.ui.mount(doc.getElementById('app'), {
    mode: 'popup',
    hostname: 'ai.sknt.ru'
  });
  await flush();

  const groups = doc.querySelectorAll('.group');
  assert.equal(groups.length, 2);
  const [macrosWrap, pastesWrap] = groups;
  assert.equal(pastesWrap.hidden, false, 'по умолчанию пасты видимы');
  assert.equal(macrosWrap.hidden, true, 'макросы скрыты');

  handle.setMode('macros');
  await flush();
  assert.equal(macrosWrap.hidden, false);
  assert.equal(pastesWrap.hidden, true);
});

test('настройки: по умолчанию макросы; профили и плейсхолдеры вне дропдауна', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat');
  await window.MMC.ui.mount(doc.getElementById('app'), { mode: 'options' });
  await flush();

  const [macrosWrap, pastesWrap] = doc.querySelectorAll('.group');
  assert.equal(macrosWrap.hidden, false, 'в настройках по умолчанию макросы');
  assert.equal(pastesWrap.hidden, true);

  assert.ok(macrosWrap.querySelector('.profiles'), 'профили не спрятаны');
  assert.ok(macrosWrap.querySelector('.vars'), 'плейсхолдеры не спрятаны');
  assert.ok(macrosWrap.querySelector('.collapse-body .list'), 'список макросов в дропдауне');
});

test('паста: копирование подставляет плейсхолдеры', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat');
  const handle = await window.MMC.ui.mount(doc.getElementById('app'), {
    mode: 'popup',
    hostname: 'ai.sknt.ru'
  });
  await flush();

  const st = handle.state;
  st.profiles[0].vars = { имя: 'Екатерина' };
  st.pastes.push({ id: 'p1', title: 't', text: 'Я {имя}, готов помочь.' });

  let captured = null;
  Object.defineProperty(window.navigator, 'clipboard', {
    value: { writeText: (t) => { captured = t; return Promise.resolve(); } },
    configurable: true
  });

  handle.copyPaste(st.pastes.find((p) => p.id === 'p1'));
  await flush();
  assert.equal(captured, 'Я Екатерина, готов помочь.');
});

test('настройки: "Удалить все пасты" чистит список', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat');
  const handle = await window.MMC.ui.mount(doc.getElementById('app'), { mode: 'options' });
  await flush();

  handle.state.pastes.push({ id: 'x', title: 't', text: 'y' });
  const btn = [...doc.querySelectorAll('button')].find((b) =>
    b.textContent.includes('Удалить все пасты')
  );
  assert.ok(btn, 'кнопка есть');
  btn.dispatchEvent(new window.Event('click', { bubbles: true }));
  await flush();
  assert.equal(handle.state.pastes.length, 0, 'пасты удалены');
});

test('выключение расширения переключается', async () => {
  const { window, doc, flush } = setup('https://ai.sknt.ru/chat');
  const handle = await window.MMC.ui.mount(doc.getElementById('app'), {
    mode: 'popup',
    hostname: 'ai.sknt.ru'
  });
  await flush();
  const app = doc.getElementById('app');
  const toggle = app.querySelector('.switch input');
  assert.equal(toggle.checked, true, 'по умолчанию включено');
  toggle.checked = false;
  toggle.dispatchEvent(new window.Event('change', { bubbles: true }));
  await flush();
  assert.equal(handle.state.enabled, false, 'состояние выключено');
});
