// Find and replace. Matches are searched inside each paragraph, so a match
// may span differently formatted text but never crosses a paragraph break.

import type { Node as PMNode } from "prosemirror-model";
import { type EditorState, TextSelection, type Transaction } from "prosemirror-state";

export interface FindOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

export interface Match {
  from: number;
  to: number;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRegExp(query: string, opts: FindOptions): RegExp | null {
  if (!query) return null;
  let src = escapeRegExp(query);
  if (opts.wholeWord) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  return new RegExp(src, opts.matchCase ? "gu" : "giu");
}

export function findAll(doc: PMNode, query: string, opts: FindOptions): Match[] {
  const re = buildRegExp(query, opts);
  if (!re) return [];
  const matches: Match[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // One placeholder character per inline leaf keeps string offsets equal
    // to document positions inside the block.
    const text = node.textBetween(0, node.content.size, undefined, "￼");
    const start = pos + 1;
    for (const m of text.matchAll(re)) {
      if (m[0].length) matches.push({ from: start + m.index!, to: start + m.index! + m[0].length });
    }
    return false;
  });
  return matches;
}

/** Selects the next match after the selection, wrapping to the start. */
export function findNext(state: EditorState, query: string, opts: FindOptions, backwards = false): Transaction | null {
  const all = findAll(state.doc, query, opts);
  if (!all.length) return null;
  const { from, to } = state.selection;
  const hit = backwards
    ? ([...all].reverse().find((m) => m.from < from) ?? all[all.length - 1]!)
    : (all.find((m) => m.from >= to && !(m.from === from && m.to === to)) ?? all[0]!);
  return state.tr.setSelection(TextSelection.create(state.doc, hit.from, hit.to)).scrollIntoView();
}

function selectionMatches(state: EditorState, query: string, opts: FindOptions): boolean {
  const { from, to } = state.selection;
  return findAll(state.doc, query, opts).some((m) => m.from === from && m.to === to);
}

/** Replaces the current match (if selected) and moves to the next one. */
export function replaceOne(state: EditorState, query: string, replacement: string, opts: FindOptions): Transaction | null {
  if (!selectionMatches(state, query, opts)) return findNext(state, query, opts);
  const { from, to } = state.selection;
  const tr = state.tr.insertText(replacement, from, to);
  const after = tr.mapping.map(to);
  tr.setSelection(TextSelection.create(tr.doc, after));
  const next = findAll(tr.doc, query, opts).find((m) => m.from >= after) ?? findAll(tr.doc, query, opts)[0];
  if (next) tr.setSelection(TextSelection.create(tr.doc, next.from, next.to));
  return tr.scrollIntoView();
}

export function replaceAll(state: EditorState, query: string, replacement: string, opts: FindOptions): { tr: Transaction; count: number } | null {
  const all = findAll(state.doc, query, opts);
  if (!all.length) return null;
  const tr = state.tr;
  // Work backwards so earlier positions stay valid.
  for (let i = all.length - 1; i >= 0; i--) tr.insertText(replacement, all[i]!.from, all[i]!.to);
  return { tr, count: all.length };
}
