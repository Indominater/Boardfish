'use strict';

(function initDomRegistry(root) {
  const REQUIRED_ELEMENTS = Object.freeze({
    canvas: 'canvas',
    boardCanvas: 'board-canvas',
    ctxMenu: 'ctx-menu',
    darkModeMenuBtn: 'ctx-btn-dark-mode',
    fileInput: 'file-input',
    selOverlay: 'sel-overlay',
    multiSelOverlay: 'multi-sel-overlay',
    island: 'island',
    islZoom: 'isl-zoom',
    openingShield: 'opening-shield',
    objCtxMenu: 'obj-ctx-menu',
    copyBtn: 'obj-btn-copy',
    lockBtn: 'obj-btn-lock',
    moveToBackBtn: 'obj-btn-move-to-back',
    deleteBtn: 'obj-btn-delete',
    saveImageBtn: 'obj-btn-save-image',
    saveImagesBtn: 'obj-btn-save-images',
    exportSep: 'obj-sep-export',
    imageActionsSep: 'obj-sep-image-actions',
    layerActionsSep: 'obj-sep-layer-actions',
    deleteSep: 'obj-sep-delete',
    flipHorizontalBtn: 'obj-btn-flip-horizontal',
    flipVerticalBtn: 'obj-btn-flip-vertical',
    rotateBtn: 'obj-btn-rotate',
    rubberBand: 'rubber-band',
    addTextBtn: 'btn-add-text',
    addImageBtn: 'btn-add-image',
    pasteBtn: 'btn-paste',
    resetZoomBtn: 'btn-reset-zoom',
    resetZoomSep: 'ctx-sep-reset-zoom',
    exportAllImageBtn: 'btn-export-all-images',
    exportAllTextBtn: 'btn-export-all-text',
    exportAllSep: 'ctx-sep-export-all',
  });

  function requireElement(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`missing required DOM element #${id}`);
    return el;
  }

  function createDomRegistry() {
    const elements = {};
    for (const [name, id] of Object.entries(REQUIRED_ELEMENTS)) {
      elements[name] = requireElement(id);
    }
    elements.ctx = elements.boardCanvas.getContext('2d');
    if (!elements.ctx) throw new Error('board canvas 2D context is unavailable');
    return Object.freeze(elements);
  }

  root.BoardfishDOM = createDomRegistry();
})(typeof window !== 'undefined' ? window : globalThis);
