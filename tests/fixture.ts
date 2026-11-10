// A document that exercises every node and mark in the schema.
import { schema } from "../src/editor/schema.ts";

export const sampleDoc = () =>
  schema.nodeFromJSON({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1, align: "center" }, content: [{ type: "text", text: "Letter to Ada" }] },
      {
        type: "paragraph",
        attrs: { indent: 1 },
        content: [
          { type: "text", text: "Plain, " },
          { type: "text", text: "bold", marks: [{ type: "strong" }] },
          { type: "text", text: ", " },
          { type: "text", text: "italic", marks: [{ type: "em" }] },
          { type: "text", text: ", " },
          { type: "text", text: "under", marks: [{ type: "underline" }] },
          { type: "text", text: " and " },
          { type: "text", text: "struck", marks: [{ type: "strike" }] },
          { type: "text", text: ". " },
          { type: "text", text: "Red Georgia 18", marks: [{ type: "font", attrs: { key: "georgia" } }, { type: "size", attrs: { key: "18" } }, { type: "color", attrs: { key: "red" } }] },
          { type: "text", text: " highlighted", marks: [{ type: "highlight", attrs: { key: "yellow" } }] },
          { type: "hard_break" },
          { type: "text", text: "Caffè {braces} \\ <tags> & \u{1F33F}\ttab" },
        ],
      },
      {
        type: "bullet_list",
        content: [
          { type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "First" }] }] },
          {
            type: "list_item",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Second" }] },
              { type: "ordered_list", attrs: { order: 3 }, content: [{ type: "list_item", content: [{ type: "paragraph", content: [{ type: "text", text: "Nested three" }] }] }] },
            ],
          },
        ],
      },
      { type: "horizontal_rule" },
      { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "A quote" }] }] },
      { type: "code_block", content: [{ type: "text", text: "let x = 1;\nlet y = 2;" }] },
      { type: "paragraph", attrs: { align: "right" }, content: [{ type: "text", text: "Liz" }] },
    ],
  });
