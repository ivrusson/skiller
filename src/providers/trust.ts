import type { RemoteSkill } from "./types";

/** Heuristic trust signal — not a security audit. */
export type TrustLevel = "high" | "medium" | "low" | "unknown";

export interface TrustAssessment {
  level: TrustLevel;
  /** 0–100 composite used only for ranking/display. */
  score: number;
  reasons: string[];
}

/** Well-known skill publishers. Weak signal — ownership can be spoofed via similar names. */
const KNOWN_ORGS = new Set([
  "anthropics",
  "vercel",
  "openai",
  "google",
  "microsoft",
  "meta",
  "facebook",
  "github",
  "cloudflare",
  "amazon",
  "aws",
  "supabase",
  "neon",
  "prisma",
  "stripe",
  "hashicorp",
  "docker",
  "kubernetes",
  "nodejs",
  "oven-sh",
  "denoland",
  "bun",
]);

function repoOwner(repo: string | undefined): string | undefined {
  const clean = repo?.split(" ")[0];
  return clean?.split("/")[0]?.toLowerCase();
}

export function assessTrust(
  s: Pick<RemoteSkill, "provider" | "repo" | "installs" | "stars">,
): TrustAssessment {
  let score = 15;
  const reasons: string[] = [];
  const providers = s.provider
    .split(/\s*\+\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  const owner = repoOwner(s.repo);
  if (owner && KNOWN_ORGS.has(owner)) {
    score += 40;
    reasons.push(`known publisher (${owner})`);
  }

  if (providers.includes("skills.sh")) {
    score += 15;
    reasons.push("listed on skills.sh");
  }
  if (providers.includes("marketplace")) {
    score += 12;
    reasons.push("in a Claude marketplace");
  }
  if (providers.includes("awesome")) {
    score += 6;
    reasons.push("curated awesome-list");
  }
  if (providers.length > 1) {
    score += 10;
    reasons.push(`cross-listed (${providers.length} providers)`);
  }

  const installs = s.installs ?? 0;
  if (installs >= 5_000) {
    score += 22;
    reasons.push(`${installs.toLocaleString("en-US")} installs`);
  } else if (installs >= 500) {
    score += 14;
    reasons.push(`${installs.toLocaleString("en-US")} installs`);
  } else if (installs >= 50) {
    score += 8;
    reasons.push(`${installs.toLocaleString("en-US")} installs`);
  } else if (installs > 0) {
    score += 3;
  }

  const stars = s.stars ?? 0;
  if (stars >= 1_000) {
    score += 8;
    reasons.push(`${stars.toLocaleString("en-US")} stars`);
  } else if (stars >= 100) {
    score += 4;
    reasons.push(`${stars.toLocaleString("en-US")} stars`);
  }

  score = Math.max(0, Math.min(100, score));

  let level: TrustLevel;
  if (score >= 70) level = "high";
  else if (score >= 45) level = "medium";
  else if (score >= 25 && reasons.length > 0) level = "low";
  else level = "unknown";

  if (!reasons.length) reasons.push("no trust signals available");

  return { level, score, reasons };
}

export function trustLabel(level: TrustLevel): string {
  switch (level) {
    case "high":
      return "Higher trust";
    case "medium":
      return "Moderate trust";
    case "low":
      return "Lower trust";
    default:
      return "Unknown";
  }
}
