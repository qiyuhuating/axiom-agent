// The native Pi session tree is the authority for custom state.
// Follow only the selected branch. Never project sibling/forked entries.
export function projectHarness({ tree, leafId }) {
  const nodes = [...tree],
    byId = new Map();
  while (nodes.length) {
    const node = nodes.pop();
    byId.set(node.entry.id, node.entry);
    for (const child of node.children) nodes.push(child);
  }
  let current = leafId,
    goal = null,
    planMode;
  while (current) {
    const entry = byId.get(current);
    if (!entry) break;
    if (entry.type === "custom") {
      if (entry.customType === "axiom-goal-v1" && goal === null) goal = entry.data;
      if (entry.customType === "axiom-plan-mode-v1" && planMode === undefined)
        planMode = entry.data === true;
    }
    if (goal !== null && planMode !== undefined) break;
    current = entry.parentId;
  }
  return { goal, planMode: planMode ?? false };
}
