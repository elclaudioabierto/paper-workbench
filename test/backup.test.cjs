const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { zipSync, strToU8, unzipSync, strFromU8 } = require("fflate");
const { Store } = require("../src/store.cjs");
const {
  createBackup,
  readBackup,
  prepareRestore,
  applyRestore,
} = require("../src/backup.cjs");
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "paper-backup-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
test("library ZIP restores projects, versions, audit, graph, runs and custom workflows while keeping the prior library", (t) => {
  const dir = fixture(t),
    root = path.join(dir, "library");
  const store = new Store(root),
    project = store.create("Example");
  const custom = store.saveCustomWorkflow({
    title: "My workflow",
    instruction: "Summarize.",
    fields: [],
  });
  const doc = store.addDocument(project.id, {
    name: "Paper",
    role: "manuscript",
    text: "Original paper.",
  });
  store.saveDocument(project.id, doc.id, {
    name: "Paper",
    role: "manuscript",
    text: "Revised paper.",
  });
  store.saveGraph(project.id, {
    nodes: [{ id: "one", workflow: custom.id }],
    edges: [],
  });
  const run = store.createRun(project.id, {
    workflow: custom.id,
    workflowVersion: "custom-1",
    model: "model",
    sourceDocuments: [],
    prompt: "Exact prompt",
  });
  run.output = "Result";
  store.finishRun(project.id, run, "completed");
  const backup = createBackup(root);
  store.create("Newer local project");
  const prepared = prepareRestore(root, backup);
  assert.equal(prepared.projectCount, 1);
  assert.equal(prepared.workflowCount, 1);
  const previous = applyRestore(root, prepared.stage);
  const restored = new Store(root);
  assert.deepEqual(
    restored.list().map((p) => p.name),
    ["Example"],
  );
  assert.equal(restored.document(project.id, doc.id).text, "Revised paper.");
  assert.equal(
    JSON.parse(
      fs.readFileSync(
        path.join(root, "projects", project.id, "versions", doc.id, "1.json"),
      ),
    ).text,
    "Original paper.",
  );
  assert.equal(restored.run(project.id, run.id).output, "Result");
  assert.equal(restored.graph(project.id).nodes[0].workflow, custom.id);
  assert.equal(restored.customWorkflows()[custom.id].title, "My workflow");
  assert.equal(restored.verify(project.id).valid, true);
  assert.equal(new Store(previous).list().length, 2);
});
test("rejects unsafe, altered and incomplete backups before touching the library", (t) => {
  const dir = fixture(t),
    root = path.join(dir, "library");
  const store = new Store(root),
    project = store.create("Keep me");
  const original = createBackup(root);
  const traversal = zipSync({
    "library/../../outside": strToU8("evil"),
    "manifest.json": strToU8("{}"),
  });
  assert.throws(() => prepareRestore(root, traversal), /unsafe/);
  const entries = unzipSync(original);
  entries[`library/projects/${project.id}/project.json`] =
    strToU8('{"name":"changed"}');
  assert.throws(() => prepareRestore(root, zipSync(entries)), /damaged/);
  const manifest = JSON.parse(strFromU8(entries["manifest.json"]));
  manifest.version = 99;
  entries["manifest.json"] = strToU8(JSON.stringify(manifest));
  assert.throws(() => readBackup(zipSync(entries)), /unsupported/);
  assert.equal(new Store(root).project(project.id).name, "Keep me");
  assert.equal(fs.existsSync(path.join(dir, "outside")), false);
});
test("rejects a backup with an invalid audit chain even when its file hashes match", (t) => {
  const dir = fixture(t),
    root = path.join(dir, "library");
  const store = new Store(root),
    project = store.create("Example");
  const auditFile = path.join(root, "projects", project.id, "audit.jsonl");
  const event = JSON.parse(fs.readFileSync(auditFile, "utf8"));
  event.data.project.name = "Tampered";
  fs.writeFileSync(auditFile, JSON.stringify(event) + "\n");
  assert.throws(
    () => prepareRestore(root, createBackup(root)),
    /Audit integrity/,
  );
});
test(
  "refuses symbolic links in a library backup",
  { skip: process.platform === "win32" },
  (t) => {
    const dir = fixture(t),
      root = path.join(dir, "library");
    new Store(root);
    fs.symlinkSync(dir, path.join(root, "external"));
    assert.throws(() => createBackup(root), /symbolic links/);
  },
);
