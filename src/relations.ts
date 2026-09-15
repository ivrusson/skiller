/** Group installed skills by skills.sh / GitHub owner+repo. */

export interface SkillOrigin {
  name: string;
  /** Raw registry source or install id, e.g. `vercel-labs/agent-skills`. */
  source?: string | null;
}

export interface SkillRelations {
  /** Normalized `owner/repo` (marketplace suffixes stripped). */
  repo: string | null;
  owner: string | null;
  /** Other installed skills from the same repo. */
  siblings: string[];
  /** Other installed skills from the same owner (includes other repos). */
  sameOwner: string[];
}

const REPO_RE = /^(?!-)[A-Za-z0-9_.-]+\/(?!-)[A-Za-z0-9_.-]+$/;

/** `owner/repo (/path)` or bare `owner/repo` → `owner/repo`. */
export function normalizeRepo(source: string | null | undefined): string | null {
  if (!source) return null;
  const base = String(source).split(/\s+/)[0]!.trim();
  if (!REPO_RE.test(base)) return null;
  return base.toLowerCase();
}

export function ownerOf(repo: string | null | undefined): string | null {
  if (!repo) return null;
  const owner = repo.split("/")[0];
  return owner || null;
}

export function originFromSource(
  name: string,
  source?: string | null,
): SkillOrigin & { repo: string | null; owner: string | null } {
  const repo = normalizeRepo(source);
  return { name, source: source ?? null, repo, owner: ownerOf(repo) };
}

/**
 * Build per-skill relation maps from installed origins.
 * Skills without a parseable `owner/repo` source get empty sibling lists.
 */
export function buildRelations(origins: SkillOrigin[]): Map<string, SkillRelations> {
  const parsed = origins.map((o) => originFromSource(o.name, o.source));
  const byRepo = new Map<string, string[]>();
  const byOwner = new Map<string, string[]>();

  for (const p of parsed) {
    if (p.repo) {
      const list = byRepo.get(p.repo) ?? [];
      list.push(p.name);
      byRepo.set(p.repo, list);
    }
    if (p.owner) {
      const list = byOwner.get(p.owner) ?? [];
      list.push(p.name);
      byOwner.set(p.owner, list);
    }
  }

  const out = new Map<string, SkillRelations>();
  for (const p of parsed) {
    const siblings = p.repo ? (byRepo.get(p.repo) ?? []).filter((n) => n !== p.name) : [];
    const sameOwner = p.owner ? (byOwner.get(p.owner) ?? []).filter((n) => n !== p.name) : [];
    out.set(p.name, {
      repo: p.repo,
      owner: p.owner,
      siblings: [...new Set(siblings)].sort((a, b) => a.localeCompare(b)),
      sameOwner: [...new Set(sameOwner)].sort((a, b) => a.localeCompare(b)),
    });
  }
  return out;
}

export interface RelationGroupStats {
  key: string;
  kind: "repo" | "owner";
  skills: string[];
  totalSessions: number;
  uniqueSessions: number;
  lastUsed: string | null;
  /** Skills in the group with zero recorded usage. */
  unused: string[];
}

type UsageLike = {
  skillName: string;
  totalSessions: number;
  uniqueSessions?: number;
  lastUsed: string | null;
};

/** Aggregate per-skill usage into repo or owner buckets. */
export function groupUsageByRelation(
  usage: UsageLike[],
  relations: Map<string, SkillRelations>,
  kind: "repo" | "owner",
  /** All known skill names (so unused siblings appear in the group). */
  allNames?: string[],
): RelationGroupStats[] {
  const usageMap = new Map(usage.map((u) => [u.skillName.toLowerCase(), u]));
  const relByLower = new Map<string, SkillRelations>();
  for (const [name, rel] of relations) relByLower.set(name.toLowerCase(), rel);

  const names = allNames ?? [...new Set([...usage.map((u) => u.skillName), ...relations.keys()])];

  const buckets = new Map<string, string[]>();
  for (const name of names) {
    const rel = relByLower.get(name.toLowerCase());
    const key = kind === "repo" ? rel?.repo : rel?.owner;
    if (!key) continue;
    const list = buckets.get(key) ?? [];
    if (!list.some((n) => n.toLowerCase() === name.toLowerCase())) list.push(name);
    buckets.set(key, list);
  }

  const groups: RelationGroupStats[] = [];
  for (const [key, skills] of buckets) {
    let totalSessions = 0;
    let uniqueSessions = 0;
    let lastMs = 0;
    const unused: string[] = [];
    for (const name of skills) {
      const u = usageMap.get(name.toLowerCase());
      if (!u || u.totalSessions === 0) {
        unused.push(name);
        continue;
      }
      totalSessions += u.totalSessions;
      uniqueSessions += u.uniqueSessions ?? u.totalSessions;
      if (u.lastUsed) {
        const t = Date.parse(u.lastUsed);
        if (t > lastMs) lastMs = t;
      }
    }
    groups.push({
      key,
      kind,
      skills: [...skills].sort((a, b) => a.localeCompare(b)),
      totalSessions,
      uniqueSessions,
      lastUsed: lastMs ? new Date(lastMs).toISOString() : null,
      unused: unused.sort((a, b) => a.localeCompare(b)),
    });
  }

  return groups.sort((a, b) => b.totalSessions - a.totalSessions || a.key.localeCompare(b.key));
}
