# PaperPad

A fast, light and local-first word processor with a modern retro 90s look.
For Windows, macOS, Linux and Android tablets.

## Why PaperPad

- **Simple.** Opens in an instant, every tool is in the toolbar, nothing to set up.
- **No account, no login, no network.** It never connects to the internet. No telemetry, no tracking.
- **No permissions.** On desktop it touches only the files you pick in the system dialogs. On Android it asks for no permission at all.
- **Your cloud, your choice.** No sync of its own: use Dropbox, Nextcloud, OneDrive, Syncthing or any service you trust. A file changed on another device is never overwritten silently.
- **Files that outlive the app.** One standalone `.html` per document, which any browser opens with its formatting, with or without PaperPad.
- **Hard to lose work.** Version history on every save, crash recovery and autosave.

## Features

- Paragraph styles (Normal, Heading 1 to 3, Quote, Code) set once for the whole document, fonts, sizes, colors, highlight, alignment, lists, indent, horizontal rule, code block.
- Images stored inside the document, scaled down and stripped of metadata.
- Opens `.html`, Markdown and plain text. Exports to PDF, Word, RTF, Markdown and plain text.
- Find and replace, word count, page view with page numbers or one infinite sheet, spell checking.
- Six themes, each light and dark, and a choice of caret feel.
- Fonts that look the same everywhere: Atkinson Hyperlegible, Inter, Literata and JetBrains Mono come with the app.

**On Android tablets:** open, edit and save documents from the tablet or any cloud app in the system file picker, with a touch toolbar above the keyboard, images, autosave always on and the same file format as desktop. Export, print, page view and the desktop settings are not there yet.

The [guide](GUIDE.md) covers sync between devices, conflicts, version history, styles and more.

## Download

From the [Releases](../../releases) page:

| System | File |
|---|---|
| Windows 10 and 11 | `.exe` or `.msi` |
| macOS 11 or later | `.dmg` (`aarch64` for Apple Silicon, `x64` for Intel) |
| Linux | `.AppImage`, `.deb` or `.rpm` |
| Android 7.0 or later | `.apk`, from the first release that includes Android |

The apps are not signed by a store, so the system warns you once:

- **Windows:** "More info", then "Run anyway".
- **macOS:** open it once, then "Open Anyway" in System Settings, Privacy and Security. If it says the app "is damaged", run `xattr -dr com.apple.quarantine /Applications/PaperPad.app` in Terminal.
- **Android:** allow your browser or file manager to install unknown apps. If Play Protect warns, choose "Install anyway".

## Build from source

Needs [Node.js](https://nodejs.org) 22+, [Rust](https://rustup.rs) and the [Tauri prerequisites](https://tauri.app/start/prerequisites/). For Android see [ANDROID.md](ANDROID.md).

```sh
npm install
npm run tauri dev       # desktop app with hot reload
npm run tauri build     # desktop installer
npm run android:dev     # Android app on a connected tablet
npm test                # all tests (cd src-tauri && cargo test for Rust)
```

A shared core (`src/editor`, `src/io`, `src/export`, `src/ui-kit`) and two shells, desktop (`src/app.ts`, `src/ui`) and mobile (`src/mobile`), which never import each other. Releases: see [RELEASE.md](RELEASE.md).

## License

Source available under the [PolyForm Noncommercial License 1.0.0](LICENSE): free for any noncommercial use, including charities, schools and public bodies. For a commercial license, contact paperboardlabs@gmail.com.

The bundled fonts are under the [SIL Open Font License 1.1](https://openfontlicense.org), each with its license in [public/fonts](public/fonts): Atkinson Hyperlegible (Braille Institute of America), Inter (The Inter Project Authors), Literata (The Literata Project Authors), JetBrains Mono (The JetBrains Mono Project Authors).

Copyright © 2026 Paper Board Labs.
