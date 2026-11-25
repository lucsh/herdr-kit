// What the GitHub watcher asks for and what it makes of the answers: which events fire a banner,
// what the banners say, and the "Waiting on you" list. No Herdr imports, so `node --test` runs it.

const PR = 'url number title updatedAt repository{nameWithOwner} author{login}';

export const QUERY_REVIEWS_MERGED = `{
  reviews: search(query:"is:pr is:open user-review-requested:@me", type:ISSUE, first:50){ nodes{ ... on PullRequest { ${PR} } } }
  merged: search(query:"is:pr author:@me is:merged sort:updated-desc", type:ISSUE, first:20){ nodes{ ... on PullRequest { ${PR} mergedAt } } }
}`;

// Pages of 25: one call for all ~40 PRs with their merge state returned HTTP 502.
export const QUERY_MINE = `query($after:String){
  search(query:"is:pr is:open author:@me", type:ISSUE, first:25, after:$after){
    pageInfo{hasNextPage endCursor}
    nodes{ ... on PullRequest { ${PR} isDraft mergeStateStatus autoMergeRequest{enabledAt}
      commits(last:1){nodes{commit{oid statusCheckRollup{contexts(first:100){nodes{__typename
        ... on CheckRun{status conclusion} ... on StatusContext{state}}}}}}} } }
  }
}`;

const STALE_MS = 15 * 60_000;
const MANY = 3;
const MERGED_SLACK_MS = 5 * 60_000;
const MERGED_KEEP = 100;
const PULLS = 'https://github.com/pulls';
const FAILED_RUN = new Set(['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']);
const ORDER = ['review', 'ci', 'ready', 'merged'];
const TITLES = { review: 'Review requested', ci: 'CI failed', ready: 'Ready to merge', merged: 'Merged' };
const COUNTS = {
  review: (n) => `${n} review request${n === 1 ? '' : 's'}`,
  ci: (n) => `${n} CI failure${n === 1 ? '' : 's'}`,
  ready: (n) => `${n} ready to merge`,
  merged: (n) => `${n} merged`,
};

/** The response's `data`, or throws with GitHub's error message. */
function dataOf(response) {
  if (response?.errors?.length) throw new Error(response.errors.map((e) => e.message).join('; '));
  if (!response?.data) throw new Error('GitHub returned no data');
  return response.data;
}

/** The fields every PR kind shares. */
function pr(n) {
  return { url: n.url, repo: n.repository?.nameWithOwner ?? '', number: n.number, title: n.title ?? '', author: n.author?.login ?? '', updatedAt: n.updatedAt };
}

/** True once every check on the commit has finished and at least one failed. */
function ciFailed(contexts) {
  if (!contexts.length) return false;
  const failed = (c) => (c.__typename === 'CheckRun' ? c.status === 'COMPLETED' && FAILED_RUN.has(c.conclusion) : c.state === 'FAILURE' || c.state === 'ERROR');
  const unfinished = (c) => (c.__typename === 'CheckRun' ? c.status !== 'COMPLETED' : c.state === 'PENDING' || c.state === 'EXPECTED');
  return !contexts.some(unfinished) && contexts.some(failed);
}

/** One of Lucas's open PRs, with its head commit, CI outcome and whether it can merge now. */
function minePr(n) {
  const commit = n.commits?.nodes?.[0]?.commit;
  return {
    ...pr(n),
    isDraft: Boolean(n.isDraft),
    sha: commit?.oid ?? '',
    ciFailed: ciFailed(commit?.statusCheckRollup?.contexts?.nodes ?? []),
    ready: !n.isDraft && (n.mergeStateStatus === 'CLEAN' || n.mergeStateStatus === 'HAS_HOOKS') && !n.autoMergeRequest,
    mergeUnknown: n.mergeStateStatus === 'UNKNOWN',
  };
}

/** Turns the QUERY_REVIEWS_MERGED response and the QUERY_MINE pages into a Snapshot. */
export function parsePoll(reviewsMerged, minePages) {
  const rm = dataOf(reviewsMerged);
  const mine = minePages.flatMap((page) => dataOf(page).search?.nodes ?? []);
  return {
    reviews: (rm.reviews?.nodes ?? []).filter((n) => n?.url).map(pr),
    mine: mine.filter((n) => n?.url).map(minePr),
    merged: (rm.merged?.nodes ?? []).filter((n) => n?.url).map((n) => ({ ...pr(n), mergedAt: n.mergedAt })),
  };
}

/** URLs of PRs ready to merge; one GitHub is still recomputing (UNKNOWN) keeps what it was. */
function readyUrls(snap, prev) {
  const was = new Set(prev?.ready ?? []);
  return snap.mine.filter((p) => p.ready || (p.mergeUnknown && was.has(p.url))).map((p) => p.url);
}

/** The new saved state and the events since `prev` (none on a first run, when `prev` is null). */
export function diff(prev, snap, now) {
  const firedBefore = (p) => prev?.ci?.[p.url]?.sha === p.sha && prev.ci[p.url].fired;
  const state = {
    saved_at: now,
    reviews: snap.reviews.map((p) => p.url),
    ci: Object.fromEntries(snap.mine.map((p) => [p.url, { sha: p.sha, fired: p.ciFailed || firedBefore(p) }])),
    ready: readyUrls(snap, prev),
    merged: [...new Set([...snap.merged.map((p) => p.url), ...(prev?.merged ?? [])])].slice(0, MERGED_KEEP),
  };
  if (!prev) return { state, events: [] };
  const event = (kind, p) => ({ kind, url: p.url, repo: p.repo, number: p.number, title: p.title, author: p.author });
  const reviewed = new Set(prev.reviews ?? []), ready = new Set(prev.ready ?? []), announced = new Set(prev.merged ?? []);
  const events = [
    ...snap.reviews.filter((p) => !reviewed.has(p.url)).map((p) => event('review', p)),
    ...snap.mine.filter((p) => p.ciFailed && !firedBefore(p)).map((p) => event('ci', p)),
    ...snap.mine.filter((p) => p.ready && !ready.has(p.url)).map((p) => event('ready', p)),
    ...snap.merged.filter((p) => !announced.has(p.url) && Date.parse(p.mergedAt) >= prev.saved_at - MERGED_SLACK_MS).map((p) => event('merged', p)),
  ];
  return { state, events };
}

/** One banner per event, or a single summary after a long gap or when many arrive at once. */
export function banners(events, prevSavedAt, now) {
  if (!events.length) return [];
  const stale = prevSavedAt != null && now - prevSavedAt > STALE_MS;
  if (stale || events.length > MANY) {
    const body = ORDER.map((k) => [k, events.filter((e) => e.kind === k).length]).filter(([, n]) => n).map(([k, n]) => COUNTS[k](n)).join(', ');
    return [{ title: 'GitHub', body, url: PULLS }];
  }
  return events.map((e) => ({
    title: TITLES[e.kind],
    body: `${e.repo}#${e.number} ${e.title}${e.kind === 'review' ? ` — ${e.author}` : ''}`,
    url: e.url,
  }));
}

/** The "Waiting on you" list: review requests, then failed CI, then ready to merge; newest first in each.
 *  `prev` (the state before this poll) keeps a ready PR listed while GitHub recomputes its merge state. */
export function todo(snap, now, prev = null) {
  const ready = new Set(readyUrls(snap, prev));
  const newest = (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  const item = (kind) => (p) => ({ kind, url: p.url, repo: p.repo, number: p.number, title: p.title, author: p.author, updatedAt: p.updatedAt });
  return {
    fetched_at: new Date(now).toISOString(),
    error: null,
    items: [
      ...[...snap.reviews].sort(newest).map(item('review')),
      ...snap.mine.filter((p) => p.ciFailed).sort(newest).map(item('ci')),
      ...snap.mine.filter((p) => ready.has(p.url)).sort(newest).map(item('ready')),
    ],
  };
}
