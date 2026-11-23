import { el } from "./dom.ts";

/** On what a folded heading hides */
const FOLDED = "v2s-folded";
const HEADINGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

/** The heading a block of a note is, or null for a block of another kind. A block is a `div` around what it holds. */
function headingOf(block: Element): Element | null {
  const inner = block.firstElementChild;
  return inner !== null && HEADINGS.has(inner.tagName) ? inner : null;
}

/** The level of a heading element, or 0 for no heading */
function levelOf(heading: Element | null): number {
  return heading === null ? 0 : Number(heading.tagName.charAt(1));
}

/**
 * Which of the blocks of a note are hidden, given which headings are folded.
 * A folded heading hides what follows it up to the next heading of its level
 * or above. A heading inside a folded part keeps its own state for when the
 * part is opened again.
 *
 * @param blocks for each block: the level of the heading it is, or 0, and whether that heading is folded
 */
export function hiddenBlocks(blocks: readonly { level: number; isFolded: boolean }[]): boolean[] {
  /** The level of the folded heading that hides what comes now, or 0 */
  let under = 0;
  return blocks.map(({ level, isFolded }) => {
    if (level > 0 && (under === 0 || level <= under)) {
      under = isFolded ? level : 0;
      return false;
    }
    return under > 0;
  });
}

/**
 * Lets the headings of a note be folded, as in the reading view of Obsidian:
 * a triangle before a heading folds what is under it. Only the headings of
 * the note itself, which are the blocks at its top level.
 */
export function addFolding(sizer: HTMLElement, triangle: string): void {
  const apply = (): void => {
    const blocks = Array.from(sizer.children);
    const hidden = hiddenBlocks(
      blocks.map((block) => {
        const heading = headingOf(block);
        return { level: levelOf(heading), isFolded: heading !== null && block.classList.contains("is-collapsed") };
      }),
    );
    for (const [at, block] of blocks.entries()) {
      block.classList.toggle(FOLDED, hidden[at] === true);
    }
  };
  for (const block of Array.from(sizer.children)) {
    const heading = headingOf(block);
    if (heading === null) {
      continue;
    }
    const indicator = el("span", { cls: "heading-collapse-indicator collapse-indicator collapse-icon", attr: { role: "button", "aria-label": "Fold" } });
    indicator.innerHTML = triangle;
    indicator.addEventListener("click", (event) => {
      event.stopPropagation();
      // As in Obsidian, the block of the heading says that it is folded, and so does the triangle
      const isFolded = block.classList.toggle("is-collapsed");
      indicator.classList.toggle("is-collapsed", isFolded);
      apply();
    });
    heading.prepend(indicator);
  }
}
