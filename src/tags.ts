import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureSkillerHome, tagsPath } from "./paths";
import type { SkillInfo } from "./scan";

export type TagMap = Record<string, string[]>;

export { tagsPath } from "./paths";

export function loadTags(): TagMap {
  ensureSkillerHome();
  try {
    const parsed = JSON.parse(readFileSync(tagsPath(), "utf8")) as TagMap;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  return {};
}

export function saveTags(map: TagMap): void {
  ensureSkillerHome();
  const path = tagsPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(map, null, 2));
  renameSync(tmp, path);
}

function normalize(tag: string): string {
  return tag.trim().replace(/\s+/g, " ").slice(0, 40);
}

export function addTags(name: string, tags: string[]): string[] {
  const map = loadTags();
  const current = map[name] ?? [];
  for (const raw of tags) {
    const tag = normalize(raw);
    if (!tag) continue;
    if (!current.some((t) => t.toLowerCase() === tag.toLowerCase())) current.push(tag);
  }
  map[name] = current;
  saveTags(map);
  return current;
}

export function removeTags(name: string, tags: string[]): string[] {
  const map = loadTags();
  const rest = (map[name] ?? []).filter((t) => !tags.some((x) => x.toLowerCase() === t.toLowerCase()));
  if (rest.length) map[name] = rest;
  else delete map[name];
  saveTags(map);
  return rest;
}

export function manualTagsFor(name: string, map: TagMap = loadTags()): string[] {
  return map[name] ?? [];
}

interface Rule {
  tag: string;
  pattern: RegExp;
  nameOnly?: boolean;
}

const RULES: Rule[] = [
  { tag: "testing", pattern: /\b(tdd|tests?|testing|spec|coverage|shoehorn|red-green)\b/ },
  { tag: "typescript", pattern: /typescript|type.?safe|type system|typecheck/ },
  { tag: "frontend", pattern: /react|next\.?js|tailwind|\bcss\b|frontend|front-end|components?|heroui/ },
  { tag: "backend", pattern: /\b(hono|api|backend|cloudflare|http)\b/ },
  { tag: "data", pattern: /drizzle|\bsql\b|postgres|database|migrat|\borm\b/ },
  { tag: "devops", pattern: /deploy|docker|dokploy|ci\/cd|pre-commit|\bhooks?\b|hosting|infrastructure/ },
  { tag: "git", pattern: /\bgit\b|merge conflict|\bcommit|branch/ },
  { tag: "architecture", pattern: /architect|system design|domain model|\badr\b|deep modules?|coupling|cohesion|\bsolid\b/ },
  { tag: "ai-agents", pattern: /agent|claude|opencode|orca|\bmcp\b|orchestrat|codex|worktrees?|computer.?use/ },
  { tag: "ai-agents", pattern: /skills?/, nameOnly: true },
  { tag: "writing", pattern: /writing|docs?\b|readme|document|handoff|markdown|technical writing/ },
  { tag: "workflow", pattern: /workflow|handoff|triage|tickets?|spec\b|retro|wizard|plan(ning)?|questionnaire|decision/ },
  { tag: "debugging", pattern: /\bbugs?\b|diagnos|debug|regression|errors?|crash/ },
  { tag: "research", pattern: /research|investigat|primary sources/ },
  { tag: "security", pattern: /security|guardrails?|dangerous|malicious|vulnerab/ },
  { tag: "review", pattern: /\breviews?\b|code.?review|pull request/ },
  { tag: "communication", pattern: /grill|interview|teach|pitch|question/ },
  { tag: "telegram", pattern: /telegram|mini.?app|\btwa\b/ },
];

const MAX_AUTO_TAGS = 4;

export function autoTags(skill: Pick<SkillInfo, "name" | "description" | "summary">): string[] {
  const name = skill.name.toLowerCase();
  const hay = `${skill.name} ${skill.description} ${skill.summary}`.toLowerCase();
  const out: string[] = [];
  for (const rule of RULES) {
    const target = rule.nameOnly ? name : hay;
    if (rule.pattern.test(target) && !out.includes(rule.tag)) out.push(rule.tag);
    if (out.length >= MAX_AUTO_TAGS) break;
  }
  return out;
}

export function tagCounts(map: TagMap = loadTags()): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const tags of Object.values(map)) {
    for (const t of tags) counts[t] = (counts[t] ?? 0) + 1;
  }
  return counts;
}
