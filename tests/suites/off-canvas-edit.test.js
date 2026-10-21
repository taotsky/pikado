import { suite } from '../harness.js';
import { createCanvas } from '../../src/core/util.js';
import { createRasterLayer } from '../../src/core/layer.js';
import { processSurface, commitSurface } from '../../src/filters/run.js';
import { clear } from '../../src/edit/clipboard.js';
import { placeAsLayer } from '../../src/io/open.js';
import { transformLayers } from '../../src/commands/image-ops.js';
import { createShapeLayer, refreshShapeLayer } from '../../src/vector/path.js';
import { translateLayerGeometry } from '../../src/core/layer.js';
import { showImageSizeDialog } from '../../src/ui/dialogs/image-size.js';
import { convertToProfile } from '../../src/color/manage.js';
import { getProfile } from '../../src/color/icc.js';
import '../../src/tools/brush.js';
import '../../src/tools/eraser.js';
import '../../src/tools/gradient.js';
import '../../src/tools/crop.js';

function sourceLayer(t, doc) {
  const pixels = createCanvas(24, 16);
  const c = pixels.getContext('2d');
  c.fillStyle = '#0000ff';
  c.fillRect(0, 0, 24, 16);
  c.fillStyle = '#ff0000';
  c.fillRect(0, 0, 8, 16);
  const layer = createRasterLayer(doc.width, doc.height, 'off-canvas');
  layer.setPixelSource(pixels, -8, 0, doc);
  doc.addLayer(layer);
  doc.setActiveLayer(layer.id);
  doc.commit('Fixture');
  return layer;
}

suite('off-canvas / brush commits a private projection and preserves hidden pixels', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const layer = sourceLayer(t, doc);
  const oldTool = t.app.tool?.id;
  const oldForeground = t.app.foreground;
  t.app.setTool('brush');
  const brush = t.app.tool;
  const oldState = brush.state;
  brush.state = { ...oldState, size: 4, hardness: 100, opacity: 100, flow: 100, smoothing: 0, pressureSize: false };
  t.app.setForeground({ r: 0, g: 255, b: 0, a: 1 });
  const event = { x: 8, y: 8, button: 0, pressure: 1, altKey: false };
  try {
    t.is(brush.doc, doc, 'the registered brush is bound to the live document');
    const original = layer.pixelKey();
    brush.onPointerDown(event);
    t.ok(brush.stroke, 'pointer-down starts the real brush stroke');
    t.is(layer.pixelKey(), original, 'preview does not mutate the authoritative source');
    brush.cancel();
    t.is(layer.pixelKey(), original, 'cancel keeps the original source');
    brush.onPointerDown(event);
    brush.onPointerUp();
    t.pixel(layer.canvas, 8, 8, '0,255,0,255', 'stroke reaches the layer');
    const src = layer.getPixelSource();
    t.eq(src.x, -8, 'hidden source position remains');
    t.pixel(src.canvas, 0, 8, '255,0,0,255', 'hidden red edge survives painting');
    doc.history.undo();
    t.pixel(doc.findLayer(layer.id).canvas, 8, 8, '0,0,255,255', 'undo restores the visible pixels');
    doc.history.redo();
    t.pixel(doc.findLayer(layer.id).getPixelSource().canvas, 0, 8, '255,0,0,255', 'redo retains the hidden edge');
  } finally {
    brush.cancel();
    brush.state = oldState;
    t.app.setForeground(oldForeground);
    if (oldTool) t.app.setTool(oldTool);
  }
});

suite('off-canvas / filter and clear preserve pixels outside the document', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const layer = sourceLayer(t, doc);
  const output = processSurface(doc, layer, (pixels) => {
    for (let i = 0; i < pixels.data.length; i += 4) {
      pixels.data[i + 1] = 255;
      pixels.data[i + 2] = 0;
    }
    return pixels;
  });
  commitSurface(doc, layer, output, 'Filter');
  t.pixel(layer.canvas, 8, 8, '0,255,0,255', 'filter commits visible pixels');
  t.pixel(layer.getPixelSource().canvas, 0, 8, '255,0,0,255', 'filter preserves the hidden edge');
  clear(doc);
  t.pixel(layer.canvas, 8, 8, '0,0,0,0', 'clear commits erased alpha');
  t.pixel(layer.getPixelSource().canvas, 0, 8, '255,0,0,255', 'clear preserves pixels outside its document region');
});

suite('off-canvas / local placement keeps a compact complete source', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const pixels = createCanvas(8, 8);
  const c = pixels.getContext('2d');
  c.fillStyle = '#ff0000';
  c.fillRect(0, 0, 8, 8);
  const layer = placeAsLayer(doc, pixels, 'local');
  const src = layer.getPixelSource();
  t.eq([src.x, src.y, src.canvas.width, src.canvas.height], [4, 4, 8, 8], 'placement keeps contain sizing and centered source');
  t.pixel(layer.canvas, 4, 4, '255,0,0,255', 'the source is rendered at its document position');
});

suite('off-canvas / eraser and mask brush commit alpha without losing hidden source', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const layer = sourceLayer(t, doc);
  const previous = t.app.tool?.id;
  const foreground = t.app.foreground;
  const event = { x: 8, y: 8, button: 0, pressure: 1, altKey: false };
  t.app.setTool('eraser');
  const eraser = t.app.tool;
  const eraserState = eraser.state;
  eraser.state = { ...eraserState, size: 4, hardness: 100, opacity: 100, flow: 100, smoothing: 0, pressureSize: false, eraseToHistory: false };
  try {
    eraser.onPointerDown(event);
    eraser.onPointerUp();
    t.pixel(layer.canvas, 8, 8, '0,0,0,0', 'eraser commits transparent pixels');
    t.pixel(layer.getPixelSource().canvas, 0, 8, '255,0,0,255', 'eraser preserves hidden pixels');
    const mask = createCanvas(24, 16);
    const c = mask.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, 24, 16);
    c.fillStyle = '#808080'; c.fillRect(0, 0, 8, 16);
    layer.setMaskSource(mask, -8, 0, 255, doc);
    layer.editingMask = true;
    t.app.setTool('brush');
    const brush = t.app.tool;
    const state = brush.state;
    brush.state = { ...state, size: 4, hardness: 100, opacity: 100, flow: 100, smoothing: 0, pressureSize: false };
    t.app.setForeground('#000000');
    try {
      const original = layer.getMaskSource().canvas;
      brush.onPointerDown(event);
      brush.cancel();
      t.is(layer.getMaskSource().canvas, original, 'cancelled mask preview keeps its complete source');
      brush.onPointerDown(event);
      brush.onPointerUp();
      t.pixel(layer.mask, 8, 8, '0,0,0,255', 'mask paint reaches document coordinates');
      const source = layer.getMaskSource();
      t.pixel(source.canvas, 0, 8, '128,128,128,255', 'hidden mask values survive');
      t.eq([source.x, source.defaultValue], [-8, 255], 'mask origin and default coverage survive');
    } finally { brush.cancel(); brush.state = state; }
  } finally {
    eraser.cancel(); eraser.state = eraserState;
    t.app.setForeground(foreground);
    if (previous) t.app.setTool(previous);
  }
});

suite('off-canvas / gradient cancellation and selected-layer flips preserve complete pixels', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const layer = sourceLayer(t, doc);
  const previous = t.app.tool?.id;
  t.app.setTool('gradient');
  const tool = t.app.tool;
  const event = { x: 2, y: 2, button: 0, pressure: 1, shiftKey: false };
  try {
    const original = layer.pixelKey();
    tool.onPointerDown(event);
    tool.onPointerMove({ ...event, x: 14 });
    tool.cancel();
    t.is(layer.pixelKey(), original, 'cancel discards the gradient preview');
    tool.onPointerDown(event);
    tool.onPointerMove({ ...event, x: 14 });
    tool.onPointerUp();
    t.pixel(layer.getPixelSource().canvas, 0, 8, '255,0,0,255', 'gradient keeps the hidden edge');
    const before = t.bytes(layer.getPixelSource().canvas);
    transformLayers(doc, [layer], 'flip-h');
    transformLayers(doc, [layer], 'flip-h');
    t.eq(layer.getPixelSource().x, -8, 'two flips restore the negative source origin');
    t.eq(t.mad(t.bytes(layer.getPixelSource().canvas), before), 0, 'two flips preserve every complete source pixel');
  } finally {
    tool.cancel();
    if (previous) t.app.setTool(previous);
  }
});

suite('off-canvas / authored shapes rerender their complete bounds', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const points = [{ x: -8, y: 4 }, { x: 12, y: 4 }, { x: 12, y: 12 }, { x: -8, y: 12 }];
  const layer = createShapeLayer(doc, [{ closed: true, points }], { fill: '#ff0000' });
  doc.addLayer(layer);
  t.lt(layer.getPixelSource().x, 0, 'renderer stores the negative shape bounds');
  translateLayerGeometry(layer, 8, 0);
  refreshShapeLayer(doc, layer);
  t.pixel(layer.canvas, 2, 8, '255,0,0,255', 'hidden left part is recovered by rerendering the moved geometry');
});

suite('off-canvas / rotated crop reads preserved pixels and non-deleting crop keeps them', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const layer = sourceLayer(t, doc);
  const previous = t.app.tool?.id;
  t.app.setTool('crop');
  const crop = t.app.tool;
  const state = crop.state;
  crop.state = { ...state, deleteCropped: true };
  try {
    crop.rect = { x: -8, y: 0, width: 24, height: 16 };
    crop.angle = Math.PI / 4;
    crop.applyCrop();
    t.pixel(doc.findLayer(layer.id).canvas, 6, 13, '255,0,0,255', 'rotated crop includes the preserved red edge outside the old document');
    doc.history.undo();
    t.eq([doc.width, doc.height], [16, 16], 'undo restores the original document size');
    crop.state = { ...state, deleteCropped: false };
    crop.rect = { x: 4, y: 4, width: 8, height: 8 };
    crop.angle = 0;
    crop.applyCrop();
    t.eq([doc.width, doc.height], [8, 8], 'non-deleting crop uses the chosen document frame');
    const source = doc.findLayer(layer.id).getPixelSource();
    t.eq([source.x, source.y, source.canvas.width], [-12, -4, 24], 'non-deleting crop only shifts complete layer coordinates');
    t.pixel(source.canvas, 0, 8, '255,0,0,255', 'pixels outside the new frame remain intact');
  } finally {
    crop.cancel(); crop.state = state;
    if (previous) t.app.setTool(previous);
  }
});

suite('off-canvas / perspective crop samples complete sources and rejects allocations atomically', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const layer = sourceLayer(t, doc);
  const previous = t.app.tool?.id;
  t.app.setTool('crop-perspective');
  const crop = t.app.tool;
  try {
    const quad = [{ x: -8, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 16 }, { x: -8, y: 16 }];
    crop.quad = quad;
    const original = layer.pixelKey();
    const historyLength = doc.history.states.length;
    doc.memoryLimitMB = 0.001;
    await t.throws(() => crop.apply(), 'oversize preparation is rejected');
    t.is(layer.pixelKey(), original, 'rejected crop does not replace any layer source');
    t.eq([doc.width, doc.height, doc.history.states.length], [16, 16, historyLength], 'rejected crop preserves dimensions and history');
    delete doc.memoryLimitMB;
    crop.quad = quad;
    crop.apply();
    t.eq([doc.width, doc.height], [24, 16], 'perspective crop uses its full selected rectangle');
    t.pixel(doc.findLayer(layer.id).canvas, 4, 8, '255,0,0,255', 'perspective sampling reads the hidden source edge');
    doc.history.undo();
    t.eq(doc.findLayer(layer.id).getPixelSource().x, -8, 'undo restores the source offset');
  } finally {
    delete doc.memoryLimitMB;
    crop.cancel();
    if (previous) t.app.setTool(previous);
  }
});

suite('off-canvas / image size restores the original state when a later stage fails', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const layer = sourceLayer(t, doc);
  const source = layer.getPixelSource();
  const length = doc.history.states.length;
  const dirty = doc.dirty;
  const resample = doc.resample;
  doc.resample = function(...args) {
    resample.apply(this, args);
    throw new Error('injected failure after resampling');
  };
  try {
    const pending = showImageSizeDialog(doc);
    const dialog = document.querySelector('.pkd-imagesize');
    const width = dialog.querySelector('input[type="number"]');
    width.value = '8';
    width.dispatchEvent(new Event('input', { bubbles: true }));
    dialog.querySelector('.pk-dialog-footer .primary').click();
    await pending;
    const restored = doc.findLayer(layer.id).getPixelSource();
    t.eq([doc.width, doc.height, doc.history.states.length, doc.dirty], [16, 16, length, dirty], 'failed resize restores dimensions, history and dirty state');
    t.is(restored.canvas, source.canvas, 'failed resize restores the complete original buffer');
    t.eq([restored.x, restored.y], [source.x, source.y], 'failed resize restores its negative origin');
  } finally { doc.resample = resample; }
});

suite('off-canvas / profile conversion checks its complete source budget before replacement', async (t) => {
  const doc = t.doc(16, 16, '#ffffff');
  const layer = sourceLayer(t, doc);
  doc.profile = getProfile('srgb');
  const source = layer.getPixelSource();
  const before = doc.profile;
  const history = doc.history.states.length;
  doc.memoryLimitMB = 0.001;
  try {
    await t.throws(() => convertToProfile(doc, 'display-p3'), 'conversion rejects an insufficient complete-source budget');
    const restored = doc.findLayer(layer.id).getPixelSource();
    t.is(restored.canvas, source.canvas, 'failed conversion restores the original pixels');
    t.eq([restored.x, restored.y, doc.history.states.length], [-8, 0, history], 'failed conversion preserves position and history');
    t.is(doc.profile, before, 'failed conversion preserves the profile');
  } finally { delete doc.memoryLimitMB; }
});
