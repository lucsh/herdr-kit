// HerdrCalendar: writes today's macOS Calendar events to ~/.cache/herdr-calendar/today.json for the
// Herdr calendar panel (mods/day-calendar). A separate app so it gets its own Calendars permission.
// --sync first asks macOS to refresh remote calendar accounts, then writes again once they settle.
import AppKit
import EventKit
import Foundation

let sync = CommandLine.arguments.contains("--sync")
let store = EKEventStore()
let dir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".cache/herdr-calendar")
let iso = ISO8601DateFormatter()
let meetingLink = try! NSRegularExpression(
  pattern: #"https://[^\s<>"]*(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com|webex\.com|whereby\.com|around\.co)[^\s<>"]*"#)

/// Writes the payload atomically (temp file, then rename) so the panel never reads half a file.
func write(_ payload: [String: Any]) {
  try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys]) else { return }
  let tmp = dir.appendingPathComponent(".today.\(getpid()).json")
  try? data.write(to: tmp)
  rename(tmp.path, dir.appendingPathComponent("today.json").path)
}

/// "#rrggbb" for a calendar's color.
func hex(_ color: CGColor?) -> String {
  guard let c = color.flatMap({ NSColor(cgColor: $0)?.usingColorSpace(.sRGB) }) else { return "#888888" }
  return String(format: "#%02x%02x%02x", Int(c.redComponent * 255), Int(c.greenComponent * 255), Int(c.blueComponent * 255))
}

/// The first video-call link in the event's URL, location or notes.
func link(_ e: EKEvent) -> String? {
  for text in [e.url?.absoluteString, e.location, e.notes].compactMap({ $0 }) {
    let range = NSRange(text.startIndex..., in: text)
    if let m = meetingLink.firstMatch(in: text, range: range), let r = Range(m.range, in: text) { return String(text[r]) }
  }
  return e.url?.absoluteString
}

/// Today's events, cancelled ones left out, with whether you declined.
func today() -> [[String: Any]] {
  let cal = Calendar.current, start = cal.startOfDay(for: Date())
  let end = cal.date(byAdding: .day, value: 1, to: start)!
  return store.events(matching: store.predicateForEvents(withStart: start, end: end, calendars: nil))
    .filter { $0.status != .canceled }
    .sorted { ($0.isAllDay ? 0 : 1, $0.startDate) < ($1.isAllDay ? 0 : 1, $1.startDate) }
    .map { e in
      let me = e.attendees?.first { $0.isCurrentUser }
      var item: [String: Any] = [
        "id": e.eventIdentifier ?? UUID().uuidString, "title": e.title ?? "(No title)",
        "start": iso.string(from: e.startDate), "end": iso.string(from: e.endDate), "all_day": e.isAllDay,
        "calendar": e.calendar.title, "color": hex(e.calendar.cgColor),
        "declined": me?.participantStatus == .declined,
      ]
      if let l = e.location, !l.isEmpty { item["location"] = l }
      if let u = link(e) { item["link"] = u }
      return item
    }
}

/// Forces a real sync: Calendar.app's `reload calendars` (opened hidden if it isn't running).
func reloadCalendarApp() {
  let id = "com.apple.iCal"
  let reload = {
    var error: NSDictionary?
    // Don't wait for Calendar's reply: the reload can take a while, and waiting would block the 15 s cutoff.
    NSAppleScript(source: "tell application id \"\(id)\"\nignoring application responses\nreload calendars\nend ignoring\nend tell")?.executeAndReturnError(&error)
  }
  if !NSRunningApplication.runningApplications(withBundleIdentifier: id).isEmpty { reload(); return }
  guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: id) else { return }
  let config = NSWorkspace.OpenConfiguration()
  config.activates = false
  config.hides = true
  NSWorkspace.shared.openApplication(at: url, configuration: config) { _, _ in
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { reload() }
  }
}

/// Writes today's events, marking whether a sync is still running.
func publish(syncing: Bool) {
  let day = DateFormatter(); day.dateFormat = "yyyy-MM-dd"
  write(["date": day.string(from: Date()), "fetched_at": iso.string(from: Date()), "syncing": syncing, "events": today()])
}

store.requestFullAccessToEvents { granted, _ in
  DispatchQueue.main.async {
    guard granted else {
      write(["error": "denied", "fetched_at": iso.string(from: Date()), "syncing": false, "events": []])
      exit(0)
    }
    publish(syncing: sync)
    guard sync else { exit(0) }
    // Make the accounts sync, then publish once changes stop arriving (or after 15 s).
    var settle: DispatchWorkItem?
    let finish = { publish(syncing: false); exit(0) }
    NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { _ in
      settle?.cancel()
      settle = DispatchWorkItem(block: finish)
      DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: settle!)
    }
    store.refreshSourcesIfNecessary()
    reloadCalendarApp()
    DispatchQueue.main.asyncAfter(deadline: .now() + 15, execute: finish)
  }
}
dispatchMain()
