/**
 * Constraint application from the CONSTRAIN panel (M1b): validate the
 * current selection for the chosen constraint, call the engine, and surface
 * invalid combos / D4.2 over-constraint conflicts in a modal dialog.
 */
import { EngineError, getEngine } from '../engine';
import type { ConstraintPayload, EntityDto } from '../engine/types';
import { translate } from '../i18n';
import { useAppStore } from '../store/appStore';

type Kind = EntityDto['kind'];

/** Client-side selection requirements per constraint icon id. */
const RULES: Record<
  string,
  {
    count: number | number[];
    kinds?: (ks: Kind[]) => boolean;
    build: (ids: number[]) => ConstraintPayload[];
    fix?: boolean;
  }
> = {
  hv: {
    count: [1, 2, 3, 4, 5, 6, 7, 8],
    kinds: (ks) => ks.every((k) => k === 'line'),
    // Apply H to near-horizontal lines and V to near-vertical ones.
    build: () => [],
  },
  coincident: { count: 2, build: ([a, b]) => [{ type: 'coincident', a, b }] },
  tangent: { count: 2, build: ([a, b]) => [{ type: 'tangent', a, b }] },
  equal: { count: 2, build: ([a, b]) => [{ type: 'equal', a, b }] },
  parallel: {
    count: 2,
    kinds: (ks) => ks.every((k) => k === 'line'),
    build: ([a, b]) => [{ type: 'parallel', a, b }],
  },
  perpendicular: {
    count: 2,
    kinds: (ks) => ks.every((k) => k === 'line'),
    build: ([a, b]) => [{ type: 'perpendicular', a, b }],
  },
  fixUnfix: { count: [1, 2, 3, 4, 5, 6, 7, 8], fix: true, build: () => [] },
  midpoint: {
    count: 2,
    kinds: (ks) => ks.filter((kind) => kind === 'point').length === 1 && ks.filter((kind) => kind === 'line').length === 1,
    build: ([a, b]) => [{ type: 'midpoint', a, b }],
  },
  concentric: { count: 2, build: ([a, b]) => [{ type: 'concentric', a, b }] },
  collinear: {
    count: 2,
    kinds: (ks) => ks.every((k) => k === 'line'),
    build: ([a, b]) => [{ type: 'collinear', a, b }],
  },
  symmetry: {
    count: 3,
    kinds: (ks) =>
      (ks.filter((kind) => kind === 'point').length === 2 &&
        ks.filter((kind) => kind === 'line').length === 1) ||
      ks.every((kind) => kind === 'line'),
    build: ([a, b, axis]) => [{ type: 'symmetry', a, b, axis }],
  },
};

export async function applyConstraintById(iconId: string | undefined): Promise<void> {
  const s = useAppStore.getState();
  const sketch = s.activeSketch;
  if (!sketch || !iconId) return;
  const rule = RULES[iconId];
  if (!rule) {
    s.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: translate('constraints.unsupported'),
    });
    return;
  }

  const ids = [
    ...new Set([
      ...s.selectedEntities,
      ...(s.selectedEntity !== null && !s.selectedEntities.includes(s.selectedEntity)
        ? [s.selectedEntity]
        : []),
    ]),
  ];
  const byId = new Map(sketch.entities.map((e) => [e.id, e]));
  const kinds = ids.map((id) => byId.get(id)?.kind ?? ('missing' as const));

  const counts = Array.isArray(rule.count) ? rule.count : [rule.count];
  if (!counts.includes(ids.length) || (rule.kinds && !rule.kinds(kinds as Kind[]))) {
    s.setConstraintDialog({
      titleKey: 'constraints.invalidTitle',
      message: translate(`constraints.needs.${iconId}`),
    });
    return;
  }

  // Normalize order-sensitive engine payloads from entity kinds. For
  // all-line Symmetry, the most recently selected (primary) line is the
  // explicit axis; point/line combinations are fully inferable.
  let orderedIds = [...ids];
  if (iconId === 'midpoint') {
    const point = ids.find((id) => byId.get(id)?.kind === 'point');
    const line = ids.find((id) => byId.get(id)?.kind === 'line');
    if (point !== undefined && line !== undefined) orderedIds = [point, line];
  } else if (iconId === 'symmetry') {
    const points = ids.filter((id) => byId.get(id)?.kind === 'point');
    const lines = ids.filter((id) => byId.get(id)?.kind === 'line');
    if (points.length === 2 && lines.length === 1) {
      orderedIds = [points[0], points[1], lines[0]];
    } else if (lines.length === 3) {
      const axis =
        s.selectedEntity !== null && lines.includes(s.selectedEntity)
          ? s.selectedEntity
          : lines[lines.length - 1];
      orderedIds = [...lines.filter((id) => id !== axis), axis];
    }
  }

  const engine = await getEngine();
  try {
    if (rule.fix) {
      const result = await engine.toggleFixEntities(orderedIds);
      s.setActiveSketch(result.sketch);
      return;
    }
    if (iconId === 'hv') {
      // Per-line H or V by the line's dominant axis.
      const constraints = orderedIds.flatMap((id) => {
        const entity = byId.get(id);
        if (!entity || entity.kind !== 'line') return [];
        const horizontal =
          Math.abs(entity.end.x - entity.start.x) >= Math.abs(entity.end.y - entity.start.y);
        return [{
          type: horizontal ? 'horizontal' : 'vertical',
          entity: id,
        } as const];
      });
      const result = await engine.addConstraints(constraints);
      s.setActiveSketch(result.sketch);
      return;
    }
    const result = await engine.addConstraints(rule.build(orderedIds));
    s.setActiveSketch(result.sketch);
  } catch (err) {
    if (err instanceof EngineError) {
      const report = err.data as
        | { rejected: { kind: string; entities: Array<{ label: string }> }; conflicts_with: Array<{ kind: string; entities: Array<{ label: string }> }> }
        | undefined;
      s.setConstraintDialog({
        titleKey: report ? 'constraints.conflictTitle' : 'constraints.invalidTitle',
        message: err.message,
        conflicts: report,
      });
    } else {
      s.setConstraintDialog({
        titleKey: 'constraints.invalidTitle',
        message: err instanceof Error ? err.message : 'Cannot apply constraint',
      });
    }
  }
}
