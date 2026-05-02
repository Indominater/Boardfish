# Boardfish

Boardfish is a fast, local-first infinite canvas for visual research, moodboards, image references, and text snippets.

It is built for people who collect lots of visual material and want a lightweight place to arrange, inspect, save, and export without hassle.

<img src="src-tauri/icons/image_e4de38.png" alt="Boardfish canvas screenshot" width="900">

## Download

Grab the latest Windows and macOS installers from the [Releases](https://github.com/Indominater/Boardfish/releases/latest) page.

- **Windows** — download the `.exe`, run the installer
- **macOS** — download the `.dmg`, drag Boardfish to Applications

> **macOS:** If you see "damaged and can't be opened", run this in Terminal after dragging to Applications:
> ```bash
> xattr -cr /Applications/Boardfish.app
> ```

## Why Boardfish?

- **Local-first:** your boards stay on your machine
- **Fast with image-heavy boards:** built for large collections of images and text
- **Lossless image workflow:** import, transform, copy, and export without degrading originals
- **No account required:** no workspaces, subscriptions, sync setup, or team features to get through
- **Portable projects:** save everything into a local `.bf` file
- **Simple extraction:** export selected images, all images, or all text when you need the raw material back

Boardfish is not a team whiteboard. It is a private, lightweight canvas for collecting and arranging visual material quickly.

## Who It's For

- Artists and illustrators building reference boards
- Designers collecting visual inspiration
- Students organizing screenshots, formulas, and notes
- Writers, game developers, and worldbuilders gathering research
- Anyone who wants a quiet local canvas instead of a browser-based whiteboard

## Features

- An infinite canvas free from formatting rules
- Lag-free navigation across massive boards supporting 1 GB+ of images and text
- Multi-select, translate, scale, flip, rotate, copy, paste, and duplicate
- Losslessly add images and text via clipboard, drag and drop, or the file picker
- Losslessly copy images back to your clipboard (with flip and rotate applied)
- Export one image, selected images, or all images in a single click
- Export all text into a single `.txt` file
- Save everything locally as a portable `.bf` file

## Keyboard Shortcuts

| Action | Mac | Windows |
|--------|-----|---------|
| New board | Cmd+N | Ctrl+N |
| Open board | Cmd+O | Ctrl+O |
| Save | Cmd+S | Ctrl+S |
| Save As | Cmd+Shift+S | Ctrl+Shift+S |
| Select all objects | Cmd+A | Ctrl+A |
| Copy | Cmd+C | Ctrl+C |
| Cut | Cmd+X | Ctrl+X |
| Paste | Cmd+V | Ctrl+V |
| Duplicate selected | Cmd+D | Ctrl+D |
| Undo | Cmd+Z | Ctrl+Z |
| Redo | Cmd+Shift+Z | Ctrl+Shift+Z / Ctrl+Y |
| Delete selected | Backspace / Delete | Backspace / Delete |
| Pan canvas | Space + drag | Space + drag |
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
