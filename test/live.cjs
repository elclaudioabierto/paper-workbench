// Opt-in real Codex smoke test. Uses a synthetic manuscript and the signed-in account.
const { _electron: electron } = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paper-live-"));
  const env = {
    ...process.env,
    PAPER_WORKBENCH_DATA: path.join(root, "library"),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PAPER_WORKBENCH_CODEX;
  delete env.PAPER_WORKBENCH_CODEX_ARGS;
  const app = await electron.launch({
    args: ["--no-sandbox", path.join(__dirname, "..")],
    env,
  });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => !!window.workbench);
    const result = await page.evaluate(async () => {
      const api = window.workbench.invoke;
      const account = await api("account");
      if (!account.account) throw new Error("Codex sign-in required.");
      const models = await api("models");
      const model = (models.find((m) => m.isDefault) || models[0]).model;
      const project = await api("projectCreate", {
        name: "Synthetic live smoke test",
      });
      const doc = await api("documentAdd", {
        projectId: project.id,
        name: "Synthetic manuscript",
        role: "manuscript",
        text: "Synthetic methods demonstration. An observational cross-sectional study of 50 adults assessed the association between self-reported screen use and wellbeing. A weak negative association was observed; no numerical estimate or significance test is supplied. Convenience sampling, self-report, and lack of longitudinal data limit interpretation. No causal conclusion is supported.",
      });
      const run = await api("runStart", {
        projectId: project.id,
        workflow: "abstract",
        model,
        effort: "low",
        documentIds: [doc.id],
        options: {
          wordLimit: 100,
          instructions:
            "Keep the abstract under 100 words. Do not invent any statistics. Keep the grounding check brief.",
        },
      });
      return { projectId: project.id, runId: run.id, model };
    });
    let run;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const detail = await page.evaluate(
        async (x) => window.workbench.invoke("runDetail", x),
        result,
      );
      run = detail.run;
      if (!["starting", "running"].includes(run.status)) break;
    }
    if (run?.status !== "completed")
      throw new Error(
        "Real Codex smoke test: " +
          JSON.stringify({ status: run?.status, error: run?.error }),
      );
    if (!run.output || !run.threadId || !run.turnId)
      throw new Error("Missing live output or protocol IDs.");
    console.log(
      "PASS real Codex abstract:",
      JSON.stringify({
        model: run.resolvedModel || run.model,
        status: run.status,
        outputCharacters: run.output.length,
        usage: run.tokenUsage,
      }),
    );
  } finally {
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBoxSync = () => 1;
    });
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
