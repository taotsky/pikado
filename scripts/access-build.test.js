import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { build } from 'vite';

test('protected build replaces offline worker and removes offline registration', async () => {
  const result = await build({ mode: 'vbd', logLevel: 'silent', build: { write: false } });
  const output = result.output;
  assert.equal(JSON.parse(output.find((item) => item.fileName === 'pikado-version.json').source).access, 'protected');
  assert.equal(output.find((item) => item.fileName === 'sw.js').source, await readFile(new URL('./access-worker.js', import.meta.url), 'utf8'));
  assert.match(output.find((item) => item.fileName === 'index.html').source, /name="pikado-access" content="protected"/);
  assert.ok(output.filter((item) => item.type === 'chunk').every((item) => !item.code.includes('serviceWorker.register(')));
});

test('default standalone build retains offline installation', async () => {
  const result = await build({ mode: 'production', logLevel: 'silent', build: { write: false } });
  assert.equal(JSON.parse(result.output.find((item) => item.fileName === 'pikado-version.json').source).access, 'public');
  assert.ok(result.output.some((item) => item.type === 'chunk' && item.code.includes('serviceWorker.register(')));
});
