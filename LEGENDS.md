# Legends

Glossary and mental map for skiller. Read this when a term in the README or UI is unclear, or when you need to know how the pieces fit.

## Domain

| Term                   | Meaning                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skill**              | A folder with a `SKILL.md` (Agent Skills format): frontmatter (`name`, `description`, …) plus markdown body that tells an agent how to do a job.                                             |
| **Harness**            | The agent runtime that loads skills — Claude Code, Cursor, Codex, OpenCode, and similar.                                                                                                     |
| **Scope**              | Where a skill lives: **user** (`~/.…/skills`) vs **project** (`./.…/skills`).                                                                                                                |
| **Source**             | Human-readable origin label in the UI/CLI (e.g. `user/claude`, `project/agents`).                                                                                                            |
| **Registry**           | [skills.sh](https://skills.sh) metadata used to enrich _installed_ skills (exact name → install count, id, url). Cached 24h.                                                                 |
| **Provider**           | An Explore catalog (skills.sh search, Claude plugin marketplaces, SkillsMP, awesome-lists, ClawHub). Each has its own cache under `~/.skiller/cache/providers/`.                             |
| **Remote skill**       | A catalog hit from Explore — may not be installed yet. Often keyed by GitHub `owner/repo`.                                                                                                   |
| **Installs**           | Download/install count from a registry or provider. Treated as a weak popularity signal, not quality.                                                                                        |
| **Trust**              | Heuristic badge on skills (`HIGH` / `MEDIUM` / `LOW` / unknown) from known publishers, cross-listing, installs, and stars. **Not a security audit** — always read a skill before installing. |
| **Tag**                | Label on a skill. **Auto** tags come from content rules; **manual** tags are yours in `tags.json`. Filters combine with AND.                                                                 |
| **Related / siblings** | Other installed skills that share the same `owner/repo` (or owner) according to registry `source`.                                                                                           |
| **Coverage / agents**  | Which harnesses a skill is linked into, from `npx skills list -g --json` (`agents[]`). Skiller displays this; it does not invent symlinks.                                                   |
| **Repair**             | Re-run `npx skills add <source> -g -s <name> -a <missing…>` so missing harness links are created by the official CLI.                                                                        |
| **Usage event**        | One recorded invocation of a skill by a harness (`usage.db`). Ingested from transcripts or logged by hand.                                                                                   |
| **Session**            | Logical unit of usage (often a transcript / conversation id). Deduped so the same session does not double-count.                                                                             |

## Runtime map

```
                    ┌─────────────┐
   SKILL.md roots → │   scan.ts   │
                    └──────┬──────┘
                           ▼
                    ┌─────────────┐     skills.sh API
   tags / usage  →  │ collect.ts  │ ←── registry.ts
   trust / related  │             │ ←── skills-cli.ts
   agents overlay   └──────┬──────┘     (skills list -g --json)
                           ▼
              ┌────────────┴────────────┐
              ▼                         ▼
        index.ts (CLI)            server.ts (web)
              │                         │
              │                   web/ + /ws/run
              ▼                         ▼
        OpenTUI wizards           Installed / Explore
              │                         │
              └──────────┬──────────────┘
                         ▼
                   install.ts
         thin wrapper: npx skills add|remove|update
                    (+ clawhub)
```

**Explore** does not go through `collect`. It calls `providers.explore(query)`, dedupes by repo/name relatedness, ranks by a simple score (`installs + stars/50`), and marks rows already present on disk.

**Install / uninstall / update / repair** always spawn an external CLI. Flags `-a/--agent`, `-s/--skill`, `--all`, and `--copy` project 1:1 onto `npx skills`. Skiller plans the command, asks for confirmation (unless `--yes`), streams output, then refreshes the local catalog. It never `rm -rf`s skill folders and never creates harness symlinks itself.

## Data under `~/.skiller`

| Path                        | Owner           | Role                                     |
| --------------------------- | --------------- | ---------------------------------------- |
| `tags.json`                 | `tags.ts`       | Manual tags keyed by skill name          |
| `usage.db`                  | `usage.ts`      | SQLite `usage_events`                    |
| `cache/registry.json`       | `registry.ts`   | skills.sh enrichments                    |
| `cache/skills-list.json`    | `skills-cli.ts` | `skills list -g --json` (agent coverage) |
| `cache/providers/<id>.json` | `providers/*`   | Explore catalogs                         |

Override root with `SKILLER_HOME` (tests do this). First run may migrate legacy XDG locations.

## Providers (Explore)

| id            | How it feeds Explore                                            |
| ------------- | --------------------------------------------------------------- |
| `skills-sh`   | Search API + install counts                                     |
| `marketplace` | Claude Code `marketplace.json` catalogs from known GitHub repos |
| `skillsmp`    | Paginated public SkillsMP API                                   |
| `awesome`     | Parsed awesome-list READMEs                                     |
| `clawhub`     | `clawhub search` (or `npx clawhub`)                             |

Each provider call is capped (~25s) so one slow catalog cannot stall the UI. Details and extension points live in `src/providers/`.

## Ingest sources

| Harness     | Where                                       | Detection                              |
| ----------- | ------------------------------------------- | -------------------------------------- |
| Claude Code | `~/.claude/projects/**`                     | `Skill` tool invocations (exact)       |
| Cursor      | `~/.cursor/projects/*/agent-transcripts/**` | Reads of known skill paths (heuristic) |

Heuristic matches can miss usages or rare false positives. Prefer exact harness hooks (`skiller usage log …`) when you control the harness.

## CLI vs web

| Job                                   | CLI                            | Web                                                |
| ------------------------------------- | ------------------------------ | -------------------------------------------------- |
| Inventory + detail                    | `list` / `info`                | Installed tab + drawer                             |
| Cross-catalog search                  | `explore`                      | Explore tab                                        |
| Install / uninstall / update / repair | wizards + flags → `npx skills` | Terminal overlay (+ Agents / Copy)                 |
| Tags                                  | `tag` / `untag`                | Drawer + chip bar                                  |
| Usage analytics                       | `usage *`                      | Shown via collect payload (no separate usage page) |
| Cache / home                          | `cache` / `home`               | Refresh buttons for registry / providers           |

## Kazi docs and Linear

Kazi features are tracked twice, and the two copies stay together. Each feature page in the Kazi repo carries `linear: KAZ-N` in its YAML front matter. When a feature is examined, open that Linear issue and leave the page and the issue saying the same thing. A feature that is not built yet still gets both a page and an issue on the Producto project. The rule is in Kazi's `AGENTS.md`, `CLAUDE.md`, and `docs/glossary.md` (the term is **Referencia Linear**, issue KAZ-80).

## Non-goals

- Skiller is **not** a skill authoring IDE.
- It is **not** a cloud registry — catalogs are read-only mirrors plus local state.
- Trust badges are **not** a substitute for reading a skill before you install it.
- It does **not** manage harness symlinks or copies itself — that is `npx skills` only (no `skiller link`).
