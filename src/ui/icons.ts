// Original 20x20 toolbar icons in a chunky 90s style. They use classes
// instead of colors so the theme (light or dark) recolors them through CSS:
//   k  = ink outline    f = ink fill     p = paper fill
//   a  = blue           y = yellow       r = red        g = green
//   s  = silver         w = wood/brown   ka/kg/kr = colored strokes
// Static strings only: nothing here is built from user input.

const rects = (rows: [number, number, number][]) =>
  rows.map(([x, y, w]) => `<rect class="f" x="${x}" y="${y}" width="${w}" height="1.75" rx=".4"/>`).join("");

const lines = (x: number, ys: number[], w: number) => rects(ys.map((y) => [x, y, w]));

export const ICONS = {
  new: `<path class="p k" d="M4.75 2.75h7l3.5 3.5v11h-10.5z"/><path class="k" d="M11.75 2.75v3.5h3.5"/><path class="y k" d="M15.5 .9l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z"/>`,
  open: `<path class="y k" d="M2.75 4.75h5l1.5 1.75h7v9.75H2.75z"/><path class="w k" d="M2.75 16.25l2.5-6.5h12.5l-2.5 6.5z"/>`,
  save: `<path class="a k" d="M3.25 3.25h11l2.5 2.5v11h-13.5z"/><path class="p k" d="M6.25 3.25h6.5v4.25h-6.5z"/><path class="f" d="M10.5 4.25h1.25v2.25H10.5z"/><path class="p k" d="M5.75 10.75h8.5v6h-8.5z"/>${lines(7, [12.4, 14.4], 6)}`,
  print: `<path class="p k" d="M6.25 2.75h7.5v4.5h-7.5z"/><path class="s k" d="M2.75 7.25h14.5v6.5H2.75z"/><circle class="g" cx="14.75" cy="9.5" r=".9"/><path class="p k" d="M5.75 11.75h8.5v5.5h-8.5z"/>${lines(7, [13.4], 6)}`,
  export: `<path class="p k" d="M3.75 2.75h7l3 3v11.5H3.75z"/>${lines(5.5, [8, 10.5, 13], 5)}<path class="kg" d="M10.5 13.5h7m-2.75-2.75 2.75 2.75-2.75 2.75"/>`,
  cut: `<circle class="r k" cx="5.75" cy="14.5" r="2.5"/><circle class="r k" cx="14.25" cy="14.5" r="2.5"/><path class="k" d="M7.5 12.5 14.25 2.75M12.5 12.5 5.75 2.75"/>`,
  copy: `<path class="p k" d="M3.25 2.75h8v10.5h-8z"/><path class="p k" d="M8.75 6.75h8v10.5h-8z"/>${lines(10.5, [9.5, 12, 14.5], 4.5)}`,
  paste: `<path class="w k" d="M3.75 4.25h12.5v13H3.75z"/><path class="p" d="M5.75 7h8.5v8.5h-8.5z"/><path class="s k" d="M7.25 2.75h5.5v3h-5.5z"/>${lines(7.25, [9, 11.5], 5.5)}`,
  undo: `<path class="ka" d="M7.25 5.25 3.75 8.75l3.5 3.5"/><path class="ka" d="M4.25 8.75h7.25a3.75 3.75 0 0 1 0 7.5H8.5"/>`,
  redo: `<path class="ka" d="M12.75 5.25l3.5 3.5-3.5 3.5"/><path class="ka" d="M15.75 8.75H8.5a3.75 3.75 0 0 0 0 7.5h3"/>`,
  find: `<circle class="p k" cx="8.25" cy="8.25" r="5"/><path class="a" d="M5.6 6.4a3 3 0 0 1 2.2-1.6l.3 1.1a1.9 1.9 0 0 0-1.4 1z"/><path class="kt" d="M12 12l5 5"/>`,
  bold: `<text class="t tbo" x="10" y="15.5">B</text>`,
  italic: `<text class="t ti" x="10.5" y="15.5">I</text>`,
  underline: `<text class="t tu" x="10" y="13.5">U</text><rect class="f" x="4.5" y="16" width="11" height="1.75"/>`,
  strike: `<text class="t tu" x="10" y="15.5">S</text><rect class="r" x="3.5" y="9.6" width="13" height="1.75"/>`,
  color: `<text class="t tbo" x="10" y="13.5">A</text>`,
  highlight: `<path class="y k" d="M11.75 2.75l4.5 4.5-6.5 6.5-4.5-4.5z"/><path class="s k" d="M5.25 9.25l4.5 4.5-1.5 1.5H5.75l-2-2z"/>`,
  alignLeft: rects([[3, 4, 14], [3, 7.5, 9], [3, 11, 14], [3, 14.5, 9]]),
  alignCenter: rects([[3, 4, 14], [5.5, 7.5, 9], [3, 11, 14], [5.5, 14.5, 9]]),
  alignRight: rects([[3, 4, 14], [8, 7.5, 9], [3, 11, 14], [8, 14.5, 9]]),
  alignJustify: rects([[3, 4, 14], [3, 7.5, 14], [3, 11, 14], [3, 14.5, 9]]),
  bullets: `<circle class="a" cx="4.5" cy="5" r="1.6"/><circle class="a" cx="4.5" cy="10" r="1.6"/><circle class="a" cx="4.5" cy="15" r="1.6"/>${lines(8, [4.1, 9.1, 14.1], 9)}`,
  numbers: `<text class="t tn" x="4.5" y="7">1</text><text class="t tn" x="4.5" y="12">2</text><text class="t tn" x="4.5" y="17">3</text>${lines(8, [4.1, 9.1, 14.1], 9)}`,
  outdent: `${lines(9, [4, 7.5, 11, 14.5], 8)}<path class="ka" d="M6.25 6.5 3 9.25l3.25 2.75"/>`,
  indent: `${lines(9, [4, 7.5, 11, 14.5], 8)}<path class="ka" d="M3 6.5l3.25 2.75L3 12"/>`,
  rule: `${lines(4, [4.5, 14], 12)}<rect class="f" x="2" y="8.6" width="16" height="2.5" rx=".6"/>`,
  // A page with text and a "#" in its footer: the usual sign for page numbers.
  pageNumbers: `<path class="p k" d="M4.25 1.75h7.5l4 4v12.5H4.25z"/><path class="k" d="M11.75 1.75v4h4"/>${lines(6.25, [4.25], 4)}${lines(6.25, [7.5], 7.5)}<path class="kn" d="M8.9 11.75l-.8 5M11.9 11.75l-.8 5M7.25 13.4h5.5M6.9 15.4h5.5"/>`,
  // A framed picture: sun and green hills.
  image: `<path class="p k" d="M2.75 3.75h14.5v12.5H2.75z"/><circle class="y k" cx="7" cy="7.75" r="1.6"/><path class="g k" d="M2.75 16.25l5-5.5 3 3.25 2.5-2.5 4 4.75z"/>`,
  code: `<path class="p k" d="M2.75 4.25h14.5v11.5H2.75z"/><path class="ka" d="M7.25 7.75 4.75 10l2.5 2.25M12.75 7.75l2.5 2.25-2.5 2.25"/>`,
  clear: `<path class="r k" d="M3.25 12.25l6.5-6.5 5 5-4 4H6.25z"/><path class="p k" d="M3.25 12.25l3-3 5 5-1 1H6.25z"/><rect class="f" x="11" y="16" width="6" height="1.5"/>`,
  sun: `<circle class="y k" cx="10" cy="10" r="3.5"/><path class="k" d="M10 1.75v2.5M10 15.75v2.5M1.75 10h2.5M15.75 10h2.5M4.2 4.2l1.75 1.75M14.05 14.05l1.75 1.75M4.2 15.8l1.75-1.75M14.05 5.95 15.8 4.2"/>`,
  moon: `<path class="s k" d="M12.5 2.5a7.25 7.25 0 1 0 5 12.25A6 6 0 0 1 12.5 2.5z"/><path class="y" d="M15.5 3l.55 1.2 1.2.55-1.2.55-.55 1.2-.55-1.2-1.2-.55 1.2-.55z"/>`,
  caret: `<path class="f" d="M6 8h8l-4 4.5z"/>`,
} as const;

export type IconName = keyof typeof ICONS;

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 20 20");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("ico");
  // Trusted constant markup (see the note at the top of the file).
  svg.innerHTML = ICONS[name];
  return svg;
}
