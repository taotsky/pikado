import { suite } from '../harness.js';
import '../../src/filters/blur.js';
import '../../src/tools/shape.js';
import '../../src/commands/definitions.js';
import { buildForm } from '../../src/ui/dialog.js';
import { getFilter } from '../../src/filters/registry.js';
import { getTool } from '../../src/tools/base.js';
import { getCommand, labelOf } from '../../src/commands/registry.js';
import { showLayerStyleDialog } from '../../src/effects/styles-dialog.js';

suite('i18n features / translated filter controls keep original parameter values', (t) => {
  const filter = getFilter('radial-blur');
  const state = { ...filter.defaults };
  const changed = [];
  const form = buildForm(filter.params, state, (key, value) => changed.push([key, value]));
  t.eq(filter.name, 'Radial Blur...', 'saved filter metadata stays English');
  t.ok(form.node.textContent.includes('模糊方法'), 'parameter heading is translated');
  const method = filter.params.find((p) => p.key === 'method');
  t.eq(method.options.map((option) => option.value), ['spin', 'zoom'], 'radio values remain stable');
  const quality = form.node.querySelector('select');
  t.eq([...quality.options].map((option) => option.textContent), ['草稿', '良好', '最佳'], 'visible options are Chinese');
  quality.value = 'best';
  quality.dispatchEvent(new Event('change'));
  t.eq(changed.at(-1), ['quality', 'best'], 'control writes the original business value');
  const shape = getTool('custom-shape').options.find((p) => p.key === 'shape');
  t.ok(shape.options.some((option) => option.value === 'triangle' && option.label === '三角形'), 'custom shape translation preserves its ID');
});

suite('i18n features / command labels preserve user file names and saved history', (t) => {
  const doc = t.doc(8, 8, '#ffffff');
  t.eq(getCommand('edit.copy').label, 'Copy', 'command metadata is not rewritten');
  t.eq(labelOf('edit.copy'), '复制', 'command display is translated');
  doc.commit('Snapshot: Blur');
  t.ok(labelOf('edit.undo').includes('Blur'), 'snapshot name that matches a UI key is preserved');
  t.eq(doc.history.states[doc.history.index].label, 'Snapshot: Blur', 'stored history remains unchanged');
  const old = localStorage.getItem('pikado.recent');
  try {
    localStorage.setItem('pikado.recent', JSON.stringify([{ key: 'test-i18n', name: 'Layer', when: 1 }]));
    t.eq(labelOf('file.open-recent.0'), 'Layer', 'a user file name is not translated as a command');
  } finally {
    if (old === null) localStorage.removeItem('pikado.recent');
    else localStorage.setItem('pikado.recent', old);
  }
});

suite('i18n features / layer styles render Chinese without changing the layer name', async (t) => {
  const doc = t.doc(8, 8, '#ffffff');
  const layer = doc.activeLayer();
  layer.name = 'Color Overlay';
  const result = showLayerStyleDialog(doc, layer, 'colorOverlay');
  try {
    const dialog = document.querySelector('.pk-fx-dialog');
    t.ok(dialog.textContent.includes('颜色叠加'), 'effect list is translated');
    t.ok(dialog.textContent.includes('启用颜色叠加'), 'dynamic enable label is translated');
    t.eq(layer.name, 'Color Overlay', 'user layer name is retained');
  } finally {
    document.querySelector('.pk-fx-dialog .pk-dialog-close')?.click();
    await result;
  }
});

suite('i18n features / selection sources localize only their fixed descriptions', async (t) => {
  const doc = t.doc(8, 8, '#ffffff');
  const layer = doc.activeLayer();
  layer.name = 'Save';
  const pending = getCommand('select.load').run();
  const dialog = document.querySelector('.pk-dialog');
  try {
    const option = dialog.querySelector(`option[value="layer:${layer.id}"]`);
    t.eq(option.textContent, 'Save 透明度', 'user layer name is preserved inside the translated description');
    t.eq(option.value, `layer:${layer.id}`, 'source identity is unchanged');
    t.eq(layer.name, 'Save', 'stored layer name is unchanged');
  } finally {
    dialog.querySelector('.pk-dialog-close').click();
    await pending;
  }
});
