const REPO_RE = /^(?!-)[A-Za-z0-9_.-]+\/(?!-)[A-Za-z0-9_.-]+$/;

export type InstallProvider = "skills" | "clawhub";

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

export function planInstall(opts: {
  repo: string;
  provider?: string;
  /** When true, omit auto-yes flags so the user can answer CLI prompts. */
  interactive?: boolean;
}): { ok: true; spec: CommandSpec } | { ok: false; error: string } {
  const resolved = resolveProvider(
    opts.provider === "clawhub" || opts.provider === "skills" ? opts.provider : undefined,
    opts.provider,
  );
  const auto = !opts.interactive;
  if (resolved === "clawhub") {
    const slug = cleanRepo(opts.repo) ?? opts.repo.trim();
    if (!slug) return { ok: false, error: `invalid clawhub slug "${opts.repo}"` };
    const argv = auto
      ? ["clawhub", "install", slug, "--no-input"]
      : ["clawhub", "install", slug];
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
  const argv = auto
    ? ["npx", "-y", "skills", "add", repo, "-g", "-y"]
    : ["npx", "-y", "skills", "add", repo, "-g"];
  return {
    ok: true,
    spec: {
      provider: "skills",
      argv,
      display: argv.join(" "),
    },
  };
}

export function planUninstall(opts: {
  name: string;
  repo?: string;
  provider?: string;
  interactive?: boolean;
}): { ok: true; spec: CommandSpec } | { ok: false; error: string } {
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
  if (!name) return { ok: false, error: "missing skill name" };
  const argv = auto
    ? ["npx", "-y", "skills", "remove", name, "-g", "-y"]
    : ["npx", "-y", "skills", "remove", name, "-g"];
  return {
    ok: true,
    spec: {
      provider: "skills",
      argv,
      display: argv.join(" "),
    },
  };
}

export interface InstallResult {
  ok: boolean;
  command: string;
  stdout: string;
  stderr: string;
  provider?: InstallProvider;
}

type Spawner = (argv: string[], timeoutMs: number) => Promise<{ exit: number; stdout: string; stderr: string }>;

async function defaultSpawn(argv: string[], timeoutMs: number): Promise<{ exit: number; stdout: string; stderr: string }> {
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
      return { ok: false, command: spec.display, stdout: "", stderr: String(err), provider: spec.provider };
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
      last = { ok: false, command: attempt.display, stdout: "", stderr: String(err), provider: "clawhub" };
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
  opts: { repo: string; provider?: string; timeoutMs?: number; spawn?: Spawner },
): Promise<InstallResult> {
  const planned = planInstall({ repo: opts.repo, provider: opts.provider });
  if (!planned.ok) {
    return { ok: false, command: "", stdout: "", stderr: planned.error };
  }
  return runCommandSpec(planned.spec, opts);
}

export async function uninstallSkill(
  opts: { name: string; repo?: string; provider?: string; timeoutMs?: number; spawn?: Spawner },
): Promise<InstallResult> {
  const planned = planUninstall({ name: opts.name, repo: opts.repo, provider: opts.provider });
  if (!planned.ok) {
    return { ok: false, command: "", stdout: "", stderr: planned.error };
  }
  return runCommandSpec(planned.spec, opts);
}

/** @deprecated use installSkill */
export async function installFromRepo(repo: string, timeoutMs = 120_000): Promise<InstallResult> {
  return installSkill({ repo, timeoutMs });
}
