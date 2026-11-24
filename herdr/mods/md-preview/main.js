// Markdown preview pane. props.file: a .md file to show; without one, lists the .md files under the focused folder.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { spaces, panes, focused, exec, readTextFile, watchFolder, theme, checking, notify, home, props as hostProps } from "herdr";

const dirname = (p) => p.replace(/\/[^/]*$/, "") || "/";
// A markdown path in copied text ("Wrote docs/plan.md:12", "`~/notes.md`"), resolved against root.
const mdPath = (text, root) => {
  const m = text?.slice(0, 4000).match(/(?:~|\.{0,2})?\/?[\w.@+~\/-]*[\w-]\.(?:md|markdown)\b/i)?.[0];
  if (!m) return null;
  if (m.startsWith("~/")) return home() + m.slice(1);
  return m.startsWith("/") ? m : root ? `${root}/${m}` : null;
};

export default class MdPreview extends View {
  init(_props, cx) {
    const props = hostProps() ?? _props;
    const f = focused(), pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
    this.root = props?.folder || pane?.cwd || f?.cwd || spaces().find(s => s.active)?.folder || null;
    this.files = [];
    this.file = null;
    if (checking()) return;
    if (props?.file) return this.open(props.file, cx);
    const copied = mdPath(cx.read_from_clipboard(), this.root);
    if (!copied) return this.list(cx);
    cx.spawn(async (cx) => {
      const exists = await readTextFile(copied).then(t => t != null, () => false);
      if (exists) this.open(copied, cx); else this.list(cx);
      cx.notify();
    });
  }

  list(cx) {
    this.file = null;
    this.watch?.cancel();
    if (!this.root) return;
    cx.spawn(async (cx) => {
      const r = await exec("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.md", "*.markdown"], { cwd: this.root }).catch(() => null);
      const out = r?.code === 0 ? r.stdout
        : (await exec("sh", ["-c", "find . -maxdepth 3 -name '*.md' -not -path '*/node_modules/*' -not -path './Library/*' 2>/dev/null | head -500"], { cwd: this.root }).catch(() => null))?.stdout ?? "";
      this.files = out.split("\n").map(s => s.replace(/^\.\//, "")).filter(Boolean).sort().slice(0, 500);
      cx.notify();
    });
  }

  open(path, cx) {
    this.file = path.startsWith("/") ? path : `${this.root}/${path}`;
    this.text = null;
    this.error = null;
    this.watch?.cancel();
    const file = this.file;
    cx.spawn(async (cx) => {
      while (this.file === file) {
        try { this.text = await readTextFile(file); this.error = null; }
        catch { this.error = `Cannot read ${file}`; }
        cx.notify();
        this.watch = watchFolder(dirname(file));
        const changed = await this.watch.catch(() => []);
        if (!changed.length) return;
      }
    });
  }

  link(url, cx) {
    if (/^[a-z]+:/i.test(url)) { exec("open", [url]); return; }
    const target = url.split("#")[0];
    if (target) this.open(target.startsWith("/") ? target : `${dirname(this.file)}/${target}`, cx);
  }

  close() { this.watch?.cancel(); }

  render(cx) {
    const t = theme();
    const header = h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
      .when(Boolean(this.file), el => el.child(div().id("md-back").cursor_pointer().text_color(t.muted)
        .on_click((_e, cx) => { this.list(cx); cx.notify(); }).child("←")))
      .child(div().font_semibold().child("Markdown"))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim)
        .child(this.file?.split("/").pop() ?? this.root ?? ""))
      .when(this.text != null && Boolean(this.file), el => el.child(div().id("md-copy").px(8).py(2).rounded(6).text_size(12)
        .cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { cx.write_to_clipboard(this.text); notify({ title: "Markdown copied", timeout: 1500 }); })
        .child("Copy")));

    const body = this.file
      ? (this.text != null
          ? TextView.markdown("md-view", this.text).selectable(true).scrollable(true)
              .on_link_click((url, cx) => { this.link(url, cx); cx.notify(); })
          : div().p(12).text_color(t.dim).child(this.error ?? "Loading…"))
      : v_flex().id("md-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(
          this.files.length
            ? this.files.map(f => div().id(`md-${f}`).h(26).flex_none().px(8).rounded(6).flex().items_center()
                .cursor_pointer().hover(s => s.bg(t.hover)).truncate()
                .on_click((_e, cx) => { this.open(f, cx); cx.notify(); }).child(f))
            : [div().p(8).text_size(12).text_color(t.dim).child(this.root ? "No markdown files" : "No folder")]);

    return v_flex().size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(header)
      .child(div().flex_1().min_h(0).p(this.file ? 16 : 0).child(body));
  }
}
