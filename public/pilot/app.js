const byOffer = (key) => document.querySelectorAll(`[data-offer="${key}"]`);
let offer = null;

function setText(key, value) {
  for (const element of byOffer(key)) element.textContent = value;
}

function setList(id, values) {
  const list = document.getElementById(id);
  list.replaceChildren(...values.map((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    return item;
  }));
}

function validateOffer(value) {
  const scope = value?.scope;
  const inquiry = new URL(value?.inquiry_url);
  const positive = (number) => Number.isSafeInteger(number) && number > 0;
  const textFields = ['tax_note', 'supported_environment', 'delivery_mode', 'price_status', 'inquiry_privacy_note', 'revision', 'name'];
  if (!positive(value?.price_krw) || !scope || !Object.values(scope).every(positive)
    || !['companies', 'environments', 'part_families', 'max_variants', 'revision_rounds', 'support_days_after_handoff', 'support_hours'].every((key) => positive(scope[key]))
    || !textFields.every((key) => typeof value[key] === 'string' && value[key].length > 0)
    || !['acceptance', 'exclusions'].every((key) => Array.isArray(value[key]) && value[key].length > 0 && value[key].every((item) => typeof item === 'string'))
    || value.repository_url !== 'https://github.com/dooosp/freecad-automation'
    || inquiry.origin !== 'https://github.com' || inquiry.pathname !== '/dooosp/freecad-automation/issues/new'
    || value.proposal_file !== 'assets/pilot-proposal.ko.pdf'
    || value.demo_file !== 'assets/pilot-demo.ko.md') throw new Error('Invalid offer data');
  return value;
}

async function loadOffer() {
  try {
    const response = await fetch('offer.json', { cache: 'no-cache' });
    if (!response.ok) throw new Error('Offer unavailable');
    offer = validateOffer(await response.json());
    const scope = offer.scope;
    setText('price', offer.price_krw.toLocaleString('ko-KR'));
    setText('target', `회사 ${scope.companies}곳 · 실행 환경 ${scope.environments}개`);
    setText('family', `부품군 ${scope.part_families}개`);
    setText('variants', `최대 ${scope.max_variants}개`);
    setText('revisions', `${scope.revision_rounds}회`);
    setText('support', `인계 후 ${scope.support_days_after_handoff}일 안에 총 ${scope.support_hours}시간 원격 지원`);
    for (const key of ['tax_note', 'supported_environment', 'delivery_mode', 'price_status', 'inquiry_privacy_note', 'revision']) setText(key, offer[key]);
    setList('acceptance-list', offer.acceptance);
    setList('exclusion-list', offer.exclusions);
    for (const link of document.querySelectorAll('[data-inquiry]')) link.href = offer.inquiry_url;
    document.documentElement.dataset.offerState = 'loaded';
  } catch {
    document.documentElement.dataset.offerState = 'fallback';
    document.getElementById('offer-load-status').textContent = '최신 제안 데이터를 불러오지 못해 페이지에 포함된 기준을 표시합니다. 제안서와 상담에서 최종 조건을 확인하세요.';
  }
}

const form = document.getElementById('fit-form');
const checks = [...form.querySelectorAll('input[type="checkbox"]')];
const downloadButton = document.getElementById('download-brief');

function updateFit() {
  const count = checks.filter((input) => input.checked).length;
  const complete = count === checks.length;
  document.getElementById('fit-title-result').textContent = complete
    ? '첫 상담에서 작업 범위를 검토할 수 있습니다.'
    : count === 0 ? '조건을 선택해 적합성을 확인하세요.' : `${checks.length}개 중 ${count}개 조건을 확인했습니다.`;
  document.getElementById('fit-detail-result').textContent = complete
    ? '실제 형상과 입력 조합의 지원 여부는 별도 확인합니다. 아래에서 확인서를 받아 상담 준비에 활용하세요.'
    : '선택하지 않은 조건은 상담에서 먼저 확인합니다. 이 확인만으로 계약이나 지원 범위가 확정되지는 않습니다.';
  downloadButton.disabled = count === 0;
}

form.addEventListener('change', updateFit);
form.addEventListener('submit', (event) => event.preventDefault());
downloadButton.addEventListener('click', () => {
  if (!checks.some((input) => input.checked)) return;
  const lines = [
    'FreeCAD Automation 파일럿 사전 확인서',
    `제안 기준: ${offer?.revision || '2026-10-29'}`,
    '이 문서는 상담 준비용이며 계약·견적 확정 또는 기술 검수 결과가 아닙니다.',
    '',
    ...checks.map((input) => `${input.checked ? '[확인]' : '[미확인]'} ${input.value}`),
    '',
    '공개 GitHub 문의에 연락처, 고객명, 도면, 모델, 치수 또는 기밀 자료를 올리지 마세요.',
    '상세 자료 전달 방법과 최종 범위·일정·결제 조건은 별도 합의합니다.',
    '',
    '이 확인서는 브라우저에서 생성되었습니다. 선택 내용은 서버로 전송하거나 저장하지 않았습니다.',
  ];
  const url = URL.createObjectURL(new Blob(['\uFEFF', lines.join('\n')], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'freecad-pilot-fit-check.ko.txt';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

updateFit();
loadOffer();
