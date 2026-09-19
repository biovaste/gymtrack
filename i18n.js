/* GymTrack localization. Draft Finnish is published immediately; review improves it. */
(function (root) {
  'use strict';
  const catalogue = root.GYM_I18N_CATALOG || { entries: {} };
  const entries = catalogue.entries || {};
  // Track detection mirrors APP_CONFIG in app.js (which loads later). Personal
  // defaults to English, athlete alpha to Finnish; each keeps its own choice.
  const loc = root.location || {};
  const isDevHost = loc.hostname === 'localhost' || loc.hostname === '127.0.0.1';
  let modeParam = null;
  try { modeParam = new URLSearchParams(loc.search || '').get('mode'); } catch (_) { /* no URL API */ }
  const isPersonal = loc.hostname === 'gymtrack.hithitpull.fi' ||
    (isDevHost && loc.port === '8765' && modeParam !== 'alpha') ||
    (isDevHost && loc.port !== '8766' && modeParam === 'personal');
  const storageKey = isPersonal ? 'gym.language' : 'gym_alpha.language';
  let saved;
  try { saved = root.localStorage.getItem(storageKey); } catch (_) { /* storage may be disabled */ }
  let language = ['en', 'fi'].includes(saved) ? saved : (isPersonal ? 'en' : 'fi');
  const missing = new Set();
  const localeTag = () => language === 'fi' ? 'fi-FI' : 'en-GB';

  function t(key, params = {}) {
    const entry = entries[key];
    if (!entry) {
      if (!missing.has(key)) { missing.add(key); root.console?.warn('Missing translation:', key); }
      return key;
    }
    const message = language === 'fi' && typeof entry.fi === 'string' && entry.fi.trim() ? entry.fi : entry.en;
    // Substitutions are plain text. Callers escape at HTML boundaries, once.
    return String(message ?? '').replace(/\{([A-Za-z][A-Za-z0-9_]*)\}/g, (match, name) =>
      Object.hasOwn(params, name) ? String(params[name] ?? '') : match);
  }

  function translateStatic(scope = root.document) {
    if (!scope?.querySelectorAll) return;
    for (const el of scope.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const attr of ['aria-label', 'title', 'placeholder']) {
      for (const el of scope.querySelectorAll('[data-i18n-' + attr + ']')) {
        el.setAttribute(attr, t(el.getAttribute('data-i18n-' + attr)));
      }
    }
    if (root.document?.documentElement) root.document.documentElement.lang = language;
  }

  function setLocale(next) {
    if (!['en', 'fi'].includes(next)) return false;
    language = next;
    try { root.localStorage.setItem(storageKey, next); } catch (_) { /* session choice still works */ }
    translateStatic();
    if (typeof root.CustomEvent === 'function') root.dispatchEvent?.(new root.CustomEvent('gym-languagechange', { detail: { locale: next } }));
    return true;
  }

  root.I18n = {
    t, english: key => entries[key]?.en, locale: () => language, localeTag, setLocale, translateStatic,
    number: (value, options) => new Intl.NumberFormat(localeTag(), options).format(value),
    date: (value, options) => new Intl.DateTimeFormat(localeTag(), options).format(new Date(value)),
    plural: value => new Intl.PluralRules(localeTag()).select(value),
    parseNumber(value) {
      const normalized = String(value ?? '').trim().replace(',', '.');
      return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized) ? Number(normalized) : null;
    },
    exercise: name => String(name ?? ''),
    explanation: (_name, fallback) => fallback,
    version: catalogue.version || 'development',
    missingKeys: () => [...missing]
  };
  translateStatic();
})(globalThis);
