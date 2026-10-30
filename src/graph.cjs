// Validate a workflow graph and return a stable topological execution order.
function validateGraph(graph, definitions) {
  if (
    !graph ||
    !Array.isArray(graph.nodes) ||
    !Array.isArray(graph.edges) ||
    graph.nodes.length > 30 ||
    graph.edges.length > 100
  )
    throw new Error("A graph can have at most 30 steps and 100 connections.");
  const ids = new Set();
  for (const node of graph.nodes) {
    if (
      !node ||
      typeof node.id !== "string" ||
      !/^[a-zA-Z0-9-]{1,80}$/.test(node.id) ||
      ids.has(node.id) ||
      !Object.hasOwn(definitions, node.workflow)
    )
      throw new Error("Each step needs a unique ID and an available workflow.");
    ids.add(node.id);
    if (
      node.instructions != null &&
      (typeof node.instructions !== "string" ||
        node.instructions.length > 50000)
    )
      throw new Error("Step instructions are too long.");
  }
  const pairs = new Set();
  for (const edge of graph.edges) {
    const key = `${edge.from}:${edge.to}`;
    if (
      !ids.has(edge.from) ||
      !ids.has(edge.to) ||
      edge.from === edge.to ||
      pairs.has(key) ||
      !["order", "output"].includes(edge.type)
    )
      throw new Error(
        "Connections must join different steps, have a valid type, and be unique.",
      );
    pairs.add(key);
  }
  const remaining = [...graph.nodes],
    order = [];
  while (remaining.length) {
    const i = remaining.findIndex((n) =>
      graph.edges.every(
        (e) => e.to !== n.id || order.some((done) => done.id === e.from),
      ),
    );
    if (i < 0) throw new Error("Connections cannot form a cycle.");
    order.push(remaining.splice(i, 1)[0]);
  }
  return order;
}
module.exports = { validateGraph };
