// The spell check setting and the name of the language it checks. Pure, no DOM.
//
// Spelling is checked by the webview's built-in checker (WebView2 on Windows).
// It checks one language: the one the webview was started with, which Tauri
// sets to the Windows display language. The app cannot choose another one.

/** Spell checking is off unless it was turned on. */
export const parseSpellcheck = (raw: string | null): boolean => raw === "on";

export const storedSpellcheck = (on: boolean): string => (on ? "on" : "off");

/**
 * The English name of a language tag, such as "English (United States)" for
 * "en-US" or "Italian" for "it". English because the rest of the UI is.
 */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language", languageDisplay: "standard" }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}
