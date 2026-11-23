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
/** Notes further apart than this do not push each other: with thousands of notes, only neighbors are looked at */
const REACH = 240;

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

/** One step. Returns how much the notes moved, a note on average: near zero when the picture has settled. */
export function step(graph: Graph): number {
  const { nodes, links } = graph;
  // Notes are sorted into squares of the size of the reach: a note is pushed by those in its square and the eight around it
  const squares = new Map<string, number[]>();
  for (const [at, node] of nodes.entries()) {
    const key = `${String(Math.floor(node.x / REACH))},${String(Math.floor(node.y / REACH))}`;
    const square = squares.get(key);
    if (square === undefined) {
      squares.set(key, [at]);
    } else {
      square.push(at);
    }
  }
  for (const [at, node] of nodes.entries()) {
    const sx = Math.floor(node.x / REACH);
    const sy = Math.floor(node.y / REACH);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of squares.get(`${String(sx + dx)},${String(sy + dy)}`) ?? []) {
          if (other <= at) {
            continue;
          }
          const b = nodes[other];
          let x = node.x - b.x;
          let y = node.y - b.y;
          let distance = x * x + y * y;
          if (distance > REACH * REACH) {
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
    // A note with many links is pulled less by each of them, or it would be torn at
    const pull = ((length - REST) * 0.06) / Math.sqrt(Math.max(1, Math.min(a.degree, b.degree)));
    a.vx += (x / length) * pull;
    a.vy += (y / length) * pull;
    b.vx -= (x / length) * pull;
    b.vy -= (y / length) * pull;
  }
  let moved = 0;
  for (const node of nodes) {
    node.vx = (node.vx - node.x * 0.004) * 0.82;
    node.vy = (node.vy - node.y * 0.004) * 0.82;
    node.x += node.vx;
    node.y += node.vy;
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
