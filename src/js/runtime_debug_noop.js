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
  toggleNativeSkewStress: async () => ({ summary: {}, events: [], samples: [] }),
  events: [],
  samples: [],
  expectedCanvasBg(theme = 'light') {
    return theme === 'dark' ? '#1c1b22' : 'rgb(224, 224, 227)';
  },
  lastResult: null,
  lastJson: '',
};

const ClipDebug = createNoopDebugApi({
  largePasteReport: () => null,
  pasteBreakdown: () => null,
});
const HistoryDebug = createNoopDebugApi();
const ViewportDebug = createNoopDebugApi();
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
  nativeBreakdown: () => [],
});
const ExportAllDiag = createNoopDebugApi();
const TextSelDebug = createNoopDebugApi({
  _logDraw: noop,
  _logHit: noop,
  _logSelection: noop,
});
const PillDebug = createNoopDebugApi();
const MenuDebug = createNoopDebugApi();
const EyedropperDebug = createNoopDebugApi({
  state: () => ({}),
  _count: noop,
  _countPerf: noop,
  _logPreviewPresent: noop,
  _logReadbackFailure: noop,
  _logSample: noop,
  _logSamplingEvent: noop,
  _logToggle: noop,
  _logUnsafeImageSkip: noop,
  _recordPrewarmTiming: noop,
  _recordSampleTiming: noop,
  _startFrameProbe: noop,
  _stopFrameProbe: noop,
});

const exposeDebug = () => {};
const registerDebugCommand = () => {};
async function beginDebug() { return null; }
async function finishDebug() { return null; }

if (typeof window !== 'undefined') {
  window.exposeDebug = exposeDebug;
  window.registerDebugCommand = registerDebugCommand;
}
