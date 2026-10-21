import { uid, createCanvas, cloneCanvas, ctx2d } from './util.js';

/**
 * Deep-copying a Smart Object's embedded source needs PikaDocument, which
 * cannot be imported here (document.js imports this module). src/core/smart.js
 * installs the cloner at load time instead, which keeps the dependency
 * one-directional.
 * @type {((source:object)=>object)|null}
 */
let smartSourceCloner = null;

export function setSmartSourceCloner(fn) {
  smartSourceCloner = fn;
}

/**
 * Copy a smart payload for `Layer.clone()`.
 *
 * **Linked by default**, which is what Photoshop's Cmd+J does: the copy keeps
 * the same `linkId`, so editing either instance's contents updates both.
 *
 * The identity is the `linkId`, deliberately *not* the shared `source` object.
 * A contents edit installs a fresh source rather than mutating the old one —
 * which is what makes history correct, since a snapshot holding the previous
 * document is genuinely the previous state — and that same property is what
 * would make reference-sharing diverge silently. Instances are found by id and
 * updated together instead.
 *
 * `link: false` is the independent copy: a new id and its own source, so the
 * two go their own way from that point.
 */
function cloneSmartPayload(smart, link = true) {
  const source = link
    ? smart.source
    : (smart.source && smartSourceCloner ? smartSourceCloner(smart.source) : smart.source);
  return {
    ...smart,
    linkId: link ? smart.linkId : `sl_${Math.random().toString(36).slice(2, 10)}`,
    source,
    transform: smart.transform ? { ...smart.transform, matrix: [...(smart.transform.matrix || [])] } : smart.transform,
    filters: (smart.filters || []).map((f) => ({ ...f, params: { ...f.params } })),
  };
}

export const LayerType = {
  RASTER: 'raster',
  TEXT: 'text',
  SHAPE: 'shape',
  GROUP: 'group',
  ADJUSTMENT: 'adjustment',
  SMART: 'smart',
};

export const MAX_PIXEL_EDGE = 32767;
export const MAX_PIXEL_AREA = 67108864;

/** Check the output and live input buffers before allocating a replacement. */
export function checkPixelAllocation(width, height, extraPixels = 0, budgetBytes = 512 * 1048576) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1
    || width > MAX_PIXEL_EDGE || height > MAX_PIXEL_EDGE || width * height > MAX_PIXEL_AREA
    || !Number.isFinite(extraPixels) || extraPixels < 0 || !Number.isFinite(budgetBytes) || budgetBytes <= 0
    || (width * height + extraPixels) * 4 > budgetBytes) {
    throw new Error('图层像素超出尺寸或内存预算，原有内容未修改');
  }
}

function position(x, y) {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw new Error('图层位置必须为有效整数');
}

function affineValues(matrix) {
  const values = Array.isArray(matrix) ? matrix : [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
  if (values.length !== 6 || !values.every(Number.isFinite)) throw new Error('图层变换矩阵无效');
  return values;
}

export function pixelSourceBounds(source, matrix, clipDoc = null) {
  if (!source) return null;
  const [a, b, c, d, e, f] = affineValues(matrix);
  const points = [[source.x, source.y], [source.x + source.canvas.width, source.y],
    [source.x, source.y + source.canvas.height], [source.x + source.canvas.width, source.y + source.canvas.height]];
  const snap = (value) => Math.abs(value - Math.round(value)) < 1e-9 ? Math.round(value) : value;
  const xs = points.map(([x, y]) => snap(a * x + c * y + e));
  const ys = points.map(([x, y]) => snap(b * x + d * y + f));
  let x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
  let right = Math.ceil(Math.max(...xs)), bottom = Math.ceil(Math.max(...ys));
  if (clipDoc) {
    x = Math.max(0, x); y = Math.max(0, y);
    right = Math.min(clipDoc.width, right); bottom = Math.min(clipDoc.height, bottom);
  }
  position(x, y);
  position(right, bottom);
  if (right <= x || bottom <= y) return { x: 0, y: 0, width: 1, height: 1, empty: true };
  return { x, y, width: right - x, height: bottom - y };
}

/** Resample a complete source in document space, optionally for an explicit crop. */
export function transformPixelSource(source, matrix, doc = null, options = {}) {
  if (!source) return null;
  const rect = pixelSourceBounds(source, matrix, options.clip ? doc : null);
  checkPixelAllocation(rect.width, rect.height,
    source.canvas.width * source.canvas.height + (options.extraPixels || 0), (doc?.memoryLimitMB || 512) * 1048576);
  const canvas = createCanvas(rect.width, rect.height);
  const ctx = ctx2d(canvas);
  if (source.defaultValue !== undefined) {
    ctx.fillStyle = `rgb(${source.defaultValue} ${source.defaultValue} ${source.defaultValue})`;
    ctx.fillRect(0, 0, rect.width, rect.height);
  }
  if (!rect.empty) {
    const [a, b, c, d, e, f] = affineValues(matrix);
    ctx.imageSmoothingEnabled = options.smoothing !== 'nearest';
    ctx.imageSmoothingQuality = options.smoothing === 'nearest' ? 'low' : (options.smoothing || 'high');
    ctx.setTransform(a, b, c, d, a * source.x + c * source.y + e - rect.x, b * source.x + d * source.y + f - rect.y);
    ctx.clearRect(0, 0, source.canvas.width, source.canvas.height);
    ctx.drawImage(source.canvas, 0, 0);
  }
  return { canvas, x: rect.x, y: rect.y,
    ...(source.defaultValue !== undefined ? { defaultValue: source.defaultValue } : {}) };
}

function projectSource(source, width, height, fill = null) {
  if (!source) return null;
  checkPixelAllocation(width, height, source.canvas.width * source.canvas.height);
  const out = createCanvas(width, height);
  const c = ctx2d(out);
  if (fill !== null) {
    c.fillStyle = `rgb(${fill} ${fill} ${fill})`;
    c.fillRect(0, 0, width, height);
    c.clearRect(source.x, source.y, source.canvas.width, source.canvas.height);
  }
  c.drawImage(source.canvas, source.x, source.y);
  return out;
}

function regionSource(source, rect, pixels, fill, doc, otherSource) {
  position(rect.x, rect.y);
  if (!Number.isSafeInteger(rect.width) || !Number.isSafeInteger(rect.height)
    || rect.width < 1 || rect.height < 1 || pixels.width !== rect.width || pixels.height !== rect.height) {
    throw new Error('编辑像素与目标区域尺寸不一致');
  }
  const x = source ? Math.min(source.x, rect.x) : rect.x;
  const y = source ? Math.min(source.y, rect.y) : rect.y;
  const right = Math.max(source ? source.x + source.canvas.width : rect.x, rect.x + rect.width);
  const bottom = Math.max(source ? source.y + source.canvas.height : rect.y, rect.y + rect.height);
  position(right, bottom);
  const width = right - x, height = bottom - y;
  const sourcePixels = (source ? source.canvas.width * source.canvas.height : 0)
    + (otherSource ? otherSource.canvas.width * otherSource.canvas.height : 0);
  const extraPixels = Math.max(sourcePixels, doc.memoryUse ? doc.memoryUse() / 4 : 0)
    + pixels.width * pixels.height + doc.width * doc.height;
  checkPixelAllocation(width, height, extraPixels, (doc.memoryLimitMB || 512) * 1048576);
  const out = createCanvas(width, height);
  const c = ctx2d(out);
  if (fill !== null) {
    c.fillStyle = `rgb(${fill} ${fill} ${fill})`;
    c.fillRect(0, 0, width, height);
  }
  if (source) {
    c.clearRect(source.x - x, source.y - y, source.canvas.width, source.canvas.height);
    c.drawImage(source.canvas, source.x - x, source.y - y);
  }
  c.clearRect(rect.x - x, rect.y - y, rect.width, rect.height);
  if (typeof ImageData !== 'undefined' && pixels instanceof ImageData) c.putImageData(pixels, rect.x - x, rect.y - y);
  else c.drawImage(pixels, rect.x - x, rect.y - y);
  return { canvas: out, x, y };
}

/**
 * A single layer.
 *
 * Complete sources are shared with history and treated as immutable. Readers
 * receive projections; region commits and explicit replacements install private
 * buffers so older undo states keep their pixels.
 */
export class Layer {
  constructor(opts = {}) {
    this.id = opts.id || uid('layer');
    this.type = opts.type || LayerType.RASTER;
    this.name = opts.name || 'Layer';
    this.visible = opts.visible !== false;
    this.opacity = opts.opacity == null ? 1 : opts.opacity;
    this.fillOpacity = opts.fillOpacity == null ? 1 : opts.fillOpacity;
    this.blendMode = opts.blendMode || 'normal';
    this.clipped = !!opts.clipped;
    this.locked = opts.locked || { all: false, pixels: false, position: false, transparency: false };

    // Exactly one authoritative pixel buffer; document projections are disposable.
    /** @type {HTMLCanvasElement|null} */
    this._full = opts.canvas || null;
    /** @type {{canvas: HTMLCanvasElement, x: number, y: number}|null} */
    this._tile = opts.tile || null;
    this._docWidth = opts.docWidth || opts.tile?.docWidth || opts.canvas?.width || opts.mask?.width || 1;
    this._docHeight = opts.docHeight || opts.tile?.docHeight || opts.canvas?.height || opts.mask?.height || 1;
    this._mask = opts.mask || null;
    this.maskX = opts.maskX || 0;
    this.maskY = opts.maskY || 0;
    this.maskDefault = opts.maskDefault ?? 0;
    this.maskEnabled = opts.maskEnabled !== false;
    this.maskLinked = opts.maskLinked !== false;
    this.maskInverted = !!opts.maskInverted;
    /** Bumped whenever mask pixels change so the alpha cache can invalidate. */
    this.maskVersion = 0;
    this._maskAlpha = null;
    this._maskAlphaVersion = -1;

    /** Group children. layers[0] is the TOP-most child (same as the panel). */
    this.children = opts.children || (this.type === LayerType.GROUP ? [] : null);
    this.expanded = opts.expanded !== false;
    /** @type {Layer|null} */
    this.parent = null;

    /** Layer effects, see src/effects/styles.js */
    this.styles = opts.styles || null;

    /** Type-specific payloads. */
    this.text = opts.text || null;
    this.shape = opts.shape || null;
    this.adjustment = opts.adjustment || null;
    this.smart = opts.smart || null;

    /** Set when the layer is the locked bottom "Background". */
    this.isBackground = !!opts.isBackground;

    /** Whether the mask (rather than the pixels) currently receives painting. */
    this.editingMask = false;

    this.thumbDirty = true;
    this._thumb = null;
  }

  /* ------------------------------------------------------------------ */

  /** A disposable document-space projection. Writers must commit their region. */
  get canvas() {
    return this.projectPixels();
  }

  set canvas(cv) {
    this.setPixelSource(cv);
  }

  get mask() { return this.projectMask(); }

  set mask(cv) { this.setMaskSource(cv); }

  /** Borrowed read-only pixels. Never mutate a source returned by this method. */
  getPixelSource() {
    return this._tile ? { canvas: this._tile.canvas, x: this._tile.x, y: this._tile.y }
      : this._full ? { canvas: this._full, x: 0, y: 0 } : null;
  }

  getMaskSource() {
    return this._mask ? { canvas: this._mask, x: this.maskX, y: this.maskY, defaultValue: this.maskDefault } : null;
  }

  setDocumentSize(width, height) {
    if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
      throw new Error('文档尺寸无效');
    }
    if (width !== this._docWidth || height !== this._docHeight) this._maskAlphaVersion = -1;
    this._docWidth = width;
    this._docHeight = height;
    if (this._tile) this._tile = { ...this._tile, docWidth: width, docHeight: height };
    this.thumbDirty = true;
    return this;
  }

  projectPixels(doc = null) {
    return projectSource(this.getPixelSource(), doc?.width || this._docWidth, doc?.height || this._docHeight);
  }

  projectMask(doc = null) {
    return projectSource(this.getMaskSource(), doc?.width || this._docWidth, doc?.height || this._docHeight, this.maskDefault);
  }

  /** Explicit complete replacement; takes ownership of an already private buffer. */
  setPixelSource(canvas, x = 0, y = 0, doc = null) {
    position(x, y);
    if (doc) this.setDocumentSize(doc.width, doc.height);
    this._full = canvas && x === 0 && y === 0 ? canvas : null;
    this._tile = canvas && !this._full ? { canvas, x, y, docWidth: this._docWidth, docHeight: this._docHeight } : null;
    this.thumbDirty = true;
    return this;
  }

  setMaskSource(canvas, x = 0, y = 0, defaultValue = 0, doc = null) {
    position(x, y);
    if (!Number.isInteger(defaultValue) || defaultValue < 0 || defaultValue > 255) throw new Error('蒙版默认覆盖值无效');
    if (doc) this.setDocumentSize(doc.width, doc.height);
    this._mask = canvas || null;
    this.maskX = x;
    this.maskY = y;
    this.maskDefault = defaultValue;
    if (!canvas) this._maskAlpha = null;
    this.touchMask();
    return this;
  }

  translatePixels(dx, dy, doc = null) {
    const source = this.getPixelSource();
    if (source) this.setPixelSource(source.canvas, source.x + dx, source.y + dy, doc);
    return this;
  }

  translateMask(dx, dy, doc = null) {
    if (this._mask) this.setMaskSource(this._mask, this.maskX + dx, this.maskY + dy, this.maskDefault, doc);
    return this;
  }

  commitPixelRegion(doc, rect, pixels) {
    const source = regionSource(this.getPixelSource(), rect, pixels, null, doc, this.getMaskSource());
    return this.setPixelSource(source.canvas, source.x, source.y, doc);
  }

  commitMaskRegion(doc, rect, pixels) {
    const source = regionSource(this.getMaskSource(), rect, pixels, this.maskDefault, doc, this.getPixelSource());
    return this.setMaskSource(source.canvas, source.x, source.y, this.maskDefault, doc);
  }

  /**
   * The compact form, or null when the pixels are already document-sized.
   *
   * Consumers that can honour an offset should prefer this and leave the layer
   * compact. Everyone else reads `.canvas` and pays for the expansion.
   */
  get tile() {
    return this._tile;
  }

  /**
   * Store pixels compactly: `src` sits at (x, y) in a `docWidth` x `docHeight`
   * document. Replaces whatever was there.
   */
  setTile(src, x, y, docWidth, docHeight) {
    position(x, y);
    this.setDocumentSize(docWidth, docHeight);
    this._full = null;
    this._tile = src ? { canvas: src, x, y, docWidth, docHeight } : null;
    this.thumbDirty = true;
    return this;
  }

  /**
   * The buffer object currently holding this layer's pixels, whichever form it
   * is in — a stable identity for caching against, without materialising.
   *
   * Copy-on-write makes this a sound invalidation key: region commits replace
   * whichever buffer exists, so a new object means new pixels. Callers that key
   * a cache on `layer.canvas` instead would expand every layer they merely
   * measured, which is how snapping a layer into place could otherwise cost a
   * document its compact form.
   *
   * @returns {HTMLCanvasElement|null}
   */
  pixelKey() {
    return this._full || (this._tile ? this._tile.canvas : null);
  }

  /** Bytes of pixel buffer this layer holds, without materialising anything. */
  pixelBytes() {
    if (this._full) return this._full.width * this._full.height * 4;
    if (this._tile) return this._tile.canvas.width * this._tile.canvas.height * 4;
    return 0;
  }

  get isRasterLike() {
    return this.type !== LayerType.GROUP && this.type !== LayerType.ADJUSTMENT;
  }

  ensureCanvas(w, h) {
    this.setDocumentSize(w, h);
    if (!this.pixelKey()) this.setPixelSource(createCanvas(w, h));
    return this.projectPixels();
  }

  getContext() {
    return this.projectPixels()?.getContext('2d') || null;
  }

  /** Region commits and complete replacements install private buffers themselves. */
  beginEdit() {
    this.thumbDirty = true;
    return this;
  }

  /** The surface tools should paint into, honouring mask-editing mode. */
  paintTarget() {
    return this.editingMask && this._mask ? this.projectMask() : this.projectPixels();
  }

  addMask(w, h, fill = '#ffffff') {
    if (this._mask) return this.projectMask();
    const mask = createCanvas(w, h);
    const c = mask.getContext('2d');
    c.fillStyle = fill;
    c.fillRect(0, 0, w, h);
    this.setMaskSource(mask, 0, 0, 0, { width: w, height: h });
    return this.projectMask();
  }

  removeMask() {
    this.mask = null;
    this.editingMask = false;
    this._maskAlpha = null;
    this._maskAlphaVersion = -1;
  }

  touchMask() {
    this.maskVersion++;
    this._maskAlphaVersion = -1;
    this.thumbDirty = true;
  }

  /**
   * Mask converted to an alpha-only canvas (luminance -> alpha) suitable as a
   * `destination-in` source. Cached against `maskVersion`.
   */
  maskAlphaCanvas() {
    if (!this._mask) return null;
    if (this._maskAlpha && this._maskAlphaVersion === this.maskVersion
      && this._maskAlphaInverted === this.maskInverted) return this._maskAlpha;
    const mask = this.projectMask();
    const w = mask.width, h = mask.height;
    const src = mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h);
    const out = new ImageData(w, h);
    const s = src.data, d = out.data;
    const inv = this.maskInverted;
    for (let i = 0; i < s.length; i += 4) {
      let l = (s[i] * 0.299 + s[i + 1] * 0.587 + s[i + 2] * 0.114) * (s[i + 3] / 255);
      if (inv) l = 255 - l;
      d[i] = 0; d[i + 1] = 0; d[i + 2] = 0; d[i + 3] = l;
    }
    const cv = createCanvas(w, h);
    cv.getContext('2d').putImageData(out, 0, 0);
    this._maskAlpha = cv;
    this._maskAlphaVersion = this.maskVersion;
    this._maskAlphaInverted = this.maskInverted;
    return cv;
  }

  /* ------------------------------------------------------------------ */

  /** Deep-ish clone. Pixel buffers are copied so the clone is independent. */
  /**
   * @param {boolean} [newIds]
   * @param {boolean} [link] for a Smart Object: keep the link to its siblings
   *   (the default, matching Photoshop) or make an independent copy.
   */
  clone(newIds = true, link = true) {
    const l = new Layer({
      id: newIds ? undefined : this.id,
      type: this.type,
      name: this.name,
      visible: this.visible,
      opacity: this.opacity,
      fillOpacity: this.fillOpacity,
      blendMode: this.blendMode,
      clipped: this.clipped,
      locked: { ...this.locked },
      canvas: this._full ? cloneCanvas(this._full) : null,
      tile: this._tile ? { ...this._tile, canvas: cloneCanvas(this._tile.canvas) } : null,
      docWidth: this._docWidth,
      docHeight: this._docHeight,
      mask: cloneCanvas(this._mask),
      maskX: this.maskX,
      maskY: this.maskY,
      maskDefault: this.maskDefault,
      maskEnabled: this.maskEnabled,
      maskLinked: this.maskLinked,
      maskInverted: this.maskInverted,
      styles: this.styles ? structuredClone(this.styles) : null,
      text: this.text ? structuredClone(this.text) : null,
      shape: this.shape ? structuredClone(this.shape) : null,
      adjustment: this.adjustment ? structuredClone(this.adjustment) : null,
      smart: this.smart ? cloneSmartPayload(this.smart, link) : null,
      isBackground: this.isBackground,
      expanded: this.expanded,
    });
    if (this.children) {
      l.children = this.children.map((c) => {
        const cc = c.clone(newIds, link);
        cc.parent = l;
        return cc;
      });
    }
    return l;
  }

  /**
   * Shallow structural snapshot used by History. Pixel buffers are *shared*
   * (copy-on-write guarantees they will not be mutated afterwards).
   */
  snapshot() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      visible: this.visible,
      opacity: this.opacity,
      fillOpacity: this.fillOpacity,
      blendMode: this.blendMode,
      clipped: this.clipped,
      locked: { ...this.locked },
      // Snapshots share authoritative buffers, never disposable projections.
      canvas: this._full,
      tile: this._tile,
      docWidth: this._docWidth,
      docHeight: this._docHeight,
      mask: this._mask,
      maskX: this.maskX,
      maskY: this.maskY,
      maskDefault: this.maskDefault,
      maskEnabled: this.maskEnabled,
      maskLinked: this.maskLinked,
      maskInverted: this.maskInverted,
      editingMask: this.editingMask,
      styles: this.styles ? structuredClone(this.styles) : null,
      text: this.text ? structuredClone(this.text) : null,
      shape: this.shape ? structuredClone(this.shape) : null,
      adjustment: this.adjustment ? structuredClone(this.adjustment) : null,
      smart: this.smart ? { ...this.smart } : null,
      isBackground: this.isBackground,
      expanded: this.expanded,
      children: this.children ? this.children.map((c) => c.snapshot()) : null,
    };
  }

  static fromSnapshot(s) {
    const l = new Layer({ ...s, id: s.id });
    l.editingMask = !!s.editingMask;
    l.children = s.children ? s.children.map((c) => {
      const cc = Layer.fromSnapshot(c);
      cc.parent = l;
      return cc;
    }) : (s.type === LayerType.GROUP ? [] : null);
    l.maskVersion = 1;
    return l;
  }

  localContentBounds() {
    const source = this.getPixelSource();
    if (!source) return null;
    const w = source.canvas.width, h = source.canvas.height;
    const d = source.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (d[row + x * 4 + 3] !== 0) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  /** Opaque bounds in document coordinates, including content outside the document. */
  contentBounds() {
    const b = this.localContentBounds();
    const source = this.getPixelSource();
    return b ? { ...b, x: b.x + source.x, y: b.y + source.y } : null;
  }

  /** 40×40 thumbnail used by the Layers panel. */
  thumbnail(size = 40) {
    if (!this.thumbDirty && this._thumb && this._thumb.width === size) return this._thumb;
    const cv = createCanvas(size, size);
    const c = cv.getContext('2d');
    const source = this.type === LayerType.GROUP ? null : this.getPixelSource();
    if (source) {
      const src = source.canvas;
      const boxW = this._docWidth, boxH = this._docHeight;
      const s = Math.min(size / boxW, size / boxH);
      c.imageSmoothingQuality = 'high';
      c.drawImage(
        src,
        (size - boxW * s) / 2 + source.x * s,
        (size - boxH * s) / 2 + source.y * s,
        src.width * s, src.height * s,
      );
    }
    this._thumb = cv;
    this.thumbDirty = false;
    return cv;
  }
}

/* ---------------------------------------------------------------- */
/* Authored geometry                                                 */
/* ---------------------------------------------------------------- */

/**
 * Move a layer's *authored* geometry to follow its pixels.
 *
 * Text and shape layers hold two descriptions of the same thing: the rendered
 * canvas, and the parameters that produced it — `text.x/y`, `shape.subpaths`.
 * Anything that moves the pixels without moving the parameters leaves the two
 * disagreeing, and the disagreement is invisible until something re-renders
 * from the parameters. Then the layer silently jumps back to where it was
 * authored: move a caption and type one more character, and it hops across the
 * canvas.
 *
 * So every operation that transforms the canvas has to bring the parameters
 * with it. `mapPoint` maps document space to document space; `sizeScale` is the
 * matching scale factor for glyph size, which has no coordinate to map.
 *
 * One limit worth stating plainly: a text layer stores a position but not an
 * orientation, so under a rotation or a flip the anchor lands correctly and the
 * glyphs stay upright. Subpaths carry the full transform exactly.
 *
 * @param {Layer} layer
 * @param {(x: number, y: number) => {x: number, y: number}} mapPoint
 * @param {number} [sizeScale]
 */
export function mapLayerGeometry(layer, mapPoint, sizeScale = 1) {
  if (!layer) return;

  if (layer.text) {
    const p = mapPoint(num(layer.text.x), num(layer.text.y));
    const next = { ...layer.text, x: p.x, y: p.y };
    if (sizeScale !== 1) {
      next.scale = (num(layer.text.scale, 1) || 1) * sizeScale;
      // Box text wraps to a width in document space, so the box has to scale too
      // or the wrap points move relative to the glyphs.
      if (num(next.boxWidth)) next.boxWidth = num(next.boxWidth) * sizeScale;
      if (num(next.boxHeight)) next.boxHeight = num(next.boxHeight) * sizeScale;
    }
    layer.text = next;
  }

  if (layer.shape && Array.isArray(layer.shape.subpaths)) {
    layer.shape = {
      ...layer.shape,
      subpaths: layer.shape.subpaths.map((sp) => ({
        ...sp,
        points: (sp.points || []).map((pt) => {
          const a = mapPoint(num(pt.x), num(pt.y));
          const out = { ...pt, x: a.x, y: a.y };
          if (pt.in) { const q = mapPoint(num(pt.in.x), num(pt.in.y)); out.in = { x: q.x, y: q.y }; }
          if (pt.out) { const q = mapPoint(num(pt.out.x), num(pt.out.y)); out.out = { x: q.x, y: q.y }; }
          return out;
        }),
      })),
    };
    // A corner radius is a length, so it only survives a uniform scale.
    if (sizeScale !== 1 && num(layer.shape.radius)) {
      layer.shape.radius = num(layer.shape.radius) * sizeScale;
    }
  }
}

/** Translate authored geometry — the common case. */
export function translateLayerGeometry(layer, dx, dy) {
  if (!dx && !dy) return;
  mapLayerGeometry(layer, (x, y) => ({ x: x + dx, y: y + dy }));
}

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/* ---------------------------------------------------------------- */
/* Factory helpers                                                   */
/* ---------------------------------------------------------------- */

export function createRasterLayer(w, h, name = 'Layer') {
  return new Layer({ type: LayerType.RASTER, name, canvas: createCanvas(w, h) });
}

export function createGroupLayer(name = 'Group') {
  return new Layer({ type: LayerType.GROUP, name, children: [], blendMode: 'pass-through' });
}

export function createAdjustmentLayer(kind, params, w, h, name) {
  return new Layer({
    type: LayerType.ADJUSTMENT,
    name: name || kind,
    adjustment: { kind, params: params || {} },
  });
}
