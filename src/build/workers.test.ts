import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { severalAtATime } from "./workers.ts";

const later = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("severalAtATime", () => {
  it("does the work for every number once, and never more at a time than it may", async () => {
    const done: number[] = [];
    let running = 0;
    let most = 0;
    await severalAtATime(20, 6, async (at) => {
      most = Math.max(most, ++running);
      await later(at % 3);
      running--;
      done.push(at);
    });
    assert.deepEqual(
      done.sort((a, b) => a - b),
      Array.from({ length: 20 }, (_, i) => i),
    );
    assert.equal(most, 6);
  });

  it("does nothing for nothing, and takes fewer than it may at a time", async () => {
    let calls = 0;
    const count = async (): Promise<void> => {
      await later(1);
      calls++;
    };
    await severalAtATime(0, 6, count);
    assert.equal(calls, 0);
    await severalAtATime(2, 6, count);
    assert.equal(calls, 2);
  });

  it("starts nothing after a failure, and waits for what runs before it throws the first failure", async () => {
    const started: number[] = [];
    const ended: number[] = [];
    let running = 0;
    const work = severalAtATime(50, 4, async (at) => {
      started.push(at);
      running++;
      try {
        // The second fails first, the first fails later, and the others take longer than both
        await later(at === 1 ? 5 : at === 0 ? 15 : 40);
        if (at < 2) {
          throw new Error(`failure ${String(at)}`);
        }
        ended.push(at);
      } finally {
        running--;
      }
    });
    await assert.rejects(work, /failure 1/);
    assert.equal(running, 0, "nothing runs any more when the failure is told");
    assert.deepEqual(started, [0, 1, 2, 3]);
    assert.deepEqual(ended, [2, 3]);
    await later(60);
    assert.deepEqual(started, [0, 1, 2, 3], "and nothing is started after it");
  });

  it("throws what was thrown, also when that is no error", async () => {
    class Stopped extends Error {}
    await assert.rejects(
      severalAtATime(3, 2, () => Promise.reject(new Stopped())),
      Stopped,
    );
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- what is tried is a thing that is no error
    await assert.rejects(severalAtATime(3, 2, () => Promise.reject("words")), /words/);
  });
});
