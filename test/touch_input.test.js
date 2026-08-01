'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const TouchInput = require('../src/js/touch_input.js');
const touchInputSource = fs.readFileSync(require.resolve('../src/js/touch_input.js'), 'utf8');

function makeGestureHarness(overrides = {}) {
  let clock = 0;
  let timerId = 0;
  const timers = new Map();
  const events = [];
  const controller = TouchInput.createTouchGestureController({
    holdDelayMs: 550,
    moveThresholdPx: 8,
    scheduleTimer(callback, delay) {
      const id = ++timerId;
      timers.set(id, { callback, due: clock + delay });
      return id;
    },
    cancelTimer(id) {
      timers.delete(id);
    },
    onTap: (event) => events.push({ type: 'tap', ...event }),
    onLongPress: (event) => events.push({ type: 'long-press', ...event }),
    onPanStart: (event) => events.push({ type: 'pan-start', ...event }),
    onPan: (event) => events.push({ type: 'pan', ...event }),
    onPinchStart: (event) => events.push({ type: 'pinch-start', ...event }),
    onPinch: (event) => events.push({ type: 'pinch', ...event }),
    ...overrides,
  });

  return {
    controller,
    events,
    advance(ms) {
      clock += ms;
      let ran = true;
      while (ran) {
        ran = false;
        for (const [id, timer] of [...timers]) {
          if (timer.due > clock) continue;
          timers.delete(id);
          timer.callback();
          ran = true;
        }
      }
    },
  };
}

const point = (pointerId, clientX, clientY, target = null) => ({
  pointerId,
  clientX,
  clientY,
  target,
});

test('a short stationary touch maps to one left-click tap', () => {
  const target = {};
  const harness = makeGestureHarness();
  harness.controller.pointerDown(point(1, 20, 30, target));
  harness.advance(200);
  harness.controller.pointerUp(point(1, 23, 32, target));

  assert.deepEqual(harness.events.map((event) => event.type), ['tap']);
  assert.equal(harness.events[0].x, 23);
  assert.equal(harness.events[0].y, 32);
  assert.equal(harness.events[0].target, target);
  assert.deepEqual(harness.controller.state(), { mode: 'idle', activeCount: 0 });
});

test('one-finger movement beyond the tap slop pans without tapping', () => {
  const harness = makeGestureHarness();
  harness.controller.pointerDown(point(1, 10, 10));
  harness.controller.pointerMove(point(1, 14, 13));
  assert.deepEqual(harness.events.map((event) => event.type), []);

  harness.controller.pointerMove(point(1, 20, 10));
  harness.controller.pointerMove(point(1, 24, 16));
  harness.controller.pointerUp(point(1, 24, 16));

  assert.deepEqual(harness.events.map((event) => event.type), ['pan-start', 'pan', 'pan']);
  assert.deepEqual(
    harness.events.filter((event) => event.type === 'pan').map(({ dx, dy }) => ({ dx, dy })),
    [{ dx: 10, dy: 0 }, { dx: 4, dy: 6 }],
  );
});

test('press and hold maps to one right-click long press and suppresses tap', () => {
  const harness = makeGestureHarness();
  harness.controller.pointerDown(point(7, 50, 60));
  harness.advance(549);
  assert.deepEqual(harness.events, []);
  harness.advance(1);
  harness.controller.pointerUp(point(7, 50, 60));

  assert.deepEqual(harness.events.map((event) => event.type), ['long-press']);
  assert.equal(harness.events[0].x, 50);
  assert.equal(harness.events[0].y, 60);
});

test('two touches pinch around their midpoint and can resume as a pan', () => {
  const harness = makeGestureHarness();
  harness.controller.pointerDown(point(1, 0, 0));
  harness.controller.pointerDown(point(2, 100, 0));
  for (const x of [120, 140, 160, 180, 200, 200]) {
    harness.controller.pointerMove(point(2, x, 0));
  }

  const pinchStart = harness.events.find((event) => event.type === 'pinch-start');
  const pinchEvents = harness.events.filter((event) => event.type === 'pinch');
  const pinch = pinchEvents[pinchEvents.length - 1];
  assert.equal(pinchStart.centerX, 50);
  assert.equal(pinchStart.distance, 100);
  assert.equal(pinch.centerX, 100);
  assert.equal(pinch.scale, 2);

  harness.controller.pointerUp(point(2, 200, 0));
  harness.controller.pointerMove(point(1, 12, 8));
  harness.controller.pointerUp(point(1, 12, 8));

  const resumedPan = harness.events.find((event) => event.type === 'pan-start' && event.resumedFromPinch);
  const pan = harness.events.find((event) => event.type === 'pan');
  assert.ok(resumedPan);
  assert.deepEqual({ dx: pan.dx, dy: pan.dy }, { dx: 12, dy: 8 });
  assert.equal(harness.events.some((event) => event.type === 'tap'), false);
});

test('an atomic touch snapshot updates both contacts before emitting zoom', () => {
  const harness = makeGestureHarness();
  harness.controller.pointerDown(point(1, 100, 0));
  harness.controller.pointerDown(point(2, 200, 0));
  harness.controller.pointerMoves([
    point(1, 75, 0),
    point(2, 225, 0),
  ]);

  const pinchEvents = harness.events.filter((event) => event.type === 'pinch');
  assert.equal(pinchEvents.length, 1);
  assert.equal(pinchEvents[0].centerX, 150);
  assert.equal(pinchEvents[0].scale, 1.5);
});

test('mobile browsers feed complete TouchEvent snapshots into the gesture controller', () => {
  assert.match(touchInputSource, /const useAtomicTouchEvents = \([\s\S]*navigator\?\.maxTouchPoints/);
  assert.match(touchInputSource, /const touchSnapshot = Array\.from\(\s*event\.touches \|\| \[\],[\s\S]*controller\.pointerMoves\(touchSnapshot\);/);
  assert.match(touchInputSource, /const finalTouchSnapshot = \[[\s\S]*event\.touches[\s\S]*event\.changedTouches[\s\S]*controller\.pointerMoves\(finalTouchSnapshot\);/);
  assert.doesNotMatch(touchInputSource, /event\.targetTouches \|\| event\.touches/);
});

test('a simultaneous two-finger lift commits one coherent final separation', () => {
  const harness = makeGestureHarness();
  harness.controller.pointerDown(point(1, 0, 0));
  harness.controller.pointerDown(point(2, 100, 0));
  harness.controller.pointerMoves([
    point(1, -25, 0),
    point(2, 125, 0),
  ]);
  harness.controller.pointerUp(point(1, -25, 0));
  harness.controller.pointerUp(point(2, 125, 0));

  const scales = harness.events
    .filter((event) => event.type === 'pinch')
    .map((event) => event.scale);
  assert.deepEqual(scales, [1.5, 1.5]);
});

test('pinch zoom follows separation instead of catching up after speed changes', () => {
  const harness = makeGestureHarness();
  harness.controller.pointerDown(point(1, 0, 0));
  harness.controller.pointerDown(point(2, 100, 0));
  for (const x of [151, 202, 151, 145, 150]) {
    harness.controller.pointerMove(point(2, x, 0));
  }

  const scales = harness.events
    .filter((event) => event.type === 'pinch')
    .map((event) => event.scale);
  assert.deepEqual(scales, [1.51, 2.02, 1.51, 1.45, 1.5]);
});

test('dense and sparse pinch samples produce the same zoom at the same separation', () => {
  const finalScale = (moves) => {
    const harness = makeGestureHarness();
    harness.controller.pointerDown(point(1, 0, 0));
    harness.controller.pointerDown(point(2, 100, 0));
    for (const x of moves) harness.controller.pointerMove(point(2, x, 0));
    return harness.events.filter((event) => event.type === 'pinch').at(-1).scale;
  };

  assert.equal(finalScale([110, 120, 130, 140, 150]), 1.5);
  assert.equal(finalScale([150]), 1.5);
  assert.equal(finalScale([90, 80, 75]), 0.75);
  assert.equal(finalScale([75]), 0.75);
});

test('a large pinch maps immediately to its exact separation without catch-up', () => {
  const harness = makeGestureHarness();
  harness.controller.pointerDown(point(1, 0, 0));
  harness.controller.pointerDown(point(2, 100, 0));
  harness.controller.pointerMove(point(2, 250, 0));
  harness.controller.pointerUp(point(2, 250, 0));

  const pinchEvents = harness.events.filter((event) => event.type === 'pinch');
  assert.deepEqual(pinchEvents.map((event) => event.scale), [2.5, 2.5]);
});

test('pinch viewport math keeps the original world point under the moving midpoint', () => {
  const next = TouchInput.pinchViewportFromGesture(
    { panX: 10, panY: 20, zoom: 1 },
    {
      startCenterX: 100,
      startCenterY: 120,
      centerX: 110,
      centerY: 130,
      scale: 2,
    },
    { minZoom: 0.01, maxZoom: 100 },
  );

  assert.deepEqual(next, { panX: -70, panY: -70, zoom: 2 });
  assert.equal((110 - next.panX) / next.zoom, 90);
  assert.equal((130 - next.panY) / next.zoom, 100);
});

test('cancelling a pending touch clears the hold timer without a click', () => {
  const harness = makeGestureHarness();
  harness.controller.pointerDown(point(1, 0, 0));
  harness.controller.pointerCancel(point(1, 0, 0));
  harness.advance(1000);

  assert.deepEqual(harness.events, []);
  assert.deepEqual(harness.controller.state(), { mode: 'idle', activeCount: 0 });
});
