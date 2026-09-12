export interface RemoteSkill {
  name: string;
  description: string;
  url: string;
  provider: string;
  repo?: string;
  installs?: number;
  stars?: number;
  tags?: string[];
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface Provider {
  id: string;
  label: string;
  search(query: string, fetcher?: Fetcher): Promise<RemoteSkill[]>;
}

export function repoFromGitHubUrl(url: string): string | undefined {
  const m = /github\.com\/([^/]+\/[^/#?]+)/i.exec(url);
  return m ? m[1]!.replace(/\.git$/, "") : undefined;
}
