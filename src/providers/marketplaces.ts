import { cacheFresh, readCache, writeCache } from "./cache";
import { repoFromGitHubUrl, type Fetcher, type Provider, type RemoteSkill } from "./types";

const TTL_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_MARKETPLACES = [
  "anthropics/claude-plugins-official",
  "alirezarezvani/claude-skills",
  "addyosmani/agent-skills",
] as const;

interface MarketplaceSource {
  source?: string;
  url?: string;
  repo?: string;
  path?: string;
}

interface MarketplacePlugin {
  name: string;
  description?: string;
  version?: string;
  author?: string;
  category?: string;
  keywords?: string[];
  source?: string | MarketplaceSource;
  homepage?: string;
}

interface MarketplaceJson {
  name?: string;
  description?: string;
  plugins?: MarketplacePlugin[];
}

function rawUrl(repo: string, ref: string, path: string): string {
  return `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;
}

function pluginRepo(plugin: MarketplacePlugin, marketplaceRepo: string): string | undefined {
  const src = plugin.source;
  if (typeof src === "string") {
    if (src.startsWith("./")) return marketplaceRepo;
    return repoFromGitHubUrl(src) ?? src.match(/^[^/\s]+\/[^/\s]+$/)?.[0];
  }
  if (src && typeof src === "object") {
    if (src.source === "github" && src.repo) return src.repo;
    if (src.url) return repoFromGitHubUrl(src.url);
  }
  return undefined;
}

function pluginPath(plugin: MarketplacePlugin): string | undefined {
  const src = plugin.source;
  if (typeof src === "string" && src.startsWith("./")) return src.slice(2);
  if (src && typeof src === "object" && typeof src.path === "string") return src.path;
  return undefined;
}

function pluginUrl(plugin: MarketplacePlugin, repo: string | undefined): string {
  if (plugin.homepage) return plugin.homepage;
  if (repo) return `https://github.com/${repo}`;
  return "";
}

function toRemote(plugin: MarketplacePlugin, marketplaceRepo: string): RemoteSkill {
  const repo = pluginRepo(plugin, marketplaceRepo);
  const path = pluginPath(plugin);
  return {
    name: plugin.name,
    description: plugin.description ?? "",
    url: pluginUrl(plugin, repo),
    provider: "marketplace",
    repo: repo ? (path && !plugin.homepage ? `${repo} (/${path})` : repo) : undefined,
    tags: [...new Set([plugin.category, ...(plugin.keywords ?? [])].filter((t): t is string => !!t))],
  };
}

async function fetchMarketplace(repo: string, fetcher: Fetcher): Promise<RemoteSkill[]> {
  const res = await fetcher(rawUrl(repo, "HEAD", ".claude-plugin/marketplace.json"), {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${repo} HTTP ${res.status}`);
  const json = (await res.json()) as MarketplaceJson;
  return (json.plugins ?? []).map((p) => toRemote(p, repo));
}

async function syncCatalog(fetcher: Fetcher): Promise<RemoteSkill[]> {
  const settled = await Promise.allSettled(DEFAULT_MARKETPLACES.map((r) => fetchMarketplace(r, fetcher)));
  const out: RemoteSkill[] = [];
  for (const r of settled) if (r.status === "fulfilled") out.push(...r.value);
  if (!out.length) throw new Error("no marketplace reachable");
  return out;
}

function matches(skill: RemoteSkill, q: string): boolean {
  const hay = (skill.name + " " + skill.description + " " + (skill.tags ?? []).join(" ")).toLowerCase();
  return q.toLowerCase().split(/\s+/).every((t) => hay.includes(t));
}

export const marketplacesProvider: Provider = {
  id: "marketplace",
  label: "Claude marketplaces",

  async search(query, fetcher = fetch): Promise<RemoteSkill[]> {
    const cached = readCache<RemoteSkill[]>("marketplace");
    let catalog = cacheFresh("marketplace", TTL_MS) && cached ? cached : null;
    if (!catalog) {
      try {
        catalog = await syncCatalog(fetcher);
        writeCache("marketplace", catalog);
      } catch {
        catalog = cached ?? [];
      }
    }
    return catalog.filter((s) => matches(s, query));
  },
};
