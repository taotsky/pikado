const report = [];
window.__pikadoEmbedTests = report;
const assert = (condition, name) => {
  report.push({ name, pass: !!condition });
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  if (!condition) throw new Error(name);
};
const origin = location.origin;
const frames = [];
let sequence = 0;
const namespace = 'vbd:pikado';
const version = 1;
const params = new URLSearchParams(location.search);
const testCase = params.get('case') || 'smoke';
const runId = params.get('run') || crypto.randomUUID();

function frame(projectId = runId, userId = runId, expectedCommit = 'development', themeOptions = {}) {
  const iframe = document.createElement('iframe');
  iframe.width = '1280'; iframe.height = '860';
  iframe.loading = 'eager';
  iframe.style.cssText = 'position:fixed;left:0;top:0';
  const sessionId = crypto.randomUUID();
  const pending = new Map();
  const received = [];
  let initialTheme;
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const readyTimer = setTimeout(() => rejectReady(new Error('ready timeout')), 20000);
  const send = (type, payload, requestId) => iframe.contentWindow.postMessage({ namespace, version, sessionId, type, requestId, payload }, origin);
  const listener = (event) => {
    const m = event.data;
    if (event.origin !== origin || event.source !== iframe.contentWindow || m?.sessionId !== sessionId) return;
    received.push(m.type);
    if (m.type === 'booted') {
      initialTheme = iframe.contentDocument.documentElement.dataset.theme;
      if (themeOptions.latest) send('set-theme', { theme: themeOptions.latest });
      send('init', { userId, projectId, expectedCommit, theme: themeOptions.init });
    }
    if (m.type === 'ready') { clearTimeout(readyTimer); resolveReady(m.payload); }
    if (m.type === 'error' && !m.requestId) { clearTimeout(readyTimer); rejectReady(m.payload); }
    if (m.requestId && pending.has(m.requestId)) {
      const task = pending.get(m.requestId);
      pending.delete(m.requestId);
      if (m.type === 'error') task.reject(m.payload); else task.resolve(m.payload);
    }
  };
  window.addEventListener('message', listener);
  const url = new URL(`../index.html?embed=1&session=${sessionId}`, location.href).href;
  if (!iframe.isConnected) document.body.appendChild(iframe);
  const themedUrl = new URL(url);
  if (themeOptions.snapshot) themedUrl.searchParams.set('theme', themeOptions.snapshot);
  iframe.src = themedUrl.href;
  const call = (type, payload, id = `test-${++sequence}`) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timeout`)), 20000);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    send(type, payload, id);
  });
  const remove = () => { clearTimeout(readyTimer); iframe.remove(); window.removeEventListener('message', listener); };
  const result = { iframe, ready, call, remove, received, notify: send, get initialTheme() { return initialTheme; } };
  frames.push(result);
  return result;
}

async function smoke() {
  const first = frame();
  const ready = await first.ready;
  assert(ready.buildCommit === 'development', 'ready identifies actual dev build');
  assert(!first.iframe.contentDocument.querySelector('#menubar .pk-brand'), 'embedded menu bar omits the Pikado brand');
  assert(!first.iframe.contentDocument.querySelector('.pk-welcome .pk-wc-mark, .pk-welcome .pk-wc-word'), 'empty embedded welcome omits the Pikado logo and name');
  assert(first.iframe.contentDocument.querySelector('.pk-welcome .pk-wc-tag')?.textContent === '图像工作室', 'embedded welcome retains its studio heading');
  await new Promise((resolve) => {
    const menu = first.iframe.contentDocument.getElementById('menubar');
    const observer = new MutationObserver(() => { if (menu.querySelector('.pk-menu-btn')) finish(); });
    const timeout = setTimeout(finish, 3000);
    function finish() { observer.disconnect(); clearTimeout(timeout); resolve(); }
    observer.observe(menu, { childList: true, subtree: true });
    if (menu.querySelector('.pk-menu-btn')) finish();
  });
  assert(first.iframe.contentDocument.querySelectorAll('#menubar [role="menubar"] button').length > 0, 'embedded menu commands remain available');
  assert((await first.call('get-targets')).documents.length === 0, 'new partition is empty');
  const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
  const context = canvas.getContext('2d'); context.fillStyle = '#ff0000'; context.fillRect(0, 0, 8, 8);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve));
  const payload = { docId: null, layerId: null, images: [{ blob, name: 'red' }, { blob, name: 'second' }] };
  const inserted = await first.call('insert-images', payload, 'dedup');
  assert(first.iframe.contentDocument.querySelector('#menubar .pk-doc-name')?.textContent === 'red', 'embedded document name remains visible');
  const duplicate = await first.call('insert-images', payload, 'dedup');
  assert(inserted.docId === duplicate.docId, 'duplicate insert returns same response');
  assert((await first.call('get-targets')).documents.length === 1, 'duplicate request creates only one document');
  const anchorPrototype = first.iframe.contentWindow.HTMLAnchorElement.prototype;
  const originalClick = anchorPrototype.click;
  let capturedDownload;
  anchorPrototype.click = function () { capturedDownload = { href: this.href, name: this.download }; };
  try {
    await first.call('download-project');
    assert(capturedDownload?.name === 'red.pkd', 'download-project uses the active document filename');
    const bytes = await (await fetch(capturedDownload.href)).arrayBuffer();
    assert(new TextDecoder().decode(bytes.slice(0, 8)) === 'PIKADO02', 'download-project serializes a real native project');
    const pkd = await first.iframe.contentWindow.eval(`import(${JSON.stringify(new URL('../src/io/pkd.js', location.href).href)})`);
    const back = await pkd.loadPKD(bytes);
    assert(back.layers.length === 2 && back.layers[0].canvas.getContext('2d').getImageData(0, 0, 1, 1).data[0] === 255, 'downloaded project reopens with expected layers and pixels');
  } finally {
    anchorPrototype.click = originalClick;
  }
  const store = await first.iframe.contentWindow.eval(`import(${JSON.stringify(new URL('../src/io/store.js', location.href).href)})`);
  const pointer = await store.kvGet('session');
  const docStoreId = first.iframe.contentWindow.pikado.activeDoc._storeId;
  assert(!pointer?.open?.some((ref) => ref.id === docStoreId) || !!await store.getDocData(docStoreId), 'new document pointer never precedes its payload');
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert(!!await store.getDocData(docStoreId), 'new document autosaves without another edit or explicit flush');
  let rejected = false;
  try { await first.call('insert-images', { ...payload, docId: inserted.docId, layerId: 'deleted' }); } catch { rejected = true; }
  assert(rejected, 'missing fixed target rejects insertion');
  const locked = await navigator.locks.request(`pikado:vbd:${encodeURIComponent(runId)}:${encodeURIComponent(runId)}`, { ifAvailable: true }, (lock) => !lock);
  assert(locked, 'another writer cannot acquire the active project Web Lock');
  const live = first.iframe.contentWindow.pikado.activeDoc;
  const layerCanvas = live.layers[0].getPixelSource().canvas;
  const originalToBlob = layerCanvas.toBlob;
  layerCanvas.toBlob = () => { throw new Error('injected storage encoding failure'); };
  live.touch('save failure test');
  let disposeFailed = false;
  try { await first.call('dispose'); } catch { disposeFailed = true; }
  assert(disposeFailed, 'dispose refuses to discard a failed save');
  assert(!first.iframe.contentDocument.getElementById('app').inert, 'failed dispose restores editable UI');
  assert((await first.call('get-targets')).documents.length === 1, 'failed dispose keeps communication working');
  layerCanvas.toBlob = originalToBlob;
  await first.call('flush');
  await first.call('dispose'); first.remove();
  const links = document.createElement('p');
  for (const name of ['restore', 'other-project', 'other-user', 'version']) {
    const link = document.createElement('a');
    const url = new URL(location.href);
    url.searchParams.set('case', name);
    url.searchParams.set('run', runId);
    link.href = url.href;
    link.textContent = name;
    links.append(link, document.createTextNode(' '));
  }
  document.body.appendChild(links);
}

async function theme() {
  const current = frame(runId, runId, 'development', { snapshot: 'light', init: 'light', latest: 'dark' });
  await current.ready;
  const child = current.iframe.contentWindow;
  const root = current.iframe.contentDocument.documentElement;
  assert(current.initialTheme === 'light', 'URL snapshot applies before the editor boots');
  assert(root.dataset.theme === 'dark', 'latest loading notification overrides stale init theme');
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
  canvas.getContext('2d').fillStyle = '#ff0000'; canvas.getContext('2d').fillRect(0, 0, 8, 8);
  const blob = await new Promise(resolve => canvas.toBlob(resolve));
  await current.call('insert-images', { docId: null, layerId: null, images: [{ blob, name: 'theme artwork' }] });
  await current.call('flush');
  const doc = child.pikado.activeDoc;
  const history = doc.history.states.length;
  const before = doc.layers[0].canvas.getContext('2d').getImageData(0, 0, 1, 1).data.join(',');
  const states = current.received.filter(type => type === 'save-state').length;
  const source = current.iframe.src;
  for (const value of ['light', 'dark', 'light']) current.notify('set-theme', { theme: value });
  await current.call('get-targets');
  assert(root.dataset.theme === 'light', 'consecutive theme notifications apply the latest value');
  assert(root.style.colorScheme === 'light' && child.document.querySelector('meta[name="theme-color"]').content === '#f3f3f6', 'theme updates native color scheme and browser theme color');
  assert(!child.document.getElementById('app').inert, 'theme does not leave the editor inert');
  assert(current.iframe.src === source && child.pikado.activeDoc === doc, 'theme keeps iframe and document instances');
  assert(doc.history.states.length === history && doc.layers[0].canvas.getContext('2d').getImageData(0, 0, 1, 1).data.join(',') === before, 'theme preserves history and artwork pixels');
  assert(current.received.filter(type => type === 'save-state').length === states, 'theme notifications do not save the project');
  for (const [key, value] of [['sessionId', 'wrong-session'], ['version', 2], ['namespace', 'wrong-namespace']]) {
    child.postMessage({ namespace, version, sessionId: new URL(source).searchParams.get('session'), type: 'set-theme', payload: { theme: 'dark' }, [key]: value }, origin);
  }
  const envelope = { namespace, version, sessionId: new URL(source).searchParams.get('session'), type: 'set-theme', payload: { theme: 'dark' } };
  child.dispatchEvent(new child.MessageEvent('message', { origin: 'https://wrong.invalid', source: window, data: envelope }));
  child.dispatchEvent(new child.MessageEvent('message', { origin, source: child, data: envelope }));
  current.notify('set-theme', { theme: 'system' });
  await current.call('get-targets');
  assert(root.dataset.theme === 'light', 'invalid origin source session namespace version and theme are ignored');
  await current.call('dispose');
  current.notify('set-theme', { theme: 'dark' });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert(root.dataset.theme === 'light', 'disposed editor ignores theme notifications');
}

async function run() {
  try {
    if (testCase === 'theme') await theme();
    else if (testCase === 'smoke') await smoke();
    else {
      if (!params.get('run')) throw new Error('Run smoke first and follow its case links');
      if (!['restore', 'other-project', 'other-user', 'version'].includes(testCase)) throw new Error('Unknown test case');
      const current = frame(
        testCase === 'other-project' ? `${runId}-other` : runId,
        testCase === 'other-user' ? `${runId}-other-user` : runId,
        testCase === 'version' ? '0'.repeat(40) : 'development',
      );
      if (testCase === 'version') {
        try { await current.ready; assert(false, 'wrong build must reject'); }
        catch (error) { assert(error.code === 'VERSION_MISMATCH', 'wrong build commit rejected'); }
      } else {
        await current.ready;
        const targets = await current.call('get-targets');
        if (testCase === 'restore') {
          assert(targets.documents.length === 1 && targets.documents[0].layers.length === 2, 'ready waits for persisted documents to restore');
          // Read the embedded window's live registry, rather than the parent's module instance.
          const ai = await current.iframe.contentWindow.eval(`import(${JSON.stringify(new URL('../src/commands/registry.js', location.href).href)})`);
          assert(!ai.getCommand('edit.generative-fill') && !ai.getCommand('edit.ai-settings'), 'AI commands are unavailable in embedded registry');
        } else assert(targets.documents.length === 0, `${testCase} cannot recover the smoke project`);
        await current.call('dispose');
      }
    }
  } catch (error) {
    report.push({ name: error.message || String(error), pass: false, stack: error.stack, frames: frames.map((f) => ({ src: f.iframe.src, received: f.received })) });
  } finally {
    for (const f of frames) f.remove();
    document.getElementById('report').textContent = JSON.stringify(report, null, 2);
    window.__pikadoEmbedTestsDone = true;
  }
}
run();
