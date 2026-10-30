const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Store, hash } = require("../src/store.cjs");
const { buildPrompt, workflows } = require("../src/workflows.cjs");
const { Codex } = require("../src/codex.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paper-store-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const s = new Store(root),
    p = s.create("Study");
  const d = s.addDocument(p.id, {
    name: "Manuscript",
    role: "manuscript",
    text: "Observational study. N=50. Association, not causation.",
  });
  return { s, p, d };
}
test("document snapshots are immutable and exact run sources survive edits", (t) => {
  const { s, p, d } = fixture(t);
  const prompt = buildPrompt(p, [d], "abstract");
  const r = s.createRun(p.id, {
    ...prompt,
    workflow: "abstract",
    model: "test",
    sourceDocuments: [{ id: d.id, version: 1, sha256: d.sha256 }],
  });
  s.saveDocument(p.id, d.id, { text: "New manuscript text" });
  const archive = s.export(p.id);
  assert.equal(archive.versions.length, 2);
  assert.equal(archive.versions.find((v) => v.version === 1).text, d.text);
  assert.equal(archive.runs[0].prompt, r.prompt);
  assert.equal(archive.runs[0].sourceDocuments[0].sha256, hash(d.text));
  assert.equal(archive.integrity.valid, true);
});
test("audit chain detects changed payload and broken linkage", (t) => {
  const { s, p } = fixture(t);
  const file = path.join(s.dir(p.id), "audit.jsonl");
  const original = fs.readFileSync(file, "utf8");
  const events = original.trim().split("\n").map(JSON.parse);
  events[0].data.project.name = "Altered";
  fs.writeFileSync(file, events.map(JSON.stringify).join("\n") + "\n");
  assert.equal(s.verify(p.id).valid, false);
});
test("interrupted runs recover once and preserve partial output and protocol events", (t) => {
  const { s, p } = fixture(t);
  const r = s.createRun(p.id, {
    workflow: "rewrite",
    model: "test",
    prompt: "Exact prompt",
    sourceDocuments: [],
  });
  r.output = "Partial draft";
  s.saveRun(p.id, r);
  s.appendRunEvent(p.id, r.id, "item/agentMessage/delta", {
    delta: "Partial draft",
  });
  s.recover();
  s.recover();
  const recovered = s.run(p.id, r.id);
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.output, "Partial draft");
  assert.equal(
    s.events(p.id).filter((e) => e.type === "run.interrupted").length,
    1,
  );
  assert.equal(s.export(p.id).runs[0].events.length, 1);
  assert.equal(recovered.outputSha256, hash("Partial draft"));
});
test("workflow validation refuses missing manuscript and context overflow without truncation", (t) => {
  const { p, d } = fixture(t);
  assert.throws(() => buildPrompt(p, [], "abstract"), /manuscript/);
  assert.throws(
    () => buildPrompt(p, [{ ...d, text: "x".repeat(600001) }], "rewrite"),
    /Nothing has been truncated/,
  );
  assert.throws(() => buildPrompt(p, [d], "unknown"), /Unknown/);
  for (const id of Object.keys(workflows)) {
    const b = buildPrompt(
      {
        ...p,
        journal: "Target journal",
        authorInstructionsUrl: "https://example.org/authors",
      },
      [d],
      id,
      {
        instructions: "Preserve citations",
      },
    );
    assert.ok(b.prompt.includes(d.text));
    assert.ok(b.prompt.includes("Preserve citations"));
    assert.equal(b.settings.journal, "Target journal");
  }
});
test("identifiers cannot escape project storage", (t) => {
  const { s, p } = fixture(t);
  assert.throws(() => s.project("../outside"), /Invalid identifier/);
  assert.throws(() => s.document(p.id, "../../file"), /Invalid identifier/);
});
test("Codex bridge handles device auth, streaming, cancellation, request denial and timeouts", async (t) => {
  const c = new Codex({
    binary: process.execPath,
    args: [path.join(__dirname, "fake-codex.cjs")],
  });
  t.after(() => c.stop());
  const notifications = [];
  c.on("notification", (n) => notifications.push(n));
  await c.start();
  const login = await c.request("account/login/start", {
    type: "chatgptDeviceCode",
  });
  assert.equal(login.userCode, "PAPER-1234");
  const result = await c.request("thread/start", { model: "test" });
  await c.request("turn/start", {
    threadId: result.thread.id,
    input: [{ type: "text", text: "WORKFLOW: Abstract" }],
  });
  await c.request("turn/interrupt", {
    threadId: result.thread.id,
    turnId: "turn-1",
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(
    notifications.some(
      (n) =>
        n.method === "turn/completed" && n.params.turn.status === "interrupted",
    ),
  );
  await c.request("test/serverRequest");
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.ok(notifications.some((n) => n.method === "workbench/actionDeclined"));
  await assert.rejects(c.request("test/hang", {}, 25), /timed out/);
});
test("Codex process failures reject pending calls and allow restart", async (t) => {
  const c = new Codex({
    binary: process.execPath,
    args: [path.join(__dirname, "fake-codex.cjs")],
  });
  t.after(() => c.stop());
  await c.start();
  await assert.rejects(c.request("test/crash"), /Codex stopped/);
  await c.start();
  assert.ok((await c.request("model/list")).data.length);
});
test(
  "Windows Codex command shim starts the protocol process",
  { skip: process.platform !== "win32" },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "paper codex "));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const shim = path.join(root, "codex.cmd");
    fs.writeFileSync(
      shim,
      `@echo off\r\n"${process.execPath}" "${path.join(__dirname, "fake-codex.cjs")}" %*\r\n`,
    );
    const c = new Codex({ binary: shim });
    t.after(() => c.stop());
    await c.start();
    assert.ok((await c.request("model/list")).data.length);
  },
);
test("DOCX export imports back as readable manuscript text", async (t) => {
  const { extract, exportDocx } = require("../src/documents.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paper-docx-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "draft.docx");
  fs.writeFileSync(
    file,
    await exportDocx("# Abstract\n\nA study of 50 participants."),
  );
  const d = await extract(file);
  assert.ok(d.text.includes("A study of 50 participants."));
  assert.equal(d.sourceSha256.length, 64);
});
test("Word tables retain cells and order through Markdown import and Word export", async (t) => {
  const {
    Document,
    Packer,
    Paragraph,
    Table,
    TableRow,
    TableCell,
  } = require("docx");
  const { extract, exportDocx } = require("../src/documents.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paper-tables-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "table.docx");
  const cell = (text) => new TableCell({ children: [new Paragraph(text)] });
  fs.writeFileSync(
    file,
    await Packer.toBuffer(
      new Document({
        sections: [
          {
            children: [
              new Paragraph("Before"),
              new Table({
                rows: [
                  new TableRow({ children: [cell("Measure"), cell("Value")] }),
                  new TableRow({ children: [cell("A | B"), cell("42")] }),
                ],
              }),
              new Paragraph("After"),
            ],
          },
        ],
      }),
    ),
  );
  const imported = (await extract(file)).text;
  assert.match(
    imported,
    /Before[\s\S]*\| Measure \| Value \|[\s\S]*\| A \\\| B \| 42 \|[\s\S]*After/,
  );
  fs.writeFileSync(file, await exportDocx(imported));
  const html = (await require("mammoth").convertToHtml({ path: file })).value;
  assert.match(
    html,
    /<table>[\s\S]*<td><p>A \| B<\/p><\/td>[\s\S]*<td><p>42<\/p><\/td>[\s\S]*<\/table>/,
  );
});
test("custom workflows persist, validate choices, and preserve prompt revisions", (t) => {
  const { s, p } = fixture(t);
  const d = s.addDocument(p.id, {
    name: "Paper",
    role: "manuscript",
    text: "Evidence.",
  });
  const def = s.saveCustomWorkflow({
    title: "Plain summary",
    instruction: "Summarize the paper.",
    fields: [{ label: "Audience", options: ["Experts", "Public"] }],
    webSearch: true,
  });
  const { buildPrompt } = require("../src/workflows.cjs");
  const first = buildPrompt(
    p,
    [d],
    def.id,
    { customChoices: ["Public"] },
    s.customWorkflows(),
  );
  assert.deepEqual(first.settings.customChoices, [
    { label: "Audience", value: "Public" },
  ]);
  assert.match(first.prompt, /Summarize the paper/);
  assert.equal(first.workflowVersion, "custom-1");
  assert.throws(
    () =>
      buildPrompt(
        p,
        [d],
        def.id,
        { customChoices: ["Invalid"] },
        s.customWorkflows(),
      ),
    /valid option/,
  );
  assert.throws(
    () =>
      s.saveCustomWorkflow({
        title: "Bad",
        instruction: "Prompt",
        fields: [{ label: "A", options: [] }],
      }),
    /dropdown/,
  );
  s.saveCustomWorkflow({ ...def, instruction: "Write a new summary." });
  assert.equal(s.customWorkflows()[def.id].revision, 2);
  assert.match(first.prompt, /Summarize the paper/);
});
test("Markdown bundle includes matching SVG figures, blank tables and body captions", () => {
  const { markdownBundle } = require("../src/documents.cjs");
  const { unzipSync, strFromU8 } = require("fflate");
  const text =
    "# Paper\n\n![Figure 1 placeholder](assets/figure-1.svg)\n\nFigure 1. The original caption.\n\nTable 1. Original caption.\n\n| Measure | Value |\n| --- | --- |\n| | |\n| | |";
  const files = unzipSync(markdownBundle(text));
  assert.equal(strFromU8(files["manuscript.md"]), text);
  assert.ok(
    strFromU8(files["assets/figure-1.svg"]).includes("Figure 1 placeholder"),
  );
  assert.ok(!files["../figure.svg"]);
});
test("PowerPoint is an editable slide package with summary before critique and preserved notes", async () => {
  const { parseDeck, exportPptx } = require("../src/presentation.cjs");
  const { unzipSync, strFromU8 } = require("fflate");
  const text =
    "# A paper\n## Slide 1: Summary of the paper\n- Study of 50 adults.\n### Speaker notes\nGrounded in methods.\n## Slide 2: What is missing\n- Sampling detail not reported.\n### Speaker notes\nNot reported does not mean not done.\n## Slide 3: What is overstated\n- Causal claims exceed design.\n### Speaker notes\nUse association.";
  const deck = parseDeck(text);
  assert.equal(deck.slides[0].title, "Summary of the paper");
  assert.equal(deck.slides.length, 3);
  const files = unzipSync(new Uint8Array(await exportPptx(text)));
  assert.ok(
    strFromU8(files["ppt/slides/slide1.xml"]).includes("Study of 50 adults."),
  );
  assert.ok(
    strFromU8(files["ppt/notesSlides/notesSlide2.xml"]).includes(
      "Not reported does not mean not done.",
    ),
  );
  assert.ok(
    strFromU8(files["ppt/slides/slide3.xml"]).includes(
      "Causal claims exceed design.",
    ),
  );
});
test("long slide content is split without dropping text", () => {
  const { parseDeck } = require("../src/presentation.cjs");
  const text =
    "# Paper\n## Slide 1: Summary\n" +
    Array.from({ length: 14 }, (_, i) => "- Finding " + i).join("\n") +
    "\n### Speaker notes\nSource notes.";
  const deck = parseDeck(text);
  assert.ok(deck.slides.length >= 3);
  assert.equal(deck.slides.flatMap((s) => s.bullets).length, 14);
  assert.ok(deck.slides.every((s) => s.notes === "Source notes."));
});
test("all letter types preserve recipient, sources and correspondence safeguards", (t) => {
  const { p, d } = fixture(t);
  const { LETTER_TYPES } = require("../src/workflows.cjs");
  for (const letterType of LETTER_TYPES) {
    const result = buildPrompt(p, [d], "letter", {
      letterType,
      recipient: "Dr. Example",
      instructions: "Answer Reviewer 2 respectfully.",
    });
    assert.equal(result.settings.letterType, letterType);
    assert.equal(result.settings.recipient, "Dr. Example");
    assert.ok(result.prompt.includes("AUTHOR TO CONFIRM"));
    assert.ok(result.prompt.includes("Do not send the letter"));
    assert.ok(result.prompt.includes(d.text));
  }
  assert.throws(
    () => buildPrompt(p, [d], "letter", { letterType: "Unsupported" }),
    /supported letter type/,
  );
});
test("preflight accepts a journal URL, preserves its provenance and requires an evidence source", (t) => {
  const { s, p, d } = fixture(t);
  assert.throws(
    () => buildPrompt(p, [d], "preflight"),
    /author-instructions URL/,
  );
  const saved = s.update(p.id, {
    authorInstructionsUrl: "https://example.org/journal/authors#research",
  });
  const result = buildPrompt(saved, [d], "preflight");
  assert.equal(
    result.settings.authorInstructionsUrl,
    "https://example.org/journal/authors#research",
  );
  assert.ok(result.prompt.includes("UNVERIFIED"));
  assert.ok(result.prompt.includes("original Word/PDF typography"));
  assert.ok(result.prompt.includes("extractedTextWordCount"));
  assert.equal(
    s.project(p.id).authorInstructionsUrl,
    result.settings.authorInstructionsUrl,
  );
  const override = buildPrompt(saved, [d], "preflight", {
    authorInstructionsUrl: "https://example.org/other/authors",
  });
  assert.equal(
    override.settings.authorInstructionsUrl,
    "https://example.org/other/authors",
  );
  assert.throws(
    () => buildPrompt(saved, [d], "preflight", { authorInstructionsUrl: "" }),
    /author-instructions URL/,
  );
  const guidelines = s.addDocument(p.id, {
    name: "Author instructions",
    role: "guidelines",
    text: "Abstract limit: 250 words. Supply a data availability statement.",
  });
  const supplied = buildPrompt(saved, [d, guidelines], "preflight", {
    authorInstructionsUrl: "",
  });
  assert.equal(supplied.settings.authorInstructionsUrl, "");
  assert.ok(supplied.prompt.includes(guidelines.text));
  assert.ok(
    supplied.prompt.includes("supplied guidelines rather than a live check"),
  );
  assert.equal(s.verify(p.id).valid, true);
});
test("author-instructions links reject unsafe schemes and credential-bearing URLs", () => {
  const { instructionsUrl } = require("../src/workflows.cjs");
  for (const url of [
    "file:///tmp/private",
    "javascript:alert(1)",
    "https://user:secret@example.org",
    "not a url",
  ])
    assert.throws(() => instructionsUrl(url), /URL/);
  assert.equal(
    instructionsUrl(" https://example.org/authors "),
    "https://example.org/authors",
  );
});
test("reviewer suggestions preserve candidate count, author identities, exclusions and journal policy", (t) => {
  const { p, d } = fixture(t);
  const input = {
    reviewerCount: 4,
    reviewerAuthors: "Dr. Author, Example University",
    reviewerExclusions: "Dr. Collaborator; Example University",
    authorInstructionsUrl: "https://example.org/reviewer-policy",
  };
  const built = buildPrompt(p, [d], "reviewers", input);
  for (const key of Object.keys(input))
    assert.equal(built.settings[key], input[key]);
  assert.ok(built.prompt.includes("never label a candidate conflict-free"));
  assert.ok(built.prompt.includes("Do not recommend excluded candidates"));
  assert.ok(built.prompt.includes("Never guess email addresses"));
  assert.ok(
    built.prompt.includes(
      "do not copy unpublished manuscript passages into search queries",
    ),
  );
  assert.ok(built.prompt.includes("do not contact candidates"));
  assert.equal(buildPrompt(p, [d], "reviewers").settings.reviewerCount, 5);
  assert.equal(
    buildPrompt(p, [d], "reviewers").settings.authorInstructionsUrl,
    "",
  );
  for (const reviewerCount of [0, 13, 1.5, NaN, "5"])
    assert.throws(
      () => buildPrompt(p, [d], "reviewers", { reviewerCount }),
      /between 1 and 12/,
    );
});
