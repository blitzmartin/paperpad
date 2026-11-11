// Word (.docx) export, built by hand from the Office Open XML spec
// (ECMA-376, WordprocessingML). This file produces the XML parts; Rust
// packs them into a ZIP (src-tauri/src/zip.rs). No docx library needed.
//
// Element order inside w:pPr and w:rPr matters to Word, so the builders
// below emit children in schema order.

import type { Mark, Node as PMNode } from "prosemirror-model";
import { displaySize, EXPORT_COLUMN, isWrapped, parseDataUrl } from "../editor/image.ts";
import { COLORS, findFont, HIGHLIGHTS } from "../editor/palette.ts";
import { AUTO_COLOR, exportColor, type ResolvedStyle, resolveRule, resolveStyles, type RuleStyle } from "../editor/styles.ts";

export interface DocxPart {
  name: string;
  content: string;
  /** The content is base64 (an image); Rust decodes it before zipping. */
  base64?: boolean;
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const INDENT_TWIPS = 720;
const A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main";
const PIC_NS = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const EMU_PER_PX = 9525;

/** Escapes text for XML and drops characters XML 1.0 does not allow. */
export function xmlEscape(s: string): string {
  return s
    .replace(/[^\u0009\u000A\u000D -퟿-�\u{10000}-\u{10FFFF}]/gu, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const hexOf = (list: typeof COLORS, key: string) => list.find((c) => c.key === key)?.hex.slice(1);

// ---- runs ---------------------------------------------------------------------

function runProps(marks: readonly Mark[]): string {
  let fonts = "", b = "", i = "", strike = "", color = "", sz = "", u = "", shd = "";
  for (const m of marks) {
    switch (m.type.name) {
      case "strong": b = "<w:b/>"; break;
      case "em": i = "<w:i/>"; break;
      case "strike": strike = "<w:strike/>"; break;
      case "underline": u = '<w:u w:val="single"/>'; break;
      case "code": fonts = rFonts("Courier New"); break;
      case "font": {
        const f = findFont(m.attrs.key);
        if (f) fonts = rFonts(f.name);
        break;
      }
      case "size": {
        const half = Number(m.attrs.key) * 2;
        sz = `<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`;
        break;
      }
      case "color": {
        const hex = hexOf(COLORS, m.attrs.key);
        if (hex) color = `<w:color w:val="${hex}"/>`;
        break;
      }
      case "highlight": {
        const hex = hexOf(HIGHLIGHTS, m.attrs.key);
        if (hex) shd = `<w:shd w:val="clear" w:color="auto" w:fill="${hex}"/>`;
        break;
      }
    }
  }
  const all = fonts + b + i + strike + color + sz + u + shd;
  return all ? `<w:rPr>${all}</w:rPr>` : "";
}

function rFonts(name: string) {
  const n = xmlEscape(name);
  return `<w:rFonts w:ascii="${n}" w:hAnsi="${n}" w:cs="${n}"/>`;
}

function textRuns(text: string, rPr: string): string {
  // Tabs and newlines are separate elements in WordprocessingML.
  return text
    .split(/(\t|\n)/)
    .map((piece) => {
      if (piece === "\t") return `<w:r>${rPr}<w:tab/></w:r>`;
      if (piece === "\n") return `<w:r>${rPr}<w:br/></w:r>`;
      if (!piece) return "";
      return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(piece)}</w:t></w:r>`;
    })
    .join("");
}

function inline(block: PMNode): string {
  let out = "";
  block.forEach((child) => {
    if (child.isText) out += textRuns(child.text!, runProps(child.marks));
    else if (child.type.name === "hard_break") out += "<w:r><w:br/></w:r>";
  });
  return out;
}

// ---- paragraphs ---------------------------------------------------------------

interface ParaOpts {
  style?: string;
  numId?: number;
  ilvl?: number;
  indent?: number;
  align?: string;
}

const JC: Record<string, string> = { center: "center", right: "right", justify: "both" };

function paragraph(body: string, o: ParaOpts): string {
  let pPr = "";
  if (o.style) pPr += `<w:pStyle w:val="${o.style}"/>`;
  if (o.numId) pPr += `<w:numPr><w:ilvl w:val="${o.ilvl ?? 0}"/><w:numId w:val="${o.numId}"/></w:numPr>`;
  if (o.indent && !o.numId) pPr += `<w:ind w:left="${o.indent * INDENT_TWIPS}"/>`;
  if (o.align && JC[o.align]) pPr += `<w:jc w:val="${JC[o.align]}"/>`;
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ""}${body}</w:p>`;
}

const RULE_VAL: Record<RuleStyle["line"], string> = { solid: "single", dashed: "dashed", dotted: "dotted", double: "double" };
/** Twips of the text column (A4 with 2.54 cm margins). */
const COLUMN_TWIPS = 11906 - 2 * 1440;

/**
 * The horizontal rule: an empty, tiny paragraph with a bottom border in the
 * rule's style. Shorter rules are centered with equal left and right indents.
 */
function ruleParagraph(rule: RuleStyle): string {
  const color = rule.color === AUTO_COLOR ? "auto" : exportColor(rule.color)!.slice(1);
  // Word measures border width in eighths of a point, from 2 to 96.
  const sz = Math.min(96, Math.max(2, Math.round(rule.thickness * 8)));
  const side = Math.round((COLUMN_TWIPS * (100 - rule.width)) / 200);
  return (
    `<w:p><w:pPr><w:pBdr><w:bottom w:val="${RULE_VAL[rule.line]}" w:sz="${sz}" w:space="1" w:color="${color}"/></w:pBdr>` +
    `<w:spacing w:before="${rule.before * 20}" w:after="${rule.after * 20}" w:line="240" w:lineRule="auto"/>` +
    `${side ? `<w:ind w:left="${side}" w:right="${side}"/>` : ""}<w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>`
  );
}

interface ListNum {
  numId: number;
  ordered: boolean;
  start: number;
  ilvl: number;
}

// ---- images -------------------------------------------------------------------

interface MediaFile {
  name: string;
  ext: "png" | "jpeg";
  rid: string;
  base64: string;
}

/** The images of a document. The same image used twice is stored once. */
class Media {
  readonly files: MediaFile[] = [];
  private readonly bySrc = new Map<string, MediaFile>();
  private drawings = 0;

  /**
   * A picture run (DrawingML), sized like in the editor. Inline, or for text
   * around it an anchor on one side with square wrapping.
   */
  drawing(node: PMNode): string {
    const data = parseDataUrl(node.attrs.src);
    if (!data) return "";
    let file = this.bySrc.get(node.attrs.src as string);
    if (!file) {
      const n = this.files.length + 1;
      const ext = data.mime === "image/png" ? "png" : "jpeg";
      file = { name: `image${n}.${ext}`, ext, rid: `rIdImg${n}`, base64: data.base64 };
      this.files.push(file);
      this.bySrc.set(node.attrs.src as string, file);
    }
    const id = ++this.drawings;
    const { w, h } = displaySize(node.attrs as { width: number; height: number; size: string; align: string }, EXPORT_COLUMN.w, EXPORT_COLUMN.h);
    const cx = Math.round(w * EMU_PER_PX);
    const cy = Math.round(h * EMU_PER_PX);
    const pr = `id="${id}" name="Picture ${id}" descr="${xmlEscape(node.attrs.alt as string)}"`;
    const extent = `<wp:extent cx="${cx}" cy="${cy}"/>`;
    const side = node.attrs.align === "wrap-right" ? "right" : "left";
    // 0.3 cm between the image and the text beside it.
    const open = isWrapped(node.attrs.align)
      ? `<wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="0">` +
        `<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>${side}</wp:align></wp:positionH>` +
        `<wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV>${extent}<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapSquare wrapText="bothSides"/>`
      : `<wp:inline distT="0" distB="0" distL="0" distR="0">${extent}`;
    const close = isWrapped(node.attrs.align) ? "</wp:anchor>" : "</wp:inline>";
    return (
      `<w:r><w:drawing>${open}<wp:docPr ${pr}/>` +
      `<wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${A_NS}" noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
      `<a:graphic xmlns:a="${A_NS}"><a:graphicData uri="${PIC_NS}"><pic:pic xmlns:pic="${PIC_NS}">` +
      `<pic:nvPicPr><pic:cNvPr ${pr}/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="${file.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>` +
      `</pic:pic></a:graphicData></a:graphic>${close}</w:drawing></w:r>`
    );
  }
}

function documentBody(doc: PMNode): { body: string; lists: ListNum[]; media: Media } {
  const out: string[] = [];
  const lists: ListNum[] = [];
  const media = new Media();
  const rule = resolveRule(doc.attrs);
  // An image with text around is anchored to the next paragraph, whose text then flows beside it.
  let anchors = "";
  const takeAnchors = () => {
    const a = anchors;
    anchors = "";
    return a;
  };
  /** Before anything that is not a paragraph, waiting anchors get one of their own. */
  const flush = () => {
    if (anchors) out.push(paragraph(takeAnchors(), {}));
  };

  const walk = (node: PMNode, quote: number, list?: { numId: number; ilvl: number }) => {
    const name = node.type.name;
    if (name === "paragraph" || name === "heading") {
      out.push(
        paragraph(takeAnchors() + inline(node), {
          style: name === "heading" ? `Heading${node.attrs.level}` : quote ? "Quote" : undefined,
          numId: list?.numId,
          ilvl: list?.ilvl,
          indent: (node.attrs.indent as number) + quote,
          align: node.attrs.align as string,
        }),
      );
    } else if (name === "code_block") {
      flush();
      out.push(paragraph(textRuns(node.textContent, ""), { style: "Code", indent: quote }));
    } else if (name === "image" && isWrapped(node.attrs.align)) {
      anchors += media.drawing(node);
    } else if (name === "image") {
      flush();
      const indent = quote + (list ? list.ilvl + 1 : 0);
      out.push(paragraph(media.drawing(node), { indent, align: node.attrs.align as string }));
    } else if (name === "horizontal_rule") {
      flush();
      out.push(ruleParagraph(rule));
    } else if (name === "blockquote") {
      node.forEach((c) => walk(c, quote + 1, list));
    } else if (name === "bullet_list" || name === "ordered_list") {
      const ordered = name === "ordered_list";
      const ilvl = list ? Math.min(list.ilvl + 1, 8) : 0;
      // Every list gets its own w:num so numbered lists restart at their start value.
      const numId = lists.length + 1;
      lists.push({ numId, ordered, start: ordered ? (node.attrs.order as number) : 1, ilvl });
      node.forEach((item) => {
        item.forEach((child, _o, i) => {
          if (child.isTextblock && i === 0) walk(child, quote, { numId, ilvl });
          else if (child.isTextblock) out.push(paragraph(takeAnchors() + inline(child), { style: "ListParagraph", indent: ilvl + 1 }));
          else walk(child, quote, { numId, ilvl });
        });
      });
    } else {
      node.forEach((c) => walk(c, quote, list));
    }
  };

  doc.forEach((n) => walk(n, 0));
  flush();
  if (!out.length) out.push("<w:p/>");
  return { body: out.join("\n"), lists, media };
}

// ---- static parts ---------------------------------------------------------------

function numberingXml(lists: ListNum[]): string {
  const levels = (ordered: boolean) =>
    Array.from({ length: 9 }, (_, l) => {
      // Decimal at every level, matching how the editor numbers nested lists.
      const fmt = ordered ? "decimal" : "bullet";
      const text = ordered ? `%${l + 1}.` : ["•", "◦", "▪"][l % 3];
      const left = INDENT_TWIPS * (l + 1);
      return `<w:lvl w:ilvl="${l}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${left}" w:hanging="360"/></w:pPr></w:lvl>`;
    }).join("");
  const abstract =
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>`;
  const nums = lists
    .map((l) => {
      const override = l.ordered ? `<w:lvlOverride w:ilvl="${l.ilvl}"><w:startOverride w:val="${l.start}"/></w:lvlOverride>` : "";
      return `<w:num w:numId="${l.numId}"><w:abstractNumId w:val="${l.ordered ? 1 : 0}"/>${override}</w:num>`;
    })
    .join("");
  return `${XML_HEAD}<w:numbering ${W_NS}>${abstract}${nums}</w:numbering>`;
}

/** Run properties of a paragraph style. A color of "auto" inherits, like in the editor. */
function styleRPr(st: ResolvedStyle): string {
  const hex = exportColor(st.color);
  const half = st.size * 2;
  return (
    `<w:rPr>${rFonts(st.font.name)}${st.bold ? "<w:b/>" : '<w:b w:val="0"/>'}${st.italic ? "<w:i/>" : '<w:i w:val="0"/>'}` +
    `${hex ? `<w:color w:val="${hex.slice(1)}"/>` : ""}<w:sz w:val="${half}"/><w:szCs w:val="${half}"/><w:u w:val="${st.underline ? "single" : "none"}"/></w:rPr>`
  );
}

const spacing = (st: ResolvedStyle) =>
  `<w:spacing w:before="${st.before * 20}" w:after="${st.after * 20}" w:line="${Math.round(st.lineHeight * 240)}" w:lineRule="auto"/>`;

/** Word styles built from the document's paragraph styles (see styles.ts). */
function stylesXml(doc: PMNode): string {
  const st = resolveStyles(doc.attrs);
  const n = st.normal;
  const heading = (level: 1 | 2 | 3) => {
    const h = st[`h${level}`];
    return `<w:style w:type="paragraph" w:styleId="Heading${level}"><w:name w:val="heading ${level}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/>${spacing(h)}<w:outlineLvl w:val="${level - 1}"/></w:pPr>${styleRPr(h)}</w:style>`;
  };
  return (
    `${XML_HEAD}<w:styles ${W_NS}>` +
    `<w:docDefaults><w:rPrDefault><w:rPr>${rFonts(n.font.name)}<w:sz w:val="${n.size * 2}"/><w:szCs w:val="${n.size * 2}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr>${spacing(n)}</w:pPr></w:pPrDefault></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr>${spacing(n)}</w:pPr>${styleRPr(n)}</w:style>` +
    heading(1) + heading(2) + heading(3) +
    `<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="999999"/></w:pBdr>${spacing(st.quote)}</w:pPr>${styleRPr(st.quote)}</w:style>` +
    `<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr>${spacing(st.code)}</w:pPr>${styleRPr(st.code)}</w:style>` +
    `<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>` +
    `</w:styles>`
  );
}

function coreXml(title: string): string {
  return (
    `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">` +
    `<dc:title>${xmlEscape(title)}</dc:title></cp:coreProperties>`
  );
}

const CONTENT_TYPES =
  `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
  `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
  `<Default Extension="xml" ContentType="application/xml"/>` +
  `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
  `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
  `<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` +
  `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>` +
  `<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>` +
  `</Types>`;

const ROOT_RELS =
  `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>` +
  `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>` +
  `</Relationships>`;

const DOC_RELS =
  `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
  `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
  `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
  `</Relationships>`;

const APP_XML =
  `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>PaperPad</Application></Properties>`;

// A4 portrait with 2.54 cm margins.
const sectPr = (footer: boolean) =>
  `<w:sectPr>${footer ? '<w:footerReference w:type="default" r:id="rId3"/>' : ""}<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`;

// A centered PAGE field: Word and LibreOffice replace it with the page number.
const FOOTER_XML =
  `${XML_HEAD}<w:ftr ${W_NS}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>` +
  `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
  `<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;

export function toDocxParts(doc: PMNode, title: string): DocxPart[] {
  const { body, lists, media } = documentBody(doc);
  const pageNumbers = !!doc.attrs.pageNumbers;
  const document = `${XML_HEAD}<w:document ${W_NS} xmlns:wp="${WP_NS}"><w:body>${body}${sectPr(pageNumbers)}</w:body></w:document>`;
  // With page numbers, the footer part must also be declared in the content types and the relationships.
  // So do the images: one Default per image type, one relationship per image.
  const types = [...new Set(media.files.map((f) => f.ext))].map((ext) => `<Default Extension="${ext}" ContentType="image/${ext}"/>`);
  if (pageNumbers) types.push('<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>');
  const contentTypes = CONTENT_TYPES.replace("</Types>", `${types.join("")}</Types>`);
  const rels = media.files.map((f) => `<Relationship Id="${f.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${f.name}"/>`);
  if (pageNumbers) rels.push('<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>');
  const docRels = DOC_RELS.replace("</Relationships>", `${rels.join("")}</Relationships>`);
  const parts: DocxPart[] = [
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: ROOT_RELS },
    { name: "docProps/core.xml", content: coreXml(title) },
    { name: "docProps/app.xml", content: APP_XML },
    { name: "word/document.xml", content: document },
    { name: "word/styles.xml", content: stylesXml(doc) },
    { name: "word/numbering.xml", content: numberingXml(lists) },
    { name: "word/_rels/document.xml.rels", content: docRels },
  ];
  if (pageNumbers) parts.push({ name: "word/footer1.xml", content: FOOTER_XML });
  for (const f of media.files) parts.push({ name: `word/media/${f.name}`, content: f.base64, base64: true });
  return parts;
}
