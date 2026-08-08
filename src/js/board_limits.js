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

  function currentContentBytes() {
    const store = root.imageStore || {};
    const referenced = root.BoardfishBoardDocument?.referencedImageKeys && Array.isArray(root.objects)
      ? root.BoardfishBoardDocument.referencedImageKeys(root.objects)
      : Object.keys(store);
    let total = 0;
    for (const key of referenced) total += imageSourceByteLength(store[key]);
    try {
      const objects = Array.isArray(root.objects) ? root.objects : [];
      const cleanObjects = objects.map(({ id, type, x, y, w, h, z, data }) => ({ id, type, x, y, w, h, z, data }));
      const json = JSON.stringify({
        viewport: { panX: root.panX || 0, panY: root.panY || 0, zoom: root.zoom || 1 },
        objects: cleanObjects,
      });
      return total + textByteLength(json) + 1024;
    } catch (_) {
      return total + 1024;
    }
  }

  function projectedContentBytes(additionalImageBytes = 0, additionalObjectCount = 0, baseBytes = currentContentBytes()) {
    const objectCount = Array.isArray(root.objects) ? root.objects.length : 0;
    let additionalObjectBytes = 0;
    for (let i = 0; i < additionalObjectCount; i++) additionalObjectBytes += (objectCount || i) ? 3 : 2;
    return baseBytes + Math.max(0, Number(additionalImageBytes) || 0) + additionalObjectBytes;
  }

  function canAcceptAdditionalContentBytes(additionalImageBytes = 0, additionalObjectCount = 0, options = {}) {
    const projected = projectedContentBytes(additionalImageBytes, additionalObjectCount, options.baseBytes);
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

  async function validateDataUrlImage(dataUrl, options = {}) {
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
    currentContentBytes,
    imageSourceByteLength,
    isLimitedRuntime,
    limitError,
    notify,
    textByteLength,
    validateBoardPayload,
    validateDataUrlImage,
  });

  root.BoardfishWebLimits = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
