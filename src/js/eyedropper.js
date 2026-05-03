'use strict';

var eyedropperLoupe = document.getElementById('eyedropper-loupe');
var eyedropperPreview = document.getElementById('eyedropper-preview');
var eyedropperCanvas = document.getElementById('eyedropper-canvas');
var eyedropperSwatch = document.getElementById('eyedropper-swatch');
var eyedropperHex = document.getElementById('eyedropper-hex');
var eyedropperHsl = document.getElementById('eyedropper-hsl');
var eyedropperRgb = document.getElementById('eyedropper-rgb');
var eyedropperCtx = eyedropperCanvas?.getContext('2d', { willReadFrequently: true });
var eyedropperRenderedSampleCanvas = document.createElement('canvas');
var eyedropperRenderedSampleCtx = eyedropperRenderedSampleCanvas.getContext('2d', { willReadFrequently: true });
var eyedropperSampleImageCache = {};
var eyedropperSampleImageUseCounter = 1;
var eyedropperEnabled = false;
var eyedropperSampling = false;
var _eyedropperLastSampleEvent = null;
var _eyedropperPendingSampleEvent = null;
var _eyedropperSampleRaf = null;
var _eyedropperShieldRelease = null;
var EYEDROPPER_RADIUS_CSS = 16;
var EYEDROPPER_PREVIEW_ZOOM_SCALE = 3;
var EYEDROPPER_PREVIEW_CSS = 96;
var EYEDROPPER_MENU_CSS_WIDTH = 280;
var EYEDROPPER_MENU_CSS_HEIGHT = 392;
var EYEDROPPER_SOURCE_CACHE_LIMIT = 3;
var EYEDROPPER_MAX_IMAGE_DATA_BYTES = 96 * 1024 * 1024;
var EYEDROPPER_MAX_SOURCE_AVERAGE_SIDE = 32;
var EYEDROPPER_GRID_SIZE = EYEDROPPER_RADIUS_CSS * 2 + 1;

function setEyedropperEnabled(enabled) {
  eyedropperEnabled = !!enabled;
  if (eyedropperEnabled && !_eyedropperShieldRelease) {
    _eyedropperShieldRelease = acquireInputShield(
      'pointerdown:0',
      'pointermove',
      'pointerup:0',
      'mousedown:0',
      'mousemove',
      'mouseup:0',
      'contextmenu',
      'wheel',
      'key:escape',
      'key:i',
      'key:o',
      'key:s',
      'code:keyo',
      'code:keys',
      'code:space',
      { visual: false, allowBoardNavigation: true },
    );
  } else if (!eyedropperEnabled && _eyedropperShieldRelease) {
    _eyedropperShieldRelease();
    _eyedropperShieldRelease = null;
  }
  if (eyedropperMenuBtn) eyedropperMenuBtn.setAttribute('aria-pressed', eyedropperEnabled ? 'true' : 'false');
  document.body.classList.toggle('eyedropper-enabled', eyedropperEnabled);
  updateEyedropperCommandState();
  if (!eyedropperEnabled) hideEyedropperSample();
  updateSelectionOverlay();
}

function isEyedropperShieldActive() {
  return eyedropperEnabled && !!_eyedropperShieldRelease;
}

function isCommandBlockedByEyedropper(commandId) {
  return eyedropperEnabled && ['btn-add-text', 'btn-add-image', 'btn-paste'].includes(commandId);
}

function updateEyedropperCommandState() {
  const creationGroupTrailingSep = pasteBtn?.nextElementSibling?.classList?.contains('ctx-sep')
    ? pasteBtn.nextElementSibling
    : null;
  for (const button of [addTextBtn, addImageBtn, pasteBtn]) {
    if (!button) continue;
    button.disabled = eyedropperEnabled;
    button.setAttribute('aria-disabled', eyedropperEnabled ? 'true' : 'false');
    button.style.display = eyedropperEnabled ? 'none' : '';
  }
  if (creationGroupTrailingSep) creationGroupTrailingSep.style.display = eyedropperEnabled ? 'none' : '';
}

function positionEyedropperLoupe(clientX, clientY) {
  const margin = 18;
  const gap = 22;
  const rect = eyedropperLoupe.getBoundingClientRect();
  const previewRect = eyedropperPreview?.getBoundingClientRect();
  const width = rect.width || EYEDROPPER_MENU_CSS_WIDTH;
  const height = rect.height || EYEDROPPER_MENU_CSS_HEIGHT;
  const previewHeight = previewRect?.height || width;
  const previewTopOffset = previewRect?.height ? previewRect.top - rect.top : 0;
  let left = clientX + gap;
  let top = clientY - previewTopOffset - (previewHeight / 2);
  if (left + width + margin > window.innerWidth) {
    left = clientX - width - gap;
  }
  left = Math.max(margin, Math.min(window.innerWidth - width - margin, left));
  top = Math.max(margin, Math.min(window.innerHeight - height - margin, top));
  eyedropperLoupe.style.transform = `translate(${Math.round(left)}px,${Math.round(top)}px)`;
}

function rgbaToCss(pixel) {
  if (!pixel) return 'transparent';
  return `rgba(${pixel[0]},${pixel[1]},${pixel[2]},${Math.round((pixel[3] / 255) * 1000) / 1000})`;
}

function colorByteToHex(value) {
  return Number(value || 0).toString(16).padStart(2, '0').toUpperCase();
}

function rgbaToHex(pixel) {
  if (!pixel) return '#000000';
  const hex = `#${colorByteToHex(pixel[0])}${colorByteToHex(pixel[1])}${colorByteToHex(pixel[2])}`;
  return pixel[3] === 255 ? hex : `${hex}${colorByteToHex(pixel[3])}`;
}

function rgbaToRgbText(pixel) {
  if (!pixel) return '0 0 0';
  return `${pixel[0]} ${pixel[1]} ${pixel[2]}`;
}

function rgbaToHslText(pixel) {
  if (!pixel) return '0 0% 0%';
  const r = pixel[0] / 255;
  const g = pixel[1] / 255;
  const b = pixel[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  let hue = 0;
  let saturation = 0;

  if (max !== min) {
    const delta = max - min;
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
    hue *= 60;
  }

  return `${Math.round(hue)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`;
}

function updateEyedropperColorReadout(pixel) {
  const cssColor = rgbaToCss(pixel);
  if (eyedropperSwatch) eyedropperSwatch.style.background = cssColor;
  if (eyedropperHex) eyedropperHex.textContent = rgbaToHex(pixel);
  if (eyedropperHsl) eyedropperHsl.textContent = rgbaToHslText(pixel);
  if (eyedropperRgb) eyedropperRgb.textContent = rgbaToRgbText(pixel);
}

function clampColorByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

function averageImageDataRect(data, width, height, left, top, right, bottom) {
  if (!data || width <= 0 || height <= 0) return null;
  const x0 = Math.max(0, Math.min(width - 1, Math.floor(left)));
  const y0 = Math.max(0, Math.min(height - 1, Math.floor(top)));
  const x1 = Math.max(x0, Math.min(width - 1, Math.ceil(right) - 1));
  const y1 = Math.max(y0, Math.min(height - 1, Math.ceil(bottom) - 1));
  let count = 0;
  let alphaSum = 0;
  let redAlphaSum = 0;
  let greenAlphaSum = 0;
  let blueAlphaSum = 0;

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const idx = (y * width + x) * 4;
      const alpha = data[idx + 3];
      count++;
      alphaSum += alpha;
      redAlphaSum += data[idx] * alpha;
      greenAlphaSum += data[idx + 1] * alpha;
      blueAlphaSum += data[idx + 2] * alpha;
    }
  }

  if (!count || alphaSum <= 0) return [0, 0, 0, 0];
  return [
    clampColorByte(redAlphaSum / alphaSum),
    clampColorByte(greenAlphaSum / alphaSum),
    clampColorByte(blueAlphaSum / alphaSum),
    clampColorByte(alphaSum / count),
  ];
}

function sampleCanvasPixel(context, sourceX, sourceY) {
  try {
    const data = context.getImageData(sourceX, sourceY, 1, 1).data;
    return [data[0], data[1], data[2], data[3]];
  } catch (_) {
    return null;
  }
}

function sampleCanvasRect(context, sourceX, sourceY, sourceW, sourceH) {
  try {
    const data = context.getImageData(sourceX, sourceY, sourceW, sourceH).data;
    return averageImageDataRect(data, sourceW, sourceH, 0, 0, sourceW, sourceH);
  } catch (_) {
    return null;
  }
}

function compositePixelOver(source, backdrop) {
  if (!source) return backdrop ? backdrop.slice() : [0, 0, 0, 0];
  if (!backdrop) return source.slice();
  const sourceAlpha = source[3] / 255;
  const backdropAlpha = backdrop[3] / 255;
  const outAlpha = sourceAlpha + backdropAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return [0, 0, 0, 0];
  return [
    clampColorByte((source[0] * sourceAlpha + backdrop[0] * backdropAlpha * (1 - sourceAlpha)) / outAlpha),
    clampColorByte((source[1] * sourceAlpha + backdrop[1] * backdropAlpha * (1 - sourceAlpha)) / outAlpha),
    clampColorByte((source[2] * sourceAlpha + backdrop[2] * backdropAlpha * (1 - sourceAlpha)) / outAlpha),
    clampColorByte(outAlpha * 255),
  ];
}

function pixelsApproximatelyEqual(a, b, tolerance = 1) {
  if (!a || !b) return false;
  return Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance &&
    Math.abs((a[3] ?? 255) - (b[3] ?? 255)) <= tolerance;
}

function parseRgbColor(value, fallback = [0, 0, 0, 255]) {
  const match = String(value || '').match(/rgba?\(([^)]+)\)/);
  if (!match) return fallback;
  const parts = match[1].split(/[,\s/]+/).filter(Boolean);
  const alpha = parts[3] == null ? 1 : Number(parts[3]);
  return [
    Math.max(0, Math.min(255, Math.round(Number(parts[0]) || 0))),
    Math.max(0, Math.min(255, Math.round(Number(parts[1]) || 0))),
    Math.max(0, Math.min(255, Math.round(Number(parts[2]) || 0))),
    Math.max(0, Math.min(255, Math.round((Number.isFinite(alpha) ? alpha : 1) * 255))),
  ];
}

function boardBackgroundPixel() {
  return parseRgbColor(getComputedStyle(canvas).backgroundColor, [224, 224, 227, 255]);
}

function clientToBoardScreenPoint(clientX, clientY) {
  const rect = boardCanvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function screenToBoardWorldPoint(screenPoint) {
  const safeZoom = Math.max(zoom || 1, 0.0001);
  return { x: (screenPoint.x - panX) / safeZoom, y: (screenPoint.y - panY) / safeZoom };
}

function clientToBoardWorldPoint(clientX, clientY) {
  if (typeof toWorld === 'function') return toWorld(clientX, clientY);
  return screenToBoardWorldPoint(clientToBoardScreenPoint(clientX, clientY));
}

function worldPointToImageLocalUnit(obj, worldPoint) {
  if (!obj || obj.type !== 'image' || !worldPoint || obj.w <= 0 || obj.h <= 0) return null;
  const transform = imageTransformFromObject(obj);
  const rotation = ((transform.rotation || 0) * Math.PI) / 180;
  const sideways = isSidewaysRotation(transform.rotation);
  const drawW = sideways ? obj.h : obj.w;
  const drawH = sideways ? obj.w : obj.h;
  if (drawW <= 0 || drawH <= 0) return null;

  const dx = worldPoint.x - (obj.x + obj.w / 2);
  const dy = worldPoint.y - (obj.y + obj.h / 2);
  const unflippedX = transform.flipX ? -dx : dx;
  const unflippedY = transform.flipY ? -dy : dy;
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  const localX = unflippedX * cos - unflippedY * sin;
  const localY = unflippedX * sin + unflippedY * cos;
  const u = (localX + drawW / 2) / drawW;
  const v = (localY + drawH / 2) / drawH;
  const epsilon = 1e-9;
  if (u < -epsilon || u > 1 + epsilon || v < -epsilon || v > 1 + epsilon) return null;
  return {
    u: Math.max(0, Math.min(1, u)),
    v: Math.max(0, Math.min(1, v)),
  };
}

function objectContainsWorldPoint(obj, point) {
  if (!obj || !point) return false;
  if (obj.type === 'image') return !!worldPointToImageLocalUnit(obj, point);
  return point.x >= obj.x && point.x <= obj.x + obj.w && point.y >= obj.y && point.y <= obj.y + obj.h;
}

function topObjectAtWorldPoint(point) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (objectContainsWorldPoint(obj, point)) return obj;
  }
  return null;
}

function imageNaturalSize(source) {
  if (!source) return null;
  if (source.complete === false) return null;
  const width = source.naturalWidth || source.width || 0;
  const height = source.naturalHeight || source.height || 0;
  return width > 0 && height > 0 ? { width, height } : null;
}

function refreshEyedropperAfterSourceReady() {
  if (eyedropperSampling && _eyedropperLastSampleEvent) updateEyedropperSample(_eyedropperLastSampleEvent);
}

function pruneEyedropperSourceCache() {
  const entries = Object.values(eyedropperSampleImageCache);
  if (entries.length <= EYEDROPPER_SOURCE_CACHE_LIMIT) return;
  entries
    .sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0))
    .slice(0, entries.length - EYEDROPPER_SOURCE_CACHE_LIMIT)
    .forEach((entry) => {
      if (entry?.key) delete eyedropperSampleImageCache[entry.key];
    });
}

function cacheEyedropperSampleImage(key, src = '', readySource = null) {
  if (!key) return null;
  const readySize = imageNaturalSize(readySource);
  const sourceToken = src || readySource?.currentSrc || readySource?.src || `source:${key}:${readySize?.width || 0}x${readySize?.height || 0}`;
  const existing = eyedropperSampleImageCache[key];
  if (existing?.sourceToken === sourceToken && (existing.ready || !readySource || existing.img === readySource)) {
    existing.lastUsed = eyedropperSampleImageUseCounter++;
    return existing;
  }

  const entry = {
    key,
    src,
    sourceToken,
    img: readySource || new Image(),
    ownsImage: !readySource,
    ready: !!readySize,
    width: readySize?.width || 0,
    height: readySize?.height || 0,
    canvas: null,
    ctx: null,
    imageData: null,
    tainted: false,
    lastUsed: eyedropperSampleImageUseCounter++,
  };
  if (entry.ownsImage) {
    entry.img.onload = () => {
      const size = imageNaturalSize(entry.img);
      entry.width = size?.width || 0;
      entry.height = size?.height || 0;
      entry.ready = true;
      refreshEyedropperAfterSourceReady();
    };
    entry.img.onerror = () => { entry.error = true; };
    if (src && typeof src === 'string') entry.img.src = src;
  }
  eyedropperSampleImageCache[key] = entry;
  pruneEyedropperSourceCache();
  return entry;
}

function requestEyedropperNativeImageSource(key) {
  if (!key || !isNativeImageRef(imageStore[key])) return;
  ensureImageDataUrl(key)
    .then((dataUrl) => {
      if (!dataUrl) return;
      const entry = cacheEyedropperSampleImage(key, dataUrl);
      if (entry?.ready) refreshEyedropperAfterSourceReady();
    })
    .catch(() => {});
}

function imageElementSourceMatches(img, src) {
  return !!(img && src && ((img.currentSrc || img.src || '') === src));
}

function resolveEyedropperImageSourceEntry(key) {
  if (!key) return null;
  const stored = imageStore[key];
  const cached = imageCache[key];
  const cachedSize = imageNaturalSize(cached);
  if (typeof stored === 'string' && stored) {
    return cacheEyedropperSampleImage(
      key,
      stored,
      cachedSize && imageElementSourceMatches(cached, stored) ? cached : null,
    );
  }

  if (isNativeImageRef(stored)) {
    requestEyedropperNativeImageSource(key);
    return eyedropperSampleImageCache[key] || null;
  }

  if (cachedSize) {
    const src = cached.currentSrc || cached.src || imageAssetUrlCache[key] || '';
    return cacheEyedropperSampleImage(key, src, cached);
  }

  const bitmap = imageBitmapCache[key];
  const bitmapSize = imageNaturalSize(bitmap);
  if (bitmapSize) return cacheEyedropperSampleImage(key, `bitmap:${key}:${bitmapSize.width}x${bitmapSize.height}`, bitmap);

  const src = imageAssetUrlCache[key] || '';
  return src ? cacheEyedropperSampleImage(key, src) : null;
}

function resolveEyedropperImageDrawSourceEntry(obj) {
  const key = obj?.data?.imgKey;
  if (!key) return null;
  const fullSource = imageBitmapCache[key] || imageCache[key] || null;
  if (imageNaturalSize(fullSource)) {
    const selected = typeof selectImageSourceForDraw === 'function'
      ? selectImageSourceForDraw(key, obj, fullSource)
      : { source: fullSource, scale: 1, targetScale: 1 };
    const source = selected?.source || fullSource;
    const size = imageNaturalSize(source);
    if (size) {
      const scale = selected?.scale ?? 1;
      const cacheKey = `${key}:draw:${scale}:${size.width}x${size.height}`;
      return cacheEyedropperSampleImage(cacheKey, `draw:${cacheKey}`, source);
    }
  }
  return resolveEyedropperImageSourceEntry(key);
}

function ensureEyedropperSourceCanvas(entry) {
  if (!entry?.ready || entry.tainted || !entry.width || !entry.height) return false;
  if (entry.canvas && entry.ctx) return true;
  try {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = entry.width;
    sourceCanvas.height = entry.height;
    const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!sourceCtx) return false;
    sourceCtx.setTransform(1, 0, 0, 1, 0, 0);
    sourceCtx.imageSmoothingEnabled = false;
    sourceCtx.clearRect(0, 0, entry.width, entry.height);
    sourceCtx.drawImage(entry.img, 0, 0, entry.width, entry.height);
    entry.canvas = sourceCanvas;
    entry.ctx = sourceCtx;
  } catch (_) {
    entry.tainted = true;
    return false;
  }
  return true;
}

function ensureEyedropperSourceImageData(entry) {
  if (entry?.imageData || entry?.tainted) return !!entry?.imageData;
  if (!ensureEyedropperSourceCanvas(entry)) return false;
  if (entry.width * entry.height * 4 > EYEDROPPER_MAX_IMAGE_DATA_BYTES) return false;
  try {
    entry.imageData = entry.ctx.getImageData(0, 0, entry.width, entry.height).data;
    return true;
  } catch (_) {
    entry.tainted = true;
    entry.imageData = null;
    return false;
  }
}

function sampleEyedropperSourceRect(entry, sourceX, sourceY, footprintW = 1, footprintH = 1) {
  if (!entry?.ready || !entry.width || !entry.height) return null;
  const halfW = Math.max(0.5, Math.min(EYEDROPPER_MAX_SOURCE_AVERAGE_SIDE, footprintW || 1) / 2);
  const halfH = Math.max(0.5, Math.min(EYEDROPPER_MAX_SOURCE_AVERAGE_SIDE, footprintH || 1) / 2);
  const left = Math.max(0, Math.min(entry.width - 1, sourceX - halfW));
  const top = Math.max(0, Math.min(entry.height - 1, sourceY - halfH));
  const right = Math.max(left + 1, Math.min(entry.width, sourceX + halfW));
  const bottom = Math.max(top + 1, Math.min(entry.height, sourceY + halfH));
  entry.lastUsed = eyedropperSampleImageUseCounter++;

  if (ensureEyedropperSourceImageData(entry)) {
    return averageImageDataRect(entry.imageData, entry.width, entry.height, left, top, right, bottom);
  }
  if (!ensureEyedropperSourceCanvas(entry)) return null;
  return sampleCanvasRect(
    entry.ctx,
    Math.floor(left),
    Math.floor(top),
    Math.max(1, Math.ceil(right) - Math.floor(left)),
    Math.max(1, Math.ceil(bottom) - Math.floor(top)),
  );
}

function worldPointToImageSourcePoint(obj, worldPoint, sourceWidth, sourceHeight) {
  const local = worldPointToImageLocalUnit(obj, worldPoint);
  if (!local || sourceWidth <= 0 || sourceHeight <= 0) return null;
  return {
    x: Math.max(0, Math.min(sourceWidth - 1, local.u * sourceWidth)),
    y: Math.max(0, Math.min(sourceHeight - 1, local.v * sourceHeight)),
  };
}

function sourceSampleFootprintForObject(obj, sourceWidth, sourceHeight) {
  const transform = imageTransformFromObject(obj);
  const sideways = isSidewaysRotation(transform.rotation);
  const drawW = Math.max(1, sideways ? obj.h : obj.w);
  const drawH = Math.max(1, sideways ? obj.w : obj.h);
  const dpr = window.devicePixelRatio || 1;
  return {
    width: Math.max(1, sourceWidth / Math.max(1, drawW * zoom * dpr)),
    height: Math.max(1, sourceHeight / Math.max(1, drawH * zoom * dpr)),
  };
}

function sampleImageObjectSourcePixel(obj, worldPoint) {
  const key = obj?.data?.imgKey;
  if (!key) return { object: obj, pixel: null, pending: false, source: 'image-missing-key' };
  if (!worldPointToImageLocalUnit(obj, worldPoint)) return { object: obj, pixel: null, outside: true, source: 'image-outside' };

  const entries = [
    { entry: resolveEyedropperImageDrawSourceEntry(obj), source: 'image-draw-source' },
    { entry: resolveEyedropperImageSourceEntry(key), source: 'image-stored-source' },
  ].filter((item, index, list) => item.entry && list.findIndex((other) => other.entry === item.entry) === index);
  let pending = false;
  let sawUnreadable = false;

  for (const item of entries) {
    const entry = item.entry;
    if (!entry?.ready || !entry.width || !entry.height) {
      pending = true;
      continue;
    }
    const sourcePoint = worldPointToImageSourcePoint(obj, worldPoint, entry.width, entry.height);
    if (!sourcePoint) continue;
    const footprint = sourceSampleFootprintForObject(obj, entry.width, entry.height);
    const pixel = sampleEyedropperSourceRect(entry, sourcePoint.x, sourcePoint.y, footprint.width, footprint.height);
    if (pixel) {
      return {
        object: obj,
        pixel,
        source: item.source,
        pending: false,
        sourceX: sourcePoint.x,
        sourceY: sourcePoint.y,
      };
    }
    sawUnreadable = true;
  }

  return {
    object: obj,
    pixel: null,
    source: pending ? 'image-source-pending' : (sawUnreadable ? 'image-source-unreadable' : 'image-missing-source'),
    pending,
  };
}

function sampleBoardModelPoint(clientX, clientY, background = boardBackgroundPixel()) {
  const point = clientToBoardWorldPoint(clientX, clientY);
  const layers = [];
  let topObject = null;
  let pending = false;
  let source = 'board-background';

  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!objectContainsWorldPoint(obj, point)) continue;
    if (!topObject) topObject = obj;
    if (obj.type !== 'image') {
      source = source === 'board-background' ? 'rendered-fallback' : source;
      continue;
    }
    const sample = sampleImageObjectSourcePixel(obj, point);
    if (sample.pending) pending = true;
    if (!sample.pixel) continue;
    layers.push(sample.pixel);
    source = 'model-composite';
    if (sample.pixel[3] >= 255) break;
  }

  let pixel = background.slice();
  for (let i = layers.length - 1; i >= 0; i--) {
    pixel = compositePixelOver(layers[i], pixel);
  }
  return { object: topObject, pixel, pending, source };
}

function fillEyedropperPreviewCell(gridX, gridY, sourceSize, drawSize, pixel) {
  eyedropperCtx.fillStyle = rgbaToCss(pixel);
  eyedropperCtx.fillRect(
    Math.floor(gridX * drawSize / sourceSize),
    Math.floor(gridY * drawSize / sourceSize),
    Math.ceil((gridX + 1) * drawSize / sourceSize) - Math.floor(gridX * drawSize / sourceSize),
    Math.ceil((gridY + 1) * drawSize / sourceSize) - Math.floor(gridY * drawSize / sourceSize),
  );
}

function drawEyedropperSampleDot(drawSize) {
  const centerIndex = EYEDROPPER_RADIUS_CSS;
  const cellX = Math.floor(centerIndex * drawSize / EYEDROPPER_GRID_SIZE);
  const cellY = Math.floor(centerIndex * drawSize / EYEDROPPER_GRID_SIZE);
  const cellW = Math.ceil((centerIndex + 1) * drawSize / EYEDROPPER_GRID_SIZE) - cellX;
  const cellH = Math.ceil((centerIndex + 1) * drawSize / EYEDROPPER_GRID_SIZE) - cellY;
  const cx = cellX + cellW / 2;
  const cy = cellY + cellH / 2;
  const radius = 2;

  eyedropperCtx.save();
  eyedropperCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperCtx.beginPath();
  eyedropperCtx.arc(cx, cy, radius + 1, 0, Math.PI * 2);
  eyedropperCtx.fillStyle = 'rgba(0,0,0,0.9)';
  eyedropperCtx.fill();
  eyedropperCtx.beginPath();
  eyedropperCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  eyedropperCtx.fillStyle = 'rgba(255,255,255,0.95)';
  eyedropperCtx.fill();
  eyedropperCtx.restore();
}

function paintEyedropperPixelGridPreview(clientX, clientY, drawSize) {
  const radius = EYEDROPPER_RADIUS_CSS;
  const sourceSize = EYEDROPPER_GRID_SIZE;
  const background = boardBackgroundPixel();
  let centerPixel = null;

  for (let y = 0; y < sourceSize; y++) {
    for (let x = 0; x < sourceSize; x++) {
      const sampleClientX = clientX + x - radius;
      const sampleClientY = clientY + y - radius;
      const modelSample = sampleBoardModelPoint(sampleClientX, sampleClientY, background);
      const pixel = modelSample?.pixel || background;
      fillEyedropperPreviewCell(x, y, sourceSize, drawSize, pixel);
      if (x === radius && y === radius) centerPixel = pixel;
    }
  }
  return centerPixel;
}

function renderedBoardSampleGeometry(clientX, clientY) {
  const rect = boardCanvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || boardCanvas.width <= 0 || boardCanvas.height <= 0) return null;
  const scaleX = boardCanvas.width / Math.max(1, rect.width);
  const scaleY = boardCanvas.height / Math.max(1, rect.height);
  const canvasX = (clientX - rect.left) * scaleX;
  const canvasY = (clientY - rect.top) * scaleY;
  if (canvasX < 0 || canvasY < 0 || canvasX > boardCanvas.width || canvasY > boardCanvas.height) return null;
  const sourceX = Math.max(0, Math.min(boardCanvas.width - 1, Math.floor(canvasX)));
  const sourceY = Math.max(0, Math.min(boardCanvas.height - 1, Math.floor(canvasY)));
  const radiusX = Math.max(1, Math.round(EYEDROPPER_RADIUS_CSS * scaleX));
  const radiusY = Math.max(1, Math.round(EYEDROPPER_RADIUS_CSS * scaleY));
  const sourceSizeX = radiusX * 2 + 1;
  const sourceSizeY = radiusY * 2 + 1;
  const intendedSx = sourceX - radiusX;
  const intendedSy = sourceY - radiusY;
  const sx = Math.max(0, intendedSx);
  const sy = Math.max(0, intendedSy);
  const sw = Math.min(boardCanvas.width - sx, sourceSizeX - (sx - intendedSx));
  const sh = Math.min(boardCanvas.height - sy, sourceSizeY - (sy - intendedSy));
  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh, sourceSizeX, sourceSizeY, radiusX, radiusY, dx: sx - intendedSx, dy: sy - intendedSy };
}

function ensureEyedropperRenderedSampleSize(width, height) {
  if (eyedropperRenderedSampleCanvas.width !== width) eyedropperRenderedSampleCanvas.width = width;
  if (eyedropperRenderedSampleCanvas.height !== height) eyedropperRenderedSampleCanvas.height = height;
}

function drawEyedropperPreviewObject(context, obj) {
  if (obj.type === 'text') {
    context.fillStyle = canvasTextColor();
    context.textBaseline = 'alphabetic';
    const lines = getWrappedLines(obj);
    for (let i = 0; i < lines.length; i++) {
      context.fillText(lines[i].text, obj.x + TEXT_PAD, obj.y + TEXT_PAD + TEXT_BASELINE_Y_OFFSET + i * LINE_H);
    }
    return true;
  }
  if (obj.type === 'image') {
    const key = obj.data?.imgKey;
    const img = imageBitmapCache[key] || imageCache[key] || null;
    if (!isDrawableImageSource(img)) return false;
    try {
      drawImageObj(context, obj, img);
      return true;
    } catch (_) {
      return false;
    }
  }
  return false;
}

function paintZoomedBoardPreview(clientX, clientY, drawSize) {
  if (!eyedropperRenderedSampleCtx) return { painted: false, pixel: null };

  const dpr = window.devicePixelRatio || 1;
  const renderSize = Math.max(1, Math.round(drawSize));
  const renderCssSize = renderSize / dpr;
  const worldPoint = clientToBoardWorldPoint(clientX, clientY);
  const previewZoom = Math.max(zoom || 1, 0.0001) * EYEDROPPER_PREVIEW_ZOOM_SCALE;
  const halfWorld = renderCssSize / (2 * previewZoom);
  const viewportRect = {
    x1: worldPoint.x - halfWorld,
    y1: worldPoint.y - halfWorld,
    x2: worldPoint.x + halfWorld,
    y2: worldPoint.y + halfWorld,
  };

  ensureEyedropperRenderedSampleSize(renderSize, renderSize);
  eyedropperRenderedSampleCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperRenderedSampleCtx.imageSmoothingEnabled = true;
  eyedropperRenderedSampleCtx.imageSmoothingQuality = 'high';
  fillBoardBackground(eyedropperRenderedSampleCtx, renderSize, renderSize);
  eyedropperRenderedSampleCtx.setTransform(
    previewZoom * dpr,
    0,
    0,
    previewZoom * dpr,
    renderSize / 2 - worldPoint.x * previewZoom * dpr,
    renderSize / 2 - worldPoint.y * previewZoom * dpr,
  );
  eyedropperRenderedSampleCtx.font = FONT;
  eyedropperRenderedSampleCtx.textBaseline = 'alphabetic';

  for (const obj of objects) {
    if (!objectIntersectsRect(obj, viewportRect)) continue;
    if (obj.id === editingId) continue;
    drawEyedropperPreviewObject(eyedropperRenderedSampleCtx, obj);
  }
  if (editingId) drawEditingTextOverlay(eyedropperRenderedSampleCtx);

  eyedropperRenderedSampleCtx.setTransform(1, 0, 0, 1, 0, 0);
  const center = Math.floor(renderSize / 2);
  const pixel = sampleCanvasPixel(eyedropperRenderedSampleCtx, center, center);

  try {
    eyedropperCtx.imageSmoothingEnabled = false;
    eyedropperCtx.drawImage(
      eyedropperRenderedSampleCanvas,
      0,
      0,
      renderSize,
      renderSize,
      0,
      0,
      renderSize,
      renderSize,
    );
    return { painted: true, pixel };
  } catch (_) {
    return { painted: false, pixel: null };
  }
}

function sampleEyedropperCenterPixel(clientX, clientY, fallback = boardBackgroundPixel()) {
  const modelSample = sampleBoardModelPoint(clientX, clientY, fallback);
  return modelSample?.pixel || fallback;
}

// The rendered backing pixels are the WYSIWYG source of truth: they already
// include compositing, text antialiasing, and any downscaled image variant.
function paintRenderedBoardPreview(clientX, clientY, drawSize) {
  const geometry = renderedBoardSampleGeometry(clientX, clientY);
  if (!geometry || !eyedropperRenderedSampleCtx) return { painted: false, pixel: null };

  ensureEyedropperRenderedSampleSize(geometry.sourceSizeX, geometry.sourceSizeY);
  eyedropperRenderedSampleCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperRenderedSampleCtx.imageSmoothingEnabled = false;
  eyedropperRenderedSampleCtx.clearRect(0, 0, geometry.sourceSizeX, geometry.sourceSizeY);
  eyedropperRenderedSampleCtx.fillStyle = rgbaToCss(boardBackgroundPixel());
  eyedropperRenderedSampleCtx.fillRect(0, 0, geometry.sourceSizeX, geometry.sourceSizeY);

  try {
    eyedropperRenderedSampleCtx.drawImage(
      boardCanvas,
      geometry.sx,
      geometry.sy,
      geometry.sw,
      geometry.sh,
      geometry.dx,
      geometry.dy,
      geometry.sw,
      geometry.sh,
    );
  } catch (_) {
    return { painted: false, pixel: null };
  }

  const pixel = sampleCanvasPixel(eyedropperRenderedSampleCtx, geometry.radiusX, geometry.radiusY);

  try {
    eyedropperCtx.drawImage(
      eyedropperRenderedSampleCanvas,
      0,
      0,
      geometry.sourceSizeX,
      geometry.sourceSizeY,
      0,
      0,
      drawSize,
      drawSize,
    );
    return { painted: true, pixel };
  } catch (_) {
    return { painted: false, pixel };
  }
}

function topImageObjectForSourcePreview(worldPoint) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const obj = objects[i];
    if (!objectContainsWorldPoint(obj, worldPoint)) continue;
    return obj.type === 'image' ? obj : null;
  }
  return null;
}

function paintTransformedSourceImagePreview(clientX, clientY, drawSize, obj, entry) {
  if (!entry?.ready || !entry.width || !entry.height || !ensureEyedropperSourceCanvas(entry)) {
    return { painted: false, pixel: null };
  }

  const sourceSize = EYEDROPPER_GRID_SIZE;
  const radius = EYEDROPPER_RADIUS_CSS;
  const transparent = [0, 0, 0, 0];
  const footprint = sourceSampleFootprintForObject(obj, entry.width, entry.height);
  let centerPixel = null;
  let painted = false;

  for (let y = 0; y < sourceSize; y++) {
    for (let x = 0; x < sourceSize; x++) {
      const sampleClientX = clientX + x - radius;
      const sampleClientY = clientY + y - radius;
      const worldPoint = clientToBoardWorldPoint(sampleClientX, sampleClientY);
      const sourcePoint = worldPointToImageSourcePoint(obj, worldPoint, entry.width, entry.height);
      const pixel = sourcePoint
        ? sampleEyedropperSourceRect(entry, sourcePoint.x, sourcePoint.y, footprint.width, footprint.height)
        : null;
      const previewPixel = pixel || transparent;
      fillEyedropperPreviewCell(x, y, sourceSize, drawSize, previewPixel);
      if (pixel) painted = true;
      if (x === radius && y === radius) centerPixel = previewPixel;
    }
  }

  return { painted, pixel: centerPixel };
}

function paintSourceImagePreview(clientX, clientY, drawSize) {
  if (!eyedropperRenderedSampleCtx) return { painted: false, pixel: null };
  const worldPoint = clientToBoardWorldPoint(clientX, clientY);
  const obj = topImageObjectForSourcePreview(worldPoint);
  const key = obj?.data?.imgKey;
  if (!key) return { painted: false, pixel: null };

  const entry = resolveEyedropperImageSourceEntry(key);
  if (!entry?.ready || !entry.width || !entry.height || !ensureEyedropperSourceCanvas(entry)) {
    return { painted: false, pixel: null };
  }

  if (imageTransformNeedsRendering(imageTransformFromObject(obj))) {
    return paintTransformedSourceImagePreview(clientX, clientY, drawSize, obj, entry);
  }

  const sourcePoint = worldPointToImageSourcePoint(obj, worldPoint, entry.width, entry.height);
  if (!sourcePoint) return { painted: false, pixel: null };

  const sourceSize = EYEDROPPER_GRID_SIZE;
  const radius = EYEDROPPER_RADIUS_CSS;
  const centerX = Math.max(0, Math.min(entry.width - 1, Math.floor(sourcePoint.x)));
  const centerY = Math.max(0, Math.min(entry.height - 1, Math.floor(sourcePoint.y)));
  const intendedSx = centerX - radius;
  const intendedSy = centerY - radius;
  const sx = Math.max(0, intendedSx);
  const sy = Math.max(0, intendedSy);
  const sw = Math.min(entry.width - sx, sourceSize - (sx - intendedSx));
  const sh = Math.min(entry.height - sy, sourceSize - (sy - intendedSy));
  if (sw <= 0 || sh <= 0) return { painted: false, pixel: null };

  ensureEyedropperRenderedSampleSize(sourceSize, sourceSize);
  eyedropperRenderedSampleCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperRenderedSampleCtx.imageSmoothingEnabled = false;
  eyedropperRenderedSampleCtx.clearRect(0, 0, sourceSize, sourceSize);

  try {
    eyedropperRenderedSampleCtx.drawImage(
      entry.canvas,
      sx,
      sy,
      sw,
      sh,
      sx - intendedSx,
      sy - intendedSy,
      sw,
      sh,
    );
  } catch (_) {
    return { painted: false, pixel: null };
  }

  const pixel = sampleCanvasPixel(entry.ctx, centerX, centerY);

  try {
    eyedropperCtx.drawImage(
      eyedropperRenderedSampleCanvas,
      0,
      0,
      sourceSize,
      sourceSize,
      0,
      0,
      drawSize,
      drawSize,
    );
    return { painted: true, pixel };
  } catch (_) {
    return { painted: false, pixel };
  }
}

function commitEyedropperSample(e) {
  if (!eyedropperSampling || !eyedropperLoupe || !eyedropperCanvas || !eyedropperCtx) return;
  _eyedropperLastSampleEvent = { clientX: e.clientX, clientY: e.clientY };

  const dpr = window.devicePixelRatio || 1;
  const previewRect = eyedropperCanvas.getBoundingClientRect();
  const previewSize = previewRect.width || EYEDROPPER_PREVIEW_CSS;
  const drawSize = Math.round(previewSize * dpr);

  if (eyedropperCanvas.width !== drawSize || eyedropperCanvas.height !== drawSize) {
    eyedropperCanvas.width = drawSize;
    eyedropperCanvas.height = drawSize;
  }

  eyedropperCtx.setTransform(1, 0, 0, 1, 0, 0);
  eyedropperCtx.imageSmoothingEnabled = false;
  eyedropperCtx.clearRect(0, 0, drawSize, drawSize);

  const background = boardBackgroundPixel();
  paintZoomedBoardPreview(e.clientX, e.clientY, drawSize);
  const centerPixel = sampleEyedropperCenterPixel(e.clientX, e.clientY, background);
  drawEyedropperSampleDot(drawSize);
  updateEyedropperColorReadout(centerPixel);
  if (!eyedropperLoupe.classList.contains('visible')) eyedropperLoupe.classList.add('visible');
  positionEyedropperLoupe(e.clientX, e.clientY);
}

function updateEyedropperSample(e) {
  if (!eyedropperSampling || !e) return;
  _eyedropperPendingSampleEvent = { clientX: e.clientX, clientY: e.clientY };
  _eyedropperLastSampleEvent = _eyedropperPendingSampleEvent;
  if (_eyedropperSampleRaf) return;
  _eyedropperSampleRaf = requestAnimationFrame(() => {
    _eyedropperSampleRaf = null;
    const sampleEvent = _eyedropperPendingSampleEvent;
    _eyedropperPendingSampleEvent = null;
    if (sampleEvent) commitEyedropperSample(sampleEvent);
  });
}

function cancelPendingEyedropperSample() {
  if (_eyedropperSampleRaf) cancelAnimationFrame(_eyedropperSampleRaf);
  _eyedropperSampleRaf = null;
  _eyedropperPendingSampleEvent = null;
}

function endEyedropperSample(e = null) {
  if (eyedropperSampling && e?.clientX != null && e?.clientY != null) {
    cancelPendingEyedropperSample();
    commitEyedropperSample({ clientX: e.clientX, clientY: e.clientY });
  } else {
    cancelPendingEyedropperSample();
  }
  eyedropperSampling = false;
  _eyedropperLastSampleEvent = null;
}

function isEyedropperSampleVisible() {
  return !!eyedropperLoupe?.classList.contains('visible');
}

function hideEyedropperSample() {
  endEyedropperSample();
  if (eyedropperLoupe) eyedropperLoupe.classList.remove('visible');
}

function isPointInsideVisibleEyedropperLoupe(clientX, clientY) {
  if (!isEyedropperSampleVisible()) return false;
  const rect = eyedropperLoupe.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function isEventInsideVisibleEyedropperLoupe(e) {
  return !!(isEyedropperSampleVisible() && e.target instanceof Node && eyedropperLoupe?.contains(e.target));
}

function showEyedropperCopiedMessage() {
  if (typeof finishPillTransition === 'function') finishPillTransition({ finalMsg: 'Copied' });
}

async function copyEyedropperValue(targetId) {
  const value = document.getElementById(targetId)?.textContent || '';
  if (!value) return;
  try {
    await copyTextToClipboard(value);
    showEyedropperCopiedMessage();
  } catch (_) {}
}

eyedropperLoupe?.addEventListener('pointerdown', (e) => e.stopPropagation());
eyedropperLoupe?.addEventListener('mousedown', (e) => {
  e.preventDefault();
  e.stopPropagation();
});
eyedropperLoupe?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  const target = e.target.closest?.('.eyedropper-copy-row');
  if (target) copyEyedropperValue(target.dataset.copyTarget);
});
eyedropperLoupe?.addEventListener('keydown', (e) => {
  const target = e.target.closest?.('.eyedropper-copy-row');
  if (!target || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  e.stopPropagation();
  copyEyedropperValue(target.dataset.copyTarget);
});

function startEyedropperSample(e) {
  if (!eyedropperEnabled || e.button !== 0) return false;
  if (typeof _spaceDown !== 'undefined' && _spaceDown) return false;
  if (_boardOpening || (isBoardInputBlocked() && !isEyedropperShieldActive())) return false;
  if (isPointInsideVisibleEyedropperLoupe(e.clientX, e.clientY)) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return true;
  }
  if (!(e.target instanceof Node) || !canvas.contains(e.target)) return false;
  if (isEventInsideVisibleContextMenu(e)) return false;
  if (ctxMenu.classList.contains('visible') || objCtxMenu.classList.contains('visible') || ctxActions?.classList.contains('visible')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    hideMenus();
    return true;
  }
  if (!eyedropperSampling && isEyedropperSampleVisible()) {
    e.preventDefault();
    e.stopImmediatePropagation();
    hideEyedropperSample();
    return true;
  }

  e.preventDefault();
  e.stopImmediatePropagation();
  hideMenus();
  eyedropperSampling = true;
  commitEyedropperSample(e);
  beginDocumentDrag({
    move: updateEyedropperSample,
    up: endEyedropperSample,
  });
  return true;
}

canvas.addEventListener('mousedown', startEyedropperSample, true);
