import { suite } from '../harness.js';
import { PikaDocument } from '../../src/core/document.js';
import { Layer, LayerType } from '../../src/core/layer.js';
import { createCanvas, ctx2d } from '../../src/core/util.js';

function pixels(width = 4, height = 2, color = '#ff0000') {
  const cv = createCanvas(width, height);
  const c = ctx2d(cv);
  c.fillStyle = color;
  c.fillRect(0, 0, width, height);
  return cv;
}

function documentWithLayer() {
  const doc = new PikaDocument({ width: 10, height: 8 });
  const layer = new Layer({ type: LayerType.RASTER });
  layer.setPixelSource(pixels(), -2, 2, doc);
  layer.setMaskSource(pixels(2, 2, '#000000'), -1, 2, 255, doc);
  layer.maskLinked = false;
  doc.addLayer(layer);
  doc.history.clear('fixture');
  return { doc, layer };
}

suite('off-canvas / document construction and layer insertion bind projection dimensions', (t) => {
  const blank = PikaDocument.blank(10, 8, 'blank', '#ffffff');
  t.pixel(blank.activeLayer().canvas, 2, 2, '255,255,255,255', 'blank fills the private initial source');
  const photo = PikaDocument.fromImage(pixels(), 'image');
  t.pixel(photo.activeLayer().canvas, 2, 1, '255,0,0,255', 'opening an image fills its source');
  const group = new Layer({ type: LayerType.GROUP });
  const child = new Layer({ canvas: pixels() });
  group.children.push(child);
  child.parent = group;
  blank.addLayer(group);
  t.eq([child.canvas.width, child.canvas.height], [10, 8], 'inserted group children project at the target size');
});

suite('off-canvas / shrinking and expanding a canvas only shifts source origins', (t) => {
  const { doc, layer } = documentWithLayer();
  const source = layer.pixelKey(), mask = layer.getMaskSource().canvas;
  doc.resizeCanvasTo(6, 4, 'center');
  doc.commit('Shrink');
  t.is(layer.pixelKey(), source, 'canvas sizing does not copy or resample pixels');
  t.is(layer.getMaskSource().canvas, mask, 'canvas sizing does not resample the mask');
  t.eq([layer.getPixelSource().x, layer.getPixelSource().y], [-4, 0], 'center anchor shifts complete source');
  t.eq([layer.getMaskSource().x, layer.getMaskSource().y], [-3, 0], 'unlinked mask follows the document coordinate change');
  doc.resizeCanvasTo(10, 8, 'center');
  doc.commit('Expand');
  t.eq(layer.contentBounds(), { x: -2, y: 2, width: 4, height: 2 }, 'the original complete bounds return');
  t.is(layer.pixelKey(), source, 'hidden columns survived both size changes');
  doc.history.undo();
  t.eq([doc.width, doc.height, doc.activeLayer().getPixelSource().x], [6, 4, -4], 'undo restores document size and source position together');
  doc.history.redo();
  t.eq([doc.width, doc.height, doc.activeLayer().getPixelSource().x], [10, 8, -2], 'redo restores the expanded state');
});

suite('off-canvas / resampling scales complete local buffers by document ratios', (t) => {
  const { doc, layer } = documentWithLayer();
  const before = layer.snapshot();
  doc.resample(20, 4, 'nearest');
  const source = layer.getPixelSource();
  t.eq([source.x, source.y, source.canvas.width, source.canvas.height], [-4, 1, 8, 1], 'source scales 2x horizontally and 0.5x vertically');
  const mask = layer.getMaskSource();
  t.eq([mask.x, mask.y, mask.canvas.width, mask.canvas.height], [-2, 1, 4, 1], 'unlinked mask follows the same document scaling');
  t.eq(mask.defaultValue, 255, 'resampling keeps unstored mask coverage');
  t.pixel(source.canvas, 0, 0, '255,0,0,255', 'off-canvas source content was resampled too');
  t.eq([before.tile.canvas.width, before.tile.canvas.height], [4, 2], 'the prior source remains unchanged for undo');
});

suite('off-canvas / document quarter turns and flips preserve the complete source', (t) => {
  for (const [kind, expected] of [
    ['cw', [4, -2, 2, 4]], ['ccw', [2, 8, 2, 4]],
    ['180', [8, 4, 4, 2]], ['flip-h', [8, 2, 4, 2]], ['flip-v', [-2, 4, 4, 2]],
  ]) {
    const { doc, layer } = documentWithLayer();
    doc.transformImage(kind);
    const s = layer.getPixelSource();
    t.eq([s.x, s.y, s.canvas.width, s.canvas.height], expected, `${kind}: bounds include formerly hidden content`);
    t.eq(t.inked(s.canvas), 8, `${kind}: every original pixel is retained`);
    t.eq(layer.getMaskSource().defaultValue, 255, `${kind}: mask outside coverage stays unchanged`);
  }
});

suite('off-canvas / explicit cropping removes only content outside its rectangle', (t) => {
  const { doc, layer } = documentWithLayer();
  doc.crop({ x: -1, y: 1, width: 4, height: 4 });
  doc.commit('Crop');
  const source = layer.getPixelSource();
  t.eq([source.x, source.y, source.canvas.width, source.canvas.height], [0, 1, 3, 2], 'the cut source is clipped in the new coordinate system');
  t.eq(t.inked(source.canvas), 6, 'only the column beyond the crop was removed');
  doc.history.undo();
  t.eq(doc.activeLayer().contentBounds(), { x: -2, y: 2, width: 4, height: 2 }, 'undo restores pixels deleted by an explicit crop');
});

suite('off-canvas / geometry allocation failure changes no layer or document state', async (t) => {
  const { doc, layer } = documentWithLayer();
  const second = new Layer({ canvas: pixels() });
  doc.addLayer(second);
  const source = layer.pixelKey(), mask = layer.getMaskSource().canvas;
  const secondSource = second.pixelKey(), historyIndex = doc.history.index;
  doc.memoryLimitMB = 0.0001;
  await t.throws(() => doc.resample(100, 80), 'an over-budget document scale is rejected');
  t.eq([doc.width, doc.height], [10, 8], 'document size was not changed');
  t.is(layer.pixelKey(), source, 'first layer retained its source');
  t.is(second.pixelKey(), secondSource, 'second layer retained its source');
  t.is(layer.getMaskSource().canvas, mask, 'mask was not partially replaced');
  t.eq(doc.history.index, historyIndex, 'failed geometry did not create a history step');
});

suite('off-canvas / affine quarter turns do not pad bounds and preserve smart geometry', (t) => {
  const { doc, layer } = documentWithLayer();
  const source = new PikaDocument({ width: 2, height: 2 });
  layer.type = LayerType.SMART;
  const perspective = [0.001, 0.002];
  const warp = Array.from({ length: 4 }, (_, y) => Array.from({ length: 4 }, (_, x) => ({ x: x * 2 / 3, y: y * 2 / 3 })));
  layer.smart = { source, transform: { matrix: [1, 0, 0, 1, -2, 2], perspective, warp } };
  doc.transformAffine(new DOMMatrix().translate(8, 0).rotate(90), 8, 10);
  const s = layer.getPixelSource();
  t.eq([s.x, s.y, s.canvas.width, s.canvas.height], [4, -2, 2, 4], 'a floating-point quarter turn has the same bounds as an integer matrix');
  const matrix = layer.smart.transform.matrix;
  t.close(matrix[0], 0, 1e-9, 'smart affine x coefficient rotates');
  t.close(matrix[1], 1, 1e-9, 'smart affine y coefficient rotates');
  t.close(matrix[4], 6, 1e-9, 'smart origin is mapped in document coordinates');
  t.close(matrix[5], -2, 1e-9, 'negative smart origin is retained');
  t.is(layer.smart.source, source, 'document transforms keep the embedded source');
  t.is(layer.smart.transform.perspective, perspective, 'left affine composition keeps the perspective row');
  t.is(layer.smart.transform.warp, warp, 'source-space warp data remains unchanged');
});
