'use strict';

(function initGpuRenderer(root) {
  // Geometry is retained in object-local coordinates. Camera changes only update
  // uniforms; the distance field and every glyph instance remain unchanged.
  const ROWS_PER_CHUNK = 64;
  const INSTANCE_BYTES = 12;
  const DEFAULT_BUFFER_BYTES = 64 * 1024 * 1024;
  const DEFAULT_CHUNK_LIMIT = 4096;
  const DEFAULT_IMAGE_BYTES = 128 * 1024 * 1024;
  const DEFAULT_FALLBACK_BYTES = 16 * 1024 * 1024;
  const ASCII = /^[\x20-\x7e\t]*$/;
  const ASCII_DOCUMENT = /^[\x09\x0a\x0d\x20-\x7e]*$/;
  const IDENTITY = [1, 0, 0, 1, 0, 0];
  const VERTEX = `#version 300 es
    precision highp float;
    layout(location=0) in vec3 instance;
    uniform mat3 transform;
    uniform vec2 viewport;
    uniform float fontSize;
    uniform vec2 pixelPadding;
    uniform sampler2D glyphs;
    out vec2 uv;
    flat out vec4 glyphBounds;
    out vec2 glyphPosition;
    flat out int glyphCode;
    void main() {
      vec2 corner=vec2(gl_VertexID&1, (gl_VertexID>>1)&1);
      vec4 plane=texelFetch(glyphs,ivec2(int(instance.z),0),0);
      vec4 atlas=texelFetch(glyphs,ivec2(int(instance.z),1),0);
      // A fragment shader cannot recover a subpixel quad that missed all pixel
      // centers. Include the entire pixel filter footprint around the glyph.
      vec2 point=plane.xy+corner*plane.zw+(corner*2.-1.)*pixelPadding;
      vec2 local=instance.xy+point*fontSize;
      vec2 pixel=(transform*vec3(local,1.)).xy;
      gl_Position=vec4(pixel.x/viewport.x*2.-1.,1.-pixel.y/viewport.y*2.,0.,1.);
      uv=atlas.xy+(point-plane.xy)/plane.zw*atlas.zw;
      glyphBounds=vec4(atlas.xy,atlas.xy+atlas.zw);
      glyphPosition=point;
      glyphCode=int(instance.z);
    }`;
  const FRAGMENT = `#version 300 es
    precision highp float;
    uniform sampler2D atlas;
    uniform vec2 unitRange;
    uniform vec4 color;
    uniform float deviceEm;
    uniform bool areaFiltered;
    uniform sampler2D integralAtlas;
    uniform bool integralFloat;
    uniform vec4 integralInfo;
    uniform vec3 integralGrid;
    in vec2 uv;
    flat in vec4 glyphBounds;
    in vec2 glyphPosition;
    flat in int glyphCode;
    out vec4 result;
    float median3(vec3 v) { return max(min(v.r,v.g),min(max(v.r,v.g),v.b)); }
    float coverage(vec2 p,float range) {
      return clamp((median3(texture(atlas,clamp(p,glyphBounds.xy,glyphBounds.zw)).rgb)-.5)*range+.5,0.,1.);
    }
    float integral(vec2 p) {
      int index=glyphCode-32,columns=int(integralInfo.w);
      vec2 tile=vec2(index%columns,index/columns)*integralInfo.z;
      vec2 q=clamp((p-integralGrid.yz)*integralGrid.x,vec2(0.),vec2(integralInfo.z-1.));
      if(integralFloat)return texture(integralAtlas,(tile+q+.5)/integralInfo.xy).r;
      // Decode before interpolating on devices without float texture filtering.
      // Low-precision RGB8 hardware interpolation can amplify byte carries.
      ivec2 p0=ivec2(tile+floor(q)),p1=ivec2(tile+min(floor(q)+1.,vec2(integralInfo.z-1.)));
      vec2 f=fract(q);vec3 weights=vec3(65536.,256.,1.);
      return mix(mix(dot(texelFetch(integralAtlas,p0,0).rgb,weights),dot(texelFetch(integralAtlas,ivec2(p1.x,p0.y),0).rgb,weights),f.x),
        mix(dot(texelFetch(integralAtlas,ivec2(p0.x,p1.y),0).rgb,weights),dot(texelFetch(integralAtlas,p1,0).rgb,weights),f.x),f.y);
    }
    float areaCoverage() {
      vec2 footprint=abs(dFdx(glyphPosition))+abs(dFdy(glyphPosition));
      vec2 lo=glyphPosition-footprint*.5,hi=glyphPosition+footprint*.5;
      float sum=integral(hi)-integral(vec2(lo.x,hi.y))-integral(vec2(hi.x,lo.y))+integral(lo);
      return clamp(sum/max(footprint.x*footprint.y*integralGrid.x*integralGrid.x,1e-8),0.,1.);
    }
    void main() {
      float area=areaFiltered?areaCoverage():0.;
      if(areaFiltered&&deviceEm<=8.) {
        float a=area*color.a;
        result=vec4(color.rgb*a,a);
        return;
      }
      vec2 dx=dFdx(uv),dy=dFdy(uv);
      float range=max(.5*dot(unitRange,1./max(fwidth(uv),vec2(1e-8))),1.);
      float a;
      if(deviceEm<32.) {
        // Fixed screen-space integration at reading sizes. This is applied on
        // every frame, including motion, and never rebuilds or swaps the atlas.
        vec2 x=dx*.25,y=dy*.25;
        float subRange=range*2.;
        float integrated=(coverage(uv-x-y,subRange)+coverage(uv+x-y,subRange)+
           coverage(uv-x+y,subRange)+coverage(uv+x+y,subRange))*.25;
        a=mix(integrated,coverage(uv,range),smoothstep(24.,32.,deviceEm));
      } else a=coverage(uv,range);
      if(areaFiltered)a=mix(area,a,smoothstep(8.,12.,deviceEm));
      a*=color.a;
      result=vec4(color.rgb*a,a);
    }`;
  const QUAD_VERTEX = `#version 300 es
    precision highp float;
    uniform mat3 transform;
    uniform vec2 viewport;
    uniform vec2 size;
    uniform vec4 sourceRect;
    out vec2 uv;
    void main() {
      vec2 corner=vec2(gl_VertexID&1,(gl_VertexID>>1)&1);
      vec2 p=(transform*vec3(corner*size,1.)).xy;
      gl_Position=vec4(p.x/viewport.x*2.-1.,1.-p.y/viewport.y*2.,0.,1.);
      uv=sourceRect.xy+corner*sourceRect.zw;
    }`;
  const QUAD_FRAGMENT = `#version 300 es
    precision highp float;
    uniform sampler2D image;
    uniform vec4 color;
    uniform bool textured;
    uniform bool coverageMask;
    in vec2 uv;
    out vec4 result;
    void main() {
      // Browser image uploads are premultiplied; MSDF uploads are deliberately
      // linear data and use their separate shader above.
      if(coverageMask) {
        float a=clamp(texture(image,uv).r,0.,1.)*color.a;
        result=vec4(color.rgb*a,a);
      } else result=textured?texture(image,uv)*color.a:vec4(color.rgb*color.a,color.a);
    }`;

  function multiply(a, b) {
    return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],
      a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],
      a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
  }
  function matrix3(m,x,y) { return [m[0],m[1],0,m[2],m[3],0,m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5],1]; }
  function state() {
    return { matrix: IDENTITY, fillStyle:'#000000', globalAlpha:1,
      globalCompositeOperation:'source-over', imageSmoothingEnabled:true,
      imageSmoothingQuality:'high', font:'16px sans-serif', textBaseline:'alphabetic',
      textAlign:'left', direction:'ltr', fontKerning:'none', letterSpacing:'0px',
      fontStretch:'normal', fontVariantCaps:'normal', wordSpacing:'0px', filter:'none',
      shadowColor:'rgba(0, 0, 0, 0)',shadowBlur:0,shadowOffsetX:0,shadowOffsetY:0 };
  }
  function createContext(canvas, options = {}) {
    if (!canvas?.getContext || !options.font?.glyphs) return null;
    const gl = canvas.getContext('webgl2', {
      alpha:false, antialias:false, depth:false, stencil:false,
      premultipliedAlpha:true, preserveDrawingBuffer:false, powerPreference:'high-performance',
    });
    if (!gl) return null;
    const makeCanvas = options.createCanvas || (() => root.document.createElement('canvas'));
    const font = options.font;
    const integralFont = options.integralFont || root.BoardfishAsciiIntegralFont;
    const bufferLimit = Math.max(INSTANCE_BYTES, options.maxBufferBytes || DEFAULT_BUFFER_BYTES);
    const chunkLimit = Math.max(1, Math.trunc(options.maxChunks || DEFAULT_CHUNK_LIMIT));
    const imageLimit = Math.max(4, options.maxImageBytes || DEFAULT_IMAGE_BYTES);
    const fallbackLimit = Math.max(4, options.maxFallbackBytes || DEFAULT_FALLBACK_BYTES);
    const chunks = new Map(), images = new Map(), textures = new Map(), fallback = new Map();
    const anonymousIds = new WeakMap();
    const immutableCanvases = new WeakSet();
    const asciiPrefixes = new WeakMap();
    const asciiObjects = new WeakMap();
    let anonymousId = 0, current = state(), stack = [], path = [];
    let textProgram, quadProgram, textVao, quadVao;
    let fontResources = [];
    let coverageTarget = null;
    let floatCoverage = false, floatIntegral = false;
    let lost = false, disposed = false, fontReady = false, generation = 0;
    let bufferBytes = 0, imageBytes = 0, fallbackBytes = 0;
    let measurementCanvas, measurementContext, colorContext;
    let ready;
    const colorCache = new Map();
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const tileSize = Math.min(2048, maxTextureSize - 2);
    /* BOARDFISH_DEV_DIAGNOSTICS_START */
    const stats = { frames:0, drawCalls:0, textDrawCalls:0, imageDrawCalls:0,
      rectangleDrawCalls:0, glyphsDrawn:0, bufferUploads:0, bufferUploadBytes:0,
      imageUploads:0, imageUploadBytes:0, imageEvictions:0, atlasUploads:0, fallbackRasterizations:0, contextLosses:0,
      areaTextDraws:0, coverageComposites:0, coverageTargetAllocations:0,
      frameDrawCalls:0, frameBufferUploads:0, frameGlyphsDrawn:0 };
    /* BOARDFISH_DEV_DIAGNOSTICS_END */

    function report(error) { try { options.onError?.(error); } catch (_) {} }
    function shader(type, source) {
      const value = gl.createShader(type);
      gl.shaderSource(value, source); gl.compileShader(value);
      if (!gl.getShaderParameter(value,gl.COMPILE_STATUS)) {
        const error = new Error(gl.getShaderInfoLog(value) || 'Text renderer shader compilation failed');
        gl.deleteShader(value); throw error;
      }
      return value;
    }
    function program(vertex, fragment, uniforms) {
      const value = gl.createProgram();
      let v, f;
      try {
        v=shader(gl.VERTEX_SHADER,vertex); f=shader(gl.FRAGMENT_SHADER,fragment);
        gl.attachShader(value,v); gl.attachShader(value,f); gl.linkProgram(value);
        if(!gl.getProgramParameter(value,gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(value) || 'Text renderer link failed');
        const locations={};
        for(const name of uniforms) locations[name]=gl.getUniformLocation(value,name);
        return {value,locations};
      } catch(error) { gl.deleteProgram(value); throw error; }
      finally { if(v)gl.deleteShader(v);if(f)gl.deleteShader(f); }
    }
    function textureParameters(filter) {
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    }
    function initialize() {
      floatCoverage=!!gl.getExtension('EXT_color_buffer_float');
      floatIntegral=!!gl.getExtension('OES_texture_float_linear');
      textProgram=program(VERTEX,FRAGMENT,['transform','viewport','fontSize','pixelPadding','glyphs','atlas','unitRange','color','deviceEm','areaFiltered','integralAtlas','integralFloat','integralInfo','integralGrid']);
      quadProgram=program(QUAD_VERTEX,QUAD_FRAGMENT,['transform','viewport','size','sourceRect','image','color','textured','coverageMask']);
      textVao=gl.createVertexArray(); quadVao=gl.createVertexArray();
      gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);gl.disable(gl.DITHER);
      gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      fontResources=[font,...(font.largeFont?[font.largeFont]:[]),...(integralFont?[integralFont]:[])].map(description=>{
        if(description===integralFont)return {font:description,integral:true,glyphTexture:null,atlasTexture:null,ready:false};
        const metadata = new Float32Array(128*2*4);
        for(let code=0;code<128;code++) {
          const glyph=description.glyphs[code],p=glyph?.planeBounds,a=glyph?.atlasBounds;
          if(!p||!a)continue;
          metadata.set([p.left,-p.top,p.right-p.left,p.top-p.bottom],code*4);
          metadata.set([a.left/description.width,1-a.top/description.height,(a.right-a.left)/description.width,(a.top-a.bottom)/description.height],(128+code)*4);
        }
        const glyphTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,glyphTexture);
        textureParameters(gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA32F,128,2,0,gl.RGBA,gl.FLOAT,metadata);
        return {font:description,glyphTexture,atlasTexture:null,ready:false};
      });
      gl.activeTexture(gl.TEXTURE0);
      loadAtlases();
    }
    function loadAtlases() {
      fontReady=false;
      const token=++generation;
      ready=Promise.all(fontResources.map(resource=>{
        const description=resource.font;
        const imagePromise=options.loadImage ? Promise.resolve().then(()=>options.loadImage(description.atlasURL)) : new Promise((resolve,reject)=>{
          const image=new root.Image();
          image.onload=()=>resolve(image);
          image.onerror=()=>reject(new Error('Could not load the ASCII font atlas'));
          image.src=description.atlasURL;
        });
        return imagePromise.then(image=>{
          if(disposed||lost||token!==generation)return false;
          if(description.width>maxTextureSize||description.height>maxTextureSize)throw new Error('ASCII atlas exceeds the device texture limit');
          if((image.width||image.naturalWidth)!==description.width||(image.height||image.naturalHeight)!==description.height)throw new Error('ASCII atlas dimensions do not match its metrics');
          resource.atlasTexture=gl.createTexture();gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,resource.atlasTexture);
          textureParameters(gl.LINEAR);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
          gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.NONE);
          if(resource.integral&&floatIntegral) {
            // One small startup decode; pan and zoom never read back or upload.
            const source=makeCanvas();source.width=description.width;source.height=description.height;
            const context=source.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0);
            const pixels=context.getImageData(0,0,source.width,source.height).data;
            const values=new Float32Array(source.width*source.height);
            for(let i=0;i<values.length;i++)values[i]=(pixels[i*4]*65536+pixels[i*4+1]*256+pixels[i*4+2])/255;
            source.width=source.height=0;
            gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,description.width,description.height,0,gl.RED,gl.FLOAT,values);
          } else gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
          /* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.atlasUploads++; /* BOARDFISH_DEV_DIAGNOSTICS_END */
          resource.ready=true;return true;
        });
      })).then(results=>{
        if(disposed||lost||token!==generation||!results.every(Boolean))return false;
        fontReady=true;
        try { options.onReady?.(); } catch(error) { report(error); }
        return true;
      }).catch(error=>{ if(!disposed&&token===generation)report(error);return false; });
    }
    function measurement() {
      if(!measurementContext) {
        measurementCanvas=makeCanvas();measurementContext=measurementCanvas.getContext('2d');
      }
      return measurementContext;
    }
    function rgba(value) {
      const key=String(value);
      if(colorCache.has(key))return colorCache.get(key);
      let match, color;
      if((match=/^#([0-9a-f]{3,8})$/i.exec(key))) {
        let hex=match[1];
        if(hex.length===3||hex.length===4)hex=Array.from(hex,c=>c+c).join('');
        if(hex.length===6||hex.length===8)color=[parseInt(hex.slice(0,2),16)/255,parseInt(hex.slice(2,4),16)/255,parseInt(hex.slice(4,6),16)/255,hex.length===8?parseInt(hex.slice(6,8),16)/255:1];
      }
      if(!color) {
        if(!colorContext) { const c=makeCanvas();c.width=c.height=1;colorContext=c.getContext('2d',{willReadFrequently:true}); }
        colorContext.clearRect(0,0,1,1);colorContext.fillStyle=key;colorContext.fillRect(0,0,1,1);
        color=Array.from(colorContext.getImageData(0,0,1,1).data,v=>v/255);
      }
      if(colorCache.size>=128)colorCache.delete(colorCache.keys().next().value);
      colorCache.set(key,color);return color;
    }
    function color() { const c=rgba(current.fillStyle);return [c[0],c[1],c[2],c[3]*current.globalAlpha]; }
    function setup(value) {
      gl.useProgram(value.value);
      gl.viewport(0,0,canvas.width,canvas.height);
      gl.uniform2f(value.locations.viewport,canvas.width,canvas.height);
      if(current.globalCompositeOperation==='copy')gl.disable(gl.BLEND);else gl.enable(gl.BLEND);
    }
    /* BOARDFISH_DEV_DIAGNOSTICS_START */ function drew(kind) { stats.drawCalls++;stats.frameDrawCalls++;stats[kind]++; } /* BOARDFISH_DEV_DIAGNOSTICS_END */
    function quad(x,y,w,h,texture,uv,tint=color()) {
      if(lost||disposed||!w||!h)return;
      setup(quadProgram);gl.bindVertexArray(quadVao);
      gl.uniformMatrix3fv(quadProgram.locations.transform,false,matrix3(current.matrix,x,y));
      gl.uniform2f(quadProgram.locations.size,w,h);
      gl.uniform4fv(quadProgram.locations.color,tint);
      gl.uniform1i(quadProgram.locations.textured,texture?1:0);
      gl.uniform1i(quadProgram.locations.coverageMask,0);
      if(texture) {
        gl.uniform4fv(quadProgram.locations.sourceRect,uv);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
        textureParameters(current.imageSmoothingEnabled?gl.LINEAR:gl.NEAREST);
        gl.uniform1i(quadProgram.locations.image,0);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP,0,4);/* BOARDFISH_DEV_DIAGNOSTICS_START */ drew(texture?'imageDrawCalls':'rectangleDrawCalls'); /* BOARDFISH_DEV_DIAGNOSTICS_END */
    }
    function deleteChunk(key,chunk) {
      if(!lost)gl.deleteBuffer(chunk.buffer);
      bufferBytes-=chunk.bytes;chunks.delete(key);
    }
    function deleteTexture(record) {
      if(!lost)gl.deleteTexture(record.texture);
      imageBytes-=record.bytes;textures.delete(record);
      record.owner.tiles.delete(record.key);
      if(!record.owner.tiles.size&&images.get(record.owner.source)===record.owner)images.delete(record.owner.source);
    }
    function trimResources() {
      while((bufferBytes>bufferLimit||chunks.size>chunkLimit)&&chunks.size) {
        const [key,chunk]=chunks.entries().next().value;deleteChunk(key,chunk);
      }
      while(imageBytes>imageLimit&&textures.size) {
        deleteTexture(textures.keys().next().value);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.imageEvictions++; /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
    }
    function deleteFallback(key,entry) {
      fallback.delete(key);fallbackBytes-=entry.bytes;
      const owner=images.get(entry.source);
      if(owner)for(const record of owner.tiles.values())deleteTexture(record);
      if(images.get(entry.source)===owner)images.delete(entry.source);
      immutableCanvases.delete(entry.source);
      // Image owners hold source canvases strongly. Release both representations
      // together so the CPU fallback budget remains independent of image LRU.
      entry.source.width=entry.source.height=0;
    }
    function trimFallback() {
      while(fallbackBytes>fallbackLimit&&fallback.size) {
        const [key,entry]=fallback.entries().next().value;deleteFallback(key,entry);
      }
    }
    function clearTextCache() {
      for(const [key,chunk] of chunks)deleteChunk(key,chunk);
      for(const [key,entry] of fallback)deleteFallback(key,entry);
    }
    function releaseCoverageTarget() {
      if(!coverageTarget)return;
      if(!lost) {
        gl.deleteFramebuffer(coverageTarget.framebuffer);
        gl.deleteTexture(coverageTarget.texture);
      }
      coverageTarget=null;
    }
    function getCoverageTarget() {
      if(coverageTarget?.width===canvas.width&&coverageTarget?.height===canvas.height)return coverageTarget;
      releaseCoverageTarget();
      if(!canvas.width||!canvas.height||canvas.width>maxTextureSize||canvas.height>maxTextureSize)return null;
      const texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
      textureParameters(gl.NEAREST);
      gl.texImage2D(gl.TEXTURE_2D,0,floatCoverage?gl.R16F:gl.R8,canvas.width,canvas.height,0,gl.RED,floatCoverage?gl.HALF_FLOAT:gl.UNSIGNED_BYTE,null);
      gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
      const complete=gl.checkFramebufferStatus(gl.FRAMEBUFFER)===gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      if(!complete) { gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);return null; }
      coverageTarget={texture,framebuffer,width:canvas.width,height:canvas.height};
      /* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.coverageTargetAllocations++; /* BOARDFISH_DEV_DIAGNOSTICS_END */
      return coverageTarget;
    }
    function resetResources() {
      clearTextCache();
      releaseCoverageTarget();
      for(const record of textures.keys())deleteTexture(record);
      images.clear();
    }
    function objectKey(obj) {
      if(obj.id!=null)return `id:${obj.id}`;
      if(!anonymousIds.has(obj))anonymousIds.set(obj,++anonymousId);
      return `anonymous:${anonymousIds.get(obj)}`;
    }
    function optionsFor(style={}) {
      return {fontSize:Number(style.fontSize)||16,padding:Number.isFinite(style.padding)?style.padding:16,
        lineHeight:Number(style.lineHeight)||24,baselineOffset:Number.isFinite(style.baselineOffset)?style.baselineOffset:16};
    }
    function prepare(layout,obj,style) {
      if(!fontReady||lost||disposed||!Array.isArray(layout)||!obj)return null;
      const content=obj.data?.content;
      if(typeof content==='string') {
        let checked=asciiObjects.get(obj);
        if(!checked||checked.content!==content) {
          checked={content,supported:ASCII_DOCUMENT.test(content)};asciiObjects.set(obj,checked);
        }
        // A Unicode row entering/leaving the viewport must not switch every
        // other row in this textbox between raster and distance-field rendering.
        if(!checked.supported)return null;
      }
      const settings=optionsFor(style),key=objectKey(obj),groups=new Map();
      for(const line of layout) {
        const text=String(line.text??'');
        if(!line.prefixWidths||typeof line.prefixWidths!=='object')return null;
        let checked=asciiPrefixes.get(line.prefixWidths);
        if(!checked||checked.text!==text) {
          checked={text,supported:ASCII.test(text)};asciiPrefixes.set(line.prefixWidths,checked);
        }
        if(!checked.supported)return null;
        const row=Math.round((line.y-obj.y-settings.padding)/settings.lineHeight);
        const index=Math.floor(row/ROWS_PER_CHUNK);
        let group=groups.get(index);
        if(!group) { group={index,lines:[],first:row,last:row};groups.set(index,group); }
        group.lines.push({line,row});group.first=Math.min(group.first,row);group.last=Math.max(group.last,row);
      }
      const prepared=[],protectedChunks=new Set();
      let protectedBytes=0;
      for(const group of groups.values()) {
        if(protectedChunks.size>=chunkLimit)return null;
        const chunkKey=`${key}:${group.index}:${settings.lineHeight}:${settings.baselineOffset}`;
        let chunk=chunks.get(chunkKey);
        if(!chunk) {
          for(const [candidateKey,candidate] of chunks) {
            if(chunks.size<chunkLimit)break;
            if(!protectedChunks.has(candidate))deleteChunk(candidateKey,candidate);
          }
          chunk={objectKey:key,index:group.index,rows:new Map(),buffer:gl.createBuffer(),bytes:0,offsets:new Map(),dirty:true};
          chunks.set(chunkKey,chunk);
        }
        const changedRows=new Set();
        let count=chunk.bytes/INSTANCE_BYTES;
        for(const {line,row} of group.lines) {
          const old=chunk.rows.get(row);
          // Subtracting translated world coordinates can differ by a few ULPs.
          // A micro-world-pixel canonical baseline prevents movement-only uploads.
          const baseline=Math.round((Number.isFinite(line.textY)?line.textY-line.y:settings.baselineOffset)*1e6)/1e6;
          if(!old||old.text!==line.text||old.prefix!==line.prefixWidths||old.baseline!==baseline) {
            let glyphCount=0;
            for(let i=0;i<line.text.length;i++)if(line.text.charCodeAt(i)>32) {
              glyphCount++;
              // A single row that cannot fit must fall back before allocating
              // any new instance array, even for enormous legacy text rows.
              if(protectedBytes+glyphCount*INSTANCE_BYTES>bufferLimit) { deleteChunk(chunkKey,chunk);return null; }
            }
            count+=glyphCount-(old?.glyphCount??chunk.offsets.get(row)?.count??0);
            chunk.rows.set(row,{text:line.text,prefix:line.prefixWidths,baseline,glyphCount});
            changedRows.add(row);chunk.dirty=true;
          }
        }
        if(chunk.dirty) {
          // Extremely wide legacy rows retain the compatible raster path rather
          // than attempting a device-sized allocation or dropping characters.
          const nextBytes=count*INSTANCE_BYTES;
          if(protectedBytes+nextBytes>bufferLimit) { deleteChunk(chunkKey,chunk);return null; }
          // Enforce the aggregate budget before allocating/uploading. Chunks
          // referenced by this pending draw cannot be evicted until submitted.
          for(const [candidateKey,candidate] of chunks) {
            if(bufferBytes-chunk.bytes+nextBytes<=bufferLimit)break;
            if(candidate===chunk||protectedChunks.has(candidate))continue;
            deleteChunk(candidateKey,candidate);
          }
          try {
            // Keep exactly one CPU instance array per retained GPU buffer.
            // Panning usually exposes only a few rows: copy the other rows in
            // native code instead of decoding every retained glyph again.
            // The limit is checked above before creating this temporary
            // replacement; retained CPU bytes match the bounded GPU bytes.
            const data=new Float32Array(count*3),offsets=new Map();let offset=0;
            chunk.left=Infinity;chunk.right=-Infinity;chunk.baselineMin=Infinity;chunk.baselineMax=-Infinity;
            for(const row of Array.from(chunk.rows.keys()).sort((a,b)=>a-b)) {
              const entry=chunk.rows.get(row),start=offset/3,previous=chunk.offsets.get(row);
              chunk.left=Math.min(chunk.left,entry.prefix[0]||0);
              chunk.right=Math.max(chunk.right,entry.prefix[entry.text.length]||0);
              chunk.baselineMin=Math.min(chunk.baselineMin,entry.baseline);
              chunk.baselineMax=Math.max(chunk.baselineMax,entry.baseline);
              if(chunk.data&&previous&&!changedRows.has(row)) {
                data.set(chunk.data.subarray(previous.start*3,(previous.start+previous.count)*3),offset);
                offset+=previous.count*3;
              } else for(let i=0;i<entry.text.length;i++) {
                const code=entry.text.charCodeAt(i);if(code<=32)continue;
                data[offset++]=entry.prefix[i];
                data[offset++]=(row-group.index*ROWS_PER_CHUNK)*settings.lineHeight+entry.baseline;
                data[offset++]=code;
              }
              offsets.set(row,{start,count:offset/3-start});
            }
            gl.bindBuffer(gl.ARRAY_BUFFER,chunk.buffer);gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
            bufferBytes+=data.byteLength-chunk.bytes;chunk.bytes=data.byteLength;
            chunk.data=data;chunk.offsets=offsets;chunk.dirty=false;
            /* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.bufferUploads++;stats.frameBufferUploads++;stats.bufferUploadBytes+=data.byteLength; /* BOARDFISH_DEV_DIAGNOSTICS_END */
          } catch(_) {
            // Changed row metadata must never outlive a failed replacement.
            deleteChunk(chunkKey,chunk);return null;
          }
        }
        // Map order is the resource LRU; movement and camera changes touch only
        // references and uniforms, never retained glyph bytes.
        if(protectedBytes+chunk.bytes>bufferLimit)return null;
        chunks.delete(chunkKey);chunks.set(chunkKey,chunk);
        protectedChunks.add(chunk);protectedBytes+=chunk.bytes;
        prepared.push({chunk,group,settings});
      }
      return prepared;
    }
    function drawTextLayout(layout,obj,style) {
      const prepared=prepare(layout,obj,style);if(!prepared)return false;
      if(!prepared.length)return true;
      const settings=prepared[0].settings,m=current.matrix;
      const deviceEm=settings.fontSize*Math.max(Math.hypot(m[0],m[1]),Math.hypot(m[2],m[3]));
      const integralResource=fontResources.find(resource=>resource.integral);
      // Board text is axis aligned. A rotated/sheared transform keeps MSDF:
      // a rectangular integral is not an exact rotated pixel footprint.
      const areaFiltered=!!(integralResource?.ready&&deviceEm<12&&m[1]===0&&m[2]===0&&m[0]&&m[3]);
      const target=areaFiltered?getCoverageTarget():null;
      let bounds;
      if(target) {
        let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
        for(const {chunk,group} of prepared) {
          if(!Number.isFinite(chunk.left))continue;
          // Chunk x bounds may include retained offscreen rows, conservatively.
          // Only their device-space rectangle is cleared and composited.
          const x=m[0]*(obj.x+settings.padding)+m[4];
          const y=m[3]*(obj.y+settings.padding)+m[5];
          const a=x+m[0]*(chunk.left-settings.fontSize),b=x+m[0]*(chunk.right+settings.fontSize);
          const c=y+m[3]*(group.first*settings.lineHeight+chunk.baselineMin-settings.fontSize*1.5);
          const d=y+m[3]*(group.last*settings.lineHeight+chunk.baselineMax+settings.fontSize);
          left=Math.min(left,a,b);right=Math.max(right,a,b);
          top=Math.min(top,c,d);bottom=Math.max(bottom,c,d);
        }
        bounds=[Math.max(0,Math.floor(left-1)),Math.max(0,Math.floor(top-1)),Math.min(canvas.width,Math.ceil(right+1)),Math.min(canvas.height,Math.ceil(bottom+1))];
        if(!(bounds[2]>bounds[0]&&bounds[3]>bounds[1]))return true;
        gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer);
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(bounds[0],canvas.height-bounds[3],bounds[2]-bounds[0],bounds[3]-bounds[1]);
        gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
      }
      setup(textProgram);gl.bindVertexArray(textVao);
      if(target) { gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE); }
      gl.uniform1i(textProgram.locations.atlas,0);gl.uniform1i(textProgram.locations.glyphs,1);
      gl.uniform4fv(textProgram.locations.color,target?[1,1,1,1]:color());
      gl.uniform1i(textProgram.locations.areaFiltered,target?1:0);
      gl.uniform2f(textProgram.locations.pixelPadding,
        target ? .5/(Math.abs(m[0])*settings.fontSize) : 0,
        target ? .5/(Math.abs(m[3])*settings.fontSize) : 0);
      if(target) {
        const description=integralResource.font;
        gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,integralResource.atlasTexture);
        gl.uniform1i(textProgram.locations.integralAtlas,2);
        gl.uniform1i(textProgram.locations.integralFloat,floatIntegral?1:0);
        gl.uniform4fv(textProgram.locations.integralInfo,[description.width,description.height,description.cellSize,description.columns]);
        gl.uniform3f(textProgram.locations.integralGrid,description.emSize,description.originX,description.originY);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.areaTextDraws++; /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
      gl.enableVertexAttribArray(0);gl.vertexAttribDivisor(0,1);
      for(const {chunk,group,settings} of prepared) {
        const first=chunk.offsets.get(group.first),last=chunk.offsets.get(group.last);
        const count=last.start+last.count-first.start;if(!count)continue;
        const deviceEm=settings.fontSize*Math.max(Math.hypot(current.matrix[0],current.matrix[1]),Math.hypot(current.matrix[2],current.matrix[3]));
        // Both detail levels are uploaded before first use. Changing scale only
        // selects immutable resources; it never rerasterizes or uploads glyphs.
        const resource=deviceEm>=128&&font.largeFont?fontResources[1]:fontResources[0];
        const description=resource.font;
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,resource.atlasTexture);
        gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,resource.glyphTexture);
        gl.uniform2f(textProgram.locations.unitRange,description.distanceRange/description.width,description.distanceRange/description.height);
        gl.uniform1f(textProgram.locations.fontSize,settings.fontSize);
        gl.uniform1f(textProgram.locations.deviceEm,deviceEm);
        const x=obj.x+settings.padding,y=obj.y+settings.padding+chunk.index*ROWS_PER_CHUNK*settings.lineHeight;
        gl.uniformMatrix3fv(textProgram.locations.transform,false,matrix3(current.matrix,x,y));
        gl.bindBuffer(gl.ARRAY_BUFFER,chunk.buffer);
        gl.vertexAttribPointer(0,3,gl.FLOAT,false,INSTANCE_BYTES,first.start*INSTANCE_BYTES);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,count);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.glyphsDrawn+=count;stats.frameGlyphsDrawn+=count;drew('textDrawCalls'); /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
      if(target) {
        gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.disable(gl.SCISSOR_TEST);
        gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
        // Accumulate coverage before source-over. Independently source-overing
        // glyphs would lose ink whenever adjacent letters share a tiny pixel.
        setup(quadProgram);gl.bindVertexArray(quadVao);
        gl.uniformMatrix3fv(quadProgram.locations.transform,false,matrix3(IDENTITY,bounds[0],bounds[1]));
        gl.uniform2f(quadProgram.locations.size,bounds[2]-bounds[0],bounds[3]-bounds[1]);
        gl.uniform4fv(quadProgram.locations.color,color());
        gl.uniform1i(quadProgram.locations.coverageMask,1);
        gl.uniform1i(quadProgram.locations.textured,1);
        gl.uniform4fv(quadProgram.locations.sourceRect,[bounds[0]/canvas.width,1-bounds[1]/canvas.height,(bounds[2]-bounds[0])/canvas.width,-(bounds[3]-bounds[1])/canvas.height]);
        gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,target.texture);
        gl.uniform1i(quadProgram.locations.image,0);
        gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
        /* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.coverageComposites++;drew('textDrawCalls'); /* BOARDFISH_DEV_DIAGNOSTICS_END */
      }
      trimResources();
      return true;
    }
    function fillPath() {
      // Canvas fills the union of subpaths once. Drawing translucent selection
      // rectangles independently would darken their overlapping areas.
      const events=[];
      for(let index=0;index<path.length;index++) {
        let [x,y,w,h]=path[index];if(!w||!h)continue;
        if(w<0){x+=w;w=-w;}if(h<0){y+=h;h=-h;}
        events.push({y,index,x,right:x+w,add:true},{y:y+h,index,add:false});
      }
      events.sort((a,b)=>a.y-b.y);
      const active=new Map();let previous=events[0]?.y;
      for(let i=0;i<events.length;) {
        const y=events[i].y;
        if(y>previous&&active.size) {
          const intervals=Array.from(active.values()).sort((a,b)=>a.x-b.x);
          let left=intervals[0].x,right=intervals[0].right;
          for(let j=1;j<intervals.length;j++) {
            const next=intervals[j];
            if(next.x<=right)right=Math.max(right,next.right);
            else {quad(left,previous,right-left,y-previous,null);left=next.x;right=next.right;}
          }
          quad(left,previous,right-left,y-previous,null);
        }
        while(i<events.length&&events[i].y===y) {
          const event=events[i++];if(event.add)active.set(event.index,event);else active.delete(event.index);
        }
        previous=y;
      }
    }
    function imageDimensions(source) { return [source.naturalWidth||source.videoWidth||source.width,source.naturalHeight||source.videoHeight||source.height]; }
    function imageLevel(width,height,sw,sh,dw,dh) {
      // Retain a power-of-two resolution pyramid, capped at native resolution.
      // Minified images supply at least one texel per device pixel, without
      // allocating full-size images
      // just above the CPU quarter-bitmap cutoff. Crop and camera position do
      // not affect the level or its tile grid. Use the largest singular value
      // so rotation, flips, anisotropic scaling and shear preserve detail.
      const m=current.matrix,x=dw/sw,y=dh/sh;
      const aa=(m[0]*m[0]+m[1]*m[1])*x*x,bb=(m[2]*m[2]+m[3]*m[3])*y*y;
      const ab=(m[0]*m[2]+m[1]*m[3])*x*y;
      const density=Math.sqrt((aa+bb+Math.hypot(aa-bb,2*ab))/2);
      const exponent=current.imageSmoothingEnabled&&Number.isFinite(density)&&density>0
        ? Math.max(-Math.ceil(Math.log2(Math.max(width,height))),Math.min(0,Math.ceil(Math.log2(density)-1e-10))) : 0;
      const scale=2**exponent;
      return {exponent,width:Math.max(1,Math.ceil(width*scale)),height:Math.max(1,Math.ceil(height*scale))};
    }
    function sourceTexture(source,owner,level,tx,ty,sw,sh) {
      const key=`${level.exponent}:${tx},${ty}`;let record=owner.tiles.get(key);
      const dynamic=!immutableCanvases.has(source)&&(typeof source.getContext==='function'||typeof source.requestVideoFrameCallback==='function');
      if(record&&!dynamic) { textures.delete(record);textures.set(record,true);return record; }
      // Gutters are measured in level texels. Downsample the entire source on
      // one global grid, clipped by the tile canvas, so filtering can read past
      // tile boundaries and odd source dimensions keep the same sample phase.
      const ux=Math.max(0,tx-1),uy=Math.max(0,ty-1);
      const uw=Math.min(level.width,tx+sw+1)-ux,uh=Math.min(level.height,ty+sh+1)-uy;
      let upload=source;
      if(level.exponent||ux||uy||uw!==owner.width||uh!==owner.height) {
        const tile=makeCanvas();tile.width=uw;tile.height=uh;
        const ctx=tile.getContext('2d');
        if(level.exponent) {
          ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';
          ctx.drawImage(source,0,0,owner.width,owner.height,-ux,-uy,level.width,level.height);
        } else ctx.drawImage(source,ux,uy,uw,uh,0,0,uw,uh);
        upload=tile;
      }
      if(!record) {
        record={key,owner,texture:gl.createTexture(),bytes:uw*uh*4,width:uw,height:uh,x:ux,y:uy};
        owner.tiles.set(key,record);images.set(source,owner);textures.set(record,true);imageBytes+=record.bytes;
      }
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,record.texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,gl.BROWSER_DEFAULT_WEBGL);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,upload);
      /* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.imageUploads++;stats.imageUploadBytes+=record.bytes; /* BOARDFISH_DEV_DIAGNOSTICS_END */return record;
    }
    function drawImage(source,...args) {
      if(lost||disposed||!source)return;
      const [width,height]=imageDimensions(source);if(!(width>0&&height>0))return;
      let sx=0,sy=0,sw=width,sh=height,dx,dy,dw,dh;
      if(args.length===2) { [dx,dy]=args;dw=width;dh=height; }
      else if(args.length===4) [dx,dy,dw,dh]=args;
      else if(args.length===8) [sx,sy,sw,sh,dx,dy,dw,dh]=args;
      else throw new TypeError('drawImage requires 3, 5, or 9 arguments');
      if(![sx,sy,sw,sh,dx,dy,dw,dh].every(Number.isFinite)||!sw||!sh||!dw||!dh)return;
      // Canvas negative dimensions expand the rectangle in the other direction;
      // flipping is represented by the current transform instead.
      if(sw<0){sx+=sw;sw=-sw;}if(sh<0){sy+=sh;sh=-sh;}
      if(dw<0){dx+=dw;dw=-dw;}if(dh<0){dy+=dh;dh=-dh;}
      const level=imageLevel(width,height,sw,sh,dw,dh);
      // Actual rounded dimensions, rather than the nominal power of two,
      // preserve the image's complete extent for odd-sized sources and crops.
      sx*=level.width/width;sw*=level.width/width;
      sy*=level.height/height;sh*=level.height/height;
      const x1=Math.max(0,sx),y1=Math.max(0,sy),x2=Math.min(level.width,sx+sw),y2=Math.min(level.height,sy+sh);
      if(x2<=x1||y2<=y1)return;
      let owner=images.get(source);
      const version=source.currentSrc||source.src||'';
      if(owner&&(owner.width!==width||owner.height!==height||owner.version!==version)) {
        for(const record of owner.tiles.values())deleteTexture(record);owner=null;
      }
      if(!owner) { owner={source,width,height,version,tiles:new Map()};images.set(source,owner); }
      for(let ty=Math.floor(y1/tileSize)*tileSize;ty<y2;ty+=tileSize) {
        for(let tx=Math.floor(x1/tileSize)*tileSize;tx<x2;tx+=tileSize) {
          const tw=Math.min(tileSize,level.width-tx),th=Math.min(tileSize,level.height-ty);
          const left=Math.max(x1,tx),top=Math.max(y1,ty),right=Math.min(x2,tx+tw),bottom=Math.min(y2,ty+th);
          const record=sourceTexture(source,owner,level,tx,ty,tw,th);
          quad(dx+(left-sx)*dw/sw,dy+(top-sy)*dh/sh,(right-left)*dw/sw,(bottom-top)*dh/sh,
            record.texture,[(left-record.x)/record.width,(top-record.y)/record.height,(right-left)/record.width,(bottom-top)/record.height],[1,1,1,current.globalAlpha]);
          trimResources();
        }
      }
    }
    function configureMeasurement(context) {
      for(const key of ['font','fontKerning','letterSpacing','wordSpacing','fontStretch','fontVariantCaps','textAlign','direction','textBaseline']) {
        try { context[key]=current[key]; } catch (_) {}
      }
    }
    function fillText(text,x,y,maxWidth) {
      if(lost||disposed||!text)return;
      const scale=Math.max(Math.hypot(current.matrix[0],current.matrix[1]),Math.hypot(current.matrix[2],current.matrix[3]),1/64);
      const key=JSON.stringify([String(text),current.font,current.fillStyle,current.textBaseline,current.textAlign,current.direction,scale,maxWidth]);
      let entry=fallback.get(key);
      if(!entry) {
        const measure=measurement();configureMeasurement(measure);
        const metrics=measure.measureText(String(text));
        const size=parseFloat(/([\d.]+)px/.exec(current.font)?.[1])||16;
        const left=Number.isFinite(metrics.actualBoundingBoxLeft)?metrics.actualBoundingBoxLeft:0;
        const right=Number.isFinite(metrics.actualBoundingBoxRight)?metrics.actualBoundingBoxRight:metrics.width;
        const ascent=Number.isFinite(metrics.actualBoundingBoxAscent)?metrics.actualBoundingBoxAscent:size;
        const descent=Number.isFinite(metrics.actualBoundingBoxDescent)?metrics.actualBoundingBoxDescent:size*.3;
        const pad=2/scale,rx=-left-pad,ry=-ascent-pad;
        const width=Math.max(1,Math.ceil((left+right+pad*2)*scale));
        const height=Math.max(1,Math.ceil((ascent+descent+pad*2)*scale));
        const raster=makeCanvas();raster.width=width;raster.height=height;
        const context=raster.getContext('2d');configureMeasurement(context);
        context.setTransform(scale,0,0,scale,-rx*scale,-ry*scale);context.fillStyle=current.fillStyle;
        if(maxWidth==null)context.fillText(String(text),0,0);else context.fillText(String(text),0,0,maxWidth);
        immutableCanvases.add(raster);
        entry={source:raster,x:rx,y:ry,w:width/scale,h:height/scale,bytes:width*height*4};
        fallback.set(key,entry);fallbackBytes+=entry.bytes;/* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.fallbackRasterizations++; /* BOARDFISH_DEV_DIAGNOSTICS_END */
      } else { fallback.delete(key);fallback.set(key,entry); }
      // drawImage may trim its GPU tiles while submitting a large fallback.
      // Keep the source canvas intact until every tile has consumed its pixels.
      try { drawImage(entry.source,x+entry.x,y+entry.y,entry.w,entry.h); }
      finally { trimFallback();trimResources(); }
    }
    function lostContext(event) {
      event.preventDefault();lost=true;fontReady=false;generation++;/* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.contextLosses++; /* BOARDFISH_DEV_DIAGNOSTICS_END */
      chunks.clear();images.clear();textures.clear();bufferBytes=imageBytes=0;
      coverageTarget=null;
      try { options.onLost?.(); } catch(error) { report(error); }
    }
    function restoredContext() {
      if(disposed)return;
      lost=false;
      try { initialize(); } catch(error) { lost=true;report(error); }
    }
    const context={
      canvas,isBoardfishGpuContext:true,
      get fontReady(){return fontReady;},get ready(){return ready;},
      save(){stack.push({...current});},
      restore(){if(stack.length)current=stack.pop();},
      setTransform(...values){
        if(values.length===1&&typeof values[0]==='object') {const m=values[0];current.matrix=[m.a??m.m11??1,m.b??m.m12??0,m.c??m.m21??0,m.d??m.m22??1,m.e??m.m41??0,m.f??m.m42??0];}
        else if(values.length===6&&values.every(Number.isFinite))current.matrix=values;
      },
      resetTransform(){current.matrix=IDENTITY;},
      getTransform(){const [a,b,c,d,e,f]=current.matrix;return {a,b,c,d,e,f,is2D:true};},
      transform(...values){if(values.length===6&&values.every(Number.isFinite))current.matrix=multiply(current.matrix,values);},
      translate(x,y){current.matrix=multiply(current.matrix,[1,0,0,1,x,y]);},
      scale(x,y){current.matrix=multiply(current.matrix,[x,0,0,y,0,0]);},
      rotate(angle){const c=Math.cos(angle),s=Math.sin(angle);current.matrix=multiply(current.matrix,[c,s,-s,c,0,0]);},
      fillRect(x,y,w,h){quad(x,y,w,h,null);},
      clearRect(x,y,w,h){
        if(lost||disposed)return;
        const old=current.globalCompositeOperation;current.globalCompositeOperation='copy';
        quad(x,y,w,h,null,null,[0,0,0,0]);current.globalCompositeOperation=old;
      },
      beginPath(){path=[];},rect(x,y,w,h){path.push([x,y,w,h]);},fill:fillPath,
      drawImage,fillText,
      measureText(text){const ctx=measurement();configureMeasurement(ctx);return ctx.measureText(text);},
      drawTextLayout,
      prepareTextLayout(layout,obj,style){const result=prepare(layout,obj,style);trimResources();return result!==null;},
      beginFrame(objects){
        /* BOARDFISH_DEV_DIAGNOSTICS_START */ stats.frames++;stats.frameDrawCalls=stats.frameBufferUploads=stats.frameGlyphsDrawn=0; /* BOARDFISH_DEV_DIAGNOSTICS_END */
        if(objects) {
          const live=new Set();for(const obj of objects)if(obj?.type==='text')live.add(objectKey(obj));
          for(const [key,chunk] of chunks)if(!live.has(chunk.objectKey))deleteChunk(key,chunk);
        }
      },
      endFrame(){trimResources();},clearTextCache,resetResources,
      /* BOARDFISH_DEV_DIAGNOSTICS_START */ getStats(){return {...stats,fontReady,lost,frame:stats.frames,bufferBytes,imageBytes,fallbackBytes,floatCoverage,floatIntegral,coverageBytes:coverageTarget?coverageTarget.width*coverageTarget.height*(floatCoverage?2:1):0,chunkCount:chunks.size,imageCount:images.size,textureCount:textures.size,atlasBytes:fontResources.reduce((bytes,resource)=>bytes+(resource.ready?resource.font.width*resource.font.height*4+(resource.glyphTexture?4096:0):0),0)};}, /* BOARDFISH_DEV_DIAGNOSTICS_END */
      dispose(){
        if(disposed)return;resetResources();disposed=true;fontReady=false;generation++;
        canvas.removeEventListener?.('webglcontextlost',lostContext);canvas.removeEventListener?.('webglcontextrestored',restoredContext);
        if(!lost) {
          for(const resource of fontResources) {
            if(resource.atlasTexture)gl.deleteTexture(resource.atlasTexture);if(resource.glyphTexture)gl.deleteTexture(resource.glyphTexture);
          }
          if(textProgram)gl.deleteProgram(textProgram.value);if(quadProgram)gl.deleteProgram(quadProgram.value);
          if(textVao)gl.deleteVertexArray(textVao);if(quadVao)gl.deleteVertexArray(quadVao);
        }
      },
    };
    for(const key of Object.keys(current))if(key!=='matrix')Object.defineProperty(context,key,{
      enumerable:true,get(){return current[key];},set(value){
        if(key==='globalAlpha'){if(Number.isFinite(value)&&value>=0&&value<=1)current[key]=value;}
        else current[key]=value;
      },
    });
    canvas.addEventListener?.('webglcontextlost',lostContext);
    canvas.addEventListener?.('webglcontextrestored',restoredContext);
    try { initialize(); } catch(error) { report(error);context.dispose();return null; }
    return context;
  }
  const api=Object.freeze({createContext});
  root.BoardfishGpuRenderer=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
