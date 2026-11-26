// Merges herdr-kit's settings into existing config files, and takes them out again.
// Usage: node merge.mjs install|uninstall --share <dir> --herdr <herdr-app home> [--resume]
// Every change is additive: a value the person already set is kept and reported, never replaced.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const mode = args[0]
const opt = name => { const i = args.indexOf(`--${name}`); return i > 0 ? args[i + 1] : null }
const share = opt('share'), herdr = opt('herdr'), resume = args.includes('--resume')
const home = os.homedir()
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
const THEME = 'luc'
const KEYS = {
  'cmd-shift-g': ['layout.toggle:right', 'the right column (Calendar + Tasks) has no key toggle (the tab-bar buttons still work)'],
  'cmd-shift-o': ['my-status.finder', 'opening the focused folder in Finder has no key']
}
const statusCommand = `${share}/statusline.sh`
const hookCommand = `python3 -I "${share}/herdr-app-session-label.py" 2>/dev/null || true`
const TASKS_START = '<!-- herdr-kit:tasks:start -->', TASKS_END = '<!-- herdr-kit:tasks:end -->'
const TASKS_BODY = `## Tasks (follow-ups for me)
- To leave me a follow-up you can't finish now, run \`tasks add "[<branch>] <text>"\` from the repo (one list per repo, shared by its worktrees; shows in my Herdr Tasks panel)
- \`tasks list\` shows the list; never complete, edit or remove tasks you didn't add`
const ZSH_START = '# >>> herdr-kit resume', ZSH_END = '# <<< herdr-kit resume'
const appliedFile = `${share}/merges.json`
/** Which settings a run of install changed (so uninstall reverts only those). */
const applied = fs.existsSync(appliedFile) ? JSON.parse(fs.readFileSync(appliedFile, 'utf8')) : {}

/** Prints a note for the person. */
const note = msg => console.log(`  - ${msg}`)

/** Writes text to file, backing up the previous version once per run if it existed. */
function write (file, text) {
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf8') === text) return
    fs.copyFileSync(file, `${file}.bak-herdr-kit-${stamp}`)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}

/** Loads a JSON file (null when absent), lets change() edit it, and saves it if anything changed. */
function editJson (file, change, { create = false } = {}) {
  if (!fs.existsSync(file) && !create) return false
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}'
  const data = JSON.parse(before)
  change(data)
  const after = `${JSON.stringify(data, null, 2)}\n`
  if (JSON.stringify(JSON.parse(before)) !== JSON.stringify(data)) write(file, after)
  return true
}

/** Replaces or appends the marked block in a text file (after a blank line); body null removes it. */
function block (file, start, end, body, { create = false, skipIf = null } = {}) {
  const exists = fs.existsSync(file)
  if (!exists && (!create || body === null)) return
  const text = exists ? fs.readFileSync(file, 'utf8') : ''
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`${esc(start)}[\\s\\S]*?${esc(end)}\\n?`)
  const has = re.test(text)
  if (body === null) {
    if (!has) return
    const rest = text.replace(new RegExp(`\\n?${re.source}`), '')
    if (rest.trim()) write(file, rest)
    else { fs.copyFileSync(file, `${file}.bak-herdr-kit-${stamp}`); fs.rmSync(file) }
    return
  }
  if (!has && skipIf && skipIf.test(text)) { note(`${file} already has this outside herdr-kit's markers; left as is`); return }
  const chunk = `${start}\n${body}\n${end}\n`
  write(file, has ? text.replace(re, chunk) : text ? `${text.replace(/\n*$/, '\n')}\n${chunk}` : chunk)
}

/** True when a hook group runs the session-label script. */
const isLabelHook = group => JSON.stringify(group).includes('herdr-app-session-label.py')

/** Applies every merge. */
function install () {
  editJson(`${herdr}/settings.json`, s => {
    if (!s.theme) { s.theme = THEME; applied.theme = true }
    else if (s.theme !== THEME) note(`Herdr theme is ${JSON.stringify(s.theme)}; kept it (pick "luc" in Settings to use the kit's)`)
  }, { create: true })

  if (applied.key) { applied.keys = ['cmd-shift-g']; delete applied.key }
  applied.keys ??= []
  if (!editJson(`${herdr}/keys.json`, k => {
    k.global ??= {}
    for (const [key, [action, without]] of Object.entries(KEYS)) {
      if (!k.global[key]) { k.global[key] = action; if (!applied.keys.includes(key)) applied.keys.push(key) }
      else if (k.global[key] !== action) note(`${key} is already bound to ${k.global[key]}; ${without}`)
    }
  })) note(`${herdr}/keys.json not found (start Herdr once); ${Object.keys(KEYS).join(' and ')} were not bound`)

  editJson(`${home}/.claude/settings.json`, s => {
    if (!s.statusLine) { s.statusLine = { type: 'command', command: statusCommand }; applied.statusLine = true }
    else if (s.statusLine.command !== statusCommand) {
      note('Claude Code already has a status line; kept it. For the Herdr status bar, add this as its first line:')
      note('  case "$HC_TERMINAL_ID" in ""|*[!A-Za-z0-9_-]*) ;; *) hd="$HOME/.cache/herdr-claude"; mkdir -p "$hd" && printf \'%s\' "$input" > "$hd/.$HC_TERMINAL_ID.$$" && mv -f "$hd/.$HC_TERMINAL_ID.$$" "$hd/$HC_TERMINAL_ID.json";; esac')
      note(`  (or point it at ${statusCommand})`)
    }
    if (resume) {
      s.hooks ??= {}
      for (const ev of ['SessionStart', 'SessionEnd']) {
        s.hooks[ev] ??= []
        if (!s.hooks[ev].some(isLabelHook)) s.hooks[ev].push({ hooks: [{ type: 'command', command: hookCommand, timeout: 10 }] })
      }
    }
  }, { create: true })

  const skipIf = /^## Tasks \(follow-ups for me\)/m
  block(`${home}/.claude/CLAUDE.md`, TASKS_START, TASKS_END, TASKS_BODY, { create: true, skipIf })
  if (fs.existsSync(`${home}/.codex`)) block(`${home}/.codex/AGENTS.md`, TASKS_START, TASKS_END, TASKS_BODY, { create: true, skipIf })

  if (resume) block(`${home}/.zshrc`, ZSH_START, ZSH_END, `source "${herdr}/claude-resume.zsh"`, { create: true, skipIf: /claude-resume\.zsh/ })
  fs.mkdirSync(share, { recursive: true })
  fs.writeFileSync(appliedFile, `${JSON.stringify(applied)}\n`)
}

/** Takes out exactly what install added, leaving values the person changed. */
function uninstall () {
  if (applied.theme) editJson(`${herdr}/settings.json`, s => { if (s.theme === THEME) delete s.theme })
  const keys = applied.key ? ['cmd-shift-g'] : applied.keys ?? []
  editJson(`${herdr}/keys.json`, k => { for (const key of keys) if (k.global?.[key] === KEYS[key]?.[0]) delete k.global[key] })
  editJson(`${home}/.claude/settings.json`, s => {
    if (applied.statusLine && s.statusLine?.command === statusCommand) delete s.statusLine
    for (const ev of ['SessionStart', 'SessionEnd']) {
      if (!s.hooks?.[ev]) continue
      s.hooks[ev] = s.hooks[ev].filter(g => !JSON.stringify(g).includes(`${share}/herdr-app-session-label.py`))
      if (!s.hooks[ev].length) delete s.hooks[ev]
    }
    if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks
  })
  block(`${home}/.claude/CLAUDE.md`, TASKS_START, TASKS_END, null)
  block(`${home}/.codex/AGENTS.md`, TASKS_START, TASKS_END, null)
  block(`${home}/.zshrc`, ZSH_START, ZSH_END, null)
}

if (!share || !herdr || !['install', 'uninstall'].includes(mode)) {
  console.error('usage: node merge.mjs install|uninstall --share <dir> --herdr <dir> [--resume]')
  process.exit(2)
}
mode === 'install' ? install() : uninstall()
