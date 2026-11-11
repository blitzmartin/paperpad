// Format > Styles: how each paragraph role and the horizontal rule look in
// this document. A change reaches every paragraph with that role (or every
// rule), including ones written earlier.
// Styles are saved with the document; new documents start from the defaults.

import { COLORS, docFont, FONTS, SIZES } from "../editor/palette.ts";
import { applyStyles } from "../editor/setup.ts";
import {
  AUTO_COLOR,
  DEFAULT_STYLES,
  type DocStyles,
  LINE_HEIGHTS,
  normalizeStyles,
  RULE_LINE_LABELS,
  RULE_LINES,
  RULE_THICKNESSES,
  RULE_WIDTHS,
  type RuleStyle,
  SAME_FONT,
  SOFT_COLOR,
  SPACINGS,
  STYLE_IDS,
  STYLE_LABELS,
  type StyleId,
  type TextStyle,
} from "../editor/styles.ts";
import { h } from "./dom.ts";
import { icon, type IconName } from "./icons.ts";
import { showModal } from "./modal.ts";

export interface StylesResult {
  /** Normal's font, which is the document's font. */
  font: string;
  /** Null while every style is the default and the document stored none. */
  styles: DocStyles | null;
}

/** The tabs of the dialog: the paragraph styles, then the horizontal rule. */
type Tab = StyleId | "rule";
const TABS: readonly Tab[] = [...STYLE_IDS, "rule"];
const TAB_LABELS: Record<Tab, string> = { ...STYLE_LABELS, rule: "Horizontal rule" };

const lineLabel = (n: number) => (n === 1 ? "1 (single)" : n === 2 ? "2 (double)" : String(n));
const copy = (s: DocStyles): DocStyles => JSON.parse(JSON.stringify(s));

/** Opens the dialog for a document's attributes. Resolves null on Cancel or when nothing changed. */
export async function openStylesDialog(attrs: { font?: unknown; styles?: unknown }): Promise<StylesResult | null> {
  const initialFont = docFont(attrs.font).key;
  const initial = normalizeStyles(attrs.styles) ?? copy(DEFAULT_STYLES);
  let font = initialFont;
  const draft = copy(initial);
  let current: Tab = "normal";

  // ---- fields --------------------------------------------------------------

  const field = <T extends string | number>(id: string, options: [T, string][]) => {
    const el = h("select", { class: "field", id: `sty-${id}` });
    for (const [value, text] of options) el.append(h("option", { value: String(value), text }));
    return el;
  };
  const fontField = field("font", []);
  const sizeField = field("size", SIZES.map((n) => [n, `${n} pt`]));
  const colors: [string, string][] = [[AUTO_COLOR, "Automatic"], [SOFT_COLOR, "Soft gray"], ...COLORS.map((c): [string, string] => [c.key, c.label])];
  const colorField = field("color", colors);

  const lineField = field("line", LINE_HEIGHTS.map((n) => [n, lineLabel(n)]));
  const beforeField = field("before", SPACINGS.map((n) => [n, `${n} pt`]));
  const afterField = field("after", SPACINGS.map((n) => [n, `${n} pt`]));
  const bold = h("input", { type: "checkbox", id: "sty-bold" });
  const italic = h("input", { type: "checkbox", id: "sty-italic" });
  const underline = h("input", { type: "checkbox", id: "sty-underline" });

  const ruleColor = field("rule-color", colors);
  const ruleThickness = field("rule-thickness", RULE_THICKNESSES.map((n) => [n, `${n} pt`]));
  const ruleLine = field("rule-line", RULE_LINES.map((l) => [l, RULE_LINE_LABELS[l]]));
  const ruleWidth = field("rule-width", RULE_WIDTHS.map((n) => [n, n === 100 ? "Full width" : `${n}%`]));
  const ruleBefore = field("rule-before", SPACINGS.map((n) => [n, `${n} pt`]));
  const ruleAfter = field("rule-after", SPACINGS.map((n) => [n, `${n} pt`]));

  /** Normal picks the document's font; the others can follow it. */
  const fillFonts = () => {
    const options: [string, string][] = FONTS.map((f) => [f.key, f.label]);
    if (current !== "normal") options.unshift([SAME_FONT, `Same as Normal (${docFont(font).label})`]);
    fontField.replaceChildren(...options.map(([value, text]) => h("option", { value, text, class: value === SAME_FONT ? "" : `ff-${value}` })));
  };

  const show = () => {
    heading.textContent = TAB_LABELS[current];
    tabs.forEach((t, i) => {
      const on = TABS[i] === current;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    textGrid.hidden = current === "rule";
    ruleGrid.hidden = current !== "rule";
    if (current === "rule") {
      const r = draft.rule;
      ruleColor.value = r.color;
      ruleThickness.value = String(r.thickness);
      ruleLine.value = r.line;
      ruleWidth.value = String(r.width);
      ruleBefore.value = String(r.before);
      ruleAfter.value = String(r.after);
      return render();
    }
    const s = draft[current];
    fillFonts();
    fontField.value = current === "normal" ? font : s.font;
    sizeField.value = String(s.size);
    colorField.value = s.color;
    lineField.value = String(s.lineHeight);
    beforeField.value = String(s.before);
    afterField.value = String(s.after);
    bold.checked = s.bold;
    italic.checked = s.italic;
    underline.checked = s.underline;
    render();
  };

  const edit = (change: (s: TextStyle) => void) => {
    if (current === "rule") return;
    change(draft[current]);
    render();
  };
  const editRule = (change: (r: RuleStyle) => void) => {
    change(draft.rule);
    render();
  };
  fontField.addEventListener("change", () => {
    if (current === "normal") {
      font = fontField.value;
      render();
    } else edit((s) => (s.font = fontField.value));
  });
  sizeField.addEventListener("change", () => edit((s) => (s.size = Number(sizeField.value))));
  colorField.addEventListener("change", () => edit((s) => (s.color = colorField.value)));
  lineField.addEventListener("change", () => edit((s) => (s.lineHeight = Number(lineField.value))));
  beforeField.addEventListener("change", () => edit((s) => (s.before = Number(beforeField.value))));
  afterField.addEventListener("change", () => edit((s) => (s.after = Number(afterField.value))));
  bold.addEventListener("change", () => edit((s) => (s.bold = bold.checked)));
  italic.addEventListener("change", () => edit((s) => (s.italic = italic.checked)));
  underline.addEventListener("change", () => edit((s) => (s.underline = underline.checked)));
  ruleColor.addEventListener("change", () => editRule((r) => (r.color = ruleColor.value)));
  ruleThickness.addEventListener("change", () => editRule((r) => (r.thickness = Number(ruleThickness.value))));
  ruleLine.addEventListener("change", () => editRule((r) => (r.line = ruleLine.value as RuleStyle["line"])));
  ruleWidth.addEventListener("change", () => editRule((r) => (r.width = Number(ruleWidth.value))));
  ruleBefore.addEventListener("change", () => editRule((r) => (r.before = Number(ruleBefore.value))));
  ruleAfter.addEventListener("change", () => editRule((r) => (r.after = Number(ruleAfter.value))));

  // ---- style list ------------------------------------------------------------

  const tabs = TABS.map((id) =>
    h("button", { class: "sty-tab", type: "button", role: "tab", id: `sty-tab-${id}`, "aria-controls": "sty-panel", text: TAB_LABELS[id] }),
  );
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => {
      current = TABS[i]!;
      show();
    });
    t.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      const next = (i + step + tabs.length) % tabs.length;
      current = TABS[next]!;
      show();
      tabs[next]!.focus();
    });
  });

  const heading = h("h3", { class: "sty-heading" });
  const resetOne = h("button", { class: "btn", type: "button", text: "Reset this style" });
  resetOne.addEventListener("click", () => {
    if (current === "rule") draft.rule = { ...DEFAULT_STYLES.rule };
    else draft[current] = { ...DEFAULT_STYLES[current] };
    show();
  });
  const resetAll = h("button", { class: "btn", type: "button", text: "Reset all styles" });
  resetAll.addEventListener("click", () => {
    for (const id of STYLE_IDS) draft[id] = { ...DEFAULT_STYLES[id] };
    draft.rule = { ...DEFAULT_STYLES.rule };
    show();
  });

  /** A checkbox with the toolbar's icon instead of a word; the name is its tooltip and accessible label. */
  const emphasis = (box: HTMLInputElement, name: IconName, label: string) => {
    box.setAttribute("aria-label", label);
    return h("label", { class: "opt-choice sty-emphasis", title: label }, box, icon(name));
  };
  const row = (label: string, el: HTMLElement) => [h("label", { for: el.id, text: label }), el];
  const textGrid = h(
    "div",
    { class: "opt-grid" },
    ...row("Font", fontField),
    ...row("Size", sizeField),
    ...row("Color", colorField),
    h("span", { text: "Emphasis" }),
    h(
      "div",
      { class: "sty-checks" },
      emphasis(bold, "bold", "Bold"),
      emphasis(italic, "italic", "Italic"),
      emphasis(underline, "underline", "Underline"),
    ),
    ...row("Line spacing", lineField),
    ...row("Space before", beforeField),
    ...row("Space after", afterField),
  );
  const ruleGrid = h(
    "div",
    { class: "opt-grid" },
    ...row("Color", ruleColor),
    ...row("Thickness", ruleThickness),
    ...row("Line", ruleLine),
    ...row("Width", ruleWidth),
    ...row("Space before", ruleBefore),
    ...row("Space after", ruleAfter),
  );
  const panel = h("div", { class: "sty-panel", id: "sty-panel", role: "tabpanel" }, heading, h("div", { class: "sty-grids" }, textGrid, ruleGrid), h("div", { class: "sty-resets" }, resetOne, resetAll));

  // ---- preview -----------------------------------------------------------------

  const sample: Record<Tab, HTMLElement> = {
    h1: h("h1", { text: "Heading 1" }),
    h2: h("h2", { text: "Heading 2" }),
    normal: h("p", { text: "Normal text, as most of a document is written. Changing a style changes every paragraph with that style." }),
    h3: h("h3", { text: "Heading 3" }),
    quote: h("blockquote", {}, h("p", { text: "A quote stands apart from the text around it." })),
    code: h("pre", { text: "Code keeps   its spacing\nand its line breaks." }),
    rule: h("hr"),
  };
  const preview = h(
    "div",
    { class: "doc sty-preview", "aria-label": "Preview", role: "img" },
    sample.h1,
    sample.normal,
    sample.h2,
    sample.normal.cloneNode(true) as HTMLElement,
    sample.rule,
    sample.h3,
    sample.quote,
    sample.code,
  );

  function render() {
    applyStyles(preview, { font, styles: draft });
    for (const id of TABS) sample[id].classList.toggle("sty-current", id === current);
  }

  const body = h(
    "div",
    { class: "sty-dialog" },
    h("div", { class: "sty-list", role: "tablist", "aria-label": "Styles", "aria-orientation": "vertical" }, ...tabs),
    panel,
    preview,
    h("p", { class: "opt-note sty-note", text: "Styles belong to this document and are saved with it. In headings, quotes and code, the font, size and color come from the style." }),
  );

  show();
  const result = await showModal({
    title: "Styles",
    body,
    buttons: [
      { id: "ok", label: "OK", primary: true },
      { id: "cancel", label: "Cancel" },
    ],
    cancelId: "cancel",
  });
  if (result !== "ok") return null;
  const stylesChanged = JSON.stringify(draft) !== JSON.stringify(initial);
  if (!stylesChanged && font === initialFont) return null;
  // A document keeps no styles until one is changed (see styles.ts).
  return { font, styles: stylesChanged || attrs.styles ? draft : null };
}
