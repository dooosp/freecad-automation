export const FALLBACK_LOCALE = 'en';
export const DEFAULT_LOCALE = FALLBACK_LOCALE;
export const SUPPORTED_LOCALES = Object.freeze(['en', 'ko']);
export const LOCALE_COOKIE_NAME = 'ui_locale';
export const LOCALE_COOKIE_SUFFIX = '; Path=/; Max-Age=31536000; SameSite=Lax';

export function normalizeLocale(value) {
  if (typeof value !== 'string') return DEFAULT_LOCALE;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('ko')) return 'ko';
  return DEFAULT_LOCALE;
}

export function parseLocaleCookie(cookieHeader = '') {
  if (typeof cookieHeader !== 'string' || cookieHeader.length === 0) return '';
  const cookie = cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE_NAME}=`));
  if (!cookie) return '';
  return normalizeLocale(cookie.slice(LOCALE_COOKIE_NAME.length + 1));
}

export function resolveInitialLocale({
  cookieHeader = '',
  browserLanguage = '',
  savedLocale = '',
} = {}) {
  return normalizeLocale(savedLocale || parseLocaleCookie(cookieHeader) || browserLanguage || DEFAULT_LOCALE);
}

export function formatLocaleCookie(locale) {
  return `${LOCALE_COOKIE_NAME}=${normalizeLocale(locale)}${LOCALE_COOKIE_SUFFIX}`;
}
