import assert from 'node:assert/strict';

import {
  LOCALE_COOKIE_NAME,
  createTranslator,
  normalizeLocale,
  parseLocaleCookie,
  resolveInitialLocale,
  translateText,
} from '../public/js/i18n/index.js';

assert.equal(normalizeLocale('en-US'), 'en');
assert.equal(normalizeLocale('ko-KR'), 'ko');
assert.equal(parseLocaleCookie(`${LOCALE_COOKIE_NAME}=ko; Path=/`), 'ko');
assert.equal(resolveInitialLocale({ browserLanguage: 'ko-KR' }), 'ko');
assert.equal(resolveInitialLocale({ savedLocale: 'en' }), 'en');

const ko = createTranslator('ko');
assert.equal(ko.t('locale.label'), '언어');
assert.equal(translateText('Jobs center', 'ko'), '작업 센터');
assert.equal(translateText('3 recent jobs', 'ko'), '3개의 최근 작업');

console.log('browser-i18n.test.js: ok');
