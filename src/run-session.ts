import type { CommandSpec, InstallProvider } from "./install";

export type RunSessionMessage =
  | { type: "start"; command: string; provider: InstallProvider }
  | { type: "out"; stream: "stdout" | "stderr"; data: string }
  | { type: "exit"; code: number; ok: boolean }
  | { type: "error"; message: string };

export interface LiveRun {
  kill: () => void;
  write: (data: string) => void;
  exited: Promise<number>;
}

/**
 * Spawn a command with live stdout/stderr streaming and writable stdin.
 * On Unix, wraps with `script` when possible so CLIs that require a TTY
 * (prompts) still work in the web terminal.
 */
export function startLiveRun(
  spec: CommandSpec,
  opts: {
    onData: (stream: "stdout" | "stderr", chunk: string) => void;
    interactive?: boolean;
    timeoutMs?: number;
  },
): LiveRun {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  const { argv, displayArgv } = wrapForTty(spec.argv, !!opts.interactive);

  const proc = Bun.spawn(argv, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      CI: opts.interactive ? "" : "1",
    },
  });

  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  const pump = async (stream: ReadableStream<Uint8Array> | null, name: "stdout" | "stderr") => {
    if (!stream) return;
    const reader = stream.getReader();
    const dec = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value?.byteLength) opts.onData(name, dec.decode(value));
      }
    } catch {
      /* closed */
    }
  };

  const exited = (async () => {
    try {
      const [, , code] = await Promise.all([
        pump(proc.stdout, "stdout"),
        pump(proc.stderr, "stderr"),
        proc.exited,
      ]);
      return killed ? 124 : Number(code);
    } finally {
      clearTimeout(timer);
    }
  })();

  return {
    kill: () => {
      killed = true;
      try {
        proc.kill();
      } catch {
        /* ignore */
      }
    },
    write: (data: string) => {
      try {
        const stdin = proc.stdin;
        if (!stdin) return;
        stdin.write(data);
        if (typeof stdin.flush === "function") stdin.flush();
      } catch {
        /* ignore */
      }
    },
    exited,
  };
}

function wrapForTty(argv: string[], interactive: boolean): { argv: string[]; displayArgv: string[] } {
  if (!interactive || process.platform === "win32") {
    return { argv, displayArgv: argv };
  }
  // Allocate a PTY so prompt UIs (clack, etc.) work from the browser.
  if (process.platform === "darwin") {
    return {
      argv: ["script", "-q", "/dev/null", ...argv],
      displayArgv: argv,
    };
  }
  // Linux: script -qfc 'cmd' /dev/null
  const shellCmd = argv.map(shellQuote).join(" ");
  return {
    argv: ["script", "-qfc", shellCmd, "/dev/null"],
    displayArgv: argv,
  };
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@+=,-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function resolveRunArgv(spec: CommandSpec, interactive: boolean): string[] {
  return wrapForTty(spec.argv, interactive).displayArgv;
}
