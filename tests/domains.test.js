import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './helpers.mjs';

const MMC = loadCore();
const { normalizeDomain, getHostname, hostnameMatches, profilesForHostname, activeMacros } =
  MMC.domains;

test('normalizeDomain убирает схему, порт, путь и точки', () => {
  assert.equal(normalizeDomain('https://AI.Sknt.ru:8080/chat?x=1'), 'ai.sknt.ru');
  assert.equal(normalizeDomain('.example.com.'), 'example.com');
  assert.equal(normalizeDomain(''), '');
});

test('getHostname из URL', () => {
  assert.equal(getHostname('https://chat.ai.sknt.ru/index.html'), 'chat.ai.sknt.ru');
  assert.equal(getHostname('не-url'), '');
  assert.equal(getHostname(''), '');
});

test('hostnameMatches: точное и поддомены', () => {
  assert.equal(hostnameMatches('ai.sknt.ru', 'ai.sknt.ru'), true);
  assert.equal(hostnameMatches('chat.ai.sknt.ru', 'ai.sknt.ru'), true);
  assert.equal(hostnameMatches('sknt.ru', 'ai.sknt.ru'), false);
  assert.equal(hostnameMatches('notai.sknt.ru', 'ai.sknt.ru'), false);
  assert.equal(hostnameMatches('anything.example', 'ai.sknt.ru'), false);
});

test('пустой домен профиля = все сайты', () => {
  assert.equal(hostnameMatches('any.example.com', ''), true);
});

test('activeMacros соединяет глобальные и доменные', () => {
  const state = MMC.storage.createDefaultState();
  state.profiles[0].macros = [{ id: 'g1', key: 'прив', text: 'G', enabled: true }];
  state.profiles.push({
    id: 'p1',
    domain: 'ai.sknt.ru',
    name: 'ai.sknt.ru',
    enabled: true,
    macros: [{ id: 'd1', key: 'спс', text: 'D', enabled: true }]
  });

  const keys = activeMacros(state, 'chat.ai.sknt.ru').map((m) => m.key);
  assert.equal(keys.join('|'), 'прив|спс');

  const other = activeMacros(state, 'other.example').map((m) => m.key);
  assert.equal(other.join('|'), 'прив');
});

test('выключенный профиль/глобальный выключатель отключают макросы', () => {
  const state = MMC.storage.createDefaultState();
  state.profiles[0].macros = [{ id: 'g1', key: 'прив', text: 'G', enabled: true }];

  state.profiles[0].enabled = false;
  assert.equal(activeMacros(state, 'x.example').length, 0);
  state.profiles[0].enabled = true;

  state.enabled = false;
  assert.equal(activeMacros(state, 'x.example').length, 0);
});

test('profilesForHostname: от более специфичного к менее', () => {
  const state = MMC.storage.createDefaultState();
  state.profiles.push(
    { id: 'a', domain: 'sknt.ru', name: 'sknt.ru', enabled: true, macros: [] },
    { id: 'b', domain: 'ai.sknt.ru', name: 'ai', enabled: true, macros: [] }
  );
  const order = profilesForHostname(state, 'ai.sknt.ru')
    .filter((p) => p.domain)
    .map((p) => p.domain);
  assert.equal(order.join('|'), 'ai.sknt.ru|sknt.ru');
});
