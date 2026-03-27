import assert from 'node:assert/strict';
import { resolve } from 'node:path';

import {
  DEFAULT_RULE_PROFILE,
  getSelectedRuleProfileName,
  loadRuleProfile,
  resolveMaterialProfile,
} from '../src/services/config/rule-profile-service.js';

const ROOT = resolve(import.meta.dirname, '..');

assert.equal(getSelectedRuleProfileName({}), DEFAULT_RULE_PROFILE);
assert.equal(getSelectedRuleProfileName({ standards: { profile: 'iso-basic' } }), 'iso-basic');

const ksProfile = await loadRuleProfile(ROOT, {});
assert.equal(ksProfile.id, 'ks-basic');
assert.equal(ksProfile.selection.reason, 'requested');
assert.equal(ksProfile.processes.dfm_constraints.machining.hole_edge_factor, 1.0);

const isoProfile = await loadRuleProfile(ROOT, { standards: { profile: 'iso-basic' } });
assert.equal(isoProfile.id, 'iso-basic');
assert.equal(isoProfile.standards.default_standard, 'ISO');
assert.equal(isoProfile.processes.dfm_constraints.machining.hole_edge_factor, 1.5);

const fallbackProfile = await loadRuleProfile(ROOT, { standards: { profile: 'missing-profile' } });
assert.equal(fallbackProfile.id, DEFAULT_RULE_PROFILE);
assert.equal(fallbackProfile.selection.reason, 'fallback');

const materialProfile = resolveMaterialProfile(ksProfile, 'al6061-t6');
assert.equal(materialProfile.name, 'AL6061-T6');
assert.equal(materialProfile.family, 'aluminum');

console.log('rule-profile-service.test.js: ok');
