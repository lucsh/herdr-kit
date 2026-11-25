// The "Waiting on you" tab's data: ~/.cache/herdr-github/todo.json, written by the gh-banners mod.
const STALE_MS = 15 * 60_000;

/** "09:30", local time. */
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** The list's items, an "as of HH:MM" note once the last good fetch is old, and the last error. */
export function waitingView(raw, now) {
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!data || typeof data !== 'object') return { items: [], note: null, error: null };
  const fetched = data.fetched_at ? Date.parse(data.fetched_at) : NaN;
  return {
    items: Array.isArray(data.items) ? data.items : [],
    note: Number.isFinite(fetched) && now - fetched > STALE_MS ? `as of ${hm(new Date(fetched))}` : null,
    error: data.error ?? null,
  };
}
