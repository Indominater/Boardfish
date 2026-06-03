import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { VARIANT_SCRIPTS } from '../src/js/startup_manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, 'src');
const jsRoot = path.join(srcRoot, 'js');

const variants = {
  'web-preview': {
    outDir: path.join(root, 'dist-web'),
    scripts: VARIANT_SCRIPTS['web-preview'],
    bundle: 'assets/boardfish-web-preview.min.js',
    cacheBust: true,
    mode: 'bundle',
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

async function copyStaticAssets(outDir, { includeJs = false, includePwa = false } = {}) {
  await copyFile(path.join(srcRoot, 'styles.css'), path.join(outDir, 'styles.css'));
  await copyFile(path.join(srcRoot, 'boardfish-icon.png'), path.join(outDir, 'boardfish-icon.png'));
  await copyDir(path.join(srcRoot, 'fonts'), path.join(outDir, 'fonts'));
  if (includePwa) {
    await copyFile(path.join(srcRoot, 'manifest.webmanifest'), path.join(outDir, 'manifest.webmanifest'));
    await copyFile(path.join(srcRoot, 'boardfish-icon-192.png'), path.join(outDir, 'boardfish-icon-192.png'));
  }
  if (includeJs) await copyDir(jsRoot, path.join(outDir, 'js'));
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

async function writeIndex(outDir, scriptTag, { includePwa = false } = {}) {
  const html = await readFile(path.join(srcRoot, 'index.html'), 'utf8');
  let next = html.replace(
    /<script\s+type="module"\s+src="js\/main(?:\.[^"]+)?\.mjs"><\/script>/,
    scriptTag,
  );
  if (!includePwa) {
    next = next.replace(/\n\s*<link\s+rel="manifest"\s+href="manifest\.webmanifest"\s*\/>/, '');
  }
  await writeFile(path.join(outDir, 'index.html'), next);
}

async function writeServiceWorker(outDir, buildAssets = []) {
  const source = await readFile(path.join(srcRoot, 'sw.js'), 'utf8');
  const assets = buildAssets.map((asset) => asset.startsWith('./') ? asset : `./${asset}`);
  const next = source.replace(
    /const BOARDFISH_BUILD_ASSETS = \[\];/,
    `const BOARDFISH_BUILD_ASSETS = ${JSON.stringify(assets)};`,
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
  await copyStaticAssets(config.outDir, { includePwa: variantName === 'web-preview' });

  const concatenated = await concatenateScripts(config.scripts, variantName);
  const result = await esbuild.transform(concatenated, {
    minify: true,
    legalComments: 'none',
    target: 'es2020',
  });
  const bundle = config.cacheBust ? cacheBustedBundlePath(config.bundle, result.code) : config.bundle;
  const outPath = path.join(config.outDir, bundle);
  await writeFile(outPath, result.code);
  await writeIndex(config.outDir, `<script src="${bundle}"></script>`, {
    includePwa: variantName === 'web-preview',
  });
  if (variantName === 'web-preview') await writeServiceWorker(config.outDir, [bundle]);

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
