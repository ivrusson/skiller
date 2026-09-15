const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const state = { skills: [] };
const filterTags = new Set();
const filterSources = new Set();
const filterOwners = new Set();
let filterScope = "";
let onlyReg = false;
let sortBy = "name";
let current = null;

const EXPLORE_PROVIDERS = [
  { id: "skills.sh", label: "skills.sh" },
  { id: "marketplace", label: "marketplaces" },
  { id: "skillsmp", label: "SkillsMP" },
  { id: "awesome", label: "awesome" },
  { id: "clawhub", label: "ClawHub" },
];
const filterProviders = new Set();

function sourceShort(source) {
  const s = String(source || "");
  const project = s.startsWith("./");
  let name = "other";
  if (/opencode/.test(s)) name = "opencode";
  else if (/\.cursor\b|\/\.cursor\//.test(s) || s.includes(".cursor/")) name = "cursor";
  else if (/\.claude\b|\/\.claude\//.test(s) || s.includes(".claude/")) name = "claude";
  else if (/\.agents\b|\/\.agents\//.test(s) || s.includes(".agents/")) name = "agents";
  return project ? name + " · project" : name;
}

const media = matchMedia("(prefers-color-scheme: light)");
function applyTheme(t) {
  root.dataset.theme = t;
  try {
    localStorage.setItem("skiller-theme", t);
  } catch {}
}
$("#theme").onclick = () => applyTheme(root.dataset.theme === "light" ? "dark" : "light");
media.addEventListener?.("change", (e) => {
  let stored = null;
  try {
    stored = localStorage.getItem("skiller-theme");
  } catch {}
  if (!stored) applyTheme(e.matches ? "light" : "dark");
});

function fmt(n) {
  if (n == null) return null;
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}

function escapeHtml(s) {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
}

function isTruncated(el) {
  return el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
}

function hideTip() {
  const tip = $("#tip");
  tip.classList.remove("show", "mono");
  tip.textContent = "";
}

function showTip(el) {
  const text = el.getAttribute("data-tip");
  if (!text) return;
  if (!el.hasAttribute("data-tip-always") && !isTruncated(el)) return;
  const tip = $("#tip");
  tip.textContent = text;
  tip.classList.toggle("mono", el.hasAttribute("data-tip-mono"));
  tip.classList.add("show");
  const r = el.getBoundingClientRect();
  const pad = 8;
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  let left = Math.min(Math.max(pad, r.left), window.innerWidth - tw - pad);
  let top = r.bottom + 6;
  if (top + th > window.innerHeight - pad) top = Math.max(pad, r.top - th - 6);
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

function wireTips(root) {
  root.querySelectorAll("[data-tip]").forEach((el) => {
    el.addEventListener("mouseenter", () => showTip(el));
    el.addEventListener("mouseleave", hideTip);
    el.addEventListener("focus", () => showTip(el));
    el.addEventListener("blur", hideTip);
  });
}

function chipHtml(tag, opts = {}) {
  const cls =
    "tag" +
    (opts.static ? " static" : "") +
    (opts.active ? " active" : "") +
    (opts.manual ? " own" : "");
  const dot = opts.manual ? '<span class="dot" title="manual tag"></span>' : "";
  const x = opts.removable
    ? '<span class="x" data-tag="' + escapeHtml(tag) + '" title="Remove tag">&#10005;</span>'
    : "";
  const n = opts.count !== undefined ? '<span class="n">' + opts.count + "</span>" : "";
  return (
    '<span class="' +
    cls +
    '" data-tag="' +
    escapeHtml(tag) +
    '">' +
    dot +
    escapeHtml(tag) +
    n +
    x +
    "</span>"
  );
}

function skeletonHtml() {
  const widths = [
    ["w60", "w80", "w30"],
    ["w40", "w60", "w40"],
    ["w80", "w40", "w30"],
  ];
  let html = "";
  for (let i = 0; i < 12; i++) {
    const w = widths[i % 3];
    html +=
      '<div class="skel"><div class="b ' +
      w[0] +
      '"></div><div class="b ' +
      w[1] +
      '"></div><div class="b ' +
      w[2] +
      '"></div><div class="b"></div><div class="b"></div></div>';
  }
  return html;
}

async function load(refresh = false) {
  $("#loaderr").classList.remove("show");
  if (!state.skills.length) $("#list").innerHTML = skeletonHtml();
  $("#meta").textContent = refresh ? "refreshing…" : "loading…";
  try {
    const res = await fetch("/api/skills" + (refresh ? "?refresh=1" : ""));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    state.skills = data.skills;
  } catch (err) {
    $("#list").innerHTML = "";
    $("#loaderrDetail").textContent = String(err);
    $("#loaderr").classList.add("show");
    $("#meta").textContent = "load failed";
    return;
  }
  render();
}
$("#retry").onclick = () => load();

// ---- Explore tab ----
const xstate = { results: [], all: [], timer: null };

function switchTab(tab) {
  $("#tabInstalled").classList.toggle("active", tab === "installed");
  $("#tabExplore").classList.toggle("active", tab === "explore");
  try {
    history.replaceState(null, "", tab === "explore" ? "#explore" : "#");
  } catch {}
  document.querySelector("header .controls").style.display = tab === "installed" ? "" : "none";
  $("#tagbar").style.display = tab === "installed" ? "" : "none";
  $("#meta").style.display = tab === "installed" ? "" : "none";
  document.querySelector("main").style.display = tab === "installed" ? "" : "none";
  $("#empty").style.display = tab === "installed" && !$("#empty").hidden ? "" : "none";
  $("#exploreView").hidden = tab !== "explore";
  if (tab === "explore") {
    renderXProvFilters();
    if (!xstate.all.length) $("#xq").focus();
  }
}
$("#tabInstalled").onclick = () => switchTab("installed");
$("#tabExplore").onclick = () => switchTab("explore");

function renderXProvFilters() {
  const counts = {};
  for (const r of xstate.all) {
    for (const p of String(r.provider || "").split(/\s*\+\s*/)) {
      const id = p.trim();
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
  }
  const none = filterProviders.size === 0;
  let html =
    '<span class="filter-label">Provider</span>' +
    '<button type="button" class="fchip all' +
    (none ? " active" : "") +
    '" data-prov="">All</button>';
  for (const p of EXPLORE_PROVIDERS) {
    const n = counts[p.id];
    const active = filterProviders.has(p.id);
    html +=
      '<button type="button" class="fchip' +
      (active ? " active" : "") +
      '" data-prov="' +
      escapeHtml(p.id) +
      '"' +
      ' aria-pressed="' +
      active +
      '">' +
      escapeHtml(p.label) +
      (n != null ? '<span class="n">' + n + "</span>" : "") +
      "</button>";
  }
  $("#xprovFilters").innerHTML = html;
  $("#xprovFilters")
    .querySelectorAll(".fchip")
    .forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.prov;
        if (!id) {
          filterProviders.clear();
        } else if (filterProviders.has(id)) {
          filterProviders.delete(id);
        } else {
          filterProviders.add(id);
        }
        renderExplore();
      };
    });
}

function exploreFiltered() {
  if (!filterProviders.size) return xstate.all;
  return xstate.all.filter((r) => {
    const parts = String(r.provider || "")
      .split(/\s*\+\s*/)
      .map((p) => p.trim());
    return [...filterProviders].some((p) => parts.includes(p));
  });
}

function xSkeleton() {
  const widths = [
    ["w60", "w80"],
    ["w40", "w60"],
    ["w80", "w40"],
  ];
  let html = "";
  for (let i = 0; i < 8; i++) {
    const w = widths[i % 3];
    html +=
      '<div class="xrow"><div class="b skelb ' +
      w[0] +
      '"></div><div class="b skelb ' +
      w[1] +
      '"></div><div class="b skelb w30"></div><div class="b skelb"></div><div class="b skelb"></div></div>';
  }
  return html;
}

function installableRepo(r) {
  return r && /^(?!-)[A-Za-z0-9_.-]+\/(?!-)[A-Za-z0-9_.-]+$/.test(r) ? r : null;
}

function cleanRepo(repo) {
  if (!repo) return null;
  const base = String(repo).split(" ")[0];
  return installableRepo(base) ? base : null;
}

function githubUrl(repo) {
  const r = cleanRepo(repo);
  return r ? "https://github.com/" + r : null;
}

function trustBadge(t) {
  if (!t)
    return '<span class="trust t-unknown" data-tip="Unknown trust · no signals" data-tip-always>?</span>';
  const tip =
    (t.level === "high"
      ? "Higher"
      : t.level === "medium"
        ? "Moderate"
        : t.level === "low"
          ? "Lower"
          : "Unknown") +
    " trust (" +
    t.score +
    "/100) · " +
    (t.reasons || []).join(" · ") +
    " — heuristic, not a security audit";
  const label = t.level === "unknown" ? "?" : t.level;
  return (
    '<span class="trust t-' +
    t.level +
    '" data-tip="' +
    escapeHtml(tip) +
    '" data-tip-always>' +
    label +
    "</span>"
  );
}

async function previewCommand(kind, body) {
  const res = await fetch(kind === "install" ? "/api/install" : "/api/uninstall", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, preview: true }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error || "preview failed");
  return data.command;
}

let termWs = null;
let termResolve = null;
let termPayload = null;

function termAppend(text, cls) {
  const log = $("#termLog");
  const span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text;
  log.appendChild(span);
  log.scrollTop = log.scrollHeight;
}

function termResetUi(running) {
  $("#termStart").disabled = running;
  $("#termKill").disabled = !running;
  $("#termInput").disabled = !running;
  $("#termInteractive").disabled = running;
  if (running) $("#termInput").focus();
}

function closeTerm(result) {
  $("#term").classList.remove("open");
  if (termWs) {
    try {
      termWs.close();
    } catch {}
    termWs = null;
  }
  const resolve = termResolve;
  termResolve = null;
  termPayload = null;
  termResetUi(false);
  if (resolve) resolve(result || { cancelled: true });
}

function openTermSession(opts) {
  return new Promise((resolve) => {
    termResolve = resolve;
    termPayload = opts;
    $("#termTitle").textContent = opts.title || "Terminal";
    $("#termCmd").textContent = opts.command || "";
    $("#termLog").textContent = "";
    $("#termInteractive").checked = !!opts.interactive;
    $("#termStart").textContent = opts.startLabel || "Run";
    $("#termStart").className = opts.danger ? "danger" : "primary";
    termResetUi(false);
    termAppend("Ready. Click Run to start — output streams here.\n", "meta");
    if (opts.hint) termAppend(opts.hint + "\n", "meta");
    $("#term").classList.add("open");
  });
}

async function refreshTermCommand() {
  if (!termPayload) return;
  const interactive = $("#termInteractive").checked;
  try {
    const command = await previewCommand(termPayload.kind, {
      ...termPayload.body,
      interactive,
    });
    termPayload.command = command;
    $("#termCmd").textContent = command;
  } catch (err) {
    termAppend(String(err) + "\n", "err");
  }
}

function startTermRun() {
  if (!termPayload || termWs) return;
  const interactive = $("#termInteractive").checked;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(proto + "//" + location.host + "/ws/run");
  termWs = ws;
  termResetUi(true);
  $("#termLog").textContent = "";
  termAppend("$ starting…\n", "meta");

  ws.onopen = () => {
    ws.send(
      JSON.stringify({
        type: "start",
        action: termPayload.kind,
        interactive,
        ...termPayload.body,
      }),
    );
  };
  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === "start") {
      $("#termCmd").textContent = msg.command;
      termAppend("$ " + msg.command + "\n", "meta");
    } else if (msg.type === "out") {
      termAppend(msg.data, msg.stream === "stderr" ? "err" : "");
    } else if (msg.type === "error") {
      termAppend("\nerror: " + msg.message + "\n", "err");
      termResetUi(false);
      try {
        ws.close();
      } catch {}
      termWs = null;
    } else if (msg.type === "exit") {
      termAppend(
        msg.ok ? "\n✔ exit " + msg.code + "\n" : "\n✘ exit " + msg.code + "\n",
        msg.ok ? "ok" : "err",
      );
      termResetUi(false);
      termWs = null;
      try {
        ws.close();
      } catch {}
      const resolve = termResolve;
      termResolve = null;
      if (resolve) resolve({ ok: !!msg.ok, code: msg.code, cancelled: false });
    }
  };
  ws.onerror = () => {
    termAppend("\nWebSocket error\n", "err");
    termResetUi(false);
    termWs = null;
  };
  ws.onclose = () => {
    if (termWs === ws) {
      termWs = null;
      termResetUi(false);
    }
  };
}

$("#termClose").onclick = () => {
  if (termWs) {
    try {
      termWs.send(JSON.stringify({ type: "kill" }));
    } catch {}
  }
  closeTerm({ cancelled: true });
};
$("#termKill").onclick = () => {
  if (termWs) {
    try {
      termWs.send(JSON.stringify({ type: "kill" }));
    } catch {}
    termAppend("\n^C stop requested\n", "meta");
  }
};
$("#termStart").onclick = async () => {
  await refreshTermCommand();
  startTermRun();
};
$("#termInteractive").onchange = () => {
  refreshTermCommand();
};
$("#termInput").onkeydown = (e) => {
  if (e.key !== "Enter" || !termWs) return;
  e.preventDefault();
  const v = $("#termInput").value;
  $("#termInput").value = "";
  termAppend(v + "\n");
  try {
    termWs.send(JSON.stringify({ type: "stdin", data: v + "\n" }));
  } catch {}
};
$("#term").onclick = (e) => {
  if (e.target.id === "term" && !termWs) closeTerm({ cancelled: true });
};

async function runInstall(opts) {
  const command = await previewCommand("install", { repo: opts.repo, provider: opts.provider });
  const result = await openTermSession({
    title: "Install “" + opts.name + "”",
    kind: "install",
    body: { repo: opts.repo, provider: opts.provider },
    command,
    startLabel: "Install",
    hint: "Enable Interactive prompts if the CLI asks questions.",
  });
  return result;
}

async function runUninstall(opts) {
  const command = await previewCommand("uninstall", {
    name: opts.name,
    repo: opts.repo,
    provider: opts.provider,
  });
  const result = await openTermSession({
    title: "Uninstall “" + opts.name + "”",
    kind: "uninstall",
    body: { name: opts.name, repo: opts.repo, provider: opts.provider },
    command,
    startLabel: "Uninstall",
    danger: true,
    hint: "Skiller does not delete skill folders itself — the CLI does.",
  });
  return result;
}

function renderExplore() {
  renderXProvFilters();
  const rows = exploreFiltered();
  xstate.results = rows;
  $("#xlist").innerHTML = rows
    .map((r, i) => {
      const repo = cleanRepo(r.repo);
      const action = r.installed
        ? '<button data-i="' + i + '" data-act="uninstall" class="danger-btn">Uninstall</button>'
        : repo
          ? '<button data-i="' + i + '" data-act="install">Install</button>'
          : '<span class="installed-tag" title="No direct repo to install from">manual</span>';
      const provText = r.provider + (r.repo || r.url ? " · " + (r.repo ?? r.url) : "");
      return (
        '<div class="xrow" data-i="' +
        i +
        '">' +
        '<div class="xname" data-tip="' +
        escapeHtml(r.name) +
        '" data-tip-mono tabindex="0">' +
        trustBadge(r.trust) +
        (r.installed ? '<span class="check">&#10003;</span>' : "") +
        '<span class="nm">' +
        escapeHtml(r.name) +
        "</span></div>" +
        '<div class="xdesc" data-tip="' +
        escapeHtml(r.description || "") +
        '" tabindex="0">' +
        (r.description
          ? escapeHtml(r.description)
          : '<span style="color:var(--faint)">no description</span>') +
        "</div>" +
        '<div class="xprov" data-tip="' +
        escapeHtml(provText) +
        '" data-tip-mono tabindex="0"><span class="badge">' +
        escapeHtml(r.provider) +
        "</span>" +
        escapeHtml(r.repo ?? r.url) +
        "</div>" +
        '<div class="xinst" title="score: ' +
        (r.score ?? 0) +
        ' (installs + stars/50)">' +
        (r.installs != null
          ? "&#8595; " + fmt(r.installs)
          : r.stars != null
            ? "&#9733; " + fmt(r.stars)
            : "&#8212;") +
        "</div>" +
        '<div class="xact">' +
        action +
        "</div>" +
        "</div>"
      );
    })
    .join("");
  const hasQuery = !!$("#xq").value.trim();
  const filteredOut = hasQuery && !rows.length && xstate.all.length > 0 && filterProviders.size > 0;
  if (filteredOut) {
    $("#xempty").hidden = false;
    $("#xempty").innerHTML =
      '<p>No results for the selected providers.</p><p class="note">Clear provider filters or broaden the query.</p>';
  } else if (!hasQuery) {
    $("#xempty").hidden = false;
    $("#xempty").innerHTML =
      '<p>No results yet.</p><p class="note">Type a query to search skills.sh, Claude marketplaces, SkillsMP, awesome-lists and ClawHub.</p>';
  } else if (!rows.length) {
    $("#xempty").hidden = false;
    $("#xempty").innerHTML =
      '<p>No matches.</p><p class="note">Try another query across skills.sh, marketplaces, SkillsMP, awesome-lists and ClawHub.</p>';
  } else {
    $("#xempty").hidden = true;
  }
  const parts = [];
  if (hasQuery) {
    parts.push(rows.length + " result(s)");
    if (filterProviders.size && xstate.all.length && rows.length !== xstate.all.length) {
      parts.push("of " + xstate.all.length);
    }
  }
  $("#xmeta").textContent = parts.join(" ");
  document.querySelectorAll("#xlist .xact button").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const i = Number(btn.dataset.i);
      if (btn.dataset.act === "uninstall") uninstallExplore(i, btn);
      else installExplore(i, btn);
    };
  });
  document.querySelectorAll("#xlist .xrow").forEach((el) => {
    el.onclick = (e) => {
      if (e.target.closest("button, a")) return;
      openExploreDetail(Number(el.dataset.i));
    };
  });
  wireTips($("#xlist"));
}

function openExploreDetail(i) {
  const r = xstate.results[i];
  if (!r) return;
  current = null;
  const repo = cleanRepo(r.repo);
  const gh = githubUrl(r.repo);
  const t = r.trust;
  const links = [];
  if (r.url) links.push({ href: r.url, label: "Open listing", primary: !gh });
  if (gh && (!r.url || !r.url.includes("github.com/" + repo)))
    links.push({ href: gh, label: "GitHub" });
  if (repo && r.provider.includes("skills.sh")) {
    links.push({ href: "https://www.skills.sh/" + repo, label: "skills.sh" });
  }
  const linkHtml = links.length
    ? '<div class="drawer-links">' +
      links
        .map(
          (l) =>
            '<a href="' +
            escapeHtml(l.href) +
            '" target="_blank" rel="noopener"' +
            (l.primary ? ' class="primary"' : "") +
            ">" +
            escapeHtml(l.label) +
            "</a>",
        )
        .join("") +
      (r.installed
        ? '<button class="danger-btn" id="drawerUninstall">Uninstall</button>'
        : repo
          ? '<button class="primary" id="drawerInstall">Install</button>'
          : "") +
      "</div>"
    : r.installed
      ? '<div class="drawer-links"><button class="danger-btn" id="drawerUninstall">Uninstall</button></div>'
      : repo
        ? '<div class="drawer-links"><button class="primary" id="drawerInstall">Install</button></div>'
        : "";
  const trustHtml = t
    ? '<div class="trust-box"><div class="row-t">' +
      trustBadge(t) +
      "<strong>" +
      (t.level === "high"
        ? "Higher trust"
        : t.level === "medium"
          ? "Moderate trust"
          : t.level === "low"
            ? "Lower trust"
            : "Unknown trust") +
      '</strong><span style="color:var(--faint);font:11px var(--mono)">' +
      t.score +
      "/100</span></div>" +
      "<ul>" +
      t.reasons.map((x) => "<li>" + escapeHtml(x) + "</li>").join("") +
      "</ul>" +
      '<p class="disc">Heuristic popularity / provenance signal — not a security audit. Review the repo before installing.</p></div>'
    : "";
  const tags =
    r.tags && r.tags.length
      ? '<h3 class="label">Tags</h3><div>' +
        r.tags.map((tg) => chipHtml(tg, { static: true })).join("") +
        "</div>"
      : "";
  const stats = [];
  if (r.installs != null)
    stats.push("<dt>installs</dt><dd>" + r.installs.toLocaleString("en-US") + "</dd>");
  if (r.stars != null) stats.push("<dt>stars</dt><dd>" + r.stars.toLocaleString("en-US") + "</dd>");
  if (r.score != null) stats.push("<dt>rank score</dt><dd>" + r.score + "</dd>");
  if (repo) stats.push("<dt>repo</dt><dd>" + escapeHtml(repo) + "</dd>");

  $("#drawer").innerHTML =
    '<button class="close" onclick="closeDetail()">&#10005;&nbsp;close</button>' +
    "<h2>" +
    escapeHtml(r.name) +
    "</h2>" +
    '<div class="cell scope" style="margin-bottom:8px"><span class="badge" style="margin-right:6px">' +
    escapeHtml(r.provider) +
    "</span>" +
    (r.installed ? '<span class="installed-tag">&#10003; installed</span>' : "") +
    "</div>" +
    linkHtml +
    trustHtml +
    '<h3 class="label">Description</h3>' +
    '<p class="lead">' +
    (r.description
      ? escapeHtml(r.description)
      : '<span style="color:var(--faint)">(no description from providers)</span>') +
    "</p>" +
    tags +
    (stats.length
      ? '<h3 class="label">Details</h3><dl class="meta">' + stats.join("") + "</dl>"
      : "");
  $("#overlay").classList.add("open");
  wireTips($("#drawer"));
  const installBtn = $("#drawerInstall");
  if (installBtn) {
    installBtn.onclick = async () => {
      installBtn.disabled = true;
      installBtn.textContent = "installing…";
      await installExplore(i, installBtn);
      openExploreDetail(i);
    };
  }
  const uninstallBtn = $("#drawerUninstall");
  if (uninstallBtn) {
    uninstallBtn.onclick = async () => {
      uninstallBtn.disabled = true;
      uninstallBtn.textContent = "uninstalling…";
      await uninstallExplore(i, uninstallBtn);
      openExploreDetail(i);
    };
  }
}

async function doExplore() {
  const q = $("#xq").value.trim();
  $("#xerr").hidden = true;
  if (!q) {
    xstate.all = [];
    xstate.results = [];
    $("#xlist").innerHTML = "";
    $("#xempty").hidden = false;
    $("#xempty").innerHTML =
      '<p>No results yet.</p><p class="note">Type a query to search skills.sh, Claude marketplaces, SkillsMP, awesome-lists and ClawHub.</p>';
    $("#xmeta").textContent = "";
    renderXProvFilters();
    return;
  }
  $("#xlist").innerHTML = xSkeleton();
  $("#xmeta").textContent = "searching…";
  try {
    const res = await fetch("/api/explore?q=" + encodeURIComponent(q));
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    xstate.all = data.results;
    renderExplore();
  } catch (err) {
    xstate.all = [];
    xstate.results = [];
    $("#xlist").innerHTML = "";
    $("#xempty").hidden = true;
    $("#xerr").textContent = "Search failed: " + err;
    $("#xerr").hidden = false;
    $("#xmeta").textContent = "";
    renderXProvFilters();
  }
}

$("#xq").oninput = () => {
  clearTimeout(xstate.timer);
  xstate.timer = setTimeout(doExplore, 350);
};
$("#xq").onkeydown = (e) => {
  if (e.key === "Enter") {
    clearTimeout(xstate.timer);
    doExplore();
  }
};

$("#xrefresh").onclick = async () => {
  const label = $("#xrefreshLabel");
  label.textContent = "refreshing…";
  $("#xrefresh").disabled = true;
  try {
    const res = await fetch("/api/providers/refresh", { method: "POST" });
    const data = await res.json();
    label.textContent = "cleared " + (data.cleared ?? 0) + " catalog(s)";
    xstate.all = [];
    xstate.results = [];
    if ($("#xq").value.trim()) doExplore();
    else renderExplore();
  } finally {
    setTimeout(() => {
      label.textContent = "Refresh catalogs";
      $("#xrefresh").disabled = false;
    }, 2500);
  }
};

async function installExplore(i, btn) {
  const r = xstate.results[i];
  if (!r) return;
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const result = await runInstall({ name: r.name, repo: r.repo, provider: r.provider });
    if (result.cancelled) {
      btn.disabled = false;
      btn.textContent = prev;
      return;
    }
    if (!result.ok) throw new Error("command exited " + result.code);
    r.installed = true;
    const all = xstate.all.find((x) => x.name === r.name && x.repo === r.repo);
    if (all) all.installed = true;
    renderExplore();
    load();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "retry";
    btn.title = String(err);
  }
}

async function uninstallExplore(i, btn) {
  const r = xstate.results[i];
  if (!r) return;
  const prev = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";
  try {
    const result = await runUninstall({ name: r.name, repo: r.repo, provider: r.provider });
    if (result.cancelled) {
      btn.disabled = false;
      btn.textContent = prev;
      return;
    }
    if (!result.ok) throw new Error("command exited " + result.code);
    r.installed = false;
    const all = xstate.all.find((x) => x.name === r.name && x.repo === r.repo);
    if (all) all.installed = false;
    renderExplore();
    load();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "retry";
    btn.title = String(err);
  }
}

async function uninstallInstalled(s, btn) {
  const prev = btn ? btn.textContent : "";
  if (btn) {
    btn.disabled = true;
    btn.textContent = "…";
  }
  try {
    const repo = s.registry?.source || s.registry?.id || undefined;
    const result = await runUninstall({ name: s.name, repo, provider: "skills" });
    if (result.cancelled) {
      if (btn) {
        btn.disabled = false;
        btn.textContent = prev;
      }
      return;
    }
    if (!result.ok) throw new Error("command exited " + result.code);
    closeDetail();
    await load(true);
  } catch (err) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "retry";
      btn.title = String(err);
    }
    alert("Uninstall failed:\n" + String(err));
  }
}

function skillOwner(s) {
  return s.related?.owner || null;
}
function skillRepo(s) {
  return s.related?.repo || null;
}
function originLabel(s) {
  const repo = skillRepo(s);
  if (!repo) return null;
  const siblings = s.related?.siblings?.length ?? 0;
  return { repo, owner: skillOwner(s), siblings };
}

function filtered() {
  const q = $("#q").value.trim().toLowerCase();
  const rows = state.skills.filter((s) => {
    if (filterScope && s.scope !== filterScope) return false;
    if (onlyReg && !s.registry) return false;
    if (filterSources.size && !filterSources.has(s.source)) return false;
    if (filterOwners.size) {
      const owner = skillOwner(s);
      if (!owner || !filterOwners.has(owner)) return false;
    }
    if (filterTags.size && ![...filterTags].some((t) => s.tags.includes(t))) return false;
    if (q) {
      const hay = [s.name, s.description, s.summary, skillOwner(s) || "", skillRepo(s) || ""]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  rows.sort((a, b) => {
    if (sortBy === "installs") return (b.registry?.installs ?? -1) - (a.registry?.installs ?? -1);
    if (sortBy === "modified") return b.modified.localeCompare(a.modified);
    if (sortBy === "usage") return (b.usage?.totalSessions ?? -1) - (a.usage?.totalSessions ?? -1);
    if (sortBy === "owner") {
      const ao = skillOwner(a) || "\uffff";
      const bo = skillOwner(b) || "\uffff";
      return ao.localeCompare(bo) || a.name.localeCompare(b.name);
    }
    if (sortBy === "repo") {
      const ar = skillRepo(a) || "\uffff";
      const br = skillRepo(b) || "\uffff";
      return ar.localeCompare(br) || a.name.localeCompare(b.name);
    }
    return a.name.localeCompare(b.name);
  });
  return rows;
}

function renderSourceFilters() {
  const counts = {};
  for (const s of state.skills) counts[s.source] = (counts[s.source] ?? 0) + 1;
  const sources = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const none = filterSources.size === 0;
  let html =
    '<span class="filter-label">Source</span>' +
    '<button type="button" class="fchip all' +
    (none ? " active" : "") +
    '" data-source="">All<span class="n">' +
    state.skills.length +
    "</span></button>";
  for (const src of sources) {
    const active = filterSources.has(src);
    html +=
      '<button type="button" class="fchip' +
      (active ? " active" : "") +
      '" data-source="' +
      escapeHtml(src) +
      '"' +
      ' title="' +
      escapeHtml(src) +
      '" aria-pressed="' +
      active +
      '">' +
      escapeHtml(sourceShort(src)) +
      '<span class="n">' +
      counts[src] +
      "</span></button>";
  }
  $("#sourceFilters").innerHTML = html;
  $("#sourceFilters")
    .querySelectorAll(".fchip")
    .forEach((el) => {
      el.onclick = () => {
        const src = el.dataset.source;
        if (!src) filterSources.clear();
        else if (filterSources.has(src)) filterSources.delete(src);
        else filterSources.add(src);
        render();
      };
    });
}

function renderOwnerFilters() {
  const counts = {};
  for (const s of state.skills) {
    const owner = skillOwner(s);
    if (owner) counts[owner] = (counts[owner] ?? 0) + 1;
  }
  const owners = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const withOwner = Object.values(counts).reduce((a, n) => a + n, 0);
  const none = filterOwners.size === 0;
  let html =
    '<span class="filter-label">Publisher</span>' +
    '<button type="button" class="fchip all' +
    (none ? " active" : "") +
    '" data-owner="">All<span class="n">' +
    withOwner +
    "</span></button>";
  for (const [owner, n] of owners.slice(0, 28)) {
    const active = filterOwners.has(owner);
    html +=
      '<button type="button" class="fchip' +
      (active ? " active" : "") +
      '" data-owner="' +
      escapeHtml(owner) +
      '"' +
      ' title="' +
      escapeHtml(owner) +
      " · " +
      n +
      " skill" +
      (n === 1 ? "" : "s") +
      '" aria-pressed="' +
      active +
      '">' +
      escapeHtml(owner) +
      '<span class="n">' +
      n +
      "</span></button>";
  }
  $("#ownerFilters").innerHTML = html;
  $("#ownerFilters")
    .querySelectorAll(".fchip")
    .forEach((el) => {
      el.onclick = () => {
        const owner = el.dataset.owner;
        if (!owner) filterOwners.clear();
        else if (filterOwners.has(owner)) filterOwners.delete(owner);
        else filterOwners.add(owner);
        render();
      };
    });
}

function renderScopeFilters() {
  const counts = {};
  for (const s of state.skills) counts[s.scope] = (counts[s.scope] ?? 0) + 1;
  const scopes = Object.keys(counts).sort();
  const none = !filterScope;
  let html =
    '<span class="filter-label">Scope</span>' +
    '<button type="button" class="fchip all' +
    (none ? " active" : "") +
    '" data-scope="">All</button>';
  for (const sc of scopes) {
    const active = filterScope === sc;
    html +=
      '<button type="button" class="fchip' +
      (active ? " active" : "") +
      '" data-scope="' +
      escapeHtml(sc) +
      '"' +
      ' aria-pressed="' +
      active +
      '">' +
      escapeHtml(sc) +
      '<span class="n">' +
      counts[sc] +
      "</span></button>";
  }
  $("#scopeFilters").innerHTML = html;
  $("#scopeFilters")
    .querySelectorAll(".fchip")
    .forEach((el) => {
      el.onclick = () => {
        filterScope = el.dataset.scope || "";
        render();
      };
    });
}

function syncOnlyRegChip() {
  const el = $("#onlyReg");
  el.classList.toggle("active", onlyReg);
  el.setAttribute("aria-pressed", onlyReg ? "true" : "false");
}

function renderSortFilters() {
  $("#sortFilters")
    .querySelectorAll(".fchip")
    .forEach((el) => {
      const active = el.dataset.sort === sortBy;
      el.classList.toggle("active", active);
      el.classList.toggle("all", active);
      el.setAttribute("aria-pressed", active ? "true" : "false");
    });
}

function setSort(next) {
  sortBy = next || "name";
  render();
}

function hi(text) {
  const q = $("#q").value.trim();
  if (!q) return escapeHtml(text);
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i === -1) return escapeHtml(text);
  return (
    escapeHtml(text.slice(0, i)) +
    "<mark>" +
    escapeHtml(text.slice(i, i + q.length)) +
    "</mark>" +
    escapeHtml(text.slice(i + q.length))
  );
}

function renderTagbar() {
  const counts = {};
  for (const s of state.skills) for (const t of s.tags) counts[t] = (counts[t] ?? 0) + 1;
  const tags = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  let html = tags.map((t) => chipHtml(t, { count: counts[t], active: filterTags.has(t) })).join("");
  if (filterTags.size) {
    html += '<button id="clearTags">&#10005; clear (' + filterTags.size + ")</button>";
  }
  $("#tagbar").innerHTML = html || '<span class="note">no tags yet</span>';
  document.querySelectorAll("#tagbar .tag").forEach((el) => {
    el.onclick = () => toggleTag(el.dataset.tag);
  });
  const clear = $("#clearTags");
  if (clear)
    clear.onclick = () => {
      filterTags.clear();
      render();
    };
}

function toggleTag(tag) {
  if (filterTags.has(tag)) filterTags.delete(tag);
  else filterTags.add(tag);
  render();
}

function renderSortHead() {
  document.querySelectorAll("#listhead .h.sortable").forEach((el) => {
    const active = el.dataset.sort === sortBy;
    el.classList.toggle("active", active);
    el.querySelector(".dir").textContent = active ? "▼" : "";
  });
}

function renderRow(s) {
  const inst = s.registry
    ? '<a href="' +
      s.registry.url +
      '" target="_blank" rel="noopener" title="on skills.sh (' +
      escapeHtml(s.registry.id) +
      ')">&#8595; ' +
      fmt(s.registry.installs) +
      "</a>"
    : '<span class="none" title="No exact match on skills.sh">&#8212;</span>';
  const shown = s.tags
    .slice(0, 4)
    .map((t) => chipHtml(t, { static: true, manual: s.manualTags.includes(t) }))
    .join("");
  const rest = s.tags.slice(4);
  const more = rest.length
    ? '<span class="tag static" data-tip="' +
      escapeHtml(rest.join(", ")) +
      '" data-tip-always>+' +
      rest.length +
      "</span>"
    : "";
  const descText = s.description || s.summary || "";
  const usageText = s.usage
    ? s.usage.totalSessions +
      " session" +
      (s.usage.totalSessions > 1 ? "s" : "") +
      " · " +
      s.usage.harnesses.join(", ")
    : "";
  const origin = originLabel(s);
  const originHtml = origin
    ? '<div class="origin" title="' +
      escapeHtml(origin.repo) +
      (origin.siblings ? " · " + origin.siblings + " other skill(s) from this repo" : "") +
      '">' +
      '<button type="button" class="owner-link" data-owner="' +
      escapeHtml(origin.owner) +
      '">' +
      escapeHtml(origin.owner) +
      "</button>" +
      "<span>/" +
      escapeHtml(origin.repo.split("/")[1] || "") +
      "</span>" +
      (origin.siblings ? '<span class="more"> · +' + origin.siblings + "</span>" : "") +
      "</div>"
    : '<div class="origin" style="color:var(--faint)">local / unlisted</div>';
  return (
    '<div class="row" data-id="' +
    s.id +
    '">' +
    '<div class="cell name">' +
    '<div class="name-row" data-tip="' +
    escapeHtml(s.name) +
    '" data-tip-mono tabindex="0">' +
    trustBadge(s.trust) +
    '<span class="nm">' +
    hi(s.name) +
    "</span></div>" +
    originHtml +
    "</div>" +
    '<div class="cell main">' +
    '<div class="desc" data-tip="' +
    escapeHtml(descText) +
    '" tabindex="0">' +
    (descText ? hi(descText) : '<span style="color:var(--faint)">no description</span>') +
    "</div>" +
    (s.tags.length ? '<div class="tags">' + shown + more + "</div>" : "") +
    "</div>" +
    '<div class="cell scope"><span class="sq ' +
    s.scope +
    '"></span>' +
    s.scope +
    ' <span class="src" data-tip="' +
    escapeHtml(s.scope + " · " + s.source) +
    '" data-tip-mono tabindex="0">' +
    escapeHtml(s.source) +
    "</span></div>" +
    '<div class="cell inst">' +
    inst +
    "</div>" +
    '<div class="cell usage"' +
    (usageText ? ' data-tip="' + escapeHtml(usageText) + '" data-tip-always' : "") +
    ">" +
    (s.usage
      ? '<span class="n">' + s.usage.totalSessions + "</span> s."
      : '<span class="none">—</span>') +
    "</div>" +
    "</div>"
  );
}

function render() {
  renderSourceFilters();
  renderOwnerFilters();
  renderScopeFilters();
  renderSortFilters();
  syncOnlyRegChip();
  renderTagbar();
  renderSortHead();
  const rows = filtered();
  const withReg = state.skills.filter((s) => s.registry).length;
  const tagged = state.skills.filter((s) => s.tags.length).length;
  const withUsage = state.skills.filter((s) => s.usage && s.usage.totalSessions > 0).length;
  const publishers = new Set(state.skills.map(skillOwner).filter(Boolean)).size;
  $("#meta").textContent =
    state.skills.length +
    " installed · " +
    publishers +
    " publishers · " +
    withReg +
    " on skills.sh · " +
    tagged +
    " tagged · " +
    withUsage +
    " with usage";

  const groupBy = sortBy === "owner" || sortBy === "repo" ? sortBy : null;
  let html = "";
  let lastKey = null;
  for (const s of rows) {
    if (groupBy) {
      const key = (groupBy === "owner" ? skillOwner(s) : skillRepo(s)) || "(unknown)";
      if (key !== lastKey) {
        lastKey = key;
        const count = rows.filter(
          (r) => ((groupBy === "owner" ? skillOwner(r) : skillRepo(r)) || "(unknown)") === key,
        ).length;
        const owner =
          groupBy === "owner"
            ? key === "(unknown)"
              ? ""
              : key
            : key.includes("/")
              ? key.split("/")[0]
              : "";
        html +=
          '<div class="group-head">' +
          '<span class="gk">' +
          escapeHtml(key) +
          "</span>" +
          '<span class="gn">' +
          count +
          " skill" +
          (count === 1 ? "" : "s") +
          "</span>" +
          (owner
            ? '<button type="button" class="gfilter" data-owner="' +
              escapeHtml(owner) +
              '">filter publisher</button>'
            : "") +
          "</div>";
      }
    }
    html += renderRow(s);
  }
  $("#list").innerHTML = html;
  $("#empty").hidden = rows.length > 0;
  document.querySelectorAll(".row").forEach((el) => {
    el.onclick = () => openDetail(el.dataset.id);
  });
  document.querySelectorAll(".owner-link, .gfilter").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      const owner = el.dataset.owner;
      if (!owner) return;
      filterOwners.clear();
      filterOwners.add(owner);
      if (sortBy !== "owner" && sortBy !== "repo") sortBy = "owner";
      render();
    };
  });
  wireTips($("#list"));
}

async function openDetail(id) {
  const s = state.skills.find((x) => x.id === id);
  if (!s) return;
  current = s;
  const res = await fetch("/api/skills/" + encodeURIComponent(s.name) + "?scope=" + s.scope);
  const data = await res.json();
  const fm = Object.entries(data.skill.frontmatter)
    .filter(([k]) => !["name", "description"].includes(k))
    .map(([k, v]) => "<dt>" + escapeHtml(k) + "</dt><dd>" + escapeHtml(v) + "</dd>")
    .join("");
  const reg = data.skill.registry
    ? '<p class="lead">&#8595; <strong style="color:var(--ok)">' +
      data.skill.registry.installs.toLocaleString("en-US") +
      " installs</strong> on skills.sh · " +
      '<a href="' +
      data.skill.registry.url +
      '" target="_blank" rel="noopener">' +
      escapeHtml(data.skill.registry.id) +
      "</a></p>"
    : '<p class="lead" style="color:var(--faint)">No exact match on skills.sh</p>';
  const t = s.trust;
  const trustHtml = t
    ? '<div class="trust-box"><div class="row-t">' +
      trustBadge(t) +
      "<strong>" +
      (t.level === "high"
        ? "Higher trust"
        : t.level === "medium"
          ? "Moderate trust"
          : t.level === "low"
            ? "Lower trust"
            : "Unknown trust") +
      '</strong><span style="color:var(--faint);font:11px var(--mono)">' +
      t.score +
      "/100</span></div>" +
      "<ul>" +
      (t.reasons || []).map((x) => "<li>" + escapeHtml(x) + "</li>").join("") +
      "</ul>" +
      '<p class="disc">Heuristic popularity / provenance signal — not a security audit.</p></div>'
    : "";
  $("#drawer").innerHTML =
    '<button class="close" onclick="closeDetail()">&#10005;&nbsp;close</button>' +
    "<h2>" +
    escapeHtml(s.name) +
    "</h2>" +
    '<div class="cell scope" style="margin-bottom:8px"><span class="sq ' +
    s.scope +
    '"></span>' +
    s.scope +
    ' <span class="src">' +
    escapeHtml(s.source) +
    "</span></div>" +
    '<div class="drawer-links"><button class="danger-btn" id="drawerUninstallInstalled">Uninstall</button></div>' +
    reg +
    trustHtml +
    '<p class="lead">' +
    escapeHtml(data.skill.description || "(no description in frontmatter)") +
    "</p>" +
    (data.skill.summary && data.skill.summary !== data.skill.description
      ? "<p><em>" + escapeHtml(data.skill.summary) + "</em></p>"
      : "") +
    '<h3 class="label">Tags</h3><div id="tagEditor"></div>' +
    '<h3 class="label">Details</h3>' +
    '<dl class="meta"><dt>path</dt><dd>' +
    escapeHtml(s.path) +
    "</dd>" +
    "<dt>files</dt><dd>" +
    s.files +
    "</dd>" +
    "<dt>size</dt><dd>" +
    s.sizeKb +
    " KB</dd>" +
    "<dt>modified</dt><dd>" +
    s.modified +
    "</dd>" +
    fm +
    "</dl>" +
    (data.skill.headings.length
      ? '<h3 class="label">Sections</h3>' +
        data.skill.headings.map((h) => chipHtml(h, { static: true })).join(" ")
      : "") +
    (data.skill.usage
      ? '<h3 class="label">Usage</h3>' +
        '<dl class="meta"><dt>sessions</dt><dd><strong>' +
        data.skill.usage.totalSessions +
        "</strong> (" +
        data.skill.usage.uniqueSessions +
        " unique)</dd>" +
        "<dt>harnesses</dt><dd>" +
        escapeHtml(data.skill.usage.harnesses.join(", ")) +
        "</dd>" +
        "<dt>last used</dt><dd>" +
        (data.skill.usage.lastUsed
          ? new Date(data.skill.usage.lastUsed).toLocaleString()
          : "never") +
        "</dd>" +
        "</dl>"
      : "") +
    (data.skill.related &&
    (data.skill.related.repo ||
      data.skill.related.siblings?.length ||
      data.skill.related.sameOwner?.length)
      ? '<h3 class="label">Publisher</h3>' +
        '<dl class="meta">' +
        (data.skill.related.repo
          ? "<dt>repo</dt><dd>" + escapeHtml(data.skill.related.repo) + "</dd>"
          : "") +
        (data.skill.related.owner
          ? "<dt>owner</dt><dd>" +
            escapeHtml(data.skill.related.owner) +
            ' <button type="button" class="gfilter" id="drawerFilterOwner" data-owner="' +
            escapeHtml(data.skill.related.owner) +
            '">show all from publisher</button></dd>'
          : "") +
        (data.skill.related.siblings?.length
          ? "<dt>same repo</dt><dd>" +
            data.skill.related.siblings.map((n) => escapeHtml(n)).join(", ") +
            "</dd>"
          : "") +
        (data.skill.related.sameOwner?.length &&
        data.skill.related.sameOwner.length !== (data.skill.related.siblings?.length || 0)
          ? "<dt>same owner</dt><dd>" +
            data.skill.related.sameOwner.map((n) => escapeHtml(n)).join(", ") +
            "</dd>"
          : "") +
        "</dl>"
      : "") +
    '<h3 class="label">SKILL.md</h3><pre>' +
    escapeHtml(data.content) +
    "</pre>";
  renderEditor();
  $("#overlay").classList.add("open");
  wireTips($("#drawer"));
  const unBtn = $("#drawerUninstallInstalled");
  if (unBtn) unBtn.onclick = () => uninstallInstalled(s, unBtn);
  const filterOwnerBtn = $("#drawerFilterOwner");
  if (filterOwnerBtn) {
    filterOwnerBtn.onclick = () => {
      const owner = filterOwnerBtn.dataset.owner;
      if (!owner) return;
      filterOwners.clear();
      filterOwners.add(owner);
      sortBy = "owner";
      closeDetail();
      render();
    };
  }
}

function renderEditor() {
  if (!current) return;
  const s = current;
  const manual = s.manualTags.map((t) => chipHtml(t, { removable: true, manual: true })).join("");
  const auto = s.autoTags
    .filter((t) => !s.manualTags.includes(t))
    .map((t) => chipHtml(t, { static: true }))
    .join("");
  $("#tagEditor").innerHTML =
    (manual || "") +
    (auto || "") +
    (s.tags.length
      ? ""
      : '<span class="note" style="color:var(--faint);font-size:12px">no tags yet &#8212;</span>') +
    '<input type="text" id="newTag" placeholder="new tag…" maxlength="40">' +
    '<button onclick="addManualTag()">Add</button>' +
    '<div class="hint">dot = manual (saved to ~/.skiller/tags.json) · the rest are inferred from content</div>';
  document.querySelectorAll("#tagEditor .x").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();
      removeManualTag(el.dataset.tag);
    };
  });
  $("#newTag").onkeydown = (e) => {
    if (e.key === "Enter") addManualTag();
  };
  $("#newTag").focus();
}

async function addManualTag() {
  const input = $("#newTag");
  const tag = input.value.trim();
  if (!tag || !current) return;
  await fetch("/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: current.name, tag }),
  });
  applyTags(current.name, [...new Set([...(current.manualTags || []), tag])]);
  renderEditor();
  render();
}

async function removeManualTag(tag) {
  if (!current) return;
  await fetch("/api/tags/" + encodeURIComponent(current.name) + "/" + encodeURIComponent(tag), {
    method: "DELETE",
  });
  applyTags(
    current.name,
    (current.manualTags || []).filter((t) => t !== tag),
  );
  renderEditor();
  render();
}

function applyTags(name, manualTags) {
  for (const s of state.skills) {
    if (s.name === name) {
      s.manualTags = manualTags;
      s.tags = [...new Set([...manualTags, ...s.autoTags])];
    }
  }
  current.manualTags = manualTags;
  current.tags = [...new Set([...manualTags, ...current.autoTags])];
}

function closeDetail() {
  $("#overlay").classList.remove("open");
  current = null;
}

$("#q").oninput = render;
$("#sortFilters")
  .querySelectorAll(".fchip")
  .forEach((el) => {
    el.onclick = () => setSort(el.dataset.sort);
  });
document.querySelectorAll("#listhead .h.sortable").forEach((el) => {
  el.onclick = () => setSort(el.dataset.sort);
});
$("#onlyReg").onclick = () => {
  onlyReg = !onlyReg;
  render();
};
$("#reset").onclick = () => {
  filterTags.clear();
  filterSources.clear();
  filterOwners.clear();
  filterScope = "";
  onlyReg = false;
  sortBy = "name";
  $("#q").value = "";
  render();
};
$("#refresh").onclick = () => {
  $("#refreshLabel").textContent = "refreshing…";
  $("#list").innerHTML = skeletonHtml();
  load(true).finally(() => {
    $("#refreshLabel").textContent = "Refresh";
  });
};
$("#overlay").onclick = (e) => {
  if (e.target.id === "overlay") closeDetail();
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    hideTip();
    if ($("#term").classList.contains("open")) {
      $("#termClose").click();
      return;
    }
    if ($("#confirm").classList.contains("open")) {
      $("#confirmCancel").click();
      return;
    }
    closeDetail();
  }
});
document.addEventListener("scroll", hideTip, true);

if (location.hash === "#explore") {
  switchTab("explore");
  const preset = new URLSearchParams(location.search).get("xq");
  if (preset) {
    $("#xq").value = preset;
    doExplore();
  }
}
load();
