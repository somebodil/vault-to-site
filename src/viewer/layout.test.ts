import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundsOf, makeGraph, paintOf, step, type Graph } from "./layout.ts";

const links: Record<string, string[]> = { a: ["b", "c", "b", "a", "gone"], b: ["a"], c: [], d: [] };
const graph = (): Graph => makeGraph(["a", "b", "c", "d"], (id) => links[id] ?? []);

function distance(g: Graph, a: number, b: number): number {
  const p = g.nodes[a];
  const q = g.nodes[b];
  assert.ok(p !== undefined && q !== undefined);
  return Math.hypot(p.x - q.x, p.y - q.y);
}

describe("makeGraph", () => {
  it("keeps one link between two notes, and none to itself or to a note that is not there", () => {
    const g = graph();
    assert.deepEqual(g.links, [
      [0, 1],
      [0, 2],
    ]);
    assert.deepEqual(
      g.nodes.map((node) => node.degree),
      [2, 1, 1, 0],
    );
  });

  it("starts with every note on a spot of its own, the same every time", () => {
    const one = graph();
    const other = graph();
    assert.deepEqual(one.nodes, other.nodes);
    assert.equal(new Set(one.nodes.map((node) => `${String(node.x)},${String(node.y)}`)).size, 4);
  });
});

describe("step", () => {
  it("settles, with linked notes nearer to each other than notes without a link", () => {
    const g = graph();
    let moved = Infinity;
    for (let i = 0; i < 400; i++) {
      moved = step(g);
    }
    // Not to a stop: the notes go on drifting by a tenth of a point a step, which the eye does not see
    assert.ok(moved < 0.3, `still moving: ${String(moved)}`);
    assert.ok(distance(g, 0, 1) < distance(g, 1, 3));
    assert.ok(distance(g, 0, 2) < distance(g, 2, 3));
    assert.ok(distance(g, 0, 1) > 15, "linked notes do not lie on each other");
    for (const node of g.nodes) {
      assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y));
    }
  });

  it("takes notes apart that start on the same spot", () => {
    const g = makeGraph(["a", "b"], () => []);
    for (const node of g.nodes) {
      node.x = 5;
      node.y = 5;
    }
    for (let i = 0; i < 50; i++) {
      step(g);
    }
    assert.ok(distance(g, 0, 1) > 5);
  });

  it("stays in a bounded space with many notes", () => {
    const ids = Array.from({ length: 1500 }, (_, i) => String(i));
    const g = makeGraph(ids, (id) => [String((Number(id) * 7 + 1) % 1500), String((Number(id) * 13 + 5) % 1500)]);
    for (let i = 0; i < 60; i++) {
      step(g);
    }
    const box = boundsOf(g);
    assert.ok(box.right - box.left < 20000 && box.bottom - box.top < 20000);
    assert.ok(box.right - box.left > 200);
  });

  it("stays whole around a note with hundreds of links", () => {
    for (const count of [120, 300, 1500]) {
      const ids = Array.from({ length: count + 1 }, (_, i) => String(i));
      const g = makeGraph(ids, (id) => (id === "0" ? ids.slice(1) : []));
      for (let i = 0; i < 300; i++) {
        step(g);
      }
      const box = boundsOf(g);
      assert.ok(Number.isFinite(box.left) && Number.isFinite(box.right), `not a number with ${String(count)} links`);
      assert.ok(box.right - box.left < 6000 && box.bottom - box.top < 6000, `flew apart with ${String(count)} links: ${JSON.stringify(box)}`);
    }
  });

  it("stays whole with thousands of notes of which a few have most of the links", () => {
    // Each note links to an earlier one, more often to those that have many links already
    let seed = 7;
    const random = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    const ends: number[] = [0];
    const linksOf: number[][] = [[]];
    for (let i = 1; i < 5000; i++) {
      const to = ends[Math.floor(random() * ends.length)] ?? 0;
      linksOf.push([to]);
      ends.push(to, i);
    }
    const g = makeGraph(
      linksOf.map((_, i) => String(i)),
      (id) => (linksOf[Number(id)] ?? []).map(String),
    );
    let moved = 0;
    for (let i = 0; i < 120; i++) {
      moved = step(g);
    }
    assert.ok(Number.isFinite(moved));
    const box = boundsOf(g);
    assert.ok(box.right - box.left < 40000 && box.bottom - box.top < 40000, JSON.stringify(box));
    assert.ok(Math.max(...g.nodes.map((node) => node.degree)) > 50, "the graph of the test has a note with many links");
  });

  it("does nothing for no notes", () => {
    const g = makeGraph([], () => []);
    assert.equal(step(g), 0);
    assert.deepEqual(boundsOf(g), { left: 0, top: 0, right: 0, bottom: 0 });
  });
});

describe("paintOf", () => {
  it("paints every note in the light while the pointer is on none, and marks the note that is open", () => {
    assert.deepEqual(
      [0, 1, 2].map((at) => paintOf(at, 1, -1, null)),
      [2, 3, 2],
    );
    assert.equal(paintOf(0, -1, -1, null), 2);
  });

  it("keeps in the light only the note under the pointer and the notes it has links with", () => {
    // The pointer is on note 0, which has a link with note 1. Note 3 is open.
    const near = new Set([1]);
    assert.deepEqual(
      [0, 1, 2, 3].map((at) => paintOf(at, 3, 0, near)),
      [3, 2, 0, 1],
    );
    // The note that is open is in the light when it has a link with the one under the pointer
    assert.equal(paintOf(1, 1, 0, near), 3);
  });
});
