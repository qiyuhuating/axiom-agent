// Explicit retry of an inactive, read-only team. Preserve completed DAG outputs.
export function retryTeam(state, id, activeIds) {
  const team = state.jobs.filter((j) => j.team === id);
  if (
    !team.length ||
    team.some((j) => activeIds.has(j.id) || ["queued", "running"].includes(j.status))
  )
    throw Error("Team must be inactive before retry");
  const retry = team.filter((j) =>
    ["failed", "cancelled", "interrupted", "blocked"].includes(j.status),
  );
  if (!retry.length) throw Error("No failed team tasks");
  if (retry.some((j) => j.write || j.cleanupError))
    throw Error("Cannot retry a writable task or an incompletely stopped worker");
  const nodes = new Set(retry.map((j) => j.node));
  state.mail = state.mail.filter((m) => m.team !== id || (!nodes.has(m.from) && !nodes.has(m.to)));
  for (const j of retry) {
    j.status = "queued";
    j.results = [];
    j.attempt = (j.attempt ?? 1) + 1;
    delete j.error;
    delete j.started;
    delete j.finished;
    j.activity = "";
  }
  return retry.length;
}
