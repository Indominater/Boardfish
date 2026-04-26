# Boardfish

Have you ever wanted a fast, non-destructive way to visualize your ideas?

Meet Boardfish: a lightweight, open-source canvas for Windows and macOS. It provides an infinite, freeform space for visual research, moodboards, and snippets—a frictionless place for your thoughts to land.

<img src="src-tauri/icons/image_e4de38.png" alt="Boardfish canvas screenshot" width="900">

## Download

Grab the latest installer from the [Releases](../../releases/latest) page.

- **Windows** — download the `.exe`, run the installer
- **macOS** — download the `.dmg`, drag Boardfish to Applications

> **macOS:** If you see "damaged and can't be opened", run this in Terminal after dragging to Applications:
> ```bash
> xattr -cr /Applications/Boardfish.app
> ```

## Features

- Minimal dark UI with infinite canvas
- Right-click context menu for quick actions
- Add text and images from your clipboard, drag and drop, or the file picker
- Send objects to back, duplicate, copy, paste, cut, delete, undo and redo
- Copy images back to your clipboard at original resolution
- Multi-select with lossless scaling, translation, flipping and exporting
- Export one image, selected images, or all images in one action
- Export all text into a single `.txt` file
- Save everything locally as one portable `.bf` file

## Why Boardfish?

- No layout engine or formatting rules
- Images keep their original quality
- Insert, transform and export images quickly
- Everything stays local

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
