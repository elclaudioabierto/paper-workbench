const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paper-ui-"));
  const artifacts = path.join(__dirname, "..", "test-artifacts");
  fs.mkdirSync(artifacts, { recursive: true });
  const env = {
    ...process.env,
    PAPER_WORKBENCH_DATA: path.join(root, "library"),
    PAPER_WORKBENCH_CODEX: process.execPath,
    PAPER_WORKBENCH_CODEX_ARGS: JSON.stringify([
      path.join(__dirname, "fake-codex.cjs"),
    ]),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.PAPER_WORKBENCH_EXECUTABLE || undefined,
    args: process.env.PAPER_WORKBENCH_EXECUTABLE
      ? ["--no-sandbox"]
      : ["--no-sandbox", path.join(__dirname, "..")],
    env,
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  try {
    await page
      .getByRole("button", { name: "Create your first project" })
      .click();
    await page.locator("#project-name").fill("Digital wellbeing study");
    await page
      .getByRole("button", { name: "Create project ↗", exact: true })
      .click();
    await page.getByRole("button", { name: "Connect Codex" }).click();
    await page.getByRole("button", { name: "Sign in with Codex" }).click();
    await page.locator(".device-code").waitFor();
    await page.locator(".integrity").filter({ hasText: "Signed in" }).waitFor();
    await page.getByRole("button", { name: "Documents", exact: false }).click();
    await page.getByRole("button", { name: "Paste text" }).click();
    await page.locator("#doc-name").fill("Manuscript");
    await page
      .locator("#doc-text")
      .fill(
        "Title: Digital wellbeing and daily routines\nAn observational study of 50 adults examined the association between screen use and wellbeing. A small negative association was observed; causal inference is not supported.",
      );
    await page
      .getByRole("button", { name: "Add document", exact: true })
      .click();
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator("#doc-text")
      .fill(
        "Title: Digital wellbeing and daily routines\nAn observational study of 50 adults examined screen use and wellbeing. A small negative association was observed. Causal inference is not supported.\nLimitations: convenience sample and self-report measures.",
      );
    await page.getByRole("button", { name: "Save new version" }).click();
    await page.getByText("Version 2", { exact: false }).first().waitFor();
    await page
      .getByRole("button", { name: "Project settings", exact: true })
      .click();
    await page.locator("#target-journal").fill("Journal of Digital Health");
    await page.getByRole("button", { name: "Save settings" }).click();
    const reviews = path.join(root, "reviewers.txt");
    fs.writeFileSync(
      reviews,
      "Reviewer 1: Clarify the sampling limitations. Reviewer 2: Remove causal wording.",
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, reviews);
    await page
      .getByRole("button", { name: "Import files", exact: true })
      .click();
    await page.locator("#import-role").selectOption("reviews");
    await page.getByRole("button", { name: "Choose files" }).click();
    await page
      .getByRole("heading", { name: "reviewers.txt", exact: true })
      .waitFor();
    await page.getByRole("button", { name: "Workbench", exact: false }).click();
    await page.screenshot({ path: path.join(artifacts, "workbench.png") });
    for (const title of [
      "Select a journal",
      "Craft an abstract",
      "Prepare a revision",
      "Prepare a rewrite",
      "Convert to Markdown",
      "PowerPoint from paper",
      "Letter to reviewers / editor",
    ]) {
      await page
        .getByRole("button", { name: title, exact: false })
        .first()
        .click();
      await page
        .locator("#instructions")
        .fill("Preserve all reported findings and flag gaps.");
      if (title === "Letter to reviewers / editor") {
        await page
          .locator("#letter-type")
          .selectOption("Resubmission letter to editor");
        await page.locator("#letter-recipient").fill("Dr. Example, Editor");
      }
      await page.getByRole("button", { name: "Run workflow" }).click();
      await page
        .locator("#output-area .status.completed")
        .waitFor({ timeout: 20000 });
      assert.equal(await page.evaluate(() => window.pwned), undefined);
      if (!title.includes("PowerPoint"))
        assert.ok(await page.locator("#output-area table").count());
      if (title === "Craft an abstract")
        await page.screenshot({ path: path.join(artifacts, "abstract.png") });
      const format =
        title === "Convert to Markdown"
          ? "zip"
          : title === "PowerPoint from paper"
            ? "pptx"
            : "docx";
      const outputFile = path.join(
        root,
        title.replace(/[^a-z]/gi, "-") + "." + format,
      );
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: file,
        });
      }, outputFile);
      await page.getByRole("button", { name: "Export ↗", exact: true }).click();
      await page.locator("#export-format").selectOption(format);
      await page.getByRole("button", { name: "Choose destination" }).click();
      await page.waitForFunction(
        () =>
          document.querySelector("#toast").textContent === "Output exported.",
      );
      assert.ok(fs.statSync(outputFile).size > 100);
      await page.getByRole("button", { name: "Review & save" }).click();
      await page.locator("#draft-name").fill(title + " reviewed");
      await page.getByRole("button", { name: "Save reviewed draft" }).click();
      await page.getByRole("button", { name: "All workflows" }).click();
    }
    await page
      .getByRole("button", { name: "Prepare a rewrite", exact: false })
      .first()
      .click();
    await page.getByRole("button", { name: "Run workflow" }).click();
    await page.getByRole("button", { name: "Stop run" }).click();
    await page.locator("#output-area .status.cancelled").waitFor();
    await page.getByRole("button", { name: "Run details" }).click();
    await page.getByText("Exact prompt sent to Codex").click();
    assert.ok(
      await page.getByText("WORKFLOW VERSION:", { exact: false }).count(),
    );
    await page
      .getByRole("button", { name: "Audit trail", exact: false })
      .click();
    await page.getByText("Hash chain verified", { exact: false }).waitFor();
    const auditPath = path.join(root, "export.json");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, auditPath);
    await page.getByRole("button", { name: "Export audit archive" }).click();
    await page.waitForFunction(() =>
      document.querySelector("#toast").textContent.includes("archive exported"),
    );
    const archive = JSON.parse(fs.readFileSync(auditPath));
    assert.equal(archive.integrity.valid, true);
    const letter = archive.runs.find((r) => r.workflow === "letter");
    assert.equal(letter.settings.letterType, "Resubmission letter to editor");
    assert.equal(letter.settings.recipient, "Dr. Example, Editor");
    assert.equal(archive.runs.length, 8);
    assert.equal(
      archive.runs.filter((r) => r.status === "completed").length,
      7,
    );
    assert.equal(
      archive.runs.filter((r) => r.status === "cancelled").length,
      1,
    );
    assert.ok(archive.versions.some((d) => d.version === 1));
    assert.ok(archive.versions.some((d) => d.version === 2));
    assert.ok(archive.runs.every((r) => r.prompt && r.sourceDocuments.length));
    assert.ok(
      archive.runs
        .filter((r) => r.status === "completed")
        .every((r) => r.events.length && r.tokenUsage),
    );
    await page.screenshot({ path: path.join(artifacts, "audit.png") });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: device sign-in; project settings; text import/edit/version; file import; all seven workflows; streaming; Markdown sanitization; draft adoption; stop; run details; full audit export.",
    );
    console.log("Screenshots:", artifacts);
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
