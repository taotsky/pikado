import { createCanvas } from '../core/util.js';
import { setLayerPreview, setLayerMaskPreview } from '../render/compositor.js';
import { checkPixelAllocation } from '../core/layer.js';
export { transformPixelSource as transformSource } from '../core/layer.js';

export function setPaintPreview(layer, canvas) {
  if (!canvas) {
    setLayerPreview(layer.id, null);
    setLayerMaskPreview(layer.id, null);
  } else if (layer.editingMask && layer.getMaskSource()) setLayerMaskPreview(layer.id, canvas);
  else setLayerPreview(layer.id, canvas);
}

/** A private document-space surface for an existing pixel operation. */
export function paintSurface(doc, layer) {
  checkPixelAllocation(doc.width, doc.height,
    doc.memoryUse() / 4 + doc.width * doc.height * 3, (doc.memoryLimitMB || 512) * 1048576);
  return layer.editingMask && layer.getMaskSource()
    ? layer.projectMask(doc)
    : layer.projectPixels(doc);
}

/** Replace only the operation's document-space region, including erased alpha. */
export function commitPaintSurface(doc, layer, canvas, rect = null, isMask = layer.editingMask && !!layer.getMaskSource()) {
  const x = Math.max(0, Math.floor(rect ? rect.x ?? rect.x0 : 0));
  const y = Math.max(0, Math.floor(rect ? rect.y ?? rect.y0 : 0));
  const right = Math.min(doc.width, Math.ceil(rect ? rect.width == null ? rect.x1 : rect.x + rect.width : doc.width));
  const bottom = Math.min(doc.height, Math.ceil(rect ? rect.height == null ? rect.y1 : rect.y + rect.height : doc.height));
  if (right <= x || bottom <= y) return false;
  checkPixelAllocation(right - x, bottom - y,
    doc.memoryUse() / 4 + canvas.width * canvas.height, (doc.memoryLimitMB || 512) * 1048576);
  const pixels = createCanvas(right - x, bottom - y);
  pixels.getContext('2d').drawImage(canvas, -x, -y);
  const region = { x, y, width: pixels.width, height: pixels.height };
  if (isMask) layer.commitMaskRegion(doc, region, pixels);
  else layer.commitPixelRegion(doc, region, pixels);
  return true;
}
