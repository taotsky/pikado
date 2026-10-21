import { suite } from '../harness.js';
import { t as translate } from '../../src/i18n.js';
import { el } from '../../src/core/util.js';
import { showCanvasSizeDialog } from '../../src/ui/dialogs/canvas-size.js';
import { showImageSizeDialog } from '../../src/ui/dialogs/image-size.js';
import { showExportDialog } from '../../src/ui/dialogs/export.js';
import { showPreferencesDialog } from '../../src/ui/dialogs/preferences.js';
import { showAssignProfileDialog, showConvertProfileDialog } from '../../src/ui/dialogs/color-settings.js';
import { showAiConsentDialog } from '../../src/ui/dialogs/ai-consent.js';
import { showAiGuideDialog } from '../../src/ui/dialogs/ai-guide.js';
import { createRasterLayer } from '../../src/core/layer.js';
import { readPSD } from '../../src/io/psd-read.js';

function cancel(dialog) {
  Array.from(dialog.querySelectorAll('.pk-dialog-footer button')).find(button => button.textContent === '取消').click();
}

suite('export dialogs / PSD preserves layers and never falls back to PNG', async (test) => {
  const doc = test.doc(8, 6, '#ff0000', 'PSD-test');
  doc.layers[0].name = 'Save';
  const layer = createRasterLayer(8, 6, 'Layer');
  test.fill(layer, '#0000ff', 1, 1, 2, 2);
  doc.addLayer(layer);
  const downloads = [];
  const urls = new Map();
  const originalURL = URL.createObjectURL;
  const originalClick = HTMLAnchorElement.prototype.click;
  URL.createObjectURL = function(blob) { const url = originalURL.call(this, blob); urls.set(url, blob); return url; };
  HTMLAnchorElement.prototype.click = function() { downloads.push({ filename: this.download, blob: urls.get(this.href) }); };
  try {
    const pending = showExportDialog(doc);
    const dialog = document.querySelector('.pkd-export');
    const format = dialog.querySelector('select');
    const scale = dialog.querySelector('input[min="0.05"]');
    const checks = dialog.querySelectorAll('input[type="checkbox"]');
    scale.value = '3'; scale.dispatchEvent(new Event('input'));
    checks[0].checked = false; checks[0].dispatchEvent(new Event('change'));
    checks[1].checked = true; checks[1].dispatchEvent(new Event('change'));
    format.value = 'psd'; format.dispatchEvent(new Event('change'));
    test.eq(scale.value, '1', 'PSD resets export scale');
    test.eq([checks[0].checked, checks[1].checked], [true, false], 'PSD keeps document transparency and one layered file');
    test.eq([scale.closest('.pk-field').style.display, ...[...checks].map(input => input.closest('label').style.display)], ['none', 'none', 'none'], 'PSD hides incompatible raster controls');
    await new Promise(resolve => {
      const readout = dialog.querySelector('.pkd-readout');
      const observer = new MutationObserver(() => { if (readout.textContent.includes('PSD-test.psd')) finish(); });
      const timeout = setTimeout(finish, 5000);
      function finish() { observer.disconnect(); clearTimeout(timeout); resolve(); }
      observer.observe(readout, { childList: true, subtree: true });
      if (readout.textContent.includes('PSD-test.psd')) finish();
    });
    test.ok(dialog.querySelector('.pkd-readout').textContent.includes('8 × 6 px'), 'PSD preview uses original document dimensions');
    test.notOk(dialog.querySelector('.pkd-readout').textContent.includes('≈'), 'PSD does not estimate a raster file size');
    [...dialog.querySelectorAll('.pk-dialog-footer button')].find(button => button.textContent === '导出').click();
    const result = await pending;
    test.eq([result.format, result.scale, result.allLayers], ['psd', 1, false], 'actual export UI submits PSD with native dimensions');
    test.eq(downloads.length, 1, 'PSD exports one file');
    test.eq(downloads[0].filename, 'PSD-test.psd', 'download has a PSD extension');
    const bytes = await downloads[0].blob.arrayBuffer();
    test.eq(String.fromCharCode(...new Uint8Array(bytes, 0, 4)), '8BPS', 'download contains a real PSD signature');
    const restored = await readPSD(bytes);
    test.eq([restored.width, restored.height], [8, 6], 'PSD dimensions remain unscaled');
    test.eq(restored.layers.map(item => item.name), doc.layers.map(item => item.name), 'separate layer names survive PSD round trip');
    test.pixel(restored.layers.find(item => item.name === 'Save').canvas, 0, 0, '255,0,0,255', 'background layer pixels survive');
    test.pixel(restored.layers.find(item => item.name === 'Layer').canvas, 1, 1, '0,0,255,255', 'upper layer pixels survive');

    const failed = showExportDialog(doc);
    const failureDialog = document.querySelector('.pkd-export');
    const failureFormat = failureDialog.querySelector('select');
    failureFormat.value = 'psd'; failureFormat.dispatchEvent(new Event('change'));
    const guides = Object.getOwnPropertyDescriptor(doc, 'guides');
    Object.defineProperty(doc, 'guides', { configurable: true, get() { throw new Error('Test PSD writer failure'); } });
    try {
      [...failureDialog.querySelectorAll('.pk-dialog-footer button')].find(button => button.textContent === '导出').click();
      await failed;
      test.eq(downloads.length, 1, 'writer failure does not download a PNG with a PSD filename');
    } finally {
      if (guides) Object.defineProperty(doc, 'guides', guides);
      else delete doc.guides;
    }
  } finally {
    URL.createObjectURL = originalURL;
    HTMLAnchorElement.prototype.click = originalClick;
  }
});

suite('i18n dialogs / exact vocabulary and opaque dynamic names', (test) => {
  const family = 'Save <b>Layer</b> {width}';
  const text = translate('Remove {family}?', { family });
  test.eq(text, `是否移除 ${family}？`, 'font names and placeholder-like user content are not translated recursively');
  const node = el('span', { text });
  test.eq(node.querySelector('b'), null, 'dynamic text is never parsed as HTML');
  test.eq(translate('Single file: {filename}', { filename: 'Save.pkd' }), '单个文件：Save.pkd', 'filenames remain intact');
});

suite('i18n dialogs / canvas and image size retain machine values and cancellation', async (test) => {
  const doc = test.doc(8, 6, '#ff0000', 'Save');
  const canvasPending = showCanvasSizeDialog(doc);
  const canvas = document.querySelector('.pkd-canvassize');
  test.ok(canvas.textContent.includes('画布扩展颜色'), 'canvas extension control is Chinese');
  test.eq(canvas.querySelector('option[value="gray"]').textContent, '50% 灰色', 'color display is translated');
  test.eq(canvas.querySelector('option[value="gray"]').value, 'gray', 'color enum is unchanged');
  test.ok(canvas.querySelector('button[title="左上"]'), 'anchor accessibility label is Chinese');
  cancel(canvas);
  await canvasPending;
  const imagePending = showImageSizeDialog(doc);
  const image = document.querySelector('.pkd-imagesize');
  test.eq(image.querySelector('option[value="nearest"]').textContent, '邻近（硬边缘）', 'resampling display is translated');
  test.eq(image.querySelector('option[value="nearest"]').value, 'nearest', 'resampling enum is unchanged');
  test.ok(image.textContent.includes('重新采样'), 'resampling control is Chinese');
  cancel(image);
  await imagePending;
  test.eq([doc.name, doc.width, doc.height], ['Save', 8, 6], 'cancel preserves user name and dimensions');
});

suite('i18n dialogs / preferences and export translate labels without changing settings or filenames', async (test) => {
  const preferencesPending = showPreferencesDialog('general');
  const preferences = document.querySelector('.pkd-prefs-dialog');
  test.ok(preferences.textContent.includes('默认单位'), 'preference labels are Chinese');
  test.eq(preferences.querySelector('option[value="auto"]').textContent, '需要时下载', 'web font policy display is translated');
  test.eq(preferences.querySelector('option[value="off"]').value, 'off', 'web font policy value is unchanged');
  cancel(preferences);
  await preferencesPending;
  const doc = test.doc(8, 8, '#ffffff', 'Save');
  const exportPending = showExportDialog(doc);
  const dialog = document.querySelector('.pkd-export');
  test.ok(dialog.textContent.includes('文件名'), 'export field is Chinese');
  test.eq(dialog.querySelector('input[type="text"]').value, 'Save', 'user filename matching a UI key is untouched');
  test.eq(dialog.querySelector('option[value="png"]').textContent, 'PNG', 'file format abbreviation is untouched');
  await new Promise((resolve) => {
    const readout = dialog.querySelector('.pkd-readout');
    const observer = new MutationObserver(() => { if (readout.textContent) finish(); });
    const timeout = setTimeout(finish, 5000);
    function finish() {
      observer.disconnect();
      clearTimeout(timeout);
      resolve();
    }
    observer.observe(readout, { childList: true, subtree: true });
    if (readout.textContent) finish();
  });
  const estimate = dialog.querySelector('.pkd-readout').textContent;
  test.ok(estimate.includes('Save.png'), 'asynchronous export estimate preserves the filename');
  test.notOk(estimate.includes('null'), 'non-animated export does not render a null animation row');
  cancel(dialog);
  await exportPending;
});

suite('i18n dialogs / profiles retain original ICC names and source metadata', async (test) => {
  const doc = test.doc(8, 8, '#ffffff', 'Layer');
  doc.sourceProfileName = 'Save <b>Layer</b>';
  const pending = showAssignProfileDialog(doc);
  const dialog = document.querySelector('.pk-dialog');
  test.ok(dialog.textContent.includes('原文件标记为 Save <b>Layer</b>'), 'profile name is inserted verbatim in translated explanation');
  test.eq(dialog.querySelector('b'), null, 'profile metadata cannot create markup');
  test.ok(dialog.querySelector('option[value="srgb"]'), 'profile enum is unchanged');
  cancel(dialog);
  await pending;
  const convertPending = showConvertProfileDialog(doc);
  const convert = document.querySelector('.pk-dialog');
  test.eq(convert.querySelector('option[value="relative"]').textContent, '相对比色', 'intent label is translated');
  test.eq(convert.querySelector('option[value="relative"]').value, 'relative', 'intent enum is unchanged');
  cancel(convert);
  await convertPending;
});

suite('i18n dialogs / AI consent and guide preserve destinations and do not send requests', async (test) => {
  const host = `dialog-${crypto.randomUUID()}.invalid`;
  const pending = showAiConsentDialog({ name: 'Save <b>Layer</b>', endpoint: `https://${host}/images` });
  const dialog = document.querySelector('.pk-dialog');
  test.ok(dialog.textContent.includes(host), 'destination hostname is retained');
  test.ok(dialog.textContent.includes('Save <b>Layer</b>'), 'provider name is opaque text');
  test.ok(dialog.textContent.includes('不会发送的内容'), 'consent explanation is Chinese');
  test.eq(dialog.querySelector('b'), null, 'provider text cannot create HTML');
  cancel(dialog);
  test.eq(await pending, false, 'cancel does not grant consent');
  const guidePending = showAiGuideDialog();
  const guide = document.querySelector('.pkd-guide');
  test.ok(guide.textContent.includes('首次设置'), 'guide headings are Chinese');
  test.ok(guide.textContent.includes('platform.openai.com/api-keys'), 'OpenAI setup destination is retained');
  test.ok(guide.textContent.includes('aistudio.google.com/apikey'), 'Gemini setup destination is retained');
  test.ok(guide.textContent.includes('明文'), 'key persistence limitation remains visible');
  Array.from(guide.querySelectorAll('.pk-dialog-footer button')).find(button => button.textContent === '关闭').click();
  await guidePending;
});
