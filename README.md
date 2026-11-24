# herdr-kit

My Herdr desktop app setup, for any Mac.

## What you get

- **The `main-md` layout.** It has a sidebar, a tab bar with Files, Changes, Tasks and Pull requests buttons, and a bottom status bar.
- **The `luc` theme.** It uses the colors of luc.sh: olive-black background, warm off-white text, coral accent.
- **Files panel.** It has a search box. Code opens in a syntax-highlighted pane and markdown opens in a preview pane.
- **Tasks panel.** Each repo gets one to-do list, shared by all of its worktrees. Agents add to the same list with `tasks add "[<branch>] <text>"`. The `tasks` command is zamarrowski/herdr-tasks' CLI, pinned in `kit.env`.
- **Status bar.** It shows the focused Claude session's model, effort, context, 5-hour and weekly usage, cost, run time and account. It also shows the folder, the branch with its count of changed files, and the lines added and removed.
- **Working agents** show a braille spinner.
- **Pull requests panel.** This is jjangsky/herdr-pr-flow 0.6.0 (MIT) with a local patch that finds PRs in submodules. `cmd-shift-g` toggles it, and you can drag its left edge to resize it.
- **Optional (`--with-resume`):** after a reboot, each terminal resumes the Claude session it was running.

## Requirements

- The Herdr desktop app, opened at least once.
- `git`, `jq`, `rsync`, and Node.js 20 or newer.
- `gh`, logged in, for the Pull requests panel.
- `python3`, only for `--with-resume`.

## Install

```sh
git clone <this repo> ~/Repos/herdr-kit
~/Repos/herdr-kit/install.sh                 # add --with-resume for reboot resume
```

You can rerun it at any time; it updates what it installed and changes nothing else.

It never overwrites files it didn't install. If a mod or layout of the same name exists, it stops before changing anything. `--force` backs those up as `*.bak-herdr-kit-*` and replaces them.

Settings are merged, never replaced:

| File | Change |
|---|---|
| Herdr `settings.json` | `theme: "luc"`, only if no theme is set |
| Herdr `keys.json` | `cmd-shift-g`, only if that key is free |
| `~/.claude/settings.json` | the status line, only if none is set; otherwise the installer prints the one line to add to yours. With `--with-resume`, also two hooks |
| `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` | a marked "Tasks" block |
| `~/.zshrc` | a marked `source` line, with `--with-resume` only |

Every file it edits is backed up first as `<file>.bak-herdr-kit-<time>`.

## Where things go

| What | Where |
|---|---|
| Layout, theme, mods | `~/.config/herdr-app/` (or `$HERDR_APP_HOME`) |
| `tasks` command | `~/.local/bin/tasks` (needs to be on your PATH) |
| herdr-tasks checkout | `~/.local/share/herdr-tasks` |
| Status line and hook scripts, install manifest | `~/.local/share/herdr-kit/` |
| Task lists | `~/.local/state/herdr-tasks/<repo>/tasks.json` |
| Status bar data | `~/.cache/herdr-claude/` |

## Uninstall

```sh
~/Repos/herdr-kit/uninstall.sh
```

This removes only what the installer created (files that were already there, even identical ones, stay) and reverts only the settings it changed, keeping any values you changed yourself. Your task lists are kept.

## Caveats

- The `my-*` mods and `files-md` are copies of Herdr 0.1.16's built-in mods (`agents`, `tabs`, `pane`, `workspace-status`, `files`). Herdr updates won't reach them. The installer warns when the Herdr version differs, and runs `herdr-app check` on every mod.
- The status bar only sees Claude sessions on this computer. Sessions on remote machines write their data on that machine.
- To update the kit from a Mac where you've changed things, copy the changed `~/.config/herdr-app/mods/<name>` folders back into `herdr/mods/` (leave out `gpui-kit.d.ts` and `jsconfig.json`).
