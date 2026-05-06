'use strict';

// ─── Text selection debugger ──────────────────────────────────────────────────
// Diagnoses Windows text selection offset bugs.
// Usage:
//   await beginDebug({ textSel: ["enable"] })
//   await finishDebug({ textSel: ["summary", "report", "measure"] })
// Direct BoardfishDebug.textSel.* console calls are intentionally guarded so
// agents collect one downloadable JSON file instead of fragmented console output.
var _textSelDebugEnabled = false;
var TextSelDebug = (() => {
  const MAX = 400;
  const events = [];
  let nextId = 1;

  function push(evt) {
    if (!_textSelDebugEnabled) return;
    events.push({ id: nextId++, at: Math.round(performance.now() * 10) / 10, ...evt });
    if (events.length > MAX) events.shift();
  }

  function enable() {
    if (!DEBUG_TOOLS_ENABLED) return;
    _textSelDebugEnabled = true;
    console.info(
      '[textSel] enabled. Double-click a text object to edit it, then drag to select.' +
      '\nUse finishDebug({ textSel: ["report", "summary", "measure"] }) to collect results.'
    );
  }
  function disable() {
    _textSelDebugEnabled = false;
    if (DEBUG_TOOLS_ENABLED) console.info('[textSel] disabled.');
  }

  function summary() {
    const rows = events.map(e => ({
      id: e.id,
      type: e.type,
      wx: e.wx?.toFixed(2) ?? '',
      baseX: e.baseX?.toFixed(2) ?? '',
      wx_minus_baseX: e.wx != null && e.baseX != null ? (e.wx - e.baseX).toFixed(2) : '',
      hitLine: e.hitLine ?? '',
      returnedIdx: e.returnedIdx ?? '',
      selStart: e.selStart ?? '',
      selEnd: e.selEnd ?? '',
      x1: e.x1?.toFixed(2) ?? '',
      x2: e.x2?.toFixed(2) ?? '',
      lineText: e.lineText ? e.lineText.slice(0, 30) : '',
      note: e.note ?? '',
    }));
    console.table(rows);
    return rows;
  }

  function showWhitespace(text) {
    return String(text ?? '')
      .replace(/ /g, '·')
      .replace(/\t/g, '→')
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n\n');
  }

  function report() {
    if (typeof editingId === 'undefined' || !editingId) {
      console.warn('[textSel] No text object being edited. Double-click a text object first.');
      return null;
    }
    const obj = (typeof objectsMap !== 'undefined') && objectsMap.get(editingId);
    if (!obj) { console.warn('[textSel] Editing object not found.'); return null; }
    const value = _editEl?.value ?? obj.data.content ?? '';
    const selStart = _editEl?.selectionStart ?? 0;
    const selEnd = _editEl?.selectionEnd ?? 0;
    const lines = getTextLayout(obj);
    const rows = lines.map((line, i) => {
      const textEnd = line.startIndex + line.text.length;
      const nextStart = line.nextStartIndex ?? textEnd;
      const skipped = value.slice(textEnd, nextStart);
      return {
        line: i,
        start: line.startIndex,
        textEnd,
        nextStart,
        selected: selEnd > line.startIndex && selStart < textEnd,
        text: showWhitespace(line.text),
        skippedAfter: showWhitespace(skipped),
        width: Math.round(line.prefixWidths[line.text.length] * 100) / 100,
      };
    });
    const payload = {
      valueLength: value.length,
      selectionStart: selStart,
      selectionEnd: selEnd,
      selectionDirection: _editEl?.selectionDirection || 'none',
      selectedText: value.slice(selStart, selEnd),
      visibleSelectedText: showWhitespace(value.slice(selStart, selEnd)),
      rows,
    };
    console.group('[textSel] report');
    console.log('selection', {
      start: payload.selectionStart,
      end: payload.selectionEnd,
      direction: payload.selectionDirection,
      selectedText: payload.visibleSelectedText,
    });
    console.table(rows);
    console.groupEnd();
    return payload;
  }

  function selectAll() {
    if (typeof editingId === 'undefined' || !editingId || !_editEl) {
      console.warn('[textSel] No text object being edited. Double-click a text object first.');
      return null;
    }
    _editEl.focus({ preventScroll: true });
    _editEl.setSelectionRange(0, _editEl.value.length, 'none');
    _caretVisible = true;
    _logSelection('debug-select-all', _editEl);
    scheduleRender(true, false);
    return report();
  }

  // Measure every character in the currently-edited object and report
  // measured prefix widths vs what you'd expect from toWorld(mouse)
  function measure() {
    if (typeof editingId === 'undefined' || !editingId) {
      console.warn('[textSel] No text object being edited. Double-click a text object first.');
      return null;
    }
    const obj = (typeof objectsMap !== 'undefined') && objectsMap.get(editingId);
    if (!obj) { console.warn('[textSel] Editing object not found.'); return null; }

    const dpr = window.devicePixelRatio || 1;
    const zm  = (typeof zoom !== 'undefined') ? zoom : 1;
    console.group(`[textSel] measure() — obj.id=${obj.id}  dpr=${dpr}  zoom=${zm}`);
    console.log(`obj.x=${obj.x}  obj.y=${obj.y}  obj.w=${obj.w}  TEXT_PAD=${TEXT_PAD}`);
    console.log(`baseX (world) = obj.x + TEXT_PAD = ${obj.x + TEXT_PAD}`);
    console.log(`baseX (screen) = baseX * zoom plus panX: ${(obj.x + TEXT_PAD) * zm + (typeof panX !== 'undefined' ? panX : 0)}`);

    const lines = (typeof getWrappedLines !== 'undefined') ? getWrappedLines(obj) : [];
    for (const line of lines) {
      const pw = (typeof getPrefixWidths !== 'undefined') ? getPrefixWidths(line.text) : null;
      console.group(`line: "${line.text.slice(0,40)}${line.text.length>40?'…':''}" startIndex=${line.startIndex}`);
      if (pw) {
        const rows = Array.from({ length: line.text.length }, (_, i) => ({
          char: JSON.stringify(line.text[i]),
          charIndex: line.startIndex + i,
          pw_start: pw[i].toFixed(3),
          pw_end: pw[i+1].toFixed(3),
          char_width: (pw[i+1] - pw[i]).toFixed(3),
          midpoint_world: (obj.x + TEXT_PAD + pw[i] + (pw[i+1]-pw[i])/2).toFixed(3),
          midpoint_screen: ((obj.x + TEXT_PAD + pw[i] + (pw[i+1]-pw[i])/2) * zm + (typeof panX !== 'undefined' ? panX : 0)).toFixed(3),
        }));
        console.table(rows);
        console.log(`Total measured line width: ${pw[line.text.length].toFixed(3)} world px`);
        console.log(`measureText full line: ${(typeof measureTextW !== 'undefined') ? measureTextW(line.text).toFixed(3) : '?'} world px`);
      }
      console.groupEnd();
    }
    console.groupEnd();
    return lines;
  }

  function reset() { events.length = 0; nextId = 1; }

  return { enable, disable, summary, report, selectAll, measure, reset, showWhitespace,
    get enabled() { return _textSelDebugEnabled; },
    get events() { return events.slice(); },
    // Internal: called by layoutHitTest
    _logHit(wx, wy, obj, line, returnedIdx, pw) {
      if (!_textSelDebugEnabled) return;
      const baseX = obj.x + TEXT_PAD;
      push({ type: 'hit', wx, wy, baseX, hitLine: line?.text?.slice(0,30), returnedIdx,
        pw0: pw?.[0], pw1: pw?.[1], pw2: pw?.[2], pw3: pw?.[3],
        note: `wx-baseX=${(wx-baseX).toFixed(2)}` });
    },
    // Internal: called by selection draw
    _logDraw(line, selStart, selEnd, x1, x2) {
      if (!_textSelDebugEnabled) return;
      push({ type: 'draw', lineText: line?.text?.slice(0,30), selStart, selEnd, x1, x2,
        note: `width=${(x2-x1).toFixed(2)}` });
    },
    _logSelection(label, proxy) {
      if (!_textSelDebugEnabled || !proxy) return;
      const selStart = proxy.selectionStart ?? 0;
      const selEnd = proxy.selectionEnd ?? 0;
      push({
        type: 'selection',
        selStart,
        selEnd,
        note: `${label}: "${showWhitespace(proxy.value.slice(selStart, selEnd)).slice(0, 80)}"`,
      });
    },
  };
})();

exposeDebug({ textSel: TextSelDebug });
