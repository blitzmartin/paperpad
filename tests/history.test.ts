import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HISTORY_KEEP, parseHistoryKeep, sizeLabel } from "../src/ui/history.ts";

test("version history keeps 50 versions unless another known number is stored", () => {
  assert.equal(DEFAULT_HISTORY_KEEP, 50);
  assert.equal(parseHistoryKeep(null), 50);
  assert.equal(parseHistoryKeep("100"), 100);
  assert.equal(parseHistoryKeep("20"), 20);
  assert.equal(parseHistoryKeep("7"), 50);
  assert.equal(parseHistoryKeep("lots"), 50);
});

test("sizes are shown in B, KB and MB", () => {
  assert.equal(sizeLabel(900), "900 B");
  assert.equal(sizeLabel(2048), "2 KB");
  assert.equal(sizeLabel(3 * 1024 * 1024), "3.0 MB");
});
