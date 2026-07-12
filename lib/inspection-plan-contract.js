import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const schema = JSON.parse(readFileSync(new URL('../schemas/inspection_plan.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false, strictNumbers: true, validateFormats: false }).compile(schema);

export const INSPECTION_PLAN_SCHEMA_VERSION = '1.0';
export const INSPECTION_PLAN_AUTHORITY_LEVELS = Object.freeze([
  'authoritative_released_requirement', 'explicit_review_requirement', 'revision_impact_requirement', 'advisory_generated_context', 'unresolved',
]);

export function validateInspectionPlan(plan) {
  const errors = [];
  if (!validate(plan)) errors.push(...(validate.errors || []).map((entry) => `${entry.instancePath || '/'} ${entry.message}`));
  const ids = new Set();
  const pairs = new Set();
  for (const item of plan?.items || []) {
    if (ids.has(item.plan_item_id)) errors.push(`duplicate plan_item_id: ${item.plan_item_id}`);
    ids.add(item.plan_item_id);
    const pair = `${item.characteristic_id}\0${item.plan_item_id}`;
    if (pairs.has(pair)) errors.push(`duplicate characteristic/plan item pair: ${item.characteristic_id}`);
    pairs.add(pair);
    for (const value of [item.nominal_value, item.lower_limit, item.upper_limit]) {
      if (value !== null && !Number.isFinite(value)) errors.push(`${item.plan_item_id} contains a non-finite number`);
    }
    if (item.lower_limit !== null && item.upper_limit !== null && item.lower_limit > item.upper_limit) errors.push(`${item.plan_item_id} lower_limit exceeds upper_limit`);
  }
  return { ok: errors.length === 0, errors };
}

export function assertValidInspectionPlan(plan) {
  const result = validateInspectionPlan(plan);
  if (!result.ok) throw new Error(`Inspection plan validation failed: ${result.errors.join(' | ')}`);
  return plan;
}

export function canonicalizeInspectionPlan(plan) {
  return `${JSON.stringify(plan, null, 2)}\n`;
}
