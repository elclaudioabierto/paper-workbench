const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { zipSync, unzipSync, strToU8, strFromU8 } = require("fflate");
const { Store } = require("./store.cjs");
const MAX_TOTAL = 512 * 1024 * 1024,
  MAX_ARCHIVE = MAX_TOTAL + 16 * 1024 * 1024,
  MAX_FILE = 128 * 1024 * 1024,
  MAX_FILES = 50000;
const digest = (data) => createHash("sha256").update(data).digest("hex");
const safePath = (name) =>
  typeof name === "string" &&
  name.length <= 512 &&
  name
    .split("/")
    .every(
      (part) =>
        part && part !== "." && part !== ".." && /^[a-zA-Z0-9._-]+$/.test(part),
    );
function createBackup(root) {
  const files = {},
    records = [];
  let total = 0;
  function walk(dir, relative = "") {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (!safePath(name))
        throw new Error(`Cannot back up an unsupported file name: ${name}`);
      const full = path.join(dir, item.name);
      if (item.isSymbolicLink())
        throw new Error(`Cannot back up symbolic links: ${name}`);
      if (item.isDirectory()) walk(full, name);
      else if (item.isFile()) {
        const size = fs.statSync(full).size;
        total += size;
        if (size > MAX_FILE || total > MAX_TOTAL || records.length >= MAX_FILES)
          throw new Error(
            "Library exceeds the backup size or file count limit.",
          );
        const bytes = fs.readFileSync(full);
        if (bytes.length !== size)
          throw new Error("A library file changed during backup. Try again.");
        files[`library/${name}`] = bytes;
        records.push({ path: name, size, sha256: digest(bytes) });
      } else throw new Error(`Cannot back up this file type: ${name}`);
    }
  }
  walk(root);
  files["manifest.json"] = strToU8(
    JSON.stringify({
      format: "paper-workbench-library",
      version: 1,
      createdAt: new Date().toISOString(),
      files: records,
    }),
  );
  const archive = zipSync(files, { level: 6 });
  if (archive.length > MAX_ARCHIVE)
    throw new Error("Backup archive exceeds the size limit.");
  return archive;
}
function readBackup(bytes) {
  if (bytes.length > MAX_ARCHIVE)
    throw new Error("Backup archive exceeds the size limit.");
  let total = 0,
    count = 0;
  const names = new Set();
  const files = unzipSync(bytes, {
    filter(entry) {
      const name = entry.name;
      if (!(
        name === "manifest.json" ||
        (name.startsWith("library/") && safePath(name.slice(8)))
      ))
        throw new Error("Backup contains an unsafe file path.");
      const key = name.toLowerCase();
      if (names.has(key))
        throw new Error("Backup contains duplicate file paths.");
      names.add(key);
      if (
        ++count > MAX_FILES + 1 ||
        entry.originalSize >
          (name === "manifest.json" ? 16 * 1024 * 1024 : MAX_FILE) ||
        (name !== "manifest.json" && (total += entry.originalSize) > MAX_TOTAL)
      )
        throw new Error("Backup exceeds the size or file count limit.");
      if (![0, 8].includes(entry.compression))
        throw new Error("Unsupported backup compression.");
      return true;
    },
  });
  if (!files["manifest.json"])
    throw new Error("This is not a Paper Workbench library backup.");
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(files["manifest.json"]));
  } catch {
    throw new Error("The backup manifest is invalid.");
  }
  if (
    manifest.format !== "paper-workbench-library" ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== count - 1
  )
    throw new Error("This backup format is invalid or unsupported.");
  const seen = new Set();
  for (const record of manifest.files) {
    if (
      !record ||
      !safePath(record.path) ||
      seen.has(record.path.toLowerCase())
    )
      throw new Error("Invalid backup manifest path.");
    seen.add(record.path.toLowerCase());
    const data = files[`library/${record.path}`];
    if (!data || data.length !== record.size || digest(data) !== record.sha256)
      throw new Error(`Backup file is missing or damaged: ${record.path}`);
  }
  return { files, manifest };
}
function prepareRestore(root, bytes) {
  const { files, manifest } = readBackup(bytes);
  const parent = path.dirname(root);
  fs.mkdirSync(parent, { recursive: true });
  const stage = fs.mkdtempSync(path.join(parent, ".paper-workbench-restore-"));
  try {
    fs.chmodSync(stage, 0o700);
    for (const record of manifest.files) {
      const target = path.join(stage, ...record.path.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
      fs.writeFileSync(target, files[`library/${record.path}`], {
        mode: 0o600,
        flag: "wx",
      });
    }
    const candidate = new Store(stage);
    const workflows = candidate.customWorkflows();
    if (!workflows || typeof workflows !== "object" || Array.isArray(workflows))
      throw new Error("Invalid custom workflow library.");
    for (const [id, workflow] of Object.entries(workflows)) {
      if (
        !/^custom-[a-f0-9-]{36}$/.test(id) ||
        !workflow ||
        workflow.custom !== true ||
        typeof workflow.title !== "string" ||
        typeof workflow.instruction !== "string" ||
        !Array.isArray(workflow.fields) ||
        workflow.fields.some(
          (field) =>
            !field ||
            typeof field.label !== "string" ||
            !Array.isArray(field.options) ||
            !field.options.length ||
            field.options.some((option) => typeof option !== "string"),
        )
      )
        throw new Error("Invalid custom workflow in backup.");
    }
    const projects = candidate.list();
    for (const project of projects) {
      if (
        !project ||
        typeof project.name !== "string" ||
        candidate.project(project.id).id !== project.id
      )
        throw new Error("Invalid project in backup.");
      if (!candidate.verify(project.id).valid)
        throw new Error(`Audit integrity check failed for ${project.name}.`);
      candidate.docs(project.id);
      candidate.runs(project.id);
      candidate.graph(project.id);
    }
    const actualDirs = fs.readdirSync(path.join(stage, "projects"));
    if (
      actualDirs.length !== projects.length ||
      projects.some((project) => !actualDirs.includes(project.id))
    )
      throw new Error("Backup contains incomplete projects.");
    return {
      stage,
      projectCount: projects.length,
      workflowCount: Object.keys(workflows).length,
    };
  } catch (error) {
    fs.rmSync(stage, { recursive: true, force: true });
    throw error;
  }
}
function applyRestore(root, stage) {
  const previous = `${root}-before-restore-${randomUUID()}`;
  const existed = fs.existsSync(root);
  if (existed) fs.renameSync(root, previous);
  try {
    fs.renameSync(stage, root);
  } catch (error) {
    if (existed) fs.renameSync(previous, root);
    throw error;
  }
  return existed ? previous : null;
}
module.exports = {
  createBackup,
  readBackup,
  prepareRestore,
  applyRestore,
  MAX_ARCHIVE,
};
