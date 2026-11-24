// Bottom status bar: workspace (machine, folder, branch) on the left; the focused Claude session
// (model, context, usage, cost, time, account) on the right. Claude's status line writes its input to
// ~/.cache/herdr-claude/<terminal>.json (see statusLine in ~/.claude/settings.json); this reads it.
import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, agents, focused, theme, run, window, keys, home, exec, readTextFile, watchFolder } from "herdr";

/** "27m", "1h 04m". */
const duration = (ms) => { const m = Math.floor(ms / 60000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`; };
/** Reset time: "21:00" today, else "Thu 23:00". */
const resetAt = (s, weekday) => {
  const d = new Date(s * 1000), hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return weekday ? `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()]} ${hm}` : hm;
};

export default class WorkspaceStatus extends View {
  /** Starts the account read, the Claude file watch and the git check. */
  init(_props, cx) {
    this.dir = `${home()}/.cache/herdr-claude`;
    this.terminal = null; this.raw = null; this.claude = null; this.account = null; this.git = null;
    this.readAccount(cx);
    cx.timer.every(300000, cx => this.readAccount(cx));
    cx.timer.every(15000, cx => this.checkGit(cx, true));
    cx.spawn(async cx => {
      for (;;) {
        try { await watchFolder(this.dir); } catch { await cx.sleep(5000); }
        await this.readClaude(cx);
      }
    });
  }

  /** The signed-in Claude account from ~/.claude.json. */
  readAccount(cx) {
    cx.spawn(async cx => {
      try {
        const a = JSON.parse(await readTextFile(`${home()}/.claude.json`) ?? "{}").oauthAccount;
        this.account = a ? { email: a.emailAddress, org: a.organizationName } : null;
      } catch { this.account = null; }
      cx.notify();
    });
  }

  /** Reloads the focused Claude session's file; redraws only when it changed. */
  async readClaude(cx) {
    if (!this.terminal) return;
    const raw = await readTextFile(`${this.dir}/${this.terminal}.json`).catch(() => null);
    if (!raw || raw === this.raw) return;
    try { this.claude = JSON.parse(raw); this.raw = raw; cx.notify(); } catch {}
  }

  /** Uncommitted file count for the focused folder; `again` rechecks the same folder. */
  checkGit(cx, again = false) {
    const cwd = this.cwd;
    if (!cwd || this.gitBusy || (!again && this.gitCwd === cwd)) return;
    this.gitBusy = true; this.gitCwd = cwd;
    cx.spawn(async cx => {
      const r = await exec("git", ["--no-optional-locks", "status", "--porcelain"], { cwd, timeout: 5000 }).catch(() => null);
      this.gitBusy = false;
      const next = r?.code === 0 ? r.stdout.split("\n").filter(Boolean).length : null;
      if (next !== this.git) { this.git = next; cx.notify(); }
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  /** Muted under 50%, yellow under 80%, accent above. */
  level(t, pct) { return pct >= 80 ? t.accent : pct >= 50 ? t.ansi3 : t.muted; }

  /** Workspace on the left, the focused (or last focused) Claude session on the right. */
  render(cx) {
    const t = theme();
    const space = spaces().find(s => s.active), f = focused();
    const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
    const cwd = pane?.cwd || f?.cwd || space?.folder;
    if (cwd !== this.cwd) { this.cwd = cwd; this.git = null; }
    this.checkGit(cx);
    if (f?.terminal && f.terminal !== this.terminal && /^[\w-]+$/.test(f.terminal)) {
      this.terminal = f.terminal;
      cx.spawn(async cx => {
        const raw = await readTextFile(`${this.dir}/${f.terminal}.json`).catch(() => null);
        if (raw && this.terminal === f.terminal && raw !== this.raw) { try { this.claude = JSON.parse(raw); this.raw = raw; cx.notify(); } catch {} }
      });
    }

    const list = agents(), needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text, color) => h_flex().gap(6).items_center().when(Boolean(color), el => el.text_color(color))
      .child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    const sep = () => div().text_color(t.border).child("│");
    const folder = cwd ? (cwd === home() ? "~" : cwd.split("/").pop()) : null;

    const c = this.claude, ctx = Math.round(c?.context_window?.used_percentage ?? 0);
    const five = c?.rate_limits?.five_hour, week = c?.rate_limits?.seven_day;
    const usage = (name, r, weekday) => h_flex().gap(4).items_center()
      .child(div().text_color(t.dim).child(name))
      .child(div().text_color(this.level(t, r.used_percentage)).child(`${Math.round(r.used_percentage)}%`))
      .when(Boolean(r.resets_at), el => el.child(div().text_color(t.dim).child(`↻${resetAt(r.resets_at, weekday)}`)));
    const meter = h_flex().gap(6).items_center()
      .child(div().w(44).h(5).rounded(3).bg(t.border).overflow_hidden()
        .child(div().h_full().w(Math.max(2, Math.min(44, ctx * 0.44))).rounded(3).bg(this.level(t, ctx))))
      .child(div().text_color(this.level(t, ctx)).child(`${ctx}%`));

    return h_flex().size_full().px(14).gap(14).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(folder), el => el.child(label("folder", folder, t.foreground)))
      .when(Boolean(space?.branch), el => el.child(h_flex().gap(6).items_center().child(label("git-branch", space.branch))
        .when(this.git > 0, el => el.child(div().text_color(t.ansi3).child(`●${this.git}`)))))
      .when(Boolean(c?.cost?.total_lines_added || c?.cost?.total_lines_removed), el => el.child(h_flex().gap(4)
        .child(div().text_color(t.ansi2).child(`+${c.cost.total_lines_added ?? 0}`))
        .child(div().text_color(t.ansi1).child(`−${c.cost.total_lines_removed ?? 0}`))))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .when(Boolean(c), el => el
        .child(h_flex().gap(4).items_center().child(div().text_color(t.foreground).child(c.model?.display_name ?? "Claude"))
          .when(Boolean(c.effort?.level), el => el.child(div().text_color(t.dim).child(c.effort.level))))
        .child(meter)
        .when(Boolean(five), el => el.child(sep()).child(usage("5h", five, false)))
        .when(Boolean(week), el => el.child(usage("wk", week, true)))
        .when(c.cost?.total_cost_usd != null, el => el.child(sep()).child(div().child(`$${c.cost.total_cost_usd.toFixed(2)}`)))
        .when(Boolean(c.cost?.total_duration_ms), el => el.child(label("clock", duration(c.cost.total_duration_ms)))))
      .when(Boolean(this.account?.email), el => el.child(sep()).child(div().max_w(260).truncate().text_color(t.dim).child(this.account.email)))
      .child(sep())
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
