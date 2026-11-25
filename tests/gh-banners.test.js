import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePoll, diff, banners, todo } from "../herdr/mods/gh-banners/watch.js";

const T = Date.parse("2026-11-25T12:00:00Z");
const MIN = 60_000;

const node = (n, extra = {}) => ({
  url: `https://github.com/o/r/pull/${n}`, number: n, title: `Title ${n}`, updatedAt: "2026-11-25T10:00:00Z",
  repository: { nameWithOwner: "o/r" }, author: { login: "alice" }, ...extra,
});
const run = (status, conclusion = null) => ({ __typename: "CheckRun", status, conclusion });
const ctx = (state) => ({ __typename: "StatusContext", state });
const mineNode = (n, { contexts = [], sha = "a", isDraft = false, mergeStateStatus = "BLOCKED", autoMergeRequest = null, updatedAt } = {}) =>
  node(n, {
    isDraft, mergeStateStatus, autoMergeRequest, ...(updatedAt ? { updatedAt } : {}),
    commits: { nodes: [{ commit: { oid: sha, statusCheckRollup: contexts === null ? null : { contexts: { nodes: contexts } } } }] },
  });
const responses = ({ reviews = [], merged = [], mine = [] } = {}) => [
  { data: { reviews: { nodes: reviews }, merged: { nodes: merged } } },
  [{ data: { search: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: mine } } }],
];
const snap = (parts) => parsePoll(...responses(parts));
const mineOf = (contexts, opts = {}) => snap({ mine: [mineNode(1, { contexts, ...opts })] }).mine[0];

test("parsePoll: CI waits for every check", () => {
  assert.equal(mineOf([run("COMPLETED", "FAILURE"), run("IN_PROGRESS")]).ciFailed, false);
  assert.equal(mineOf([run("COMPLETED", "FAILURE"), run("COMPLETED", "SUCCESS")]).ciFailed, true);
  assert.equal(mineOf([ctx("ERROR")]).ciFailed, true);
  assert.equal(mineOf([ctx("FAILURE"), ctx("PENDING")]).ciFailed, false);
  assert.equal(mineOf([run("COMPLETED", "TIMED_OUT")]).ciFailed, true);
  assert.equal(mineOf([run("COMPLETED", "SUCCESS")]).ciFailed, false);
  assert.equal(mineOf([]).ciFailed, false);
  assert.equal(mineOf(null).ciFailed, false);
});

test("parsePoll: ready", () => {
  assert.equal(mineOf([], { mergeStateStatus: "CLEAN" }).ready, true);
  assert.equal(mineOf([], { mergeStateStatus: "HAS_HOOKS" }).ready, true);
  assert.equal(mineOf([], { mergeStateStatus: "UNSTABLE" }).ready, false);
  assert.equal(mineOf([], { mergeStateStatus: "CLEAN", autoMergeRequest: { enabledAt: "x" } }).ready, false);
  assert.equal(mineOf([], { mergeStateStatus: "CLEAN", isDraft: true }).ready, false);
});

test("parsePoll: flattens a PR", () => {
  const s = snap({ reviews: [node(7)], mine: [mineNode(3, { sha: "abc" })], merged: [node(4, { mergedAt: "2026-11-25T11:00:00Z" })] });
  assert.deepEqual(s.reviews[0], { url: "https://github.com/o/r/pull/7", repo: "o/r", number: 7, title: "Title 7", author: "alice", updatedAt: "2026-11-25T10:00:00Z" });
  assert.equal(s.mine[0].sha, "abc");
  assert.equal(s.merged[0].mergedAt, "2026-11-25T11:00:00Z");
});

test("parsePoll: errors throw", () => {
  assert.throws(() => parsePoll({ errors: [{ message: "x" }] }, []), /x/);
  assert.throws(() => parsePoll(...responses().slice(0, 1), [{ errors: [{ message: "page broke" }] }]), /page broke/);
  assert.throws(() => parsePoll({}, []), Error);
});

test("diff: first run is silent", () => {
  const s = snap({ reviews: [node(1)], mine: [mineNode(2, { contexts: [ctx("FAILURE")], mergeStateStatus: "CLEAN" })], merged: [node(3, { mergedAt: "2026-11-25T11:59:00Z" })] });
  assert.deepEqual(diff(null, s, T).events, []);
});

test("diff: review fires once", () => {
  const empty = diff(null, snap(), T).state;
  const one = snap({ reviews: [node(5)] });
  const first = diff(empty, one, T + MIN);
  assert.deepEqual(first.events.map((e) => [e.kind, e.number, e.author]), [["review", 5, "alice"]]);
  assert.deepEqual(diff(first.state, one, T + 2 * MIN).events, []);
  const gone = diff(first.state, snap(), T + 3 * MIN).state;
  assert.deepEqual(diff(gone, one, T + 4 * MIN).events.map((e) => e.kind), ["review"]);
});

test("diff: ci fires once per sha", () => {
  const failedA = snap({ mine: [mineNode(1, { sha: "a", contexts: [ctx("FAILURE")] })] });
  const pendingB = snap({ mine: [mineNode(1, { sha: "b", contexts: [ctx("PENDING")] })] });
  const failedB = snap({ mine: [mineNode(1, { sha: "b", contexts: [ctx("FAILURE")] })] });
  const s0 = diff(null, snap({ mine: [mineNode(1, { sha: "a", contexts: [ctx("PENDING")] })] }), T).state;
  const s1 = diff(s0, failedA, T + MIN);
  assert.deepEqual(s1.events.map((e) => e.kind), ["ci"]);
  const s2 = diff(s1.state, failedA, T + 2 * MIN);
  assert.deepEqual(s2.events, []);
  const s3 = diff(s2.state, pendingB, T + 3 * MIN);
  assert.deepEqual(s3.events, []);
  assert.deepEqual(diff(s3.state, failedB, T + 4 * MIN).events.map((e) => e.kind), ["ci"]);
});

test("diff: ready fires on transition", () => {
  const blocked = snap({ mine: [mineNode(1, { mergeStateStatus: "BLOCKED" })] });
  const clean = snap({ mine: [mineNode(1, { mergeStateStatus: "CLEAN" })] });
  const s1 = diff(diff(null, blocked, T).state, clean, T + MIN);
  assert.deepEqual(s1.events.map((e) => e.kind), ["ready"]);
  assert.deepEqual(diff(s1.state, clean, T + 2 * MIN).events, []);
});

test("diff: merged window", () => {
  const prev = diff(null, snap(), T).state;
  const at = (ms) => snap({ merged: [node(9, { mergedAt: new Date(T - ms).toISOString() })] });
  assert.deepEqual(diff(prev, at(4 * MIN), T + MIN).events.map((e) => e.kind), ["merged"]);
  assert.deepEqual(diff(prev, at(6 * MIN), T + MIN).events, []);
});

const ev = (kind, n, author = "alice") => ({ kind, url: `https://github.com/o/r/pull/${n}`, repo: "o/r", number: n, title: "Title", author });

test("banners: one each", () => {
  assert.deepEqual(banners([ev("review", 1), ev("ci", 2)], T - MIN, T), [
    { title: "Review requested", body: "o/r#1 Title — alice", url: "https://github.com/o/r/pull/1" },
    { title: "CI failed", body: "o/r#2 Title", url: "https://github.com/o/r/pull/2" },
  ]);
  assert.deepEqual(banners([ev("ready", 3), ev("merged", 4)], T - MIN, T).map((b) => [b.title, b.body]), [
    ["Ready to merge", "o/r#3 Title"], ["Merged", "o/r#4 Title"],
  ]);
  assert.deepEqual(banners([], T - 8 * 60 * MIN, T), []);
});

test("banners: summary when stale", () => {
  assert.deepEqual(banners([ev("ci", 2), ev("review", 1)], T - 8 * 60 * MIN, T), [
    { title: "GitHub", body: "1 review request, 1 CI failure", url: "https://github.com/pulls" },
  ]);
});

test("banners: summary when many", () => {
  const four = [ev("merged", 1), ev("review", 2), ev("review", 3), ev("ready", 4)];
  assert.deepEqual(banners(four, T - MIN, T), [
    { title: "GitHub", body: "2 review requests, 1 ready to merge, 1 merged", url: "https://github.com/pulls" },
  ]);
  assert.equal(banners(four.slice(0, 3), T - MIN, T).length, 3);
  assert.equal(banners([ev("ci", 1), ev("ci", 2), ev("ci", 3), ev("ci", 4)], T - MIN, T)[0].body, "4 CI failures");
});

test("todo: order", () => {
  const s = snap({
    reviews: [node(1, { updatedAt: "2026-11-25T09:00:00Z" }), node(2, { updatedAt: "2026-11-25T11:00:00Z" })],
    mine: [
      mineNode(3, { mergeStateStatus: "CLEAN" }),
      mineNode(4, { contexts: [ctx("FAILURE")] }),
      mineNode(5, { contexts: [ctx("PENDING")] }),
    ],
    merged: [node(6, { mergedAt: "2026-11-25T11:00:00Z" })],
  });
  const t = todo(s, T);
  assert.equal(t.fetched_at, "2026-11-25T12:00:00.000Z");
  assert.equal(t.error, null);
  assert.deepEqual(t.items.map((i) => [i.kind, i.number]), [["review", 2], ["review", 1], ["ci", 4], ["ready", 3]]);
});
