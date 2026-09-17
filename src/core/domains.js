/**
 * MMCopyPaste — работа с доменами и профилями.
 *
 * Профиль = именованный список макросов, привязанный к домену.
 * Профиль с пустым доменем («Все сайты») действует везде.
 */
(function (root) {
  'use strict';

  const GLOBAL_PROFILE_ID = 'all';
  const GLOBAL_PROFILE_NAME = 'Все сайты';

  /** Приводим домен к нижнему регистру, без схемы, порта, пути и точки в начале. */
  function normalizeDomain(domain) {
    let value = typeof domain === 'string' ? domain.trim().toLowerCase() : '';
    if (!value) return '';
    value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // http://, https://
    value = value.split(/[/?#]/)[0]; // убираем путь и якорь
    value = value.split(':')[0]; // убираем порт
    return value.replace(/^\.+/, '').replace(/\.+$/, '');
  }

  /** Безопасно достаём hostname из URL. */
  function getHostname(url) {
    if (typeof url !== 'string' || !url) return '';
    try {
      return normalizeDomain(new URL(url).hostname);
    } catch (err) {
      return '';
    }
  }

  /**
   * Подходит ли профиль под страницу.
   * Пустой домен профиля = «Все сайты» = подходит всегда.
   * "ai.sknt.ru" подходит и для "chat.ai.sknt.ru" (поддомены).
   */
  function hostnameMatches(hostname, domain) {
    const pattern = normalizeDomain(domain);
    if (!pattern) return true;
    const host = normalizeDomain(hostname);
    if (!host) return false;
    return host === pattern || host.endsWith('.' + pattern);
  }

  function isGlobalProfile(profile) {
    return !profile || !profile.domain;
  }

  /** Точное совпадение домена профиля. */
  function findProfileByDomain(state, domain) {
    const wanted = normalizeDomain(domain);
    const profiles = (state && state.profiles) || [];
    return profiles.find((profile) => normalizeDomain(profile.domain) === wanted) || null;
  }

  function findProfileById(state, id) {
    const profiles = (state && state.profiles) || [];
    return profiles.find((profile) => profile && profile.id === id) || null;
  }

  /**
   * Все профили, действующие на странице: сначала «Все сайты»,
   * затем доменные — от более специфичного к менее специфичному.
   */
  function profilesForHostname(state, hostname) {
    const profiles = (state && state.profiles) || [];
    const matching = profiles.filter(
      (profile) => profile && !isGlobalProfile(profile) && hostnameMatches(hostname, profile.domain)
    );
    matching.sort((a, b) => normalizeDomain(b.domain).length - normalizeDomain(a.domain).length);
    const globals = profiles.filter((profile) => profile && isGlobalProfile(profile));
    return globals.concat(matching);
  }

  /** Плоский список макросов, которые должны срабатывать на странице. */
  function activeMacros(state, hostname) {
    if (!state || state.enabled === false) return [];
    const macros = [];
    for (const profile of profilesForHostname(state, hostname)) {
      if (!profile || profile.enabled === false) continue;
      for (const macro of profile.macros || []) {
        if (macro && macro.enabled !== false && macro.key) macros.push(macro);
      }
    }
    return macros;
  }

  root.MMC = root.MMC || {};
  root.MMC.domains = {
    GLOBAL_PROFILE_ID,
    GLOBAL_PROFILE_NAME,
    normalizeDomain,
    getHostname,
    hostnameMatches,
    isGlobalProfile,
    findProfileByDomain,
    findProfileById,
    profilesForHostname,
    activeMacros
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
