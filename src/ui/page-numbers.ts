// Page numbers when printing or saving as PDF from the app. The @page rule
// lives in a constructed stylesheet (not a <style> element), which the
// strict CSP allows. Webviews without constructed stylesheets skip it.

import { PAGE_NUMBER_CSS } from "../io/native.ts";

let sheet: CSSStyleSheet | null = null;
try {
  sheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
} catch {
  sheet = null;
}

let current = false;

export function setPrintPageNumbers(on: boolean): void {
  if (!sheet || on === current) return;
  current = on;
  sheet.replaceSync(on ? PAGE_NUMBER_CSS : "");
}
