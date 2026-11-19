// Tauri applies a capability without "platforms" to every platform. Each
// capability must name its platforms, and each platform must get exactly one,
// so a desktop permission can never reach the Android build (or the reverse).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const DIR = new URL("../../src-tauri/capabilities/", import.meta.url);
const KNOWN = ["linux", "macOS", "windows", "android", "iOS"];
const DESKTOP = ["linux", "macOS", "windows"];

type Capability = { file: string; platforms: unknown };

const capabilities: Capability[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((file) => ({ file, platforms: JSON.parse(readFileSync(new URL(file, DIR), "utf8")).platforms }));

test("every capability names its platforms", () => {
  assert.ok(capabilities.length > 0, "capabilities found");
  for (const { file, platforms } of capabilities) {
    assert.ok(Array.isArray(platforms) && platforms.length > 0, `${file} has a non-empty "platforms" list`);
    for (const p of platforms as unknown[]) assert.ok(KNOWN.includes(p as string), `${file}: unknown platform ${String(p)}`);
  }
});

test("each platform gets one capability at most, and every desktop system gets one", () => {
  const owner = new Map<string, string>();
  for (const { file, platforms } of capabilities) {
    for (const p of platforms as string[]) {
      assert.ok(!owner.has(p), `${p} is in both ${owner.get(p)} and ${file}`);
      owner.set(p, file);
    }
  }
  for (const p of DESKTOP) assert.ok(owner.has(p), `${p} has a capability`);
});
