'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderer(overrides = {}) {
  const context = { console, ...overrides };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'js', 'renderer.js'), 'utf8'),
    context,
    { filename: 'renderer.js' },
  );
  const api = context.BoardfishRenderer;
  const helpers = api.createBoardRenderer({});
  return {
    createBoardRenderer: api.createBoardRenderer,
    createDrawCounters: helpers.createDrawCounters,
  };
}

function opaqueScene(objects,production=false) {
  const drawn=[],backgrounds=[],clips=[],stack=[];let theme='#1c1b22',clip=null;
  const context={fillStyle:'#fbfbfe',globalAlpha:1,
    save(){stack.push({clip,fillStyle:this.fillStyle,globalAlpha:this.globalAlpha});},
    restore(){const old=stack.pop();clip=old.clip;this.fillStyle=old.fillStyle;this.globalAlpha=old.globalAlpha;},
    clipRect(x,y,w,h){clip={x1:x,y1:y,x2:x+w,y2:y+h};clips.push(clip);},
    fillRect(...rect){backgrounds.push({rect,color:this.fillStyle,alpha:this.globalAlpha});},
    drawTextLayout(layout,obj){drawn.push({obj,layout,clip,color:this.fillStyle});return true;},
  };
  const layouts=[];
  const api=loadRenderer(production?{BOARDFISH_PRODUCTION:true}:{});
  const renderer=api.createBoardRenderer({objects:()=>objects,zoom:()=>1,dpr:()=>1,viewportCullingEnabled:()=>true,
    canvasBackgroundColor:()=>theme,canvasTextColor:()=>context.fillStyle,
    objectIntersectsRect:(obj,r)=>obj.x<=r.x2&&obj.x+obj.w>=r.x1&&obj.y<=r.y2&&obj.y+obj.h>=r.y1,
    getTextLayoutForViewport(obj,rect){layouts.push({obj,rect});return[{text:obj.data?.content||''}];},
    imageBitmapCache:()=>({}),imageStore:()=>({}),selectImageSourceForDraw(){throw Error('occluded image source must not be requested');},
  });
  return {renderer,context,drawn,backgrounds,clips,layouts,setTheme(value){theme=value;}};
}

test('textbox backgrounds exactly match the object rectangle and live theme while preserving text state',()=>{
  const obj={id:'text',type:'text',x:11.25,y:-7.5,w:120.75,h:96,data:{content:'Visible'}};
  const f=opaqueScene([obj]);f.context.globalAlpha=.4;
  f.renderer.drawSingleObj(f.context,obj);
  f.setTheme('rgb(234, 234, 237)');f.renderer.drawSingleObj(f.context,obj);
  assert.deepEqual(f.backgrounds,[
    {rect:[11.25,-7.5,120.75,96],color:'#1c1b22',alpha:1},
    {rect:[11.25,-7.5,120.75,96],color:'rgb(234, 234, 237)',alpha:1},
  ]);
  assert.equal(f.context.fillStyle,'#fbfbfe');assert.equal(f.context.globalAlpha,.4);
  assert.ok(f.drawn.every(draw=>draw.color==='#fbfbfe'));
});

for(const production of [false,true])test(`opaque top textbox skips fully covered text layouts and images in ${production?'production':'development'}`,()=>{
  const rect={x:0,y:0,w:100,h:100};
  const objects=[{...rect,id:'image',type:'image',data:{imgKey:'hidden'}},{...rect,id:'lower',type:'text',data:{content:'hidden text'}},{...rect,id:'top',type:'text',data:{content:'top text'}}];
  const f=opaqueScene(objects,production),counters=production?null:f.renderer.createDrawCounters();
  f.renderer.drawVisibleObjects(f.context,counters,{x1:0,y1:0,x2:100,y2:100});
  assert.deepEqual(f.layouts.map(entry=>entry.obj.id),['top']);
  assert.deepEqual(f.drawn.map(entry=>entry.obj.id),['top']);
  assert.equal(f.backgrounds.length,1);
  if(counters){assert.equal(counters.occludedText,1);assert.equal(counters.occludedImages,1);assert.equal(counters.visibleObjects,1);}
});

test('partial textbox occlusion submits only a disjoint union of visible rectangles in source z-order',()=>{
  const lower={id:'lower',type:'text',x:0,y:0,w:100,h:100,data:{content:'lower'}};
  const top={id:'top',type:'text',x:30,y:20,w:40,h:60,data:{content:'top'}};
  const f=opaqueScene([lower,top]),counters=f.renderer.createDrawCounters();
  f.renderer.drawVisibleObjects(f.context,counters,{x1:0,y1:0,x2:100,y2:100});
  const regions=f.layouts.filter(entry=>entry.obj===lower).map(entry=>entry.rect);
  assert.equal(regions.length,4);
  assert.equal(regions.reduce((sum,r)=>sum+(r.x2-r.x1)*(r.y2-r.y1),0),7600);
  for(let i=0;i<regions.length;i++)for(let j=i+1;j<regions.length;j++) {
    const a=regions[i],b=regions[j];assert.ok(Math.min(a.x2,b.x2)<=Math.max(a.x1,b.x1)||Math.min(a.y2,b.y2)<=Math.max(a.y1,b.y1));
  }
  assert.equal(f.drawn.at(-1).obj,top);assert.equal(counters.partiallyOccludedObjects,1);assert.equal(counters.visibleObjectRegions,4);
});

test('occlusion fragmentation is bounded and its conservative fallback never removes an uncovered point',()=>{
  const lower={id:'lower',type:'text',x:0,y:0,w:1000,h:1000,data:{content:'lower'}};
  const covers=Array.from({length:100},(_,i)=>({id:`cover-${i}`,type:'text',x:(i%10)*100+20,y:Math.floor(i/10)*100+20,w:40,h:40,data:{content:'cover'}}));
  const f=opaqueScene([lower,...covers]);f.renderer.drawVisibleObjects(f.context,null,{x1:0,y1:0,x2:1000,y2:1000});
  const regions=f.layouts.filter(entry=>entry.obj===lower).map(entry=>entry.rect);
  assert.ok(regions.length>0&&regions.length<=32);
  for(let y=5;y<1000;y+=25)for(let x=5;x<1000;x+=25) {
    if(covers.some(obj=>x>=obj.x&&x<obj.x+obj.w&&y>=obj.y&&y<obj.y+obj.h))continue;
    assert.ok(regions.some(r=>x>=r.x1&&x<r.x2&&y>=r.y1&&y<r.y2),`uncovered point ${x},${y} stays visible`);
  }
});

test('text renderer uses the viewport-aware layout path', () => {
  const BoardfishRenderer = loadRenderer();
  const drawnLines = [];
  const viewportRect = { x1: 0, y1: 0, x2: 200, y2: 100 };
  const obj = { type: 'text', x: 20, y: 30, data: { content: 'one\ntwo' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    drawTextLineRange(_context, line) {
      drawnLines.push(line.text);
    },
    getTextLayoutForViewport(layoutObj, rect) {
      assert.strictEqual(layoutObj, obj);
      assert.strictEqual(rect, viewportRect);
      return [{ text: 'one', y: 30 }, { text: 'two', y: 54 }];
    },
    lineHeight: 24,
  });

  renderer.drawSingleObj({}, obj, null, viewportRect);

  assert.deepEqual(drawnLines, ['one', 'two']);
});

test('tiny text retains its physical filter footprint at all viewport edges without expanding image visibility', () => {
  const api = loadRenderer();
  const viewport = { x1: 0, y1: 0, x2: 100, y2: 100 };
  for (const [zoom, dpr] of [[.1, 1], [.1, 2], [.5, 1], [.75, 1]]) {
    const padding = 16 * zoom * dpr < 12 ? 4.25 / (zoom * dpr) : 0;
    const objects = [
      { id: 'left', x: -padding - 9.9, y: 40 },
      { id: 'right', x: 100 + padding - .1, y: 40 },
      { id: 'top', x: 40, y: -padding - 9.9 },
      { id: 'bottom', x: 40, y: 100 + padding - .1 },
      { id: 'outside', x: -padding - 10.1, y: 40 },
    ].map(obj => ({ ...obj, type: 'text', w: 10, h: 10 }));
    if (padding) objects.push({ id: 'image', type: 'image', x: -padding - 9.9, y: 40, w: 10, h: 10 });
    const drawn = [], layouts = [];
    const renderer = api.createBoardRenderer({
      objects: () => objects, zoom: () => zoom, dpr: () => dpr,
      viewportCullingEnabled: () => true,
      objectIntersectsRect: (obj, rect) => obj.x <= rect.x2 && obj.x + obj.w >= rect.x1 && obj.y <= rect.y2 && obj.y + obj.h >= rect.y1,
      getTextLayoutForViewport(_obj, rect) { layouts.push(rect); return [{ text: 'edge' }]; },
    });
    renderer.drawVisibleObjects({ drawTextLayout(_layout, obj) { drawn.push(obj.id); return true; } }, null, viewport);
    assert.deepEqual(drawn, ['left', 'right', 'top', 'bottom']);
    for (const rect of layouts) {
      assert.equal(rect.x1, 0 - padding); assert.equal(rect.y1, 0 - padding);
      assert.equal(rect.x2, 100 + padding); assert.equal(rect.y2, 100 + padding);
      if (!padding) assert.strictEqual(rect, viewport);
    }
  }
});

test('text renderer separates retained blits from cold raster and direct draw work', () => {
  const api = loadRenderer();
  const counters = api.createDrawCounters();
  const renderer = api.createBoardRenderer({
    getTextLayout: () => [{ text: 'retained ASCII' }],
    drawTextLineRange: () => ({ drawCalls: 1, rasterDrawCalls: 1, rasterCacheMisses: 1, rasterizedDrawCalls: 12 }),
  });
  renderer.drawSingleObj({}, { type: 'text', data: { content: 'retained ASCII' } }, counters);
  assert.equal(counters.textDrawCalls, 1);
  assert.equal(counters.textRasterDrawCalls, 1);
  assert.equal(counters.textRasterCacheMisses, 1);
  assert.equal(counters.textRasterizedDrawCalls, 12);
  assert.equal(counters.textDirectDraws, 0);
});

test('image renderer crops untransformed images to the visible viewport', () => {
  const BoardfishRenderer = loadRenderer();
  const drawImageCalls = [];
  const context = {
    drawImage(...args) {
      drawImageCalls.push(args);
    },
  };
  const counters = BoardfishRenderer.createDrawCounters();
  const source = {
    complete: true,
    naturalWidth: 200,
    naturalHeight: 100,
    width: 200,
    height: 100,
  };
  const obj = { type: 'image', x: -10, y: 20, w: 100, h: 50, data: { imgKey: 'img-1' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 25, x2: 60, y2: 45 }),
    dpr: () => 1,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({}),
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [obj],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({ source, scale: 1, targetScale: 1 }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects(context, null, { x1: 0, y1: 25, x2: 60, y2: 45 });
  drawImageCalls.length = 0;
  const result = renderer.drawVisibleObjects(context, counters, { x1: 0, y1: 25, x2: 60, y2: 45 });

  assert.equal(result.drawnImages, 1);
  assert.equal(result.drawnText, 0);
  assert.equal(counters.croppedImages, 1);
  assert.equal(counters.imageSourceDraws, 1);
  assert.equal(counters.imageSourceFirstDraws, 1);
  assert.equal(counters.imageSourceWarmDraws, 0);
  assert.equal(counters.imageContextFirstDraws, 1);
  assert.equal(counters.imageContextWarmDraws, 0);
  assert.equal(counters.fullScaleImageContextFirstDraws, 1);
  assert.deepEqual(drawImageCalls, [[
    source,
    20,
    10,
    120,
    40,
    0,
    25,
    60,
    20,
  ]]);

  drawImageCalls.length = 0;
  const warmCounters = BoardfishRenderer.createDrawCounters();
  renderer.drawVisibleObjects(context, warmCounters, { x1: 0, y1: 25, x2: 60, y2: 45 });

  assert.equal(warmCounters.imageSourceFirstDraws, 0);
  assert.equal(warmCounters.imageSourceWarmDraws, 1);
  assert.equal(warmCounters.imageContextFirstDraws, 0);
  assert.equal(warmCounters.imageContextWarmDraws, 1);

  const nextContextCounters = BoardfishRenderer.createDrawCounters();
  renderer.drawVisibleObjects({
    drawImage() {},
  }, nextContextCounters, { x1: 0, y1: 25, x2: 60, y2: 45 });

  assert.equal(nextContextCounters.imageSourceFirstDraws, 0);
  assert.equal(nextContextCounters.imageSourceWarmDraws, 1);
  assert.equal(nextContextCounters.imageContextFirstDraws, 1);
  assert.equal(nextContextCounters.imageContextWarmDraws, 0);
  assert.equal(nextContextCounters.fullScaleImageContextFirstDraws, 1);
});

test('image renderer overdraws image edges by one device pixel at the current view scale', () => {
  const BoardfishRenderer = loadRenderer();
  const drawImageCalls = [];
  const context = {
    drawImage(...args) {
      drawImageCalls.push(args);
    },
  };
  const source = {
    complete: true,
    naturalWidth: 80,
    naturalHeight: 60,
    width: 80,
    height: 60,
  };
  const obj = { type: 'image', x: 10, y: 20, w: 40, h: 30, data: { imgKey: 'img-1' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 100, y2: 100 }),
    dpr: () => 1,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [obj],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({ source, scale: 1, targetScale: 1 }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects(context, BoardfishRenderer.createDrawCounters(),
    { x1: 0, y1: 0, x2: 100, y2: 100 }, undefined, undefined, undefined,
    { zoom: 2, dpr: 2, panX: 0, panY: 0 });

  assert.deepEqual(drawImageCalls, [[source, 9.75, 19.75, 40.5, 30.5]]);
});

test('image renderer keeps active full fallback visible with temporary disabled smoothing', () => {
  const BoardfishRenderer = loadRenderer();
  const drawQualities = [];
  const drawSmoothingEnabled = [];
  const context = {
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    drawImage() {
      drawSmoothingEnabled.push(this.imageSmoothingEnabled);
      drawQualities.push(this.imageSmoothingQuality);
    },
  };
  const source = {
    complete: true,
    naturalWidth: 4000,
    naturalHeight: 4000,
    width: 4000,
    height: 4000,
  };
  const obj = { type: 'image', x: 10, y: 20, w: 500, h: 500, data: { imgKey: 'img-1' } };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 1000, y2: 1000 }),
    dpr: () => 1,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [obj],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({
      source,
      scale: 1,
      targetScale: 0.25,
      scaledVariantPending: true,
      activeInputFullFallback: true,
    }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 0.1,
  });

  const result = renderer.drawVisibleObjects(context, counters);

  assert.equal(result.drawnImages, 1);
  assert.deepEqual(drawSmoothingEnabled, [false]);
  assert.equal(context.imageSmoothingEnabled, true);
  assert.deepEqual(drawQualities, ['high']);
  assert.equal(context.imageSmoothingQuality, 'high');
  assert.equal(counters.scaledFallbackFull, 1);
  assert.equal(counters.activeInputFullFallbackImages, 1);
});

test('viewport navigation keeps culling and uses the canonical image draw path', () => {
  const BoardfishRenderer = loadRenderer();
  const selectCalls = [];
  const drawSmoothingEnabled = [];
  const source = {
    complete: true,
    naturalWidth: 2000,
    naturalHeight: 1200,
    width: 2000,
    height: 1200,
  };
  const obj = {
    id: 'viewport-image',
    type: 'image',
    x: 0,
    y: 0,
    w: 1000,
    h: 600,
    data: { imgKey: 'img-1' },
  };
  const offscreenObj = {
    id: 'offscreen-image',
    type: 'image',
    x: 5000,
    y: 5000,
    w: 1000,
    h: 600,
    data: { imgKey: 'img-2' },
  };
  const context = {
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
    drawImage() {
      drawSmoothingEnabled.push(this.imageSmoothingEnabled);
    },
  };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 1000, y2: 600 }),
    dpr: () => 2,
    getWrappedLines: () => [],
    imageBitmapCache: () => ({ 'img-1': source, 'img-2': source }),
    imageStore: () => ({ 'img-1': 'source', 'img-2': 'source' }),
    lineHeight: 24,
    objectIntersectsRect: (selectedObj) => selectedObj.id === obj.id,
    objects: () => [obj, offscreenObj],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw(key, selectedObj, fullSource, view) {
      selectCalls.push({ key, selectedObj, fullSource, view });
      return { source, scale: 1, targetScale: 1 };
    },
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  const counters = BoardfishRenderer.createDrawCounters();
  const result = renderer.drawVisibleObjects(context, counters);

  assert.equal(result.drawnImages, 1);
  assert.equal(selectCalls.length, 1);
  assert.equal(selectCalls[0].key, 'img-1');
  assert.equal(selectCalls[0].view.activeInput, undefined);
  assert.deepEqual(drawSmoothingEnabled, [true]);
  assert.equal(context.imageSmoothingEnabled, true);
  assert.equal(counters.culledImages, 1);
});

test('renderer can draw only text while drawing visible objects', () => {
  const BoardfishRenderer = loadRenderer();
  const drawImageCalls = [];
  const drawnText = [];
  const source = {
    width: 20,
    height: 20,
  };
  const context = {
    drawImage(...args) {
      drawImageCalls.push(args);
    },
    fillText(text) {
      drawnText.push(text);
    },
    setTransform() {},
    translate() {},
    rotate() {},
    scale() {},
    save() {},
    restore() {},
  };
  const image = { id: 'img-1', type: 'image', x: 0, y: 0, w: 20, h: 20, data: { imgKey: 'img-1' } };
  const text = { id: 'text-1', type: 'text', x: 0, y: 0, w: 20, h: 20 };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 30, y2: 30 }),
    dpr: () => 1,
    drawTextLineRange(_context, line) {
      drawnText.push(line.text);
    },
    getTextLayout: () => [{ text: 'drawn', y: 0 }],
    imageBitmapCache: () => ({ 'img-1': source }),
    imageStore: () => ({ 'img-1': 'source' }),
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [image, text],
    panX: () => 0,
    panY: () => 0,
    selectImageSourceForDraw: () => ({ source, scale: 1, targetScale: 1 }),
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  const result = renderer.drawVisibleObjects(
    context, BoardfishRenderer.createDrawCounters(), undefined, undefined, undefined, true,
  );

  assert.equal(result.drawnImages, 0);
  assert.equal(result.drawnText, 1);
  assert.deepEqual(drawImageCalls, []);
  assert.deepEqual(drawnText, ['drawn']);
});

test('renderer skips the editing object while drawing visible objects', () => {
  const BoardfishRenderer = loadRenderer();
  const drawnText = [];
  const textA = { id: 'text-a', type: 'text', x: 0, y: 0, w: 80, h: 24, data: { content: 'skip' } };
  const textB = { id: 'text-b', type: 'text', x: 0, y: 30, w: 80, h: 24, data: { content: 'draw' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 120, y2: 80 }),
    dpr: () => 1,
    drawTextLineRange(_context, line) {
      drawnText.push(line.text);
    },
    getTextLayout: (obj) => [{ text: obj.data.content, y: obj.y }],
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [textA, textB],
    panX: () => 0,
    panY: () => 0,
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  const result = renderer.drawVisibleObjects(
    {}, BoardfishRenderer.createDrawCounters(), undefined, undefined, 'text-a',
  );

  assert.equal(result.drawnText, 1);
  assert.deepEqual(drawnText, ['draw']);
});

test('text renderer draws the exact viewport-aware layout range', () => {
  const BoardfishRenderer = loadRenderer();
  const drawnLines = [];
  const context = {
    fillStyle: '',
    textBaseline: '',
  };
  const text = { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 96 };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 200, y2: 47 }),
    dpr: () => 1,
    drawTextLineRange(_context, line) {
      drawnLines.push(line.text);
    },
    getTextLayoutForViewport(_obj, viewportRect) {
      assert.deepEqual(viewportRect, { x1: 0, y1: 0, x2: 200, y2: 47 });
      const layout = [{ text: 'visible', y: 0 }];
      layout.totalLines = 3;
      return layout;
    },
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  const result = renderer.drawVisibleObjects(context, counters);

  assert.equal(result.drawnText, 1);
  assert.deepEqual(drawnLines, ['visible']);
  assert.equal(counters.textLines, 3);
  assert.equal(counters.drawnTextLines, 1);
  assert.equal(counters.culledTextLines, 2);
});

test('production text drawing skips debug stats allocation', () => {
  const BoardfishRenderer = loadRenderer();
  const collectStatsOptions = [];
  const text = { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 24, data: { content: 'plain' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 200, y2: 40 }),
    dpr: () => 1,
    drawTextLineRange(_context, _line, _obj, _start, _end, options) {
      collectStatsOptions.push(options.collectStats);
      return null;
    },
    getTextLayout: () => [{ text: 'plain', y: 0 }],
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects({ fillStyle: '', textBaseline: '' }, null);

  assert.deepEqual(collectStatsOptions, [false]);
});

test('text context configuration persists until canvas state resets', () => {
  const BoardfishRenderer = loadRenderer();
  let configurationWrites = 0;
  const context = { fillStyle: '', textBaseline: 'alphabetic', setTransform() {} };
  const configuredValues = new Map();
  for (const property of ['fontKerning', 'letterSpacing', 'fontStretch', 'fontVariantCaps', 'textAlign', 'direction']) {
    Object.defineProperty(context, property, {
      configurable: true,
      get() {
        return configuredValues.get(property);
      },
      set(value) {
        configurationWrites++;
        configuredValues.set(property, value);
      },
    });
  }
  const text = { id: 'text-1', type: 'text', x: 0, y: 0, w: 200, h: 24, data: { content: 'plain' } };
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    dpr: () => 1,
    drawTextLineRange() {},
    getTextLayout: () => [{ text: 'plain', y: 0 }],
    getWrappedLines: () => [],
    font: '12px sans-serif',
    lineHeight: 24,
    panX: () => 0,
    setCanvasImageQuality() {},
    panY: () => 0,
    textBaselineYOffset: () => 0,
    textPad: 4,
    zoom: () => 1,
  });

  renderer.setWorldCanvasTransform(context);
  renderer.setWorldCanvasTransform(context);
  renderer.drawSingleObj(context, text);
  renderer.drawSingleObj(context, text);
  assert.equal(configurationWrites, 6);
  assert.equal(context.fillStyle, '#fff');
  assert.equal(context.textBaseline, 'alphabetic');

  configuredValues.clear();
  renderer.setWorldCanvasTransform(context);
  renderer.drawSingleObj(context, text);

  assert.equal(configurationWrites, 12);
  assert.deepEqual(Object.fromEntries(configuredValues), {
    direction: 'ltr',
    fontKerning: 'none',
    fontStretch: 'normal',
    fontVariantCaps: 'normal',
    letterSpacing: '0px',
    textAlign: 'left',
  });
});

test('text renderer keeps measured text drawing at low zoom instead of switching to fast text', () => {
  const BoardfishRenderer = loadRenderer();
  const drawnText = [];
  const rects = [];
  let layoutCalls = 0;
  const context = {
    fillStyle: '',
    textBaseline: '',
    fillRect(...args) {
      rects.push(args);
    },
  };
  const text = { id: 'text-1', type: 'text', x: 10, y: 20, w: 200, h: 32 };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 300, y2: 100 }),
    dpr: () => 2,
    drawTextLineRange(_context, line, _obj, _start, _end, options = {}) {
      drawnText.push(line.text);
      assert.equal(options.fast, undefined);
      return {
        chars: line.text.length,
        drawnChars: line.text.length,
        drawUnits: line.text.length,
        drawCalls: 2,
        runs: 1,
        skippedTabs: 0,
      };
    },
    getTextLayout() {
      layoutCalls++;
      return [{ text: 'tiny', y: 20, prefixWidths: [0, 12, 24, 36, 48] }];
    },
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 0.2,
  });

  renderer.drawVisibleObjects(context, counters);

  assert.deepEqual(drawnText, ['tiny']);
  assert.equal(rects.length, 0);
  assert.equal(layoutCalls, 1);
  assert.equal(counters.textLines, 1);
  assert.equal(counters.drawnTextLines, 1);
  assert.equal(counters.culledTextLines, 0);
  assert.equal(counters.textChars, 4);
  assert.equal(counters.textDrawUnits, 4);
  assert.equal(counters.textDrawCalls, 2);
  assert.equal(counters.textRuns, 1);
  assert.equal(counters.maxTextDrawUnitsPerLine, 4);
  assert.equal(counters.maxTextDrawCallsPerLine, 2);
});

test('text renderer keeps direct text rendering', () => {
  const BoardfishRenderer = loadRenderer();
  const drawImageCalls = [];
  const drawnLines = [];
  const context = {
    fillStyle: '',
    textBaseline: '',
    drawImage(...args) {
      drawImageCalls.push(args);
    },
  };
  const text = { id: 'text-1', type: 'text', x: 10, y: 20, w: 200, h: 80, data: { content: 'cached' } };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 300, y2: 160 }),
    dpr: () => 2,
    drawTextLineRange(_context, line) {
      drawnLines.push(line.text);
      return {
        chars: line.text.length,
        drawnChars: line.text.length,
        drawUnits: line.text.length,
        drawCalls: line.text.length,
        runs: 1,
      };
    },
    getTextLayout() {
      return [
        { text: 'cached one', y: 20, textY: 36 },
        { text: 'cached two', y: 44, textY: 60 },
      ];
    },
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    setCanvasImageQuality: () => {},
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 1,
  });

  renderer.drawVisibleObjects(context, counters,
    { x1: 0, y1: 0, x2: 300, y2: 160 }, undefined, undefined, undefined,
    { zoom: 1, panX: 0, panY: 0, dpr: 2 });

  assert.deepEqual(drawnLines, ['cached one', 'cached two']);
  assert.deepEqual(drawImageCalls, []);
  assert.equal(counters.textLines, 2);
  assert.equal(counters.drawnTextLines, 2);
  assert.equal(counters.textDirectDraws, 1);
});

test('text renderer records slow text line timing rows for debug captures', () => {
  let now = 0;
  const BoardfishRenderer = loadRenderer({
    performance: {
      now() {
        now += 1;
        return now;
      },
    },
  });
  const text = { id: 'text-1', type: 'text', x: 10, y: 20, w: 200, h: 80, data: { content: 'first line\nsecond line' } };
  const counters = BoardfishRenderer.createDrawCounters();
  const renderer = BoardfishRenderer.createBoardRenderer({
    canvasTextColor: () => '#fff',
    currentViewportWorldRect: () => ({ x1: 0, y1: 0, x2: 300, y2: 160 }),
    dpr: () => 2,
    drawTextLineRange(_context, line) {
      return {
        chars: line.text.length,
        drawnChars: line.text.length,
        drawUnits: line.text.length,
        runs: 1,
        skippedTabs: 0,
        skippedSpaces: 1,
        planCacheHits: 1,
        planCacheMisses: 0,
      };
    },
    getTextLayout() {
      return [
        { text: 'first line', y: 20, textY: 36, startIndex: 0, endIndex: 10, logicalLineIndex: 0 },
        { text: 'second line', y: 44, textY: 60, startIndex: 11, endIndex: 22, logicalLineIndex: 1 },
      ];
    },
    getWrappedLines: () => [],
    lineHeight: 24,
    objectIntersectsRect: () => true,
    objects: () => [text],
    panX: () => 0,
    panY: () => 0,
    textBaselineYOffset: () => 0,
    textPad: 4,
    viewportCullingEnabled: () => true,
    zoom: () => 0.1,
  });

  renderer.drawVisibleObjects({ fillStyle: '', textBaseline: '' }, counters);

  assert.equal(counters.textLineDrawMs, 2);
  assert.equal(counters.maxTextLineDrawMs, 1);
  assert.equal(counters.slowTextLineDrawCount, 2);
  assert.equal(counters.slowTextLineDraws.length, 2);
  const lineRows = counters.slowTextLineDraws.slice().sort((a, b) => a.lineIndex - b.lineIndex);
  assert.equal(lineRows[0].objectId, 'text-1');
  assert.equal(lineRows[0].logicalLineIndex, 0);
  assert.equal(lineRows[0].sample, 'first line');
  assert.equal(lineRows[0].drawUnits, 10);
  assert.equal(lineRows[1].logicalLineIndex, 1);
  assert.equal(lineRows[1].sample, 'second line');
  assert.equal(counters.slowDrawObjects[0].textLineDrawMs, 2);
  assert.equal(counters.slowDrawObjects[0].slowTextLineDrawCount, 2);
  assert.equal(counters.slowDrawObjects[0].slowTextLineRows.length, 2);
});
