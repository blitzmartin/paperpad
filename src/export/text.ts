// Plain text export. Lists keep a readable bullet or number prefix.

import type { Node as PMNode } from "prosemirror-model";

export function toPlainText(doc: PMNode): string {
  const lines: string[] = [];

  const inline = (block: PMNode) => {
    let out = "";
    block.forEach((child) => {
      if (child.isText) out += child.text;
      else if (child.type.name === "hard_break") out += "\n";
    });
    return out;
  };

  const walk = (node: PMNode, prefix: string, depth: number) => {
    switch (node.type.name) {
      case "paragraph":
      case "heading":
        lines.push(prefix + inline(node));
        break;
      case "code_block":
        for (const l of node.textContent.split("\n")) lines.push(prefix + l);
        break;
      case "horizontal_rule":
        lines.push("----------------------------------------");
        break;
      case "blockquote":
        node.forEach((c) => walk(c, prefix + "> ", depth));
        break;
      case "bullet_list":
      case "ordered_list": {
        let n = node.type.name === "ordered_list" ? (node.attrs.order as number) : 0;
        node.forEach((item) => {
          const marker = n ? `${n++}. ` : "- ";
          const pad = "    ".repeat(depth);
          item.forEach((child, _off, i) => {
            const lead = i === 0 ? prefix + pad + marker : prefix + pad + " ".repeat(marker.length);
            if (child.isTextblock) lines.push(lead + inline(child));
            else walk(child, prefix, depth + 1);
          });
        });
        break;
      }
      default:
        node.forEach((c) => walk(c, prefix, depth));
    }
  };

  doc.forEach((n) => walk(n, "", 0));
  return lines.join("\n") + "\n";
}
