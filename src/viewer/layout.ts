/**
 * Places the notes of a graph: notes that link to each other end up near
 * each other. Nothing here touches the page, so it is tested with plain
 * Node.js.
 *
 * Every note pushes the others away, a link pulls its two notes together,
 * and all are drawn a little to the middle. Done step by step, the picture
 * settles.
 */

export interface GraphNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** How many links it has */
  degree: number;
}

export interface Graph {
  nodes: GraphNode[];
  /** Pairs of places in `nodes` */
  links: [number, number][];
}

/** The length a link wants to have */
const REST = 60;
/**
 * Notes further apart than this do not push each other: with thousands of
 * notes, only neighbors are looked at. The pull to the middle packs many
 * notes closer, so a reach of one length would take in ever more of them:
 * the more notes, the shorter the reach. A step for 3000 notes takes 6 ms
 * with it and 20 ms without.
 */
export function reachOf(count: number): number {
  return Math.max(80, Math.min(240, (240 * 1000) / Math.max(1, count)));
}

/** A graph of the given notes. A link to a note that is not among them is left out, and so is a second link between the same two. */
export function makeGraph(ids: readonly string[], linksOf: (id: string) => readonly string[]): Graph {
  const place = new Map(ids.map((id, at) => [id, at]));
  // Start on a spiral: no two notes on the same spot, and the same picture every time
  const nodes: GraphNode[] = ids.map((id, at) => {
    const angle = at * 2.399963;
    const radius = 12 * Math.sqrt(at + 1);
    return { id, x: radius * Math.cos(angle), y: radius * Math.sin(angle), vx: 0, vy: 0, degree: 0 };
  });
  const links: [number, number][] = [];
  const seen = new Set<string>();
  for (const [from, id] of ids.entries()) {
    for (const other of linksOf(id)) {
      const to = place.get(other);
      if (to === undefined || to === from) {
        continue;
      }
      const key = from < to ? `${String(from)}-${String(to)}` : `${String(to)}-${String(from)}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      links.push([from, to]);
      nodes[from].degree++;
      nodes[to].degree++;
    }
  }
  return { nodes, links };
}

/** The furthest a note moves in one step. Without it, a note that many others pull at would be thrown further at every step. */
const FASTEST = 40;
/** Squares are numbered up to this far from the middle, in each direction */
const FURTHEST_SQUARE = 30_000;

function squareOf(position: number, reach: number): number {
  return Math.max(-FURTHEST_SQUARE, Math.min(FURTHEST_SQUARE, Math.floor(position / reach)));
}

/** One step. Returns how much the notes moved, a note on average: near zero when the picture has settled. */
export function step(graph: Graph): number {
  const { nodes, links } = graph;
  const reach = reachOf(nodes.length);
  // Notes are sorted into squares of the size of the reach: a note is pushed by those in its square and the eight around it
  const span = 2 * FURTHEST_SQUARE + 3;
  const squares = new Map<number, number[]>();
  for (const [at, node] of nodes.entries()) {
    const key = (squareOf(node.x, reach) + FURTHEST_SQUARE + 1) * span + squareOf(node.y, reach) + FURTHEST_SQUARE + 1;
    const square = squares.get(key);
    if (square === undefined) {
      squares.set(key, [at]);
    } else {
      square.push(at);
    }
  }
  for (const [at, node] of nodes.entries()) {
    const sx = squareOf(node.x, reach) + FURTHEST_SQUARE + 1;
    const sy = squareOf(node.y, reach) + FURTHEST_SQUARE + 1;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of squares.get((sx + dx) * span + sy + dy) ?? []) {
          if (other <= at) {
            continue;
          }
          const b = nodes[other];
          let x = node.x - b.x;
          let y = node.y - b.y;
          let distance = x * x + y * y;
          if (distance > reach * reach) {
            continue;
          }
          if (distance < 0.01) {
            // On the same spot: pushed apart in a direction of their own
            x = ((at % 7) - 3) * 0.1 + 0.05;
            y = ((other % 5) - 2) * 0.1 + 0.05;
            distance = x * x + y * y;
          }
          const push = 900 / distance;
          const length = Math.sqrt(distance);
          const fx = (x / length) * Math.min(push, 30);
          const fy = (y / length) * Math.min(push, 30);
          node.vx += fx;
          node.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
    }
  }
  for (const [from, to] of links) {
    const a = nodes[from];
    const b = nodes[to];
    const x = b.x - a.x;
    const y = b.y - a.y;
    const length = Math.sqrt(x * x + y * y) || 1;
    // Each end is pulled by its share of the links it has. A note with a hundred links is then pulled
    // as hard in all as a note with one, and is not thrown back and forth by the sum of them.
    const stretch = (length - REST) * 0.15;
    a.vx += ((x / length) * stretch) / Math.max(1, a.degree);
    a.vy += ((y / length) * stretch) / Math.max(1, a.degree);
    b.vx -= ((x / length) * stretch) / Math.max(1, b.degree);
    b.vy -= ((y / length) * stretch) / Math.max(1, b.degree);
  }
  let moved = 0;
  for (const [at, node] of nodes.entries()) {
    node.vx = (node.vx - node.x * 0.004) * 0.82;
    node.vy = (node.vy - node.y * 0.004) * 0.82;
    const speed = Math.hypot(node.vx, node.vy);
    if (speed > FASTEST) {
      node.vx *= FASTEST / speed;
      node.vy *= FASTEST / speed;
    }
    node.x += node.vx;
    node.y += node.vy;
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      // Should a number be lost all the same, the note starts again from a spot of its own
      node.x = 12 * Math.sqrt(at + 1);
      node.y = 0;
      node.vx = 0;
      node.vy = 0;
    }
    moved += Math.abs(node.vx) + Math.abs(node.vy);
  }
  return nodes.length === 0 ? 0 : moved / nodes.length;
}

/** The smallest box around all notes */
export function boundsOf(graph: Graph): { left: number; top: number; right: number; bottom: number } {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const node of graph.nodes) {
    left = Math.min(left, node.x);
    top = Math.min(top, node.y);
    right = Math.max(right, node.x);
    bottom = Math.max(bottom, node.y);
  }
  return graph.nodes.length === 0 ? { left: 0, top: 0, right: 0, bottom: 0 } : { left, top, right, bottom };
}
