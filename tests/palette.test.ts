import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { COLORS, FONTS, HIGHLIGHTS, SIZES } from "../src/editor/palette.ts";

const css = readFileSync(new URL("../src/styles/main.css", import.meta.url), "utf8");

test("every palette entry has a CSS class (run scripts/palette-css.ts if this fails)", () => {
  const missing = [
    ...FONTS.map((f) => `.ff-${f.key} `),
    ...SIZES.map((s) => `.fs-${s} `),
    ...COLORS.flatMap((c) => [`.c-${c.key} `, `.sw-c-${c.key} `]),
    ...HIGHLIGHTS.flatMap((c) => [`.hl-${c.key} `, `.sw-hl-${c.key} `]),
  ].filter((sel) => !css.includes(sel));
  assert.deepEqual(missing, []);
});
