#!/usr/bin/env bun
import { collect, type WithMeta } from "./src/collect";
import { addTags, removeTags, tagCounts } from "./src/tags";
import { startServer } from "./src/server";
import {
  getUsageStats,
  getHarnessSummary,
  getUnusedSkills,
  purgeUsage,
  logUsage,
  usageDbPath,
} from "./src/usage";

const args = process.argv.slice(2);
if (args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  console.log(`skiller — inspect the agent skills installed on this machine

Usage:
  skiller list [--json] [--no-registry] [--refresh] [--tag t1,t2]   list all skills (default)
  skiller wizard                                                    interactive menu (TTY + OpenTUI)
  skiller info <name> [--json]                                      show one skill in detail
  skiller ui [--port 4780] [--open] [--refresh]                     local web view
  skiller tag <name> <tag...>                                       add manual tags to a skill
  skiller untag <name> <tag...>                                     remove manual tags
  skiller tags                                                      list manual tags with counts
  skiller cache [--clear-providers]                                 registry + provider catalog cache status
  skiller home                                                      print data directory (~/.skiller)
  skiller explore [query]                                           search skills (prompts if query omitted)
  skiller install [owner/repo|slug] [--provider skills|clawhub] [--yes]
  skiller uninstall [name] [--provider skills|clawhub] [--repo slug] [--yes]
  skiller usage                                                      show session stats per skill
  skiller usage by-repo                                              usage grouped by owner/repo
  skiller usage by-owner                                             usage grouped by contributor
  skiller usage log <skill> <harness> [--session <id>]              record a session
  skiller usage harness                                            sessions per harness
  skiller usage unused [--days N]                                  skills unused in N days
  skiller usage purge [--days N]                                   purge records older than N days
  skiller usage db                                                 print usage database path
  skiller usage ingest                                             scan harness transcripts and record skill usage
  `);
  process.exit(0);
}
const cmd = args[0] && !args[0].startsWith("--") ? args[0] : "list";
const rest = cmd === args[0] ? args.slice(1) : args;

function flags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined || !arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

const f = flags(rest);
const positional = rest.filter((a) => !a.startsWith("--"));

async function collectFlagged(): Promise<WithMeta[]> {
  const rows = await collect({ refresh: !!f.refresh, registry: !f["no-registry"] });
  const tagFilter =
    typeof f.tag === "string"
      ? f.tag
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean)
      : [];
  if (!tagFilter.length) return rows;
  return rows.filter((r) => tagFilter.every((t) => r.tags.some((x) => x.toLowerCase() === t)));
}

function fmtInstalls(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "k";
  return String(n);
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function renderTable(rows: WithMeta[]): void {
  const termWidth = process.stdout.columns ?? 110;
  const wName = Math.min(32, Math.max(...rows.map((r) => r.name.length), 4));
  const wScope = 18;
  const wInst = 8;
  const wDesc = Math.max(30, termWidth - wName - wScope - wInst - 7);
  const line = (a: string, b: string, c: string, d: string) =>
    `${a.padEnd(wName)} ${b.padEnd(wScope)} ${c.padStart(wInst)} ${d}`;
  console.log(line("NAME", "SOURCE", "INSTALLS", "DESCRIPTION"));
  console.log(line("─".repeat(wName), "─".repeat(wScope), "─".repeat(wInst), "─".repeat(wDesc)));
  for (const r of rows) {
    const desc = truncate(r.description || r.summary, wDesc);
    console.log(
      line(
        truncate(r.name, wName),
        truncate(r.source, wScope),
        fmtInstalls(r.registry?.installs),
        desc,
      ),
    );
  }
  const withReg = rows.filter((r) => r.registry).length;
  console.log(`\n${rows.length} skills · ${withReg} found on skills.sh`);
}

function renderInfo(skill: WithMeta, siblings: WithMeta[]): void {
  console.log(`\n${skill.name}`);
  console.log("─".repeat(skill.name.length));
  console.log(`description : ${skill.description || "(no description)"}`);
  console.log(`summary     : ${skill.summary || "(no content)"}`);
  if (siblings.length > 1) {
    console.log(`installed in: ${siblings.map((s) => `${s.source}`).join(", ")}`);
  } else {
    console.log(`location    : ${skill.source}`);
  }
  console.log(`path        : ${skill.path}`);
  console.log(
    `files       : ${skill.files} · ${skill.sizeKb} KB SKILL.md · modified ${skill.modified}`,
  );
  const tagList = skill.tags.length
    ? skill.tags.join(", ")
    : `(no tags — add with: skiller tag ${skill.name} <tag>)`;
  console.log(`tags        : ${tagList}`);
  if (skill.registry) {
    console.log(
      `skills.sh   : ${fmtInstalls(skill.registry.installs)} installs · ${skill.registry.id}`,
    );
    console.log(`             ${skill.registry.url}`);
  } else {
    console.log("skills.sh   : no exact match in the registry");
  }
  if (skill.related?.repo || skill.related?.siblings?.length) {
    if (skill.related.repo) console.log(`repo        : ${skill.related.repo}`);
    if (skill.related.siblings.length)
      console.log(`same repo   : ${skill.related.siblings.join(", ")}`);
    if (
      skill.related.sameOwner.length &&
      skill.related.sameOwner.length !== skill.related.siblings.length
    ) {
      console.log(`same owner  : ${skill.related.sameOwner.join(", ")}`);
    }
  }
  const extra = Object.entries(skill.frontmatter).filter(
    ([k]) => !["name", "description"].includes(k),
  );
  if (extra.length) {
    console.log("\nextra frontmatter:");
    for (const [k, v] of extra) console.log(`  ${k}: ${truncate(v, 120)}`);
  }
  if (skill.headings.length) {
    console.log("\nsections:");
    for (const h of skill.headings) console.log(`  · ${h}`);
  }
  console.log();
}

function usage(): void {
  console.log(`skiller — inspect the agent skills installed on this machine

Usage:
  skiller list [--json] [--no-registry] [--refresh] [--tag t1,t2]   list all skills (default)
  skiller wizard                                                    interactive menu (TTY + OpenTUI)
  skiller info <name> [--json]                                      show one skill in detail
  skiller ui [--port 4780] [--open] [--refresh]                     local web view
  skiller tag <name> <tag...>                                       add manual tags to a skill
  skiller untag <name> <tag...>                                     remove manual tags
  skiller tags                                                      list manual tags with counts
  skiller cache [--clear-providers]                                 registry + provider catalog cache status
  skiller home                                                      print data directory (~/.skiller)
  skiller explore [query]                                           search skills (prompts if query omitted)
  skiller install [owner/repo|slug] [--provider skills|clawhub] [--yes]
  skiller uninstall [name] [--provider skills|clawhub] [--repo slug] [--yes]
  skiller usage                                                      show session stats per skill
  skiller usage by-repo                                              usage grouped by owner/repo
  skiller usage by-owner                                             usage grouped by contributor
  skiller usage log <skill> <harness> [--session <id>]   record a session
  skiller usage harness                                            sessions per harness
  skiller usage unused [--days N]                                  skills unused in N days
  skiller usage purge [--days N]                                   purge records older than N days
  skiller usage db                                                 print usage database path
  skiller usage ingest                                             scan harness transcripts and record skill usage
  `);
}

async function runExplore(q: string): Promise<void> {
  const { explore } = await import("./src/providers");
  const installed = await collect({ registry: false });
  const results = await explore(q, { installedNames: installed.map((s) => s.name) });
  if (!results.length) {
    console.log(`no skills found for "${q}"`);
    return;
  }
  const wName = Math.min(34, Math.max(...results.map((r) => r.name.length), 4));
  const wProv = Math.max(...results.map((r) => r.provider.length));
  for (const r of results) {
    const flag = r.installed ? "✓" : " ";
    const meta =
      r.installs != null
        ? fmtInstalls(r.installs) + " installs"
        : r.stars != null
          ? fmtInstalls(r.stars) + " stars"
          : "";
    console.log(
      `${flag} ${truncate(r.name, wName).padEnd(wName)}  ${r.provider.padEnd(wProv)}  ${meta.padStart(14)}  ${truncate(r.description, 90)}`,
    );
  }
  console.log(`\n${results.length} result(s) — install with: skiller install <owner/repo>`);
}

async function runInstall(opts: { repo: string; provider?: string }): Promise<void> {
  const { installSkill } = await import("./src/install");
  const result = await installSkill(opts);
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  if (!result.ok) {
    console.error(`install failed (${result.command})`);
    process.exit(1);
  }
  console.log(`installed via ${result.command}`);
}

async function runUninstall(opts: {
  name: string;
  provider?: string;
  repo?: string;
}): Promise<void> {
  const { uninstallSkill } = await import("./src/install");
  const result = await uninstallSkill(opts);
  if (result.stdout) console.log(result.stdout);
  if (result.stderr) console.error(result.stderr);
  if (!result.ok) {
    console.error(`uninstall failed (${result.command})`);
    process.exit(1);
  }
  console.log(`uninstalled via ${result.command}`);
}

async function main(): Promise<void> {
  switch (cmd) {
    case "list": {
      const rows = await collectFlagged();
      if (f.json) {
        console.log(JSON.stringify(rows, null, 2));
      } else {
        renderTable(rows);
      }
      break;
    }
    case "info": {
      if (!positional[0]) {
        console.error("missing skill name: skiller info <name>");
        process.exit(1);
      }
      const rows = await collectFlagged();
      const first = rows.find((r) => r.name.toLowerCase() === String(positional[0]).toLowerCase());
      if (!first) {
        console.error(`skill "${positional[0]}" not found`);
        process.exit(1);
      }
      const matches = rows.filter(
        (r) => r.name.toLowerCase() === String(positional[0]).toLowerCase(),
      );
      if (f.json) {
        console.log(JSON.stringify({ ...first, all: matches }, null, 2));
      } else {
        renderInfo(first, matches);
      }
      break;
    }
    case "ui":
    case "serve":
    case "web":
    case "open": {
      const port = Number(f.port ?? 4780);
      const host = String(f.host ?? "127.0.0.1");
      startServer({ port, host, refreshOnStart: !!f.refresh });
      if (f.open || cmd === "open") {
        const url = `http://${host}:${port}`;
        if (process.platform === "darwin") Bun.$`open ${url}`.quiet();
        else if (process.platform === "win32") Bun.$`cmd /c start "" ${url}`.quiet();
        else Bun.$`xdg-open ${url}`.quiet();
      }
      break;
    }
    case "tag":
    case "untag": {
      if (!positional[0] || positional.length < 2) {
        console.error(`missing arguments: skiller ${cmd} <name> <tag...>`);
        process.exit(1);
      }
      const name = positional[0];
      const tags = positional.slice(1);
      const current = cmd === "tag" ? addTags(name, tags) : removeTags(name, tags);
      console.log(current.length ? `${name}: ${current.join(", ")}` : `${name}: no manual tags`);
      break;
    }
    case "tags": {
      const counts = tagCounts();
      const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (!entries.length) {
        console.log("no manual tags yet — add with: skiller tag <name> <tag...>");
        break;
      }
      const w = Math.max(...entries.map(([t]) => t.length));
      for (const [tag, count] of entries) {
        console.log(
          `${tag.padEnd(w)}  ${String(count).padStart(3)} skill${count === 1 ? "" : "s"}`,
        );
      }
      break;
    }
    case "explore": {
      let q = positional.join(" ").trim();
      if (!q) {
        const { wizardExplore } = await import("./src/cli/wizards");
        q = (await wizardExplore()) ?? "";
        if (!q) {
          console.log("cancelled");
          process.exit(1);
        }
      }
      await runExplore(q);
      break;
    }
    case "install": {
      const { wizardInstall } = await import("./src/cli/wizards");
      const picked = await wizardInstall({
        repo: positional[0],
        provider: typeof f.provider === "string" ? f.provider : undefined,
        yes: !!f.yes,
      });
      if (!picked) {
        console.log("cancelled");
        process.exit(1);
      }
      await runInstall(picked);
      break;
    }
    case "uninstall": {
      const { wizardUninstall } = await import("./src/cli/wizards");
      const picked = await wizardUninstall({
        name: positional[0],
        provider: typeof f.provider === "string" ? f.provider : undefined,
        repo: typeof f.repo === "string" ? f.repo : undefined,
        yes: !!f.yes,
      });
      if (!picked) {
        console.log("cancelled");
        process.exit(1);
      }
      await runUninstall(picked);
      break;
    }
    case "wizard": {
      const { canUseTui } = await import("./src/cli/tui");
      const { wizardMainMenu } = await import("./src/cli/wizards");
      if (!canUseTui()) {
        console.error("skiller wizard requires an interactive TTY");
        process.exit(1);
      }
      const choice = await wizardMainMenu();
      if (choice.action === "cancel") {
        console.log("cancelled");
        break;
      }
      if (choice.action === "list") {
        const rows = await collectFlagged();
        renderTable(rows);
      } else if (choice.action === "explore") {
        await runExplore(choice.query);
      } else if (choice.action === "install") {
        await runInstall(choice);
      } else if (choice.action === "uninstall") {
        await runUninstall(choice);
      } else if (choice.action === "ui") {
        const port = Number(f.port ?? 4780);
        const host = String(f.host ?? "127.0.0.1");
        startServer({ port, host, refreshOnStart: !!f.refresh });
      } else if (choice.action === "usage") {
        const stats = getUsageStats();
        if (!stats.length) {
          console.log(
            "no usage recorded yet — log sessions with: skiller usage log <skill> <harness>",
          );
        } else {
          const w1 = Math.max(...stats.map((s) => s.skillName.length));
          const w2 = Math.max(...stats.map((s) => String(s.totalSessions).length));
          const w3 = Math.max(...stats.map((s) => String(s.uniqueSessions).length));
          console.log(
            `${"SKILL".padEnd(w1)}  ${"SESSIONS".padStart(w2)}  ${"UNIQUE".padStart(w3)}  LAST USED  HARNESS`,
          );
          for (const s of stats) {
            const last = s.lastUsed ? new Date(s.lastUsed).toLocaleDateString() : "never";
            console.log(
              `${s.skillName.padEnd(w1)}  ${String(s.totalSessions).padStart(w2)}  ${String(s.uniqueSessions).padStart(w3)}  ${last.padStart(10)}  ${s.harnesses.join(", ")}`,
            );
          }
        }
      } else if (choice.action === "home") {
        const { ensureSkillerHome, tagsPath, usageDbPath, cacheDir } = await import("./src/paths");
        const home = ensureSkillerHome();
        console.log(home);
        console.log(`  tags     ${tagsPath()}`);
        console.log(`  usage    ${usageDbPath()}`);
        console.log(`  cache    ${cacheDir()}`);
      }
      break;
    }
    case "cache": {
      const { cacheInfo } = await import("./src/registry");
      const { clearProviderCaches, providerCacheInfo } = await import("./src/providers/cache");
      const { ensureSkillerHome } = await import("./src/paths");
      ensureSkillerHome();
      if (f["clear-providers"]) {
        console.log(`cleared ${clearProviderCaches()} provider cache file(s)`);
        break;
      }
      const info = cacheInfo();
      console.log(info.exists ? `cache: ${info.path}` : "no cache yet");
      if (info.exists) {
        console.log(
          `entries: ${info.entries} · updated: ${new Date(info.updatedAt).toLocaleString()}`,
        );
      }
      const pc = providerCacheInfo();
      if (pc.length) {
        console.log("\nprovider catalogs:");
        for (const p of pc) {
          console.log(
            `  ${p.id.padEnd(12)} ${String(p.entries).padStart(5)} entries · updated ${new Date(p.updatedAt).toLocaleString()}`,
          );
        }
      }
      break;
    }
    case "home": {
      const { ensureSkillerHome, tagsPath, usageDbPath, cacheDir } = await import("./src/paths");
      const home = ensureSkillerHome();
      console.log(home);
      console.log(`  tags     ${tagsPath()}`);
      console.log(`  usage    ${usageDbPath()}`);
      console.log(`  cache    ${cacheDir()}`);
      break;
    }
    case "usage": {
      const sub = positional[0] ?? "stats";
      if (sub === "log") {
        const skill = positional[1];
        const harness = positional[2];
        if (!skill || !harness) {
          console.error("missing arguments: skiller usage log <skill> <harness>");
          process.exit(1);
        }
        const sessionId = f.session ?? crypto.randomUUID();
        logUsage(skill, harness, String(sessionId));
        console.log(`recorded: ${skill} · ${harness} · ${sessionId}`);
      } else if (sub === "harness") {
        const summary = getHarnessSummary();
        if (!summary.length) {
          console.log(
            "no usage recorded yet — log sessions with: skiller usage log <skill> <harness>",
          );
          break;
        }
        const w1 = Math.max(...summary.map((s) => s.harness.length));
        for (const s of summary) {
          console.log(
            `${s.harness.padEnd(w1)}  sessions: ${String(s.totalSessions).padStart(4)}  skills: ${s.uniqueSkills}`,
          );
        }
      } else if (sub === "unused") {
        const days = f.days ? Number(f.days) : 90;
        const candidates = getUnusedSkills(days);
        if (!candidates.length) {
          console.log(`no skills unused in ${days} days`);
          break;
        }
        console.log(`skills unused in ${days} days:\n`);
        const w = Math.max(...candidates.map((c) => c.skillName.length));
        for (const c of candidates) {
          console.log(
            `${c.skillName.padEnd(w)}  sessions: ${String(c.totalSessions).padStart(3)}  last used: ${c.lastUsed ?? "never"} (${c.daysSinceLastUse ?? "?"}d ago)`,
          );
        }
      } else if (sub === "purge") {
        const days = f.days ? Number(f.days) : 365;
        const removed = purgeUsage(days);
        console.log(`removed ${removed} record(s) older than ${days} days`);
      } else if (sub === "db") {
        console.log(usageDbPath());
      } else if (sub === "by-repo" || sub === "by-owner") {
        const kind = sub === "by-repo" ? "repo" : "owner";
        const { cachedSources } = await import("./src/registry");
        const { buildRelations, groupUsageByRelation } = await import("./src/relations");
        const { scanAll } = await import("./src/scan");
        const names = scanAll().map((s) => s.name);
        const sources = cachedSources(names);
        const relations = buildRelations(names.map((name) => ({ name, source: sources[name] })));
        const groups = groupUsageByRelation(getUsageStats(), relations, kind, names);
        if (!groups.length) {
          console.log(
            `no ${kind} groups yet — skills need a skills.sh source (owner/repo) and usage data`,
          );
          break;
        }
        for (const g of groups) {
          const last = g.lastUsed ? new Date(g.lastUsed).toLocaleDateString() : "never";
          const unused = g.unused.length ? ` · ${g.unused.length} unused` : "";
          console.log(
            `${g.key}  sessions: ${String(g.totalSessions).padStart(4)}  skills: ${g.skills.length}${unused}  last: ${last}`,
          );
          console.log(`  ${g.skills.join(", ")}`);
        }
      } else if (sub === "ingest") {
        const { ingestAll } = await import("./src/ingest");
        const result = ingestAll();
        console.log(
          `scanned ${result.scannedFiles} transcript file(s), added ${result.added} session(s)`,
        );
        for (const [harness, n] of Object.entries(result.byHarness)) {
          console.log(`  ${harness}: +${n}`);
        }
        const repos = Object.entries(result.byRepo).sort((a, b) => b[1] - a[1]);
        if (repos.length) {
          console.log("by repo:");
          for (const [repo, n] of repos) console.log(`  ${repo}: +${n}`);
        }
        const owners = Object.entries(result.byOwner).sort((a, b) => b[1] - a[1]);
        if (owners.length) {
          console.log("by owner:");
          for (const [owner, n] of owners) console.log(`  ${owner}: +${n}`);
        }
        const relatedHits = Object.entries(result.related).filter(([, r]) => r.siblings.length);
        if (relatedHits.length) {
          console.log("related (same repo):");
          for (const [name, rel] of relatedHits) {
            console.log(`  ${name} → ${rel.repo}: also ${rel.siblings.join(", ")}`);
          }
        }
      } else {
        const stats = getUsageStats();
        if (!stats.length) {
          console.log(
            "no usage recorded yet — log sessions with: skiller usage log <skill> <harness>",
          );
          break;
        }
        const w1 = Math.max(...stats.map((s) => s.skillName.length));
        const w2 = Math.max(...stats.map((s) => String(s.totalSessions).length));
        const w3 = Math.max(...stats.map((s) => String(s.uniqueSessions).length));
        console.log(
          `${"SKILL".padEnd(w1)}  ${"SESSIONS".padStart(w2)}  ${"UNIQUE".padStart(w3)}  LAST USED  HARNESS`,
        );
        console.log(
          `${"─".repeat(w1)}  ${"─".repeat(w2)}  ${"─".repeat(w3)}  ${"─".repeat(10)}  ${"─".repeat(12)}`,
        );
        for (const s of stats) {
          const last = s.lastUsed ? new Date(s.lastUsed).toLocaleDateString() : "never";
          console.log(
            `${s.skillName.padEnd(w1)}  ${String(s.totalSessions).padStart(w2)}  ${String(s.uniqueSessions).padStart(w3)}  ${last.padStart(10)}  ${s.harnesses.join(", ")}`,
          );
        }
      }
      break;
    }
    case "help":
    case "--help":
    case "-h": {
      usage();
      break;
    }
    default: {
      console.error(`unknown command: ${cmd}\n`);
      usage();
      process.exit(1);
    }
  }
}

await main();
