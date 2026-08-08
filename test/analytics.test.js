'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/js/analytics.js'), 'utf8');

function analyticsScriptsFor(pathname) {
  const scripts = [];
  const context = {
    location: {
      protocol: 'https:',
      hostname: 'indominater.github.io',
      pathname,
    },
    navigator: {},
    document: {
      head: {
        appendChild(script) {
          scripts.push(script);
        },
      },
      createElement() {
        return {
          setAttribute(name, value) {
            this[name] = value;
          },
        };
      },
    },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'analytics.js' });
  return scripts;
}

test('production pages load analytics while beta pages remain separate', () => {
  assert.equal(analyticsScriptsFor('/Boardfish/').length, 1);
  assert.equal(analyticsScriptsFor('/Boardfish/index.html').length, 1);
  assert.equal(analyticsScriptsFor('/Boardfish/beta').length, 0);
  assert.equal(analyticsScriptsFor('/Boardfish/beta/').length, 0);
  assert.equal(analyticsScriptsFor('/Boardfish/beta/index.html').length, 0);
  assert.equal(analyticsScriptsFor('/Boardfish-preview/').length, 0);
});
