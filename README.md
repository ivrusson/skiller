# skiller

Inspect, explore, install, and track the **agent skills** on your machine.

Skiller is a Bun CLI plus a local web UI. It finds every `SKILL.md` your harnesses already use, enriches them with registry metadata, and helps you decide what to keep, install, or remove.

```bash
curl -fsSL https://raw.githubusercontent.com/ivrusson/skiller/main/install.sh | bash
skiller list
skiller ui --open
```

Requirements: [Bun](https://bun.sh) ≥ 1.1 for source installs. Network is optional for local listing; Explore and download counts need the internet.

---

## What you get

| Surface      | Use it to                                                                        |
| ------------ | -------------------------------------------------------------------------------- |
| **CLI**      | List/info, tags, explore, install/uninstall, usage analytics, OpenTUI wizards    |
| **Web UI**   | Browse installed skills, search catalogs, install/uninstall with a live terminal |
| **Usage DB** | See which skills Claude Code / Cursor (and friends) actually invoke              |

Everything runs locally under `~/.skiller`. Skiller never deletes skill folders itself — install and uninstall always go through `npx skills` or `clawhub`.

---

## Install

All paths put a `skiller` **command** on your `PATH` by installing the binary at `$PREFIX/bin/skiller` (default: `~/.local/bin/skiller`). After a successful install you run:

```bash
skiller --help
skiller list
```

Override the install location with `PREFIX=/usr/local` (→ `/usr/local/bin/skiller`). If the installer warns that the bin dir is not on your `PATH`, add it to your shell profile and open a new terminal.

### 1. One-liner from source (recommended)

Clones the repo, compiles a native binary with Bun, installs it. No checkout left behind.

```bash
curl -fsSL https://raw.githubusercontent.com/ivrusson/skiller/main/install.sh | bash
```

Needs `curl`, `git`, and [Bun](https://bun.sh). Pin a branch/tag with `SKILLER_REF`:

```bash
curl -fsSL https://raw.githubusercontent.com/ivrusson/skiller/main/install.sh | SKILLER_REF=v0.1.0 bash
```

### 2. Prebuilt binary from GitHub Releases

Uses the artifacts published by CI when a `v*` tag is pushed (no local compile):

```bash
curl -fsSL https://raw.githubusercontent.com/ivrusson/skiller/main/install.sh | bash -s -- --from-release
```

Needs `curl` only. Assets look like `skiller-darwin-arm64`, `skiller-linux-x64`, `skiller-windows-x64.exe`.

### 3. From a git checkout

```bash
git clone https://github.com/ivrusson/skiller.git
cd skiller
./install.sh                 # bun install + compile → ~/.local/bin/skiller
./install.sh --build-only    # only write dist/skiller
bun run build                # same compile step via package script
```

### 4. Development (run via Bun, no standalone binary)

```bash
git clone https://github.com/ivrusson/skiller.git
cd skiller
bun install
bun link                     # optional: `skiller` on PATH → index.ts
bun run index.ts list        # or: bun run index.ts ui --open
```

---

## Quick start

```bash
curl -fsSL https://raw.githubusercontent.com/ivrusson/skiller/main/install.sh | bash

skiller list
skiller info hono
skiller ui --open
skiller wizard
```

---

## Guide

### 1. See what is installed

Skiller scans these roots (user + project):

- `~/.agents/skills` — multi-agent standard (Codex, OpenCode, …)
- `~/.claude/skills` — Claude Code
- `~/.cursor/skills`, `~/.config/opencode/skills|skill`
- `./.agents/skills`, `./.claude/skills`, `./.cursor/skills`

```bash
skiller list                         # table: name, source, installs, description
skiller list --json                  # machine-readable
skiller list --no-registry           # local only (no network)
skiller list --refresh               # bypass the 24h skills.sh cache
skiller list --tag testing,frontend  # AND filter on auto + manual tags
skiller info <name>                  # path, tags, registry, related siblings
```

Download counts come from [skills.sh](https://skills.sh) and only accept **exact** skill-name matches.

### 2. Browse in the browser

```bash
skiller ui                  # http://127.0.0.1:4780
skiller ui --open           # also open the default browser
skiller ui --port 8080
```

**Installed** — search, filter by source/publisher/tags, sort by downloads or usage, open a detail drawer (SKILL.md body, trust, related skills, manual tags), uninstall.

**Explore** — search across multiple catalogs (skills.sh, Claude marketplaces, SkillsMP, awesome-lists, ClawHub). Install or uninstall from a row; a web terminal streams the CLI output. Enable **Interactive prompts** when the installer asks questions (PTY via `script` on macOS/Linux).

Theme follows your system preference and persists in `localStorage`.

### 3. Find and install new skills

```bash
skiller explore hono
skiller explore              # prompts for a query on a TTY

skiller install owner/repo
skiller install owner/repo --provider clawhub
skiller install              # wizard: repo → provider → confirm
skiller uninstall hono
skiller install owner/repo --yes   # skip prompts (scripts / CI)
```

On a TTY, install/uninstall/explore use [OpenTUI](https://github.com/anomalyco/opentui) panels. Non-TTY falls back to flags and plain text.

```bash
skiller wizard               # main menu: list · explore · install · uninstall · ui · usage
```

### 4. Tag and filter

Automatic tags (~17 categories from name + description + summary, max 4). Manual tags live in `~/.skiller/tags.json` and apply across scopes.

```bash
skiller tag hono favorite backend
skiller untag hono backend
skiller tags
skiller list --tag favorite
```

In the web UI, the chip bar under search filters by tag; the drawer edits manual tags (dot = manual).

### 5. Track real usage

```bash
# Scan Claude Code + Cursor transcripts (also runs when the web UI starts)
skiller usage ingest

skiller usage                # sessions per skill
skiller usage harness        # sessions per harness
skiller usage unused         # unused in 90 days
skiller usage unused --days 30
skiller usage by-repo        # roll up by owner/repo
skiller usage by-owner
skiller usage log hono claude-code
skiller usage purge          # drop events older than 365 days
skiller usage db
```

Ingest detects Claude Code `Skill` tool calls exactly, and Cursor skill-file reads heuristically. Only the invoked skill is recorded; same-repo siblings show up via registry metadata.

### 6. Data directory

```
~/.skiller/
  tags.json
  usage.db
  cache/
    registry.json
    providers/*.json
```

Override with `SKILLER_HOME`. First run migrates old XDG paths (`~/.config/skiller`, `~/.cache/skiller`) if present.

```bash
skiller home
skiller cache
skiller cache --clear-providers
```

---

## CLI reference

```
skiller list [--json] [--no-registry] [--refresh] [--tag t1,t2]
skiller info <name> [--json]
skiller ui [--port 4780] [--host 127.0.0.1] [--open] [--refresh]
skiller wizard
skiller explore [query]
skiller install [owner/repo|slug] [--provider skills|clawhub] [--yes]
skiller uninstall [name] [--provider skills|clawhub] [--repo slug] [--yes]
skiller tag <name> <tag...>
skiller untag <name> <tag...>
skiller tags
skiller cache [--clear-providers]
skiller home
skiller usage | usage ingest | usage log | usage harness | usage unused
skiller usage by-repo | by-owner | purge | db
```

`skiller --help` prints the same list from the binary.

---

## Development

```bash
bun install
bun test
bun run lint
bun run fmt:check
bun run build              # → dist/skiller
./install.sh               # build + install to ~/.local/bin (PREFIX=… to override)
./install.sh --build-only  # compile only
bun run --watch index.ts ui    # or: bun run dev
```

### Releasing

1. Ask an agent to **prepare a release** (uses `.cursor/skills/prepare-release`).
2. Review the draft under `.releases/` (gitignored) — version, changelog, tag commands.
3. Bump `"version"` in `package.json` if you agree, commit if desired.
4. Push an annotated tag: `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.
5. GitHub Actions (`.github/workflows/release.yml`) builds standalone binaries on **native** runners and attaches them to the GitHub Release.
6. Users can then install with either:
   - **Source:** `curl …/install.sh | bash` (compiles locally)
   - **Prebuilt:** `curl …/install.sh | bash -s -- --from-release`

Layout:

```
index.ts           CLI entry
src/
  scan.ts          find + parse SKILL.md
  collect.ts       scan → registry → tags → usage → trust → relations
  registry.ts      skills.sh cache
  providers/       Explore catalogs
  install.ts       npx skills / clawhub bridge
  usage.ts         SQLite sessions
  ingest.ts        transcript scanning
  server.ts        Bun.serve + /ws/run
  web/             HTML partials + app.js (no bundler)
  cli/             OpenTUI wizards
test/              bun:test
```

See [LEGENDS.md](./LEGENDS.md) for domain terms and how pieces connect. See [AGENTS.md](./AGENTS.md) if you are an coding agent working in this repo. Contributor notes for the UI live in [`src/web/README.md`](./src/web/README.md).

---

## License

MIT
