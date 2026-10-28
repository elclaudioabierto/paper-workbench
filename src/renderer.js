"use strict";
const api = (action, input) => window.workbench.invoke(action, input);
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (value) =>
  new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
const words = (text) => (text.trim().match(/\S+/g) || []).length;
const icons = {
  journal: "⌕",
  abstract: "Aa",
  revision: "≡",
  rewrite: "↗",
  markdown: "M↓",
  presentation: "▰",
  letter: "L",
  preflight: "✓",
};
const state = {
  projects: [],
  workflows: {},
  project: null,
  documents: [],
  runs: [],
  audit: [],
  view: "overview",
  workflow: "abstract",
  runId: null,
  selected: new Set(),
  models: [],
  account: null,
  authError: null,
  active: null,
  activity: "",
  drafts: {},
  outputEdits: {},
  model: localStorage.getItem("model") || "",
  effort: localStorage.getItem("effort") || "medium",
  device: null,
};
let toastTimer, refreshTimer;
function toast(message, error = false) {
  const el = $("#toast");
  el.textContent = message;
  el.className = `visible${error ? " error" : ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ""), error ? 9000 : 4500);
}
function status(run) {
  return `<span class="status ${esc(run.status)}">${esc(run.status)}</span>`;
}
function showModal(html) {
  const modal = $("#modal");
  modal.innerHTML = `<div class="modal-body">${html}</div>`;
  if (!modal.open) modal.showModal();
}
function closeModal() {
  $("#modal").close();
}
function field(label, id, value = "", extra = "") {
  return `<label for="${id}">${label}</label><input id="${id}" value="${esc(value)}" ${extra}>`;
}
function roleOptions(value) {
  return [
    ["manuscript", "Manuscript"],
    ["reviews", "Reviewer comments"],
    ["guidelines", "Journal guidelines"],
    ["notes", "Notes / supporting material"],
  ]
    .map(
      ([id, label]) =>
        `<option value="${id}" ${value === id ? "selected" : ""}>${label}</option>`,
    )
    .join("");
}
function currentRun() {
  return state.runs.find((r) => r.id === state.runId);
}
function draft() {
  const key = `${state.project?.id}:${state.workflow}`;
  return (state.drafts[key] ||= {
    instructions: "",
    wordLimit: 250,
    structure: "Journal appropriate",
    letterType: "Response to reviewers",
    recipient: "",
    authorInstructionsUrl: state.project?.authorInstructionsUrl || "",
  });
}
function readDraft() {
  const d = draft();
  if ($("#instructions")) d.instructions = $("#instructions").value;
  if ($("#word-limit")) d.wordLimit = Number($("#word-limit").value);
  if ($("#structure")) d.structure = $("#structure").value;
  if ($("#author-url")) d.authorInstructionsUrl = $("#author-url").value;
  if ($("#letter-type")) d.letterType = $("#letter-type").value;
  if ($("#letter-recipient")) d.recipient = $("#letter-recipient").value;
}
function render() {
  const p = state.project;
  $("#app").innerHTML =
    `<div class="layout"><aside class="sidebar"><div class="brand"><div class="brand-mark">p</div><span>Paper Workbench</span></div><button data-action="navigate" data-view="overview" class="${state.view === "overview" ? "active" : ""}"><span>◫</span> Workbench</button><button data-action="navigate" data-view="documents" class="${state.view === "documents" ? "active" : ""}" ${!p ? "disabled" : ""}><span>▤</span> Documents</button><button data-action="navigate" data-view="history" class="${state.view === "history" ? "active" : ""}" ${!p ? "disabled" : ""}><span>◷</span> Run history</button><button data-action="navigate" data-view="audit" class="${state.view === "audit" ? "active" : ""}" ${!p ? "disabled" : ""}><span>☷</span> Audit trail</button><div class="sidebar-label">Your projects</div><div class="project-list">${state.projects.map((x) => `<button data-action="open-project" data-id="${x.id}" class="${p?.id === x.id ? "active" : ""}" title="${esc(x.name)}">${esc(x.name)}</button>`).join("")}</div><button class="new-project" data-action="new-project">＋ New project</button><div class="sidebar-bottom"><button data-action="navigate" data-view="settings" class="${state.view === "settings" ? "active" : ""}"><span class="account-dot ${state.account ? "online" : ""}"></span> ${state.account ? "Codex connected" : "Connect Codex"} <span>↗</span></button><div class="sidebar-footnote">Local projects. Traceable work.<br>Paper Workbench · v${esc(state.version)}</div></div></aside><main class="main"><header class="topbar"><div class="breadcrumb"><span>Library</span><span>/</span><strong>${esc(p?.name || "Your next paper starts here")}</strong>${state.view === "workflow" ? `<span>/</span><span>${esc(state.workflows[state.workflow].title)}</span>` : ""}</div><div class="actions">${state.active ? '<button class="small" data-action="active-run">◌ Workflow running</button>' : ""}<span class="pill">${p ? "Project saved locally" : "Your research, in focus"}</span>${p ? '<button class="small secondary" data-action="project-settings" title="Project settings">Project settings</button>' : ""}</div></header><section class="content">${viewHTML()}</section></main></div>`;
  if (state.view === "workflow") renderOutput();
}
function viewHTML() {
  if (state.view === "settings") return settingsHTML();
  if (!state.project) return onboardingHTML();
  if (state.view === "documents") return documentsHTML();
  if (state.view === "history") return historyHTML();
  if (state.view === "audit") return auditHTML();
  if (state.view === "workflow") return workflowHTML();
  if (state.view === "run-detail") return detailHTML();
  return overviewHTML();
}
function onboardingHTML() {
  return `<div class="onboarding"><div class="eyebrow">From first draft to final response</div><h1>Papers.<br>Work in progress.</h1><div class="intro"><p>Manuscripts, eight workflows, and a complete record of what you ran.</p><button class="primary" data-action="new-project">Create your first project ↗</button></div><div class="grid">${Object.entries(
    state.workflows,
  )
    .map(([id, w], i) => card(id, w, i, true))
    .join(
      "",
    )}</div><p class="help onboarding-note">Connect your Codex account in Settings. Manuscripts stay in your local library; selected source text is sent to Codex when you run a workflow.</p></div>`;
}
function card(id, w, i, disabled = false) {
  return `<button class="workflow-card" data-action="workflow" data-id="${id}" ${disabled ? "disabled" : ""}><div class="card-top"><span class="workflow-icon">${icons[id]}</span><span class="card-number">0${i + 1} / WORKFLOW</span></div><h2>${esc(w.title)}</h2><p>${esc(w.description)}</p><span class="arrow">↗</span></button>`;
}
function overviewHTML() {
  const p = state.project;
  return `<div class="intro"><div class="eyebrow">Project workspace</div><h1>Manuscript workbench.</h1><p>Choose a workflow. Every run is saved with its sources and output.</p></div><div class="stats"><span><strong>${state.documents.length}</strong> source documents</span><span><strong>${state.runs.length}</strong> workflow runs</span><span>Target: <strong>${esc(p.journal || "Not selected yet")}</strong></span></div>${!state.documents.length ? '<div class="note">Start by adding your manuscript. You can also include reviewer comments, journal guidelines, and supporting notes. <button class="text-button" data-action="navigate" data-view="documents">Add documents ↗</button></div>' : ""}<div class="grid">${Object.entries(
    state.workflows,
  )
    .map(([id, w], i) => card(id, w, i))
    .join(
      "",
    )}</div><div class="section-title"><h3>Recent work</h3><button class="text-button" data-action="navigate" data-view="history">View all runs ↗</button></div>${state.runs.length ? state.runs.slice(0, 4).map(runRow).join("") : '<div class="empty"><p>Your first workflow will appear here, together with its sources and results.</p></div>'}`;
}
function runRow(r) {
  return `<button class="run-row" data-action="run-detail" data-id="${r.id}"><div><strong>${esc(state.workflows[r.workflow]?.title || r.workflow)}</strong><small>${date(r.startedAt)} · ${esc(r.resolvedModel || r.model)} · ${r.sourceDocuments.length} source${r.sourceDocuments.length === 1 ? "" : "s"}</small></div>${status(r)}</button>`;
}
function documentsHTML() {
  return `<div class="heading-row"><div><div class="eyebrow">The source of truth</div><h1>Project documents</h1><p class="muted">Import a file or paste text. Every save creates a version.</p></div><div class="actions"><button data-action="import-dialog">Import files</button><button class="primary" data-action="new-document">＋ Paste text</button></div></div><div class="document-grid">${state.documents.map((d) => `<div class="doc-card"><div class="file-icon">▤</div><div><h3>${esc(d.name)}</h3><p>${esc({ manuscript: "Manuscript", reviews: "Reviewer comments", guidelines: "Journal guidelines", notes: "Supporting notes" }[d.role])} · ${words(d.text).toLocaleString()} words · Version ${d.version} · ${date(d.updatedAt)}</p></div><div class="actions"><button class="small" data-action="versions" data-id="${d.id}">Versions</button><button class="small" data-action="edit-document" data-id="${d.id}">Open</button></div></div>`).join("") || '<div class="empty"><h2>Add source documents.</h2><p>Add DOCX, PDF, Markdown, or plain-text files. Include the manuscript and any materials you want Codex to consider.</p><button class="primary" data-action="import-dialog">Import your manuscript</button></div>'}</div><div class="note">DOCX and PDF imports extract text; original layout, figures, comments, and tracked changes are not preserved. Review the extracted text before running. Scanned PDFs need OCR. Source-file hashes and every text version are recorded.</div>`;
}
function workflowHTML() {
  const w = state.workflows[state.workflow],
    d = draft(),
    runs = state.runs.filter((r) => r.workflow === state.workflow);
  return `<div class="heading-row"><div><div class="eyebrow">${esc(w.eyebrow)}</div><h1>${esc(w.title)}</h1><p class="muted">${esc(w.description)}</p></div><button class="small secondary" data-action="navigate" data-view="overview">← All workflows</button></div><div class="workspace-grid"><div class="panel workflow-form"><h3>Source documents</h3><p class="help">Only selected text versions are sent to Codex.</p>${state.documents.map((doc) => `<label class="doc-select"><input type="checkbox" data-document="${doc.id}" ${state.selected.has(doc.id) ? "checked" : ""}><span>${esc(doc.name)}<br><small>${esc(doc.role)} · v${doc.version} · ${words(doc.text).toLocaleString()} words</small></span></label>`).join("") || '<button class="small" data-action="navigate" data-view="documents">Add a manuscript ↗</button>'}${state.workflow === "abstract" ? `<div class="inline-fields">${field("Word limit", "word-limit", d.wordLimit, 'type="number" min="50" max="3000"')}<div><label for="structure">Structure</label><select id="structure">${["Journal appropriate", "Structured", "Unstructured"].map((s) => `<option ${d.structure === s ? "selected" : ""}>${s}</option>`).join("")}</select></div></div>` : ""}${preflightFields(d)}${letterFields(d)}<label for="instructions">${state.workflow === "revision" ? "Revision priorities" : state.workflow === "rewrite" ? "Scope & rewrite instructions" : state.workflow === "journal" ? "Journal preferences & constraints" : "Additional instructions"}</label><textarea id="instructions" rows="5" placeholder="${state.workflow === "journal" ? "e.g. Digital health audience, no mandatory APC, accepts observational research" : state.workflow === "rewrite" ? "e.g. Rewrite the introduction and discussion; preserve all citation markers" : state.workflow === "revision" ? "e.g. Prioritize Reviewer 2’s concerns about causal language" : "e.g. Emphasize the clinical implications; use cautious language"}">${esc(d.instructions)}</textarea><label for="run-model">Model</label><select id="run-model">${modelOptions()}</select><label for="run-effort">Reasoning effort</label><select id="run-effort">${effortOptions()}</select><div class="run-controls"><span class="help">${state.account ? "Connected to Codex" : "Sign in under Settings"}</span><button class="primary" data-action="start-run" ${state.active || !state.account || !state.documents.length ? "disabled" : ""}>Run workflow ↗</button></div><p class="help">A new run preserves its prompt, sources, settings, events, and result. ${["journal", "preflight"].includes(state.workflow) ? "Live web access is enabled for journal requirements." : ""}</p></div><div class="panel output-panel"><div class="output-toolbar"><h3>Working draft</h3><select class="run-picker" id="run-picker"><option value="">${runs.length ? "Choose a run" : "No runs yet"}</option>${runs.map((r) => `<option value="${r.id}" ${r.id === state.runId ? "selected" : ""}>${date(r.startedAt)} · ${r.status}</option>`).join("")}</select></div><div id="output-area"></div><div class="output-footer">Generated work needs your review. Original run outputs remain unchanged; reviewed drafts can be saved as project documents.</div></div></div>`;
}
function preflightFields(d) {
  if (state.workflow !== "preflight") return "";
  return `${field("Journal author-instructions URL", "author-url", d.authorInstructionsUrl || "", 'type="url" placeholder="https://journal.example/author-instructions"')}<p class="help">Codex opens this page and cites the requirements it checks. Inaccessible pages and requirements that cannot be checked from extracted text stay unverified. You can also select an imported guidelines document.</p>`;
}
function letterFields(d) {
  if (state.workflow !== "letter") return "";
  return `<label for="letter-type">Letter type</label><select id="letter-type">${["Editor cover letter", "Response to reviewers", "Resubmission letter to editor"].map((type) => `<option ${type === (d.letterType || "Response to reviewers") ? "selected" : ""}>${type}</option>`).join("")}</select>${field(
    "Recipient (optional)",
    "letter-recipient",
    d.recipient || "",
    'placeholder="e.g. Dr. Smith, Editor"',
  )}<p class="help">Include reviews and revision notes for a response or resubmission letter. Unverified declarations and changes stay as author-confirmation placeholders.</p>`;
}
function modelOptions() {
  return state.models.length
    ? state.models
        .map(
          (m) =>
            `<option value="${esc(m.model)}" ${m.model === state.model ? "selected" : ""}>${esc(m.displayName || m.model)}</option>`,
        )
        .join("")
    : '<option value="">Connect Codex to load models</option>';
}
function effortOptions() {
  const model = state.models.find((m) => m.model === state.model);
  const efforts = model?.supportedReasoningEfforts?.map(
    (e) => e.reasoningEffort,
  ) || ["low", "medium", "high"];
  return efforts
    .map(
      (e) =>
        `<option value="${esc(e)}" ${state.effort === e ? "selected" : ""}>${esc(e)}</option>`,
    )
    .join("");
}
function markdown(text) {
  if (window.markdownit && window.DOMPurify) {
    const md = window.markdownit({ html: false, linkify: true, breaks: false });
    md.renderer.rules.image = (tokens, index) =>
      `<div class="figure-placeholder"><span>▧</span><p>${esc(tokens[index].content || "Figure placeholder")}</p><small>${esc(tokens[index].attrGet("src") || "")}</small></div>`;
    return window.DOMPurify.sanitize(md.render(text));
  }
  return `<pre>${esc(text)}</pre>`;
}
function renderOutput() {
  const el = $("#output-area");
  if (!el) return;
  const r = currentRun();
  if (!r) {
    el.innerHTML =
      '<div class="output-empty"><div class="glyph">¶</div><h2>Workflow output.</h2><p>Choose your sources and run the workflow. The output will appear here as Codex works.</p></div>';
    return;
  }
  const running = ["starting", "running"].includes(r.status);
  el.innerHTML = `${running ? `<div class="activity">◌ ${esc(state.activity || "Codex is working…")} <button class="text-button" data-action="cancel-run" data-id="${r.id}">Stop run</button></div>` : ""}${r.error ? `<div class="error-box">${esc(r.error)}</div>` : ""}<div class="output-body">${r.output ? markdown(r.output) : '<p class="muted">Waiting for output…</p>'}</div><div class="output-toolbar"><div class="actions">${status(r)}<button class="small" data-action="run-detail" data-id="${r.id}">Run details</button></div><div class="actions"><button class="small" data-action="review-output" data-id="${r.id}" ${!r.output ? "disabled" : ""}>Review & save</button><button class="small" data-action="export-output" data-id="${r.id}" ${!r.output ? "disabled" : ""}>Export ↗</button></div></div>`;
}
function historyHTML() {
  return `<div class="heading-row"><div><div class="eyebrow">Every attempt, in context</div><h1>Run history</h1><p class="muted">Successful, failed, and stopped runs all have a place here.</p></div><button class="small" data-action="export-audit">Export full archive ↗</button></div>${state.runs.map(runRow).join("") || '<div class="empty"><h2>No runs yet.</h2><p>Choose a workflow from your workbench to get started.</p></div>'}`;
}
function auditHTML() {
  const v = state.integrity;
  return `<div class="heading-row"><div><div class="eyebrow">A record you can inspect</div><h1>Project audit trail</h1><p class="muted">Source changes, workflow runs, saved drafts, and exports.</p></div><button data-action="export-audit">Export audit archive ↗</button></div><div class="integrity ${v?.valid ? "" : "bad"}">${v?.valid ? "✓ Hash chain verified" : "! Audit integrity check failed"} · ${v?.count || 0} events</div><p class="help">Events form a local SHA-256 hash chain. This detects changes within the recorded chain; it is not an externally signed or tamper-proof record. The export includes document versions, exact prompts, outputs, and observable Codex events.</p>${[
    ...state.audit,
  ]
    .reverse()
    .map(
      (e) =>
        `<div class="audit-event"><span class="audit-seq">${e.sequence}</span><div><strong>${esc(e.type.replaceAll(".", " / "))}</strong><p>${esc(e.data.name || e.data.project?.name || (e.data.workflow ? state.workflows[e.data.workflow]?.title : "") || e.data.runId || e.data.documentId || "")}</p><details><summary>Event payload & hash</summary><pre>${esc(JSON.stringify(e, null, 2))}</pre></details></div><time>${date(e.at)}</time></div>`,
    )
    .join("")}`;
}
function detailHTML() {
  const r = currentRun();
  if (!r) return '<div class="empty">Run not found.</div>';
  return `<div class="heading-row"><div><div class="eyebrow">Run record</div><h1>${esc(state.workflows[r.workflow]?.title)}</h1>${status(r)}</div><div class="actions"><button class="small" data-action="open-run-workflow" data-id="${r.id}">Open output</button><button class="small" data-action="rerun" data-id="${r.id}">Use as new run</button></div></div><div class="panel"><div class="detail-meta">${[
    ["Run ID", r.id],
    ["Started", date(r.startedAt)],
    ["Finished", r.finishedAt ? date(r.finishedAt) : "In progress"],
    ["Model", r.resolvedModel || r.model],
    ["Reasoning effort", r.effort],
    ["Workflow version", r.workflowVersion],
    ["Codex thread", r.threadId || "Not started"],
    ["Codex turn", r.turnId || "Not started"],
  ]
    .map(([k, v]) => `<div><span>${k}</span>${esc(v)}</div>`)
    .join(
      "",
    )}</div>${r.error ? `<div class="error-box">${esc(r.error)}</div>` : ""}<h3>Source snapshots</h3>${r.sourceDocuments.map((d) => `<p class="help">${esc(d.name)} · version ${d.version}<br>SHA-256: ${esc(d.sha256)}</p>`).join("")}<details><summary>Exact prompt sent to Codex</summary><pre>${esc(r.prompt)}</pre></details><details><summary>Settings & token usage</summary><pre>${esc(JSON.stringify({ settings: r.settings, execution: r.execution, tokenUsage: r.tokenUsage, codexVersion: r.codexVersion, parentRunId: r.parentRunId }, null, 2))}</pre></details><details><summary>Observable Codex events (${state.detailEvents?.length || 0})</summary><pre>${esc(JSON.stringify(state.detailEvents || [], null, 2))}</pre></details><details><summary>Original output</summary><pre>${esc(r.output)}</pre></details></div>`;
}
function settingsHTML() {
  return `<div class="intro"><div class="eyebrow">Configuration</div><h1>Settings & connection</h1><p>Use your Codex account and keep project files on this machine.</p></div><div class="settings-grid"><div class="panel"><h2>Codex account</h2>${state.account ? `<div class="integrity">✓ Signed in ${state.account.email ? `as ${esc(state.account.email)}` : ""}<br>${esc(state.account.planType || state.account.type || "")}</div><button data-action="logout">Sign out</button>` : `<p class="help">Sign in with a device code. Codex manages credentials and token refresh. Your access token is never sent to this interface.</p>${state.authError ? `<div class="error-box">${esc(state.authError)}</div>` : ""}<button class="primary" data-action="login">Sign in with Codex ↗</button>`}${state.device ? `<div class="device-code">${esc(state.device.userCode)}</div><p class="help">Open the verification page and enter this code. Waiting for approval…</p><div class="actions"><button data-action="open-device">Open verification page ↗</button><button data-action="cancel-login">Cancel</button></div>` : ""}<p class="help">Requires the Codex CLI on PATH. This app uses the CLI’s managed account, so sign-in/sign-out can affect other local Codex clients.</p><button class="text-button" data-action="refresh-account">Refresh connection ↻</button></div><div class="panel"><h2>Model & reasoning</h2><label for="settings-model">Default model</label><select id="settings-model">${modelOptions()}</select><label for="settings-effort">Default reasoning effort</label><select id="settings-effort">${effortOptions()}</select><p class="help">Models are discovered from your Codex account. Each run records the selected model and effort.</p><h3>Local library</h3><p class="help">${esc(state.dataRoot)}</p><p class="help">Projects and audit archives contain manuscript text. Selected documents and instructions are transmitted to Codex when you run a workflow. Journal selection also uses web search.</p></div></div>`;
}
async function openProject(id) {
  const data = await api("projectOpen", { projectId: id });
  Object.assign(state, data);
  state.selected = new Set(data.documents.map((d) => d.id));
  localStorage.setItem("project", id);
  state.runId = null;
  state.view = "overview";
  render();
}
async function refreshProject() {
  if (!state.project) return;
  const data = await api("projectOpen", { projectId: state.project.id });
  Object.assign(state, data);
  state.projects = state.projects.map((p) =>
    p.id === data.project.id ? data.project : p,
  );
}
async function refreshAccount() {
  try {
    const result = await api("account");
    state.account = result.account;
    state.authError = null;
    if (state.account) {
      state.models = await api("models");
      if (!state.models.some((m) => m.model === state.model))
        state.model =
          (state.models.find((m) => m.isDefault) || state.models[0])?.model ||
          "";
      normalizeEffort();
    }
  } catch (e) {
    state.authError = e.message;
    state.account = null;
  }
}
function normalizeEffort() {
  const model = state.models.find((m) => m.model === state.model);
  const options = model?.supportedReasoningEfforts?.map(
    (e) => e.reasoningEffort,
  );
  if (options?.length && !options.includes(state.effort))
    state.effort = model.defaultReasoningEffort || options[0];
  localStorage.setItem("model", state.model);
  localStorage.setItem("effort", state.effort);
}
async function showRun(id) {
  const { run, events } = await api("runDetail", {
    projectId: state.project.id,
    runId: id,
  });
  state.runs = state.runs.map((r) => (r.id === id ? run : r));
  state.runId = id;
  state.detailEvents = events;
  state.view = "run-detail";
  render();
}
function documentModal(doc) {
  showModal(
    `<h2>${doc ? "Edit document" : "Add a document"}</h2><p class="help">${doc ? "Saving creates a new version. Previous versions and run sources remain available." : "Paste manuscript text, reviewer comments, journal requirements, or supporting notes."}</p>${field("Document name", "doc-name", doc?.name || "")}<label for="doc-role">Document role</label><select id="doc-role">${roleOptions(doc?.role || "manuscript")}</select><label for="doc-text">Document text</label><textarea class="wide-editor" id="doc-text">${esc(doc?.text || "")}</textarea><div class="modal-footer"><button data-action="close-modal">Cancel</button><button class="primary" data-action="save-document" data-id="${doc?.id || ""}">${doc ? "Save new version" : "Add document"}</button></div>`,
  );
}
const actions = {
  navigate: async (el) => {
    readDraft();
    state.view = el.dataset.view;
    if (["audit", "history"].includes(state.view)) await refreshProject();
    render();
  },
  "new-project": () =>
    showModal(
      `<div class="eyebrow">New project</div><h2>Create a manuscript project</h2><p class="help">A local home for your sources, workflow results, and audit trail.</p>${field("Project name", "project-name", "", 'placeholder="e.g. Digital wellbeing and daily routines" maxlength="200" autofocus')}<div class="modal-footer"><button data-action="close-modal">Cancel</button><button class="primary" data-action="create-project">Create project ↗</button></div>`,
    ),
  "create-project": async () => {
    const p = await api("projectCreate", { name: $("#project-name").value });
    state.projects.unshift(p);
    closeModal();
    await openProject(p.id);
  },
  "open-project": async (el) => {
    readDraft();
    await openProject(el.dataset.id);
  },
  "close-modal": closeModal,
  "project-settings": () =>
    showModal(
      `<h2>Project settings</h2>${field("Project name", "edit-project-name", state.project.name)}${field("Target journal", "target-journal", state.project.journal, 'placeholder="Optional — use journal selection to explore"')}${field("Author-instructions URL", "project-author-url", state.project.authorInstructionsUrl || "", 'type="url" placeholder="https://journal.example/author-instructions"')}${field("Article type", "article-type", state.project.articleType)}<div class="modal-footer"><button data-action="close-modal">Cancel</button><button class="primary" data-action="save-project">Save settings</button></div>`,
    ),
  "save-project": async () => {
    await api("projectUpdate", {
      projectId: state.project.id,
      name: $("#edit-project-name").value,
      journal: $("#target-journal").value,
      articleType: $("#article-type").value,
      authorInstructionsUrl: $("#project-author-url").value,
    });
    await refreshProject();
    closeModal();
    render();
    toast("Project settings saved.");
  },
  "new-document": () => documentModal(),
  "edit-document": (el) =>
    documentModal(state.documents.find((d) => d.id === el.dataset.id)),
  "save-document": async (el) => {
    const input = {
      projectId: state.project.id,
      name: $("#doc-name").value,
      role: $("#doc-role").value,
      text: $("#doc-text").value,
    };
    const d = await api(
      el.dataset.id ? "documentSave" : "documentAdd",
      el.dataset.id ? { ...input, documentId: el.dataset.id } : input,
    );
    state.selected.add(d.id);
    await refreshProject();
    closeModal();
    render();
    toast(`Document saved as version ${d.version}.`);
  },
  "import-dialog": () =>
    showModal(
      `<h2>Import project documents</h2><p class="help">DOCX, PDF, Markdown, and plain text. Multiple files can be imported together.</p><label for="import-role">Document role</label><select id="import-role">${roleOptions(state.documents.some((d) => d.role === "manuscript") ? "reviews" : "manuscript")}</select><div class="modal-footer"><button data-action="close-modal">Cancel</button><button class="primary" data-action="import-files">Choose files ↗</button></div>`,
    ),
  "import-files": async () => {
    const role = $("#import-role").value;
    closeModal();
    const result = await api("documentImport", {
      projectId: state.project.id,
      role,
    });
    result.documents.forEach((d) => state.selected.add(d.id));
    await refreshProject();
    render();
    if (result.errors.length) toast(result.errors.join("\n"), true);
    else if (result.documents.length)
      toast(`${result.documents.length} document(s) imported.`);
  },
  versions: async (el) => {
    const versions = await api("documentVersions", {
      projectId: state.project.id,
      documentId: el.dataset.id,
    });
    state.versions = versions;
    showModal(
      `<h2>Document versions</h2><p class="help">Restore a previous version by saving it as a new version.</p><div class="version-list">${versions.map((v) => `<div class="version-item"><h3>Version ${v.version} · ${esc(v.name)}</h3><p>${date(v.updatedAt)} · ${words(v.text)} words</p><details><summary>Read text</summary><pre>${esc(v.text)}</pre></details><button class="small" data-action="restore-version" data-id="${v.id}" data-version="${v.version}">Restore as new version</button></div>`).join("")}</div><div class="modal-footer"><button data-action="close-modal">Close</button></div>`,
    );
  },
  "restore-version": async (el) => {
    const v = state.versions.find(
      (v) => v.version === Number(el.dataset.version),
    );
    await api("documentSave", {
      projectId: state.project.id,
      documentId: v.id,
      text: v.text,
      name: v.name,
      role: v.role,
    });
    await refreshProject();
    closeModal();
    render();
    toast("Restored as a new document version.");
  },
  workflow: (el) => {
    readDraft();
    state.workflow = el.dataset.id;
    state.runId =
      state.runs.find((r) => r.workflow === state.workflow)?.id || null;
    state.view = "workflow";
    render();
  },
  "start-run": async () => {
    readDraft();
    state.model = $("#run-model").value;
    state.effort = $("#run-effort").value;
    normalizeEffort();
    const run = await api("runStart", {
      projectId: state.project.id,
      workflow: state.workflow,
      model: state.model,
      effort: state.effort,
      documentIds: [...state.selected],
      options: draft(),
      parentRunId: state.parentRunId || null,
    });
    state.parentRunId = null;
    state.runId = run.id;
    if (!state.runs.some((r) => r.id === run.id)) state.runs.unshift(run);
    state.active = { projectId: state.project.id, run };
    state.activity = "Connecting to Codex…";
    render();
  },
  "cancel-run": async (el) => {
    await api("runCancel", { runId: el.dataset.id });
    toast("Stop requested. Partial output and events will be kept.");
  },
  "run-detail": (el) => showRun(el.dataset.id),
  "open-run-workflow": (el) => {
    const r = state.runs.find((r) => r.id === el.dataset.id);
    state.workflow = r.workflow;
    state.runId = r.id;
    state.view = "workflow";
    render();
  },
  "active-run": async () => {
    const a = state.active;
    if (!a) return;
    if (state.project?.id !== a.projectId) await openProject(a.projectId);
    state.runId = a.run.id;
    state.workflow = a.run.workflow;
    state.view = "workflow";
    render();
  },
  rerun: (el) => {
    const r = state.runs.find((r) => r.id === el.dataset.id);
    state.workflow = r.workflow;
    state.drafts[`${state.project.id}:${r.workflow}`] = { ...r.settings };
    state.selected = new Set(r.sourceDocuments.map((d) => d.id));
    state.model = r.model;
    state.effort = r.effort;
    state.parentRunId = r.id;
    state.view = "workflow";
    render();
    toast("Prior settings loaded. A new run will use current source versions.");
  },
  "review-output": (el) => {
    const r = state.runs.find((r) => r.id === el.dataset.id);
    showModal(
      `<h2>Review & save a draft</h2><p class="help">Edit the text below. Saving adds a supporting document; the original Codex output stays in the run record.</p>${field("Draft name", "draft-name", `${state.workflows[r.workflow].title} — reviewed draft`)}<label for="draft-text">Reviewed text</label><textarea class="wide-editor" id="draft-text">${esc(r.output)}</textarea><div class="modal-footer"><button data-action="close-modal">Cancel</button><button class="primary" data-action="save-output" data-id="${r.id}">Save reviewed draft</button></div>`,
    );
  },
  "save-output": async (el) => {
    const doc = await api("runAdopt", {
      projectId: state.project.id,
      runId: el.dataset.id,
      name: $("#draft-name").value,
      text: $("#draft-text").value,
    });
    state.selected.add(doc.id);
    await refreshProject();
    closeModal();
    render();
    toast("Reviewed draft saved in project documents.");
  },
  "export-output": (el) =>
    showModal(
      `<h2>Export original run output</h2><p class="help">Markdown preserves the full response structure. The ZIP bundle includes editable Markdown and local SVG figure placeholders. PowerPoint export creates editable slides with speaker notes. Word export preserves text and headings; Markdown table/list markers remain as text.</p><label for="export-format">Format</label><select id="export-format"><option value="md">Markdown (.md)</option><option value="zip">Markdown + placeholder images (.zip)</option><option value="docx">Word document (.docx)</option><option value="pptx">PowerPoint slides (.pptx)</option><option value="txt">Plain text (.txt)</option></select><div class="modal-footer"><button data-action="close-modal">Cancel</button><button class="primary" data-action="save-export" data-id="${el.dataset.id}">Choose destination ↗</button></div>`,
    ),
  "save-export": async (el) => {
    const format = $("#export-format").value;
    closeModal();
    if (
      await api("exportOutput", {
        projectId: state.project.id,
        runId: el.dataset.id,
        format,
      })
    ) {
      await refreshProject();
      toast("Output exported.");
    }
  },
  "export-audit": async () => {
    if (await api("exportAudit", { projectId: state.project.id })) {
      await refreshProject();
      render();
      toast("Complete project audit archive exported.");
    }
  },
  login: async () => {
    const result = await api("login");
    if (result.type !== "chatgptDeviceCode")
      throw new Error("Codex did not return a device code.");
    state.device = result;
    state.authError = null;
    render();
  },
  "open-device": () =>
    api("openExternal", { url: state.device.verificationUrl }),
  "cancel-login": async () => {
    await api("loginCancel", { loginId: state.device.loginId });
    state.device = null;
    render();
  },
  logout: async () => {
    await api("logout");
    state.account = null;
    state.models = [];
    render();
  },
  "refresh-account": async () => {
    await refreshAccount();
    render();
    toast(
      state.account
        ? "Codex connected."
        : state.authError || "Sign in to connect Codex.",
      !!state.authError,
    );
  },
};
document.addEventListener("click", async (event) => {
  const link = event.target.closest("a");
  if (link) {
    event.preventDefault();
    try {
      await api("openExternal", { url: link.href });
    } catch (e) {
      toast(e.message, true);
    }
    return;
  }
  const el = event.target.closest("[data-action]");
  if (!el || el.disabled) return;
  const action = actions[el.dataset.action];
  if (!action) return;
  try {
    el.disabled = true;
    await action(el);
  } catch (e) {
    toast(
      e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
      true,
    );
  } finally {
    if (el.isConnected) el.disabled = false;
  }
});
document.addEventListener("change", (event) => {
  const el = event.target;
  if (el.dataset.document) {
    if (el.checked) state.selected.add(el.dataset.document);
    else state.selected.delete(el.dataset.document);
  }
  if (el.id === "run-picker") {
    readDraft();
    state.runId = el.value;
    renderOutput();
  }
  if (["run-model", "settings-model"].includes(el.id)) {
    readDraft();
    state.model = el.value;
    normalizeEffort();
    render();
  }
  if (["run-effort", "settings-effort"].includes(el.id)) {
    state.effort = el.value;
    normalizeEffort();
  }
  if (
    [
      "instructions",
      "word-limit",
      "structure",
      "letter-type",
      "letter-recipient",
      "author-url",
    ].includes(el.id)
  )
    readDraft();
});
window.workbench.onEvent(async ({ type, data }) => {
  if (type === "run") {
    const terminal = !["running", "starting"].includes(data.run.status);
    state.active = terminal ? null : data;
    if (state.project?.id === data.projectId) {
      const index = state.runs.findIndex((r) => r.id === data.run.id);
      if (index >= 0) state.runs[index] = data.run;
      else state.runs.unshift(data.run);
      if (!terminal) state.runId = data.run.id;
      if (state.view === "workflow") {
        readDraft();
        render();
      } else if (["history", "overview"].includes(state.view)) render();
      if (terminal) {
        await refreshProject();
        if (state.view === "audit") render();
      }
    }
    if (terminal)
      toast(
        data.run.status === "completed"
          ? "Workflow complete. Output and audit record saved."
          : `Run ${data.run.status}. ${data.run.error || ""}`,
        data.run.status === "failed",
      );
  }
  if (type === "delta" && state.project?.id === data.projectId) {
    const r = state.runs.find((r) => r.id === data.runId);
    if (r) r.output = data.output;
    if (state.runId === data.runId && state.view === "workflow") {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(renderOutput, 100);
    }
  }
  if (type === "activity") {
    state.activity =
      {
        webSearch: "Searching journal sources…",
        agentMessage: "Writing your draft…",
        reasoning: "Considering your sources…",
      }[data.method] ||
      data.detail ||
      "Codex is working…";
    if (state.view === "workflow" && state.runId === data.runId) renderOutput();
  }
  if (type === "account") {
    if (data.method === "account/login/completed") {
      state.device = null;
      if (!data.params.success)
        state.authError = data.params.error || "Sign-in was not completed.";
    }
    await refreshAccount();
    if (state.view === "settings") render();
  }
  if (type === "connectionError") {
    state.authError = data;
    if (state.view === "settings") render();
  }
});
(async () => {
  try {
    const data = await api("bootstrap");
    Object.assign(state, data);
    const id = localStorage.getItem("project");
    if (id && state.projects.some((p) => p.id === id)) await openProject(id);
    else if (state.projects.length) await openProject(state.projects[0].id);
    else render();
    await refreshAccount();
    readDraft();
    render();
  } catch (e) {
    toast(e.message, true);
    render();
  }
})();
