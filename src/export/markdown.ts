// Markdown import and export (CommonMark plus ~~strikethrough~~).
//
// Markdown has no notion of fonts, sizes, colors, highlight, underline,
// alignment or indent, so those are dropped on export. Raw HTML is never
// parsed on import, and links and images are reduced to their text.

import { defaultMarkdownParser, defaultMarkdownSerializer, MarkdownParser, MarkdownSerializer } from "prosemirror-markdown";
import type { Node as PMNode } from "prosemirror-model";
import { schema } from "../editor/schema.ts";

const plain = { open: "", close: "", mixable: true, expelEnclosingWhitespace: true };
const base = defaultMarkdownSerializer;

const serializer = new MarkdownSerializer(
  {
    ...base.nodes,
    heading(state, node) {
      state.write(state.repeat("#", node.attrs.level as number) + " ");
      state.renderInline(node, false);
      state.closeBlock(node);
    },
    bullet_list(state, node) {
      state.renderList(node, "  ", () => "- ");
    },
  },
  {
    em: base.marks.em!,
    strong: base.marks.strong!,
    code: base.marks.code!,
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    underline: plain,
    font: plain,
    size: plain,
    color: plain,
    highlight: plain,
  },
);

export function toMarkdown(doc: PMNode): string {
  return serializer.serialize(doc, { tightLists: true }) + "\n";
}

// The default parser's tokenizer is markdown-it in "commonmark" mode with
// HTML disabled. We reuse it (it is bundled anyway) and enable ~~strike~~.
const tokenizer = defaultMarkdownParser.tokenizer.enable("strikethrough");

const parser = new MarkdownParser(schema, tokenizer, {
  ...defaultMarkdownParser.tokens,
  heading: {
    block: "heading",
    getAttrs: (tok) => ({ level: Math.min(3, Number(tok.tag.slice(1))) }),
  },
  link: { ignore: true },
  image: { ignore: true, noCloseToken: true },
  s: { mark: "strike" },
});

export function fromMarkdown(text: string): PMNode {
  return parser.parse(text);
}
