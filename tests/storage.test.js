import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers.mjs';

const MMC = loadCore();
const S = MMC.storage;

test('createDefaultState: глобальный профиль первым с примерами', () => {
  const state = S.createDefaultState();
  assert.equal(state.enabled, true);
  assert.equal(state.prefix, '--');
  assert.equal(state.profiles[0].domain, '');
  assert.equal(state.profiles[0].macros.length, 2);
});

test('normalize добавляет глобальный профиль, если его нет', () => {
  const state = S.normalize({ profiles: [{ domain: 'a.ru', macros: [] }] });
  assert.equal(state.profiles[0].domain, '');
  assert.equal(state.profiles.length, 2);
});

test('normalize убирает дубликаты ключей и пустые записи', () => {
  const state = S.normalize({
    profiles: [
      {
        domain: '',
        macros: [
          { key: 'прив', text: 'A' },
          { key: 'ПРИВ', text: 'B' }, // дубль по регистру -> отсеется
          { key: '', text: 'X' }, // пустой ключ -> отсеется
          { key: 'нет', text: '' } // пустой текст -> отсеется
        ]
      }
    ]
  });
  const keys = state.profiles[0].macros.map((m) => m.key);
  assert.equal(keys.join('|'), 'прив');
});

test('upsertMacro: добавление и обновление', () => {
  const state = S.createDefaultState();
  const created = S.upsertMacro(state, state.profiles[0].id, { key: 'нов', text: 'Н!' });
  assert.equal(created.key, 'нов');

  const updated = S.upsertMacro(state, state.profiles[0].id, { id: created.id, key: 'нов', text: 'Н2' });
  assert.equal(updated.text, 'Н2');
  assert.equal(state.profiles[0].macros.length, 1 + 2); // 2 сиду + 1
});

test('upsertMacro: дубликат ключа бросает', () => {
  const state = S.createDefaultState();
  S.upsertMacro(state, state.profiles[0].id, { key: 'нов', text: 'X' });
  assert.throws(() => S.upsertMacro(state, state.profiles[0].id, { key: 'НОВ', text: 'Y' }), /занято/);
});

test('upsertMacro: пустые значения бросают', () => {
  const state = S.createDefaultState();
  assert.throws(() => S.upsertMacro(state, state.profiles[0].id, { key: '', text: 'X' }));
  assert.throws(() => S.upsertMacro(state, state.profiles[0].id, { key: 'a', text: '' }));
});

test('removeMacro', () => {
  const state = S.createDefaultState();
  const first = state.profiles[0].macros[0];
  assert.equal(S.removeMacro(state, state.profiles[0].id, first.id), true);
  assert.equal(S.removeMacro(state, state.profiles[0].id, 'nope'), false);
});

test('addProfile не создаёт дубликатов, removeProfile не трогает глобальный', () => {
  const state = S.createDefaultState();
  const p1 = S.addProfile(state, 'ai.sknt.ru');
  const p2 = S.addProfile(state, 'AI.Sknt.Ru');
  assert.equal(p1.id, p2.id);

  assert.equal(S.removeProfile(state, state.profiles[0].id), false, 'глобальный неудаляем');
  assert.equal(S.removeProfile(state, p1.id), true);
});

test('экспорт и импорт круговорот', () => {
  const state = S.createDefaultState();
  S.upsertMacro(state, state.profiles[0].id, { key: 'нов', text: 'Текст\nс переносом' });
  const json = S.exportState(state);
  const imported = S.importState(json);
  const keys = imported.profiles[0].macros.map((m) => m.key);
  assert.ok(keys.includes('нов'));

  assert.throws(() => S.importState('{ не json'), /JSON/);
});

test('cleanKey нормализует пробелы и длину', () => {
  assert.equal(S.cleanKey('  прив  '), 'прив');
  assert.equal(S.cleanKey('a'.repeat(100)).length, S.MAX_KEY_LENGTH);
});

test('normalize сохраняет send и vars', () => {
  const state = S.normalize({
    profiles: [
      {
        domain: '',
        vars: { имя: 'Иван', пустой: '' },
        macros: [{ key: 'прив', text: 'X', send: 'ctrl' }, { key: 'bad', text: 'Y', send: 'телепорт' }]
      }
    ]
  });
  const [a, b] = state.profiles[0].macros;
  assert.equal(a.send, 'ctrl');
  assert.equal(b.send, 'none', 'неизвестный режим откатывается в none');
  assert.equal(state.profiles[0].vars['имя'], 'Иван');
});

test('upsertMacro сохраняет send', () => {
  const state = S.createDefaultState();
  const created = S.upsertMacro(state, state.profiles[0].id, { key: 'нов', text: 'T', send: 'shift' });
  assert.equal(created.send, 'shift');
});

test('varsForHost: домен перекрывает глобальные', () => {
  const state = S.createDefaultState();
  state.profiles[0].vars = { имя: 'Глобал', город: 'Москва' };
  state.profiles.push({
    id: 'p1',
    domain: 'ai.sknt.ru',
    name: 'ai',
    enabled: true,
    macros: [],
    vars: { имя: 'Домен' }
  });
  const vars = S.varsForHost(state, 'ai.sknt.ru');
  assert.equal(vars['имя'], 'Домен');
  assert.equal(vars['город'], 'Москва');

  const other = S.varsForHost(state, 'other.example');
  assert.equal(other['имя'], 'Глобал');
});

test('пасты: createDefaultState и normalize', () => {
  const def = S.createDefaultState();
  assert.equal(def.pastes.length, 2);

  const state = S.normalize({ pastes: [{ title: 'адрес', text: 'текст' }, { title: '', text: 'x' }] });
  assert.equal(state.pastes.length, 1, 'пустой заголовок отброшен');
  assert.equal(state.pastes[0].title, 'адрес');
});

test('пасты: upsert и remove', () => {
  const state = S.createDefaultState();
  const created = S.upsertPaste(state, { title: 'порты', text: 'текст про порты' });
  assert.equal(created.title, 'порты');

  const updated = S.upsertPaste(state, { id: created.id, title: 'порты', text: 'обновлено' });
  assert.equal(updated.text, 'обновлено');

  assert.throws(() => S.upsertPaste(state, { title: '', text: 'x' }), /заголовок/i);
  assert.equal(S.removePaste(state, created.id), true);
  assert.equal(S.removePaste(state, 'nope'), false);
});

test('пасты: clearPastes чистит и возвращает счётчик', () => {
  const state = S.createDefaultState();
  assert.equal(S.clearPastes(state), 2);
  assert.equal(state.pastes.length, 0);
});

test('gender хранится; {g} временно отключён', () => {
  const m = S.normalize({});
  assert.equal(m.gender, 'm');
  const f = S.normalize({ gender: 'f' });
  assert.equal(f.gender, 'f');
  // род пока скрыт: effectiveVars не добавляет {g}
  assert.equal('g' in S.effectiveVars(f, 'x.example'), false);
});

test('setVar добавляет и удаляет', () => {
  const state = S.createDefaultState();
  const id = state.profiles[0].id;
  S.setVar(state, id, 'имя', 'Иван');
  assert.equal(state.profiles[0].vars['имя'], 'Иван');
  S.setVar(state, id, 'имя', null);
  assert.equal(state.profiles[0].vars['имя'], undefined);
});
