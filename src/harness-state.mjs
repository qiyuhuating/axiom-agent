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
  return projectHarnessEntries(byId, leafId);
}
export function projectHarnessEntries(byId, leafId) {
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

export function projectSessionHistory({ tree, leafId }) {
  const rows = [];
  const pending = [];
  const byId = new Map();
  for (let i = tree.length - 1; i >= 0; i--) pending.push([tree[i], 0]);
  while (pending.length) {
    const [node, depth] = pending.pop();
    const { entry, children } = node;
    const message = entry.type === "message" ? entry.message : undefined;
    const content = message && ["user", "assistant"].includes(message.role) ? message.content : "";
    const row = {
      id: entry.id,
      depth,
      kind: message?.role ?? entry.type,
      label: typeof node.label === "string" ? node.label.slice(0, 200) : "",
      preview:
        typeof content === "string"
          ? content.slice(0, 200)
          : (content?.find((item) => item.type === "text")?.text ?? "").slice(0, 200),
      active: false,
    };
    rows.push(row);
    byId.set(entry.id, { row, parentId: entry.parentId });
    for (let i = children.length - 1; i >= 0; i--)
      pending.push([children[i], depth + Number(children.length > 1)]);
  }
  for (let id = leafId; byId.has(id); ) {
    const { row, parentId } = byId.get(id);
    row.active = true;
    id = parentId;
  }
  return { rows, leafId };
}

export function projectSessionHistoryEntries(entries, leafId) {
  const labels = new Map();
  for (const entry of entries) {
    if (entry.type === "label") {
      if (entry.label) labels.set(entry.targetId, entry.label);
      else labels.delete(entry.targetId);
    }
  }
  const nodes = new Map(
    entries.map((entry) => [entry.id, { entry, children: [], label: labels.get(entry.id) }]),
  );
  const tree = [];
  for (const entry of entries) {
    const node = nodes.get(entry.id);
    const parent = entry.parentId !== entry.id && nodes.get(entry.parentId);
    if (parent) parent.children.push(node);
    else tree.push(node);
  }
  for (const node of nodes.values())
    node.children.sort(
      (a, b) => new Date(a.entry.timestamp).getTime() - new Date(b.entry.timestamp).getTime(),
    );
  return projectSessionHistory({ tree, leafId });
}
