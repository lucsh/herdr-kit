// Today's macOS Calendar events. HerdrCalendar.app (~/.local/share/herdr-calendar) reads them with
// its own Calendars permission and writes ~/.cache/herdr-calendar/today.json; this panel shows that
// file, reruns the helper every 5 minutes, and Sync asks macOS to refresh the calendar accounts first.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, readTextFile, watchFolder, theme, home } from "herdr";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "09:30", local time. */
const hm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** "2026-11-24", local date. */
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** "45m", "1h 30m". */
const span = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`; };

export default class DayCalendar extends View {
  /** Loads the last snapshot, watches for new ones, and refreshes every 5 minutes and at midnight. */
  init(_props, cx) {
    this.dir = `${home()}/.cache/herdr-calendar`;
    this.app = `${home()}/.local/share/herdr-calendar/HerdrCalendar.app`;
    this.data = null; this.raw = null; this.syncingSince = null; this.missing = false; this.showDone = false;
    this.fetch(cx, false);
    cx.timer.every(300000, cx => this.fetch(cx, false));
    cx.timer.every(60000, cx => {
      if (this.data?.date && this.data.date !== ymd(new Date())) this.fetch(cx, false);
      if (this.syncingSince && Date.now() - this.syncingSince > 30000) this.syncingSince = null;
      cx.notify();
    });
    cx.spawn(async cx => {
      await exec("mkdir", ["-p", this.dir]).catch(() => null);
      for (;;) {
        await this.load(cx);
        const changed = await watchFolder(this.dir).catch(() => []);
        if (!changed.length) await cx.sleep(5000);
      }
    });
  }

  /** Rereads today.json; redraws only when it changed. */
  async load(cx) {
    const raw = await readTextFile(`${this.dir}/today.json`).catch(() => null);
    if (!raw || raw === this.raw) return;
    try {
      this.data = JSON.parse(raw); this.raw = raw;
      if (this.syncingSince && !this.data.syncing && Date.parse(this.data.fetched_at) >= this.syncingSince - 2000) this.syncingSince = null;
      cx.notify();
    } catch {}
  }

  /** Runs the helper in the background; sync = refresh remote accounts first. */
  fetch(cx, sync) {
    if (sync) this.syncingSince = Date.now();
    cx.spawn(async cx => {
      const r = await exec("open", ["-n", "-g", "-a", this.app, ...(sync ? ["--args", "--sync"] : [])]).catch(() => null);
      this.missing = r?.code !== 0;
      if (this.missing) this.syncingSince = null;
      cx.notify();
    });
  }

  /** Today's events with copies from other calendars merged (the one with a call link wins). */
  events() {
    const seen = new Map();
    for (const e of this.data?.events ?? []) {
      const key = `${e.title}|${e.start}|${e.end}|${e.all_day}`;
      const prev = seen.get(key);
      if (!prev || (!prev.link && e.link)) seen.set(key, e);
    }
    return [...seen.values()];
  }

  /** One timed event: time, color bar, title and place, Join for calls. */
  row(t, e, now) {
    const start = new Date(e.start), end = new Date(e.end);
    const past = end <= now, current = start <= now && now < end;
    const dim = past || e.declined;
    return h_flex().id(`ev-${e.id}-${e.start}`).flex_none().px(8).py(6).gap(9).items_start().rounded(7)
      .when(current, el => el.bg(t.accent + "1f"))
      .child(v_flex().w(38).flex_none().items_end().text_size(11.5)
        .child(div().text_color(dim ? t.dim : t.foreground).child(hm(start)))
        .child(div().text_color(t.dim).child(span(end - start))))
      .child(div().w(3).flex_none().self_stretch().rounded(2).bg(e.color ?? t.accent).when(dim, el => el.opacity(0.4)))
      .child(v_flex().flex_1().min_w(0).gap(1)
        .child(div().whitespace_normal().text_size(13).text_color(dim ? t.dim : t.foreground).when(e.declined, el => el.line_through()).child(e.title))
        .child(div().truncate().text_size(11).text_color(t.dim).child(current ? `now · ends ${hm(end)}` : e.location || e.calendar)))
      .when(Boolean(e.link) && !past, el => el.child(div().id(`join-${e.id}-${e.start}`).flex_none().px(8).h(22).flex().items_center().rounded(6)
        .text_size(11.5).cursor_pointer().bg(current ? t.accent : t.hover).text_color(current ? t.accent_foreground : t.foreground)
        .on_click(() => exec("open", [e.link])).child("Join")));
  }

  /** Header with date and Sync, all-day chips, then the day's events with a now line. */
  render(cx) {
    const t = theme(), now = new Date(), d = this.data;
    const all = this.events(), allDay = all.filter(e => e.all_day), timed = all.filter(e => !e.all_day);
    const done = timed.filter(e => new Date(e.end) <= now), upcoming = timed.filter(e => new Date(e.end) > now);
    const nowAt = upcoming.findIndex(e => new Date(e.start) > now);
    const syncing = Boolean(this.syncingSince) || Boolean(d?.syncing);
    const nowLine = () => h_flex().id("now-line").flex_none().px(8).gap(6).items_center().h(14)
      .child(div().w(38).flex_none().text_right().text_size(10.5).text_color(t.accent).child(hm(now)))
      .child(div().size(6).rounded(3).bg(t.accent)).child(div().flex_1().h(1).bg(t.accent));
    const list = [];
    upcoming.forEach((e, i) => { if (i === nowAt) list.push(nowLine()); list.push(this.row(t, e, now)); });
    if (nowAt < 0) list.push(nowLine());
    const updated = d?.fetched_at ? hm(new Date(d.fetched_at)) : null;
    const message = this.missing ? "Helper not found: run ~/.local/share/herdr-calendar/build.sh"
      : d?.error === "denied" ? "Calendar access is off. Allow “Herdr Calendar” in System Settings › Privacy & Security › Calendars, then Sync."
      : !d ? "Loading…" : null;

    return v_flex().id("calendar").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Today"))
        .child(div().text_size(12).text_color(t.muted).child(`${WEEKDAY[now.getDay()]} ${now.getDate()} ${MONTH[now.getMonth()]}`))
        .child(div().flex_1())
        .when(Boolean(updated), el => el.child(div().text_size(11).text_color(t.dim).child(syncing ? "syncing…" : `updated ${updated}`)))
        .child(h_flex().id("cal-sync").h(24).px(8).gap(5).items_center().rounded(6).cursor_pointer().text_size(12)
          .bg(t.hover).text_color(t.foreground).hover(s => s.bg(t.selected))
          .on_click((_e, cx) => { if (!syncing) this.fetch(cx, true); cx.notify(); })
          .child(syncing ? div().w(10).text_color(t.accent).frames(SPIN, 80) : svg("mods/pr-flow/refresh.svg").size(12))
          .child("Sync")))
      .when(allDay.length > 0, el => el.child(h_flex().flex_none().flex_wrap().gap(5).px(10).pt(8)
        .children(allDay.map(e => h_flex().id(`ad-${e.id}`).h(22).px(8).gap(6).items_center().rounded(6).bg(t.hover).max_w_full()
          .child(div().size(7).flex_none().rounded(4).bg(e.color ?? t.accent))
          .child(div().truncate().text_size(11.5).text_color(t.muted).child(e.title))))))
      .child(v_flex().id("cal-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).gap(1)
        .when(Boolean(message), el => el.child(div().p(8).text_size(12).text_color(t.dim).whitespace_normal().child(message))
          .when(d?.error === "denied", el => el.child(div().id("cal-privacy").mx(8).px(8).h(24).flex().items_center().self_start().rounded(6).cursor_pointer()
            .bg(t.hover).text_size(12).on_click(() => exec("open", ["x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars"])).child("Open Privacy settings"))))
        .when(!message && !timed.length, el => el.child(div().p(8).text_size(12).text_color(t.dim).child(allDay.length ? "No meetings today" : "Nothing on the calendar today")))
        .when(!message && done.length > 0, el => el
          .child(h_flex().id("cal-done").px(8).h(22).gap(6).items_center().cursor_pointer().text_size(11).text_color(t.dim)
            .hover(s => s.text_color(t.foreground)).on_click((_e, cx) => { this.showDone = !this.showDone; cx.notify(); })
            .child(svg(`mods/workspace-chrome/chevron-${this.showDone ? "down" : "right"}.svg`).size(12)).child(`Earlier · ${done.length}`))
          .when(this.showDone, el => el.children(done.map(e => this.row(t, e, now)))))
        .when(!message, el => el.children(list)));
  }
}
