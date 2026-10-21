import { suite } from '../harness.js';
import { Layer, LayerType, createGroupLayer } from '/src/core/layer.js';
import { PikaDocument } from '/src/core/document.js';
import { createCanvas } from '/src/core/util.js';
import { savePKD, loadPKD, pkdVersion } from '/src/io/pkd.js';
import { saveDocument } from '/src/io/save.js';

function solid(w, h, color) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

async function rewrite(blob, update, magic = 'PIKADO02') {
  const buffer = await blob.arrayBuffer();
  const length = new DataView(buffer).getUint32(8, true);
  const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, length)));
  update(manifest);
  const encoded = new TextEncoder().encode(JSON.stringify(manifest));
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode(magic));
  new DataView(header.buffer).setUint32(8, encoded.length, true);
  return new Blob([header, encoded, buffer.slice(12 + length)]);
}

async function legacyBlob(doc) {
  return rewrite(await savePKD(doc), (manifest) => {
    manifest.version = 1;
    const layer = (node) => {
      node.canvas = node.source?.canvas || null;
      node.mask = node.maskSource?.canvas || null;
      delete node.source;
      delete node.maskSource;
      node.children?.forEach(layer);
      node.smart?.source?.layers?.forEach(layer);
    };
    manifest.layers.forEach(layer);
  }, 'PIKADO01');
}

suite('off-canvas IO / full sources survive nested v2 round trips', async (t) => {
  const doc = t.doc(16, 16, '#ffffff', 'Off-canvas');
  const group = createGroupLayer('Group');
  const raster = new Layer({ name: 'Negative pixels' });
  raster.setPixelSource(solid(7, 5, '#ff0000'), -4, 15, doc);
  raster.setMaskSource(solid(3, 2, '#000000'), -2, 20, 255, doc);
  group.children = [raster];
  raster.parent = group;
  const source = new PikaDocument({ width: 11, height: 9, name: 'Smart contents' });
  const inner = new Layer({ name: 'Inner' });
  inner.setPixelSource(solid(4, 6, '#0000ff'), -8, -3, source);
  source.layers = [inner];
  const smart = new Layer({ type: LayerType.SMART, name: 'Smart' });
  smart.smart = { source, sourceWidth: 11, sourceHeight: 9, linkId: 'off-canvas-source',
    sourceVersion: 1, transform: { matrix: [1, 0, 0, 1, 0, 0] }, filters: [] };
  doc.layers = [group, smart];
  const original = raster.pixelKey();
  const blob = await savePKD(doc);
  t.eq(await pkdVersion(blob), 2, 'new files use PIKADO02');
  t.is(raster.pixelKey(), original, 'saving does not materialise or replace the complete source');
  const reopened = await loadPKD(await blob.arrayBuffer());
  const pixels = reopened.layers[0].children[0].getPixelSource();
  t.eq([pixels.x, pixels.y, pixels.canvas.width, pixels.canvas.height], [-4, 15, 7, 5], 'group child keeps full dimensions and negative position');
  t.pixel(pixels.canvas, 6, 4, '255,0,0,255', 'off-canvas edge pixels survive');
  const mask = reopened.layers[0].children[0].getMaskSource();
  t.eq([mask.x, mask.y, mask.defaultValue], [-2, 20, 255], 'mask position and outside coverage survive');
  t.pixel(mask.canvas, 2, 1, '0,0,0,255', 'complete mask pixels survive');
  const innerAgain = reopened.layers[1].smart.source.layers[0].getPixelSource();
  t.eq([innerAgain.x, innerAgain.y, innerAgain.canvas.width, innerAgain.canvas.height], [-8, -3, 4, 6], 'embedded smart document uses full layer encoding');
  t.pixel(innerAgain.canvas, 3, 5, '0,0,255,255', 'embedded off-canvas pixels survive');
});

suite('off-canvas IO / v1 compatibility and pre-decode format refusal', async (t) => {
  const doc = t.doc(8, 8, '#ffffff');
  doc.layers[0].setPixelSource(solid(8, 8, '#00ff00'), 0, 0, doc);
  const v1 = await legacyBlob(doc);
  const reopened = await loadPKD(await v1.arrayBuffer());
  t.eq(reopened._pkdVersion, 1, 'legacy version is tracked for safe file saving');
  t.eq([reopened.layers[0].getPixelSource().x, reopened.layers[0].getPixelSource().y], [0, 0], 'v1 position defaults to document origin');
  t.pixel(reopened.layers[0].getPixelSource().canvas, 7, 7, '0,255,0,255', 'legacy pixels remain intact');
  const v2 = await savePKD(doc);
  // Frozen header guard from the old loadPKD: it must reject before reading a new manifest.
  const legacyHeaderGuard = async (blob) => {
    const u8 = new Uint8Array(await blob.arrayBuffer());
    let magic = '';
    for (let i = 0; i < 8; i++) magic += String.fromCharCode(u8[i]);
    if (magic !== 'PIKADO01') throw new Error('Not a Pikado project file');
  };
  await t.throws(() => legacyHeaderGuard(v2), 'old reader header guard refuses v2');
  const mismatch = await rewrite(v2, (m) => { m.version = 1; });
  await t.throws(async () => loadPKD(await mismatch.arrayBuffer()), 'header and manifest version mismatch is refused');
  const legacyMismatch = await rewrite(v2, () => {}, 'PIKADO01');
  await t.throws(async () => loadPKD(await legacyMismatch.arrayBuffer()), 'legacy header cannot claim a v2 manifest');
  const unknownVersion = await rewrite(v2, (m) => { m.version = 3; });
  await t.throws(async () => loadPKD(await unknownVersion.arrayBuffer()), 'unknown manifest version is refused');
  const unknown = await rewrite(v2, () => {}, 'PIKADO03');
  await t.throws(async () => loadPKD(await unknown.arrayBuffer()), 'unknown file header is refused');
  const invalidPosition = await rewrite(v2, (m) => { m.layers[0].source.x = 0.5; });
  await t.throws(async () => loadPKD(await invalidPosition.arrayBuffer()), 'fractional pixel source position is refused');
  const unsafeExtent = await rewrite(v2, (m) => { m.layers[0].source.x = Number.MAX_SAFE_INTEGER; });
  await t.throws(async () => loadPKD(await unsafeExtent.arrayBuffer()), 'an extent beyond safe integer coordinates is refused');
});

suite('off-canvas IO / atomic upgrade checkpoint, recovery and rollback on backup failure', async (t) => {
  // A separate module instance keeps the live editor's store configuration untouched.
  const store = await import(`/src/io/store.js?off-canvas-test=${crypto.randomUUID()}`);
  const dbName = `pikado-off-canvas-test-${crypto.randomUUID()}`;
  store.configureStore(dbName);
  const doc = new PikaDocument({ width: 8, height: 8, name: 'Upgrade fixture' });
  const layer = new Layer();
  layer.setPixelSource(solid(8, 8, '#ff0000'), 0, 0, doc);
  doc.layers = [layer];
  const v1 = await legacyBlob(doc);
  layer.translatePixels(-20, 0, doc);
  const v2 = await savePKD(doc);
  const rec = { id: 'fixture', name: doc.name, width: 8, height: 8, layers: 1 };
  const pointer = { open: [{ id: rec.id, name: doc.name }], activeId: rec.id, savedAt: 1 };
  try {
    await store.putDoc({ ...rec, data: v1 });
    await store.kvSet('session', pointer);
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, ...args) {
      if (this.name === 'kv' && value.key?.startsWith('pkd-recovery:v1:')) {
        throw new DOMException('Injected backup failure', 'QuotaExceededError');
      }
      return originalPut.call(this, value, ...args);
    };
    try {
      await t.throws(() => store.putDoc({ ...rec, data: v2 }), 'backup write failure rejects the whole upgrade');
    } finally { IDBObjectStore.prototype.put = originalPut; }
    t.eq(await pkdVersion(await store.getDocData(rec.id)), 1, 'failed upgrade leaves v1 blob intact');
    t.eq((await store.getDocMeta(rec.id)).formatVersion, 1, 'failed upgrade leaves metadata intact');
    t.eq(await store.kvGet('session'), pointer, 'failed upgrade leaves session pointer intact');
    t.eq(await store.getUpgradeCheckpoint(rec.id), null, 'failed transaction leaves no partial recovery record');
    await store.kvSet('pkd-recovery:budget-fixture', { bytes: store.STORE_LIMIT_BYTES });
    await t.throws(() => store.putDoc({ ...rec, data: v2 }), 'recovery bytes are checked before committing an over-budget save');
    t.eq(await pkdVersion(await store.getDocData(rec.id)), 1, 'budget refusal keeps old bytes');
    await store.kvDelete('pkd-recovery:budget-fixture');
    await store.putDoc({ ...rec, data: v2 });
    const checkpoint = await store.getUpgradeCheckpoint(rec.id);
    t.eq(await pkdVersion(checkpoint.data), 1, 'first successful upgrade retains the original v1 file');
    t.eq(checkpoint.session, pointer, 'upgrade preserves its session checkpoint');
    t.eq((await store.usage()).recoveryBytes, v1.size, 'recovery bytes count against local storage budget');
    await store.putDoc({ ...rec, data: v2 });
    t.eq((await store.getUpgradeCheckpoint(rec.id)).createdAt, checkpoint.createdAt, 'subsequent saves do not replace the first checkpoint');
    const recovery = await store.restoreUpgradeCheckpoint(rec.id);
    t.eq(await pkdVersion(await store.getDocData(rec.id)), 1, 'explicit recovery restores legacy bytes');
    t.eq(await pkdVersion((await store.kvGet(recovery.preservedKey)).data), 2, 'recovery keeps newer work in a separate record');
    t.eq((await store.kvGet('session')).activeId, rec.id, 'recovered document remains addressable from the session');
    await store.putDoc({ ...rec, data: v2 });
    const secondRecovery = await store.restoreUpgradeCheckpoint(rec.id);
    t.ne(secondRecovery.preservedKey, recovery.preservedKey, 'another recovery uses a different preservation key');
    t.eq(await pkdVersion((await store.kvGet(recovery.preservedKey)).data), 2, 'another recovery cannot overwrite the first preserved v2 project');
    await store.prune([]);
    t.ok(await store.getUpgradeCheckpoint(rec.id), 'ordinary recent-project pruning does not remove recovery records');
  } finally {
    await store.closeStore();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
});

suite('off-canvas IO / legacy Save uses a different file and cancellation keeps dirty state', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(window, 'showSaveFilePicker');
  let writes = 0;
  const handle = { name: 'legacy.pkd', createWritable: async () => { writes++; throw new Error('must not overwrite'); } };
  const doc = { _pkdVersion: 1, fileHandle: handle, name: 'legacy', dirty: true };
  try {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => { throw new DOMException('cancelled', 'AbortError'); } });
    t.notOk(await saveDocument(doc), 'cancelling the first v2 Save As returns false');
    t.ok(doc.dirty, 'cancelled save keeps dirty state');
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => handle });
    t.notOk(await saveDocument(doc), 'choosing the same legacy handle is refused');
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => ({
      isSameEntry: async () => true, createWritable: handle.createWritable,
    }) });
    t.notOk(await saveDocument(doc), 'a different handle for the same underlying legacy file is refused');
    t.eq(writes, 0, 'the old file was never opened for writing');
    t.ok(doc.dirty, 'refusing the original file keeps dirty state');
    const actual = t.doc(8, 8, '#00ff00', 'Save v2');
    actual._pkdVersion = 1;
    actual.fileHandle = handle;
    actual.dirty = true;
    let written = null;
    const newHandle = { name: 'legacy-v2.pkd', isSameEntry: async () => false,
      createWritable: async () => ({ write: async (blob) => { written = blob; }, close: async () => {} }) };
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: async () => newHandle });
    t.ok(await saveDocument(actual), 'a different file can be saved successfully');
    t.eq(await pkdVersion(written), 2, 'the different file receives a complete v2 project');
    t.is(actual.fileHandle, newHandle, 'future saves target the new file');
    t.notOk(actual.dirty, 'only a successful save clears dirty state');
    t.eq(writes, 0, 'successful Save As still never writes the original legacy file');
  } finally {
    if (descriptor) Object.defineProperty(window, 'showSaveFilePicker', descriptor);
    else delete window.showSaveFilePicker;
  }
});
