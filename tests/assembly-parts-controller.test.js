import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TestElement, installDrawingTestDom } from './helpers/drawing-test-dom.js';
import { setLocale } from '../public/js/i18n/index.js';
import { createAssemblyPartControls } from '../public/js/app/assembly-parts.js';

// The baseline viewer has clickable DIVs only; this regression requires native
// controls and checks their effects on the same mesh/material fields as Three.js.
test('part controls select, hide and restore mesh plus edges without replacing focused controls', (t) => {
  const restore = installDrawingTestDom(); t.after(restore);
  setLocale('en', { persist: false });
  const parts = ['cam', 'follower'].map((id) => ({
    id, label: id, mesh: { visible: true }, edgeLines: { visible: true },
    material: { color: { getHexString: () => '123456' }, emissive: { value: 0, setHex(value) { this.value = value; } } },
  }));
  const state = { selectedPartIndex: -1, edgesVisible: true };
  const saved = {};
  const element = new TestElement();
  const controls = createAssemblyPartControls({ element, sceneState: state, getParts: () => parts, saved });
  controls.build('preview-A');
  const select = element.querySelector('button');
  const visibility = element.querySelector('input');
  assert.equal(select.type, 'button');
  assert.equal(select.textContent, 'cam');
  assert.equal(select.getAttribute('aria-pressed'), 'false');
  assert.equal(visibility.type, 'checkbox');
  assert.equal(visibility.getAttribute('aria-label'), 'Show part: cam');
  select.focus(); select.dispatch('click', {});
  assert.equal(state.selectedPartIndex, 0);
  assert.equal(select.getAttribute('aria-pressed'), 'true');
  assert.equal(document.activeElement, element.querySelector('button'));
  assert.equal(parts[0].material.emissive.value, 0x264f78);
  visibility.focus(); visibility.checked = false; visibility.dispatch('change', {});
  assert.equal(parts[0].mesh.visible, false);
  assert.equal(parts[0].edgeLines.visible, false);
  assert.equal(document.activeElement, element.querySelector('input'));
  controls.select(1);
  assert.equal(parts[0].mesh.visible, false, 'selecting another part does not reveal the hidden part');
  assert.equal(parts[0].material.emissive.value, 0);
  assert.equal(parts[1].material.emissive.value, 0x264f78);
  state.edgesVisible = false; controls.sync();
  visibility.checked = true; visibility.dispatch('change', {});
  assert.equal(parts[0].mesh.visible, true);
  assert.equal(parts[0].edgeLines.visible, false, 'showing a part respects the global edges control');
  state.edgesVisible = true; controls.sync();
  assert.equal(parts[0].edgeLines.visible, true);
  controls.select(1);
  assert.equal(state.selectedPartIndex, -1, 'select button toggles selection off');
});

test('same preview restores selection and hidden parts on locale/route remount; new preview resets them', (t) => {
  const restore = installDrawingTestDom(); t.after(() => { setLocale('en', { persist: false }); restore(); });
  const saved = {};
  function mount(locale, previewId) {
    setLocale(locale, { persist: false });
    const parts = ['cam', 'follower'].map((id) => ({ id, label: id, mesh: { visible: true }, edgeLines: { visible: true }, material: { color: { getHexString: () => '123456' }, emissive: { setHex() {} } } }));
    const sceneState = { selectedPartIndex: -1, edgesVisible: true };
    const element = new TestElement();
    const controls = createAssemblyPartControls({ element, sceneState, getParts: () => parts, saved });
    controls.build(previewId);
    return { controls, element, parts, sceneState };
  }
  const first = mount('en', 'A');
  first.controls.select(0);
  const checkbox = first.element.querySelector('input'); checkbox.checked = false; checkbox.dispatch('change', {});
  const remount = mount('ko', 'A');
  assert.equal(remount.parts[0].mesh.visible, false);
  assert.equal(remount.parts[0].edgeLines.visible, false);
  assert.equal(remount.sceneState.selectedPartIndex, 0);
  assert.equal(remount.element.querySelector('input').checked, false);
  assert.equal(remount.element.querySelector('input').getAttribute('aria-label'), '부품 표시: cam');
  const fresh = mount('ko', 'B');
  assert.equal(fresh.parts[0].mesh.visible, true);
  assert.equal(fresh.parts[0].edgeLines.visible, true);
  assert.equal(fresh.sceneState.selectedPartIndex, -1);
  assert.equal(fresh.element.querySelector('input').checked, true);
});
