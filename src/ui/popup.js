/**
 * Попап: показываем профиль текущего сайта, если он уже создан.
 */
(function (root) {
  'use strict';

  const api = root.chrome || root.browser;

  function activeTabHostname() {
    if (!api || !api.tabs || typeof api.tabs.query !== 'function') return Promise.resolve('');
    return api.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        const tab = tabs && tabs[0];
        return tab && tab.url ? root.MMC.domains.getHostname(tab.url) : '';
      })
      .catch(() => '');
  }

  activeTabHostname().then((hostname) => {
    root.MMC.ui.mount(root.document.getElementById('app'), {
      mode: 'popup',
      hostname
    });
  });
})(typeof globalThis !== 'undefined' ? globalThis : this);
