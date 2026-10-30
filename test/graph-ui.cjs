const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paper-graph-"));
  const env = {
    ...process.env,
    PAPER_WORKBENCH_DATA: root,
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
    await page.locator("#project-name").fill("Graph test");
    await page
      .getByRole("button", { name: "Create project ↗", exact: true })
      .click();
    await page.evaluate(() => window.workbench.invoke("login"));
    await page.waitForTimeout(2000);
    await page.locator('button[data-view="documents"]').first().click();
    await page.getByRole("button", { name: "Paste text" }).click();
    await page.locator("#doc-name").fill("Paper");
    await page.locator("#doc-text").fill("A study of 50 participants.");
    await page
      .getByRole("button", { name: "Add document", exact: true })
      .click();
    await page.getByRole("button", { name: "Workflow graph" }).click();
    await page.locator("#graph-workflow").selectOption("rewrite");
    await page.getByRole("button", { name: "＋ Add step" }).click();
    await page.locator("#graph-workflow").selectOption("abstract");
    await page.getByRole("button", { name: "＋ Add step" }).click();
    await page.locator("#graph-workflow").selectOption("presentation");
    await page.getByRole("button", { name: "＋ Add step" }).click();
    const options = await page
      .locator("#graph-from option")
      .evaluateAll((els) => els.map((e) => e.value));
    await page.locator("#graph-from").selectOption(options[0]);
    await page.locator("#graph-to").selectOption(options[1]);
    await page.locator("#graph-type").selectOption("order");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.locator("#graph-from").selectOption(options[1]);
    await page.locator("#graph-to").selectOption(options[2]);
    await page.locator("#graph-type").selectOption("output");
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: "Run graph" }).click();
    await page.getByText("Graph: completed").waitFor({ timeout: 30000 });
    const data = await page.evaluate(async () => {
      const { projects } = await window.workbench.invoke("bootstrap");
      return window.workbench.invoke("projectOpen", {
        projectId: projects[0].id,
      });
    });
    const runs = data.runs;
    assert.equal(runs.length, 3);
    const first = runs.find((r) => r.workflow === "rewrite");
    const second = runs.find((r) => r.workflow === "abstract");
    const third = runs.find((r) => r.workflow === "presentation");
    assert.ok(
      first.finishedAt <= second.startedAt &&
        second.finishedAt <= third.startedAt,
    );
    assert.deepEqual(second.inputRunIds, []);
    assert.ok(!second.prompt.includes(first.output));
    assert.deepEqual(third.inputRunIds, [second.id]);
    assert.ok(
      third.prompt.includes(JSON.stringify(second.output).slice(1, -1)),
    );
    assert.equal(new Set(runs.map((r) => r.graphExecutionId)).size, 1);
    assert.equal(data.graph.edges.length, 2);
    await page.getByRole("button", { name: "Run graph" }).click();
    await page.getByRole("button", { name: "Stop graph" }).click();
    await page.getByText("Graph: cancelled", { exact: false }).waitFor({ timeout: 10000 });
    const stopped = await page.evaluate(async () => {
      const { projects } = await window.workbench.invoke("bootstrap");
      return window.workbench.invoke("projectOpen", { projectId: projects[0].id });
    });
    assert.equal(stopped.runs.length, 4);
    assert.equal(stopped.runs.filter(r => r.status === "cancelled").length, 1);
    console.log("Graph UI and automatic execution passed.");
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
