import { suite } from '../harness.js';
import { Layer, LayerType, checkPixelAllocation } from '../../src/core/layer.js';
import { layerBounds, peekBounds } from '../../src/core/layer-bounds.js';
import { createCanvas, ctx2d } from '../../src/core/util.js';

function solid(width, height, color) {
  const canvas = createCanvas(width, height);
  const c = ctx2d(canvas);
  c.fillStyle = color;
  c.fillRect(0, 0, width, height);
  return canvas;
}

suite('off-canvas / projections never replace or expose the complete source', (t) => {
  const doc = { width: 10, height: 8 };
  const pixels = solid(6, 4, '#ff0000');
  const layer = new Layer({ type: LayerType.RASTER });
  layer.setPixelSource(pixels, -3, 2, doc);
  const source = layer.pixelKey();
  t.pixel(layer.canvas, 0, 2, '255,0,0,255', 'visible part is projected in document coordinates');
  layer.canvas.getContext('2d').clearRect(0, 0, doc.width, doc.height);
  t.is(layer.pixelKey(), source, 'writing a disposable projection does not replace its source');
  t.pixel(layer.canvas, 0, 2, '255,0,0,255', 'writing a projection cannot erase the source');
  layer.translatePixels(20, 0, doc);
  t.eq(t.inked(layer.canvas), 0, 'a completely off-canvas layer projects as empty');
  layer.translatePixels(-17, 0, doc);
  t.is(layer.pixelKey(), source, 'round-trip movement never resamples or copies pixels');
  t.eq(layer.contentBounds(), { x: 0, y: 2, width: 6, height: 4 }, 'all six columns return');
  t.eq(t.inked(layer.canvas), 24, 'hidden pixels were retained');
});

suite('off-canvas / region edits replace alpha and keep hidden pixels and history', (t) => {
  const doc = { width: 10, height: 8 };
  const layer = new Layer();
  layer.setPixelSource(solid(6, 4, '#ff0000'), -3, 2, doc);
  const before = layer.snapshot();
  const erase = createCanvas(2, 2);
  layer.beginEdit();
  layer.commitPixelRegion(doc, { x: 0, y: 2, width: 2, height: 2 }, erase);
  t.pixel(layer.canvas, 0, 2, '0,0,0,0', 'transparent edits erase rather than blend over pixels');
  t.pixel(layer.getPixelSource().canvas, 0, 0, '255,0,0,255', 'pixels outside the document remain unchanged');
  t.isNot(layer.pixelKey(), before.tile.canvas, 'the edit installs a private replacement');
  const undo = Layer.fromSnapshot(before);
  t.pixel(undo.canvas, 0, 2, '255,0,0,255', 'the history source was not mutated');
  const paint = solid(2, 2, '#0000ff');
  layer.commitPixelRegion(doc, { x: 5, y: 1, width: 2, height: 2 }, paint);
  t.eq(layer.getPixelSource().x, -3, 'an extending edit retains the old origin');
  t.pixel(layer.canvas, 5, 1, '0,0,255,255', 'new pixels land at their document coordinates');
  t.pixel(layer.getPixelSource().canvas, 0, 1, '255,0,0,255', 'extending the source keeps hidden content');
});

suite('off-canvas / mask source has its own position and outside coverage', (t) => {
  const doc = { width: 10, height: 8 };
  const layer = new Layer();
  layer.setPixelSource(solid(4, 4, '#ff0000'), -2, 1, doc);
  layer.setMaskSource(solid(2, 2, '#000000'), -1, 2, 255, doc);
  const before = layer.snapshot();
  t.pixel(layer.mask, 0, 2, '0,0,0,255', 'stored mask pixels use the mask position');
  t.pixel(layer.mask, 5, 5, '255,255,255,255', 'unstored mask area uses the explicit default');
  layer.translatePixels(2, 0, doc);
  t.eq(layer.getMaskSource().x, -1, 'moving pixels alone leaves an unlinked mask fixed');
  layer.translateMask(2, 0, doc);
  t.eq(layer.getMaskSource().x, 1, 'linked movement can shift the mask independently');
  t.pixel(layer.maskAlphaCanvas(), 1, 2, '0,0,0,0', 'mask alpha uses document-space mask coverage');
  layer.commitMaskRegion(doc, { x: 1, y: 2, width: 1, height: 1 }, solid(1, 1, '#ffffff'));
  t.pixel(layer.maskAlphaCanvas(), 1, 2, '0,0,0,255', 'mask commit invalidates the alpha projection');
  const undo = Layer.fromSnapshot(before);
  t.eq(undo.getMaskSource().x, -1, 'history restores the independent mask position');
  t.eq(undo.getMaskSource().defaultValue, 255, 'history restores unstored coverage');
  const clone = undo.clone();
  t.isNot(clone.getMaskSource().canvas, undo.getMaskSource().canvas, 'duplicated masks own their buffer');
});

suite('off-canvas / bounds cache is local when sources are shared across positions', (t) => {
  const doc = { width: 10, height: 8 };
  const pixels = solid(2, 3, '#00ff00');
  const a = new Layer().setPixelSource(pixels, -2, 1, doc);
  const b = new Layer().setPixelSource(pixels, 5, 4, doc);
  t.eq(layerBounds(a), { x: -2, y: 1, width: 2, height: 3 }, 'first layer measures at its position');
  t.eq(layerBounds(b), { x: 5, y: 4, width: 2, height: 3 }, 'shared buffer does not share document coordinates');
  const before = a.snapshot();
  a.translatePixels(4, -2, doc);
  t.eq(peekBounds(a), { x: 2, y: -1, width: 2, height: 3 }, 'a cache hit adds the current position');
  t.eq(layerBounds(Layer.fromSnapshot(before)), { x: -2, y: 1, width: 2, height: 3 }, 'undo gets original coordinates with the same source');
  t.eq(layerBounds(b), { x: 5, y: 4, width: 2, height: 3 }, 'moving one layer leaves the other cache user unchanged');
});

suite('off-canvas / rejected allocations leave pixels and position intact', async (t) => {
  const doc = { width: 10, height: 8 };
  const layer = new Layer().setPixelSource(solid(2, 2, '#00ff00'), 1000000, 0, doc);
  const before = layer.getPixelSource();
  await t.throws(() => layer.commitPixelRegion(doc, { x: 0, y: 0, width: 1, height: 1 }, solid(1, 1, '#ff0000')), 'distant edit is rejected before an enormous union is allocated');
  t.is(layer.pixelKey(), before.canvas, 'rejected edit keeps the existing pixels');
  t.eq(layer.getPixelSource().x, before.x, 'rejected edit keeps position');
  await t.throws(() => layer.setPixelSource(before.canvas, Infinity, 0, doc), 'non-finite positions are rejected');
  await t.throws(() => checkPixelAllocation(10, 10, 100, 400), 'allocation check counts simultaneous input buffers');
  await t.throws(() => layer.commitPixelRegion(doc, { x: 0, y: 0, width: 2, height: 2 }, createCanvas(1, 1)), 'edit dimensions must match their region');
});
