import { createAdvancedMotionCases } from './advanced-motion-cases.js';
import { createAnalysisCases } from './analysis-cases.js';
import { createDrawingCases } from './drawing-cases.js';
import { createIntegrationCases } from './integration-cases.js';
import { createModelCases } from './model-cases.js';
import { createReportCases } from './report-cases.js';
import { createRuntimeCases } from './runtime-cases.js';

export function createCaseRegistry(assert) {
  return new Map([
    ...createRuntimeCases(assert),
    ...createModelCases(assert),
    ...createDrawingCases(assert),
    ...createAnalysisCases(assert),
    ...createReportCases(assert),
    ...createIntegrationCases(assert),
    ...createAdvancedMotionCases(assert),
  ]);
}
