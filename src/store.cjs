const fs = require("node:fs");
const path = require("node:path");
const { randomUUID, createHash } = require("node:crypto");
const { instructionsUrl } = require("./workflows.cjs");
const hash = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const now = () => new Date().toISOString();
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function read(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function validateId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(id))
    throw new Error("Invalid identifier.");
  return id;
}
class Store {
  constructor(root) {
    this.root = root;
    fs.mkdirSync(path.join(root, "projects"), { recursive: true, mode: 0o700 });
  }
  dir(id) {
    return path.join(this.root, "projects", validateId(id));
  }
  project(id) {
    return read(path.join(this.dir(id), "project.json"));
  }
  list() {
    return fs
      .readdirSync(path.join(this.root, "projects"))
      .filter((id) => fs.existsSync(path.join(this.dir(id), "project.json")))
      .map((id) => this.project(id))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  audit(id, type, data = {}) {
    const events = this.events(id);
    const previousHash = events.at(-1)?.hash || null;
    const body = {
      sequence: events.length + 1,
      id: randomUUID(),
      at: now(),
      type,
      data,
      previousHash,
    };
    const event = { ...body, hash: hash(body) };
    const fd = fs.openSync(path.join(this.dir(id), "audit.jsonl"), "a", 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(event) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    return event;
  }
  events(id) {
    const file = path.join(this.dir(id), "audit.jsonl");
    return fs.existsSync(file)
      ? fs
          .readFileSync(file, "utf8")
          .split("\n")
          .filter(Boolean)
          .map(JSON.parse)
      : [];
  }
  verify(id) {
    let previousHash = null;
    const events = this.events(id);
    for (let i = 0; i < events.length; i++) {
      const { hash: digest, ...body } = events[i];
      if (
        body.previousHash !== previousHash ||
        body.sequence !== i + 1 ||
        hash(body) !== digest
      )
        return { valid: false, count: events.length, brokenAt: i + 1 };
      previousHash = digest;
    }
    return { valid: true, count: events.length, head: previousHash };
  }
  create(name) {
    if (typeof name !== "string" || !name.trim() || name.length > 200)
      throw new Error("Enter a project name (up to 200 characters).");
    const p = {
      id: randomUUID(),
      name: name.trim(),
      journal: "",
      authorInstructionsUrl: "",
      articleType: "Research article",
      createdAt: now(),
      updatedAt: now(),
    };
    atomic(path.join(this.dir(p.id), "project.json"), p);
    this.audit(p.id, "project.created", { project: p });
    return p;
  }
  update(id, input) {
    const p = this.project(id);
    for (const key of [
      "name",
      "journal",
      "articleType",
      "authorInstructionsUrl",
    ])
      if (typeof input[key] === "string") {
        if (input[key].length > 2000 || (key === "name" && !input[key].trim()))
          throw new Error("Invalid project settings.");
        p[key] =
          key === "authorInstructionsUrl"
            ? instructionsUrl(input[key])
            : input[key].trim();
      }
    p.updatedAt = now();
    atomic(path.join(this.dir(id), "project.json"), p);
    this.audit(id, "project.updated", { project: p });
    return p;
  }
  docs(id) {
    const dir = path.join(this.dir(id), "documents");
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((x) => x.endsWith(".json"))
      .map((x) => read(path.join(dir, x)));
  }
  document(id, docId) {
    return read(
      path.join(this.dir(id), "documents", `${validateId(docId)}.json`),
    );
  }
  addDocument(id, input) {
    this.project(id);
    if (!["manuscript", "reviews", "guidelines", "notes"].includes(input.role))
      throw new Error("Invalid document role.");
    if (typeof input.text !== "string" || !input.text.trim())
      throw new Error(
        "The document has no extractable text. Scanned PDFs need OCR first.",
      );
    if (input.text.length > 2000000)
      throw new Error("Document exceeds 2 million characters.");
    const d = {
      id: randomUUID(),
      name: String(input.name || "Untitled document").slice(0, 200),
      role: input.role,
      text: input.text,
      version: 1,
      createdAt: now(),
      updatedAt: now(),
      sha256: hash(input.text),
      sourceName: input.sourceName || null,
      sourceSha256: input.sourceSha256 || null,
    };
    atomic(path.join(this.dir(id), "documents", `${d.id}.json`), d);
    atomic(path.join(this.dir(id), "versions", d.id, "1.json"), d);
    this.audit(id, "document.added", {
      documentId: d.id,
      name: d.name,
      role: d.role,
      version: 1,
      sha256: d.sha256,
      sourceSha256: d.sourceSha256,
    });
    return d;
  }
  saveDocument(id, docId, input) {
    const d = this.document(id, docId);
    if (
      typeof input.text !== "string" ||
      !input.text.trim() ||
      input.text.length > 2000000
    )
      throw new Error("Document text must contain 1–2,000,000 characters.");
    const previousVersion = d.version;
    d.text = input.text;
    if (typeof input.name === "string") d.name = input.name.slice(0, 200);
    if (["manuscript", "reviews", "guidelines", "notes"].includes(input.role))
      d.role = input.role;
    d.version++;
    d.updatedAt = now();
    d.sha256 = hash(d.text);
    atomic(path.join(this.dir(id), "versions", d.id, `${d.version}.json`), d);
    atomic(path.join(this.dir(id), "documents", `${d.id}.json`), d);
    this.audit(id, "document.version.saved", {
      documentId: d.id,
      previousVersion,
      version: d.version,
      sha256: d.sha256,
    });
    return d;
  }
  runs(id) {
    const dir = path.join(this.dir(id), "runs");
    return fs.existsSync(dir)
      ? fs
          .readdirSync(dir)
          .filter((x) => x.endsWith(".json"))
          .map((x) => read(path.join(dir, x)))
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      : [];
  }
  run(id, runId) {
    return read(path.join(this.dir(id), "runs", `${validateId(runId)}.json`));
  }
  createRun(id, data) {
    const run = {
      ...data,
      id: randomUUID(),
      status: "starting",
      startedAt: now(),
      finishedAt: null,
      output: "",
      threadId: null,
      turnId: null,
      error: null,
    };
    atomic(path.join(this.dir(id), "runs", `${run.id}.json`), run);
    this.audit(id, "run.requested", {
      runId: run.id,
      workflow: run.workflow,
      workflowVersion: run.workflowVersion,
      model: run.model,
      sourceDocuments: run.sourceDocuments,
      promptSha256: hash(run.prompt),
      settings: run.settings,
      parentRunId: run.parentRunId || null,
    });
    return run;
  }
  saveRun(id, run) {
    atomic(path.join(this.dir(id), "runs", `${validateId(run.id)}.json`), run);
  }
  appendRunEvent(id, runId, method, params) {
    const dir = path.join(this.dir(id), "run-events");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      path.join(dir, `${validateId(runId)}.jsonl`),
      JSON.stringify({ at: now(), method, params }) + "\n",
      { mode: 0o600 },
    );
  }
  runEvents(id, runId) {
    const f = path.join(
      this.dir(id),
      "run-events",
      `${validateId(runId)}.jsonl`,
    );
    return fs.existsSync(f)
      ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(JSON.parse)
      : [];
  }
  finishRun(id, run, status, error) {
    if (run.finishedAt) return run;
    run.status = status;
    run.error = error || null;
    run.finishedAt = now();
    run.outputSha256 = hash(run.output);
    const eventFile = path.join(
      this.dir(id),
      "run-events",
      `${validateId(run.id)}.jsonl`,
    );
    run.eventsSha256 = hash(
      fs.existsSync(eventFile) ? fs.readFileSync(eventFile, "utf8") : "",
    );
    this.saveRun(id, run);
    this.audit(id, `run.${status}`, {
      runId: run.id,
      threadId: run.threadId,
      turnId: run.turnId,
      outputSha256: run.outputSha256,
      eventsSha256: run.eventsSha256,
      error: run.error,
    });
    return run;
  }
  recover() {
    for (const p of this.list())
      for (const r of this.runs(p.id))
        if (["starting", "running"].includes(r.status))
          this.finishRun(
            p.id,
            r,
            "interrupted",
            "The application closed before this run finished.",
          );
  }
  export(id) {
    return {
      format: "paper-workbench-audit-v1",
      exportedAt: now(),
      project: this.project(id),
      documents: this.docs(id),
      versions: this.docs(id).flatMap((d) =>
        fs
          .readdirSync(path.join(this.dir(id), "versions", d.id))
          .filter((f) => f.endsWith(".json"))
          .map((f) => read(path.join(this.dir(id), "versions", d.id, f))),
      ),
      runs: this.runs(id).map((r) => ({
        ...r,
        events: this.runEvents(id, r.id),
      })),
      audit: this.events(id),
      integrity: this.verify(id),
    };
  }
}
module.exports = { Store, hash, atomic, validateId };
