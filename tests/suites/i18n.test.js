import { suite } from '../harness.js';
import { t as translate } from '../../src/i18n.js';
import { el } from '../../src/core/util.js';
import { commands, registerCommand, labelOf } from '../../src/commands/registry.js';
import { Tool } from '../../src/tools/base.js';
import { Dialog, buildForm } from '../../src/ui/dialog.js';
import { savePKD, loadPKD } from '../../src/io/pkd.js';
import { showNewDocumentDialog } from '../../src/ui/dialogs/new-document.js';

suite('i18n / exact labels and safe fallback', (t) => {
  t.eq(translate('Save'), '保存', 'known label is Chinese');
  t.eq(translate('Unknown upstream label'), 'Unknown upstream label', 'new labels keep English');
  for (const value of ['toString', 'constructor', '__proto__', '', 'Save Layer']) {
    t.eq(translate(value), value, `unknown or prototype key stays unchanged: ${value}`);
  }
  t.eq(translate(3), 3, 'numbers retain their type');
  t.eq(translate(null), null, 'null is retained');
});

suite('i18n / user text and machine attributes are never translated by el', (t) => {
  const node = el('a.Layer#Save', {
    text: 'Save', title: 'Layer', href: '#Save', 'aria-label': 'Save',
    dataset: { project: 'Layer' },
  });
  t.eq(node.textContent, 'Save', 'user-visible data is unchanged without explicit translation');
  t.eq(node.title, 'Layer', 'user filename tooltip is unchanged');
  t.eq(node.id, 'Save', 'id is unchanged');
  t.eq(node.className, 'Layer', 'class is unchanged');
  t.eq(node.getAttribute('href'), '#Save', 'URL is unchanged');
  t.eq(node.dataset.project, 'Layer', 'dataset is unchanged');
  t.eq(node.getAttribute('aria-label'), 'Save', 'raw accessible data is unchanged');
  t.eq(el('span', {}, 'Save', 'Layer').textContent, 'SaveLayer', 'children are unchanged');
  t.eq(el('input', { value: 'Save' }).value, 'Save', 'input value is unchanged');
  const option = el('option', { value: 'Layer', text: translate('Layer') });
  t.eq(option.value, 'Layer', 'select business value is unchanged');
  t.eq(option.textContent, '图层', 'explicit UI label is translated');
});

suite('i18n / command display, dialog labels and form values', (t) => {
  const id = 'test.i18n.save';
  const cmd = registerCommand({ id, label: 'Save', accel: 'Ctrl+S', run() {} });
  try {
    t.eq(labelOf(id), '保存', 'command display translates its static label');
    t.eq(cmd.label, 'Save', 'command metadata is unchanged');
    t.eq(cmd.id, id, 'command id is unchanged');
    t.eq(cmd.accel, 'Ctrl+S', 'keyboard shortcut is unchanged');
    cmd.dynamicLabel = () => 'Save';
    t.eq(labelOf(id), 'Save', 'dynamic filename matching the vocabulary is unchanged');
  } finally {
    commands.delete(id);
  }
  t.eq(new Tool({ id: 'test', name: 'Move Tool' }).name, 'Move Tool', 'tool metadata is unchanged');
  const dialog = new Dialog({ title: 'New Document' });
  dialog.setButtons([{ label: 'Save', value: 'Layer' }]);
  t.eq(dialog.header.querySelector('.pk-dialog-title').textContent, '新建文档', 'dialog UI title is translated');
  t.eq(dialog.footer.querySelector('button').textContent, '保存', 'dialog action is translated');
  const state = { name: 'Save', choice: 'Layer' };
  const form = buildForm([
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'choice', label: 'Type', type: 'select', options: [{ value: 'Layer', label: 'Save' }] },
  ], state, (key, value) => { state[key] = value; });
  t.eq(form.node.querySelector('label').textContent, '名称', 'form field label is translated');
  t.eq(form.node.querySelector('input').value, 'Save', 'user-entered name is unchanged');
  t.eq(form.node.querySelector('select').value, 'Layer', 'selected machine value is unchanged');
  t.eq(form.node.querySelector('option').textContent, 'Save', 'dynamic user option label is unchanged');
  t.eq(state, { name: 'Save', choice: 'Layer' }, 'form state is unchanged');
});

suite('i18n / native projects retain user names and text', async (t) => {
  const doc = t.doc(8, 8, '#ff0000', 'Save');
  doc.layers[0].name = 'Layer';
  doc.layers[0].text = { content: 'Save', font: 'Layer' };
  const back = await loadPKD(await (await savePKD(doc)).arrayBuffer());
  t.eq(back.name, 'Save', 'project name survives serialization unchanged');
  t.eq(back.layers[0].name, 'Layer', 'layer name survives serialization unchanged');
  t.eq(back.layers[0].text.content, 'Save', 'user text survives serialization unchanged');
  t.pixel(back.layers[0].canvas, 0, 0, '255,0,0,255', 'pixels survive serialization');
});

suite('i18n / new document labels preserve values and creation behavior', async (t) => {
  const pending = showNewDocumentDialog();
  const dialog = document.querySelector('.pkd-newdoc');
  const labels = Array.from(dialog.querySelectorAll('label')).map((label) => label.textContent);
  t.ok(['名称', '宽度', '高度', '单位', '分辨率', '方向', '颜色模式', '背景内容'].every((label) => labels.includes(label)), 'core creation fields are Chinese');
  t.eq(dialog.querySelector('option[value="px"]').textContent, '像素', 'unit label is Chinese');
  t.eq(dialog.querySelector('option[value="rgb"]').value, 'rgb', 'color mode value remains unchanged');
  t.eq(dialog.querySelector('option[value="white"]').value, 'white', 'background value remains unchanged');
  const name = dialog.querySelector('input[type="text"]');
  name.value = 'Save';
  name.dispatchEvent(new Event('input'));
  const numbers = dialog.querySelectorAll('input[type="number"]');
  for (const input of [numbers[0], numbers[1]]) {
    input.value = '8';
    input.dispatchEvent(new Event('input'));
  }
  const create = Array.from(dialog.querySelectorAll('.pk-dialog-footer button')).find((button) => button.textContent === '创建');
  t.ok(create, 'create action is Chinese');
  create.click();
  const doc = await pending;
  try {
    t.eq(doc.name, 'Save', 'typed project name matching a UI word is unchanged');
    t.eq([doc.width, doc.height, doc.colorMode], [8, 8, 'rgb'], 'creation still uses the original numeric and enum values');
  } finally {
    t.app.closeDocument(doc);
  }
});
