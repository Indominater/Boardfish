'use strict';

(function initBoardLimits(root) {
  const MB = 1024 * 1024;
  const LIMITS = Object.freeze({
    maxObjects: 100,
    maxBoardContentBytes: 500 * MB,
  });

  function isLimitedRuntime() {
    return true;
  }

  function formatBytes(bytes) {
    const mb = Math.round((Number(bytes) || 0) / MB * 10) / 10;
    return `${mb} MB`;
  }

  function objectLimitMessage() {
    return `Boardfish is limited to ${LIMITS.maxObjects} objects`;
  }

  function boardContentLimitMessage() {
    return `Boardfish boards are limited to ${formatBytes(LIMITS.maxBoardContentBytes)}`;
  }

  function limitError(message, userMessage = '') {
    const err = new Error(message);
    err.boardfishLimit = true;
    if (userMessage) err.boardfishUserMessage = userMessage;
    return err;
  }

  function notify(message) {
    if (typeof root.showIslandMsg === 'function') {
      root.showIslandMsg(message, root.long_message ?? 4500);
      return;
    }
    if (typeof root.alert === 'function') root.alert(message);
  }

  function rejectLimit(message, { notifyUser = true, throwError = false } = {}) {
    if (notifyUser) notify(message);
    if (throwError) throw limitError(message);
    return false;
  }

  function objectCount() {
    return Array.isArray(root.objects) ? root.objects.length : 0;
  }

  function canAddObjects(count = 1, options = {}) {
    const nextCount = objectCount() + Math.max(0, Number(count) || 0);
    if (nextCount <= LIMITS.maxObjects) return true;
    return rejectLimit(objectLimitMessage(), options);
  }

  function assertObjectCountAllowed(count, label = 'board') {
    if ((Number(count) || 0) <= LIMITS.maxObjects) return true;
    throw limitError(
      `This ${label} has ${count} objects; ${objectLimitMessage()}.`,
      objectLimitMessage()
    );
  }

  function dataUrlByteLength(dataUrl) {
    if (root.BoardfishWebBoardContainer?.dataUrlByteLength) {
      return root.BoardfishWebBoardContainer.dataUrlByteLength(dataUrl);
    }
    const match = /^data:[^;,]+;base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!match) return 0;
    const base64 = match[1].replace(/\s/g, '');
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
  }

  let textByteEncoder = null;
  function textByteLength(text = '') {
    const value = String(text ?? '');
    if (typeof TextEncoder === 'function') {
      if (!textByteEncoder) textByteEncoder = new TextEncoder();
      return textByteEncoder.encode(value).length;
    }
    return value.length;
  }

  function imageSourceByteLength(source) {
    if (typeof source === 'string' && source.startsWith('data:')) return dataUrlByteLength(source);
    if (source && typeof source === 'object') return Number(source.bytes || source.byteLength || 0) || 0;
    return 0;
  }

  function textDataForJsonEstimate(data = {}) {
    const content = typeof data.content === 'string' ? data.content : '';
    const result = { content };
    if (Array.isArray(data.lineAlign) && data.lineAlign.length) {
      const lineAlign = new Array(data.lineAlign.length);
      for (let i = 0; i < data.lineAlign.length; i++) lineAlign[i] = data.lineAlign[i];
      result.lineAlign = lineAlign;
    }
    if (Array.isArray(data.scriptRanges) && data.scriptRanges.length) {
      const scriptRanges = [];
      for (const range of data.scriptRanges) {
        const kind = range?.kind === 'sup' || range?.kind === 'sub' ? range.kind : '';
        if (!kind) continue;
        scriptRanges.push({
          start: Math.max(0, Math.trunc(Number(range?.start)) || 0),
          end: Math.max(0, Math.trunc(Number(range?.end)) || 0),
          kind,
        });
      }
      if (scriptRanges.length) result.scriptRanges = scriptRanges;
    }
    return result;
  }

  function imageDataForJsonEstimate(data = {}) {
    return {
      imgKey: typeof data.imgKey === 'string' ? data.imgKey : '',
      flipX: !!data.flipX,
      flipY: !!data.flipY,
      rotation: Number.isFinite(data.rotation) ? data.rotation : 0,
    };
  }

  function objectForJsonEstimate(obj = {}) {
    const type = obj.type === 'image' ? 'image' : 'text';
    return {
      id: typeof obj.id === 'string' ? obj.id : '',
      type,
      x: Number.isFinite(obj.x) ? obj.x : 0,
      y: Number.isFinite(obj.y) ? obj.y : 0,
      w: Number.isFinite(obj.w) ? obj.w : 1,
      h: Number.isFinite(obj.h) ? obj.h : 1,
      z: Number.isFinite(obj.z) ? obj.z : 0,
      data: type === 'image' ? imageDataForJsonEstimate(obj.data) : textDataForJsonEstimate(obj.data),
    };
  }

  function referencedImageKeys() {
    if (root.BoardfishBoardDocument?.referencedImageKeys && Array.isArray(root.objects)) {
      return root.BoardfishBoardDocument.referencedImageKeys(root.objects);
    }
    const keys = new Set();
    const store = root.imageStore || {};
    for (const key in store) {
      if (Object.prototype.hasOwnProperty.call(store, key)) keys.add(key);
    }
    return keys;
  }

  function currentImageContentBytes() {
    const store = root.imageStore || {};
    const referenced = referencedImageKeys();
    let total = 0;
    for (const key of referenced) total += imageSourceByteLength(store[key]);
    return total;
  }

  function currentBoardJsonEstimateBytes(additionalObjectCount = 0) {
    try {
      const objects = Array.isArray(root.objects) ? root.objects : [];
      const cleanObjects = [];
      for (const obj of objects) cleanObjects.push(objectForJsonEstimate(obj));
      for (let i = 0; i < additionalObjectCount; i++) cleanObjects.push({});
      const json = JSON.stringify({
        viewport: { panX: root.panX || 0, panY: root.panY || 0, zoom: root.zoom || 1 },
        objects: cleanObjects,
      });
      return textByteLength(json) + 1024;
    } catch (_) {
      return 1024;
    }
  }

  function projectedContentBytes(additionalImageBytes = 0, additionalObjectCount = 0) {
    return currentImageContentBytes() + Math.max(0, Number(additionalImageBytes) || 0) + currentBoardJsonEstimateBytes(additionalObjectCount);
  }

  function canAcceptAdditionalContentBytes(additionalImageBytes = 0, additionalObjectCount = 0, options = {}) {
    const projected = projectedContentBytes(additionalImageBytes, additionalObjectCount);
    if (projected <= LIMITS.maxBoardContentBytes) return true;
    return rejectLimit(boardContentLimitMessage(), options);
  }

  function validateImageBytes(bytes, options = {}) {
    try {
      const normalizedBytes = Number(bytes || 0);
      canAcceptAdditionalContentBytes(normalizedBytes, 1, { notifyUser: false, throwError: true });
      return { bytes: normalizedBytes };
    } catch (err) {
      return rejectLimit(err?.boardfishUserMessage || err?.message || String(err), options);
    }
  }

  function dataUrlImageBytesForValidation(dataUrl) {
    const text = String(dataUrl || '');
    if (!/^data:[^;,]+;base64,/i.test(text)) return 0;
    return dataUrlByteLength(text);
  }

  async function validateDataUrlImage(dataUrl, name = 'image', options = {}) {
    return validateImageBytes(dataUrlImageBytesForValidation(dataUrl), options);
  }

  function validateBoardPayload({ objectCount: nextObjectCount = 0, boardJsonBytes = 0, imageBytes = null, imageEntries = [] } = {}) {
    assertObjectCountAllowed(nextObjectCount, 'board');
    let totalImageBytes = Number(imageBytes);
    if (!Number.isFinite(totalImageBytes)) {
      totalImageBytes = 0;
      for (const entry of imageEntries || []) {
        const bytes = Number(entry.byteLength ?? entry.bytes?.length ?? 0) || 0;
        totalImageBytes += bytes;
      }
    }
    const total = (Number(boardJsonBytes) || 0) + totalImageBytes;
    if (total > LIMITS.maxBoardContentBytes) {
      throw limitError(
        `This board is ${formatBytes(total)}; ${boardContentLimitMessage()}.`,
        boardContentLimitMessage()
      );
    }
    return true;
  }

  async function validateOpenedImageEntries(imageEntries = []) {
    if (!Array.isArray(imageEntries)) throw new Error('Boardfish image entries metadata is invalid');
    for (const entry of imageEntries) {
      const path = typeof entry?.path === 'string' ? entry.path : '';
      const mime = typeof entry?.mime === 'string' ? entry.mime.toLowerCase() : '';
      const byteLength = Number(entry?.byteLength ?? entry?.bytes?.length ?? entry?.bytes ?? 0);
      if (!path || path.includes('\0')) throw new Error('Boardfish image entry path is invalid');
      if (!/^image\/(?:png|jpe?g|webp|gif)$/.test(mime)) {
        throw new Error(`${path} has unsupported image metadata`);
      }
      if (!Number.isFinite(byteLength) || byteLength < 0) {
        throw new Error(`${path} has invalid image metadata`);
      }
    }
    return true;
  }

  function assertBoardDataAllowed(board) {
    assertObjectCountAllowed(board?.objects?.length || 0, 'board');
    return true;
  }

  const api = Object.freeze({
    LIMITS,
    assertBoardDataAllowed,
    boardContentLimitMessage,
    canAcceptAdditionalContentBytes,
    canAddObjects,
    currentImageContentBytes,
    dataUrlByteLength,
    imageSourceByteLength,
    isLimitedRuntime,
    limitError,
    notify,
    objectLimitMessage,
    textByteLength,
    validateBoardPayload,
    validateDataUrlImage,
    validateOpenedImageEntries,
  });

  root.BoardfishLimits = api;
  root.BoardfishWebLimits = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
