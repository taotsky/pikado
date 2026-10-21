import { PikaDocument } from '../core/document.js';
import { Layer, LayerType } from '../core/layer.js';
import { decodeImage } from '../io/decode.js';
import { createCanvas } from '../core/util.js';

function reject(message, code = 'INVALID_INPUT') {
  throw Object.assign(new Error(message), { code });
}

export function validateImages(payload) {
  if (!payload || ![null, 'string'].includes(payload.docId === null ? null : typeof payload.docId)
    || ![null, 'string'].includes(payload.layerId === null ? null : typeof payload.layerId)
    || (!payload.docId && payload.layerId) || !Array.isArray(payload.images)
    || payload.images.length < 1 || payload.images.length > 8) reject('每次请选择 1 至 8 张图片');
  let bytes = 0;
  for (const image of payload.images) {
    if (!image || !(image.blob instanceof Blob) || !image.blob.size
      || typeof image.name !== 'string' || image.name.length > 512) reject('图片数据无效');
    bytes += image.blob.size;
  }
  if (bytes > 64 * 1024 * 1024) reject('图片总体积不能超过 64 MiB', 'LIMIT_EXCEEDED');
}

function targetOf(app, { docId, layerId }) {
  if (docId === null) return null;
  const doc = app.docs.find((d) => d.id === docId);
  if (!doc || (layerId !== null && !doc.findLayer(layerId))) reject('目标文档或图层已不存在，请重新选择', 'TARGET_MISSING');
  return doc;
}

export function getTargets(app) {
  return {
    activeDocumentId: app.activeDoc?.id || null,
    documents: app.docs.map((doc) => {
      const layers = [];
      const walk = (list, depth) => {
        for (const layer of list) {
          layers.push({ id: layer.id, name: layer.name, type: layer.type, depth });
          if (layer.children) walk(layer.children, depth + 1);
        }
      };
      walk(doc.layers, 0);
      return { id: doc.id, name: doc.name, width: doc.width, height: doc.height, activeLayerId: doc.activeLayerId || null, layers };
    }),
  };
}

export async function insertImages(app, payload) {
  validateImages(payload);
  targetOf(app, payload);
  const sources = [];
  try {
    let sourcePixels = 0;
    for (const image of payload.images) {
      const canvas = await decodeImage(image.blob);
      sources.push(canvas);
      const pixels = canvas.width * canvas.height;
      if (!pixels || canvas.width > 8192 || canvas.height > 8192 || pixels > 16777216) reject('单图最多 16,777,216 像素，单边最多 8192', 'LIMIT_EXCEEDED');
      sourcePixels += pixels;
      if (sourcePixels > 33554432) reject('本次图片总像素超过限制', 'LIMIT_EXCEEDED');
    }
    const existing = targetOf(app, payload);
    const width = existing?.width || sources[0].width;
    const height = existing?.height || sources[0].height;
    if (width * height * sources.length + sourcePixels > 67108864) reject('目标画布与图片总像素超过本次插入预算', 'LIMIT_EXCEEDED');
    const doc = existing || new PikaDocument({ width, height, name: payload.images[0].name || 'Image' });
    const snapshot = existing && doc.captureState();
    const dirty = doc.dirty;
    const history = { states: [...doc.history.states], index: doc.history.index };
    const layerIds = new Array(sources.length);
    let above = payload.layerId === null ? null : doc.findLayer(payload.layerId);
    try {
      // Reverse insertion keeps the original result order from top to bottom.
      for (let i = sources.length - 1; i >= 0; i--) {
        const source = sources[i];
        const layer = new Layer({ type: LayerType.RASTER, name: payload.images[i].name || 'Image' });
        const scale = Math.min(1, width / source.width, height / source.height);
        const w = Math.max(1, Math.round(source.width * scale));
        const h = Math.max(1, Math.round(source.height * scale));
        const pixels = createCanvas(w, h);
        const c = pixels.getContext('2d');
        c.imageSmoothingQuality = 'high';
        c.drawImage(source, 0, 0, w, h);
        layer.setPixelSource(pixels, Math.round((width - w) / 2), Math.round((height - h) / 2), doc);
        doc.addLayer(layer, { above });
        above = layer;
        layerIds[i] = layer.id;
      }
      if (existing) doc.commit('Insert VBD images');
      else {
        doc.history.clear('Insert VBD images');
        doc.dirty = true;
        app.addDocument(doc);
      }
    } catch (error) {
      if (snapshot) {
        doc.restoreState(snapshot);
        doc.dirty = dirty;
        doc.history.states = history.states;
        doc.history.index = history.index;
        doc.emit('structure');
        doc.history.emit('change');
      }
      throw error;
    }
    app.setActiveDoc(doc);
    app.requestRender();
    return { docId: doc.id, layerIds };
  } finally {
    for (const canvas of sources) { canvas.width = 0; canvas.height = 0; }
  }
}
