# Boardfish

A minimal, fast canvas app for Mac and Windows. Drop text and images onto an infinite board, arrange them freely, and save your work as a single file.

## Download

Grab the latest installer from the [Releases](../../releases/latest) page.

- **Mac** — download the `.dmg`, drag Boardfish to Applications
- **Windows** — download the `.msi`, run the installer

> **macOS:** If you see "damaged and can't be opened", run this in Terminal after dragging to Applications:
> ```bash
> xattr -cr /Applications/Boardfish.app
> ```

## Features

- Infinite canvas with smooth pan and zoom
- Add text and images — paste, drag and drop, or use the context menu
- Resize objects with drag handles
- Copy and paste within the app or from external sources
- Undo / redo
- Save boards as a single `.bf` file
- Right-click canvas for quick actions
- Right-click any object to duplicate or delete

## Keyboard Shortcuts

| Action | Mac | Windows |
|--------|-----|---------|
| Save | Cmd+S | Ctrl+S |
| Copy | Cmd+C | Ctrl+C |
| Paste | Cmd+V | Ctrl+V |
| Undo | Cmd+Z | Ctrl+Z |
| Redo | Cmd+Shift+Z | Ctrl+Shift+Z |
| Delete selected | Backspace / Delete | Backspace / Delete |
| Deselect / exit edit | Esc | Esc |

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
