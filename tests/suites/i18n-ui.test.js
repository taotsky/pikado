import { suite } from '../harness.js';
import { t as translate } from '../../src/i18n.js';
import { BROWSE_FONTS } from '../../src/text/fonts.js';
import { fontOptions, setInstalledProvider } from '../../src/ui/font-field.js';
import { curveParam, defaultCurves, curvesFromPreset } from '../../src/ui/curve-editor.js';
import { gradientPresetPicker, normalizeGradient } from '../../src/ui/gradient-editor.js';

suite('i18n UI / font families and custom gradient names stay user data', (t) => {
  setInstalledProvider(() => [{ id: 'Save', name: 'Save' }, { id: 'Layer', name: 'Layer' }]);
  try {
    const options = fontOptions('Save');
    t.eq(options.find((option) => option.value === BROWSE_FONTS).label, '浏览 Google 字体…', 'browse action is translated');
    t.eq(options.find((option) => option.value === 'Save').label, 'Save', 'font family matching a dictionary key stays raw');
  } finally {
    setInstalledProvider(null);
  }
  let chosen = null;
  const picker = gradientPresetPicker((gradient, name) => { chosen = name; }, {
    presets: [{ name: 'Save', gradient: normalizeGradient([[0, '#000000'], [1, '#ffffff']]) }],
  });
  const button = picker.querySelector('button');
  t.eq(button.title, 'Save', 'custom gradient tooltip stays raw');
  button.click();
  t.eq(chosen, 'Save', 'custom gradient selection preserves its name');
});

suite('i18n UI / curve labels translate while preset values remain stable', (t) => {
  const container = document.createElement('div');
  const state = { curves: defaultCurves() };
  const control = curveParam({ size: 80, histogram: () => null }).render(container, state, (key, value) => { state[key] = value; });
  try {
    const option = [...container.querySelectorAll('option')].find((item) => item.value === 'Strong Contrast');
    t.eq(option.textContent, '强对比度', 'static preset label is translated');
    const select = option.parentElement;
    select.value = 'Strong Contrast';
    select.dispatchEvent(new Event('change'));
    t.eq(state.curves, curvesFromPreset('Strong Contrast'), 'English preset id still selects its original curve');
    t.eq(container.querySelector('.pk-curve-readout').textContent, '输入：—   输出：—', 'curve readout is translated');
  } finally {
    if (control && control.destroy) control.destroy();
  }
});

suite('i18n UI / dynamic labels keep inserted names unchanged', (t) => {
  t.eq(translate('Editing “{name}”', { name: 'Save' }), '正在编辑“Save”', 'user layer name is not translated');
  t.eq(translate('{name} — Ctrl/Cmd-click to load as a selection', { name: 'Layer' }), 'Layer — 按 Ctrl/Cmd 点击以载入选区', 'custom channel name is not translated');
  t.eq(translate('Input: {input}   Output: {output}', { input: 0, output: 255 }), '输入：0   输出：255', 'numeric values survive interpolation');
  t.eq(translate('Mem: {memory}', { memory: '128 MB' }), '内存：128 MB', 'format abbreviations remain intact');
});
