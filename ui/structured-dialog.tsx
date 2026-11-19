import { useState } from "react";
import { validateAnswer } from "../src/interaction-protocol.mjs";
import css from "../vendor/dsh/capabilities/QuestionComposer.module.css";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { Modal } from "../vendor/dsh/primitives/Modal.tsx";
import { api, msg } from "./panel-shared.tsx";
import type { Dialog } from "./projection.ts";
import { removeDialog } from "./projection.ts";

type Question = {
  id: string;
  question: string;
  header?: string;
  detail?: string;
  multiSelect: boolean;
  options: { label: string; description?: string }[];
};
type Request =
  | { kind: "questions"; questions: Question[] }
  | { kind: "plan-review"; title: string; markdown: string };
type Answer = { id: string; selected: string[]; custom: string; skipped: boolean };
export function StructuredDialog({ dialog, request }: { dialog: Dialog; request: Request }) {
  const [index, setIndex] = useState(0),
    [working, setWorking] = useState(false),
    [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [answers, setAnswers] = useState<Answer[]>(() =>
    request.kind === "questions"
      ? request.questions.map((q) => ({ id: q.id, selected: [], custom: "", skipped: false }))
      : [],
  );
  async function respond(value?: object) {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      const payload = value ? JSON.stringify(value) : undefined;
      if (payload !== undefined) validateAnswer(request, payload);
      await api("ui-response", {
        id: dialog.id,
        ...(payload === undefined ? { cancelled: true } : { value: payload }),
      });
      removeDialog(dialog.id);
    } catch (e) {
      setError(msg(e));
    } finally {
      setWorking(false);
    }
  }
  if (request.kind === "plan-review")
    return (
      <Modal
        open
        title={request.title}
        closeLabel="关闭"
        onClose={() => void respond()}
        footer={
          <>
            <Button
              variant="outline"
              disabled={working}
              onClick={() => void respond({ decision: "reject", feedback })}
            >
              拒绝
            </Button>
            <Button
              variant="outline"
              disabled={working || !feedback.trim()}
              onClick={() => void respond({ decision: "revise", feedback })}
            >
              要求修改
            </Button>
            <Button
              variant="primary"
              disabled={working}
              onClick={() => void respond({ decision: "approve", feedback })}
            >
              批准计划
            </Button>
          </>
        }
      >
        <pre style={{ whiteSpace: "pre-wrap", maxHeight: "50vh", overflow: "auto" }}>
          {request.markdown}
        </pre>
        <label>
          修改意见
          <textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            disabled={working}
          />
        </label>
        <p>批准仅退出计划模式，不改变现有工具权限。</p>
        {error && <p role="alert">{error}</p>}
      </Modal>
    );
  const question = request.questions[index],
    answer = answers[index];
  const patch = (value: Partial<Answer>) =>
    setAnswers((old) => old.map((a, i) => (i === index ? { ...a, ...value } : a)));
  const complete = (a: Answer) => a.skipped || a.selected.length > 0 || !!a.custom.trim();
  return (
    <Modal
      open
      title={question.header || "回答问题"}
      closeLabel="取消"
      onClose={() => void respond()}
      footer={
        <>
          <Button
            variant="outline"
            disabled={working || index === 0}
            onClick={() => setIndex((i) => i - 1)}
          >
            上一题
          </Button>
          <Button
            variant="outline"
            disabled={working}
            onClick={() => {
              patch({ selected: [], custom: "", skipped: true });
              if (index < answers.length - 1) setIndex((i) => i + 1);
            }}
          >
            跳过
          </Button>
          <Button
            variant="outline"
            disabled={working || index === answers.length - 1 || !complete(answer)}
            onClick={() => setIndex((i) => i + 1)}
          >
            下一题
          </Button>
          <Button
            variant="primary"
            disabled={working || !answers.every(complete)}
            onClick={() => void respond({ answers })}
          >
            提交答案
          </Button>
        </>
      }
    >
      <section className={css.body}>
        <p className={css.progress}>
          {index + 1} / {answers.length}
        </p>
        <h3>{question.question}</h3>
        {question.detail && <p>{question.detail}</p>}
        <div className={css.options}>
          {question.options.map((option, i) => {
            const selected = answer.selected.includes(option.label);
            return (
              <button
                type="button"
                key={option.label}
                className={css.option + (selected ? " " + css.optionSelected : "")}
                aria-pressed={selected}
                disabled={working}
                onClick={() =>
                  patch({
                    skipped: false,
                    selected: question.multiSelect
                      ? selected
                        ? answer.selected.filter((s) => s !== option.label)
                        : [...answer.selected, option.label]
                      : [option.label],
                    ...(!question.multiSelect ? { custom: "" } : {}),
                  })
                }
              >
                <span className={css.number}>{i + 1}</span>
                <span className={css.optionCopy}>
                  <span className={css.optionLabel}>{option.label}</span>
                  {option.description && (
                    <span className={css.description}>{option.description}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <label>
          自定义答案
          <textarea
            value={answer.custom}
            disabled={working}
            onChange={(e) =>
              patch({
                custom: e.target.value,
                skipped: false,
                ...(!question.multiSelect ? { selected: [] } : {}),
              })
            }
          />
        </label>
        {answer.skipped && <p>已跳过</p>}
        {error && <p role="alert">{error}</p>}
      </section>
    </Modal>
  );
}
