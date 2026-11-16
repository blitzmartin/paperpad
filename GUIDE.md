# PaperPad guide

Details for everyday use. For what PaperPad is and how to install it, see the [README](README.md).

## Using PaperPad on several devices

PaperPad has no sync of its own and never connects to the internet. It works on ordinary files and lets a sync service you already use carry them between devices.

- **Desktop:** make a folder inside your sync app (for example `Dropbox/PaperPad`) and choose it in View, Options, Files or in the welcome window. Open and Save as start there. Do the same on each computer.
- **Android:** install your service's app, then open and save in PaperPad through the system file picker, where the service appears as a location. Tested with Dropbox.

Some services that work (examples, not recommendations: check the provider before you rely on it):

| Service | Windows | macOS | Linux | Android | Good to know |
|---|---|---|---|---|---|
| Dropbox | yes | yes | yes | yes | The free plan is enough for text documents. |
| Nextcloud | yes | yes | yes | yes | Open source. Self hosted or through a provider. |
| Syncthing | yes | yes | yes | community app | Open source and serverless: two devices must be on at the same time. On Android it keeps a real folder on the tablet. |
| OneDrive, Google Drive | yes | yes | no official app | yes | Fine without Linux. |
| iCloud Drive | limited | yes | no | no | Best kept for Apple devices. |

Tips:

- Let the sync app finish before you open the same document on another device, or you open an older version and PaperPad treats the newer one as a conflict.
- On desktop, keep the PaperPad folder available offline if your sync app has "online only" files.
- On Android a cloud app may show a cached copy for a while, so a change made elsewhere can show up late.
- Version history stays on each device. Your documents travel, their history does not.

## Conflicts

Each PaperPad file carries a small random document ID, so its history follows it when you rename or move it. If another device saves a file you have open:

- With no unsaved changes, PaperPad reloads the new version when you come back to it. Your version stays in the version history.
- With unsaved changes, Save asks you to keep both (your version is saved as `Name (conflict 20261114-153000).html`; on Android you choose where) or to replace the other version, which stays in the version history.
- Autosave never decides this on its own: it stops and waits for you to choose Save.

## Saving and history

- **Autosave** (desktop): File, Autosave or View, Options, Saving, from every 10 seconds to every 10 minutes, and when you switch to another window. On Android it is always on: 15 seconds after a change and as soon as you leave the app. It saves PaperPad documents that already have a file. Markdown and text files keep no formatting, so they are saved only when you choose Save.
- **Version history:** every save also keeps a copy named with the date and time (UTC) in PaperPad's own data folder, written before your file is. File, Version history restores one as a change you can undo. Identical saves are not repeated, autosave adds a version at most every 5 minutes and the oldest copies go beyond the number set in View, Options, Files (20, 50 or 100). On Android the copies are kept, but cannot be browsed there yet.
- **Crash recovery:** unsaved work is copied every 15 seconds, also for documents never saved, and offered the next time PaperPad starts.

## Styles and the toolbar

Normal text has two layers of formatting, as in Google Docs and Word:

1. **The Normal style**, set in Format, Styles: the look of every Normal paragraph with nothing set by hand.
2. **Formatting set by hand** from the toolbar, which wins over the style.

- Pressing Enter keeps what you set by hand. After a heading the next paragraph starts again from Normal.
- Changing Normal in Format, Styles changes all Normal text that has no font or size of its own.
- Format, Update Normal to match turns what you set by hand into the style, in one undoable step. Format, Clear formatting removes it from the selection.
- Headings, quotes and code always take their font, size and color from their style, so the toolbar greys these out there. Bold, italic, underline, strikethrough and highlight stay free everywhere.
- An empty line keeps its formatting only while the caret stays on it.

New documents use the default font chosen in View, Options (Trebuchet MS until you choose; Atkinson Hyperlegible on Android).

## Images

PNG, JPEG, GIF, WebP and BMP, from the toolbar, Format, Add image, Ctrl+Shift+G, by pasting or by dropping them on the page. Each image is stored inside the document. Large photos are scaled down to 2000 pixels on the longest side and their metadata is removed. Right-click an image (or use Format) for its size, alignment (left or right with text around, as in Word) and alternative text. Word, RTF and PDF exports include images; Markdown and plain text show the alternative text instead, like `[Image: A cat]`.

## Page view and page numbers

Page view (View menu) shows A4 sheets with the print margins and page numbers from the toolbar, which also appear in print, PDF, Word and RTF. Infinite view is one long sheet without page numbers: a document saved from it loses them. Android has the continuous view only and keeps page numbers in the file.

## Writing feel

| | Classic | Smooth | Calm |
| --- | --- | --- | --- |
| Caret movement | Instant | Glides (60 ms) | Glides slowly (140 ms) |
| When you pause | Blinks | Fades in and out | Stays solid |
| Caret | Thin line | Thin line | Thick line |
| Smooth scrolling | Off | On | On |

The caret never blinks while you type. Calm is the default, or Classic if your system is set to reduce animations. Advanced settings in View, Options.

## Keyboard and mouse

- Right-click in the document for cut, copy, paste and the image tools. Shift+right-click shows the system menu, with the spelling suggestions.
- Spell checking is off until you turn it on in View, Options. It checks the system display language only. On Android, Gboard does it.
- Leave a code block with the arrow keys: Down on its last line, Up on its first. On Android, press Enter twice at its end or tap below it.
- Help, Keyboard shortcuts lists every shortcut.
