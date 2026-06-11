'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function listFiles(dir, predicate = () => true) {
  const fullDir = path.join(root, dir);
  const entries = fs.readdirSync(fullDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(relativePath, predicate));
    else if (predicate(relativePath)) files.push(relativePath);
  }
  return files;
}

test('DOM text uses the shared app font rendering defaults', () => {
  const css = readSource('src/styles.css');
  const html = readSource('src/index.html');

  for (const declaration of [
    "--text-font-family: 'Geist Sans', system-ui;",
    '--text-font-style: normal;',
    '--regular_text: 300;',
    '--bold_text: 350;',
    '--text-font-kerning: none;',
    '--text-font-stretch: normal;',
    '--text-font-variant-caps: normal;',
    '--text-letter-spacing: 0px;',
    '--text-direction: ltr;',
    '--menu-item-letter-spacing: var(--text-letter-spacing);',
  ]) {
    assert.ok(css.includes(declaration), `missing shared text declaration: ${declaration}`);
  }

  for (const bodyDeclaration of [
    'font: var(--text-font-style) var(--regular_text) var(--menu-item-font-size) var(--text-font-family);',
    'font-kerning: var(--text-font-kerning);',
    'font-stretch: var(--text-font-stretch);',
    'font-variant-caps: var(--text-font-variant-caps);',
    'letter-spacing: var(--text-letter-spacing);',
    'direction: var(--text-direction);',
  ]) {
    assert.ok(css.includes(bodyDeclaration), `body does not apply ${bodyDeclaration}`);
  }

  const fontWeightDeclarations = [...css.matchAll(/font-weight:\s*([^;]+);/g)]
    .map((match) => match[1].trim());
  assert.deepEqual(fontWeightDeclarations, ['300 700']);
  assert.equal(
    [...css.matchAll(/font:\s*var\(--text-font-style\)\s+var\(--bold_text\)\s+var\(--menu-item-font-size\)\s+var\(--text-font-family\);/g)].length,
    4
  );
  assert.equal(
    [...css.matchAll(/font:\s*var\(--text-font-style\)\s+var\(--regular_text\)\s+var\(--menu-item-font-size\)\s+var\(--text-font-family\);/g)].length,
    2
  );
  assert.match(css, /\.ctx-shortcut\s*\{[\s\S]*font: var\(--text-font-style\) var\(--regular_text\) var\(--menu-item-font-size\) var\(--text-font-family\);[\s\S]*line-height: inherit;[\s\S]*\}/);
  assert.doesNotMatch(css, /\b500\b/);
  assert.match(html, /Material\+Symbols\+Outlined:opsz,wght,FILL,GRAD@24,300,0,0/);
  assert.doesNotMatch(html, /wght[^"]*100\.\.700/);

  assert.match(css, /button,\s*input,\s*textarea,\s*select\s*\{[\s\S]*font: inherit;[\s\S]*font-variant-caps: inherit;[\s\S]*letter-spacing: inherit;[\s\S]*direction: inherit;[\s\S]*\}/);
  assert.doesNotMatch(css, /font-synthesis/);
  assert.doesNotMatch(css, /font-variant-numeric/);
  assert.doesNotMatch(css, /-webkit-font-smoothing/);
});

test('canvas text uses the same non-size font feature defaults', () => {
  const textLayout = readSource('src/js/text_layout.js');
  const renderer = readSource('src/js/renderer.js');

  for (const declaration of [
    'const regular_text = 400;',
    "const TEXT_FONT_STYLE = 'normal';",
    'const TEXT_FONT_FAMILY = "\'Geist Sans\', system-ui";',
    "const TEXT_CANVAS_FONT_KERNING = 'none';",
    "context.fontKerning = TEXT_CANVAS_FONT_KERNING;",
    "context.letterSpacing = '0px';",
    "context.fontStretch = 'normal';",
    "context.fontVariantCaps = 'normal';",
    "context.textAlign = 'left';",
    "context.direction = 'ltr';",
  ]) {
    assert.ok(textLayout.includes(declaration), `text layout missing ${declaration}`);
  }

  for (const declaration of [
    "context.fontKerning = 'none';",
    "context.letterSpacing = '0px';",
    "context.fontStretch = 'normal';",
    "context.fontVariantCaps = 'normal';",
    "context.textAlign = 'left';",
    "context.direction = 'ltr';",
  ]) {
    assert.ok(renderer.includes(declaration), `renderer missing ${declaration}`);
  }

  const fillTextFiles = listFiles('src/js', (file) => file.endsWith('.js'))
    .filter((file) => readSource(file).includes('fillText('))
    .sort();
  assert.deepEqual(fillTextFiles, ['src/js/renderer.js', 'src/js/text_layout.js']);
});
