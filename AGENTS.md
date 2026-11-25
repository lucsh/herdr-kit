# Installing herdr-kit

You are installing this kit on a Mac for the person at it. `README.md` says what the kit adds; `install.sh` is the authority on what it checks and changes. Some fixes need the person's hands (a browser sign-in, a macOS dialog): the check output marks those `(person)`. Ask, wait for them, then continue.

## Steps

1. **Ask about reboot resume.** `--with-resume` adds a Claude Code SessionStart/SessionEnd hook and a line in `~/.zshrc`, so each Herdr terminal resumes its Claude session after a reboot. It's the person's choice; the default is without. Done when you know whether to pass it.

2. **Check.** Run `./install.sh --check` (plus `--with-resume` if chosen). It changes nothing. Every line that isn't `ok` ends with its fix after `->`.
   - `FAIL` under Prerequisites: fix it. Run `brew install …` fixes yourself after telling the person; hand `(person)` fixes to them.
   - `FAIL` under "Would block the install": a mod, layout or file of the same name exists that the kit didn't install. Show the person the path. Rerun with `--force` (it backs the old one up as `*.bak-herdr-kit-*` and replaces it) only after they agree.
   - `warn`: the install works without it, minus one feature. Tell the person which, and fix it if they want. `gh` not signed in costs the Pull requests panel, its "Waiting on you" list and the GitHub banners. No `swiftc` costs the Calendar panel, the GitHub banners and the agent banners (agent alerts then stay in-app).

   Done when the check prints `Ready to install.` (with `--force` agreed for any remaining "would block" lines).

3. **Install.** First tell the person that macOS will show two prompts for "Herdr Calendar" (access to Calendars, then permission to control Calendar) and one for "Herdr Notify" (notifications). All three need Allow. For Herdr Notify, the alert style should be Banners. Then run `./install.sh` with the flags from steps 1 and 2. Done when it prints `Done.` Pass every `note:` line and every `  - ` line it printed on to the person: these are settings it kept instead of replacing, such as an existing Claude status line and the one line to add to it.

4. **Verify.** Each of these must hold:
   - `herdr-app status` shows `"layout": "main-md"` and `"errors": []`. If Herdr isn't running, ask the person to open it and pick main-md with `ctrl-shift-l`.
   - `tasks path` prints a path under `~/.local/state/herdr-tasks/`.
   - `jq '{error, events: (.events | length)}' ~/.cache/herdr-calendar/today.json` shows `"error": null`. If it shows `"denied"`, the person turns on Herdr Calendar in System Settings › Privacy & Security › Calendars, then presses Sync in the Calendar panel.
   - `open -n -g -a ~/.local/share/herdr-notify/HerdrNotify.app --args --test` shows a "Test banner", and `jq .authorized ~/.cache/herdr-github/notify.json` shows `true`. If it shows `false`, the person turns on Herdr Notify in System Settings › Notifications.
   - Agent banners: pick a live agent's terminal id from `herdr-app ls`, then `open -n -g -a ~/.local/share/herdr-notify/HerdrNotify.app --args --title "Agent check" --body "click me" --do agent.focus --do-args '{"terminal":"<id>"}'`. Ask the person to click the banner: Herdr comes forward on that agent.
   - With Herdr open, within a minute `jq '{error, fetched_at}' ~/.cache/herdr-github/todo.json` shows `"error": null` and a recent time. An `HTTP 502` error clears on the next check. Any other error, such as a login one, needs `gh auth login`.
   - If the installer set the Claude status line (it printed no status-line note), a new Claude session in a Herdr terminal creates `~/.cache/herdr-claude/<terminal id>.json` within a few seconds.

5. **Report.** Tell the person what was installed, which `warn` items limit a feature, and what's left for them:
   - any permission prompts still unanswered, including Herdr Notify's;
   - GitHub banners only arrive while Herdr is open;
   - `gh auth login`, if it was skipped;
   - restarting Claude and Codex sessions that were already running, so they read the new Tasks block in `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md`.

## Rules

- The Calendar panel reads the macOS calendar database only. The person's Google Workspace blocks unapproved apps from reading calendars, and an attempt raises flags with IT. When events look stale or missing, fix the Mac's account: System Settings › Internet Accounts, turn Calendars off and on again for that account, then press Sync.
- `HerdrCalendar.app` is ad-hoc signed, so every rebuild makes macOS ask for both permissions again. `install.sh` rebuilds it only when its source changed; run `calendar/build.sh` yourself only after editing `calendar/src/`.
- `HerdrNotify.app` (the GitHub banner helper) is ad-hoc signed too, so a rebuild asks again to allow its notifications. The same rule applies: run `notify/build.sh` only after editing `notify/src/`.
- Commit or push this repo only when the person asks.
- To remove everything: `./uninstall.sh`. It takes out only what the installer created and reverts only the settings it changed.
