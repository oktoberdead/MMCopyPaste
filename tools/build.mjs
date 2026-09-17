/**
 * Сборка дистрибутивов MMCopyPaste.
 *
 * Исходники не требуют бандлера: это классические скрипты, которые одинаково
 * работают в Chrome, Edge, Opera, Яндекс и Firefox. Сборка лишь раскладывает
 * файлы по папкам dist/chrome и dist/firefox, дописывает Firefox-специфичный
 * манифест, проверяет, что все файлы из манифеста на месте, и пакует .zip.
 *
 * Запуск: npm run build
 */
import {
  rmSync,
  mkdirSync,
  cpSync,
  readFileSync,
  writeFileSync,
  existsSync
} from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const FIREFOX_EXTRA = {
  browser_specific_settings: {
    gecko: {
      id: 'mmcopypaste@oktoberdead.github.io',
      strict_min_version: '115.0'
    }
  }
};

function readRootManifest() {
  return JSON.parse(readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
}

function copyCommon(target) {
  mkdirSync(target, { recursive: true });
  cpSync(path.join(ROOT, 'src'), path.join(target, 'src'), { recursive: true });
  cpSync(path.join(ROOT, 'icons'), path.join(target, 'icons'), { recursive: true });
  if (existsSync(path.join(ROOT, 'README.md'))) {
    cpSync(path.join(ROOT, 'README.md'), path.join(target, 'README.md'));
  }
}

function referencedFiles(manifest) {
  const files = [];
  const push = (value) => {
    if (typeof value === 'string') files.push(value);
  };
  Object.values(manifest.icons || {}).forEach(push);
  push(manifest.action && manifest.action.default_popup);
  Object.values((manifest.action && manifest.action.default_icon) || {}).forEach(push);
  push(manifest.options_ui && manifest.options_ui.page);
  for (const cs of manifest.content_scripts || []) (cs.js || []).forEach(push);
  return files;
}

function validate(target, manifest) {
  const missing = referencedFiles(manifest).filter(
    (file) => !existsSync(path.join(target, file))
  );
  if (missing.length) {
    throw new Error(
      `[build] ${path.basename(target)}: манифест ссылается на отсутствующие файлы: ${missing.join(', ')}`
    );
  }
}

function zipDirectory(dir, outName) {
  try {
    execSync(`zip -qr ${JSON.stringify(outName)} .`, { cwd: dir, stdio: 'pipe' });
    return true;
  } catch (err) {
    console.warn('[build] не удалось создать zip (нет утилиты zip?):', err.message);
    return false;
  }
}

function buildChrome() {
  const target = path.join(DIST, 'chrome');
  const manifest = readRootManifest();
  rmSync(target, { recursive: true, force: true });
  copyCommon(target);
  writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  validate(target, manifest);
  const zipped = zipDirectory(target, path.join(DIST, 'mmcopypaste-chrome.zip'));
  console.log('[build] chrome готов:', path.relative(ROOT, target), zipped ? '(+zip)' : '');
}

function buildFirefox() {
  const target = path.join(DIST, 'firefox');
  const manifest = { ...readRootManifest(), ...FIREFOX_EXTRA };
  rmSync(target, { recursive: true, force: true });
  copyCommon(target);
  writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2));
  validate(target, manifest);
  const zipped = zipDirectory(target, path.join(DIST, 'mmcopypaste-firefox.zip'));
  console.log('[build] firefox готов:', path.relative(ROOT, target), zipped ? '(+zip)' : '');
}

rmSync(DIST, { recursive: true, force: true });
buildChrome();
buildFirefox();
console.log('[build] сборка завершена.');
