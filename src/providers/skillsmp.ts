import { cacheFresh, readCache, writeCache } from "./cache";
import { repoFromGitHubUrl, type Fetcher, type Provider, type RemoteSkill } from "./types";

const TTL_MS = 24 * 60 * 60 * 1000;
const API = "https://skillsmp.com/api/skills?page=";
const MAX_PAGES = 12; // public API caps around 1,200 results

interface RawSkillsMp {
  id?: string;
  name?: string;
  author?: string;
  description?: string;
  githubUrl?: string;
  stars?: number;
  forks?: number;
  route?: { ownerSlug?: string; repoSlug?: string };
}

interface RawResponse {
  skills?: RawSkillsMp[];
  pagination?: { page?: number; totalPages?: number };
}

function toRemote(raw: RawSkillsMp): RemoteSkill | null {
  const name = raw.name?.trim();
  if (!name) return null;
  const repo =
    repoFromGitHubUrl(raw.githubUrl ?? "") ??
    (raw.route?.ownerSlug && raw.route?.repoSlug
      ? `${raw.route.ownerSlug}/${raw.route.repoSlug}`
      : undefined);
  return {
    name,
    description: raw.description ?? "",
    url: raw.githubUrl ?? (repo ? `https://github.com/${repo}` : `https://skillsmp.com`),
    provider: "skillsmp",
    repo,
    stars: raw.stars,
    tags: raw.author ? [raw.author] : undefined,
  };
}

async function syncCatalog(fetcher: Fetcher): Promise<RemoteSkill[]> {
  const get = async (page: number): Promise<RawResponse> => {
    const res = await fetcher(API + page, {
      signal: AbortSignal.timeout(20_000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`skillsmp HTTP ${res.status}`);
    return (await res.json()) as RawResponse;
  };
  const first = await get(1);
  const totalPages = Math.min(first.pagination?.totalPages ?? 1, MAX_PAGES);
  const rest =
    totalPages > 1
      ? await Promise.all(Array.from({ length: totalPages - 1 }, (_, i) => get(i + 2)))
      : [];
  const out = [first, ...rest]
    .flatMap((r) => r.skills ?? [])
    .map(toRemote)
    .filter((s): s is RemoteSkill => !!s);
  if (!out.length) throw new Error("skillsmp returned no skills");
  return out;
}

function matches(skill: RemoteSkill, q: string): boolean {
  const hay = (
    skill.name +
    " " +
    skill.description +
    " " +
    (skill.tags ?? []).join(" ")
  ).toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((t) => hay.includes(t));
}

export const skillsMpProvider: Provider = {
  id: "skillsmp",
  label: "SkillsMP",

  async search(query, fetcher = fetch): Promise<RemoteSkill[]> {
    const term = query.trim();
    if (!term) return [];
    const cached = readCache<RemoteSkill[]>("skillsmp");
    let catalog = cacheFresh("skillsmp", TTL_MS) && cached ? cached : null;
    if (!catalog) {
      try {
        catalog = await syncCatalog(fetcher);
        writeCache("skillsmp", catalog);
      } catch {
        catalog = cached ?? [];
      }
    }
    return catalog.filter((s) => matches(s, term));
  },
};
