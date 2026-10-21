import { suite } from '../harness.js';
import '../../src/styles.css';
import { applyTheme } from '../../src/theme.js';
import { curveParam, defaultCurves } from '../../src/ui/curve-editor.js';
import { allPrefs, setPrefs, PREF_DEFAULTS, applyStoredPreferences } from '../../src/ui/dialogs/preferences.js';

suite('theme / light controls preserve artwork and reject unknown themes', (test) => {
  const previous = document.documentElement.dataset.theme || 'dark';
  const preferences = allPrefs();
  const storedPreferences = localStorage.getItem('pikado.prefs');
  const doc = test.doc(8, 8, '#ff0000', 'Theme user content');
  const history = doc.history.states.length;
  const holder = document.createElement('div');
  document.body.append(holder);
  curveParam({ size: 80, histogram: () => null }).render(holder, { curves: defaultCurves() }, () => {});
  const plot = holder.querySelector('canvas');
  try {
    setPrefs({ accent: PREF_DEFAULTS.accent, canvasBg: PREF_DEFAULTS.canvasBg });
    applyTheme('dark');
    const darkPixel = test.px(plot, 15, 15);
    test.ok(applyTheme('light'), 'light theme is accepted');
    test.eq(document.documentElement.style.colorScheme, 'light', 'browser controls use the resolved theme');
    test.ne(test.px(plot, 15, 15), darkPixel, 'an already open curve control repaints on theme change');
    test.notOk(applyTheme('system'), 'unresolved or arbitrary themes are rejected');
    test.eq(document.documentElement.dataset.theme, 'light', 'invalid theme cannot replace the latest valid theme');
    test.is(test.app.activeDoc, doc, 'theme keeps the active document instance');
    test.eq(doc.history.states.length, history, 'theme creates no undo record');
    test.pixel(doc.layers[0].canvas, 0, 0, '255,0,0,255', 'theme leaves document pixels untouched');
    const style = getComputedStyle(document.documentElement);
    const lum = (hex) => {
      const values = hex.trim().slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
      return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
    };
    for (const name of ['--text-hi', '--text', '--text-dim', '--text-faint', '--accent-hi']) {
      const foreground = lum(style.getPropertyValue(name));
      const background = lum(style.getPropertyValue('--void'));
      test.ok((background + .05) / (foreground + .05) >= 4.5, `${name} reaches 4.5:1 against the neutral workspace`);
    }
  } finally {
    holder.remove();
    setPrefs(preferences);
    if (storedPreferences === null) localStorage.removeItem('pikado.prefs');
    else localStorage.setItem('pikado.prefs', storedPreferences);
    applyTheme(previous);
  }
});

suite('theme / default preferences follow theme while custom colours survive', (test) => {
  const previous = document.documentElement.dataset.theme || 'dark';
  const preferences = allPrefs();
  const storedPreferences = localStorage.getItem('pikado.prefs');
  const root = document.documentElement;
  try {
    setPrefs({ accent: PREF_DEFAULTS.accent, canvasBg: PREF_DEFAULTS.canvasBg });
    applyTheme('light');
    applyStoredPreferences();
    const light = getComputedStyle(root);
    test.eq(light.getPropertyValue('--accent').trim(), '#4dbcba', 'applying default preferences retains the light accent');
    test.eq(light.getPropertyValue('--void').trim(), '#d0d0d0', 'applying default preferences retains the light surround');
    applyTheme('dark');
    test.eq(getComputedStyle(root).getPropertyValue('--void').trim(), '#121212', 'default surround follows subsequent dark theme');
    setPrefs({ accent: '#bd31a0', canvasBg: '#383838' });
    applyTheme('light');
    test.eq(getComputedStyle(root).getPropertyValue('--accent').trim(), '#bd31a0', 'theme switching preserves a custom accent');
    test.eq(getComputedStyle(root).getPropertyValue('--void').trim(), '#383838', 'theme switching preserves a custom canvas surround');
    applyStoredPreferences();
    test.eq(getComputedStyle(root).getPropertyValue('--accent').trim(), '#bd31a0', 'reapplying custom preferences preserves the accent');
    setPrefs({ accent: PREF_DEFAULTS.accent, canvasBg: PREF_DEFAULTS.canvasBg });
    test.eq([root.style.getPropertyValue('--accent'), root.style.getPropertyValue('--void')], ['', ''], 'reset colours release inline overrides back to the theme');
  } finally {
    setPrefs(preferences);
    if (storedPreferences === null) localStorage.removeItem('pikado.prefs');
    else localStorage.setItem('pikado.prefs', storedPreferences);
    applyTheme(previous);
  }
});
