import { suite } from '../harness.js';
import { Layer } from '../../src/core/layer.js';
import { createCanvas } from '../../src/core/util.js';
import { nudgeLayers, pickLayerAt } from '../../src/tools/move.js';
import { startTransform, setTransformNumeric, getTransformNumeric, commitTransform, cancelTransform } from '../../src/tools/transform.js';
import { getComposite, flattenCompleteLayers } from '../../src/render/compositor.js';
import { mergeDown, applyLayerMask, rasterizeLayer } from '../../src/layers/ops.js';
import { createSmartObject, getSmartTransform } from '../../src/core/smart.js';
import { savePKD, loadPKD } from '../../src/io/pkd.js';
import { CanvasView } from '../../src/ui/canvas-view.js';
import { artworkOf } from '../../src/ui/cross-doc-drag.js';

function fixture(t) {
  const doc = t.doc(20, 16, 'transparent');
  const canvas = createCanvas(12, 10);
  const c = canvas.getContext('2d');
  c.fillStyle = '#ff0000'; c.fillRect(0, 0, 6, 10);
  c.fillStyle = '#0000ff'; c.fillRect(6, 0, 6, 10);
  const layer = new Layer({ name: 'edges' }).setPixelSource(canvas, 4, 3, doc);
  doc.addLayer(layer);
  doc.commit('Fixture');
  return { doc, layer };
}

suite('off-canvas / separate pointer drags preserve all four edges and cancellation', (t) => {
  const { doc, layer } = fixture(t);
  t.app.setTool('move');
  const move = t.app.tool;
  const settings = { ...move.state };
  move.state = { ...move.state, autoSelect: false, showTransform: false };
  const original = layer.pixelKey();
  const drag = (dx, dy) => {
    move.onPointerDown({ x: 8, y: 7, ctrlKey: false, metaKey: false, shiftKey: false });
    move.onPointerMove({ x: 8 + dx, y: 7 + dy, ctrlKey: true, shiftKey: false });
    move.onPointerUp({});
  };
  try {
    for (const [dx, dy] of [[-30, 0], [30, 0], [0, -30], [0, 30], [-30, -30]]) {
      drag(dx, dy);
      t.is(layer.pixelKey(), original, 'drag preserves the original pixel buffer');
      drag(-dx, -dy);
      t.eq([layer.getPixelSource().x, layer.getPixelSource().y], [4, 3], 'a separate return drag restores position');
      t.eq(t.mad(t.bytes(layer.pixelKey()), t.bytes(original)), 0, 'every edge remains bit exact');
    }
    move.onPointerDown({ x: 8, y: 7, ctrlKey: false, metaKey: false });
    move.onPointerMove({ x: -100, y: -100, ctrlKey: true });
    move.cancel();
    t.eq([layer.getPixelSource().x, layer.getPixelSource().y], [4, 3], 'Escape restores the starting location');
    t.pixel(getComposite(doc), 5, 4, '255,0,0,255', 'original red edge remains visible');
    const history = doc.history.states.length;
    move.onPointerDown({ x: 8, y: 7, ctrlKey: false, metaKey: false });
    move.onPointerMove({ x: -30, y: 7, ctrlKey: true });
    t.app.setTool('brush');
    t.eq(doc.history.states.length, history + 1, 'switching tools commits an active move once');
    doc.history.undo();
    t.eq(doc.findLayer(layer.id).getPixelSource().x, 4, 'the interrupted move remains undoable');
  } finally { move.state = settings; }
});

suite('off-canvas / nudge, linked masks, history and project reload preserve full sources', async (t) => {
  const { doc, layer } = fixture(t);
  const mask = createCanvas(12, 10);
  const c = mask.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 12, 10);
  layer.setMaskSource(mask, 4, 3, 0, doc);
  doc.commit('Mask');
  const original = layer.pixelKey();
  nudgeLayers(doc, -40, -20);
  t.is(layer.pixelKey(), original, 'nudge keeps the pixel source identity');
  t.eq([layer.getMaskSource().x, layer.getMaskSource().y], [-36, -17], 'linked mask moves with its layer');
  const restored = await loadPKD(await (await savePKD(doc)).arrayBuffer());
  const copy = restored.findLayer(layer.id);
  copy.translatePixels(40, 20, restored); copy.translateMask(40, 20, restored);
  t.pixel(copy.canvas, 5, 4, '255,0,0,255', 'source can return after saving fully off canvas');
  doc.history.undo();
  t.eq(doc.findLayer(layer.id).getPixelSource().x, 4, 'undo restores original position');
  doc.history.redo();
  t.eq(doc.findLayer(layer.id).getPixelSource().x, -36, 'redo restores the off-canvas position');
});

suite('off-canvas / separate free transform sessions do not crop outside the viewport', (t) => {
  const { doc, layer } = fixture(t);
  const bytes = t.bytes(layer.pixelKey());
  startTransform(doc);
  let current = getTransformNumeric();
  setTransformNumeric({ x: current.x - 30, y: current.y - 30 });
  commitTransform();
  t.eq(layer.getPixelSource().x, -26, 'first session commits outside the document');
  startTransform(doc);
  current = getTransformNumeric();
  setTransformNumeric({ x: current.x + 30, y: current.y + 30 });
  commitTransform();
  t.eq([layer.getPixelSource().x, layer.getPixelSource().y], [4, 3], 'second session brings the full source back');
  t.eq(t.mad(t.bytes(layer.pixelKey()), bytes), 0, 'integer translation does not resample or crop');
  startTransform(doc);
  setTransformNumeric({ angle: 90 });
  cancelTransform();
  t.eq(t.mad(t.bytes(layer.pixelKey()), bytes), 0, 'cancelling rotation restores the complete source');
});

suite('off-canvas / complete merging and mask baking retain hidden source pixels', (t) => {
  const { doc, layer } = fixture(t);
  layer.translatePixels(-10, 0, doc);
  const flattened = flattenCompleteLayers(doc, [layer]);
  t.eq(flattened.x, -6, 'complete flattening retains negative bounds');
  t.pixel(flattened.canvas, 0, 0, '255,0,0,255', 'complete flatten includes hidden red pixels');
  t.pixel(artworkOf(doc, [layer]), 0, 0, '255,0,0,255', 'cross-document copy includes hidden red pixels');
  const mask = createCanvas(12, 10);
  const c = mask.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, 12, 10);
  layer.setMaskSource(mask, -6, 3, 0, doc);
  applyLayerMask(doc, layer);
  t.eq(layer.getPixelSource().x, -6, 'baking the mask retains the negative origin');
  t.pixel(layer.pixelKey(), 0, 0, '255,0,0,255', 'baking retains visible mask coverage outside the document');
  const merged = mergeDown(doc, layer);
  t.eq(merged.getPixelSource().x, -6, 'merge down includes off-canvas source bounds');
});

suite('off-canvas / smart movement and rasterization retain off-canvas contents', (t) => {
  const { doc, layer } = fixture(t);
  layer.translatePixels(-10, 0, doc);
  const smart = createSmartObject(doc, [layer]);
  nudgeLayers(doc, -50, 0);
  t.eq(getSmartTransform(smart)[4], -56, 'ordinary move updates the authored smart transform');
  nudgeLayers(doc, 50, 0);
  t.eq(getSmartTransform(smart)[4], -6, 'moving back restores the transform');
  rasterizeLayer(doc, smart);
  t.eq(smart.getPixelSource().x, -6, 'rasterization retains the full render origin');
  smart.translatePixels(10, 0, doc);
  t.pixel(smart.canvas, 5, 4, '255,0,0,255', 'hidden pixels survive conversion, movement and rasterization');
});

suite('off-canvas / rejected transforms restore pixels, masks, positions and history', (t) => {
  const { doc, layer } = fixture(t);
  const original = layer.getPixelSource();
  const history = doc.history.states.length;
  startTransform(doc);
  setTransformNumeric({ scaleX: 1000000, scaleY: 1000000 });
  t.eq(t.app.transformSession, null, 'oversized transform cancels the session');
  t.is(layer.pixelKey(), original.canvas, 'failed transform restores the original buffer');
  t.eq([layer.getPixelSource().x, layer.getPixelSource().y], [original.x, original.y], 'failed transform restores source coordinates');
  t.eq(doc.history.states.length, history, 'failed transform adds no history entry');
});

suite('off-canvas / pointer errors cancel editing and report the allocation failure', (t) => {
  const tool = t.app.tool;
  let cancelled = false, released = false, warning = '';
  const off = t.app.on('toast', (event) => { warning = event.message; });
  const view = Object.assign(Object.create(CanvasView.prototype), {
    _pointerDown: true,
    _lastDoc: { x: 1, y: 1 },
    canvas: { hasPointerCapture: () => true, releasePointerCapture: () => { released = true; } },
  });
  t.app.tool = {
    onPointerMove() { throw new Error('pixel budget exceeded'); },
    cancel() { cancelled = true; },
  };
  try {
    t.notOk(view._toolEvent('onPointerMove', {}, { pointerId: 1 }), 'failed event is not reported as successful');
    t.ok(cancelled && released, 'failure cancels the tool and releases its pointer');
    t.notOk(view._pointerDown, 'the gesture is no longer active');
    t.eq(warning, 'pixel budget exceeded', 'the user receives the actual failure message');
  } finally { t.app.tool = tool; off(); }
});

suite('off-canvas / masked hit testing reads only the source pixel and outside coverage', (t) => {
  const { doc, layer } = fixture(t);
  layer.setMaskSource(createCanvas(1, 1), 4, 3, 255, doc);
  let projections = 0;
  const originalPixels = layer.projectPixels, originalMask = layer.projectMask;
  layer.projectPixels = function (...args) { projections++; return originalPixels.apply(this, args); };
  layer.projectMask = function (...args) { projections++; return originalMask.apply(this, args); };
  try {
    t.eq(pickLayerAt(doc, 4, 3), null, 'transparent stored mask coverage hides its pixel');
    t.is(pickLayerAt(doc, 5, 4), layer, 'white outside coverage makes the layer selectable');
    t.eq(projections, 0, 'single-pixel hit testing allocates no document-sized projections');
  } finally { layer.projectPixels = originalPixels; layer.projectMask = originalMask; }
});
