// Several copies of the watcher can run (one per Herdr window). Each writes the new state only if
// the file still holds what it read; the copy whose write lands posts the banners, the others don't.

/** Writes `nextRaw` over `prevRaw` and, only if that write wins, posts each banner in order. */
export async function claimAndPost({ prevRaw, nextRaw, write, post, banners }) {
  try {
    await write(nextRaw, prevRaw);
  } catch {
    return false;
  }
  for (const b of banners) await post(b);
  return true;
}
