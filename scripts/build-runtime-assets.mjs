import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { WEB_PREVIEW_SCRIPTS } from '../src/js/startup_manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, 'src');
const jsRoot = path.join(srcRoot, 'js');

const RUNTIME_CONSOLE_SENTINEL = '__BOARDFISH_RUNTIME_CONSOLE_7E3D2A91__';
const DROP_DIAGNOSTIC_SENTINEL = '__BOARDFISH_DROP_DIAGNOSTIC_1C6A53B4__';
const readableProductionAudit = process.env.BOARDFISH_BUILD_READABLE === '1';
const DEV_DIAGNOSTICS_START = '/* BOARDFISH_DEV_DIAGNOSTICS_START */';
const DEV_DIAGNOSTICS_END = '/* BOARDFISH_DEV_DIAGNOSTICS_END */';
const DIAGNOSTIC_APIS = Object.freeze([
  'StartupDebug',
  'ClipDebug',
  'HistoryDebug',
  'ViewportDebug',
  'SaveDebug',
  'OpenDebug',
  'ExportDebug',
  'InsertDebug',
  'TextSelDebug',
  'PillDebug',
  'MenuDebug',
  'ManualPerfDebug',
]);
const DIAGNOSTIC_CALLS = Object.freeze([
  'logStartupStep',
  'logStep',
  'logInputStep',
  'logPasteStep',
  'textEditorDebugLog',
  'textEditorDebugNow',
  'textEditorDebugRound',
  'textEditorEventDebugStats',
  'textEditorSelectionDebugStats',
  'textEditorCaretLineDebugStats',
  'textEditorObjectDebugStats',
  'textEditorSizeDebugStats',
  'textEditorProxySizeDebugStats',
  'textEditorTextStats',
  'textEditorClipStep',
  'textEditorClipboardLog',
  'textEditorPerfDebugApi',
  'textEditorClipDebugApi',
  'shouldTraceTextEditorInput',
  'recordTextEditorInputPerfStep',
  'recordInputSetupStep',
  'nextTextEditInputDebugSeq',
  'selectionInputPerfDebugApi',
  'selectionResizeDebugNow',
  'selectionResizeDebugRound',
  'selectionResizeEventMeta',
  'selectionResizeTextObjectStats',
  'recordSelectionTextResizeStep',
  'canvasInputDebugRound',
  'canvasInputNow',
  'canvasInputEventDebugMeta',
  'canvasInputViewportDebugSnapshot',
  'canvasInputWheelDebugMeta',
  'canvasInputTextDebugLog',
  'logClickEditStep',
  'historyDebugRound',
  'logTextEditHistoryDebug',
  'objectCommandDebugNow',
  'objectCommandTextStats',
  'imageFileDebugName',
  'imageSourceDebugInfo',
  'textClipboardStats',
  'clipboardTextStats',
  'clipboardTextMetricsForObjects',
  'clipboardIoNow',
  'clipboardIoElapsedMs',
  'clipboardNow',
  'clipboardElapsedMs',
  'webSourceClipboardKind',
  'recordMotionDebug',
  'isHistoryDebugEnabled',
  'isDebugApiEnabled',
  'shouldPrepareImagePreviewDebug',
  'isDebugApiEnabledForStep',
  'isOpenDebugActive',
  'isPillDebugActive',
  'shouldCollectOpenBoardMetrics',
  'getBoardSaveDebugMetrics',
  'getBoardOpenDebugMetrics',
  'getOpenImageRuntimeDebugMetrics',
  'getImageStoreOpenDebugSampleIfEnabled',
  'scheduleSaveFrameProbe',
  'scheduleOpenFrameProbe',
  'registerDebugCommand',
]);
const PRODUCTION_FALSE_DIAGNOSTIC_FLAGS = Object.freeze([
  'collectDiagnostics',
  'collectDebug',
  'collectPanDebug',
  'collectDrawDebug',
  'collectViewportDebug',
  'collectOpenInitialRenderDebug',
  'collectOpenPreviewFallbackDebug',
  'collectTransformDebug',
  'collectInitialRenderDebug',
  'collectMotionDebug',
  'collectClipboardDiagnostics',
  'collectClipboardIoDiagnostics',
  'perfTraceInput',
  'shouldLogInput',
]);

const variants = {
  'web-preview': {
    outDir: path.join(root, 'dist-web'),
    scripts: WEB_PREVIEW_SCRIPTS,
    bundle: 'assets/boardfish-web-preview.min.js',
  },
};

function assertInsideWorkspace(target) {
  const resolved = path.resolve(target);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`refusing to write outside workspace: ${resolved}`);
  }
  return resolved;
}

async function resetDir(dir) {
  const resolved = assertInsideWorkspace(dir);
  await rm(resolved, { recursive: true, force: true });
  await mkdir(resolved, { recursive: true });
}

async function copyDir(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    const source = path.join(from, entry);
    const target = path.join(to, entry);
    const info = await stat(source);
    if (info.isDirectory()) {
      await copyDir(source, target);
    } else {
      await copyFile(source, target);
    }
  }
}

async function copyStaticAssets(outDir) {
  await copyFile(path.join(srcRoot, 'styles.css'), path.join(outDir, 'styles.css'));
  await copyFile(path.join(srcRoot, 'boardfish-icon.png'), path.join(outDir, 'boardfish-icon.png'));
  await copyDir(path.join(srcRoot, 'fonts'), path.join(outDir, 'fonts'));
  await copyFile(path.join(srcRoot, 'manifest.webmanifest'), path.join(outDir, 'manifest.webmanifest'));
  await copyFile(path.join(srcRoot, 'boardfish-icon-192.png'), path.join(outDir, 'boardfish-icon-192.png'));
}

function resolveScriptPath(script) {
  return path.resolve(jsRoot, script);
}

async function concatenateScripts(scripts, variantName) {
  const parts = [];
  for (const script of scripts) {
    const filePath = resolveScriptPath(script);
    const source = await readFile(filePath, 'utf8');
    const relative = path.relative(root, filePath).replace(/\\/g, '/');
    parts.push(`\n;/* ${variantName}: ${relative} */\n${source}\n`);
  }
  return parts.join('');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeQualifiedDiagnosticApis(source) {
  const apiPattern = DIAGNOSTIC_APIS.map(escapeRegExp).join('|');
  return source.replace(
    new RegExp(`\\b(?:root|globalThis|window)\\.(${apiPattern})\\b`, 'g'),
    '$1',
  );
}

function inlineProductionDiagnosticFlags(source) {
  let next = source;
  for (const flag of PRODUCTION_FALSE_DIAGNOSTIC_FLAGS) {
    next = next.replace(
      new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(flag)}\\s*=\\s*[^;]+;`, 'g'),
      '',
    );
  }
  return next;
}

function stripMarkedDeveloperDiagnostics(source) {
  const starts = source.split(DEV_DIAGNOSTICS_START).length - 1;
  const ends = source.split(DEV_DIAGNOSTICS_END).length - 1;
  if (starts !== ends) throw new Error('unbalanced developer diagnostic build markers');
  const block = new RegExp(
    `${escapeRegExp(DEV_DIAGNOSTICS_START)}[\\s\\S]*?${escapeRegExp(DEV_DIAGNOSTICS_END)}`,
    'g',
  );
  return source.replace(block, '');
}

function aliasNamedDiagnosticCalls(source) {
  const callPattern = DIAGNOSTIC_CALLS.map(escapeRegExp).join('|');
  return source.replace(
    new RegExp(`(?<![\\w$])(${callPattern})\\s*(?:\\?\\.)?\\s*\\(`, 'g'),
    (match, _name, offset, wholeSource) => {
      const prefix = wholeSource.slice(Math.max(0, offset - 24), offset);
      return /\bfunction\s*$/.test(prefix) ? match : `${DROP_DIAGNOSTIC_SENTINEL}.log(`;
    },
  );
}

async function compileProductionBundle(source) {
  if (source.includes(RUNTIME_CONSOLE_SENTINEL)) {
    throw new Error('production console sentinel collides with runtime source');
  }
  if (source.includes(DROP_DIAGNOSTIC_SENTINEL)) {
    throw new Error('production diagnostic sentinel collides with runtime source');
  }

  const define = {
    BOARDFISH_PRODUCTION: 'true',
    DEBUG_TOOLS_ENABLED: 'false',
    module: 'undefined', require: 'undefined',
    console: RUNTIME_CONSOLE_SENTINEL,
    'OpenDebug.hydrationConcurrency': 'openHydrationConcurrency',
  };
  for (const flag of PRODUCTION_FALSE_DIAGNOSTIC_FLAGS) define[flag] = 'false';
  for (const api of DIAGNOSTIC_APIS) {
    define[`${api}.enabled`] = 'false';
    define[api] = DROP_DIAGNOSTIC_SENTINEL;
  }

  // esbuild can drop console calls including their arguments. Hide the real
  // console first, route diagnostics through console, then restore it.
  const productionSource = inlineProductionDiagnosticFlags(stripMarkedDeveloperDiagnostics(source));
  const diagnosticCallsAliased = aliasNamedDiagnosticCalls(normalizeQualifiedDiagnosticApis(productionSource));
  const substituted = await esbuild.transform(diagnosticCallsAliased, {
    define,
    legalComments: 'none',
    target: 'es2020',
  });
  const droppable = substituted.code.replaceAll(DROP_DIAGNOSTIC_SENTINEL, 'console');
  const stripped = await esbuild.transform(droppable, {
    drop: ['console'],
    legalComments: 'none',
    minifyIdentifiers: !readableProductionAudit,
    minifySyntax: true,
    minifyWhitespace: !readableProductionAudit,
    target: 'es2020',
    treeShaking: true,
  });
  const restored = await esbuild.transform(stripped.code, {
    define: { [RUNTIME_CONSOLE_SENTINEL]: 'console' },
    legalComments: 'none',
    minifyIdentifiers: !readableProductionAudit,
    minifySyntax: true,
    minifyWhitespace: !readableProductionAudit,
    target: 'es2020',
    treeShaking: true,
  });
  if (restored.code.includes(RUNTIME_CONSOLE_SENTINEL)) {
    throw new Error('production console sentinel was not restored');
  }
  return restored;
}

async function writeIndex(outDir, scriptTag, preloadScript) {
  const html = await readFile(path.join(srcRoot, 'index.html'), 'utf8');
  let next = html.replace(
    /<script\s+type="module"\s+src="js\/main(?:\.[^"]+)?\.mjs"><\/script>/,
    scriptTag,
  );
  next = next.replace(
    /\n<\/head>/,
    `\n  <link rel="preload" href="${preloadScript}" as="script" />\n</head>`,
  );
  await writeFile(path.join(outDir, 'index.html'), next);
}

async function writeServiceWorker(outDir, buildAssets) {
  const source = await readFile(path.join(srcRoot, 'sw.js'), 'utf8');
  const assets = buildAssets.map((asset) => `  './${asset}',`).join('\n');
  const next = source.replace(
    '  /* BOARDFISH_BUILD_ASSETS */',
    assets,
  );
  await writeFile(path.join(outDir, 'sw.js'), next);
}

function cacheBustedBundlePath(bundle, code) {
  const hash = createHash('sha256').update(code).digest('hex').slice(0, 12);
  return bundle.replace(/(?:\.min)?\.js$/, `.${hash}.min.js`);
}

async function buildBundle(variantName, config) {
  await resetDir(config.outDir);
  await mkdir(path.join(config.outDir, 'assets'), { recursive: true });
  await copyStaticAssets(config.outDir);

  const concatenated = await concatenateScripts(config.scripts, variantName);
  const result = await compileProductionBundle(concatenated);
  const bundle = cacheBustedBundlePath(config.bundle, result.code);
  const outPath = path.join(config.outDir, bundle);
  await writeFile(outPath, result.code);
  await writeIndex(config.outDir, `<script src="${bundle}"></script>`, bundle);
  await writeServiceWorker(config.outDir, [bundle]);

  const rawKb = Math.round(result.code.length / 1024 * 10) / 10;
  const gzipKb = Math.round(gzipSync(result.code).length / 1024 * 10) / 10;
  console.log(`${variantName}: ${bundle} ${rawKb} KB raw, ${gzipKb} KB gzip`);
}

const requested = process.argv.slice(2);
const names = requested.length ? requested : ['web-preview'];

for (const name of names) {
  const config = variants[name];
  if (!config) {
    console.error(`Unknown build variant "${name}". Expected one of: ${Object.keys(variants).join(', ')}`);
    process.exit(1);
  }
  await buildBundle(name, config);
}
