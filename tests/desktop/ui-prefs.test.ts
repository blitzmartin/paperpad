// Settings and labels of the desktop shell (src/ui). Pure data, no DOM.
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyLabel, MOD_LABEL } from "../../src/ui/keys.ts";
import { languageName, parseSpellcheck, storedSpellcheck } from "../../src/ui/spelling.ts";
import { parsePrefs, PRESETS, type PresetId, presetOf } from "../../src/ui/writing-feel.ts";

test("shortcut labels read like menu shortcuts", () => {
  assert.equal(keyLabel("Shift-Mod-x"), `${MOD_LABEL}+Shift+X`);
  assert.equal(keyLabel("Mod-Alt-1"), `${MOD_LABEL}+Alt+1`);
  assert.equal(keyLabel("Mod--"), `${MOD_LABEL}+-`);
  assert.equal(keyLabel("Mod-+"), `${MOD_LABEL}++`);
  assert.equal(keyLabel("F1"), "F1");
});

test("writing feel presets are told apart and stored settings are checked", () => {
  for (const id of Object.keys(PRESETS) as PresetId[]) assert.equal(presetOf(PRESETS[id].prefs), id);
  assert.equal(presetOf({ ...PRESETS.smooth.prefs, shape: "underscore" }), null, "custom");
  assert.deepEqual(parsePrefs(null, false), PRESETS.calm.prefs, "Calm is the default");
  assert.deepEqual(parsePrefs("not json", true), PRESETS.classic.prefs, "reduced motion");
  const stored = parsePrefs(JSON.stringify({ movement: "smoother", blink: "nope", shape: "underscore", smoothScroll: "yes" }), false);
  assert.deepEqual(stored, { ...PRESETS.calm.prefs, movement: "smoother", shape: "underscore" });
});

test("spell checking is off by default and the setting round trips", () => {
  assert.equal(parseSpellcheck(null), false);
  assert.equal(parseSpellcheck("garbage"), false);
  for (const on of [true, false]) assert.equal(parseSpellcheck(storedSpellcheck(on)), on);
});

test("the checked language is shown by name", () => {
  assert.equal(languageName("en-US"), "English (United States)");
  assert.equal(languageName("it"), "Italian");
  assert.equal(languageName("not a tag"), "not a tag");
});
