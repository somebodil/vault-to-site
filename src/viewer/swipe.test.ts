import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { endsOpen, FLICK, shiftOf, sideFor, SLOP, speedOf, wayOf } from "./swipe.ts";

describe("wayOf", () => {
  it("is not known while the finger has hardly moved", () => {
    assert.equal(wayOf(0, 0), null);
    assert.equal(wayOf(SLOP - 1, -(SLOP - 1)), null);
  });

  it("is sideways only when that is clear", () => {
    assert.equal(wayOf(SLOP, 0), "sideways");
    // What a browser first tells of a finger: some pixels one way, hardly any the other
    assert.equal(wayOf(8, 2), "sideways");
    assert.equal(wayOf(-30, 12), "sideways");
    assert.equal(wayOf(30, 25), "along");
    assert.equal(wayOf(12, 12), "along");
  });

  it("is along the note for a finger that scrolls", () => {
    assert.equal(wayOf(0, SLOP), "along");
    assert.equal(wayOf(4, -40), "along");
  });
});

describe("sideFor", () => {
  it("uncovers the left side for a finger that goes right, and the right side for one that goes left", () => {
    assert.equal(sideFor(null, 20), "left");
    assert.equal(sideFor(null, -20), "right");
  });

  it("covers the side that is open, and does nothing the other way", () => {
    assert.equal(sideFor("left", -20), "left");
    assert.equal(sideFor("left", 20), null);
    assert.equal(sideFor("right", 20), "right");
    assert.equal(sideFor("right", -20), null);
  });
});

describe("shiftOf", () => {
  it("follows the finger from the place of the note, and not past the width of the side", () => {
    assert.equal(shiftOf("left", false, 0, 300), 0);
    assert.equal(shiftOf("left", false, 120, 300), 120);
    assert.equal(shiftOf("left", false, 500, 300), 300);
    assert.equal(shiftOf("left", false, -50, 300), 0);
    assert.equal(shiftOf("right", false, -120, 300), -120);
    assert.equal(shiftOf("right", false, -500, 300), -300);
    assert.equal(shiftOf("right", false, 50, 300) === 0, true);
  });

  it("starts from the side when that was open", () => {
    assert.equal(shiftOf("left", true, 0, 300), 300);
    assert.equal(shiftOf("left", true, -100, 300), 200);
    assert.equal(shiftOf("left", true, -400, 300), 0);
    assert.equal(shiftOf("left", true, 80, 300), 300);
    assert.equal(shiftOf("right", true, 0, 300), -300);
    assert.equal(shiftOf("right", true, 100, 300), -200);
    assert.equal(shiftOf("right", true, 400, 300) === 0, true);
  });
});

describe("speedOf", () => {
  it("is what the finger did in its last moments", () => {
    assert.equal(speedOf([], 1000), 0);
    assert.equal(speedOf([[10, 1000]], 1000), 0);
    assert.equal(
      speedOf(
        [
          [0, 1000],
          [50, 1100],
        ],
        1105,
      ),
      0.5,
    );
    assert.equal(
      speedOf(
        [
          [300, 1000],
          [300, 1500],
          [260, 1550],
        ],
        1560,
      ),
      -0.8,
    );
  });

  it("is taken from the place before, where the last moments hold one place only", () => {
    // The finger came down, and all its moves were told as one
    assert.equal(
      speedOf(
        [
          [100, 1000],
          [170, 1070],
        ],
        1075,
      ),
      1,
    );
    assert.equal(
      speedOf(
        [
          [0, 1000],
          [90, 1300],
        ],
        1305,
      ),
      0.3,
    );
  });

  it("is nothing for a finger that rested before it was lifted", () => {
    // A finger that rests sends nothing, so its last moves are still the fast ones
    const fast: [number, number][] = [
      [0, 1000],
      [50, 1100],
    ];
    assert.equal(speedOf(fast, 1200), 0.5);
    assert.equal(speedOf(fast, 1201), 0);
    assert.equal(speedOf(fast, 2100), 0);
    // One that slowed down while it still moved has the speed of its end
    assert.equal(
      speedOf(
        [
          [0, 1000],
          [200, 1100],
          [200, 1400],
          [200, 1450],
        ],
        1460,
      ),
      0,
    );
  });
});

describe("endsOpen", () => {
  it("goes where a flick sends the note, wherever the note is", () => {
    assert.equal(endsOpen("left", 20, FLICK, 300), true);
    assert.equal(endsOpen("left", 280, -FLICK, 300), false);
    assert.equal(endsOpen("right", -20, -FLICK, 300), true);
    assert.equal(endsOpen("right", -280, FLICK, 300), false);
  });

  it("goes where the note is nearer to without a flick", () => {
    assert.equal(endsOpen("left", 151, 0, 300), true);
    assert.equal(endsOpen("left", 150, 0.1, 300), false);
    assert.equal(endsOpen("right", -151, 0, 300), true);
    assert.equal(endsOpen("right", -100, -0.1, 300), false);
  });
});
