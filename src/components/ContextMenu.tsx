/**
 * Application-owned context menu shared by browser and desktop hosts.
 *
 * Keeping this in React makes secondary-click behavior identical in a web
 * browser, macOS WKWebView, and Windows WebView2. The menu is portaled out of
 * clipped panels, clamped to the current window, and supports the standard
 * keyboard context-menu gesture (handled by each opener) plus menu navigation.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx';

export type ContextMenuEntry =
  | {
      type: 'item';
      id: string;
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
      onSelect: () => void;
    }
  | {
      type: 'separator';
      id: string;
    };

export interface ContextMenuPoint {
  x: number;
  y: number;
}

const VIEWPORT_MARGIN = 6;

export function ContextMenu({
  point,
  entries,
  ariaLabel,
  onClose,
}: {
  point: ContextMenuPoint;
  entries: ContextMenuEntry[];
  ariaLabel: string;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [position, setPosition] = useState(point);

  useLayoutEffect(() => {
    // React Strict Mode re-runs layout effects in development. Capture the
    // opener only once so the second pass cannot replace it with the first
    // focused menu item and break Escape focus restoration.
    if (openerRef.current === null) {
      openerRef.current =
        window.document.activeElement instanceof HTMLElement
          ? window.document.activeElement
          : null;
    }

    const menu = menuRef.current;
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_MARGIN, window.innerWidth - rect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, window.innerHeight - rect.height - VIEWPORT_MARGIN);
    setPosition({
      x: Math.max(VIEWPORT_MARGIN, Math.min(point.x, maxLeft)),
      y: Math.max(VIEWPORT_MARGIN, Math.min(point.y, maxTop)),
    });

    // Keep pointer-opened menus visually neutral. The container receives
    // focus; ArrowUp/ArrowDown then moves focus to an item for keyboard users.
    menu.focus({ preventScroll: true });
  }, [point.x, point.y]);

  useEffect(() => {
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const closeForViewportChange = () => onClose();
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') closeAndRestoreFocus();
    };

    window.document.addEventListener('pointerdown', closeOnOutsidePointer, true);
    window.document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('blur', closeForViewportChange);
    window.addEventListener('resize', closeForViewportChange);
    window.addEventListener('scroll', closeForViewportChange, true);
    return () => {
      window.document.removeEventListener('pointerdown', closeOnOutsidePointer, true);
      window.document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('blur', closeForViewportChange);
      window.removeEventListener('resize', closeForViewportChange);
      window.removeEventListener('scroll', closeForViewportChange, true);
    };
  });

  const enabledItems = () => itemRefs.current.filter((item) => item && !item.disabled);

  const closeAndRestoreFocus = () => {
    const opener = openerRef.current;
    onClose();
    window.requestAnimationFrame(() => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = enabledItems();
    if (items.length === 0) return;
    const current = items.indexOf(window.document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = current < 0 ? 0 : (current + 1) % items.length;
    if (event.key === 'ArrowUp') next = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus({ preventScroll: true });
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-label={ariaLabel}
      data-context-menu
      data-native-viewport-overlay
      className="fixed z-[100] min-w-52 max-w-72 rounded border border-edge bg-header py-1 shadow-xl shadow-black/25 outline-none"
      style={{ left: position.x, top: position.y }}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry, index) => {
        if (entry.type === 'separator') {
          return <div key={entry.id} role="separator" className="mx-2 my-1 h-px bg-edge" />;
        }
        const activate = () => {
          if (entry.disabled) return;
          onClose();
          entry.onSelect();
        };
        return (
          <button
            key={entry.id}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={entry.disabled}
            aria-disabled={entry.disabled || undefined}
            data-context-menu-item={entry.id}
            onClick={activate}
            className={cx(
              'flex h-8 w-full items-center gap-2 px-3 text-left text-[11px] outline-none transition-colors',
              entry.disabled
                ? 'cursor-default text-mute'
                : entry.danger
                  ? 'cursor-pointer text-warn hover:bg-[rgb(var(--warn-rgb)/0.12)] focus-visible:bg-[rgb(var(--warn-rgb)/0.12)]'
                  : 'cursor-pointer text-ink hover:bg-edge focus-visible:bg-accent focus-visible:text-white',
            )}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-current">
              {entry.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.shortcut && (
              <span className="shrink-0 text-[10px] text-mute">{entry.shortcut}</span>
            )}
          </button>
        );
      })}
    </div>,
    window.document.body,
  );
}
