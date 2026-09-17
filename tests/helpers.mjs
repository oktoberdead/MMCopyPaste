/**
 * Хелперы для тестов.
 *
 * Ядро расширения написано как классические IIFE-скрипты (без сборки), чтобы
 * одинаково работать в Chrome, Edge, Opera, Яндекс и Firefox. В тестах мы
 * читаем эти файлы как текст и исполняем их в изолированном vm-контексте —
 * таким образом проверяется ровно тот код, который уедет в браузер.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CORE_FILES = [
  'src/core/expand.js',
  'src/core/domains.js',
  'src/core/storage.js'
];

/** Исполняем ядро в чистом контексте и возвращаем неймспейс MMC. */
export function loadCore() {
  // В браузере URL и console существуют; в vm-контексе их нужно передать явно.
  const context = { URL, console };
  vm.createContext(context, { name: 'mmc-core' });
  for (const file of CORE_FILES) {
    const source = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    vm.runInContext(source, context, { filename: file });
  }
  return context.MMC;
}

/** Создаём свежее состояние с профилем "Все сайты" и заданными макросами. */
export function makeState(macros, overrides = {}) {
  const MMC = loadCore();
  const state = MMC.storage.createDefaultState();
  state.profiles[0].macros = macros;
  return { ...state, ...overrides };
}

export function macro(key, text, enabled = true) {
  return { id: 'm-' + key, key, text, enabled };
}
