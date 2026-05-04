'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const Color = require('../src/js/eyedropper_color.js');

test('formats RGBA pixels for CSS, hex, and compact RGB text', () => {
  assert.equal(Color.rgbaToCss([12, 34, 56, 128]), 'rgba(12,34,56,0.502)');
  assert.equal(Color.rgbaToHex([12, 34, 56, 255]), '#0C2238');
  assert.equal(Color.rgbaToHex([12, 34, 56, 128]), '#0C223880');
  assert.equal(Color.rgbaToRgbText([12, 34, 56, 128]), '12 34 56');
});

test('parses supported CSS color forms into RGBA pixels', () => {
  assert.deepEqual(Color.parseCssColor('#0C2238'), [12, 34, 56, 255]);
  assert.deepEqual(Color.parseCssColor('#abc8'), [170, 187, 204, 136]);
  assert.deepEqual(Color.parseCssColor('rgb(12 34 56 / 0.5)'), [12, 34, 56, 128]);
  assert.deepEqual(Color.parseCssColor('rgba(300, -5, 10, 2)'), [255, 0, 10, 255]);
});

test('returns caller fallback for unsupported CSS color input', () => {
  const fallback = [1, 2, 3, 4];
  assert.equal(Color.parseCssColor('not-a-color', fallback), fallback);
  assert.equal(Color.parseHexColor('#xyz', fallback), fallback);
});
