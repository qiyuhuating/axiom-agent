import { ChevronDown, Target } from "lucide-react";
import { useEffect, useState } from "react";
import deliveryCss from "../vendor/dsh/capabilities/Deliverables.module.css";
import goalCss from "../vendor/dsh/capabilities/GoalBar.module.css";
import planCss from "../vendor/dsh/capabilities/PlanPreview.module.css";
import { PresentedFileCard } from "../vendor/dsh/capabilities/PresentedFileCard.tsx";
import teamCss from "../vendor/dsh/capabilities/TeamBoard.module.css";
import trajectoryCss from "../vendor/dsh/capabilities/TrajectoryTable.module.css";
import { TodoPanel } from "../vendor/dsh/conversation/TodoPanel.tsx";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { Modal } from "../vendor/dsh/primitives/Modal.tsx";
import { StateDot } from "../vendor/dsh/primitives/StateDot.tsx";
import { maskCredentials } from "./credential-mask.ts";
import {
  appendDraft,
  type Job,
  loadJobs,
  setError,
  type Tool,
  useProjection,
} from "./projection.ts";
import { openDelivery, openPanel } from "./workbench.tsx";

const t = (key: string, params?: Record<string, number>) =>
  ({
    "todo.title": "计划",
    "todo.status.completed": "已完成",
    "todo.status.inProgress": "进行中",
    "todo.status.pending": "待处理",
    "todo.progress.done": `已完成 ${params?.done}`,
    "todo.progress.active": `进行中 ${params?.active}`,
    "todo.progress.pending": `待处理 ${params?.pending}`,
  })[key] ?? key;
export function PlanDock() {
  const { state, jobs } = useProjection();
  const [review, setReview] = useState(false);
  const plan = state ? jobs?.plans[state.sessionId] : undefined;
  useEffect(() => {
    if (state?.sessionId) void loadJobs().catch(setError);
  }, [state?.sessionId]);
  if (!plan || (!plan.goal && !plan.items.length)) return null;
  return (
    <div className="plan-dock">
      {plan.goal && (
        <div className={goalCss.dock}>
          <div className={goalCss.bar}>
            <Target size={14} className={goalCss.goalGlyph} />
            <span className={goalCss.label}>会话目标</span>
            <span className={goalCss.objective} title={maskCredentials(plan.goal)}>
              {maskCredentials(plan.goal)}
            </span>
            <Button size="sm" variant="ghost" onClick={() => openPanel("jobs")}>
              编辑
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setReview(true)}>
              审查
            </Button>
          </div>
        </div>
      )}
      <TodoPanel
        todos={plan.items.map((item) => ({
          content: maskCredentials(item.text),
          status: item.done ? "completed" : "pending",
        }))}
        t={t}
      />
      <Modal
        open={review}
        title="审查会话计划"
        closeLabel="关闭"
        onClose={() => setReview(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setReview(false)}>
              返回
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                appendDraft(
                  [
                    "目标：" + plan.goal,
                    ...plan.items.map((item) => (item.done ? "[x] " : "[ ] ") + item.text),
                  ].join("\n"),
                );
                setReview(false);
              }}
            >
              写入输入框
            </Button>
          </>
        }
      >
        <section className={planCss.preview}>
          <div className={planCss.document}>
            <strong>{maskCredentials(plan.goal)}</strong>
            <ul>
              {plan.items.map((item, i) => (
                <li key={i}>
                  {item.done ? "已完成：" : "待处理："}
                  {maskCredentials(item.text)}
                </li>
              ))}
            </ul>
            <p className="wb-muted">确认后只写入草稿，仍需主动发送给 Pi。</p>
          </div>
        </section>
      </Modal>
    </div>
  );
}
function displayState(status: string) {
  return status === "completed"
    ? "done"
    : status === "running"
      ? "ongoing"
      : ["failed", "interrupted"].includes(status)
        ? "error"
        : status === "blocked"
          ? "warning"
          : "idle";
}
export function TeamOverview({ jobs }: { jobs: Job[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const teams = new Map<string, Job[]>();
  for (const job of jobs) {
    if (job.team) {
      const members = teams.get(job.team) ?? [];
      members.push(job);
      teams.set(job.team, members);
    }
  }
  return (
    <>
      {Array.from(teams, ([team, members]) => (
        <section key={team} className={teamCss.board}>
          <div className={teamCss.progress}>
            团队 {team.slice(0, 8)} · {members.filter((j) => j.status === "completed").length}/
            {members.length}
          </div>
          <ul className={teamCss.tasks}>
            {members.map((j) => (
              <li className={teamCss.task} key={j.id} data-expanded={expanded === j.id}>
                <button
                  type="button"
                  className={teamCss.taskRow}
                  aria-expanded={expanded === j.id}
                  onClick={() => setExpanded(expanded === j.id ? null : j.id)}
                >
                  <span className={teamCss.glyph}>
                    <StateDot state={displayState(j.status)} />
                  </span>
                  <span className={teamCss.subject}>
                    {maskCredentials(j.label)} · {j.status}
                  </span>
                  <ChevronDown size={14} className={teamCss.chevron} />
                </button>
                {expanded === j.id && (
                  <div className={teamCss.details}>
                    <p className={teamCss.description}>
                      {maskCredentials(j.activity ?? j.error ?? j.steps?.join("\n") ?? "")}
                    </p>
                    <p className={teamCss.owner}>成员：{j.node ?? j.id.slice(0, 8)}</p>
                    {j.blockedBy?.length > 0 && <p>依赖：{j.blockedBy.join(", ")}</p>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
export function TraceLedger({ tools, busy }: { tools: Tool[]; busy: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const active = tools.find((t) => t.id === selected);
  const show = (value: unknown) =>
    maskCredentials(
      JSON.stringify(value, (_k, v) => (typeof v === "string" ? maskCredentials(v) : v), 2) ?? "",
    );
  return (
    <div className={trajectoryCss.split}>
      <div className={trajectoryCss.tablePane}>
        <table className={trajectoryCss.table}>
          <thead>
            <tr>
              <th>工具</th>
              <th>状态</th>
              <th>耗时</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr
                key={tool.id}
                data-kind="tool"
                data-selected={tool.id === selected}
                data-error={tool.failed || undefined}
              >
                <td className={trajectoryCss.content}>
                  <button
                    type="button"
                    onClick={() => setSelected(selected === tool.id ? null : tool.id)}
                  >
                    {maskCredentials(tool.name)}
                  </button>
                </td>
                <td>
                  {tool.finished ? (
                    <StateDot state={tool.failed ? "error" : "done"} />
                  ) : (
                    <StateDot state={busy && tool.started ? "ongoing" : "idle"} />
                  )}{" "}
                  {tool.finished
                    ? tool.failed
                      ? "失败"
                      : "完成"
                    : busy && tool.started
                      ? "运行"
                      : "未记录结果"}
                </td>
                <td>
                  {tool.started !== undefined && tool.ended !== undefined
                    ? Math.max(0, tool.ended - tool.started) + " ms"
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {active && (
          <details open>
            <summary>{maskCredentials(active.name)}</summary>
            <pre>{show({ arguments: active.args, result: active.result })}</pre>
          </details>
        )}
      </div>
    </div>
  );
}

export function DeliverableCards({ tools }: { tools: Tool[] }) {
  const files = new Map<string, { path: string; size: number }>();
  for (const tool of tools) {
    if (tool.name !== "present_files" || !tool.finished || tool.failed) continue;
    const result = tool.details as { kind?: string; files?: unknown[] } | undefined;
    if (result?.kind !== "axiom-deliverables-v1" || !Array.isArray(result.files)) continue;
    for (const row of result.files) {
      if (
        row &&
        typeof row === "object" &&
        "path" in row &&
        typeof row.path === "string" &&
        "size" in row &&
        typeof row.size === "number"
      )
        files.set(row.path, { path: row.path, size: row.size });
    }
  }
  if (!files.size) return null;
  return (
    <section className={deliveryCss.root} aria-label="会话交付物">
      <div className={deliveryCss.presented} data-single={files.size === 1}>
        {Array.from(files.values(), (file) => (
          <PresentedFileCard
            key={file.path}
            file={{ path: file.path, description: Math.ceil(file.size / 1024) + " KiB" }}
            cwd={undefined}
            phase={undefined}
            host={null}
            contextMenuProps={{}}
            actions={null}
            onPreview={() => openDelivery(file.path)}
            t={(key, args) =>
              key === "presented.previewCard"
                ? "预览 " + args?.name
                : key === "presented.preview"
                  ? "预览"
                  : "文件"
            }
          />
        ))}
      </div>
    </section>
  );
}
