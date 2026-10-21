import { app } from '../core/app.js';
import { download } from '../core/util.js';
import { savePKD } from '../io/pkd.js';
import { configureStore, verifyStore, closeStore } from '../io/store.js';
import { flushAll, stopSession, sessionEvents } from '../io/session.js';
import { buildCommit, partitionName } from './mode.js';
import { getTargets, insertImages } from './insert.js';
import { applyTheme } from '../theme.js';

const namespace = 'vbd:pikado';
const version = 1;

export function validEnvelope(event, sessionId) {
  const m = event.data;
  return event.source === parent && event.origin === location.origin
    && m && typeof m === 'object' && m.namespace === namespace && m.version === version
    && m.sessionId === sessionId && typeof m.type === 'string'
    && (m.requestId === undefined || (typeof m.requestId === 'string' && m.requestId.length > 0 && m.requestId.length <= 256));
}

async function acquireLock(name) {
  if (!navigator.locks) throw Object.assign(new Error('浏览器不支持工程写锁，请使用 Chrome 或 Edge'), { code: 'LOCK_UNAVAILABLE' });
  return new Promise((resolve, reject) => {
    navigator.locks.request(name, { ifAvailable: true }, (lock) => {
      if (!lock) {
        reject(Object.assign(new Error('此工程已在另一个页面打开，请关闭后重试'), { code: 'PROJECT_LOCKED' }));
        return;
      }
      return new Promise((release) => resolve(release));
    }).catch(reject);
  });
}

export function startEmbedded(boot) {
  const sessionId = new URLSearchParams(location.search).get('session');
  const shell = document.getElementById('app');
  shell.inert = true;
  document.querySelector('link[rel="manifest"]')?.remove();
  if (parent === window || !sessionId || sessionId.length > 256) return;
  let initialized = false;
  let ready = false;
  let closing = false;
  let disposed = false;
  let themeNotified = false;
  let releaseLock;
  let offSave;
  let queue = Promise.resolve();
  const blockInput = (event) => {
    if (!shell.inert) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  for (const type of ['keydown', 'keyup', 'paste', 'drop', 'pointerdown']) window.addEventListener(type, blockInput, true);
  // Responses retain no image Blobs; duplicate IDs never repeat a mutation.
  const requests = new Map();
  const send = (type, payload, requestId) => parent.postMessage({ namespace, version, sessionId, type, ...(requestId ? { requestId } : {}), ...(payload === undefined ? {} : { payload }) }, location.origin);
  const errorPayload = (error) => ({ code: typeof error?.code === 'string' ? error.code : 'OPERATION_FAILED', message: error?.message || '操作失败，请重试' });

  async function initialize(m) {
    const { userId, projectId, expectedCommit } = m.payload || {};
    if (!themeNotified) applyTheme(m.payload?.theme);
    const name = partitionName(userId, projectId);
    if (expectedCommit !== buildCommit) throw Object.assign(new Error('编辑器版本不匹配，请刷新页面'), { code: 'VERSION_MISMATCH' });
    releaseLock = await acquireLock(name);
    configureStore(name);
    await verifyStore();
    offSave = sessionEvents.on('state', (state) => {
      const status = state.error ? 'error' : state.saving ? 'saving' : 'saved';
      send('save-state', { status, ...(state.error ? { message: String(state.error) } : {}) });
    });
    await boot();
    ready = true;
    shell.inert = false;
    send('ready', { buildCommit });
  }

  async function execute(m) {
    shell.inert = true;
    try {
      if (m.type === 'get-targets') return getTargets(app);
      if (m.type === 'insert-images') return await insertImages(app, m.payload);
      if (m.type === 'download-project') {
        if (!app.activeDoc) throw new Error('请先打开工程');
        const doc = app.activeDoc;
        download(await savePKD(doc), `${doc.name.replace(/[\\/:*?"<>|]/g, '-') || 'Untitled'}.pkd`);
        return {};
      }
      if (m.type === 'flush') { await flushAll({ strict: true }); return {}; }
      if (m.type === 'dispose') {
        try {
          if (m.payload?.discard !== true) await flushAll({ strict: true });
          await stopSession();
          await closeStore();
          offSave?.();
          releaseLock?.();
          disposed = true;
          window.removeEventListener('message', receive);
          return {};
        } catch (error) {
          closing = false;
          throw error;
        }
      }
      throw Object.assign(new Error('不支持的编辑器操作'), { code: 'UNKNOWN_REQUEST' });
    } finally {
      if (!disposed) shell.inert = false;
    }
  }

  function receive(event) {
    if (!validEnvelope(event, sessionId) || disposed) return;
    const m = event.data;
    if (m.type === 'set-theme') {
      if (applyTheme(m.payload?.theme)) themeNotified = true;
      return;
    }
    if (m.type === 'init') {
      if (initialized) return;
      initialized = true;
      initialize(m).catch(async (error) => {
        shell.inert = true;
        offSave?.();
        await stopSession();
        await closeStore().catch(() => {});
        releaseLock?.();
        send('error', errorPayload(error), m.requestId);
      });
      return;
    }
    if (!m.requestId) return;
    if (requests.has(m.requestId)) {
      requests.get(m.requestId).then((response) => send(response.type, response.payload, m.requestId));
      return;
    }
    if (!ready || closing) {
      send('error', { code: 'NOT_READY', message: '编辑器尚未就绪或正在关闭' }, m.requestId);
      return;
    }
    if (m.type === 'dispose') closing = true;
    const work = queue.then(() => execute(m)).then(
      (payload) => ({ type: 'result', payload }),
      (error) => ({ type: 'error', payload: errorPayload(error) }),
    );
    requests.set(m.requestId, work);
    queue = work.then((response) => send(response.type, response.payload, m.requestId));
  }

  window.addEventListener('message', receive);
  send('booted');
}
