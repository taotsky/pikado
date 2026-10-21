import { Emitter } from './emitter.js';
import {
  Layer, createRasterLayer, mapLayerGeometry,
  checkPixelAllocation, pixelSourceBounds, transformPixelSource,
} from './layer.js';
import { Selection } from './selection.js';
import { History } from './history.js';
import { uid, createCanvas } from './util.js';

function mapPoint(matrix, x, y) {
  return { x: matrix[0] * x + matrix[2] * y + matrix[4], y: matrix[1] * x + matrix[3] * y + matrix[5] };
}

function mapSmartPayload(smart, matrix) {
  if (!smart) return smart;
  const [a, b, c, d, e, f] = smart.transform?.matrix || [1, 0, 0, 1, 0, 0];
  const m = matrix;
  return { ...smart, transform: { ...smart.transform, matrix: [
    m[0] * a + m[2] * b, m[1] * a + m[3] * b,
    m[0] * c + m[2] * d, m[1] * c + m[3] * d,
    m[0] * e + m[2] * f + m[4], m[1] * e + m[3] * f + m[5],
  ] } };
}

function mapDocumentPaths(paths, matrix) {
  const out = structuredClone(paths);
  for (const path of out) for (const subpath of path.subpaths || []) for (const point of subpath.points || []) {
    Object.assign(point, mapPoint(matrix, point.x, point.y));
    if (point.in) point.in = mapPoint(matrix, point.in.x, point.in.y);
    if (point.out) point.out = mapPoint(matrix, point.out.x, point.out.y);
  }
  return out;
}

/** Prepare every output before changing the document or any history-shared data. */
function prepareGeometry(doc, matrix, width, height, smoothing = 'high', clip = false, sizeScale = 1) {
  const layers = doc.flatLayers();
  const target = { width, height, memoryLimitMB: doc.memoryLimitMB };
  let outputPixels = 0;
  for (const layer of layers) for (const source of [layer.getPixelSource(), layer.getMaskSource()]) {
    const rect = pixelSourceBounds(source, matrix, clip ? target : null);
    if (rect) {
      checkPixelAllocation(rect.width, rect.height);
      outputPixels += rect.width * rect.height;
    }
  }
  checkPixelAllocation(width, height, doc.memoryUse() / 4 + outputPixels + width * height,
    (doc.memoryLimitMB || 512) * 1048576);
  const prepared = layers.map((layer) => {
    const geometry = { text: layer.text, shape: layer.shape };
    mapLayerGeometry(geometry, (x, y) => mapPoint(matrix, x, y), sizeScale);
    return { layer, geometry, smart: mapSmartPayload(layer.smart, matrix),
      pixels: transformPixelSource(layer.getPixelSource(), matrix, target, { smoothing, clip }),
      mask: transformPixelSource(layer.getMaskSource(), matrix, target, { smoothing, clip }) };
  });
  return { target, prepared, paths: mapDocumentPaths(doc.paths, matrix) };
}

function applyGeometry(doc, state) {
  for (const { layer, geometry, smart, pixels, mask } of state.prepared) {
    layer.setDocumentSize(state.target.width, state.target.height);
    if (pixels) layer.setPixelSource(pixels.canvas, pixels.x, pixels.y);
    if (mask) layer.setMaskSource(mask.canvas, mask.x, mask.y, mask.defaultValue);
    layer.text = geometry.text;
    layer.shape = geometry.shape;
    layer.smart = smart;
  }
  doc.width = state.target.width;
  doc.height = state.target.height;
  doc.paths = state.paths;
}

/**
 * A Pikado document.
 *
 * Layer ordering convention (used everywhere): **`layers[0]` is the TOP-most
 * layer**, matching what the Layers panel shows. The compositor therefore
 * walks the array backwards.
 */
export class PikaDocument extends Emitter {
  constructor({ width = 800, height = 600, name = 'Untitled', resolution = 72 } = {}) {
    super();
    this.id = uid('doc');
    this.name = name;
    this.width = Math.max(1, Math.round(width));
    this.height = Math.max(1, Math.round(height));
    this.resolution = resolution;
    this.colorMode = 'rgb';

    /** @type {Layer[]} index 0 = top */
    this.layers = [];
    this.activeLayerId = null;
    this.selectedLayerIds = [];

    this.selection = new Selection(this.width, this.height);
    this.history = new History(this);

    /** Alpha channels saved via Select > Save Selection. */
    this.alphaChannels = [];
    /** Vector paths from the Pen tool (Paths panel). */
    this.paths = [];
    this.activePathId = null;

    this.guides = [];
    this.quickMask = false;

    /**
     * Frame animation, empty until a timeline is created. A frame records which
     * layers are visible and at what opacity — see src/core/animation.js.
     * @type {Array<{id:string, delay:number, state:Object}>}
     */
    this.frames = [];
    this.activeFrameId = null;
    /** GIF-style loop count; 0 plays forever. */
    this.loopCount = 0;

    this.dirty = false;
    this.filePath = null;
    this.fileHandle = null;

    /** Cached composite; invalidated by `invalidate()`. */
    this._composite = null;
    this._compositeValid = false;

    this.view = { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };
  }

  /* ------------------------------------------------------------------ */
  /* Construction helpers                                                */
  /* ------------------------------------------------------------------ */

  static blank(width, height, name, fill = '#ffffff') {
    const doc = new PikaDocument({ width, height, name });
    if (fill === 'transparent' || fill === null) {
      const l = createRasterLayer(width, height, 'Layer 1');
      doc.layers.push(l);
      doc.activeLayerId = l.id;
    } else {
      const canvas = createCanvas(width, height);
      const c = canvas.getContext('2d');
      c.fillStyle = fill;
      c.fillRect(0, 0, width, height);
      const bg = new Layer({ name: 'Background', canvas });
      bg.isBackground = true;
      bg.locked = { ...bg.locked, position: true };
      doc.layers.push(bg);
      doc.activeLayerId = bg.id;
    }
    doc.selectedLayerIds = [doc.activeLayerId];
    doc.history.clear('New');
    return doc;
  }

  static fromImage(img, name = 'Image') {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const doc = new PikaDocument({ width: w, height: h, name });
    const canvas = createCanvas(w, h);
    canvas.getContext('2d').drawImage(img, 0, 0);
    const l = new Layer({ name: 'Background', canvas });
    l.isBackground = true;
    doc.layers.push(l);
    doc.activeLayerId = l.id;
    doc.selectedLayerIds = [l.id];
    doc.history.clear('Open');
    return doc;
  }

  /* ------------------------------------------------------------------ */
  /* Layer tree access                                                   */
  /* ------------------------------------------------------------------ */

  /** Depth-first list of every layer, top to bottom. */
  flatLayers(list = this.layers, out = []) {
    for (const l of list) {
      out.push(l);
      if (l.children) this.flatLayers(l.children, out);
    }
    return out;
  }

  findLayer(id, list = this.layers) {
    for (const l of list) {
      if (l.id === id) return l;
      if (l.children) {
        const f = this.findLayer(id, l.children);
        if (f) return f;
      }
    }
    return null;
  }

  /** The array that directly contains `layer`, plus its index in it. */
  locate(layer, list = this.layers, parent = null) {
    const i = list.indexOf(layer);
    if (i >= 0) return { list, index: i, parent };
    for (const l of list) {
      if (l.children) {
        const f = this.locate(layer, l.children, l);
        if (f) return f;
      }
    }
    return null;
  }

  activeLayer() {
    return this.findLayer(this.activeLayerId);
  }

  selectedLayers() {
    return this.selectedLayerIds.map((id) => this.findLayer(id)).filter(Boolean);
  }

  setActiveLayer(id, additive = false, range = false) {
    if (range && this.activeLayerId) {
      const flat = this.flatLayers();
      const a = flat.findIndex((l) => l.id === this.activeLayerId);
      const b = flat.findIndex((l) => l.id === id);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        this.selectedLayerIds = flat.slice(lo, hi + 1).map((l) => l.id);
        this.activeLayerId = id;
        this.emit('selection-change');
        return;
      }
    }
    if (additive) {
      if (this.selectedLayerIds.includes(id)) this.selectedLayerIds = this.selectedLayerIds.filter((x) => x !== id);
      else this.selectedLayerIds.push(id);
      this.activeLayerId = this.selectedLayerIds[this.selectedLayerIds.length - 1] || null;
    } else {
      this.activeLayerId = id;
      this.selectedLayerIds = id ? [id] : [];
    }
    this.emit('selection-change');
  }

  /* ------------------------------------------------------------------ */
  /* Mutation                                                            */
  /* ------------------------------------------------------------------ */

  /** Insert `layer` above the active layer (or at `index` in `parentList`). */
  addLayer(layer, opts = {}) {
    const { above = this.activeLayer(), parent = null, index = null } = opts;
    for (const child of this.flatLayers([layer])) child.setDocumentSize(this.width, this.height);
    layer.parent = parent;
    if (index != null) {
      const list = parent ? parent.children : this.layers;
      list.splice(index, 0, layer);
    } else if (above) {
      const loc = this.locate(above);
      if (loc) {
        layer.parent = loc.parent;
        loc.list.splice(loc.index, 0, layer);
      } else this.layers.unshift(layer);
    } else {
      (parent ? parent.children : this.layers).unshift(layer);
    }
    this.activeLayerId = layer.id;
    this.selectedLayerIds = [layer.id];
    this.invalidate();
    this.emit('structure');
    return layer;
  }

  removeLayer(layer) {
    const loc = this.locate(layer);
    if (!loc) return false;
    loc.list.splice(loc.index, 1);
    if (this.activeLayerId === layer.id) {
      const next = loc.list[loc.index] || loc.list[loc.index - 1] || loc.parent || this.flatLayers()[0];
      this.activeLayerId = next ? next.id : null;
      this.selectedLayerIds = this.activeLayerId ? [this.activeLayerId] : [];
    }
    this.selectedLayerIds = this.selectedLayerIds.filter((id) => this.findLayer(id));
    this.invalidate();
    this.emit('structure');
    return true;
  }

  /** Move `layer` so it sits at `index` inside `parent` (null = root). */
  moveLayer(layer, parent, index) {
    const loc = this.locate(layer);
    if (!loc) return;
    const target = parent ? parent.children : this.layers;
    // Guard against dropping a group into itself.
    if (parent) {
      let p = parent;
      while (p) {
        if (p === layer) return;
        p = p.parent;
      }
    }
    loc.list.splice(loc.index, 1);
    if (loc.list === target && loc.index < index) index--;
    layer.parent = parent;
    target.splice(Math.max(0, Math.min(target.length, index)), 0, layer);
    this.invalidate();
    this.emit('structure');
  }

  /** Raise/lower within the whole stack (Layer > Arrange). */
  arrange(layer, where) {
    const loc = this.locate(layer);
    if (!loc) return;
    const list = loc.list;
    const i = loc.index;
    let j = i;
    if (where === 'front') j = 0;
    else if (where === 'back') j = list.length - 1;
    else if (where === 'forward') j = Math.max(0, i - 1);
    else if (where === 'backward') j = Math.min(list.length - 1, i + 1);
    if (j === i) return;
    list.splice(i, 1);
    list.splice(j, 0, layer);
    this.invalidate();
    this.emit('structure');
  }

  /**
   * @param {Layer} layer
   * @param {{link?:boolean}} [opts] for a Smart Object, whether the copy stays
   *   linked to the original. Linked is the default, as in Photoshop.
   */
  duplicateLayer(layer, opts = {}) {
    const copy = layer.clone(true, opts.link !== false);
    copy.name = `${layer.name} copy`;
    copy.isBackground = false;
    const loc = this.locate(layer);
    copy.parent = loc.parent;
    loc.list.splice(loc.index, 0, copy);
    this.activeLayerId = copy.id;
    this.selectedLayerIds = [copy.id];
    this.invalidate();
    this.emit('structure');
    return copy;
  }

  /* ------------------------------------------------------------------ */
  /* Edit lifecycle (copy-on-write + history)                            */
  /* ------------------------------------------------------------------ */

  /**
   * Prepare layers for pixel mutation. Always pair with `commit(label)`.
   * @param {Layer|Layer[]} [layers]
   */
  /**
   * @param {Layer|Layer[]|null} layers
   * @param {{surface?: 'canvas'|'mask'|'both'}} [opts] which buffer is about to
   *   be written; defaults to both, so callers that do not say stay correct.
   */
  beginEdit(layers, opts) {
    const list = layers == null ? [this.activeLayer()] : Array.isArray(layers) ? layers : [layers];
    for (const l of list) if (l) l.beginEdit(opts);
    return list;
  }

  /** Record a history entry and notify listeners. */
  commit(label) {
    this.dirty = true;
    this.invalidate();
    this.history.record(label);
    this.emit('change', { reason: label });
  }

  /** Notify listeners without touching history (live drag previews). */
  touch(reason = 'edit') {
    this.dirty = true;
    this.invalidate();
    this.emit('change', { reason });
  }

  invalidate() {
    this._compositeValid = false;
    for (const l of this.flatLayers()) {
      if (l._docWidth !== this.width || l._docHeight !== this.height) l.setDocumentSize(this.width, this.height);
      l.thumbDirty = true;
    }
  }

  /* ------------------------------------------------------------------ */
  /* History serialisation                                               */
  /* ------------------------------------------------------------------ */

  captureState() {
    return {
      width: this.width,
      height: this.height,
      layers: this.layers.map((l) => l.snapshot()),
      activeLayerId: this.activeLayerId,
      selectedLayerIds: [...this.selectedLayerIds],
      /*
       * Shared by reference, not copied — the same copy-on-write discipline
       * layer buffers already use. This was a deep copy on every single state
       * whether the selection had changed or not: 12 MB per state at 4000x3000,
       * so up to 720 MB across the 60-state history, for a selection the user
       * may never have touched.
       *
       * Safe because `Selection` never writes into an existing mask — every
       * mutator replaces the array. `invert()` was the one exception and no
       * longer is. If a future method mutates in place, this line is what it
       * breaks, so the test that pins it says so.
       */
      selectionMask: this.selection.mask,
      alphaChannels: this.alphaChannels.map((c) => ({ ...c })),
      paths: structuredClone(this.paths),
      guides: [...this.guides],
      quickMask: this.quickMask,
      /*
       * The colour profile belongs in history because Assign and Convert are both
       * undoable commands: without it, undoing a convert restored the pixels and
       * left them labelled with the profile they had been converted TO, which is
       * a document that describes itself wrongly.
       *
       * `doc.proof` is deliberately absent — soft proofing is a view setting, in
       * the same category as the channel view, and an undo should not change what
       * you are looking through.
       */
      profile: this.profile || null,
      // Frame animation. `activeFrameId` belongs in history with the frames:
      // stepping to a frame changes what the canvas shows, so an undo that left
      // you looking at a different frame than the one it restored would be
      // disorienting. (The *channel view* is the opposite case and is
      // deliberately absent — see src/render/compositor.js.)
      frames: this.frames ? structuredClone(this.frames) : null,
      activeFrameId: this.activeFrameId || null,
      loopCount: this.loopCount == null ? 0 : this.loopCount,
      // Tool-owned document data. These are plain values, so a structural
      // clone is enough — without them a history step silently drops them.
      slices: this.slices ? structuredClone(this.slices) : null,
      colorSamplers: this.colorSamplers ? structuredClone(this.colorSamplers) : null,
      notes: this.notes ? structuredClone(this.notes) : null,
      artboards: this.artboards ? structuredClone(this.artboards) : null,
      measurement: this.measurement ? { ...this.measurement } : null,
    };
  }

  restoreState(s) {
    const sizeChanged = this.width !== s.width || this.height !== s.height;
    this.width = s.width;
    this.height = s.height;
    this.layers = s.layers.map((x) => Layer.fromSnapshot(x));
    for (const l of this.layers) l.parent = null;
    this.activeLayerId = s.activeLayerId;
    this.selectedLayerIds = [...s.selectedLayerIds];
    if (sizeChanged) this.selection = new Selection(this.width, this.height);
    this.selection.width = this.width;
    this.selection.height = this.height;
    // Shared on the way back too, for the same reason: nothing writes into an
    // existing mask, so undo and redo can hand the same buffer around freely.
    this.selection.set(s.selectionMask || null);
    this.alphaChannels = s.alphaChannels.map((c) => ({ ...c }));
    this.paths = structuredClone(s.paths);
    this.guides = [...s.guides];
    this.quickMask = s.quickMask;
    if (s.profile !== undefined) this.profile = s.profile;
    if (s.frames !== undefined) this.frames = s.frames ? structuredClone(s.frames) : null;
    if (s.activeFrameId !== undefined) this.activeFrameId = s.activeFrameId;
    if (s.loopCount !== undefined) this.loopCount = s.loopCount;
    if (s.slices !== undefined) this.slices = s.slices ? structuredClone(s.slices) : null;
    if (s.colorSamplers !== undefined) this.colorSamplers = s.colorSamplers ? structuredClone(s.colorSamplers) : null;
    if (s.notes !== undefined) this.notes = s.notes ? structuredClone(s.notes) : null;
    if (s.artboards !== undefined) this.artboards = s.artboards ? structuredClone(s.artboards) : null;
    if (s.measurement !== undefined) this.measurement = s.measurement ? { ...s.measurement } : null;
    this.invalidate();
    this.emit('selection-change');
  }

  /* ------------------------------------------------------------------ */
  /* Canvas / image size                                                 */
  /* ------------------------------------------------------------------ */

  /** Resample every layer (Image > Image Size). */
  resample(w, h, smoothing = 'high') {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const sx = w / this.width, sy = h / this.height;
    const state = prepareGeometry(this, [sx, 0, 0, sy, 0, 0], w, h, smoothing, false, sx);
    const selection = new Selection(this.width, this.height);
    selection.set(this.selection.mask);
    selection.resize(w, h);
    applyGeometry(this, state);
    this.selection = selection;
    this.invalidate();
    this.emit('resize');
  }

  /** Change the canvas without resampling (Image > Canvas Size). */
  resizeCanvasTo(w, h, anchor = 'center') {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    const ax = anchor.includes('left') ? 0 : anchor.includes('right') ? 1 : 0.5;
    const ay = anchor.includes('top') ? 0 : anchor.includes('bottom') ? 1 : 0.5;
    const dx = Math.round((w - this.width) * ax);
    const dy = Math.round((h - this.height) * ay);
    checkPixelAllocation(w, h, this.memoryUse() / 4 + w * h, (this.memoryLimitMB || 512) * 1048576);
    const matrix = [1, 0, 0, 1, dx, dy];
    const paths = mapDocumentPaths(this.paths, matrix);
    const layers = this.flatLayers().map((layer) => {
      const pixels = layer.getPixelSource(), mask = layer.getMaskSource();
      for (const source of [pixels, mask]) if (source
        && (!Number.isSafeInteger(source.x + dx) || !Number.isSafeInteger(source.y + dy))) {
        throw new Error('画布尺寸调整后图层位置无效');
      }
      const geometry = { text: layer.text, shape: layer.shape };
      mapLayerGeometry(geometry, (x, y) => mapPoint(matrix, x, y));
      return { layer, geometry, smart: mapSmartPayload(layer.smart, matrix), pixels, mask };
    });
    const selection = new Selection(w, h);
    if (this.selection.mask) {
      const next = new Uint8ClampedArray(w * h);
      for (let y = 0; y < h; y++) {
        const sy = y - dy;
        if (sy < 0 || sy >= this.height) continue;
        const left = Math.max(0, dx), right = Math.min(w, this.width + dx);
        if (right > left) next.set(this.selection.mask.subarray(sy * this.width + left - dx, sy * this.width + right - dx), y * w + left);
      }
      selection.set(next);
    }
    for (const { layer, geometry, smart, pixels, mask } of layers) {
      layer.setDocumentSize(w, h);
      if (pixels) layer.setPixelSource(pixels.canvas, pixels.x + dx, pixels.y + dy);
      if (mask) layer.setMaskSource(mask.canvas, mask.x + dx, mask.y + dy, mask.defaultValue);
      layer.text = geometry.text;
      layer.shape = geometry.shape;
      layer.smart = smart;
    }
    this.width = w;
    this.height = h;
    this.paths = paths;
    this.selection = selection;
    this.invalidate();
    this.emit('resize');
  }

  crop(rect) {
    const { x, y, width, height } = rect;
    const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
    const state = prepareGeometry(this, [1, 0, 0, 1, -Math.round(x), -Math.round(y)], w, h, 'nearest', true);
    const selection = new Selection(w, h);
    applyGeometry(this, state);
    this.selection = selection;
    this.invalidate();
    this.emit('resize');
  }

  /** Apply an affine map to the complete document; clipping is an explicit crop. */
  transformAffine(matrix, width = this.width, height = this.height, { clip = false } = {}) {
    const values = Array.isArray(matrix) ? matrix : [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
    const state = prepareGeometry(this, values, width, height, 'high', clip);
    const selection = new Selection(width, height);
    applyGeometry(this, state);
    this.selection = selection;
    this.invalidate();
    this.emit('resize');
  }

  /** Flip or rotate the whole image. */
  transformImage(kind) {
    if (!['cw', 'ccw', '180', 'flip-h', 'flip-v'].includes(kind)) throw new Error('整图变换类型无效');
    const swap = kind === 'cw' || kind === 'ccw';
    const w = swap ? this.height : this.width;
    const h = swap ? this.width : this.height;
    const matrix = kind === 'cw' ? [0, 1, -1, 0, w, 0]
      : kind === 'ccw' ? [0, -1, 1, 0, 0, h]
      : kind === '180' ? [-1, 0, 0, -1, w, h]
      : kind === 'flip-h' ? [-1, 0, 0, 1, w, 0] : [1, 0, 0, -1, 0, h];
    const state = prepareGeometry(this, matrix, w, h, 'nearest');
    const selection = new Selection(w, h);
    applyGeometry(this, state);
    this.selection = selection;
    this.invalidate();
    this.emit('resize');
  }

  /* ------------------------------------------------------------------ */

  /** Estimated memory footprint, for the status bar. */
  /**
   * Bytes of pixel buffer this document actually holds.
   *
   * Counted per distinct canvas, not per layer. Two layers can share one buffer
   * — the PSD importer hands every pixel-less layer the same blank, and
   * copy-on-write means a snapshot shares until something is written — so
   * counting per layer reported a 41-layer import at 300 MB when the real figure
   * was 161 MB. A memory readout that overstates by 2x is not a memory readout.
   *
   * Alpha channels are counted too. They are full document-sized canvases held
   * on the document, and omitting them understated a channel-heavy file badly.
   */
  memoryUse() {
    const seen = new Set();
    let n = 0;
    const add = (cv) => {
      if (!cv || seen.has(cv)) return;
      seen.add(cv);
      n += cv.width * cv.height * 4;
    };
    for (const l of this.flatLayers()) {
      // Never `l.canvas` — asking a document how much memory it uses must not be
      // the thing that makes it use more. A compact layer is counted at its real
      // size, which is the number that matters.
      if (l._full) add(l._full);
      else if (l._tile) add(l._tile.canvas);
      add(l.getMaskSource()?.canvas);
      /*
       * The derived caches count too. `_maskAlpha` is a whole extra
       * document-sized canvas per masked layer, and a smart layer's render cache
       * is another — leaving them out is why a document could report 161 MB
       * while holding considerably more. This is a status-bar figure people use
       * to decide whether to close something, so it should not be a floor
       * presented as a total.
       */
      add(l._maskAlpha);
      if (l._smartCache) add(l._smartCache.canvas);
    }
    for (const c of this.alphaChannels || []) add(c.canvas);
    add(this._composite);
    add(this._channelComposite);
    return n;
  }
}
