import assert from 'node:assert/strict';

import {
  buildArtifactDetailItems,
  buildArtifactDetailNotes,
} from '../public/js/studio/artifact-insights.js';
import {
  getSelectedStudioExample,
  getStudioExampleValue,
  resolveSelectedStudioExampleId,
} from '../public/js/studio/examples.js';

const examples = [
  {
    id: 'ks_bracket',
    name: 'ks_bracket.toml',
    content: 'name = "ks_bracket"',
  },
  {
    id: 'controller_housing',
    name: 'controller_housing.toml',
    content: 'name = "controller_housing"',
  },
];

assert.equal(getStudioExampleValue(examples[0]), 'ks_bracket');
assert.equal(resolveSelectedStudioExampleId(examples, 'controller_housing'), 'controller_housing');
assert.equal(resolveSelectedStudioExampleId(examples, 'missing-example'), 'ks_bracket');
assert.equal(
  getSelectedStudioExample({
    items: examples,
    selectedId: 'controller_housing',
  })?.name,
  'controller_housing.toml'
);

const activeJob = {
  summary: {
    request: {
      source_label: 'Effective config copy',
    },
  },
  manifest: {
    warnings: [
      'Manifest warning one',
      'Manifest warning two',
    ],
  },
};

const artifact = {
  id: 'artifact-effective-config',
  key: 'effective_config',
  type: 'config.effective',
  file_name: 'effective-config.json',
  extension: '.json',
  content_type: 'application/json',
  exists: true,
  size_bytes: 4096,
  scope: 'user-facing',
  stability: 'stable',
  capabilities: {
    can_open: true,
    can_download: true,
    browser_safe: true,
  },
  links: {
    open: '/artifacts/job-1/artifact-effective-config',
    download: '/artifacts/job-1/artifact-effective-config/download',
  },
};

const detailItems = buildArtifactDetailItems(artifact, activeJob);
const detailMap = Object.fromEntries(detailItems.map((item) => [item.label, item]));

assert.equal(detailMap['File name'].value, 'effective-config.json');
assert.equal(detailMap['Content type'].value, 'application/json');
assert.equal(detailMap['Exists / size'].value, 'Available • 4.0 KB');
assert.equal(detailMap['Scope / stability'].value, 'user-facing • stable');
assert.equal(detailMap['Open route'].value, 'Available');
assert.equal(detailMap['Download route'].value, 'Available');
assert.equal(detailMap['Tracked source'].value, 'Effective config copy');
assert.equal(detailItems.some((item) => item.label === 'Path'), false);
assert.equal(JSON.stringify(detailItems).includes('/Users/'), false);

const detailNotes = buildArtifactDetailNotes(artifact, activeJob);
assert.deepEqual(detailNotes, [
  'Artifact ID: artifact-effective-config',
  'Tracked source label: Effective config copy',
  'Manifest warning one',
  'Manifest warning two',
]);

console.log('studio-public-contract.test.js: ok');
