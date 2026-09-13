import { planInstall, planUninstall, type InstallProvider } from "../install";
import { askConfirm, askInput, askSelect, canUseTui } from "./tui";

export type WizardAction =
  | { action: "list" }
  | { action: "explore"; query: string }
  | { action: "install"; repo: string; provider?: InstallProvider }
  | { action: "uninstall"; name: string; provider?: InstallProvider; repo?: string }
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
    console.error("confirmation required — re-run with --yes");
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

export async function wizardInstall(partial?: {
  repo?: string;
  provider?: string;
  yes?: boolean;
}): Promise<{
  repo: string;
  provider?: InstallProvider;
} | null> {
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

  const planned = planInstall({ repo, provider });
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
  return { repo, provider };
}

export async function wizardUninstall(partial?: {
  name?: string;
  provider?: string;
  repo?: string;
  yes?: boolean;
}): Promise<{ name: string; provider?: InstallProvider; repo?: string } | null> {
  let name = partial?.name?.trim() ?? "";
  if (!name) {
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
      message: `Remove “${name}”`,
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

  const planned = planUninstall({ name, repo, provider });
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
  return { name, provider, repo };
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
