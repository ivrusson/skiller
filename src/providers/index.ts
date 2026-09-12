import { awesomeProvider } from "./awesome";
import { clawhubProvider } from "./clawhub";
import { marketplacesProvider } from "./marketplaces";
import { skillsMpProvider } from "./skillsmp";
import { skillsShProvider } from "./skills-sh";
import { assessTrust, type TrustAssessment } from "./trust";
import type { Provider, RemoteSkill } from "./types";

export type { Provider, RemoteSkill } from "./types";
export type { TrustAssessment, TrustLevel } from "./trust";
export { assessTrust, trustLabel } from "./trust";
export { awesomeProvider } from "./awesome";
export { clawhubProvider } from "./clawhub";
export { DEFAULT_MARKETPLACES, marketplacesProvider } from "./marketplaces";
export { skillsMpProvider } from "./skillsmp";
export { skillsShProvider } from "./skills-sh";

export const providers: Provider[] = [skillsShProvider, marketplacesProvider, skillsMpProvider, awesomeProvider, clawhubProvider];

export interface ExploreResult extends RemoteSkill {
  installed?: boolean;
  score?: number;
  trust?: TrustAssessment;
}

const PROVIDER_TIMEOUT_MS = 25_000;

function withTimeout(p: Promise<RemoteSkill[]>): Promise<RemoteSkill[]> {
  return Promise.race([
    p,
    new Promise<RemoteSkill[]>((_, reject) => setTimeout(() => reject(new Error("provider timeout")), PROVIDER_TIMEOUT_MS)),
  ]);
}

function normName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .replace(/^(claude-code|claude|agent)-/, "");
}

function repoBasename(repo: string | undefined): string | undefined {
  // "owner/repo (/subpath)" → "repo"
  const clean = repo?.split(" ")[0];
  return clean?.split("/")[1]?.toLowerCase();
}

function namesRelated(a: string, b: string): boolean {
  const na = normName(a);
  const nb = normName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // claude-code-review ↔ code-review ↔ review
  if (na.length >= 3 && nb.length >= 3 && (na.endsWith(nb) || nb.endsWith(na))) return true;
  return false;
}

/** Prefer names without harness prefixes / closer to the repo basename. */
function betterName(current: string, candidate: string, repo?: string): string {
  const base = repoBasename(repo);
  const curN = normName(current);
  const candN = normName(candidate);
  if (base) {
    if (candN === base && curN !== base) return candidate;
    if (curN === base) return current;
  }
  const strip = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const curRaw = strip(current);
  const candRaw = strip(candidate);
  // Prefer the name that didn't need a prefix stripped
  if (candRaw === candN && curRaw !== curN) return candidate;
  if (curRaw === curN && candRaw !== candN) return current;
  // Prefer the longer normalized form (code-review > review)
  if (candN.length > curN.length) return candidate;
  return current;
}

function scoreOf(s: RemoteSkill): number {
  // installs: primary signal; stars: secondary (repo stars overstate skill popularity)
  return (s.installs ?? 0) + (s.stars ?? 0) / 50;
}

function mergeInto(target: ExploreResult, source: RemoteSkill): void {
  if (!target.provider.split(" + ").includes(source.provider)) {
    target.provider += " + " + source.provider;
  }
  target.installs = Math.max(target.installs ?? 0, source.installs ?? 0) || undefined;
  target.stars = Math.max(target.stars ?? 0, source.stars ?? 0) || undefined;
  target.tags = [...new Set([...(target.tags ?? []), ...(source.tags ?? [])])];
  if (!target.description && source.description) target.description = source.description;
  if (!target.repo && source.repo) target.repo = source.repo;
  if (!target.url && source.url) target.url = source.url;
  target.name = betterName(target.name, source.name, target.repo ?? source.repo);
}

export async function explore(query: string, opts: { installedNames?: string[] } = {}): Promise<ExploreResult[]> {
  const settled = await Promise.allSettled(providers.map((p) => withTimeout(p.search(query))));
  const out: ExploreResult[] = [];

  const findMatch = (skill: RemoteSkill): ExploreResult | undefined => {
    const repoKey = skill.repo?.split(" ")[0]?.toLowerCase();
    const base = repoBasename(skill.repo);
    return out.find((o) => {
      const oRepoKey = o.repo?.split(" ")[0]?.toLowerCase();
      if (repoKey && oRepoKey && repoKey === oRepoKey) return true;
      // Fuzzy: related names and the repo basename agrees (or one side has no repo)
      if (namesRelated(skill.name, o.name)) {
        const oBase = repoBasename(o.repo);
        return !oBase || !base || oBase === base;
      }
      return false;
    });
  };

  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const skill of r.value) {
      const existing = findMatch(skill);
      if (existing) {
        mergeInto(existing, skill);
        continue;
      }
      out.push({ ...skill });
    }
  }
  if (opts.installedNames) {
    const installed = new Set(opts.installedNames.map((n) => n.toLowerCase()));
    for (const s of out) s.installed = installed.has(s.name.toLowerCase());
  }
  for (const s of out) {
    s.score = Math.round(scoreOf(s) * 10) / 10;
    s.trust = assessTrust(s);
  }
  out.sort((a, b) => scoreOf(b) - scoreOf(a) || a.name.localeCompare(b.name));
  return out;
}
