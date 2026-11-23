import { el } from "./dom.ts";
import { boundsOf, makeGraph, step, type Graph } from "./layout.ts";

export interface GraphHost {
  /** The notes a note links to */
  linksOf(id: string): readonly string[];
  titleOf(id: string): string;
  /** Called when a note is chosen */
  go(id: string): void;
  /** A color of the look of the site, by the name of its variable, as the browser paints it */
  color(variable: string, fallback: string): string;
}

export interface GraphView {
  el: HTMLElement;
  /** Draws these notes and the links between them. `focus` is the note that is open. */
  show(ids: readonly string[], focus: string | null): void;
  /** Reads the colors again, after the look changed */
  repaint(): void;
  /** Stops what runs in the background */
  stop(): void;
}

/** Below this much movement of a note in a step, the picture is taken as settled */
const SETTLED = 0.1;

/** With more notes than this, names are shown only for the note under the pointer and its neighbors */
const NAMES_UP_TO = 60;

/**
 * A graph of notes on a canvas: a dot for a note, a line for a link. It can
 * be moved and made larger and smaller; the note under the pointer shows its
 * name and its links, and a click opens it.
 */
export function graphView(host: GraphHost): GraphView {
  const canvas = el("canvas", { cls: "v2s-graph-canvas" });
  const container = el("div", { cls: "v2s-graph" }, [canvas]);
  const context = canvas.getContext("2d");

  let graph: Graph = { nodes: [], links: [] };
  let neighbors: Set<number>[] = [];
  let focus = -1;
  let hovered = -1;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  /** True once the person has moved or sized the picture: it is then no longer fitted to the canvas */
  let isMoved = false;
  let frame = 0;
  let stepsLeft = 0;
  let colors = { node: "#888", focus: "#7c3aed", line: "#ccc", text: "#222" };

  const readColors = (): void => {
    colors = {
      node: host.color("--graph-node", "var(--text-muted, #888)"),
      focus: host.color("--graph-node-focused", "var(--text-accent, #7c3aed)"),
      line: host.color("--graph-line", "var(--background-modifier-border, #ccc)"),
      text: host.color("--graph-text", "var(--text-normal, #222)"),
    };
  };

  const size = (): { width: number; height: number } => ({ width: container.clientWidth, height: container.clientHeight });

  const fit = (): void => {
    const { width, height } = size();
    const box = boundsOf(graph);
    const spanX = Math.max(60, box.right - box.left);
    const spanY = Math.max(60, box.bottom - box.top);
    scale = Math.max(0.05, Math.min(2.2, 0.86 * Math.min(width / spanX, height / spanY)));
    offsetX = width / 2 - ((box.left + box.right) / 2) * scale;
    offsetY = height / 2 - ((box.top + box.bottom) / 2) * scale;
  };

  const radiusOf = (degree: number): number => 3 + Math.min(7, Math.sqrt(degree));

  const draw = (): void => {
    if (context === null) {
      return;
    }
    const ratio = window.devicePixelRatio || 1;
    const { width, height } = size();
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.setTransform(ratio * scale, 0, 0, ratio * scale, ratio * offsetX, ratio * offsetY);
    const near = hovered === -1 ? null : neighbors[hovered];
    const isLit = (at: number): boolean => at === hovered || near?.has(at) === true;

    context.lineWidth = 1 / scale;
    context.strokeStyle = colors.line;
    context.globalAlpha = near === null ? 0.7 : 0.18;
    context.beginPath();
    for (const [from, to] of graph.links) {
      if (near !== null && (from === hovered || to === hovered)) {
        continue;
      }
      const a = graph.nodes[from];
      const b = graph.nodes[to];
      if (a !== undefined && b !== undefined) {
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
      }
    }
    context.stroke();
    if (near !== null) {
      context.globalAlpha = 1;
      context.strokeStyle = colors.focus;
      context.beginPath();
      const center = graph.nodes[hovered];
      for (const other of near) {
        const b = graph.nodes[other];
        if (center !== undefined && b !== undefined) {
          context.moveTo(center.x, center.y);
          context.lineTo(b.x, b.y);
        }
      }
      context.stroke();
    }

    for (const [at, node] of graph.nodes.entries()) {
      context.globalAlpha = near === null || isLit(at) ? 1 : 0.25;
      context.fillStyle = at === focus || at === hovered ? colors.focus : colors.node;
      context.beginPath();
      context.arc(node.x, node.y, radiusOf(node.degree) / Math.sqrt(scale), 0, Math.PI * 2);
      context.fill();
    }

    // Names: of all notes while they are few, else of the note under the pointer, its neighbors, and the note that is open
    context.globalAlpha = 1;
    context.fillStyle = colors.text;
    context.font = `${String(12 / scale)}px ${getComputedStyle(container).fontFamily}`;
    context.textAlign = "center";
    context.textBaseline = "top";
    const namesAll = graph.nodes.length <= NAMES_UP_TO;
    for (const [at, node] of graph.nodes.entries()) {
      if (namesAll ? near === null || isLit(at) : isLit(at) || at === focus) {
        const name = host.titleOf(node.id);
        context.fillText(name.length > 40 ? name.slice(0, 39) + "…" : name, node.x, node.y + (radiusOf(node.degree) + 3) / Math.sqrt(scale));
      }
    }
  };

  /** Takes steps for as long as `millis` allows, at least one. Returns false when no more are needed. */
  const stepFor = (millis: number): boolean => {
    const until = performance.now() + millis;
    do {
      const moved = step(graph);
      stepsLeft--;
      if (!(moved >= SETTLED)) {
        // Settled, or not a number: either way there is nothing to gain from more steps
        stepsLeft = 0;
      }
    } while (stepsLeft > 0 && performance.now() < until);
    return stepsLeft > 0;
  };

  const run = (): void => {
    window.cancelAnimationFrame(frame);
    const tick = (): void => {
      if (stepsLeft > 0 && container.isConnected) {
        // A part of the time between two pictures: the page stays quick to answer, however many notes there are
        stepFor(10);
        if (!isMoved) {
          fit();
        }
        draw();
        frame = window.requestAnimationFrame(tick);
      }
    };
    frame = window.requestAnimationFrame(tick);
  };

  // ---- The pointer: move the picture, size it, and choose a note ----
  const toGraph = (event: { clientX: number; clientY: number }): { x: number; y: number } => {
    const box = canvas.getBoundingClientRect();
    return { x: (event.clientX - box.left - offsetX) / scale, y: (event.clientY - box.top - offsetY) / scale };
  };
  const nodeAt = (event: { clientX: number; clientY: number }): number => {
    const point = toGraph(event);
    let best = -1;
    let nearest = Infinity;
    for (const [at, node] of graph.nodes.entries()) {
      const distance = Math.hypot(node.x - point.x, node.y - point.y);
      // A finger or a pointer does not have to hit the dot itself
      if (distance < (radiusOf(node.degree) + 6) / Math.sqrt(scale) + 4 / scale && distance < nearest) {
        best = at;
        nearest = distance;
      }
    }
    return best;
  };
  const zoomAt = (clientX: number, clientY: number, factor: number): void => {
    const box = canvas.getBoundingClientRect();
    const next = Math.max(0.03, Math.min(6, scale * factor));
    offsetX = clientX - box.left - ((clientX - box.left - offsetX) / scale) * next;
    offsetY = clientY - box.top - ((clientY - box.top - offsetY) / scale) * next;
    scale = next;
    isMoved = true;
    draw();
  };

  const pointers = new Map<number, { x: number; y: number }>();
  let pressed: { x: number; y: number; travelled: number } | null = null;
  let pinch = 0;
  canvas.addEventListener("pointerdown", (event) => {
    // Only the main button of a mouse moves the picture; a finger or a pen always does
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pressed = pointers.size === 1 ? { x: event.clientX, y: event.clientY, travelled: 0 } : null;
    pinch = 0;
  });
  canvas.addEventListener("pointermove", (event) => {
    const before = pointers.get(event.pointerId);
    if (before === undefined) {
      const at = nodeAt(event);
      if (at !== hovered) {
        hovered = at;
        canvas.classList.toggle("is-over-note", at !== -1);
        draw();
      }
      return;
    }
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      if (a !== undefined && b !== undefined) {
        const apart = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) {
          zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, apart / pinch);
        }
        pinch = apart;
      }
      return;
    }
    offsetX += event.clientX - before.x;
    offsetY += event.clientY - before.y;
    if (pressed !== null) {
      pressed.travelled += Math.abs(event.clientX - before.x) + Math.abs(event.clientY - before.y);
      if (pressed.travelled > 4) {
        isMoved = true;
      }
    }
    draw();
  });
  const release = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    pinch = 0;
    if (pressed !== null && pressed.travelled <= 4 && event.type === "pointerup") {
      const node = graph.nodes[nodeAt(event)];
      if (node !== undefined) {
        host.go(node.id);
      }
    }
    pressed = null;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  // The end of a press can be taken by something else, as by a menu: then the press is over all the same
  canvas.addEventListener("lostpointercapture", release);
  canvas.addEventListener("pointerleave", () => {
    if (hovered !== -1 && pointers.size === 0) {
      hovered = -1;
      draw();
    }
  });
  canvas.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
    },
    { passive: false },
  );
  const resized = new ResizeObserver(() => {
    if (!isMoved) {
      fit();
    }
    draw();
  });
  resized.observe(container);

  return {
    el: container,
    show(ids, focusId) {
      graph = makeGraph(ids, (id) => host.linksOf(id));
      neighbors = graph.nodes.map(() => new Set<number>());
      for (const [from, to] of graph.links) {
        neighbors[from]?.add(to);
        neighbors[to]?.add(from);
      }
      focus = focusId === null ? -1 : ids.indexOf(focusId);
      hovered = -1;
      isMoved = false;
      readColors();
      // Placed for a moment before the first picture, and from then on while it is shown, so that the page does not stand still
      stepsLeft = graph.nodes.length === 0 ? 0 : 400;
      if (stepsLeft > 0) {
        stepFor(graph.nodes.length <= 60 ? 30 : 12);
      }
      fit();
      draw();
      run();
    },
    repaint() {
      readColors();
      draw();
    },
    stop() {
      stepsLeft = 0;
      window.cancelAnimationFrame(frame);
      resized.disconnect();
    },
  };
}
