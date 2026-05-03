# Boardfish

Boardfish is a fast, local-first infinite canvas for visual research, moodboards, and image references.

<img src="src-tauri/icons/image_e4de38.png" alt="Boardfish canvas screenshot" width="900">

## Download

Grab the latest Windows and macOS installers from the [Releases](https://github.com/Indominater/Boardfish/releases/latest) page.

- **Windows** — download the `.exe`, run the installer
- **macOS** — download the `.dmg`, drag Boardfish to Applications

> **macOS:** If you see "damaged and can't be opened", run this in Terminal after dragging to Applications:
> ```bash
> xattr -cr /Applications/Boardfish.app
> ```

## Features

- **Local-first:** your boards stay on your machine
- **Fast infinite canvas:** pan, zoom, select, multi-select, and arrange massive boards of images and text
- **Flexible input:** add PNG/JPEG images and text from menus, shortcuts, clipboard, file picker, or drag and drop
- **Image tools:** copy, resize, reorder, flip, rotate, export, and sample colors with the eyedropper
- **Dark mode:** saved app preference with matching native window styling
- **Portable projects:** save and reopen local `.bf` files with viewport, image, text, and transform state
- **Simple extraction:** export selected images, all images, or all text when you need the raw material back
- **No account required:** no workspaces, subscriptions, sync setup, or team features to get through

## Basic Use

- Right-click the canvas to add text/images, paste, save/open boards, export content, toggle dark mode, or enable the eyedropper
- Right-click selected objects to copy, cut, duplicate, move to back, transform images, export images, or delete
- Drag selected objects to move them; drag selection handles to resize them
- Double-click a text object to edit it
- Click the zoom pill to return to 100%

## Who It's For

- Artists and illustrators building reference boards
- Designers collecting visual inspiration
- Students organizing screenshots, formulas, and notes
- Writers, game developers, and worldbuilders gathering research
- Anyone who wants a quiet local canvas instead of a browser-based whiteboard

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
| Copy | Cmd+C | Ctrl+C |
| Cut | Cmd+X | Ctrl+X |
| Paste | Cmd+V | Ctrl+V |
| Duplicate selected | Cmd+D | Ctrl+D |
| Undo | Cmd+Z | Ctrl+Z |
| Redo | Cmd+Shift+Z | Ctrl+Shift+Z / Ctrl+Y |
| Delete selected | Backspace / Delete | Backspace / Delete |
| Toggle eyedropper | I | I |
| Pan canvas | Space + drag | Space + drag |
| Pan with wheel / trackpad | Scroll | Scroll |
| Zoom around cursor | Cmd+scroll | Ctrl+scroll |
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
