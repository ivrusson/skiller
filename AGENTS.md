# AGENTS.md

Instructions for coding agents working in this repository.

## Project

**skiller** — Bun CLI + local web UI to inventory, explore, install/uninstall, tag, and track usage of Agent Skills (`SKILL.md`) on the machine.

- Runtime: **Bun only** (no Node, npm, pnpm, vite, express).
- Entry: `index.ts` (`bin.skiller`).
- Tests: `bun test` under `test/`.
- UI: assembled HTML/CSS/JS in `src/web/` — no bundler, no React.
- CLI prompts: `@opentui/core` in `src/cli/` (TTY only; `--yes` / non-TTY fallbacks).

## Commands

```bash
bun install
bun test
bun run index.ts --help
bun run --watch index.ts ui
```

Prefer `bun <file>`, `bun test`, `bun install`. Bun loads `.env` automatically — do not add dotenv.

## Layout

| Path | Responsibility |
| --- | --- |
| `index.ts` | CLI router and help text |
| `src/scan.ts` | Discover + parse `SKILL.md` |
| `src/collect.ts` | Pipeline: scan → registry → tags → usage → trust → relations |
| `src/registry.ts` | skills.sh cache |
| `src/providers/` | Explore catalogs |
| `src/install.ts` | Plan/run `npx skills` / `clawhub` (never delete skill dirs) |
| `src/usage.ts` / `ingest.ts` | SQLite usage + transcript ingest |
| `src/server.ts` | `Bun.serve` + `/ws/run` |
| `src/web/` | Partials + `app.js` / `styles.css` |
| `src/cli/` | OpenTUI wizards |
| `src/paths.ts` | `~/.skiller` / `SKILLER_HOME` |

Domain terms: [LEGENDS.md](./LEGENDS.md). User guide: [README.md](./README.md).

## Hard rules

1. **Install/uninstall = external CLI only.** Route through `install.ts`. Do not remove skill folders from disk.
2. **Confirm before mutating.** Interactive paths confirm; scripts use `--yes`. Web APIs require `confirm: true` (or `preview: true` for dry-run).
3. **Tests set `SKILLER_HOME`** (and related env) to a temp dir — never write to the developer’s real `~/.skiller` from tests.
4. **Keep the web UI framework-free.** Edit partials / `app.js` / `styles.css`; `page.ts` assembles HTML.
5. **Single help source of truth:** when changing CLI surface, update both the early `--help` branch and `usage()` in `index.ts`, plus the README CLI reference.
6. **No secrets in the repo.** State belongs under `~/.skiller`, not the working tree.

## APIs to prefer

- `Bun.serve()` (including WebSockets) — not Express.
- `bun:sqlite` — not better-sqlite3.
- `Bun.file` over ad-hoc `fs` reads when convenient.
- Built-in `WebSocket` — not `ws`.

## Docs policy

- README = humans (quick start + guide).
- LEGENDS = glossary / architecture map.
- AGENTS.md = this file (agent workflow).
- Do not revive research checklists under `docs/` unless they describe *current* behaviour.
- Do not commit screen recordings or `.cursor/` local tooling.

## When changing behaviour

- Add or update a `test/*.test.ts` for pure logic (install plans, providers, tags, paths, usage).
- Smoke-check `bun run index.ts list` and `bun run index.ts ui` if you touch the server or collect pipeline.
- Keep provider timeouts and cache TTLs intentional — Explore must stay responsive when one catalog is slow.
