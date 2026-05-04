'use strict';

(function initDomRegistry(root) {
  const REQUIRED_ELEMENTS = Object.freeze({
    canvas: 'canvas',
    boardCanvas: 'board-canvas',
    ctxMenu: 'ctx-menu',
    ctxActions: 'ctx-actions',
    darkModeMenuBtn: 'ctx-btn-dark-mode',
    eyedropperMenuBtn: 'ctx-btn-eyedropper',
    fileInput: 'file-input',
    selOverlay: 'sel-overlay',
    multiSelOverlay: 'multi-sel-overlay',
    island: 'island',
    islZoom: 'isl-zoom',
    islMeasure: 'isl-measure',
    openingShield: 'opening-shield',
    objCtxMenu: 'obj-ctx-menu',
    copyBtn: 'obj-btn-copy',
    saveImageBtn: 'obj-btn-save-image',
    saveImagesBtn: 'obj-btn-save-images',
    exportSep: 'obj-sep-export',
    imageActionsSep: 'obj-sep-image-actions',
    flipHorizontalBtn: 'obj-btn-flip-horizontal',
    flipVerticalBtn: 'obj-btn-flip-vertical',
    rotateBtn: 'obj-btn-rotate',
    rubberBand: 'rubber-band',
    addTextBtn: 'btn-add-text',
    addImageBtn: 'btn-add-image',
    pasteBtn: 'btn-paste',
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
