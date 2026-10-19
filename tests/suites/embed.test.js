import { suite } from '../harness.js';
import { insertImages, getTargets, validateImages } from '../../src/embed/insert.js';
import { partitionName } from '../../src/embed/mode.js';
import { createCanvas } from '../../src/core/util.js';
import { validEnvelope } from '../../src/embed/bridge.js';

async function image(color) {
  const canvas = createCanvas(8, 8);
  const c = canvas.getContext('2d');
  c.fillStyle = color;
  c.fillRect(0, 0, 8, 8);
  return new Promise((resolve) => canvas.toBlob((blob) => resolve({ blob, name: color }), 'image/png'));
}

suite('embed / insertion order, fixed targets and one undo step', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const target = doc.activeLayerId;
  const original = doc.history.states.length;
  const images = [await image('#ff0000'), await image('#0000ff')];
  const result = await insertImages(t.app, { docId: doc.id, layerId: target, images });
  t.eq(doc.layers.map((l) => l.id), [...result.layerIds, target], 'result order is top to bottom');
  t.eq(doc.history.states.length, original + 1, 'one history entry');
  t.pixel(doc.layers[0].canvas, 4, 4, '255,0,0,255', 'original pixels centered without enlargement');
  doc.history.undo();
  t.eq(doc.layers.map((l) => l.id), [target], 'one undo removes the entire batch');
  doc.history.redo();
  t.eq(doc.layers.map((l) => l.id), [...result.layerIds, target], 'redo rebuilds both layers');
  await t.throws(() => insertImages(t.app, { docId: doc.id, layerId: 'deleted', images }), 'deleted target rejected');
  t.eq(getTargets(t.app).documents.find((d) => d.id === doc.id).layers.length, 3, 'target listing includes all layers');
});

suite('embed / partial insertion rolls back pixels, selection and history', async (t) => {
  const doc = t.doc(16, 16, '#00ff00');
  const id = doc.activeLayerId;
  const states = [...doc.history.states];
  const images = [await image('#ff0000'), await image('#0000ff')];
  const add = doc.addLayer;
  let calls = 0;
  doc.addLayer = function (...args) {
    if (++calls === 2) throw new Error('injected canvas failure');
    return add.apply(this, args);
  };
  try {
    await t.throws(() => insertImages(t.app, { docId: doc.id, layerId: id, images }), 'partial failure surfaced');
  } finally {
    delete doc.addLayer;
  }
  t.eq(doc.layers.map((l) => l.id), [id], 'no partial layers left');
  t.eq(doc.activeLayerId, id, 'selection restored');
  t.eq(doc.history.states.length, states.length, 'no failed history step');
  t.pixel(doc.findLayer(id).canvas, 0, 0, '0,255,0,255', 'original pixels survive rollback');
});

suite('embed / validation and partition encoding', async (t) => {
  const image1 = await image('#ff0000');
  t.ne(partitionName('a:b', 'c'), partitionName('a', 'b:c'), 'partition names cannot collide through separators');
  await t.throws(() => partitionName('', 'project'), 'empty user rejected');
  await t.throws(() => validateImages({ docId: null, layerId: null, images: new Array(9).fill(image1) }), 'nine images rejected');
  await t.throws(() => validateImages({ docId: null, layerId: 'layer', images: [image1] }), 'new document cannot reference an old layer');
  await t.throws(() => validateImages({ docId: null, layerId: null, images: [{ blob: new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]), name: 'large' }] }), 'encoded byte budget enforced');
  const wide = createCanvas(8193, 1);
  const wideBlob = await new Promise((resolve) => wide.toBlob(resolve));
  await t.throws(() => insertImages(t.app, { docId: null, layerId: null, images: [{ blob: wideBlob, name: 'wide' }] }), 'edge budget enforced after decode');
  await t.throws(() => insertImages(t.app, { docId: null, layerId: null, images: [{ blob: new Blob(['broken']), name: 'bad' }] }), 'invalid bytes rejected before creating a document');
  const event = { origin: location.origin, source: parent, data: { namespace: 'vbd:pikado', version: 1, sessionId: 'test', type: 'flush', requestId: '1' } };
  t.ok(validEnvelope(event, 'test'), 'valid envelope accepted');
  t.notOk(validEnvelope({ ...event, origin: 'https://other.invalid' }, 'test'), 'foreign origin rejected');
  t.notOk(validEnvelope({ ...event, source: null }, 'test'), 'other window rejected');
  t.notOk(validEnvelope(event, 'old-session'), 'stale session rejected');
  t.notOk(validEnvelope({ ...event, data: { ...event.data, version: 2 } }, 'test'), 'other version rejected');
});
