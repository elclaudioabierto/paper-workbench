const readline = require("node:readline");
let loggedIn = false,
  sequence = 0,
  active = null;
const send = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const event = (method, params) => send({ method, params });
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const req = JSON.parse(line);
  if (!req.method) return;
  const { id, method, params: p } = req;
  const reply = (result) => send({ id, result });
  if (method === "initialize") return reply({ userAgent: "fake-codex/1.0" });
  if (method === "initialized") return;
  if (method === "account/read")
    return reply({
      account: loggedIn
        ? {
            type: "chatgpt",
            email: "researcher@example.test",
            planType: "plus",
          }
        : null,
      requiresOpenaiAuth: true,
    });
  if (method === "account/login/start") {
    reply({
      type: "chatgptDeviceCode",
      loginId: "login-1",
      userCode: "PAPER-1234",
      verificationUrl: "https://auth.openai.com/codex/device",
    });
    setTimeout(() => {
      loggedIn = true;
      event("account/login/completed", {
        loginId: "login-1",
        success: true,
        error: null,
      });
    }, 900);
    return;
  }
  if (method === "account/login/cancel") return reply({ status: "canceled" });
  if (method === "account/logout") {
    loggedIn = false;
    return reply({});
  }
  if (method === "model/list")
    return reply({
      data: [
        {
          id: "test-model",
          model: "test-model",
          displayName: "Test model",
          isDefault: true,
          defaultReasoningEffort: "medium",
          supportedReasoningEfforts: [
            { reasoningEffort: "low" },
            { reasoningEffort: "medium" },
            { reasoningEffort: "high" },
          ],
        },
      ],
      nextCursor: null,
    });
  if (method === "thread/start")
    return reply({ thread: { id: "thread-" + ++sequence }, model: p.model });
  if (method === "turn/start") {
    const threadId = p.threadId,
      turnId = "turn-" + sequence;
    active = { threadId, turnId };
    reply({ turn: { id: turnId, status: "inProgress" } });
    event("turn/started", {
      threadId,
      turn: { id: turnId, status: "inProgress" },
    });
    const title =
      p.input[0].text.match(/WORKFLOW: ([^\n]+)/)?.[1] || "Workflow";
    let output = `# ${title}\n\nA grounded working draft based on the supplied manuscript.\n\n## Evidence check\n\n- Findings preserved.\n- Missing evidence flagged.\n\n| Item | Status |\n| --- | --- |\n| Source | Verified |\n\n[Source](https://example.org/journal)\n\n<script>window.pwned=true</script>`;
    if (title === "Convert to Markdown")
      output =
        "# Digital wellbeing study\n\n## Abstract\n\nAn observational study of 50 adults.\n\n![Figure 1 placeholder](assets/figure-1.svg)\n\nFigure 1. Wellbeing by screen use.\n\nTable 1. Sample characteristics.\n\n| Measure | Value |\n| --- | --- |\n| | |\n| | |";
    if (title === "PowerPoint from paper")
      output =
        "# Digital wellbeing: summary and appraisal\n\n## Slide 1: Summary of the paper\n- Observational study of 50 adults.\n- Association does not establish causality.\n\n### Speaker notes\nBased on the supplied manuscript abstract and methods.\n\n## Slide 2: What is missing\n- Sampling detail is not fully reported.\n\n### Speaker notes\nNot reported does not mean not done.\n\n## Slide 3: What is overstated\n- Causal language would exceed this design.\n\n### Speaker notes\nPreserve associative language.\n";
    event("item/started", {
      threadId,
      turnId,
      item: { id: "message-" + sequence, type: "agentMessage" },
    });
    let at = 0;
    const timer = setInterval(() => {
      if (!active || active.turnId !== turnId) {
        clearInterval(timer);
        return;
      }
      at += 45;
      event("item/agentMessage/delta", {
        threadId,
        turnId,
        itemId: "message-" + sequence,
        delta: output.slice(at - 45, at),
      });
      if (at >= output.length) {
        clearInterval(timer);
        event("item/completed", {
          threadId,
          turnId,
          item: {
            id: "message-" + sequence,
            type: "agentMessage",
            text: output,
            phase: "final_answer",
          },
        });
        event("thread/tokenUsage/updated", {
          threadId,
          turnId,
          tokenUsage: {
            total: { inputTokens: 500, outputTokens: 100, totalTokens: 600 },
          },
        });
        event("turn/completed", {
          threadId,
          turn: { id: turnId, status: "completed", error: null },
        });
        active = null;
      }
    }, 70);
    return;
  }
  if (method === "turn/interrupt") {
    reply({});
    if (active) {
      event("turn/completed", {
        threadId: active.threadId,
        turn: { id: active.turnId, status: "interrupted", error: null },
      });
      active = null;
    }
    return;
  }
  if (method === "test/serverRequest") {
    send({
      id: "server-1",
      method: "item/commandExecution/requestApproval",
      params: { command: "whoami" },
    });
    return reply({});
  }
  if (method === "test/hang") return;
  if (method === "test/crash") process.exit(2);
  send({
    id,
    error: { code: -32601, message: "Unknown test method: " + method },
  });
});
