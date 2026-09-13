import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  SelectRenderable,
  SelectRenderableEvents,
  TextRenderable,
  createCliRenderer,
  type SelectOption,
} from "@opentui/core";

export type AskOption<T = string> = {
  name: string;
  description?: string;
  value: T;
};

const ACCENT = "#e2793b";
const BG = "#131412";
const PANEL = "#1b1e19";
const LINE = "#3d423a";
const TEXT = "#e9ebe3";
const MUTED = "#a3a89b";

export function canUseTui(): boolean {
  return !!(process.stdin.isTTY && process.stdout.isTTY);
}

async function withRenderer<T>(
  build: (renderer: Awaited<ReturnType<typeof createCliRenderer>>, resolve: (value: T) => void) => void | Promise<void>,
): Promise<T> {
  let resolveOuter!: (value: T) => void;
  const result = new Promise<T>((resolve) => {
    resolveOuter = resolve;
  });

  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    backgroundColor: BG,
    targetFps: 30,
  });

  let settled = false;
  const finish = (value: T) => {
    if (settled) return;
    settled = true;
    try {
      renderer.destroy();
    } catch {
      /* ignore */
    }
    resolveOuter(value);
  };

  renderer.keyInput.on("keypress", (key) => {
    if (key.name === "escape") finish(undefined as T);
  });

  try {
    await build(renderer, finish);
  } catch (err) {
    finish(undefined as T);
    throw err;
  }

  return result;
}

/** Single-choice select. Returns undefined if cancelled (Esc). */
export async function askSelect<T>(opts: {
  title: string;
  message?: string;
  options: AskOption<T>[];
  height?: number;
}): Promise<T | undefined> {
  if (!canUseTui()) return undefined;

  return withRenderer<T | undefined>(async (renderer, resolve) => {
    const panel = new BoxRenderable(renderer, {
      width: Math.min(72, (renderer.width || 80) - 4),
      borderStyle: "rounded",
      borderColor: LINE,
      backgroundColor: PANEL,
      padding: 1,
      flexDirection: "column",
      gap: 1,
    });

    panel.add(new TextRenderable(renderer, { content: opts.title, fg: ACCENT }));
    if (opts.message) {
      for (const line of opts.message.split("\n")) {
        panel.add(new TextRenderable(renderer, { content: line, fg: MUTED }));
      }
    }

    const select = new SelectRenderable(renderer, {
      width: "auto",
      height: opts.height ?? Math.min(10, Math.max(4, opts.options.length + 1)),
      options: opts.options.map(
        (o): SelectOption => ({
          name: o.name,
          description: o.description ?? "",
          value: o.value,
        }),
      ),
      backgroundColor: PANEL,
      focusedBackgroundColor: "#242822",
      textColor: TEXT,
      focusedTextColor: TEXT,
      selectedBackgroundColor: ACCENT,
      selectedTextColor: "#1a1206",
      descriptionColor: MUTED,
      selectedDescriptionColor: "#f0e6d8",
      showDescription: true,
      wrapSelection: true,
      flexGrow: 1,
    });

    select.on(SelectRenderableEvents.ITEM_SELECTED, (_i, option) => {
      resolve(option.value as T);
    });

    panel.add(select);
    panel.add(new TextRenderable(renderer, { content: "↑↓ navigate · enter select · esc cancel", fg: MUTED }));
    renderer.root.add(panel);
    select.focus();
  });
}

/** Yes/No confirm. Returns false if cancelled. */
export async function askConfirm(opts: {
  title: string;
  message: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}): Promise<boolean> {
  if (!canUseTui()) return false;

  const message = opts.detail ? `${opts.message}\n${opts.detail}` : opts.message;
  const value = await askSelect<boolean>({
    title: opts.title,
    message,
    height: 5,
    options: [
      {
        name: opts.confirmLabel ?? (opts.danger ? "Uninstall" : "Confirm"),
        description: opts.danger ? "Proceed with this destructive action" : "Run the planned command",
        value: true,
      },
      {
        name: opts.cancelLabel ?? "Cancel",
        description: "Abort without changes",
        value: false,
      },
    ],
  });
  return value === true;
}

/** Text input. Returns undefined if cancelled. */
export async function askInput(opts: {
  title: string;
  message?: string;
  placeholder?: string;
  initial?: string;
}): Promise<string | undefined> {
  if (!canUseTui()) return undefined;

  return withRenderer<string | undefined>(async (renderer, resolve) => {
    const panel = new BoxRenderable(renderer, {
      width: Math.min(72, (renderer.width || 80) - 4),
      borderStyle: "rounded",
      borderColor: LINE,
      backgroundColor: PANEL,
      padding: 1,
      flexDirection: "column",
      gap: 1,
    });

    panel.add(new TextRenderable(renderer, { content: opts.title, fg: ACCENT }));
    if (opts.message) {
      panel.add(new TextRenderable(renderer, { content: opts.message, fg: MUTED }));
    }

    const input = new InputRenderable(renderer, {
      width: "auto",
      placeholder: opts.placeholder ?? "",
      value: opts.initial ?? "",
      backgroundColor: "#242822",
      focusedBackgroundColor: "#2c3028",
      textColor: TEXT,
      focusedTextColor: TEXT,
      placeholderColor: MUTED,
      cursorColor: ACCENT,
      maxLength: 200,
    });

    input.on(InputRenderableEvents.ENTER, (value) => {
      const v = String(value ?? "").trim();
      resolve(v || undefined);
    });

    panel.add(input);
    panel.add(new TextRenderable(renderer, { content: "enter submit · esc cancel", fg: MUTED }));
    renderer.root.add(panel);
    input.focus();
  });
}
