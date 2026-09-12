import { cacheFresh, readCache, writeCache } from "./cache";
import type { Fetcher, Provider, RemoteSkill } from "./types";

const TTL_MS = 6 * 60 * 60 * 1000;
const API = "https://skills.sh/api/search?q=";

interface RawSkill {
  id: string;
  skillId: string;
  name: string;
  description?: string;
  installs: number;
  source: string;
}

type TermCache = Record<string, RemoteSkill[]>;

function toRemote(raw: RawSkill): RemoteSkill {
  return {
    name: raw.name || raw.skillId || raw.id,
    description: raw.description ?? "",
    url: `https://www.skills.sh/${raw.id}`,
    provider: "skills.sh",
    repo: raw.source,
    installs: raw.installs ?? 0,
  };
}

async function queryApi(term: string, fetcher: Fetcher): Promise<RemoteSkill[]> {
  const res = await fetcher(API + encodeURIComponent(term), {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`skills.sh HTTP ${res.status}`);
  const json = (await res.json()) as { skills?: RawSkill[] };
  return (json.skills ?? []).map(toRemote);
}

export const skillsShProvider: Provider = {
  id: "skills-sh",
  label: "skills.sh",

  async search(query, fetcher = fetch): Promise<RemoteSkill[]> {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    const cached = readCache<TermCache>("skills-sh") ?? {};
    if (cacheFresh("skills-sh", TTL_MS) && cached[term]) return cached[term]!;
    try {
      const results = await queryApi(term, fetcher);
      cached[term] = results;
      writeCache("skills-sh", cached);
      return results;
    } catch {
      return cached[term] ?? [];
    }
  },
};
