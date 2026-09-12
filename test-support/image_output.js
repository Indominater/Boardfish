'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const WebContainer = require('../src/js/web_board_container.js');

const pngBytes = fs.readFileSync(path.join(__dirname, '../src/boardfish-icon-192.png'));

function loadReadableImageSourceBlob({ container = WebContainer, decode = async () => ({ close() {} }) } = {}) {
  const context = vm.createContext({
    Blob,
    BoardfishWebBoardContainer: container,
    createImageBitmap: decode,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/js/image_state.js'), 'utf8'), context);
  return context.readableImageSourceBlob;
}

module.exports = { loadReadableImageSourceBlob, pngBytes };
