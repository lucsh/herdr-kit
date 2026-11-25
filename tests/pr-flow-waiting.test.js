import { test } from "node:test";
import assert from "node:assert/strict";
import { waitingView } from "../herdr/mods/pr-flow/waiting.js";
import { createTracker } from "../herdr/mods/pr-flow/tracker.js";

const T = Date.parse("2026-11-25T12:00:00Z");
const MIN = 60_000;
const item = { kind: "review", url: "https://github.com/o/r/pull/1", repo: "o/r", number: 1, title: "T", author: "alice", updatedAt: "2026-11-25T11:00:00Z" };
const file = (ageMs, extra = {}) => JSON.stringify({ fetched_at: new Date(T - ageMs).toISOString(), error: null, items: [item], ...extra });

test("waitingView: fresh", () => {
  assert.deepEqual(waitingView(file(2 * MIN), T), { items: [item], note: null, error: null });
});

test("waitingView: stale", () => {
  const v = waitingView(file(20 * MIN), T);
  assert.match(v.note, /^as of \d\d:\d\d$/);
  assert.equal(v.items.length, 1);
});

test("waitingView: error", () => {
  const v = waitingView(file(MIN, { error: "HTTP 502" }), T);
  assert.equal(v.error, "HTTP 502");
  assert.deepEqual(v.items, [item]);
});

test("waitingView: missing", () => {
  assert.deepEqual(waitingView(null, T), { items: [], note: null, error: null });
  assert.deepEqual(waitingView("{nope", T), { items: [], note: null, error: null });
});

test("waitingView: never fetched", () => {
  const v = waitingView(JSON.stringify({ fetched_at: null, error: "gh: not logged in", items: [] }), T);
  assert.deepEqual(v, { items: [], note: null, error: "gh: not logged in" });
});

const URL1 = "https://github.com/o/r/pull/1";
function fakeTracker() {
  const saves = [];
  const pr = { number: 1, title: "T", body: "", url: URL1, state: "OPEN", isDraft: false, headRefName: "b", headRefOid: "x", statusCheckRollup: [], latestReviews: [], reviewDecision: "", updatedAt: "2026-11-25T11:00:00Z", files: [] };
  const tracker = createTracker({
    gh: { fetchPr: async () => pr, fetchThreads: async () => ({ threads: [], issues: [], headCommittedAt: null }) },
    remoteOf: async () => null,
    store: { load: () => ({}), save: (d) => saves.push(Object.keys(d)) },
    settings: { pollMs: 30_000, ciWaitMs: 120_000, aiChecks: [], mine: false },
    now: () => T,
  });
  return { tracker, saves };
}

test("tracker peek: shown, never saved, then dropped", async () => {
  const { tracker, saves } = fakeTracker();
  await tracker.peek(URL1);
  const card = tracker.cards().find((c) => c.url === URL1);
  assert.equal(card?.peek, true);
  assert.ok(saves.every((keys) => !keys.includes(URL1)));
  tracker.unpeek(URL1);
  assert.equal(tracker.cards().length, 0);
});

test("tracker peek: a tracked PR stays tracked", async () => {
  const { tracker } = fakeTracker();
  tracker.track(URL1);
  await tracker.peek(URL1);
  tracker.unpeek(URL1);
  assert.equal(tracker.cards()[0]?.peek, false);
});

test("tracker peek: discovery promotes a peeked PR", async () => {
  const { tracker, saves } = fakeTracker();
  await tracker.peek(URL1);
  tracker.track(URL1);
  await tracker.refresh(URL1);
  assert.equal(tracker.cards()[0].peek, false);
  assert.ok(saves.at(-1).includes(URL1));
});
