import {
  Command,
  FileText,
  FolderOpen,
  GitCompare,
  ListChecks,
  Plus,
  Search,
  Settings,
  SquareTerminal,
  SunMoon,
  TextCursorInput,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "./pi-primitives.tsx";
import { layoutActions } from "./shell-layout.ts";
import { openPanel } from "./workbench.tsx";

type Props = { locked: boolean; unavailable: boolean; onNew: () => void; onTheme: () => void };
export function CommandPalette({ locked, unavailable, onNew, onTheme }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const show = useCallback(() => {
    setQuery("");
    setSelected(0);
    setOpen(true);
  }, []);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.repeat ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        !event.shiftKey ||
        event.code !== "KeyP" ||
        document.querySelector('[role="dialog"][aria-modal="true"],[role="menu"]')
      )
        return;
      event.preventDefault();
      show();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [show]);
  const commands = [
    { label: "新建会话", hint: "New chat", Icon: Plus, disabled: locked, action: onNew },
    {
      label: "聚焦输入区",
      hint: "Composer",
      Icon: TextCursorInput,
      disabled: unavailable,
      action: () => {
        layoutActions.closeDrawer();
        document.getElementById("prompt")?.focus();
      },
    },
    { label: "打开文件浏览器", hint: "Files", Icon: FolderOpen, action: () => openPanel("files") },
    {
      label: "打开终端",
      hint: "Terminal",
      Icon: SquareTerminal,
      action: () => openPanel("terminal"),
    },
    { label: "查看代码差异", hint: "Git Diff", Icon: GitCompare, action: () => openPanel("diff") },
    {
      label: "查看执行轨迹",
      hint: "Trace",
      Icon: ListChecks,
      action: () => openPanel("trajectory"),
    },
    { label: "任务与计划", hint: "Tasks", Icon: FileText, action: () => openPanel("jobs") },
    { label: "打开设置", hint: "Settings", Icon: Settings, action: () => openPanel("settings") },
    { label: "切换深浅色", hint: "Appearance", Icon: SunMoon, action: onTheme },
  ].filter(
    (command) =>
      !command.disabled &&
      (command.label + " " + command.hint)
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );
  const current = Math.min(selected, Math.max(0, commands.length - 1));
  const choose = (index: number) => {
    const command = commands[index];
    if (!command) return;
    setOpen(false);
    requestAnimationFrame(command.action);
  };
  return (
    <>
      <button
        type="button"
        className="axiom-command-trigger"
        aria-label="快速操作"
        title="快速操作 (Ctrl+Shift+P)"
        aria-keyshortcuts="Control+Shift+P Meta+Shift+P"
        onClick={show}
      >
        <Command size={16} aria-hidden="true" />
        <span>快速操作</span>
        <kbd>Ctrl Shift P</kbd>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="快速操作"
        headless
        className="axiom-command-dialog"
      >
        <div className="axiom-command-search">
          <Search size={19} aria-hidden="true" />
          <input
            type="search"
            aria-label="搜索操作"
            data-modal-autofocus
            placeholder="搜索操作…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                if (commands.length)
                  setSelected(
                    (current + (event.key === "ArrowDown" ? 1 : -1) + commands.length) %
                      commands.length,
                  );
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(current);
              }
            }}
          />
          <button
            className="pi-more-button"
            type="button"
            aria-label="关闭快速操作"
            onClick={() => setOpen(false)}
          >
            Esc
          </button>
        </div>
        <div className="axiom-command-results">
          {commands.map(({ label, hint, Icon }, index) => (
            <button
              key={label}
              type="button"
              aria-current={index === current ? "true" : undefined}
              onClick={() => choose(index)}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
              <small>{hint}</small>
            </button>
          ))}
          {!commands.length && <p role="status">未找到匹配操作</p>}
        </div>
        <div className="axiom-command-help">
          <span>↑ ↓ 选择</span>
          <span>Enter 执行</span>
          <span>Esc 关闭</span>
        </div>
      </Modal>
    </>
  );
}
