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
const noopAsync = async () => null;

async function mapWithConcurrency(items, limit, worker) {
  const out = new Array(items.length);
  let next = 0;
  const workerCount = Math.max(1, Math.min(Number(limit) || 1, items.length));
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await worker(items[index], index);
    }
  }));
  return out;
}

const createNoopDebugApi = (extra = {}) => {
  return {
    enable: noop,
    disable: noop,
    setVerbose: noop,
    start: () => null,
    step: noop,
    end: noop,
    count: noop,
    max: noop,
    timing: noop,
    isEnabled: () => false,
    frameStart: () => null,
    frameEnd: noop,
    log: noop,
    logDomEvent: noop,
    watch: () => noop,
    wrap: async (_ctx, _command, call) => call(),
    invoke: noopAsync,
    dump: () => [],
    summary: () => [],
    phaseSummary: () => [],
    reset: noop,
    get enabled() { return false; },
    get events() { return []; },
    ...extra,
  };
};

const StartupDebug = {
  record: noop,
  sample: () => null,
  sampleFrames: async () => [],
  report: async () => ({ summary: {}, events: [], samples: [] }),
  toggleStress: async () => ({ summary: {}, events: [], samples: [] }),
  topBandScan: () => ({ summary: {}, rows: [] }),
  toggleBandStress: async () => ({ summary: {}, events: [], samples: [] }),
  toggleThemeOrderStress: async () => ({ summary: {}, events: [], samples: [] }),
  events: [],
  samples: [],
  expectedCanvasBg(theme = 'dark') {
    return theme === 'dark' ? '#1c1b22' : 'rgb(234, 234, 237)';
  },
  lastResult: null,
  lastJson: '',
};

const ClipDebug = createNoopDebugApi({
  copyBreakdown: () => [],
  copyPanReport: () => null,
  textPasteLagReport: () => null,
  textClipboardReport: () => null,
  largePasteReport: () => null,
  pasteBreakdown: () => null,
  status: () => null,
});
const HistoryDebug = createNoopDebugApi();
const ViewportDebug = createNoopDebugApi({
  rawInputTimeline: () => [],
  recordRawInput: noop,
  recordShieldBlock: noop,
});
const SaveDebug = createNoopDebugApi({
  report: () => null,
});
const OpenDebug = createNoopDebugApi({
  hydrationConcurrency: 8,
  hydrationSummary: () => null,
  hydrationBreakdown: () => [],
  cacheImageBreakdown: () => [],
  imageStoreSummary: () => null,
  imageStoreSample: () => [],
  hydrationCandidates: () => null,
  slowImages: () => [],
  report: () => null,
  setHydrationMode: noop,
  setHydrationConcurrency: noop,
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
  smoothnessReport: () => null,
});
const ManualPerfDebug = createNoopDebugApi();
const InsertDebug = createNoopDebugApi({
  report: () => null,
  imageBreakdown: () => [],
  fileBreakdown: () => [],
});
const TextSelDebug = createNoopDebugApi({
  clipboardReport: () => null,
  editLifecycleReport: () => [],
  exitEditReport: () => null,
  performanceSummary: () => null,
  selectionReport: () => null,
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
