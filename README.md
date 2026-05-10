# Boardfish

Boardfish is a fast, lossless infinite canvas for visual ideation. Designed for Windows and macOS, it provides a lightweight environment for visual research, moodboarding, and snippets.

<img src="src-tauri/icons/image_f55a65.png" alt="Boardfish canvas screenshot" width="900">

## Download

Grab the latest Windows and macOS installers from the [Releases](https://github.com/Indominater/Boardfish/releases/latest) page.

- **Windows** — download the `.exe`, run the installer
- **macOS** — download the `.dmg`, drag Boardfish to Applications

> **macOS:** If you see "damaged and can't be opened", run this in Terminal after dragging to Applications:
> ```bash
> xattr -cr /Applications/Boardfish.app
> ```

## Features

- drag/drop or paste PNG/JPEG images and text
- pan/zoom large image-heavy boards
- preserve images losslessly
- save everything locally as a portable `.bf` file
- multi-select, resize, flip, rotate, duplicate, copy/paste
- sample colors with a pinned eyedropper card
- export selected images, all images, or all text
- light/dark mode

## Keyboard Shortcuts

| Action | Mac | Windows |
|--------|-----|---------|
| New board | Cmd+N | Ctrl+N |
| Open board | Cmd+O | Ctrl+O |
| Save | Cmd+S | Ctrl+S |
| Save As | Cmd+Shift+S | Ctrl+Shift+S |
| Add text | Cmd+T | Ctrl+T |
| Add images | Cmd+I | Ctrl+I |
| Select all objects | Cmd+A | Ctrl+A |
| Add/remove object from selection | Cmd+click | Ctrl+click |
| Additive marquee selection | Cmd+drag empty canvas | Ctrl+drag empty canvas |
| Copy | Cmd+C | Ctrl+C |
| Cut | Cmd+X | Ctrl+X |
| Paste | Cmd+V | Ctrl+V |
| Duplicate selected | Cmd+D | Ctrl+D |
| Move selected to back | Cmd+[ | Ctrl+[ |
| Export selected image(s) | Cmd+E | Ctrl+E |
| Undo | Cmd+Z | Ctrl+Z |
| Redo | Cmd+Shift+Z | Ctrl+Shift+Z / Ctrl+Y |
| Delete selected | Backspace / Delete | Backspace / Delete |
| Edit text | Double-click | Double-click |
| Hold eyedropper | Shift | Shift |
| Close pinned eyedropper | Right-click card | Right-click card |
| Pan canvas | Space + drag | Space + drag |
| Pan with wheel / trackpad | Scroll | Scroll |
| Zoom around cursor | Cmd+scroll | Ctrl+scroll |
| Reset zoom to nearest object | Cmd+0 | Ctrl+0 |
| Deselect / exit edit / close menus | Esc | Esc |
| Quit / close | Cmd+Q / Cmd+W | Ctrl+Q / Ctrl+W |

## Building from Source

**Prerequisites:** [Node.js](https://nodejs.org) 18+ and [Rust](https://rustup.rs)

```bash
git clone https://github.com/Indominater/Boardfish.git
cd Boardfish
npm install
npm run tauri dev
```

To build a release installer:

```bash
npm run tauri build
```

## License

Boardfish is source-available under the [Boardfish Source-Available License](LICENSE).

The source code is available for personal, educational, research, evaluation, and other non-commercial use. Commercial use, resale, redistribution as part of a paid product or service, and business/studio/enterprise use require prior written permission.
