// Pi RPC editor transport, versioned independently of rendering.
export const INTERACTION_TITLE = "Axiom structured interaction v1";
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const string = (v, max) => typeof v === "string" && v.trim().length > 0 && v.length <= max;
export function validateRequest(v) {
  if (!record(v)) throw Error("Invalid interaction request");
  if (v.kind === "plan-review") {
    if (!string(v.title, 200) || !string(v.markdown, 32000)) throw Error("Invalid plan document");
    return { kind: v.kind, title: v.title, markdown: v.markdown };
  }
  if (
    v.kind !== "questions" ||
    !Array.isArray(v.questions) ||
    v.questions.length < 1 ||
    v.questions.length > 12
  )
    throw Error("Expected 1 to 12 questions");
  const ids = new Set();
  const questions = v.questions.map((item) => {
    if (
      !record(item) ||
      !string(item.id, 80) ||
      ids.has(item.id) ||
      !string(item.question, 4000) ||
      (item.header !== undefined && !string(item.header, 200)) ||
      (item.detail !== undefined && !string(item.detail, 8000)) ||
      (item.multiSelect !== undefined && typeof item.multiSelect !== "boolean")
    )
      throw Error("Invalid or duplicate question");
    ids.add(item.id);
    const options = item.options ?? [];
    if (!Array.isArray(options) || options.length > 12) throw Error("Invalid question options");
    const labels = new Set();
    for (const o of options) {
      if (
        !record(o) ||
        !string(o.label, 250) ||
        labels.has(o.label) ||
        (o.description !== undefined && !string(o.description, 2000))
      )
        throw Error("Invalid or duplicate option");
      labels.add(o.label);
    }
    return {
      id: item.id,
      question: item.question,
      header: item.header,
      detail: item.detail,
      multiSelect: item.multiSelect === true,
      options: options.map((o) => ({ label: o.label, description: o.description })),
    };
  });
  return { kind: v.kind, questions };
}
export function decodeRequest(dialog) {
  if (dialog?.method !== "editor" || dialog.title !== INTERACTION_TITLE) return null;
  if (typeof dialog.prefill !== "string" || dialog.prefill.length > 256000)
    throw Error("Invalid interaction payload");
  return validateRequest(JSON.parse(dialog.prefill));
}
export function validateAnswer(request, value) {
  if (typeof value !== "string" || value.length > 96000)
    throw Error("Invalid interaction response");
  const answer = JSON.parse(value);
  if (!record(answer)) throw Error("Invalid interaction response");
  if (request.kind === "plan-review") {
    if (
      !["approve", "revise", "reject"].includes(answer.decision) ||
      (answer.feedback !== undefined &&
        (typeof answer.feedback !== "string" || answer.feedback.length > 8000)) ||
      (answer.decision === "revise" && !answer.feedback?.trim())
    )
      throw Error("Invalid plan decision");
    return { decision: answer.decision, feedback: answer.feedback?.trim() ?? "" };
  }
  if (!Array.isArray(answer.answers) || answer.answers.length !== request.questions.length)
    throw Error("Answer every question or explicitly skip");
  const values = new Map();
  for (const a of answer.answers) {
    const question = record(a) ? request.questions.find((q) => q.id === a.id) : undefined;
    if (
      !question ||
      values.has(a.id) ||
      !Array.isArray(a.selected) ||
      new Set(a.selected).size !== a.selected.length ||
      !a.selected.every((label) => question.options.some((o) => o.label === label)) ||
      (a.custom !== undefined && (typeof a.custom !== "string" || a.custom.length > 4000)) ||
      (a.skipped !== undefined && typeof a.skipped !== "boolean")
    )
      throw Error("Invalid answer");
    const custom = a.custom?.trim() ?? "";
    if (
      (!question.multiSelect && a.selected.length + (custom ? 1 : 0) > 1) ||
      (a.skipped === true && (a.selected.length || custom)) ||
      (!a.skipped && !a.selected.length && !custom)
    )
      throw Error("Select, write, or explicitly skip each question");
    values.set(a.id, {
      id: a.id,
      selected: a.selected,
      ...(custom ? { custom } : {}),
      ...(a.skipped ? { skipped: true } : {}),
    });
  }
  return { answers: request.questions.map((q) => values.get(q.id)) };
}
