import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { cachedSources } from "./registry";
import { buildRelations, normalizeRepo, ownerOf, type SkillRelations } from "./relations";
import { scanAll } from "./scan";
import { logUsageOnce } from "./usage";

export interface IngestResult {
  added: number;
  scannedFiles: number;
  byHarness: Record<string, number>;
  /** Newly recorded sessions rolled up by `owner/repo`. */
  byRepo: Record<string, number>;
  /** Newly recorded sessions rolled up by GitHub owner. */
  byOwner: Record<string, number>;
  /** Relation map for skills that gained usage this run. */
  related: Record<string, SkillRelations>;
}

export interface IngestOpts {
  claudeDir?: string;
  cursorDir?: string;
  knownSkills?: string[];
  /** Optional `skill → owner/repo` overrides (else registry cache). */
  sources?: Record<string, string | null | undefined>;
}

const CURSOR_READ_TOOLS = new Set(["Read", "ReadFile"]);
const SKILL_PATH_RE = /\/skills\/([^/]+)\//;

function* walkJsonl(dir: string): Generator<string> {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkJsonl(p);
    else if (e.name.endsWith(".jsonl")) yield p;
  }
}

function sessionIdOf(file: string): string {
  const base = file.split("/").pop() ?? file;
  return base.replace(/\.jsonl$/, "");
}

function* eachLine(file: string): Generator<Record<string, unknown>> {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line) as Record<string, unknown>;
    } catch {}
  }
}

function contentBlocks(msg: unknown): Array<Record<string, unknown>> {
  if (typeof msg !== "object" || msg === null) return [];
  const content = (msg as Record<string, unknown>).content;
  return Array.isArray(content) ? (content as Array<Record<string, unknown>>) : [];
}

function* toolInputs(file: string): Generator<{ name: string; input: Record<string, unknown>; ts: number }> {
  const mtime = statSync(file).mtimeMs;
  for (const obj of eachLine(file)) {
    const message = obj.message as Record<string, unknown> | undefined;
    for (const block of contentBlocks(message)) {
      if (block.type !== "tool_use") continue;
      const input = typeof block.input === "object" && block.input !== null ? (block.input as Record<string, unknown>) : {};
      yield {
        name: String(block.name ?? ""),
        input,
        ts: typeof obj.timestamp === "string" || typeof obj.timestamp === "number" ? new Date(obj.timestamp as string).getTime() || mtime : mtime,
      };
    }
  }
}

function bumpGroup(map: Record<string, number>, key: string | null | undefined): void {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
}

function recordHit(
  skill: string,
  harness: string,
  sessionId: string,
  ts: number,
  relations: Map<string, SkillRelations>,
  result: IngestResult,
): void {
  if (!logUsageOnce(skill, harness, sessionId, ts)) return;
  result.added++;
  result.byHarness[harness] = (result.byHarness[harness] ?? 0) + 1;
  const rel = relations.get(skill);
  if (rel) {
    result.related[skill] = rel;
    bumpGroup(result.byRepo, rel.repo);
    bumpGroup(result.byOwner, rel.owner);
  }
}

function ingestClaude(
  dir: string,
  known: Map<string, string>,
  relations: Map<string, SkillRelations>,
  result: IngestResult,
): void {
  for (const file of walkJsonl(dir)) {
    result.scannedFiles++;
    const sessionId = sessionIdOf(file);
    for (const { name, input, ts } of toolInputs(file)) {
      if (name !== "Skill") continue;
      const raw = typeof input.skill === "string" ? input.skill : "";
      const skill = known.get(raw.toLowerCase());
      if (!skill) continue;
      recordHit(skill, "claude-code", sessionId, ts, relations, result);
    }
  }
}

function ingestCursor(
  dir: string,
  known: Map<string, string>,
  relations: Map<string, SkillRelations>,
  result: IngestResult,
): void {
  let projects: ReturnType<typeof readdirSync>;
  try {
    projects = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const p of projects) {
    if (!p.isDirectory()) continue;
    const transcripts = join(dir, p.name, "agent-transcripts");
    if (!existsSync(transcripts)) continue;
    for (const file of walkJsonl(transcripts)) {
      result.scannedFiles++;
      const sessionId = sessionIdOf(file);
      for (const { name, input, ts } of toolInputs(file)) {
        if (!CURSOR_READ_TOOLS.has(name)) continue;
        const path = typeof input.path === "string" ? input.path : typeof input.file_path === "string" ? input.file_path : "";
        const m = SKILL_PATH_RE.exec(path);
        if (!m) continue;
        const dirName = m[1]!;
        if (dirName.startsWith("_") || dirName.startsWith(".")) continue;
        const skill = known.get(dirName.toLowerCase());
        if (!skill) continue;
        recordHit(skill, "cursor", sessionId, ts, relations, result);
      }
    }
  }
}

export function ingestAll(opts: IngestOpts = {}): IngestResult {
  const names = opts.knownSkills ?? scanAll().map((s) => s.name);
  const known = new Map(names.map((n) => [n.toLowerCase(), n]));
  const sources = opts.sources ?? cachedSources(names);
  const relations = buildRelations(names.map((name) => ({ name, source: sources[name] })));

  const result: IngestResult = {
    added: 0,
    scannedFiles: 0,
    byHarness: {},
    byRepo: {},
    byOwner: {},
    related: {},
  };
  ingestClaude(opts.claudeDir ?? join(homedir(), ".claude", "projects"), known, relations, result);
  ingestCursor(opts.cursorDir ?? join(homedir(), ".cursor", "projects"), known, relations, result);
  return result;
}

export { normalizeRepo, ownerOf, buildRelations };
