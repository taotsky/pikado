import { suite } from '../harness.js';
import { createCanvas, ctx2d } from '../../src/core/util.js';
import { applyMatrix3, unitSquareToQuad, createSmartObject, setSmartTransform } from '../../src/core/smart.js';
import { startTransform, setTransformNumeric, commitTransform, cancelTransform } from '../../src/tools/transform.js';
import { compositeDocument } from '../../src/render/compositor.js';
import { defaultStyle, effectReach } from '../../src/effects/styles.js';

function solid(size, color) {
  const cv = createCanvas(size, size);
  const c = ctx2d(cv);
  c.fillStyle = color;
  c.fillRect(0, 0, size, size);
  return cv;
}

function fixture(t, maskSize, maskX, maskY, defaultValue) {
  const doc = t.doc(100, 100, 'transparent', 'nonlinear-mask');
  const layer = doc.activeLayer();
  layer.setPixelSource(solid(20, '#ff0000'), 30, 30, doc);
  layer.setMaskSource(solid(maskSize, defaultValue === 255 ? '#000000' : '#ffffff'), maskX, maskY, defaultValue, doc);
  doc.history.clear('fixture');
  return { doc, layer };
}

suite('off-canvas / identity warp keeps linked mask content outside the image bounds', (t) => {
  const { doc, layer } = fixture(t, 80, 0, 0, 0);
  const before = layer.snapshot();
  try {
    startTransform(doc, { mode: 'warp' });
    setTransformNumeric({});
    commitTransform();
    const mask = layer.getMaskSource();
    t.ok(mask.x <= 0 && mask.y <= 0 && mask.x + mask.canvas.width >= 80 && mask.y + mask.canvas.height >= 80,
      'the complete mask is retained, including its domain outside the image');
    t.pixel(layer.mask, 10, 10, '255,255,255,255', 'white mask pixels outside the image still exist');
    t.pixel(layer.mask, 65, 65, '255,255,255,255', 'the opposite mask corner also survives');
    t.pixel(layer.maskAlphaCanvas(), 40, 40, '0,0,0,255', 'the visible image remains unmasked');
    doc.history.undo();
    t.is(doc.activeLayer().getMaskSource().canvas, before.mask, 'undo restores the original complete mask buffer');
  } finally { cancelTransform(); }
});

suite('off-canvas / nonlinear masks preserve their unstored white coverage', (t) => {
  for (const mode of ['warp', 'perspective']) {
    const { doc, layer } = fixture(t, 2, 31, 31, 255);
    try {
      const session = startTransform(doc, { mode });
      if (mode === 'perspective') {
        session.quad[1].x -= 5;
        session.freeform = true;
      }
      setTransformNumeric({});
      commitTransform();
      t.eq(layer.getMaskSource().defaultValue, 255, `${mode}: the unstored mask value is retained`);
      t.pixel(layer.mask, 42, 42, '255,255,255,255', `${mode}: an area beyond the small black source remains white`);
      t.pixel(layer.maskAlphaCanvas(), 42, 42, '0,0,0,255', `${mode}: missing mask pixels do not become hidden alpha`);
    } finally { cancelTransform(); }
  }
});

suite('off-canvas / perspective maps the full linked mask beyond the image quad', (t) => {
  const { doc, layer } = fixture(t, 80, 0, 0, 0);
  try {
    const session = startTransform(doc, { mode: 'perspective' });
    session.quad[1].x -= 5;
    session.freeform = true;
    const matrix = unitSquareToQuad(session.quad);
    const p = applyMatrix3(matrix, (10 - 30) / 20, (10 - 30) / 20);
    setTransformNumeric({});
    commitTransform();
    const source = layer.getMaskSource();
    t.ok(source.canvas.width > 20 && source.canvas.height > 20, 'the output covers the complete mask rather than only the image quad');
    t.pixel(layer.mask, Math.round(p.x), Math.round(p.y), '255,255,255,255', 'mask content outside the original image is mapped and kept');
    t.eq(source.defaultValue, 0, 'the outside of the complete mask remains hidden by its original default');
  } finally { cancelTransform(); }
});

suite('off-canvas / transparent stored mask pixels stay hidden over a white default', (t) => {
  for (const mode of ['warp', 'perspective']) {
    const { doc, layer } = fixture(t, 8, 31, 31, 255);
    layer.setMaskSource(createCanvas(8, 8), 31, 31, 255, doc);
    try {
      const session = startTransform(doc, { mode });
      if (mode === 'perspective') {
        session.quad[1].x -= 5;
        session.freeform = true;
      }
      const point = mode === 'warp' ? { x: 35, y: 35 }
        : applyMatrix3(unitSquareToQuad(session.quad), (35 - 30) / 20, (35 - 30) / 20);
      setTransformNumeric({});
      commitTransform();
      t.pixel(layer.maskAlphaCanvas(), Math.round(point.x), Math.round(point.y), '0,0,0,0',
        `${mode}: transparent stored coverage is not filled by the white outside default`);
      t.pixel(layer.maskAlphaCanvas(), 45, 45, '0,0,0,255', `${mode}: the unstored region remains visible`);
    } finally { cancelTransform(); }
  }
});

suite('off-canvas / failed smart return projection leaves payload and source unchanged', async (t) => {
  const doc = t.doc(100, 100, 'transparent', 'smart-allocation');
  const layer = doc.activeLayer();
  layer.setPixelSource(solid(20, '#ff0000'), 30, 30, doc);
  const smart = createSmartObject(doc, [layer]);
  const before = { payload: smart.smart, pixels: smart.pixelKey(), history: doc.history.index };
  t.ok(smart._smartCache, 'precondition: smart source composition is already cached');
  const original = HTMLCanvasElement.prototype.getContext;
  let injected = 0;
  try {
    HTMLCanvasElement.prototype.getContext = function (...args) {
      if (this.width === doc.width && this.height === doc.height && args[0] === '2d') {
        injected++;
        throw new Error('injected document projection allocation failure');
      }
      return original.apply(this, args);
    };
    await t.throws(() => setSmartTransform(doc, smart, [0.5, 0, 0, 0.5, 0, 0]), 'the final document projection failure is surfaced');
  } finally { HTMLCanvasElement.prototype.getContext = original; }
  t.eq(injected, 1, 'failure was injected into the document projection after the smaller render was composed');
  t.is(smart.smart, before.payload, 'the previous smart payload is restored exactly');
  t.is(smart.pixelKey(), before.pixels, 'the previous complete pixel source was not replaced');
  t.eq(doc.history.index, before.history, 'the failed transform did not create history');
});

suite('off-canvas / converting a styled layer keeps its off-canvas effect bounds', (t) => {
  const doc = t.doc(100, 100, 'transparent', 'smart-effects');
  const layer = doc.activeLayer();
  layer.setPixelSource(solid(20, '#ff0000'), 1, 30, doc);
  layer.styles = { outerGlow: { ...defaultStyle('outerGlow'), enabled: true, size: 12, opacity: 1, color: '#0000ff', blendMode: 'normal' } };
  const reach = effectReach(layer.styles);
  const before = compositeDocument(doc);
  t.gt(t.bytes(before)[(40 * 100) * 4 + 3], 0, 'precondition: glow reaches the canvas edge outside the image');
  const smart = createSmartObject(doc, [layer]);
  const source = smart.getPixelSource();
  t.ok(source.x <= 1 - reach, 'the smart render includes the full effect reach beyond the left edge');
  t.gt(smart.smart.source.width, doc.width, 'the embedded document is expanded to retain the off-canvas glow');
  t.lt(t.mad(t.bytes(compositeDocument(doc)), t.bytes(before)), 0.1, 'the visible composite matches after conversion within rasterization tolerance');
});
