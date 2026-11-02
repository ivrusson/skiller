import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir, ensureSkillerHome } from "./paths";
import { isInstallableRepo } from "./install";

export interface SkillsListEntry {
  name: string;
  path: string;
  scope: string;
  agents: string[];
  source: string;
  sourceUrl?: string;
  sourceType?: string;
}

const DEFAULT_TTL_MS = 10 * 60 * 1000;

/** Display name (from `skills list --json`) → CLI `--agent` slug. */
const AGENT_DISPLAY_TO_SLUG: Record<string, string> = {
  "aider desk": "aider-desk",
  "claude code": "claude-code",
  claude: "claude-code",
  cursor: "cursor",
  codex: "codex",
  opencode: "opencode",
  "open code": "opencode",
  openclaw: "openclaw",
  "gemini cli": "gemini-cli",
  "github copilot": "github-copilot",
  "kimi code cli": "kimi-code-cli",
  "kiro cli": "kiro-cli",
  antigravity: "antigravity",
  amp: "amp",
  windsurf: "windsurf",
  warp: "warp",
  zed: "zed",
  pi: "pi",
  goose: "goose",
  cline: "cline",
  "roo code": "roo",
  droid: "droid",
};

export function skillsListCachePath(): string {
  return join(cacheDir(), "skills-list.json");
}

/** Map a skills-list display agent name to a CLI `-a` slug. */
export function agentDisplayToSlug(display: string): string {
  const key = display.trim().toLowerCase();
  if (AGENT_DISPLAY_TO_SLUG[key]) return AGENT_DISPLAY_TO_SLUG[key]!;
  // Already a slug?
  if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) return key;
  return key.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function parseSkillsListJson(raw: string): SkillsListEntry[] {
  const trimmed = raw.trim();
  // npx may prefix npm notices; find the JSON array
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("skills list --json: no JSON array in output");
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("skills list --json: expected array");
  return parsed.map((row) => {
    const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    return {
      name: String(r.name ?? ""),
      path: String(r.path ?? ""),
      scope: String(r.scope ?? ""),
      agents: Array.isArray(r.agents) ? r.agents.map((a) => String(a)) : [],
      source: String(r.source ?? ""),
      sourceUrl: typeof r.sourceUrl === "string" ? r.sourceUrl : undefined,
      sourceType: typeof r.sourceType === "string" ? r.sourceType : undefined,
    };
  });
}

type Spawner = (
  argv: string[],
  timeoutMs: number,
) => Promise<{ exit: number; stdout: string; stderr: string }>;

async function defaultSpawn(
  argv: string[],
  timeoutMs: number,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exit, stdout, stderr };
  } finally {
    clearTimeout(timer);
  }
}

interface CacheFile {
  fetchedAt: number;
  entries: SkillsListEntry[];
}

function readCache(ttlMs: number): SkillsListEntry[] | null {
  const path = skillsListCachePath();
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as CacheFile;
    if (!data || !Array.isArray(data.entries) || typeof data.fetchedAt !== "number") return null;
    if (Date.now() - data.fetchedAt > ttlMs) return null;
    return data.entries;
  } catch {
    return null;
  }
}

function writeCache(entries: SkillsListEntry[]): void {
  ensureSkillerHome();
  mkdirSync(cacheDir(), { recursive: true });
  const payload: CacheFile = { fetchedAt: Date.now(), entries };
  writeFileSync(skillsListCachePath(), JSON.stringify(payload, null, 2));
}

export async function fetchSkillsListGlobal(
  opts: {
    refresh?: boolean;
    ttlMs?: number;
    timeoutMs?: number;
    spawn?: Spawner;
  } = {},
): Promise<{ ok: true; entries: SkillsListEntry[] } | { ok: false; error: string }> {
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  if (!opts.refresh) {
    const cached = readCache(ttlMs);
    if (cached) return { ok: true, entries: cached };
  }

  const spawn = opts.spawn ?? defaultSpawn;
  const argv = ["npx", "-y", "skills", "list", "-g", "--json"];
  try {
    const r = await spawn(argv, opts.timeoutMs ?? 60_000);
    if (r.exit !== 0) {
      return { ok: false, error: r.stderr.trim() || `skills list exited ${r.exit}` };
    }
    const entries = parseSkillsListJson(r.stdout);
    writeCache(entries);
    return { ok: true, entries };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** All unique agent display names seen across the machine's skills list. */
export function universeAgents(entries: SkillsListEntry[]): string[] {
  const set = new Set<string>();
  for (const e of entries) for (const a of e.agents) set.add(a);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export interface RepairGap {
  name: string;
  source: string;
  missingDisplay: string[];
  missingSlugs: string[];
}

/** Compute skills that are missing some agents relative to a target set (display names). */
export function computeRepairGaps(
  entries: SkillsListEntry[],
  opts: {
    names?: string[];
    /** Target agents as display names; default = universe of all agents in entries. */
    targetDisplay?: string[];
  } = {},
): RepairGap[] {
  const nameFilter = opts.names?.map((n) => n.toLowerCase());
  const target = opts.targetDisplay ?? universeAgents(entries);
  const gaps: RepairGap[] = [];
  for (const e of entries) {
    if (nameFilter && !nameFilter.includes(e.name.toLowerCase())) continue;
    if (!isInstallableRepo(e.source.split(" ")[0]?.trim() ?? "")) continue;
    const have = new Set(e.agents.map((a) => a.toLowerCase()));
    const missingDisplay = target.filter((a) => !have.has(a.toLowerCase()));
    if (!missingDisplay.length) continue;
    const missingSlugs = [...new Set(missingDisplay.map(agentDisplayToSlug))];
    gaps.push({
      name: e.name,
      source: e.source.split(" ")[0]!.trim(),
      missingDisplay,
      missingSlugs,
    });
  }
  return gaps;
}

/** Index list entries by skill name (first wins; prefer agents-skills path if multiple). */
export function indexByName(entries: SkillsListEntry[]): Map<string, SkillsListEntry> {
  const map = new Map<string, SkillsListEntry>();
  for (const e of entries) {
    const key = e.name.toLowerCase();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, e);
      continue;
    }
    const prefer = e.path.includes("/.agents/skills/") && !prev.path.includes("/.agents/skills/");
    if (prefer) map.set(key, e);
  }
  return map;
}
