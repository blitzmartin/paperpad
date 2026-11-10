// Print and PDF page numbers. The printed page gets a page counter in the
// bottom margin when the document has the setting on. The rule lives in a
// constructed stylesheet (not a <style> element), so the strict CSP still applies.

const RULE = "@page { @bottom-center { content: counter(page); font: 9pt Arial, sans-serif; color: #555; } }";

let sheet: CSSStyleSheet | null = null;
let current: boolean | null = null;

try {
  sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
} catch {
  // Older webviews without constructed stylesheets: page numbers are skipped.
  sheet = null;
}

export function setPrintPageNumbers(on: boolean): void {
  if (!sheet || on === current) return;
  current = on;
  sheet.replaceSync(on ? RULE : "");
}
