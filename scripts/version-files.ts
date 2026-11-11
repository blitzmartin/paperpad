// Every file that holds the app version, with a pattern that finds exactly
// that one spot. Used by scripts/bump.ts to change them together and by
// tests/version.test.ts to check they agree.
//
// Each pattern has three groups: the text before the version, the version
// and the text after it.

export interface VersionFile {
  path: string;
  pattern: RegExp;
}

export const VERSION_FILES: VersionFile[] = [
  { path: "package.json", pattern: /^(\{[^{}]*?\n {2}"version": ")([^"]+)(")/ },
  { path: "package-lock.json", pattern: /^(\{\s*"name": "paperpad",\s*"version": ")([^"]+)(")/ },
  { path: "package-lock.json", pattern: /("": \{\s*"name": "paperpad",\s*"version": ")([^"]+)(")/ },
  { path: "src-tauri/tauri.conf.json", pattern: /^( {2}"version": ")([^"]+)(")/m },
  { path: "src-tauri/Cargo.toml", pattern: /(\[package\]\nname = "paperpad"\nversion = ")([^"]+)(")/ },
  { path: "src-tauri/Cargo.lock", pattern: /(\[\[package\]\]\nname = "paperpad"\nversion = ")([^"]+)(")/ },
  { path: "src/version.ts", pattern: /(export const VERSION = ")([^"]+)(")/ },
];

/** Plain x.y.z only: Windows installers (MSI) reject pre-release suffixes. */
export const VERSION_FORMAT = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
