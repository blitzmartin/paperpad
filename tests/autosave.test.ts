import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_AUTOSAVE, parseAutosave } from "../src/ui/autosave.ts";

test("autosave settings default to off, every 30 seconds when turned on", () => {
  assert.deepEqual(parseAutosave(null), DEFAULT_AUTOSAVE);
  assert.deepEqual(DEFAULT_AUTOSAVE, { on: false, seconds: 30 });
});

test("stored autosave settings keep only known values", () => {
  assert.deepEqual(parseAutosave('{"on":true,"seconds":300}'), { on: true, seconds: 300 });
  assert.deepEqual(parseAutosave('{"on":"no","seconds":7}'), DEFAULT_AUTOSAVE);
  assert.deepEqual(parseAutosave("not json"), DEFAULT_AUTOSAVE);
  assert.deepEqual(parseAutosave("[1,2]"), DEFAULT_AUTOSAVE);
});
