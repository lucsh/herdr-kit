// HerdrNotify: posts one macOS banner for the Herdr GitHub watcher (mods/gh-banners), and opens the
// banner's PR when it's clicked. A separate app so its notifications have their own name and permission.
//   HerdrNotify --title T --body B --url U   post a banner; a click opens U
//   HerdrNotify --title T --body B --do C --do-args JSON
//                                            post a banner; a click brings Herdr forward and runs `Herdr do C JSON`
//   HerdrNotify --test                       post a test banner
//   (no arguments)                           launched by a banner click: open its URL or run its Herdr command
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
    let command = arg("--do") ?? "", commandArgs = arg("--do-args") ?? "{}"
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
      if command.isEmpty { content.sound = .default } // Herdr plays its own sound for agent alerts
      content.userInfo = ["url": url, "do": command, "doArgs": commandArgs]
      // A repeat for the same PR or agent replaces the earlier banner instead of stacking.
      let key = command.isEmpty ? url : command + commandArgs
      let request = UNNotificationRequest(identifier: key.isEmpty ? UUID().uuidString : key, content: content, trigger: nil)
      self.center.add(request) { _ in exit(0) }
    }
  }

  /// A banner was clicked: open its PR, or bring Herdr forward and run its command; quits within 10 s.
  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                              withCompletionHandler done: @escaping () -> Void) {
    let info = response.notification.request.content.userInfo
    done()
    DispatchQueue.main.asyncAfter(deadline: .now() + 10) { exit(0) }
    let command = info["do"] as? String ?? ""
    if command.isEmpty {
      if let s = info["url"] as? String, let u = URL(string: s), !s.isEmpty { NSWorkspace.shared.open(u) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { exit(0) }
      return
    }
    guard let herdr = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "dev.herdr.app") else { exit(0) }
    let args = info["doArgs"] as? String ?? "{}"
    NSWorkspace.shared.openApplication(at: herdr, configuration: NSWorkspace.OpenConfiguration()) { _, _ in
      self.runHerdr(herdr.appendingPathComponent("Contents/MacOS/Herdr"), ["do", command, args], until: Date().addingTimeInterval(8))
    }
  }

  /// Runs Herdr's CLI, retrying every half second while a just-opened Herdr is still starting; quits on
  /// success or once `deadline` passes.
  func runHerdr(_ exe: URL, _ arguments: [String], until deadline: Date) {
    let p = Process()
    p.executableURL = exe
    p.arguments = arguments
    p.standardOutput = FileHandle.nullDevice
    p.standardError = FileHandle.nullDevice
    p.terminationHandler = { p in
      if p.terminationStatus == 0 || Date() > deadline { exit(0) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { self.runHerdr(exe, arguments, until: deadline) }
    }
    do { try p.run() } catch { exit(0) }
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
