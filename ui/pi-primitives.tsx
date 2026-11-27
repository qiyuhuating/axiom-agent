import { Check, Search, TriangleAlert, X } from "lucide-react";
import {
  type ButtonHTMLAttributes,
  type ComponentPropsWithoutRef,
  forwardRef,
  type KeyboardEventHandler,
  type ReactNode,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import { useModalLayer } from "../vendor/dsh/primitives/useModalLayer.ts";

export function PanelSearch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="pi-panel-search">
      <Search size={15} aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={label}
        aria-label={label}
      />
    </label>
  );
}

export type ButtonVariant = "primary" | "ghost" | "outline" | "toolbar";
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "md" | "sm";
  icon?: ReactNode;
};
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "ghost", size = "md", icon, className = "", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={"pi-button " + className}
      data-variant={variant}
      data-size={size}
      {...props}
    >
      {icon != null && (
        <span className="pi-button-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
});

export type StateDotState = "done" | "warning" | "ongoing" | "error" | "idle";
export function StateDot({
  state,
  size,
  className = "",
  appearance = "dot",
}: {
  state: StateDotState;
  size?: number;
  className?: string;
  appearance?: "dot" | "step";
}) {
  const edge = size ?? (state === "ongoing" ? 14 : 10);
  return (
    <span
      className={"pi-state-dot " + className}
      data-state={state}
      data-appearance={appearance}
      style={{ width: edge, height: edge }}
      aria-hidden="true"
    >
      {appearance === "step" && state === "done" && <Check size={edge - 2} />}
    </span>
  );
}
export function UserMessageBubble({ className = "", ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={"pi-user-surface " + className} {...props} />;
}

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  tone?: "warning";
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  shortcutModal?: string;
  onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>;
  backdropBlur?: boolean;
} & ({ headless: true; closeLabel?: never } | { headless?: false; closeLabel: string });
export function Modal({
  open,
  onClose,
  title,
  tone,
  description,
  children,
  footer,
  className = "",
  contentClassName = "",
  shortcutModal,
  onKeyDownCapture,
  backdropBlur = true,
  headless = false,
  closeLabel,
}: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  // Preserve the existing shared modal keyboard ownership while migrating its chrome.
  useModalLayer(dialog, open, onClose);
  if (!open) return null;
  return createPortal(
    <div className="pi-modal-layer" role="presentation" onKeyDownCapture={onKeyDownCapture}>
      <button
        type="button"
        tabIndex={-1}
        aria-label="关闭对话框"
        className="pi-modal-mask"
        data-blur={backdropBlur}
        onClick={onClose}
      />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-shortcut-modal={shortcutModal}
        className={"pi-modal-card " + className}
      >
        {headless ? (
          children
        ) : (
          <>
            <div className={"pi-modal-content " + contentClassName}>
              <header className="pi-modal-header">
                <h2>
                  {tone === "warning" && <TriangleAlert size={18} aria-hidden="true" />}
                  {title}
                </h2>
                <button
                  type="button"
                  className="pi-icon-button"
                  aria-label={closeLabel}
                  onClick={onClose}
                >
                  <X size={16} aria-hidden="true" />
                </button>
              </header>
              {description && <p className="pi-modal-description">{description}</p>}
              {children !== undefined && <div className="pi-modal-body">{children}</div>}
            </div>
            {footer !== undefined && <footer className="pi-modal-footer">{footer}</footer>}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
