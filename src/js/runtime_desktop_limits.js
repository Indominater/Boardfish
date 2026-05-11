'use strict';

(function initDesktopWebLimits(root) {
  const LIMITS = Object.freeze({
    maxObjects: Infinity,
    maxBoardContentBytes: Infinity,
  });

  const api = Object.freeze({
    LIMITS,
    assertBoardDataAllowed: () => true,
    canAcceptAdditionalContentBytes: () => true,
    canAddObjects: () => true,
    currentImageContentBytes: () => 0,
    dataUrlByteLength: () => 0,
    imageSourceByteLength: (source) => Number(source?.bytes || source?.byteLength || 0) || 0,
    isLimitedRuntime: () => false,
    limitError: (message) => new Error(message),
    notify(message) {
      if (typeof root.showIslandMsg === 'function') root.showIslandMsg(message, root.long_message ?? 4500);
    },
    remainingObjectSlots: () => Infinity,
    validateBoardPayload: () => true,
    validateDataUrlImage: async () => true,
    validateImageBlob: async () => true,
    validateImageFile: async () => true,
    validateOpenedImageEntries: async () => true,
  });

  root.BoardfishWebLimits = api;
})(typeof window !== 'undefined' ? window : globalThis);
