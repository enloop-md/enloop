/**
 * Finds the example values a step marks up — `Put "**Buy milk**" in the
 * field` — and rewrites them so the panel can offer to type them into the
 * page.
 *
 * The marker is a **bolded run wrapped in double quotes**, and it is the
 * pair that carries the meaning. Neither half can do it alone:
 *
 * - Quotes on their own are ordinary punctuation. Case prose quotes error
 *   messages ("no `Undefined property` errors"), field names, UI copy. A
 *   rule that chipped those would offer to type sentence fragments into the
 *   page, and a panel full of controls that are mostly wrong teaches
 *   testers to ignore the ones that are right.
 * - Bold on its own is emphasis, and an author should keep being allowed to
 *   emphasise a word.
 *
 * Requiring both makes it an opt-in an author performs deliberately, while
 * still leaving a case file that reads correctly to someone who never opens
 * the extension — in any Markdown viewer, `"**Buy milk**"` is a quoted
 * value with the value emphasised. That readability is the constraint the
 * marker exists to satisfy: these files are reviewed on GitHub and in
 * editors far more often than they are run.
 *
 * Backticks mean something else in the step contract — a visible UI label,
 * or a selector — so code is skipped entirely: `` `Save changes` `` is a
 * button to find, not a value to type.
 */

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

/** Straight and typographic quotes both count on both sides, and may be
 * mixed: authors paste from anywhere, and a value that lost its chip
 * because the quotes came out of a word processor is a bug the author
 * cannot see in their own file. */
const OPENING = /["“]$/;
const CLOSING = /^["”]/;

/** A value longer than this is a sentence someone bolded, not something a
 * tester types into a field. */
const MAX_VALUE_LENGTH = 120;

/** Elements whose text is not prose. */
const SKIP = new Set(["code", "pre"]);

function isText(node: HastNode): node is HastText {
  return node.type === "text";
}

/** The literal an author wrote, with any nested markup flattened away. */
function textOf(node: HastNode): string {
  if (isText(node)) return node.value;
  const children = (node as HastElement).children;
  return Array.isArray(children) ? children.map(textOf).join("") : "";
}

function walk(node: HastParent): void {
  const children = node.children;
  if (!Array.isArray(children)) return;

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type !== "element") continue;
    const element = child as HastElement;
    if (SKIP.has(element.tagName)) continue;

    if (element.tagName !== "strong") {
      walk(element);
      continue;
    }

    // The quotes live in the text nodes on either side, since the bold
    // markers sit inside them: `"` + `<strong>` + `"`.
    const before = children[i - 1];
    const after = children[i + 1];
    if (!before || !after || !isText(before) || !isText(after)) continue;
    if (!OPENING.test(before.value) || !CLOSING.test(after.value)) continue;

    const value = textOf(element).trim();
    if (!value || value.length > MAX_VALUE_LENGTH || value.includes("\n")) continue;

    // The chip draws the quotes back around the value, so take them out of
    // the surrounding prose — otherwise the sentence renders with two.
    before.value = before.value.slice(0, -1);
    after.value = after.value.slice(1);
    children[i] = {
      type: "element",
      tagName: "mark",
      properties: {},
      children: [{ type: "text", value }],
    };
  }
}

/** rehype plugin: rewrites quoted-bold values into `<mark>` elements. Safe
 * to run on any tree — Markdown here is parsed without raw HTML, so a
 * `<mark>` in the output can only be one this produced. */
export function rehypeQuotedValues() {
  return (tree: HastParent): void => walk(tree);
}
