/**
 * BROWSER panel (left): document root with unit indicator + tree of
 * browser nodes from the document snapshot. Supports expand/collapse,
 * eye-visibility toggles, hover states, and selection highlight.
 */
import {
  Bookmark,
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Crosshair,
  Eye,
  EyeOff,
  Globe,
  Layers3,
  Lock,
  MousePointer2,
  PenLine,
  Pencil,
  SlidersHorizontal,
  Square,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { useTranslation } from '../i18n';
import { cx } from '../lib/cx';
import {
  deleteTimelineFeature,
  editSketch,
  openConstructionPlane,
  pickDatumPlane,
  pickPlane,
} from '../engine/controller';
import { useAppStore } from '../store/appStore';
import type { BrowserNode, BrowserNodeKind } from '../types/document';
import type { FeatureDto } from '../types/document';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { DeleteFeatureDialog } from './DeleteFeatureDialog';

/** Localized label keys per node kind (nodes without an explicit name). */
const KIND_LABEL_KEYS: Record<BrowserNodeKind, string> = {
  document_settings: 'browser.documentSettings',
  named_views: 'browser.namedViews',
  origin: 'browser.origin',
  origin_plane_xy: 'browser.originPlaneXy',
  origin_plane_xz: 'browser.originPlaneXz',
  origin_plane_yz: 'browser.originPlaneYz',
  origin_center_point: 'browser.originCenterPoint',
  bodies_folder: 'browser.bodies',
  body: 'browser.bodies',
  sketches_folder: 'browser.sketches',
  sketch: 'browser.sketches',
  construction_folder: 'browser.construction',
  construction_plane: 'browser.constructionPlane',
};

const KIND_ICONS: Record<BrowserNodeKind, LucideIcon> = {
  document_settings: SlidersHorizontal,
  named_views: Bookmark,
  origin: Crosshair,
  origin_plane_xy: Square,
  origin_plane_xz: Square,
  origin_plane_yz: Square,
  origin_center_point: CircleDot,
  bodies_folder: Box,
  body: Box,
  sketches_folder: PenLine,
  sketch: PenLine,
  construction_folder: Layers3,
  construction_plane: Square,
};

const PLANE_BY_KIND: Partial<Record<BrowserNodeKind, 'xy' | 'xz' | 'yz'>> = {
  origin_plane_xy: 'xy',
  origin_plane_xz: 'xz',
  origin_plane_yz: 'yz',
};

interface BrowserContextTarget {
  node: BrowserNode;
  label: string;
  x: number;
  y: number;
}

function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function selectBrowserNode(node: BrowserNode, additive = false) {
  const state = useAppStore.getState();
  if (node.kind === 'body' && node.reference_id !== null) {
    state.selectSolidFeature(
      'body',
      node.reference_id,
      node.reference_id,
      null,
      additive,
    );
  } else {
    if (!additive) state.clearSolidSelection();
    state.selectNode(node.id);
  }
}

export function BrowserTree() {
  const { t } = useTranslation();
  const document = useAppStore((s) => s.document);
  const mode = useAppStore((s) => s.mode);
  const busy = useAppStore((s) => s.solidBusy);
  const expanded = useAppStore((s) => s.expanded);
  const hidden = useAppStore((s) => s.hidden);
  const solidScene = useAppStore((s) => s.solidScene);
  const datumPlanes = useAppStore((s) => s.datumPlanes);
  const activeSketchName = useAppStore((s) => s.activeSketch?.name ?? null);
  const [contextTarget, setContextTarget] = useState<BrowserContextTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FeatureDto | null>(null);

  const featureForNode = (node: BrowserNode): FeatureDto | null => {
    if (!document) return null;
    if (node.kind === 'sketch' && node.name) {
      return document.features.find(
        (feature) => feature.kind === 'sketch' && feature.name === node.name,
      ) ?? null;
    }
    if (node.kind === 'construction_plane' && node.reference_id !== null) {
      const featureId = datumPlanes.find(
        (plane) => plane.datum_id === node.reference_id,
      )?.feature_id;
      return document.features.find((feature) => feature.id === featureId) ?? null;
    }
    if (node.kind === 'body' && node.reference_id !== null) {
      const featureId = solidScene.bodies.find(
        (body) => body.id === node.reference_id,
      )?.feature_id;
      return document.features.find((feature) => feature.id === featureId) ?? null;
    }
    return null;
  };

  const contextEntries = (): ContextMenuEntry[] => {
    if (!contextTarget) return [];
    const { node } = contextTarget;
    const entries: ContextMenuEntry[] = [];
    const primary: ContextMenuEntry[] = [];
    const organization: ContextMenuEntry[] = [];
    const plane = PLANE_BY_KIND[node.kind];
    const isActiveSketch =
      node.kind === 'sketch' && node.name !== null && node.name === activeSketchName;
    const deleteFeature = featureForNode(node);

    if (plane) {
      primary.push({
        type: 'item',
        id: 'create-sketch',
        label: t('browser.createSketch'),
        icon: <PenLine size={14} />,
        disabled: mode === 'sketch' || busy,
        onSelect: () => void pickPlane(plane),
      });
    }
    if (node.kind === 'construction_plane' && node.reference_id !== null) {
      primary.push({
        type: 'item',
        id: 'create-sketch',
        label: t('browser.createSketch'),
        icon: <PenLine size={14} />,
        disabled: mode === 'sketch' || busy,
        onSelect: () => void pickDatumPlane(node.reference_id!),
      });
      const definition = useAppStore
        .getState()
        .datumPlanes.find((datum) => datum.datum_id === node.reference_id);
      if (definition) {
        primary.push({
          type: 'item',
          id: 'edit-plane',
          label: t('timeline.editFeature'),
          icon: <Pencil size={14} />,
          disabled: mode !== 'solid' || busy,
          onSelect: () =>
            openConstructionPlane(
              definition.source.type,
              definition.feature_id,
            ),
        });
      }
    }
    if (node.kind === 'sketch' && node.name !== null) {
      primary.push({
        type: 'item',
        id: 'edit-sketch',
        label: t('browser.editSketch'),
        icon: <Pencil size={14} />,
        disabled: isActiveSketch || mode !== 'solid' || busy,
        onSelect: () => void editSketch(node.name!),
      });
    }
    if (
      node.kind === 'body' ||
      node.kind === 'sketch' ||
      node.kind === 'construction_plane'
    ) {
      organization.push({
        type: 'item',
        id: hidden[node.id] ? 'show' : 'hide',
        label: hidden[node.id] ? t('browser.show') : t('browser.hide'),
        icon: hidden[node.id] ? <Eye size={14} /> : <EyeOff size={14} />,
        onSelect: () => useAppStore.getState().toggleHidden(node.id),
      });
    }
    if (node.children.length > 0) {
      organization.push({
        type: 'item',
        id: expanded[node.id] ? 'collapse' : 'expand',
        label: expanded[node.id] ? t('browser.collapse') : t('browser.expand'),
        icon: expanded[node.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />,
        onSelect: () => useAppStore.getState().toggleExpanded(node.id),
      });
    }

    entries.push(...primary);
    if (primary.length > 0 && organization.length > 0) {
      entries.push({ type: 'separator', id: 'primary-separator' });
    }
    entries.push(...organization);
    if (entries.length > 0) entries.push({ type: 'separator', id: 'select-separator' });
    entries.push({
      type: 'item',
      id: 'select',
      label: t('browser.select'),
      icon: <MousePointer2 size={14} />,
      onSelect: () => selectBrowserNode(node),
    });
    if (deleteFeature) {
      entries.push({ type: 'separator', id: 'delete-separator' });
      entries.push({
        type: 'item',
        id: 'delete-feature',
        label: t(
          node.kind === 'body'
            ? 'browser.deleteOwningFeature'
            : 'browser.deleteItem',
        ).replace('{name}', deleteFeature.name),
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: mode !== 'solid' || busy,
        onSelect: () => setDeleteTarget(deleteFeature),
      });
    }
    return entries;
  };

  return (
    <aside
      data-testid="browser-panel"
      className="flex w-60 shrink-0 flex-col border-r border-edge bg-panel"
    >
      <div className="flex h-7 shrink-0 items-center border-b border-edge px-2">
        <span className="text-[10px] font-semibold tracking-widest text-mute">
          {t('browser.title')}
        </span>
      </div>
      <div role="tree" className="min-h-0 flex-1 overflow-y-auto py-1">
        {document ? (
          <RootRow
            onOpenContext={(node, label, x, y) =>
              setContextTarget({ node, label, x, y })
            }
          />
        ) : null}
      </div>
      {contextTarget && (
        <ContextMenu
          point={contextTarget}
          entries={contextEntries()}
          ariaLabel={`${contextTarget.label} — ${t('browser.contextMenu')}`}
          onClose={() => setContextTarget(null)}
        />
      )}
      {deleteTarget && (
        <DeleteFeatureDialog
          feature={deleteTarget}
          busy={busy}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => {
            const featureId = deleteTarget.id;
            setDeleteTarget(null);
            void deleteTimelineFeature(featureId);
          }}
        />
      )}
    </aside>
  );
}

function RootRow({
  onOpenContext,
}: {
  onOpenContext: (node: BrowserNode, label: string, x: number, y: number) => void;
}) {
  const { t } = useTranslation();
  const document = useAppStore((s) => s.document)!;

  const units = document.settings.units;
  const unitsLabel = t(`browser.units.${units}`);

  return (
    <div>
      <div className="flex h-7 items-center gap-1 px-2 text-xs text-ink">
        <Globe size={13} className="shrink-0 text-mute" />
        <span className="min-w-0 flex-1 truncate font-medium">{document.name}</span>
        <span className="shrink-0 rounded border border-edge px-1 text-[9px] uppercase text-mute">
          {unitsLabel}
        </span>
      </div>
      <div>
        {document.browser.map((node) => (
          <NodeRow key={node.id} node={node} depth={1} onOpenContext={onOpenContext} />
        ))}
      </div>
    </div>
  );
}

function NodeRow({
  node,
  depth,
  onOpenContext,
}: {
  node: BrowserNode;
  depth: number;
  onOpenContext: (node: BrowserNode, label: string, x: number, y: number) => void;
}) {
  const { t } = useTranslation();
  const expanded = useAppStore((s) => !!s.expanded[node.id]);
  const hidden = useAppStore((s) => !!s.hidden[node.id]);
  const selected = useAppStore(
    (s) =>
      s.selectedNode === node.id ||
      (node.kind === 'body' &&
        node.reference_id !== null &&
        (s.selectedBody === node.reference_id ||
          s.selectedBodies.includes(node.reference_id))),
  );
  const toggleExpanded = useAppStore((s) => s.toggleExpanded);
  const toggleHidden = useAppStore((s) => s.toggleHidden);
  const mode = useAppStore((s) => s.mode);
  const hoveredPlane = useAppStore((s) => s.hoveredPlane);
  const hoveredDatumPlane = useAppStore((s) => s.hoveredDatumPlane);
  const setHoveredPlane = useAppStore((s) => s.setHoveredPlane);
  const setHoveredDatumPlane = useAppStore((s) => s.setHoveredDatumPlane);
  const activeSketchName = useAppStore((s) => s.activeSketch?.name ?? null);
  const activeFullyDefined = useAppStore((s) => s.activeSketch?.dof.fully_defined ?? false);

  const hasChildren = node.children.length > 0;
  const Icon = KIND_ICONS[node.kind];
  const label = node.name ?? t(KIND_LABEL_KEYS[node.kind]);

  // In pick-plane mode the origin plane rows hover-sync with the viewport
  // quads and act as plane pickers.
  const plane = PLANE_BY_KIND[node.kind];
  const picking = mode === 'pickPlane' && plane !== undefined;
  const pickingDatum =
    mode === 'pickPlane' &&
    node.kind === 'construction_plane' &&
    node.reference_id !== null;
  const planeHovered = picking && hoveredPlane === plane;
  const datumHovered =
    pickingDatum && hoveredDatumPlane === node.reference_id;
  const isActiveSketch = node.kind === 'sketch' && node.name !== null && node.name === activeSketchName;
  // A finished sketch re-enters editing via double-click or the pencil
  // affordance (M1d).
  const isEditableSketch = node.kind === 'sketch' && node.name !== null && !isActiveSketch && mode === 'solid';
  const reEdit = isEditableSketch ? () => void editSketch(node.name!) : undefined;
  const canToggleVisibility =
    node.kind === 'body' ||
    node.kind === 'sketch' ||
    node.kind === 'construction_plane';

  const openPointerContext = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    selectBrowserNode(node);
    event.currentTarget.focus({ preventScroll: true });
    onOpenContext(node, label, event.clientX, event.clientY);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const opensContextMenu = event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
    if (opensContextMenu) {
      event.preventDefault();
      event.stopPropagation();
      selectBrowserNode(node);
      const rect = event.currentTarget.getBoundingClientRect();
      onOpenContext(node, label, rect.left + Math.min(40, rect.width / 2), rect.bottom);
      return;
    }
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectBrowserNode(node);
    }
  };

  return (
    <div>
      <div
        role="treeitem"
        aria-expanded={hasChildren ? expanded : undefined}
        aria-haspopup="menu"
        tabIndex={0}
        data-browser-node-id={node.id}
        className={cx(
          'group flex h-6 cursor-pointer items-center gap-0.5 pr-1 text-xs hover:bg-header',
          selected && 'bg-accent/20 hover:bg-accent/25',
          hidden && 'opacity-50',
          planeHovered && 'bg-accent/25 hover:bg-accent/30',
          datumHovered && 'bg-accent/25 hover:bg-accent/30',
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
        onClick={(event) => {
          // macOS control-click emits a primary click as part of the
          // secondary-click gesture. Let onContextMenu own that gesture.
          if (event.ctrlKey && isMacPlatform()) return;
          if (picking && plane) {
            void pickPlane(plane);
            return;
          }
          if (pickingDatum) {
            void pickDatumPlane(node.reference_id!);
            return;
          }
          selectBrowserNode(
            node,
            event.shiftKey ||
              event.metaKey ||
              (event.ctrlKey && !isMacPlatform()),
          );
        }}
        onDoubleClick={reEdit}
        onContextMenu={openPointerContext}
        onKeyDown={onRowKeyDown}
        onMouseEnter={
          picking && plane
            ? () => setHoveredPlane(plane)
            : pickingDatum
              ? () => setHoveredDatumPlane(node.reference_id)
              : undefined
        }
        onMouseLeave={
          picking && plane
            ? () => setHoveredPlane(null)
            : pickingDatum
              ? () => setHoveredDatumPlane(null)
              : undefined
        }
      >
        <button
          type="button"
          aria-label={label}
          className={cx(
            'flex h-4 w-4 shrink-0 items-center justify-center rounded text-mute',
            hasChildren ? 'hover:text-ink' : 'invisible',
          )}
          onClick={(e) => {
            if (e.ctrlKey) return;
            e.stopPropagation();
            if (hasChildren) toggleExpanded(node.id);
          }}
        >
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        <Icon size={13} className={cx('shrink-0', isActiveSketch ? 'text-accent' : 'text-mute')} />
        <span className={cx('min-w-0 flex-1 truncate', isActiveSketch ? 'font-semibold text-accent' : 'text-ink')}>
          {label}
        </span>
        {isActiveSketch && activeFullyDefined && (
          <Lock size={11} className="shrink-0 text-mute" aria-label={t('browser.fullyDefined')} />
        )}

        {isEditableSketch && (
          <button
            type="button"
            title={t('browser.editSketch')}
            aria-label={t('browser.editSketch')}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-mute opacity-0 hover:bg-edge hover:text-ink group-hover:opacity-100"
            onClick={(e) => {
              if (e.ctrlKey) return;
              e.stopPropagation();
              reEdit!();
            }}
          >
            <Pencil size={11} />
          </button>
        )}

        {canToggleVisibility && (
          <button
            type="button"
            title={t('browser.toggleVisibility')}
            aria-label={t('browser.toggleVisibility')}
            className={cx(
              'flex h-4 w-4 shrink-0 items-center justify-center rounded text-mute hover:text-ink',
              hidden ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            onClick={(e) => {
              if (e.ctrlKey) return;
              e.stopPropagation();
              toggleHidden(node.id);
            }}
          >
            {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
      </div>

      {hasChildren && expanded && (
        <div>
          {node.children.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              onOpenContext={onOpenContext}
            />
          ))}
        </div>
      )}
    </div>
  );
}
