// Which notifications leave Herdr: an agent's (it needs you, or finished while you weren't looking)
// becomes a macOS banner whose click runs the same `agent.focus` the in-app toast would.

/** Whether notify.json (written by every HerdrNotify run) says macOS lets it post banners. */
function allowed(notifyRaw) {
  try { return JSON.parse(notifyRaw)?.authorized === true; } catch { return false; }
}

/** The banner for an agent notification, or null to draw it in-app. `notifyRaw` is notify.json's text:
 *  while banners aren't allowed (denied, or the prompt is unanswered) alerts stay in-app. It reflects
 *  the helper's last run, so the first alert after a permission change can still go the old way. */
export function route(props, notifyRaw) {
  if (props?.action?.name !== 'agent.focus' || !allowed(notifyRaw)) return null;
  return { title: props.title ?? '', body: props.body ?? '', do: 'agent.focus', doArgs: JSON.stringify(props.action.args ?? {}) };
}
