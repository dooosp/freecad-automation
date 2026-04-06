import assert from 'node:assert/strict';

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE_NAME,
  SUPPORTED_LOCALES,
  formatLocaleCookie,
  normalizeLocale,
  parseLocaleCookie,
  resolveInitialLocale,
} from '#i18n-contract';
import {
  createTranslator,
  translateText,
} from '../public/js/i18n/index.js';

assert.equal(DEFAULT_LOCALE, 'en');
assert.deepEqual(SUPPORTED_LOCALES, ['en', 'ko']);
assert.equal(normalizeLocale('en-US'), 'en');
assert.equal(normalizeLocale('ko-KR'), 'ko');
assert.equal(parseLocaleCookie(`${LOCALE_COOKIE_NAME}=ko; Path=/`), 'ko');
assert.equal(resolveInitialLocale({ browserLanguage: 'ko-KR' }), 'ko');
assert.equal(resolveInitialLocale({ savedLocale: 'en' }), 'en');
assert.equal(resolveInitialLocale({
  savedLocale: 'ko',
  cookieHeader: `${LOCALE_COOKIE_NAME}=en`,
  browserLanguage: 'en-US',
}), 'ko');
assert.equal(formatLocaleCookie('ko-KR'), `${LOCALE_COOKIE_NAME}=ko; Path=/; Max-Age=31536000; SameSite=Lax`);

const ko = createTranslator('ko');
assert.equal(ko.t('locale.label'), '언어');
assert.equal(ko.t('index.title'), 'FreeCAD 클래식 뷰어');
assert.equal(ko.t('index.mode.label'), '클래식 호환 모드');
assert.equal(translateText('Jobs center', 'ko'), '작업 센터');
assert.equal(translateText('Console', 'ko'), '콘솔');
assert.equal(translateText('Packs', 'ko'), '패키지');
assert.equal(translateText('Preferred browser review console', 'ko'), '기본 브라우저 검토 콘솔');
assert.equal(
  translateText('Review-first launchpad for ingest, packs, compare, and reopen actions.', 'ko'),
  '입력, 패키지, 비교, 재열기 작업을 위한 검토 우선 시작 화면입니다.'
);
assert.equal(
  translateText('Use the Packs workspace to reopen tracked review packs, readiness reports, and release bundles. Local file import is not available on this path yet.', 'ko'),
  '패키지 작업 영역에서 추적된 검토 패키지, 준비 상태 보고서, 릴리스 번들을 다시 열 수 있습니다. 이 경로에서는 아직 로컬 파일 가져오기를 지원하지 않습니다.'
);
assert.equal(translateText('Open compare workspace', 'ko'), '비교 작업 영역 열기');
assert.equal(translateText('3 recent jobs', 'ko'), '3개의 최근 작업');
assert.equal(translateText('Select example', 'ko'), '예제 선택');
assert.equal(translateText('Recent jobs loading', 'ko'), '최근 작업 불러오는 중');
assert.equal(translateText('Choose your first supported step', 'ko'), '처음 시작할 현재 지원 경로를 선택하세요');
assert.equal(
  translateText('Preview routes stay local to this workspace and do not create tracked `/jobs` history.', 'ko'),
  '미리보기 경로는 현재 작업 영역 안에서만 동작하며 추적 `/jobs` 기록을 만들지 않습니다.'
);
assert.equal(translateText('Classic compatibility route', 'ko'), '클래식 호환 경로');
assert.equal(translateText('Jump between runs', 'ko'), '실행 간 이동');
assert.equal(translateText('Artifact trail and manifests', 'ko'), '산출물 흐름 및 매니페스트');
assert.equal(
  translateText('Tracked outputs need a dedicated surface so job history and artifact provenance do not get buried under entry controls.', 'ko'),
  '추적 산출물은 작업 이력과 산출물 출처 정보가 시작 제어 아래 묻히지 않도록 전용 작업 영역이 필요합니다.'
);
assert.equal(translateText('Manifest-first layout', 'ko'), '매니페스트 우선 레이아웃');
assert.equal(translateText('Active job', 'ko'), '활성 작업');
assert.equal(translateText('Select a recent job', 'ko'), '최근 작업 선택');
assert.equal(
  translateText('The Start workspace recent-jobs list is the intended entry point into artifacts.', 'ko'),
  'Start 작업 영역의 최근 작업 목록은 산출물로 들어가는 기본 진입점입니다.'
);
assert.equal(
  translateText('Drawing plan, SVG canvas, BOM, and dimension loop staging.', 'ko'),
  '도면 계획, SVG 캔버스, BOM, 치수 반복 작업을 다룹니다.'
);
assert.equal(
  translateText('Drawing previews and tracked sheet runs use the same runtime and job model as the rest of Studio.', 'ko'),
  '도면 미리보기와 추적 시트 실행은 Studio의 다른 작업과 같은 런타임 및 작업 모델을 사용합니다.'
);
assert.equal(translateText('Project root unavailable', 'ko'), '프로젝트 루트를 사용할 수 없음');
assert.equal(translateText('Not checked yet', 'ko'), '아직 확인하지 않음');
assert.equal(
  translateText('Generate drawing to open the sheet-first workbench.', 'ko'),
  '시트 중심 작업 영역을 열려면 도면을 생성하세요.'
);
assert.equal(translateText('Local API connected', 'ko'), '로컬 API 연결됨');
assert.equal(translateText('Local API degraded', 'ko'), '로컬 API 성능 저하');
assert.equal(translateText('Legacy shell fallback', 'ko'), '레거시 셸 대체 경로');
assert.equal(translateText('Shell-only mode', 'ko'), '셸 전용 모드');
assert.equal(translateText('Runtime diagnostics available.', 'ko'), '런타임 진단을 확인할 수 있습니다.');
assert.equal(translateText('Runtime check required', 'ko'), '런타임 확인 필요');
assert.equal(translateText('Runtime unavailable on legacy path', 'ko'), '레거시 경로에서는 런타임을 사용할 수 없음');
assert.equal(translateText('Runtime status pending', 'ko'), '런타임 상태 확인 대기 중');
assert.equal(
  translateText('No jobs have been tracked yet on this local API instance.', 'ko'),
  '이 로컬 API 인스턴스에는 아직 추적된 작업이 없습니다.'
);
assert.equal(
  translateText('No tracked job is selected or monitored.', 'ko'),
  '선택되거나 모니터링 중인 추적 작업이 없습니다.'
);
assert.equal(
  translateText('Recent jobs require the local API path from `fcad serve`.', 'ko'),
  '최근 작업을 보려면 로컬 API 경로의 `fcad serve`를 사용해야 합니다.'
);
assert.equal(
  translateText('Recent job history requires the local API path from `fcad serve`.', 'ko'),
  '최근 작업 기록을 보려면 로컬 API 경로의 `fcad serve`를 사용해야 합니다.'
);
assert.equal(translateText('3 recent jobs visible', 'ko'), '최근 작업 3개 표시됨');
assert.equal(translateText('Connection local api', 'ko'), '연결 로컬 API');
assert.equal(translateText('Connection legacy shell', 'ko'), '연결 레거시 셸');
assert.equal(translateText('Connection shell only', 'ko'), '연결 셸 전용');
assert.equal(translateText('Runtime legacy-only', 'ko'), '런타임 레거시 전용');
assert.equal(translateText('Updated Mar 29, 10:10:10', 'ko'), '업데이트 Mar 29, 10:10:10');
assert.equal(
  translateText('Run `fcad serve` to expose `/jobs` and artifact history for the new studio shell.', 'ko'),
  '새 스튜디오 셸에서 `/jobs`와 산출물 이력을 보려면 `fcad serve`를 실행하세요.'
);
assert.equal(
  translateText('Legacy shell detected. Examples still load, but runtime health and tracked jobs require the local API path from `fcad serve`.', 'ko'),
  '레거시 셸이 감지되었습니다. 예제는 계속 불러올 수 있지만 런타임 상태와 추적 작업에는 `fcad serve`의 로컬 API 경로가 필요합니다.'
);
assert.equal(
  translateText('Keep the most recent jobs close so the artifact trail stays fast to navigate.', 'ko'),
  '가장 최근 작업을 가까이에 두어 산출물 흐름을 빠르게 따라갈 수 있게 합니다.'
);
assert.equal(translateText('Recent job shortcuts', 'ko'), '최근 작업 바로가기');
assert.equal(translateText('Tracked outputs', 'ko'), '추적 산출물');
assert.equal(translateText('Why this workspace exists', 'ko'), '이 작업 영역이 필요한 이유');
assert.equal(translateText('No silent downloads', 'ko'), '자동 다운로드 없음');
assert.equal(
  translateText('Use Start to choose a recent job and route here.', 'ko'),
  '시작에서 최근 작업을 선택해 여기로 오세요.'
);
assert.equal(
  translateText('Once jobs exist on the local API path, they will appear here automatically.', 'ko'),
  '로컬 API 경로에 작업이 생기면 여기에 자동으로 나타납니다.'
);
assert.equal(
  translateText('Artifact and manifest views can deepen later without changing how Start routes users back into work.', 'ko'),
  '산출물과 매니페스트 보기는 나중에 더 확장하더라도 Start가 사용자를 작업으로 되돌리는 방식은 바꾸지 않습니다.'
);
assert.equal(translateText('Unknown job', 'ko'), '알 수 없는 작업');
assert.equal(translateText('Unavailable on this serve path', 'ko'), '현재 serve 경로에서는 사용할 수 없음');
assert.equal(
  translateText('1 queued or running job currently monitored from this shell session.', 'ko'),
  '이 셸 세션에서 현재 대기 또는 실행 상태로 모니터링 중인 작업은 1개입니다.'
);
assert.equal(
  translateText('2 queued or running jobs currently monitored from this shell session.', 'ko'),
  '이 셸 세션에서 현재 대기 또는 실행 상태로 모니터링 중인 작업은 2개입니다.'
);
assert.equal(
  translateText('2 queued or running review-console jobs currently monitored from this shell session.', 'ko'),
  '이 셸 세션에서 현재 대기 또는 실행 상태로 모니터링 중인 검토 콘솔 작업은 2개입니다.'
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
