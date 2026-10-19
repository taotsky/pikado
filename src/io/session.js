import { app } from '../core/app.js';
import { Emitter } from '../core/emitter.js';
import { createCanvas } from '../core/util.js';
import { getComposite } from '../render/compositor.js';
import { savePKD, loadPKD } from './pkd.js';
import {
  putDoc, getDocData, listDocs, deleteDoc, kvSet, kvGet,
  storageAvailable, requestPersistence, usage, DOC_LIMIT_BYTES,
} from './store.js';

/**
 * Session persistence: your open documents survive a refresh, a crash, and
 * being offline.
 *
 * Documents are serialised with the same `.pkd` writer File > Save uses, so
 * there is one format to trust rather than a parallel "autosave schema".
 *
 * Timing matters more than it looks. Serialising is 1-2 s for a large document
 * (PNG-encoding every layer), and `beforeunload` cannot await asynchronous
 * storage work — so a save triggered by the refresh itself would never finish.
 * Instead we save continuously in the background:
 *
 *   - 1.2 s after you stop editing (debounce), and
 *   - no more often than every 4 s per document (throttle floor), so a long
 *     drag-heavy session does not spend all its time encoding, and
 *   - immediately when the tab is hidden, which is the last reliable moment
 *     before a reload or a tab close.
 *
 * That bounds what a refresh can cost you to the few seconds since the last
 * quiet moment. Undo history is deliberately not persisted — Photoshop does not
 * either, and it would multiply the payload by the number of history states.
 */

export const sessionEvents = new Emitter();

const SESSION_KEY = 'session';
const IDLE_MS = 1200;
const MIN_INTERVAL_MS = 4000;
const THUMB_MAX = 320;

const state = {
  enabled: false,
  saving: false,
  lastSavedAt: 0,
  error: null,
  restoring: false,
};

/** @type {Map<string, {timer:any, lastSaveAt:number, signature:string, pending:boolean}>} */
const tracked = new Map();
const revisions = new WeakMap();
let saveQueue = Promise.resolve();
let uninstall = [];

export async function stopSession() {
  state.enabled = false;
  for (const off of uninstall.splice(0)) off();
  for (const entry of tracked.values()) clearTimeout(entry.timer);
  await saveQueue;
  state.error = null;
  tracked.clear();
}

export function sessionState() {
  return { ...state };
}

function emit() {
  sessionEvents.emit('state', sessionState());
}

/**
 * A stable id for the document across sessions.
 *
 * `doc.id` is regenerated every time a document is constructed, so a restored
 * document would otherwise be stored again under a fresh key and the old copy
 * would linger until eviction.
 */
function storeIdOf(doc) {
  if (!doc._storeId) doc._storeId = doc.id;
  return doc._storeId;
}

/**
 * What "unchanged" means. The history position moves on every commit, and the
 * rest covers the things that change without one.
 */
function signatureOf(doc) {
  const h = doc.history;
  return `${revisions.get(doc) || 0}|${h ? h.index : 0}.${h ? h.states.length : 0}|${doc.width}x${doc.height}|${doc.name}|${doc.layers.length}`;
}

/** A small PNG of the composite, for the welcome screen's recent list. */
async function makeThumb(doc) {
  try {
    const src = getComposite(doc);
    const s = Math.min(THUMB_MAX / doc.width, THUMB_MAX / doc.height, 1);
    const w = Math.max(1, Math.round(doc.width * s));
    const h = Math.max(1, Math.round(doc.height * s));
    const cv = createCanvas(w, h);
    const c = cv.getContext('2d');
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, w, h);
    return await new Promise((res) => cv.toBlob((b) => res(b), 'image/png'));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

/**
 * Write a document to local storage now.
 * @param {import('../core/document.js').PikaDocument} doc
 * @param {{force?:boolean}} [opts] force skips the "nothing changed" check
 */
export function saveDocNow(doc, opts = {}) {
  const task = saveQueue.then(() => saveDocument(doc, opts));
  saveQueue = task.catch(() => {});
  return task;
}

async function saveDocument(doc, opts = {}) {
  if (!state.enabled || !doc || state.restoring) return false;
  const id = storeIdOf(doc);
  const entry = tracked.get(id) || { timer: null, lastSaveAt: 0, signature: '', pending: false };
  tracked.set(id, entry);

  const sig = signatureOf(doc);
  if (!opts.force && sig === entry.signature) return false;

  state.saving = true;
  state.error = null;
  emit();
  try {
    const [data, thumb] = await Promise.all([savePKD(doc), makeThumb(doc)]);
    if (data.size > DOC_LIMIT_BYTES) {
      state.error = 'too-large';
      app.toast(`"${doc.name}" is too large to keep locally, so it will not be restored after a refresh.`, 'warn', 6000);
      return false;
    }
    await putDoc({
      id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
      layers: doc.flatLayers().length,
      data,
      thumb,
    }, { keepIds: app.docs.map(storeIdOf) });
    entry.signature = sig;
    entry.lastSaveAt = Date.now();
    state.lastSavedAt = entry.lastSaveAt;
    if (!await writeSessionPointer()) throw new Error('无法保存本地工程会话');
    return true;
  } catch (err) {
    state.error = (err && err.message) || String(err);
    console.warn('[session] save failed:', state.error);
    return false;
  } finally {
    state.saving = false;
    emit();
  }
}

/** Debounced autosave for one document. */
function schedule(doc) {
  if (!state.enabled || state.restoring || !doc) return;
  revisions.set(doc, (revisions.get(doc) || 0) + 1);
  const id = storeIdOf(doc);
  const entry = tracked.get(id) || { timer: null, lastSaveAt: 0, signature: '', pending: false };
  tracked.set(id, entry);

  clearTimeout(entry.timer);
  const since = Date.now() - entry.lastSaveAt;
  const wait = Math.max(IDLE_MS, MIN_INTERVAL_MS - since);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (app.docs.includes(doc)) saveDocNow(doc);
  }, wait);
}

/** Save every open document that has changed. Used when the tab goes away. */
export async function flushAll({ strict = false } = {}) {
  if (!state.enabled) {
    if (strict) throw new Error('本地存储不可用，请下载工程备份');
    return;
  }
  await saveQueue;
  state.error = null;
  for (const doc of [...app.docs]) {
    const entry = tracked.get(storeIdOf(doc));
    if (entry && entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
    // Sequential on purpose: concurrent encodes of several large documents is
    // the one thing guaranteed not to finish before the tab dies.
    do {
      await saveDocNow(doc);
      if (state.error) {
        if (strict) throw new Error(state.error);
        return;
      }
    } while (state.enabled && app.docs.includes(doc) && tracked.get(storeIdOf(doc))?.signature !== signatureOf(doc));
  }
  if (!await writeSessionPointer()) {
    state.error = '无法保存本地工程会话';
    emit();
    if (strict) throw new Error(state.error);
  }
  emit();
}

async function writeSessionPointer() {
  if (!state.enabled || state.restoring) return true;
  // Never persist a pointer to a new document before its payload exists.
  const persisted = app.docs.filter((d) => tracked.get(storeIdOf(d))?.signature);
  const open = persisted.map((d) => ({
    id: storeIdOf(d),
    name: d.name,
    view: d === app.activeDoc ? app.viewport.serialize() : (app._views.get(d.id) || null),
  }));
  const activeId = persisted.includes(app.activeDoc) ? storeIdOf(app.activeDoc) : null;
  const saved = await kvSet(SESSION_KEY, { open, activeId, savedAt: Date.now() });
  if (!saved) {
    state.error = '无法保存本地工程会话';
    emit();
  }
  return saved;
}

/* ------------------------------------------------------------------ */
/* Restoring                                                           */
/* ------------------------------------------------------------------ */

/**
 * Reopen whatever was open last time.
 * @returns {Promise<number>} how many documents came back
 */
export async function restoreSession({ strict = false } = {}) {
  if (!storageAvailable()) return 0;
  const sess = await kvGet(SESSION_KEY);
  if (!sess || !Array.isArray(sess.open) || !sess.open.length) return 0;

  state.restoring = true;
  let restored = 0;
  let firstFailure = null;
  try {
    for (const ref of sess.open) {
      try {
        const blob = await getDocData(ref.id);
        if (!blob) {
          if (strict) throw new Error('本地工程数据缺失，请从备份恢复');
          continue;
        }
        const doc = await loadPKD(await blob.arrayBuffer());
        doc._storeId = ref.id;
        if (ref.name) doc.name = ref.name;
        doc.dirty = false;
        app.addDocument(doc, false);
        if (ref.view) app._views.set(doc.id, ref.view);
        // Restored work is already on disk; do not rewrite it immediately.
        tracked.set(ref.id, {
          timer: null, lastSaveAt: Date.now(), signature: signatureOf(doc), pending: false,
        });
        restored++;
      } catch (err) {
        if (!firstFailure) firstFailure = err;
        console.warn(`[session] could not restore ${ref.id}:`, err && err.message);
      }
    }

    if (restored) {
      const active = app.docs.find((d) => d._storeId === sess.activeId) || app.docs[0];
      app.setActiveDoc(active);
      const view = app._views.get(active.id);
      if (view) { app.viewport.restore(view); app.emit('view-change'); }
      else app.fitView();
    }
  } finally {
    state.restoring = false;
    emit();
  }

  if (firstFailure && !restored) {
    app.toast('Your previous session could not be restored.', 'warn', 5000);
  }
  if (firstFailure && strict) throw firstFailure;
  return restored;
}

/* ------------------------------------------------------------------ */
/* Recent projects (the welcome screen reads these)                    */
/* ------------------------------------------------------------------ */

/** @returns {Promise<Array<{id,name,width,height,layers,updatedAt,bytes,thumb}>>} */
export function listRecent() {
  return listDocs();
}

/** Open a stored project into a tab, or focus it if already open. */
export async function openRecent(id) {
  const already = app.docs.find((d) => d._storeId === id);
  if (already) { app.setActiveDoc(already); return already; }

  return app.busy('Opening…', async () => {
    const blob = await getDocData(id);
    if (!blob) { app.toast('That project is no longer stored locally.', 'warn'); return null; }
    const doc = await loadPKD(await blob.arrayBuffer());
    doc._storeId = id;
    doc.dirty = false;
    app.addDocument(doc);
    tracked.set(id, { timer: null, lastSaveAt: Date.now(), signature: signatureOf(doc), pending: false });
    app.fitView();
    if (!await writeSessionPointer()) throw new Error('无法保存本地工程会话');
    sessionEvents.emit('recents-change');
    return doc;
  });
}

export async function forgetRecent(id) {
  await deleteDoc(id);
  sessionEvents.emit('recents-change');
}

export { usage as storageUsage };

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

/**
 * Turn autosave on and start watching the app.
 * Safe to call when storage is unavailable — it simply stays off.
 */
export function installSession() {
  if (state.enabled) return true;
  if (!storageAvailable()) {
    console.info('[session] local storage unavailable; autosave is off');
    return false;
  }
  state.enabled = true;
  requestPersistence();

  const touch = (doc) => schedule(doc || app.activeDoc);
  const on = (event, fn) => uninstall.push(app.on(event, fn));
  on('doc-change', touch);
  on('doc-structure', touch);
  on('doc-resize', touch);
  on('history-change', touch);

  on('docs-change', () => {
    for (const doc of app.docs) {
      if (!tracked.has(storeIdOf(doc))) schedule(doc);
    }
    writeSessionPointer();
    sessionEvents.emit('recents-change');
  });
  on('active-doc', () => writeSessionPointer());

  // Closing a document should leave it in the recent list but drop it from the
  // session, so a refresh does not resurrect something you deliberately closed.
  on('docs-change', () => {
    const live = new Set(app.docs.map((d) => d._storeId).filter(Boolean));
    for (const [id, entry] of tracked) {
      if (!live.has(id)) {
        clearTimeout(entry.timer);
        tracked.delete(id);
      }
    }
  });

  // The last reliable moment before a reload or close.
  const hidden = () => {
    if (document.visibilityState === 'hidden') flushAll();
  };
  const pagehide = () => { flushAll(); };
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('pagehide', pagehide);
  uninstall.push(() => document.removeEventListener('visibilitychange', hidden));
  uninstall.push(() => window.removeEventListener('pagehide', pagehide));

  emit();
  return true;
}
