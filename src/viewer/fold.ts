import { el, iconNodes } from "./dom.ts";

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

/** Hides and shows the blocks of a note by which of its headings are folded */
function apply(sizer: HTMLElement): void {
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
}

/**
 * Opens the folded headings that hide something of a note, so that it can be
 * gone to: a heading the outline names, a line a search found. What hides a
 * block is the nearest folded heading before it that is itself seen. Under
 * it there may be another one, which hides the block then.
 */
export function unfoldFor(sizer: HTMLElement, target: Element): void {
  let block: Element | null = target;
  while (block !== null && block.parentElement !== sizer) {
    block = block.parentElement;
  }
  // No more turns than there are levels of headings
  for (let turn = 0; block !== null && block.classList.contains(FOLDED) && turn < 6; turn++) {
    let hider = block.previousElementSibling;
    while (hider !== null && !(headingOf(hider) !== null && hider.classList.contains("is-collapsed") && !hider.classList.contains(FOLDED))) {
      hider = hider.previousElementSibling;
    }
    if (hider === null) {
      return;
    }
    hider.classList.remove("is-collapsed");
    hider.querySelector(".heading-collapse-indicator")?.classList.remove("is-collapsed");
    apply(sizer);
  }
}

/**
 * Closes or opens a callout that can be folded, as Obsidian marks it in what
 * it draws: the callout and the sign in its title say that it is closed, and
 * what the callout holds is taken out of sight on the element itself.
 */
export function foldCallout(callout: Element, isFolded: boolean): void {
  callout.classList.toggle("is-collapsed", isFolded);
  callout.querySelector(":scope > .callout-title .callout-fold")?.classList.toggle("is-collapsed", isFolded);
  const content = callout.querySelector<HTMLElement>(":scope > .callout-content");
  if (content !== null) {
    content.style.display = isFolded ? "none" : "";
  }
}

/** What a closed callout hides: what it holds, not its title */
const HIDDEN_BY_CALLOUT = ".callout.is-collapsed > .callout-content";

/**
 * Opens the closed callouts that hide something of a note, so that it can be
 * gone to: a line a search found, the place a footnote leads to. A callout
 * inside a callout is hidden by both.
 */
export function openCallouts(sizer: HTMLElement, target: Element): void {
  let hidden = target.closest(HIDDEN_BY_CALLOUT);
  while (hidden !== null && sizer.contains(hidden)) {
    const callout: Element | null = hidden.parentElement;
    if (callout === null) {
      return;
    }
    foldCallout(callout, false);
    hidden = callout.parentElement?.closest(HIDDEN_BY_CALLOUT) ?? null;
  }
}

/**
 * Lets the headings of a note be folded, as in the reading view of Obsidian:
 * a triangle before a heading folds what is under it. Only the headings of
 * the note itself, which are the blocks at its top level.
 */
export function addFolding(sizer: HTMLElement, triangle: string): void {
  for (const block of Array.from(sizer.children)) {
    const heading = headingOf(block);
    if (heading === null) {
      continue;
    }
    const indicator = el("span", { cls: "heading-collapse-indicator collapse-indicator collapse-icon", attr: { role: "button", "aria-label": "Fold" } }, iconNodes(triangle));
    indicator.addEventListener("click", (event) => {
      event.stopPropagation();
      // As in Obsidian, the block of the heading says that it is folded, and so does the triangle
      const isFolded = block.classList.toggle("is-collapsed");
      indicator.classList.toggle("is-collapsed", isFolded);
      apply(sizer);
    });
    heading.prepend(indicator);
  }
}
