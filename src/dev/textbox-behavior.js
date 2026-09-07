'use strict';

// These controls exercise the actual app's event handlers. Synthetic paste
// events have no browser default action, so the harness emulates that action
// only when the application has allowed it.
const appFrame = document.getElementById('app');
const statusEl = document.getElementById('status');
const resultEl = document.getElementById('result');
const production = new URLSearchParams(location.search).get('production') === '1';
let app;
const checks = {};
const nextFrame = () => new Promise(requestAnimationFrame);
function resetScene() {
  app.exitEdit();
  app.BoardfishEditorState.resetBoardObjectState();
  app.ctx.resetBoard?.();
  app.applyAppTheme('dark', { dirty:false });
}
function textbox(content, x = 40, y = 40, width = 4500) {
  const obj = { id:app.newId(), type:'text', x, y, w:width, h:56, z:++app.zCounter, data:{content} };
  app.BoardfishEditorState.addObject(obj);
  app.syncTextAutoHeight(obj);
  return obj;
}
function camera(zoom = .1, panX = 30, panY = 30) {
  app.BoardfishViewportState.setZoomPan(zoom, panX, panY);
  app.drawBoard();
  app.updateSelectionOverlay();
  app.hideIsland('textbox-behavior');
}
function proxy() { return app.document.querySelector('textarea[aria-label="Boardfish text editor"]'); }
function edit(obj, start = obj.data.content.length, end = start) {
  app.selectObject(obj.id);
  app.enterEdit(obj.id);
  const input = proxy();
  input.value = obj.data.content;
  app.setTextEditProxyLogicalValue(input, input.value);
  input.setSelectionRange(start, end);
  return input;
}
async function paste(input, value) {
  const data = new app.DataTransfer(); data.setData('text/plain', value);
  const event = new app.ClipboardEvent('paste', { clipboardData:data, bubbles:true, cancelable:true });
  input.dispatchEvent(event);
  if (!event.defaultPrevented) {
    const before = new app.InputEvent('beforeinput', { data:value, inputType:'insertFromPaste', bubbles:true, cancelable:true });
    input.dispatchEvent(before);
    if (!before.defaultPrevented) {
      input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end');
      input.dispatchEvent(new app.InputEvent('input', { data:value, inputType:'insertFromPaste', bubbles:true }));
    }
  }
  await nextFrame(); await nextFrame();
}
function type(input, value, withBeforeInput = true) {
  const event = new app.InputEvent('beforeinput', { data:value, inputType:'insertText', bubbles:true, cancelable:true });
  if (withBeforeInput) input.dispatchEvent(event);
  if (!event.defaultPrevented) {
    input.setRangeText(value, input.selectionStart, input.selectionEnd, 'end');
    input.dispatchEvent(new app.InputEvent('input', { data:value, inputType:'insertText', bubbles:true }));
  }
}
function compose(input, provisional, committed) {
  const start = input.selectionStart;
  input.dispatchEvent(new app.CompositionEvent('compositionstart',{bubbles:true,data:''}));
  for (const [index,value] of [provisional,committed].entries()) {
    if(index) input.setSelectionRange(start,start+provisional.length);
    input.dispatchEvent(new app.InputEvent('beforeinput',{data:value,inputType:'insertCompositionText',isComposing:true,bubbles:true}));
    input.setRangeText(value,input.selectionStart,input.selectionEnd,'end');
    input.dispatchEvent(new app.InputEvent('input',{data:value,inputType:'insertCompositionText',isComposing:true,bubbles:true}));
  }
  input.dispatchEvent(new app.CompositionEvent('compositionend',{bubbles:true,data:committed}));
}
function pixels() {
  app.drawBoard();
  const canvas = app.boardCanvas;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('GPU context unavailable for the pixel check');
  const data = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return { data, width:canvas.width, height:canvas.height, stats:app.ctx.getStats?.() || null };
}
function pixelDifference(a, b) {
  let max = 0, changed = 0;
  for (let i = 0; i < a.data.length; i++) { const d = Math.abs(a.data[i]-b.data[i]); max = Math.max(max,d); if(d) changed++; }
  return { maxChannelDifference:max, changedChannels:changed };
}
function compositeDifference(composite, background, foreground, obj) {
  const dpr = app.devicePixelRatio || 1;
  const bounds = [obj.x, obj.y, obj.x+obj.w, obj.y+obj.h].map((v,i) =>
    Math.ceil((v*app.zoom+(i%2 ? app.panY : app.panX))*dpr-.5));
  let max = 0, changed = 0;
  for(let y=0;y<composite.height;y++) for(let x=0;x<composite.width;x++) {
    const screenY = composite.height-1-y;
    const source = x>=bounds[0] && x<bounds[2] && screenY>=bounds[1] && screenY<bounds[3] ? foreground : background;
    const offset = (y*composite.width+x)*4;
    for(let c=0;c<4;c++) { const d=Math.abs(composite.data[offset+c]-source.data[offset+c]);max=Math.max(max,d);if(d)changed++; }
  }
  return {maxChannelDifference:max,changedChannels:changed};
}
async function inputChecks() {
  resetScene();
  const text = 'alpha beta gamma delta epsilon '.repeat(4000).slice(0,100000);
  const obj = textbox(text,40,40,9000);
  camera();
  const input = edit(obj);
  const initialHeight = obj.h;
  await paste(input, text);
  const heightBeforeAnyEnter = obj.h;
  const expectedHeight = app.getWrappedLineCount(obj, obj.data.content) * app.LINE_H + app.TEXT_PAD * 2;
  const borderHeight = app.selOverlay.getBoundingClientRect().height;
  const sizeCheck = { initialCharacters:text.length, finalCharacters:obj.data.content.length, initialHeight,
    heightBeforeAnyEnter, expectedHeight, borderHeightCss:borderHeight,
    expectedBorderHeightCss:obj.h * app.zoom, pendingSizeSync:!!obj._textEditPendingSizeSync,
    pass:obj.data.content.length===200000 && heightBeforeAnyEnter===expectedHeight && heightBeforeAnyEnter>initialHeight &&
      Math.abs(borderHeight-obj.h*app.zoom)<1 && !obj._textEditPendingSizeSync };
  app.exitEdit();
  const mixed = textbox('keep', 4800, 40, 900);
  const mixedInput = edit(mixed);
  await paste(mixedInput, 'A\r\nB\tC é😀\u200bD\u0000');
  const afterPaste = mixed.data.content;
  mixedInput.setSelectionRange(0,4);
  await paste(mixedInput, '🌟🥰é');
  const unsupportedPastePreservesSelection = mixed.data.content===afterPaste;
  mixedInput.setSelectionRange(mixed.data.content.length,mixed.data.content.length);
  type(mixedInput, 'X😀Y');
  const afterTyping = mixed.data.content;
  mixedInput.setSelectionRange(0,4);
  type(mixedInput, '😀', false);
  const unsupportedFallbackPreservesSelection = mixed.data.content===afterTyping;
  mixedInput.setSelectionRange(0,4);
  compose(mixedInput,'e','é');
  const unsupportedCompositionPreservesSelection = mixed.data.content===afterTyping;
  const normalized = afterPaste==='keepA\nB\tC D' && afterTyping==='keepA\nB\tC DXY';
  const asciiOnly = /^[\x09\x0a\x20-\x7e]*$/.test(mixed.data.content);
  checks.input = { pasteSize:sizeCheck, afterPaste, afterTyping, unsupportedPastePreservesSelection,
    unsupportedFallbackPreservesSelection, unsupportedCompositionPreservesSelection,
    normalized, asciiOnly,
    pass:sizeCheck.pass && normalized && asciiOnly && unsupportedPastePreservesSelection &&
      unsupportedFallbackPreservesSelection && unsupportedCompositionPreservesSelection };
  app.exitEdit(); app.selectObject(obj.id); camera();
}
async function overlapChecks() {
  resetScene();
  const content = 'Opaque text stays sharp while zooming and panning. '.repeat(2400).slice(0,100000);
  const one = textbox(content);
  const backs = [one];
  camera();
  const single = pixels();
  for (let i=0;i<3;i++) backs.push(textbox(content));
  const stack = pixels();
  const fullDifference = pixelDifference(single,stack);
  const front = textbox('Foreground textbox\n'.repeat(65),1000,800,2500);
  const themes = [];
  const partialOverlaps = [];
  for (const theme of ['dark','light']) {
    app.applyAppTheme(theme,{dirty:false}); camera();
    const image = pixels();
    const dpr = app.boardCanvas.width / app.boardCanvas.getBoundingClientRect().width;
    const x = Math.floor((front.x+front.w-100)*app.zoom*dpr+app.panX*dpr);
    const y = Math.floor((front.y+front.h/2)*app.zoom*dpr+app.panY*dpr);
    const offset = ((image.height-1-y)*image.width+x)*4;
    const actual = Array.from(image.data.slice(offset,offset+4));
    const expected = theme==='dark' ? [28,27,34,255] : [234,234,237,255];
    edit(front,0,10);
    const editingImage = pixels();
    const editingActual = Array.from(editingImage.data.slice(offset,offset+4));
    app.exitEdit();
    themes.push({theme,actual,editingActual,expected,
      pass:actual.every((v,i)=>v===expected[i]) && editingActual.every((v,i)=>v===expected[i])});
    for (const zoom of [.1,.1137,.45]) {
      camera(zoom,30.23,30.71);
      const composite = pixels();
      app.BoardfishEditorState.removeObjectsById(backs.map(obj=>obj.id));
      const foreground = pixels();
      app.BoardfishEditorState.removeObjectsById([front.id]);
      backs.forEach(obj=>app.BoardfishEditorState.addObject(obj));
      const background = pixels();
      app.BoardfishEditorState.addObject(front);
      const difference = compositeDifference(composite,background,foreground,front);
      partialOverlaps.push({theme,zoom,...difference,pass:difference.changedChannels===0});
    }
  }
  app.applyAppTheme('dark',{dirty:false}); app.selectObject(front.id); camera();
  checks.overlap = { fullOverlap:fullDifference, objectsInStack:4,
    singleGlyphs:single.stats?.frameGlyphsDrawn, stackedGlyphs:stack.stats?.frameGlyphsDrawn,
    glyphWorkUnchanged:single.stats ? single.stats.frameGlyphsDrawn===stack.stats.frameGlyphsDrawn : null,
    themes, partialOverlaps,
    pass:fullDifference.changedChannels===0 && themes.every(t=>t.pass) && partialOverlaps.every(t=>t.pass) };
}
async function run(action) {
  document.querySelectorAll('button').forEach(button=>button.disabled=true);
  statusEl.textContent='Checking…';
  try {
    await action();
    const bundle = Array.from(app.document.scripts,script=>script.getAttribute('src')).find(src=>src?.includes('boardfish-web-preview.')) || null;
    const result = {production,bundle,environment:{dpr:app.devicePixelRatio,
      canvasWidth:app.boardCanvas.width,canvasHeight:app.boardCanvas.height},checks};
    resultEl.textContent=JSON.stringify(result,null,2);
    await fetch('/__evidence/textbox-behavior.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
    statusEl.textContent='Complete. Inspect the checks and board below.';
  } catch(error) { statusEl.textContent=error.stack || String(error); }
  finally {
    // Generated fixtures have no user file to save; permit leaving this page.
    app.markSaved();
    document.querySelectorAll('button').forEach(button=>button.disabled=false);
  }
}
document.getElementById('input').onclick=()=>run(inputChecks);
document.getElementById('overlap').onclick=()=>run(overlapChecks);
for (const theme of ['light','dark']) document.getElementById(theme).onclick=()=>app.applyAppTheme(theme,{dirty:false});
appFrame.onload=async()=>{
  app=appFrame.contentWindow;
  try {
    await app.document.fonts.ready; await app.ctx.ready;
    statusEl.textContent=production ? 'Production app ready.' : 'Development app ready.';
    document.querySelectorAll('button').forEach(button=>button.disabled=false);
  } catch(error) { statusEl.textContent=String(error); }
};
appFrame.src=production ? '/__release/index.html' : '/';
