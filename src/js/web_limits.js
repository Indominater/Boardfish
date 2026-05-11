'use strict';

(function initWebLimits(root) {
  const MB = 1024 * 1024;
  const LIMITS = Object.freeze({
    maxObjects: 100,
    maxBoardContentBytes: 512 * MB,
  });

  function isLimitedRuntime() {
    return !(typeof root.hasTauri === 'function' && root.hasTauri());
  }

  function formatBytes(bytes) {
    const mb = Math.round((Number(bytes) || 0) / MB * 10) / 10;
    return `${mb} MB`;
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

  function remainingObjectSlots() {
    if (!isLimitedRuntime()) return Infinity;
    return Math.max(0, LIMITS.maxObjects - objectCount());
  }

  function canAddObjects(count = 1, options = {}) {
    if (!isLimitedRuntime()) return true;
    const nextCount = objectCount() + Math.max(0, Number(count) || 0);
    if (nextCount <= LIMITS.maxObjects) return true;
    return rejectLimit(`Boardfish Web is limited to ${LIMITS.maxObjects} objects`, options);
  }

  function assertObjectCountAllowed(count, label = 'board') {
    if (!isLimitedRuntime()) return true;
    if ((Number(count) || 0) <= LIMITS.maxObjects) return true;
    throw limitError(
      `This ${label} has ${count} objects; Boardfish Web is limited to ${LIMITS.maxObjects} objects.`,
      `Boardfish Web is limited to ${LIMITS.maxObjects} objects`
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

  function imageSourceByteLength(source) {
    if (typeof source === 'string' && source.startsWith('data:')) return dataUrlByteLength(source);
    if (source && typeof source === 'object') return Number(source.bytes || source.byteLength || 0) || 0;
    return 0;
  }

  function referencedImageKeys() {
    if (root.BoardfishBoardDocument?.referencedImageKeys && Array.isArray(root.objects)) {
      return root.BoardfishBoardDocument.referencedImageKeys(root.objects);
    }
    return new Set(Object.keys(root.imageStore || {}));
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
      return JSON.stringify({
        viewport: { panX: root.panX || 0, panY: root.panY || 0, zoom: root.zoom || 1 },
        objects: additionalObjectCount ? objects.concat(new Array(additionalObjectCount).fill({})) : objects,
      }).length + 1024;
    } catch (_) {
      return 1024;
    }
  }

  function projectedContentBytes(additionalImageBytes = 0, additionalObjectCount = 0) {
    return currentImageContentBytes() + Math.max(0, Number(additionalImageBytes) || 0) + currentBoardJsonEstimateBytes(additionalObjectCount);
  }

  function canAcceptAdditionalContentBytes(additionalImageBytes = 0, additionalObjectCount = 0, options = {}) {
    if (!isLimitedRuntime()) return true;
    const projected = projectedContentBytes(additionalImageBytes, additionalObjectCount);
    if (projected <= LIMITS.maxBoardContentBytes) return true;
    return rejectLimit(`Boardfish Web boards are limited to ${formatBytes(LIMITS.maxBoardContentBytes)}`, options);
  }

  function blobFromDataUrl(dataUrl) {
    const match = /^data:([^;,]+);base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!match || !root.BoardfishWebBoardContainer?.dataUrlToBytes) return null;
    return new Blob([root.BoardfishWebBoardContainer.dataUrlToBytes(dataUrl)], { type: match[1] });
  }

  async function validateImageBlob(blob, name = 'image', options = {}) {
    if (!isLimitedRuntime()) return true;
    try {
      const bytes = Number(blob?.size || blob?.byteLength || 0);
      canAcceptAdditionalContentBytes(bytes, 1, { notifyUser: false, throwError: true });
      return { bytes };
    } catch (err) {
      return rejectLimit(err?.boardfishUserMessage || err?.message || String(err), options);
    }
  }

  async function validateImageFile(file, options = {}) {
    return validateImageBlob(file, file?.name || 'image', options);
  }

  async function validateDataUrlImage(dataUrl, name = 'image', options = {}) {
    if (!isLimitedRuntime()) return true;
    const blob = blobFromDataUrl(dataUrl);
    return validateImageBlob(blob, name, options);
  }

  function validateBoardPayload({ objectCount: nextObjectCount = 0, boardJsonBytes = 0, imageEntries = [] } = {}) {
    if (!isLimitedRuntime()) return true;
    assertObjectCountAllowed(nextObjectCount, 'board');
    let imageBytes = 0;
    for (const entry of imageEntries || []) {
      const bytes = Number(entry.byteLength ?? entry.bytes?.length ?? 0) || 0;
      imageBytes += bytes;
    }
    const total = (Number(boardJsonBytes) || 0) + imageBytes;
    if (total > LIMITS.maxBoardContentBytes) {
      throw limitError(
        `This board is ${formatBytes(total)}; Boardfish Web boards are limited to ${formatBytes(LIMITS.maxBoardContentBytes)}.`,
        `Boardfish Web boards are limited to ${formatBytes(LIMITS.maxBoardContentBytes)}`
      );
    }
    return true;
  }

  async function validateOpenedImageEntries(imageEntries = []) {
    if (!isLimitedRuntime()) return true;
    void imageEntries;
    return true;
  }

  function assertBoardDataAllowed(board) {
    if (!isLimitedRuntime()) return true;
    assertObjectCountAllowed(board?.objects?.length || 0, 'board');
    return true;
  }

  const api = Object.freeze({
    LIMITS,
    assertBoardDataAllowed,
    canAcceptAdditionalContentBytes,
    canAddObjects,
    currentImageContentBytes,
    dataUrlByteLength,
    imageSourceByteLength,
    isLimitedRuntime,
    limitError,
    notify,
    remainingObjectSlots,
    validateBoardPayload,
    validateDataUrlImage,
    validateImageBlob,
    validateImageFile,
    validateOpenedImageEntries,
  });

  root.BoardfishWebLimits = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
