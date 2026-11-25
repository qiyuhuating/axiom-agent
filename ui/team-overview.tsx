import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import teamCss from "../vendor/dsh/capabilities/TeamBoard.module.css";
import { Button } from "../vendor/dsh/primitives/Button.tsx";
import { StateDot } from "../vendor/dsh/primitives/StateDot.tsx";
import { maskCredentials } from "./credential-mask.ts";
import { api } from "./panel-shared.tsx";
import { action, type Job, loadJobs, run, setError } from "./projection.ts";

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
