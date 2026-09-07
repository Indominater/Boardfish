'use strict';

(function textLayoutZoomBenchmark() {
  const $ = id => document.getElementById(id);
  const baseline = new URLSearchParams(location.search).get('baseline') === '1';
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const round = value => Math.round(value * 1e6) / 1e6;
  const work = { wrappingCalls: 0, wrappingCharacters: 0, prefixSliceCalls: 0, prefixSliceBytes: 0 };
  const originalWrap = wrapTextParagraph, originalPrefixSlice = textPrefixWidthsSlice;
  wrapTextParagraph = function (...args) {
    work.wrappingCalls++; work.wrappingCharacters += args[3] - args[2];
    return originalWrap(...args);
  };
  textPrefixWidthsSlice = function (...args) {
    const result = originalPrefixSlice(...args);
    work.prefixSliceCalls++; work.prefixSliceBytes += result.byteLength;
    return result;
  };
  let fixture;
  function summarize(values) {
    const sorted = values.toSorted((a, b) => a - b);
    return { count: sorted.length, min: round(sorted[0] || 0), max: round(sorted.at(-1) || 0),
      mean: round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)),
      p50: round(sorted[Math.max(0, Math.ceil(sorted.length * .5) - 1)] || 0),
      p95: round(sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] || 0) };
  }
  function delta(before) { return Object.fromEntries(Object.keys(work).map(key => [key, work[key] - before[key]])); }
  function cloneFixture(id = fixture.id) {
    return { id, type: 'text', x: fixture.x, y: fixture.y, w: fixture.w, h: fixture.h,
      data: { ...fixture.data, content: fixture.data.content } };
  }
  function serializeRows(rows) {
    return JSON.stringify(rows.map(line => ({ text: line.text, startIndex: line.startIndex, endIndex: line.endIndex,
      nextStartIndex: line.nextStartIndex, caretEndIndex: line.caretEndIndex, logicalLineIndex: line.logicalLineIndex,
      y: line.y, textY: line.textY, visibleWidth: line.visibleWidth, prefixWidths: Array.from(line.prefixWidths),
      graphemeBoundaries: line.prefixWidths.graphemeBoundaries ? Array.from(line.prefixWidths.graphemeBoundaries) : null,
      boundarySpacing: line.prefixWidths.boundarySpacing ? Array.from(line.prefixWidths.boundarySpacing) : null })));
  }
  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function visibility() { return { state: document.visibilityState, focused: document.hasFocus() }; }

  async function run() {
    $('run').disabled = true;
    try {
      $('status').textContent = 'Preparing the wrapping index…';
      const obj = cloneFixture();
      objects = [obj];
      clearTextLayoutCaches({ measurements: true });
      refreshTextMetrics();
      await frame();
      const prepBefore = { ...work }, prepStart = performance.now();
      syncTextAutoHeight(obj);
      const preparation = { cpuMs: round(performance.now() - prepStart), ...delta(prepBefore),
        rowCount: obj._textWrappedLineIndexCache?.lineCount || obj._textWrappedLineCountCacheValue,
        visualIndexBytes: obj._textWrappedLineIndexCache?.visualRows?.byteLength || 0 };
      const samples = [], first = 100, initialLast = 104, frames = 80;
      if (preparation.rowCount <= initialLast + frames - 1) throw new Error('The fixture has too few wrapped rows for this benchmark.');
      const totalBefore = { ...work }, visibilityBefore = visibility();
      let previous = await frame();
      for (let index = 0; index < frames; index++) {
        const last = initialLast + index, before = { ...work }, started = performance.now();
        const layout = getTextLayoutForLineRange(obj, first, last);
        const cpuMs = performance.now() - started;
        const sample = { index, first, last, rows: layout.length, cpuMs: round(cpuMs), ...delta(before) };
        samples.push(sample);
        if (index % 10 === 9) $('status').textContent = `${baseline ? 'Previous' : 'Current'} layout: ${index + 1}/${frames} frames`;
        const at = await frame(); sample.rafMs = round(at - previous); previous = at;
      }
      const totalWork = delta(totalBefore), visibilityAfter = visibility();
      $('status').textContent = 'Verifying exact rows outside the timed region…';
      const last = initialLast + frames - 1;
      const requested = serializeRows(getTextLayoutForLineRange(obj, first, last));
      const reference = serializeRows(getTextLayout(cloneFixture('full-layout-reference')).slice(first, last + 1));
      const equality = { exact: requested === reference, first, last, rows: last - first + 1,
        requestedSha256: await sha256(requested), referenceSha256: await sha256(reference) };
      const result = { schemaVersion: 1, measuredAt: new Date().toISOString(), mode: baseline ? 'before' : 'after',
        source: baseline ? '/dev/text-layout-before.js' : '/js/text_layout.js',
        fixture: { id: fixture.id, characters: fixture.data.content.length, contentSha256: await sha256(fixture.data.content),
          width: fixture.w, originalHeight: fixture.h, x: fixture.x, y: fixture.y },
        environment: { userAgent: navigator.userAgent, dpr: devicePixelRatio, font: FONT,
          fontLoaded: document.fonts.check(FONT), visibilityBefore, visibilityAfter },
        preparation, frames, cpuMs: summarize(samples.map(sample => sample.cpuMs)),
        rafMs: summarize(samples.map(sample => sample.rafMs)), work: totalWork, equality, samples };
      $('json').textContent = JSON.stringify(result, null, 2);
      $('summary').textContent = `${result.mode}: layout CPU median ${result.cpuMs.p50} ms, p95 ${result.cpuMs.p95} ms\n`
        + `${totalWork.wrappingCharacters.toLocaleString()} paragraph characters rewrapped; ${totalWork.prefixSliceBytes.toLocaleString()} prefix bytes allocated\n`
        + `Exact row verification: ${equality.exact ? 'PASS' : 'FAIL'}`;
      if (!equality.exact) throw new Error('Indexed rows differ from the full layout.');
      const saved = await fetch('/__evidence/board-layout-zoom.json', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result) });
      if (!saved.ok) throw new Error(`Measurements completed, but evidence save failed: HTTP ${saved.status}`);
      $('status').textContent = `Complete: ${result.mode}, ${frames} frames, exact row verification passed.`;
    } catch (error) {
      $('status').textContent = `Error: ${error.message}`;
    } finally { $('run').disabled = false; }
  }
  $('run').addEventListener('click', run);
  (async () => {
    try {
      const response = await fetch('/__fixture/board.json');
      if (!response.ok) throw new Error(`Fixture unavailable: HTTP ${response.status}`);
      const board = await response.json();
      fixture = board.objects.find(obj => obj.id === 'obj-545' && obj.type === 'text');
      if (!fixture) throw new Error('The fixture does not contain text object obj-545.');
      await document.fonts.load(FONT);
      await document.fonts.ready;
      if (!document.fonts.check(FONT)) throw new Error('The Geist font did not load.');
      refreshTextMetrics();
      $('fixture').textContent = `${baseline ? 'Previous' : 'Current'} layout · ${fixture.id} · ${fixture.data.content.length.toLocaleString()} characters · actual Geist font`;
      $('status').textContent = 'Ready';
      $('run').disabled = false;
    } catch (error) { $('status').textContent = `Error: ${error.message}`; }
  })();
})();
