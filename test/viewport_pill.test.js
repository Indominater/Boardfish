'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');

function createElement(id = 'el') {
  const attrs = new Map();
  const children = [];
  const classes = new Set();
  const el = {
    id,
    dataset: {},
    style: {},
    textContent: '',
    parentNode: null,
    children,
    appendChild(child) {
      child.parentNode = el;
      children.push(child);
      return child;
    },
    remove() {
      if (!el.parentNode) return;
      const siblings = el.parentNode.children || [];
      const index = siblings.indexOf(el);
      if (index >= 0) siblings.splice(index, 1);
      el.parentNode = null;
    },
    querySelector(selector) {
      if (selector !== '.opening-shield-pill') return null;
      return children.find((child) => child.classList.contains('opening-shield-pill')) || null;
    },
    setAttribute(name, value) {
      attrs.set(name, String(value));
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    get firstElementChild() {
      return children[0] || null;
    },
  };
  el.classList = {
    add(...names) {
      for (const name of names) classes.add(name);
    },
    remove(...names) {
      for (const name of names) classes.delete(name);
    },
    contains(name) {
      return classes.has(name);
    },
    toggle(name, force) {
      const next = force === undefined ? !classes.has(name) : !!force;
      if (next) classes.add(name);
      else classes.delete(name);
      return next;
    },
  };
  Object.defineProperty(el, 'className', {
    get() {
      return [...classes].join(' ');
    },
    set(value) {
      classes.clear();
      for (const name of String(value).split(/\s+/).filter(Boolean)) classes.add(name);
    },
  });
  return el;
}

function loadViewportPillHarness() {
  const source = fs.readFileSync(path.join(root, 'src', 'js', 'viewport.js'), 'utf8');
  const prefixEnd = source.indexOf('var _offscreen = document.createElement');
  assert.ok(prefixEnd > 0, 'viewport pill bootstrap section is missing');
  const motionCalls = [];
  const openingShield = createElement('opening-shield');
  openingShield.classList.add('active', 'opening-freeze');
  const island = createElement('island');
  const islZoom = createElement('isl-zoom');
  const context = {
    console,
    document: {
      createElement: () => createElement(),
    },
    openingShield,
    island,
    islZoom,
    clearTimeout() {},
    setTimeout() {
      return 1;
    },
    localStorage: {
      setItem() {},
    },
    performance: {
      now: () => 0,
    },
    PillDebug: {
      log() {},
    },
    BoardfishMotion: {
      applyActionAnimation(_action, payload = {}) {
        if (payload.pill) motionCalls.push(islZoom.textContent);
        return !!payload.pill;
      },
      bumpIsland() {
        motionCalls.push(islZoom.textContent);
      },
    },
    motionCalls,
  };

  vm.createContext(context);
  vm.runInContext(
    `${source.slice(0, prefixEnd)}\n` +
      'globalThis.showIslandMsg = showIslandMsg;\n' +
      'globalThis.startPillTask = startPillTask;\n' +
      'globalThis.updatePillTask = updatePillTask;\n',
    context,
    { filename: 'viewport.js' },
  );
  motionCalls.length = 0;
  return context;
}

test('pill messages replay smooth slide only when the message changes', () => {
  const context = loadViewportPillHarness();

  context.showIslandMsg('Saved');
  assert.deepEqual(context.motionCalls, ['Saved']);

  context.motionCalls.length = 0;
  context.showIslandMsg('Saved');
  assert.deepEqual(context.motionCalls, []);

  context.showIslandMsg('Copied');
  assert.deepEqual(context.motionCalls, ['Copied']);
});

test('busy pill progress updates smooth slide when the displayed message changes', () => {
  const context = loadViewportPillHarness();
  const busyPill = context.startPillTask({ message: '0/2', progress: true });
  assert.deepEqual(context.motionCalls, ['0/2']);

  context.motionCalls.length = 0;
  context.updatePillTask(busyPill, '0/2');
  assert.deepEqual(context.motionCalls, []);

  context.updatePillTask(busyPill, '1/2');
  assert.deepEqual(context.motionCalls, ['1/2']);

  const openingPill = context.openingShield.querySelector('.opening-shield-pill');
  assert.equal(openingPill.firstElementChild.textContent, '1/2');
  assert.equal(openingPill.classList.contains('visible'), true);
});
