# Releasing PaperPad

Installers for every platform are built by `.github/workflows/release.yml`. Checks on every push and pull request run in `.github/workflows/ci.yml`.

## How the release workflow works

- It starts when a release is **published** on GitHub. Saving a release as a draft does nothing, because GitHub never fires workflow events for drafts. Pushing a tag on its own does nothing either.
- The `verify` job checks that the release tag is `v` plus the `version` in `src-tauri/tauri.conf.json` (for example `v0.1.0` for `0.1.0`). If they differ, the run fails in seconds without building.
- Four builds then run: Windows x64, macOS Apple Silicon, macOS Intel and Linux x64. Each one runs the core and desktop typecheck and tests (`typecheck:desktop`, `test:desktop`), then uploads its installers to the release. CI on every push checks everything.
- The title, notes and pre-release flag stay as you set them on GitHub. The workflow only adds files.
- Running the workflow by hand (Actions, Release, Run workflow) builds every platform and attaches the installers to the run as downloadable artifacts. Nothing is published.

## Steps

1. **Bump the version** with one command:

   ```sh
   npm run bump 0.2.0   # or: patch, minor, major
   ```

   It updates every file that holds the version, and `tests/core/version.test.ts` fails if any of them disagree. See [The version](#the-version) below.
2. **Check locally:** `npm run typecheck`, `npm test`, `npx vite build` and `cd src-tauri && cargo test`.
3. **Commit and push to `main`.** Wait for CI to pass.
4. **Optional dry run:** Actions, Release, Run workflow. Download the artifacts and try the installers.
5. **Create the release:** Releases, Draft a new release.
   - In "Choose a tag" type the new tag (for example `v0.2.0`) and create it from `main`. If you already pushed the tag, pick it.
   - Write the title (for example `PaperPad 0.2.0`) and the notes. See [Release notes](#release-notes) below.
   - Tick **Set as a pre-release**, then press **Publish release**.
6. **Wait for the builds** (about 15 to 25 minutes) and check that every platform's files are attached.
7. **Add the Android APK** from your machine, on the commit the tag points to (see [Android](#android) below):

   ```sh
   git checkout main && git pull --tags
   npm run android:release -- --upload
   ```

   Copy the certificate SHA-256 it prints into the release notes.
8. **Make it final:** edit the release, untick pre-release and tick **Set as the latest release**.

Publishing as a pre-release first keeps an empty release from showing as "Latest" while the installers are still building.

## Android

The APK is built and signed locally, never on GitHub: the signing key stays on the release machine. `scripts/android-release.sh` (`npm run android:release`) reads the version from `tauri.conf.json`, refuses to run off `main` or with uncommitted changes, asks for the keystore password (passed to Gradle through the environment, never written to disk) and builds the `arm64` APK. It then checks that the APK is signed with the release key (not the debug one), that it has no `INTERNET` permission and that its `versionName` matches. It writes `dist-android/PaperPad_<version>_android_arm64.apk` and its `.sha256`. With `--upload` it attaches both to the existing release `v<version>` through the [GitHub CLI](https://cli.github.com) (`brew install gh`, then `gh auth login`), and only if `HEAD` is the tagged commit. Without `--upload`, attach the two files by hand in the release page.

### Once: the signing key

```sh
keytool -genkey -v -keystore ~/paperpad-release.jks -keyalg RSA -keysize 4096 -validity 10000 -alias paperpad
```

Then create `src-tauri/gen/android/keystore.properties` (git-ignored) with:

```properties
storeFile=/Users/<you>/paperpad-release.jks
keyAlias=paperpad
```

Keep an offline backup of the keystore and its password. **The key can never change:** an APK signed with another key does not install over the previous one, so users would have to uninstall and lose the app's data. A keystore that leaks (for example committed by mistake) must be treated as compromised.

The `versionCode` is derived by Tauri from the version (`1.1.0` gives `1001000`), so it always grows with `npm run bump`.

## The version

`npm run bump` (in `scripts/bump.ts`) sets the version in:

- `package.json` and `package-lock.json`
- `src-tauri/tauri.conf.json` (the one the release workflow checks against the tag)
- `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`
- `src/version.ts`, which the About dialog and saved files read

It takes the exact version or the part to raise. It never looks at the commits: which part changes is your choice, following [semantic versioning](https://semver.org). From `1.1.0`:

| Command | Result | When to use it |
| --- | --- | --- |
| `npm run bump patch` | `1.1.1` | Bug fixes only, nothing new for the user |
| `npm run bump minor` | `1.2.0` | New features that keep working with files and settings from earlier versions |
| `npm run bump major` | `2.0.0` | Changes that break compatibility, for example a file format older versions cannot open |
| `npm run bump 1.1.1` | `1.1.1` | The exact version given (a leading `v` is allowed) |

Raising a part resets the ones after it to `0`. It only accepts plain `x.y.z` versions newer than the current one, because Windows installers reject suffixes like `-beta`. If any file cannot be found or holds a different version, it writes nothing and says which file to fix.

Do not edit the version by hand. To add a file that holds it, add it to `scripts/version-files.ts`.

## If something goes wrong

- **Tag and version differ:** delete the release and the tag, fix the version or the tag and start again.
- **One platform fails:** fix the cause on `main`, then delete the release and its tag and start again. Re-running only the failed job can work, but it may fail if some of that platform's files were already uploaded. Deleting the release also deletes the APK: upload it again.
- **The release job cannot write to the release:** on GitHub, open Settings, Actions, General, Workflow permissions and select "Read and write permissions".

## Expected files

| System | Files |
|---|---|
| Windows 10 and 11 | `-setup.exe` (recommended) and `.msi` |
| macOS 11 or later | `.dmg` for `aarch64` (Apple Silicon) and `x64` (Intel) |
| Linux | `.AppImage`, `.deb` and `.rpm` |
| Android 7.0 or later | `_android_arm64.apk` and its `.sha256` (uploaded by hand, see [Android](#android)) |

## Release notes

Keep them short. People open the page to pick a file, so lead with what is new, then how to download and open the app. Link to the README for the features and to GUIDE.md for how they work, instead of copying them.

Template:

```markdown
One or two lines on what this release is about.

## What's new

- ...

See the [README](https://github.com/blitzmartin/paperpad#readme) for the features and the [guide](https://github.com/blitzmartin/paperpad/blob/main/GUIDE.md) for how they work.

## Download

| System | File |
|---|---|
| Windows 10 and 11 | `-setup.exe` (recommended) or `.msi` |
| macOS 11 or later | `.dmg`: `aarch64` for Apple Silicon (M1 and later), `x64` for Intel |
| Linux | `.AppImage`, `.deb` or `.rpm` |
| Android 7.0 or later (tablets) | `_android_arm64.apk` |

The APK is signed with this certificate (SHA-256), check it with `apksigner verify --print-certs`:

```
<certificate SHA-256 printed by npm run android:release>
```

## First launch

These builds are not code signed yet, so your system warns you the first time you open PaperPad.

- **Windows:** in SmartScreen, choose "More info" then "Run anyway".
- **macOS:** drag PaperPad to Applications and try to open it once. Then open System Settings, Privacy and Security, scroll down and choose "Open Anyway". If macOS says the app "is damaged and can't be opened", run this in Terminal and open it again:

  ```
  xattr -dr com.apple.quarantine /Applications/PaperPad.app
  ```
- **Android:** allow your browser or file manager to install unknown apps. If Play Protect warns, choose "Install anyway". PaperPad asks for no permission.

## License

Free for personal and other noncommercial use under the [PolyForm Noncommercial License 1.0.0](https://github.com/blitzmartin/paperpad/blob/main/LICENSE). For a commercial license, contact paperboardlabs@gmail.com.
```

Drop the First launch section once the builds are code signed.

## Branches

- `main` is always releasable. Releases are only tagged from `main`.
- Work on short branches such as `feat/autosave` or `fix/rtf-quotes`, merge them into `main` through a pull request once CI passes, then delete them.
- No long-lived development branch is needed while one person works on the project.
