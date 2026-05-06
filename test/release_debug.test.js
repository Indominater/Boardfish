'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('debug flag has an explicit release reminder while local diagnostics are enabled', () => {
  const startupDebugSource = readSource('src/js/startup_debug.js');
  const contextMenuSource = readSource('src/js/context_menu.js');

  assert.match(startupDebugSource, /AGENTS: Set this to true only while running local diagnostics\/debug tests\./);
  assert.match(startupDebugSource, /Before making a new build or release, set it back to false\./);
  assert.match(startupDebugSource, /const DEBUG_TOOLS_ENABLED = true;/);
  assert.match(startupDebugSource, /var StartupDebug = DEBUG_TOOLS_ENABLED \?/);
  assert.match(startupDebugSource, /createNoopStartupDebug\(\)/);
  assert.match(contextMenuSource, /if \(DEBUG_TOOLS_ENABLED\) \{\s*for \(const type of \[/);
});
