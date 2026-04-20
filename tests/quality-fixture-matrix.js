const QUALITY_FIXTURE_MATRIX = Object.freeze([
  Object.freeze({
    id: 'quality_pass_bracket',
    configPath: 'configs/examples/quality_pass_bracket.toml',
    purpose: 'strict-pass happy path for create, draw, DFM, and report readiness',
    strictCreate: Object.freeze({
      expectedExit: 0,
      qualityStatus: 'pass',
    }),
    strictDraw: Object.freeze({
      expectedExit: 0,
      qualityStatus: 'pass',
    }),
    dfm: Object.freeze({
      expectedExit: 0,
      expectedScore: 100,
      status: 'pass',
    }),
    report: Object.freeze({
      overallStatus: 'pass',
      readyForManufacturingReview: true,
    }),
  }),
  Object.freeze({
    id: 'ks_bracket',
    configPath: 'configs/examples/ks_bracket.toml',
    purpose: 'intentional blocker-rich expected-fail demo for quality gate regression coverage',
    strictCreate: Object.freeze({
      expectedExit: 'nonzero',
      qualityStatus: 'fail',
    }),
    strictDraw: Object.freeze({
      expectedExit: 'nonzero',
      qualityStatus: 'fail',
    }),
    dfm: Object.freeze({
      expectedExit: 'nonzero',
      expectedScore: 70,
      status: 'fail',
    }),
    report: Object.freeze({
      overallStatus: 'fail',
      readyForManufacturingReview: false,
    }),
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getQualityFixtureMatrix() {
  return clone(QUALITY_FIXTURE_MATRIX);
}

export function getQualityFixtureExpectation(id) {
  const fixture = QUALITY_FIXTURE_MATRIX.find((entry) => entry.id === id);
  return fixture ? clone(fixture) : null;
}

export function createQualityFixtureSmokeMatrix() {
  return getQualityFixtureMatrix().map((fixture) => ({
    ...fixture,
    observed: {
      createQualityStatus: null,
      strictCreateExit: null,
      drawingQualityStatus: null,
      strictDrawExit: null,
      dfmExit: null,
      dfmScore: null,
      reportOverallStatus: null,
      reportReadyForManufacturingReview: null,
    },
  }));
}

export function getQualityFixtureSmokeRecord(records, id) {
  return records.find((record) => record.id === id) || null;
}
