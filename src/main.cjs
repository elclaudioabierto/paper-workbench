const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
if (process.platform === "darwin") {
  // Finder launches with a minimal PATH; include common CLI install locations.
  process.env.PATH = [
    process.env.PATH || "",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(app.getPath("home"), ".local", "bin"),
  ].join(path.delimiter);
}
const { Store, hash } = require("./store.cjs");
const { validateGraph } = require("./graph.cjs");
const { randomUUID } = require("node:crypto");
const { Codex } = require("./codex.cjs");
const { workflows, buildPrompt, BASE } = require("./workflows.cjs");
const { extract, exportDocx, markdownBundle } = require("./documents.cjs");
const { exportPptx } = require("./presentation.cjs");
let win,
  store,
  codex,
  active = null,
  graphExecution = null;
const dataRoot =
  process.env.PAPER_WORKBENCH_DATA ||
  path.join(app.getPath("userData"), "library");
const send = (type, data) => {
  if (win && !win.isDestroyed())
    win.webContents.send("workbench:event", { type, data });
};
const cleanName = (name) =>
  name.replace(/[^\p{L}\p{N}_. -]/gu, "-").slice(0, 100) || "paper-workbench";
function finish(status, error) {
  if (!active) return;
  const { projectId, run, timer } = active;
  clearTimeout(timer);
  store.finishRun(projectId, run, status, error);
  active = null;
  send("run", { projectId, run });
  if (graphExecution && run.graphExecutionId === graphExecution.id)
    graphStepFinished(run);
}
function notification({ method, params: p }) {
  if (/^account\//.test(method)) {
    send("account", { method, params: p });
    return;
  }
  if (!active || (p.threadId && p.threadId !== active.run.threadId)) return;
  const { projectId, run } = active;
  // Persist observable protocol activity, excluding internal reasoning streams and duplicate legacy notifications.
  if (/reasoning|rawResponse|^codex\//i.test(method)) return;
  store.appendRunEvent(projectId, run.id, method, p);
  if (method === "item/agentMessage/delta") {
    active.messages.set(
      p.itemId,
      (active.messages.get(p.itemId) || "") + p.delta,
    );
    run.output = [...active.messages.values()].join("\n\n");
    send("delta", { projectId, runId: run.id, output: run.output });
  }
  if (method === "item/completed" && p.item?.type === "agentMessage") {
    active.messages.set(p.item.id, p.item.text || "");
    if (p.item.phase === "final_answer")
      active.finalMessages.set(p.item.id, p.item.text || "");
    run.output = [
      ...(active.finalMessages.size
        ? active.finalMessages
        : active.messages
      ).values(),
    ].join("\n\n");
    send("delta", { projectId, runId: run.id, output: run.output });
  }
  if (method === "thread/tokenUsage/updated") run.tokenUsage = p.tokenUsage;
  if (method === "turn/started") {
    run.turnId = p.turn.id;
    run.status = "running";
    store.saveRun(projectId, run);
    send("run", { projectId, run });
  }
  if (method === "error") {
    run.lastError = p.error?.message || p.message;
    send("activity", {
      projectId,
      runId: run.id,
      method,
      detail: run.lastError,
    });
  }
  if (method === "item/started")
    send("activity", {
      projectId,
      runId: run.id,
      method: p.item?.type || method,
    });
  if (method === "turn/completed") {
    run.turnId = p.turn.id;
    if (active.finalMessages.size)
      run.output = [...active.finalMessages.values()].join("\n\n");
    finish(
      p.turn.status === "completed"
        ? "completed"
        : p.turn.status === "interrupted"
          ? "cancelled"
          : "failed",
      p.turn.error?.message ||
        (p.turn.status === "failed"
          ? run.lastError || "Codex could not finish this run."
          : null),
    );
  }
}
async function startRun(input) {
  if (active)
    throw new Error(
      "A workflow is already running. Wait for it to finish or cancel it.",
    );
  const p = store.project(input.projectId);
  if (!Array.isArray(input.documentIds) || !input.documentIds.length)
    throw new Error("Select source documents.");
  const docs =
    input._graphDocs ||
    [...new Set(input.documentIds)].map((id) => store.document(p.id, id));
  const custom = store.customWorkflows();
  const built = buildPrompt(
    p,
    docs,
    input.workflow,
    input.options || {},
    custom,
  );
  if (typeof input.model !== "string" || !input.model.trim())
    throw new Error("Choose an available model in Settings.");
  const run = store.createRun(p.id, {
    ...built,
    workflow: input.workflow,
    model: input.model,
    effort: input.effort || "medium",
    appVersion: app.getVersion(),
    sourceDocuments: docs.map((d) => ({
      id: d.id,
      name: d.name,
      version: d.version,
      sha256: d.sha256,
    })),
    parentRunId: input.parentRunId || null,
    graphExecutionId: input._graphExecutionId || null,
    graphNodeId: input._graphNodeId || null,
    inputRunIds: input._inputRunIds || [],
    execution: {
      sandbox: "read-only",
      approvalPolicy: "never",
      webSearch:
        ["journal", "preflight", "reviewers"].includes(input.workflow) ||
        custom[input.workflow]?.webSearch
          ? "live"
          : "disabled",
    },
  });
  const current = {
    projectId: p.id,
    run,
    messages: new Map(),
    finalMessages: new Map(),
    cancelRequested: false,
  };
  active = current;
  current.timer = setTimeout(
    () => {
      if (active !== current) return;
      if (run.threadId && run.turnId)
        codex
          .request("turn/interrupt", {
            threadId: run.threadId,
            turnId: run.turnId,
          })
          .catch(() => {});
      finish(
        "failed",
        "Run exceeded the 30-minute limit. Partial output was retained.",
      );
    },
    30 * 60 * 1000,
  );
  send("run", { projectId: p.id, run });
  (async () => {
    try {
      await codex.start();
      run.codexVersion = codex.version;
      if (current.cancelRequested) {
        finish("cancelled");
        return;
      }
      const result = await codex.request("thread/start", {
        cwd: store.dir(p.id),
        model: run.model,
        sandbox: "read-only",
        approvalPolicy: "never",
        baseInstructions: BASE,
        config: {
          web_search: run.execution.webSearch,
          features: { shell_tool: false, apply_patch_freeform: false },
        },
      });
      if (active !== current) return;
      run.threadId = result.thread.id;
      run.resolvedModel = result.model;
      store.saveRun(p.id, run);
      store.audit(p.id, "run.connected", {
        runId: run.id,
        threadId: run.threadId,
        resolvedModel: result.model,
        codexVersion: run.codexVersion,
      });
      if (current.cancelRequested) {
        finish("cancelled");
        return;
      }
      const turn = await codex.request("turn/start", {
        threadId: run.threadId,
        input: [{ type: "text", text: run.prompt }],
        effort: run.effort,
      });
      if (active !== current) return;
      run.turnId = turn.turn.id;
      run.status = "running";
      store.saveRun(p.id, run);
      send("run", { projectId: p.id, run });
      if (current.cancelRequested)
        await codex.request("turn/interrupt", {
          threadId: run.threadId,
          turnId: run.turnId,
        });
    } catch (e) {
      if (active === current) finish("failed", e.message);
    }
  })();
  return run;
}
function graphUpdate() {
  if (graphExecution) send("graph", graphExecution.public);
}
function graphEnd(status, error = "") {
  const g = graphExecution;
  if (!g) return;
  g.public.status = status;
  g.public.error = error;
  store.audit(g.projectId, "graph.finished", {
    executionId: g.id,
    status,
    error,
    steps: g.public.steps,
  });
  graphUpdate();
  graphExecution = null;
}
function graphStepFinished(run) {
  const g = graphExecution;
  if (!g) return;
  const step = g.public.steps.find((s) => s.id === run.graphNodeId);
  step.status = run.status;
  step.runId = run.id;
  if (run.status !== "completed")
    return graphEnd(run.status, run.error || "A step did not complete.");
  g.results.set(step.id, run);
  graphUpdate();
  setImmediate(() => {
    if (graphExecution === g) graphNext();
  });
}
async function graphNext() {
  const g = graphExecution;
  if (!g) return;
  const node = g.order[g.index++];
  if (!node) return graphEnd("completed");
  try {
    const sources = g.graph.edges
      .filter((e) => e.to === node.id && e.type === "output")
      .map((e) => g.results.get(e.from));
    if (sources.some((r) => !r || !r.output.trim()))
      throw new Error("An upstream step produced no output to pass forward.");
    const extra = sources.map((r) => ({
      id: r.id,
      name: `Output of ${r.workflowTitle} (run ${r.id})`,
      role: "notes",
      version: 1,
      text: r.output,
      sha256: hash(r.output),
    }));
    const step = g.public.steps.find((s) => s.id === node.id);
    step.status = "starting";
    graphUpdate();
    await startRun({
      projectId: g.projectId,
      documentIds: g.documentIds,
      workflow: node.workflow,
      model: g.model,
      effort: g.effort,
      options: { instructions: node.instructions || "" },
      _graphDocs: [...g.docs, ...extra],
      _graphExecutionId: g.id,
      _graphNodeId: node.id,
      _inputRunIds: sources.map((r) => r.id),
    });
  } catch (e) {
    const step = g.public.steps.find((s) => s.id === node.id);
    step.status = "failed";
    graphEnd("failed", e.message);
  }
}
async function startGraph(input) {
  if (active || graphExecution)
    throw new Error("A workflow or graph is already running.");
  const project = store.project(input.projectId);
  const graph = store.graph(input.projectId);
  const definitions = { ...workflows, ...store.customWorkflows() };
  const order = validateGraph(graph, definitions);
  if (!order.length) throw new Error("Add at least one step.");
  if (!Array.isArray(input.documentIds) || !input.documentIds.length)
    throw new Error("Select source documents.");
  if (typeof input.model !== "string" || !input.model.trim())
    throw new Error("Choose an available model in Settings.");
  const documentIds = [...new Set(input.documentIds)];
  const docs = documentIds.map((id) => store.document(project.id, id));
  // Catch invalid settings before starting any work.
  for (const node of order)
    buildPrompt(
      project,
      docs,
      node.workflow,
      { instructions: node.instructions || "" },
      definitions,
    );
  const id = randomUUID();
  graphExecution = {
    id,
    projectId: project.id,
    graph,
    order,
    index: 0,
    docs,
    documentIds,
    model: input.model,
    effort: input.effort || "medium",
    results: new Map(),
    public: {
      id,
      projectId: project.id,
      status: "running",
      steps: order.map((n) => ({
        id: n.id,
        workflow: n.workflow,
        status: "waiting",
        runId: null,
      })),
    },
  };
  store.audit(project.id, "graph.started", {
    executionId: id,
    graph,
    documentIds,
    model: input.model,
    effort: input.effort || "medium",
  });
  graphUpdate();
  const result = graphExecution.public;
  await graphNext();
  return result;
}
const handlers = {
  bootstrap: async () => ({
    projects: store.list(),
    workflows: { ...workflows, ...store.customWorkflows() },
    dataRoot,
    version: app.getVersion(),
    active: active ? { projectId: active.projectId, run: active.run } : null,
    graphExecution: graphExecution?.public || null,
  }),
  customWorkflowSave: async (input) => {
    store.saveCustomWorkflow(input);
    return { ...workflows, ...store.customWorkflows() };
  },
  projectCreate: async ({ name }) => store.create(name),
  projectUpdate: async ({ projectId, ...input }) =>
    store.update(projectId, input),
  projectOpen: async ({ projectId }) => ({
    project: store.project(projectId),
    documents: store.docs(projectId),
    runs: store.runs(projectId),
    audit: store.events(projectId),
    integrity: store.verify(projectId),
    graph: store.graph(projectId),
  }),
  documentAdd: async ({ projectId, ...input }) =>
    store.addDocument(projectId, input),
  documentSave: async ({ projectId, documentId, ...input }) =>
    store.saveDocument(projectId, documentId, input),
  documentImport: async ({ projectId, role }) => {
    store.project(projectId);
    const result = await dialog.showOpenDialog(win, {
      title: "Import project documents",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Documents",
          extensions: ["docx", "pdf", "md", "txt", "markdown", "csv"],
        },
      ],
    });
    if (result.canceled) return { documents: [], errors: [] };
    const documents = [],
      errors = [];
    for (const file of result.filePaths) {
      try {
        documents.push(
          store.addDocument(projectId, { ...(await extract(file)), role }),
        );
      } catch (e) {
        errors.push(`${path.basename(file)}: ${e.message}`);
      }
    }
    return { documents, errors };
  },
  documentVersions: async ({ projectId, documentId }) => {
    store.document(projectId, documentId);
    const dir = path.join(store.dir(projectId), "versions", documentId);
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
      .sort((a, b) => b.version - a.version);
  },
  account: async () => {
    await codex.start();
    const result = await codex.request("account/read", { refreshToken: false });
    return { ...result, codexVersion: codex.version };
  },
  login: async () => {
    await codex.start();
    return codex.request("account/login/start", { type: "chatgptDeviceCode" });
  },
  loginCancel: async ({ loginId }) =>
    codex.request("account/login/cancel", { loginId }),
  logout: async () => {
    if (active)
      throw new Error("Finish or cancel the active run before signing out.");
    await codex.start();
    return codex.request("account/logout");
  },
  models: async () => {
    await codex.start();
    const models = [];
    let cursor = null;
    do {
      const result = await codex.request("model/list", { cursor, limit: 100 });
      models.push(...result.data);
      cursor = result.nextCursor;
    } while (cursor);
    return models;
  },
  graphSave: async ({ projectId, graph }) => {
    validateGraph(graph, { ...workflows, ...store.customWorkflows() });
    return store.saveGraph(projectId, graph);
  },
  graphStart: startGraph,
  graphCancel: async () => {
    if (!graphExecution) return;
    if (active) return handlers.runCancel({ runId: active.run.id });
    graphEnd("cancelled", "Stopped by user.");
  },
  runStart: async (input) => {
    if (graphExecution) throw new Error("A workflow graph is running.");
    const {
      _graphDocs,
      _graphExecutionId,
      _graphNodeId,
      _inputRunIds,
      ...safeInput
    } = input;
    return startRun(safeInput);
  },
  runCancel: async ({ runId }) => {
    if (!active || active.run.id !== runId) return;
    active.cancelRequested = true;
    if (active.run.turnId)
      await codex.request("turn/interrupt", {
        threadId: active.run.threadId,
        turnId: active.run.turnId,
      });
    return true;
  },
  runDetail: async ({ projectId, runId }) => ({
    run: store.run(projectId, runId),
    events: store.runEvents(projectId, runId),
  }),
  runAdopt: async ({ projectId, runId, text, name }) => {
    const run = store.run(projectId, runId);
    if (!run.output) throw new Error("This run has no output.");
    const doc = store.addDocument(projectId, {
      name: name || `${workflows[run.workflow].title} — reviewed draft`,
      role: "notes",
      text: text || run.output,
    });
    store.audit(projectId, "run.output.adopted", {
      runId,
      documentId: doc.id,
      edited: doc.text !== run.output,
      sha256: doc.sha256,
    });
    return doc;
  },
  exportOutput: async ({ projectId, runId, format, text }) => {
    const run = store.run(projectId, runId);
    const content = typeof text === "string" ? text : run.output;
    if (!content) throw new Error("No output to export.");
    if (!["md", "docx", "txt", "zip", "pptx"].includes(format))
      throw new Error("Unknown export format.");
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${cleanName(store.project(projectId).name)}-${run.workflow}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (result.canceled) return false;
    await fs.promises.writeFile(
      result.filePath,
      format === "docx"
        ? await exportDocx(content)
        : format === "zip"
          ? markdownBundle(content)
          : format === "pptx"
            ? await exportPptx(content)
            : content,
      { mode: 0o600 },
    );
    store.audit(projectId, "run.output.exported", {
      runId,
      format,
      fileName: path.basename(result.filePath),
      edited: content !== run.output,
      sha256: hash(content),
    });
    return true;
  },
  exportAudit: async ({ projectId }) => {
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${cleanName(store.project(projectId).name)}-audit.json`,
      filters: [{ name: "Audit archive", extensions: ["json"] }],
    });
    if (result.canceled) return false;
    store.audit(projectId, "project.audit.exported", {
      fileName: path.basename(result.filePath),
    });
    await fs.promises.writeFile(
      result.filePath,
      JSON.stringify(store.export(projectId), null, 2),
      { mode: 0o600 },
    );
    return true;
  },
  revealProject: async ({ projectId }) => {
    shell.showItemInFolder(path.join(store.dir(projectId), "project.json"));
  },
  openExternal: async ({ url }) => {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol))
      throw new Error("Only web links can be opened.");
    await shell.openExternal(parsed.href);
  },
};
if (process.env.PAPER_WORKBENCH_DATA)
  app.setPath("userData", path.dirname(dataRoot));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    store = new Store(dataRoot);
    store.recover();
    codex = new Codex({
      binary: process.env.PAPER_WORKBENCH_CODEX || "codex",
      args: process.env.PAPER_WORKBENCH_CODEX_ARGS
        ? JSON.parse(process.env.PAPER_WORKBENCH_CODEX_ARGS)
        : undefined,
    });
    codex.on("notification", notification);
    codex.on("disconnected", (error) => {
      if (active) finish("failed", error);
      send("connectionError", error);
    });
    codex.on("protocolError", (message) => send("connectionError", message));
    ipcMain.handle("workbench:invoke", async (event, action, input = {}) => {
      if (event.sender !== win.webContents || !Object.hasOwn(handlers, action))
        throw new Error("Unsupported request.");
      return handlers[action](input);
    });
    win = new BrowserWindow({
      width: 1460,
      height: 960,
      minWidth: 480,
      minHeight: 480,
      title: "Paper Workbench",
      icon: path.join(__dirname, "icon.png"),
      icon: path.join(__dirname, "icon.png"),
      backgroundColor: "#ffffff",
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.loadFile(path.join(__dirname, "index.html"));
    win.on("close", (event) => {
      if (active || graphExecution) {
        const answer = dialog.showMessageBoxSync(win, {
          type: "question",
          buttons: ["Keep working", "Stop run and quit"],
          defaultId: 0,
          cancelId: 0,
          message: "A workflow is still running.",
          detail:
            "Quitting interrupts the run. Its audit trail and partial output will be preserved.",
        });
        if (answer === 0) event.preventDefault();
        else if (active) finish("interrupted", "Application closed by user.");
        else graphEnd("interrupted", "Application closed by user.");
      }
    });
    const checkpoint = setInterval(() => {
      if (active) store.saveRun(active.projectId, active.run);
    }, 1000);
    checkpoint.unref();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    if (active) finish("interrupted", "Application shut down.");
    if (graphExecution) graphEnd("interrupted", "Application shut down.");
    codex?.stop();
  });
}
