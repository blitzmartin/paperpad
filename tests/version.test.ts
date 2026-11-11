import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { VERSION_FILES, VERSION_FORMAT } from "../scripts/version-files.ts";
import { VERSION } from "../src/version.ts";

test("every file holds the same version (change it with npm run bump)", () => {
  assert.match(VERSION, VERSION_FORMAT);
  for (const { path, pattern } of VERSION_FILES) {
    const text = readFileSync(path, "utf8");
    assert.equal(text.match(new RegExp(pattern.source, pattern.flags + "g"))?.length, 1, `one version in ${path}`);
    assert.equal(text.match(pattern)![2], VERSION, `version in ${path}`);
  }
});
