// HerdrNotify: posts one macOS banner for the Herdr GitHub watcher (mods/gh-banners), and opens the
// banner's PR when it's clicked. A separate app so its notifications have their own name and permission.
//   HerdrNotify --title T --body B --url U   post a banner
//   HerdrNotify --test                       post a test banner
//   (no arguments)                           launched by a banner click: open its URL
// Every run records whether notifications are allowed in ~/.cache/herdr-github/notify.json.
import AppKit
import Foundation
import UserNotifications

let dir = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".cache/herdr-github")

/// The value after `name` in the arguments, if any.
func arg(_ name: String) -> String? {
  let args = CommandLine.arguments
  guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
  return args[i + 1]
}

/// Writes notify.json atomically (temp file, then rename).
func record(authorized: Bool) {
  try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
  let payload: [String: Any] = ["authorized": authorized, "at": ISO8601DateFormatter().string(from: Date())]
  guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) else { return }
  let tmp = dir.appendingPathComponent(".notify.\(getpid()).json")
  try? data.write(to: tmp)
  rename(tmp.path, dir.appendingPathComponent("notify.json").path)
}

final class Delegate: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  let center = UNUserNotificationCenter.current()

  /// Asks for permission, records it, then posts the banner the arguments describe (or waits for a click).
  func applicationDidFinishLaunching(_ note: Notification) {
    let test = CommandLine.arguments.contains("--test")
    let title = test ? "Herdr Notify" : arg("--title")
    let body = test ? "Test banner" : (arg("--body") ?? "")
    let url = test ? "https://github.com/pulls" : (arg("--url") ?? "")
    center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
      record(authorized: granted)
      guard let title else {
        // Launched by a click: didReceive delivers it; give up after 10 s.
        DispatchQueue.main.asyncAfter(deadline: .now() + 10) { exit(0) }
        return
      }
      guard granted else { exit(2) }
      let content = UNMutableNotificationContent()
      content.title = title
      content.body = body
      content.sound = .default
      content.userInfo = ["url": url]
      // The URL as identifier: a repeat replaces the earlier banner instead of stacking.
      let request = UNNotificationRequest(identifier: url.isEmpty ? UUID().uuidString : url, content: content, trigger: nil)
      self.center.add(request) { _ in exit(0) }
    }
  }

  /// A banner was clicked: open its PR, then quit.
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler done: @escaping () -> Void) {
    if let s = response.notification.request.content.userInfo["url"] as? String, let u = URL(string: s), !s.isEmpty {
      NSWorkspace.shared.open(u)
    }
    done()
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
  }

  /// Show the banner even though this app is frontmost while it posts.
  func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                              withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
    done([.banner, .sound])
  }
}

let app = NSApplication.shared
let delegate = Delegate()
UNUserNotificationCenter.current().delegate = delegate
app.delegate = delegate
app.run()
