// Read-only, syntax-highlighted code pane. props.file: the file to show; props.on: its machine (null = this computer).
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor, EditorState } from "gpui-base";
import { readTextFile, watchFolder, theme, settings, checking, notify, props as hostProps } from "herdr";

const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html", yml: "yaml", htm: "html" };
const MAX = 400000;
/** Parent folder of a path. */
const dirname = (p) => p.replace(/\/[^/]*$/, "") || "/";

export default class CodePreview extends View {
  /** Reads props, loads the file and reloads it when its folder changes (local files only). */
  init(_props, cx) {
    const props = hostProps() ?? _props;
    this.file = props?.file ?? null;
    this.on = props?.on ?? null;
    if (checking() || !this.file) return;
    cx.spawn(async (cx) => {
      while (!this.closed) {
        await this.load();
        cx.notify();
        if (this.on) return;
        this.watch = watchFolder(dirname(this.file));
        const changed = await this.watch.catch(() => []);
        if (!changed.length) return;
      }
    });
  }

  /** Reads the file and builds the read-only highlighted editor state. */
  async load() {
    try {
      const text = await readTextFile(this.file, { on: this.on });
      if (this.closed) return;
      this.code?.release(); this.code = null; this.text = null;
      if (text === null) { this.error = "This file is no longer available"; return; }
      if (text.includes("\0")) { this.error = "Binary file · no text preview"; return; }
      const t = theme(), name = this.file.split("/").pop(), ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "txt";
      this.text = text; this.error = null;
      this.code = EditorState.new({ language: LANG[ext] ?? ext, readonly: true,
        value: text.length > MAX ? text.slice(0, MAX) + "\n… (file truncated)" : text,
        font_family: settings().font_family, font_size: 13,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1,
                  constant: t.ansi6, boolean: t.ansi1, "string.escape": t.ansi6, variable: t.foreground, operator: t.muted, punctuation: t.muted } });
    } catch { this.error = `Cannot read ${this.file}`; }
  }

  /** Stops the watch and frees the editor state when the pane closes. */
  close() { this.closed = true; this.watch?.cancel(); this.code?.release(); }

  /** Header with name, folder and Copy, then the code view. */
  render() {
    const t = theme();
    return v_flex().size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(h_flex().h(36).flex_none().px(12).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child(this.file?.split("/").pop() ?? "Code"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.file ? dirname(this.file) : ""))
        .when(this.text != null, el => el.child(div().id("code-copy").px(8).py(2).rounded(6).text_size(12)
          .cursor_pointer().text_color(t.muted).hover(s => s.bg(t.hover).text_color(t.foreground))
          .on_click((_e, cx) => { cx.write_to_clipboard(this.text); notify({ title: "Copied", timeout: 1500 }); })
          .child("Copy"))))
      .child(this.code ? Editor.new(this.code).flex_1().min_h(0)
        : div().p(12).text_color(t.dim).child(this.error ?? (this.file ? "Loading…" : "No file")));
  }
}
