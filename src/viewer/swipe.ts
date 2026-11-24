/**
 * Moving the note aside with a finger, on a narrow window: the note follows
 * the finger sideways, and the side that lies under it shows. A finger that
 * goes to the right uncovers the files on the left, one that goes to the
 * left the outline on the right, and the other way covers them again.
 *
 * What moves is moved by the browser without laying the page out again.
 * Scrolling up and down stays with the browser, and so does scrolling
 * sideways inside a wide table or a block of code.
 *
 * The browser is asked one thing: when a finger takes the note, it is told
 * not to make a gesture of its own of that touch. Without that, a browser
 * that goes back a page for a finger that moves sideways where nothing
 * scrolls does so when the finger is lifted, as over a table. The browser
 * waits for this answer once a touch, at its first move, and for nothing
 * after it.
 */

export type Side = "left" | "right";

/**
 * How far a finger moves, in pixels, before it is said which way it goes.
 * Less than what a browser lets a finger move before it tells the page of
 * it: the first move the page hears of is then enough to say, and that is
 * the only one at which the browser can still be told to keep out.
 */
export const SLOP = 6;
/** From this speed on, in pixels a millisecond, a finger that is lifted has flicked the note */
export const FLICK = 0.3;
/** The speed of a finger is taken from what it did in its last milliseconds */
const RECENT = 100;

/**
 * Which way a finger goes: sideways, along the note (up or down), or not yet
 * known. Sideways has to be clear: a finger that scrolls a note never moves
 * in a straight line.
 */
export function wayOf(dx: number, dy: number): "sideways" | "along" | null {
  if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) {
    return null;
  }
  return Math.abs(dx) > Math.abs(dy) * 1.5 ? "sideways" : "along";
}

/**
 * The side a finger works on, or null when its way does nothing: with both
 * sides covered, the one it uncovers, and with a side open, that side when
 * the finger goes to cover it.
 */
export function sideFor(open: Side | null, dx: number): Side | null {
  if (open === null) {
    return dx > 0 ? "left" : "right";
  }
  return (open === "left") === dx < 0 ? open : null;
}

/**
 * Where the note is, in pixels from its place: to the right of it over the
 * left side, to the left of it (below zero) over the right side, and never
 * further than the side is wide.
 *
 * @param moved how far the finger has gone since it took the note
 */
export function shiftOf(side: Side, wasOpen: boolean, moved: number, width: number): number {
  const sign = side === "left" ? 1 : -1;
  const from = wasOpen ? width : 0;
  return sign * Math.min(width, Math.max(0, from + sign * moved));
}

/**
 * The speed of a finger when it is lifted, in pixels a millisecond, from
 * where it was at which time. A finger that rests sends nothing: one that
 * has sent nothing for a while before it is lifted has no speed, however
 * fast it went before.
 *
 * A browser that is busy tells of several moves as one. So the place where
 * the finger came down counts as well, and where its last moments hold one
 * place only, the speed is taken from the place before.
 *
 * @param lifted the time the finger was lifted
 */
export function speedOf(samples: readonly (readonly [x: number, time: number])[], lifted: number): number {
  const last = samples[samples.length - 1];
  if (last === undefined || lifted - last[1] > RECENT) {
    return 0;
  }
  const recent = samples.findIndex(([, time]) => last[1] - time <= RECENT);
  const first = samples[recent === samples.length - 1 ? recent - 1 : recent] ?? last;
  return last[1] === first[1] ? 0 : (last[0] - first[0]) / (last[1] - first[1]);
}

/**
 * Whether a side is open after the finger is lifted: where a flick sends the
 * note, and without one, where the note is nearer to.
 */
export function endsOpen(side: Side, shift: number, speed: number, width: number): boolean {
  if (Math.abs(speed) >= FLICK) {
    return speed > 0 === (side === "left");
  }
  return Math.abs(shift) > width / 2;
}

/** What the page does for a finger */
export interface SwipeHost {
  /** The side that is open */
  open(): Side | null;
  /** How wide a side is, in pixels */
  width(side: Side): number;
  /** A finger has taken the note, to uncover or cover this side */
  begin(side: Side): void;
  /** The note is this far from its place, which is this part of the whole way (0 to 1) */
  move(shift: number, part: number): void;
  /** The finger is lifted: the side ends open or covered */
  end(side: Side, open: boolean): void;
}

/**
 * True when a touch that starts on this element is not for the note as a
 * whole: on something that takes a finger itself, or inside something that
 * can still be scrolled the way the finger goes.
 */
function isTaken(target: Element, root: Element, dx: number): boolean {
  if (target.closest("canvas, input, textarea, select, [contenteditable]") !== null) {
    return true;
  }
  for (let at: Element | null = target; at !== null && at !== root; at = at.parentElement) {
    if (at.scrollWidth <= at.clientWidth + 1) {
      continue;
    }
    const overflow = getComputedStyle(at).overflowX;
    if (overflow !== "auto" && overflow !== "scroll") {
      continue;
    }
    // A finger that goes right pulls in what lies to the left
    if (dx > 0 ? at.scrollLeft > 0 : at.scrollLeft + at.clientWidth < at.scrollWidth - 1) {
      return true;
    }
  }
  return false;
}

/**
 * Watches the fingers on the page, for as long as the sides lie under the
 * note. Gives back what ends the watching, and a move that is going on with
 * it: for when the window stops being narrow.
 */
export function watchSwipe(root: HTMLElement, host: SwipeHost): () => void {
  const watching = new AbortController();
  const passive = { passive: true, signal: watching.signal };
  /** The finger that is followed: what it has done, and what was made of it */
  let touch: {
    id: number;
    x: number;
    y: number;
    /** When it came down */
    time: number;
    target: Element | null;
    /** Not yet known, the note is with the finger, or the finger is left alone */
    state: "wait" | "drag" | "leave";
  } | null = null;
  /** Of the finger that has the note */
  let drag: { side: Side; wasOpen: boolean; width: number; from: number; shift: number; samples: [number, number][] } | null = null;
  let frame = 0;

  /** @param lifted the time a finger was lifted that may have flicked the note, or null when none did */
  const finish = (lifted: number | null): void => {
    const done = drag;
    touch = null;
    drag = null;
    if (done === null) {
      return;
    }
    window.cancelAnimationFrame(frame);
    frame = 0;
    host.end(done.side, endsOpen(done.side, done.shift, lifted === null ? 0 : speedOf(done.samples, lifted), done.width));
  };

  const mine = (event: TouchEvent): Touch | null => {
    for (const one of Array.from(event.changedTouches)) {
      if (one.identifier === touch?.id) {
        return one;
      }
    }
    return null;
  };

  root.addEventListener(
    "touchstart",
    (event) => {
      const first = event.touches[0];
      if (event.touches.length !== 1 || first === undefined) {
        // A second finger is for making the page larger or smaller: the note stays where it is nearer to
        finish(null);
        return;
      }
      touch = { id: first.identifier, x: first.clientX, y: first.clientY, time: event.timeStamp, target: event.target instanceof Element ? event.target : null, state: "wait" };
    },
    passive,
  );

  root.addEventListener(
    "touchmove",
    (event) => {
      const now = touch === null || touch.state === "leave" ? null : mine(event);
      if (touch === null || now === null) {
        return;
      }
      const dx = now.clientX - touch.x;
      if (touch.state === "wait") {
        const way = wayOf(dx, now.clientY - touch.y);
        if (way === null) {
          return;
        }
        const side = way === "sideways" ? sideFor(host.open(), dx) : null;
        const selected = window.getSelection();
        if (side === null || touch.target === null || isTaken(touch.target, root, dx) || (selected !== null && !selected.isCollapsed)) {
          touch.state = "leave";
          return;
        }
        touch.state = "drag";
        const wasOpen = host.open() === side;
        const width = host.width(side);
        drag = { side, wasOpen, width, from: dx, shift: shiftOf(side, wasOpen, 0, width), samples: [[touch.x, touch.time]] };
        host.begin(side);
      }
      if (drag === null) {
        return;
      }
      // The touch is the note's: the browser makes no scrolling and no step back of it
      if (event.cancelable) {
        event.preventDefault();
      }
      drag.shift = shiftOf(drag.side, drag.wasOpen, dx - drag.from, drag.width);
      drag.samples.push([now.clientX, event.timeStamp]);
      if (drag.samples.length > 20) {
        drag.samples.shift();
      }
      // Fingers are read more often than the screen is drawn: the note is moved once for each time it is drawn
      if (frame === 0) {
        frame = window.requestAnimationFrame(() => {
          frame = 0;
          if (drag !== null) {
            host.move(drag.shift, drag.width === 0 ? 0 : Math.abs(drag.shift) / drag.width);
          }
        });
      }
    },
    { passive: false, signal: watching.signal },
  );

  const lifted = (flicked: boolean) => (event: TouchEvent) => {
    if (touch !== null && mine(event) !== null) {
      finish(flicked ? event.timeStamp : null);
    }
  };
  root.addEventListener("touchend", lifted(true), passive);
  // A touch the browser takes away, as for a gesture of its own, was no flick
  root.addEventListener("touchcancel", lifted(false), passive);

  return () => {
    watching.abort();
    finish(null);
  };
}
