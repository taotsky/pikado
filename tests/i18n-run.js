import { runAll } from './harness.js';
import './suites/i18n.test.js';
import './suites/i18n-runtime.test.js';
import './suites/i18n-dialogs.test.js';
import './suites/i18n-ui.test.js';
import './suites/i18n-features.test.js';
import './suites/theme.test.js';

async function run() {
  const report = await runAll();
  window.__pikadoI18nTests = report;
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  window.__pikadoI18nTestsDone = true;
}
run();
