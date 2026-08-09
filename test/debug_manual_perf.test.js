'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readSource(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} is missing`);
  const boundaries = [
    source.indexOf(`\n  function `, start + 1),
    source.indexOf(`\n  return {`, start + 1),
  ].filter(index => index !== -1);
  assert.notEqual(boundaries.length, 0, `${name} end could not be found`);
  const next = Math.min(...boundaries);
  return source.slice(start, next);
}

test('text edit math perf debugger is passive event recording only', () => {
  const source = readSource('src/js/debug_manual_perf.js');
  const beginSource = functionSource(source, 'textEditMathBegin');
  const reportSource = functionSource(source, 'textEditMathReport');
  const combined = `${beginSource}\n${reportSource}`;

  assert.match(source, /const TEXT_EDIT_MATH_EVENT_TYPES = \[[\s\S]*'wheel'[\s\S]*'pointermove'[\s\S]*'mousemove'[\s\S]*'beforeinput'[\s\S]*'input'[\s\S]*'paste'[\s\S]*'copy'[\s\S]*'cut'[\s\S]*'selectionchange'/);
  assert.match(source, /deltaX: event\?\.deltaX/);
  assert.match(source, /clientX: event\?\.clientX/);
  assert.match(source, /shortcut: textEditMathShortcutFromEvent\(event\)/);
  assert.match(source, /historyTextUndoRedoReport/);
  assert.match(source, /historyMaxProxyValueSetMs/);
  assert.match(source, /historyMaxProxyValueDiffMs/);
  assert.match(source, /historyMaxProxyValueMutationMs/);
  assert.match(source, /historyMaxProxyValueAssignMs/);
  assert.match(source, /historyHydratedTextRuntimeCaches/);
  assert.match(source, /historyHydratedTextLayoutCaches/);
  assert.match(source, /domValueLength/);
  assert.match(source, /domValueStale/);
  assert.match(source, /maxLogicalSetMs/);
  assert.match(source, /historyMaxFocusMs/);
  assert.match(source, /maxHeightDeltaFromLogical/);
  assert.match(source, /expectedLogicalHeight/);
  assert.match(source, /heightDeltaFromCached/);
  assert.match(source, /cachedLineSource/);
  assert.match(source, /proxyScrollHeight/);
  assert.match(source, /autoHeightForceReason/);
  assert.match(source, /restoredMinLinesReset/);
  assert.match(source, /textUndoRedoReport/);
  assert.match(source, /const textEditInputSteps = \[\]/);
  assert.match(source, /function isTextEditInputTraceActive/);
  assert.match(source, /function recordTextEditInputStep/);
  assert.match(source, /function textEditInputStepSummary/);
  assert.match(source, /function textEditInputStepTimeline/);
  assert.match(source, /traceDeleteInputs/);
  assert.doesNotMatch(source, /maxLayoutPatchTotalMs/);
  assert.match(source, /maxTextareaMutationMs/);
  assert.match(source, /textEditMathBegin/);
  assert.match(source, /textEditMathReport/);
  assert.match(source, /textEditMathTimeline/);
  assert.match(source, /textEditInputStepTimeline/);
  assert.match(combined, /mode: 'passive-event-recording'/);
  assert.match(combined, /BoardfishDebug\.viewport\.enable/);
  assert.match(combined, /BoardfishDebug\.viewport\.reset/);
  assert.match(combined, /BoardfishDebug\.history\.enable/);
  assert.match(combined, /BoardfishDebug\.history\.reset/);
  assert.match(combined, /setTextEditMathListeners\(true\)/);
  assert.match(combined, /setTextEditMathListeners\(false\)/);
  assert.match(combined, /history: historyTextUndoRedoReport\(options\)/);
  assert.match(combined, /inputStepSummary: textEditInputStepSummary\(inputSteps\)/);
  assert.match(combined, /inputStepTimeline: textEditInputStepTimeline/);

  for (const forbidden of [
    'wheelPanTest',
    'wheelZoomTest',
    'mousePanTest',
    'dispatchPanWheel',
    'dispatchPanMouse',
    'measureTextLayoutPass',
    'getTextLayout',
    'clearTextLayoutCaches',
    'textBoardSummary',
    'memorySnapshot',
    'BoardfishEditorState',
    'BoardfishViewportState.setViewport',
    'scheduleRender',
    'copyLast()',
  ]) {
    assert.doesNotMatch(combined, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('text resize perf debugger captures resize and follow-up input evidence', () => {
  const source = readSource('src/js/debug_manual_perf.js');
  const beginSource = functionSource(source, 'textResizeBegin');
  const reportSource = functionSource(source, 'textResizeReport');
  const combined = `${beginSource}\n${reportSource}`;

  assert.match(source, /const textResizeEvents = \[\]/);
  assert.match(source, /function textResizeSummary/);
  assert.match(source, /function textResizeTimeline/);
  assert.match(source, /function textResizeHeadline/);
  assert.match(source, /function isTextResizeTraceActive/);
  assert.match(source, /function startTextResizeDrag/);
  assert.match(source, /function recordTextResizeStep/);
  assert.match(source, /function finishTextResizeDrag/);
  assert.match(source, /textResizeBegin/);
  assert.match(source, /textResizeReport/);
  assert.match(source, /maxResizeAutoHeightMs/);
  assert.match(source, /liveAutoHeightCommits/);
  assert.match(source, /liveBoardRenderCommits/);
  assert.match(source, /cacheKeyedAutoHeightCommits/);
  assert.match(source, /maxResizeClearLayoutMs/);
  assert.match(source, /maxResizeScheduleRenderMs/);
  assert.match(source, /maxResizeEventAgeMs/);
  assert.match(source, /_textMinWidthWordSegmentCache/);
  assert.doesNotMatch(source, /_textMinWidthCache/);
  assert.match(source, /paragraphPrefixCacheEntries/);
  assert.match(source, /wrappedLineCountCachePresent/);
  assert.match(source, /scriptMetricsCachePresent/);
  assert.match(source, /layoutCacheLinesBefore/);
  assert.match(source, /layoutInvalidationMethod/);
  assert.match(source, /startParagraphPrefixCacheEntries/);
  assert.match(source, /endWrappedLineCountCacheW/);
  assert.match(source, /textSelectionRecording/);
  assert.match(combined, /mode: 'passive-text-resize-and-input-recording'/);
  assert.match(combined, /BoardfishDebug\.viewport\.enable/);
  assert.match(combined, /BoardfishDebug\.viewport\.reset/);
  assert.match(combined, /BoardfishDebug\.history\.enable/);
  assert.match(combined, /TextSelDebug\.enable/);
  assert.match(combined, /setTextEditMathListeners\(true\)/);
  assert.match(combined, /setTextEditMathListeners\(false\)/);
  assert.match(combined, /resizeSummary: textResizeSummary\(events\)/);
  assert.match(combined, /resizeTimeline: textResizeTimeline/);
  assert.match(combined, /eventSummary: textEditMathEventSummary\(domEvents\)/);
  assert.match(combined, /inputStepSummary: textEditInputStepSummary\(inputSteps\)/);
  assert.match(combined, /viewport: viewportEventReport\(options\)/);
  assert.match(combined, /history: historyTextUndoRedoReport\(options\)/);
});

test('large text panning debugger records the four large-text viewport scenarios', () => {
  const source = readSource('src/js/debug_manual_perf.js');
  const viewportSource = readSource('src/js/debug.js');
  const beginSource = functionSource(source, 'largeTextPanningBegin');
  const reportSource = functionSource(source, 'largeTextPanningReport');
  const combined = `${beginSource}\n${reportSource}`;

  assert.match(source, /let largeTextPanningSession = null/);
  assert.doesNotMatch(source, new RegExp('create' + 'LargeTextScenario'));
  assert.doesNotMatch(source, new RegExp('debug' + '-text-'));
  assert.doesNotMatch(source, new RegExp('restore' + 'LargeTextOriginalState'));
  assert.doesNotMatch(source, new RegExp('largeText' + 'Evaluation'));
  assert.match(source, /function normalizeLargeTextPanningMode/);
  assert.match(source, /function applyLargeTextPanningState/);
  assert.match(source, /function currentLargeTextPanningState/);
  assert.match(source, /function largeTextInteractionSnapshot/);
  assert.match(source, /function largeTextPanningHeadline/);
  assert.match(source, /largeTextPanningBegin/);
  assert.match(source, /largeTextPanningReport/);
  assert.match(source, /manual-sequence/);
  assert.match(source, /large-text-pan-manual-sequence/);
  assert.match(source, /large-text-pan-plain/);
  assert.match(source, /large-text-pan-select-mode/);
  assert.match(source, /large-text-pan-edit-mode/);
  assert.match(source, /large-text-pan-edit-highlight/);
  assert.match(source, /mode === 'select'/);
  assert.match(source, /mode === 'edit'/);
  assert.match(source, /mode === 'edit-highlight'/);
  assert.match(source, /setLargeTextEditSelection\(obj, range, highlighted\)/);
  assert.match(source, /TextSelDebug\.selectionReport/);
  assert.match(beginSource, /currentLargeTextPanningState\(mode, options\)/);
  assert.match(beginSource, /applyState: options\.applyState === true/);
  assert.doesNotMatch(beginSource, /setup:|objectCount|linesPerObject|charsPerLine/);
  assert.match(combined, /resetLargeTextPanningRecorders\(options\)/);
  assert.match(combined, /setTextEditMathListeners\(true\)/);
  assert.match(combined, /setTextEditMathListeners\(false\)/);
  assert.match(combined, /recordedEventTypes: TEXT_EDIT_MATH_EVENT_TYPES\.slice\(\)/);
  assert.match(combined, /eventSummary: textEditMathEventSummary\(events\)/);
  assert.match(combined, /eventTimeline: textEditMathTimeline/);
  assert.match(combined, /viewportEvents/);
  assert.match(combined, /BoardfishDebug\.viewport\.events/);
  assert.match(combined, /largeTextSelectionDebugReport\(options\)/);
  assert.match(combined, /history: options\.history === false \? null : historyTextUndoRedoReport\(options\)/);
  assert.match(combined, /includeViewportEvents/);
  assert.doesNotMatch(reportSource, /restore/);
  assert.doesNotMatch(reportSource, /wheelPanTest|wheelZoomTest|mousePanTest|dispatchPanWheel|dispatchPanMouse|clearTextLayoutCaches/);

  assert.match(viewportSource, /const MAX_EVENTS = 10000/);
  assert.match(viewportSource, /const RAW_INPUT_TYPES = \[[\s\S]*'pointermove'[\s\S]*'pointercancel'[\s\S]*'mousemove'/);
});

test('pan and zoom debugger captures input, scheduling, and render evidence', () => {
  const source = readSource('src/js/debug_manual_perf.js');
  const viewportSource = readSource('src/js/debug.js');
  const canvasInputSource = readSource('src/js/canvas_input.js');
  const viewportRuntimeSource = readSource('src/js/viewport.js');
  const beginSource = functionSource(source, 'begin');
  const panZoomReportSource = functionSource(source, 'panZoomReport');

  assert.match(viewportSource, /function recordPanZoom/);
  assert.match(viewportSource, /function recordFrameSchedule/);
  assert.match(viewportSource, /function panZoomSummary/);
  assert.match(viewportSource, /function panZoomTimeline/);
  assert.match(viewportSource, /function panZoomReport/);
  assert.match(viewportSource, /wheelDeltaXPx/);
  assert.match(viewportSource, /deltaModeLabel/);
  assert.match(viewportSource, /maxPanDistancePx/);
  assert.match(viewportSource, /maxZoomDeltaPct/);
  assert.match(viewportSource, /frameScheduleTimeline/);
  assert.match(viewportSource, /bestTextLayoutPrewarm/);
  assert.match(viewportSource, /textLayoutPrewarmHistory/);

  assert.match(canvasInputSource, /canvasInputWheelDebugMeta/);
  assert.match(canvasInputSource, /recordPanZoom\?\.\('wheel-pan'/);
  assert.match(canvasInputSource, /recordPanZoom\?\.\('wheel-zoom'/);
  assert.match(canvasInputSource, /recordPanZoom\?\.\('mouse-pan-move'/);
  assert.match(canvasInputSource, /panXBefore/);
  assert.match(canvasInputSource, /zoomDeltaPct/);
  assert.match(canvasInputSource, /handlerMs/);

  assert.match(viewportRuntimeSource, /recordFrameSchedule\?\.\('scheduled'/);
  assert.match(viewportRuntimeSource, /recordFrameSchedule\?\.\('coalesced'/);
  assert.match(viewportRuntimeSource, /recordFrameSchedule\?\.\('raf-fired'/);
  assert.match(viewportRuntimeSource, /recordPanZoom\?\.\('transform-scheduled'/);
  assert.match(viewportRuntimeSource, /const totalMeasuredMs = performance\.now\(\) - transformStart/);
  assert.match(viewportRuntimeSource, /function getVisibleTextLayoutPrewarmHistory/);
  assert.match(viewportRuntimeSource, /function getBestVisibleTextLayoutPrewarm/);

  assert.match(beginSource, /prewarmScaledImages/);
  assert.match(beginSource, /prewarmVisibleScaledImageVariants/);
  assert.match(beginSource, /prewarmTextLayout/);
  assert.match(beginSource, /prewarmVisibleTextLayoutCaches/);
  assert.match(source, /panZoomReport/);
  assert.match(panZoomReportSource, /BoardfishDebug\.viewport\.panZoomReport/);
  assert.match(panZoomReportSource, /memorySnapshot\('pan-zoom-finish'/);
  assert.match(panZoomReportSource, /Pan\/zoom report is passive/);
  assert.match(panZoomReportSource, /viewportNavigationHeadline\(out\.viewport\)/);
});

test('jiggle debugger captures motion smoothness and animated image latency evidence', () => {
  const viewportSource = readSource('src/js/debug.js');
  const motionSource = readSource('src/js/motion.js');
  const rendererSource = readSource('src/js/renderer.js');

  assert.match(viewportSource, /function recordMotion/);
  assert.match(viewportSource, /function motionSummary/);
  assert.match(viewportSource, /function motionTimeline/);
  assert.match(viewportSource, /function jiggleReport/);
  assert.match(viewportSource, /motionJiggleStarts/);
  assert.match(viewportSource, /maxFirstProgressLatencyMs/);
  assert.match(viewportSource, /progressGapsOver32ms/);
  assert.match(viewportSource, /maxLowLatencyImageDraws/);
  assert.match(viewportSource, /motionActiveInputFullFallbackImages/);
  assert.match(viewportSource, /lowLatencyImageDraws/);
  assert.match(viewportSource, /recordMotion,/);
  assert.match(viewportSource, /jiggleReport,/);
  assert.match(viewportSource, /motionSummary,/);
  assert.match(viewportSource, /motionTimeline,/);

  assert.match(motionSource, /recordMotionDebug\('jiggle-start'/);
  assert.match(motionSource, /recordMotionDebug\('raf-fired'/);
  assert.match(motionSource, /recordMotionDebug\('render-scheduled'/);
  assert.match(motionSource, /recordMotionDebug\('jiggle-progress'/);

  assert.match(rendererSource, /lowLatencyImageDraws/);
  assert.match(rendererSource, /motionScaledImages/);
  assert.match(rendererSource, /motionFullFallbackImages/);
  assert.match(rendererSource, /imageSourceResolver\(key, obj, view, counters, lowLatencyImageMotion\)/);
  assert.match(rendererSource, /selectImageSourceForDraw\(key, obj, bitmap, view, lowLatencyImageMotion\)/);
});

test('text selection debugger includes focused enter and exit edit timings', () => {
  const source = readSource('src/js/debug_text_selection.js');

  assert.match(source, /function enterEditReport/);
  assert.match(source, /maxClickToEditTotalMs/);
  assert.match(source, /maxEnterEditCallMs/);
  assert.match(source, /maxCanvasRouteMs/);
  assert.doesNotMatch(source, /EmptyTextCleanup/);
  assert.match(source, /maxHitTestMs/);
  assert.match(source, /maxCaretApplyMs/);
  assert.match(source, /maxScheduledDelayMs/);
  assert.match(source, /focusScheduled/);
  assert.match(source, /scheduledDelayMs/);
  assert.match(source, /proxyWrap/);
  assert.match(source, /proxySpellcheck/);
  assert.match(source, /proxyAriaHidden/);
  assert.match(source, /proxyAriaLabel/);
  assert.match(source, /proxyContain/);
  assert.match(source, /function exitEditReport/);
  assert.match(source, /maxProxyRemoveMs/);
  assert.match(source, /maxWidthSyncMs/);
  assert.match(source, /maxHeightSyncMs/);
  assert.match(source, /sizeSyncReason/);
  assert.match(source, /latestSizeSyncReason/);
  assert.match(source, /maxEditHistoryMs/);
  assert.match(source, /maxWindowSelectionClearMs/);
});

test('text edit proxy disables native wrapping and browser text services', () => {
  const source = readSource('src/js/text_editor.js');

  assert.match(source, /function configureTextEditProxyElement/);
  assert.match(source, /proxy\.wrap = 'off'/);
  assert.match(source, /proxy\.spellcheck = false/);
  assert.match(source, /autocomplete', 'off'/);
  assert.match(source, /autocorrect', 'off'/);
  assert.match(source, /autocapitalize', 'off'/);
  assert.match(source, /aria-label', 'Boardfish text editor'/);
  assert.doesNotMatch(source, /aria-hidden', 'true'/);
  assert.match(source, /proxy\.style\.cssText = '[^']*contain:strict[^']*';/);
  assert.match(source, /configureTextEditProxyElement\(proxy\)/);
});
