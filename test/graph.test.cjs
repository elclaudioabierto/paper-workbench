const test = require("node:test");
const assert = require("node:assert/strict");
const { validateGraph } = require("../src/graph.cjs");
const definitions = { a: {}, b: {} };
test("orders a branching graph and rejects invalid connections", () => {
  const nodes = [
    { id: "c", workflow: "b" },
    { id: "a", workflow: "a" },
    { id: "b", workflow: "b" },
  ];
  const edges = [
    { from: "a", to: "c", type: "output" },
    { from: "b", to: "c", type: "order" },
  ];
  assert.deepEqual(
    validateGraph({ nodes, edges }, definitions).map((n) => n.id),
    ["a", "b", "c"],
  );
  assert.throws(
    () =>
      validateGraph(
        { nodes, edges: [...edges, { from: "c", to: "a", type: "order" }] },
        definitions,
      ),
    /cycle/,
  );
  assert.throws(
    () =>
      validateGraph(
        { nodes, edges: [...edges, { from: "a", to: "c", type: "order" }] },
        definitions,
      ),
    /unique/,
  );
  assert.throws(
    () =>
      validateGraph(
        { nodes, edges: [{ from: "a", to: "b", type: "invalid" }] },
        definitions,
      ),
    /valid type/,
  );
});
