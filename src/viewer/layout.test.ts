import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { boundsOf, makeGraph, step, type Graph } from "./layout.ts";

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
    assert.ok(moved < 0.1, `still moving: ${String(moved)}`);
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

  it("does nothing for no notes", () => {
    const g = makeGraph([], () => []);
    assert.equal(step(g), 0);
    assert.deepEqual(boundsOf(g), { left: 0, top: 0, right: 0, bottom: 0 });
  });
});
