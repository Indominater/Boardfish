'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fonts = path.join(__dirname, '../src/fonts');

test('the shipped ASCII atlas matches the bundled font and covers every printable glyph', () => {
  const data = JSON.parse(fs.readFileSync(path.join(fonts, 'geist-ascii-msdf.json'), 'utf8'));
  const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(fonts, 'Geist.woff2'))).digest('hex');
  assert.equal(data.source.sha256, hash, 'Regenerate the ASCII atlas when changing the font');
  assert.equal(data.source.weight, 400);
  const png = fs.readFileSync(path.join(fonts, 'geist-ascii-msdf.png'));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), data.atlas.width);
  assert.equal(png.readUInt32BE(20), data.atlas.height);
  assert.equal(data.atlas.yOrigin, 'bottom');
  assert.deepEqual(data.glyphs.map((glyph) => glyph.unicode).sort((a, b) => a - b),
    Array.from({ length: 95 }, (_, i) => i + 32));
  for (const glyph of data.glyphs) {
    if (glyph.unicode === 32) continue;
    const a = glyph.atlasBounds, p = glyph.planeBounds;
    assert.ok(a.left >= 0 && a.bottom >= 0 && a.right <= data.atlas.width && a.top <= data.atlas.height);
    assert.ok(a.right > a.left && a.top > a.bottom);
    assert.ok(p.right > p.left && p.top > p.bottom);
  }
});
