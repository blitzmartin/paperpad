# Releasing PaperPad

Installers for every platform are built by `.github/workflows/release.yml`. Checks on every push and pull request run in `.github/workflows/ci.yml`.

## How the release workflow works

- It starts when a release is **published** on GitHub. Saving a release as a draft does nothing, because GitHub never fires workflow events for drafts. Pushing a tag on its own does nothing either.
- The `verify` job checks that the release tag is `v` plus the `version` in `src-tauri/tauri.conf.json` (for example `v0.1.0` for `0.1.0`). If they differ, the run fails in seconds without building.
- Four builds then run: Windows x64, macOS Apple Silicon, macOS Intel and Linux x64. Each one runs typecheck and tests, then uploads its installers to the release.
- The title, notes and pre-release flag stay as you set them on GitHub. The workflow only adds files.
- Running the workflow by hand (Actions, Release, Run workflow) builds every platform and attaches the installers to the run as downloadable artifacts. Nothing is published.

## Steps

1. **Bump the version** in all five places:
   - `package.json`
   - `src-tauri/tauri.conf.json` (the one the workflow checks)
   - `src-tauri/Cargo.toml`
   - the About dialog in `src/app.ts`
   - `VERSION` in `src/io/native.ts`
2. **Check locally:** `npm run typecheck`, `npm test`, `npx vite build` and `cd src-tauri && cargo test`.
3. **Commit and push to `main`.** Wait for CI to pass.
4. **Optional dry run:** Actions, Release, Run workflow. Download the artifacts and try the installers.
5. **Create the release:** Releases, Draft a new release.
   - In "Choose a tag" type the new tag (for example `v0.2.0`) and create it from `main`. If you already pushed the tag, pick it.
   - Write the title (for example `PaperPad 0.2.0`) and the notes. See [Release notes](#release-notes) below.
   - Tick **Set as a pre-release**, then press **Publish release**.
6. **Wait for the builds** (about 15 to 25 minutes) and check that every platform's files are attached.
7. **Make it final:** edit the release, untick pre-release and tick **Set as the latest release**.

Publishing as a pre-release first keeps an empty release from showing as "Latest" while the installers are still building.

## If something goes wrong

- **Tag and version differ:** delete the release and the tag, fix the version or the tag and start again.
- **One platform fails:** fix the cause on `main`, then delete the release and its tag and start again. Re-running only the failed job can work, but it may fail if some of that platform's files were already uploaded.
- **The release job cannot write to the release:** on GitHub, open Settings, Actions, General, Workflow permissions and select "Read and write permissions".

## Expected files

| System | Files |
|---|---|
| Windows 10 and 11 | `-setup.exe` (recommended) and `.msi` |
| macOS 11 or later | `.dmg` for `aarch64` (Apple Silicon) and `x64` (Intel) |
| Linux | `.AppImage`, `.deb` and `.rpm` |

## Release notes

Keep them short. People open the page to pick a file, so lead with what is new, then how to download and open the app. Link to the README for the full feature list instead of copying it.

Template:

```markdown
One or two lines on what this release is about.

## What's new

- ...

See the [README](https://github.com/blitzmartin/paperpad#readme) for every feature.

## Download

| System | File |
|---|---|
| Windows 10 and 11 | `-setup.exe` (recommended) or `.msi` |
| macOS 11 or later | `.dmg`: `aarch64` for Apple Silicon (M1 and later), `x64` for Intel |
| Linux | `.AppImage`, `.deb` or `.rpm` |

## First launch

These builds are not code signed yet, so your system warns you the first time you open PaperPad.

- **Windows:** in SmartScreen, choose "More info" then "Run anyway".
- **macOS:** drag PaperPad to Applications and try to open it once. Then open System Settings, Privacy and Security, scroll down and choose "Open Anyway". If macOS says the app "is damaged and can't be opened", run this in Terminal and open it again:

  ```
  xattr -dr com.apple.quarantine /Applications/PaperPad.app
  ```

## License

Free for personal and other noncommercial use under the [PolyForm Noncommercial License 1.0.0](https://github.com/blitzmartin/paperpad/blob/main/LICENSE). For a commercial license, contact paperboardlabs@gmail.com.
```

Drop the First launch section once the builds are code signed.

## Branches

- `main` is always releasable. Releases are only tagged from `main`.
- Work on short branches such as `feat/autosave` or `fix/rtf-quotes`, merge them into `main` through a pull request once CI passes, then delete them.
- No long-lived development branch is needed while one person works on the project.
