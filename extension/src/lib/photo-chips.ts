/**
 * Turns `%PHOTO_n%` in rendered prose into something the panel can draw a
 * chip for.
 *
 * The placeholder is where a step's n-th `### Photo` lands on export. In the
 * panel it should read as "a picture goes here", and during a run it
 * should say whether that picture exists yet — which is why it is an
 * element with the number on it rather than left as text for the tester
 * to decode.
 *
 * Text nodes are split around every match and the match becomes a `<data>`
 * element carrying `n` in `value`. `<data>` because the Markdown here is
 * parsed without raw HTML, so an author cannot produce one, and the panel's
 * component map can claim the tag outright — the same trick as `<mark>`
 * for quoted values. Code and pre are left alone: a placeholder inside a
 * script is text, not a figure.
 */

import { PHOTO_PLACEHOLDER_RE } from "@tcm/shared";

interface HastText {
  type: "text";
  value: string;
}
interface HastElement {
  type: "element";
  tagName: string;
  properties?: Record<string, unknown>;
  children: HastNode[];
}
interface HastParent {
  type: string;
  tagName?: string;
  children?: HastNode[];
}
type HastNode = HastText | HastElement | HastParent;

const SKIP = new Set(["code", "pre"]);

function chip(n: string): HastElement {
  return {
    type: "element",
    tagName: "data",
    properties: { value: n, dataPhoto: "" },
    children: [{ type: "text", value: `%PHOTO_${n}%` }],
  };
}

function split(text: string): HastNode[] | null {
  const re = new RegExp(PHOTO_PLACEHOLDER_RE.source, "g");
  const out: HastNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: "text", value: text.slice(last, at) });
    out.push(chip(m[1]));
    last = at + m[0].length;
  }
  if (out.length === 0) return null;
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

function walk(node: HastParent): void {
  const children = node.children;
  if (!Array.isArray(children)) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === "text") {
      const pieces = split((child as HastText).value);
      if (!pieces) continue;
      children.splice(i, 1, ...pieces);
      i += pieces.length - 1;
      continue;
    }
    if (child.type === "element" && SKIP.has((child as HastElement).tagName)) continue;
    walk(child as HastParent);
  }
}

/** rehype plugin: `%PHOTO_n%` → `<data value="n" data-photo>`. */
export function rehypePhotoChips() {
  return (tree: HastParent): void => walk(tree);
}
