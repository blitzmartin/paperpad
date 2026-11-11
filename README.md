# PaperPad

A fast, light and local-first word processor with a modern retro 90s look.
Think WordPad in 1995, with a softer palette, a dark mode and today's file formats.

- **Toolbar for everything:** new, open, save, print, export, clipboard, undo, find and replace, page numbers, paragraph styles, fonts, sizes, bold, italic, underline, strikethrough, text color, highlight, alignment, lists, indent, horizontal line, code block, clear formatting.
- **Code blocks** you can leave with the arrow keys: Down on the last line, Up on the first.
- **Page view or infinite view** in the View menu. Page view shows the document as A4 sheets with the same margins as print and the status bar shows which page you are on. Infinite view is one long sheet.
- **Page numbers** from the toolbar in page view: at the bottom of each sheet and on each printed page, in PDF, Word and RTF exports. The setting is saved with the document. Infinite view has no page numbers: switching to it turns them off and a document opened in it loses them the next time it is saved.
- **Word count** in the status bar, with the count for the selection when text is selected.
- **Paragraph styles** in Format, Styles: choose the font, size, color, bold and italic, line spacing and spacing of Normal text, Heading 1 to 3, Quote and Code. A change reaches every paragraph with that style, even ones written earlier. In headings, quotes and code the font, size and color always come from the style, so the toolbar greys them out there and the document stays consistent. Styles are saved with each document. New documents start from the default styles with your default font.
- **Default font** of your choice in View, Options. New documents start with it and it is saved with each document, so a file looks the same on any computer.
- **Writing feel** in View, Options: Classic, Smooth or Calm caret presets (see [Writing feel presets](#writing-feel-presets)), plus advanced settings for caret movement, blink, shape and smooth scrolling.
- **Spell checking** you can turn on and off in View, Options. It checks the Windows display language only, so words in other languages are underlined too.
- **Themes:** Sage, Gray, Sand, Slate, Rose and Lilac, all soft on the eyes, from View, Theme. Each one has a light and a dark mode, which follows your system until you choose.
- **Local only:** no accounts, no network, no telemetry. Documents never leave your computer.
- **Your files outlive the app:** documents are saved as a single standalone `.html` file, an open standard instead of a closed format. Any browser on any system opens it with its formatting intact, today or decades from now, with or without PaperPad. It has no scripts and no external links and it stays readable as plain text, so your writing is never locked in.
- **Opens** PaperPad `.html`, Markdown `.md` and plain `.txt` files.
- **Exports** to PDF (through the print dialog), Word `.docx`, Rich Text `.rtf`, Markdown and plain text.
- **Autosave** you can turn on in File, Autosave or in View, Options, Saving, where you also choose how soon changes are saved: from 10 seconds to 10 minutes. It is off until you turn it on. It saves PaperPad documents once they have a file, and also when you switch to another window. Text and Markdown files are only saved when you choose Save, because they keep no formatting.
- **Crash recovery:** with or without autosave, PaperPad keeps a copy of unsaved work in its own data folder every 15 seconds, including new documents that were never saved. If the app or the computer stops unexpectedly, PaperPad offers to restore that copy the next time it starts. The copy is removed once you save or choose not to keep your changes.
- **Small:** about 85 KB of gzipped JavaScript at startup, installers of a few MB.

## Writing feel presets

| | Classic | Smooth | Calm |
| --- | --- | --- | --- |
| Caret movement | Instant | Glides (60 ms) | Glides slowly (140 ms) |
| When you pause | Blinks | Fades in and out | Stays solid |
| Caret | Thin line | Thin line | Thick line |
| Smooth scrolling | Off | On | On |

The caret never blinks while you type, only after half a second of pause. Smooth is the default. If Windows or your system is set to reduce animations, Classic is the default instead. Any preset can be adjusted under Advanced.

## Download

Grab the installer for your system from the [Releases](../../releases) page:

| System | File |
|---|---|
| Windows 10 and 11 | `PaperPad_x.y.z_x64-setup.exe` or `.msi` |
| macOS 11 or later | `.dmg` (`aarch64` for Apple Silicon, `x64` for Intel) |
| Linux | `.AppImage`, `.deb` or `.rpm` |

The builds are not code signed yet, so the system warns you the first time you open PaperPad.

- **Windows:** choose "More info" then "Run anyway" in SmartScreen.
- **macOS:** drag PaperPad to Applications and try to open it once. Then go to System Settings, Privacy and Security, scroll down and choose "Open Anyway". If macOS says the app "is damaged and can't be opened", it only means it is not signed. Run this in Terminal, then open it again:

  ```sh
  xattr -dr com.apple.quarantine /Applications/PaperPad.app
  ```

  This removes the "downloaded from the internet" flag from PaperPad only. It does not change any security setting on your Mac.

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

Publishing a release on GitHub builds the installers for every platform and attaches them to it. See [RELEASE.md](RELEASE.md) for the steps, the release notes template and the branch workflow.

## License

PaperPad is source available under the [PolyForm Noncommercial License 1.0.0](LICENSE).
You may use, study, modify and share it for any noncommercial purpose, including personal use and use by charities, schools and public bodies. Commercial use is not permitted.
For a commercial license, contact paperboardlabs@gmail.com.

Copyright © 2026 Paper Board Labs.
