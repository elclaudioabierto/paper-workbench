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
  await page.setViewportSize({ width: 1200, height: 900 });
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
    await page.getByRole("heading", { name: "Need to install Codex?" }).waitFor();
    await page.getByText("Updates are available in installed builds.").waitFor();
    await page.getByText("npm install -g @openai/codex").waitFor();
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
    await page
      .locator("#project-author-url")
      .fill("https://example.org/journal/author-instructions");
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
      "Submission preflight",
      "Suggest reviewers",
    ]) {
      await page
        .getByRole("button", { name: title, exact: false })
        .first()
        .click();
      await page
        .locator("#instructions")
        .fill("Preserve all reported findings and flag gaps.");
      if (title === "Submission preflight") {
        assert.equal(
          await page.locator("#author-url").inputValue(),
          "https://example.org/journal/author-instructions",
        );
      }
      if (title === "Suggest reviewers") {
        await page.locator("#reviewer-count").fill("4");
        await page
          .locator("#reviewer-authors")
          .fill("Dr. Author, Example University");
        await page
          .locator("#reviewer-exclusions")
          .fill("Dr. Collaborator; Example University");
      }
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
    const preflight = archive.runs.find((r) => r.workflow === "preflight");
    assert.equal(
      preflight.settings.authorInstructionsUrl,
      "https://example.org/journal/author-instructions",
    );
    assert.equal(preflight.execution.webSearch, "live");
    const reviewers = archive.runs.find((r) => r.workflow === "reviewers");
    assert.equal(reviewers.execution.webSearch, "live");
    assert.equal(reviewers.settings.reviewerCount, 4);
    assert.equal(
      reviewers.settings.reviewerAuthors,
      "Dr. Author, Example University",
    );
    assert.equal(
      reviewers.settings.reviewerExclusions,
      "Dr. Collaborator; Example University",
    );
    assert.equal(
      reviewers.settings.authorInstructionsUrl,
      "https://example.org/journal/author-instructions",
    );
    const letter = archive.runs.find((r) => r.workflow === "letter");
    assert.equal(letter.settings.letterType, "Resubmission letter to editor");
    assert.equal(letter.settings.recipient, "Dr. Example, Editor");
    assert.equal(archive.runs.length, 10);
    assert.equal(
      archive.runs.filter((r) => r.status === "completed").length,
      9,
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
    await page.getByRole("button", { name: "Workbench", exact: false }).click();
    await page.getByRole("button", { name: "Create workflow" }).click();
    await page.getByRole("button", { name: "Save workflow" }).click();
    await page.locator("#custom-workflow-error").waitFor();
    await page.locator("#custom-title").fill("Plain-language summary");
    await page
      .locator("#custom-prompt")
      .fill("Summarize the paper for the chosen audience.");
    await page
      .locator("#custom-dropdowns")
      .fill("Audience | Experts | Public\nTone | Formal | Friendly");
    await page.getByRole("button", { name: "Save workflow" }).click();
    await page
      .locator(".workflow-card")
      .filter({ hasText: "Plain-language summary" })
      .click();
    await page.getByLabel("Audience").selectOption("Public");
    await page.getByLabel("Tone").selectOption("Friendly");
    await page.getByRole("button", { name: "Run workflow" }).click();
    await page
      .locator("#output-area .status.completed")
      .waitFor({ timeout: 20000 });
    const customRun = await page.evaluate(async () => {
      const { projects } = await window.workbench.invoke("bootstrap");
      return window.workbench.invoke("runDetail", {
        projectId: projects[0].id,
        runId: document.querySelector("#run-picker").value,
      });
    });
    assert.deepEqual(customRun.run.settings.customChoices, [
      { label: "Audience", value: "Public" },
      { label: "Tone", value: "Friendly" },
    ]);
    await page.getByRole("button", { name: "Edit workflow" }).click();
    await page.locator("#custom-prompt").fill("Write a shorter summary.");
    await page.getByRole("button", { name: "Save workflow" }).click();
    await page.reload();
    await page
      .locator(".workflow-card")
      .filter({ hasText: "Plain-language summary" })
      .click();
    await page.getByRole("button", { name: "Edit workflow" }).click();
    assert.equal(
      await page.locator("#custom-prompt").inputValue(),
      "Write a shorter summary.",
    );
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.setViewportSize({ width: 600, height: 520 });
    const menu = page.getByRole("button", { name: "☰ Menu" });
    await menu.click();
    assert.equal(await menu.getAttribute("aria-expanded"), "true");
    await page.getByRole("button", { name: "Close menu" }).click();
    assert.equal(await menu.getAttribute("aria-expanded"), "false");
    await menu.click();
    await page.getByRole("button", { name: "Workbench", exact: false }).click();
    await page.getByRole("button", { name: /Craft an abstract/ }).click();
    assert.equal(await page.locator(".workflow-jumps").isVisible(), true);
    await page.getByRole("button", { name: "Results ↓" }).click();
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      "workflow-results",
    );
    assert.equal(
      await page.evaluate(
        () =>
          document.querySelector(".content").scrollWidth <=
          document.querySelector(".content").clientWidth,
      ),
      true,
    );
    await page.getByRole("button", { name: "Project settings" }).click();
    assert.equal(
      await page.getByRole("button", { name: "Save settings" }).isVisible(),
      true,
    );
    await page.getByRole("button", { name: "Cancel" }).click();
    assert.deepEqual(errors, []);
    console.log(
      "PASS: device sign-in; project settings; text import/edit/version; file import; all nine workflows; streaming; Markdown sanitization; draft adoption; stop; run details; full audit export.",
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
