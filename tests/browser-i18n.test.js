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
assert.equal(translateText('Select example', 'ko'), '예제 선택');
assert.equal(translateText('Recent jobs loading', 'ko'), '최근 작업 불러오는 중');
assert.equal(translateText('Project root unavailable', 'ko'), '프로젝트 루트를 사용할 수 없음');
assert.equal(translateText('Not checked yet', 'ko'), '아직 확인하지 않음');
assert.equal(translateText('Local API connected', 'ko'), '로컬 API 연결됨');
assert.equal(translateText('Local API degraded', 'ko'), '로컬 API 성능 저하');
assert.equal(translateText('Legacy shell fallback', 'ko'), '레거시 셸 대체 경로');
assert.equal(translateText('Shell-only mode', 'ko'), '셸 전용 모드');
assert.equal(translateText('Runtime check required', 'ko'), '런타임 확인 필요');
assert.equal(translateText('Runtime unavailable on legacy path', 'ko'), '레거시 경로에서는 런타임을 사용할 수 없음');
assert.equal(translateText('Runtime status pending', 'ko'), '런타임 상태 확인 대기 중');
assert.equal(
  translateText('No tracked job is selected or monitored.', 'ko'),
  '선택되거나 모니터링 중인 추적 작업이 없습니다.'
);
assert.equal(
  translateText('Recent jobs require the local API path from `fcad serve`.', 'ko'),
  '최근 작업을 보려면 로컬 API 경로의 `fcad serve`를 사용해야 합니다.'
);
assert.equal(
  translateText('1 queued or running job currently monitored from this shell session.', 'ko'),
  '이 셸 세션에서 현재 대기 또는 실행 상태로 모니터링 중인 작업은 1개입니다.'
);
assert.equal(
  translateText('2 queued or running jobs currently monitored from this shell session.', 'ko'),
  '이 셸 세션에서 현재 대기 또는 실행 상태로 모니터링 중인 작업은 2개입니다.'
);
assert.equal(
  translateText('Latest tracked job create queued.', 'ko'),
  '최신 추적 작업: 생성 대기 중.'
);
assert.equal(translateText('1 running', 'ko'), '실행 중 1개');
assert.equal(translateText('1 queued', 'ko'), '대기 중 1개');
assert.equal(translateText('Last poll Mar 29, 10:10:10.', 'ko'), '마지막 확인 Mar 29, 10:10:10.');
assert.equal(translateText('Missing • Unknown size', 'ko'), '누락됨 • 크기 알 수 없음');
assert.equal(translateText('unknown • stable', 'ko'), '알 수 없음 • 안정적');
assert.equal(translateText('Not available', 'ko'), '사용할 수 없음');
assert.equal(translateText('Size unavailable', 'ko'), '크기를 사용할 수 없음');

console.log('browser-i18n.test.js: ok');
