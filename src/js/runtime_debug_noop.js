'use strict';

const DEBUG_TOOLS_ENABLED = false;

if (!Object.prototype.hasOwnProperty.call(globalThis, '__BOARDFISH_DEBUG_TOOLS_ENABLED__')) {
  Object.defineProperty(globalThis, '__BOARDFISH_DEBUG_TOOLS_ENABLED__', {
    value: false,
    writable: false,
    configurable: false,
  });
}

const noop = () => {};

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, items.length));
  const workers = new Array(workerCount);
  for (let i = 0; i < workerCount; i++) {
    workers[i] = (async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await worker(items[index], index);
      }
    })();
  }
  await Promise.all(workers);
  return out;
}

const createNoopDebugApi = (extra = {}) => {
  return {
    start: () => null,
    step: noop,
    end: noop,
    count: noop,
    max: noop,
    isEnabled: () => false,
    log: noop,
    watch: () => noop,
    wrap: async (_ctx, _command, call) => call(),
    get enabled() { return false; },
    ...extra,
  };
};

const StartupDebug = {
  record: noop,
  sample: () => null,
};

const ClipDebug = createNoopDebugApi();
const HistoryDebug = createNoopDebugApi();
const ViewportDebug = createNoopDebugApi({
  recordShieldBlock: noop,
});
const SaveDebug = createNoopDebugApi();
const OpenDebug = createNoopDebugApi({
  hydrationConcurrency: 8,
  recordPreviewHeldRender: noop,
  recordDynamicPreview: noop,
  beginInitialRenderDebug: () => false,
  isInitialRenderDebugActive: () => false,
});
const ExportDebug = createNoopDebugApi({
  startMassive: noop,
  recordResolveStart: noop,
  recordResolveProgress: noop,
  recordResolveDone: noop,
  recordResolve: noop,
  recordSaveStart: noop,
  recordSaveBatch: noop,
  recordSaveDone: noop,
  recordProgressUi: noop,
  recordEventLoopYield: noop,
});
const InsertDebug = createNoopDebugApi();
const TextSelDebug = createNoopDebugApi({
  _logDraw: noop,
  _logClipboard: noop,
  _logEditLifecycle: noop,
  _logHit: noop,
  _logSelection: noop,
});
const PillDebug = createNoopDebugApi();
const MenuDebug = createNoopDebugApi();

const exposeDebug = () => {};
const registerDebugCommand = () => {};
async function beginDebug() { return null; }
async function finishDebug() { return null; }

if (typeof window !== 'undefined') {
  window.exposeDebug = exposeDebug;
  window.registerDebugCommand = registerDebugCommand;
}
