// Local reproduction against a real .bf file. Never writes the input board.
import http from 'node:http';
import { createReadStream, openAsBlob } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { values } = parseArgs({ options: {
  board: { type: 'string' }, baseline: { type: 'string', default: 'HEAD' },
  port: { type: 'string', default: '5193' }, evidence: { type: 'string' },
} });
if (!values.board) throw new Error('Usage: node scripts/serve-text-motion.mjs --board /path/to/board.bf [--baseline git-ref] [--evidence /tmp/results]');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(repo, 'src'), releaseRoot = path.join(repo, 'dist-web'), boardPath = path.resolve(values.board);
const port = Number(values.port);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
const evidence = values.evidence ? path.resolve(values.evidence) : null;
const require = createRequire(import.meta.url);
const { readBoardContainer } = require('../src/js/web_board_container.js');
const { board } = await readBoardContainer(await openAsBlob(boardPath), { lazyImageRefs: true, verifyImageCrc: false });
const fixture = JSON.stringify({ objects: board.objects, viewport: board.viewport });
const baseline = execFileSync('git', ['show', `${values.baseline}:src/js/gpu_renderer.js`], { cwd: repo, maxBuffer: 2 * 1024 * 1024 });
const mime = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
const evidenceNames = new Set(['board-motion.json', 'board-motion-before.png', 'board-motion-after.png', 'board-full.json', 'board-full.png']);
if (evidence) await mkdir(evidence, { recursive: true });

const fixtureControls = `<div style="position:fixed;z-index:99999;top:60px;left:10px;background:#333;color:white;padding:8px">
<button id="fixture-open">Open fixture board</button><button id="fixture-pan">Pan at 10%</button><button id="fixture-zoom">Zoom sweep</button><button id="fixture-next">Next textbox</button><output id="fixture-status">Ready</output></div>
<script>
const fixtureStatus=document.getElementById('fixture-status');
document.getElementById('fixture-open').onclick=async()=>{try{
  fixtureStatus.textContent='Loading board…';
  const blob=await(await fetch('/__fixture/boardTest.bf')).blob();
  await openBoardFileRef({kind:'web-file',file:new File([blob],'motion-fixture.bf'),name:'motion-fixture.bf'});
  fixtureStatus.textContent='Opened '+objects.length+' objects';
}catch(error){fixtureStatus.textContent=String(error)}};
async function fixtureSweep(changeZoom){
  const samples=[],x=panX,y=panY,before=ctx.getStats?.();let previous=performance.now();
  for(let i=0;i<240;i++){
    await new Promise(requestAnimationFrame);const now=performance.now();samples.push(now-previous);previous=now;
    if(changeZoom)BoardfishViewportState.zoomAroundClient(innerWidth/2,innerHeight/2,.1+.25*(1-Math.cos(i/239*Math.PI*2))/2);
    else BoardfishViewportState.setZoomPan(.1,x+Math.sin(i/35)*120,y+i*.31);
    scheduleRender();
  }
  fixtureStatus.textContent=(changeZoom?'Zoom':'Pan')+' finished; 240 frames; p95 '+samples.slice().sort((a,b)=>a-b)[228].toFixed(1)+'ms';
  const evidence={motion:changeZoom?'zoom':'pan',objects:objects.length,zoom,panX,panY,dpr:devicePixelRatio,width:boardCanvas.width,height:boardCanvas.height,before,after:ctx.getStats?.(),rafMs:samples};
  await fetch('/__evidence/board-full.json',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(evidence)});
  drawBoard();const snapshot=await new Promise(resolve=>boardCanvas.toBlob(resolve,'image/png'));
  if(snapshot)await fetch('/__evidence/board-full.png',{method:'POST',headers:{'Content-Type':'image/png'},body:snapshot});
}
document.getElementById('fixture-pan').onclick=()=>fixtureSweep(false);
document.getElementById('fixture-zoom').onclick=()=>fixtureSweep(true);
let fixtureIndex=-1;
document.getElementById('fixture-next').onclick=()=>{
  const boxes=objects.filter(obj=>obj.type==='text');if(!boxes.length)return;
  const obj=boxes[++fixtureIndex%boxes.length];
  BoardfishViewportState.setZoomPan(.1,innerWidth/2-(obj.x+obj.w/2)*.1,innerHeight/2-(obj.y+obj.h/2)*.1);
  scheduleRender();fixtureStatus.textContent='Textbox '+obj.id+' ('+obj.data.content.length+' characters)';
};
</script>`;

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'POST' && url.pathname.startsWith('/__evidence/')) {
      const name = url.pathname.slice('/__evidence/'.length);
      if (!evidence || !evidenceNames.has(name)) { res.writeHead(404).end(); return; }
      const chunks = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 32 * 1024 * 1024) { res.writeHead(413).end(); return; }
        chunks.push(chunk);
      }
      await writeFile(path.join(evidence, name), Buffer.concat(chunks));
      res.end('saved'); return;
    }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    if (url.pathname === '/__fixture/board.json') {
      res.setHeader('Content-Type', mime['.json']); res.end(fixture); return;
    }
    if (url.pathname === '/dev/gpu-motion-before.js') {
      res.setHeader('Content-Type', mime['.js']); res.end(baseline); return;
    }
    if (url.pathname === '/actual-board.html' || url.pathname === '/production-board.html') {
      res.setHeader('Content-Type', mime['.html']);
      const production = url.pathname === '/production-board.html';
      let html = await readFile(path.join(production ? releaseRoot : root, 'index.html'), 'utf8');
      if (production) html = html.replace('<head>', '<head><base href="/__release/">');
      res.end(html.replace('</body>', fixtureControls + '</body>')); return;
    }
    const file = url.pathname === '/__fixture/boardTest.bf' ? boardPath
      : url.pathname.startsWith('/__release/') ? path.resolve(releaseRoot, '.' + decodeURIComponent(url.pathname.slice('/__release'.length)))
      : path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (file !== boardPath && !file.startsWith(root + path.sep) && !file.startsWith(releaseRoot + path.sep)) { res.writeHead(403).end(); return; }
    if (!(await stat(file)).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    createReadStream(file).pipe(res);
  } catch (error) {
    if (!res.headersSent) res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end('Could not serve the requested test resource');
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Text comparison: http://127.0.0.1:${port}/dev/board-motion-benchmark.html?baseline=1`);
  console.log(`Full board: http://127.0.0.1:${port}/actual-board.html`);
  console.log(`Built app (run npm run web:build first): http://127.0.0.1:${port}/production-board.html`);
});
