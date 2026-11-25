// GitHub watcher: once a minute asks GitHub (through `gh`) for review requests that name you and
// for your open and recently merged PRs, posts a macOS banner for each new event through
// HerdrNotify.app, and writes the "Waiting on you" list the Pull requests panel shows.
// Draws nothing; main-md mounts it in a 0 px block beside the status bar so it always runs.
import { View, div } from "gpui-kit";
import { exec, readTextFile, writeTextFile, home, checking, nextCommand } from "herdr";
import { QUERY_REVIEWS_MERGED, QUERY_MINE, parsePoll, diff, banners, todo } from "./watch.js";
import { claimAndPost } from "./claim.js";

const POLL_MS = 60_000;

/** Runs `gh api graphql` with the query (and variables) and returns the parsed response. */
async function graphql(query, vars = {}) {
  const args = ["api", "graphql", "-f", `query=${query}`];
  for (const [k, v] of Object.entries(vars)) args.push("-f", `${k}=${v}`);
  const r = await exec("gh", args, { timeout: 60_000 });
  if (r.code !== 0) throw new Error(String(r.stderr).trim().split("\n")[0] || "gh api graphql failed");
  return JSON.parse(r.stdout);
}

export default class GhBanners extends View {
  /** Polls now, then every minute and on the `gh-banners.refresh` command. */
  init(_props, cx) {
    if (checking()) return;
    this.dir = `${home()}/.cache/herdr-github`;
    this.app = `${home()}/.local/share/herdr-notify/HerdrNotify.app`;
    this.busy = false;
    cx.spawn(async () => {
      await exec("mkdir", ["-p", this.dir]).catch(() => null);
      await this.poll();
    });
    cx.timer.every(POLL_MS, () => { cx.spawn(() => this.poll()); });
    cx.spawn(async () => {
      for (;;) if ((await nextCommand()) === "refresh") await this.poll();
    });
  }

  /** One round: fetch, diff against the saved state, post what's new, write the to-do list. */
  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      const reviewsMerged = await graphql(QUERY_REVIEWS_MERGED);
      const pages = [];
      let after = null;
      do {
        const page = await graphql(QUERY_MINE, after ? { after } : {});
        pages.push(page);
        const info = page?.data?.search?.pageInfo;
        after = info?.hasNextPage ? info.endCursor : null;
      } while (after);
      const snap = parsePoll(reviewsMerged, pages);
      const now = Date.now();
      const statePath = `${this.dir}/state.json`;
      const prevRaw = await readTextFile(statePath);
      let prev = null;
      try { prev = prevRaw ? JSON.parse(prevRaw) : null; } catch {}
      const { state, events } = diff(prev, snap, now);
      await claimAndPost({
        prevRaw,
        nextRaw: JSON.stringify(state),
        write: (text, expected) => writeTextFile(statePath, text, expected),
        post: (b) => exec("open", ["-n", "-g", "-a", this.app, "--args", "--title", b.title, "--body", b.body, "--url", b.url]).catch(() => null),
        banners: banners(events, prev?.saved_at ?? null, now),
      });
      await this.writeTodo(todo(snap, now));
    } catch (error) {
      await this.writeTodo(null, error?.message ?? String(error));
    } finally {
      this.busy = false;
    }
  }

  /** Replaces todo.json with `next`, or on a failed poll keeps its items and records the error. */
  async writeTodo(next, error) {
    const path = `${this.dir}/todo.json`;
    const raw = await readTextFile(path).catch(() => null);
    if (!next) {
      let last = null;
      try { last = raw ? JSON.parse(raw) : null; } catch {}
      next = { fetched_at: last?.fetched_at ?? null, items: last?.items ?? [], error, tried_at: new Date().toISOString() };
    }
    await writeTextFile(path, JSON.stringify(next), raw).catch(() => null);
  }

  /** Nothing to show. */
  render() {
    return div().size(0);
  }
}
