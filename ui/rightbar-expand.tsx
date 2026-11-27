/** Adapted from upstream SidebarRight/ExpandButton: the conversation header corner seat. */
import { PanelRight } from "lucide-react";
import css from "../vendor/dsh/sidebar-right/ExpandButton.module.css";
import { Button } from "./pi-primitives.tsx";

export function RightbarExpand({
  expanded,
  narrow,
  onExpand,
}: {
  expanded: boolean;
  narrow: boolean;
  onExpand: () => void;
}) {
  // Upstream retains a hidden, disabled corner button on mobile to keep header width stable.
  if (expanded && !narrow) return null;
  return (
    <Button
      size="sm"
      id="show-workbench"
      className={css.button + (expanded ? " " + css.expanded : "")}
      disabled={expanded}
      aria-label="展开右侧栏"
      aria-expanded={expanded}
      title="展开右侧栏"
      data-sidebar-right-expand
      onClick={onExpand}
    >
      <PanelRight className={css.icon} size={18} />
    </Button>
  );
}
