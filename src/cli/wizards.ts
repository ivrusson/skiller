import {
  planInstall,
  planUninstall,
  type InstallProvider,
  type SkillsMutateOpts,
} from "../install";
import { askConfirm, askInput, askSelect, canUseTui } from "./tui";

export type WizardAction =
  | { action: "list" }
  | { action: "explore"; query: string }
  | ({ action: "install"; repo: string; provider?: InstallProvider } & SkillsMutateOpts)
  | ({
      action: "uninstall";
      name: string;
      provider?: InstallProvider;
      repo?: string;
    } & SkillsMutateOpts)
  | { action: "ui" }
  | { action: "usage" }
  | { action: "home" }
  | { action: "cancel" };

export async function confirmCommand(opts: {
  title: string;
  command: string;
  danger?: boolean;
  yes?: boolean;
}): Promise<boolean> {
  if (opts.yes) {
    console.log(`Will run: ${opts.command}`);
    return true;
  }
  if (canUseTui()) {
    return askConfirm({
      title: opts.title,
      message: "Run this command?",
      detail: opts.command,
      confirmLabel: opts.danger ? "Uninstall" : "Install",
      danger: opts.danger,
    });
  }
  if (!process.stdin.isTTY) {
    console.error("confirmation required — re-run with `--yes`");
    return false;
  }
  console.log(`Will run: ${opts.command}`);
  process.stdout.write("Proceed? [y/N] ");
  const line = await new Promise<string>((resolve) => {
    let buf = "";
    const onData = (chunk: Buffer | string) => {
      buf += String(chunk);
      if (buf.includes("\n")) {
        process.stdin.off("data", onData);
        resolve(buf);
      }
    };
    process.stdin.on("data", onData);
    process.stdin.resume();
  });
  process.stdin.pause();
  const answer = line.trim().toLowerCase();
  return answer === "y" || answer === "yes";
}

async function pickAgents(
  current?: string[],
  yes?: boolean,
): Promise<{ agents?: string[]; all?: boolean }> {
  if (current?.length || yes || !canUseTui()) {
    return current?.length ? { agents: current } : {};
  }
  const picked = await askSelect<string>({
    title: "Agents",
    message: "Where should skills link? (skills.sh decides symlink vs copy)",
    height: 8,
    options: [
      { name: "Default", description: "Let skills CLI pick detected agents", value: "default" },
      { name: "All agents (*)", description: "skills add -a '*'", value: "*" },
      { name: "Claude Code", description: "-a claude-code", value: "claude-code" },
      { name: "Cursor", description: "-a cursor", value: "cursor" },
      { name: "OpenCode", description: "-a opencode", value: "opencode" },
      { name: "Codex", description: "-a codex", value: "codex" },
    ],
  });
  if (picked === undefined) return {};
  if (picked === "default") return {};
  if (picked === "*") return { agents: ["*"] };
  return { agents: [picked] };
}

export async function wizardInstall(
  partial?: {
    repo?: string;
    provider?: string;
    yes?: boolean;
  } & SkillsMutateOpts,
): Promise<({ repo: string; provider?: InstallProvider } & SkillsMutateOpts) | null> {
  let repo = partial?.repo?.trim() ?? "";
  if (!repo) {
    if (!canUseTui()) {
      console.error("missing target: skiller install <owner/repo|slug>");
      return null;
    }
    repo =
      (await askInput({
        title: "Install skill",
        message: "GitHub owner/repo or ClawHub slug",
        placeholder: "vercel-labs/agent-skills",
      })) ?? "";
    if (!repo) return null;
  }

  let provider = partial?.provider as InstallProvider | undefined;
  if (!provider && canUseTui() && !partial?.yes) {
    const picked = await askSelect<InstallProvider | "auto">({
      title: "Provider",
      message: `Installing ${repo}`,
      height: 5,
      options: [
        { name: "Auto / skills.sh", description: "npx skills add (default)", value: "auto" },
        { name: "ClawHub", description: "clawhub install (npx fallback)", value: "clawhub" },
        { name: "skills CLI", description: "Force npx skills add", value: "skills" },
      ],
    });
    if (picked === undefined) return null;
    if (picked !== "auto") provider = picked;
  }

  let agents = partial?.agents;
  let all = partial?.all;
  let skills = partial?.skills;
  let copy = partial?.copy;
  if ((!provider || provider === "skills") && !all) {
    const picked = await pickAgents(agents, partial?.yes);
    if (picked.agents) agents = picked.agents;
    if (picked.all) all = true;
  }

  const planned = planInstall({
    repo,
    provider,
    agents,
    skills,
    all,
    copy,
  });
  if (!planned.ok) {
    console.error(planned.error);
    return null;
  }
  const ok = await confirmCommand({
    title: "Confirm install",
    command: planned.spec.display,
    yes: partial?.yes,
  });
  if (!ok) return null;
  return { repo, provider, agents, skills, all, copy };
}

export async function wizardUninstall(
  partial?: {
    name?: string;
    provider?: string;
    repo?: string;
    yes?: boolean;
  } & SkillsMutateOpts,
): Promise<
  ({ name: string; provider?: InstallProvider; repo?: string } & SkillsMutateOpts) | null
> {
  let name = partial?.name?.trim() ?? "";
  if (!name && !partial?.all) {
    if (!canUseTui()) {
      console.error("missing name: skiller uninstall <name>");
      return null;
    }
    name =
      (await askInput({
        title: "Uninstall skill",
        message: "Installed skill name",
        placeholder: "hono",
      })) ?? "";
    if (!name) return null;
  }

  let provider = partial?.provider as InstallProvider | undefined;
  let repo = partial?.repo;
  if (!provider && canUseTui() && !partial?.yes) {
    const picked = await askSelect<InstallProvider>({
      title: "Uninstall via",
      message: `Remove “${name || "all"}”`,
      height: 5,
      options: [
        { name: "skills CLI", description: "npx skills remove -g", value: "skills" },
        { name: "ClawHub", description: "clawhub uninstall", value: "clawhub" },
      ],
    });
    if (picked === undefined) return null;
    provider = picked;
    if (provider === "clawhub" && !repo) {
      repo =
        (await askInput({
          title: "ClawHub slug",
          message: "owner/slug (optional if name is enough)",
          placeholder: name.includes("/") ? name : `owner/${name}`,
          initial: name.includes("/") ? name : "",
        })) || undefined;
    }
  }

  const agents = partial?.agents;
  const skills = partial?.skills;
  const all = partial?.all;
  const planned = planUninstall({ name, repo, provider, agents, skills, all });
  if (!planned.ok) {
    console.error(planned.error);
    return null;
  }
  const ok = await confirmCommand({
    title: "Confirm uninstall",
    command: planned.spec.display,
    danger: true,
    yes: partial?.yes,
  });
  if (!ok) return null;
  return { name, provider, repo, agents, skills, all };
}

export async function wizardExplore(): Promise<string | null> {
  if (!canUseTui()) {
    console.error("missing query: skiller explore <query>");
    return null;
  }
  return (
    (await askInput({
      title: "Explore skills",
      message: "Search across skills.sh, marketplaces, SkillsMP, awesome, ClawHub",
      placeholder: "hono",
    })) ?? null
  );
}

export async function wizardMainMenu(): Promise<WizardAction> {
  if (!canUseTui()) return { action: "list" };

  const action = await askSelect<WizardAction["action"] | "cancel">({
    title: "skiller",
    message: "What do you want to do?",
    height: 9,
    options: [
      { name: "List installed", description: "Show local skills table", value: "list" },
      { name: "Explore", description: "Search remote providers", value: "explore" },
      { name: "Install", description: "Add a skill via CLI", value: "install" },
      { name: "Uninstall", description: "Remove a skill via CLI", value: "uninstall" },
      { name: "Open web UI", description: "skiller ui on :4780", value: "ui" },
      { name: "Usage", description: "Session stats per skill", value: "usage" },
      { name: "Data home", description: "Show ~/.skiller paths", value: "home" },
      { name: "Quit", description: "Exit", value: "cancel" },
    ],
  });

  if (!action || action === "cancel") return { action: "cancel" };

  if (action === "explore") {
    const query = await wizardExplore();
    if (!query) return { action: "cancel" };
    return { action: "explore", query };
  }
  if (action === "install") {
    const result = await wizardInstall();
    if (!result) return { action: "cancel" };
    return { action: "install", ...result };
  }
  if (action === "uninstall") {
    const result = await wizardUninstall();
    if (!result) return { action: "cancel" };
    return { action: "uninstall", ...result };
  }
  return { action } as WizardAction;
}
