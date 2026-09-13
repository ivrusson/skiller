import { readFileSync } from "node:fs";
import { collect } from "./collect";
import { ingestAll } from "./ingest";
import { installSkill, planInstall, planUninstall, uninstallSkill, type CommandSpec } from "./install";
import { explore } from "./providers";
import { clearProviderCaches } from "./providers/cache";
import { startLiveRun, type LiveRun, type RunSessionMessage } from "./run-session";
import { scanAll } from "./scan";
import { addTags, removeTags } from "./tags";
import { logUsage, getUsageStats, getSkillUsage } from "./usage";
import { renderPage, webAsset } from "./web/page";

let memCache: { data: Awaited<ReturnType<typeof collect>>; at: number } | null = null;

async function collectCached(refresh = false) {
  if (!refresh && memCache && Date.now() - memCache.at < 10_000) return memCache.data;
  const data = await collect({ refresh });
  memCache = { data, at: Date.now() };
  return data;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

type WsData = {
  run: LiveRun | null;
};

function send(ws: { send: (s: string) => void }, msg: RunSessionMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* closed */
  }
}

function planFromStart(msg: Record<string, unknown>): { ok: true; spec: CommandSpec } | { ok: false; error: string } {
  const interactive = msg.interactive === true;
  if (msg.action === "install") {
    if (typeof msg.repo !== "string" || !msg.repo.trim()) return { ok: false, error: "missing repo" };
    return planInstall({
      repo: msg.repo.trim(),
      provider: typeof msg.provider === "string" ? msg.provider : undefined,
      interactive,
    });
  }
  if (msg.action === "uninstall") {
    if (typeof msg.name !== "string" || !msg.name.trim()) return { ok: false, error: "missing name" };
    return planUninstall({
      name: msg.name.trim(),
      repo: typeof msg.repo === "string" ? msg.repo : undefined,
      provider: typeof msg.provider === "string" ? msg.provider : undefined,
      interactive,
    });
  }
  return { ok: false, error: "action must be install or uninstall" };
}

export function startServer(opts: { port: number; host: string; refreshOnStart?: boolean }): void {
  Bun.serve({
    port: opts.port,
    hostname: opts.host,
    routes: {
      "/": () =>
        new Response(renderPage(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      "/styles.css": () => {
        const a = webAsset("styles.css");
        return new Response(a.body, { headers: { "Content-Type": a.type } });
      },
      "/app.js": () => {
        const a = webAsset("app.js");
        return new Response(a.body, { headers: { "Content-Type": a.type } });
      },
      "/api/skills": {
        GET: async (req) => {
          const url = new URL(req.url);
          const refresh = url.searchParams.get("refresh") === "1";
          const skills = await collectCached(refresh || opts.refreshOnStart === true);
          return json({
            skills,
            scannedAt: new Date().toISOString(),
            sources: [...new Set(skills.map((s) => s.source))],
          });
        },
      },
      "/api/skills/:name": {
        GET: async (req) => {
          const url = new URL(req.url);
          const name = decodeURIComponent(req.params.name);
          const scope = url.searchParams.get("scope");
          const skills = await collectCached(false);
          const match = skills.find(
            (s) => s.name.toLowerCase() === name.toLowerCase() && (!scope || s.scope === scope),
          );
          if (!match) return json({ error: "not found" }, 404);
          let content = "";
          try {
            content = readFileSync(match.skillFile, "utf8");
          } catch {}
          return json({ skill: match, content });
        },
      },
      "/api/tags": {
        POST: async (req) => {
          let body: unknown;
          try {
            body = await req.json();
          } catch {
            return json({ error: "invalid body" }, 400);
          }
          const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
          if (typeof b.name !== "string" || typeof b.tag !== "string" || !b.tag.trim()) {
            return json({ error: "expected { name, tag }" }, 400);
          }
          const manualTags = addTags(b.name, [b.tag]);
          memCache = null;
          return json({ ok: true, name: b.name, manualTags });
        },
      },
      "/api/tags/:name/:tag": {
        DELETE: async (req) => {
          const name = decodeURIComponent(req.params.name);
          const tag = decodeURIComponent(req.params.tag);
          const manualTags = removeTags(name, [tag]);
          memCache = null;
          return json({ ok: true, name, manualTags });
        },
      },
      "/api/usage": {
        GET: async () => json(getUsageStats()),
        POST: async (req) => {
          let body: unknown;
          try { body = await req.json(); } catch { return json({ error: "invalid body" }, 400); }
          const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
          if (typeof b.skillName !== "string" || typeof b.harness !== "string") {
            return json({ error: "expected { skillName, harness }" }, 400);
          }
          logUsage(b.skillName, b.harness, crypto.randomUUID());
          memCache = null;
          return json({ ok: true });
        },
      },
      "/api/usage/:name": {
        GET: async (req) => {
          const name = decodeURIComponent(req.params.name);
          const stats = getSkillUsage(name);
          if (!stats) return json({ error: "not found" }, 404);
          return json({ stats });
        },
      },
      "/api/usage/ingest": {
        POST: async () => {
          const result = ingestAll();
          memCache = null;
          return json({ ok: true, ...result });
        },
      },
      "/api/explore": {
        GET: async (req) => {
          const url = new URL(req.url);
          const q = url.searchParams.get("q")?.trim() ?? "";
          if (!q) return json({ results: [] });
          const results = await explore(q, { installedNames: scanAll().map((s) => s.name) });
          return json({ results });
        },
      },
      "/api/providers/refresh": {
        POST: async () => json({ ok: true, cleared: clearProviderCaches() }),
      },
      "/api/install": {
        POST: async (req) => {
          let body: unknown;
          try { body = await req.json(); } catch { return json({ error: "invalid body" }, 400); }
          const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
          if (typeof b.repo !== "string" || !b.repo.trim()) {
            return json({ error: "expected { repo, confirm: true }" }, 400);
          }
          const provider = typeof b.provider === "string" ? b.provider : undefined;
          const interactive = b.interactive === true;
          if (b.preview === true) {
            const planned = planInstall({ repo: b.repo.trim(), provider, interactive });
            if (!planned.ok) return json({ error: planned.error }, 400);
            return json({ ok: true, command: planned.spec.display, provider: planned.spec.provider });
          }
          if (b.confirm !== true) {
            return json({ error: "confirmation required", hint: "pass { confirm: true }" }, 400);
          }
          const result = await installSkill({ repo: b.repo.trim(), provider });
          if (result.ok) {
            memCache = null;
            ingestAll();
          }
          return json(result, result.ok ? 200 : 502);
        },
      },
      "/api/uninstall": {
        POST: async (req) => {
          let body: unknown;
          try { body = await req.json(); } catch { return json({ error: "invalid body" }, 400); }
          const b = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
          if (typeof b.name !== "string" || !b.name.trim()) {
            return json({ error: "expected { name, confirm: true }" }, 400);
          }
          const provider = typeof b.provider === "string" ? b.provider : undefined;
          const repo = typeof b.repo === "string" ? b.repo : undefined;
          const interactive = b.interactive === true;
          if (b.preview === true) {
            const planned = planUninstall({ name: b.name.trim(), repo, provider, interactive });
            if (!planned.ok) return json({ error: planned.error }, 400);
            return json({ ok: true, command: planned.spec.display, provider: planned.spec.provider });
          }
          if (b.confirm !== true) {
            return json({ error: "confirmation required", hint: "pass { confirm: true }" }, 400);
          }
          const result = await uninstallSkill({ name: b.name.trim(), repo, provider });
          if (result.ok) {
            memCache = null;
            ingestAll();
          }
          return json(result, result.ok ? 200 : 502);
        },
      },
    },
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws/run") {
        const ok = server.upgrade(req, { data: { run: null } satisfies WsData });
        if (ok) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) {
        (ws.data as WsData).run = null;
      },
      async message(ws, raw) {
        const data = ws.data as WsData;
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw)) as Record<string, unknown>;
        } catch {
          send(ws, { type: "error", message: "invalid json" });
          return;
        }

        if (msg.type === "stdin") {
          if (typeof msg.data === "string") data.run?.write(msg.data);
          return;
        }
        if (msg.type === "kill") {
          data.run?.kill();
          return;
        }
        if (msg.type !== "start") {
          send(ws, { type: "error", message: "unknown message type" });
          return;
        }
        if (data.run) {
          send(ws, { type: "error", message: "a command is already running" });
          return;
        }

        const planned = planFromStart(msg);
        if (!planned.ok) {
          send(ws, { type: "error", message: planned.error });
          return;
        }

        const interactive = msg.interactive === true;
        send(ws, {
          type: "start",
          command: planned.spec.display,
          provider: planned.spec.provider,
        });

        const run = startLiveRun(planned.spec, {
          interactive,
          onData: (stream, chunk) => send(ws, { type: "out", stream, data: chunk }),
        });
        data.run = run;

        const code = await run.exited;
        data.run = null;
        const ok = code === 0;
        if (ok) {
          memCache = null;
          try {
            ingestAll();
          } catch {
            /* ignore */
          }
        }
        send(ws, { type: "exit", code, ok });
      },
      close(ws) {
        const data = ws.data as WsData;
        data.run?.kill();
        data.run = null;
      },
    },
    error: () => new Response("not found", { status: 404 }),
  });

  console.log(`skiller web → http://${opts.host}:${opts.port}`);
  setTimeout(() => {
    try {
      const result = ingestAll();
      if (result.added > 0) {
        console.log(`usage ingest: +${result.added} session(s) from transcripts`);
        memCache = null;
      }
    } catch (err) {
      console.error("usage ingest failed:", err);
    }
  }, 0);
}
