const test = require("node:test");
const assert = require("node:assert/strict");
const { workflows, buildPrompt } = require("../src/workflows.cjs");

test("all workflow prompts direct a non-interactive response", () => {
  const project = { name: "Study", authorInstructionsUrl: "https://example.org/instructions" };
  const docs = [{ id: "1", version: 1, name: "Draft", role: "manuscript", text: "Study text." }];
  const custom = { custom: { title: "Custom", instruction: "Review the draft.", custom: true, revision: 1, fields: [] } };
  for (const key of [...Object.keys(workflows), "custom"]) {
    const { prompt } = buildPrompt(project, docs, key, {}, custom);
    assert.match(prompt, /do not ask follow-up or clarifying questions or wait for a reply/i, key);
    assert.doesNotMatch(prompt, /ask for (?:it|author information)/i, key);
  }
});
