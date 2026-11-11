// Sets the app version in every file that holds it.
//
//   npm run bump 0.2.0
//   npm run bump patch     (0.1.0 -> 0.1.1)
//   npm run bump minor     (0.1.0 -> 0.2.0)
//   npm run bump major     (0.1.0 -> 1.0.0)
//
// Nothing is written unless every file is found and updated.
import { readFileSync, writeFileSync } from "node:fs";
import { VERSION_FILES, VERSION_FORMAT } from "./version-files.ts";

function fail(message: string): never {
  console.error(`bump: ${message}`);
  process.exit(1);
}

const parts = (v: string) => v.split(".").map(Number) as [number, number, number];
const newer = (a: string, b: string) => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
};

const arg = process.argv[2];
if (!arg) fail("give a version (like 0.2.0) or patch, minor or major");

const contents = new Map<string, string>();
const read = (path: string) => {
  if (!contents.has(path)) contents.set(path, readFileSync(path, "utf8"));
  return contents.get(path)!;
};

const current = read("package.json").match(VERSION_FILES[0]!.pattern)?.[2];
if (!current || !VERSION_FORMAT.test(current)) fail(`cannot read the current version from package.json`);

const [major, minor, patch] = parts(current);
const next =
  arg === "major" ? `${major + 1}.0.0` : arg === "minor" ? `${major}.${minor + 1}.0` : arg === "patch" ? `${major}.${minor}.${patch + 1}` : arg.replace(/^v/, "");
if (!VERSION_FORMAT.test(next)) fail(`"${arg}" is not a version like 1.2.3`);
if (!newer(next, current)) fail(`${next} is not newer than the current version ${current}`);

for (const { path, pattern } of VERSION_FILES) {
  const text = read(path);
  const found = text.match(new RegExp(pattern.source, pattern.flags + "g"));
  if (found?.length !== 1) fail(`expected one version in ${path}, found ${found?.length ?? 0}`);
  const old = text.match(pattern)![2];
  if (old !== current) fail(`${path} has version ${old}, but package.json has ${current}. Fix it by hand first.`);
  contents.set(path, text.replace(pattern, `$1${next}$3`));
}

for (const [path, text] of contents) writeFileSync(path, text);
console.log(`Version ${current} -> ${next} in:`);
for (const path of contents.keys()) console.log(`  ${path}`);
console.log(`\nNext: check, commit and push to main, then publish a release tagged v${next} (see RELEASE.md).`);
