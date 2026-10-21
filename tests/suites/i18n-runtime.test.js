import { suite } from '../harness.js';
import { t, historyLabel } from '../../src/i18n.js';
import runtime from '../../src/i18n/runtime.js';
import ui from '../../src/i18n/ui.js';
import dialogs from '../../src/i18n/dialogs.js';
import features from '../../src/i18n/features.js';
import { GEN_ERRORS, GenerationError, messageFor } from '../../src/ai/errors.js';
import { BLEND_MODES } from '../../src/core/blend.js';
import { getPatterns, patternOptions } from '../../src/paint/patterns.js';

suite('i18n / dynamic messages preserve user data and error actions', (assert) => {
  const name = 'Save {count} $& <Layer> 中文.pkd';
  assert.eq(t('Saved {name}', { name }), `已保存 ${name}`, 'filename remains literal, with no nested interpolation or replacement expansion');
  assert.eq(t('Copied {width} × {height} px', { width: 12, height: 4 }), '已复制 12 × 4 px', 'numeric details remain accurate');
  assert.eq(t('Unknown {name}', { name: 'Layer' }), 'Unknown Layer', 'untranslated messages still preserve the inserted value');
  assert.eq(t('Saved {name}', {}), '已保存 {name}', 'missing substitutions are visible rather than silently removed');
  assert.eq(t('Unknown {constructor}', {}), 'Unknown {constructor}', 'inherited substitution keys are not read');
  const limited = messageFor(new GenerationError(GEN_ERRORS.RATE_LIMIT, '', { provider: 'Save', retryAfter: 30 }));
  assert.ok(limited.text.includes('Save') && limited.text.includes('30 秒'), 'provider identity and retry interval survive localization');
  assert.eq(limited.action, null, 'rate-limit action is unchanged');
  assert.eq(messageFor(new GenerationError(GEN_ERRORS.BAD_KEY, '', { provider: 'Layer' })).action, 'key', 'credential recovery keeps its machine action');
  assert.eq(t('Not a Pikado project file'), '这不是 Pikado 工程文件', 'raw parser diagnostics are localized at the display boundary');
  assert.eq(historyLabel('Snapshot: Save'), '快照：Save', 'a snapshot name matching a UI term remains unchanged');
  assert.eq(historyLabel('New Layer Layer'), '新建 Layer 图层', 'a user layer name is not translated');
  assert.eq(historyLabel('Fade Snapshot: Save'), '渐隐 快照：Save', 'nested operation prefixes preserve snapshot names');
  assert.eq(historyLabel('Assign Profile: Display P3'), '指定配置文件：Display P3', 'profile identities are retained');
});

suite('i18n / built-in blend modes and patterns localize without changing registry data', (assert) => {
  assert.eq(BLEND_MODES.find((mode) => mode.id === 'multiply').name, 'Multiply', 'blend metadata remains unchanged');
  assert.eq(t('Multiply'), '正片叠底', 'blend display uses the standard Chinese term');
  assert.ok(BLEND_MODES.every((mode) => /[\u4e00-\u9fff]/.test(t(mode.name))), 'every built-in blend mode has a Chinese label');
  assert.eq(getPatterns().find((pattern) => pattern.id === 'checkerboard').name, 'Checkerboard', 'pattern metadata remains unchanged');
  assert.eq(patternOptions().find((option) => option.value === 'checkerboard').label, '棋盘格', 'pattern control has a translated label and original ID');
});

suite('i18n / runtime templates keep every substitution', (assert) => {
  const parameters = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [key, value] of Object.entries({ ...runtime, ...ui, ...dialogs, ...features })) {
    if (!parameters(key).length && !parameters(value).length) continue;
    assert.eq(parameters(value), parameters(key), `template parameters are retained: ${key}`);
  }
});
