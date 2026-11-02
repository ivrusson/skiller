const REPO_RE = /^(?!-)[A-Za-z0-9_.-]+\/(?!-)[A-Za-z0-9_.-]+$/;

export type InstallProvider = "skills" | "clawhub";

/** Flags that project 1:1 onto `npx skills` add/remove (skills provider only). */
export interface SkillsMutateOpts {
  /** Target agents (`claude-code`, `cursor`, `*`, …). */
  agents?: string[];
  /** Skill names within a pack (`*` = all). */
  skills?: string[];
  /** Shorthand for `--skill '*' --agent '*' -y` on add; remove-all on remove. */
  all?: boolean;
  /** Copy instead of symlink (escape hatch; not promoted). */
  copy?: boolean;
}

export function isInstallableRepo(repo: string | undefined): repo is string {
  return !!repo && REPO_RE.test(repo);
}

/** Strip marketplace suffixes like `owner/repo (/path)` → `owner/repo`. */
export function cleanRepo(repo: string | undefined): string | null {
  if (!repo) return null;
  const base = String(repo).split(" ")[0]!.trim();
  return isInstallableRepo(base) ? base : null;
}

export function isClawhubProvider(provider: string | undefined): boolean {
  if (!provider) return false;
  return provider
    .split(/\s*\+\s*/)
    .map((p) => p.trim().toLowerCase())
    .some((p) => p === "clawhub");
}

export function resolveProvider(
  explicit: string | undefined,
  providerField?: string,
): InstallProvider {
  if (explicit === "clawhub" || explicit === "skills") return explicit;
  return isClawhubProvider(providerField) ? "clawhub" : "skills";
}

export interface CommandSpec {
  argv: string[];
  display: string;
  provider: InstallProvider;
}

/** Normalize CSV / repeated flag values into a clean string list. */
export function normalizeList(values: string[] | string | undefined): string[] {
  if (values === undefined) return [];
  const raw = Array.isArray(values) ? values : [values];
  const out: string[] = [];
  for (const v of raw) {
    for (const part of String(v).split(",")) {
      const t = part.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

function appendSkillsMutateFlags(
  argv: string[],
  opts: SkillsMutateOpts,
  mode: "add" | "remove",
): void {
  if (opts.all) {
    argv.push("--all");
    return;
  }
  const skills = normalizeList(opts.skills);
  const agents = normalizeList(opts.agents);
  for (const s of skills) {
    argv.push("-s", s);
  }
  for (const a of agents) {
    argv.push("-a", a);
  }
  if (mode === "add" && opts.copy) {
    argv.push("--copy");
  }
}

export function planInstall(
  opts: {
    repo: string;
    provider?: string;
    /** When true, omit auto-yes flags so the user can answer CLI prompts. */
    interactive?: boolean;
  } & SkillsMutateOpts,
): { ok: true; spec: CommandSpec } | { ok: false; error: string } {
  const resolved = resolveProvider(
    opts.provider === "clawhub" || opts.provider === "skills" ? opts.provider : undefined,
    opts.provider,
  );
  const auto = !opts.interactive;
  if (resolved === "clawhub") {
    const slug = cleanRepo(opts.repo) ?? opts.repo.trim();
    if (!slug) return { ok: false, error: `invalid clawhub slug "${opts.repo}"` };
    const argv = auto ? ["clawhub", "install", slug, "--no-input"] : ["clawhub", "install", slug];
    return {
      ok: true,
      spec: {
        provider: "clawhub",
        argv,
        display: argv.join(" "),
      },
    };
  }
  const repo = cleanRepo(opts.repo);
  if (!repo) return { ok: false, error: `invalid repo "${opts.repo}"` };
  const argv = ["npx", "-y", "skills", "add", repo, "-g"];
  appendSkillsMutateFlags(argv, opts, "add");
  // `--all` already implies -y in the official CLI; still add -y in auto mode when not --all
  // so non-interactive installs stay quiet. When interactive, never pass -y.
  if (auto && !opts.all) argv.push("-y");
  else if (auto && opts.all) {
    /* --all already implies -y */
  }
  return {
    ok: true,
    spec: {
      provider: "skills",
      argv,
      display: argv.join(" "),
    },
  };
}

export function planUninstall(
  opts: {
    name: string;
    repo?: string;
    provider?: string;
    interactive?: boolean;
  } & SkillsMutateOpts,
): { ok: true; spec: CommandSpec } | { ok: false; error: string } {
  const resolved = resolveProvider(
    opts.provider === "clawhub" || opts.provider === "skills" ? opts.provider : undefined,
    opts.provider,
  );
  const auto = !opts.interactive;
  if (resolved === "clawhub") {
    const slug = cleanRepo(opts.repo) ?? opts.name.trim();
    if (!slug) return { ok: false, error: "missing clawhub skill slug" };
    const argv = auto
      ? ["clawhub", "uninstall", slug, "--no-input"]
      : ["clawhub", "uninstall", slug];
    return {
      ok: true,
      spec: {
        provider: "clawhub",
        argv,
        display: argv.join(" "),
      },
    };
  }
  const name = opts.name.trim();
  if (opts.all) {
    const argv = ["npx", "-y", "skills", "remove", "-g", "--all"];
    return {
      ok: true,
      spec: {
        provider: "skills",
        argv,
        display: argv.join(" "),
      },
    };
  }
  if (!name && !normalizeList(opts.skills).length) {
    return { ok: false, error: "missing skill name" };
  }
  const argv = ["npx", "-y", "skills", "remove"];
  if (name) argv.push(name);
  argv.push("-g");
  appendSkillsMutateFlags(argv, opts, "remove");
  if (auto) argv.push("-y");
  return {
    ok: true,
    spec: {
      provider: "skills",
      argv,
      display: argv.join(" "),
    },
  };
}

export function planUpdate(opts: {
  names?: string[];
  interactive?: boolean;
}): { ok: true; spec: CommandSpec } | { ok: false; error: string } {
  const names = normalizeList(opts.names);
  const argv = ["npx", "-y", "skills", "update", ...names, "-g"];
  if (!opts.interactive) argv.push("-y");
  return {
    ok: true,
    spec: {
      provider: "skills",
      argv,
      display: argv.join(" "),
    },
  };
}

/**
 * Re-add a skill from its lock source targeting missing agents only.
 * Never creates symlinks itself — delegates to `skills add -g -s … -a …`.
 */
export function planRepair(opts: {
  source: string;
  skill: string;
  agents: string[];
  interactive?: boolean;
  copy?: boolean;
}): { ok: true; spec: CommandSpec } | { ok: false; error: string } {
  const source = cleanRepo(opts.source) ?? opts.source.trim();
  if (!isInstallableRepo(source) && !REPO_RE.test(source)) {
    // allow owner/repo only for repair (skills needs a fetchable source)
    if (!cleanRepo(opts.source)) {
      return { ok: false, error: `repair needs owner/repo source, got "${opts.source}"` };
    }
  }
  const repo = cleanRepo(opts.source);
  if (!repo) return { ok: false, error: `repair needs owner/repo source, got "${opts.source}"` };
  const skill = opts.skill.trim();
  if (!skill) return { ok: false, error: "missing skill name" };
  const agents = normalizeList(opts.agents);
  if (!agents.length) return { ok: false, error: "no agents to repair" };
  return planInstall({
    repo,
    provider: "skills",
    skills: [skill],
    agents,
    copy: opts.copy,
    interactive: opts.interactive,
  });
}

export interface InstallResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  provider?: InstallProvider;
}

type Spawner = (
  argv: string[],
  timeoutMs: number,
) => Promise<{ exit: number; stdout: string; stderr: string }>;

async function defaultSpawn(
  argv: string[],
  timeoutMs: number,
): Promise<{ exit: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, stderr, exit] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    return { exit, stdout: stdout.trim(), stderr: stderr.trim() };
  } finally {
    clearTimeout(timer);
  }
}

async function spawnWithClawhubFallback(
  spec: CommandSpec,
  timeoutMs: number,
  spawn: Spawner,
): Promise<InstallResult> {
  if (spec.provider !== "clawhub") {
    try {
      const r = await spawn(spec.argv, timeoutMs);
      return {
        ok: r.exit === 0,
        command: spec.display,
        stdout: r.stdout,
        stderr: r.stderr,
        provider: spec.provider,
      };
    } catch (err) {
      return {
        ok: false,
        command: spec.display,
        stdout: "",
        stderr: String(err),
        provider: spec.provider,
      };
    }
  }

  const attempts: Array<{ argv: string[]; display: string }> = [
    { argv: spec.argv, display: spec.display },
    {
      argv: ["npx", "-y", "clawhub@latest", ...spec.argv.slice(1)],
      display: `npx -y clawhub@latest ${spec.argv.slice(1).join(" ")}`,
    },
  ];

  let last: InstallResult = {
    ok: false,
    command: spec.display,
    stdout: "",
    stderr: "clawhub not available",
    provider: "clawhub",
  };
  for (const attempt of attempts) {
    try {
      const r = await spawn(attempt.argv, timeoutMs);
      last = {
        ok: r.exit === 0,
        command: attempt.display,
        stdout: r.stdout,
        stderr: r.stderr,
        provider: "clawhub",
      };
      if (r.exit === 0) return last;
      if (r.exit === 127 || /not found|ENOENT/i.test(r.stderr)) continue;
      return last;
    } catch (err) {
      last = {
        ok: false,
        command: attempt.display,
        stdout: "",
        stderr: String(err),
        provider: "clawhub",
      };
      if (/ENOENT|not found/i.test(String(err))) continue;
      return last;
    }
  }
  return last;
}

export async function runCommandSpec(
  spec: CommandSpec,
  opts: { timeoutMs?: number; spawn?: Spawner } = {},
): Promise<InstallResult> {
  return spawnWithClawhubFallback(spec, opts.timeoutMs ?? 120_000, opts.spawn ?? defaultSpawn);
}

export async function installSkill(
  opts: {
    repo: string;
    provider?: string;
    timeoutMs?: number;
    spawn?: Spawner;
    interactive?: boolean;
  } & SkillsMutateOpts,
): Promise<InstallResult> {
  const planned = planInstall(opts);
  if (!planned.ok) {
    return { ok: false, command: "", stdout: "", stderr: planned.error };
  }
  return runCommandSpec(planned.spec, opts);
}

export async function uninstallSkill(
  opts: {
    name: string;
    repo?: string;
    provider?: string;
    timeoutMs?: number;
    spawn?: Spawner;
    interactive?: boolean;
  } & SkillsMutateOpts,
): Promise<InstallResult> {
  const planned = planUninstall(opts);
  if (!planned.ok) {
    return { ok: false, command: "", stdout: "", stderr: planned.error };
  }
  return runCommandSpec(planned.spec, opts);
}

export async function updateSkills(opts: {
  names?: string[];
  interactive?: boolean;
  timeoutMs?: number;
  spawn?: Spawner;
}): Promise<InstallResult> {
  const planned = planUpdate(opts);
  if (!planned.ok) {
    return { ok: false, command: "", stdout: "", stderr: planned.error };
  }
  return runCommandSpec(planned.spec, opts);
}

export async function repairSkill(opts: {
  source: string;
  skill: string;
  agents: string[];
  interactive?: boolean;
  copy?: boolean;
  timeoutMs?: number;
  spawn?: Spawner;
}): Promise<InstallResult> {
  const planned = planRepair(opts);
  if (!planned.ok) {
    return { ok: false, command: "", stdout: "", stderr: planned.error };
  }
  return runCommandSpec(planned.spec, opts);
}

/** @deprecated use installSkill */
export async function installFromRepo(repo: string, timeoutMs = 120_000): Promise<InstallResult> {
  return installSkill({ repo, timeoutMs });
}
