import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

test('migration claims old pages and removes only Pikado directory entries', async () => {
  const handlers = {};
  const entries = new Map([
    ['pikado-v1', ['https://vb.test/tools/pikado/index.html', 'https://vb.test/api/keep']],
    ['pikado-old', ['https://vb.test/tools/pikado/assets/old.js']],
    ['canvas', ['https://vb.test/tools/pikado/keep.js']],
  ]);
  const lifecycle = [];
  const caches = {
    keys: async () => [...entries.keys()],
    open: async (name) => ({
      keys: async () => entries.get(name).map((url) => ({ url })),
      delete: async ({ url }) => entries.set(name, entries.get(name).filter((value) => value !== url)),
    }),
    delete: async (name) => entries.delete(name),
  };
  const self = {
    location: { href: 'https://vb.test/tools/pikado/sw.js' },
    addEventListener: (type, handler) => { handlers[type] = handler; },
    skipWaiting: async () => { lifecycle.push('skip'); },
    clients: { claim: async () => { lifecycle.push('claim'); } },
    registration: { unregister: async () => { lifecycle.push('unregister'); } },
  };
  vm.runInNewContext(await readFile(new URL('./access-worker.js', import.meta.url), 'utf8'), { self, caches, URL });
  let pending;
  handlers.install({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  handlers.activate({ waitUntil: (promise) => { pending = promise; } });
  await pending;
  assert.deepEqual([...entries], [['pikado-v1', ['https://vb.test/api/keep']], ['canvas', ['https://vb.test/tools/pikado/keep.js']]]);
  assert.deepEqual(lifecycle, ['skip', 'claim', 'unregister']);
  assert.equal(handlers.fetch, undefined);
});
