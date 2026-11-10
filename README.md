# PaperPad

A fast, light and local-first word processor with a modern retro 90s look.
Think WordPad in 1995, with a softer palette, a dark mode and today's file formats.

- **Toolbar for everything:** new, open, save, print, export, clipboard, undo, find and replace, page numbers, paragraph styles, fonts, sizes, bold, italic, underline, strikethrough, text color, highlight, alignment, lists, indent, horizontal line, code block, clear formatting.
- **Code blocks** you can leave with the arrow keys: Down on the last line, Up on the first.
- **Page numbers** at the bottom of each printed page, in PDF, Word and RTF exports. The setting is saved with the document.
- **Word count** in the status bar, with the count for the selection when text is selected.
- **Light and dark mode**, following your system until you choose.
- **Local only:** no accounts, no network, no telemetry. Documents never leave your computer.
- **Native format:** a small standalone `.html` file that any browser can open forever.
- **Opens** PaperPad `.html`, Markdown `.md` and plain `.txt` files.
- **Exports** to PDF (through the print dialog), Word `.docx`, Rich Text `.rtf`, Markdown and plain text.
- **Crash recovery:** unsaved work is kept in the app data folder every 15 seconds.
- **Small:** about 85 KB of gzipped JavaScript at startup, installers of a few MB.

## Download

Grab the installer for your system from the [Releases](../../releases) page:

| System | File |
|---|---|
| Windows 10 and 11 | `PaperPad_x.y.z_x64-setup.exe` or `.msi` |
| macOS 11 or later | `.dmg` (`aarch64` for Apple Silicon, `x64` for Intel) |
| Linux | `.AppImage`, `.deb` or `.rpm` |

The builds are not code signed yet. On Windows choose "More info" then "Run anyway" in SmartScreen. On macOS right-click the app, choose Open, then confirm.

## Build from source

Requirements: [Node.js](https://nodejs.org) 22 or later, [Rust](https://rustup.rs) stable and the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your system (WebView2 is already part of Windows 11; Linux needs the WebKitGTK packages listed there).

```sh
npm install
npm run tauri dev     # run the app with hot reload
npm run tauri build   # build an installer for this machine
```

Other scripts:

```sh
npm run dev           # frontend only, in a browser (open and save are disabled)
npm run typecheck
npm test              # exporter, palette and editor tests (Node's built-in runner)
cd src-tauri && cargo test
```

## Releasing

1. Bump `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`.
2. Commit, then tag and push: `git tag v0.1.0 && git push origin v0.1.0`.
3. GitHub Actions builds every platform and creates a draft release. Review it and press Publish.

You can also run the Release workflow by hand from the Actions tab to get installers as downloadable artifacts without making a release.

## License

PaperPad is source available under the [PolyForm Noncommercial License 1.0.0](LICENSE).
You may use, study, modify and share it for any noncommercial purpose, including personal use and use by charities, schools and public bodies. Commercial use is not permitted.
For a commercial license, contact paperboardlabs@gmail.com.

Copyright (c) 2026 Paper Board Labs.
