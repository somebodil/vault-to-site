/**
 * Does a piece of work for each number below `count`, several at a time.
 *
 * When one of them cannot go on, as when a write fails or the build is
 * stopped, no other is started, and those that run are waited for: none is
 * left to write into a build that is over, or to say how far it is after
 * the build has said that it failed. Then the first failure is thrown.
 *
 * @param atATime how many run at the same time, at most
 * @param work is given each number from 0 on, once, in order
 */
export async function severalAtATime(count: number, atATime: number, work: (at: number) => Promise<void>): Promise<void> {
  let next = 0;
  // Kept in an object: what a function sets from inside is not seen by the compiler on a plain variable
  const first: { failure: Error | null } = { failure: null };
  const worker = async (): Promise<void> => {
    while (next < count && first.failure === null) {
      try {
        await work(next++);
      } catch (error) {
        first.failure ??= error instanceof Error ? error : new Error(String(error));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(atATime, count) }, worker));
  if (first.failure !== null) {
    throw first.failure;
  }
}
