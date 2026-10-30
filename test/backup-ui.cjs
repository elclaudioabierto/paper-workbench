const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paper-backup-ui-"));
  const backupFile = path.join(root, "backup.zip");
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
    args: ["--no-sandbox", path.join(__dirname, "..")],
    env,
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1200, height: 900 });
  try {
    await page
      .getByRole("button", { name: "Create your first project" })
      .click();
    await page.locator("#project-name").fill("Backed up project");
    await page
      .getByRole("button", { name: "Create project ↗", exact: true })
      .click();
    await page.evaluate(() =>
      window.workbench.invoke("customWorkflowSave", {
        title: "Custom backup workflow",
        instruction: "Summarize",
        fields: [],
      }),
    );
    await page.locator('button[data-view="settings"]').first().click();
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
    }, backupFile);
    await page.getByRole("button", { name: "Back up library" }).click();
    await page.getByText("Library backup saved.").waitFor();
    assert.ok(fs.existsSync(backupFile));
    await page.evaluate(() =>
      window.workbench.invoke("projectCreate", { name: "Local later project" }),
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
      dialog.showMessageBox = async () => ({ response: 1 });
    }, backupFile);
    await page.getByRole("button", { name: "Restore backup" }).click();
    await page.getByRole("heading", { name: "Library restored" }).waitFor();
    const previous = await page.locator("#modal pre").textContent();
    assert.ok(fs.existsSync(previous));
    const data = await page.evaluate(() =>
      window.workbench.invoke("bootstrap"),
    );
    assert.deepEqual(
      data.projects.map((p) => p.name),
      ["Backed up project"],
    );
    assert.ok(
      Object.values(data.workflows).some(
        (w) => w.title === "Custom backup workflow",
      ),
    );
    console.log("Library backup and restore UI passed.");
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
