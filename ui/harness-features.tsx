import { ChevronDown, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import deliveryCss from "../vendor/dsh/capabilities/Deliverables.module.css";
import goalCss from "../vendor/dsh/capabilities/GoalBar.module.css";
import planCss from "../vendor/dsh/capabilities/PlanPreview.module.css";
import { PresentedFileCard } from "../vendor/dsh/capabilities/PresentedFileCard.tsx";
import teamCss from "../vendor/dsh/capabilities/TeamBoard.module.css";
import { TodoPanel } from "../vendor/dsh/conversation/TodoPanel.tsx";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { Modal } from "../vendor/dsh/primitives/Modal.tsx";
import { StateDot } from "../vendor/dsh/primitives/StateDot.tsx";
import { maskCredentials } from "./credential-mask.ts";
import { api } from "./panel-shared.tsx";
import { PanelSearch } from "./pi-primitives.tsx";
import {
  action,
  appendDraft,
  type Job,
  loadJobs,
  refresh,
  run,
  setError,
  type Tool,
  useProjectionField,
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
export function HarnessModeDock({ inline = false }: { inline?: boolean }) {
  const harness = useProjectionField("harness"),
    busy = useProjectionField("busy"),
    syncing = useProjectionField("syncing"),
    syncFailed = useProjectionField("syncFailed"),
    connected = useProjectionField("connected"),
    changing = useProjectionField("changing");
  const disabled = busy || syncing || syncFailed || !connected || changing;
  if (!harness) return null;
  const g = harness.goal;
  const command = (value: string) =>
    void run(async () => {
      await action("prompt", value);
      await refresh();
    });
  return (
    <div className={inline ? "axiom-input-mode" : "plan-dock"}>
      <div className={goalCss.bar}>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => command(harness.planMode ? "/axiom-plan off" : "/axiom-plan on")}
        >
          {harness.planMode ? "退出计划模式" : "计划模式"}
        </Button>
        {g?.phase === "paused" && g.remaining > 0 && (
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => {
              if (window.confirm("重新授权剩余 " + g.remaining + " 轮目标推进？"))
                command("/axiom-goal resume");
            }}
          >
            恢复目标
          </Button>
        )}
        {g && (
          <>
            <span className={goalCss.objective} title={maskCredentials(g.objective)}>
              {maskCredentials(g.objective)} ·{" "}
              {g.phase === "completed"
                ? "模型报告完成"
                : g.phase === "exhausted"
                  ? "预算用尽"
                  : g.phase === "paused"
                    ? "暂停"
                    : "已设置"}{" "}
              · 剩余 {g.remaining}
            </span>
            <Button
              size="sm"
              disabled={disabled || g.phase !== "armed"}
              onClick={() => command("/axiom-goal pause")}
            >
              暂停
            </Button>
          </>
        )}
        <Button
          size="sm"
          disabled={disabled}
          onClick={() => {
            const objective = window.prompt("目标（仅在下一次主动发送任务后自动推进）");
            if (!objective?.trim()) return;
            const limit = window.prompt("额外自动推进轮数 1-10", "3");
            if (
              limit &&
              /^(?:[1-9]|10)$/.test(limit) &&
              window.confirm("允许 Pi 在下一次任务中额外推进 " + limit + " 轮？")
            )
              command("/axiom-goal " + limit + " " + objective.trim());
          }}
        >
          设置目标
        </Button>
      </div>
    </div>
  );
}
export function PlanDock() {
  const state = useProjectionField("state"),
    jobs = useProjectionField("jobs");
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
export function JobDetails({ job, insert }: { job: Job; insert?: (s: string) => void }) {
  const [detail, setDetail] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let current = true,
      timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const value = await api("jobs?view=detail&id=" + encodeURIComponent(job.id));
        if (current) {
          setDetail(value);
          setError("");
        }
      } catch (e) {
        if (current) setError(String(e));
      }
      if (current && ["queued", "running"].includes(job.status)) timer = setTimeout(read, 3000);
    }
    void read();
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [job.id, job.status]);
  if (error) return <p role="alert">{error}</p>;
  if (!detail || detail.id !== job.id) return <p>正在读取详情…</p>;
  return (
    <>
      <p>{maskCredentials(detail.error || detail.steps?.join("\n") || "")}</p>
      {detail.results?.map((r: any, i: number) => (
        <details key={i}>
          <summary>步骤 {i + 1}</summary>
          <pre>{r.text}</pre>
          {insert && (
            <Button size="sm" onClick={() => insert(r.text)}>
              引用结果
            </Button>
          )}
        </details>
      ))}
    </>
  );
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
          {members.some((j) => ["queued", "running"].includes(j.status)) && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (window.confirm("取消整个团队的未完成任务？"))
                  void run(async () => {
                    await api("job-action", { action: "team-cancel", value: { id: team } });
                    await loadJobs();
                  });
              }}
            >
              取消团队
            </Button>
          )}
          {!members.some((j) => ["queued", "running"].includes(j.status)) &&
            members.some((j) =>
              ["failed", "cancelled", "interrupted", "blocked"].includes(j.status),
            ) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  if (window.confirm("重试未完成团队任务？已完成依赖保留，失败步骤会重新运行。"))
                    void run(async () => {
                      await api("job-action", { action: "team-retry", value: { id: team } });
                      await loadJobs();
                    });
                }}
              >
                重试未完成任务
              </Button>
            )}
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
                    <JobDetails job={j} />
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
function toolStatus(tool: Tool, busy: boolean) {
  return tool.finished
    ? tool.failed
      ? "failed"
      : "done"
    : busy && tool.started !== undefined
      ? "running"
      : "pending";
}
const toolStatusLabel = { failed: "失败", done: "完成", running: "运行中", pending: "未记录结果" };
function ToolDetails({ tool }: { tool: Tool }) {
  const show = (value: unknown) =>
    maskCredentials(
      JSON.stringify(value, (_k, v) => (typeof v === "string" ? maskCredentials(v) : v), 2) ?? "",
    );
  return (
    <div className="pi-tool-detail">
      <h4>调用参数</h4>
      <pre>{show(tool.args) || "无记录"}</pre>
      <h4>返回结果</h4>
      <pre>{show(tool.result) || "无记录"}</pre>
    </div>
  );
}
export function TraceLedger({ tools, busy }: { tools: Tool[]; busy: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "running" | "failed" | "done" | "pending">("all");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const { counts, matching } = useMemo(() => {
    const counts = { all: tools.length, running: 0, failed: 0, done: 0, pending: 0 };
    const matching: Tool[] = [];
    const search = query.trim().toLowerCase();
    for (let index = tools.length - 1; index >= 0; index--) {
      const tool = tools[index];
      const status = toolStatus(tool, busy);
      counts[status]++;
      if (
        (filter === "all" || filter === status) &&
        (!search || maskCredentials(tool.name).toLowerCase().includes(search))
      )
        matching.push(tool);
    }
    return { counts, matching };
  }, [tools, busy, filter, query]);
  return (
    <div className="pi-tool-ledger">
      <div className="pi-tool-toolbar">
        <fieldset className="pi-tool-filters" aria-label="筛选工具状态">
          {(["all", "running", "failed", "done", "pending"] as const).map((status) => (
            <button
              type="button"
              key={status}
              aria-pressed={filter === status}
              onClick={() => {
                setFilter(status);
                setLimit(100);
              }}
            >
              {status === "all" ? "全部" : toolStatusLabel[status]} <b>{counts[status]}</b>
            </button>
          ))}
        </fieldset>
        <PanelSearch
          label="筛选工具名称"
          value={query}
          onChange={(value) => {
            setQuery(value);
            setLimit(100);
          }}
        />
        <p className="pi-tool-caption">{matching.length} 条记录 · 最新优先</p>
      </div>
      {matching.length === 0 && (
        <p className="pi-tool-empty">
          {tools.length ? "没有匹配记录" : "Pi 执行工具后，调用记录将显示在这里。"}
        </p>
      )}
      {matching.slice(0, limit).map((tool) => {
        const status = toolStatus(tool, busy);
        const open = selected === tool.id;
        return (
          <section key={tool.id} className="pi-tool-entry" data-kind="tool" data-status={status}>
            <button
              type="button"
              className="pi-tool-row"
              aria-expanded={open}
              onClick={() => setSelected(open ? null : tool.id)}
            >
              <span className="pi-tool-dot" aria-hidden="true" />
              <span className="pi-tool-name">
                <strong>{maskCredentials(tool.name)}</strong>
                <small>
                  {tool.turn === undefined ? "当前回合" : "回合 " + tool.turn} ·{" "}
                  {toolStatusLabel[status]}
                </small>
              </span>
              <span className="pi-tool-duration">
                {tool.started !== undefined && tool.ended !== undefined
                  ? Math.max(0, tool.ended - tool.started) + " ms"
                  : "—"}
              </span>
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            {open && <ToolDetails tool={tool} />}
          </section>
        );
      })}
      {matching.length > limit && (
        <button className="pi-more-button" type="button" onClick={() => setLimit(limit + 100)}>
          查看更早的工具记录（剩余 {matching.length - limit} 条）
        </button>
      )}
    </div>
  );
}
export function ObservedChanges({ tools }: { tools: Tool[] }) {
  const rows = tools.flatMap((tool) => {
    const change = (
      tool.details as
        | {
            axiomFileChange?: {
              path: string;
              kind: string;
              before: string | null;
              after: string;
              source: string;
              patch?: string;
            };
          }
        | undefined
    )?.axiomFileChange;
    return tool.finished &&
      !tool.failed &&
      change?.source === "direct-tool-observation" &&
      typeof change.path === "string" &&
      (change.before === null || typeof change.before === "string") &&
      typeof change.after === "string" &&
      ["created", "modified"].includes(change.kind)
      ? [{ ...change, id: tool.id, turn: tool.turn }]
      : [];
  });
  if (!rows.length) return null;
  return (
    <section aria-label="逐轮文件变更">
      <h4>直接工具文件变更</h4>
      {rows.map((row) => (
        <div className="wb-list-row" key={row.id}>
          <span>
            {row.turn === undefined ? "当前回合" : "回合 " + row.turn} ·{" "}
            {row.kind === "created" ? "创建" : "修改"} · {maskCredentials(row.path)}
            <small>
              {row.before?.slice(0, 12) ?? "不存在"} → {row.after.slice(0, 12)}
            </small>
          </span>
          {typeof row.patch === "string" && (
            <details>
              <summary>历史 Diff</summary>
              <pre>{maskCredentials(row.patch)}</pre>
            </details>
          )}
          <Button size="sm" onClick={() => openDelivery(row.path)}>
            预览当前文件
          </Button>
        </div>
      ))}
      <small>仅记录成功 write/edit 的前后摘要，不将 Shell 或外部文件修改推断为 Agent 所有。</small>
    </section>
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
