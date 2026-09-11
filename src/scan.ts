import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export interface SkillSource {
  root: string;
  scope: "user" | "project";
  label: string;
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  summary: string;
  scope: string;
  source: string;
  path: string;
  skillFile: string;
  files: number;
  sizeKb: number;
  modified: string;
  frontmatter: Record<string, string>;
  headings: string[];
}

const HOME = homedir();

export function defaultSources(cwd = process.cwd()): SkillSource[] {
  const defs: Array<{ root: string; scope: "user" | "project"; label: string }> = [
    { root: join(HOME, ".agents", "skills"), scope: "user", label: "~/.agents/skills" },
    { root: join(HOME, ".claude", "skills"), scope: "user", label: "~/.claude/skills" },
    { root: join(HOME, ".cursor", "skills"), scope: "user", label: "~/.cursor/skills" },
    { root: join(HOME, ".config", "opencode", "skills"), scope: "user", label: "~/.config/opencode/skills" },
    { root: join(HOME, ".config", "opencode", "skill"), scope: "user", label: "~/.config/opencode/skill" },
    { root: join(cwd, ".agents", "skills"), scope: "project", label: "./.agents/skills" },
    { root: join(cwd, ".claude", "skills"), scope: "project", label: "./.claude/skills" },
    { root: join(cwd, ".cursor", "skills"), scope: "project", label: "./.cursor/skills" },
  ];
  return defs
    .filter((d) => existsSync(d.root))
    .map((d) => ({ ...d, root: resolve(d.root) }));
}

export function parseFrontmatter(markdown: string): { data: Record<string, string>; body: string } {
  const data: Record<string, string> = {};
  if (!markdown.startsWith("---")) return { data, body: markdown };
  const end = markdown.indexOf("\n---", 3);
  if (end === -1) return { data, body: markdown };
  const raw = markdown.slice(3, end).replace(/^\r?\n/, "");
  const body = markdown.slice(end + 4).replace(/^\r?\n/, "");
  const lines = raw.split(/\r?\n/);
  let current: string | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const m = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
    const key = m?.[1];
    const rawValue = m?.[2];
    if (key !== undefined && rawValue !== undefined) {
      current = key;
      let value = stripQuotes(rawValue.trim());
      const block = /^([>|])[+-]?\d*$/.exec(value);
      if (block) {
        const collected: string[] = [];
        for (;;) {
          const next = lines[i + 1];
          if (next === undefined || !/^\s+\S/.test(next)) break;
          i++;
          collected.push(next.trim());
        }
        value = block[0].startsWith("|") ? collected.join("\n") : collected.join(" ");
      }
      data[key] = value;
    } else if (current !== null && /^\s+\S/.test(line)) {
      data[current] = (data[current] ?? "") + " " + line.trim();
    }
  }
  return { data, body };
}

function stripQuotes(value: string): string {
  if (value.length > 1 && /^["'].*["']$/.test(value)) return value.slice(1, -1);
  return value;
}

export function extractSummary(body: string, max = 240): string {
  const para: string[] = [];
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const t = line.trim();
    if (!t || t.startsWith("#")) {
      if (para.length) break;
      continue;
    }
    para.push(t);
    if (para.join(" ").length > max) break;
  }
  const text = para
    .join(" ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

export function extractHeadings(body: string, max = 12): string[] {
  const headings: string[] = [];
  let inFence = false;
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^##\s+(.+)$/.exec(line.trim());
    const heading = m?.[1];
    if (heading) {
      headings.push(heading.replace(/[`*]/g, "").trim());
      if (headings.length >= max) break;
    }
  }
  return headings;
}

function countFiles(dir: string, max = 500): number {
  let count = 0;
  let stack = [dir];
  while (stack.length && count < max) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      if (e.isDirectory()) stack.push(join(current, e.name));
      else count++;
      if (count >= max) break;
    }
  }
  return count;
}

export function scanSkill(source: SkillSource, dir: string): SkillInfo | null {
  const skillFile = join(dir, "SKILL.md");
  if (!existsSync(skillFile)) return null;
  let content: string;
  let stat;
  try {
    content = readFileSync(skillFile, "utf8");
    stat = statSync(skillFile);
  } catch {
    return null;
  }
  const { data, body } = parseFrontmatter(content);
  const name = data.name || basename(dir);
  return {
    id: `${source.scope}:${name}:${basename(dir)}`,
    name,
    description: data.description ?? "",
    summary: extractSummary(body),
    scope: source.scope,
    source: source.label,
    path: dir,
    skillFile,
    files: countFiles(dir),
    sizeKb: Math.max(1, Math.round(stat.size / 1024)),
    modified: stat.mtime.toISOString().slice(0, 10),
    frontmatter: data,
    headings: extractHeadings(body),
  };
}

export function scanAll(sources = defaultSources()): SkillInfo[] {
  const skills: SkillInfo[] = [];
  for (const source of sources) {
    let entries;
    try {
      entries = readdirSync(source.root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue;
      const skill = scanSkill(source, join(source.root, e.name));
      if (skill) skills.push(skill);
    }
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}
