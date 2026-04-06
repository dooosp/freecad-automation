import en from './en.js';
import ko from './ko.js';
import {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  formatLocaleCookie,
  LOCALE_COOKIE_NAME,
  normalizeLocale,
  parseLocaleCookie,
  resolveInitialLocale,
  SUPPORTED_LOCALES,
} from '#i18n-contract';

export {
  DEFAULT_LOCALE,
  FALLBACK_LOCALE,
  formatLocaleCookie,
  LOCALE_COOKIE_NAME,
  normalizeLocale,
  parseLocaleCookie,
  resolveInitialLocale,
  SUPPORTED_LOCALES,
} from '#i18n-contract';

const DICTIONARIES = {
  en,
  ko,
};

const TEXT_NODE_ORIGINALS = new WeakMap();
const ATTRIBUTE_ORIGINALS = new WeakMap();
const listeners = new Set();

let currentLocale = DEFAULT_LOCALE;

function readPath(object, dottedPath) {
  if (object && typeof object === 'object' && dottedPath in object) {
    return object[dottedPath];
  }
  return String(dottedPath || '')
    .split('.')
    .filter(Boolean)
    .reduce((value, key) => (value && typeof value === 'object' ? value[key] : undefined), object);
}

function interpolate(template, params = {}) {
  return String(template).replace(/\{(\w+)\}/g, (match, key) => (
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match
  ));
}

function localeDictionary(locale = DEFAULT_LOCALE) {
  return DICTIONARIES[normalizeLocale(locale)] || en;
}

export function localeLabel(locale) {
  return localeDictionary(locale).localeName || locale;
}

export function t(key, params = {}, locale = currentLocale) {
  const dictionary = localeDictionary(locale);
  const template = readPath(dictionary.messages, key)
    ?? readPath(en.messages, key)
    ?? key;
  return interpolate(template, params);
}

export function translateText(text, locale = currentLocale) {
  if (text == null) return text;
  const raw = String(text);
  const trimmed = raw.trim();
  if (!trimmed) return raw;

  const dictionary = localeDictionary(locale);
  const phrase = dictionary.phrases?.[trimmed] ?? en.phrases?.[trimmed];
  if (phrase) {
    return raw.replace(trimmed, phrase);
  }

  for (const rule of dictionary.patterns || []) {
    const match = trimmed.match(rule.regex);
    if (match) {
      const translated = typeof rule.replace === 'function'
        ? rule.replace(...match)
        : trimmed.replace(rule.regex, rule.replace);
      return raw.replace(trimmed, translated);
    }
  }

  return raw;
}

export function translateAttributeValue(value, locale = currentLocale) {
  return translateText(value, locale);
}

export function createTranslator(locale = currentLocale) {
  return {
    locale: normalizeLocale(locale),
    t(key, params = {}) {
      return t(key, params, locale);
    },
    text(value) {
      return translateText(value, locale);
    },
  };
}

function browserSavedLocale() {
  if (typeof document === 'undefined') return '';
  return parseLocaleCookie(document.cookie || '');
}

function browserLanguage() {
  if (typeof navigator === 'undefined') return '';
  return navigator.language || navigator.languages?.[0] || '';
}

function mirrorLocaleToStorage(locale) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCALE_COOKIE_NAME, locale);
  } catch {}
}

function writeLocaleCookie(locale) {
  if (typeof document === 'undefined') return;
  document.cookie = formatLocaleCookie(locale);
}

function applyLocaleMetadata(locale) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = normalizeLocale(locale);
  document.documentElement.dataset.uiLocale = normalizeLocale(locale);
}

export function getLocale() {
  return currentLocale;
}

export function setLocale(locale, { persist = true } = {}) {
  const nextLocale = normalizeLocale(locale);
  currentLocale = nextLocale;
  applyLocaleMetadata(nextLocale);
  if (persist) {
    writeLocaleCookie(nextLocale);
    mirrorLocaleToStorage(nextLocale);
  }
  listeners.forEach((listener) => listener(nextLocale));
  return nextLocale;
}

export function initializeLocale() {
  const initial = resolveInitialLocale({
    savedLocale: browserSavedLocale(),
    browserLanguage: browserLanguage(),
  });
  currentLocale = initial;
  applyLocaleMetadata(initial);
  writeLocaleCookie(initial);
  mirrorLocaleToStorage(initial);
  return initial;
}

export function subscribeLocale(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bindLocaleControls(root = document) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('[data-locale-select]').forEach((control) => {
    control.value = currentLocale;
    if (control.dataset.localeBound === 'true') return;
    control.dataset.localeBound = 'true';
    control.addEventListener('change', (event) => {
      setLocale(event.currentTarget.value);
    });
  });
}

function applyDataDrivenTranslations(root = document) {
  if (!root?.querySelectorAll) return;

  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  });
  root.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.setAttribute('title', t(element.dataset.i18nTitle));
  });
  root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
}

function shouldSkipTextNode(node) {
  const parent = node.parentElement;
  if (!parent) return true;
  if (parent.closest('[data-i18n-preserve="true"]')) return true;
  return ['CODE', 'PRE', 'SCRIPT', 'STYLE'].includes(parent.tagName);
}

export function applyTranslations(root = document.body) {
  if (!root || typeof document === 'undefined') return;

  applyLocaleMetadata(currentLocale);
  applyDataDrivenTranslations(root);
  bindLocaleControls(root);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (!shouldSkipTextNode(node)) {
      if (!TEXT_NODE_ORIGINALS.has(node)) {
        TEXT_NODE_ORIGINALS.set(node, node.nodeValue);
      }
      node.nodeValue = translateText(TEXT_NODE_ORIGINALS.get(node), currentLocale);
    }
    node = walker.nextNode();
  }

  root.querySelectorAll('*').forEach((element) => {
    if (!ATTRIBUTE_ORIGINALS.has(element)) {
      ATTRIBUTE_ORIGINALS.set(element, {});
    }
    const originals = ATTRIBUTE_ORIGINALS.get(element);
    ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value == null) return;
      if (!(attribute in originals)) {
        originals[attribute] = value;
      }
      element.setAttribute(attribute, translateAttributeValue(originals[attribute], currentLocale));
    });
  });
}
