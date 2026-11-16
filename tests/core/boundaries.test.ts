// The core (editor, file format, export, backend wrappers) is shared by two
// shells: desktop (app.ts, main.ts, ui/) and mobile (mobile/). A shell may use
// the core and itself, never the other shell; the core uses neither. This keeps
// each build free of the other platform's code (see ANDROID.md, section 1).
//
// When a module of one shell is needed by the other, move it to the core
// instead of adding an exception here.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

type Zone = "core" | "desktop" | "mobile";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));

/** Paths relative to src/ that belong to a shell. Everything else is core. */
const SHELLS: Record<Exclude<Zone, "core">, string[]> = {
  desktop: ["app.ts", "main.ts", "ui/"],
  mobile: ["mobile/"],
};

const ALLOWED: Record<Zone, Zone[]> = {
  core: ["core"],
  desktop: ["core", "desktop"],
  mobile: ["core", "mobile"],
};

const zoneOf = (fromSrc: string): Zone => {
  const path = fromSrc.split(sep).join("/");
  for (const [zone, prefixes] of Object.entries(SHELLS) as [Zone, string[]][]) {
    if (prefixes.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p))) return zone;
  }
  return "core";
};

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return e.name.endsWith(".ts") ? [full] : [];
  });

/** Static imports, re-exports, side-effect imports and dynamic imports. */
const IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g;

const relativeImports = (file: string): string[] =>
  [...readFileSync(file, "utf8").matchAll(IMPORT)].map((m) => m[1]!).filter((s) => s.startsWith("."));

test("zones are recognized from the path", () => {
  assert.equal(zoneOf("app.ts"), "desktop");
  assert.equal(zoneOf(join("ui", "menu.ts")), "desktop");
  assert.equal(zoneOf(join("mobile", "main.ts")), "mobile");
  assert.equal(zoneOf(join("editor", "schema.ts")), "core");
  // Only the exact file, not a file whose name starts the same way.
  assert.equal(zoneOf("app.test.ts"), "core");
  assert.equal(zoneOf(join("uikit", "x.ts")), "core");
});

test("a shell never imports the other shell, and the core imports neither", () => {
  const files = sourceFiles(SRC);
  const violations: string[] = [];
  let checked = 0;
  for (const file of files) {
    const from = zoneOf(relative(SRC, file));
    for (const spec of relativeImports(file)) {
      const target = relative(SRC, resolve(dirname(file), spec));
      // Outside src/ (none today): not a shell, so not this test's concern.
      if (target.startsWith("..")) continue;
      checked++;
      const to = zoneOf(target);
      if (!ALLOWED[from].includes(to)) violations.push(`${relative(SRC, file)} (${from}) imports ${spec} (${to})`);
    }
  }
  // Guard against a test that passes because it found nothing.
  assert.ok(files.some((f) => zoneOf(relative(SRC, f)) === "desktop"), "desktop shell found");
  assert.ok(checked > 50, `only ${checked} imports found: is the pattern still right?`);
  assert.deepEqual(violations, []);
});
