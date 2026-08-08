/**
 * Bottom navigation bar (center-bottom viewport overlay): MODAL nav tools
 * (Orbit / Pan / Zoom / Zoom Window), Fit, display & grid settings. In
 * sketch mode undo/redo buttons dock on the left, wired to the engine
 * command stack.
 *
 * Modal behavior: clicking a tool button activates it (accent
 * highlight); left-drag in the viewport applies it; clicking it again (or
 * Esc, or the ribbon Select button) returns to Select. Free-orbit via
 * MMB/Shift+MMB/right-drag/wheel stays untouched (D7).
 */
import {
  Focus,
  Gamepad2,
  Grid3x3,
  Hand,
  Maximize,
  Monitor,
  Move3d,
  Redo2,
  SquareDashed,
  Undo2,
  ZoomIn,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { isTauriRuntime } from '../../engine';
import { redoSketch, undoSketch } from '../../engine/controller';
import {
  createSixDofMouseController,
  type SixDofMouseConnectionStatus,
  type SixDofMouseController,
} from '../../input/sixDofMouse';
import type { SixDofDriverView } from '../../input/threeDConnexionBridge';
import { useTranslation } from '../../i18n';
import { cx } from '../../lib/cx';
import { useAppStore, type NavTool } from '../../store/appStore';
import type { SixDofMotion } from './cameraApi';

export function NavBar({
  onFit,
  onSixDof,
  getSixDofDriverView,
}: {
  onFit: () => void;
  onSixDof: (motion: SixDofMotion) => void;
  getSixDofDriverView: () => SixDofDriverView | null;
}) {
  const { t } = useTranslation();
  const sketchMode = useAppStore((s) => s.mode === 'sketch');
  const canUndo = useAppStore((s) => s.activeSketch?.can_undo ?? false);
  const canRedo = useAppStore((s) => s.activeSketch?.can_redo ?? false);
  const navTool = useAppStore((s) => s.navTool);
  const setNavTool = useAppStore((s) => s.setNavTool);
  const requestLookAt = useAppStore((s) => s.requestLookAt);
  const [sixDofMouseStatus, setSixDofMouseStatus] = useState<SixDofMouseConnectionStatus>({
    state: 'disconnected',
    message: t('navbar.sixDofConnect'),
  });
  const sixDofMouseRef = useRef<SixDofMouseController | null>(null);
  const onSixDofRef = useRef(onSixDof);
  const onFitRef = useRef(onFit);
  onSixDofRef.current = onSixDof;
  onFitRef.current = onFit;

  useEffect(() => {
    const controller = createSixDofMouseController(
      (motion) => onSixDofRef.current(motion),
      setSixDofMouseStatus,
      (button) => {
        // The primary hardware button has a safe, useful default while the
        // richer installed-driver action interface remains optional.
        if (button === 1) onFitRef.current();
      },
      getSixDofDriverView,
    );
    sixDofMouseRef.current = controller;
    if (controller.supported) {
      const windowsDesktop =
        isTauriRuntime() && /Windows/i.test(navigator.userAgent);
      if (windowsDesktop) {
        // Do not touch hardware on Windows startup. All motion paths remain
        // inert until the user deliberately clicks the connection button.
        setSixDofMouseStatus({
          state: 'disconnected',
          message: 'Click to connect the 3D mouse through 3DxWare.',
        });
      } else {
        // Browsers may reconnect an already authorized raw-HID device.
        void controller.connect({
          requestPermission: false,
          allowDriverBridge: false,
        });
      }
    }
    else {
      setSixDofMouseStatus({
        state: 'unsupported',
        message: '3D mouse needs the desktop app or a compatible Chromium browser.',
      });
    }
    return () => {
      void controller.dispose();
      sixDofMouseRef.current = null;
    };
  }, []);

  const modal = (id: NavTool, label: string, icon: React.ReactNode) => {
    const active = navTool === id;
    return {
      id,
      label,
      icon,
      active,
      onClick: () => setNavTool(active ? 'select' : id),
    };
  };

  const buttons = [
    modal('orbit', t('navbar.orbit'), <Move3d size={15} />),
    modal('pan', t('navbar.pan'), <Hand size={15} />),
    modal('zoom', t('navbar.zoom'), <ZoomIn size={15} />),
    modal('zoomWindow', t('navbar.zoomWindow'), <SquareDashed size={15} />),
    { id: 'fit', label: t('navbar.fit'), icon: <Maximize size={15} />, active: false, onClick: onFit },
    { id: 'displaySettings', label: t('navbar.displaySettings'), icon: <Monitor size={15} />, active: false, onClick: undefined },
    { id: 'gridSettings', label: t('navbar.gridSettings'), icon: <Grid3x3 size={15} />, active: false, onClick: undefined },
  ];

  return (
    <div
      data-native-hud="navigation"
      data-native-six-dof-state={sixDofMouseStatus.state}
      data-native-viewport-overlay
      className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded border border-edge bg-header/90 px-1.5 py-1 backdrop-blur-sm"
    >
      {sketchMode && (
        <>
          <button
            type="button"
            data-native-nav-id="undo"
            title={t('navbar.undo')}
            disabled={!canUndo}
            onClick={() => void undoSketch()}
            className="flex h-6 w-6 items-center justify-center rounded text-mute transition-all duration-150 ease-out enabled:hover:-translate-y-px enabled:hover:bg-edge enabled:hover:text-ink disabled:opacity-40"
          >
            <Undo2 size={15} />
          </button>
          <button
            type="button"
            data-native-nav-id="redo"
            title={t('navbar.redo')}
            disabled={!canRedo}
            onClick={() => void redoSketch()}
            className="flex h-6 w-6 items-center justify-center rounded text-mute transition-all duration-150 ease-out enabled:hover:-translate-y-px enabled:hover:bg-edge enabled:hover:text-ink disabled:opacity-40"
          >
            <Redo2 size={15} />
          </button>
          <button
            type="button"
            data-native-nav-id="lookAtSketch"
            data-testid="look-at-sketch-nav"
            title={t('navbar.lookAtSketch')}
            aria-label={t('navbar.lookAtSketch')}
            onClick={requestLookAt}
            className="flex h-6 w-6 items-center justify-center rounded text-mute transition-all duration-150 ease-out hover:-translate-y-px hover:bg-edge hover:text-ink"
          >
            <Focus size={15} />
          </button>
          <div className="mx-1 h-4 w-px bg-edge" />
        </>
      )}
      {buttons.map((b) => (
        <button
          key={b.id}
          type="button"
          data-native-nav-id={b.id}
          data-native-nav-active={b.active ? 'true' : 'false'}
          title={b.label}
          disabled={!b.onClick}
          onClick={b.onClick}
          className={cx(
            'flex h-6 w-6 items-center justify-center rounded text-mute transition-all duration-150 ease-out enabled:hover:-translate-y-px enabled:hover:bg-edge enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-35',
            b.active && 'bg-accent/30 text-accent hover:bg-accent/40 hover:text-accent',
          )}
        >
          {b.icon}
        </button>
      ))}
      <div className="mx-1 h-4 w-px bg-edge" />
      <button
        type="button"
        data-native-nav-id="sixDof"
        data-testid="six-dof-mouse-connect"
        title={sixDofMouseStatus.message}
        aria-label={sixDofMouseStatus.message}
        disabled={
          sixDofMouseStatus.state === 'unsupported' ||
          sixDofMouseStatus.state === 'connecting'
        }
        onClick={() => {
          const controller = sixDofMouseRef.current;
          if (!controller) return;
          if (sixDofMouseStatus.state === 'connected') void controller.disconnect();
          else {
            void controller.connect({
              requestPermission: true,
              allowDriverBridge: true,
            });
          }
        }}
        className={cx(
          'relative flex h-6 w-6 items-center justify-center rounded text-mute transition-all duration-150 ease-out enabled:hover:-translate-y-px enabled:hover:bg-edge enabled:hover:text-ink disabled:cursor-not-allowed disabled:opacity-35',
          sixDofMouseStatus.state === 'connected' && 'bg-accent/25 text-accent',
        )}
      >
        <Gamepad2 size={15} />
        <span
          className={cx(
            'absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full border border-header',
            sixDofMouseStatus.state === 'connected'
              ? 'bg-emerald-400'
              : sixDofMouseStatus.state === 'connecting'
                ? 'animate-pulse bg-amber-400'
              : sixDofMouseStatus.state === 'error'
                ? 'bg-red-400'
                : 'bg-mute',
          )}
        />
      </button>
    </div>
  );
}
