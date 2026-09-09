import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExtractedDrawingSemantics, compareDrawingIntentToExtractedSemantics,
  validateExtractedDrawingSemantics } from '../src/services/drawing/extracted-drawing-semantics.js';
import { buildDrawingQualitySummary } from '../src/services/drawing/drawing-quality-summary.js';

const processNote = { id: 'PROCESS', text: 'Process: machining', required: true };
const intent = { enforceable: true, required_notes: [processNote] };
const extract = (body, drawingIntent = intent) => buildExtractedDrawingSemantics({
  drawingSvgPath: '/tmp/note-unit.svg', svgContent: `<svg>${body}</svg>`, drawingIntent });
const label = (text = 'Process: machining', id = 'PROCESS') => `<text data-note-id="${id}">${text}</text>`;
const quality = (body, drawingIntent = intent, sidecar = null) => buildDrawingQualitySummary({
  drawingSvgPath: '/tmp/note-unit.svg', svgContent: `<svg>${body}</svg>`, drawingIntent,
  extractedDrawingSemantics: sidecar });

for (const [name, body] of [
  ['ID only', '<text>PROCESS</text>'],
  ['wrong process', '<text>Process: casting</text>'],
  ['negated instruction', '<text>Do not use Process: machining</text>'],
  ['hidden parent', `<g display="none">${label()}</g>`],
  ['transparent paint', label().replace('<text ', '<text fill="none" ')],
  ['comment', `<!-- ${label()} -->`],
  ['definition', `<defs>${label()}</defs>`],
  ['wrong explicit ID', label('Process: machining', 'OTHER')],
  ['conflicting ID', label()+label('Process: casting')],
  ['duplicate ID attribute', label().replace('data-note-id="PROCESS"', 'data-note-id="OTHER" data-note-id="PROCESS"')],
]) test(`required note rejects ${name}`, () => {
  const semantics = extract(body);
  assert.equal(semantics.coverage.required_notes_extracted, 0);
  const summary = quality(body, intent, extract(label()));
  assert.equal(summary.semantic_quality.required_notes_present, 0);
  assert.equal(summary.semantic_quality.extracted_evidence.coverage.required_notes.extracted, 0);
});

test('visible body and equivalent duplicate count once', () => {
  const semantics = extract(label()+label());
  assert.equal(validateExtractedDrawingSemantics(semantics).ok, true);
  assert.equal(semantics.coverage.required_notes_extracted, 1);
  assert.equal(quality(label()+label()).semantic_quality.required_notes_present, 1);
});

for (const body of ['', '<text>irrelevant</text>']) test(`current SVG defeats stale note claim: ${body || 'empty'}`, () => {
  const summary = quality(body, intent, extract(label()));
  assert.equal(summary.semantic_quality.required_notes_present, 0);
  assert.equal(summary.semantic_quality.extracted_evidence.coverage.required_notes.extracted, 0);
});

test('comparison checks content again instead of trusting old matched ID', () => {
  const semantics = extract(label()); semantics.notes[0].raw_text = 'Process: casting';
  assert.equal(compareDrawingIntentToExtractedSemantics(intent, semantics).coverage.required_notes.extracted, 0);
});

test('wrapped note joins only its own visible group and preserves Unicode', () => {
  const drawingIntent = { required_notes: [{ id:'TRACE', text:'로트 추적: opposite connector slot.', required:true }] };
  const body = '<g class="general-notes"><text data-note-index="1">1. 로트 추적: opposite</text><text data-note-index="1">connector slot.</text></g>';
  assert.equal(extract(body, drawingIntent).coverage.required_notes_extracted, 1);
  for (const bad of [body.replace('>connector', ' display="none">connector'),
    body.replace('>connector', ' data-note-id="OTHER">connector'),
    body.replace('</text><text', '</text></g><g class="general-notes"><text')]) {
    assert.equal(extract(bad, drawingIntent).coverage.required_notes_extracted, 0);
  }
});

for (const [id, text, body] of [
  ['MATERIAL','Material: AL6061','<text>MATERIAL</text>'],
  ['MATERIAL','Material: AL6061','<text>Material: SS400</text>'],
  ['MATERIAL','Material: AL6061','<g visibility="hidden"><text x="10" y="10">MATERIAL</text><text x="10" y="15">AL6061</text></g>'],
  ['GENERAL_TOLERANCE','General tolerance: ±0.1','<text>General tolerance: ±0.5</text>'],
]) test(`note value required: ${body}`, () => {
  const drawingIntent = { required_notes:[{id,text,required:true}] };
  assert.equal(extract(body,drawingIntent).coverage.required_notes_extracted,0);
  assert.equal(quality(body,drawingIntent).semantic_quality.required_notes_present,0);
});

for (const [id,text,body] of [
  ['MATERIAL','Material: AL6061','<text>Do not use Material: AL6061</text>'],
  ['MATERIAL','Material: AL6061','<text>Material: SS304, not AL6061</text>'],
  ['MATERIAL','Material: AL6061','<text x="10" y="10">MATERIAL</text><text x="10" y="15">Not AL6061</text>'],
  ['GENERAL_TOLERANCE','General tolerance: ±0.1','<text>Do not use TOL ±0.1</text>'],
  ['GENERAL_TOLERANCE','General tolerance: ±0.1','<text>TOL ±0.1 and ±0.5</text>'],
  ...[
    '<text x="10" y="10" data-note-id="OTHER">MATERIAL</text><text x="10" y="15">AL6061</text>',
    '<text x="10" y="10">MATERIAL</text><text x="10" y="15" data-note-id="OTHER">AL6061</text>',
    '<g data-note-id="OTHER"><text x="10" y="10">MATERIAL</text><text x="10" y="15">AL6061</text></g>',
    '<text x="10" y="10">MATERIAL</text><text x="10" y="15">AL6061</text><text data-note-id="MATERIAL">Material: SS304</text>',
  ].map(body => ['MATERIAL','Material: AL6061',body]),
]) test(`aliases and material pairs cannot bypass note meaning: ${body}`, () => {
  const drawingIntent={enforceable:true,required_notes:[{id,text,required:true}]};
  assert.equal(extract(body,drawingIntent).coverage.required_notes_extracted,0);
  const summary=quality(body,drawingIntent);
  assert.equal(summary.semantic_quality.required_notes_present,0);
  assert.notEqual(summary.semantic_quality.decision,'pass');
});

for (const body of [
  '<text x="10" y="10">MATERIAL</text><text x="10" y="15" data-note-id="MATERIAL">AL6061</text>',
  '<g data-note-id="MATERIAL"><text x="10" y="10">MATERIAL</text><text x="10" y="15">AL6061</text></g>',
]) test(`material pair retains compatible explicit identity: ${body}`, () => {
  const drawingIntent = {required_notes:[{id:'MATERIAL',text:'Material: AL6061',required:true}]};
  assert.equal(extract(body,drawingIntent).coverage.required_notes_extracted,1);
  assert.equal(quality(body,drawingIntent).semantic_quality.required_notes_present,1);
});

for (const note of [
  {id:'MATERIAL',text:'Material: AL6061',label:'Material: SS304',wrong:'MATL: SS304'},
  {id:'GENERAL_TOLERANCE',text:'General tolerance: ±0.1',label:'General tolerance: ±0.5',wrong:'TOL ±0.5'},
]) test(`display label cannot override authored note value: ${note.id}`, () => {
  const drawingIntent={required_notes:[{...note,required:true}]};
  assert.equal(extract(`<text>${note.wrong}</text>`,drawingIntent).coverage.required_notes_extracted,0);
});

for (const [id, text, lines] of [
  ['PROCESS', 'Process: machining', ['Not for AL6061', 'Process: machining']],
  ['MATERIAL', 'Material: AL6061', ['AL6061', 'is prohibited']],
]) test(`material pairing preserves every line of a logical note: ${id}`, () => {
  const drawingIntent = { enforceable: true, required_notes: [{ id, text, required: true }] };
  const body = '<g class="general-notes"><text x="10" y="10">MATERIAL</text>'
    + lines.map((line, index) => `<text data-note-index="1" x="10" y="${15 + index * 5}">${line}</text>`).join('')
    + '</g>';
  const semantics = extract(body, drawingIntent);
  assert.equal(semantics.coverage.required_notes_extracted, 0);
  const logicalNote = semantics.notes.find(note => note.raw_text === lines.join(' '));
  assert.equal(logicalNote?.provenance.svg_text_ids.length, 2);
  const summary = quality(body, drawingIntent);
  assert.equal(summary.semantic_quality.required_notes_present, 0);
  assert.equal(summary.semantic_quality.extracted_evidence.coverage.required_notes.extracted, 0);
  assert.notEqual(summary.semantic_quality.decision, 'pass');
});
