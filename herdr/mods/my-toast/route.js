// Which notifications leave Herdr: an agent's (it needs you, or finished while you weren't looking)
// becomes a macOS banner whose click runs the same `agent.focus` the in-app toast would.

/** The banner for an agent notification, or null to draw it in-app (also when herdr-app can't be found). */
export function route(props, herdrPath) {
  if (props?.action?.name !== 'agent.focus' || !herdrPath) return null;
  return { title: props.title ?? '', body: props.body ?? '', do: 'agent.focus', doArgs: JSON.stringify(props.action.args ?? {}) };
}
