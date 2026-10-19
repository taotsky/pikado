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
const runId = crypto.randomUUID();
const testFrame = document.createElement('iframe');

function frame(projectId = runId, userId = runId, expectedCommit = 'development') {
  const iframe = testFrame;
  iframe.width = '1280'; iframe.height = '860';
  iframe.loading = 'eager';
  iframe.style.cssText = 'position:fixed;left:0;top:0';
  const sessionId = crypto.randomUUID();
  const pending = new Map();
  const received = [];
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const readyTimer = setTimeout(() => rejectReady(new Error('ready timeout')), 20000);
  const send = (type, payload, requestId) => iframe.contentWindow.postMessage({ namespace, version, sessionId, type, requestId, payload }, origin);
  const listener = (event) => {
    const m = event.data;
    if (event.origin !== origin || event.source !== iframe.contentWindow || m?.sessionId !== sessionId) return;
    received.push(m.type);
    if (m.type === 'booted') send('init', { userId, projectId, expectedCommit });
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
  iframe.src = url;
  const call = (type, payload, id = `test-${++sequence}`) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${type} timeout`)), 20000);
    pending.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
    send(type, payload, id);
  });
  const remove = () => { clearTimeout(readyTimer); window.removeEventListener('message', listener); };
  const result = { iframe, ready, call, remove, received };
  frames.push(result);
  return result;
}

async function run() {
try {
  const first = frame();
  const ready = await first.ready;
  assert(ready.buildCommit === 'development', 'ready identifies actual dev build');
  assert((await first.call('get-targets')).documents.length === 0, 'new partition is empty');
  const canvas = document.createElement('canvas'); canvas.width = 8; canvas.height = 8;
  const context = canvas.getContext('2d'); context.fillStyle = '#ff0000'; context.fillRect(0, 0, 8, 8);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve));
  const payload = { docId: null, layerId: null, images: [{ blob, name: 'red' }, { blob, name: 'second' }] };
  const inserted = await first.call('insert-images', payload, 'dedup');
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
    assert(new TextDecoder().decode(bytes.slice(0, 8)) === 'PIKADO01', 'download-project serializes a real native project');
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
  const layerCanvas = live.layers[0].canvas;
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
  const isolated = frame(`${runId}-other`);
  await isolated.ready;
  assert((await isolated.call('get-targets')).documents.length === 0, 'other project cannot recover first project');
  await isolated.call('dispose'); isolated.remove();
  const user = frame(runId, `${runId}-other-user`);
  await user.ready;
  assert((await user.call('get-targets')).documents.length === 0, 'other user cannot recover first user');
  await user.call('dispose'); user.remove();
  const restored = frame();
  await restored.ready;
  const targets = await restored.call('get-targets');
  assert(targets.documents.length === 1 && targets.documents[0].layers.length === 2, 'ready waits for persisted documents to restore');
  // Read the embedded window's live registry, rather than the parent's module instance.
  const ai = await restored.iframe.contentWindow.eval(`import(${JSON.stringify(new URL('../src/commands/registry.js', location.href).href)})`);
  assert(!ai.getCommand('edit.generative-fill') && !ai.getCommand('edit.ai-settings'), 'AI commands are unavailable in embedded registry');
  await restored.call('dispose'); restored.remove();
  const mismatch = frame(runId, runId, '0'.repeat(40));
  try { await mismatch.ready; assert(false, 'wrong build must reject'); } catch (error) { assert(error.code === 'VERSION_MISMATCH', 'wrong build commit rejected'); }
  mismatch.remove();
} catch (error) {
  report.push({ name: error.message || String(error), pass: false, stack: error.stack, frames: frames.map((f) => ({ src: f.iframe.src, href: f.iframe.contentWindow?.location.href, html: f.iframe.contentDocument?.documentElement?.outerHTML.slice(0, 400), received: f.received })) });
} finally {
  for (const f of frames) f.remove();
  testFrame.remove();
  document.getElementById('report').textContent = JSON.stringify(report, null, 2);
  window.__pikadoEmbedTestsDone = true;
}
}
run();
