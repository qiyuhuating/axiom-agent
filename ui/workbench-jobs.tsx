import { useEffect, useState } from "react";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { api, errorBox, Header, msg } from "./panel-shared.tsx";
import { appendDraft, getSnapshot, loadJobs, useProjection } from "./projection.ts";
import { JobDetails, TeamOverview } from "./team-overview.tsx";

const jobAction = (action: string, value: unknown) => api("job-action", { action, value });
export function Jobs() {
  const { jobs, state: session } = useProjection();
  const data = { value: jobs ?? { jobs: [], schedules: [], plans: {} }, load: loadJobs, error: "" };
  const [goal, setGoal] = useState(""),
    [plan, setPlan] = useState<{ text: string; done: boolean }[]>([]),
    [item, setItem] = useState(""),
    [label, setLabel] = useState(""),
    [steps, setSteps] = useState(""),
    [cron, setCron] = useState("0 9 * * *"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [expandedJob, setExpandedJob] = useState("");
  const [previousPages, setPreviousPages] = useState<string[]>([]);
  async function navigate(cursor: string, history: string[]) {
    setBusy(true);
    try {
      await loadJobs(cursor);
      setPreviousPages(history);
      setExpandedJob("");
      setError("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }
  const reloadJobs = data.load;
  useEffect(() => {
    let mounted = true;
    async function initialize() {
      try {
        const j = await loadJobs();
        const st = getSnapshot().state;
        if (!mounted || !st) return;
        const p = j.plans[st.sessionId];
        setGoal(p?.goal || "");
        setPlan(p?.items || []);
      } catch (e) {
        if (mounted) setError(msg(e));
      }
    }
    void initialize();
    const switched = () => void initialize();
    window.addEventListener("axiom:session", switched);
    const tick = setInterval(
      () =>
        void reloadJobs().catch((e) => {
          if (mounted) setError(msg(e));
        }),
      3000,
    );
    return () => {
      mounted = false;
      clearInterval(tick);
      window.removeEventListener("axiom:session", switched);
    };
  }, [reloadJobs]);
  async function execute(a: string, v: any) {
    setBusy(true);
    try {
      await jobAction(a, v);
      const creating = ["start", "team", "dag", "schedule-run"].includes(a);
      await loadJobs(creating ? "" : undefined);
      if (creating) setPreviousPages([]);
      setError("");
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  }
  async function savePlan(next = plan) {
    if (!session) return;
    setPlan(next);
    await execute("plan", { sessionId: session.sessionId, goal, items: next });
  }
  const [graph, setGraph] = useState("");
  const currentSteps = () =>
    steps
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  function startDag() {
    try {
      const nodes = JSON.parse(graph);
      if (!window.confirm("运行依赖图中的只读 Pi 智能体？")) return;
      void execute("dag", { label, model: session?.model, nodes });
    } catch (e) {
      setError(msg(e));
    }
  }
  const create = (a: string) => {
    if (
      !window.confirm(
        a === "schedule-create"
          ? "确认建立重复执行的只读 Pi 定时任务？"
          : "启动独立 Pi 后台任务？将使用当前模型账户。",
      )
    )
      return;
    void execute(a, {
      label,
      steps: currentSteps(),
      cron,
      model: session?.model,
    });
  };
  return (
    <div className="wb-panel">
      <Header>
        <strong>目标、工作流与 Agent Teams</strong>
        <Button size="sm" onClick={() => void data.load()}>
          刷新
        </Button>
      </Header>
      <div className="wb-scroll wb-form">
        {errorBox(error || data.error)}
        <h4>当前会话目标与计划</h4>
        <textarea
          aria-label="会话目标"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder="目标"
        />
        <Button size="sm" onClick={() => void savePlan()} disabled={busy}>
          保存目标
        </Button>
        {plan.map((p, i) => (
          <div className="wb-list-row" key={i}>
            <label className="wb-check">
              <input
                type="checkbox"
                checked={p.done}
                onChange={(e) =>
                  void savePlan(
                    plan.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)),
                  )
                }
              />
              {p.text}
            </label>
            <Button size="sm" onClick={() => void savePlan(plan.filter((_, j) => j !== i))}>
              移除
            </Button>
          </div>
        ))}
        <input placeholder="新增计划项" value={item} onChange={(e) => setItem(e.target.value)} />
        <Button
          size="sm"
          disabled={!item.trim() || busy}
          onClick={() => {
            void savePlan([...plan, { text: item.trim(), done: false }]);
            setItem("");
          }}
        >
          新增计划
        </Button>
        <Button
          size="sm"
          onClick={() =>
            appendDraft(
              "目标：" +
                goal +
                "\n计划：\n" +
                plan.map((p) => (p.done ? "[x] " : "[ ] ") + p.text).join("\n"),
            )
          }
        >
          把计划交给 Pi
        </Button>
        <h4>创建后台任务 / 工作流 / 团队</h4>
        <input placeholder="任务名称" value={label} onChange={(e) => setLabel(e.target.value)} />
        <textarea
          aria-label="任务步骤"
          placeholder="每行一个步骤或子智能体任务"
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          rows={5}
        />
        <p className="wb-muted">
          独立 Pi 会话。工作流依次执行各步，团队为每行建立独立只读子智能体。并发上限
          3；结果保留在本机。
        </p>
        <Button variant="primary" disabled={busy || !steps.trim()} onClick={() => create("start")}>
          运行工作流
        </Button>
        <Button variant="outline" disabled={busy || !steps.trim()} onClick={() => create("team")}>
          并行 Agent Team
        </Button>
        <label>
          定时表达式（Cron，本机时区）
          <input value={cron} onChange={(e) => setCron(e.target.value)} />
        </label>
        <Button
          variant="outline"
          disabled={busy || !steps.trim()}
          onClick={() => create("schedule-create")}
        >
          创建自动化
        </Button>
        <h4>DAG 依赖工作流</h4>
        <p className="wb-muted">
          JSON 节点数组，每个节点包含 id、prompt、dependsOn。依赖完成后自动运行，结果传给下游。
        </p>
        <textarea
          aria-label="DAG 节点"
          rows={6}
          value={graph}
          onChange={(e) => setGraph(e.target.value)}
          placeholder={JSON.stringify(
            [
              { id: "research", prompt: "分析项目", dependsOn: [] },
              { id: "review", prompt: "审查分析", dependsOn: ["research"] },
            ],
            null,
            2,
          )}
        />
        <Button variant="outline" disabled={busy || !graph.trim()} onClick={startDag}>
          运行 DAG
        </Button>
        <h4>计划任务</h4>
        {data.value.schedules.map((s: any) => (
          <div key={s.id} className="wb-job">
            <strong>{s.label}</strong>
            <small>
              {s.cron} · {s.timezone} · {s.enabled ? "启用" : "暂停"}
            </small>
            <div className="wb-bar">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void execute("schedule-toggle", { id: s.id })}
              >
                {s.enabled ? "暂停" : "启用"}
              </Button>
              <Button size="sm" onClick={() => void execute("schedule-run", { id: s.id })}>
                运行
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  if (window.confirm("删除定时任务？"))
                    void execute("schedule-delete", { id: s.id });
                }}
              >
                删除
              </Button>
            </div>
          </div>
        ))}
        <h4>团队消息</h4>
        {(data.value.mail || [])
          .slice(-50)
          .reverse()
          .map((m: any) => (
            <div className="wb-job" key={m.id}>
              <small>
                {m.team.slice(0, 8)} · {m.from} → {m.to}
              </small>
              <pre>{m.text}</pre>
            </div>
          ))}
        <h4>执行历史</h4>
        <TeamOverview jobs={jobs?.teamJobs ?? []} />
        {data.value.jobs.map((j: any) => (
          <div className="wb-job" key={j.id}>
            <strong>{j.label}</strong>
            <small>
              {j.status} {j.activity || ""}
              {j.team ? " · " + j.team.slice(0, 8) + " / " + (j.node || "成员") : ""}
              {j.blockedBy?.length ? " · " + j.blockedBy.length + " 个依赖" : ""}
            </small>
            {["queued", "running"].includes(j.status) && (
              <Button size="sm" onClick={() => void execute("cancel", { id: j.id })}>
                取消
              </Button>
            )}
            <Button
              size="sm"
              aria-expanded={expandedJob === j.id}
              onClick={() => setExpandedJob(expandedJob === j.id ? "" : j.id)}
            >
              任务详情
            </Button>
            {expandedJob === j.id && <JobDetails job={j} insert={appendDraft} />}
          </div>
        ))}
        {jobs?.cursor && (
          <Button disabled={busy} onClick={() => void navigate("", [])}>
            返回最新任务
          </Button>
        )}
        {!!previousPages.length && (
          <Button
            disabled={busy}
            onClick={() => void navigate(previousPages.at(-1)!, previousPages.slice(0, -1))}
          >
            上一页
          </Button>
        )}
        {jobs?.nextCursor && (
          <Button
            disabled={busy}
            onClick={() => void navigate(jobs.nextCursor!, [...previousPages, jobs.cursor])}
          >
            下一页
          </Button>
        )}
      </div>
    </div>
  );
}
