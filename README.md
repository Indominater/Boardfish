# Boardfish

Boardfish is a fast, lossless infinite canvas for visual ideation. It runs in the browser and provides a lightweight environment for visual research, moodboarding, and snippets.

<img src="docs/readme-assets/boardfish-canvas-screenshot.png" alt="Boardfish canvas screenshot" width="900">

## Use Boardfish

Open the web app in a modern Chromium-based browser:

https://indominater.github.io/Boardfish/

## Features

- drag/drop or paste PNG/JPEG images and text
- smoothly pan/zoom boards with up to 500 MB of images
- preserve images losslessly
- save everything locally as a portable `.bf` file
- multi-select, resize, flip, rotate, duplicate, copy/paste
- export selected image(s)
- light/dark mode

## Keyboard Shortcuts

| Action | Mac | Windows |
|--------|-----|---------|
| New board | N | N |
| Open board | Cmd+O | Ctrl+O |
| Save | Cmd+S | Ctrl+S |
| Save As | Cmd+Shift+S | Ctrl+Shift+S |
| Add text | T | T |
| Add images | Cmd+I | Ctrl+I |
| Select all objects | Cmd+A | Ctrl+A |
| Add/remove object from selection | Cmd+click | Ctrl+click |
| Additive marquee selection | Cmd+drag empty canvas | Ctrl+drag empty canvas |
| Copy | Cmd+C | Ctrl+C |
| Cut | Cmd+X | Ctrl+X |
| Paste | Cmd+V | Ctrl+V |
| Duplicate selected | Cmd+D | Ctrl+D |
| Move selected to back | Cmd+[ | Ctrl+[ |
| Flip selected image(s) | Cmd+F | Ctrl+F |
| Rotate selected image(s) | Cmd+R | Ctrl+R |
| Export selected image(s) | Cmd+E | Ctrl+E |
| Undo | Cmd+Z | Ctrl+Z |
| Redo | Cmd+Shift+Z / Cmd+Y | Ctrl+Shift+Z / Ctrl+Y |
| Delete selected | Backspace / Delete | Backspace / Delete |
| Edit text | Double-click | Double-click |
| Pan canvas | Space + drag | Space + drag |
| Pan with wheel / trackpad | Scroll | Scroll |
| Zoom around cursor | Cmd+scroll | Ctrl+scroll |
| Reset zoom to nearest object | Cmd+0 | Ctrl+0 |
| Deselect / exit edit / close menus | Esc | Esc |

## Building from Source

```bash
git clone https://github.com/Indominater/Boardfish.git
cd Boardfish
npm install
npm run web:dev
```

For a production build, run:

```bash
npm run web:build
```

## License

Boardfish is source-available under the [Boardfish Source-Available License](LICENSE).

The source code is available for personal, educational, research, evaluation, and other non-commercial use. Commercial use, resale, redistribution as part of a paid product or service, and business/studio/enterprise use require prior written permission.
