import { Check, ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, Search } from "lucide-react";
import type { CSSProperties, KeyboardEvent } from "react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import css from "../vendor/dsh/model/ModelSelect.module.css";
import { MenuSurface } from "../vendor/dsh/primitives/MenuSurface.tsx";

type Model = { provider: string; id: string };
type Pane = "root" | "model" | "effort";
type Props = {
  models: Model[];
  levels: string[];
  current?: Model;
  effort?: string;
  sessionId?: string;
  disabled: boolean;
  onModel: (model: Model) => Promise<void>;
  onEffort: (level: string) => Promise<void>;
};

export function PiModelSelect({
  models,
  levels,
  current,
  effort,
  sessionId,
  disabled,
  onModel,
  onEffort,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState<Pane>("root");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const previousSession = useRef(sessionId);
  const id = useId().replaceAll(":", "");
  const style = { "--dsh-model-anchor": "--axiom-model-" + id } as CSSProperties;
  const groups = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const providers = new Map<string, Model[]>();
    for (const model of models) {
      if (normalized && !(model.id + " " + model.provider).toLowerCase().includes(normalized))
        continue;
      const list = providers.get(model.provider) ?? [];
      list.push(model);
      providers.set(model.provider, list);
    }
    return Array.from(providers, ([provider, choices]) => ({ provider, choices }));
  }, [models, query]);

  const close = () => {
    setOpen(false);
    setPane("root");
    setQuery("");
    trigger.current?.focus({ preventScroll: true });
  };
  const drill = (next: Pane) => {
    setQuery("");
    setPane(next);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (trigger.current?.contains(event.target) || menu.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  useEffect(() => {
    if (previousSession.current === sessionId) return;
    previousSession.current = sessionId;
    setOpen(false);
    setPane("root");
    setQuery("");
  }, [sessionId]);
  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);
  useLayoutEffect(() => {
    if (!open) return;
    if (pane === "model" && models.length > 4) {
      search.current?.focus({ preventScroll: true });
      return;
    }
    menu.current
      ?.querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled),[role="menuitemradio"]:not(:disabled)',
      )
      ?.focus({ preventScroll: true });
  }, [open, pane, models.length]);

  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      (event.key === "Tab" || event.key === "Enter") &&
      pane === "model" &&
      document.activeElement === search.current
    ) {
      const first = menu.current?.querySelector<HTMLButtonElement>(
        '[role="menuitemradio"]:not(:disabled)',
      );
      if (first) {
        event.preventDefault();
        first.click();
        return;
      }
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey && pane !== "root") drill("root");
      else close();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (pane === "root") close();
      else drill("root");
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const rows = Array.from(
        menu.current?.querySelectorAll<HTMLButtonElement>(
          '[role="menuitem"]:not(:disabled),[role="menuitemradio"]:not(:disabled)',
        ) ?? [],
      );
      if (!rows.length) return;
      event.preventDefault();
      const active = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        event.key === "ArrowDown"
          ? (active + 1) % rows.length
          : (active + rows.length - 1) % rows.length;
      rows[next]?.focus();
    } else if (event.key === "ArrowLeft" && pane !== "root") {
      event.preventDefault();
      drill("root");
    }
  };
  const choose = async (operation: () => Promise<void>) => {
    setPending(true);
    try {
      await operation();
      close();
    } finally {
      setPending(false);
    }
  };
  const currentLabel = current?.id ?? "选择模型";

  return (
    <div className={css.root + " axiom-model-select"} style={style}>
      <button
        ref={trigger}
        type="button"
        id="models"
        className={css.trigger}
        disabled={disabled || pending}
        aria-label="模型"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-busy={pending}
        title={[current?.provider, current?.id, effort].filter(Boolean).join(" / ")}
        onClick={() => {
          if (open) close();
          else {
            setPane("root");
            setQuery("");
            setOpen(true);
          }
        }}
      >
        <span className={css.triggerLabel}>{currentLabel}</span>
        {effort && <span className={css.triggerEffort}>{effort}</span>}
        {pending ? (
          <LoaderCircle size={12} className="axiom-model-spinner" />
        ) : (
          <ChevronDown size={12} className={css.chevron + (open ? " " + css.chevronOpen : "")} />
        )}
      </button>
      {open &&
        createPortal(
          <MenuSurface
            ref={menu}
            style={style}
            className={css.menu + " axiom-model-menu"}
            onKeyDown={onKeys}
            role="menu"
            aria-label="模型和思考强度"
          >
            {pane === "root" ? (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={css.cell}
                  onClick={() => drill("model")}
                >
                  <span className={css.cellLabel}>模型</span>
                  <span className={css.cellValue}>{currentLabel}</span>
                  <ChevronRight size={14} className={css.cellChevron} />
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={css.cell}
                  disabled={!levels.length}
                  onClick={() => drill("effort")}
                >
                  <span className={css.cellLabel}>思考强度</span>
                  <span className={css.cellValue}>{effort || "默认"}</span>
                  <ChevronRight size={14} className={css.cellChevron} />
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="axiom-model-back"
                  onClick={() => drill("root")}
                  aria-label="返回模型设置"
                >
                  <ChevronLeft size={14} />
                  {pane === "model" ? "选择模型" : "思考强度"}
                </button>
                {pane === "model" ? (
                  <>
                    {models.length > 4 && (
                      <label className="axiom-model-search">
                        <Search size={14} />
                        <input
                          ref={search}
                          aria-label="搜索模型"
                          placeholder="搜索模型或提供商"
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                        />
                      </label>
                    )}
                    <div className={css.groups + " axiom-model-groups"}>
                      {groups.map((group) => (
                        <div key={group.provider}>
                          <div className="axiom-model-provider">{group.provider}</div>
                          {group.choices.map((model) => {
                            const selected =
                              current?.provider === model.provider && current?.id === model.id;
                            return (
                              <button
                                type="button"
                                role="menuitemradio"
                                aria-checked={selected}
                                key={model.provider + ":" + model.id}
                                disabled={pending}
                                className={css.option + " axiom-model-option"}
                                onClick={() => void choose(() => onModel(model))}
                              >
                                <span className={css.optionCopy}>
                                  <span className={css.modelName}>{model.id}</span>
                                </span>
                                {selected && <Check className={css.check} size={14} />}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                      {!groups.length && <div className={css.empty}>没有匹配的模型</div>}
                    </div>
                  </>
                ) : (
                  <div className="axiom-model-groups">
                    {levels.map((level) => (
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={effort === level}
                        key={level}
                        disabled={pending}
                        className={css.option + " axiom-model-option"}
                        onClick={() => void choose(() => onEffort(level))}
                      >
                        <span className={css.optionCopy}>
                          <span className={css.modelName}>{level}</span>
                        </span>
                        {effort === level && <Check className={css.check} size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </MenuSurface>,
          document.body,
        )}
    </div>
  );
}
