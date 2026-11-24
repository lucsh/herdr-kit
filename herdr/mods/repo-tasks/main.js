// Tasks panel: a plain to-do list per git repo, shared by all of the repo's worktrees (keyed by its
// git common dir). Same file format as zamarrowski/herdr-tasks, stored at
// ~/.local/state/herdr-tasks/<common dir with / as _>/tasks.json (outside a repo: .../global/), so a
// `tasks` CLI pointed there with HERDR_PLUGIN_STATE_DIR edits the same list.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, writeTextFile, watchFolder, theme, home } from "herdr";

/** ISO timestamp, as herdr-tasks writes them. */
const now = () => new Date().toISOString();
/** 8 hex characters, like herdr-tasks' ids. */
const newId = () => Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
/** Pending first, then done; each group in stored order. */
const ordered = (tasks) => [...tasks.filter(t => !t.done), ...tasks.filter(t => t.done)];
/** The tasks array from file text; [] when absent or unreadable. */
const parse = (raw) => { try { const d = JSON.parse(raw ?? "{}"); return Array.isArray(d.tasks) ? d.tasks : []; } catch { return []; } };

export default class RepoTasks extends View {
  /** Sets up the add and edit inputs; the list loads once the focused folder's repo is known. */
  init(_props, cx) {
    this.tasks = []; this.raw = null; this.repo = null; this.where = null;
    this.hover = null; this.confirm = null; this.editing = null; this.showDone = true;
    this.input = InputState.new({ placeholder: "Add a task…" });
    this.input.on("submit", (_e, cx) => {
      const text = this.input.value().trim();
      if (!text) return;
      this.input.set_value("");
      this.mutate(cx, tasks => { tasks.push({ id: newId(), text, done: false, created_at: now(), updated_at: now() }); });
    });
    this.edit = InputState.new({});
    this.edit.on("submit", (_e, cx) => {
      const id = this.editing, text = this.edit.value().trim();
      this.editing = null;
      if (text) this.mutate(cx, tasks => { const t = tasks.find(t => t.id === id); if (t) { t.text = text; t.updated_at = now(); } });
      cx.notify();
    });
    this.edit.on("blur", (_e, cx) => { this.editing = null; cx.notify(); });
  }

  /** Finds the focused folder's repo (its git common dir) and opens that list when it changes. */
  locate(cx) {
    const space = spaces().find(s => s.active), f = focused();
    const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
    const cwd = pane?.cwd || f?.cwd || space?.folder || null, on = space?.machine ?? null;
    const where = `${on ?? ""}|${cwd ?? ""}`;
    if (where === this.where) return;
    this.where = where;
    cx.spawn(async cx => {
      const r = cwd ? await exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, on, timeout: 5000 }).catch(() => null) : null;
      if (this.where !== where) return;
      const common = r?.code === 0 ? r.stdout.trim() : null;
      const top = common?.endsWith("/.git") ? common.slice(0, -5) : common;
      this.open(common
        ? { id: `${on ? on + ":" : ""}${common}`.replaceAll("/", "_"), name: top.split("/").pop() || top }
        : { id: "global", name: "No repo · global list" }, cx);
    });
  }

  /** Shows one repo's list and reloads it whenever its folder changes (the CLI writes there too). */
  open(repo, cx) {
    if (this.repo?.id === repo.id) return;
    this.repo = repo; this.tasks = []; this.raw = null; this.confirm = null; this.editing = null;
    this.watch?.cancel();
    const dir = `${home()}/.local/state/herdr-tasks/${repo.id}`;
    this.dir = dir; this.file = `${dir}/tasks.json`;
    cx.spawn(async cx => {
      await exec("mkdir", ["-p", dir]).catch(() => null);
      while (this.dir === dir) {
        const raw = await readTextFile(`${dir}/tasks.json`).catch(() => null);
        if (this.dir !== dir) return;
        if (raw !== this.raw) { this.raw = raw; this.tasks = parse(raw); cx.notify(); }
        this.watch = watchFolder(dir);
        const changed = await this.watch.catch(() => []);
        if (!changed.length) await cx.sleep(2000);
      }
    });
  }

  /** Read, change, write back only if nobody else wrote in between (retries), like herdr-tasks' mutate. */
  mutate(cx, change) {
    const file = this.file;
    if (!file) return;
    cx.spawn(async cx => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const raw = await readTextFile(file).catch(() => null), tasks = parse(raw);
        change(tasks);
        const text = `${JSON.stringify({ version: 1, tasks }, null, 2)}\n`;
        try {
          await writeTextFile(file, text, raw);
          if (this.file === file) { this.raw = text; this.tasks = tasks; cx.notify(); }
          return;
        } catch {}
      }
    });
  }

  /** Done ↔ pending. */
  toggle(id, cx) {
    this.mutate(cx, tasks => { const t = tasks.find(t => t.id === id); if (t) { t.done = !t.done; t.done_at = t.done ? now() : null; t.updated_at = now(); } });
  }

  /** Moves a task up (-1) or down (+1), staying within its own group. */
  move(id, by, cx) {
    this.mutate(cx, tasks => {
      const items = ordered(tasks), from = items.findIndex(t => t.id === id);
      if (from < 0) return;
      const task = items[from], pending = items.filter(t => !t.done).length;
      const [min, max] = task.done ? [pending, items.length - 1] : [0, pending - 1];
      items.splice(from, 1);
      items.splice(Math.max(min, Math.min(from + by, max)), 0, task);
      tasks.splice(0, tasks.length, ...items);
    });
  }

  /** Deletes a task. */
  remove(id, cx) {
    this.confirm = null;
    this.mutate(cx, tasks => { const i = tasks.findIndex(t => t.id === id); if (i >= 0) tasks.splice(i, 1); });
  }

  /** One task: check circle, text (or the edit input), and hover actions. */
  row(t, task) {
    const id = task.id, hovered = this.hover === id, confirming = this.confirm === id;
    const action = (key, label, onClick, color) => div().id(`${key}-${id}`).px(5).h(20).flex().items_center().rounded(5).cursor_pointer()
      .text_size(12).text_color(color ?? t.dim).hover(s => s.bg(t.hover).text_color(color ?? t.foreground))
      .on_click((_e, cx) => { onClick(cx); cx.notify(); }).child(label);
    return h_flex().id(`task-${id}`).relative().min_h(30).flex_none().px(8).py(5).gap(9).items_start().rounded(7).hover(s => s.bg(t.hover))
      .on_hover((h, cx) => { if (h) this.hover = id; else if (this.hover === id) { this.hover = null; if (this.confirm === id) this.confirm = null; } cx.notify(); })
      .child(div().id(`check-${id}`).mt(2).size(15).flex_none().flex().items_center().justify_center().rounded(8).cursor_pointer()
        .border(1.5).border_color(task.done ? t.accent : t.input).when(task.done, el => el.bg(t.accent))
        .on_click((_e, cx) => this.toggle(id, cx))
        .when(task.done, el => el.child(svg("mods/workspace-chrome/check.svg").size(10).text_color(t.accent_foreground))))
      .child(this.editing === id
        ? Input.new(this.edit).flex_1().min_w(0).h(20).text_size(13).text_color(t.foreground)
        : div().flex_1().min_w(0).whitespace_normal().text_size(13).text_color(task.done ? t.dim : t.foreground)
            .when(task.done, el => el.line_through()).child(task.text))
      // Floats over the row's top-right corner so hovering never reflows the task text.
      .when(hovered && this.editing !== id, el => el.child(h_flex().absolute().top(4).right(6).gap(1).items_center()
        .px(2).h(24).rounded(6).bg(t.raised ?? t.background).border_1().border_color(t.border).shadow_sm()
        .child(action("up", "↑", cx => this.move(id, -1, cx)))
        .child(action("down", "↓", cx => this.move(id, 1, cx)))
        .child(action("edit", "✎", () => { this.editing = id; this.edit.set_value(task.text); this.edit.focus(); }))
        .child(confirming
          ? action("delete", "Delete?", cx => this.remove(id, cx), t.blocked)
          : action("delete", "×", () => { this.confirm = id; }))));
  }

  /** Header with the repo, the add box, pending tasks, then a collapsible done group. */
  render(cx) {
    this.locate(cx);
    const t = theme(), items = ordered(this.tasks);
    const pending = items.filter(x => !x.done), done = items.filter(x => x.done);
    return v_flex().id("tasks").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Tasks"))
        .when(pending.length > 0, el => el.child(div().px(6).rounded(5).bg(t.hover).text_size(11).text_color(t.muted).child(String(pending.length))))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.repo?.name ?? "")))
      .child(h_flex().h(30).flex_none().mx(8).mt(8).px(8).gap(6).items_center().rounded(7).border_1().border_color(t.border).bg(t.background)
        .child(div().text_color(t.dim).child("+"))
        .child(Input.new(this.input).flex_1().min_w(0).h_full().text_size(12).text_color(t.foreground)))
      .child(v_flex().id("tasks-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
        .children(pending.map(task => this.row(t, task)))
        .when(!items.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(this.repo ? "No tasks yet" : "Loading…")))
        .when(done.length > 0, el => el
          .child(h_flex().id("tasks-done").mt(8).px(8).h(24).gap(6).items_center().cursor_pointer().text_size(11).text_color(t.dim)
            .hover(s => s.text_color(t.foreground)).on_click((_e, cx) => { this.showDone = !this.showDone; cx.notify(); })
            .child(svg(`mods/workspace-chrome/chevron-${this.showDone ? "down" : "right"}.svg`).size(12)).child(`Done · ${done.length}`))
          .when(this.showDone, el => el.children(done.map(task => this.row(t, task))))));
  }
}
